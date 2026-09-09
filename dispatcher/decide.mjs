/**
 * Every decision the dispatcher makes, as a pure function of a snapshot.
 *
 * `gather.mjs` reads GitHub into a snapshot. This file turns the snapshot
 * into a plan: a list of actions `apply.mjs` executes in order. Nothing
 * here fetches, so `node --test dispatcher/test` covers every branch.
 *
 * The invariant the whole file rests on: the event is a wake-up, and the
 * decision is re-derived from current state. A stale payload, a cancelled
 * pending run, or a storm of thirty-six thread resolutions all land on the
 * same answer. (why: docs/why.md#actions-observes-classifies-locks-and-fires)
 */

import { parseVerb } from './verbs.mjs'

// ---- action constructors ----------------------------------------------
export const fire = (handler, flags = {}) => ({ type: 'fire', handler, flags })
export const recheck = () => ({ type: 'recheck' })
export const label = (add = [], remove = []) => ({ type: 'label', add, remove })
export const status = (value) => ({ type: 'status', value })
export const commentOnce = (key, body) => ({ type: 'comment', key, body })
export const markReady = () => ({ type: 'markReady' })
export const requestReviewer = () => ({ type: 'requestReviewer' })
export const merge = () => ({ type: 'merge' })
export const bumpFixCi = () => ({ type: 'bumpFixCi' })
export const sentry = (issue, id) => ({ type: 'sentry', issue, id })
export const relationships = (blockedBy) => ({ type: 'relationships', blockedBy })
export const anomaly = (kind, text) => ({ type: 'anomaly', kind, text })
export const targets = (list) => ({ type: 'targets', list })
export const note = (text) => ({ type: 'note', text })
export const react = (emoji) => ({ type: 'react', emoji })

// ---- predicates ------------------------------------------------------
const lower = (s) => String(s || '').toLowerCase()

export function isBot(login, config) {
  return lower(login) === lower(config.identity?.expectedLogin)
}
export function respondTo(login, config) {
  return (config.assignment?.respondTo || []).some((l) => lower(l) === lower(login))
}
export function isHuman(login, config) {
  return respondTo(login, config) && lower(login) !== 'copilot'
}
const ACCESS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
export function hasAccess(association) {
  return ACCESS.has(String(association || '').toUpperCase())
}
export function isReviewer(login, config) {
  return lower(login) === lower(config.assignment?.reviewer)
}

/** The bot's newest comment that is not a dispatcher comment. */
export function botLastWordAt(comments, config) {
  let at = null
  for (const c of comments || []) {
    if (!isBot(c.author, config) || isDispatcherComment(c.body)) continue
    if (!at || c.createdAt > at) at = c.createdAt
  }
  return at
}
export function isDispatcherComment(body) {
  return /<!--\s*sydevs-(dispatcher|status)/.test(String(body || ''))
}

/** Newest respondTo comment newer than the bot's last word, with a verb, for the surface. */
export function pendingVerb(snapshot, config, surface) {
  const since = botLastWordAt(snapshot.comments, config)
  let best = null
  for (const c of snapshot.comments || []) {
    if (!isHuman(c.author, config) && !(surface === 'pr' && respondTo(c.author, config))) continue
    if (since && c.createdAt <= since) continue
    const v = parseVerb(c.body, config.dispatch, surface)
    if (!v.mentioned) continue
    if (!best || c.createdAt > best.createdAt) best = { ...v, comment: c }
  }
  return best
}

function ownReview(snapshot, config) {
  const header = config.review?.bodyHeader || '## 🧐 Adversarial review'
  return (snapshot.reviews || []).some(
    (r) => isBot(r.user?.login, config) && String(r.body || '').trimStart().startsWith(header),
  )
}

function needsAddressReview(snapshot, config) {
  const since = botLastWordAt(snapshot.comments, config)
  for (const t of snapshot.threads || []) {
    if (t.isResolved) continue
    const cs = t.comments || []
    if (!cs.length) continue
    const root = cs[0]
    const last = cs[cs.length - 1]
    if (respondTo(last.author, config) && !isBot(last.author, config)) return 'a thread waits on a reply'
    if (isBot(root.author, config) && !cs.slice(1).some((c) => isBot(c.author, config))) return 'own-rooted thread unanswered'
  }
  for (const r of snapshot.reviews || []) {
    if (!respondTo(r.user?.login, config) || isBot(r.user?.login, config)) continue
    if (since && r.submitted_at <= since) continue
    const state = String(r.state || '').toUpperCase()
    if (state === 'CHANGES_REQUESTED' || (r.body && r.body.trim()) || r.inline_count > 0) return 'a review asks for changes'
  }
  const newest = (snapshot.comments || []).filter((c) => !isDispatcherComment(c.body)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
  if (newest && respondTo(newest.author, config) && !isBot(newest.author, config) && (!since || newest.createdAt > since)) {
    return 'the last word is a human comment'
  }
  return null
}

function pendingReviewVerb(snapshot, config) {
  const newestBotReview = (snapshot.reviews || [])
    .filter((r) => isBot(r.user?.login, config))
    .map((r) => r.submitted_at)
    .sort()
    .pop()
  for (const c of snapshot.comments || []) {
    if (!respondTo(c.author, config)) continue
    if (newestBotReview && c.createdAt <= newestBotReview) continue
    const v = parseVerb(c.body, config.dispatch, 'pr')
    if (v.mentioned && v.verb === 'review') return true
  }
  return false
}

function underThreshold(pr, config) {
  const w = config.review?.skipWhen
  if (!w) return false
  return (pr.changed_files ?? Infinity) <= w.maxFiles && (pr.additions ?? 0) + (pr.deletions ?? 0) <= w.maxLines
}

function loopMayNotMerge(snapshot, config) {
  return (config.mergePolicy?.loopMayNotMerge || []).includes(snapshot.repo.name)
}

// ---- the one derivation every PR event funnels into ----------------------
export function evaluatePr(s, config) {
  const pr = s.pr
  const awaiting = config.labels.awaiting
  if (!pr || pr.state !== 'open') return [status('done')]
  if (!isBot(pr.user?.login, config)) return []
  if (s.locked) return [recheck()]
  // The session that holds the linked issue still owns this branch. A repo
  // with no CI is green the moment the PR opens, so without this the critic
  // fires while implement is still pushing.
  // (why: docs/why.md#the-lease-covers-the-branch-not-the-item)
  if (s.linkedLocked?.length) return [note(`#${s.linkedLocked[0]} is still locked — its session owns this branch`)]

  if (pendingReviewVerb(s, config)) return [fire('adversarial-review', { onDemand: true })]

  const why = needsAddressReview(s, config)
  if (why) return [note(why), fire('address-review')]

  if (!pr.draft && s.mergeable === 'CONFLICTING') return [fire('resolve-conflicts')]

  if (s.ci.failing.length) {
    if ((s.record?.fixCi || 0) < (config.ceilings?.ciFixIterations ?? 3)) return [bumpFixCi(), fire('fix-ci')]
    return [
      label([awaiting], [config.labels.stuck]),
      commentOnce(`ci-capped ${pr.head?.sha}`, `CI is still red after ${config.ceilings.ciFixIterations} fix attempts (${s.ci.reason}). I have stopped retrying. A comment or a push from you starts me again.`),
      anomaly('ci-capped', `${s.repo.full}#${pr.number} CI capped: ${s.ci.reason}`),
    ]
  }
  if (s.ci.running.length || !s.ci.green) return [note(`waiting on CI: ${s.ci.reason}`)]

  if (pr.draft) {
    const small = underThreshold(pr, config)
    if (!ownReview(s, config) && !small) return [fire('adversarial-review')]
    const plan = [markReady(), requestReviewer(), label([awaiting], [])]
    if (small && !ownReview(s, config)) {
      plan.push(commentOnce(`critic-skipped ${pr.head?.sha}`, `Adversarial review skipped: ${pr.changed_files} file(s), ${(pr.additions || 0) + (pr.deletions || 0)} changed line(s), under \`review.skipWhen\`. Say \`${config.dispatch.commandPrefix} review\` to force one.`))
    }
    return plan
  }

  if (s.normalized?.reviewDecision !== 'APPROVED') return [status('revising')]
  if (s.verdict?.verdict === 'MERGE') return [merge(), status('done')]
  const plan = [status('approved'), note(`approved, held: ${s.verdict?.reason}`)]
  if (loopMayNotMerge(s, config)) plan.push(label([awaiting], []))
  return plan
}

// ---- per-event deciders ------------------------------------------------
const LOCK_FREE_STATUS_ONLY = ['status', 'ensure', 'note', 'relationships', 'label']

/**
 * `decide(target, snapshot, config)` → plan[].
 *
 * `target.reason` names the event row: `issues.opened`, `issue_comment`,
 * `pull_request.synchronize`, `review`, `thread`, `ci`, `unlock`,
 * `unblock-check`, `conflict-scan`, `sweep-*`. `target.facts` carries
 * what the payload said — used only to pick the row; state comes from the
 * snapshot.
 */
export function decide(target, s, config) {
  const L = config.labels
  const facts = target.facts || {}
  const plan = []

  if ((s.item?.labels || []).includes(L.journal)) return [note('journal issue — ignored')]

  switch (target.reason) {
    case 'issues.opened': {
      plan.push({ type: 'ensure' }, status('proposed'), label([L.awaiting], []))
      if (isBot(s.item.author, config)) plan.push(label([L.proposal], []))
      if (s.markers.blockedBy.length) plan.push(relationships(s.markers.blockedBy))
      if (s.blockedByOpen.length || s.markers.blockedBy.length || s.markers.recheck) plan.push(label([L.blocked], []))
      return plan
    }
    case 'issues.edited': {
      if (s.markers.blockedBy.length) plan.push(relationships(s.markers.blockedBy))
      if (s.markers.blockedBy.length || s.markers.recheck) plan.push(label([L.blocked], []))
      return plan.length ? plan : [note('no marker change')]
    }
    case 'issues.reopened':
    case 'issues.transferred':
      return [{ type: 'ensure' }, status((s.item.labels || []).includes(L.proposal) ? 'proposed' : 'revising'), label([L.awaiting], [])]
    case 'issues.closed':
      return [status('done'), label([], [L.awaiting, L.stuck]), targets(s.dependents.map((d) => ({ ...d, reason: 'unblock-check' })))]
    // Both directions. `blocked` follows the native relationship, so an issue
    // blocked before the label existed gets one the first time the sweeper
    // sees it. (why: docs/why.md#blocked-follows-the-relationship)
    case 'unblock-check': {
      const labelled = (s.item.labels || []).includes(L.blocked)
      const applyIfMissing = (why) => (labelled ? [note(why)] : [label([L.blocked], []), note(`${why} — label applied`)])
      if (s.blockedByOpen.length) return applyIfMissing(`still blocked by ${s.blockedByOpen.map((b) => '#' + b.number).join(', ')}`)
      if (s.park?.until && !s.park.passed) return applyIfMissing(`parked until ${s.park.until}`)
      if (!labelled) return [note('not blocked')]
      return [
        label([L.awaiting], [L.blocked]),
        commentOnce(`unblocked ${facts.closedNumber || ''}`, `@${config.assignment.reviewer} unblocked: every blocker is closed. Say \`${config.dispatch.commandPrefix} implement\` to start.`),
      ]
    }
    case 'issue_comment': {
      if (isBot(facts.author, config)) return [note('own comment — ignored')]
      if (!respondTo(facts.author, config)) return [note(`comment by ${facts.author} — not feedback`)]
      if (isHuman(facts.author, config) && !hasAccess(facts.association)) return [note(`comment by ${facts.author} without write access — not feedback`)]
      if (s.kind === 'pr') {
        if (isBot(s.pr?.user?.login, config)) { plan.push(label([], [L.awaiting, L.stuck])); return plan.concat(evaluatePr(s, config)) }
        const v = parseVerb(facts.body, config.dispatch, 'pr')
        if (!v.mentioned) return [note('human PR, no mention — ignored')]
        if (s.locked) return [recheck()]
        return v.verb === 'review' ? [fire('adversarial-review', { onDemand: true })] : [fire('address-review', { delegated: true })]
      }
      if (!isHuman(facts.author, config)) return [note('issue verbs are for humans')]
      const v = parseVerb(facts.body, config.dispatch, 'issue')
      if (!v.mentioned) return [note('no mention — ignored')]
      plan.push(label([], [L.proposal, L.awaiting, L.stuck]), react('eyes'))
      if (v.verb === 'implement') {
        if (s.openPrsClosingIt.length) return plan.concat(commentOnce(`in-flight ${s.openPrsClosingIt[0]}`, `#${s.openPrsClosingIt[0]} is already open for this ticket, so I will not start a second implementation.`), label([L.awaiting], []))
        // A park stops the dispatch here, before any session starts. The
        // label alone is not the test: a ticket parked on a date it never
        // carried a label for would otherwise be implemented.
        // (why: docs/why.md#a-park-stops-the-dispatch-not-the-session)
        const parked = s.park?.until && !s.park.passed
        if ((s.item.labels || []).includes(L.blocked) || s.blockedByOpen.length || parked) {
          const why = s.blockedByOpen.length
            ? `it waits on ${s.blockedByOpen.map((b) => '#' + b.number).join(', ')}`
            : parked ? `it is parked until ${s.park.until}` : 'it carries the blocked label'
          return plan.concat(label([L.blocked, L.awaiting], []), commentOnce('blocked', `I will not implement this yet: ${why}. I will say so here when that clears.`))
        }
        plan.push(status('approved'))
        if (s.locked) return plan.concat(recheck())
        return plan.concat(fire('implement'))
      }
      plan.push(status('revising'))
      if (s.locked) return plan.concat(recheck())
      return plan.concat(fire(v.verb))
    }
    case 'review': {
      if (isBot(facts.author, config)) {
        const header = config.review?.bodyHeader || '## 🧐 Adversarial review'
        const isCritic = String(facts.body || '').trimStart().startsWith(header) && isBot(s.pr?.user?.login, config)
        return isCritic ? evaluatePr(s, config) : [note('own review — ignored')]
      }
      if (!respondTo(facts.author, config)) return [note(`review by ${facts.author} — ignored`)]
      if (isBot(s.pr?.user?.login, config)) return [label([], [L.awaiting, L.stuck])].concat(evaluatePr(s, config))
      const v = parseVerb(facts.body, config.dispatch, 'pr')
      if (!v.mentioned) return [note('human PR review, no mention')]
      if (s.locked) return [recheck()]
      return v.verb === 'review' ? [fire('adversarial-review', { onDemand: true })] : [fire('address-review', { delegated: true })]
    }
    case 'thread':
      return isBot(s.pr?.user?.login, config) ? evaluatePr(s, config) : [note('human PR thread')]
    case 'pull_request.opened':
    case 'pull_request.reopened': {
      plan.push({ type: 'ensure' }, status('revising'))
      if (target.reason === 'pull_request.opened' && isBot(s.pr?.user?.login, config)) {
        plan.push(targets(s.linkedIssues.map((n) => ({ repo: s.repo, kind: 'issue', number: n, reason: 'linked-in-flight' }))))
      }
      return plan.concat(evaluatePr(s, config))
    }
    case 'linked-in-flight':
      return [status('done'), label([], [L.awaiting])]
    case 'pull_request.ready_for_review':
      return [requestReviewer(), label([L.awaiting], [])].concat(evaluatePr(s, config))
    case 'pull_request.synchronize':
      plan.push(facts.pusherIsBot ? note('bot push') : label([], [L.awaiting, L.stuck]))
      return plan.concat(evaluatePr(s, config))
    case 'pull_request.closed': {
      plan.push(status('done'), label([], [L.awaiting, L.stuck]))
      if (facts.merged) {
        for (const li of s.linkedIssueDetails || []) if (li.sentry) plan.push(sentry(li.number, li.sentry.id))
        plan.push(targets(s.otherOpenBotPrs.map((n) => ({ repo: s.repo, kind: 'pr', number: n, reason: 'conflict-scan' }))))
      } else if (isBot(s.pr?.user?.login, config)) {
        plan.push(targets(s.linkedIssues.map((n) => ({ repo: s.repo, kind: 'issue', number: n, reason: 'linked-abandoned', facts: { pr: s.pr.number } }))))
      }
      return plan
    }
    case 'linked-abandoned':
      return [status('revising'), label([L.awaiting], []), commentOnce(`abandoned ${facts.pr}`, `#${facts.pr} was closed without merging, so this ticket is open again. Say \`${config.dispatch.commandPrefix} implement\` to try again.`)]
    case 'conflict-scan':
      return s.pr?.draft ? [note('draft — another session owns it')] : evaluatePr(s, config)
    case 'unlock': {
      const finished = facts.handler || s.record?.current?.handler || null
      plan.push({ type: 'unlocked', handler: finished })
      if (s.kind === 'pr') {
        const p = evaluatePr(s, config)
        const idle = !p.some((a) => a.type === 'fire' || a.type === 'merge' || a.type === 'markReady')
        if (idle && !s.pr?.draft) p.push(label([L.awaiting], []))
        return plan.concat(p)
      }
      const v = pendingVerb(s, config, 'issue')
      // An implement session answers with a PR, never a comment on the issue,
      // so the verb that started it still reads as pending. Re-dispatching it
      // only hits the in-flight guard, and leaves `awaiting` on a ticket whose
      // PR is open. The PR is the answer.
      // (why: docs/why.md#a-pr-is-the-answer-to-an-implement-verb)
      const answered = v?.verb === 'implement' && s.openPrsClosingIt.length > 0
      if (v && !answered) return plan.concat(targets([{ repo: s.repo, kind: 'issue', number: s.item.number, reason: 'issue_comment', facts: { author: v.comment.author, body: v.comment.body, association: 'MEMBER', commentId: v.comment.id } }]))
      if (s.openPrsClosingIt.length) plan.push(status('done'), label([], [L.awaiting]))
      else if (s.botSpokeLast) plan.push(status('revising'), label([L.awaiting], []))
      else plan.push(label([L.awaiting], []), anomaly('silent', `${s.repo.full}#${s.item.number} session ended without a comment`))
      return plan
    }
    case 'ci':
      return isBot(s.pr?.user?.login, config) ? evaluatePr(s, config) : [note('not a bot PR')]
    case 'sweep-retry':
      return [{ type: 'retry' }]
    case 'sweep-timeout':
      return [{ type: 'timeout' }]
    case 'sweep-recheck':
      return decide({ ...target, reason: 'unlock', facts: {} }, s, config)
    case 'sweep-orphan': {
      const p = evaluatePr(s, config)
      return p.some((a) => a.type === 'fire') ? p : p.concat(label([L.awaiting], []), commentOnce(`orphan ${s.pr?.head?.sha}`, 'This draft has had no CI activity for hours and no session holds it. Comment or push to wake me.'), anomaly('orphan', `${s.repo.full}#${s.pr?.number} orphaned draft`))
    }
    case 'sweep-awaiting': {
      if (s.locked || (s.item.labels || []).includes(L.stuck) || (s.item.labels || []).includes(L.awaiting)) return [note('no correction')]
      if (s.botSpokeLast) return [label([L.awaiting], []), anomaly('awaiting-drift', `${s.repo.full}#${s.item.number} awaiting was missing`)]
      return [note('human spoke last')]
    }
    default:
      return [note(`no rule for ${target.reason}`)]
  }
}

export const _internal = { needsAddressReview, ownReview, pendingReviewVerb, underThreshold, LOCK_FREE_STATUS_ONLY }
