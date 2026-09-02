#!/usr/bin/env node

/**
 * The run's whole queue, in one call.
 *
 * Rung 0 was a dozen MCP searches, a per-repo PR list, a comment fetch per
 * candidate and a blocker read per ticket — every result crossing the context
 * window, nine times a day, so the run could re-derive a queue the assignee field
 * already stores. This prints the same queue as a table.
 *
 * What it does NOT do is decide. It reports what the queries found; which item to
 * work, and how, stays in the skill. Bodies are deliberately absent — only the
 * item actually being worked needs one
 * (why: docs/why.md#titles-yes-bodies-no).
 *
 * ## The blocker check is not optional
 *
 * Relationships have no MCP tool, so blocked-ness lives in a `Blocked by:` line in
 * the ticket body. That is the one place this script does read bodies, and it
 * resolves every URL it finds rather than trusting the line: a blocker that has
 * since closed does not block, and three consecutive journals once described one
 * such ticket as blocked. Rows carry `blockedBy` (still-open) and `cleared`
 * (closed, and the line should be struck).
 *
 * ## Usage
 *
 *   worklist.mjs [--since ISO8601] [--config path] [--json]
 *
 * `--since` bounds the mention sweep to what has moved since the last run — the
 * standing `mentions:` query has no date bound, so without it every mention ever
 * written re-surfaces on every pass.
 */

import { api, search, loadLoopConfig, flag } from '../../lib/gh.mjs'
import { readPr, mergeVerdict } from '../../lib/merge-gate.mjs'

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const config = loadLoopConfig(flag(argv, 'config'))

const ORG = config.org
const BOT = config.assignment.bot
const REVIEWER = config.assignment.reviewer
const READY = config.labels.readyToImplement
const JOURNAL = config.labels.journal
const HOLD = config.labels.hold

const key = (item) => {
  const m = /repos\/([^/]+\/[^/]+)\/issues\/(\d+)/.exec(item.url)
  return m ? `${m[1]}#${m[2]}` : item.html_url
}
const repoOf = (item) => /repos\/([^/]+\/[^/]+)\//.exec(item.url)?.[1] || null
const numOf = (item) => Number(/\/issues\/(\d+)/.exec(item.url)?.[1])
const labelsOf = (item) => (item.labels || []).map((l) => l.name)

/**
 * Still-open blockers named by the body, and the ones that have closed. Both are
 * returned: a cleared blocker is an edit the run owes the ticket, not just an
 * absence of a problem.
 */
function blockersOf(body) {
  const marker = config.relationships.bodyMarker
  const open = []
  const cleared = []
  const re = new RegExp(`^(?!~~)\\s*(?:[-*]\\s*)?${marker}\\s*<?(https://github\\.com/([^/]+)/([^/]+)/issues/(\\d+))`, 'gim')

  for (const m of String(body || '').matchAll(re)) {
    try {
      const issue = api(`repos/${m[2]}/${m[3]}/issues/${m[4]}`)
      ;(issue.state === 'open' ? open : cleared).push(`${m[2]}/${m[3]}#${m[4]}`)
    } catch {
      // Unreadable is not the same as absent. Never conclude "unblocked" from a
      // failed lookup — treat it as blocking and let a human see the URL.
      open.push(m[1])
    }
  }
  return { open, cleared }
}

// ── PRs the bot holds ───────────────────────────────────────────────────────
const botPrs = search(`org:${ORG} is:pr is:open assignee:${BOT}`).map((item) => {
  const repo = repoOf(item)
  const pr = readPr(repo, numOf(item))
  const gate = mergeVerdict(pr, repo, config.mergePolicy)
  return {
    key: key(item),
    title: item.title,
    rung: gate.verdict === 'MERGE' ? 1 : 2,
    verdict: gate.verdict,
    reason: gate.reason,
    unresolved: gate.unresolved,
    reviewDecision: pr.reviewDecision || 'NONE',
    draft: pr.isDraft,
    reviewRequested: (pr.reviewRequests?.nodes || []).some(
      (r) => r.requestedReviewer?.login === REVIEWER,
    ),
    closes: (pr.closingIssuesReferences?.nodes || []).map(
      (n) => `${n.repository.nameWithOwner}#${n.number}`,
    ),
  }
})

// ── Tickets the bot holds ───────────────────────────────────────────────────
const botIssues = search(`org:${ORG} is:issue is:open assignee:${BOT} -label:${JOURNAL}`).map(
  (item) => {
    const labels = labelsOf(item)
    const ready = labels.includes(READY)
    const { open, cleared } = ready ? blockersOf(item.body) : { open: [], cleared: [] }
    return {
      key: key(item),
      title: item.title,
      rung: ready ? 3 : 4,
      ready,
      onHold: labels.includes(HOLD),
      labels,
      blockedBy: open,
      cleared,
      priority: (item.field_values || []).find?.((f) => /priority/i.test(f.field_name || ''))?.value,
    }
  },
)

// ── Direct mentions — always a rung-4 candidate, whatever else matched ──────
const since = flag(argv, 'since')
const mentions = search(
  since ? `${config.identity.mentionQuery} updated:>=${since}` : config.identity.mentionQuery,
).map((item) => ({
  key: key(item),
  title: item.title,
  isPr: Boolean(item.pull_request),
}))

// ── WIP, against ceilings.wipCapPerRepo ─────────────────────────────────────
const wip = {}
for (const repo of config.repos) wip[repo] = 0
for (const pr of search(`org:${ORG} is:pr is:open author:${BOT}`)) {
  const r = repoOf(pr)?.split('/')[1]
  if (r && r in wip) wip[r] += 1
}

const out = {
  generatedAt: new Date().toISOString(),
  ceilings: config.ceilings,
  wip,
  atCap: Object.entries(wip)
    .filter(([, n]) => n >= config.ceilings.wipCapPerRepo)
    .map(([r]) => r),
  rung1: botPrs.filter((p) => p.rung === 1),
  rung2: botPrs.filter((p) => p.rung === 2),
  rung3: botIssues.filter((i) => i.rung === 3 && !i.onHold && i.blockedBy.length === 0),
  rung3Blocked: botIssues.filter((i) => i.rung === 3 && (i.onHold || i.blockedBy.length > 0)),
  rung4: botIssues.filter((i) => i.rung === 4),
  mentions,
  needsBlockerStrike: botIssues.filter((i) => i.cleared.length > 0),
}

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2))
} else {
  const rows = (label, items, fmt) => {
    console.log(`\n## ${label} (${items.length})`)
    if (!items.length) console.log('  —')
    for (const i of items) console.log(`  ${fmt(i)}`)
  }
  console.log(`WIP: ${Object.entries(wip).map(([r, n]) => `${r} ${n}`).join(' · ')}` +
    `   cap ${config.ceilings.wipCapPerRepo}${out.atCap.length ? `   AT CAP: ${out.atCap.join(', ')}` : ''}`)
  rows('Rung 1 — merge', out.rung1, (p) => `${p.key}  ${p.reason}  — ${p.title}`)
  rows('Rung 2 — PR health', out.rung2, (p) => `${p.key}  HOLD: ${p.reason}  — ${p.title}`)
  rows('Rung 3 — implement', out.rung3, (i) => `${i.key}  — ${i.title}`)
  rows('Rung 3 — blocked/held', out.rung3Blocked, (i) =>
    `${i.key}  ${i.onHold ? 'hold' : `blocked by ${i.blockedBy.join(', ')}`}  — ${i.title}`)
  rows('Rung 4 — reply / investigate', out.rung4, (i) => `${i.key}  — ${i.title}`)
  rows('Mentions', out.mentions, (m) => `${m.key}  — ${m.title}`)
  rows('Cleared blockers to strike', out.needsBlockerStrike, (i) =>
    `${i.key}  cleared: ${i.cleared.join(', ')}`)
}
