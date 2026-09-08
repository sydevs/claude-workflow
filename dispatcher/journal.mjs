/**
 * The day's journal issue, created by the dispatcher and written to by the
 * sessions (one comment each) and by the dispatcher (anomalies only). The
 * title and the body's tally block are counts the sweeper keeps current;
 * the weekly reflect reads them to report usage (why: docs/why.md#there-is-no-wip-cap).
 * (why: docs/why.md#the-journal-day-is-a-local-date)
 */

const DAY_MARKER = '<!-- ops-journal:'
const TALLY_OPEN = '<!-- tally -->'
const TALLY_CLOSE = '<!-- /tally -->'
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

/** Count the day's dispatch-done and anomaly markers. Pure. */
export function tallyFrom(bodies) {
  const t = { dispatches: 0, failed: 0, anomalies: 0, byHandler: {}, byRepo: {}, byItem: {} }
  for (const body of bodies) {
    const b = String(body || '')
    if (b.startsWith(DONE_MARKER)) {
      t.dispatches += 1
      try {
        const j = JSON.parse(b.slice(DONE_MARKER.length, b.indexOf(' -->')))
        if (Number(j.failed) > 0) t.failed += 1
        if (j.handler) t.byHandler[j.handler] = (t.byHandler[j.handler] || 0) + 1
        const repo = String(j.repo || '').split('/').pop()
        if (repo) t.byRepo[repo] = (t.byRepo[repo] || 0) + 1
        if (j.repo && j.number) { const k = `${j.repo}#${j.number}`; t.byItem[k] = (t.byItem[k] || 0) + 1 }
      } catch { /* a malformed marker still counts as a dispatch */ }
    } else if (b.startsWith(ANOMALY_MARKER)) t.anomalies += 1
  }
  return t
}

/** The body block reflect reads: per handler, per repo, and the busiest items. */
export function renderTally(t) {
  const list = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'
  const busy = Object.entries(t.byItem).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k} ×${n}`).join(', ')
  return `${TALLY_OPEN}\n**Usage.** ${list(t.byHandler)} — ${list(t.byRepo)}${busy ? `\nMost sessions: ${busy}` : ''}\n${TALLY_CLOSE}`
}

function withTally(body, block) {
  const b = String(body || '')
  const i = b.indexOf(TALLY_OPEN)
  const j = b.indexOf(TALLY_CLOSE)
  if (i >= 0 && j > i) return b.slice(0, i) + block + b.slice(j + TALLY_CLOSE.length)
  return `${b.trimEnd()}\n\n${block}`
}

/** Recount the day from its comment markers; patch the title and the body's tally block. */
export async function refreshTally(gh, config, journalNumber, now = new Date()) {
  const owner = config.org
  const repo = config.journalRepo
  const bodies = []
  let page = 1
  for (;;) {
    const { data } = await gh.rest.issues.listComments({ owner, repo, issue_number: journalNumber, per_page: 100, page })
    for (const c of data) bodies.push(c.body)
    if (data.length < 100) break
    page += 1
  }
  const counts = tallyFrom(bodies)
  const title = titleFor(weekday(now, config.journal.timezone), counts)
  const { data: issue } = await gh.rest.issues.get({ owner, repo, issue_number: journalNumber })
  const body = withTally(issue.body, renderTally(counts))
  const patch = {}
  if (issue.title !== title) patch.title = title
  if (String(issue.body || '') !== body) patch.body = body
  if (Object.keys(patch).length) await gh.rest.issues.update({ owner, repo, issue_number: journalNumber, ...patch })
  return counts
}
