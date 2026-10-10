import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tonight } from '../../workflow/skills/run-audit/calendar.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
const on = (d) => tonight(config, new Date(`${d}T08:00:00Z`))

test('each weekday names its audit, and audit-code is spaced Tue/Thu/Sat', () => {
  // The week of 2026-10-12: Mon … Sun.
  const week = ['12', '13', '14', '15', '16', '17', '18'].map((n) => on(`2026-10-${n}`).skill)
  assert.deepEqual(week, ['audit-contracts', 'audit-code', 'audit-sentry', 'audit-code', 'cut-release', 'audit-code', 'improve-loop'])
})

test('Mondays alternate audit-deps and audit-contracts, from the epoch', () => {
  const mondays = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'].map((d) => on(d).skill)
  assert.deepEqual(mondays, ['audit-deps', 'audit-contracts', 'audit-deps', 'audit-contracts', 'audit-deps'])
})

test('a monthly override still wins, and does not use up a turn', () => {
  const cfg = { ...config, auditCalendar: { ...config.auditCalendar, monthly: { saturday: { 1: 'audit-contracts' } } } }
  const at = (d) => tonight(cfg, new Date(`${d}T08:00:00Z`))
  const first = at('2026-11-07')
  assert.equal(first.skill, 'audit-contracts')
  assert.equal(first.override, true)
  assert.equal(first.angle, undefined)
  // The Saturdays either side are consecutive hygiene angles: the override did not use one up.
  assert.equal(at('2026-11-14').index, (at('2026-10-31').index + 1) % at('2026-10-31').of)
})

test('each day keeps its own rotation and family', () => {
  const tue = [on('2026-10-06'), on('2026-10-13'), on('2026-10-20'), on('2026-10-27'), on('2026-11-03')]
  assert.deepEqual(tue.map((r) => r.family), Array(5).fill('risk'))
  assert.deepEqual(tue.map((r) => r.index), [0, 1, 2, 3, 0], 'four risk angles, then round again')
  assert.equal(on('2026-10-08').family, 'experience')
  assert.equal(on('2026-10-10').family, 'hygiene')
})
