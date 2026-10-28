// Status is derived, never read: one function of the snapshot a plan leaves.
// (why: docs/why.md#status-is-derived-never-read)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deriveStatus } from '../status.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
const now = new Date('2026-10-27T12:00:00Z')
const repo = { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }

function issue(over = {}) {
  const { item, ...rest } = over
  return {
    kind: 'issue', repo, now,
    item: { number: 9, state: 'open', labels: [], type: 'Feature', ...item },
    record: {}, blockedByOpen: [], park: { until: null, passed: false }, openPrsClosingIt: [], openQuestions: { open: 0 }, children: [], parent: null,
    ...rest,
  }
}
const key = (s) => deriveStatus(s, config, now).key

test('an issue: every lane, from the facts alone', () => {
  assert.equal(key(issue()), 'awaiting', 'no verdict yet')
  assert.equal(key(issue({ item: { state: 'closed' } })), 'done')
  assert.equal(key(issue({ item: { labels: ['bot:working'] } })), 'working')
  assert.equal(key(issue({ openPrsClosingIt: [12] })), 'done', 'an issue whose PR is open')
  assert.equal(key(issue({ blockedByOpen: [{ number: 4 }] })), 'blocked')
  assert.equal(key(issue({ blockedByOpen: [{ number: 4 }], record: { approved: { by: 'Ardnived' } } })), 'pending', 'approved and blocked waits, approval kept')
  assert.equal(key(issue({ park: { until: '2026-12-01', passed: false } })), 'hold')
  assert.equal(key(issue({ park: { until: '2026-10-01', passed: true } })), 'awaiting', 'a passed hold is yours again')
  assert.equal(key(issue({ record: { approved: { by: 'Ardnived' } } })), 'pending', 'approved and free: implement is owed')
  assert.equal(key(issue({ record: { approved: { by: 'Ardnived' } }, openQuestions: { open: 1 } })), 'awaiting', 'an open question beats the approval')
  assert.equal(key(issue({ record: { pending: { handler: 'revise', reason: '429 rate limited' } } })), 'pending', 'a retry is the machinery\'s')
  assert.equal(key(issue({ record: { approved: { by: 'x' }, handback: { reason: 'did not finish after 3 attempts' } } })), 'awaiting', 'a hand-back is yours')
  assert.equal(key(issue({ blockedByOpen: [{ number: 4 }], record: { handback: { reason: 'x' } } })), 'blocked', 'a blocker comes before a hand-back')
})

test('a Pending wait the machinery owns carries a due; a wait on another item does not', () => {
  assert.equal(deriveStatus(issue({ record: { approved: { by: 'x' } } }), config, now).due, true)
  assert.equal(deriveStatus(issue({ blockedByOpen: [{ number: 4 }], record: { approved: { by: 'x' } } }), config, now).due, false)
})

const goal = (over = {}) => issue({ item: { type: 'Roadmap', ...(over.item || {}) }, ...over })
const child = (n, over = {}) => ({ repo, number: n, state: 'open', prs: 0, locked: false, blockedByOpen: [], holdUntil: null, ...over })

test('a goal is yours while it needs its own verdict, then follows its children', () => {
  assert.equal(key(goal()), 'awaiting', 'plan it with implement')
  assert.equal(key(goal({ children: [child(1)] })), 'awaiting', 'approve the plan')
  assert.equal(key(goal({ openQuestions: { open: 2 }, record: { approved: { by: 'x' } } })), 'awaiting')
  assert.equal(key(goal({ item: { type: 'Roadmap', labels: ['bot:working'] } })), 'working')
  assert.equal(key(goal({ blockedByOpen: [{ number: 3 }] })), 'blocked')
  const approved = { approved: { by: 'Ardnived' } }
  assert.equal(key(goal({ record: approved, children: [child(1, { prs: 1 }), child(2)] })), 'pending', 'in delivery')
  assert.equal(key(goal({ record: approved, children: [child(1, { blockedByOpen: [{ number: 7 }] }), child(2, { blockedByOpen: [{ number: 8 }] })] })), 'blocked', 'every open child blocked')
  assert.equal(key(goal({ record: approved, children: [child(1, { holdUntil: '2026-12-01' })] })), 'hold', 'every open child held')
  assert.equal(key(goal({ record: approved, children: [child(1, { state: 'closed' })] })), 'awaiting', 'every child closed and the goal open: the check found a gap')
  assert.equal(key(goal({ record: { ...approved, verifyDue: true }, children: [child(1, { state: 'closed' })] })), 'pending', 'the completion check is owed')
})

function pr(over = {}) {
  const { pull, ...rest } = over
  return {
    kind: 'pr', repo, now,
    item: { number: 5, state: 'open', labels: [] },
    record: {}, threads: [], reviews: [], comments: [],
    pr: { number: 5, state: 'open', draft: false, user: { login: 'sydevs-bot' }, head: { sha: 'abc' }, autoMergeArmed: true, ...pull },
    mergeable: 'MERGEABLE', ci: { green: true, failing: [], running: [] }, normalized: { reviewDecision: null },
    ...rest,
  }
}
const question = { isResolved: false, comments: [{ author: 'sydevs-bot', body: 'A or B?\n<!-- sydevs-question -->', createdAt: '2026-10-25T00:00:00Z' }] }

test('a PR: review is yours, the queue is the machinery\'s, and a question thread is yours even when approved', () => {
  assert.equal(key(pr()), 'awaiting', 'review')
  assert.equal(key(pr({ pull: { state: 'closed', merged: true } })), 'done')
  assert.equal(key(pr({ item: { number: 5, state: 'open', labels: ['bot:working'] } })), 'working')
  assert.equal(key(pr({ normalized: { reviewDecision: 'APPROVED' } })), 'pending', 'approved and armed')
  // sydevs/SahajAtlasWeb#328 and sydevs/WeMeditateWeb#198: approved, armed,
  // and held by an open question nobody was told about.
  assert.equal(key(pr({ normalized: { reviewDecision: 'APPROVED' }, threads: [question] })), 'awaiting')
  assert.equal(key(pr({ normalized: { reviewDecision: 'APPROVED' }, mergeable: 'CONFLICTING' })), 'pending', 'a conflict is the machinery\'s, approved or not')
  assert.equal(key(pr({ pull: { draft: true } })), 'pending', 'a bot draft is still being built')
  assert.equal(key(pr({ pull: { draft: true, user: { login: 'Ardnived' } } })), 'awaiting', 'a member\'s draft is theirs')
  assert.equal(key(pr({ pull: { user: { login: 'dependabot[bot]' } }, normalized: { reviewDecision: 'APPROVED' } })), 'awaiting', 'an outside PR is only ever yours')
  assert.equal(key(pr({ repo: { ...repo, name: 'claude-workflow' }, normalized: { reviewDecision: 'APPROVED' } })), 'awaiting', 'a repo the loop may not merge')
  assert.equal(key(pr({ normalized: { reviewDecision: 'APPROVED' }, linkedBlockedOpen: ['sydevs/SahajCloud#1'] })), 'pending')
  assert.equal(deriveStatus(pr({ normalized: { reviewDecision: 'APPROVED' }, linkedBlockedOpen: ['sydevs/SahajCloud#1'] }), config, now).due, false, 'waiting on its producer has no due')
})

test('an approved stacked PR is yours to merge into its parent, not a wait that never ends', () => {
  // sydevs/SahajAtlasWeb#340 sits on #318's branch. Nothing arms it, so a
  // Pending here is a due the reconciler checks three times and hands back.
  const onParent = { base: { ref: 'claude/feat-147-submit-a-class', defaultBranch: 'main' } }
  const s = pr({ pull: { ...onParent }, normalized: { reviewDecision: 'APPROVED' } })
  assert.equal(deriveStatus(s, config, now).key, 'awaiting')
  assert.match(deriveStatus(s, config, now).reason, /merging it into claude\/feat-147-submit-a-class is yours/)
  assert.equal(deriveStatus(s, config, now).due, false)
  const onMain = pr({ pull: { base: { ref: 'main', defaultBranch: 'main' } }, normalized: { reviewDecision: 'APPROVED' } })
  assert.equal(key(onMain), 'pending', 'a PR on the default branch is still the queue\'s')
  // A conflict or red CI on a stacked PR is still the machinery's to repair.
  assert.equal(key(pr({ pull: { ...onParent }, normalized: { reviewDecision: 'APPROVED' }, mergeable: 'CONFLICTING' })), 'pending')
  assert.equal(key(pr({ pull: { ...onParent }, normalized: { reviewDecision: 'APPROVED' }, ci: { green: false, failing: ['build'], running: [] } })), 'pending')
  // A producer wait ends on its own, so it holds — merging ahead of it is wrong.
  const alsoWaiting = pr({ pull: { ...onParent }, normalized: { reviewDecision: 'APPROVED' }, linkedBlockedOpen: ['sydevs/SahajCloud#1'] })
  assert.equal(deriveStatus(alsoWaiting, config, now).key, 'pending')
  assert.match(deriveStatus(alsoWaiting, config, now).reason, /merges after sydevs\/SahajCloud#1/)
})

test('a bot finding the bot has not answered is its own turn, not yours', () => {
  const finding = { isResolved: false, comments: [{ author: 'sydevs-bot', body: 'finding', createdAt: '2026-10-25T00:00:00Z' }] }
  assert.equal(key(pr({ threads: [finding] })), 'pending', 'address-review owes the reply')
  const replied = { isResolved: false, comments: [...finding.comments, { author: 'sydevs-bot', body: 'fixed in abc', createdAt: '2026-10-25T01:00:00Z' }] }
  assert.equal(key(pr({ normalized: { reviewDecision: 'APPROVED' }, threads: [replied] })), 'awaiting', 'answered and unresolved: yours to resolve')
})

test('a goal planned before approval lived in the record reads as approved', () => {
  // sydevs/SahajAtlasWeb#266: two plans ran, four children shipped, and no
  // `approved` was ever recorded.
  const planned = goal({ record: { dispatches: [{ handler: 'revise-roadmap' }, { handler: 'implement-roadmap' }] }, children: [child(1, { state: 'closed' }), child(2)] })
  assert.equal(key(planned), 'pending')
})

test('a planned goal whose tickets are all still proposals awaits its verdict', () => {
  // sydevs/SahajCloud#902: planned, one child shipped, four proposals nobody approved.
  const s = goal({ record: { dispatches: [{ handler: 'implement-roadmap' }] }, children: [child(1, { state: 'closed' }), child(2, { proposal: true, blockedByOpen: [{ number: 9 }] }), child(3, { proposal: true })] })
  assert.equal(key(s), 'awaiting')
})
