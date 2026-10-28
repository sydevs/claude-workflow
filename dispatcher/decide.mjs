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

import { parseVerb, parseBlock, parseHold } from './verbs.mjs'
import { pushRoute, relayRefusal } from './relay.mjs'
import { failedDeploys } from '../workflow/lib/railway.mjs'

// ---- action constructors ----------------------------------------------
export const fire = (handler, flags = {}) => ({ type: 'fire', handler, flags })
export const recheck = () => ({ type: 'recheck' })
export const label = (add = [], remove = []) => ({ type: 'label', add, remove })
/** The last action of every plan: `apply` derives Status from the state the plan left. (why: docs/why.md#status-is-derived-never-read) */
export const syncStatus = () => ({ type: 'syncStatus' })
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
/** Set the Hold Until date, or clear it with `null`. */
export const hold = (date) => ({ type: 'hold', date })
/** A pass on an item whose session ended with no unlock seen: archive it, release the lease. */
export const archiveCurrent = () => ({ type: 'archiveCurrent' })
export const transfer = (repo, milestone) => ({ type: 'transfer', repo, milestone })
export const relay = ({ branch, head, sha }) => ({ type: 'relay', branch, head, sha })

// ---- predicates ------------------------------------------------------
const lower = (s) => String(s || '').toLowerCase()

/**
 * A login is the loop's own, case aside. The expected login must be named, and
 * a missing one throws: a seam that forgets to thread it would otherwise refuse
 * every comment, which `loadRecord` reports as no record at all and
 * `sweep.mjs` then reads as a timed-out lease on a live session.
 * (why: docs/why.md#a-dispatcher-owned-marker-is-qualified-by-its-author)
 */
export function isLogin(login, expected) {
  if (!expected) throw new Error('isLogin: the expected login is required')
  return lower(login) === lower(expected)
}
export function isBot(login, config) {
  return isLogin(login, config.identity?.expectedLogin)
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
 * A PR the loop works in full: the bot's own, or one a `respondTo` login
 * wrote. Anyone else's gets an answer to a mention and nothing more, so a
 * stranger's PR cannot spend sessions. (why: docs/why.md#a-members-pr-gets-the-loop)
 */
export function fullTreatment(login, config) {
  return isBot(login, config) || respondTo(login, config)
}
/**
 * A PR based on another branch than the default. The loop never opens one
 * and never works one: it has no ruleset behind it, so armed it would merge
 * unreviewed. (why: docs/why.md#a-stacked-pr-is-never-armed)
 */
export function stackedPr(s) {
  const base = s.pr?.base
  return Boolean(base?.defaultBranch && base.ref !== base.defaultBranch)
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
const nowOf = (s) => s.now || new Date()
/** Approval is the dispatcher's memory, not a Status. (why: docs/why.md#approval-lives-in-the-record) */
const approve = (s, by) => record({ approved: { by: by || null, at: nowOf(s).toISOString() } })
const withdraw = (s) => (s.record?.approved ? [record({ approved: null })] : [])
/**
 * The machinery gave up, so the item is yours until you act: Status reads
 * Awaiting with this reason. Any verb, mention, review or push of yours clears it.
 */
const handback = (s, reason) => record({ handback: { reason, at: nowOf(s).toISOString() } })
const clearHandback = (s) => (s.record?.handback ? [record({ handback: null })] : [])

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

/** The handlers that may ask for another session to finish their work. */
const CONTINUES = new Set(['implement', 'address-review'])

/**
 * A session near its deadline pushed what it built and asked for another.
 * It starts at once, with the same flags, up to `dispatch.maxAttempts` in a
 * row, then the item is your turn. (why: docs/why.md#a-feature-is-built-in-one-session)
 */
function continueNext(s, config, handler) {
  const n = (s.record?.continues || 0) + 1
  if (n <= (config.dispatch.maxAttempts ?? 3)) return [record({ continues: n }), fire(handler, { ...(s.record?.current?.flags || {}), continuation: n })]
  const p = config.dispatch.commandPrefix
  const number = s.kind === 'pr' ? s.pr?.number : s.item.number
  return [
    record({ continues: 0 }),
    handback(s, `not finished after ${n} sessions in a row`),
    commentOnce(`continue-cap ${s.record?.current?.firedAt || ''}`, `Not finished after ${n} sessions in a row. The branch holds what is built, and the comment above says what remains. A mention (\`${p}\`) starts me again.`),
    anomaly('continue-cap', `${s.repo.full}#${number} not finished after ${n} sessions`),
  ]
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
export function isQuestion(root, config) {
  const marker = config.review?.questionMarker || '<!-- sydevs-question -->'
  return isBot(root.author, config) && String(root.body || '').includes(marker)
}

/**
 * On a member's own PR the loop answers only the threads it rooted, and only
 * a review someone else left: a member's notes to themselves are not a
 * request. (why: docs/why.md#a-members-pr-gets-the-loop)
 */
export function needsAddressReview(snapshot, config) {
  const since = botLastWordAt(snapshot.comments, config)
  const author = snapshot.pr?.user?.login
  const memberPr = Boolean(author) && !isBot(author, config)
  for (const t of snapshot.threads || []) {
    if (t.isResolved) continue
    const cs = t.comments || []
    if (!cs.length) continue
    const root = cs[0]
    const last = cs[cs.length - 1]
    if (memberPr && !isBot(root.author, config)) continue
    if (respondTo(last.author, config) && !isBot(last.author, config)) return 'a thread waits on a reply'
    if (isQuestion(root, config)) continue
    if (isBot(root.author, config) && !cs.slice(1).some((c) => isBot(c.author, config))) return 'own-rooted thread unanswered'
  }
  for (const r of snapshot.reviews || []) {
    if (!respondTo(r.user?.login, config) || isBot(r.user?.login, config)) continue
    if (memberPr && lower(r.user?.login) === lower(author)) continue
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
    handback(s, `CI failed on infrastructure: ${names}`),
    commentOnce(`ci-infra ${sha}`, `CI failed on infrastructure, not on this change: ${names}.${tried} Re-run it once the service is back, or push.`),
    anomaly('ci-infra', `${s.repo.full}#${s.pr.number} infrastructure: ${names}`),
  ]
}

/** A queue failure recorded against this head, while nothing has re-armed it. */
function queueFailure(s) {
  const q = s.record?.queueFail
  return q?.sha && q.sha === s.pr?.head?.sha && !s.pr?.autoMergeArmed ? q : null
}

/** Fire `fix-ci` on this head, once per head and up to the ceiling, then hand it to a person. */
function repairPlan(s, config, reason, flags = {}) {
  const pr = s.pr
  const ended = endedFixCiFor(s.record, pr.head?.sha)
  // It stood down on this head, and its comment says why: your turn, until a
  // push gives it a new head.
  if (ended) return [...(s.record?.handback ? [] : [handback(s, `fix-ci ran on ${String(pr.head.sha).slice(0, 7)} and CI is still red`)]), note(`fix-ci ${ended.outcome || 'ran'} on ${String(pr.head.sha).slice(0, 7)} — a push to a new head is what asks again`)]
  const cap = config.ceilings?.ciFixIterations ?? 3
  if ((s.record?.fixCi || 0) < cap) return [bumpFixCi(), fire('fix-ci', flags)]
  // The cap comment promises that a person's push starts the repair again,
  // so a head they pushed since the last fix-ci resets the count.
  // (why: docs/why.md#a-push-from-a-person-resets-the-repair-count)
  if (isHuman(s.headAuthor, config) && pr.head?.sha && pr.head.sha !== lastFixCiSha(s.record)) return [record({ fixCi: 0 }), bumpFixCi(), fire('fix-ci', flags)]
  return [
    handback(s, `CI still red after ${cap} fix attempts`),
    commentOnce(`ci-capped ${pr.head?.sha}`, `CI is still red after ${config.ceilings.ciFixIterations} fix attempts (${reason}). I have stopped retrying. A mention or a push from you starts me again.`),
    anomaly('ci-capped', `${s.repo.full}#${pr.number} CI capped: ${reason}`),
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
 * nothing downstream of this — fix-ci, the critic — can ever move it: the
 * conflict goes first. One exception: a resolve-conflicts session that
 * already ended on this head, or is ending now, stopped on a conflict it
 * would not guess, so that is your turn, until a push gives it a new head.
 */
export function conflictPlan(s, config) {
  const sha = s.pr.head?.sha
  const ran = (d) => d?.handler === 'resolve-conflicts' && sha && d.sha === sha
  const ended = (s.record?.dispatches || []).find((d) => ran(d) && d.outcome) || (ran(s.record?.current) ? s.record.current : null)
  if (ended) return [...(s.record?.handback ? [] : [handback(s, 'it still conflicts after resolve-conflicts ran on this head')]), note(`resolve-conflicts ${ended.outcome || 'ran'} on ${String(sha).slice(0, 7)} and it still conflicts — a push to a new head is what asks again`)]
  return [fire('resolve-conflicts')]
}

/**
 * Required CI is green, and a Railway preview `railway.statusContexts` lists
 * failed. One `fix-ci` pass in `deploy` mode reads its log, once per head,
 * with no `bumpFixCi`: it never spends a `ceilings.ciFixIterations` pass.
 * (why: docs/why.md#a-failed-preview-is-read-from-its-log)
 */
function deployPass(s, config) {
  if (!failedDeploys(s.ci?.advisory, config).length) return null
  if (deployPassFor(s.record, s.pr.head?.sha)) return null
  return advisoryNote(s).concat(fire('fix-ci', { mode: 'deploy' }))
}

function underThreshold(pr, config) {
  const w = config.review?.skipWhen
  if (!w) return false
  return Boolean(pr.contractSyncOnly) || ((pr.changed_files ?? Infinity) <= w.maxFiles && (pr.additions ?? 0) + (pr.deletions ?? 0) <= w.maxLines)
}

/** Repos where a merge is a deploy, so nothing is ever armed. */
export function loopMayNotMerge(snapshot, config) {
  return (config.mergePolicy?.loopMayNotMerge || []).includes(snapshot.repo.name)
}

// The actions that move an item. Every other action — a label, a comment, a
// status, an anomaly — only restates where it already is.
const MOVES = new Set(['fire', 'armAutoMerge', 'markReady', 'recheck', 'targets', 'rerunJobs'])

/**
 * A sweep pass over an item last left Awaiting says nothing unless the
 * derivation moves it.
 *
 * New activity is anything that ends Awaiting, and every way to end it is an
 * event the dispatcher already wakes on. So a plan with no move is the plan
 * the last pass ran, and running it again writes the same `commentOnce` and
 * the same anomaly. (why: docs/why.md#a-quiet-awaiting-item-is-swept-in-silence)
 */
function quietSweep(plan, s, config) {
  if (s.record?.status !== 'awaiting') return plan
  if (plan.some((a) => MOVES.has(a.type))) return plan
  return [note('awaiting with no new activity — nothing to add')]
}

// ---- the one derivation every PR event funnels into ----------------------
export function evaluatePr(s, config) {
  const pr = s.pr
  if (!pr || pr.state !== 'open') return []
  if (!fullTreatment(pr.user?.login, config)) return []
  if (s.locked) return [recheck()]
  // A member's draft is their own work in progress until it is ready or they
  // mention the bot. (why: docs/why.md#a-members-pr-gets-the-loop)
  if (pr.draft && !isBot(pr.user?.login, config)) return [note('a member draft — left alone until it is ready')]
  // Nothing runs on a stacked PR: no critic, no repair, no arming. Said once.
  // (why: docs/why.md#a-stacked-pr-is-never-armed)
  if (stackedPr(s)) return [commentOnce(`stacked ${pr.base.ref}`, `This PR is stacked on \`${pr.base.ref}\`. Merge it into that branch, or retarget it to \`${pr.base.defaultBranch}\`: the loop does not work stacked PRs, so nothing runs here until then.`)]
  // The session that holds the linked issue still owns this branch. A repo
  // with no CI is green the moment the PR opens, so without this the critic
  // fires while implement is still pushing.
  // (why: docs/why.md#the-lease-covers-the-branch-not-the-item)
  if (s.linkedLocked?.length) return [note(`${String(s.linkedLocked[0]).includes('#') ? '' : '#'}${s.linkedLocked[0]} is still locked — its session owns this branch`)]

  if (pendingReviewVerb(s, config)) return [fire('review-pr', { onDemand: true })]

  const why = needsAddressReview(s, config)
  if (why) return [note(why), fire('address-review')]

  if (s.mergeable === 'CONFLICTING') return conflictPlan(s, config)

  if (s.ci.failing.length) {
    // Red only on infrastructure: re-run it, never spend a repair on it.
    // (why: docs/why.md#an-infrastructure-failure-is-re-run-not-repaired)
    const infra = s.ci.infra || []
    if (infra.length && infra.length === s.ci.failing.length) return infraPlan(s, config, infra)
    return repairPlan(s, config, s.ci.reason)
  }
  if (s.ci.running.length || !s.ci.green) return [note(`waiting on CI: ${s.ci.reason}`)]
  // Green here and red in the queue: the PR breaks against the base it will
  // land on. Repaired like red CI, never re-armed into the same failure.
  // (why: docs/why.md#a-queue-failure-is-a-ci-failure)
  const queued = queueFailure(s)
  if (queued) return repairPlan(s, config, 'the merge queue run failed', queued.run ? { queueRun: queued.run } : {})
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
  // A consumer built beside its producer is reviewed with it, and merges
  // after it. (why: docs/why.md#a-cross-repo-set-is-built-together)
  const waitsOn = s.linkedBlockedOpen?.length ? s.linkedBlockedOpen.join(', ') : null
  // evaluatePr stops a stacked PR before here; never arming one is the
  // guard behind that. (why: docs/why.md#a-stacked-pr-is-never-armed)
  const mayArm = !loopMayNotMerge(s, config) && !waitsOn && !stackedPr(s)

  if (pr.draft) {
    // implement opens the PR only once the ticket is built, so the critic
    // reads the whole of it, once. (why: docs/why.md#a-feature-is-built-in-one-session)
    const small = underThreshold(pr, config)
    if (!ownReview(s, config) && !small) return [fire('review-pr')]
    // GitHub refuses auto-merge on a draft, so this is the first moment it can
    // be armed. From here the ruleset decides: approval, resolved threads and
    // green CI, then the queue. (why: docs/why.md#github-owns-the-merge)
    const plan = [markReady(), requestReviewer()]
    if (mayArm) plan.push(armAutoMerge())
    if (waitsOn) plan.push(commentOnce(`waits-on ${waitsOn}`, `Ready to review with ${waitsOn}. It merges after ${waitsOn} does: auto-merge is armed once that closes, after its contract re-sync lands here.`))
    if (small && !ownReview(s, config)) {
      const why = pr.contractSyncOnly ? 'this PR only re-syncs a copied contract' : `${pr.changed_files} file(s), ${(pr.additions || 0) + (pr.deletions || 0)} changed line(s), under \`review.skipWhen\``
      plan.push(commentOnce(`critic-skipped ${pr.head?.sha}`, `Adversarial review skipped: ${why}. Say \`${config.dispatch.commandPrefix} review\` to force one.`))
    }
    return plan
  }

  // A member's PR reaches ready without the bot's draft pass, so it gets the
  // critic and the reviewer request here, once.
  // (why: docs/why.md#a-members-pr-gets-the-loop)
  const member = !isBot(pr.user?.login, config)
  if (member && !ownReview(s, config) && !underThreshold(pr, config)) return [requestReviewer(), fire('review-pr')]
  const plan = member ? [requestReviewer()] : []

  // The dispatcher no longer merges. GitHub does, once the ruleset is
  // satisfied — one approval, every thread resolved, CI green — and the queue
  // rebases and tests before it lands. All that is left here is arming a PR
  // that reached ready without it. (why: docs/why.md#github-owns-the-merge)
  if (mayArm && !s.pr?.autoMergeArmed) return plan.concat(armAutoMerge())
  // Approved, and a thread still waits on you: the ruleset will not merge it
  // until that thread is resolved, so say which.
  // (why: docs/why.md#an-approved-pr-names-what-holds-it)
  if (s.normalized?.reviewDecision === 'APPROVED') {
    for (const t of threadsWaiting(s, config)) {
      const url = t.comments?.[0]?.url
      plan.push(commentOnce(`approved-thread ${t.id}`, `Approved, but this thread still waits on you, and the ruleset will not merge until it is resolved: ${url || 'see the review threads'}. Reply there, or resolve it.`))
    }
  }
  return plan
}

/**
 * Unresolved threads whose last word is the bot's: a question it asked, or a
 * reply it gave that nobody resolved. Each one waits on a person. A finding
 * the bot rooted and never answered is the bot's own turn instead.
 */
export function threadsWaiting(s, config) {
  return (s.threads || []).filter((t) => {
    if (t.isResolved) return false
    const cs = t.comments || []
    return cs.length > 0 && isBot(cs[cs.length - 1].author, config) && (isQuestion(cs[0], config) || cs.length > 1 || !isBot(cs[0].author, config))
  })
}

// ---- issue verbs ------------------------------------------------------

/** An unticked open question is a decision still owed, so nothing is built yet. (why: docs/why.md#a-decision-is-settled-before-the-build) */
function refuseOpenQuestions(s, config, facts) {
  const p = config.dispatch.commandPrefix
  return [
    commentOnce(`open-questions ${facts.commentId || ''}`, `Not started: ${s.openQuestions.open} open question(s) in the body still need an answer. Reply \`${p} revise\` with your choices (for example \`1A\`), then say \`${p} implement\` again.`),
  ]
}

const refList = (list) => list.map((b) => '#' + b.number).join(', ')

/**
 * `implement` approves, and starts the build when nothing stands in the way.
 * A hold is cleared, because the verb is the answer the hold was waiting for.
 * An open blocker keeps it Pending: it starts by itself when the last one
 * closes. (why: docs/why.md#approval-lives-in-the-record)
 */
function implementTicket(s, config, facts) {
  const prs = inFlight(s)
  if (prs) return [commentOnce(`in-flight ${prs[0]}`, `#${prs[0]} is already open for this ticket, so I will not start a second implementation.`)]
  if (s.openQuestions?.open) return refuseOpenQuestions(s, config, facts)
  const out = [approve(s, facts.author)]
  if (parked(s)) out.push(hold(null), note(`hold until ${s.park.until} cleared — implement answers it`))
  if (s.blockedByOpen.length) {
    return out.concat(commentOnce(`approved-blocked ${facts.commentId || ''}`, `Approved. It waits on ${refList(s.blockedByOpen)}, and starts by itself when the last one closes.`))
  }
  if (s.locked) return out.concat(recheck())
  if (s.parent?.setBuild) return out.concat(note(`its goal's set build is building it — ${s.parent.repo.full}#${s.parent.number}`))
  return out.concat(fire('implement'))
}

/** Open children no PR answers and no session holds: the ones an approval can still start. */
const unstarted = (s) => (s.children || []).filter((c) => c.state === 'open' && !c.prs && !c.locked)

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
 * A blocked goal records the approval and plans when its blocker closes.
 * (why: docs/why.md#one-verb-plans-and-approves)
 */
function implementGoal(s, config, facts) {
  if (s.openQuestions?.open) return refuseOpenQuestions(s, config, facts)
  const out = [approve(s, facts.author)]
  if (s.blockedByOpen.length) {
    return out.concat(commentOnce(`approved-blocked ${facts.commentId || ''}`, `Approved. It waits on ${refList(s.blockedByOpen)}, and is planned by itself when the last one closes.`))
  }
  if (parked(s)) out.push(hold(null), note(`hold until ${s.park.until} cleared — implement answers it`))
  const open = (s.children || []).filter((c) => c.state === 'open')
  if (planned(s) && open.length && !doubledUp(s)) return out.concat(approveChildren(s, config, facts))
  if (s.locked) return out.concat(recheck())
  return out.concat(record({ approveOnPlan: { by: facts.author || null } }), fire('implement-roadmap', { mode: planned(s) && open.length ? 'replan' : 'plan' }))
}

const refOf = (c) => `${c.repo?.full || `${c.owner}/${c.repo}`}#${c.number}`

/**
 * The unstarted children one session can build together: each blocked only
 * by others in the set, so the producer and its consumers share a build and
 * a review, and only the merge waits. (why: docs/why.md#a-cross-repo-set-is-built-together)
 */
function buildSet(todo) {
  let set = todo
  for (;;) {
    const keys = new Set(set.map(refOf))
    const next = set.filter((c) => (c.blockedByOpen || []).every((b) => keys.has(refOf(b))))
    if (next.length === set.length) return set
    set = next
  }
}

/**
 * Approve every unstarted child. Two or more that are free together build as
 * one set, on the goal's lock. The rest start alone, now or once their
 * blocker closes.
 */
function approveChildren(s, config, facts) {
  if (s.locked) return [recheck()]
  const todo = unstarted(s)
  if (!todo.length) return [note('every open child already has a PR')]
  const parent = `${s.repo.full}#${s.item.number}`
  const by = facts.author || null
  const set = buildSet(todo)
  const together = set.length > 1 ? set : []
  const alone = todo.filter((c) => !together.includes(c))
  const how = together.length ? `${together.map(refOf).join(', ')} build together now, and merge in order.` : ''
  const rest = alone.length ? `${alone.map(refOf).join(', ')} ${alone.length === 1 ? 'starts' : 'each start'} now, or once ${alone.length === 1 ? 'its blocker closes' : 'their blockers close'}.` : ''
  const plan = [
    commentOnce(`approve-all ${facts.commentId || todo.map(refOf).join(' ')}`, `Approved ${todo.length} implementation ticket(s). ${[how, rest].filter(Boolean).join(' ')}`),
    targets([
      ...together.map((c) => ({ repo: c.repo, kind: 'issue', number: c.number, reason: 'approve-set', facts: { by, parent } })),
      ...alone.map((c) => ({ repo: c.repo, kind: 'issue', number: c.number, reason: 'approve', facts: { by, parent } })),
    ]),
  ]
  if (together.length) plan.push(fire('implement', { mode: 'set', children: together.map(refOf) }))
  return plan
}

/** A PR is merged or closed, never parked. (why: docs/why.md#a-pr-is-merged-or-closed-never-held) */
function refusePrPark(s, config, facts, verb) {
  return [commentOnce(`pr-park ${facts.commentId || ''}`, `Not ${verb === 'hold' ? 'held' : 'blocked'}: a PR is merged or closed, never parked. Close it if it should wait, and reopen it when it can go.`)]
}

/**
 * `block on <ref>` is mechanical, and keeps an approval: the ticket starts
 * when the last blocker closes. `block until <reason>` and `block <reason>`
 * ask a session to turn the reason into a relationship or a hold.
 * (why: docs/why.md#a-hold-is-a-date-not-a-recheck)
 */
function blockVerb(s, config, facts) {
  const p = config.dispatch.commandPrefix
  const b = parseBlock(facts.body, config.dispatch, config.org)
  const key = facts.commentId || ''
  if (b.form === 'on') {
    if (!b.refs.length) return [commentOnce(`block-refused ${key}`, `Not blocked: name the blocker as a full issue URL or \`owner/repo#N\`, for example \`${p} block on ${config.org}/SahajCloud#632\`.`)]
    const refs = b.refs.map((r) => `${r.owner}/${r.repo}#${r.number}`).join(', ')
    const then = s.record?.approved ? 'It is still approved, and starts by itself when the last one closes.' : 'When the last one closes it comes back to you.'
    return [relationships(b.refs), commentOnce(`block-on ${key}`, `Blocked by ${refs}. ${then}`)]
  }
  if (s.locked) return [recheck()]
  return [fire(isRoadmap(s, config) ? 'revise-roadmap' : 'revise', { mode: 'block' })]
}

/**
 * A bare `hold` spreads the dates it picks across `issueFields.holdUntil.defaultDays`,
 * keyed on the item, so a batch held together does not come back together.
 */
function defaultHoldDate(s, config) {
  const [lo, hi] = config.issueFields?.holdUntil?.defaultDays || [30, 90]
  const key = `${s.repo?.full || ''}#${s.item?.number || 0}`
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const days = lo + (h % Math.max(1, hi - lo + 1))
  return new Date(nowOf(s).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * `hold [until] <N days|weeks|months|date>` parks the ticket on a date, and
 * withdraws any approval: a held ticket comes back to you, never straight
 * into a build. (why: docs/why.md#a-hold-is-a-date-not-a-recheck)
 */
function holdVerb(s, config, facts) {
  const p = config.dispatch.commandPrefix
  const key = facts.commentId || ''
  const h = parseHold(facts.body, config.dispatch, nowOf(s))
  if (h.form === 'invalid') return [commentOnce(`hold-refused ${key}`, `Not held: \`${h.text}\` is not a date. Say \`${p} hold\`, \`${p} hold 3 weeks\`, \`${p} hold 2 months\` or \`${p} hold until 2026-12-01\`.`)]
  const date = h.form === 'default' ? defaultHoldDate(s, config) : h.date
  const days = config.issueFields?.holdUntil?.maxHorizonDays ?? 180
  const today = nowOf(s).toISOString().slice(0, 10)
  const limit = new Date(nowOf(s).getTime() + days * 86_400_000).toISOString().slice(0, 10)
  if (date <= today || date > limit) return [commentOnce(`hold-refused ${key}`, `Not held: ${date} must be after today and no later than ${limit} (${days} days).`)]
  const was = Boolean(s.record?.approved)
  return [hold(date), ...withdraw(s), commentOnce(`hold ${key}`, `Held until ${date}. It comes back to you then.${was ? ` The approval is withdrawn: say \`${p} implement\` when it should start.` : ''}`)]
}

/**
 * One comment per live `Blocked by` line that names a target and resolves no
 * in-org issue. `stripBlockedBy` leaves such a line in the body, rightly — it
 * is the only record of the author's intent — so unreported it reads as
 * blocked to every human and as ready to the machinery. No label,
 * relationship or Status moves for it, because `blocked` follows the
 * relationship and this line made none. The message says that, rather than
 * "not blocked": a sibling line that did resolve can be applying `blocked`
 * in the same plan.
 * (why: docs/why.md#an-unresolved-blocker-line-is-reported)
 *
 * Keyed on the targets, not the whole line: there is no comment id on this
 * path, and the author rewording the reason must not re-post the advice.
 * Sorted, so reordering the targets does not either.
 */
function refuseUnresolvedBlockers(s, config) {
  // Guarded, unlike its `blockedBy` neighbour: a snapshot assembled by hand
  // predates the field, and `decide` must stay total over one.
  return (s.markers.unresolvedBlockers || []).map(({ line, targets }) =>
    commentOnce(
      `blocker-unresolved ${[...targets].sort().join(' ')}`,
      [
        `No relationship created: ${targets.join(', ')} ${targets.length > 1 ? 'name' : 'names'} no ${config.org} issue.`,
        `> ${line}`,
        `Name the blocker as a full issue URL or \`owner/repo#N\`. A PR URL and a bare \`#N\` are ignored — block on the issue a PR closes.`,
      ].join('\n\n'),
    ))
}

// ---- per-event deciders ------------------------------------------------

/**
 * `decide(target, snapshot, config)` → plan[].
 *
 * `target.reason` names the event row: `issues.opened`, `issue_comment`,
 * `pull_request.synchronize`, `review`, `review_comment`, `thread`, `ci`,
 * `queue-failed`, `unlock`, `unblock-check`, `conflict-scan`, `reconcile`,
 * `sweep-*`. `target.facts` carries what the payload said — used only to pick
 * the row; state comes from the snapshot.
 *
 * Every plan but a journal issue's or a spike's ends in `syncStatus`: no row
 * names a Status, because `apply` derives it from the state the plan left.
 * (why: docs/why.md#status-is-derived-never-read)
 */
/**
 * The session left its commits on a relay branch and asked for them to land.
 * The push that lands them is the next event, so nothing else runs now.
 * (why: docs/why.md#the-relay)
 */
function relayPlan(s, config, req) {
  const why = relayRefusal(s, config, req, fullTreatment)
  if (!why) return [relay(req)]
  return [
    handback(s, `the relay was refused: ${why}`),
    commentOnce(`relay-refused ${req.sha}`, `The session left its work on \`${req.branch}\`, but I could not land it here: ${why}. The branch is kept; merge it yourself, or mention me (\`${config.dispatch.commandPrefix}\`) to try again.`),
  ]
}

/** Every session fired at a PR carries where it may push. (why: docs/why.md#the-branch-decides-where-a-session-pushes) */
function withPushRoute(plan, s, config) {
  if (s.kind !== 'pr') return plan
  const push = pushRoute(s, config, fullTreatment)
  return plan.map((a) => (a.type === 'fire' && !a.flags?.push ? { ...a, flags: { ...(a.flags || {}), push } } : a))
}

export function decide(target, s, config) {
  let plan = withPushRoute(route(target, s, config), s, config)
  // A fresh implement or address-review starts its own count of continuations.
  if (s.record?.continues && plan.some((a) => a.type === 'fire' && CONTINUES.has(a.handler) && !a.flags?.continuation)) plan = plan.concat(record({ continues: 0 }))
  if (untouched(s, config)) return plan
  return plan.concat(syncStatus())
}

/** Items the dispatcher writes nothing to, Status included. */
function untouched(s, config) {
  return (s.item?.labels || []).includes(config.labels.journal) || isSpike(s, config)
}

/**
 * The approved ticket is free: build it. The same guards as the verb, without
 * recording the approval again. A ticket that turned out not free comes back
 * with the session's question. A goal is only ever planned here, never has
 * its children approved: approving them is a person's verb.
 * (why: docs/why.md#approval-lives-in-the-record)
 */
function startApproved(s, config, commentId) {
  if (isRoadmap(s, config)) {
    if (planned(s)) return [note('an approved goal already planned — its children carry their own approvals')]
    if (s.locked) return [recheck()]
    return [record({ approveOnPlan: { by: s.record.approved.by || null } }), fire('implement-roadmap', { mode: 'plan' })]
  }
  if (inFlight(s)) return [note(`#${inFlight(s)[0]} is already open for it`)]
  if (s.openQuestions?.open) return withdraw(s).concat(refuseOpenQuestions(s, config, { commentId }))
  if (s.locked) return [recheck()]
  if (s.parent?.setBuild) return [note(`its goal's set build is building it — ${s.parent.repo.full}#${s.parent.number}`)]
  return [fire('implement')]
}

/**
 * A Pending wait the machinery owns has sat past `dispatch.pendingDueMinutes`
 * with nothing moving it. Check again, up to `dispatch.maxAttempts` times,
 * then hand it to you with the reason. (why: docs/why.md#pending-has-a-due-awaiting-has-a-reason)
 */
function overdue(s, config) {
  const since = s.record?.pendingSince
  const minutes = config.dispatch.pendingDueMinutes ?? 120
  return Boolean(since) && nowOf(s).getTime() - Date.parse(since) > minutes * 60_000
}
function dueStep(s, config, why) {
  const n = (s.record?.dueAttempts || 0) + 1
  const max = config.dispatch.maxAttempts ?? 3
  const p = config.dispatch.commandPrefix
  if (n <= max) return [record({ dueAttempts: n, pendingSince: nowOf(s).toISOString() }), note(`pending past its due, check ${n} of ${max}: ${why}`)]
  const number = s.kind === 'pr' ? s.pr?.number : s.item.number
  return [
    record({ dueAttempts: 0 }),
    handback(s, `${why}, and nothing moved it in ${max} checks`),
    commentOnce(`overdue ${s.record?.pendingSince || ''}`, `This has waited on the machinery past its due ${max} times: ${why}. I have stopped checking. A ${s.kind === 'pr' ? 'mention, review or push' : `\`${p}\` verb or mention`} from you starts me again.`),
    anomaly('pending-overdue', `${s.repo.full}#${number}: ${why}`),
  ]
}

function route(target, s, config) {
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
      const bornBlocked = s.blockedByOpen.length || blockers.length || parkedHere
      plan.push({ type: 'ensure' })
      if (isBot(s.item.author, config)) plan.push(label([L.proposal], []))
      if (blockers.length) plan.push(relationships(blockers, true))
      // An outsider's own markers are already text, so there is nothing to refuse.
      if (!outsider) plan.push(...refuseUnresolvedBlockers(s, config))
      // Nothing the loop files is revised on arrival any more: every author
      // writes through write-ticket, so a proposal arrives fully specified.
      // (why: docs/why.md#one-author-writes-every-implementation-ticket)
      if (!bornBlocked && needsIntake(s, config)) plan.push(s.locked ? recheck() : fire('revise-roadmap', { mode: 'intake' }))
      return plan
    }
    case 'issues.typed': {
      plan.push({ type: 'ensure' })
      if (isRoadmap(s, config) && needsIntake(s, config) && !blockedNow(s)) plan.push(s.locked ? recheck() : fire('revise-roadmap', { mode: 'intake' }))
      return plan
    }
    case 'issues.edited': {
      // An outsider editing their own issue cannot create a relationship or a
      // park. Only the author of an issue, the bot or a maintainer can edit
      // its body, so this is the one case to refuse.
      // (why: docs/why.md#a-strangers-marker-is-text)
      if (facts.sender && byOutsider(s, config) && lower(facts.sender) === lower(s.item.author)) return [note('edited by its non-member author — markers are text')]
      if (s.markers.blockedBy.length) plan.push(relationships(s.markers.blockedBy, true))
      // No outsider guard here: the early return above already refused the one
      // case where the editor cannot make state.
      plan.push(...refuseUnresolvedBlockers(s, config))
      return plan.length ? plan : [note('no marker change')]
    }
    // A reopened item is a fresh verdict: whatever approval it had is spent.
    case 'issues.reopened':
    case 'issues.transferred':
      return [{ type: 'ensure' }, ...withdraw(s), ...clearHandback(s)]
    case 'issues.closed': {
      const next = s.dependents.map((d) => ({ ...d, reason: 'unblock-check', facts: { closedNumber: s.item.number } }))
      // The last child of a roadmap ticket closing is the cue to check the
      // goal was met. (why: docs/why.md#a-goal-is-verified-not-assumed)
      if (s.parent?.state === 'open') next.push({ repo: s.parent.repo, kind: 'issue', number: s.parent.number, reason: 'child-closed', facts: { child: `${s.repo.full}#${s.item.number}` } })
      return [...clearHandback(s), targets(next)]
    }
    // A blocker closed, or a hold date passed. An approved ticket starts now;
    // any other comes back to you. No session rechecks it first: the
    // relationship and the date are the facts, and the build itself stops with
    // a question if the ticket is not free after all.
    // (why: docs/why.md#a-hold-is-a-date-not-a-recheck)
    case 'unblock-check': {
      if (s.blockedByOpen.length) return [note(`still blocked by ${refList(s.blockedByOpen)}`)]
      if (parked(s)) return [note(`held until ${s.park.until}`)]
      if (s.kind !== 'issue') return [note('not an issue')]
      if (s.item.state !== 'open') return [note('closed')]
      // Built in a set while its producer was open: the blocker merging lets
      // its PR merge too. No session is needed. (why: docs/why.md#a-cross-repo-set-is-built-together)
      // A contract consumer is armed by the event its re-sync push raises,
      // never before it lands; the sweep catches one that needs none.
      if (inFlight(s)) {
        if (config.contractSync?.consumers?.[s.repo.name]) return [note('free — its PR arms after the contract re-sync lands')]
        return [targets(inFlight(s).map((n) => ({ repo: s.repo, kind: 'pr', number: n, reason: 'ci' })))]
      }
      if (s.parent?.setBuild) return [note('free — its goal\'s set build is building it')]
      if (s.record?.approved) return startApproved(s, config, `unblocked-${facts.closedNumber || s.park?.until || ''}`)
      const p = config.dispatch.commandPrefix
      if (facts.closedNumber) return [commentOnce(`unblocked ${facts.closedNumber}`, `#${facts.closedNumber} closed, so nothing blocks this now. Say \`${p} implement\` to start it, or \`${p} revise\` to rework it first.`)]
      return [note('free — it is yours')]
    }
    case 'issue_comment': {
      if (isBot(facts.author, config)) return [note('own comment — ignored')]
      // The author of a roadmap ticket answers its questions, member or not.
      // A stranger's words never start a session: they are read as data on
      // the next run a member starts. (why: docs/why.md#an-outsider-feeds-a-member-fires)
      if (s.kind === 'issue' && isRoadmap(s, config) && !respondTo(facts.author, config) && lower(facts.author) === lower(s.item.author)) {
        return [note('the author replied — read as data on the next run a member starts')]
      }
      if (!respondTo(facts.author, config)) return [note(`comment by ${facts.author} — not feedback`)]
      if (isHuman(facts.author, config) && !hasAccess(facts.association)) return [note(`comment by ${facts.author} without write access — not feedback`)]
      if (s.kind === 'pr') {
        const v = parseVerb(facts.body, config.dispatch, 'pr')
        // On every PR, a comment reaches the bot only through a mention. A
        // review or a thread reply on a PR it works needs none.
        // (why: docs/why.md#a-bot-pr-answers-a-mention-or-a-review)
        if (!v.mentioned) return [note(`${fullTreatment(s.pr?.user?.login, config) ? 'worked' : 'outside'} PR comment, no mention — ignored`)]
        if (v.verb === 'hold' || v.verb === 'block') return refusePrPark(s, config, facts, v.verb)
        // A member's draft is left alone, so a mention there is a request on its own.
        const memberDraft = s.pr?.draft && !isBot(s.pr?.user?.login, config)
        if (fullTreatment(s.pr?.user?.login, config) && !memberDraft) return clearHandback(s).concat(evaluatePr(s, config))
        if (s.locked) return [recheck()]
        return clearHandback(s).concat(v.verb === 'review' ? [fire('review-pr', { onDemand: true })] : [fire('address-review', { delegated: true })])
      }
      if (!isHuman(facts.author, config)) return [note('issue verbs are for humans')]
      const v = parseVerb(facts.body, config.dispatch, 'issue')
      if (!v.mentioned) return [note('no mention — ignored')]
      plan.push(label([], [L.proposal]), react('eyes'), ...clearHandback(s))
      if (v.verb === 'block') return plan.concat(blockVerb(s, config, facts))
      if (v.verb === 'hold') return plan.concat(holdVerb(s, config, facts))
      if (v.verb === 'implement') return plan.concat(isRoadmap(s, config) ? implementGoal(s, config, facts) : implementTicket(s, config, facts))
      // `revise`, `review`, or a bare mention: the ticket is changing, so any
      // approval it had is spent. (why: docs/why.md#approval-lives-in-the-record)
      plan.push(...withdraw(s))
      if (s.locked) return plan.concat(recheck())
      // A member's first word on a stranger's goal accepts it: the full review.
      if (isRoadmap(s, config)) return plan.concat(fire('revise-roadmap', { mode: reviewedBefore(s) ? 'revise' : 'intake' }))
      return plan.concat(fire('revise', { mode: 'revise' }))
    }
    // One child of a roadmap ticket, approved with the rest by `implement` on
    // the parent. A blocked child is approved now and starts when its blocker
    // closes. (why: docs/why.md#children-are-approved-together)
    case 'approve': {
      if (s.item.state !== 'open') return [note('closed — nothing to approve')]
      if (inFlight(s)) return [note(`#${inFlight(s)[0]} is already open for it`)]
      if (s.openQuestions?.open) return [commentOnce('approve-open-questions', `Not started: ${s.openQuestions.open} open question(s) here still need an answer.`)]
      plan.push(label([], [L.proposal]), approve(s, facts.by), ...clearHandback(s))
      if (parked(s)) plan.push(hold(null))
      if (s.blockedByOpen.length) return plan.concat(note('approved — starts when its blocker closes'))
      if (s.locked) return plan.concat(recheck())
      return plan.concat(fire('implement'))
    }
    // A child built in its goal's set: approved here, built by the session
    // that holds the goal. (why: docs/why.md#a-cross-repo-set-is-built-together)
    case 'approve-set':
      if (s.item.state !== 'open') return [note('closed — nothing to approve')]
      return [label([], [L.proposal]), approve(s, facts.by), ...clearHandback(s), note(`approved — built in the set on ${facts.parent}`)]
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
      return [commentOnce(`escalated ${facts.child}`, `A decision came up while working on ${facts.child}. It is in **Open questions** above, with options and a recommendation.`)]
    }
    // A review comment is a review. From a human on a worked PR that means
    // `evaluatePr`, so a cancelled sibling costs nothing — the invariant the
    // concurrency group rests on. ⚠ On an outside PR it means the verb tail,
    // which reads this one body, so a verb left in the review body is still
    // lost when that leg is the cancelled one. The bot guard is the only
    // thing this row does not share: `case 'review'`'s bot branch carries the
    // critic-header exception, which belongs to a submitted review alone.
    // (why: docs/why.md#a-review-comment-is-feedback-whatever-its-association)
    case 'review_comment': {
      if (isBot(facts.author, config)) return [note('own review comment — ignored')]
      return route({ ...target, reason: 'review' }, s, config)
    }
    case 'review': {
      if (isBot(facts.author, config)) {
        const header = config.review?.bodyHeader || '## 🧐 Adversarial review'
        const isCritic = String(facts.body || '').trimStart().startsWith(header) && fullTreatment(s.pr?.user?.login, config)
        return isCritic ? evaluatePr(s, config) : [note('own review — ignored')]
      }
      if (!respondTo(facts.author, config)) return [note(`review by ${facts.author} — ignored`)]
      if (fullTreatment(s.pr?.user?.login, config)) return clearHandback(s).concat(evaluatePr(s, config))
      const v = parseVerb(facts.body, config.dispatch, 'pr')
      if (!v.mentioned) return [note('outside PR review, no mention')]
      if (s.locked) return [recheck()]
      return v.verb === 'review' ? [fire('review-pr', { onDemand: true })] : [fire('address-review', { delegated: true })]
    }
    case 'thread':
      return fullTreatment(s.pr?.user?.login, config) ? evaluatePr(s, config) : [note('outside PR thread')]
    case 'pull_request.opened':
    case 'pull_request.reopened': {
      plan.push({ type: 'ensure' })
      if (target.reason === 'pull_request.opened' && fullTreatment(s.pr?.user?.login, config)) {
        plan.push(targets(s.linkedIssues.map((n) => ({ repo: s.repo, kind: 'issue', number: n, reason: 'linked-in-flight' }))))
      }
      return plan.concat(evaluatePr(s, config))
    }
    // The issue's Status follows its PR: Done while the PR is open.
    case 'linked-in-flight':
      return [note('an open PR closes it')]
    case 'pull_request.ready_for_review':
      return [requestReviewer()].concat(evaluatePr(s, config))
    case 'pull_request.synchronize':
      // A person's push is the answer a hand-back waits for.
      if (!facts.pusherIsBot) plan.push(...clearHandback(s))
      return plan.concat(evaluatePr(s, config))
    case 'pull_request.closed': {
      plan.push(...clearHandback(s))
      if (facts.merged) {
        for (const li of s.linkedIssueDetails || []) if (li.sentry) plan.push(sentry(li.number, li.sentry.id))
        plan.push(targets(s.otherOpenBotPrs.map((n) => ({ repo: s.repo, kind: 'pr', number: n, reason: 'conflict-scan' }))))
      } else if (isBot(s.pr?.user?.login, config)) {
        plan.push(targets(s.linkedIssues.map((n) => ({ repo: s.repo, kind: 'issue', number: n, reason: 'linked-abandoned', facts: { pr: s.pr.number } }))))
      }
      return plan
    }
    case 'linked-abandoned':
      return [...withdraw(s), commentOnce(`abandoned ${facts.pr}`, `#${facts.pr} was closed without merging, so this ticket is open again. Say \`${config.dispatch.commandPrefix} implement\` to try again.`)]
    // Drafts too: evaluatePr already leaves a branch a session holds alone.
    case 'conflict-scan':
      return evaluatePr(s, config)
    case 'unlock': {
      const finished = facts.handler || s.record?.current?.handler || null
      plan.push({ type: 'unlocked', handler: finished })
      if (CONTINUES.has(finished)) {
        const live = s.kind === 'pr' ? s.pr?.state === 'open' : s.item.state === 'open'
        if (live && freshRequest(s)?.continue) return plan.concat(continueNext(s, config, finished))
        if (s.record?.continues) plan.push(record({ continues: 0 }))
      }
      // A PR's next turn is derived like any other pass. An approved PR a
      // session just touched stays the machinery's: it is never asked about
      // again for a merge commit. (why: docs/why.md#a-resolved-conflict-is-not-a-new-question)
      if (s.kind === 'pr') {
        const req = freshRequest(s)?.relay
        if (req) return plan.concat(relayPlan(s, config, req))
        return plan.concat(evaluatePr(s, config))
      }
      const v = pendingVerb(s, config, 'issue')
      // An implement session answers with a PR, never a comment on the issue,
      // so the verb that started it still reads as pending. Re-dispatching it
      // only hits the in-flight guard. The PR is the answer.
      // (why: docs/why.md#a-pr-is-the-answer-to-an-implement-verb)
      const answered = v?.verb === 'implement' && Boolean(inFlight(s))
      if (v && !answered) return plan.concat(targets([{ repo: s.repo, kind: 'issue', number: s.item.number, reason: 'issue_comment', facts: { author: v.comment.author, body: v.comment.body, association: 'MEMBER', commentId: v.comment.id } }]))
      if (s.item.state !== 'open') return plan
      const req = freshRequest(s)
      if (req?.escalated && s.parent) plan.push(targets([{ repo: s.parent.repo, kind: 'issue', number: s.parent.number, reason: 'escalated', facts: { child: `${s.repo.full}#${s.item.number}` } }]))
      // Still held or blocked: the approval, if any, waits with it.
      if (blockedNow(s)) return plan
      if (req?.escalated && s.parent) return plan.concat(note('waits on the decision it raised on its roadmap ticket'))
      // A build that ended with no PR stopped on purpose, and its comment says
      // why. The approval is spent: the next one is yours to give.
      if (finished === 'implement' && !isRoadmap(s, config) && !inFlight(s) && !s.parent?.setBuild) plan.push(...withdraw(s))
      if (isRoadmap(s, config)) {
        const kids = s.children || []
        // The plan the implement verb asked for has ended: approve what it
        // filed, unless it raised a decision first. (why: docs/why.md#one-verb-plans-and-approves)
        if (finished === 'implement-roadmap' && s.record?.approveOnPlan) {
          plan.push(record({ approveOnPlan: null }))
          if (!s.openQuestions?.open && unstarted(s).length) return plan.concat(approveChildren(s, config, { author: s.record.approveOnPlan.by }))
        }
        // A re-plan keeps an approval the goal already has.
        if (req?.replan && kids.length && planned(s)) return plan.concat(s.record?.approved ? [record({ approveOnPlan: { by: s.record.approved.by || null } })] : [], fire('implement-roadmap', { mode: 'replan' }))
        if (s.record?.verifyDue && kids.length && kids.every((c) => c.state !== 'open')) {
          if (!verifiedAlready(s, kids)) return plan.concat(record({ verifyDue: false }), fire('revise-roadmap', verifyFlags(kids)))
          // Then end as an unlock with nothing re-armed would.
          plan.push(record({ verifyDue: false }), note('the verify that just ended already read every child'))
        }
        // A set build answers with its PRs, which carry the turn from here.
        if (finished === 'implement' && kids.some((c) => c.state === 'open') && !unstarted(s).length) {
          // Every PR event during the build was held, so each PR is read now.
          const prs = kids.flatMap((c) => (c.prNumbers || []).map((n) => ({ repo: c.repo, kind: 'pr', number: n, reason: 'ci' })))
          return plan.concat(prs.length ? [targets(prs)] : [], note('the set build answered with its PRs'))
        }
        // write-ticket promoted it, or it was typed while a session ran.
        if (needsIntake(s, config) && finished !== 'revise-roadmap') return plan.concat(fire('revise-roadmap', { mode: 'intake' }))
      }
      if (!inFlight(s) && !s.botSpokeLast) plan.push(anomaly('silent', `${s.repo.full}#${s.item.number} session ended without a comment`))
      // Last: the issue's number changes once it moves. (why: docs/why.md#a-session-asks-actions-acts)
      if (isRoadmap(s, config) && req?.transfer && !(s.children || []).length && req.transfer.repo !== s.repo.name) plan.push(transfer(req.transfer.repo, req.transfer.milestone))
      return plan
    }
    case 'ci':
      return fullTreatment(s.pr?.user?.login, config) ? evaluatePr(s, config) : [note('outside PR')]
    // Kept against the head it failed on, so every later pass — a sweep
    // included — repairs it rather than re-arming it.
    // (why: docs/why.md#a-queue-failure-is-a-ci-failure)
    case 'queue-failed': {
      if (!fullTreatment(s.pr?.user?.login, config)) return [note('outside PR')]
      if (!s.pr?.head?.sha || s.pr.state !== 'open') return [note('no open head to charge the queue failure to')]
      const queueFail = { sha: s.pr.head.sha, run: facts.run || null }
      return [record({ queueFail })].concat(evaluatePr({ ...s, record: { ...s.record, queueFail } }, config))
    }
    // A lease ref on an item with no lock. Residue from a pass that won the
    // lease and died before the label, or a session whose end was never seen:
    // the label off and `rec.current` still set means the session removed it
    // (or a person did), so it is read as the unlock it was. A lease the
    // record dates past its deadline is reclaimed whatever the label says.
    // (why: docs/why.md#a-lease-past-its-deadline-is-reclaimed)
    //
    // ⚠ The narrow window is unchanged: the per-item concurrency group is
    // scoped to one repository, so a cross-repo fire that wins the CAS is
    // unguarded until it writes the lock — one API call later.
    case 'sweep-lease': {
      const cur = s.record?.current
      const expired = cur?.deadline && Date.parse(cur.deadline) < nowOf(s).getTime()
      if (s.locked) return expired ? [{ type: 'timeout' }] : [note('the lock is on the item — the lease is live')]
      if (cur) return route({ ...target, reason: 'unlock', facts: {} }, s, config)
      return [releaseLease('no lock and no session on the item')]
    }
    case 'sweep-retry':
      return [{ type: 'retry' }]
    case 'sweep-timeout':
      return [{ type: 'timeout' }]
    case 'sweep-recheck':
      return route({ ...target, reason: 'unlock', facts: {} }, s, config)
    case 'sweep-pr':
      return quietSweep(evaluatePr(s, config), s, config)
    case 'sweep-orphan': {
      // `sweep-pr` already ran the derivation this pass. If it found work, say
      // nothing — a draft moving forward is not an orphan.
      const p = evaluatePr(s, config)
      if (p.some((a) => ['fire', 'armAutoMerge', 'markReady', 'targets'].includes(a.type))) return [note('still moving — not an orphan')]
      return quietSweep(p.concat(...(s.record?.handback ? [] : [handback(s, 'an orphaned draft — no CI activity for hours')]), commentOnce(`orphan ${s.pr?.head?.sha}`, `This draft has had no CI activity for hours and no session holds it. A mention (\`${config.dispatch.commandPrefix}\`) or a push from you starts me again.`), anomaly('orphan', `${s.repo.full}#${s.pr?.number} orphaned draft`)), s, config)
    }
    // The reconciler's pass: the cheap view found the board out of step with
    // the item, or the item is Pending and may be overdue. Re-derive, drain
    // what a lost event left, and step a wait past its due.
    // (why: docs/why.md#the-reconciler-replaces-the-drift-window)
    case 'reconcile': {
      const rec = s.record || {}
      const cur = rec.current
      if (s.locked) return cur?.deadline && Date.parse(cur.deadline) < nowOf(s).getTime() ? [{ type: 'timeout' }] : [note('a session holds it')]
      if (cur || rec.recheck) return route({ ...target, reason: 'unlock', facts: {} }, s, config)
      if (rec.pending) return !rec.pending.retryAfter || Date.parse(rec.pending.retryAfter) <= nowOf(s).getTime() ? [{ type: 'retry' }] : [note(`retry waits until ${rec.pending.retryAfter}`)]
      const p = config.dispatch.commandPrefix
      if (s.kind === 'issue' && s.park?.passed && rec.status === 'hold') {
        plan.push(commentOnce(`hold-expired ${s.park.until}`, `The hold until ${s.park.until} has passed, so this is back with you. Say \`${p} implement\` to start it, \`${p} hold …\` to wait longer, or close it.`))
      }
      if (s.kind === 'pr') {
        if (!fullTreatment(s.pr?.user?.login, config)) return plan.length ? plan : [note('outside PR')]
        // Past its due, an approved PR that still has not merged is read again.
        // Mergeability GitHub still calls unknown is not clean: resolve it.
        if (overdue(s, config) && s.normalized?.reviewDecision === 'APPROVED' && s.mergeable === 'UNKNOWN') return plan.concat(note('mergeability still unknown past the due'), conflictPlan(s, config))
        const e = evaluatePr(s, config)
        if (overdue(s, config) && !e.some((a) => MOVES.has(a.type))) return plan.concat(e, dueStep(s, config, `the PR has not moved (${s.normalized?.mergeStateStatus || s.mergeable || 'unknown'})`))
        return plan.concat(e)
      }
      if (s.item.state === 'open' && rec.approved && !isRoadmap(s, config) && !blockedNow(s) && !inFlight(s) && !rec.handback) {
        const start = startApproved(s, config, 'reconcile')
        if (overdue(s, config) && !start.some((a) => MOVES.has(a.type))) return plan.concat(start, dueStep(s, config, 'the approved build has not started'))
        return plan.concat(start)
      }
      if (overdue(s, config)) return plan.concat(dueStep(s, config, rec.verifyDue ? 'the completion check has not run' : 'nothing has moved it'))
      return plan.length ? plan : [note('in step')]
    }
    default:
      return [note(`no rule for ${target.reason}`)]
  }
}

export const _internal = { needsAddressReview, ownReview, pendingReviewVerb, underThreshold, quietSweep, lastHumanWordAt, endedFixCiFor, defaultHoldDate }
