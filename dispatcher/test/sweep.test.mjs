import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { listSweepTargets } from '../sweep.mjs'
import { driftTargets, allowedStatuses } from '../reconcile.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
const repo = { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }
const now = new Date('2026-09-08T12:00:00Z')

function fake({ issuesByLabel = {}, prs = [], recent = [], graphIssues = null, graphPrs = [], leases = [] }) {
  const rest = {
    issues: {
      listForRepo: (args) => ({ data: args.labels ? issuesByLabel[args.labels] || [] : recent }),
      listComments: () => ({ data: [] }),
    },
    pulls: { list: () => ({ data: prs }) },
    git: { listMatchingRefs: async () => ({ data: leases.map((n) => ({ ref: `refs/sydevs-lease/${n}` })) }) },
  }
  const graphql = async (q) => (q.includes('pullRequests(')
    ? { repository: { pullRequests: { pageInfo: { hasNextPage: false }, nodes: graphPrs } } }
    : { repository: { issues: { pageInfo: { hasNextPage: false }, nodes: graphIssues || [] } } })
  return { rest, graphql, paginate: async (fn, args) => (await fn(args)).data }
}
const bot = { login: config.identity.expectedLogin }

test('every open, unlocked bot PR is re-derived, draft included', async () => {
  const prs = [
    { number: 5, draft: false, user: bot, labels: [], updated_at: '2026-09-08T11:00:00Z' },
    { number: 6, draft: true, user: bot, labels: [], updated_at: '2026-09-08T11:00:00Z' },
    { number: 7, draft: false, user: { login: 'Ardnived' }, labels: [], updated_at: '2026-09-08T11:00:00Z' },
    { number: 8, draft: false, user: bot, labels: [{ name: 'bot:working' }], updated_at: '2026-09-08T11:00:00Z' },
  ]
  const t = await listSweepTargets({ github: fake({ issuesByLabel: { 'bot:working': [{ number: 8, pull_request: {} }] }, prs }), config, repo, now })
  const scans = t.filter((x) => x.reason === 'sweep-pr').map((x) => x.number).sort((a, b) => a - b)
  assert.deepEqual(scans, [5, 6, 7], 'the ready one, the draft and the member\'s PR; not the locked one')
  assert.ok(!t.some((x) => x.reason === 'sweep-orphan'), 'a fresh draft is not an orphan')
})

test('a stale draft is re-derived first, and only then considered an orphan', async () => {
  // The derivation acts. The orphan notice only tells a human, and stays
  // quiet when the derivation found something to do.
  const prs = [{ number: 9, draft: true, user: bot, labels: [], updated_at: '2026-09-01T00:00:00Z' }]
  const t = await listSweepTargets({ github: fake({ prs }), config, repo, now })
  assert.deepEqual(t.filter((x) => x.number === 9).map((x) => x.reason), ['sweep-pr', 'sweep-orphan'], 'in that order')
})

// The cheap view: one GraphQL page per kind, its board Status beside it.
const OFF = Symbol('not on the board')
const node = (number, { labels = [], blockers = [], board = 'Awaiting', type = null, pr = false, hold = null } = {}) => ({
  number,
  issueType: type ? { name: type } : null,
  labels: { nodes: labels.map((name) => ({ name })) },
  blockedBy: { nodes: blockers.map((state) => ({ state })) },
  closedByPullRequestsReferences: { nodes: pr ? [{ state: 'OPEN' }] : [] },
  issueFieldValues: { nodes: hold ? [{ value: hold, field: { name: 'Hold Until' } }] : [] },
  projectItems: { nodes: board === OFF ? [] : [{ project: { number: 2 }, fieldValueByName: board ? { name: board } : null }] },
})

// sydevs/WeMeditateWeb#124 and #150 sat out of step for days: the old drift
// sweep looked only at items updated in the last two hours, on a cron that
// lands every two to seven. (why: docs/why.md#the-reconciler-replaces-the-drift-window)
test('the reconciler targets every item its cheap facts rule out, however long it has been quiet', async () => {
  const t = await listSweepTargets({
    github: fake({
      graphIssues: [
        node(1),                                            // in step
        node(2, { blockers: ['OPEN'] }),                    // Awaiting with an open blocker
        node(3, { board: 'Blocked' }),                      // Blocked with none
        node(4, { pr: true }),                              // an open PR, not Done
        node(5, { board: OFF }),                            // not on the board
        node(6, { board: null }),                           // on it, no Status
        node(7, { board: 'Revising' }),                     // an option that no longer exists
        node(8, { board: 'Working' }),                      // Working with no lock
        node(9, { board: 'Hold', hold: '2026-09-01' }),     // a hold that passed
        node(10, { board: 'Hold', hold: '2026-12-01' }),    // a hold still ahead
        node(11, { labels: ['ops-journal'], board: OFF }),
        node(12, { board: 'Pending' }),                     // Pending: gathered for its due
      ],
    }),
    config, repo, now,
  })
  const drift = t.filter((x) => x.reason === 'reconcile').map((x) => x.number)
  assert.deepEqual(drift, [2, 3, 4, 5, 6, 7, 8, 9, 12])
})

test('an event run adds only disagreements, capped, and never its own item', () => {
  const view = [
    { kind: 'issue', number: 1, labels: [], blockedOpen: 0, prOpen: false, board: 'Pending' },
    { kind: 'issue', number: 2, labels: [], blockedOpen: 0, prOpen: false, board: 'Blocked' },
    { kind: 'issue', number: 3, labels: [], blockedOpen: 0, prOpen: false, board: 'Done' },
    { kind: 'issue', number: 4, labels: [], blockedOpen: 0, prOpen: false, board: 'Blocked' },
  ]
  const t = driftTargets(view, config, repo, { now, limit: 1, skip: new Set([2]) })
  assert.deepEqual(t.map((x) => x.number), [3], 'Pending waits for the cron; #2 is the event\'s own; the cap is one')
})

test('a PR outside the loop is only ever Awaiting; a bot draft is the machinery\'s', () => {
  assert.deepEqual(allowedStatuses({ kind: 'pr', labels: [], draft: false, author: 'dependabot[bot]' }, config), ['awaiting'])
  assert.deepEqual(allowedStatuses({ kind: 'pr', labels: [], draft: true, author: 'Ardnived' }, config), ['awaiting'])
  assert.ok(allowedStatuses({ kind: 'pr', labels: [], draft: true, author: 'sydevs-bot' }, config).includes('pending'))
  assert.deepEqual(allowedStatuses({ kind: 'pr', labels: ['bot:working'], draft: false, author: 'sydevs-bot' }, config), ['working'])
})

test('a cheap view that cannot answer reconciles nothing, and the sweep still runs', async () => {
  const github = fake({ prs: [{ number: 5, draft: false, user: bot, labels: [], updated_at: '2026-09-08T11:00:00Z' }] })
  github.graphql = async () => { throw new Error('Field issueFieldValues does not exist') }
  const t = await listSweepTargets({ github, config, repo, now })
  assert.ok(!t.some((x) => x.reason === 'reconcile'))
  assert.ok(t.some((x) => x.reason === 'sweep-pr'))
})

test('sweep-lease takes a PR\'s kind from the open PRs, and reclaims before anything fires', async () => {
  // `coalesceTargets` keys on `repo#number` and keeps the first target's kind,
  // so `kind: 'issue'` here sent a routine record with a non-null head and a
  // kind that contradicted it.
  const prs = [{ number: 5, draft: false, user: bot, labels: [], updated_at: '2026-09-08T11:00:00Z' }]
  const t = await listSweepTargets({ github: fake({ prs, leases: [5, 42] }), config, repo, now })
  const forFive = t.filter((x) => x.number === 5)
  assert.deepEqual(forFive.map((x) => x.reason), ['sweep-lease', 'sweep-pr'], 'the reclaim comes first')
  assert.equal(forFive[0].kind, 'pr', 'an open PR number is a PR')
  assert.equal(t.find((x) => x.number === 42).kind, 'issue', 'anything else stays an issue')
})
