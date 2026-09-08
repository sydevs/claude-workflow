/**
 * The residue sweeper: every 30 minutes per repo, find what no event will
 * ever move again — a lock past its deadline, a retry whose window has
 * passed, a recheck nobody drained, an orphaned draft, an `awaiting` that
 * drifted — and turn each into a target. Runs on GitHub Actions, so it keeps
 * working through an outage of the routines.
 * (why: docs/why.md#awaiting-has-one-writer)
 */

import { loadRecord } from './record.mjs'
import { isBot } from './decide.mjs'

export async function listSweepTargets({ github, config, repo, now = new Date() }) {
  const { owner, name } = repo
  const L = config.labels
  const out = []
  const push = (kind, number, reason, facts = {}) => out.push({ repo, kind, number, reason, event: 'schedule', facts })

  const byLabel = async (label) => github.paginate(github.rest.issues.listForRepo, { owner, repo: name, state: 'open', labels: label, per_page: 100 })

  for (const i of await byLabel(L.lock)) {
    const kind = i.pull_request ? 'pr' : 'issue'
    const { rec } = await loadRecord(github, { owner, repo: name, number: i.number })
    const cur = rec.current
    if (!cur) { push(kind, i.number, 'sweep-timeout', { reason: 'lock without a record' }); continue }
    if (cur.deadline && Date.parse(cur.deadline) < now.getTime()) push(kind, i.number, 'sweep-timeout', { handler: cur.handler, attempt: cur.attempt })
  }

  for (const i of await byLabel(L.stuck)) {
    const kind = i.pull_request ? 'pr' : 'issue'
    const { rec } = await loadRecord(github, { owner, repo: name, number: i.number })
    const p = rec.pending
    if (!p) { push(kind, i.number, 'sweep-recheck'); continue }
    if (!p.retryAfter || Date.parse(p.retryAfter) <= now.getTime()) push(kind, i.number, 'sweep-retry', { handler: p.handler, attempt: p.attempt })
  }

  // Rechecks recorded while a lock was held but never drained (a missed unlabel event).
  const lockedNumbers = new Set()
  for (const i of await byLabel(L.lock)) lockedNumbers.add(i.number)
  const orphanHours = config.dispatch.orphanDraftHours ?? 6
  const bot = config.identity.expectedLogin
  const openPrs = await github.paginate(github.rest.pulls.list, { owner, repo: name, state: 'open', per_page: 100 })
  for (const pr of openPrs) {
    if (!isBot(pr.user?.login, config) || lockedNumbers.has(pr.number)) continue
    const labels = (pr.labels || []).map((l) => l.name)
    if (labels.includes(L.stuck)) continue
    if (pr.draft && Date.parse(pr.updated_at) < now.getTime() - orphanHours * 3600_000) push('pr', pr.number, 'sweep-orphan')
  }

  // Drain the implement queue for this repo.
  push('issue', 0, 'drain', {})

  // Awaiting drift: open items with neither lock nor stuck nor awaiting, last touched by the bot.
  const awaiting = new Set((await byLabel(L.awaiting)).map((i) => i.number))
  const stuck = new Set((await byLabel(L.stuck)).map((i) => i.number))
  const recent = await github.paginate(github.rest.issues.listForRepo, { owner, repo: name, state: 'open', sort: 'updated', direction: 'desc', per_page: 50 }, (res, done) => { if (res.data.length < 50) done(); return res.data })
  for (const i of recent.slice(0, 50)) {
    const labels = (i.labels || []).map((l) => l.name)
    if (labels.includes(L.journal) || labels.includes(L.lock) || awaiting.has(i.number) || stuck.has(i.number) || labels.includes(L.blocked)) continue
    if (Date.parse(i.updated_at) < now.getTime() - 2 * 3600_000) continue
    push(i.pull_request ? 'pr' : 'issue', i.number, 'sweep-awaiting')
  }

  return out
}
