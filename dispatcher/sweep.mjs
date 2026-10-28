/**
 * The residue sweeper: every 30 minutes per repo, find what no event will
 * ever move again — a lock past its deadline, a lease ref no session is
 * behind, an orphaned draft, a resolved review thread — and turn each into a
 * target. Then the reconciler: every open item's cheap view against the
 * board, and every Pending item for its due. Runs on GitHub Actions, so it
 * keeps working through an outage of the routines.
 * (why: docs/why.md#the-reconciler-replaces-the-drift-window)
 */

import { loadRecord } from './record.mjs'
import { isBot, fullTreatment } from './decide.mjs'
import { listLeases } from './lease.mjs'
import { cheapView, driftTargets } from './reconcile.mjs'

export async function listSweepTargets({ github, config, repo, now = new Date() }) {
  const { owner, name } = repo
  const L = config.labels
  const out = []
  const push = (kind, number, reason, facts = {}) => out.push({ repo, kind, number, reason, event: 'schedule', facts })

  const bot = config.identity.expectedLogin

  const byLabel = async (label) => github.paginate(github.rest.issues.listForRepo, { owner, repo: name, state: 'open', labels: label, per_page: 100 })

  const locked = await byLabel(L.lock)
  const lockedNumbers = new Set(locked.map((i) => i.number))
  for (const i of locked) {
    const kind = i.pull_request ? 'pr' : 'issue'
    const { rec } = await loadRecord(github, { owner, repo: name, number: i.number }, bot)
    const cur = rec.current
    if (!cur) { push(kind, i.number, 'sweep-timeout', { reason: 'lock without a record' }); continue }
    if (cur.deadline && Date.parse(cur.deadline) < now.getTime()) push(kind, i.number, 'sweep-timeout', { handler: cur.handler, attempt: cur.attempt })
    // A recheck recorded while the lock was held is drained by the unlock;
    // the reconciler catches one whose unlock was never seen.
  }

  const openPrs = await github.paginate(github.rest.pulls.list, { owner, repo: name, state: 'open', per_page: 100 })
  const openPrNumbers = new Set(openPrs.map((pr) => pr.number))

  // A lease ref on an item carrying no lock is residue: a pass won the CAS and
  // then died before it could write the label, or a session ended and its
  // unlock was lost. Until something reclaims it, every later fire for that
  // item is refused. `decide` reads the record before it deletes, and reclaims
  // a lease whose record is past its deadline whatever the label says.
  // (why: docs/why.md#a-lease-past-its-deadline-is-reclaimed)
  //
  // The kind comes from the open PRs, not from a guess. `coalesceTargets` keys
  // on `repo#number` and keeps the first target's kind, and this reason is
  // pushed before `sweep-pr` on purpose — it must reclaim the ref before any
  // fire asks for the lease. (why: docs/why.md#one-target-per-item)
  for (const n of await listLeases(github, owner, name)) {
    if (!lockedNumbers.has(n)) push(openPrNumbers.has(n) ? 'pr' : 'issue', n, 'sweep-lease', {})
  }
  const orphanHours = config.dispatch.orphanDraftHours ?? 6
  for (const pr of openPrs) {
    if (!fullTreatment(pr.user?.login, config) || lockedNumbers.has(pr.number)) continue
    // A member's draft is theirs until it is ready. (why: docs/why.md#a-members-pr-gets-the-loop)
    if (pr.draft && !isBot(pr.user?.login, config)) continue
    // Every open, unlocked PR the loop works is re-derived each pass, draft
    // included. Resolving a review thread fires no workflow, and neither does
    // a write the dispatcher was refused, so this is the only thing that sees
    // either. (why: docs/why.md#a-resolved-thread-fires-no-workflow,
    //  docs/why.md#a-draft-that-is-ready-is-not-an-orphan)
    push('pr', pr.number, 'sweep-pr')
    // The orphan notice is the other half: a draft with nothing left to do and
    // nobody working on it. `sweep-pr` above acts; this one only tells a human.
    if (pr.draft && Date.parse(pr.updated_at) < now.getTime() - orphanHours * 3600_000) push('pr', pr.number, 'sweep-orphan')
  }

  // Every open item against the board, and every Pending one for its due.
  // (why: docs/why.md#the-reconciler-replaces-the-drift-window)
  out.push(...driftTargets(await cheapView(github, config, owner, name), config, repo, { now, full: true }))
  return out
}
