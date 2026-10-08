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
 * - `{ form: 'until', date, reason }` — `block until 2026-11-15 — waiting on X`
 * - `{ form: 'on', refs }` — `block on sydevs/SahajCloud#632` (or a full issue URL)
 * - `{ form: 'reason', reason }` — anything else; a session picks the date
 *
 * Only the rest of the verb's own line is read.
 */
export function parseBlock(body, config, org) {
  const m = mentionRe(config).exec(String(body || ''))
  const rest = (m?.[2] || '').trim()
  const until = /^until\s+(\d{4}-\d{2}-\d{2})\b[\s:,\-—–]*(.*)$/i.exec(rest)
  if (until) return { form: 'until', date: until[1], reason: until[2].trim() }
  const on = /^on\s+(.+)$/i.exec(rest)
  if (on) return { form: 'on', refs: parseRefs(on[1], org) }
  return { form: 'reason', reason: rest }
}
