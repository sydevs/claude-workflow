#!/usr/bin/env node
/**
 * migrate-to-status.mjs — the one-time backfill from the Stage / Hold Until model
 * to Status + labels, for the event-driven cutover. Runs on a laptop with `gh`
 * logged in as an org owner. Node stdlib only. NOT committed anywhere.
 *
 *   node migrate-to-status.mjs                          # dry run, every repo
 *   node migrate-to-status.mjs --only claude-workflow   # one repo
 *   node migrate-to-status.mjs --apply                  # write (snapshot first)
 *   node migrate-to-status.mjs --restore <snapshot.json> --apply
 *
 * Flags
 *   --config <path>        loop-config.json (default ./claude-workflow/loop-config.json)
 *   --snapshot <file>      where to write the pre-change snapshot (default ./migrate-snapshot-<ts>.json)
 *   --phase <p>            snapshot | labels | relationships | status | assignees | comments | tracking | all
 *   --limit <n>            stop after n items (dry-run sizing)
 *   --keep-assignees       leave the bot assigned
 *   --blocked-status <s>   Status for a parked ticket: "Revising" (default) or "none"
 *   --apply                actually write. Without it nothing changes.
 *
 * Mapping (plan C1). The org fields Stage / Hold Until / Priority / Effort are never written.
 *
 *   issue, open
 *     Stage Proposed, or no Stage and bot-authored  → Proposed; +proposal when bot-filed with no respondTo comment ever;
 *                                                      awaiting iff the newest comment is not a respondTo human's
 *     no Stage, human-authored                       → (none); -awaiting
 *     Revising                                       → Revising; awaiting iff the newest comment is the bot's; unassign bot
 *     Blocked, or a live Hold Until                  → --blocked-status; +blocked; -awaiting; Blocked by: → native relationship;
 *                                                      Hold Until → "Re-check: <date>" appended to ## Notes + one comment; unassign
 *     Implement                                      → (none); -awaiting; unassign; listed in the tracking issue
 *     Implemented, open PR closes it                 → Done; -awaiting
 *     Implemented, no open PR                        → (none); listed "close or re-issue"
 *   PR, open
 *     draft                                          → Revising; -awaiting
 *     ready, not approved by the reviewer            → Revising; +awaiting
 *     approved by the reviewer                       → Approved; awaiting only in a loopMayNotMerge repo
 *   closed issue / merged or closed PR on the board  → Done; -awaiting
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

// ---------- args ----------
const argv = process.argv.slice(2)
const flag = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? (argv[i + 1] ?? true) : def }
const has = (name) => argv.includes(name)
const APPLY = has('--apply')
const ONLY = flag('--only', null)
const LIMIT = Number(flag('--limit', 0)) || 0
const PHASE = flag('--phase', 'all')
const KEEP_ASSIGNEES = has('--keep-assignees')
const BLOCKED_STATUS = flag('--blocked-status', 'Revising')
const RESTORE = flag('--restore', null)
const CONFIG_PATH = flag('--config', './claude-workflow/loop-config.json')
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const SNAPSHOT = flag('--snapshot', `./migrate-snapshot-${STAMP}.json`)

if (!existsSync(CONFIG_PATH)) { console.error(`no config at ${CONFIG_PATH} (use --config)`); process.exit(2) }
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
const ORG = config.org
const BOT = config.identity.expectedLogin
const REVIEWER = config.assignment.reviewer
const RESPOND = new Set(config.assignment.respondTo.map((s) => s.toLowerCase()))
// Defaults cover a loop-config.json from before the config PR (#68) merged.
const L = { journal: 'ops-journal', awaiting: 'awaiting', stuck: 'stuck', blocked: 'blocked', lock: 'bot:working', proposal: 'proposal', ...config.labels }
const STATUS_NAMES = config.projects.status || { proposed: 'Proposed', revising: 'Revising', approved: 'Approved', done: 'Done' }
const COMMAND_PREFIX = config.dispatch?.commandPrefix || '@sydevs-bot'
const REPOS = ONLY ? [ONLY] : config.repos
const BLOCKED_BY = config.relationships?.bodyMarker || 'Blocked by:'
const RECHECK = config.relationships?.recheckMarker || 'Re-check:'
const NO_MERGE = new Set(config.mergePolicy?.loopMayNotMerge || [])

// ---------- gh helpers ----------
function gh(args, { input, allowFail = false } = {}) {
  try {
    return execFileSync('gh', args, { encoding: 'utf-8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    if (allowFail) return null
    console.error(`gh ${args.join(' ')}\n${e.stderr || e.message}`)
    throw e
  }
}
const api = (path, opts = {}) => { const out = gh(['api', path, ...(opts.paginate ? ['--paginate', '--slurp'] : [])], { allowFail: opts.allowFail }); if (out == null) return null; const j = JSON.parse(out); return opts.paginate ? j.flat() : j }
function graphql(query, variables = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`]
  for (const [k, v] of Object.entries(variables)) args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`)
  return JSON.parse(gh(args)).data
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
let writes = 0
function write(label, fn) {
  if (!APPLY) { console.log(`   would ${label}`); return null }
  const r = fn()
  writes += 1
  sleep(150)
  return r
}

// ---------- project ----------
const proj = graphql(`query($org:String!,$n:Int!){ organization(login:$org){ projectV2(number:$n){ id
  field(name:"Status"){ ... on ProjectV2SingleSelectField { id options { id name } } } } } }`, { org: ORG, n: config.projects.number }).organization.projectV2
const PROJECT_ID = proj.id
const STATUS_FIELD = proj.field.id
const OPTION = Object.fromEntries(proj.field.options.map((o) => [o.name, o.id]))
for (const name of Object.values(STATUS_NAMES)) if (!OPTION[name]) { console.error(`Status option "${name}" missing on the board — rename the options first (C2)`); process.exit(2) }

function projectItems() {
  const items = []
  let after = null
  for (;;) {
    const d = graphql(`query($id:ID!,$after:String){ node(id:$id){ ... on ProjectV2 { items(first:100, after:$after){ pageInfo{ hasNextPage endCursor }
      nodes{ id
        status: fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } }
        stage: fieldValueByName(name:"Stage"){ ... on ProjectV2ItemFieldSingleSelectValue { name } }
        hold: fieldValueByName(name:"Hold Until"){ ... on ProjectV2ItemFieldDateValue { date } }
        content{ __typename ... on Issue { id number state repository{ name } } ... on PullRequest { id number state merged repository{ name } } } } } } } }`,
      after ? { id: PROJECT_ID, after } : { id: PROJECT_ID }).node.items
    items.push(...d.nodes)
    if (!d.pageInfo.hasNextPage) break
    after = d.pageInfo.endCursor
  }
  return items
}

// ---------- gather ----------
console.log(`# ${APPLY ? 'APPLY' : 'DRY RUN'} · repos: ${REPOS.join(', ')} · phase: ${PHASE} · blocked → ${BLOCKED_STATUS}`)
const board = new Map() // "repo#n" -> { itemId, status, stage, hold, state, merged, contentId }
for (const it of projectItems()) {
  const c = it.content
  if (!c) continue
  board.set(`${c.repository.name}#${c.number}`, { itemId: it.id, contentId: c.id, kind: c.__typename === 'PullRequest' ? 'pr' : 'issue', status: it.status?.name || null, stage: it.stage?.name || null, hold: it.hold?.date || null, state: c.state, merged: c.merged || false })
}
console.log(`# board items: ${board.size}`)

// Org issue fields: the REST issue object carries `issue_field_values`
// ([{issue_field_name, data_type, value, single_select_option:{name}}]).
function fieldValues(issue, repo, n) {
  let v = issue?.issue_field_values
  if (!Array.isArray(v)) v = api(`repos/${ORG}/${repo}/issues/${n}/issue-field-values`, { allowFail: true })
  const out = {}
  for (const f of Array.isArray(v) ? v : []) out[f.issue_field_name] = f.single_select_option?.name ?? f.value ?? null
  return out
}
const today = new Date().toISOString().slice(0, 10)
const items = []
for (const repo of REPOS) {
  const open = api(`repos/${ORG}/${repo}/issues?state=open&per_page=100`, { paginate: true })
  // open PRs and what they close
  const prs = graphql(`query($o:String!,$r:String!){ repository(owner:$o,name:$r){ pullRequests(states:OPEN, first:100){ nodes{ number isDraft closingIssuesReferences(first:10){ nodes{ number repository{ name } } } } } } }`, { o: ORG, r: repo }).repository.pullRequests.nodes
  const closedBy = new Map()
  for (const pr of prs) for (const c of pr.closingIssuesReferences.nodes) closedBy.set(`${c.repository.name}#${c.number}`, pr.number)

  for (const i of open) {
    if ((i.labels || []).some((l) => l.name === L.journal)) continue
    const key = `${repo}#${i.number}`
    const b = board.get(key) || {}
    const kind = i.pull_request ? 'pr' : 'issue'
    const rec = { repo, number: i.number, key, kind, title: i.title, body: i.body || '', author: i.user.login, labels: (i.labels || []).map((l) => l.name), assignees: (i.assignees || []).map((a) => a.login), itemId: b.itemId || null, contentId: b.contentId || i.node_id, status: b.status || null, stage: b.stage || null, hold: b.hold || null, state: 'open' }
    if (kind === 'issue') { const fv = fieldValues(i, repo, i.number); rec.stage = fv.Stage || rec.stage || null; rec.hold = fv['Hold Until'] || rec.hold || null; rec.priority = fv.Priority || null; rec.effort = fv.Effort || null }
    if (kind === 'issue') {
      const comments = api(`repos/${ORG}/${repo}/issues/${i.number}/comments?per_page=100`, { paginate: true }) || []
      rec.newestCommentBy = comments.length ? comments[comments.length - 1].user.login : null
      rec.everRespondTo = comments.some((c) => RESPOND.has(String(c.user.login).toLowerCase()))
      rec.openPr = closedBy.get(key) || null
      rec.nativeBlockedBy = (api(`repos/${ORG}/${repo}/issues/${i.number}/dependencies/blocked_by`, { allowFail: true }) || []).map((d) => `${d.repository?.name || repo}#${d.number}`)
      rec.markerBlockers = [...rec.body.matchAll(new RegExp(`^${BLOCKED_BY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*https://github\\.com/${ORG}/([\\w.-]+)/issues/(\\d+)`, 'gim'))].map((m) => ({ repo: m[1], number: Number(m[2]) }))
    } else {
      const pr = api(`repos/${ORG}/${repo}/pulls/${i.number}`)
      rec.draft = pr.draft
      const reviews = api(`repos/${ORG}/${repo}/pulls/${i.number}/reviews?per_page=100`, { paginate: true }) || []
      const latest = {}
      for (const r of reviews) if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) latest[r.user.login] = r.state
      rec.approvedByReviewer = latest[REVIEWER] === 'APPROVED'
    }
    items.push(rec)
    if (LIMIT && items.length >= LIMIT) break
  }
  if (LIMIT && items.length >= LIMIT) break
}
// closed items still on the board with a Status other than Done
for (const [key, b] of board) {
  const [repo] = key.split('#')
  if (!REPOS.includes(repo)) continue
  if (b.state === 'OPEN') continue
  if (b.status === STATUS_NAMES.done) continue
  const number = Number(key.split('#')[1])
  const i = api(`repos/${ORG}/${repo}/issues/${number}`, { allowFail: true })
  items.push({ repo, number, key, kind: b.kind, title: i?.title || '', body: '', author: i?.user?.login || '', labels: (i?.labels || []).map((l) => l.name), assignees: (i?.assignees || []).map((a) => a.login), itemId: b.itemId, contentId: b.contentId, status: b.status, stage: b.stage, hold: b.hold, state: 'closed' })
}

// ---------- decide ----------
const isBot = (login) => String(login).toLowerCase() === BOT.toLowerCase()
const isRespond = (login) => login && RESPOND.has(String(login).toLowerCase())
const liveHold = (d) => d && d > today
function decide(r) {
  const p = { status: undefined, add: [], remove: [], unassign: false, comment: null, recheck: null, relationships: [], track: null, note: '' }
  const hasAwaiting = r.labels.includes(L.awaiting)
  if (r.state !== 'open') { p.status = STATUS_NAMES.done; if (hasAwaiting) p.remove.push(L.awaiting); p.note = 'closed'; return p }
  if (r.kind === 'pr') {
    if (r.draft) { p.status = STATUS_NAMES.revising; if (hasAwaiting) p.remove.push(L.awaiting); p.note = 'draft' }
    else if (r.approvedByReviewer) { p.status = STATUS_NAMES.approved; const want = NO_MERGE.has(r.repo); if (want && !hasAwaiting) p.add.push(L.awaiting); if (!want && hasAwaiting) p.remove.push(L.awaiting); p.note = 'approved' }
    else { p.status = STATUS_NAMES.revising; if (!hasAwaiting) p.add.push(L.awaiting); p.note = 'ready, unreviewed' }
    return p
  }
  const botAssigned = r.assignees.some(isBot)
  const parked = r.stage === 'Blocked' || liveHold(r.hold)
  if (parked) {
    p.status = BLOCKED_STATUS === 'none' ? null : STATUS_NAMES.revising
    if (!r.labels.includes(L.blocked)) p.add.push(L.blocked)
    if (hasAwaiting) p.remove.push(L.awaiting)
    p.unassign = botAssigned
    for (const m of r.markerBlockers) if (!r.nativeBlockedBy.includes(`${m.repo}#${m.number}`)) p.relationships.push(m)
    if (r.hold && !new RegExp(`^${RECHECK}`, 'm').test(r.body)) { p.recheck = r.hold; p.comment = `Parked until ${r.hold} (migrated from the retired Hold Until field). The loop mentions @${REVIEWER} when that date passes.` }
    p.note = `parked${r.hold ? ' until ' + r.hold : ''}`
    return p
  }
  switch (r.stage) {
    case 'Implement':
      p.status = null; if (hasAwaiting) p.remove.push(L.awaiting); p.unassign = botAssigned
      p.track = botAssigned ? 'was queued' : 'authorized, never queued'; p.note = 'Implement → re-authorize'; return p
    case 'Implemented':
      if (r.openPr) { p.status = STATUS_NAMES.done; if (hasAwaiting) p.remove.push(L.awaiting); p.unassign = botAssigned; p.note = `PR #${r.openPr} open` }
      else { p.status = null; if (hasAwaiting) p.remove.push(L.awaiting); p.unassign = botAssigned; p.track = 'close or re-issue'; p.note = 'Implemented, no open PR' }
      return p
    case 'Revising': {
      p.status = STATUS_NAMES.revising
      const want = r.newestCommentBy ? isBot(r.newestCommentBy) : !isRespond(r.author)
      if (want && !hasAwaiting) p.add.push(L.awaiting); if (!want && hasAwaiting) p.remove.push(L.awaiting)
      p.unassign = botAssigned; p.note = 'revising'; return p
    }
    default: {
      if (r.stage === 'Proposed' || isBot(r.author)) {
        p.status = STATUS_NAMES.proposed
        if (isBot(r.author) && !r.everRespondTo && !r.labels.includes(L.proposal)) p.add.push(L.proposal)
        const want = !isRespond(r.newestCommentBy)
        if (want && !hasAwaiting) p.add.push(L.awaiting); if (!want && hasAwaiting) p.remove.push(L.awaiting)
        p.unassign = botAssigned; p.note = 'proposed'
      } else { p.status = null; if (hasAwaiting) p.remove.push(L.awaiting); p.unassign = botAssigned; p.note = 'no stage → backlog' }
      return p
    }
  }
}
if (KEEP_ASSIGNEES) for (const r of items) r.keep = true

// ---------- restore ----------
if (RESTORE) {
  const snap = JSON.parse(readFileSync(RESTORE, 'utf-8'))
  console.log(`# restore from ${RESTORE}: ${snap.items.length} items`)
  for (const s of snap.items) {
    const cur = items.find((i) => i.key === s.key)
    const addA = s.labels.includes(L.awaiting) && !(cur?.labels || []).includes(L.awaiting)
    const bot = s.assignees.filter(isBot)
    console.log(`${s.key}: ${addA ? '+awaiting ' : ''}${bot.length && !(cur?.assignees || []).some(isBot) ? '+assign bot' : ''}`)
    if (addA) write(`add awaiting on ${s.key}`, () => gh(['api', '-X', 'POST', `repos/${ORG}/${s.repo}/issues/${s.number}/labels`, '-f', `labels[]=${L.awaiting}`]))
    if (bot.length && !(cur?.assignees || []).some(isBot)) write(`assign ${BOT} on ${s.key}`, () => gh(['api', '-X', 'POST', `repos/${ORG}/${s.repo}/issues/${s.number}/assignees`, '-f', `assignees[]=${BOT}`]))
  }
  console.log(`# done · ${writes} writes`)
  process.exit(0)
}

// ---------- plan + snapshot ----------
const plans = items.map((r) => ({ r, p: decide(r) }))
const tally = {}
const bump = (k) => { tally[k] = (tally[k] || 0) + 1 }
console.log('\nkey                              kind   stage/hold          → status     labels                 unassign  note')
for (const { r, p } of plans) {
  const lab = [...p.add.map((l) => '+' + l), ...p.remove.map((l) => '-' + l)].join(' ')
  console.log(`${r.key.padEnd(32)} ${r.kind.padEnd(6)} ${String((r.stage || '—') + (r.hold ? '/' + r.hold : '')).padEnd(19)} → ${String(p.status === undefined ? r.status || '—' : p.status || '(none)').padEnd(10)} ${lab.padEnd(22)} ${(p.unassign && !KEEP_ASSIGNEES ? 'yes' : '').padEnd(9)} ${p.note}${p.track ? ' · TRACK: ' + p.track : ''}`)
  bump(`status ${p.status === null ? '(none)' : p.status}`)
  for (const l of p.add) bump('+' + l)
  for (const l of p.remove) bump('-' + l)
  if (p.track) bump('tracked')
}
console.log('\n# tally'); for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${v.toString().padStart(3)}  ${k}`)

const runPhase = (name) => PHASE === 'all' || PHASE === name
if (runPhase('snapshot')) {
  const snap = { takenAt: new Date().toISOString(), repos: REPOS, items: items.map((r) => ({ key: r.key, repo: r.repo, number: r.number, kind: r.kind, labels: r.labels, assignees: r.assignees, status: r.status, stage: r.stage, hold: r.hold })) }
  writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2))
  console.log(`\n# snapshot written: ${SNAPSHOT}`)
}
if (!APPLY) { console.log('\n# dry run — pass --apply to write'); process.exit(0) }

// ---------- apply ----------
const issueIdCache = new Map()
const issueId = (repo, n) => { const k = `${repo}#${n}`; if (!issueIdCache.has(k)) issueIdCache.set(k, api(`repos/${ORG}/${repo}/issues/${n}`).id); return issueIdCache.get(k) }
for (const { r, p } of plans) {
  const base = `repos/${ORG}/${r.repo}/issues/${r.number}`
  console.log(`\n## ${r.key}`)
  if (runPhase('labels')) {
    if (p.add.length) write(`add ${p.add.join(',')}`, () => gh(['api', '-X', 'POST', `${base}/labels`, ...p.add.flatMap((l) => ['-f', `labels[]=${l}`])]))
    for (const l of p.remove) write(`remove ${l}`, () => gh(['api', '-X', 'DELETE', `${base}/labels/${encodeURIComponent(l)}`], { allowFail: true }))
  }
  if (runPhase('relationships')) for (const m of p.relationships) write(`blocked_by ${m.repo}#${m.number}`, () => gh(['api', '-X', 'POST', `${base}/dependencies/blocked_by`, '-F', `issue_id=${issueId(m.repo, m.number)}`], { allowFail: true }))
  if (runPhase('status') && p.status !== undefined) {
    let itemId = r.itemId
    if (!itemId) itemId = write('add to project', () => graphql(`mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item{ id } } }`, { p: PROJECT_ID, c: r.contentId }).addProjectV2ItemById.item.id)
    if (itemId && p.status !== r.status) {
      if (p.status === null) write('clear Status', () => graphql(`mutation($p:ID!,$i:ID!,$f:ID!){ clearProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f}){ projectV2Item{ id } } }`, { p: PROJECT_ID, i: itemId, f: STATUS_FIELD }))
      else write(`Status → ${p.status}`, () => graphql(`mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){ projectV2Item{ id } } }`, { p: PROJECT_ID, i: itemId, f: STATUS_FIELD, o: OPTION[p.status] }))
    }
  }
  if (runPhase('assignees') && p.unassign && !KEEP_ASSIGNEES) write(`unassign ${BOT}`, () => gh(['api', '-X', 'DELETE', `${base}/assignees`, '-f', `assignees[]=${BOT}`], { allowFail: true }))
  if (runPhase('comments')) {
    if (p.recheck) {
      const line = `${RECHECK} ${p.recheck} — migrated from the retired Hold Until field`
      const body = /^## Notes/m.test(r.body) ? r.body.replace(/^## Notes[^\n]*\n/m, (h) => `${h}${line}\n`) : `${r.body.trimEnd()}\n\n## Notes\n${line}\n`
      write('append Re-check to Notes', () => gh(['api', '-X', 'PATCH', base, '-f', `body=${body}`]))
    }
    if (p.comment) write('comment', () => gh(['api', '-X', 'POST', `${base}/comments`, '-f', `body=${p.comment}`]))
  }
}
if (runPhase('tracking')) {
  const tracked = plans.filter(({ p }) => p.track)
  if (tracked.length) {
    const title = 'chore(loop): re-authorize tickets after the event-driven cutover'
    const existing = api(`search/issues?q=${encodeURIComponent(`repo:${ORG}/${config.journalRepo} is:issue is:open in:title "${title}"`)}`)
    if (existing.total_count) console.log(`   tracking issue exists: ${existing.items[0].html_url}`)
    else {
      const byRepo = {}
      for (const { r, p } of tracked) (byRepo[r.repo] ||= []).push(`- [ ] ${ORG}/${r.repo}#${r.number} — ${r.title} _(${p.track})_`)
      const body = [
        'The cutover to the event-driven loop retired `Stage: Implement`. These tickets were authorized under the old model and are **not** auto-dispatched.',
        `To start one, comment \`${COMMAND_PREFIX} implement\` on it. To drop one, close it. Tick the box either way.`,
        '',
        ...Object.entries(byRepo).flatMap(([repo, lines]) => [`## ${repo}`, ...lines, '']),
      ].join('\n')
      write('create the tracking issue', () => console.log('   ' + gh(['api', '-X', 'POST', `repos/${ORG}/${config.journalRepo}/issues`, '-f', `title=${title}`, '-f', `body=${body}`]).match(/"html_url":"([^"]+\/issues\/\d+)"/)?.[1]))
    }
  }
}
console.log(`\n# done · ${writes} writes · snapshot ${SNAPSHOT}`)
