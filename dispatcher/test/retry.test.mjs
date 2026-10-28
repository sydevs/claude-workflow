// A GitHub 5xx is retried, never fatal. (why: docs/why.md#a-github-5xx-is-retried-not-fatal)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { withRetry, installRetry, retriable } from '../retry.mjs'

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

