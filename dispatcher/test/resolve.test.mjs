// One target per repo#number, carrying every reason the pass found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { coalesceTargets, queuedPr, resolve } from '../resolve.mjs'

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

const queueRun = (conclusion, kind = 'workflow_run') => ({
  eventName: kind,
  repo: { owner: 'sydevs', repo: 'SahajCloud' },
  payload: { action: 'completed', [kind]: { head_sha: 'q1', head_branch: 'gh-readonly-queue/main/pr-959-2c2765ba', conclusion, pull_requests: [], html_url: kind === 'workflow_run' ? 'https://run' : undefined } },
})
// The queue path needs no API call: a lookup by sha would find no PR.
const noApi = new Proxy({}, { get: () => { throw new Error('no API call expected') } })

test('a failed queue run targets the PR its branch names', async () => {
  const out = await resolve({ github: noApi, context: queueRun('failure'), config: {} })
  assert.deepEqual(out.map((t) => [t.number, t.reason, t.facts]), [[959, 'queue-failed', { run: 'https://run' }]])
  const suite = await resolve({ github: noApi, context: queueRun('timed_out', 'check_suite'), config: {} })
  assert.deepEqual(suite.map((t) => [t.number, t.reason]), [[959, 'queue-failed']])
})

test('a passing or cancelled queue run targets nothing', async () => {
  for (const c of ['success', 'cancelled', 'neutral']) assert.deepEqual(await resolve({ github: noApi, context: queueRun(c), config: {} }), [], c)
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
