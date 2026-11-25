// One target per repo#number, carrying every reason the pass found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { coalesceTargets, queuedPr, resolve, targetLabel } from '../resolve.mjs'
import { emptyRecord, renderRecord } from '../record.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))

const repo = { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }
const t = (number, reason, facts = {}) => ({ repo, kind: 'pr', number, reason, event: 'schedule', facts })

test('a sweep pass finding three reasons for one PR emits one target carrying them all', () => {
  // A blocked, stale, open draft bot PR: `unblock-check`, `sweep-pr` and
  // `sweep-orphan`. As three matrix legs on one concurrency group, the middle
  // one is cancelled by the third and silently lost.
  const out = coalesceTargets([t(860, 'unblock-check'), t(860, 'sweep-pr'), t(860, 'sweep-orphan')])
  assert.equal(out.length, 1, 'one leg, so no two legs share a group')
  assert.equal(out[0].number, 860)
  assert.deepEqual(out[0].reasons.map((r) => r.reason), ['unblock-check', 'sweep-pr', 'sweep-orphan'], 'in the order the sweep found them')
})

test('a coalesced target still reads as its first reason', () => {
  const out = coalesceTargets([t(860, 'sweep-pr', { a: 1 }), t(860, 'sweep-orphan')])
  assert.equal(out[0].reason, 'sweep-pr')
  assert.deepEqual(out[0].facts, { a: 1 })
})

test('each reason keeps its own facts', () => {
  const out = coalesceTargets([t(7, 'unblock-check', { closedNumber: 3 }), t(7, 'sweep-timeout', { handler: 'implement', attempt: 2 })])
  assert.deepEqual(out[0].reasons[0].facts, { closedNumber: 3 })
  assert.deepEqual(out[0].reasons[1].facts, { handler: 'implement', attempt: 2 })
})

test('different items stay different targets, and different repos never merge', () => {
  const other = { owner: 'sydevs', name: 'WeMeditateWeb', full: 'sydevs/WeMeditateWeb' }
  const out = coalesceTargets([t(1, 'sweep-pr'), t(2, 'sweep-pr'), { ...t(1, 'sweep-pr'), repo: other }])
  assert.equal(out.length, 3)
  assert.deepEqual(out.map((x) => `${x.repo.name}#${x.number}`), ['SahajCloud#1', 'SahajCloud#2', 'WeMeditateWeb#1'])
})

test('one reason twice for one item is one reason', () => {
  const out = coalesceTargets([t(5, 'sweep-pr'), t(5, 'sweep-pr')])
  assert.deepEqual(out[0].reasons.map((r) => r.reason), ['sweep-pr'])
})

test('nothing in, nothing out', () => {
  assert.deepEqual(coalesceTargets([]), [])
})

// ---- merge-queue runs (why: docs/why.md#a-queue-failure-is-a-ci-failure)

test('a queue branch names its PR, whatever the base is called', () => {
  assert.equal(queuedPr('gh-readonly-queue/main/pr-959-2c2765ba676e1689ea4d48fa445517e2054f5177'), 959)
  assert.equal(queuedPr('gh-readonly-queue/release/v2/pr-12-abc123'), 12)
  assert.equal(queuedPr('claude/refactor-958-escape-regexp-utility'), null)
  assert.equal(queuedPr(undefined), null)
})

// A `check_suite` carries the app that posted it and no `html_url`; a
// `workflow_run` is Actions' own and carries one.
const queueRun = (conclusion, kind = 'workflow_run', slug = 'github-actions') => ({
  eventName: kind,
  repo: { owner: 'sydevs', repo: 'SahajCloud' },
  payload: {
    action: 'completed',
    [kind]: {
      head_sha: 'q1',
      head_branch: 'gh-readonly-queue/main/pr-959-2c2765ba',
      conclusion,
      pull_requests: [],
      ...(kind === 'workflow_run'
        ? { html_url: 'https://run' }
        : { app: slug ? { slug } : undefined, url: 'https://api.github.com/repos/sydevs/SahajCloud/check-suites/9' }),
    },
  },
})
// The queue path needs no API call: a lookup by sha would find no PR.
const noApi = new Proxy({}, { get: () => { throw new Error('no API call expected') } })
const logging = () => { const said = []; return { said, info: (m) => said.push(m) } }

test('a failed queue run targets the PR its branch names, and says what failed', async () => {
  const out = await resolve({ github: noApi, context: queueRun('failure'), config: {} })
  assert.deepEqual(out.map((t) => [t.number, t.reason, t.facts]), [[959, 'queue-failed', { app: 'github-actions', run: 'https://run' }]])
  const suite = await resolve({ github: noApi, context: queueRun('timed_out', 'check_suite'), config: {} })
  assert.deepEqual(suite.map((t) => [t.number, t.reason, t.facts]), [[959, 'queue-failed', { app: 'github-actions', run: 'https://api.github.com/repos/sydevs/SahajCloud/check-suites/9' }]])
})

test('a passing or cancelled queue run targets nothing', async () => {
  for (const c of ['success', 'cancelled', 'neutral']) assert.deepEqual(await resolve({ github: noApi, context: queueRun(c), config: {} }), [], c)
})

// SahajAtlasWeb#489: another app's suite failed on the queue branch while the
// queue's own Actions run was still going and about to pass. It is advisory on
// the PR head, so it is advisory here.
test("another app's failed suite on a queue branch targets nothing, and is logged", async () => {
  const core = logging()
  assert.deepEqual(await resolve({ github: noApi, context: queueRun('failure', 'check_suite', 'cloudflare-workers'), config: {}, core }), [])
  assert.match(core.said.join('\n'), /cloudflare-workers/)
  assert.deepEqual(await resolve({ github: noApi, context: queueRun('failure', 'check_suite', null), config: {} }), [], 'an app-less suite is not Actions either')
})

test('the resolve log line names the app and run behind a queue failure', () => {
  const queueFailed = { kind: 'pr', number: 959, reasons: [{ reason: 'queue-failed', facts: { app: 'github-actions', run: 'https://run' } }] }
  assert.equal(targetLabel(queueFailed), 'pr#959:queue-failed(github-actions https://run)')
  assert.equal(targetLabel({ kind: 'pr', number: 959, reasons: [{ reason: 'queue-failed', facts: {} }] }), 'pr#959:queue-failed')
  assert.equal(targetLabel(t(860, 'sweep-pr')), 'pr#860:sweep-pr', 'every other reason is named as it always was')
  assert.equal(targetLabel(coalesceTargets([t(860, 'sweep-pr'), t(860, 'sweep-orphan')])[0]), 'pr#860:sweep-pr+sweep-orphan')
})

// ---- a thin budget sheds the drift targets ------------------------------
// An event run's drift targets are nearly all of what it spends: each is a
// full `gather` in its own `act` leg, against the event's one. In a burst many
// runs in one repo pick the same drifted items, so the cheapest thing to give
// up under pressure is the part the cron covers anyway.
// (why: docs/why.md#a-rate-limited-call-waits-for-the-reset)

/** One repo holding one issue the board calls Done that nothing closes: drift. */
function repoWithDrift(remaining) {
  const info = []
  const gh = {
    rest: { rateLimit: { get: async () => ({ data: { resources: { core: { remaining } } } }) } },
    graphql: async (q) => (/pullRequests\(/.test(q)
      ? { repository: { pullRequests: { pageInfo: {}, nodes: [] } } }
      : { repository: { issues: { pageInfo: {}, nodes: [{
        number: 41,
        labels: { nodes: [] },
        projectItems: { nodes: [{ project: { number: config.projects.number }, fieldValueByName: { name: config.projects.status.done } }] },
      }] } } }),
  }
  return { gh, core: { info: (m) => info.push(m) }, info }
}

const opened = { eventName: 'issues', payload: { action: 'opened', issue: { number: 7 } }, repo: { owner: 'sydevs', repo: 'SahajCloud' } }

test('an event run under the REST floor returns only its own targets, and says so', async () => {
  const { gh, core, info } = repoWithDrift(500)
  const out = await resolve({ github: gh, context: opened, config, core })
  assert.deepEqual(out.map((t) => t.number), [7], 'the event itself, and nothing gathered beside it')
  assert.match(info.join(' '), /under the floor of 1000/, 'the shed is logged, not silent')
})

test('an event run with budget to spare still adds the drift targets', async () => {
  const { gh, core, info } = repoWithDrift(4000)
  const out = await resolve({ github: gh, context: opened, config, core })
  assert.deepEqual(out.map((t) => t.number), [7, 41], 'the reconciler runs as it always did')
  assert.deepEqual(info, [], 'and nothing was shed')
})

test('a budget that cannot be read sheds nothing', async () => {
  const { gh, core } = repoWithDrift(500)
  gh.rest.rateLimit.get = async () => { throw Object.assign(new Error('Bad Gateway'), { status: 502 }) }
  const out = await resolve({ github: gh, context: opened, config, core })
  assert.deepEqual(out.map((t) => t.number), [7, 41], 'an unreadable budget is not a thin one')
  // And neither is a reply that parsed but carried no core resource.
  const answered = repoWithDrift(undefined)
  assert.deepEqual((await resolve({ github: answered.gh, context: opened, config, core: answered.core })).map((t) => t.number), [7, 41])
})

test('the schedule never reads the budget, so the cron is unchanged', async () => {
  const { gh, core } = repoWithDrift(1)
  gh.rest.rateLimit.get = async () => { throw new Error('the cron must not ask') }
  gh.paginate = async () => []
  gh.rest.issues = { listForRepo: async () => ({ data: [] }) }
  gh.rest.pulls = { list: async () => ({ data: [] }) }
  const out = await resolve({ github: gh, context: { ...opened, eventName: 'schedule', payload: {} }, config, core })
  assert.ok(Array.isArray(out), 'the sweep runs its own way')
})

// ---- expired locks on an event run (why: docs/why.md#a-lease-past-its-deadline-is-reclaimed)

const now = new Date('2026-11-20T22:00:00Z')
const capped = (n) => ({ ...config, dispatch: { ...config.dispatch, reconcileMaxPerEvent: n } })

const comment = (number) => ({
  eventName: 'issue_comment',
  repo: { owner: repo.owner, repo: repo.name },
  payload: { action: 'created', issue: { number }, comment: { user: { login: 'Ardnived' }, body: '@sydevs-bot implement' } },
})

// Locked, and Working on the board, so the reconciler sees no drift here.
const lockedNode = (number, labels = [config.labels.lock]) => ({
  number,
  labels: { nodes: labels.map((name) => ({ name })) },
  projectItems: { nodes: [{ project: { number: config.projects.number }, fieldValueByName: { name: 'Working' } }] },
})

// Written by the dispatcher's own renderer, so the fake cannot drift from it.
const record = (deadline) => [{
  user: { login: config.identity.expectedLogin },
  body: renderRecord({ ...emptyRecord(), current: { handler: 'implement', attempt: 1, deadline } }),
}]

const world = (nodes, records) => ({
  rest: {
    issues: { listComments: ({ issue_number: n }) => ({ data: records[n] || [] }) },
    // Budget to spare, so the floor sheds nothing and these tests measure the
    // reclaim rather than the shed.
    rateLimit: { get: async () => ({ data: { resources: { core: { remaining: 5000 } } } }) },
  },
  graphql: async (q) => (q.includes('pullRequests(')
    ? { repository: { pullRequests: { pageInfo: { hasNextPage: false }, nodes: [] } } }
    : { repository: { issues: { pageInfo: { hasNextPage: false }, nodes } } }),
})

test('an event run reclaims a lock past its deadline, and leaves a live one alone', async () => {
  const out = await resolve({
    github: world([lockedNode(1), lockedNode(2), lockedNode(3)], { 1: record('2026-11-20T18:00:00Z'), 2: record('2026-11-20T17:26:00Z'), 3: record('2026-11-21T04:00:00Z') }),
    context: comment(1), config: capped(10), now,
  })
  assert.deepEqual(out.map((t) => [t.number, t.reason]), [[1, 'issue_comment'], [2, 'sweep-timeout']], 'its own item is never swept, and #3 is inside its deadline')
  assert.deepEqual(out[1].facts, { handler: 'implement', attempt: 1 })
  assert.equal(out[1].event, 'issue_comment.created', 'the record it fires names the event that found it')
})

test('a lock with no record is swept on an event run too, exactly as the cron does', async () => {
  const out = await resolve({ github: world([lockedNode(5)], {}), context: comment(1), config: capped(10), now })
  assert.deepEqual(out.map((t) => [t.number, t.reason]), [[1, 'issue_comment'], [5, 'sweep-timeout']])
  assert.deepEqual(out[1].facts, { reason: 'lock without a record' })
})

test('the reclaim and the drift share one cap', async () => {
  const records = Object.fromEntries([2, 3, 4].map((n) => [n, record('2026-11-20T17:26:00Z')]))
  // #5 carries no lock, so `Working` is a Status the board may not hold: a
  // drift target, and the only one either half of the cap can reach.
  const nodes = [lockedNode(2), lockedNode(3), lockedNode(4), lockedNode(5, [])]
  const out = await resolve({ github: world(nodes, records), context: comment(1), config: capped(2), now })
  assert.deepEqual(out.map((t) => [t.number, t.reason]), [[1, 'issue_comment'], [2, 'sweep-timeout'], [3, 'sweep-timeout']], 'two, and the cron takes the rest')
  const room = await resolve({ github: world(nodes, records), context: comment(1), config: capped(4), now })
  assert.deepEqual(room.map((t) => [t.number, t.reason]), [[1, 'issue_comment'], [2, 'sweep-timeout'], [3, 'sweep-timeout'], [4, 'sweep-timeout'], [5, 'reconcile']], 'the drift half takes what the reclaim leaves')
})

test('an item the reclaim took is not a drift target as well', async () => {
  // Off the board, so `driftTargets` reads it as drift: without the skip this
  // item is targeted twice, and gathered twice.
  const off = { ...lockedNode(2), projectItems: { nodes: [] } }
  const out = await resolve({ github: world([off], { 2: record('2026-11-20T17:26:00Z') }), context: comment(1), config: capped(10), now })
  assert.deepEqual(out.map((t) => [t.number, t.reason]), [[1, 'issue_comment'], [2, 'sweep-timeout']], 'reclaimed, not reconciled as well')
})

test('the cap bounds the record reads, not just the targets', async () => {
  // A live lock yields no target, so a cap on the output would let one event
  // run read every record in the repo.
  const many = Array.from({ length: 25 }, (_, k) => lockedNode(k + 2))
  const records = Object.fromEntries(many.map((n) => [n.number, record('2026-11-21T04:00:00Z')]))
  const github = world(many, records)
  const inner = github.rest.issues.listComments
  let reads = 0
  github.rest.issues.listComments = (args) => { reads += 1; return inner(args) }
  const out = await resolve({ github, context: comment(1), config: capped(3), now })
  assert.deepEqual(out.map((t) => t.reason), ['issue_comment'], 'every lock is live, so nothing is swept')
  assert.equal(reads, 3)
})

test('the journal is never swept, lock or no lock', async () => {
  const github = world([lockedNode(6, [config.labels.lock, config.labels.journal])], { 6: record('2026-11-20T17:26:00Z') })
  const out = await resolve({ github, context: comment(1), config: capped(10), now })
  assert.deepEqual(out.map((t) => t.reason), ['issue_comment'], 'the loop\'s own diary is not a worklist')
})

test('a cheap view that cannot answer reclaims nothing', async () => {
  const github = world([lockedNode(2)], { 2: record('2026-11-20T17:26:00Z') })
  github.graphql = async () => { throw new Error('502') }
  const out = await resolve({ github, context: comment(1), config: capped(10), now })
  assert.deepEqual(out.map((t) => t.reason), ['issue_comment'], 'the cron is the backstop')
})
