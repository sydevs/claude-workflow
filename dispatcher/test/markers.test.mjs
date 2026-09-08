import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBlockedBy, parseRecheck, parseSentry, datePassed } from '../markers.mjs'

const body = `## Summary
x

## Notes
Blocked by: https://github.com/sydevs/SahajCloud/issues/632 — the endpoint does not exist yet
Blocked by: https://github.com/sydevs/SahajAtlasWeb/issues/12 and https://github.com/sydevs/SahajCloud/issues/7
~~Blocked by: https://github.com/sydevs/SahajCloud/issues/1 — old~~ — cleared 2026-09-01
Blocked by: https://github.com/other-org/repo/issues/9
Blocked by: https://github.com/sydevs/SahajCloud/pull/99
Re-check: 2026-10-01
Sentry: https://sy-developers.sentry.io/issues/123 (id: 123)
`

test('live in-org issue blockers are parsed; struck, foreign and PR lines are not', () => {
  assert.deepEqual(parseBlockedBy(body, 'sydevs'), [
    { owner: 'sydevs', repo: 'SahajCloud', number: 632 },
    { owner: 'sydevs', repo: 'SahajAtlasWeb', number: 12 },
    { owner: 'sydevs', repo: 'SahajCloud', number: 7 },
  ])
})

test('re-check and sentry lines', () => {
  assert.equal(parseRecheck(body), '2026-10-01')
  assert.deepEqual(parseSentry(body), { url: 'https://sy-developers.sentry.io/issues/123', id: '123' })
  assert.equal(parseRecheck('no markers'), null)
  assert.equal(parseSentry('no markers'), null)
})

test('datePassed compares ISO dates', () => {
  assert.equal(datePassed('2026-09-01', new Date('2026-09-08T00:00:00Z')), true)
  assert.equal(datePassed('2026-09-08', new Date('2026-09-08T12:00:00Z')), false)
  assert.equal(datePassed(null), false)
})
