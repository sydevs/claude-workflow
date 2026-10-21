import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide } from '../decide.mjs'
import { parseVerb, parseBlock } from '../verbs.mjs'

const config = {
  org: 'sydevs',
  repos: ['SahajCloud', 'SahajAtlasWeb', 'WeMeditateWeb', 'SahajAtlasWordpress', 'claude-workflow'],
  identity: { expectedLogin: 'sydevs-bot' },
  assignment: { reviewer: 'Ardnived', respondTo: ['Ardnived', 'antontcymbal', 'Copilot'] },
  labels: { journal: 'ops-journal', awaiting: 'awaiting', stuck: 'stuck', blocked: 'blocked', lock: 'bot:working', proposal: 'proposal' },
  ceilings: { ciFixIterations: 3 },
  mergePolicy: { loopMayNotMerge: ['claude-workflow'] },
  review: { bodyHeader: '## 🧐 Adversarial review', skipWhen: { maxFiles: 2, maxLines: 40 } },
  dispatch: {
    commandPrefix: '@sydevs-bot',
    verbs: { issue: ['implement', 'revise', 'review', 'block'], pr: ['address', 'review', 'revise'], aliases: { issue: { review: 'revise' }, pr: { revise: 'review' } }, unknownIssue: 'revise', unknownPr: 'address' },
  },
  issueFields: { holdUntil: { name: 'Hold Until', fieldId: 46423871, maxHorizonDays: 30, maxRehold: 3 } },
  roadmap: { type: 'Roadmap', spikeBranchPrefix: 'claude/spike-' },
}

const repo = (name = 'SahajAtlasWeb') => ({ owner: 'sydevs', name, full: `sydevs/${name}` })
const types = (plan) => plan.map((a) => a.type + (a.handler ? ':' + a.handler : '') + (a.value !== undefined ? ':' + a.value : ''))
const fires = (plan) => plan.filter((a) => a.type === 'fire')

function snap(over = {}) {
  const { item, ...rest } = over
  return {
    kind: 'issue',
    repo: repo(),
    item: { number: 300, state: 'open', labels: [], author: 'Ardnived', authorAssociation: 'MEMBER', type: 'Roadmap', body: '## The goal\nx', ...item },
    locked: false,
    record: {},
    comments: [],
    markers: { blockedBy: [], recheck: null, recheckPassed: false },
    park: { until: null, passed: false, source: null },
    blockedByOpen: [],
    openPrsClosingIt: [],
    openQuestions: { total: 0, open: 0 },
    children: [],
    parent: null,
    request: null,
    dependents: [],
    botSpokeLast: true,
    now: new Date('2026-10-07T12:00:00Z'),
    ...rest,
  }
}
const ticket = (over = {}) => snap({ ...over, item: { type: 'Feature', number: 41, ...over.item } })
const verb = (body, author = 'Ardnived') => ({ reason: 'issue_comment', facts: { author, body, association: 'MEMBER', commentId: 77 } })

// ---- placement --------------------------------------------------------

test("a member's roadmap ticket is reviewed on arrival and carries no Status", () => {
  const p = decide({ reason: 'issues.opened' }, snap(), config)
  assert.deepEqual(fires(p).map((a) => [a.handler, a.flags.mode]), [['revise-roadmap', 'intake']])
  const statuses = p.filter((a) => a.type === 'status')
  assert.deepEqual(statuses.map((a) => a.value), [null], 'every status becomes one clear')
})

test("a stranger's roadmap ticket waits for a member, and its markers are text", () => {
  const s = snap({
    item: { author: 'drive-by', authorAssociation: 'NONE' },
    markers: { blockedBy: [{ owner: 'sydevs', repo: 'SahajCloud', number: 1 }], recheck: null },
  })
  const p = decide({ reason: 'issues.opened' }, s, config)
  assert.equal(fires(p).length, 0)
  assert.ok(!p.some((a) => a.type === 'relationships'), 'no relationship from a stranger')
  assert.ok(p.some((a) => a.type === 'label' && a.add.includes('awaiting')))
})

test('a roadmap proposal the bot filed waits for a human verdict', () => {
  const p = decide({ reason: 'issues.opened' }, snap({ item: { author: 'sydevs-bot' } }), config)
  assert.equal(fires(p).length, 0)
  assert.ok(p.some((a) => a.type === 'label' && a.add.includes('proposal')))
})

test('typing a ticket Roadmap reviews it once', () => {
  assert.equal(fires(decide({ reason: 'issues.typed' }, snap(), config))[0].handler, 'revise-roadmap')
  const reviewed = snap({ record: { dispatches: [{ handler: 'revise-roadmap', outcome: 'done' }] } })
  assert.equal(fires(decide({ reason: 'issues.typed' }, reviewed, config)).length, 0)
})

test('a stranger editing their own issue cannot create a relationship', () => {
  const s = ticket({ item: { author: 'drive-by', authorAssociation: 'NONE' }, markers: { blockedBy: [{ owner: 'sydevs', repo: 'SahajCloud', number: 2 }], recheck: null } })
  assert.deepEqual(types(decide({ reason: 'issues.edited', facts: { sender: 'drive-by' } }, s, config)), ['note'])
  assert.ok(decide({ reason: 'issues.edited', facts: { sender: 'Ardnived' } }, s, config).some((a) => a.type === 'relationships'))
})

// ---- conversation -----------------------------------------------------

test("the roadmap author's reply is your turn, never a session", () => {
  const s = snap({ item: { author: 'drive-by', authorAssociation: 'NONE' } })
  const p = decide(verb('@sydevs-bot 1A please', 'drive-by'), s, config)
  assert.equal(fires(p).length, 0)
  assert.ok(p.some((a) => a.type === 'label' && a.add.includes('awaiting')))
})

test("a member's revise on a stranger's goal accepts it with the full review", () => {
  const s = snap({ item: { author: 'drive-by', authorAssociation: 'NONE' } })
  assert.deepEqual(fires(decide(verb('@sydevs-bot revise'), s, config)).map((a) => [a.handler, a.flags.mode]), [['revise-roadmap', 'intake']])
})

test('revise and review are one verb, and a bare mention is revise', () => {
  const reviewed = { record: { dispatches: [{ handler: 'revise-roadmap', outcome: 'done' }] } }
  for (const body of ['@sydevs-bot revise 1A', '@sydevs-bot review', '@sydevs-bot what about B?']) {
    const p = decide(verb(body), snap(reviewed), config)
    assert.deepEqual(fires(p).map((a) => [a.handler, a.flags.mode]), [['revise-roadmap', 'revise']], body)
  }
  assert.equal(fires(decide(verb('@sydevs-bot review'), ticket(), config))[0].handler, 'revise')
})

test('on a PR, revise means review', () => {
  assert.equal(parseVerb('@sydevs-bot revise', config.dispatch, 'pr').verb, 'review')
  assert.equal(parseVerb('@sydevs-bot', config.dispatch, 'pr').verb, 'address')
})

// ---- implement --------------------------------------------------------

test('implement waits while an open question is unticked, on either tier', () => {
  for (const s of [snap({ openQuestions: { total: 2, open: 1 } }), ticket({ openQuestions: { total: 1, open: 1 } })]) {
    const p = decide(verb('@sydevs-bot implement'), s, config)
    assert.equal(fires(p).length, 0)
    assert.match(p.find((a) => a.type === 'comment').body, /1 open question/)
  }
})

test('implement on a roadmap ticket with no children plans them', () => {
  const p = decide(verb('@sydevs-bot implement'), snap(), config)
  assert.deepEqual(fires(p).map((a) => [a.handler, a.flags.mode]), [['implement-roadmap', 'plan']])
})

test('implement on a roadmap ticket with children approves the open ones', () => {
  const children = [
    { repo: repo('SahajCloud'), number: 10, state: 'open' },
    { repo: repo('SahajAtlasWeb'), number: 11, state: 'closed' },
    { repo: repo('SahajAtlasWeb'), number: 12, state: 'open' },
  ]
  const p = decide(verb('@sydevs-bot implement'), snap({ children, record: { dispatches: [{ handler: 'implement-roadmap', outcome: 'done' }] } }), config)
  const t = p.find((a) => a.type === 'targets').list
  assert.deepEqual(t.map((x) => [x.repo.name, x.number, x.reason]), [['SahajCloud', 10, 'approve-set'], ['SahajAtlasWeb', 12, 'approve-set']])
  assert.equal(t[0].facts.parent, 'sydevs/SahajAtlasWeb#300')
  assert.deepEqual(fires(p).map((a) => [a.handler, a.flags.mode, a.flags.children]), [['implement', 'set', ['sydevs/SahajCloud#10', 'sydevs/SahajAtlasWeb#12']]], 'the open children build as one set')
})

test('every child closed: implement plans what the goal still lacks', () => {
  const p = decide(verb('@sydevs-bot implement'), snap({ children: [{ repo: repo(), number: 11, state: 'closed' }] }), config)
  assert.equal(fires(p)[0].handler, 'implement-roadmap')
})

test('an approved child starts at once, or waits blocked with the approval kept', () => {
  const free = decide({ reason: 'approve', facts: { by: 'Ardnived' } }, ticket(), config)
  assert.equal(fires(free)[0].handler, 'implement')
  const held = decide({ reason: 'approve', facts: { by: 'Ardnived' } }, ticket({ blockedByOpen: [{ number: 10 }] }), config)
  assert.equal(fires(held).length, 0)
  assert.ok(held.some((a) => a.type === 'record' && a.patch.pendingImplement))
  assert.ok(held.some((a) => a.type === 'label' && a.add.includes('blocked') && a.remove.includes('awaiting')))
})

test('implement on a blocked ticket is an approval that waits', () => {
  const p = decide(verb('@sydevs-bot implement'), ticket({ blockedByOpen: [{ number: 695 }] }), config)
  assert.equal(fires(p).length, 0)
  assert.ok(p.some((a) => a.type === 'record' && a.patch.pendingImplement))
  assert.match(p.find((a) => a.type === 'comment').body, /waits on #695/)
})

// ---- block, recheck, unblock -----------------------------------------

test('block until a date is mechanical, inside the horizon', () => {
  const p = decide(verb('@sydevs-bot block until 2026-10-20 — waiting on Payload 3.x'), ticket(), config)
  assert.deepEqual(types(p).filter((t) => t !== 'react'), ['label', 'hold', 'record', 'label', 'comment'])
  assert.equal(p.find((a) => a.type === 'hold').date, '2026-10-20')
  assert.match(p.find((a) => a.type === 'comment').body, /Payload 3\.x/)
  const far = decide(verb('@sydevs-bot block until 2027-03-01'), ticket(), config)
  assert.ok(!far.some((a) => a.type === 'hold'))
  assert.match(far.find((a) => a.type === 'comment').body, /no later than 2026-11-06/)
})

test('block on a ticket makes a relationship; block with only a reason asks a session', () => {
  const on = decide(verb('@sydevs-bot block on sydevs/SahajCloud#632'), ticket(), config)
  assert.deepEqual(on.find((a) => a.type === 'relationships').blockedBy, [{ owner: 'sydevs', repo: 'SahajCloud', number: 632 }])
  const why = decide(verb('@sydevs-bot block until the Howler seek bug is fixed upstream'), ticket(), config)
  assert.deepEqual(fires(why).map((a) => [a.handler, a.flags.mode]), [['revise', 'block']])
  assert.deepEqual(parseBlock('@sydevs-bot block waiting on legal', config.dispatch, 'sydevs'), { form: 'reason', reason: 'waiting on legal' })
})

test('after maxRehold quiet re-holds the ticket is handed back with options', () => {
  const s = ticket({ item: { labels: ['blocked'] }, park: { until: '2026-10-01', passed: true, source: 'field' }, record: { rehold: 3 } })
  const p = decide({ reason: 'unblock-check', facts: {} }, s, config)
  assert.equal(fires(p).length, 0)
  assert.ok(p.some((a) => a.type === 'label' && a.add.includes('awaiting') && a.remove.includes('blocked')))
  assert.match(p.find((a) => a.type === 'comment').body, /A — keep waiting/)
})

test('a recheck that re-held the ticket ends quietly blocked', () => {
  const s = ticket({ item: { labels: ['blocked'] }, park: { until: '2026-11-01', passed: false, source: 'field' }, record: { rehold: 1, current: { handler: 'revise', firedAt: '2026-10-07T10:00:00Z' } } })
  const p = decide({ reason: 'unlock', facts: { handler: 'revise' } }, s, config)
  assert.ok(p.some((a) => a.type === 'label' && a.add.includes('blocked') && a.remove.includes('awaiting')))
  assert.equal(fires(p).length, 0)
})

test('a recheck that found the ticket free starts a pre-approved one, or hands it back', () => {
  const base = { item: { labels: ['blocked'] }, park: { until: '2026-10-01', passed: true, source: 'field' } }
  const approved = decide({ reason: 'unlock', facts: { handler: 'revise' } }, ticket({ ...base, record: { rehold: 1, pendingImplement: { by: 'Ardnived' } } }), config)
  assert.equal(fires(approved)[0].handler, 'implement')
  assert.ok(approved.some((a) => a.type === 'label' && a.remove.includes('blocked')))
  assert.ok(approved.some((a) => a.type === 'record' && a.patch.rehold === 0))
  const plain = decide({ reason: 'unlock', facts: { handler: 'revise' } }, ticket({ ...base, record: { rehold: 1 } }), config)
  assert.equal(fires(plain).length, 0)
  assert.ok(plain.some((a) => a.type === 'label' && a.add.includes('awaiting')))
})

// ---- children done, escalation, requests -------------------------------

test('a closed child with an open parent tells the parent', () => {
  const s = ticket({ parent: { repo: repo(), number: 300, state: 'open', type: 'Roadmap' } })
  const t = decide({ reason: 'issues.closed' }, s, config).find((a) => a.type === 'targets').list
  assert.deepEqual(t.map((x) => [x.number, x.reason]), [[300, 'child-closed']])
})

test('the last child closing fires the completion check', () => {
  const done = snap({ children: [{ repo: repo(), number: 1, state: 'closed' }, { repo: repo(), number: 2, state: 'closed' }] })
  assert.deepEqual(fires(decide({ reason: 'child-closed', facts: {} }, done, config)).map((a) => [a.handler, a.flags.mode]), [['revise-roadmap', 'verify']])
  const half = snap({ children: [{ repo: repo(), number: 1, state: 'closed' }, { repo: repo(), number: 2, state: 'open' }] })
  assert.deepEqual(types(decide({ reason: 'child-closed', facts: {} }, half, config)), ['note'])
  const busy = decide({ reason: 'child-closed', facts: {} }, { ...done, locked: true }, config)
  assert.deepEqual(types(busy), ['record', 'recheck'])
  // The unlock that consumes a re-armed `verifyDue`. (sydevs/claude-workflow#185)
  const firedAt = '2026-10-07T10:00:00.500Z'
  const closedAt = (n) => ({ repo: repo(), number: n, state: 'closed', closedAt: '2026-10-07T09:59:58Z' })
  const unlock = (children, current) => decide({ reason: 'unlock', facts: {} }, snap({ children, record: { verifyDue: true, current: { firedAt, ...current } } }), config)
  const verify = { handler: 'revise-roadmap', flags: { mode: 'verify' } }
  const again = unlock([closedAt(1), closedAt(2)], verify)
  assert.equal(fires(again).length, 0, 'the verify that just ended already read every child')
  assert.ok(again.some((a) => a.type === 'record' && a.patch.verifyDue === false), 'and the owed check is cleared')
  const reclosed = unlock([closedAt(1), { ...closedAt(2), closedAt: '2026-10-07T10:05:00Z' }], verify)
  assert.deepEqual(fires(reclosed).map((a) => [a.handler, a.flags.mode]), [['revise-roadmap', 'verify']], 'a child closed after the verify fired')
  for (const current of [{ ...verify, handler: 'implement' }, { ...verify, flags: { mode: 'revise' } }]) {
    const other = unlock([closedAt(1), closedAt(2)], current)
    assert.deepEqual(fires(other).map((a) => [a.handler, a.flags.mode]), [['revise-roadmap', 'verify']], `${current.handler} ${current.flags.mode} held the lock`)
  }
})

test('children closing seconds apart produce one verify, which ends as any verify does', () => {
  // sydevs/SahajCloud#897: closed 09:40:24, :27 and :30; verify fired at :43, and again on its own unlock.
  const kids = [[881, 24], [883, 27], [884, 30]].map(([number, sec]) => ({ repo: repo('SahajCloud'), number, state: 'closed', stateReason: 'completed', closedAt: `2026-10-12T09:40:${sec}Z` }))
  const current = { handler: 'revise-roadmap', flags: { mode: 'verify' }, firedAt: '2026-10-12T09:40:43.120Z' }
  let rec = {}
  let verifies = 0
  const leg = (reason, over = {}) => {
    const p = decide({ reason, facts: {} }, snap({ children: kids, record: rec, ...over }), config)
    for (const a of p) if (a.type === 'record') rec = { ...rec, ...a.patch }
    verifies += fires(p).filter((a) => a.handler === 'revise-roadmap').length
    return p
  }
  leg('child-closed') // #883's leg already reads all three closed
  rec = { ...rec, current }
  leg('child-closed', { locked: true }) // #884's leg finds the lock
  assert.equal(rec.verifyDue, true)
  const end = leg('unlock')
  assert.equal(verifies, 1)
  assert.equal(rec.verifyDue, false)
  const plain = decide({ reason: 'unlock', facts: {} }, snap({ children: kids, record: { current } }), config)
  const rest = (p) => p.filter((a) => a.type !== 'record' && a.type !== 'note')
  assert.deepEqual(rest(end), rest(plain), 'a gap the verify left is still your turn')
})

test('children all closed as not planned make a withdrawn verify, on both fire sites', () => {
  // sydevs/SahajCloud#897: three children withdrawn, verified as if they shipped.
  const kid = (number, stateReason) => ({ repo: repo(), number, state: 'closed', stateReason })
  const withdrawn = [kid(881, 'not_planned'), kid(883, 'not_planned'), kid(884, 'not_planned')]
  const mixed = [kid(881, 'not_planned'), kid(883, 'completed'), kid(884, 'not_planned')]
  const onClose = (children) => fires(decide({ reason: 'child-closed', facts: {} }, snap({ children }), config))[0].flags
  const onUnlock = (children) => fires(decide({ reason: 'unlock', facts: { handler: 'implement' } }, snap({ children, record: { verifyDue: true, current: { handler: 'implement', firedAt: '2026-10-07T10:00:00Z' } } }), config))[0].flags
  assert.deepEqual(onClose(withdrawn), { mode: 'verify', withdrawn: true })
  assert.deepEqual(onClose(mixed), { mode: 'verify' }, 'something shipped: no flag')
  for (const children of [withdrawn, mixed]) assert.deepEqual(onUnlock(children), onClose(children), 'the unlock path agrees with child-closed')
})

test('a child that escalated a decision hands the turn to its parent, not to you twice', () => {
  const s = ticket({
    parent: { repo: repo(), number: 300, state: 'open', type: 'Roadmap' },
    request: { at: '2026-10-07T11:00:00Z', body: { escalated: true } },
    record: { current: { handler: 'implement', firedAt: '2026-10-07T10:00:00Z' } },
  })
  const p = decide({ reason: 'unlock', facts: { handler: 'implement' } }, s, config)
  assert.equal(p.find((a) => a.type === 'targets').list[0].reason, 'escalated')
  assert.ok(!p.some((a) => a.type === 'label' && a.add.includes('awaiting')))
  const parent = decide({ reason: 'escalated', facts: { child: 'sydevs/SahajCloud#41' } }, snap(), config)
  assert.ok(parent.some((a) => a.type === 'label' && a.add.includes('awaiting')))
})

test('a replan request re-plans the children; an old request is ignored', () => {
  const kids = [{ repo: repo(), number: 1, state: 'open' }]
  const fresh = snap({ children: kids, request: { at: '2026-10-07T11:00:00Z', body: { replan: true } }, record: { current: { handler: 'revise-roadmap', firedAt: '2026-10-07T10:00:00Z' }, dispatches: [{ handler: 'implement-roadmap', outcome: 'done' }] } })
  assert.deepEqual(fires(decide({ reason: 'unlock', facts: {} }, fresh, config)).map((a) => [a.handler, a.flags.mode]), [['implement-roadmap', 'replan']])
  const stale = { ...fresh, request: { at: '2026-10-01T11:00:00Z', body: { replan: true } } }
  assert.equal(fires(decide({ reason: 'unlock', facts: {} }, stale, config)).length, 0)
})

test('a transfer request moves a childless roadmap ticket, last', () => {
  const s = snap({ repo: repo('SahajCloud'), request: { at: '2026-10-07T11:00:00Z', body: { transfer: { repo: 'SahajAtlasWeb', milestone: 'Sahaj Atlas launch' } } }, record: { current: { handler: 'revise-roadmap', firedAt: '2026-10-07T10:00:00Z' }, dispatches: [{ handler: 'revise-roadmap' }] } })
  const p = decide({ reason: 'unlock', facts: {} }, s, config)
  assert.deepEqual(p[p.length - 1], { type: 'transfer', repo: 'SahajAtlasWeb', milestone: 'Sahaj Atlas launch' })
  const withKids = { ...s, children: [{ repo: repo(), number: 1, state: 'open' }] }
  assert.ok(!decide({ reason: 'unlock', facts: {} }, withKids, config).some((a) => a.type === 'transfer'))
})

test('a spike PR is left to the session that pushed it', () => {
  const s = { kind: 'pr', repo: repo(), item: { number: 5, labels: [] }, pr: { number: 5, state: 'open', draft: true, user: { login: 'sydevs-bot' }, head: { ref: 'claude/spike-252-redirects', sha: 'a' } }, comments: [], reviews: [], threads: [], ci: { green: true, running: [], failing: [] } }
  for (const reason of ['pull_request.opened', 'sweep-pr', 'sweep-orphan', 'ci']) assert.deepEqual(types(decide({ reason, facts: {} }, s, config)), ['note'], reason)
})

test('a goal created with its type is locked by one leg and never marked awaiting by the other', () => {
  // SahajAtlasWeb#256: `typed` took the lock, then `opened` added awaiting.
  const p = decide({ reason: 'issues.opened' }, snap({ locked: true }), config)
  assert.ok(!p.some((a) => a.type === 'label' && a.add.includes('awaiting')))
  assert.equal(fires(p).length, 0, 'the session that holds the lock is the only one')
})

test('children a review attached are planned first, never approved unplanned', () => {
  const kids = [{ repo: repo('SahajCloud'), number: 881, state: 'open' }]
  const p = decide(verb('@sydevs-bot implement'), snap({ children: kids }), config)
  assert.deepEqual(fires(p).map((a) => [a.handler, a.flags.mode]), [['implement-roadmap', 'plan']])
  assert.ok(!p.some((a) => a.type === 'targets'), 'no child is approved')
  const replan = snap({ children: kids, request: { at: '2026-10-07T11:00:00Z', body: { replan: true } }, record: { current: { handler: 'revise-roadmap', firedAt: '2026-10-07T10:00:00Z' } } })
  assert.equal(fires(decide({ reason: 'unlock', facts: {} }, replan, config)).length, 0, 'nothing to re-plan before a plan')
})

// ---- one verb plans and approves (why: docs/why.md#one-verb-plans-and-approves)

const plannedRec = (over = {}) => ({ dispatches: [{ handler: 'implement-roadmap', outcome: 'done' }], ...over })
const endedPlan = (over = {}) => ({ dispatches: [{ handler: 'revise-roadmap', outcome: 'done' }], current: { handler: 'implement-roadmap', firedAt: '2026-10-07T10:00:00Z' }, approveOnPlan: { by: 'Ardnived' }, ...over })

test('implement on an unplanned goal plans, and the approval waits for the plan to end', () => {
  const p = decide(verb('@sydevs-bot implement'), snap(), config)
  assert.ok(p.some((a) => a.type === 'record' && a.patch.approveOnPlan?.by === 'Ardnived'))
  assert.ok(!p.some((a) => a.type === 'targets'), 'nothing is approved before the plan exists')
})

test('the plan the verb asked for approves its children when it ends, with no second verb', () => {
  const children = [{ repo: repo('SahajCloud'), number: 10, state: 'open', prs: 0 }, { repo: repo('SahajAtlasWeb'), number: 12, state: 'open', prs: 0 }]
  const p = decide({ reason: 'unlock', facts: { handler: 'implement-roadmap' } }, snap({ children, record: endedPlan() }), config)
  const t = p.find((a) => a.type === 'targets').list
  assert.deepEqual(t.map((x) => [x.number, x.reason, x.facts.by]), [[10, 'approve-set', 'Ardnived'], [12, 'approve-set', 'Ardnived']])
  assert.ok(p.some((a) => a.type === 'record' && a.patch.approveOnPlan === null))
  assert.ok(p.some((a) => a.type === 'record' && a.patch.approved === true))
  assert.ok(!p.some((a) => a.type === 'label' && a.add.includes('awaiting')), 'the goal is not your turn')
})

test('a plan that raised a decision approves nothing and hands the goal back', () => {
  const children = [{ repo: repo('SahajCloud'), number: 10, state: 'open', prs: 0 }]
  const p = decide({ reason: 'unlock', facts: { handler: 'implement-roadmap' } }, snap({ children, record: endedPlan(), openQuestions: { total: 1, open: 1 } }), config)
  assert.ok(!p.some((a) => a.type === 'targets'))
  assert.ok(p.some((a) => a.type === 'record' && a.patch.approveOnPlan === null))
  assert.ok(p.some((a) => a.type === 'label' && a.add.includes('awaiting')))
})

test('a goal planned under the old split is re-planned before approval', () => {
  const children = [{ repo: repo('SahajCloud'), number: 10, state: 'open', prs: 0 }, { repo: repo('SahajCloud'), number: 11, state: 'open', prs: 0 }]
  const p = decide(verb('@sydevs-bot implement'), snap({ children, record: plannedRec() }), config)
  assert.deepEqual(fires(p).map((a) => [a.handler, a.flags.mode]), [['implement-roadmap', 'replan']])
  assert.ok(!p.some((a) => a.type === 'targets'))
})

test('two children in one repo are not doubled up when one already has a PR', () => {
  const children = [{ repo: repo('SahajCloud'), number: 10, state: 'open', prs: 1 }, { repo: repo('SahajCloud'), number: 11, state: 'open', prs: 0 }]
  const p = decide(verb('@sydevs-bot implement'), snap({ children, record: plannedRec() }), config)
  assert.deepEqual(p.find((a) => a.type === 'targets').list.map((x) => x.number), [11], 'the child with a PR is not approved again')
})

test('a re-plan of an approved goal approves what it files', () => {
  const kids = [{ repo: repo(), number: 1, state: 'open', prs: 0 }]
  const s = snap({ children: kids, request: { at: '2026-10-07T11:00:00Z', body: { replan: true } }, record: plannedRec({ approved: true, current: { handler: 'revise-roadmap', firedAt: '2026-10-07T10:00:00Z' } }) })
  const p = decide({ reason: 'unlock', facts: {} }, s, config)
  assert.ok(p.some((a) => a.type === 'record' && a.patch.approveOnPlan))
  assert.equal(fires(p)[0].flags.mode, 'replan')
})

// ---- a cross-repo set is built together (why: docs/why.md#a-cross-repo-set-is-built-together)

const producer = { repo: repo('SahajCloud'), number: 10, state: 'open', prs: 0, blockedByOpen: [] }
const consumer = { repo: repo('SahajAtlasWeb'), number: 12, state: 'open', prs: 0, blockedByOpen: [{ owner: 'sydevs', repo: 'SahajCloud', number: 10, state: 'open' }] }

test('a consumer blocked only by its producer builds with it, in one session on the goal', () => {
  const p = decide(verb('@sydevs-bot implement'), snap({ children: [producer, consumer], record: plannedRec() }), config)
  assert.deepEqual(p.find((a) => a.type === 'targets').list.map((x) => [x.number, x.reason]), [[10, 'approve-set'], [12, 'approve-set']])
  assert.deepEqual(fires(p)[0].flags.children, ['sydevs/SahajCloud#10', 'sydevs/SahajAtlasWeb#12'])
})

test('a child blocked outside the set waits alone, and a lone free child builds alone', () => {
  const held = { ...consumer, blockedByOpen: [{ owner: 'sydevs', repo: 'SahajCloud', number: 700, state: 'open' }] }
  const p = decide(verb('@sydevs-bot implement'), snap({ children: [producer, held], record: plannedRec() }), config)
  assert.deepEqual(p.find((a) => a.type === 'targets').list.map((x) => [x.number, x.reason]), [[10, 'approve'], [12, 'approve']])
  assert.equal(fires(p).length, 0, 'each child starts through its own approval')
})

test('a consumer whose producer waits outside drops out of the set with it', () => {
  const blockedProducer = { ...producer, blockedByOpen: [{ owner: 'sydevs', repo: 'SahajCloud', number: 700, state: 'open' }] }
  const p = decide(verb('@sydevs-bot implement'), snap({ children: [blockedProducer, consumer], record: plannedRec() }), config)
  assert.ok(p.find((a) => a.type === 'targets').list.every((x) => x.reason === 'approve'))
})

test('a set child is approved without a session of its own', () => {
  const p = decide({ reason: 'approve-set', facts: { by: 'Ardnived', parent: 'sydevs/SahajAtlasWeb#300' } }, ticket({ item: { labels: ['proposal', 'awaiting', 'blocked'] } }), config)
  assert.equal(fires(p).length, 0)
  assert.ok(p.some((a) => a.type === 'status' && a.value === 'approved'))
  assert.ok(!p.some((a) => a.type === 'label' && a.remove.includes('blocked')), 'the producer still orders the merge')
})

test('a set build that opened every PR leaves the goal off your list', () => {
  const s = snap({ children: [{ ...producer, prs: 1 }, { ...consumer, prs: 1 }], record: { dispatches: [{ handler: 'revise-roadmap' }, { handler: 'implement-roadmap' }], current: { handler: 'implement', firedAt: '2026-10-07T10:00:00Z', flags: { mode: 'set' } } } })
  const p = decide({ reason: 'unlock', facts: { handler: 'implement' } }, s, config)
  assert.ok(!p.some((a) => a.type === 'label' && a.add.includes('awaiting')))
  const short = { ...s, children: [{ ...producer, prs: 1 }, consumer] }
  assert.ok(decide({ reason: 'unlock', facts: { handler: 'implement' } }, short, config).some((a) => a.type === 'label' && a.add.includes('awaiting')), 'a child left unbuilt is your turn')
})

test('the producer merging frees a built consumer without a session', () => {
  const s = ticket({ item: { labels: ['blocked'] }, openPrsClosingIt: [55] })
  const p = decide({ reason: 'unblock-check', facts: {} }, s, config)
  assert.equal(fires(p).length, 0)
  assert.ok(p.some((a) => a.type === 'label' && a.remove.includes('blocked')))
  assert.deepEqual(p.find((a) => a.type === 'targets').list.map((x) => [x.kind, x.number, x.reason]), [['pr', 55, 'ci']])
})

test('a set build that raised a decision on its own goal hands the goal back', () => {
  const s = snap({ children: [{ ...producer, prs: 1 }, consumer], openQuestions: { total: 1, open: 1 }, request: { at: '2026-10-07T11:00:00Z', body: { escalated: true } }, record: { dispatches: [{ handler: 'revise-roadmap' }, { handler: 'implement-roadmap' }], current: { handler: 'implement', firedAt: '2026-10-07T10:00:00Z', flags: { mode: 'set' } } } })
  assert.ok(decide({ reason: 'unlock', facts: { handler: 'implement' } }, s, config).some((a) => a.type === 'label' && a.add.includes('awaiting')))
})

test('a child a session already holds is never approved into a second build', () => {
  const p = decide(verb('@sydevs-bot implement'), snap({ children: [{ ...producer, locked: true }, { ...consumer, blockedByOpen: [] }], record: plannedRec() }), config)
  assert.deepEqual(p.find((a) => a.type === 'targets').list.map((x) => [x.number, x.reason]), [[12, 'approve']])
})
