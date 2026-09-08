import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { tallyFrom, renderTally, titleFor, ensureJournalDay, postAnomaly, refreshTally, DONE_MARKER, ANOMALY_MARKER } from '../journal.mjs'

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

test('a journal issue that cannot be created returns 0, and never throws', async () => {
  const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
  const gh = {
    rest: {
      issues: {
        listForRepo: async () => ({ data: [] }),
        create: async () => { const e = new Error('Resource not accessible by personal access token'); e.status = 403; throw e },
      },
    },
  }
  const r = await ensureJournalDay(gh, config, new Date('2026-09-08T22:00:00Z'))
  assert.equal(r.number, 0)
  assert.match(r.failed, /cannot create today's journal issue/)
  assert.equal(await postAnomaly(gh, config, 0, { kind: 'x', text: 'y' }), false, 'no issue, no anomaly, no throw')
  assert.equal(await refreshTally(gh, config, 0), null)
})
