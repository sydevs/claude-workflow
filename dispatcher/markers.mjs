/**
 * The body lines the loop writes and Actions reads.
 *
 * A cloud session cannot write a native issue relationship, so the survey
 * and `split-ticket` write `Blocked by: <url>` into `## Notes`, and the
 * dispatcher turns the line into a relationship. `Re-check: <date>` parks a
 * ticket until a date. `Sentry: <url> (id: <n>)` names the Sentry issue a
 * merge resolves. All three formats come from `triage-issue/SKILL.md`.
 */

const STRUCK = /^~~/

function lines(body) {
  return String(body || '').split(/\r?\n/).map((l) => l.trim())
}

/** Leading markdown emphasis and list bullets, which a human writes and a parser should not see. */
const LEAD = /^(?:[-*+]\s+)?[*_~`]*/

/**
 * In-org issues named by live `Blocked by` lines. A struck-through line
 * (`~~Blocked by: …~~`) is a cleared blocker and is skipped.
 *
 * **The reader matches the words, not the punctuation.** The loop writes
 * `Blocked by: <url>` exactly, but people write `**Blocked by sydevs/X#9.**`,
 * and a reader that misses that concludes there is no blocker. A false
 * positive skips a ticket and says why. A false negative writes code against
 * a contract that does not exist.
 * (why: docs/why.md#the-marker-reader-matches-words-not-punctuation)
 *
 * Both spellings of a target are accepted: a full in-org issue URL, and
 * `owner/repo#N`. A bare `#N` is not — it would resolve against whichever
 * repository rendered it. PR URLs are ignored.
 */
export function parseBlockedBy(body, org, marker = 'Blocked by') {
  const out = []
  const words = String(marker).replace(/:\s*$/, '').toLowerCase()
  const urlRe = new RegExp(`https://github\\.com/${org}/([A-Za-z0-9_.-]+)/issues/(\\d+)`, 'g')
  const shortRe = new RegExp(`\\b${org}/([A-Za-z0-9_.-]+)#(\\d+)\\b`, 'g')
  const seen = new Set()
  for (const l of lines(body)) {
    if (STRUCK.test(l)) continue
    const bare = l.replace(LEAD, '')
    if (!bare.toLowerCase().startsWith(words)) continue
    for (const re of [urlRe, shortRe]) {
      for (const m of bare.matchAll(re)) {
        const key = `${m[1]}#${m[2]}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ owner: org, repo: m[1], number: Number(m[2]) })
      }
    }
  }
  return out
}

/** The `Re-check: YYYY-MM-DD` date, or null. The first live line wins. */
export function parseRecheck(body, marker = 'Re-check:') {
  for (const l of lines(body)) {
    if (STRUCK.test(l) || !l.toLowerCase().startsWith(marker.toLowerCase())) continue
    const m = /(\d{4}-\d{2}-\d{2})/.exec(l)
    if (m) return m[1]
  }
  return null
}

/** `{ url, id }` from a `Sentry: <url> (id: <n>)` line, or null. */
export function parseSentry(body) {
  for (const l of lines(body)) {
    const m = /^Sentry:\s*(\S+)\s+\(id:\s*(\d+)\)/i.exec(l)
    if (m) return { url: m[1], id: m[2] }
  }
  return null
}

/** True when the date has passed, compared as ISO date strings in UTC. */
export function datePassed(isoDate, now = new Date()) {
  if (!isoDate) return false
  return isoDate < now.toISOString().slice(0, 10)
}
