/**
 * Event → targets. Each target is one issue or PR the `act` job will
 * re-derive a decision for, in its own concurrency group. Direct events
 * need no API call here; CI events and the schedule do.
 *
 * **One target per `repo#number`**, carrying every reason found for it. A
 * concurrency group serializes two matrix legs and silently drops the middle
 * of three (`dispatcher.yml` L90-91), and the sweeper does produce three for
 * one PR — `unblock-check`, `sweep-pr` and `sweep-orphan`. Coalescing makes
 * that moot: no two legs ever share a group, and `act` drains the reasons in
 * order inside the one leg. (why: docs/why.md#one-target-per-item)
 */

import { isBot } from './predicates.mjs'
import { expiredLockTargets, listSweepTargets } from './sweep.mjs'
import { cheapView, driftTargets } from './reconcile.mjs'

/**
 * The PR a merge-queue branch tests, or null. GitHub names the temporary
 * branch `gh-readonly-queue/<base>/pr-<number>-<base sha>`, and `<base>` may
 * itself hold slashes.
 */
export function queuedPr(branch) {
  const m = /^gh-readonly-queue\/.+\/pr-(\d+)-[0-9a-f]+$/.exec(String(branch || ''))
  return m ? Number(m[1]) : null
}

// `cancelled` is the queue rebuilding a group after an entry ahead failed,
// not a verdict on this PR.
const QUEUE_FAILED = new Set(['failure', 'timed_out'])

const ACTIONS_APP = 'github-actions'

/**
 * How the `resolve` log line names one coalesced target. A queue failure names
 * what failed, because the record kept only the run url — null for a
 * `check_suite` — so afterwards nothing could say what had spent the repair
 * passes. (why: docs/why.md#a-queue-failure-is-a-ci-failure)
 */
export function targetLabel(t) {
  const reasons = t.reasons.map(({ reason, facts }) => {
    const said = reason === 'queue-failed' ? [facts?.app, facts?.run || facts?.suite].filter(Boolean) : []
    return said.length ? `${reason}(${said.join(' ')})` : reason
  })
  return `${t.kind}#${t.number}:${reasons.join('+')}`
}

function repoOf(context) {
  return { owner: context.repo.owner, name: context.repo.repo, full: `${context.repo.owner}/${context.repo.repo}` }
}

/** The event a target was found on, for the dispatch record it may fire. */
export function eventLabel(context) {
  return `${context.eventName}.${context.payload?.action || ''}`.replace(/\.$/, '')
}

/**
 * Collapse targets to one per `repo#number`, keeping the order each reason was
 * found in. The survivor carries `reasons: [{ reason, facts }, ...]`; its own
 * `reason`/`facts` stay the first one, so a target read without this field
 * still behaves as it always did.
 */
export function coalesceTargets(targets) {
  const byItem = new Map()
  for (const t of targets) {
    const key = `${t.repo.full}#${t.number}`
    const held = byItem.get(key)
    if (!held) {
      byItem.set(key, { ...t, reasons: [{ reason: t.reason, facts: t.facts || {} }] })
      continue
    }
    if (held.reasons.some((r) => r.reason === t.reason)) continue
    held.reasons.push({ reason: t.reason, facts: t.facts || {} })
  }
  return [...byItem.values()]
}

/**
 * The event's own targets, then — on an event run — up to
 * `dispatch.reconcileMaxPerEvent` items elsewhere in the repo: first every
 * lock the record dates past its deadline, then the ones whose board Status
 * the cheap view rules out. The cron covers the rest.
 *
 * A cheap view that cannot answer reclaims nothing, so the cron stays the
 * backstop for a lock nobody will unlock.
 *
 * Both of those passes are almost all of what an event run spends: each
 * target is a full `gather` in its own `act` leg, against the event's one, and
 * the reclaim reads a record per locked item. So under `dispatch.rateLimitFloor`
 * the run keeps only its own targets, and the cron's full pass covers both.
 * A budget that cannot be read sheds nothing.
 * (why: docs/why.md#the-reconciler-replaces-the-drift-window,
 *  docs/why.md#a-lease-past-its-deadline-is-reclaimed,
 *  docs/why.md#a-rate-limited-call-waits-for-the-reset)
 */
export async function resolve({ github, context, config, core = { info() {} }, now = new Date() }) {
  const own = await eventTargets({ github, context, config, core, now })
  if (context.eventName === 'schedule' || context.eventName === 'workflow_dispatch') return own
  const limit = config.dispatch?.reconcileMaxPerEvent ?? 0
  if (!limit) return own
  const floor = config.dispatch?.rateLimitFloor ?? 0
  // `GET /rate_limit` is itself exempt from the limit it reports, so asking
  // costs nothing. A budget nobody can read stays null and sheds nothing.
  let remaining = null
  if (floor) {
    try {
      remaining = (await github.rest.rateLimit.get()).data?.resources?.core?.remaining
    } catch { /* unreadable: shed nothing */ }
  }
  if (Number.isFinite(remaining) && remaining < floor) {
    core.info(`REST budget ${remaining} is under the floor of ${floor} — keeping only this event's targets; the cron covers the reclaim and the drift`)
    return own
  }
  const repo = repoOf(context)
  const skip = new Set(own.map((t) => t.number))
  const view = await cheapView(github, config, repo.owner, repo.name)
  const expired = await expiredLockTargets({
    github, config, repo, now, limit, skip, event: eventLabel(context),
    items: view.filter((v) => v.labels.includes(config.labels.lock)),
  })
  // An item the reclaim took is spared the drift pass: a lock off the board,
  // or behind a Status write that failed, is a drift target too, and a second
  // target spends a slot and a full `gather` on an item already handled.
  for (const t of expired) skip.add(t.number)
  return own.concat(expired, driftTargets(view, config, repo, { now, limit: limit - expired.length, skip }))
}

async function eventTargets({ github, context, config, core, now }) {
  const repo = repoOf(context)
  const ev = context.payload
  const action = ev.action
  const name = context.eventName
  const one = (kind, number, reason, facts = {}) => [{ repo, kind, number, reason, event: eventLabel(context), facts }]

  if (name === 'issues') {
    const n = ev.issue.number
    if (action === 'unlabeled') {
      if (ev.label?.name !== config.labels.lock) return []
      return one('issue', n, 'unlock', {})
    }
    // A type set or changed is placement: a ticket typed Roadmap is reviewed
    // as one, and loses its Status. (why: docs/why.md#a-roadmap-ticket-has-no-status)
    if (action === 'typed' || action === 'untyped') return one('issue', n, 'issues.typed', {})
    // The editor, not the author, decides whether a marker is state.
    // (why: docs/why.md#a-strangers-marker-is-text)
    if (action === 'edited') return one('issue', n, 'issues.edited', { sender: ev.sender?.login })
    if (['opened', 'reopened', 'transferred', 'closed'].includes(action)) return one('issue', n, `issues.${action}`, {})
    return []
  }

  if (name === 'issue_comment' && action === 'created') {
    const c = ev.comment
    return one(ev.issue.pull_request ? 'pr' : 'issue', ev.issue.number, 'issue_comment', {
      author: c.user?.login, body: c.body, association: c.author_association, commentId: c.id, triggerType: 'comment',
    })
  }

  if (name === 'pull_request' || name === 'pull_request_target') {
    const pr = ev.pull_request
    const n = pr.number
    if (action === 'unlabeled') {
      if (ev.label?.name !== config.labels.lock) return []
      return one('pr', n, 'unlock', {})
    }
    if (action === 'synchronize') return one('pr', n, 'pull_request.synchronize', { pusherIsBot: isBot(ev.sender?.login, config) })
    if (action === 'closed') return one('pr', n, 'pull_request.closed', { merged: Boolean(pr.merged) })
    if (['opened', 'reopened', 'ready_for_review'].includes(action)) return one('pr', n, `pull_request.${action}`, {})
    return []
  }

  if (name === 'pull_request_review' && (action === 'submitted' || action === 'dismissed')) {
    const r = ev.review
    return one('pr', ev.pull_request.number, 'review', { author: r.user?.login, body: r.body, state: r.state, reviewId: r.id, triggerType: 'review' })
  }

  // Its own reason, not `issue_comment`, whose row refuses the `CONTRIBUTOR`
  // GitHub stamps here. `association` goes with it — nothing reads it on this
  // path. (why: docs/why.md#a-review-comment-is-feedback-whatever-its-association)
  if (name === 'pull_request_review_comment' && action === 'created') {
    const c = ev.comment
    return one('pr', ev.pull_request.number, 'review_comment', { author: c.user?.login, body: c.body, commentId: c.id, triggerType: 'review_comment' })
  }

  // `pull_request_review_thread` is a webhook event with no Actions trigger,
  // so no caller subscribes to it. The mapping stays for a manual re-drive.
  if (name === 'pull_request_review_thread') {
    return one('pr', ev.pull_request.number, 'thread', {})
  }

  if (name === 'workflow_run' || name === 'check_suite' || name === 'status') {
    const sha = ev.workflow_run?.head_sha || ev.check_suite?.head_sha || ev.sha
    if (!sha) return []
    // A queue run tests a commit no PR points at, so the lookup below never
    // finds one. Its branch names the PR instead.
    // (why: docs/why.md#a-queue-failure-is-a-ci-failure)
    const queued = queuedPr(ev.workflow_run?.head_branch || ev.check_suite?.head_branch)
    if (queued) {
      if (!QUEUE_FAILED.has(ev.workflow_run?.conclusion || ev.check_suite?.conclusion)) return []
      // Only Actions' own suite is the queue's CI failing. Another app's suite
      // on the ephemeral branch is advisory, exactly as it is on the PR head,
      // where `gather` reduces to the base ruleset's required checks before
      // anything reads red. A `workflow_run` is always Actions and carries no
      // `app`. (why: docs/why.md#a-queue-failure-is-a-ci-failure)
      const app = ev.workflow_run ? ACTIONS_APP : ev.check_suite?.app?.slug
      if (app !== ACTIONS_APP) {
        core.info(`a failed suite from ${app || 'an unnamed app'} on ${ev.check_suite?.head_branch} is not the queue's CI — ignored`)
        return []
      }
      // `run` stays a page a person can open, so `flags.queueRun` keeps
      // pointing a session at one. A suite carries only its API url, under its
      // own name. (why: docs/why.md#a-routine-cannot-reach-the-github-api)
      return one('pr', queued, 'queue-failed', { app, run: ev.workflow_run?.html_url || null, suite: ev.check_suite?.url || null })
    }
    let prs = (ev.workflow_run?.pull_requests || ev.check_suite?.pull_requests || []).map((p) => p.number)
    if (!prs.length) {
      const { data } = await github.rest.repos.listPullRequestsAssociatedWithCommit({ owner: repo.owner, repo: repo.name, commit_sha: sha })
      prs = data.filter((p) => p.state === 'open').map((p) => p.number)
    }
    const out = []
    for (const n of prs) {
      const { data: pr } = await github.rest.pulls.get({ owner: repo.owner, repo: repo.name, pull_number: n })
      if (pr.state !== 'open' || pr.head.sha !== sha) continue
      out.push(...one('pr', n, 'ci', { sha }))
    }
    return out
  }

  if (name === 'schedule' || name === 'workflow_dispatch') {
    return listSweepTargets({ github, config, repo, now })
  }

  return []
}
