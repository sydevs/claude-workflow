/**
 * The command grammar: `@sydevs-bot <verb> <free text>`.
 *
 * Case-insensitive on the mention and the verb. The first mention wins. The
 * free text after the verb never leaves this file except as the parsed
 * arguments of `block` — the dispatch record carries a pointer to the
 * comment, and the handler reads the comment from GitHub.
 * (why: docs/why.md#the-payload-is-a-pointer)
 */

import { parseRefs } from './markers.mjs'

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mentionRe(config) {
  const prefix = escapeRegExp(config?.commandPrefix || '@sydevs-bot')
  return new RegExp(`(?:^|[\\s(\\[])${prefix}\\b[\\s:,\\-—–]*([a-z][a-z-]*)?([^\\n]*)`, 'i')
}

/**
 * `{ mentioned, verb, raw }`.
 *
 * - not mentioned → `{ mentioned: false, verb: null, raw: null }`
 * - mentioned with a known verb → that verb, after `verbs.aliases` for the
 *   surface (`review` and `revise` mean one thing on each surface)
 * - mentioned with an unknown or absent verb → the default for the surface
 *   (`unknownIssue` or `unknownPr`), `raw` holding what was written, if anything
 */
export function parseVerb(body, config, surface) {
  const m = mentionRe(config).exec(String(body || ''))
  if (!m) return { mentioned: false, verb: null, raw: null }

  const raw = m[1] ? m[1].toLowerCase() : null
  const known = surface === 'pr' ? config?.verbs?.pr || [] : config?.verbs?.issue || []
  const fallback = surface === 'pr' ? config?.verbs?.unknownPr || 'address' : config?.verbs?.unknownIssue || 'revise'
  const verb = raw && known.includes(raw) ? raw : fallback
  return { mentioned: true, verb: config?.verbs?.aliases?.[surface]?.[verb] || verb, raw }
}

/**
 * The arguments of `@sydevs-bot block …`, one of:
 *
 * - `{ form: 'on', refs }` — `block on sydevs/SahajCloud#632` (or a full issue URL)
 * - `{ form: 'reason', reason }` — `block until <reason>` or `block <reason>`;
 *   a session turns it into a relationship or a hold
 *
 * Only the rest of the verb's own line is read. A date after `until` is part
 * of the reason now: a date alone is `hold`. (why: docs/why.md#a-hold-is-a-date-not-a-recheck)
 */
export function parseBlock(body, config, org) {
  const m = mentionRe(config).exec(String(body || ''))
  const rest = (m?.[2] || '').trim()
  const on = /^on\s+(.+)$/i.exec(rest)
  if (on) return { form: 'on', refs: parseRefs(on[1], org) }
  return { form: 'reason', reason: rest.replace(/^until\b[\s:,\-—–]*/i, '').trim() }
}

const UNIT_DAYS = { day: 1, week: 7, month: 30 }

/**
 * The arguments of `@sydevs-bot hold …`, one of:
 *
 * - `{ form: 'default' }` — `hold` alone; the dispatcher picks the date
 * - `{ form: 'date', date }` — `hold until 2026-12-01`, `hold 3 weeks`, `hold until 2 months`
 * - `{ form: 'invalid', text }` — anything else after the verb
 *
 * A month is 30 days. `now` makes a relative hold a date.
 */
export function parseHold(body, config, now = new Date()) {
  const m = mentionRe(config).exec(String(body || ''))
  const rest = (m?.[2] || '').trim().replace(/^until\b[\s:,\-—–]*/i, '').trim()
  if (!rest) return { form: 'default' }
  const date = /^(\d{4}-\d{2}-\d{2})\b/.exec(rest)
  if (date && !Number.isNaN(Date.parse(`${date[1]}T00:00:00Z`))) return { form: 'date', date: date[1] }
  const rel = /^(\d{1,3})\s*(day|week|month)s?\b/i.exec(rest)
  if (rel) {
    const d = new Date(now.getTime() + Number(rel[1]) * UNIT_DAYS[rel[2].toLowerCase()] * 86_400_000)
    return { form: 'date', date: d.toISOString().slice(0, 10) }
  }
  return { form: 'invalid', text: rest.slice(0, 80) }
}
