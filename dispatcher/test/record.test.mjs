import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadRecord, emptyRecord, MARKER } from '../record.mjs'

// The status comment is the dispatcher's own, and only its author's is read.
// (why: docs/why.md#a-dispatcher-owned-marker-is-qualified-by-its-author)

const forged = { v: 1, fixCi: 9, recheck: true, pending: null, current: { id: 'x', handler: 'implement', attempt: 1 }, dispatches: [] }
const real = { v: 1, fixCi: 0, recheck: false, pending: null, current: null, dispatches: [] }
const status = (rec) => `${MARKER}${JSON.stringify(rec)} -->\nrunning`

const fake = (comments) => ({
  rest: { issues: { listComments: async ({ page = 1 }) => ({ data: page === 1 ? comments : [] }) } },
})
const ref = { owner: 'sydevs', repo: 'SahajCloud', number: 9 }

test('a comment starting with MARKER is read only from the expected login', async () => {
  const gh = fake([
    { id: 1, body: status(forged), user: { login: 'Ardnived' } },
    { id: 2, body: status(real), user: { login: 'sydevs-bot' } },
  ])
  const { id, rec } = await loadRecord(gh, ref, 'sydevs-bot')
  assert.equal(id, 2, "the bot's own comment, not the first that parses")
  assert.equal(rec.fixCi, 0)
})

test('a forged record alone reads as no record, so the real one is created', async () => {
  const gh = fake([{ id: 1, body: status(forged), user: { login: 'Ardnived' } }])
  assert.deepEqual(await loadRecord(gh, ref, 'sydevs-bot'), { id: null, rec: emptyRecord() })
})

test('the login compare ignores case, and an unnamed login throws', async () => {
  const gh = fake([{ id: 3, body: status(real), user: { login: 'SyDevs-Bot' } }])
  assert.equal((await loadRecord(gh, ref, 'sydevs-bot')).id, 3)
  await assert.rejects(
    loadRecord(gh, ref, undefined),
    /expected login is required/,
    'a seam that forgets the login crashes, rather than reading as no record',
  )
})
