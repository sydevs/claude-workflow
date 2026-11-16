// node --test workflow/lib/merge-gate.test.mjs
//
// Table-driven. The gate's wrong answers were silent and in both directions
// (see the header of merge-gate.mjs), so each row is one wall the verdict can
// hit, plus the shapes that must NOT hit it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ciVerdict,
  checksOf,
  latestPerName,
  mergeVerdict,
  normalizeMcp,
  repoHasWorkflows,
  requiredOnly,
  reviewDecisionFrom,
  reviewsLookTruncated,
  setRepoWorkflows,
} from './merge-gate.mjs'

const run = (name, conclusion, extra = {}) => ({ name, status: conclusion ? 'completed' : 'in_progress', conclusion, ...extra })
const review = (login, state, at) => ({ user: { login }, state, submitted_at: at })
const reviews = (n) => Array.from({ length: n }, (_, i) => review('someone', 'COMMENTED', `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`))

/** An MCP-shaped snapshot that is mergeable, with every field overridable. */
function snapshot(over = {}) {
  return {
    pr: { number: 7, draft: false, mergeable: true, mergeable_state: 'clean' },
    checkRuns: { check_runs: [run('test', 'success')] },
    statuses: { statuses: [] },
    reviewThreads: { review_threads: [] },
    reviews: [review('boss', 'APPROVED', '2026-01-01T00:00:00Z')],
    reviewAuthority: ['boss'],
    ...over,
  }
}
const verdict = (over, repo = 'sydevs/SahajCloud', policy = {}) => {
  setRepoWorkflows(repo, over?.__hasWorkflows ?? true)
  const { __hasWorkflows, ...rest } = over || {}
  return mergeVerdict(normalizeMcp(snapshot(rest)), repo, policy)
}

test('mergeVerdict: each wall reports its own reason, first wall first', () => {
  const rows = [
    ['all clear', {}, 'MERGE', /1 check\(s\) green/],
    ['draft', { pr: { draft: true, mergeable: true } }, 'HOLD', /draft/],
    ['no approval', { reviews: [] }, 'HOLD', /no approving review \(NONE\)/],
    ['changes requested', { reviews: [review('boss', 'CHANGES_REQUESTED', '2026-01-01T00:00:00Z')] }, 'HOLD', /CHANGES_REQUESTED/],
    ['unresolved thread', { reviewThreads: { review_threads: [{ is_resolved: true }, { is_resolved: false }] } }, 'HOLD', /1 unresolved/],
    ['thread with neither spelling counts as unresolved', { reviewThreads: { review_threads: [{}] } }, 'HOLD', /1 unresolved/],
    ['camelCase resolved thread', { reviewThreads: { review_threads: [{ isResolved: true }] } }, 'MERGE', /green/],
    ['conflicting', { pr: { draft: false, mergeable: false } }, 'HOLD', /conflicts/],
    ['dirty state', { pr: { draft: false, mergeable: null, mergeable_state: 'dirty' } }, 'HOLD', /conflicts/],
    ['failing check', { checkRuns: { check_runs: [run('test', 'failure')] } }, 'HOLD', /failing: test/],
    ['running check', { checkRuns: { check_runs: [run('test', null)] } }, 'HOLD', /still running: test/],
    ['truncated review page', { reviews: reviews(30) }, 'HOLD', /page boundary/],
    ['paged to the end', { reviews: [...reviews(29), review('boss', 'APPROVED', '2026-02-01T00:00:00Z')], reviewsComplete: true }, 'MERGE', /green/],
  ]
  for (const [name, over, want, reason] of rows) {
    const v = verdict(over)
    assert.equal(v.verdict, want, name)
    assert.match(v.reason, reason, name)
  }
})

test('mergeVerdict: a repo on loopMayNotMerge is always HOLD, ahead of every other wall', () => {
  const policy = { loopMayNotMerge: ['claude-workflow'] }
  const v = verdict({}, 'sydevs/claude-workflow', policy)
  assert.equal(v.verdict, 'HOLD')
  assert.match(v.reason, /merged by a human/)
  // Same snapshot, another repo: merges. The policy matches the repo name only.
  assert.equal(verdict({}, 'sydevs/SahajCloud', policy).verdict, 'MERGE')
  assert.equal(verdict({}, 'other/claude-workflow-fork', policy).verdict, 'MERGE')
})

test('ciVerdict: no CI configured is green only when the repo really has none', () => {
  const empty = { commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [] } } } }] } }
  setRepoWorkflows('t/no-ci', false)
  assert.equal(ciVerdict(empty, 't/no-ci').green, true)
  setRepoWorkflows('t/has-ci', true)
  const v = ciVerdict(empty, 't/has-ci')
  assert.equal(v.green, false)
  assert.match(v.reason, /no check runs/)
  // Unknown repos default to "has CI": the safe direction.
  assert.equal(repoHasWorkflows('t/never-seen'), true)
})

test('ciVerdict: a commit status alone never stands in for a check run', () => {
  setRepoWorkflows('t/status-only', true)
  const pr = normalizeMcp(snapshot({ checkRuns: { check_runs: [] }, statuses: { statuses: [{ context: 'railway', state: 'success' }] } }))
  const v = ciVerdict(pr, 't/status-only')
  assert.equal(v.green, false)
  assert.match(v.reason, /no check runs/)
})

test('ciVerdict: conclusions map to green, failing or running', () => {
  setRepoWorkflows('t/c', true)
  const rows = [
    ['success', true],
    ['neutral', true],
    ['skipped', true],
    ['failure', false],
    ['timed_out', false],
    ['cancelled', false],
    ['action_required', false],
    ['stale', false],
    [null, false],
  ]
  for (const [conclusion, green] of rows) {
    const v = ciVerdict(normalizeMcp(snapshot({ checkRuns: { check_runs: [run('x', conclusion)] } })), 't/c')
    assert.equal(v.green, green, String(conclusion))
  }
  const pendingStatus = normalizeMcp(snapshot({ statuses: { statuses: [{ context: 'deploy', state: 'pending' }] } }))
  assert.match(ciVerdict(pendingStatus, 't/c').reason, /still running: deploy/)
  const failedStatus = normalizeMcp(snapshot({ statuses: { statuses: [{ context: 'deploy', state: 'error' }] } }))
  assert.match(ciVerdict(failedStatus, 't/c').reason, /failing: deploy/)
})

test('latestPerName: the highest id per name wins, whatever the order', () => {
  const out = latestPerName([
    { name: 'a', id: 5, conclusion: 'success' },
    { name: 'a', id: 2, conclusion: 'cancelled' },
    { name: 'b', id: 1, conclusion: 'failure' },
  ])
  assert.deepEqual(out.map((r) => [r.name, r.id]).sort(), [['a', 5], ['b', 1]])
  assert.deepEqual(latestPerName(undefined), [])
})

test('requiredOnly: keeps required contexts, lists red others as advisory, queues the missing', () => {
  const checkRuns = { check_runs: [run('test', 'success', { id: 1 }), run('preview', 'failure', { id: 2, details_url: 'https://x/p' })] }
  const statuses = { statuses: [{ context: 'railway', state: 'failure', target_url: 'https://r/d' }] }

  const unread = requiredOnly({ checkRuns, statuses, required: null })
  assert.equal(unread.checkRuns.check_runs.length, 2, 'unknown ruleset: every check counts')
  assert.deepEqual(unread.advisory, [])

  const r = requiredOnly({ checkRuns, statuses, required: ['test', 'lint'] })
  assert.deepEqual(r.checkRuns.check_runs.map((c) => [c.name, c.status]), [['test', 'completed'], ['lint', 'queued']])
  assert.deepEqual(r.advisory, [
    { name: 'preview', kind: 'check', targetUrl: 'https://x/p' },
    { name: 'railway', kind: 'status', targetUrl: 'https://r/d' },
  ])

  // Nothing required has reported: no invented queued rows.
  const none = requiredOnly({ checkRuns: { check_runs: [] }, statuses: { statuses: [] }, required: ['test'] })
  assert.deepEqual(none.checkRuns.check_runs, [])
})

test('checksOf: flattens a rollup, and tolerates a PR without one', () => {
  assert.deepEqual(checksOf({}), [])
  const pr = normalizeMcp(snapshot({ statuses: { statuses: [{ context: 'ctx', state: 'success' }] } }))
  assert.deepEqual(checksOf(pr), [
    { name: 'test', kind: 'check', state: 'SUCCESS' },
    { name: 'ctx', kind: 'status', state: 'SUCCESS' },
  ])
})

test('reviewsLookTruncated: only an exact page boundary is suspect', () => {
  const rows = [[0, false], [1, false], [29, false], [30, true], [31, false], [60, true], [100, true], [101, false]]
  for (const [n, want] of rows) assert.equal(reviewsLookTruncated(reviews(n)), want, String(n))
  assert.equal(reviewsLookTruncated(undefined), false)
})

test('reviewDecisionFrom: an allowlist decides, and only the latest state-bearing review counts', () => {
  const t = (n) => `2026-01-0${n}T00:00:00Z`
  const rows = [
    ['no authority derives nothing', [review('boss', 'APPROVED', t(1))], [], null],
    ['stranger cannot approve', [review('stranger', 'APPROVED', t(1))], ['boss'], null],
    ['approved', [review('boss', 'APPROVED', t(1))], ['boss'], 'APPROVED'],
    ['login match ignores case', [review('BOSS', 'APPROVED', t(1))], ['boss'], 'APPROVED'],
    ['later change request wins', [review('boss', 'APPROVED', t(1)), review('boss', 'CHANGES_REQUESTED', t(2))], ['boss'], 'CHANGES_REQUESTED'],
    ['later approval wins', [review('boss', 'CHANGES_REQUESTED', t(1)), review('boss', 'APPROVED', t(2))], ['boss'], 'APPROVED'],
    ['a comment never clears a decision', [review('boss', 'APPROVED', t(1)), review('boss', 'COMMENTED', t(2))], ['boss'], 'APPROVED'],
    ['dismissal clears an approval', [review('boss', 'APPROVED', t(1)), review('boss', 'DISMISSED', t(2))], ['boss'], null],
    ['any authorized change request blocks', [review('a', 'APPROVED', t(1)), review('b', 'CHANGES_REQUESTED', t(1))], ['a', 'b'], 'CHANGES_REQUESTED'],
    ['GraphQL spelling', [{ author: { login: 'boss' }, state: 'APPROVED', submittedAt: t(1) }], ['boss'], 'APPROVED'],
    ['no reviews', [], ['boss'], null],
  ]
  for (const [name, list, authorized, want] of rows) assert.equal(reviewDecisionFrom(list, { authorized }), want, name)
})

test('normalizeMcp: an explicit reviewDecision wins, and a snapshot cannot invent an approval', () => {
  const real = normalizeMcp(snapshot({ reviews: [], reviewDecision: 'APPROVED' }))
  assert.equal(real.reviewDecision, 'APPROVED')
  assert.equal(real.reviewsTruncated, false, 'a real decision never reads the list')
  assert.equal(normalizeMcp(snapshot({ reviewAuthority: [] })).reviewDecision, null)
  assert.equal(normalizeMcp(snapshot({ pr: { number: 1, draft: true } })).isDraft, true)
  assert.equal(normalizeMcp(snapshot({ pr: { mergeable: undefined } })).mergeable, 'UNKNOWN')
})
