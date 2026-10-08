/**
 * The body lines the loop writes and Actions reads.
 *
 * A cloud session cannot write a native issue relationship, so the audits
 * and `implement-roadmap` write `Blocked by: <url>` into `## Notes`, and the
 * dispatcher turns the line into a relationship. `Re-check: <date>` parks a
 * ticket until a date. `Sentry: <url> (id: <n>)` names the Sentry issue a
 * merge resolves. All three formats come from `format-ticket/SKILL.md`. A PR
 * body's `## Phases` checklist, from `implement-ticket`, is read here too, as
 * are a ticket's `## Open questions` and a session's `sydevs-request` marker.
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
  const seen = new Set()
  for (const l of lines(body)) {
    if (STRUCK.test(l)) continue
    const bare = l.replace(LEAD, '')
    if (!bare.toLowerCase().startsWith(words)) continue
    for (const r of parseRefs(bare, org)) {
      const key = `${r.repo}#${r.number}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(r)
    }
  }
  return out
}

/** In-org issues named in `text`, as full issue URLs or `owner/repo#N`. A bare `#N` names no repository. */
export function parseRefs(text, org) {
  const out = []
  const seen = new Set()
  const urlRe = new RegExp(`https://github\\.com/${org}/([A-Za-z0-9_.-]+)/issues/(\\d+)`, 'g')
  const shortRe = new RegExp(`\\b${org}/([A-Za-z0-9_.-]+)#(\\d+)\\b`, 'g')
  for (const re of [urlRe, shortRe]) {
    for (const m of String(text || '').matchAll(re)) {
      const key = `${m[1]}#${m[2]}`
      if (seen.has(key)) continue
      seen.add(key)
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

/**
 * `{ total, done }` from a PR body's `## Phases` checklist, or null when it
 * has none. `implement-ticket` writes the section when it builds one ticket
 * across sessions, and ticks a phase once it is pushed with its review done.
 * Only `- [ ]` and `- [x]` lines count, up to the next heading. A fenced
 * block is skipped, so a body quoting the template is not read as a plan.
 * (why: docs/why.md#a-ticket-is-built-in-phases-never-split)
 */
export function parsePhases(body) {
  let inside = false
  let fenced = false
  let total = 0
  let done = 0
  for (const l of lines(body)) {
    if (l.startsWith('```')) { fenced = !fenced; continue }
    if (fenced) continue
    if (/^#{1,6}\s/.test(l)) {
      if (inside) break
      inside = /^##\s+phases\s*$/i.test(l)
      continue
    }
    if (!inside) continue
    const m = /^[-*+]\s+\[([ xX])\]/.exec(l)
    if (!m) continue
    total += 1
    if (m[1] !== ' ') done += 1
  }
  return total ? { total, done } : null
}

/**
 * `{ total, open }` from a ticket body's `## Open questions` checklist, or
 * `{ total: 0, open: 0 }` when it has none. Only `- [ ]` and `- [x]` lines
 * count, up to the next heading; an option bullet under a question is not a
 * checkbox. An unticked item is a decision still owed, and `implement` waits
 * for it. (why: docs/why.md#a-decision-is-settled-before-the-build)
 */
export function parseOpenQuestions(body) {
  let inside = false
  let fenced = false
  let total = 0
  let open = 0
  for (const l of lines(body)) {
    if (l.startsWith('```')) { fenced = !fenced; continue }
    if (fenced) continue
    if (/^#{1,6}\s/.test(l)) {
      if (inside) break
      inside = /^##\s+open questions\s*$/i.test(l)
      continue
    }
    if (!inside) continue
    const m = /^[-*+]\s+\[([ xX])\]/.exec(l)
    if (!m) continue
    total += 1
    if (m[1] === ' ') open += 1
  }
  return { total, open }
}

const REQUEST = /<!--\s*sydevs-request\s+(\{[\s\S]*?\})\s*-->/

/**
 * What a session asks the dispatcher to do after it ends, from the
 * `<!-- sydevs-request {...} -->` marker in its own comment. A session can
 * write a comment but not a label, a transfer or a dispatch, so this is how
 * it hands those over. Unknown keys are dropped. (why: docs/why.md#a-session-asks-actions-acts)
 *
 * - `replan: true` — a roadmap ticket's goal changed; re-plan its children
 * - `escalated: true` — a decision went up to this ticket's roadmap parent
 * - `transfer: { repo, milestone }` — move a roadmap ticket to its milestone's repo
 */
export function parseRequest(body, repos = []) {
  const m = REQUEST.exec(String(body || ''))
  if (!m) return null
  let j
  try { j = JSON.parse(m[1]) } catch { return null }
  const out = {}
  if (j.replan === true) out.replan = true
  if (j.escalated === true) out.escalated = true
  if (j.transfer && typeof j.transfer.repo === 'string' && repos.includes(j.transfer.repo)) {
    out.transfer = { repo: j.transfer.repo, milestone: typeof j.transfer.milestone === 'string' ? j.transfer.milestone : null }
  }
  return Object.keys(out).length ? out : null
}

/** True when the date has passed, compared as ISO date strings in UTC. */
export function datePassed(isoDate, now = new Date()) {
  if (!isoDate) return false
  return isoDate < now.toISOString().slice(0, 10)
}
