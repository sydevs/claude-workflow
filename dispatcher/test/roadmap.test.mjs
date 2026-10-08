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
  const p = decide(verb('@sydevs-bot implement'), snap({ children }), config)
  assert.equal(fires(p).length, 0, 'the parent starts nothing itself')
  const t = p.find((a) => a.type === 'targets').list
  assert.deepEqual(t.map((x) => [x.repo.name, x.number, x.reason]), [['SahajCloud', 10, 'approve'], ['SahajAtlasWeb', 12, 'approve']])
  assert.equal(t[0].facts.parent, 'sydevs/SahajAtlasWeb#300')
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
  const fresh = snap({ children: kids, request: { at: '2026-10-07T11:00:00Z', body: { replan: true } }, record: { current: { handler: 'revise-roadmap', firedAt: '2026-10-07T10:00:00Z' } } })
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
