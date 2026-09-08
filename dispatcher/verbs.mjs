/**
 * The command grammar: `@sydevs-bot <verb> <free text>`.
 *
 * Case-insensitive on the mention and the verb. The first mention wins. The
 * free text after the verb never leaves this function — the dispatch record
 * carries a pointer to the comment, and the handler reads the comment from
 * GitHub. (why: docs/why.md#the-payload-is-a-pointer)
 */

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `{ mentioned, verb, raw }`.
 *
 * - not mentioned → `{ mentioned: false, verb: null, raw: null }`
 * - mentioned with a known verb → that verb
 * - mentioned with an unknown or absent verb → the default for the surface
 *   (`unknownIssue` or `unknownPr`), `raw` holding what was written, if anything
 */
export function parseVerb(body, config, surface) {
  const prefix = escapeRegExp(config?.commandPrefix || '@sydevs-bot')
  const re = new RegExp(`(?:^|[\\s(\\[])${prefix}\\b[\\s:,\\-—–]*([a-z][a-z-]*)?`, 'i')
  const m = re.exec(String(body || ''))
  if (!m) return { mentioned: false, verb: null, raw: null }

  const raw = m[1] ? m[1].toLowerCase() : null
  const known = surface === 'pr' ? config?.verbs?.pr || [] : config?.verbs?.issue || []
  const fallback = surface === 'pr' ? config?.verbs?.unknownPr || 'address' : config?.verbs?.unknownIssue || 'answer'
  return { mentioned: true, verb: raw && known.includes(raw) ? raw : fallback, raw }
}
