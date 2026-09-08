import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, evaluatePr } from '../decide.mjs'

const config = {
  org: 'sydevs',
  identity: { expectedLogin: 'sydevs-bot' },
  assignment: { reviewer: 'Ardnived', respondTo: ['Ardnived', 'antontcymbal', 'Copilot'] },
  labels: { journal: 'ops-journal', awaiting: 'awaiting', stuck: 'stuck', blocked: 'blocked', lock: 'bot:working', proposal: 'proposal' },
  ceilings: { wipCapPerRepo: 3, ciFixIterations: 3 },
  mergePolicy: { loopMayNotMerge: ['claude-workflow'] },
  review: { bodyHeader: '## 🧐 Adversarial review', skipWhen: { maxFiles: 2, maxLines: 40 } },
  dispatch: { commandPrefix: '@sydevs-bot', verbs: { issue: ['implement', 'revise', 'split', 'answer'], pr: ['address', 'review'], unknownIssue: 'answer', unknownPr: 'address' } },
}

const green = { green: true, reason: '3 check(s) green', running: [], failing: [] }
const red = { green: false, reason: 'failing: CI', running: [], failing: [{ name: 'CI' }] }
const running = { green: false, reason: 'still running', running: [{ name: 'CI' }], failing: [] }

function prSnap(over = {}) {
  return {
    kind: 'pr',
    repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' },
    item: { number: 5, labels: [] },
    locked: false,
    record: { fixCi: 0 },
    pr: { number: 5, state: 'open', draft: true, user: { login: 'sydevs-bot' }, head: { sha: 'abc' }, changed_files: 10, additions: 200, deletions: 20 },
    mergeable: 'MERGEABLE',
    reviews: [],
    threads: [],
    comments: [],
    ci: green,
    normalized: { reviewDecision: null },
    verdict: { verdict: 'HOLD', reason: 'draft' },
    ...over,
  }
}

const types = (plan) => plan.map((a) => a.type + (a.handler ? ':' + a.handler : '') + (a.value ? ':' + a.value : ''))

test('green draft with no critic review fires the critic, never marks ready', () => {
  assert.deepEqual(types(evaluatePr(prSnap(), config)), ['fire:adversarial-review'])
})

test('green draft under the size threshold is marked ready without a critic', () => {
  const p = evaluatePr(prSnap({ pr: { ...prSnap().pr, changed_files: 1, additions: 10, deletions: 5 } }), config)
  assert.deepEqual(types(p).slice(0, 3), ['markReady', 'requestReviewer', 'label'])
  assert.ok(p.some((a) => a.type === 'comment' && a.key.startsWith('critic-skipped')))
})

test('a locked PR only records a recheck', () => {
  assert.deepEqual(types(evaluatePr(prSnap({ locked: true }), config)), ['recheck'])
})

test('the critic review with an unanswered own-rooted thread dispatches address-review', () => {
  const s = prSnap({
    reviews: [{ user: { login: 'sydevs-bot' }, body: '## 🧐 Adversarial review\n…', state: 'COMMENTED', submitted_at: '2026-09-08T10:00:00Z' }],
    threads: [{ isResolved: false, comments: [{ author: 'sydevs-bot', createdAt: '2026-09-08T10:00:00Z', body: 'finding' }] }],
  })
  assert.deepEqual(types(evaluatePr(s, config)), ['note', 'fire:address-review'])
})

test('after the critic is answered and CI is green, the draft is marked ready', () => {
  const s = prSnap({
    reviews: [{ user: { login: 'sydevs-bot' }, body: '## 🧐 Adversarial review\n…', state: 'COMMENTED', submitted_at: '2026-09-08T10:00:00Z' }],
    threads: [{ isResolved: false, comments: [
      { author: 'sydevs-bot', createdAt: '2026-09-08T10:00:00Z', body: 'finding' },
      { author: 'sydevs-bot', createdAt: '2026-09-08T10:30:00Z', body: 'rebutted: see x.ts:12' },
    ] }],
    comments: [{ author: 'sydevs-bot', createdAt: '2026-09-08T10:31:00Z', body: 'Revision done' }],
  })
  assert.deepEqual(types(evaluatePr(s, config)).slice(0, 2), ['markReady', 'requestReviewer'])
})

test('red CI fires fix-ci until the cap, then hands over to awaiting', () => {
  assert.deepEqual(types(evaluatePr(prSnap({ ci: red }), config)), ['bumpFixCi', 'fire:fix-ci'])
  const capped = evaluatePr(prSnap({ ci: red, record: { fixCi: 3 } }), config)
  assert.equal(capped[0].type, 'label')
  assert.deepEqual(capped[0].add, ['awaiting'])
  assert.ok(capped.some((a) => a.type === 'anomaly'))
})

test('running CI waits', () => {
  assert.deepEqual(types(evaluatePr(prSnap({ ci: running }), config)), ['note'])
})

test('an approved conflicting PR resolves conflicts before it merges', () => {
  const s = prSnap({ pr: { ...prSnap().pr, draft: false }, mergeable: 'CONFLICTING', normalized: { reviewDecision: 'APPROVED' } })
  assert.deepEqual(types(evaluatePr(s, config)), ['fire:resolve-conflicts'])
})

test('an approved green thread-free ready PR merges; a held one shows Approved', () => {
  const ok = prSnap({ pr: { ...prSnap().pr, draft: false }, normalized: { reviewDecision: 'APPROVED' }, verdict: { verdict: 'MERGE', reason: 'green' } })
  assert.deepEqual(types(evaluatePr(ok, config)), ['merge', 'status:done'])
  const held = prSnap({ pr: { ...prSnap().pr, draft: false }, normalized: { reviewDecision: 'APPROVED' }, verdict: { verdict: 'HOLD', reason: '1 unresolved review thread(s)' } })
  assert.deepEqual(types(evaluatePr(held, config)).slice(0, 1), ['status:approved'])
})

test('a human-merge repo shows Approved plus awaiting', () => {
  const s = prSnap({ repo: { owner: 'sydevs', name: 'claude-workflow', full: 'sydevs/claude-workflow' }, pr: { ...prSnap().pr, draft: false }, normalized: { reviewDecision: 'APPROVED' }, verdict: { verdict: 'HOLD', reason: 'human' } })
  const p = evaluatePr(s, config)
  assert.ok(p.some((a) => a.type === 'label' && a.add.includes('awaiting')))
})

test('a human review on a bot PR clears awaiting and dispatches address-review', () => {
  const s = prSnap({
    pr: { ...prSnap().pr, draft: false },
    reviews: [{ user: { login: 'Ardnived' }, body: 'please fix', state: 'CHANGES_REQUESTED', submitted_at: '2026-09-08T11:00:00Z' }],
  })
  const p = decide({ reason: 'review', facts: { author: 'Ardnived', body: 'please fix' } }, s, config)
  assert.equal(p[0].type, 'label')
  assert.deepEqual(p[0].remove, ['awaiting', 'stuck'])
  assert.ok(p.some((a) => a.type === 'fire' && a.handler === 'address-review'))
})

test("the bot's own non-critic review is ignored; its critic review is the exception", () => {
  const s = prSnap()
  assert.deepEqual(types(decide({ reason: 'review', facts: { author: 'sydevs-bot', body: 'hello' } }, s, config)), ['note'])
  const critic = prSnap({
    reviews: [{ user: { login: 'sydevs-bot' }, body: '## 🧐 Adversarial review', state: 'COMMENTED', submitted_at: '2026-09-08T10:00:00Z' }],
    threads: [{ isResolved: false, comments: [{ author: 'sydevs-bot', createdAt: '2026-09-08T10:00:00Z', body: 'f' }] }],
  })
  assert.ok(decide({ reason: 'review', facts: { author: 'sydevs-bot', body: '## 🧐 Adversarial review\n…' } }, critic, config).some((a) => a.type === 'fire' && a.handler === 'address-review'))
})

function issueSnap(over = {}) {
  return {
    kind: 'issue',
    repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' },
    item: { number: 9, labels: ['proposal', 'awaiting'], author: 'sydevs-bot' },
    locked: false,
    record: {},
    comments: [],
    markers: { blockedBy: [], recheck: null, recheckPassed: false },
    blockedByOpen: [],
    openPrsClosingIt: [],
    dependents: [],
    wip: { slots: 2, names: [] },
    botSpokeLast: false,
    ...over,
  }
}

test('an implement verb from a human authorises and fires when a slot is free', () => {
  const p = decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot implement', association: 'MEMBER' } }, issueSnap(), config)
  assert.ok(p.some((a) => a.type === 'label' && a.remove.includes('proposal')))
  assert.ok(p.some((a) => a.type === 'status' && a.value === 'approved'))
  assert.ok(p.some((a) => a.type === 'fire' && a.handler === 'implement'))
})

test('an implement verb with no WIP slot queues at Approved and consumes nothing', () => {
  const p = decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot implement', association: 'MEMBER' } }, issueSnap({ wip: { slots: 0, names: ['#1', '#2', '#3'] } }), config)
  assert.ok(p.some((a) => a.type === 'status' && a.value === 'approved'))
  assert.ok(!p.some((a) => a.type === 'fire'))
  assert.ok(p.some((a) => a.type === 'comment' && a.key === 'queued'))
})

test('implement on a blocked or in-flight ticket is refused', () => {
  const blocked = decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot implement', association: 'MEMBER' } }, issueSnap({ blockedByOpen: [{ number: 3 }] }), config)
  assert.ok(!blocked.some((a) => a.type === 'fire'))
  const inflight = decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot implement', association: 'MEMBER' } }, issueSnap({ openPrsClosingIt: [44] }), config)
  assert.ok(!inflight.some((a) => a.type === 'fire'))
})

test('verbs are case-insensitive and unknown ones become answer; Copilot cannot issue them', () => {
  const p = decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@SYDEVS-BOT Thoughts?', association: 'OWNER' } }, issueSnap(), config)
  assert.ok(p.some((a) => a.type === 'fire' && a.handler === 'answer'))
  const c = decide({ reason: 'issue_comment', facts: { author: 'Copilot', body: '@sydevs-bot implement', association: 'NONE' } }, issueSnap(), config)
  assert.ok(!c.some((a) => a.type === 'fire'))
})

test('a comment without write access is not feedback, even from an allowlisted login', () => {
  const p = decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot implement', association: 'NONE' } }, issueSnap(), config)
  assert.ok(!p.some((a) => a.type === 'fire'))
})

test('the bot-filed issue gets proposal + awaiting + Proposed and its markers become relationships', () => {
  const p = decide({ reason: 'issues.opened' }, issueSnap({ markers: { blockedBy: [{ owner: 'sydevs', repo: 'SahajCloud', number: 1 }], recheck: null } }), config)
  assert.ok(p.some((a) => a.type === 'status' && a.value === 'proposed'))
  assert.ok(p.some((a) => a.type === 'relationships'))
  assert.ok(p.some((a) => a.type === 'label' && a.add.includes('blocked')))
})

test('unlock on an issue with a pending verb re-dispatches; silent end sets awaiting with an anomaly', () => {
  const pending = issueSnap({ comments: [{ author: 'Ardnived', createdAt: '2026-09-08T12:00:00Z', body: '@sydevs-bot revise', id: 7 }] })
  const p = decide({ reason: 'unlock', facts: { handler: 'answer' } }, pending, config)
  assert.ok(p.some((a) => a.type === 'targets' && a.list[0].reason === 'issue_comment'))
  const silent = decide({ reason: 'unlock', facts: { handler: 'answer' } }, issueSnap({ botSpokeLast: false }), config)
  assert.ok(silent.some((a) => a.type === 'anomaly'))
  const spoke = decide({ reason: 'unlock', facts: { handler: 'implement' } }, issueSnap({ botSpokeLast: true }), config)
  assert.ok(spoke.some((a) => a.type === 'drain'))
})

test('journal issues are ignored everywhere', () => {
  assert.deepEqual(types(decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot implement', association: 'OWNER' } }, issueSnap({ item: { number: 1, labels: ['ops-journal'] } }), config)), ['note'])
})

test('a merged PR resolves Sentry for linked issues and scans other ready bot PRs', () => {
  const s = prSnap({ pr: { ...prSnap().pr, state: 'closed', draft: false }, linkedIssueDetails: [{ number: 3, sentry: { id: '55' } }], otherOpenBotPrs: [8, 9], linkedIssues: [3] })
  const p = decide({ reason: 'pull_request.closed', facts: { merged: true } }, s, config)
  assert.ok(p.some((a) => a.type === 'sentry' && a.id === '55'))
  assert.equal(p.find((a) => a.type === 'targets').list.length, 2)
  assert.ok(p.some((a) => a.type === 'drain'))
})
