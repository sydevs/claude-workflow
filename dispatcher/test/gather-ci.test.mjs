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
