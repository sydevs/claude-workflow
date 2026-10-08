#!/usr/bin/env node

/**
 * Tonight's audit: which skill, and for `audit-code`, which family and angle.
 *
 * `auditCalendar` maps a UTC weekday to a skill. `monthly.<weekday>.<n>`
 * overrides the nth such weekday of the month (the 1st Saturday runs
 * `audit-contracts`). `auditAngles` gives `audit-code` one rotation per day
 * it runs, so a week always mixes risk, experience and hygiene.
 *
 * A rotation advances once per run of its own day, counted from
 * `auditCalendar.rotationEpoch`. An overridden day is not a run, so the 1st
 * Saturday does not skip a hygiene angle. Counting dates rather than reading
 * the journal means a missed night does not break the rotation.
 *
 * Usage:  node calendar.mjs [--date YYYY-MM-DD] [--config path]
 * stdout: { date, day, skill, override, family?, angle?, index?, of? }
 * Pure: it never fetches.
 */

import { loadLoopConfig, flag } from '../../lib/config.mjs'

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_MS = 86_400_000

const isoDay = (d) => d.toISOString().slice(0, 10)
const nthOfMonth = (d) => String(Math.ceil(d.getUTCDate() / 7))

function overrideFor(cal, d) {
  return cal.monthly?.[DAYS[d.getUTCDay()]]?.[nthOfMonth(d)] ?? null
}

export function tonight(config, date = new Date()) {
  const cal = config.auditCalendar || {}
  const d = new Date(`${isoDay(date)}T00:00:00Z`)
  const day = DAYS[d.getUTCDay()]
  const override = overrideFor(cal, d)
  const skill = override ?? cal[day] ?? null
  const out = { date: isoDay(d), day, skill, override: Boolean(override) }
  const rotation = config.auditAngles?.[day]
  if (skill !== 'audit-code' || override || !rotation?.angles?.length) return out

  let runs = 0
  const epoch = Date.parse(`${cal.rotationEpoch || '2026-01-01'}T00:00:00Z`)
  for (let t = epoch; t < d.getTime(); t += DAY_MS) {
    const past = new Date(t)
    if (DAYS[past.getUTCDay()] === day && !overrideFor(cal, past)) runs += 1
  }
  const index = runs % rotation.angles.length
  return { ...out, family: rotation.family, angle: rotation.angles[index], index, of: rotation.angles.length }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const argv = process.argv.slice(2)
  const when = flag(argv, 'date')
  const date = when ? new Date(`${when}T00:00:00Z`) : new Date()
  if (Number.isNaN(date.getTime())) {
    console.error(`calendar: --date "${when}" is not YYYY-MM-DD`)
    process.exit(1)
  }
  console.log(JSON.stringify(tonight(loadLoopConfig(flag(argv, 'config')), date), null, 2))
}
