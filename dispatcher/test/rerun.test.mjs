import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../apply.mjs'

// An infrastructure failure is re-run with the calling repo's own token.
// (why: docs/why.md#an-infrastructure-failure-is-re-run-not-repaired)

const config = { labels: { lock: 'bot:working' }, ceilings: { ciInfraReruns: 2 }, identity: { expectedLogin: 'sydevs-bot' } }
const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'pr', number: 5, reason: 'ci' }
const core = { info() {} }

function world() {
  const saved = []
  const gh = { rest: { issues: { updateComment: async (a) => saved.push(a), createComment: async (a) => { saved.push(a); return { data: { id: 99 } } } } } }
  return { gh, saved }
}

test('rerunJobs re-runs each failed job with ACTIONS_TOKEN and counts the attempt on its head', async () => {
  const { gh, saved } = world()
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201 } }
  const snapshot = { record: { fixCi: 0, ciReruns: { sha: 'abc', count: 1 } }, recordId: 7, item: { labels: [] }, pr: {} }
  await apply({ gh, target, snapshot, plan: [{ type: 'rerunJobs', sha: 'abc', checks: [{ name: 'Smoke', jobId: 20 }] }], config, env: { ACTIONS_TOKEN: 't0k' }, dryRun: false, core, fetchImpl })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.github.com/repos/sydevs/SahajCloud/actions/jobs/20/rerun')
  assert.equal(calls[0].init.headers.authorization, 'Bearer t0k')
  assert.deepEqual(snapshot.record.ciReruns, { sha: 'abc', count: 2 })
  assert.match(saved[0].body, /"ciReruns":\{"sha":"abc","count":2\}/)
})

test('a refused re-run still counts, so a missing actions grant ends at a person', async () => {
  const { gh } = world()
  const snapshot = { record: { fixCi: 0 }, recordId: 7, item: { labels: [] }, pr: {} }
  await apply({ gh, target, snapshot, plan: [{ type: 'rerunJobs', sha: 'f00d', checks: [{ name: 'Smoke', jobId: 20 }] }], config, env: { ACTIONS_TOKEN: 't0k' }, dryRun: false, core, fetchImpl: async () => ({ ok: false, status: 403 }) })
  assert.deepEqual(snapshot.record.ciReruns, { sha: 'f00d', count: 1 })
})

test('without ACTIONS_TOKEN nothing is called, and the attempt still counts', async () => {
  const { gh } = world()
  let called = false
  const snapshot = { record: { fixCi: 0 }, recordId: 7, item: { labels: [] }, pr: {} }
  await apply({ gh, target, snapshot, plan: [{ type: 'rerunJobs', sha: 'f00d', checks: [{ name: 'Smoke', jobId: 20 }] }], config, env: {}, dryRun: false, core, fetchImpl: async () => { called = true; return { ok: true } } })
  assert.equal(called, false)
  assert.equal(snapshot.record.ciReruns.count, 1)
})
