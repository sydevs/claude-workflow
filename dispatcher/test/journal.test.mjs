import test from 'node:test'
import assert from 'node:assert/strict'
import { tallyFrom, renderTally, titleFor, DONE_MARKER, ANOMALY_MARKER } from '../journal.mjs'

const done = (o) => `${DONE_MARKER}${JSON.stringify(o)} -->\n✅ did it`

test('the tally counts dispatches per handler, per repo and per item', () => {
  const t = tallyFrom([
    done({ id: 'a', handler: 'implement', repo: 'sydevs/SahajCloud', number: 1, failed: 0 }),
    done({ id: 'b', handler: 'address-review', repo: 'sydevs/SahajCloud', number: 2, failed: 1 }),
    done({ id: 'c', handler: 'address-review', repo: 'sydevs/SahajCloud', number: 2, failed: 0 }),
    done({ id: 'd', handler: 'answer', repo: 'sydevs/WeMeditateWeb', number: 9, failed: 0 }),
    `${ANOMALY_MARKER}{"kind":"429"} -->\n⚠️ 429`,
    'a human comment',
  ])
  assert.equal(t.dispatches, 4)
  assert.equal(t.failed, 1)
  assert.equal(t.anomalies, 1)
  assert.deepEqual(t.byHandler, { implement: 1, 'address-review': 2, answer: 1 })
  assert.deepEqual(t.byRepo, { SahajCloud: 3, WeMeditateWeb: 1 })
  assert.equal(t.byItem['sydevs/SahajCloud#2'], 2)
  const block = renderTally(t)
  assert.match(block, /^<!-- tally -->/)
  assert.match(block, /address-review 2 · implement 1 · answer 1/)
  assert.match(block, /Most sessions: sydevs\/SahajCloud#2 ×2/)
  assert.equal(titleFor('Mon', t), 'Mon — 4 dispatches · 1 failed · 1 anomaly')
})
