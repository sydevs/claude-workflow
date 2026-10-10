/**
 * The daily vulnerability check, for the journal repo's `deps` job.
 *
 * Dependabot already knows, for every open alert, how severe it is, whether
 * it reaches production code, and whether a patched version exists. So the
 * dispatcher reads that and fires `audit-deps` in a repo only when there is
 * something to do, instead of a session every Monday finding nothing.
 * The session still judges reachability and reads the changelog.
 * (why: docs/why.md#a-vulnerability-is-checked-before-a-session-is-spent)
 *
 * It keeps no memory. An alert is due on the day it opens, and again on
 * `deps.catchUpDay` while a fix for it exists and it is still open, so a
 * session that judged one unreachable sees it again once a week, as before.
 *
 * Alerts it cannot read — a token without the Dependabot permission — fall
 * back to the old weekly run: on the catch-up day it fires anyway, so losing
 * the read never loses the audit. The anomaly says why, every day.
 */

import { buildRecord, fireRoutine, routineIdFor, tokenFor } from './fire.mjs'
import { ensureJournalDay, postAnomaly } from './journal.mjs'
import { isBot } from './decide.mjs'

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const lower = (s) => String(s || '').toLowerCase()

/** The numbers of the open alerts that make a session worth firing now. Pure. */
export function dueAlerts(alerts, config, now) {
  const d = config.deps || {}
  const severities = new Set((d.severities || []).map(lower))
  const scopes = new Set((d.scopes || []).map(lower))
  const since = now.getTime() - (d.windowHours ?? 26) * 3_600_000
  const catchUp = DAYS[now.getUTCDay()] === lower(d.catchUpDay)
  return (alerts || [])
    .filter((a) => lower(a.state) === 'open')
    .filter((a) => severities.has(lower(a.security_advisory?.severity || a.security_vulnerability?.severity)))
    .filter((a) => scopes.has(lower(a.dependency?.scope)))
    .filter((a) => Date.parse(a.created_at) >= since || (catchUp && Boolean(a.security_vulnerability?.first_patched_version)))
    .map((a) => a.number)
}

/** The open bot PR already carrying a dependency fix, if any. Pure. */
export function depsPrInFlight(pulls, config) {
  const prefix = config.deps?.branchPrefix || 'claude/chore-deps-'
  return (pulls || []).find((p) => isBot(p.user?.login, config) && String(p.head?.ref || '').startsWith(prefix)) || null
}

export async function depsTick({ github, core, config, env = process.env, dryRun = false, now = new Date(), fetchImpl }) {
  const d = config.deps || {}
  const handler = d.handler || 'audit-deps'
  const enabled = config.dispatch?.enabledHandlers
  if (Array.isArray(enabled) && !enabled.includes(handler)) return core.info(`${handler} is not an enabled handler — no check`)

  for (const name of d.repos || []) {
    const repo = { owner: config.org, name, full: `${config.org}/${name}` }
    let step = 'read alerts'
    try {
      let due
      try {
        const alerts = await github.paginate('GET /repos/{owner}/{repo}/dependabot/alerts', { owner: repo.owner, repo: name, state: 'open', per_page: 100 })
        due = dueAlerts(alerts, config, now)
        if (!due.length) { core.info(`${name}: ${alerts.length} open alert(s), none due`); continue }
      } catch (e) {
        if (DAYS[now.getUTCDay()] !== lower(d.catchUpDay)) throw e
        await unreadable({ github, core, config, dryRun, now, repo, handler, e })
        due = []
      }
      step = 'list pull requests'
      const pulls = await github.paginate(github.rest.pulls.list, { owner: repo.owner, repo: name, state: 'open', per_page: 100 })
      const inFlight = depsPrInFlight(pulls, config)
      if (inFlight) { core.info(`${name}: ${due.length ? `alert(s) ${due.map((n) => '#' + n).join(', ')}` : 'the weekly run'} due, but #${inFlight.number} already carries a dependency fix`); continue }
      step = 'fire'
      await fireDeps({ github, core, config, env, dryRun, now, fetchImpl, repo, handler, due })
    } catch (e) {
      const why = `${repo.full} ${handler}: could not ${step} — ${e?.status || '?'} ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 160)}`
      core.warning(why)
      if (!dryRun) {
        try { const j = await ensureJournalDay(github, config, now); await postAnomaly(github, config, j.number, { kind: 'deps-check', text: why }) } catch { /* the journal is not this check's keeper */ }
      }
    }
  }
}

/** Say the alerts were unreadable, then let the catch-up day fire blind, as the weekly run did. */
async function unreadable({ github, core, config, dryRun, now, repo, handler, e }) {
  const why = `${repo.full} ${handler}: could not read alerts — ${e?.status || '?'} ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 160)}; firing the weekly run anyway`
  core.warning(why)
  if (dryRun) return
  try { const j = await ensureJournalDay(github, config, now); await postAnomaly(github, config, j.number, { kind: 'deps-check', text: why }) } catch { /* the journal is not this check's keeper */ }
}

async function fireDeps({ github, core, config, env, dryRun, now, fetchImpl, repo, handler, due }) {
  const routineId = routineIdFor(repo.name, config, env)
  const token = tokenFor(repo.name, config, env)
  const journal = dryRun ? { number: 0 } : await ensureJournalDay(github, config, now)
  if (!routineId || !token) {
    core.warning(`${repo.name}: no routine id or token — cannot fire ${handler}`)
    if (!dryRun) await postAnomaly(github, config, journal.number, { kind: 'unconfigured', text: `${repo.full} ${handler}: no routine id or token` })
    return
  }
  const target = { repo, kind: 'repo', number: null, reason: 'deps', facts: { triggerType: 'schedule' } }
  const record = buildRecord({ handler, target, snapshot: {}, flags: { mode: 'vulnerabilities' }, attempt: 1, journalNumber: journal.number, config, now })
  core.info(`${repo.name}: ${due.length ? `alert(s) ${due.map((n) => '#' + n).join(', ')} due` : 'alerts unreadable on the catch-up day'} → fire ${handler}${dryRun ? ' (dry run — not fired)' : ''}`)
  if (dryRun) return core.info(`record: ${JSON.stringify(record)}`)
  const res = await fireRoutine({ token, routineId, record, fetchImpl, now, config })
  if (res.ok) return core.info(`${repo.name}: session ${res.session}`)
  // Nothing retries a failed fire: the alert is due again on the catch-up day.
  const reason = res.status === 429 ? '429 rate limited' : res.status === 400 ? 'routines paused' : `fire failed (${res.status})`
  await postAnomaly(github, config, journal.number, { kind: res.status === 400 ? 'paused' : String(res.status), text: `${repo.full} ${handler}: ${reason}${res.error ? ' — ' + res.error : ''}`, id: record.id })
}
