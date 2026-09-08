/**
 * The day's journal issue, created by the dispatcher and written to by the
 * sessions (one comment each) and by the dispatcher (anomalies only). The
 * title is a tally the sweeper keeps current.
 * (why: docs/why.md#the-journal-day-is-a-local-date)
 */

const DAY_MARKER = '<!-- ops-journal:'
export const DONE_MARKER = '<!-- sydevs-dispatch-done v1 '
export const ANOMALY_MARKER = '<!-- sydevs-dispatcher-anomaly v1 '

export function localDate(now, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
function weekday(now, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now)
}

export function titleFor(day, counts) {
  return `${day} — ${counts.dispatches} dispatch${counts.dispatches === 1 ? '' : 'es'} · ${counts.failed} failed · ${counts.anomalies} anomal${counts.anomalies === 1 ? 'y' : 'ies'}`
}

/** Find or create today's journal issue. Returns `{ number, created }`. */
export async function ensureJournalDay(gh, config, now = new Date()) {
  const owner = config.org
  const repo = config.journalRepo
  const tz = config.journal.timezone
  const today = localDate(now, tz)
  const { data } = await gh.rest.issues.listForRepo({ owner, repo, labels: config.labels.journal, state: 'open', sort: 'created', direction: 'desc', per_page: 20 })
  for (const i of data) {
    if (i.pull_request) continue
    const marked = String(i.body || '').includes(`${DAY_MARKER}${today} -->`)
    if (marked || localDate(new Date(i.created_at), tz) === today) return { number: i.number, created: false }
  }
  const { data: created } = await gh.rest.issues.create({
    owner,
    repo,
    title: titleFor(weekday(now, tz), { dispatches: 0, failed: 0, anomalies: 0 }),
    body: `${DAY_MARKER}${today} -->\n**Dispatches today.** [Board](${config.projects.url})\n\nEach session posts one comment when it ends. The dispatcher posts only anomalies.`,
    labels: [config.labels.journal],
  })
  return { number: created.number, created: true }
}

/** One anomaly line from the dispatcher. `id` is the dispatch id when there is one. */
export async function postAnomaly(gh, config, journalNumber, { kind, text, id = null }) {
  const body = `${ANOMALY_MARKER}${JSON.stringify({ kind, id })} -->\n⚠️ **${kind}** · ${text}`
  await gh.rest.issues.createComment({ owner: config.org, repo: config.journalRepo, issue_number: journalNumber, body })
}

/** Recount the day from its comment markers and patch the title. */
export async function refreshTitle(gh, config, journalNumber, now = new Date()) {
  const owner = config.org
  const repo = config.journalRepo
  const counts = { dispatches: 0, failed: 0, anomalies: 0 }
  let page = 1
  for (;;) {
    const { data } = await gh.rest.issues.listComments({ owner, repo, issue_number: journalNumber, per_page: 100, page })
    for (const c of data) {
      const b = String(c.body || '')
      if (b.startsWith(DONE_MARKER)) {
        counts.dispatches += 1
        try {
          const j = JSON.parse(b.slice(DONE_MARKER.length, b.indexOf(' -->')))
          if (Number(j.failed) > 0) counts.failed += 1
        } catch { /* a malformed marker still counts as a dispatch */ }
      } else if (b.startsWith(ANOMALY_MARKER)) counts.anomalies += 1
    }
    if (data.length < 100) break
    page += 1
  }
  const title = titleFor(weekday(now, config.journal.timezone), counts)
  const { data: issue } = await gh.rest.issues.get({ owner, repo, issue_number: journalNumber })
  if (issue.title !== title) await gh.rest.issues.update({ owner, repo, issue_number: journalNumber, title })
  return counts
}
