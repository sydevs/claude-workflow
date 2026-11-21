// A GitHub 5xx is retried, never fatal. (why: docs/why.md#a-github-5xx-is-retried-not-fatal)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { withRetry, installRetry, retriable, rateLimitWait, apiCountLine } from '../retry.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))

test('a 5xx or a dropped connection is retried with backoff; a 4xx is an answer', async () => {
  const waits = []
  let calls = 0
  const flaky = async () => { calls += 1; if (calls < 3) { const e = new Error('Service Unavailable'); e.status = 503; throw e } return 'ok' }
  assert.equal(await withRetry(flaky, { attempts: 3, baseMs: 100, sleep: async (ms) => waits.push(ms) }), 'ok')
  assert.deepEqual(waits, [100, 200])
  let four = 0
  await assert.rejects(withRetry(async () => { four += 1; const e = new Error('Validation Failed'); e.status = 422; throw e }, { sleep: async () => {} }))
  assert.equal(four, 1, 'a 422 is not tried again')
  assert.ok(retriable(new Error('socket hang up')))
  assert.ok(!retriable(Object.assign(new Error('Not Found'), { status: 404 })))
})

test('installRetry wraps the request hook once', async () => {
  let wrapped = 0
  const github = { hook: { wrap: (name, fn) => { wrapped += 1; github.fn = fn } } }
  installRetry(github, config)
  installRetry(github, config)
  assert.equal(wrapped, 1)
  let n = 0
  const out = await github.fn(async () => { n += 1; if (n === 1) throw Object.assign(new Error('Bad Gateway'), { status: 502 }); return 'done' }, {})
  assert.equal(out, 'done')
})


// ---- a rate limit is the one 4xx that is weather -----------------------
// The budget comes back at a time the response states, so the call waits for
// it. Every dispatcher run from 23:00Z to the 23:10Z reset on 2026-11-20
// failed instead, one of them stranding a lease on sydevs/WeMeditateWeb#326.
// (why: docs/why.md#a-rate-limited-call-waits-for-the-reset)

const NOW = Date.parse('2026-11-20T23:00:00Z')
const limited = (status, headers, message = 'API rate limit exceeded for user ID 322523691') =>
  Object.assign(new Error(message), { status, response: { headers } })
const resetIn = (seconds) => ({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + seconds) })
const opts = (waits) => ({ attempts: 3, baseMs: 100, rateLimitMaxWaitMs: 900_000, sleep: async (ms) => waits.push(ms), now: () => NOW })

test('a primary rate limit waits for the reset, and only while the reset is near', async () => {
  const waits = []
  let calls = 0
  const out = await withRetry(async () => {
    calls += 1
    if (calls === 1) throw limited(403, resetIn(30))
    return 'ok'
  }, opts(waits))
  assert.equal(out, 'ok')
  assert.deepEqual(waits, [30_000], 'one wait, as long as the reset says')

  // The outage reset ten minutes after it began. Two hours is not that, and
  // waiting it out would hold the runner for nothing.
  waits.length = 0
  let far = 0
  await assert.rejects(
    withRetry(async () => { far += 1; throw limited(403, resetIn(7200)) }, opts(waits)),
    /rate limit/,
  )
  assert.equal(far, 1, 'thrown on the first answer')
  assert.deepEqual(waits, [], 'and nothing waited')
})

test('a secondary rate limit waits retry-after; a 403 with neither header is a refusal', async () => {
  const waits = []
  let calls = 0
  assert.equal(await withRetry(async () => {
    calls += 1
    if (calls === 1) throw limited(429, { 'retry-after': '5' })
    return 'ok'
  }, opts(waits)), 'ok')
  assert.deepEqual(waits, [5000])

  waits.length = 0
  let refused = 0
  await assert.rejects(
    withRetry(async () => { refused += 1; throw limited(403, { 'x-accepted-oauth-scopes': 'repo' }, 'Resource not accessible by integration') }, opts(waits)),
    /not accessible/,
  )
  assert.equal(refused, 1, 'a permission refusal is an answer no wait fixes')
  assert.deepEqual(waits, [])
  assert.equal(rateLimitWait(Object.assign(new Error('Not Found'), { status: 404 }), NOW), null)
})

test('installRetry takes the wait cap from loop-config.json', async () => {
  const waits = []
  const github = { hook: { wrap: (name, fn) => { github.fn = fn } } }
  installRetry(github, config, { sleep: async (ms) => waits.push(ms), now: () => NOW })
  let n = 0
  await github.fn(async () => { n += 1; if (n === 1) throw limited(403, resetIn(840)); return 'ok' }, { url: '/x' })
  assert.deepEqual(waits, [840_000], '14 minutes is inside dispatch.githubRetry.rateLimitMaxWaitSeconds')
  await assert.rejects(github.fn(async () => { throw limited(403, resetIn(960)) }, { url: '/x' }), /rate limit/)
  assert.deepEqual(waits, [840_000], '16 minutes is not, so nothing more waited')
})

test('the cap bounds one request\'s waits in total, not each of them', async () => {
  // `attempts` would otherwise allow two full waits, so a request could sleep
  // twice the number every job's timeout-minutes clears, and be killed
  // mid-wait — the failure the wait exists to end.
  const waits = []
  let calls = 0
  await assert.rejects(withRetry(async () => {
    calls += 1
    throw limited(403, resetIn(600))
  }, { attempts: 5, baseMs: 100, rateLimitMaxWaitMs: 900_000, sleep: async (ms) => waits.push(ms), now: () => NOW }), /rate limit/)
  assert.deepEqual(waits, [600_000], 'the second 10-minute wait does not fit in what is left of 15')
  assert.equal(calls, 2, 'tried once, waited once, tried again, then gave up')
})

test('installRetry counts every request it sends, REST and GraphQL apart', async () => {
  const github = { hook: { wrap: (name, fn) => { github.fn = fn } } }
  installRetry(github, config, { sleep: async () => {} })
  await github.fn(async () => 'ok', { url: '/repos/{owner}/{repo}/issues/{issue_number}' })
  await github.fn(async () => 'ok', { url: '/graphql', method: 'POST' })
  let n = 0
  await github.fn(async () => { n += 1; if (n === 1) throw Object.assign(new Error('Bad Gateway'), { status: 502 }); return 'ok' }, { url: '/rate_limit' })
  assert.equal(apiCountLine(github), 'api: 3 REST, 1 GraphQL', 'the retry sent a second request, and spent a second call')
  assert.equal(apiCountLine({}), 'api: 0 REST, 0 GraphQL', 'a client with no hook spent nothing')
})
