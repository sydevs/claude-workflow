// The journal tick: one step failing must not skip the next, and a day that
// rolled still gets a final true count.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { journalTick } from '../index.mjs'
import { previousDay, dayLabel, refreshTally, DONE_MARKER, ANOMALY_MARKER } from '../journal.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
const DAY_MARKER = '<!-- ops-journal:'
const done = (handler) => ({ body: `${DONE_MARKER}${JSON.stringify({ id: 'x', handler, repo: 'sydevs/SahajCloud', number: 1, failed: 0 })} -->\n✅` })
const anomaly = (kind) => ({ body: `${ANOMALY_MARKER}${JSON.stringify({ kind })} -->\n⚠️ **${kind}** · x` })

/**
 * A journal repo with two day issues: #134 for Monday 2026-09-28, frozen at a
 * stale title, and #135 for today. `now` sits inside today, so #134 is the day
 * that rolled. Monday's real counts are 37 dispatches and 4 anomalies.
 */
function journalRepo(over = {}) {
  const issues = {
    134: { number: 134, title: 'Mon — 22 dispatches · 0 failed · 1 anomaly', body: `${DAY_MARKER}2026-09-28 -->\nbody`, created_at: '2026-09-28T07:10:00Z', labels: [{ name: 'ops-journal' }] },
    135: { number: 135, title: 'Tue — 0 dispatches · 0 failed · 0 anomalies', body: `${DAY_MARKER}2026-09-29 -->\nbody`, created_at: '2026-09-29T07:05:00Z', labels: [{ name: 'ops-journal' }] },
  }
  const comments = {
    134: [...Array(37)].map(() => done('address-review')).concat([...Array(4)].map(() => anomaly('429'))),
    135: [done('implement')],
  }
  const calls = []
  const gh = {
    calls,
    rest: {
      issues: {
        listForRepo: async () => ({ data: Object.values(issues).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)) }),
        get: async ({ issue_number }) => ({ data: issues[issue_number] }),
        update: async (a) => { calls.push(['update', a.issue_number, a.title]); Object.assign(issues[a.issue_number], a); return { data: {} } },
        create: async () => { throw new Error('today already exists') },
        listComments: async ({ issue_number, page = 1 }) => ({ data: page === 1 ? (comments[issue_number] || []) : [] }),
        createComment: async (a) => { calls.push(['comment', a.issue_number, a.body]); (comments[a.issue_number] ||= []).push({ body: a.body }); return { data: {} } },
      },
    },
    ...over,
  }
  return { gh, issues, comments, calls }
}

const core = { info: () => {}, warning: () => {} }
// 2026-09-29T20:00Z is 13:00 in America/Vancouver, so today is Tue 2026-09-29.
const now = new Date('2026-09-29T20:00:00Z')

test('a throw in closeDuplicateDays does not stop the tally from running', async () => {
  const { gh, issues } = journalRepo()
  // `closeDuplicateDays` lists, finds two day issues for today, and fails to close.
  const realList = gh.rest.issues.listForRepo
  let listed = 0
  gh.rest.issues.listForRepo = async (a) => {
    listed += 1
    if (listed === 2) throw Object.assign(new Error('secondary rate limit'), { status: 403 })
    return realList(a)
  }
  await journalTick({ github: gh, core, config, now })
  assert.equal(issues[135].title, 'Tue — 1 dispatch · 0 failed · 0 anomalies', 'today was still counted')
})

test('a day that rolled gets a final true count, under its own weekday', async () => {
  const { gh, issues } = journalRepo()
  await journalTick({ github: gh, core, config, now })
  assert.equal(issues[134].title, 'Mon — 37 dispatches · 0 failed · 4 anomalies', 'Monday is recounted, and stays Monday')
  assert.match(issues[134].body, /<!-- tally -->\n\*\*Usage\.\*\* address-review 37/)
  assert.equal(issues[135].title, 'Tue — 1 dispatch · 0 failed · 0 anomalies')
})

test('a tally failure posts an anomaly to the day\'s journal issue', async () => {
  const { gh, comments } = journalRepo()
  gh.rest.issues.update = async () => { throw Object.assign(new Error('Resource not accessible by personal access token'), { status: 403 }) }
  await journalTick({ github: gh, core, config, now })
  const posted = comments[135].map((c) => c.body).filter((b) => b.startsWith(ANOMALY_MARKER))
  assert.equal(posted.length, 1, 'the failure is said once, where the day is')
  assert.match(posted[0], /journal-tally/)
  assert.match(posted[0], /Resource not accessible/, "in GitHub's own words")
})

test('a tick that finishes posts no anomaly', async () => {
  const { gh, comments } = journalRepo()
  await journalTick({ github: gh, core, config, now })
  assert.equal(comments[135].filter((c) => c.body.startsWith(ANOMALY_MARKER)).length, 0)
})

test('re-counting a day that is already right writes nothing', async () => {
  const { gh, calls } = journalRepo()
  await journalTick({ github: gh, core, config, now })
  const before = calls.filter((c) => c[0] === 'update').length
  await journalTick({ github: gh, core, config, now })
  assert.equal(calls.filter((c) => c[0] === 'update').length, before, 'the refresh is idempotent, so every tick may run it')
})

test('a missing yesterday is not a failure', async () => {
  const { gh, comments } = journalRepo()
  delete gh.rest.issues.get // only reached for an issue being refreshed
  gh.rest.issues.listForRepo = async () => ({ data: [] })
  await journalTick({ github: gh, core, config, now })
  assert.equal((comments[135] || []).filter((c) => c.body.startsWith(ANOMALY_MARKER)).length, 0)
})

test('the day before a day is a date, not a subtraction from the clock', () => {
  assert.equal(previousDay('2026-09-29'), '2026-09-28')
  assert.equal(previousDay('2026-10-01'), '2026-09-30')
  assert.equal(previousDay('2026-01-01'), '2025-12-31')
  // 2026-03-08 is the PDT switch in America/Vancouver, where a 24h subtraction drifts.
  assert.equal(previousDay('2026-03-09'), '2026-03-08')
  assert.equal(dayLabel('2026-09-28'), 'Mon')
  assert.equal(dayLabel('2026-10-01'), 'Thu')
})

test('refreshTally labels the title from the day it was given, not from now', async () => {
  const { gh, issues } = journalRepo()
  await refreshTally(gh, config, 134, now, 'Mon')
  assert.match(issues[134].title, /^Mon —/)
  await refreshTally(gh, config, 134, now)
  assert.match(issues[134].title, /^Tue —/, 'without a label the clock decides, which is only right for today')
})
