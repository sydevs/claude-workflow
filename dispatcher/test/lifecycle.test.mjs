// The Status lifecycle's moving parts: the reconcile pass, the Pending due,
// a member's PR, and the Status write itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decide, evaluatePr } from '../decide.mjs'
import { apply } from '../apply.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
const now = new Date('2026-10-27T12:00:00Z')
const repo = { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }
const types = (plan) => plan.filter((a) => a.type !== 'syncStatus').map((a) => a.type + (a.handler ? ':' + a.handler : ''))
const reconcile = { repo, kind: 'issue', number: 9, reason: 'reconcile', facts: {} }

function issue(over = {}) {
  const { item, ...rest } = over
  return {
    kind: 'issue', repo, now,
    item: { number: 9, state: 'open', labels: [], type: 'Feature', author: 'sydevs-bot', authorAssociation: 'MEMBER', ...item },
    locked: false, record: {}, comments: [], markers: { blockedBy: [], unresolvedBlockers: [] },
    blockedByOpen: [], blockedByAll: [], park: { until: null, passed: false }, openPrsClosingIt: [], openQuestions: { open: 0 }, children: [], parent: null, dependents: [],
    ...rest,
  }
}
function pr(over = {}) {
  const { pull, ...rest } = over
  return {
    kind: 'pr', repo, now,
    item: { number: 5, state: 'open', labels: [] },
    locked: false, record: { fixCi: 0 }, threads: [], reviews: [], comments: [], linkedIssues: [],
    pr: { number: 5, state: 'open', draft: false, user: { login: 'sydevs-bot' }, head: { sha: 'abc' }, autoMergeArmed: true, changed_files: 10, additions: 200, deletions: 20, ...pull },
    mergeable: 'MERGEABLE', ci: { green: true, failing: [], running: [], reason: 'green' }, normalized: { reviewDecision: 'APPROVED', mergeStateStatus: 'BLOCKED' },
    ...rest,
  }
}
const hoursAgo = (h) => new Date(now.getTime() - h * 3600_000).toISOString()

// ---- the reconcile pass ---------------------------------------------------

test('reconcile starts an approved ticket that is free, and drains what a lost event left', () => {
  assert.deepEqual(types(decide(reconcile, issue({ record: { approved: { by: 'Ardnived' } } }), config)), ['fire:implement'])
  const lostUnlock = issue({ record: { current: { handler: 'revise', deadline: hoursAgo(1) } } })
  assert.equal(decide(reconcile, lostUnlock, config)[0].type, 'unlocked', 'a session on record with no lock is read as its unlock')
  const retry = issue({ record: { pending: { handler: 'revise', reason: '429', retryAfter: hoursAgo(1) } } })
  assert.deepEqual(types(decide(reconcile, retry, config)), ['retry'])
  const early = issue({ record: { pending: { handler: 'revise', reason: '429', retryAfter: '2026-10-27T13:00:00Z' } } })
  assert.deepEqual(types(decide(reconcile, early, config)), ['note'])
  const late = issue({ locked: true, item: { labels: ['bot:working'] }, record: { current: { handler: 'implement', deadline: hoursAgo(1) } } })
  assert.deepEqual(types(decide(reconcile, late, config)), ['timeout'])
})

test('a passed hold says so once, and the ticket is yours', () => {
  const s = issue({ park: { until: '2026-10-20', passed: true, source: 'field' }, record: { status: 'hold' } })
  const p = decide(reconcile, s, config)
  assert.match(p.find((a) => a.type === 'comment').body, /hold until 2026-10-20 has passed/)
  assert.equal(p.find((a) => a.type === 'comment').key, 'hold-expired 2026-10-20')
})

// sydevs/SahajAtlasWeb#328 and sydevs/WeMeditateWeb#198: approved, armed,
// and sitting for days because nothing owned the wait.
// (why: docs/why.md#pending-has-a-due-awaiting-has-a-reason)
test('an approved PR past its due is read again, then handed back with the reason', () => {
  const due = (attempts) => pr({ record: { fixCi: 0, status: 'pending', pendingSince: hoursAgo(3), dueAttempts: attempts } })
  const first = decide({ ...reconcile, kind: 'pr', number: 5 }, due(0), config)
  assert.deepEqual(first.find((a) => a.type === 'record').patch.dueAttempts, 1)
  const last = decide({ ...reconcile, kind: 'pr', number: 5 }, due(3), config)
  assert.match(last.find((a) => a.type === 'record' && a.patch.handback).patch.handback.reason, /has not moved \(BLOCKED\)/)
  assert.ok(last.some((a) => a.type === 'anomaly' && a.kind === 'pending-overdue'))
  const fresh = decide({ ...reconcile, kind: 'pr', number: 5 }, pr({ record: { fixCi: 0, status: 'pending', pendingSince: hoursAgo(1) } }), config)
  assert.ok(!fresh.some((a) => a.type === 'record'), 'inside its due, nothing is counted')
})

test('past the due, mergeability GitHub still calls unknown is resolved, never read as clean', () => {
  const s = pr({ mergeable: 'UNKNOWN', record: { fixCi: 0, status: 'pending', pendingSince: hoursAgo(3) } })
  assert.ok(decide({ ...reconcile, kind: 'pr', number: 5 }, s, config).some((a) => a.type === 'fire' && a.handler === 'resolve-conflicts'))
})

// ---- the false re-ask (why: docs/why.md#a-resolved-conflict-is-not-a-new-question)

test('the unlock after resolve-conflicts on an approved PR asks nobody anything', () => {
  // sydevs/SahajAtlasWeb#328 was approved three times: each conflict fix
  // ended with the PR back on the reviewer's list.
  const s = pr({ record: { fixCi: 0, current: { handler: 'resolve-conflicts', sha: 'abc' } } })
  const p = decide({ repo, kind: 'pr', number: 5, reason: 'unlock', facts: { handler: 'resolve-conflicts' } }, s, config)
  assert.deepEqual(types(p), ['unlocked:resolve-conflicts'])
  assert.ok(!p.some((a) => a.type === 'comment' || a.type === 'requestReviewer' || (a.type === 'record' && a.patch.handback)))
})

test('an approved PR with a question thread names the thread, once per thread', () => {
  const t = { id: 'PRRT_1', isResolved: false, comments: [{ author: 'sydevs-bot', body: 'A or B?\n<!-- sydevs-question -->', url: 'https://github.com/sydevs/SahajCloud/pull/5#discussion_r1' }] }
  const p = evaluatePr(pr({ threads: [t] }), config)
  const c = p.find((a) => a.type === 'comment')
  assert.equal(c.key, 'approved-thread PRRT_1')
  assert.match(c.body, /discussion_r1/)
})

// ---- a member's PR (why: docs/why.md#a-members-pr-gets-the-loop)

test("a member's ready PR gets the critic and a reviewer; their draft is left alone", () => {
  const ready = pr({ pull: { user: { login: 'Ardnived' }, autoMergeArmed: false }, normalized: { reviewDecision: null } })
  assert.deepEqual(types(evaluatePr(ready, config)), ['requestReviewer', 'fire:review-pr'])
  const reviewed = pr({ pull: { user: { login: 'Ardnived' }, autoMergeArmed: false }, normalized: { reviewDecision: null }, reviews: [{ user: { login: 'sydevs-bot' }, body: '## 🧐 Adversarial review', submitted_at: hoursAgo(1) }] })
  assert.deepEqual(types(evaluatePr(reviewed, config)), ['requestReviewer', 'armAutoMerge'])
  const draft = pr({ pull: { user: { login: 'Ardnived' }, draft: true } })
  assert.deepEqual(types(evaluatePr(draft, config)), ['note'])
})

test("a mention on a member's draft is a request of its own", () => {
  const draft = pr({ pull: { user: { login: 'Ardnived' }, draft: true }, comments: [{ author: 'Ardnived', body: '@sydevs-bot fix the lint', createdAt: hoursAgo(0) }] })
  const p = decide({ repo, kind: 'pr', number: 5, reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot fix the lint', association: 'MEMBER' } }, draft, config)
  assert.deepEqual(types(p), ['fire:address-review'])
})

test("on a member's PR only a thread the bot rooted, or someone else's review, asks the bot", () => {
  const own = { isResolved: false, comments: [{ author: 'Ardnived', body: 'note to self', createdAt: hoursAgo(1) }] }
  const s = pr({ pull: { user: { login: 'Ardnived' } }, threads: [own], normalized: { reviewDecision: null }, reviews: [{ user: { login: 'sydevs-bot' }, body: '## 🧐 Adversarial review', submitted_at: hoursAgo(2) }] })
  assert.ok(!evaluatePr(s, config).some((a) => a.type === 'fire' && a.handler === 'address-review'))
  const theirs = { ...s, reviews: [...s.reviews, { user: { login: 'antontcymbal' }, state: 'CHANGES_REQUESTED', body: 'rename it', submitted_at: hoursAgo(0) }] }
  assert.ok(evaluatePr(theirs, config).some((a) => a.type === 'fire' && a.handler === 'address-review'))
})

test('an outside PR answers a mention and nothing else', () => {
  const s = pr({ pull: { user: { login: 'dependabot[bot]' } } })
  assert.deepEqual(evaluatePr(s, config), [])
})

// ---- the Status write itself ---------------------------------------------

function boardGh(boardName) {
  const calls = []
  const gh = {
    calls,
    rest: {
      issues: {
        listComments: async () => ({ data: [] }),
        createComment: async (a) => { calls.push(['createComment', a]); return { data: { id: 1 } } },
        updateComment: async (a) => { calls.push(['updateComment', a]); return { data: {} } },
        listForRepo: async () => ({ data: [] }),
        create: async () => ({ data: { number: 400 } }),
      },
    },
    graphql: async (q, v) => {
      if (q.includes('projectV2(number')) return { organization: { projectV2: { id: 'P', status: { id: 'F', options: Object.values(config.projects.status).map((name, i) => ({ id: `o${i}`, name })) } } } }
      if (q.includes('projectItems')) return { node: { projectItems: { nodes: [{ id: 'I', project: { number: config.projects.number }, fieldValueByName: { name: boardName } }] } } }
      if (q.includes('updateProjectV2ItemFieldValue')) { calls.push(['status', v.o]); return {} }
      return {}
    },
    paginate: async () => [],
  }
  return gh
}

test('a board value nobody wrote is a drag: reverted and journalled', async () => {
  const gh = boardGh('Done')
  const snapshot = issue({ item: { number: 9, state: 'open', labels: [], nodeId: 'N9' }, record: { status: 'awaiting' } })
  const logs = []
  await apply({ gh, target: { repo, kind: 'issue', number: 9, reason: 'reconcile' }, snapshot, plan: [{ type: 'syncStatus' }], config, env: {}, dryRun: false, core: { info: (m) => logs.push(m) }, now })
  assert.ok(gh.calls.some(([k, o]) => k === 'status' && o === 'o0'), 'written back to Awaiting')
  assert.ok(logs.some((m) => /board drag reverted: Done → Awaiting/.test(m)))
})

test('the Pending clock starts when a wait the machinery owns begins, and stops when it ends', async () => {
  const gh = boardGh('Awaiting')
  const snapshot = issue({ item: { number: 9, state: 'open', labels: [], nodeId: 'N9' }, record: { status: 'awaiting', approved: { by: 'Ardnived' } } })
  await apply({ gh, target: { repo, kind: 'issue', number: 9, reason: 'reconcile' }, snapshot, plan: [{ type: 'syncStatus' }], config, env: {}, dryRun: false, core: { info: () => {} }, now })
  assert.equal(snapshot.record.pendingSince, now.toISOString())
  assert.equal(snapshot.record.status, 'pending')
  const done = issue({ item: { number: 9, state: 'closed', labels: [], nodeId: 'N9' }, record: { status: 'pending', pendingSince: hoursAgo(1), dueAttempts: 2 } })
  await apply({ gh: boardGh('Pending'), target: { repo, kind: 'issue', number: 9, reason: 'issues.closed' }, snapshot: done, plan: [{ type: 'syncStatus' }], config, env: {}, dryRun: false, core: { info: () => {} }, now })
  assert.equal(done.record.pendingSince, null)
  assert.equal(done.record.dueAttempts, 0)
})

test('no pass but a person\'s verb approves a goal\'s children', () => {
  // The migration records `approved` on goals that were planned, so a
  // reconcile or an unblock that started their children would build tickets
  // nobody approved.
  const kids = [{ repo, number: 10, state: 'open', prs: 0, blockedByOpen: [] }]
  const g = (over) => issue({ item: { type: 'Roadmap' }, children: kids, record: { approved: { by: 'Ardnived' }, dispatches: [{ handler: 'implement-roadmap' }] }, ...over })
  assert.ok(!decide(reconcile, g(), config).some((a) => a.type === 'targets' || a.type === 'fire'), 'reconcile leaves a goal alone')
  const unblocked = decide({ ...reconcile, reason: 'unblock-check', facts: { closedNumber: 3 } }, g(), config)
  assert.ok(!unblocked.some((a) => a.type === 'targets' || a.type === 'fire'), 'an unblock never approves children')
  const unplanned = decide({ ...reconcile, reason: 'unblock-check', facts: { closedNumber: 3 } }, g({ children: [], record: { approved: { by: 'Ardnived' } } }), config)
  assert.ok(unplanned.some((a) => a.type === 'fire' && a.handler === 'implement-roadmap'), 'an approved, unplanned goal is planned when its blocker closes')
})
