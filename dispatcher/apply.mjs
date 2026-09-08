/**
 * Execute a plan. Every write reads current state first and returns early
 * when it already matches — the idempotency the state machine proved.
 * `dryRun` logs the plan and writes nothing.
 */

import { saveRecord } from './record.mjs'
import { setStatus, ensureItem } from './projects.mjs'
import { ensureJournalDay, postAnomaly } from './journal.mjs'
import { buildRecord, fireRoutine, routineIdFor, tokenFor } from './fire.mjs'

const DISPATCHER_MARK = '<!-- sydevs-dispatcher: '

function marker(text) {
  return String(text || '').replace(/-->/g, '--&gt;')
}

async function commentOnce(gh, t, key, body, dryRun, log) {
  const mark = `${DISPATCHER_MARK}${marker(key)} -->`
  const comments = await gh.paginate(gh.rest.issues.listComments, { owner: t.repo.owner, repo: t.repo.name, issue_number: t.number, per_page: 100 })
  if (comments.some((c) => String(c.body || '').startsWith(mark))) return log(`comment "${key}" already posted`)
  log(`comment: ${key}`)
  if (dryRun) return
  await gh.rest.issues.createComment({ owner: t.repo.owner, repo: t.repo.name, issue_number: t.number, body: `${mark}\n${body}\n\n<sub>🤖 sydevs dispatcher</sub>` })
}

async function labels(gh, t, snapshot, add, remove, dryRun, log) {
  const current = new Set(snapshot.item.labels)
  const toAdd = add.filter((l) => l && !current.has(l))
  const toRemove = remove.filter((l) => l && current.has(l))
  if (!toAdd.length && !toRemove.length) return
  log(`labels: +[${toAdd}] -[${toRemove}]`)
  if (dryRun) return
  const args = { owner: t.repo.owner, repo: t.repo.name, issue_number: t.number }
  if (toAdd.length) await gh.rest.issues.addLabels({ ...args, labels: toAdd })
  for (const l of toRemove) {
    try { await gh.rest.issues.removeLabel({ ...args, name: l }) } catch (e) { if (e.status !== 404) throw e }
  }
  for (const l of toAdd) current.add(l)
  for (const l of toRemove) current.delete(l)
  snapshot.item.labels = [...current]
}

export async function apply({ gh, target, snapshot, plan, config, env, dryRun, core, now = new Date(), fetchImpl }) {
  const log = (m) => core.info(`${target.repo.name}#${target.number} ${target.reason}: ${m}`)
  const t = target
  const args = { owner: t.repo.owner, repo: t.repo.name }
  const nodeId = snapshot.pr?.nodeId || snapshot.item?.nodeId
  const emitted = []
  let recordDirty = false
  const rec = snapshot.record

  for (const a of plan) {
    switch (a.type) {
      case 'note': log(a.text); break
      case 'ensure':
        log('ensure on project')
        if (!dryRun) await ensureItem(gh, config, nodeId)
        break
      case 'status': {
        log(`status → ${a.value}`)
        if (!dryRun) { const w = await setStatus(gh, config, nodeId, a.value); if (w) log(`status written: ${w}`) }
        break
      }
      case 'label': await labels(gh, t, snapshot, a.add, a.remove, dryRun, log); break
      case 'comment': await commentOnce(gh, t, a.key, a.body, dryRun, log); break
      case 'react':
        if (dryRun || !t.facts?.commentId) break
        try { await gh.rest.reactions.createForIssueComment({ ...args, comment_id: t.facts.commentId, content: a.emoji }) } catch { /* cosmetic */ }
        break
      case 'recheck':
        log('locked — recheck recorded')
        if (!rec.recheck) { rec.recheck = true; recordDirty = true }
        break
      case 'unlocked': {
        if (rec.recheck) { rec.recheck = false; recordDirty = true }
        if (rec.current) {
          rec.dispatches = [...(rec.dispatches || []), { ...rec.current, outcome: 'done' }]
          rec.current = null
          recordDirty = true
        }
        break
      }
      case 'bumpFixCi':
        rec.fixCi = (rec.fixCi || 0) + 1; recordDirty = true
        break
      case 'markReady': {
        log('mark ready')
        if (dryRun) break
        await gh.graphql(`mutation($id:ID!){ markPullRequestReadyForReview(input:{pullRequestId:$id}){ pullRequest { id } } }`, { id: snapshot.pr.nodeId })
        snapshot.pr.draft = false
        break
      }
      case 'requestReviewer': {
        const reviewer = config.assignment.reviewer
        const already = (snapshot.pr?.requestedReviewers || []).some((l) => l.toLowerCase() === reviewer.toLowerCase())
          || (snapshot.reviews || []).some((r) => String(r.user?.login).toLowerCase() === reviewer.toLowerCase())
        if (already) { log('reviewer already requested or reviewed'); break }
        log(`request reviewer ${reviewer}`)
        if (!dryRun) await gh.rest.pulls.requestReviewers({ ...args, pull_number: t.number, reviewers: [reviewer] })
        break
      }
      case 'merge': {
        log('merge (squash)')
        if (dryRun) break
        await gh.rest.pulls.merge({ ...args, pull_number: t.number, merge_method: 'squash' })
        break
      }
      case 'sentry': {
        const token = env.SENTRY_CLAUDE_WORKFLOW_TOKEN
        log(`sentry resolve ${a.id} (issue #${a.issue})`)
        if (dryRun || !token) { if (!token) log('no SENTRY_CLAUDE_WORKFLOW_TOKEN — skipped'); break }
        const res = await (fetchImpl || globalThis.fetch)(`${config.sentry.apiBase}/issues/${a.id}/`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'resolved' }) })
        log(`sentry → ${res.status}`)
        break
      }
      case 'relationships': {
        for (const b of a.blockedBy) {
          const exists = (snapshot.blockedByOpen || []).some((x) => x.number === b.number && x.repo === b.repo)
          if (exists) continue
          log(`blocked_by += ${b.owner}/${b.repo}#${b.number}`)
          if (dryRun) continue
          try {
            const { data: blocker } = await gh.rest.issues.get({ owner: b.owner, repo: b.repo, issue_number: b.number })
            await gh.request('POST /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by', { ...args, n: t.number, issue_id: blocker.id })
          } catch (e) { log(`relationship write failed: ${e.status || ''} ${e.message}`) }
        }
        break
      }
      case 'anomaly': {
        log(`anomaly: ${a.kind} — ${a.text}`)
        if (dryRun) break
        const j = await ensureJournalDay(gh, config, now)
        await postAnomaly(gh, config, j.number, { kind: a.kind, text: a.text, id: rec.current?.id || null })
        break
      }
      case 'targets': emitted.push(...(a.list || [])); break
      case 'drain': emitted.push({ repo: t.repo, kind: 'issue', number: 0, reason: 'drain', event: 'drain', facts: {} }); break
      case 'fire': {
        const enabled = config.dispatch.enabledHandlers
        if (Array.isArray(enabled) && !enabled.includes(a.handler)) { log(`handler ${a.handler} not enabled yet — skipped`); break }
        await doFire({ gh, t, snapshot, handler: a.handler, flags: a.flags, attempt: a.attempt || 1, config, env, dryRun, log, now, fetchImpl, rec })
        recordDirty = true
        break
      }
      case 'retry': {
        const p = rec.pending
        if (!p) break
        await doFire({ gh, t, snapshot, handler: p.handler, flags: p.flags, attempt: p.attempt, config, env, dryRun, log, now, fetchImpl, rec })
        recordDirty = true
        break
      }
      case 'timeout': {
        const cur = rec.current
        const attempt = (cur?.attempt || 1) + 1
        const max = config.dispatch.maxAttempts ?? 3
        log(`deadline passed for ${cur?.handler || 'unknown'} attempt ${cur?.attempt || '?'}`)
        if (cur) rec.dispatches = [...(rec.dispatches || []), { ...cur, outcome: 'timed out' }]
        rec.current = null
        recordDirty = true
        await labels(gh, t, snapshot, [], [config.labels.lock], dryRun, log)
        if (!cur || attempt > max) {
          await labels(gh, t, snapshot, [config.labels.awaiting], [config.labels.stuck], dryRun, log)
          await commentOnce(gh, t, `attempts-exhausted ${cur?.id || now.toISOString()}`, `The session for **${cur?.handler || 'this item'}** did not finish after ${max} attempts. I have stopped retrying. A comment, a verb, or a push from you starts me again.`, dryRun, log)
          if (!dryRun) { const j = await ensureJournalDay(gh, config, now); await postAnomaly(gh, config, j.number, { kind: 'attempts-exhausted', text: `${t.repo.full}#${t.number} ${cur?.handler || ''}`, id: cur?.id || null }) }
          break
        }
        await doFire({ gh, t, snapshot, handler: cur.handler, flags: cur.flags || {}, attempt, config, env, dryRun, log, now, fetchImpl, rec })
        break
      }
      default: log(`unknown action ${a.type}`)
    }
  }

  if (recordDirty && !dryRun) snapshot.recordId = await saveRecord(gh, { owner: t.repo.owner, repo: t.repo.name, number: t.number }, snapshot.recordId, rec)
  return emitted
}

async function doFire({ gh, t, snapshot, handler, flags, attempt, config, env, dryRun, log, now, fetchImpl, rec }) {
  const routineId = routineIdFor(t.repo.name, config, env)
  const token = tokenFor(t.repo.name, config, env)
  const L = config.labels
  if (!routineId || !token) {
    log(`no routine id or token for ${t.repo.name} — cannot fire ${handler}`)
    rec.pending = { handler, flags, attempt, reason: 'no routine configured', retryAfter: null }
    await labels(gh, t, snapshot, [L.stuck], [], dryRun, log)
    if (!dryRun) { const j = await ensureJournalDay(gh, config, now); await postAnomaly(gh, config, j.number, { kind: 'unconfigured', text: `${t.repo.full}#${t.number} ${handler}: no routine id or token` }) }
    return
  }
  const journal = dryRun ? { number: 0 } : await ensureJournalDay(gh, config, now)
  const record = buildRecord({ handler, target: t, snapshot, flags, attempt, journalNumber: journal.number, config, now })
  log(`fire ${handler} attempt ${attempt} → routine ${routineId}${dryRun ? ' (dry run — not fired)' : ''}`)
  if (dryRun) { log(`record: ${JSON.stringify(record)}`); return }

  // Lock before fire. The lock is the lease; the session removes it last.
  await labels(gh, t, snapshot, [L.lock], [L.stuck, L.awaiting], dryRun, log)
  rec.current = { id: record.id, handler, flags, attempt, firedAt: record.firedAt, deadline: record.deadline, session: null, url: null }
  rec.pending = null
  snapshot.recordId = await saveRecord(gh, { owner: t.repo.owner, repo: t.repo.name, number: t.number }, snapshot.recordId, rec)

  let res = await fireRoutine({ token, routineId, record, fetchImpl, now, config })
  const fr = config.dispatch.fireRetry || {}
  if (!res.ok && res.status === 429 && res.retryAfterSeconds <= (fr.inline429MaxSeconds ?? 60)) {
    await new Promise((r) => setTimeout(r, res.retryAfterSeconds * 1000))
    res = await fireRoutine({ token, routineId, record, fetchImpl, now: new Date(), config })
  }
  if (!res.ok && res.status >= 500) {
    await new Promise((r) => setTimeout(r, (fr.backoff5xxSeconds ?? 20) * 1000))
    res = await fireRoutine({ token, routineId, record, fetchImpl, now: new Date(), config })
  }

  if (res.ok) {
    rec.current.session = res.session
    rec.current.url = res.url
    rec.dispatches = [...(rec.dispatches || []), { id: record.id, handler, attempt, firedAt: record.firedAt, url: res.url }]
    log(`session ${res.session}`)
    return
  }

  // The fire failed. Release the lock so a human verb is never blocked by an outage.
  const reason = res.status === 429 ? '429 rate limited' : res.status === 400 ? 'routines paused' : `fire failed (${res.status})`
  const retryAfter = res.status === 429 ? res.retryAfter : res.status === 400 ? null : new Date(now.getTime() + 10 * 60_000).toISOString()
  rec.current = null
  rec.pending = { handler, flags, attempt, reason, retryAfter, id: record.id }
  await labels(gh, t, snapshot, [L.stuck], [L.lock], dryRun, log)
  await commentOnce(gh, t, `fire-failed ${record.id}`, res.status === 400
    ? '⏸ The routines are paused, so nothing started. I will retry when they resume.'
    : `⏳ ${reason}. I will retry ${retryAfter ? `after ${retryAfter.slice(11, 16)}Z` : 'shortly'}.`, dryRun, log)
  await postAnomaly(gh, config, journal.number, { kind: res.status === 400 ? 'paused' : String(res.status), text: `${t.repo.full}#${t.number} ${handler} attempt ${attempt}: ${reason}${res.error ? ' — ' + res.error : ''}`, id: record.id })
}
