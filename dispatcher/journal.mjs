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

/** Every open journal issue that belongs to `today`, oldest first. */
async function daysIssues(gh, config, today, tz) {
  const { data } = await gh.rest.issues.listForRepo({
    owner: config.org, repo: config.journalRepo, labels: config.labels.journal,
    state: 'open', sort: 'created', direction: 'desc', per_page: 20,
  })
  return data
    .filter((i) => !i.pull_request)
    .filter((i) => String(i.body || '').includes(`${DAY_MARKER}${today} -->`) || localDate(new Date(i.created_at), tz) === today)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
}

/** Stamp the day marker on an issue that lacks it, so the next lookup is exact. */
async function stamp(gh, config, issue, today) {
  if (String(issue.body || '').includes(`${DAY_MARKER}${today} -->`)) return
  try {
    await gh.rest.issues.update({
      owner: config.org, repo: config.journalRepo, issue_number: issue.number,
      body: `${DAY_MARKER}${today} -->\n${String(issue.body || '').trimStart()}`,
    })
  } catch { /* the marker is an optimisation, like the pointer itself */ }
}

/**
 * Find or create today's journal issue. Returns `{ number, created, failed }`.
 * **Never throws.** `number: 0` means the day has no issue and the dispatcher
 * could not make one — the handler finds or creates it, as in cron mode.
 * (why: docs/why.md#the-journal-pointer-is-an-optimisation)
 *
 * **The oldest issue for the day always wins.** Two `act` jobs can look at the
 * same instant and both find nothing, so after creating we look again and
 * close our own issue if an older one appeared.
 * (why: docs/why.md#one-journal-a-day-and-the-oldest-one-wins)
 */
export async function ensureJournalDay(gh, config, now = new Date()) {
  const owner = config.org
  const repo = config.journalRepo
  const tz = config.journal.timezone
  const today = localDate(now, tz)
  let mine = []
  try {
    mine = await daysIssues(gh, config, today, tz)
  } catch (e) {
    return { number: 0, created: false, failed: `cannot list ${config.labels.journal} issues: ${e.message}` }
  }
  if (mine.length) {
    await stamp(gh, config, mine[0], today)
    return { number: mine[0].number, created: false }
  }
  let created
  try {
    ({ data: created } = await gh.rest.issues.create({
      owner,
      repo,
      title: titleFor(weekday(now, tz), { dispatches: 0, failed: 0, anomalies: 0 }),
      body: `${DAY_MARKER}${today} -->\n**Dispatches today.** [Board](${config.projects.url})\n\nEach session posts one comment when it ends. The dispatcher posts only anomalies.`,
      labels: [config.labels.journal],
    }))
  } catch (e) {
    return { number: 0, created: false, failed: `cannot create today's journal issue: ${e.message}` }
  }
  // Look again. Another job may have created one in the same second.
  try {
    const after = await daysIssues(gh, config, today, tz)
    const oldest = after[0]
    if (oldest && oldest.number !== created.number) {
      await closeDuplicate(gh, config, created.number, oldest.number)
      return { number: oldest.number, created: false }
    }
  } catch { /* the create succeeded; a duplicate is the sweeper's problem */ }
  return { number: created.number, created: true }
}

/** Close a duplicate day issue, pointing at the one that won. */
export async function closeDuplicate(gh, config, number, keep) {
  const args = { owner: config.org, repo: config.journalRepo, issue_number: number }
  try {
    await gh.rest.issues.createComment({ ...args, body: `Duplicate of #${keep}, which is today's journal. Closed so the day has one document.` })
    await gh.rest.issues.update({ ...args, state: 'closed' })
    return true
  } catch { return false }
}

/**
 * Close every extra open journal issue for today, keeping the oldest. Runs on
 * the schedule, never on an event, so it is never in a race with itself.
 * Returns the numbers it closed.
 */
export async function closeDuplicateDays(gh, config, now = new Date()) {
  const tz = config.journal.timezone
  const today = localDate(now, tz)
  let mine = []
  try { mine = await daysIssues(gh, config, today, tz) } catch { return [] }
  if (mine.length < 2) return []
  const keep = mine[0].number
  const closed = []
  for (const i of mine.slice(1)) if (await closeDuplicate(gh, config, i.number, keep)) closed.push(i.number)
  return closed
}

/** One anomaly line from the dispatcher. `id` is the dispatch id when there is one. */
export async function postAnomaly(gh, config, journalNumber, { kind, text, id = null }) {
  if (!journalNumber) return false
  const body = `${ANOMALY_MARKER}${JSON.stringify({ kind, id })} -->\n⚠️ **${kind}** · ${text}`
  await gh.rest.issues.createComment({ owner: config.org, repo: config.journalRepo, issue_number: journalNumber, body })
  return true
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
  if (!journalNumber) return null
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
