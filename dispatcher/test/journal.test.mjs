import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { tallyFrom, renderTally, titleFor, ensureJournalDay, postAnomaly, anomalyLine, refreshTally, DONE_MARKER, ANOMALY_MARKER } from '../journal.mjs'

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

/** A journal issue whose comments are an array, so a test can post and read back. */
function journalWith(posted) {
  return {
    rest: {
      issues: {
        listComments: async ({ page = 1 }) => ({ data: page === 1 ? posted : [] }),
        createComment: async ({ body }) => { posted.push({ body }); return { data: {} } },
      },
    },
  }
}

test('an anomaly says itself once a day, and a changed reason is a new line', async () => {
  const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
  const posted = []
  const gh = journalWith(posted)
  const capped = (reason) => ({ kind: 'ci-capped', text: `sydevs/SahajCloud#754 CI capped: ${reason}` })

  assert.equal(await postAnomaly(gh, config, 7, capped('failing: Lint')), true, 'the first pass reports it')
  assert.equal(await postAnomaly(gh, config, 7, capped('failing: Lint')), false, 'the next sweep says nothing')
  // The dispatch id varies between passes; the fact does not.
  assert.equal(await postAnomaly(gh, config, 7, { ...capped('failing: Lint'), id: 'SahajCloud-754-fix-ci-20260910T144856Z' }), false)
  assert.equal(posted.length, 1, 'one comment for one standing condition')

  assert.equal(await postAnomaly(gh, config, 7, capped('failing: Lint, Smoke')), true, 'a changed reason is a new fact')
  assert.equal(await postAnomaly(gh, config, 7, { kind: 'orphan', text: 'sydevs/SahajCloud#754 orphaned draft' }), true, 'a different kind is a new fact')
  assert.equal(posted.length, 3)

  // The day's count is now distinct conditions, which is what the title claims.
  assert.equal(tallyFrom(posted.map((c) => c.body)).anomalies, 3)
})

test('a listing we cannot read must not silence the anomaly', async () => {
  const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
  const posted = []
  const gh = {
    rest: {
      issues: {
        listComments: async () => { throw new Error('502') },
        createComment: async ({ body }) => { posted.push({ body }); return { data: {} } },
      },
    },
  }
  assert.equal(await postAnomaly(gh, config, 7, { kind: '429', text: 'sydevs/SahajCloud#754 implement attempt 2: rate limited' }), true)
  assert.equal(posted.length, 1)
})

test('anomalyLine reads the visible line, and refuses anything else', () => {
  assert.equal(anomalyLine(`${ANOMALY_MARKER}{"kind":"orphan","id":null} -->\n⚠️ **orphan** · x#1 orphaned draft`), '⚠️ **orphan** · x#1 orphaned draft')
  assert.equal(anomalyLine(`${DONE_MARKER}{"handler":"implement"} -->\n📦 built`), null)
  assert.equal(anomalyLine('a human comment'), null)
  assert.equal(anomalyLine(undefined), null)
})
