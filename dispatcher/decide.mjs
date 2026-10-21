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

import { parseVerb, parseBlock } from './verbs.mjs'
import { parsePhases } from './markers.mjs'
import { failedDeploys } from '../workflow/lib/railway.mjs'

// ---- action constructors ----------------------------------------------
export const fire = (handler, flags = {}) => ({ type: 'fire', handler, flags })
export const recheck = () => ({ type: 'recheck' })
export const label = (add = [], remove = []) => ({ type: 'label', add, remove })
export const status = (value) => ({ type: 'status', value })
export const commentOnce = (key, body) => ({ type: 'comment', key, body })
export const markReady = () => ({ type: 'markReady' })
export const requestReviewer = () => ({ type: 'requestReviewer' })
export const armAutoMerge = () => ({ type: 'armAutoMerge' })
export const bumpFixCi = () => ({ type: 'bumpFixCi' })
export const rerunJobs = (sha, checks) => ({ type: 'rerunJobs', sha, checks })
export const sentry = (issue, id) => ({ type: 'sentry', issue, id })
/** `strip`: the targets were read from the body, so their lines go once related. A `block on` verb's were not. */
export const relationships = (blockedBy, strip = false) => ({ type: 'relationships', blockedBy, strip })
export const anomaly = (kind, text) => ({ type: 'anomaly', kind, text })
export const targets = (list) => ({ type: 'targets', list })
export const releaseLease = (why) => ({ type: 'releaseLease', why })
export const note = (text) => ({ type: 'note', text })
export const react = (emoji) => ({ type: 'react', emoji })
export const record = (patch) => ({ type: 'record', patch })
export const hold = (date) => ({ type: 'hold', date })
export const transfer = (repo, milestone) => ({ type: 'transfer', repo, milestone })

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
/**
 * The open PRs that close this issue, or null when none does. An issue whose
 * PR is open is the PR's turn, not the human's.
 * (why: docs/why.md#a-pr-is-the-answer-to-an-implement-verb)
 *
 * The read is bare, not optional. Only an issue snapshot carries the key
 * (gather.mjs:117), and on one a missing key is a gather.mjs bug worth throwing
 * on. The single arm that also takes PR snapshots tests `kind` instead, so no
 * caller pays for that arm's input with a silent "no PR is open".
 */
const inFlight = (s) => (s.openPrsClosingIt.length ? s.openPrsClosingIt : null)

/** A roadmap ticket: a plain-language goal whose state is its children. (why: docs/why.md#a-roadmap-ticket-has-no-status) */
export function isRoadmap(s, config) {
  return s.kind === 'issue' && Boolean(s.item?.type) && s.item.type === (config.roadmap?.type || 'Roadmap')
}
/** A throwaway branch a review session pushed for a preview. Nothing here touches it. */
function isSpike(s, config) {
  const prefix = config.roadmap?.spikeBranchPrefix
  return s.kind === 'pr' && Boolean(prefix) && String(s.pr?.head?.ref || '').startsWith(prefix)
}
/** The issue was opened by someone outside the org: its text is data, never state. (why: docs/why.md#a-strangers-marker-is-text) */
function byOutsider(s, config) {
  return !isBot(s.item?.author, config) && !hasAccess(s.item?.authorAssociation)
}
const parked = (s) => Boolean(s.park?.until && !s.park.passed)
const blockedNow = (s) => s.blockedByOpen.length > 0 || parked(s)

/**
 * A member's roadmap ticket is reviewed once, unprompted. A stranger's
 * waits for a member's `revise`, and a bot proposal for a human's verdict.
 */
function needsIntake(s, config) {
  if (!isRoadmap(s, config) || s.item.state !== 'open' || byOutsider(s, config) || isBot(s.item.author, config)) return false
  return !reviewedBefore(s)
}
/**
 * `implement-roadmap` has run on this goal. Children alone do not mean planned:
 * a review attaches existing tickets as sub-issues long before anyone plans,
 * and approving those would skip the plan. (why: docs/why.md#children-are-approved-together)
 */
const planned = (s) => (s.record?.dispatches || []).some((d) => d.handler === 'implement-roadmap') || s.record?.current?.handler === 'implement-roadmap'
const reviewedBefore = (s) => (s.record?.dispatches || []).some((d) => d.handler === 'revise-roadmap') || s.record?.current?.handler === 'revise-roadmap'
/**
 * The completion check's flags, the one place both of its fire sites read
 * them. Children closed entirely as not planned delivered nothing, and the
 * run must know that before it starts. (why: docs/why.md#a-goal-is-verified-not-assumed)
 */
const verifyFlags = (kids) => (kids.length && kids.every((c) => c.stateReason === 'not_planned') ? { mode: 'verify', withdrawn: true } : { mode: 'verify' })
/**
 * The session ending now was the completion check, fired after every child
 * closed. Children close seconds apart, so a sibling's leg finds that check
 * holding the lock and re-arms `verifyDue` under it. A timestamp, not the
 * handler alone: a child reclosed during the run is still owed a check.
 * (why: docs/why.md#a-goal-is-verified-not-assumed)
 */
function verifiedAlready(s, kids) {
  const cur = s.record?.current
  if (cur?.handler !== 'revise-roadmap' || cur.flags?.mode !== 'verify' || !cur.firedAt) return false
  const firedAt = Date.parse(cur.firedAt)
  return kids.every((c) => c.closedAt && Date.parse(c.closedAt) <= firedAt)
}

/** The `sydevs-request` the session that just ended left, or null. (why: docs/why.md#a-session-asks-actions-acts) */
function freshRequest(s) {
  const since = s.record?.current?.firedAt
  if (!s.request) return null
  return !since || s.request.at >= since ? s.request.body : null
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

/**
 * When each critic review was posted. review-pr falls back to one PR comment
 * led by the header when its pending-review tools fail, and that comment is
 * the review as much as a submitted one is.
 */
function criticReviewTimes(snapshot, config) {
  const header = config.review?.bodyHeader || '## 🧐 Adversarial review'
  const led = (body) => String(body || '').trimStart().startsWith(header)
  return [
    ...(snapshot.reviews || []).filter((r) => isBot(r.user?.login, config) && led(r.body)).map((r) => r.submitted_at),
    ...(snapshot.comments || []).filter((c) => isBot(c.author, config) && led(c.body)).map((c) => c.createdAt),
  ]
}

function ownReview(snapshot, config) {
  return criticReviewTimes(snapshot, config).length > 0
}

/**
 * A thread the bot rooted to ask a human something. It waits on that human:
 * only their reply, caught by the rule before it, makes it the bot's turn.
 */
function isQuestion(root, config) {
  const marker = config.review?.questionMarker || '<!-- sydevs-question -->'
  return isBot(root.author, config) && String(root.body || '').includes(marker)
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
    if (isQuestion(root, config)) continue
    if (isBot(root.author, config) && !cs.slice(1).some((c) => isBot(c.author, config))) return 'own-rooted thread unanswered'
  }
  for (const r of snapshot.reviews || []) {
    if (!respondTo(r.user?.login, config) || isBot(r.user?.login, config)) continue
    if (since && r.submitted_at <= since) continue
    const state = String(r.state || '').toUpperCase()
    if (state === 'CHANGES_REQUESTED' || (r.body && r.body.trim()) || r.inline_count > 0) return 'a review asks for changes'
  }
  // A plain comment is the reviewer talking to the PR; only a mention is
  // talking to the bot. (why: docs/why.md#a-bot-pr-answers-a-mention-or-a-review)
  const mention = (snapshot.comments || []).some((c) =>
    !isDispatcherComment(c.body) && respondTo(c.author, config) && !isBot(c.author, config)
    && (!since || c.createdAt > since) && isAddressMention(c.body, config))
  return mention ? 'a mention waits on a reply' : null
}

/** A mention asking for a reply. `review` asks for the critic, which `pendingReviewVerb` handles. */
function isAddressMention(body, config) {
  const v = parseVerb(body, config.dispatch, 'pr')
  return v.mentioned && v.verb !== 'review'
}

function pendingReviewVerb(snapshot, config) {
  // Only the critic's review answers the verb. A question review is the
  // bot's too, and must not swallow a review someone asked for.
  const newestBotReview = criticReviewTimes(snapshot, config)
    .filter(Boolean)
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

/** The newest comment, review or thread reply a respondTo human left on this item. */
function lastHumanWordAt(snapshot, config) {
  const human = (login) => respondTo(login, config) && !isBot(login, config)
  const at = []
  for (const c of snapshot.comments || []) if (human(c.author) && !isDispatcherComment(c.body)) at.push(c.createdAt)
  for (const r of snapshot.reviews || []) if (human(r.user?.login)) at.push(r.submitted_at)
  for (const t of snapshot.threads || []) for (const c of t.comments || []) if (human(c.author)) at.push(c.createdAt)
  return at.filter(Boolean).sort().pop() || null
}

/** The newest implement dispatch that ended, finished or timed out, from an issue's record. */
function lastEndedImplement(record) {
  return (record?.dispatches || []).filter((d) => d.handler === 'implement' && d.outcome).pop() || null
}

/**
 * A `fix-ci` session that already ran against this exact head and ended.
 *
 * A red run produces several `workflow_run`, `check_suite` and `status`
 * events per push, each its own `act` run, and the first session's unlock
 * re-derives the same plan on the same red head. Those re-fires were serial
 * and lock-respecting — not concurrency at all — so only the ceiling stopped
 * them, which is why it was exhausted (SahajCloud#861, SahajAtlasWeb#245).
 *
 * The head sha is what a `fix-ci` fire is about, so it is what the refusal
 * keys on. A push to a new sha has no ended session against it and fires
 * again. `rec.dispatches` keeps the last 20 entries, so a very long-lived PR
 * can age an entry out; the ceiling is still the backstop.
 * (why: docs/why.md#a-fix-ci-fire-is-keyed-to-its-head)
 */
/**
 * Every red required check is infrastructure. Re-run the failed Actions jobs,
 * up to `ceilings.ciInfraReruns` times on one head, then hand it to a person.
 * A failed check Actions did not produce cannot be re-run from here.
 */
function infraPlan(s, config, infra) {
  const sha = s.pr.head?.sha
  const done = s.record?.ciReruns?.sha === sha ? s.record.ciReruns.count || 0 : 0
  const cap = config.ceilings?.ciInfraReruns ?? 2
  const names = infra.map((c) => c.name).join(', ')
  if (done < cap && infra.every((c) => c.jobId)) return [note(`infrastructure failure on ${names} — re-run ${done + 1} of ${cap}`), rerunJobs(sha, infra)]
  const tried = done ? ` I re-ran it ${done} time${done === 1 ? '' : 's'} and it is still red.` : ''
  return [
    label([config.labels.awaiting], [config.labels.stuck]),
    commentOnce(`ci-infra ${sha}`, `CI failed on infrastructure, not on this change: ${names}.${tried} Re-run it once the service is back, or push.`),
    anomaly('ci-infra', `${s.repo.full}#${s.pr.number} infrastructure: ${names}`),
  ]
}

/** The head the last `fix-ci` fire was about, or null. */
function lastFixCiSha(record) {
  return [...(record?.dispatches || [])].reverse().find((d) => d.handler === 'fix-ci')?.sha || null
}

/**
 * A repair pass on this head that ended, or is ending now. A deploy pass never
 * counts: a flaky preview must not stand in for a real test failure.
 * `current` counts because the unlock that ends a session is decided before
 * `apply` moves it into `dispatches`; until then only its fire-time entry is
 * there, with no outcome, and a stood-down pass was fired again.
 */
function endedFixCiFor(record, sha) {
  if (!sha) return null
  const repair = (d) => d?.handler === 'fix-ci' && d.sha === sha && d.flags?.mode !== 'deploy'
  return (record?.dispatches || []).find((d) => repair(d) && d.outcome) || (repair(record?.current) ? record.current : null)
}

/**
 * A deploy pass already fired against this head: running, just unlocked, or
 * ended. `current` counts because the unlock that ends a session is decided
 * before `apply` moves it into `dispatches`, and only `current` and ended
 * entries carry `flags`. (why: docs/why.md#a-failed-preview-is-read-from-its-log)
 */
function deployPassFor(record, sha) {
  if (!sha) return null
  const isDeploy = (d) => d?.handler === 'fix-ci' && d.sha === sha && d.flags?.mode === 'deploy'
  return [record?.current, ...(record?.dispatches || [])].find(isDeploy) || null
}

/**
 * A conflicted PR, draft or ready. A conflicted branch schedules no CI, so
 * nothing downstream of this — fix-ci, the critic, the next phase — can ever
 * move it: the conflict goes first. Two exceptions. A stalled phased draft
 * labelled awaiting stays your turn. A resolve-conflicts session that already
 * ended on this head, or is ending now, stopped on a conflict it would not
 * guess, so that is your turn too, until a push gives it a new head.
 */
function conflictPlan(s, config) {
  const awaiting = config.labels.awaiting
  const phases = phasesLeft(s)
  if (phases && (s.item?.labels || []).includes(awaiting)) return [note(`phase ${phases.done + 1} of ${phases.total} waits on you, conflicted`)]
  const sha = s.pr.head?.sha
  const ran = (d) => d?.handler === 'resolve-conflicts' && sha && d.sha === sha
  const ended = (s.record?.dispatches || []).find((d) => ran(d) && d.outcome) || (ran(s.record?.current) ? s.record.current : null)
  if (ended) return [label([awaiting], []), note(`resolve-conflicts ${ended.outcome || 'ran'} on ${String(sha).slice(0, 7)} and it still conflicts — a push to a new head is what asks again`)]
  return [fire('resolve-conflicts')]
}

/** A phased draft whose ticket still has phases to build, or null. */
function phasesLeft(s) {
  const phases = parsePhases(s.item?.body)
  return s.pr?.draft && phases && phases.done < phases.total && s.linkedIssues?.length ? phases : null
}

/**
 * Required CI is green, and a Railway preview `railway.statusContexts` lists
 * failed. One `fix-ci` pass in `deploy` mode reads its log, once per head,
 * with no `bumpFixCi`: it never spends a `ceilings.ciFixIterations` pass. Not
 * mid-phases, where the next phase may be what fixes the build.
 * (why: docs/why.md#a-failed-preview-is-read-from-its-log)
 */
function deployPass(s, config) {
  if (!failedDeploys(s.ci?.advisory, config).length || phasesLeft(s)) return null
  if (deployPassFor(s.record, s.pr.head?.sha)) return null
  return advisoryNote(s).concat(fire('fix-ci', { mode: 'deploy' }))
}

function underThreshold(pr, config) {
  const w = config.review?.skipWhen
  if (!w) return false
  return Boolean(pr.contractSyncOnly) || ((pr.changed_files ?? Infinity) <= w.maxFiles && (pr.additions ?? 0) + (pr.deletions ?? 0) <= w.maxLines)
}

/** Repos where a merge is a deploy, so nothing is ever armed. */
function loopMayNotMerge(snapshot, config) {
  return (config.mergePolicy?.loopMayNotMerge || []).includes(snapshot.repo.name)
}

// The actions that move an item. Every other action — a label, a comment, a
// status, an anomaly — only restates where it already is.
const MOVES = new Set(['fire', 'armAutoMerge', 'markReady', 'recheck', 'targets', 'rerunJobs'])

/**
 * A sweep pass over an item that already carries `awaiting` says nothing
 * unless the derivation moves it.
 *
 * New activity is anything that clears `awaiting`, and every way to clear it
 * is an event the dispatcher already wakes on. So a plan with no move is the
 * plan the last pass ran, and running it again writes the same label, the
 * same `commentOnce` and the same anomaly.
 * (why: docs/why.md#a-quiet-awaiting-item-is-swept-in-silence)
 */
function quietSweep(plan, s, config) {
  if (!(s.item?.labels || []).includes(config.labels.awaiting)) return plan
  if (plan.some((a) => MOVES.has(a.type))) return plan
  return [note('awaiting with no new activity — nothing to add')]
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

  if (pendingReviewVerb(s, config)) return [fire('review-pr', { onDemand: true })]

  const why = needsAddressReview(s, config)
  if (why) return [note(why), fire('address-review')]

  if (s.mergeable === 'CONFLICTING') return conflictPlan(s, config)

  if (s.ci.failing.length) {
    // Red only on infrastructure: re-run it, never spend a repair on it.
    // (why: docs/why.md#an-infrastructure-failure-is-re-run-not-repaired)
    const infra = s.ci.infra || []
    if (infra.length && infra.length === s.ci.failing.length) return infraPlan(s, config, infra)
    const ended = endedFixCiFor(s.record, pr.head?.sha)
    if (ended) return [note(`fix-ci ${ended.outcome || 'ran'} on ${String(pr.head.sha).slice(0, 7)} — a push to a new head is what asks again`)]
    const cap = config.ceilings?.ciFixIterations ?? 3
    if ((s.record?.fixCi || 0) < cap) return [bumpFixCi(), fire('fix-ci')]
    // The cap comment promises that a person's push starts the repair again,
    // so a head they pushed since the last fix-ci resets the count.
    // (why: docs/why.md#a-push-from-a-person-resets-the-repair-count)
    if (isHuman(s.headAuthor, config) && pr.head?.sha && pr.head.sha !== lastFixCiSha(s.record)) return [record({ fixCi: 0 }), bumpFixCi(), fire('fix-ci')]
    return [
      label([awaiting], [config.labels.stuck]),
      commentOnce(`ci-capped ${pr.head?.sha}`, `CI is still red after ${config.ceilings.ciFixIterations} fix attempts (${s.ci.reason}). I have stopped retrying. A mention or a push from you starts me again.`),
      anomaly('ci-capped', `${s.repo.full}#${pr.number} CI capped: ${s.ci.reason}`),
    ]
  }
  if (s.ci.running.length || !s.ci.green) return [note(`waiting on CI: ${s.ci.reason}`)]
  return deployPass(s, config) || evaluateGreenPr(s, config).concat(advisoryNote(s))
}

/**
 * A red check the ruleset does not require is said once per set of names,
 * linked to its deployment when it has one, and fires nothing.
 * (why: docs/why.md#only-required-checks-are-ci)
 */
function advisoryNote(s) {
  const byName = new Map()
  for (const a of s.ci?.advisory || []) if (!byName.get(a.name)?.targetUrl) byName.set(a.name, a)
  const names = [...byName.keys()].sort()
  if (!names.length) return []
  const shown = names.map((n) => {
    const href = linkTarget(byName.get(n).targetUrl)
    return href ? `[\`${n}\`](${href})` : `\`${n}\``
  })
  return [commentOnce(`advisory ${names.join(' · ')}`, `Not required, so not blocking: ${shown.join(', ')} failed. A preview link in the body may not open until it passes.`)]
}

/** An https URL safe inside a Markdown link, or null. A status's `target_url` is whatever its poster set. */
function linkTarget(url) {
  try {
    const u = new URL(String(url))
    return u.protocol === 'https:' ? u.href.replace(/\(/g, '%28').replace(/\)/g, '%29') : null
  } catch {
    return null
  }
}

function evaluateGreenPr(s, config) {
  const pr = s.pr
  const awaiting = config.labels.awaiting

  if (pr.draft) {
    // One ticket, one PR, built across as many implement sessions as it
    // takes. While a phase is unticked the next session continues it, on the
    // ticket's lock, and the critic reads the whole PR once, at the end.
    // (why: docs/why.md#a-ticket-is-built-in-phases-never-split)
    const phases = phasesLeft(s)
    if (phases) {
      if ((s.item?.labels || []).includes(awaiting)) return [note(`phase ${phases.done + 1} of ${phases.total} waits on you`)]
      return [targets([{ repo: s.repo, kind: 'issue', number: s.linkedIssues[0], reason: 'phase-continue', facts: { pr: pr.number, done: phases.done, total: phases.total, humanAt: lastHumanWordAt(s, config) } }])]
    }
    const small = underThreshold(pr, config)
    if (!ownReview(s, config) && !small) return [fire('review-pr')]
    // GitHub refuses auto-merge on a draft, so this is the first moment it can
    // be armed. From here the ruleset decides: approval, resolved threads and
    // green CI, then the queue. (why: docs/why.md#github-owns-the-merge)
    const plan = [markReady(), requestReviewer(), label([awaiting], [])]
    if (!loopMayNotMerge(s, config)) plan.push(armAutoMerge())
    if (small && !ownReview(s, config)) {
      const why = pr.contractSyncOnly ? 'this PR only re-syncs a copied contract' : `${pr.changed_files} file(s), ${(pr.additions || 0) + (pr.deletions || 0)} changed line(s), under \`review.skipWhen\``
      plan.push(commentOnce(`critic-skipped ${pr.head?.sha}`, `Adversarial review skipped: ${why}. Say \`${config.dispatch.commandPrefix} review\` to force one.`))
    }
    return plan
  }

  // The dispatcher no longer merges. GitHub does, once the ruleset is
  // satisfied — one approval, every thread resolved, CI green — and the queue
  // rebases and tests before it lands. All that is left here is arming a PR
  // that reached ready without it. (why: docs/why.md#github-owns-the-merge)
  if (!loopMayNotMerge(s, config) && !s.pr?.autoMergeArmed) return [armAutoMerge()]
  if (s.normalized?.reviewDecision !== 'APPROVED') return [status('revising')]
  const plan = [status('approved')]
  if (loopMayNotMerge(s, config)) plan.push(label([awaiting], []))
  return plan
}

// ---- issue verbs ------------------------------------------------------

/** An unticked open question is a decision still owed, so nothing is built yet. (why: docs/why.md#a-decision-is-settled-before-the-build) */
function refuseOpenQuestions(s, config, facts) {
  const p = config.dispatch.commandPrefix
  return [
    label([config.labels.awaiting], []),
    commentOnce(`open-questions ${facts.commentId || ''}`, `Not started: ${s.openQuestions.open} open question(s) in the body still need an answer. Reply \`${p} revise\` with your choices (for example \`1A\`), then say \`${p} implement\` again.`),
  ]
}

function whyBlocked(s, config) {
  if (s.blockedByOpen.length) return `it waits on ${s.blockedByOpen.map((b) => '#' + b.number).join(', ')}`
  if (parked(s)) return `it is parked until ${s.park.until}`
  return 'it carries the blocked label'
}

function implementTicket(s, config, facts) {
  const L = config.labels
  const prs = inFlight(s)
  if (prs) return [commentOnce(`in-flight ${prs[0]}`, `#${prs[0]} is already open for this ticket, so I will not start a second implementation.`), label([L.awaiting], [])]
  if (s.openQuestions?.open) return refuseOpenQuestions(s, config, facts)
  // A park stops the dispatch here, before any session starts. The label
  // alone is not the test: a ticket parked on a date it never carried a label
  // for would otherwise be implemented. The approval stands, though: it starts
  // once a recheck confirms the unblock.
  // (why: docs/why.md#a-park-stops-the-dispatch-not-the-session, docs/why.md#children-are-approved-together)
  if ((s.item.labels || []).includes(L.blocked) || blockedNow(s)) {
    return [
      status('approved'),
      record({ pendingImplement: { by: facts.author || null } }),
      label([L.blocked], [L.awaiting]),
      commentOnce('blocked', `Approved, but not started: ${whyBlocked(s, config)}. When that clears and a recheck confirms it, I will start without another word from you.`),
    ]
  }
  const out = [status('approved')]
  if (s.record?.pendingImplement) out.push(record({ pendingImplement: null }))
  if (s.locked) return out.concat(recheck())
  return out.concat(fire('implement'))
}

/** Open children no PR answers yet: the ones an approval can still start. */
const unstarted = (s) => (s.children || []).filter((c) => c.state === 'open' && !c.prs)

/**
 * Two unstarted children in one repo: a plan from before the one-per-repo
 * rule. It is re-planned, and so consolidated, before anything is approved.
 * (why: docs/why.md#a-goal-gets-one-ticket-per-repo)
 */
function doubledUp(s) {
  const seen = new Set()
  return unstarted(s).some((c) => (seen.has(c.repo.full) ? true : (seen.add(c.repo.full), false)))
}

/**
 * `implement` on a roadmap ticket plans and approves in one verb. Not yet
 * planned, or planned under the old split, it plans — the children approved
 * when the plan ends. Planned, it approves every unstarted child. Planning
 * again once every child has closed files only what the goal still lacks.
 * (why: docs/why.md#one-verb-plans-and-approves)
 */
function implementGoal(s, config, facts) {
  const L = config.labels
  if (s.openQuestions?.open) return refuseOpenQuestions(s, config, facts)
  if ((s.item.labels || []).includes(L.blocked) || blockedNow(s)) {
    return [label([L.blocked], [L.awaiting]), commentOnce('blocked', `Not started: ${whyBlocked(s, config)}. I will recheck it when that clears.`)]
  }
  const open = (s.children || []).filter((c) => c.state === 'open')
  if (planned(s) && open.length && !doubledUp(s)) return approveChildren(s, config, facts)
  if (s.locked) return [recheck()]
  return [record({ approveOnPlan: { by: facts.author || null } }), fire('implement-roadmap', { mode: planned(s) && open.length ? 'replan' : 'plan' })]
}

/** Approve every unstarted child. Each starts now, or once a recheck confirms its blocker cleared. */
function approveChildren(s, config, facts) {
  if (s.locked) return [recheck()]
  const todo = unstarted(s)
  if (!todo.length) return [record({ approved: true }), note('every open child already has a PR')]
  const parent = `${s.repo.full}#${s.item.number}`
  const list = todo.map((c) => `${c.repo.full}#${c.number}`).join(', ')
  return [
    record({ approved: true }),
    commentOnce(`approve-all ${facts.commentId || ''}`, `Approved ${todo.length} implementation ticket(s): ${list}. Each starts now, or once a recheck confirms its blocker has cleared.`),
    targets(todo.map((c) => ({ repo: c.repo, kind: 'issue', number: c.number, reason: 'approve', facts: { by: facts.author || null, parent } }))),
  ]
}

/**
 * `block until <date> — <reason>` and `block on <ref>` are mechanical.
 * `block <reason>` alone asks a session to choose what to watch and when.
 * (why: docs/why.md#recheck-before-awaiting)
 */
function blockVerb(s, config, facts) {
  const L = config.labels
  const p = config.dispatch.commandPrefix
  const b = parseBlock(facts.body, config.dispatch, config.org)
  const key = facts.commentId || ''
  if (b.form === 'until') {
    const now = s.now || new Date()
    const today = now.toISOString().slice(0, 10)
    const days = config.issueFields?.holdUntil?.maxHorizonDays ?? 30
    const limit = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10)
    if (b.date <= today || b.date > limit) {
      return [label([L.awaiting], []), commentOnce(`block-refused ${key}`, `Not held: ${b.date} must be after today and no later than ${limit} (${days} days). A longer wait is a re-hold, which I do myself when the date comes.`)]
    }
    return [
      hold(b.date),
      record({ rehold: 0 }),
      label([L.blocked], [L.awaiting]),
      commentOnce(`hold ${key}`, `Held until ${b.date}. On that date I will recheck ${b.reason ? `whether this still holds: ${b.reason}` : 'why it was held'}, then re-hold it or hand it back.`),
    ]
  }
  if (b.form === 'on') {
    if (!b.refs.length) return [label([L.awaiting], []), commentOnce(`block-refused ${key}`, `Not blocked: name the blocker as a full issue URL or \`owner/repo#N\`, for example \`${p} block on ${config.org}/SahajCloud#632\`.`)]
    const refs = b.refs.map((r) => `${r.owner}/${r.repo}#${r.number}`).join(', ')
    return [relationships(b.refs), record({ rehold: 0 }), label([L.blocked], [L.awaiting]), commentOnce(`block-on ${key}`, `Blocked by ${refs}. When the last one closes I will recheck this before handing it back.`)]
  }
  if (s.locked) return [recheck()]
  return [fire(isRoadmap(s, config) ? 'revise-roadmap' : 'revise', { mode: 'block' })]
}

// ---- per-event deciders ------------------------------------------------
const LOCK_FREE_STATUS_ONLY = ['status', 'ensure', 'note', 'relationships', 'label']

/**
 * `decide(target, snapshot, config)` → plan[].
 *
 * `target.reason` names the event row: `issues.opened`, `issue_comment`,
 * `pull_request.synchronize`, `review`, `review_comment`, `thread`, `ci`,
 * `unlock`, `unblock-check`, `conflict-scan`, `sweep-*`. `target.facts` carries
 * what the payload said — used only to pick the row; state comes from the
 * snapshot.
 */
export function decide(target, s, config) {
  let plan = derive(target, s, config)
  // A locked item is the session's turn, never yours. One event can arrive
  // as two — a ticket created with its type fires `opened` and `typed` — and
  // the second leg runs after the first took the lock. Unlock re-derives
  // `awaiting` from the finished state. (why: docs/why.md#a-locked-item-is-never-awaiting)
  if (s.locked) {
    const L = config.labels
    plan = plan.map((a) => (a.type === 'label' && a.add.includes(L.awaiting) ? label(a.add.filter((x) => x !== L.awaiting), a.remove) : a))
  }
  if (!isRoadmap(s, config)) return plan
  // A roadmap ticket carries no Status: its milestone, its children and
  // whether it is closed say where it is. Every status the rows below would
  // write becomes one clear. (why: docs/why.md#a-roadmap-ticket-has-no-status)
  const out = []
  let cleared = false
  for (const a of plan) {
    if (a.type !== 'status') { out.push(a); continue }
    if (!cleared) { out.push(status(null)); cleared = true }
  }
  return out
}

function derive(target, s, config) {
  const L = config.labels
  const facts = target.facts || {}
  const plan = []

  if ((s.item?.labels || []).includes(L.journal)) return [note('journal issue — ignored')]
  if (isSpike(s, config)) return [note('spike PR — the review session that pushed it owns it')]

  switch (target.reason) {
    case 'issues.opened': {
      // A stranger's `Blocked by:` or `Re-check:` line is text, not state.
      // (why: docs/why.md#a-strangers-marker-is-text)
      const outsider = byOutsider(s, config)
      const blockers = outsider ? [] : s.markers.blockedBy
      const parkedHere = parked(s) && !(outsider && s.park.source === 'marker')
      // Parked or your turn, never both: a blocked ticket is waiting on the
      // blocker, not on you. (why: docs/why.md#blocked-and-awaiting-are-exclusive)
      const bornBlocked = s.blockedByOpen.length || blockers.length || parkedHere
      plan.push({ type: 'ensure' }, status('proposed'))
      if (!bornBlocked) plan.push(label([L.awaiting], []))
      if (isBot(s.item.author, config)) plan.push(label([L.proposal], []))
      if (blockers.length) plan.push(relationships(blockers, true))
      if (bornBlocked) plan.push(label([L.blocked], [L.awaiting]))
      // Nothing the loop files is revised on arrival any more: every author
      // writes through write-ticket, so a proposal arrives fully specified.
      // (why: docs/why.md#one-author-writes-every-implementation-ticket)
      if (!bornBlocked && needsIntake(s, config)) plan.push(s.locked ? recheck() : fire('revise-roadmap', { mode: 'intake' }))
      return plan
    }
    case 'issues.typed': {
      if (!isRoadmap(s, config)) return [{ type: 'ensure' }, status((s.item.labels || []).includes(L.proposal) ? 'proposed' : 'revising')]
      plan.push({ type: 'ensure' }, status(null))
      if (needsIntake(s, config) && !blockedNow(s)) plan.push(s.locked ? recheck() : fire('revise-roadmap', { mode: 'intake' }))
      return plan
    }
    case 'issues.edited': {
      // An outsider editing their own issue cannot create a relationship or a
      // park. Only the author of an issue, the bot or a maintainer can edit
      // its body, so this is the one case to refuse.
      // (why: docs/why.md#a-strangers-marker-is-text)
      if (facts.sender && byOutsider(s, config) && lower(facts.sender) === lower(s.item.author)) return [note('edited by its non-member author — markers are text')]
      if (s.markers.blockedBy.length) plan.push(relationships(s.markers.blockedBy, true))
      if (s.markers.blockedBy.length || parked(s)) plan.push(label([L.blocked], [L.awaiting]))
      return plan.length ? plan : [note('no marker change')]
    }
    case 'issues.reopened':
    case 'issues.transferred':
      return [{ type: 'ensure' }, status((s.item.labels || []).includes(L.proposal) ? 'proposed' : 'revising'), label([L.awaiting], [])]
    case 'issues.closed': {
      const next = s.dependents.map((d) => ({ ...d, reason: 'unblock-check' }))
      // The last child of a roadmap ticket closing is the cue to check the
      // goal was met. (why: docs/why.md#a-goal-is-verified-not-assumed)
      if (s.parent?.state === 'open') next.push({ repo: s.parent.repo, kind: 'issue', number: s.parent.number, reason: 'child-closed', facts: { child: `${s.repo.full}#${s.item.number}` } })
      return [status('done'), label([], [L.awaiting, L.stuck]), targets(next)]
    }
    // Both directions. `blocked` follows the native relationship, so an issue
    // blocked before the label existed gets one the first time the sweeper
    // sees it. (why: docs/why.md#blocked-follows-the-relationship)
    case 'unblock-check': {
      const labelled = (s.item.labels || []).includes(L.blocked)
      const applyIfMissing = (why) => (labelled ? [note(why)] : [label([L.blocked], []), note(`${why} — label applied`)])
      if (s.blockedByOpen.length) return applyIfMissing(`still blocked by ${s.blockedByOpen.map((b) => '#' + b.number).join(', ')}`)
      if (parked(s)) return applyIfMissing(`parked until ${s.park.until}`)
      if (!labelled) return [note('not blocked')]
      if (s.kind !== 'issue') return [label([L.awaiting], [L.blocked])]
      if (s.locked) return [recheck()]
      // The date passing or the blocker closing is a cue to look, not proof
      // the ticket is free. A recheck session reads why it was held, and
      // re-holds it quietly or hands it back. After maxRehold quiet re-holds
      // in a row, it is your call. (why: docs/why.md#recheck-before-awaiting)
      const reholds = s.record?.rehold || 0
      const max = config.issueFields?.holdUntil?.maxRehold ?? 3
      if (reholds >= max) {
        const p = config.dispatch.commandPrefix
        return [
          label([L.awaiting], [L.blocked]),
          record({ rehold: 0 }),
          commentOnce(`rehold-cap ${s.park?.until || facts.closedNumber || ''}`, [
            `This has been re-held ${reholds} times in a row. Which way?`,
            '',
            `- **A — keep waiting (recommended if the blocker is still real):** \`${p} block until <date> — <reason>\``,
            `- **B — rework it around the blocker:** \`${p} revise <how>\``,
            '- **C — drop it:** close it as not planned.',
          ].join('\n')),
        ]
      }
      // The converted `Blocked by:` line is gone from the body, so the fire
      // names what it waited on. (why: docs/why.md#a-converted-blocker-line-is-deleted)
      const cleared = (s.blockedByAll || []).map((b) => `${b.owner}/${b.repo}#${b.number}`)
      return [record({ rehold: reholds + 1 }), fire(isRoadmap(s, config) ? 'revise-roadmap' : 'revise', { mode: 'recheck', ...(cleared.length ? { cleared } : {}) })]
    }
    case 'issue_comment': {
      if (isBot(facts.author, config)) return [note('own comment — ignored')]
      // The author of a roadmap ticket answers its questions, member or not.
      // A stranger's words never start a session: they mark the ticket your
      // turn and are read as data on the next run a member starts.
      // (why: docs/why.md#an-outsider-feeds-a-member-fires)
      if (s.kind === 'issue' && isRoadmap(s, config) && !respondTo(facts.author, config) && lower(facts.author) === lower(s.item.author)) {
        if (s.locked || (s.item.labels || []).includes(L.blocked)) return [note('the author replied — read on the next run')]
        return [label([L.awaiting], []), note('the author replied — read as data on the next run a member starts')]
      }
      if (!respondTo(facts.author, config)) return [note(`comment by ${facts.author} — not feedback`)]
      if (isHuman(facts.author, config) && !hasAccess(facts.association)) return [note(`comment by ${facts.author} without write access — not feedback`)]
      if (s.kind === 'pr') {
        const v = parseVerb(facts.body, config.dispatch, 'pr')
        // On every PR, a comment reaches the bot only through a mention. A
        // review or a thread reply on its own PR needs none.
        // (why: docs/why.md#a-bot-pr-answers-a-mention-or-a-review)
        if (!v.mentioned) return [note(`${isBot(s.pr?.user?.login, config) ? 'bot' : 'human'} PR comment, no mention — ignored`)]
        if (isBot(s.pr?.user?.login, config)) { plan.push(label([], [L.awaiting, L.stuck])); return plan.concat(evaluatePr(s, config)) }
        if (s.locked) return [recheck()]
        return v.verb === 'review' ? [fire('review-pr', { onDemand: true })] : [fire('address-review', { delegated: true })]
      }
      if (!isHuman(facts.author, config)) return [note('issue verbs are for humans')]
      const v = parseVerb(facts.body, config.dispatch, 'issue')
      if (!v.mentioned) return [note('no mention — ignored')]
      plan.push(label([], [L.proposal, L.awaiting, L.stuck]), react('eyes'))
      if (v.verb === 'block') return plan.concat(blockVerb(s, config, facts))
      if (v.verb === 'implement') return plan.concat(isRoadmap(s, config) ? implementGoal(s, config, facts) : implementTicket(s, config, facts))
      // `revise`, `review`, or a bare mention. A human's word ends any run of
      // quiet re-holds. (why: docs/why.md#recheck-before-awaiting)
      plan.push(status('revising'))
      if (s.record?.rehold) plan.push(record({ rehold: 0 }))
      if (s.locked) return plan.concat(recheck())
      // A member's first word on a stranger's goal accepts it: the full review.
      if (isRoadmap(s, config)) return plan.concat(fire('revise-roadmap', { mode: reviewedBefore(s) ? 'revise' : 'intake' }))
      return plan.concat(fire('revise', { mode: 'revise' }))
    }
    // One child of a roadmap ticket, approved with the rest by `implement` on
    // the parent. A blocked child is approved now and starts once a recheck
    // confirms the unblock. (why: docs/why.md#children-are-approved-together)
    case 'approve': {
      if (s.item.state !== 'open') return [note('closed — nothing to approve')]
      if (inFlight(s)) return [note(`#${inFlight(s)[0]} is already open for it`)]
      if (s.openQuestions?.open) return [label([L.awaiting], []), commentOnce('approve-open-questions', `Not started: ${s.openQuestions.open} open question(s) here still need an answer.`)]
      const pending = record({ pendingImplement: { by: facts.by || null, parent: facts.parent || null } })
      plan.push(label([], [L.proposal, L.awaiting, L.stuck]), status('approved'))
      if (blockedNow(s) || (s.item.labels || []).includes(L.blocked)) return plan.concat(pending, label([L.blocked], [L.awaiting]), note('approved — starts when a recheck confirms the unblock'))
      if (s.locked) return plan.concat(pending, recheck())
      return plan.concat(fire('implement'))
    }
    case 'child-closed': {
      if (!isRoadmap(s, config)) return [note('parent is not a roadmap ticket')]
      if (s.item.state !== 'open') return [note('roadmap ticket already closed')]
      const kids = s.children || []
      const left = kids.filter((c) => c.state === 'open').length
      if (!kids.length || left) return [note(`${kids.length - left} of ${kids.length} children closed`)]
      if (s.locked) return [record({ verifyDue: true }), recheck()]
      return [record({ verifyDue: false }), fire('revise-roadmap', verifyFlags(kids))]
    }
    // A child's session raised a decision on this roadmap ticket's Open
    // questions. That is your turn here. (why: docs/why.md#a-late-decision-goes-to-the-goal)
    case 'escalated': {
      if (s.item.state !== 'open') return [note('closed')]
      return [label([L.awaiting], []), commentOnce(`escalated ${facts.child}`, `A decision came up while working on ${facts.child}. It is in **Open questions** above, with options and a recommendation.`)]
    }
    // A review comment is a review. From a human on a bot PR that means
    // `evaluatePr`, so a cancelled sibling costs nothing — the invariant the
    // concurrency group rests on. ⚠ On a human PR it means the verb tail,
    // which reads this one body, so a verb left in the review body is still
    // lost when that leg is the cancelled one. The bot guard is the only
    // thing this row does not share: `case 'review'`'s bot branch carries the
    // critic-header exception, which belongs to a submitted review alone.
    // (why: docs/why.md#a-review-comment-is-feedback-whatever-its-association)
    case 'review_comment': {
      if (isBot(facts.author, config)) return [note('own review comment — ignored')]
      return decide({ ...target, reason: 'review' }, s, config)
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
      return v.verb === 'review' ? [fire('review-pr', { onDemand: true })] : [fire('address-review', { delegated: true })]
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
    // A phased PR asked for its next session. It runs as implement, on the
    // ticket's lock, as the first one did, so the branch keeps one owner. The
    // bound is progress: a session that ended — done or out of attempts —
    // without ticking a phase, and with no human word since it started, has
    // stalled, and the PR becomes your turn instead of a loop.
    // (why: docs/why.md#a-ticket-is-built-in-phases-never-split)
    case 'phase-continue': {
      if (s.item.state !== 'open') return [note('ticket closed — no phase to continue')]
      if (s.locked) return [note('a session holds the ticket — it owns the branch')]
      const last = lastEndedImplement(s.record)
      const heardSince = facts.humanAt && last && facts.humanAt > last.firedAt
      const stalled = last && !heardSince && (last.outcome !== 'done' || last.flags?.phasesDone === facts.done)
      if (stalled) return [targets([{ repo: s.repo, kind: 'pr', number: facts.pr, reason: 'phases-stalled', facts: { done: facts.done, total: facts.total } }])]
      return [fire('implement', { phasesDone: facts.done })]
    }
    case 'phases-stalled':
      return [
        label([L.awaiting], []),
        // A push is not a word: only a mention or a review re-arms the
        // continuation (phase-continue reads `humanAt`).
        commentOnce(`phases-stalled ${s.pr?.head?.sha}`, `Phase ${facts.done + 1} of ${facts.total} did not advance in the last session, so I have stopped continuing this PR. A mention (\`${config.dispatch.commandPrefix}\`) or a review from you starts me again.`),
        anomaly('phases-stalled', `${s.repo.full}#${s.pr?.number} phase ${facts.done + 1}/${facts.total} stalled`),
      ]
    case 'linked-abandoned':
      return [status('revising'), label([L.awaiting], []), commentOnce(`abandoned ${facts.pr}`, `#${facts.pr} was closed without merging, so this ticket is open again. Say \`${config.dispatch.commandPrefix} implement\` to try again.`)]
    // Drafts too: evaluatePr already leaves a branch a session holds alone.
    case 'conflict-scan':
      return evaluatePr(s, config)
    case 'unlock': {
      const finished = facts.handler || s.record?.current?.handler || null
      plan.push({ type: 'unlocked', handler: finished })
      if (s.kind === 'pr') {
        const p = evaluatePr(s, config)
        // A closed PR is nobody's turn. Without this, a session that was
        // holding the lock when the PR merged unlocks afterwards, finds
        // nothing left to do, and calls that the human's turn.
        // (why: docs/why.md#a-closed-item-is-nobodys-turn)
        if (s.pr?.state !== 'open') return plan.concat(p, label([], [L.awaiting, L.stuck]))
        const idle = !p.some((a) => a.type === 'fire' || a.type === 'armAutoMerge' || a.type === 'markReady')
        if (idle && !s.pr?.draft) p.push(label([L.awaiting], []))
        return plan.concat(p)
      }
      const v = pendingVerb(s, config, 'issue')
      // An implement session answers with a PR, never a comment on the issue,
      // so the verb that started it still reads as pending. Re-dispatching it
      // only hits the in-flight guard, and leaves `awaiting` on a ticket whose
      // PR is open. The PR is the answer.
      // (why: docs/why.md#a-pr-is-the-answer-to-an-implement-verb)
      const answered = v?.verb === 'implement' && Boolean(inFlight(s))
      if (v && !answered) return plan.concat(targets([{ repo: s.repo, kind: 'issue', number: s.item.number, reason: 'issue_comment', facts: { author: v.comment.author, body: v.comment.body, association: 'MEMBER', commentId: v.comment.id } }]))
      if (s.item.state !== 'open') return plan.concat(label([], [L.awaiting, L.stuck]))
      const req = freshRequest(s)
      if (req?.escalated && s.parent) plan.push(targets([{ repo: s.parent.repo, kind: 'issue', number: s.parent.number, reason: 'escalated', facts: { child: `${s.repo.full}#${s.item.number}` } }]))
      // Still held — the recheck re-held it, or the session parked it. Quiet:
      // blocked is not your turn. (why: docs/why.md#recheck-before-awaiting)
      if (blockedNow(s)) return plan.concat(label([L.blocked], [L.awaiting]))
      if ((s.item.labels || []).includes(L.blocked)) plan.push(label([], [L.blocked]))
      if (s.record?.rehold) plan.push(record({ rehold: 0 }))
      if (req?.escalated) return plan.concat(note('waits on the decision it raised on its roadmap ticket'))
      // Approved while blocked, and the recheck found it free.
      // (why: docs/why.md#children-are-approved-together)
      if (s.record?.pendingImplement && !inFlight(s)) {
        if (s.openQuestions?.open) return plan.concat(record({ pendingImplement: null }), status('revising'), label([L.awaiting], []))
        return plan.concat(record({ pendingImplement: null }), status('approved'), fire('implement'))
      }
      if (isRoadmap(s, config)) {
        const kids = s.children || []
        // The plan the implement verb asked for has ended: approve what it
        // filed, unless it raised a decision first. (why: docs/why.md#one-verb-plans-and-approves)
        if (finished === 'implement-roadmap' && s.record?.approveOnPlan) {
          plan.push(record({ approveOnPlan: null }))
          if (!s.openQuestions?.open && unstarted(s).length) return plan.concat(approveChildren(s, config, { author: s.record.approveOnPlan.by }))
        }
        // A re-plan keeps an approval the goal already has.
        if (req?.replan && kids.length && planned(s)) return plan.concat(s.record?.approved ? [record({ approveOnPlan: { by: null } })] : [], fire('implement-roadmap', { mode: 'replan' }))
        if (s.record?.verifyDue && kids.length && kids.every((c) => c.state !== 'open')) {
          if (!verifiedAlready(s, kids)) return plan.concat(record({ verifyDue: false }), fire('revise-roadmap', verifyFlags(kids)))
          // Then end as an unlock with nothing re-armed would.
          plan.push(record({ verifyDue: false }), note('the verify that just ended already read every child'))
        }
        // write-ticket promoted it, or it was typed while a session ran.
        if (needsIntake(s, config) && finished !== 'revise-roadmap') return plan.concat(fire('revise-roadmap', { mode: 'intake' }))
      }
      if (inFlight(s)) plan.push(status('done'), label([], [L.awaiting]))
      else if (s.botSpokeLast) plan.push(status('revising'), label([L.awaiting], []))
      else plan.push(label([L.awaiting], []), anomaly('silent', `${s.repo.full}#${s.item.number} session ended without a comment`))
      // Last: the issue's number changes once it moves. (why: docs/why.md#a-session-asks-actions-acts)
      if (isRoadmap(s, config) && req?.transfer && !(s.children || []).length && req.transfer.repo !== s.repo.name) plan.push(transfer(req.transfer.repo, req.transfer.milestone))
      return plan
    }
    case 'ci':
      return isBot(s.pr?.user?.login, config) ? evaluatePr(s, config) : [note('not a bot PR')]
    // Residue from a pass that won the lease and died before the label. Both
    // the label and `rec.current` must be absent: the winner writes them in
    // that order, so either one present means a live session.
    //
    // ⚠ That is not a proof, only a narrowing. The per-item concurrency group
    // is scoped to one repository, so a cross-repo fire that wins the CAS is
    // unguarded until it writes the lock — one API call later. A sweep leg
    // needs a checkout and a gather to reach here, so the window is far
    // narrower than the cost of leaving a lease unreclaimed.
    case 'sweep-lease': {
      if (s.locked) return [note('the lock is on the item — the lease is live')]
      if (s.record?.current) return [note(`${s.record.current.handler} is still recorded — the lease is live`)]
      return [releaseLease('no lock and no session on the item')]
    }
    case 'sweep-retry':
      return [{ type: 'retry' }]
    case 'sweep-timeout':
      return [{ type: 'timeout' }]
    case 'sweep-recheck':
      return decide({ ...target, reason: 'unlock', facts: {} }, s, config)
    case 'sweep-pr':
      return quietSweep(evaluatePr(s, config), s, config)
    case 'sweep-orphan': {
      // `sweep-pr` already ran the derivation this pass. If it found work, say
      // nothing — a draft moving forward is not an orphan.
      const p = evaluatePr(s, config)
      if (p.some((a) => ['fire', 'armAutoMerge', 'markReady', 'targets'].includes(a.type))) return [note('still moving — not an orphan')]
      return quietSweep(p.concat(label([L.awaiting], []), commentOnce(`orphan ${s.pr?.head?.sha}`, `This draft has had no CI activity for hours and no session holds it. A mention (\`${config.dispatch.commandPrefix}\`) or a push from you starts me again.`), anomaly('orphan', `${s.repo.full}#${s.pr?.number} orphaned draft`)), s, config)
    }
    case 'sweep-awaiting': {
      if (s.locked || (s.item.labels || []).includes(L.stuck) || (s.item.labels || []).includes(L.awaiting)) return [note('no correction')]
      // This arm alone is pushed for PRs as well as issues (sweep.mjs:112), and
      // a PR snapshot carries no such key. The `kind` test is what lets every
      // read of it stay bare. (why: docs/why.md#a-pr-is-the-answer-to-an-implement-verb)
      if (s.kind === 'issue' && inFlight(s)) return [note('an open PR closes it — the PR is the turn')]
      if (s.botSpokeLast) return [label([L.awaiting], []), anomaly('awaiting-drift', `${s.repo.full}#${s.item.number} awaiting was missing`)]
      return [note('human spoke last')]
    }
    default:
      return [note(`no rule for ${target.reason}`)]
  }
}

export const _internal = { needsAddressReview, ownReview, pendingReviewVerb, underThreshold, quietSweep, lastHumanWordAt, lastEndedImplement, endedFixCiFor, LOCK_FREE_STATUS_ONLY }
