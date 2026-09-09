import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ensureJournalDay, closeDuplicateDays } from '../journal.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
const NOW = new Date('2026-09-09T14:03:46Z') // 07:03 in America/Vancouver

function fake(issues, { failCreate = false } = {}) {
  const calls = []
  let next = 100
  const gh = {
    rest: {
      issues: {
        listForRepo: async () => ({ data: issues.filter((i) => i.state !== 'closed') }),
        create: async (a) => {
          calls.push(['create', a.title])
          if (failCreate) { const e = new Error('nope'); e.status = 403; throw e }
          const i = { number: next++, body: a.body, created_at: NOW.toISOString(), state: 'open' }
          issues.push(i)
          return { data: i }
        },
        update: async (a) => { calls.push(['update', a.issue_number, a.state || 'body']); const i = issues.find((x) => x.number === a.issue_number); if (i && a.state) i.state = a.state; if (i && a.body) i.body = a.body; return { data: {} } },
        createComment: async (a) => { calls.push(['comment', a.issue_number]); return { data: {} } },
      },
    },
  }
  return { gh, calls, issues }
}

test("the survey's own journal issue is adopted, not duplicated, and gets the day marker", async () => {
  // What actually happened on 2026-09-09: survey-routine wrote #77 at 08:16 with
  // the old title and no day marker, and the dispatcher made a second one.
  const survey = { number: 77, body: '**1 run today.** Last: 2026-09-09T08:21Z', created_at: '2026-09-09T08:16:50Z', state: 'open' }
  const { gh, calls, issues } = fake([survey])
  const r = await ensureJournalDay(gh, config, NOW)
  assert.equal(r.number, 77)
  assert.equal(r.created, false)
  assert.ok(!calls.some((c) => c[0] === 'create'), 'no second issue for the day')
  assert.match(issues[0].body, /^<!-- ops-journal:2026-09-09 -->/, 'adopted issues get the marker')
})

test('a create that loses the race closes its own issue and returns the older one', async () => {
  const { gh, calls, issues } = fake([])
  // Another job creates an older issue while ours is in flight.
  const orig = gh.rest.issues.create
  gh.rest.issues.create = async (a) => {
    issues.push({ number: 55, body: '<!-- ops-journal:2026-09-09 -->', created_at: '2026-09-09T14:03:40Z', state: 'open' })
    return orig(a)
  }
  const r = await ensureJournalDay(gh, config, NOW)
  assert.equal(r.number, 55, 'the oldest issue for the day wins')
  assert.equal(r.created, false)
  assert.ok(calls.some((c) => c[0] === 'update' && c[2] === 'closed'), 'its own duplicate is closed')
})

test('the day with one issue creates nothing and closes nothing', async () => {
  const only = { number: 90, body: '<!-- ops-journal:2026-09-09 -->', created_at: '2026-09-09T09:00:00Z', state: 'open' }
  const { gh, calls } = fake([only])
  assert.equal((await ensureJournalDay(gh, config, NOW)).number, 90)
  assert.deepEqual(await closeDuplicateDays(gh, config, NOW), [])
  assert.ok(!calls.some((c) => c[0] === 'create'))
})

test('the scheduled sweep closes every extra day issue, keeping the oldest', async () => {
  const issues = [
    { number: 77, body: 'no marker', created_at: '2026-09-09T08:16:50Z', state: 'open' },
    { number: 78, body: '<!-- ops-journal:2026-09-09 -->', created_at: '2026-09-09T14:03:49Z', state: 'open' },
    { number: 79, body: '<!-- ops-journal:2026-09-09 -->', created_at: '2026-09-09T15:00:00Z', state: 'open' },
    { number: 60, body: 'yesterday', created_at: '2026-09-08T09:00:00Z', state: 'open' },
  ]
  const { gh } = fake(issues)
  assert.deepEqual(await closeDuplicateDays(gh, config, NOW), [78, 79])
  assert.equal(issues.find((i) => i.number === 60).state, 'open', "another day's journal is left alone")
})

test('a journal that cannot be created still returns 0 and never throws', async () => {
  const { gh } = fake([], { failCreate: true })
  const r = await ensureJournalDay(gh, config, NOW)
  assert.equal(r.number, 0)
  assert.match(r.failed, /cannot create/)
})
