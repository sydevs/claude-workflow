import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, evaluatePr } from '../decide.mjs'

const config = {
  org: 'sydevs',
  identity: { expectedLogin: 'sydevs-bot' },
  assignment: { reviewer: 'Ardnived', respondTo: ['Ardnived', 'antontcymbal', 'Copilot'] },
  labels: { journal: 'ops-journal', awaiting: 'awaiting', stuck: 'stuck', blocked: 'blocked', lock: 'bot:working', proposal: 'proposal' },
  ceilings: { ciFixIterations: 3 },
  mergePolicy: { loopMayNotMerge: ['claude-workflow'] },
  review: { bodyHeader: '## 🧐 Adversarial review', skipWhen: { maxFiles: 2, maxLines: 40 } },
  dispatch: { commandPrefix: '@sydevs-bot', verbs: { issue: ['implement', 'revise', 'review', 'block'], pr: ['address', 'review', 'revise'], aliases: { issue: { review: 'revise' }, pr: { revise: 'review' } }, unknownIssue: 'revise', unknownPr: 'address' } },
  issueFields: { holdUntil: { name: 'Hold Until', fieldId: 46423871, maxHorizonDays: 30, maxRehold: 3 } },
  roadmap: { type: 'Roadmap', spikeBranchPrefix: 'claude/spike-' },
  repos: ['SahajCloud', 'SahajAtlasWeb', 'WeMeditateWeb', 'SahajAtlasWordpress', 'claude-workflow'],
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
  assert.deepEqual(types(evaluatePr(prSnap(), config)), ['fire:review-pr'])
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

const endedFixCi = (sha, outcome = 'done') => ({ id: `SahajCloud-5-fix-ci-20261001T022800000Z-aaaa`, handler: 'fix-ci', attempt: 1, firedAt: '2026-10-01T02:28:00.000Z', sha, outcome })

test('a fix-ci session that ended on this head is not fired again, whatever fixCi reads', () => {
  // sydevs/SahajAtlasWeb#245: three fix-ci on unchanged head 19a284d, at
  // 02:28/02:32/02:34, after the first had commented and stood down. Serial,
  // lock-respecting re-fires of a decision already made.
  const s = prSnap({ ci: red, pr: { ...prSnap().pr, head: { sha: '19a284d' } }, record: { fixCi: 1, dispatches: [endedFixCi('19a284d')] } })
  const plan = evaluatePr(s, config)
  assert.deepEqual(types(plan), ['note'], 'no fire, and no bumpFixCi')
  assert.match(plan[0].text, /19a284d/)
})

test('a fix-ci session that timed out on this head is just as ended', () => {
  const s = prSnap({ ci: red, pr: { ...prSnap().pr, head: { sha: '19a284d' } }, record: { fixCi: 1, dispatches: [endedFixCi('19a284d', 'timed out')] } })
  assert.deepEqual(types(evaluatePr(s, config)), ['note'])
})

test('a push to a new head clears the refusal', () => {
  const s = prSnap({ ci: red, pr: { ...prSnap().pr, head: { sha: 'c0ffee1' } }, record: { fixCi: 1, dispatches: [endedFixCi('19a284d')] } })
  assert.deepEqual(types(evaluatePr(s, config)), ['bumpFixCi', 'fire:fix-ci'], 'a new sha has no ended session against it')
})

test('a fix-ci still running on this head is not an ended one — the lock answers that', () => {
  const live = { id: 'x', handler: 'fix-ci', attempt: 1, firedAt: '2026-10-01T02:28:00.000Z', sha: '19a284d' }
  const s = prSnap({ ci: red, pr: { ...prSnap().pr, head: { sha: '19a284d' } }, record: { fixCi: 1, dispatches: [live] } })
  assert.deepEqual(types(evaluatePr(s, config)), ['bumpFixCi', 'fire:fix-ci'], 'no outcome yet, so nothing stood down')
})

test('another handler ending on this head says nothing about fix-ci', () => {
  const s = prSnap({ ci: red, pr: { ...prSnap().pr, head: { sha: '19a284d' } }, record: { fixCi: 1, dispatches: [{ ...endedFixCi('19a284d'), handler: 'address-review' }] } })
  assert.deepEqual(types(evaluatePr(s, config)), ['bumpFixCi', 'fire:fix-ci'])
})

test('the unlock after a stood-down fix-ci makes the PR the human\'s turn, not a loop', () => {
  const s = prSnap({ ci: red, pr: { ...prSnap().pr, draft: false, head: { sha: '19a284d' } }, record: { fixCi: 1, current: null, dispatches: [endedFixCi('19a284d')] } })
  const plan = decide({ reason: 'unlock', facts: { handler: 'fix-ci' } }, s, config)
  assert.deepEqual(types(plan), ['unlocked:fix-ci', 'note', 'label'])
  assert.deepEqual(plan[2].add, ['awaiting'])
})

// The record as the unlock really sees it: the ending session still in
// `current`, and only its fire-time entry, with no outcome, in `dispatches`.
test('the unlock that ends a stood-down fix-ci does not fire it again on the same head', () => {
  const fired = { id: 'SahajCloud-5-fix-ci-20261001T022800000Z-aaaa', handler: 'fix-ci', attempt: 1, firedAt: '2026-10-01T02:28:00.000Z', sha: '19a284d' }
  const s = prSnap({ ci: red, pr: { ...prSnap().pr, draft: false, head: { sha: '19a284d' } }, record: { fixCi: 1, current: { ...fired, flags: { mode: null } }, dispatches: [fired] } })
  const plan = decide({ reason: 'unlock', facts: { handler: 'fix-ci' } }, s, config)
  assert.deepEqual(types(plan), ['unlocked:fix-ci', 'note', 'label'])
  assert.deepEqual(plan[2].add, ['awaiting'])
  const pushed = { ...s, pr: { ...s.pr, head: { sha: 'b0b0b0b' } } }
  assert.deepEqual(types(decide({ reason: 'unlock', facts: { handler: 'fix-ci' } }, pushed, config)), ['unlocked:fix-ci', 'bumpFixCi', 'fire:fix-ci'], 'a pass that pushed a new head that is still red is repaired again')
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

test('a ready PR gets auto-merge armed; GitHub decides the rest', () => {
  const unarmed = prSnap({ pr: { ...prSnap().pr, draft: false, autoMergeArmed: false }, normalized: { reviewDecision: 'APPROVED' } })
  assert.deepEqual(types(evaluatePr(unarmed, config)), ['armAutoMerge'])
  const armed = prSnap({ pr: { ...prSnap().pr, draft: false, autoMergeArmed: true }, normalized: { reviewDecision: 'APPROVED' } })
  assert.deepEqual(types(evaluatePr(armed, config)).slice(0, 1), ['status:approved'])
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

// SahajAtlasWeb#212: a review with four inline comments dispatched nothing.
// (why: docs/why.md#a-review-comment-is-feedback-whatever-its-association)
test('a review comment on a bot PR re-derives the PR, whatever association GitHub sent', () => {
  const s = prSnap({
    pr: { ...prSnap().pr, draft: false },
    threads: [{ isResolved: false, comments: [{ author: 'Ardnived', createdAt: '2026-09-17T00:56:35Z', body: 'this is wrong' }] }],
  })
  const p = decide({ reason: 'review_comment', facts: { author: 'Ardnived', body: 'this is wrong', association: 'CONTRIBUTOR' } }, s, config)
  assert.deepEqual(types(p), ['label', 'note', 'fire:address-review'])
  assert.deepEqual(p[0].remove, ['awaiting', 'stuck'])
})

// The note text, not just the shape: an unhandled reason is also one note, so
// both halves stay green against the old mapping unless the text is pinned.
//
// The bot half is what the row's own guard buys, so the fixture is built to
// punish its removal: an inline comment opening with the critic header on a
// bot PR with an unanswered own-rooted thread. Delegate it to `case 'review'`
// and the critic-header exception fires address-review on the bot's own words.
test('a review comment from the bot, or from outside the allowlist, dispatches nothing', () => {
  const s = prSnap({
    pr: { ...prSnap().pr, draft: false },
    reviews: [{ user: { login: 'sydevs-bot' }, body: '## 🧐 Adversarial review', state: 'COMMENTED', submitted_at: '2026-09-17T00:00:00Z' }],
    threads: [{ isResolved: false, comments: [{ author: 'sydevs-bot', createdAt: '2026-09-17T00:00:00Z', body: 'finding' }] }],
  })
  const own = decide({ reason: 'review_comment', facts: { author: 'sydevs-bot', body: '## 🧐 Adversarial review\n…' } }, s, config)
  assert.deepEqual(own.map((a) => a.text), ['own review comment — ignored'])
  const stranger = decide({ reason: 'review_comment', facts: { author: 'drive-by', body: 'a nit', association: 'MEMBER' } }, s, config)
  assert.deepEqual(stranger.map((a) => a.text), ['review by drive-by — ignored'])
})

test('a review comment carrying a verb on a human PR still dispatches that verb', () => {
  const s = prSnap({ pr: { ...prSnap().pr, draft: false, user: { login: 'Ardnived' } } })
  const at = (body) => ({ reason: 'review_comment', facts: { author: 'Ardnived', body, association: 'CONTRIBUTOR' } })
  assert.deepEqual(types(decide(at('@sydevs-bot address this'), s, config)), ['fire:address-review'])
  assert.deepEqual(types(decide(at('@sydevs-bot review'), s, config)), ['fire:review-pr'])
  assert.deepEqual(types(decide(at('a nit'), s, config)), ['note'])
})

function issueSnap(over = {}) {
  return {
    kind: 'issue',
    repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' },
    item: { number: 9, state: 'open', labels: ['proposal', 'awaiting'], author: 'sydevs-bot', authorAssociation: 'MEMBER', type: 'Feature' },
    locked: false,
    record: {},
    comments: [],
    markers: { blockedBy: [], unresolvedBlockers: [], recheck: null, recheckPassed: false },
    park: { until: null, passed: false, source: null },
    blockedByOpen: [],
    openPrsClosingIt: [],
    openQuestions: { total: 0, open: 0 },
    children: [],
    parent: null,
    request: null,
    dependents: [],
    botSpokeLast: false,
    now: new Date('2026-10-07T12:00:00Z'),
    ...over,
  }
}

test('an implement verb from a human authorises and fires at once — there is no WIP cap', () => {
  const p = decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot implement', association: 'MEMBER' } }, issueSnap(), config)
  assert.ok(p.some((a) => a.type === 'label' && a.remove.includes('proposal')))
  assert.ok(p.some((a) => a.type === 'status' && a.value === 'approved'))
  assert.ok(p.some((a) => a.type === 'fire' && a.handler === 'implement'))
})

test('implement on a blocked or in-flight ticket is refused', () => {
  const blocked = decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot implement', association: 'MEMBER' } }, issueSnap({ blockedByOpen: [{ number: 3 }] }), config)
  assert.ok(!blocked.some((a) => a.type === 'fire'))
  const inflight = decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot implement', association: 'MEMBER' } }, issueSnap({ openPrsClosingIt: [44] }), config)
  assert.ok(!inflight.some((a) => a.type === 'fire'))
})

test('verbs are case-insensitive and unknown ones become revise; Copilot cannot issue them', () => {
  const p = decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@SYDEVS-BOT Thoughts?', association: 'OWNER' } }, issueSnap(), config)
  assert.ok(p.some((a) => a.type === 'fire' && a.handler === 'revise'))
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

// ---- an unresolved blocker line is reported (why: docs/why.md#an-unresolved-blocker-line-is-reported)

const PULL_LINE = 'Blocked by: https://github.com/sydevs/SahajCloud/pull/912 — until it merges'
const PULL_TARGET = 'https://github.com/sydevs/SahajCloud/pull/912'
const unresolved = (plan) => plan.filter((a) => a.type === 'comment' && a.key.startsWith('blocker-unresolved'))
/** An issue snapshot whose body markers are what the test is about. */
const blockerSnap = (unresolvedBlockers, over = {}) =>
  issueSnap({ markers: { blockedBy: [], unresolvedBlockers, recheck: null, recheckPassed: false }, ...over })
const pullSnap = (over) => blockerSnap([{ line: PULL_LINE, targets: [PULL_TARGET] }], over)

test('a blocker line naming a PR is refused on open, and nothing else moves for it', () => {
  // sydevs/SahajCloud#987 named the PR, not the issue that PR closes.
  const p = decide({ reason: 'issues.opened' }, pullSnap(), config)
  const said = unresolved(p)
  assert.equal(said.length, 1, 'one comment per line')
  assert.match(said[0].body, /names no sydevs issue/)
  assert.match(said[0].body, /owner\/repo#N/, 'and the two accepted spellings')
  assert.match(said[0].body, /full issue URL/)
  assert.match(said[0].body, /\n> Blocked by: /, 'the line as written, quoted')
  assert.ok(!p.some((a) => a.type === 'relationships'), 'no relationship')
  assert.ok(!p.filter((a) => a.type === 'label').flatMap((a) => a.add).includes('blocked'), 'no blocked label')
  // Still Proposed and still your turn: the refusal moves no state.
  assert.deepEqual(types(p).filter((t) => t.startsWith('status')), ['status:proposed'])
})

test('the refusal is keyed on the targets, so neither a later edit nor a reword reposts it', () => {
  const onOpen = unresolved(decide({ reason: 'issues.opened' }, pullSnap(), config))[0]
  const onEdit = unresolved(decide({ reason: 'issues.edited', facts: { sender: 'Ardnived' } }, pullSnap(), config))[0]
  assert.equal(onOpen.key, `blocker-unresolved ${PULL_TARGET}`, 'the targets are the key — there is no comment id here')
  assert.equal(onEdit.key, onOpen.key, 're-derived unchanged, so commentOnce posts nothing')
  // Rewording the reason after the em dash is the edit humans actually make.
  const reworded = blockerSnap([{ line: 'Blocked by: ' + PULL_TARGET + ' — waiting on the backport', targets: [PULL_TARGET] }])
  assert.equal(unresolved(decide({ reason: 'issues.edited', facts: { sender: 'Ardnived' } }, reworded, config))[0].key, onOpen.key)
  // A corrected target yields a key that is never reached.
  const fixed = blockerSnap([{ line: 'Blocked by #907', targets: ['#907'] }])
  assert.notEqual(unresolved(decide({ reason: 'issues.edited', facts: { sender: 'Ardnived' } }, fixed, config))[0].key, onOpen.key)
})

test('a bare #N on edit is refused, and a resolvable line beside it still relates', () => {
  const s = blockerSnap([{ line: 'Blocked by #12', targets: ['#12'] }], {
    markers: { blockedBy: [{ owner: 'sydevs', repo: 'SahajCloud', number: 907 }], unresolvedBlockers: [{ line: 'Blocked by #12', targets: ['#12'] }], recheck: null, recheckPassed: false },
  })
  const p = decide({ reason: 'issues.edited', facts: { sender: 'Ardnived' } }, s, config)
  assert.equal(unresolved(p).length, 1)
  assert.ok(p.some((a) => a.type === 'relationships'), 'the resolvable line is still converted')
  assert.ok(p.filter((a) => a.type === 'label').flatMap((a) => a.add).includes('blocked'))
})

test('a non-member author\'s own line stays text — no refusal', () => {
  const stranger = { number: 9, state: 'open', labels: [], author: 'drive-by', authorAssociation: 'NONE', type: 'Bug' }
  assert.equal(unresolved(decide({ reason: 'issues.opened' }, pullSnap({ item: stranger }), config)).length, 0)
  const edited = decide({ reason: 'issues.edited', facts: { sender: 'drive-by' } }, pullSnap({ item: stranger }), config)
  assert.equal(unresolved(edited).length, 0)
})

test('an edit carrying only an unresolved line is no longer a silent no-op', () => {
  const p = decide({ reason: 'issues.edited', facts: { sender: 'Ardnived' } }, pullSnap(), config)
  assert.deepEqual(types(p), ['comment'])
  const quiet = decide({ reason: 'issues.edited', facts: { sender: 'Ardnived' } }, issueSnap(), config)
  assert.deepEqual(types(quiet), ['note'], 'and an edit with no marker at all still is')
})

test('unlock on an issue with a pending verb re-dispatches; silent end sets awaiting with an anomaly', () => {
  const pending = issueSnap({ comments: [{ author: 'Ardnived', createdAt: '2026-09-08T12:00:00Z', body: '@sydevs-bot revise', id: 7 }] })
  const p = decide({ reason: 'unlock', facts: { handler: 'answer' } }, pending, config)
  assert.ok(p.some((a) => a.type === 'targets' && a.list[0].reason === 'issue_comment'))
  const silent = decide({ reason: 'unlock', facts: { handler: 'answer' } }, issueSnap({ botSpokeLast: false }), config)
  assert.ok(silent.some((a) => a.type === 'anomaly'))
  const spoke = decide({ reason: 'unlock', facts: { handler: 'implement' } }, issueSnap({ botSpokeLast: true }), config)
  assert.ok(!spoke.some((a) => a.type === 'drain'), 'no queue to drain')
})

test('journal issues are ignored everywhere', () => {
  assert.deepEqual(types(decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot implement', association: 'OWNER' } }, issueSnap({ item: { number: 1, labels: ['ops-journal'] } }), config)), ['note'])
})

test('a merged PR resolves Sentry for linked issues and scans other ready bot PRs', () => {
  const s = prSnap({ pr: { ...prSnap().pr, state: 'closed', draft: false }, linkedIssueDetails: [{ number: 3, sentry: { id: '55' } }], otherOpenBotPrs: [8, 9], linkedIssues: [3] })
  const p = decide({ reason: 'pull_request.closed', facts: { merged: true } }, s, config)
  assert.ok(p.some((a) => a.type === 'sentry' && a.id === '55'))
  assert.equal(p.find((a) => a.type === 'targets').list.length, 2)
})

test('a closed issue goes Done and re-checks its dependents', () => {
  const p = decide({ reason: 'issues.closed' }, issueSnap({ dependents: [{ repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'issue', number: 12 }] }), config)
  assert.ok(p.some((a) => a.type === 'status' && a.value === 'done'))
  assert.equal(p.find((a) => a.type === 'targets').list[0].reason, 'unblock-check')
})

test('a passed Hold Until date fires a recheck, not awaiting; a future one is left alone', () => {
  const passed = decide({ reason: 'unblock-check', facts: {} }, issueSnap({ item: { number: 1, state: 'open', labels: ['blocked'] }, blockedByOpen: [], park: { until: '2026-09-01', passed: true, source: 'field' } }), config)
  assert.deepEqual(types(passed), ['record', 'fire:revise'])
  assert.equal(passed[1].flags.mode, 'recheck')
  assert.deepEqual(passed[0].patch, { rehold: 1 })
  assert.ok(!passed.some((a) => a.type === 'label' && a.add.includes('awaiting')), 'nobody is pinged on the date alone')
  const early = decide({ reason: 'unblock-check', facts: {} }, issueSnap({ item: { number: 1, labels: ['blocked'] }, blockedByOpen: [], park: { until: '2026-12-01', passed: false, source: 'field' } }), config)
  assert.ok(!early.some((a) => a.type === 'label'))
})

// The converted line is gone from the body, so the fire names what the ticket
// waited on. (why: docs/why.md#a-converted-blocker-line-is-deleted)
test('a recheck after the last blocker closes names the blockers that cleared', () => {
  const blockedByAll = [{ owner: 'sydevs', repo: 'SahajCloud', number: 632, state: 'closed' }, { owner: 'sydevs', repo: 'WeMeditateWeb', number: 81, state: 'closed' }]
  const p = decide({ reason: 'unblock-check', facts: { closedNumber: 632 } }, issueSnap({ item: { number: 1, state: 'open', labels: ['blocked'] }, blockedByOpen: [], blockedByAll }), config)
  assert.deepEqual(types(p), ['record', 'fire:revise'])
  assert.deepEqual(p[1].flags, { mode: 'recheck', cleared: ['sydevs/SahajCloud#632', 'sydevs/WeMeditateWeb#81'] })
  const dated = decide({ reason: 'unblock-check', facts: {} }, issueSnap({ item: { number: 1, state: 'open', labels: ['blocked'] }, blockedByOpen: [], park: { until: '2026-09-01', passed: true, source: 'field' } }), config)
  assert.deepEqual(dated[1].flags, { mode: 'recheck' }, 'a date park names no blocker')
})

test('unblock-check applies the label when GitHub says blocked and we never labelled it', () => {
  const snap = issueSnap({ item: { number: 195, labels: [] }, blockedByOpen: [{ number: 695 }], markers: { blockedBy: [], recheck: null, recheckPassed: false } })
  const p = decide({ reason: 'unblock-check', facts: {} }, snap, config)
  assert.ok(p.some((a) => a.type === 'label' && a.add.includes('blocked')), 'the label follows the relationship')
  assert.ok(!p.some((a) => a.type === 'comment'), 'nothing to tell anyone yet')
})

test('unblock-check is quiet when the label already matches the relationship', () => {
  const snap = issueSnap({ item: { number: 195, labels: ['blocked'] }, blockedByOpen: [{ number: 695 }], markers: { blockedBy: [], recheck: null, recheckPassed: false } })
  assert.deepEqual(types(decide({ reason: 'unblock-check', facts: {} }, snap, config)), ['note'])
})

test('unblock-check labels a date park that lost its label, and unparks when the date passes', () => {
  const ahead = issueSnap({ item: { number: 9, labels: [] }, blockedByOpen: [], park: { until: '2026-12-01', passed: false, source: 'field' } })
  assert.ok(decide({ reason: 'unblock-check', facts: {} }, ahead, config).some((a) => a.type === 'label' && a.add.includes('blocked')))
  const past = issueSnap({ item: { number: 9, state: 'open', labels: ['blocked'] }, blockedByOpen: [], park: { until: '2026-01-01', passed: true, source: 'field' } })
  const p = decide({ reason: 'unblock-check', facts: {} }, past, config)
  assert.ok(p.some((a) => a.type === 'fire' && a.flags.mode === 'recheck'))
})

test('a park stops an implement dispatch before any session starts', () => {
  // The label is not the test. A ticket parked on a date it never carried a
  // label for would otherwise be implemented.
  const verb = { reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot implement', association: 'MEMBER' } }
  const parked = issueSnap({ item: { number: 9, labels: [] }, park: { until: '2026-12-01', passed: false, source: 'field' } })
  const p = decide(verb, parked, config)
  assert.ok(!p.some((a) => a.type === 'fire'), 'nothing is fired')
  const lab = p.find((a) => a.type === 'label' && a.add.includes('blocked'))
  assert.ok(lab, 'blocked is applied')
  assert.ok(lab.remove.includes('awaiting'), 'and awaiting comes off — parked is not your turn')
  assert.match(p.find((a) => a.type === 'comment').body, /parked until 2026-12-01/)

  const past = issueSnap({ item: { number: 9, labels: [] }, park: { until: '2026-01-01', passed: true, source: 'field' } })
  assert.ok(decide(verb, past, config).some((a) => a.type === 'fire' && a.handler === 'implement'), 'a passed date does not park')
})

test('the refusal says which of the three reasons applies', () => {
  const verb = { reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot implement', association: 'MEMBER' } }
  const byBlocker = decide(verb, issueSnap({ item: { number: 9, labels: [] }, blockedByOpen: [{ number: 695 }] }), config)
  assert.match(byBlocker.find((a) => a.type === 'comment').body, /waits on #695/)
  const byLabel = decide(verb, issueSnap({ item: { number: 9, labels: ['blocked'] } }), config)
  assert.match(byLabel.find((a) => a.type === 'comment').body, /blocked label/)
})

test('a PR whose linked issue is still locked belongs to that session alone', () => {
  // claude-workflow has no CI, so a draft PR is green the moment it opens.
  // Without this the critic fires while implement is still pushing.
  const draft = (over) => prSnap({ pr: { ...prSnap().pr, draft: true, changed_files: 8, additions: 120 }, linkedIssues: [729], ...over })
  assert.deepEqual(types(evaluatePr(draft({ linkedLocked: [729] }), config)), ['note'], 'held')
  const freed = evaluatePr(draft({ linkedLocked: [] }), config)
  assert.ok(freed.some((a) => a.type === 'fire' && a.handler === 'review-pr'), 'the same PR, once the issue unlocks')
})

test('an implement verb is answered by the PR, not re-dispatched on unlock', () => {
  const verb = [{ author: 'Ardnived', createdAt: '2026-09-09T12:00:00Z', body: '@sydevs-bot implement', id: 1 }]
  const withPr = issueSnap({ comments: verb, openPrsClosingIt: [742], botSpokeLast: false })
  const p = decide({ reason: 'unlock', facts: { handler: 'implement' } }, withPr, config)
  assert.ok(!p.some((a) => a.type === 'targets'), 'no second dispatch')
  assert.ok(p.some((a) => a.type === 'status' && a.value === 'done'))
  assert.ok(p.some((a) => a.type === 'label' && a.remove.includes('awaiting')), 'a ticket in flight is not your turn')

  // Any other verb still re-derives, and implement does too when no PR exists.
  const revise = issueSnap({ comments: [{ ...verb[0], body: '@sydevs-bot revise' }], openPrsClosingIt: [742] })
  assert.ok(decide({ reason: 'unlock', facts: { handler: 'implement' } }, revise, config).some((a) => a.type === 'targets'))
  const noPr = issueSnap({ comments: verb, openPrsClosingIt: [] })
  assert.ok(decide({ reason: 'unlock', facts: { handler: 'implement' } }, noPr, config).some((a) => a.type === 'targets'))
})

test('the awaiting sweep leaves a ticket whose PR is open, and does not throw on a PR', () => {
  // session-end takes `awaiting` off a ticket a PR closes. Any bot comment
  // after that makes the bot last speaker, and the sweep put the label back —
  // claiming the reviewer twice for one piece of work.
  const bare = (over) => issueSnap({ item: { number: 9, labels: [] }, botSpokeLast: true, ...over })
  const open = (over) => decide({ reason: 'sweep-awaiting', facts: {} }, bare({ openPrsClosingIt: [742], ...over }), config)
  // `types()` renders every note as 'note', so the text is pinned too: without
  // the guard the botSpokeLast: false case says 'human spoke last' and passes.
  for (const spoke of [true, false]) {
    const p = open({ botSpokeLast: spoke })
    assert.deepEqual(types(p), ['note'], 'no label, no anomaly')
    assert.match(p[0].text, /open PR/, 'the PR is the turn, whoever spoke last')
  }

  // With no PR open, the correction the sweep exists for still fires.
  const noPr = decide({ reason: 'sweep-awaiting', facts: {} }, bare(), config)
  assert.ok(noPr.some((a) => a.type === 'label' && a.add.includes('awaiting')))
  assert.ok(noPr.some((a) => a.type === 'anomaly' && a.kind === 'awaiting-drift'))

  // sweep.mjs pushes this reason for PRs too, and a PR snapshot carries no
  // `openPrsClosingIt` key — gather.mjs sets it on the issue arm alone. The
  // guard must fall through it rather than throw, leaving the PR arm as it was.
  const pr = decide({ reason: 'sweep-awaiting', facts: {} }, prSnap({ botSpokeLast: true }), config)
  assert.deepEqual(types(pr), ['label', 'anomaly'])
})

test('a draft that is ready to advance is not reported as an orphan', () => {
  // The eight PRs of 2026-09-09: green, reviewed, and stuck only because the
  // token could not mark them ready. The orphan notice said the opposite.
  const ready = prSnap({ pr: { ...prSnap().pr, draft: true, changed_files: 1, additions: 3, deletions: 1 } })
  const p = decide({ reason: 'sweep-orphan', facts: {} }, ready, config)
  assert.deepEqual(types(p), ['note'], 'silent while it still has somewhere to go')

  // And the derivation that acts runs on every pass, draft or not.
  assert.ok(decide({ reason: 'sweep-pr', facts: {} }, ready, config).some((a) => a.type === 'markReady'))
})

test('a capped PR already labelled awaiting is swept in silence', () => {
  // SahajCloud#754: capped, awaiting, and re-derived 48 times a day. The first
  // pass applies the label and says so; every pass after it writes the same
  // label, the same comment and the same anomaly.
  const capped = { ci: red, record: { fixCi: 3 }, pr: { ...prSnap().pr, draft: false } }
  const first = decide({ reason: 'sweep-pr', facts: {} }, prSnap(capped), config)
  assert.ok(first.some((a) => a.type === 'label' && a.add.includes('awaiting')), 'the first pass hands over')
  assert.ok(first.some((a) => a.type === 'anomaly'))

  const next = decide({ reason: 'sweep-pr', facts: {} }, prSnap({ ...capped, item: { number: 5, labels: ['awaiting'] } }), config)
  assert.deepEqual(types(next), ['note'], 'the next sweep writes nothing')
})

test('an awaiting item is still swept, and a move still passes the gate', () => {
  // Resolving a review thread fires no workflow, so only the sweep sees it.
  // The derivation still runs; what the gate drops is a plan that repeats.
  const resolved = prSnap({
    item: { number: 5, labels: ['awaiting'] },
    pr: { ...prSnap().pr, draft: false },
    normalized: { reviewDecision: 'APPROVED' },
  })
  assert.deepEqual(types(decide({ reason: 'sweep-pr', facts: {} }, resolved, config)), ['armAutoMerge'])

  // A human-merge repo holds instead, and holding is not news.
  const held = prSnap({
    repo: { owner: 'sydevs', name: 'claude-workflow', full: 'sydevs/claude-workflow' },
    item: { number: 5, labels: ['awaiting'] },
    pr: { ...prSnap().pr, draft: false },
    normalized: { reviewDecision: 'APPROVED' },
    verdict: { verdict: 'HOLD', reason: 'human' },
  })
  assert.deepEqual(types(decide({ reason: 'sweep-pr', facts: {} }, held, config)), ['note'])
})

test('the orphan notice is said once, then the draft is left alone', () => {
  const stalled = { pr: { ...prSnap().pr, draft: true }, reviews: [{ user: { login: 'sydevs-bot' }, body: '## 🧐 Adversarial review', state: 'COMMENTED', submitted_at: '2026-09-08T10:00:00Z' }], ci: red, record: { fixCi: 3 } }
  const first = decide({ reason: 'sweep-orphan', facts: {} }, prSnap(stalled), config)
  assert.ok(first.some((a) => a.type === 'anomaly' && a.kind === 'orphan'))
  const next = decide({ reason: 'sweep-orphan', facts: {} }, prSnap({ ...stalled, item: { number: 5, labels: ['awaiting'] } }), config)
  assert.deepEqual(types(next), ['note'])
})

test('a sweep on an item without awaiting is never silenced', () => {
  const p = decide({ reason: 'sweep-pr', facts: {} }, prSnap({ ci: red, record: { fixCi: 3 } }), config)
  assert.ok(p.some((a) => a.type === 'comment'), 'the hand-over still speaks')
})

test('a merged PR is nobody\'s turn when its session finally unlocks', () => {
  // SahajCloud#747: a session held the lock when the PR merged. It unlocked
  // two minutes later, found nothing to do, and called that the human's turn.
  const merged = prSnap({ pr: { ...prSnap().pr, state: 'closed', merged: true, draft: false } })
  const p = decide({ reason: 'unlock', facts: { handler: 'address-review' } }, merged, config)
  assert.ok(!p.some((a) => a.type === 'label' && a.add.includes('awaiting')), 'awaiting is not added')
  assert.ok(p.some((a) => a.type === 'label' && a.remove.includes('awaiting')), 'and any stale one comes off')
})

test('a ticket born blocked never carries awaiting', () => {
  // SahajCloud#780 got awaiting at 08:23:07 and blocked at 08:23:09.
  const blocked = issueSnap({ item: { number: 780, labels: [], author: 'sydevs-bot' }, blockedByOpen: [{ number: 700 }] })
  const p = decide({ reason: 'issues.opened' }, blocked, config)
  const adds = p.filter((a) => a.type === 'label').flatMap((a) => a.add)
  assert.ok(adds.includes('blocked'), 'blocked is applied')
  assert.ok(!adds.includes('awaiting'), 'awaiting never is')

  const free = issueSnap({ item: { number: 781, labels: [], author: 'sydevs-bot' } })
  const q = decide({ reason: 'issues.opened' }, free, config)
  assert.ok(q.filter((a) => a.type === 'label').flatMap((a) => a.add).includes('awaiting'), 'an unblocked one still does')
})

test('claude-workflow is never armed — merging it is the deploy', () => {
  const cw = { ...config, mergePolicy: { loopMayNotMerge: ['claude-workflow'] } }
  const repo = { owner: 'sydevs', name: 'claude-workflow', full: 'sydevs/claude-workflow' }
  const ready = prSnap({ repo, pr: { ...prSnap().pr, draft: false, autoMergeArmed: false }, normalized: { reviewDecision: 'APPROVED' } })
  assert.ok(!types(evaluatePr(ready, cw)).includes('armAutoMerge'))

  const draft = prSnap({ repo, pr: { ...prSnap().pr, draft: true, changed_files: 1, additions: 3, deletions: 1 } })
  assert.ok(!types(evaluatePr(draft, cw)).includes('armAutoMerge'), 'not at mark-ready either')
})

test('a draft is armed at mark-ready, the first moment GitHub allows it', () => {
  const small = prSnap({ pr: { ...prSnap().pr, draft: true, changed_files: 1, additions: 3, deletions: 1 } })
  const t = types(evaluatePr(small, config))
  assert.ok(t.includes('markReady') && t.includes('armAutoMerge'))
  assert.ok(t.indexOf('markReady') < t.indexOf('armAutoMerge'), 'ready first — GitHub refuses auto-merge on a draft')
})

test('no implementation ticket is revised on arrival — write-ticket already wrote it', () => {
  const bot = issueSnap({ item: { number: 800, state: 'open', labels: [], author: 'sydevs-bot', authorAssociation: 'MEMBER', type: 'Bug' } })
  assert.ok(!decide({ reason: 'issues.opened' }, bot, config).some((a) => a.type === 'fire'))
  const mine = issueSnap({ item: { number: 801, state: 'open', labels: [], author: 'Ardnived', authorAssociation: 'MEMBER', type: 'Feature' } })
  assert.ok(!decide({ reason: 'issues.opened' }, mine, config).some((a) => a.type === 'fire'))
})

// ---- a consumer merges after its producer (why: docs/why.md#a-cross-repo-set-is-built-together)

test('a green consumer draft is marked ready for review with its producer, but not armed', () => {
  const s = prSnap({ reviews: [criticReview], linkedBlockedOpen: ['sydevs/SahajCloud#10'] })
  const p = evaluatePr(s, config)
  assert.deepEqual(types(p).slice(0, 3), ['markReady', 'requestReviewer', 'label'])
  assert.ok(!p.some((a) => a.type === 'armAutoMerge'))
  assert.match(p.find((a) => a.type === 'comment' && a.key.startsWith('waits-on')).body, /merges after sydevs\/SahajCloud#10/)
})

test('a ready consumer is armed only once its producer has closed', () => {
  const ready = { pr: { ...prSnap().pr, draft: false, autoMergeArmed: false }, reviews: [criticReview] }
  assert.ok(!evaluatePr(prSnap({ ...ready, linkedBlockedOpen: ['sydevs/SahajCloud#10'] }), config).some((a) => a.type === 'armAutoMerge'))
  assert.deepEqual(types(evaluatePr(prSnap({ ...ready, linkedBlockedOpen: [] }), config)), ['armAutoMerge'])
})

test('a PR whose goal holds the set build lock is left to that session', () => {
  assert.deepEqual(types(evaluatePr(prSnap({ linkedLocked: ['sydevs/SahajAtlasWeb#300'] }), config)), ['note'])
  assert.match(evaluatePr(prSnap({ linkedLocked: ['sydevs/SahajAtlasWeb#300'] }), config)[0].text, /^sydevs\/SahajAtlasWeb#300 is still locked/)
})

// ---- a feature is built in one session (why: docs/why.md#a-feature-is-built-in-one-session)

const cfgAttempts = { ...config, dispatch: { ...config.dispatch, maxAttempts: 3 } }
const asked = (over = {}) => issueSnap({
  item: { number: 9, state: 'open', labels: [] },
  botSpokeLast: true,
  request: { at: '2026-10-07T11:00:00Z', body: { continue: true } },
  record: { current: { handler: 'implement', firedAt: '2026-10-07T10:00:00Z', flags: { mode: null } } },
  ...over,
})

test('a draft with a body checklist goes to the critic: a PR opens only once its ticket is built', () => {
  const s = prSnap({ item: { number: 5, labels: [], body: '## Summary\n- x\n\n## Phases\n- [x] one\n- [ ] two\n\nCloses #9' }, linkedIssues: [9] })
  assert.deepEqual(types(evaluatePr(s, config)), ['fire:review-pr'])
})

test('an implement session that asks to continue gets the next session at once, with its flags', () => {
  const p = decide({ reason: 'unlock', facts: { handler: 'implement' } }, asked(), cfgAttempts)
  const f = p.find((a) => a.type === 'fire')
  assert.equal(f.handler, 'implement')
  assert.equal(f.flags.continuation, 1)
  assert.ok(p.some((a) => a.type === 'record' && a.patch.continues === 1))
  assert.ok(!p.some((a) => a.type === 'label' && a.add.includes('awaiting')))
})

test('a set build that asks to continue keeps its children', () => {
  const s = asked({ record: { current: { handler: 'implement', firedAt: '2026-10-07T10:00:00Z', flags: { mode: 'set', children: ['sydevs/SahajCloud#10', 'sydevs/SahajAtlasWeb#12'] } } } })
  const f = decide({ reason: 'unlock', facts: { handler: 'implement' } }, s, cfgAttempts).find((a) => a.type === 'fire')
  assert.deepEqual(f.flags.children, ['sydevs/SahajCloud#10', 'sydevs/SahajAtlasWeb#12'])
})

test('continuations stop at maxAttempts in a row, and the ticket becomes your turn', () => {
  const s = asked({ record: { continues: 3, current: { handler: 'implement', firedAt: '2026-10-07T10:00:00Z', flags: {} } } })
  const p = decide({ reason: 'unlock', facts: { handler: 'implement' } }, s, cfgAttempts)
  assert.ok(!p.some((a) => a.type === 'fire'))
  assert.ok(p.some((a) => a.type === 'label' && a.add.includes('awaiting')))
  assert.match(p.find((a) => a.type === 'comment').body, /Not finished after 4 sessions/)
  assert.ok(p.some((a) => a.type === 'record' && a.patch.continues === 0))
})

test('an old continue request is not read again, and an implement that ends without one resets the count', () => {
  const stale = asked({ request: { at: '2026-10-06T11:00:00Z', body: { continue: true } }, record: { continues: 2, current: { handler: 'implement', firedAt: '2026-10-07T10:00:00Z', flags: {} } } })
  const p = decide({ reason: 'unlock', facts: { handler: 'implement' } }, stale, cfgAttempts)
  assert.ok(!p.some((a) => a.type === 'fire'))
  assert.ok(p.some((a) => a.type === 'record' && a.patch.continues === 0))
})

test('an address-review that asks to continue gets the next session on the PR', () => {
  const s = prSnap({ request: { at: '2026-10-07T11:00:00Z', body: { continue: true } }, record: { current: { handler: 'address-review', firedAt: '2026-10-07T10:00:00Z', flags: {} } } })
  const p = decide({ reason: 'unlock', facts: { handler: 'address-review' } }, s, cfgAttempts)
  assert.deepEqual(p.filter((a) => a.type === 'fire').map((a) => [a.handler, a.flags.continuation]), [['address-review', 1]])
})

test('only implement and address-review continue: another handler asking is ignored', () => {
  const s = asked({ record: { current: { handler: 'revise', firedAt: '2026-10-07T10:00:00Z', flags: {} } } })
  assert.ok(!decide({ reason: 'unlock', facts: { handler: 'revise' } }, s, cfgAttempts).some((a) => a.type === 'fire'))
})

// ---- a bot PR answers a mention, a review or a thread reply --------------

const humanComment = (body, createdAt = '2026-10-09T10:00:00Z') => ({ author: 'Ardnived', body, createdAt, association: 'OWNER' })

test('a plain comment on a bot PR fires nothing and leaves awaiting on', () => {
  const s = prSnap({ item: { number: 5, labels: ['awaiting'] }, comments: [humanComment('looks odd, will check later')] })
  const p = decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: 'looks odd, will check later', association: 'OWNER' } }, s, config)
  assert.deepEqual(types(p), ['note'])
  assert.equal(evaluatePr(s, config).some((a) => a.handler === 'address-review'), false, 'the sweep agrees: an unmentioned comment is not owed a reply')
})

test('a mention on a bot PR clears awaiting and dispatches address-review', () => {
  const s = prSnap({ comments: [humanComment('@sydevs-bot rename this helper')] })
  const p = decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot rename this helper', association: 'OWNER' } }, s, config)
  assert.ok(p.some((a) => a.type === 'label' && a.remove.includes('awaiting')))
  assert.ok(p.some((a) => a.type === 'fire' && a.handler === 'address-review'))
})

test('a mention stays owed when a plain comment follows it', () => {
  const s = prSnap({ comments: [humanComment('@sydevs-bot rename this', '2026-10-09T10:00:00Z'), humanComment('also, nice work', '2026-10-09T10:05:00Z')] })
  assert.ok(evaluatePr(s, config).some((a) => a.handler === 'address-review'))
})

test('a review verb fires the critic and is not also owed a reply', () => {
  const s = prSnap({ comments: [humanComment('@sydevs-bot review')], reviews: [{ user: { login: 'sydevs-bot' }, body: '## 🧐 Adversarial review\n…', state: 'COMMENTED', submitted_at: '2026-10-09T11:00:00Z' }] })
  assert.equal(evaluatePr(s, config).some((a) => a.handler === 'address-review'), false)
})

test('a review on a bot PR still needs no mention', () => {
  const s = prSnap({ reviews: [{ user: { login: 'Ardnived' }, body: 'Please split this', state: 'COMMENTED', submitted_at: '2026-10-09T10:00:00Z' }] })
  assert.ok(evaluatePr(s, config).some((a) => a.handler === 'address-review'))
})

test('a comment on a human PR still needs a mention', () => {
  const s = prSnap({ pr: { ...prSnap().pr, user: { login: 'Ardnived' } } })
  assert.deepEqual(types(decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: 'hmm', association: 'OWNER' } }, s, config)), ['note'])
})

// ---- only required checks are CI -----------------------------------------

const RAILWAY_URL = 'https://railway.com/project/bdff2c72-5af2-4da3-9e2c-913f5e9d1b0f/service/1edee955-6c1f-4d8e-9cef-41737f981187?id=963aac12-f6c4-4b6e-bc9a-9feac615c336&environmentId=a35269c7-37ba-4d31-af10-711c611c2056'
const advisoryNotes = (advisory) => evaluatePr(prSnap({ pr: { ...prSnap().pr, changed_files: 1, additions: 10, deletions: 5 }, ci: { ...green, advisory } }), config)
  .filter((a) => a.type === 'comment' && a.key.startsWith('advisory '))

test('a red non-required check is said once and fires nothing', () => {
  const s = prSnap({ pr: { ...prSnap().pr, changed_files: 1, additions: 10, deletions: 5 }, ci: { ...green, advisory: [{ name: 'sahajcloud - SahajCloud', kind: 'status', targetUrl: null }] } })
  const p = evaluatePr(s, config)
  assert.equal(p.some((a) => a.handler === 'fix-ci'), false)
  const notes = p.filter((a) => a.type === 'comment' && a.key.startsWith('advisory '))
  assert.equal(notes.length, 1)
  assert.match(notes[0].body, /Not required/)
})

test('the advisory note links each failing context to its deployment, keyed by name alone', () => {
  const notes = advisoryNotes([
    { name: 'sahajcloud - SahajCloud', kind: 'status', targetUrl: RAILWAY_URL },
    { name: 'sahajcloud - SahajCloud', kind: 'check', targetUrl: null },
  ])
  assert.equal(notes.length, 1)
  assert.equal(notes[0].key, 'advisory sahajcloud - SahajCloud', 'the commentOnce key is unchanged, so no note is re-posted')
  assert.ok(notes[0].body.includes(`[\`sahajcloud - SahajCloud\`](${RAILWAY_URL})`), notes[0].body)
})

test('an advisory with no link, or one that is not https, is named without one', () => {
  const [note] = advisoryNotes([
    { name: 'Cloudflare Pages: sahajatlas', kind: 'check', targetUrl: null },
    { name: 'evil', kind: 'status', targetUrl: 'javascript:alert(1)' },
  ])
  assert.match(note.body, /: `Cloudflare Pages: sahajatlas`, `evil` failed/)
  assert.doesNotMatch(note.body, /\]\(/)
})

test('a parenthesis in a link cannot close the Markdown link early', () => {
  const [note] = advisoryNotes([{ name: 'x', kind: 'status', targetUrl: 'https://example.com/a)b(c' }])
  assert.ok(note.body.includes('[`x`](https://example.com/a%29b%28c)'), note.body)
})

test('no advisory note while required CI is still running', () => {
  const p = evaluatePr(prSnap({ ci: { ...running, advisory: [{ name: 'Cloudflare Pages: sahajatlas', kind: 'check', targetUrl: null }] } }), config)
  assert.deepEqual(types(p), ['note'])
})

// ---- a failed preview is read from its log (why: docs/why.md#a-failed-preview-is-read-from-its-log)

const railwayCfg = { ...config, railway: { statusContexts: ['sahajcloud - SahajCloud'] } }
const PREVIEW = { name: 'sahajcloud - SahajCloud', kind: 'status', targetUrl: RAILWAY_URL }
const deployPass = (sha, outcome = 'done') => ({ id: 'SahajCloud-5-fix-ci-20261012T000000000Z-bbbb', handler: 'fix-ci', flags: { mode: 'deploy' }, attempt: 1, firedAt: '2026-10-12T00:00:00.000Z', sha, outcome })
const fixCiFires = (plan) => plan.filter((a) => a.type === 'fire' && a.handler === 'fix-ci')
const spendsARepair = (plan) => plan.some((a) => a.type === 'bumpFixCi' || (a.type === 'record' && 'fixCi' in (a.patch || {})))

test('a failed preview with green required CI fires fix-ci in deploy mode, links it, and spends no repair', () => {
  const plan = evaluatePr(prSnap({ ci: { ...green, advisory: [PREVIEW] } }), railwayCfg)
  assert.deepEqual(types(plan), ['comment', 'fire:fix-ci'])
  assert.deepEqual(plan[1].flags, { mode: 'deploy' })
  assert.ok(plan[0].body.includes(RAILWAY_URL), 'the advisory comment carries the link')
  assert.equal(spendsARepair(plan), false, 'no bumpFixCi, no fixCi write')
})

test('a second ci event on the same head fires nothing and leaves record.fixCi unchanged', () => {
  const s = prSnap({ ci: { ...green, advisory: [PREVIEW] }, record: { fixCi: 1, dispatches: [deployPass('abc')] } })
  const plan = evaluatePr(s, railwayCfg)
  assert.deepEqual(fixCiFires(plan), [])
  assert.equal(spendsARepair(plan), false)
  assert.deepEqual(types(plan), ['fire:review-pr', 'comment'], 'the PR moves on to the critic, with the advisory note')
})

test('the unlock that ends a deploy pass does not fire another on its head', () => {
  // `apply` moves `current` into `dispatches` after this plan is made, and the
  // fire-time entry carries no flags, so `current` is the only witness here.
  const firedAt = { id: 'SahajCloud-5-fix-ci-20261012T000000000Z-bbbb', handler: 'fix-ci', attempt: 1, firedAt: '2026-10-12T00:00:00.000Z', sha: 'abc' }
  const { outcome, ...current } = deployPass('abc')
  const s = prSnap({ ci: { ...green, advisory: [PREVIEW] }, record: { fixCi: 0, current, dispatches: [firedAt] } })
  const plan = decide({ reason: 'unlock', facts: { handler: 'fix-ci' } }, s, railwayCfg)
  assert.deepEqual(fixCiFires(plan), [])
})

test('a push to a new head gets its own deploy pass', () => {
  const s = prSnap({ ci: { ...green, advisory: [PREVIEW] }, pr: { ...prSnap().pr, head: { sha: 'f00d' } }, record: { fixCi: 0, dispatches: [deployPass('abc')] } })
  assert.deepEqual(fixCiFires(evaluatePr(s, railwayCfg)).map((a) => a.flags), [{ mode: 'deploy' }])
})

test('a deploy pass on this head never stands in for a repair pass', () => {
  const s = prSnap({ ci: { ...red, advisory: [PREVIEW] }, record: { fixCi: 0, dispatches: [deployPass('abc')] } })
  assert.deepEqual(types(evaluatePr(s, railwayCfg)), ['bumpFixCi', 'fire:fix-ci'])
})

test('no deploy pass without a railway key, an unlisted context, or a link that is not a deployment', () => {
  const quiet = (cfg, advisory) => fixCiFires(evaluatePr(prSnap({ ci: { ...green, advisory } }), cfg))
  assert.deepEqual(quiet(config, [PREVIEW]), [])
  assert.deepEqual(quiet(railwayCfg, [{ ...PREVIEW, name: 'other - Railway' }]), [])
  assert.deepEqual(quiet(railwayCfg, [{ ...PREVIEW, targetUrl: 'https://railway.com/project/x' }]), [])
  assert.deepEqual(quiet(railwayCfg, [{ ...PREVIEW, targetUrl: null }]), [])
})

test('no deploy pass while required CI runs', () => {
  assert.deepEqual(types(evaluatePr(prSnap({ ci: { ...running, advisory: [PREVIEW] } }), railwayCfg)), ['note'])
})

// ---- a push from a person resets the repair count (why: docs/why.md#a-push-from-a-person-resets-the-repair-count)

test('at the cap, a head a person pushed since the last fix-ci resets the count and repairs again', () => {
  const s = prSnap({ ci: red, headAuthor: 'Ardnived', pr: { ...prSnap().pr, head: { sha: 'f00d' } }, record: { fixCi: 3, dispatches: [{ handler: 'fix-ci', sha: 'abc', outcome: 'done' }] } })
  const plan = evaluatePr(s, config)
  assert.deepEqual(types(plan), ['record', 'bumpFixCi', 'fire:fix-ci'])
  assert.deepEqual(plan[0].patch, { fixCi: 0 })
})

test('at the cap, the bot pushing a new head does not reset the count', () => {
  const s = prSnap({ ci: red, headAuthor: 'sydevs-bot', pr: { ...prSnap().pr, head: { sha: 'f00d' } }, record: { fixCi: 3, dispatches: [{ handler: 'fix-ci', sha: 'abc', outcome: 'done' }] } })
  assert.equal(evaluatePr(s, config)[0].type, 'label')
})

test('at the cap, a person whose push is still the head the last fix-ci saw does not reset it', () => {
  const s = prSnap({ ci: red, headAuthor: 'Ardnived', pr: { ...prSnap().pr, head: { sha: 'abc' } }, record: { fixCi: 3, dispatches: [{ handler: 'fix-ci', sha: 'abc' }] } })
  assert.equal(evaluatePr(s, config)[0].type, 'label')
})

// ---- an infrastructure failure is re-run, not repaired (why: docs/why.md#an-infrastructure-failure-is-re-run-not-repaired)

const infraCfg = { ...config, ceilings: { ciFixIterations: 3, ciInfraReruns: 2 } }
const infraRed = { ...red, infra: [{ name: 'CI', jobId: 42 }] }

test('red only on infrastructure re-runs the failed job instead of firing fix-ci', () => {
  const plan = evaluatePr(prSnap({ ci: infraRed }), infraCfg)
  assert.deepEqual(types(plan), ['note', 'rerunJobs'])
  assert.deepEqual(plan[1], { type: 'rerunJobs', sha: 'abc', checks: [{ name: 'CI', jobId: 42 }] })
})

test('after the re-run cap on this head, an infrastructure failure goes to a person, with no fix-ci', () => {
  const plan = evaluatePr(prSnap({ ci: infraRed, record: { fixCi: 0, ciReruns: { sha: 'abc', count: 2 } } }), infraCfg)
  assert.deepEqual(types(plan), ['label', 'comment', 'anomaly'])
  assert.deepEqual(plan[0].add, ['awaiting'])
  assert.match(plan[1].body, /infrastructure, not on this change/)
  assert.match(plan[1].body, /re-ran it 2 times/)
})

test('re-runs counted on an older head do not count against a new one', () => {
  const plan = evaluatePr(prSnap({ ci: infraRed, record: { fixCi: 0, ciReruns: { sha: 'old', count: 2 } } }), infraCfg)
  assert.deepEqual(types(plan), ['note', 'rerunJobs'])
})

test('an infrastructure failure Actions did not produce cannot be re-run, so it goes to a person', () => {
  const plan = evaluatePr(prSnap({ ci: { ...red, infra: [{ name: 'CI', jobId: null }] } }), infraCfg)
  assert.equal(plan[0].type, 'label')
})

test('a code failure beside an infrastructure one still fires fix-ci', () => {
  const mixed = { ...red, failing: [{ name: 'CI' }, { name: 'Smoke' }], infra: [{ name: 'Smoke', jobId: 7 }] }
  assert.deepEqual(types(evaluatePr(prSnap({ ci: mixed }), infraCfg)), ['bumpFixCi', 'fire:fix-ci'])
})

// ---- a question the bot asked waits on the human -------------------------

const criticReview = { user: { login: 'sydevs-bot' }, body: '## 🧐 Adversarial review\n…', state: 'COMMENTED', submitted_at: '2026-10-09T10:00:00Z' }
const questionThread = (replies = []) => ({ isResolved: false, comments: [
  { author: 'sydevs-bot', createdAt: '2026-10-09T10:00:00Z', body: '<!-- sydevs-question -->\nShould the cache key include the locale?' },
  ...replies,
] })

test('an unanswered question thread is the human\'s turn, not address-review', () => {
  const s = prSnap({ reviews: [criticReview], threads: [questionThread()] })
  const p = evaluatePr(s, config)
  assert.equal(p.some((a) => a.handler === 'address-review'), false, 'the bot does not answer its own question')
  assert.deepEqual(types(p).slice(0, 2), ['markReady', 'requestReviewer'], 'the green draft still moves on')
  assert.equal(decide({ reason: 'sweep-pr', facts: {} }, s, config).some((a) => a.handler === 'address-review'), false, 'the sweep agrees')
})

test('a human reply in a question thread fires address-review', () => {
  const s = prSnap({ reviews: [criticReview], threads: [questionThread([{ author: 'Ardnived', createdAt: '2026-10-09T11:00:00Z', body: 'Yes, include it.' }])] })
  const p = evaluatePr(s, config)
  assert.deepEqual(types(p), ['note', 'fire:address-review'])
  assert.equal(p[0].text, 'a thread waits on a reply')
})

test('a plain own-rooted thread is still owed an answer beside a question', () => {
  const s = prSnap({ reviews: [criticReview], threads: [questionThread(), { isResolved: false, comments: [{ author: 'sydevs-bot', createdAt: '2026-10-09T10:00:00Z', body: 'finding' }] }] })
  assert.deepEqual(types(evaluatePr(s, config)), ['note', 'fire:address-review'])
})

test('review.questionMarker names the marker when it is set', () => {
  const custom = { ...config, review: { ...config.review, questionMarker: '<!-- ask -->' } }
  const asked = { isResolved: false, comments: [{ author: 'sydevs-bot', createdAt: '2026-10-09T10:00:00Z', body: '<!-- ask -->\nWhich one?' }] }
  assert.equal(evaluatePr(prSnap({ reviews: [criticReview], threads: [asked] }), custom).some((a) => a.handler === 'address-review'), false)
  assert.ok(evaluatePr(prSnap({ reviews: [criticReview], threads: [questionThread()] }), custom).some((a) => a.handler === 'address-review'), 'the default literal is not also honoured once a marker is configured')
})

// ---- a fallback review is the review ---------------------------------------

const fallbackReview = (createdAt = '2026-10-09T12:00:00Z') => ({ author: 'sydevs-bot', createdAt, body: '\n## 🧐 Adversarial review\nThe pending-review tools failed, so here it is as one comment.' })

test('a critic review posted as one comment counts, so the draft is marked ready', () => {
  const s = prSnap({ comments: [fallbackReview()] })
  const p = evaluatePr(s, config)
  assert.equal(p.some((a) => a.handler === 'review-pr'), false, 'the critic is not fired again')
  assert.deepEqual(types(p).slice(0, 2), ['markReady', 'requestReviewer'])
  const unlock = decide({ reason: 'unlock', facts: { handler: 'review-pr' } }, s, config)
  assert.equal(unlock.some((a) => a.type === 'fire'), false, 'nor on the unlock that ends it')
})

test('only the bot\'s comment with the header counts as the critic', () => {
  const human = prSnap({ comments: [{ ...fallbackReview(), author: 'Ardnived' }] })
  assert.deepEqual(types(evaluatePr(human, config)), ['fire:review-pr'])
  const plain = prSnap({ comments: [{ ...fallbackReview(), body: 'Revision done.\n## 🧐 Adversarial review' }] })
  assert.deepEqual(types(evaluatePr(plain, config)), ['fire:review-pr'], 'the header must lead the body')
})

test('a review verb is answered by a fallback review posted after it', () => {
  const asked = humanComment('@sydevs-bot review', '2026-10-09T11:00:00Z')
  const answered = prSnap({ comments: [asked, fallbackReview('2026-10-09T12:00:00Z')] })
  assert.equal(evaluatePr(answered, config).some((a) => a.handler === 'review-pr'), false)
  const before = prSnap({ comments: [fallbackReview('2026-10-09T10:00:00Z'), asked] })
  assert.deepEqual(types(evaluatePr(before, config)), ['fire:review-pr'], 'a verb after the review still asks again')
})

// ---- a conflicted draft is resolved, not left to the orphan sweep ---------

const conflicted = (over = {}) => prSnap({ mergeable: 'CONFLICTING', ci: { green: false, reason: 'no checks', running: [], failing: [] }, ...over })

test('a conflicted draft fires resolve-conflicts', () => {
  assert.deepEqual(types(evaluatePr(conflicted(), config)), ['fire:resolve-conflicts'])
})

test('a red, conflicted draft gets resolve-conflicts, not fix-ci', () => {
  assert.deepEqual(types(evaluatePr(conflicted({ ci: red }), config)), ['fire:resolve-conflicts'])
})

test('a conflicted draft whose branch a session holds is left to it', () => {
  assert.deepEqual(types(evaluatePr(conflicted({ locked: true }), config)), ['recheck'])
  assert.deepEqual(types(evaluatePr(conflicted({ linkedLocked: [9] }), config)), ['note'])
})

test('a conflict-scan after a merge re-derives a draft too', () => {
  assert.deepEqual(types(decide({ reason: 'conflict-scan', facts: {} }, conflicted(), config)), ['fire:resolve-conflicts'])
})

test('a resolve-conflicts that ended on this head is not fired again; a new head asks again', () => {
  const ended = { id: 'x', handler: 'resolve-conflicts', attempt: 1, firedAt: '2026-10-09T10:00:00Z', sha: 'abc', outcome: 'done' }
  const p = evaluatePr(conflicted({ record: { dispatches: [ended] } }), config)
  assert.equal(p.some((a) => a.type === 'fire'), false, 'a session that stopped on a semantic conflict is not looped')
  assert.ok(p.some((a) => a.type === 'label' && a.add.includes('awaiting')), 'it is your turn')
  const unlock = decide({ reason: 'unlock', facts: { handler: 'resolve-conflicts' } }, conflicted({ record: { current: { ...ended, outcome: undefined } } }), config)
  assert.equal(unlock.some((a) => a.type === 'fire'), false, 'nor on the unlock that ends it')
  assert.deepEqual(types(evaluatePr(conflicted({ record: { dispatches: [{ ...ended, sha: 'old' }] } }), config)), ['fire:resolve-conflicts'])
})

// ---- a wake hint promises only what wakes the bot ------------------------

const wakeComment = (plan) => plan.find((a) => a.type === 'comment')

test('the orphan notice asks for a mention or a push, never a plain comment', () => {
  const stalled = { pr: { ...prSnap().pr, draft: true }, reviews: [criticReview], ci: red, record: { fixCi: 3 } }
  const c = wakeComment(decide({ reason: 'sweep-orphan', facts: {} }, prSnap(stalled), config).filter((a) => a.key?.startsWith('orphan ')))
  assert.match(c.key, /^orphan abc$/, 'the key is unchanged, so no item is told twice')
  assert.match(c.body, /A mention \(`@sydevs-bot`\) or a push from you starts me again\./)
  assert.doesNotMatch(c.body, /Comment or push/)
})

// ---- a question review is not the critic's -------------------------------

const questionReview = (submitted_at) => ({ user: { login: 'sydevs-bot' }, state: 'COMMENTED', body: '1 question(s) for the reviewer, one per thread.', submitted_at, inline_count: 0 })

test('a question review neither counts as the critic nor answers a review verb', () => {
  const s = prSnap({ reviews: [questionReview('2026-10-09T10:00:00Z')] })
  assert.deepEqual(types(evaluatePr(s, config)), ['fire:review-pr'], 'the critic still has to run')
  const asked = humanComment('@sydevs-bot review', '2026-10-09T11:00:00Z')
  const critic = { user: { login: 'sydevs-bot' }, body: '## 🧐 Adversarial review\n…', state: 'COMMENTED', submitted_at: '2026-10-09T09:00:00Z' }
  const after = prSnap({ comments: [asked], reviews: [critic, questionReview('2026-10-09T12:00:00Z')] })
  const fired = evaluatePr(after, config).find((a) => a.handler === 'review-pr')
  assert.equal(fired?.flags?.onDemand, true, 'the verb is still owed')
})
