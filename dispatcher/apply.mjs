/**
 * Execute a plan. Every write reads current state first and returns early
 * when it already matches — the idempotency the state machine proved.
 * `dryRun` logs the plan and writes nothing.
 */

import { saveRecord } from './record.mjs'
import { setStatus, ensureItem } from './projects.mjs'
import { ensureJournalDay, postAnomaly } from './journal.mjs'
import { buildRecord, fireRoutine, routineIdFor, tokenFor } from './fire.mjs'
import { takeLease, releaseLease, leaseRef } from './lease.mjs'
import { stripBlockedBy } from './markers.mjs'
import { isLogin, isReviewer, isHuman } from './decide.mjs'
import { deriveStatus } from './status.mjs'

const DISPATCHER_MARK = '<!-- sydevs-dispatcher: '

function marker(text) {
  return String(text || '').replace(/-->/g, '--&gt;')
}

/**
 * Post an advisory once. `bot` is `identity.expectedLogin`, and only that
 * author's comment counts as already posted — every key is guessable from the
 * item. (why: docs/why.md#a-dispatcher-owned-marker-is-qualified-by-its-author)
 */
async function commentOnce(gh, t, bot, key, body, dryRun, log) {
  const mark = `${DISPATCHER_MARK}${marker(key)} -->`
  const comments = await gh.paginate(gh.rest.issues.listComments, { owner: t.repo.owner, repo: t.repo.name, issue_number: t.number, per_page: 100 })
  if (comments.some((c) => isLogin(c.user?.login, bot) && String(c.body || '').startsWith(mark))) return log(`comment "${key}" already posted`)
  log(`comment: ${key}`)
  if (dryRun) return
  await gh.rest.issues.createComment({ owner: t.repo.owner, repo: t.repo.name, issue_number: t.number, body: `${mark}\n${body}\n\n<sub>🤖 sydevs dispatcher</sub>` })
}

/**
 * Release the lease, and say so when it will not go. This is the one failure
 * in the lease that nothing used to report: the next `takeLease` answers 422
 * `already exists`, which reads as contention and posts no anomaly, so the
 * item stops for good in silence. (why: docs/why.md#a-failed-release-says-so)
 */
async function release(gh, config, t, { now, dryRun, log }) {
  if (dryRun) return true
  if (await releaseLease(gh, { owner: t.repo.owner, repo: t.repo.name, number: t.number })) return true
  log(`release failed: ${leaseRef(t.number)} is still there`)
  try {
    const j = await ensureJournalDay(gh, config, now)
    await postAnomaly(gh, config, j.number, { kind: 'lease-release-failed', text: `${t.repo.full}#${t.number}: ${leaseRef(t.number)} would not delete — every later fire reads its 422 as contention` })
  } catch { /* an anomaly we cannot post must not break an exit path */ }
  return false
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
  let moved = false
  let bumpFixCi = false
  const rec = snapshot.record
  const bot = config.identity.expectedLogin

  // The board is a lens. A token that cannot reach it must not stop the
  // dispatch, which is the part that matters — the record carries the state,
  // and Status is derived from it again on the next pass. The failure is
  // journalled once per run, not swallowed.
  // A write the token is not allowed to make is not a crash. It is a step the
  // machinery cannot take, so it hands that step to a human: the plan carries
  // on, the item is handed back (Awaiting), and the journal says which step
  // and why. (why: docs/why.md#a-write-we-cannot-make-is-handed-over-not-thrown)
  const handedOver = []
  const handOver = async (what, fn) => {
    try { await fn(); return true } catch (e) {
      const msg = String(e?.message || '').replace(/\s+/g, ' ').trim()
      // GraphQL reports a refusal in `errors[].type`, with no HTTP status.
      const refused = (e?.errors || []).some((x) => ['FORBIDDEN', 'UNPROCESSABLE'].includes(x?.type))
      const denied = refused || e?.status === 403 || e?.status === 405 || e?.status === 422
        || /not accessible|FORBIDDEN|Resource protected|protected branch|required status check|approving review/i.test(msg)
      if (!denied) throw e
      log(`cannot ${what} — ${e.status || '?'} ${msg}`)
      // GitHub's own words, not a guess. A branch rule refusing a merge and a
      // token missing a scope read identically until you quote the reason.
      // (why: docs/why.md#quote-the-refusal-do-not-name-a-cause)
      handedOver.push({ what, why: msg.slice(0, 220) })
      return false
    }
  }

  let boardFailed = null
  const board = async (fn) => {
    try { return await fn() } catch (e) {
      if (e?.name !== 'BoardUnreachable') throw e
      log(`board write skipped — ${e.message}`)
      boardFailed = boardFailed || e.message
    }
  }

  let syncWanted = false
  for (const a of plan) {
    switch (a.type) {
      case 'note': log(a.text); break
      case 'ensure':
        log('ensure on project')
        if (!dryRun) await board(() => ensureItem(gh, config, nodeId))
        break
      // Run last, whatever its place in the plan: Status is read off the
      // state every other action left. (why: docs/why.md#status-is-derived-never-read)
      case 'syncStatus': syncWanted = true; break
      case 'label': await labels(gh, t, snapshot, a.add, a.remove, dryRun, log); break
      // The dispatcher's own memory on the item: the approval, a hand-back,
      // a completion check owed. (why: docs/why.md#approval-lives-in-the-record)
      case 'record':
        log(`record ← ${JSON.stringify(a.patch)}`)
        Object.assign(rec, a.patch)
        recordDirty = true
        break
      // ⚠ This endpoint replaces the issue's whole field-value set, so every
      // value it already carries is sent back with the new date.
      // (why: docs/why.md#a-date-belongs-in-a-date-field)
      // `date: null` clears the field: `implement` answers a hold.
      case 'hold': {
        const f = config.issueFields?.holdUntil
        log(a.date ? `hold until ${a.date}` : 'hold cleared')
        snapshot.park = a.date ? { until: a.date, passed: false, source: 'field' } : { until: null, passed: false, source: null }
        if (dryRun || !f?.fieldId) break
        const { data: fresh } = await gh.rest.issues.get({ ...args, issue_number: t.number })
        const values = (fresh.issue_field_values || [])
          .filter((v) => v.issue_field_id !== f.fieldId)
          .map((v) => ({ field_id: v.issue_field_id, value: v.single_select_option?.name ?? v.value }))
        if (a.date) values.push({ field_id: f.fieldId, value: a.date })
        await handOver(a.date ? 'set Hold Until' : 'clear Hold Until', () => gh.request('PUT /repos/{owner}/{repo}/issues/{n}/issue-field-values', { ...args, n: t.number, data: values }))
        break
      }
      // A roadmap ticket lives in its milestone's repo. A session cannot move
      // an issue, so it asks, and this runs last: the number changes.
      // (why: docs/why.md#a-session-asks-actions-acts)
      case 'transfer': {
        log(`transfer to ${t.repo.owner}/${a.repo}${a.milestone ? ` (milestone "${a.milestone}")` : ''}`)
        if (dryRun) break
        if (recordDirty) { snapshot.recordId = await saveRecord(gh, { owner: t.repo.owner, repo: t.repo.name, number: t.number }, snapshot.recordId, rec); recordDirty = false }
        let moved_to = null
        const ok = await handOver('transfer the issue', async () => {
          const { data: dest } = await gh.rest.repos.get({ owner: t.repo.owner, repo: a.repo })
          const d = await gh.graphql(`mutation($i:ID!,$r:ID!){ transferIssue(input:{issueId:$i, repositoryId:$r}){ issue { number } } }`, { i: snapshot.item.nodeId, r: dest.node_id })
          moved_to = d.transferIssue.issue.number
        })
        if (!ok) break
        moved = true
        log(`now ${t.repo.owner}/${a.repo}#${moved_to}`)
        if (!a.milestone) break
        const ms = await gh.paginate(gh.rest.issues.listMilestones, { owner: t.repo.owner, repo: a.repo, state: 'open', per_page: 100 })
        const m = ms.find((x) => x.title === a.milestone)
        if (!m) { log(`no open milestone "${a.milestone}" in ${a.repo}`); break }
        await gh.rest.issues.update({ owner: t.repo.owner, repo: a.repo, issue_number: moved_to, milestone: m.number })
        break
      }
      case 'comment': await commentOnce(gh, t, bot, a.key, a.body, dryRun, log); break
      case 'react':
        if (dryRun || !t.facts?.commentId) break
        try { await gh.rest.reactions.createForIssueComment({ ...args, comment_id: t.facts.commentId, content: a.emoji }) } catch { /* cosmetic */ }
        break
      case 'recheck':
        log('locked — recheck recorded')
        if (!rec.recheck) { rec.recheck = true; recordDirty = true }
        break
      case 'unlocked': {
        // The session is finished, so its lease goes with its label. A ref
        // left behind is a permanent lock on the item.
        await release(gh, config, t, { now, dryRun, log })
        if (rec.recheck) { rec.recheck = false; recordDirty = true }
        // A fire refused while this session held the lease is re-derived now,
        // not retried blind.
        if (rec.pending?.refused) { rec.pending = null; recordDirty = true }
        if (rec.current) {
          rec.dispatches = [...(rec.dispatches || []), { ...rec.current, outcome: 'done' }]
          rec.current = null
          recordDirty = true
        }
        break
      }
      // Counted when a session actually starts, never when the fire was
      // refused. Three refusals used to exhaust `ceilings.ciFixIterations`,
      // which is what then refuses a real fix (sydevs/SahajAtlasWeb#245).
      case 'bumpFixCi':
        bumpFixCi = true
        break
      // Infrastructure, not the change: re-run just the failed jobs. The PAT
      // has no Actions scope, so this uses the calling repo's own token,
      // which its `actions: write` grant allows. A refusal still counts
      // against `ceilings.ciInfraReruns`, so a missing grant ends at a person.
      // (why: docs/why.md#an-infrastructure-failure-is-re-run-not-repaired)
      case 'rerunJobs': {
        log(`re-run: ${a.checks.map((c) => c.name).join(', ')}`)
        rec.ciReruns = { sha: a.sha, count: (rec.ciReruns?.sha === a.sha ? rec.ciReruns.count || 0 : 0) + 1 }
        recordDirty = true
        if (dryRun) break
        if (!env?.ACTIONS_TOKEN) { log('no ACTIONS_TOKEN — nothing re-run'); break }
        for (const c of a.checks) {
          const res = await (fetchImpl || fetch)(`https://api.github.com/repos/${t.repo.owner}/${t.repo.name}/actions/jobs/${c.jobId}/rerun`, {
            method: 'POST',
            headers: { authorization: `Bearer ${env.ACTIONS_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
          })
          if (!res.ok) log(`re-run of ${c.name} refused (${res.status})`)
        }
        break
      }
      case 'markReady': {
        log('mark ready')
        if (dryRun) break
        const ok = await handOver('mark ready', () =>
          gh.graphql(`mutation($id:ID!){ markPullRequestReadyForReview(input:{pullRequestId:$id}){ pullRequest { id } } }`, { id: snapshot.pr.nodeId }))
        if (ok) snapshot.pr.draft = false
        break
      }
      case 'requestReviewer': {
        // GitHub refuses a review request to the PR's own author (it failed
        // on sydevs/SahajAtlasWeb#318), so a member's PR asks the other
        // member, and a PR with nobody else to ask asks nobody.
        // (why: docs/why.md#a-members-pr-gets-the-loop)
        const author = snapshot.pr?.user?.login
        const reviewer = reviewerFor(author, config)
        if (!reviewer) { log('no reviewer other than the PR author'); break }
        const already = (snapshot.pr?.requestedReviewers || []).some((l) => l.toLowerCase() === reviewer.toLowerCase())
          || (snapshot.reviews || []).some((r) => String(r.user?.login).toLowerCase() === reviewer.toLowerCase())
        if (already) { log('reviewer already requested or reviewed'); break }
        log(`request reviewer ${reviewer}`)
        if (!dryRun && await handOver('request a reviewer', () => gh.rest.pulls.requestReviewers({ ...args, pull_number: t.number, reviewers: [reviewer] }))) {
          snapshot.pr.requestedReviewers = [...(snapshot.pr.requestedReviewers || []), reviewer]
        }
        break
      }
      case 'armAutoMerge': {
        if (snapshot.pr?.autoMergeArmed) { log('auto-merge already armed'); break }
        log('arm auto-merge (squash)')
        if (dryRun) break
        const armed = await handOver('arm auto-merge', () => gh.graphql(
          `mutation($id:ID!){ enablePullRequestAutoMerge(input:{pullRequestId:$id, mergeMethod:SQUASH}){ clientMutationId } }`,
          { id: snapshot.pr.nodeId }))
        if (armed) snapshot.pr.autoMergeArmed = true
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
        // Related means already there, in any state, or POSTed without error.
        const related = []
        for (const b of a.blockedBy) {
          const exists = (snapshot.blockedByAll || []).some((x) => x.number === b.number && x.repo === b.repo)
          if (exists) { related.push(b); continue }
          log(`blocked_by += ${b.owner}/${b.repo}#${b.number}`)
          if (dryRun) { related.push(b); continue }
          try {
            const { data: blocker } = await gh.rest.issues.get({ owner: b.owner, repo: b.repo, issue_number: b.number })
            await gh.request('POST /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by', { ...args, n: t.number, issue_id: blocker.id })
            related.push(b)
            // The Status this plan ends on must see the blocker it just made.
            if (blocker.state === 'open') snapshot.blockedByOpen = [...(snapshot.blockedByOpen || []), { ...b, state: 'open' }]
          } catch (e) { log(`relationship write failed: ${e.status || ''} ${e.message}`) }
        }
        if (!a.strip || !related.length) break
        // The converted line goes, so the body never holds a second copy of
        // the relationship that drifts from it. Re-read first: `issues.edited`
        // takes no lock, so a session may have rewritten the body since
        // `gather`. A failure leaves the line, which the next edit retries.
        // (why: docs/why.md#a-converted-blocker-line-is-deleted)
        try {
          const { data: live } = await gh.rest.issues.get({ ...args, issue_number: t.number })
          const out = stripBlockedBy(live.body, config.org, config.relationships?.bodyMarker, related)
          if (!out.dropped.length) break
          log(`strip: ${out.dropped.map((l) => l.trim()).join(' | ')}`)
          if (!dryRun) await gh.rest.issues.update({ ...args, issue_number: t.number, body: out.body })
        } catch (e) { log(`strip failed: ${e.status || ''} ${e.message}`) }
        break
      }
      case 'anomaly': {
        log(`anomaly: ${a.kind} — ${a.text}`)
        if (dryRun) break
        const j = await ensureJournalDay(gh, config, now)
        await postAnomaly(gh, config, j.number, { kind: a.kind, text: a.text, id: rec.current?.id || null })
        break
      }
      case 'releaseLease':
        log(`reclaim ${leaseRef(t.number)} — ${a.why}`)
        await release(gh, config, t, { now, dryRun, log })
        break
      case 'archiveCurrent':
        if (rec.current) {
          log(`archive ${rec.current.handler} — its end was never seen`)
          rec.dispatches = [...(rec.dispatches || []), { ...rec.current, outcome: 'ended unseen' }]
          rec.current = null
          recordDirty = true
        }
        await release(gh, config, t, { now, dryRun, log })
        break
      case 'targets': emitted.push(...(a.list || [])); break
      case 'fire': {
        const enabled = config.dispatch.enabledHandlers
        if (Array.isArray(enabled) && !enabled.includes(a.handler)) { log(`handler ${a.handler} not enabled yet — skipped`); break }
        await doFire({ gh, t, snapshot, handler: a.handler, flags: a.flags, attempt: a.attempt || 1, config, env, dryRun, log, now, fetchImpl, rec, bumpFixCi })
        recordDirty = true
        break
      }
      case 'retry': {
        const p = rec.pending
        if (!p) break
        await doFire({ gh, t, snapshot, handler: p.handler, flags: p.flags, attempt: p.attempt, config, env, dryRun, log, now, fetchImpl, rec, bumpFixCi: p.bumpFixCi === true })
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
        // Unconditionally, whatever the record said: reclaiming the lease is
        // the whole point of a timeout, and a ref the dead session left is
        // what would refuse every later fire.
        await release(gh, config, t, { now, dryRun, log })
        // Every timeout, re-fired or the last: improve-loop counts them per
        // handler to tune `dispatch.timeoutsMinutes`. A journal failure must
        // not cost the re-fire.
        if (cur && !dryRun) {
          try {
            const j = await ensureJournalDay(gh, config, now)
            await postAnomaly(gh, config, j.number, { kind: 'timed-out', text: `${t.repo.full}#${t.number} ${cur.handler} attempt ${cur.attempt || 1}`, id: cur.id || null })
          } catch { /* the journal is not the deadline's keeper */ }
        }
        if (!cur || attempt > max) {
          rec.handback = { reason: `${cur?.handler || 'the session'} did not finish after ${max} attempts`, at: now.toISOString() }
          // On a PR only a mention, a review or a push wakes the bot; on an
          // issue, a verb or a bare mention. (why: docs/why.md#a-bot-pr-answers-a-mention-or-a-review)
          const p = config.dispatch.commandPrefix
          const wake = t.kind === 'pr' ? `A mention (\`${p}\`) or a push from you starts me again.` : `A \`${p}\` verb or mention from you starts me again.`
          await commentOnce(gh, t, bot, `attempts-exhausted ${cur?.id || now.toISOString()}`, `The session for **${cur?.handler || 'this item'}** did not finish after ${max} attempts. I have stopped retrying. ${wake}`, dryRun, log)
          if (!dryRun) { const j = await ensureJournalDay(gh, config, now); await postAnomaly(gh, config, j.number, { kind: 'attempts-exhausted', text: `${t.repo.full}#${t.number} ${cur?.handler || ''}`, id: cur?.id || null }) }
          break
        }
        await doFire({ gh, t, snapshot, handler: cur.handler, flags: cur.flags || {}, attempt, config, env, dryRun, log, now, fetchImpl, rec })
        break
      }
      default: log(`unknown action ${a.type}`)
    }
  }

  if (handedOver.length && !dryRun && !moved) {
    const steps = handedOver.map((h) => h.what).join(' or ')
    const reasons = handedOver.map((h) => `- **${h.what}** — GitHub said: \`${h.why}\``).join('\n')
    rec.handback = { reason: `cannot ${steps}`, at: now.toISOString() }
    recordDirty = true
    await commentOnce(gh, t, bot, `handover ${handedOver.map((h) => h.what).join('+')}`,
      `I could not ${steps} here, so this is the step left for you.\n\n${reasons}`, dryRun, log)
    try {
      const j = await ensureJournalDay(gh, config, now)
      await postAnomaly(gh, config, j.number, { kind: 'handed-over', text: `${t.repo.full}#${t.number}: cannot ${steps} — ${handedOver[0].why}` })
    } catch { /* the journal is not the token's keeper */ }
  }
  if (boardFailed && !dryRun) {
    try {
      const j = await ensureJournalDay(gh, config, now)
      await postAnomaly(gh, config, j.number, { kind: 'board-unreachable', text: `${t.repo.full}#${t.number}: ${boardFailed}` })
    } catch { /* the journal is not the board's keeper */ }
  }
  if (syncWanted && !moved) {
    if (await syncStatus({ gh, config, t, snapshot, rec, nodeId, now, dryRun, log, board })) recordDirty = true
  }
  if (recordDirty && !dryRun && !moved) snapshot.recordId = await saveRecord(gh, { owner: t.repo.owner, repo: t.repo.name, number: t.number }, snapshot.recordId, rec)
  return emitted
}

/** The member to ask for a review: the configured reviewer, or the other human when they wrote it. */
export function reviewerFor(author, config) {
  const lower = (x) => String(x || '').toLowerCase()
  if (!isReviewer(author, config)) return config.assignment.reviewer
  return (config.assignment.respondTo || []).find((l) => isHuman(l, config) && lower(l) !== lower(author)) || null
}

/**
 * Derive the item's Status from the state the plan left and write it when it
 * changed. `rec.status` remembers the last value written, so a board value
 * that is neither is a person's drag: reverted here, and journalled.
 * The Pending clock starts when a wait the machinery owns begins.
 * Returns whether the record changed. (why: docs/why.md#status-is-derived-never-read)
 */
async function syncStatus({ gh, config, t, snapshot, rec, nodeId, now, dryRun, log, board }) {
  const d = deriveStatus({ ...snapshot, record: rec, now }, config, now)
  const name = config.projects.status?.[d.key]
  let dirty = false
  if (d.key === 'pending' && d.due) {
    if (rec.status !== 'pending' || !rec.pendingSince) { rec.pendingSince = now.toISOString(); rec.dueAttempts = 0; dirty = true }
  } else if (rec.pendingSince || rec.dueAttempts) {
    rec.pendingSince = null
    rec.dueAttempts = 0
    dirty = true
  }
  log(`status → ${name} (${d.reason})`)
  if (!dryRun && nodeId) {
    await board(async () => {
      const r = await setStatus(gh, config, nodeId, d.key)
      if (r.written) log(`status written: ${r.written}`)
      const last = rec.status ? config.projects.status?.[rec.status] : null
      if (r.written && r.previous && last && r.previous !== last) {
        log(`board drag reverted: ${r.previous} → ${name}`)
        try {
          const j = await ensureJournalDay(gh, config, now)
          await postAnomaly(gh, config, j.number, { kind: 'board-drag', text: `${t.repo.full}#${t.number}: moved to ${r.previous} on the board, derived ${name} (${d.reason}) — reverted` })
        } catch { /* the journal is not the board's keeper */ }
      }
    })
  }
  // Remembered only where a status comment already exists: an item the loop
  // never dispatched gets no comment just to hold this, so a drag there is
  // reverted without being journalled.
  if (rec.status !== d.key) { rec.status = d.key; if (snapshot.recordId) dirty = true }
  return dirty
}

async function doFire({ gh, t, snapshot, handler, flags, attempt, config, env, dryRun, log, now, fetchImpl, rec, bumpFixCi = false }) {
  const routineId = routineIdFor(t.repo.name, config, env)
  const token = tokenFor(t.repo.name, config, env)
  const L = config.labels
  if (!routineId || !token) {
    log(`no routine id or token for ${t.repo.name} — cannot fire ${handler}`)
    rec.pending = { handler, flags, attempt, reason: 'no routine configured', retryAfter: null, bumpFixCi }
    if (!dryRun) { const j = await ensureJournalDay(gh, config, now); await postAnomaly(gh, config, j.number, { kind: 'unconfigured', text: `${t.repo.full}#${t.number} ${handler}: no routine id or token` }) }
    return
  }
  const journal = dryRun ? { number: 0 } : await ensureJournalDay(gh, config, now)
  // The journal pointer is an optimisation. Without it the handler finds or
  // creates today's issue itself, so a journal failure never stops a fire.
  if (journal.failed) log(`journal pointer unavailable — ${journal.failed}`)
  const record = buildRecord({ handler, target: t, snapshot, flags, attempt, journalNumber: journal.number, config, now })
  log(`fire ${handler} attempt ${attempt} → routine ${routineId}${dryRun ? ' (dry run — not fired)' : ''}`)
  if (dryRun) { log(`record: ${JSON.stringify(record)}`); return }

  // The lease, before the label. `gather` read `locked` once and `decide` ran
  // on that snapshot, so every API call since has been open window — and no
  // concurrency group can serialize a `conflict-scan` or a cross-repo target
  // anyway. This ref create is the compare-and-swap that settles it: one 201,
  // one 422. (why: docs/why.md#the-lease-is-a-ref-not-a-label)
  const item = { owner: t.repo.owner, repo: t.repo.name, number: t.number }
  const bot = config.identity.expectedLogin
  const lease = await takeLease(gh, item, snapshot.pr?.head?.sha)
  if (!lease.won) {
    const why = lease.contended ? 'another pass holds the lease' : lease.error
    log(`refused ${handler} — ${why}`)
    if (!rec.recheck) rec.recheck = true
    // Never silent: the item reads Pending with a retry, so a lease that never
    // comes free is still checked again. (why: docs/why.md#a-refused-fire-is-pending-not-silent)
    rec.pending = { handler, flags, attempt, reason: lease.contended ? 'the lease is held' : 'the lease is unavailable', retryAfter: new Date(now.getTime() + 10 * 60_000).toISOString(), bumpFixCi, refused: true }
    if (!lease.contended) {
      const j = await ensureJournalDay(gh, config, now)
      await postAnomaly(gh, config, j.number, { kind: 'lease-unavailable', text: `${t.repo.full}#${t.number} ${handler}: ${why}` })
    }
    return
  }

  // From here the lease is ours, so every exit releases it. A throw between
  // the CAS and the fire would otherwise leave a ref no label and no record
  // points at, which only `sweep-lease` could reclaim.
  try {
    await labels(gh, t, snapshot, [L.lock], [], dryRun, log)
    // `sha` rides on `current`, so the entry `unlocked` and `timeout` append
    // carries the head this session was fired against. (why: docs/why.md#a-fix-ci-fire-is-keyed-to-its-head)
    rec.current = { id: record.id, handler, flags, attempt, firedAt: record.firedAt, deadline: record.deadline, session: null, url: null, sha: record.head?.sha || null }
    rec.pending = null
    // A session starting is the machinery taking the item back.
    rec.handback = null
    snapshot.recordId = await saveRecord(gh, { owner: t.repo.owner, repo: t.repo.name, number: t.number }, snapshot.recordId, rec)
  } catch (e) {
    await release(gh, config, t, { now, dryRun, log })
    throw e
  }

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
    if (bumpFixCi) rec.fixCi = (rec.fixCi || 0) + 1
    rec.current.session = res.session
    rec.current.url = res.url
    rec.dispatches = [...(rec.dispatches || []), { id: record.id, handler, attempt, firedAt: record.firedAt, url: res.url, sha: record.head?.sha || null }]
    log(`session ${res.session}`)
    return
  }

  // The fire failed. Release the lock so a human verb is never blocked by an outage.
  const reason = res.status === 429 ? '429 rate limited' : res.status === 400 ? 'routines paused' : `fire failed (${res.status})`
  const retryAfter = res.status === 429 ? res.retryAfter : res.status === 400 ? null : new Date(now.getTime() + 10 * 60_000).toISOString()
  rec.current = null
  rec.pending = { handler, flags, attempt, reason, retryAfter, id: record.id, bumpFixCi }
  await labels(gh, t, snapshot, [], [L.lock], dryRun, log)
  await release(gh, config, t, { now, dryRun, log })
  await commentOnce(gh, t, bot, `fire-failed ${record.id}`, res.status === 400
    ? '⏸ The routines are paused, so nothing started. I will retry when they resume.'
    : `⏳ ${reason}. I will retry ${retryAfter ? `after ${retryAfter.slice(11, 16)}Z` : 'shortly'}.`, dryRun, log)
  await postAnomaly(gh, config, journal.number, { kind: res.status === 400 ? 'paused' : String(res.status), text: `${t.repo.full}#${t.number} ${handler} attempt ${attempt}: ${reason}${res.error ? ' — ' + res.error : ''}`, id: record.id })
}
