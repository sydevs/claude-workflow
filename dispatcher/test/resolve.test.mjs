// One target per repo#number, carrying every reason the pass found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coalesceTargets } from '../resolve.mjs'

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
