#!/usr/bin/env node
/**
 * migrate-to-lifecycle.mjs — the one-time move from the `awaiting` / `blocked` /
 * `stuck` labels and the Proposed / Revising / Approved / Done Status to the
 * derived lifecycle (docs/why.md#status-is-derived-never-read). Runs on a laptop
 * with `gh` logged in as an org owner. Node stdlib only. Dry run unless `--apply`.
 *
 *   node docs/rollback/migrate-to-lifecycle.mjs records            # BEFORE the merge
 *   node docs/rollback/migrate-to-lifecycle.mjs board --apply      # after it
 *   node docs/rollback/migrate-to-lifecycle.mjs labels --apply
 *   node docs/rollback/migrate-to-lifecycle.mjs reconcile --apply
 *
 * Phases, in this order:
 *   records    Approval moves into each issue's status comment: `approved: {by, at}` for an
 *              open issue on Status Approved, or whose record holds `pendingImplement`,
 *              `approveOnPlan` or the old `approved: true`, and for a goal that was planned
 *              (only `implement` plans one). An approved ticket (not a goal,
 *              whose `awaiting` meant its own review) that still carries `awaiting` gets
 *              `handback`, so it reads Awaiting and not an implement owed. `rehold` and
 *              `pendingImplement` go. An item a session holds is skipped: run it again after.
 *              The old dispatcher keeps every field it does not know when it saves a record,
 *              so this is safe to run first.
 *   board      Replaces the Status field's options with `projects.status`. `Done` keeps its id,
 *              so its items keep it; every other item's value is cleared, and `reconcile`
 *              writes them back.
 *   labels     Deletes `awaiting`, `blocked` and `stuck` in every repo in `repos`.
 *   reconcile  Dispatches each repo's `workflow-state.yml`, whose sweep reconciles every open
 *              item against the board.
 *
 * Flags: --apply (write), --only <repo>, --config <path> (default: this checkout's loop-config.json)
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseRecord, renderRecord, MARKER } from '../../dispatcher/record.mjs'

const argv = process.argv.slice(2)
const phase = argv[0]
const flag = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? (argv[i + 1] ?? true) : def }
const APPLY = argv.includes('--apply')
const ONLY = flag('--only', null)
const CONFIG = flag('--config', fileURLToPath(new URL('../../loop-config.json', import.meta.url)))
const PHASES = ['records', 'board', 'labels', 'reconcile']
if (!PHASES.includes(phase)) { console.error(`usage: migrate-to-lifecycle.mjs <${PHASES.join('|')}> [--apply] [--only <repo>]`); process.exit(2) }

const config = JSON.parse(readFileSync(CONFIG, 'utf-8'))
const ORG = config.org
const BOT = config.identity.expectedLogin
const REPOS = (config.repos || []).filter((r) => !ONLY || r === ONLY)
const OLD_LABELS = ['awaiting', 'blocked', 'stuck']
const COLORS = { awaiting: 'YELLOW', blocked: 'RED', hold: 'GRAY', pending: 'BLUE', working: 'ORANGE', done: 'GREEN' }
const DESCRIPTIONS = {
  awaiting: 'Your turn. The newest bot comment says what for.',
  blocked: 'Not approved; waits on an open blocker.',
  hold: 'Not approved; waits on its Hold Until date.',
  pending: 'The machinery owes the next move.',
  working: 'A session holds the lock.',
  done: 'Closed, or an issue whose PR is open.',
}
const token = execFileSync('gh', ['auth', 'token']).toString().trim()
const say = (m) => console.log(`${APPLY ? '' : '[dry] '}${m}`)

async function api(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) { const e = new Error(`${method} ${path}: ${res.status} ${data?.message || ''}`); e.status = res.status; throw e }
  return data
}
async function pages(path) {
  const out = []
  for (let page = 1; ; page += 1) {
    const data = await api('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    out.push(...data)
    if (data.length < 100) return out
  }
}
async function graphql(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }) })
  const j = await res.json()
  if (j.errors) throw new Error(JSON.stringify(j.errors))
  return j.data
}

/** `repo#number` → the board's Status name, for every item on the project. */
async function boardStatus() {
  const out = new Map()
  let after = null
  do {
    const d = await graphql(`query($o:String!,$n:Int!,$a:String){ organization(login:$o){ projectV2(number:$n){ items(first:100, after:$a){ pageInfo{ hasNextPage endCursor }
      nodes{ status: fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } content{ ... on Issue { number repository { name } } } } } } } }`, { o: ORG, n: config.projects.number, a: after })
    const items = d.organization.projectV2.items
    for (const n of items.nodes) if (n.content?.repository) out.set(`${n.content.repository.name}#${n.content.number}`, n.status?.name || null)
    after = items.pageInfo.hasNextPage ? items.pageInfo.endCursor : null
  } while (after)
  return out
}

async function records() {
  const board = await boardStatus()
  const at = new Date().toISOString()
  for (const repo of REPOS) {
    const issues = (await pages(`/repos/${ORG}/${repo}/issues?state=open`)).filter((i) => !i.pull_request)
    for (const i of issues) {
      const labels = i.labels.map((l) => l.name)
      if (labels.includes(config.labels.journal)) continue
      if (labels.includes(config.labels.lock)) { say(`${repo}#${i.number}: a session holds it — skipped, run again once it unlocks`); continue }
      const goal = i.type?.name === (config.roadmap?.type || 'Roadmap')
      const comments = await pages(`/repos/${ORG}/${repo}/issues/${i.number}/comments`)
      const own = comments.find((c) => String(c.user?.login).toLowerCase() === BOT.toLowerCase() && String(c.body || '').startsWith(MARKER))
      const rec = (own && parseRecord(own.body)) || null
      const was = board.get(`${repo}#${i.number}`)
      const by = rec?.pendingImplement?.by || rec?.approveOnPlan?.by || rec?.approved?.by || null
      const planned = goal && (rec?.dispatches || []).some((d) => d.handler === 'implement-roadmap')
      const approved = was === 'Approved' || planned || Boolean(rec?.pendingImplement || rec?.approveOnPlan || rec?.approved)
      const stale = rec && ('rehold' in rec || 'pendingImplement' in rec || rec.approved === true)
      if (!approved && !stale) continue
      const next = { ...(rec || { v: 1, fixCi: 0, recheck: false, pending: null, current: null, dispatches: [] }) }
      delete next.rehold
      delete next.pendingImplement
      if (approved && !(next.approved && typeof next.approved === 'object')) next.approved = { by, at, migrated: true }
      if (approved && !goal && labels.includes('awaiting') && !next.handback) next.handback = { reason: 'it was waiting on you before the lifecycle change', at }
      const what = [approved ? `approved${by ? ` by ${by}` : ''}` : null, next.handback && !rec?.handback ? 'handback' : null, stale ? 'tidied' : null].filter(Boolean).join(', ')
      say(`${repo}#${i.number} (${was || 'no Status'}${labels.length ? `, ${labels.join(' ')}` : ''}): ${what}`)
      if (!APPLY) continue
      const body = renderRecord(next)
      if (own) await api('PATCH', `/repos/${ORG}/${repo}/issues/comments/${own.id}`, { body })
      else await api('POST', `/repos/${ORG}/${repo}/issues/${i.number}/comments`, { body })
    }
  }
}

async function boardOptions() {
  const d = await graphql(`query($o:String!,$n:Int!){ organization(login:$o){ projectV2(number:$n){ field(name:"Status"){ ... on ProjectV2SingleSelectField { id options { id name } } } } } }`, { o: ORG, n: config.projects.number })
  const field = d.organization.projectV2.field
  // An option passed with its id keeps the items that hold it (Done); the rest are cleared.
  const kept = new Map(field.options.map((o) => [o.name, o.id]))
  const target = Object.entries(config.projects.status).map(([key, name]) => ({ ...(kept.has(name) ? { id: kept.get(name) } : {}), name, color: COLORS[key] || 'GRAY', description: DESCRIPTIONS[key] || '' }))
  say(`Status options: ${field.options.map((o) => o.name).join(', ')} → ${target.map((o) => o.name).join(', ')}`)
  if (!APPLY) return
  await graphql(`mutation($f:ID!,$o:[ProjectV2SingleSelectFieldOptionInput!]){ updateProjectV2Field(input:{ fieldId:$f, singleSelectOptions:$o }){ projectV2Field { ... on ProjectV2SingleSelectField { options { name } } } } }`, { f: field.id, o: target })
  console.log('Status options replaced. Run `reconcile --apply` next: every item\'s Status is empty until then.')
}

async function labels() {
  for (const repo of REPOS) {
    for (const name of OLD_LABELS) {
      say(`delete ${repo} label ${name}`)
      if (!APPLY) continue
      try { await api('DELETE', `/repos/${ORG}/${repo}/labels/${encodeURIComponent(name)}`) } catch (e) { if (e.status !== 404) throw e }
    }
  }
}

async function reconcile() {
  const workflow = (config.dispatch.callerWorkflow || '.github/workflows/workflow-state.yml').split('/').pop()
  for (const repo of REPOS) {
    say(`dispatch ${repo} ${workflow} on main`)
    if (APPLY) await api('POST', `/repos/${ORG}/${repo}/actions/workflows/${workflow}/dispatches`, { ref: 'main' })
  }
}

await { records, board: boardOptions, labels, reconcile }[phase]()
if (!APPLY) console.log('\nDry run: nothing was written. Add --apply to write.')
