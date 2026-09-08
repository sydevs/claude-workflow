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

/**
 * In-org issue URLs named by live `Blocked by:` lines. A struck-through line
 * (`~~Blocked by: …~~`) is a cleared blocker and is skipped. PR URLs and
 * prose are ignored.
 */
export function parseBlockedBy(body, org, marker = 'Blocked by:') {
  const out = []
  const urlRe = new RegExp(`https://github\\.com/${org}/([A-Za-z0-9_.-]+)/issues/(\\d+)`, 'g')
  for (const l of lines(body)) {
    if (STRUCK.test(l) || !l.toLowerCase().startsWith(marker.toLowerCase())) continue
    for (const m of l.matchAll(urlRe)) {
      out.push({ owner: org, repo: m[1], number: Number(m[2]) })
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
