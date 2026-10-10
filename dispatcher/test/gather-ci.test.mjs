import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gather } from '../gather.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
const bot = { login: config.identity.expectedLogin }

// Verbatim from sydevs/SahajCloud#742 on 2026-09-09: the product's own CI
// passed, and every "failure" was one of the dispatcher's own matrix legs,
// cancelled by cancel-in-progress. The exact-match ignore list never saw them.
const CHECKS = [
  { name: 'Lint, Test & Smoke', status: 'completed', conclusion: 'success' },
  { name: 'dispatch / act (sydevs, SahajCloud, sydevs/SahajCloud, pr, 742, review, x)', status: 'completed', conclusion: 'cancelled' },
  { name: 'dispatch / act (sydevs, SahajCloud, sydevs/SahajCloud, pr, 742, issue_comment, x)', status: 'completed', conclusion: 'cancelled' },
  { name: 'dispatch / act (sydevs, SahajCloud, sydevs/SahajCloud, pr, 742, unlock, x)', status: 'completed', conclusion: 'success' },
  { name: 'dispatch / resolve', status: 'completed', conclusion: 'success' },
  { name: 'dispatch / journal', status: 'completed', conclusion: 'skipped' },
  { name: 'legacy', status: 'completed', conclusion: 'skipped' },
]

function fake() {
  const pr = { number: 742, node_id: 'PR', state: 'open', draft: true, merged: false, user: bot, head: { ref: 'claude/x', sha: 'abc' }, base: { ref: 'main' }, mergeable: true, mergeable_state: 'clean', changed_files: 3, additions: 40, deletions: 2, requested_reviewers: [] }
  return {
    rest: {
      issues: { get: async () => ({ data: { number: 742, node_id: 'PR', state: 'open', title: 't', body: '', labels: [], user: bot, pull_request: {}, html_url: 'u', comments: 0 } }), listComments: async () => ({ data: [] }) },
      pulls: { get: async () => ({ data: pr }), listReviews: async () => ({ data: [] }), listReviewComments: async () => ({ data: [] }), list: async () => ({ data: [] }) },
      checks: { listForRef: async () => ({ data: { check_runs: CHECKS } }) },
      repos: { getCombinedStatusForRef: async () => ({ data: { statuses: [], state: 'pending' } }) },
    },
    graphql: async () => ({ repository: { pullRequest: { closingIssuesReferences: { nodes: [] }, reviewThreads: { nodes: [] } } } }),
    paginate: async (fn, args) => (await fn(args)).data,
  }
}

test("the dispatcher's own matrix legs are not CI, however GitHub names them", async () => {
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'pr', number: 742, reason: 'ci', facts: { sha: 'abc' } }
  const s = await gather(fake(), target, config, { now: new Date('2026-09-09T17:00:00Z') })
  assert.deepEqual(s.ci.failing, [], `nothing is failing, got: ${s.ci.failing.join(', ')}`)
  assert.equal(s.ci.green, true, s.ci.reason)
})

// ---- only required checks are CI (why: docs/why.md#only-required-checks-are-ci)

function withRules(checks, { statuses = [], required = null } = {}) {
  const gh = fake()
  gh.rest.checks.listForRef = async () => ({ data: { check_runs: checks } })
  gh.rest.repos.getCombinedStatusForRef = async () => ({ data: { statuses, state: 'pending' } })
  gh.request = async (route) => {
    if (!route.includes('/rules/branches/')) throw new Error(`unexpected ${route}`)
    if (required === 'throw') throw Object.assign(new Error('Not Found'), { status: 404 })
    return { data: required ? [{ type: 'pull_request' }, { type: 'required_status_checks', parameters: { required_status_checks: required.map((context) => ({ context })) } }] : [{ type: 'pull_request' }] }
  }
  return gh
}
const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'pr', number: 742, reason: 'ci', facts: { sha: 'abc' } }
const when = { now: new Date('2026-10-09T17:00:00Z') }

test('a red Railway status the ruleset does not require is advisory, not failing', async () => {
  const gh = withRules([{ id: 1, name: 'Lint, Test & Smoke', status: 'completed', conclusion: 'success' }], {
    statuses: [{ context: 'sahajcloud - SahajCloud', state: 'failure' }],
    required: ['Lint, Test & Smoke'],
  })
  const s = await gather(gh, target, config, when)
  assert.equal(s.ci.green, true, s.ci.reason)
  assert.deepEqual(s.ci.advisory, ['sahajcloud - SahajCloud'])
})

test('a cancelled duplicate run is superseded by the newer run of that name', async () => {
  // WeMeditateWeb#144: two CI runs on one head; cancel-in-progress cancelled the older.
  const gh = withRules([
    { id: 10, name: 'Smoke (web)', status: 'completed', conclusion: 'cancelled' },
    { id: 12, name: 'Smoke (web)', status: 'completed', conclusion: 'success' },
  ], { required: ['Smoke (web)'] })
  const s = await gather(gh, target, config, when)
  assert.equal(s.ci.green, true, s.ci.reason)
})

test('a required check that has not reported yet keeps the PR waiting', async () => {
  const gh = withRules([{ id: 1, name: 'Lint, Typecheck & Unit', status: 'completed', conclusion: 'success' }], { required: ['Lint, Typecheck & Unit', 'Smoke (web)'] })
  const s = await gather(gh, target, config, when)
  assert.equal(s.ci.green, false)
  assert.deepEqual(s.ci.running.map((c) => c.name), ['Smoke (web)'])
})

test('a red required check still fails, whatever else is green', async () => {
  const gh = withRules([
    { id: 1, name: 'Lint, Test & Smoke', status: 'completed', conclusion: 'failure' },
    { id: 2, name: 'Cloudflare Pages: sahajatlas', status: 'completed', conclusion: 'success' },
  ], { required: ['Lint, Test & Smoke'] })
  const s = await gather(gh, target, config, when)
  assert.deepEqual(s.ci.failing.map((c) => c.name), ['Lint, Test & Smoke'])
})

test('an unreadable or empty ruleset counts every check, as before', async () => {
  for (const required of ['throw', null]) {
    const gh = withRules([
      { id: 1, name: 'Lint, Test & Smoke', status: 'completed', conclusion: 'success' },
      { id: 2, name: 'Cloudflare Pages: sahajatlas', status: 'completed', conclusion: 'failure' },
    ], { required })
    const s = await gather(gh, target, config, when)
    assert.equal(s.ci.green, false, `required=${required}`)
    assert.deepEqual(s.ci.advisory, [])
  }
})
