/**
 * Who has approved what, and what the dispatcher owes them.
 *
 * GitHub's ruleset needs one approval to merge, and the dispatcher both gives
 * one — on a PR whose author GitHub refuses, and on a contract sync Actions
 * verified — and takes one away, when a commit of the bot's own buried it.
 * Each question here is a different reading of the same reviews and commits,
 * and a rule change moves them together, so they sit together.
 * (why: docs/why.md#the-owners-pr-is-approved-by-the-bot,
 * docs/why.md#a-bot-commit-buries-an-approval-a-conflict-merge-does-not)
 *
 * `loopMayNotMerge` is here too, where `mergePolicy`'s other half is: it is
 * the one wall no approval can clear.
 *
 * Nothing here imports `decide.mjs` or `status.mjs` back: that edge would be
 * the directory's first cycle. Nothing here fetches.
 */

import { checkApprove, commentOnce, dismissCheck, dismissProxy, dismissStale, note, proxyApprove, requestReviewer } from './actions.mjs'
import { fullTreatment, isBot, lower, nowOf, threadsWaiting } from './predicates.mjs'
import { dispatcherMark } from './markers.mjs'
import { STATE_BEARING } from '../workflow/lib/merge-gate.mjs'
import { parseVerb } from './verbs.mjs'

/**
 * The author's own PR is approved by the bot (`mergePolicy.proxyApprove`):
 * GitHub refuses an author's approval, and the owner's PR has nobody else's
 * to wait for. (why: docs/why.md#the-owners-pr-is-approved-by-the-bot)
 */
export function proxyApproves(login, config) {
  return Boolean(login) && (config.mergePolicy?.proxyApprove || []).some((l) => lower(l) === lower(login))
}

/** Repos where a merge is a deploy, so nothing is ever armed. */
export function loopMayNotMerge(snapshot, config) {
  return (config.mergePolicy?.loopMayNotMerge || []).includes(snapshot.repo.name)
}

/**
 * A person's approval that a commit of the bot's own has buried is dismissed,
 * on every pass and ahead of the lock guard, like the disarm: the queue merges
 * an approved, armed PR the moment CI goes green, and does not wait for a
 * lease. The bot's own proxy approval is `proxyPlan`'s, which also asks the
 * owner. An Actions app's approval (the contract check's) is withdrawn by the
 * job that gave it. (why: docs/why.md#a-bot-commit-buries-an-approval-a-conflict-merge-does-not)
 */
export function stalePlan(s, config) {
  const pr = s.pr
  if (!pr || pr.state !== 'open' || !fullTreatment(pr.user?.login, config)) return []
  const person = (login) => login && !isBot(login, config) && !String(login).endsWith('[bot]')
  const buried = buriedApprovals(s, config).filter((r) => person(r.user?.login))
  if (!buried.length) return []
  const logins = new Set(buried.map((r) => lower(r.user.login)))
  const ids = (s.reviews || []).filter((r) => r.state === 'APPROVED' && logins.has(lower(r.user?.login))).map((r) => r.id).filter(Boolean)
  return ids.length ? [dismissStale(ids)] : []
}

/** Each reviewer's latest state-bearing review, where it is an approval. `reviewDecisionFrom` carries why those states and no others. */
function standingApprovals(reviews) {
  const latest = new Map()
  for (const r of reviews || []) {
    if (STATE_BEARING.has(r.state)) latest.set(lower(r.user?.login), r)
  }
  return [...latest.values()].filter((r) => r.state === 'APPROVED')
}

/**
 * Each reviewer's standing approval that a later commit has buried. The
 * ruleset keeps an approval through every push, so the dispatcher withdraws
 * one itself, and only for a push that warrants it: a commit of the bot's own
 * (a fix, an adopted finding, a relay) the approval did not cover. A merge of
 * the base buries nothing: its second parent is off the PR, and the conflict
 * it resolved is not a new question (a hunk that is one asks in a thread). A
 * commit of the approver's own on top vouches for what is under it; for the
 * bot's proxy approval, that is the PR author's. A commit with no author
 * GitHub can name, an approval whose commit left the PR, or a commit list
 * never read, buries: unread fails closed.
 * (why: docs/why.md#a-bot-commit-buries-an-approval-a-conflict-merge-does-not)
 */
function buriedApprovals(s, config) {
  const head = s.pr?.head?.sha
  const commits = s.prCommits
  const onPr = new Set((commits || []).map((c) => c.sha))
  const baseMerge = (c) => (c.parents || []).length === 2 && !onPr.has(c.parents[1])
  return standingApprovals(s.reviews).filter((r) => r.commit_id !== head).filter((r) => {
    if (!commits) return true
    const at = commits.findIndex((c) => c.sha === r.commit_id)
    if (at < 0) return true
    const voucher = lower(isBot(r.user?.login, config) ? s.pr?.user?.login : r.user?.login)
    let buried = false
    for (const c of commits.slice(at + 1)) {
      if (c.author && lower(c.author) === voucher) buried = false
      else if ((!c.author || isBot(c.author, config)) && !baseMerge(c)) buried = true
    }
    return buried
  })
}

/**
 * Armed by the bot, or by nobody GitHub would name: an unread arming fails
 * closed. A draft is left alone, as everywhere: GitHub drops auto-merge when a
 * PR goes back to draft.
 */
export function botArmedOwnerPr(s, config) {
  const by = s.pr?.autoMergeBy
  return Boolean(s.pr?.autoMergeArmed) && !s.pr?.draft && (!by || isBot(by, config)) && proxyApproves(s.pr?.user?.login, config)
}

/**
 * A sync PR asks its reviewer once the contract check cannot carry it: the PR
 * changes more than the copy, `contracts-sync` did not write its head (a hand
 * edit, or a fix-ci push), the ruleset does not count the check's approval,
 * or the check has not approved a head the sync wrote within
 * `contractSync.approveWithinMinutes` (it failed, or never ran). Inside that
 * window the head waits for it. (why: docs/why.md#a-verified-contract-sync-is-approved-by-actions)
 */
export function contractSyncPlan(s, config) {
  const c = s.pr?.contractSync
  if (!c) return []
  const late = c.attestedAt && !c.approvedByCheck
    && nowOf(s) - new Date(c.attestedAt) > (config.contractSync?.approveWithinMinutes ?? 30) * 60_000
  const why = !s.pr.contractSyncOnly ? 'it changes more than the copied contract'
    : !c.attestedAt ? 'its head has commits the contract sync did not write'
    : c.approvedByCheck && c.decision !== 'APPROVED' ? "the ruleset does not count the contract check's approval"
    : late ? 'the contract check has not approved it'
    : null
  if (!why) return []
  // Outgrowing the copy is said once per PR: each fix-ci push would repeat it.
  const key = s.pr.contractSyncOnly ? `contract-check ${s.pr.head?.sha}` : 'contract-check outgrew'
  return [requestReviewer(), commentOnce(key, `Not approved automatically: ${why}. It needs a person's review.`)]
}

/** A bot PR the translation check carries: nothing but new keys, by the loop's own login. */
export function botTranslationOnly(s, config) {
  return Boolean(s.pr?.translationOnly) && isBot(s.pr?.user?.login, config)
}

/**
 * The translation check's approval of a head it no longer covers is withdrawn
 * on every pass, ahead of the lock guard, as `stalePlan`'s is: the ruleset
 * keeps an approval through every push. Only its own, found by its marker.
 * (why: docs/why.md#a-translation-key-is-approved-by-actions)
 */
export function translationStalePlan(s, config) {
  const ids = s.pr?.state === 'open' ? s.pr.translationCheck?.staleIds || [] : []
  return ids.length ? [dismissCheck(ids)] : []
}

/**
 * A green, ready bot PR of nothing but new translation keys is approved by
 * the check, pinned to its head. Its reviewer is asked once the check cannot
 * carry it: the PR outgrew new keys after the check approved an earlier head,
 * or the ruleset does not count the check's approval.
 * (why: docs/why.md#a-translation-key-is-approved-by-actions)
 */
export function translationPlan(s, config) {
  const c = s.pr?.translationCheck
  if (!s.pr?.translationOnly) {
    return c?.ever ? [requestReviewer(), commentOnce('translation-check outgrew', `Not approved automatically: ${s.pr?.translationReason || 'it changes more than new translation keys'}. It needs a person's review.`)] : []
  }
  if (!isBot(s.pr.user?.login, config)) return []
  if (!c?.approvedAtHead) return [checkApprove(s.pr.head?.sha)]
  if (c.decision && c.decision !== 'APPROVED') {
    return [requestReviewer(), commentOnce(`translation-check ${s.pr.head?.sha}`, "Not approved automatically: the ruleset does not count the translation check's approval. It needs a person's review.")]
  }
  return []
}

/**
 * The owner's PR, past the gates a bot draft passes at mark-ready: CI green,
 * the critic run or skipped, its threads answered. The approval is pinned to
 * the head read here, and never covers a commit of the bot's own the author
 * has not vouched for with `approve`: the loop pushes fixes onto member PRs.
 * The ruleset keeps an approval through later pushes, so one the bot's own
 * commit has since buried is dismissed. A merge of the base buries none.
 * (why: docs/why.md#the-owners-pr-is-approved-by-the-bot)
 */
export function proxyPlan(s, config) {
  const head = s.pr.head?.sha
  const verdict = proxyVerdict(s, config)
  if (verdict === 'unread') return [note('head commit or its author unread — no approval on this pass')]
  const approvals = (s.reviews || []).filter((r) => isBot(r.user?.login, config) && r.state === 'APPROVED')
  if (!isBot(s.headAuthor, config)) return approvals.length ? [] : [proxyApprove(head)]
  if (approvals.some((r) => r.commit_id === head)) return []
  if (verdict === 'owed') return [proxyApprove(head)]
  // Carried across a merge of the base: the approval stands, and nobody is
  // asked. (why: docs/why.md#a-bot-commit-buries-an-approval-a-conflict-merge-does-not)
  const standing = standingApprovals(s.reviews).some((r) => isBot(r.user?.login, config))
  if (standing && !buriedApprovals(s, config).some((r) => isBot(r.user?.login, config))) return []
  const buried = approvals.map((r) => r.id).filter(Boolean)
  const short = head.slice(0, 7)
  const waiting = threadsWaiting(s, config).length
  // Armed, and held only by threads: say so, or the ask reads as owed twice.
  // Its own key, because an owner who arms after the unarmed ask has done what
  // that ask told them to, and `commentOnce` would never say what is left.
  const armedHold = armedByAuthor(s) && waiting
  const ask = armedHold
    ? `The newest commit, ${short}, is ${config.identity.expectedLogin}'s own. Your auto-merge vouches for it once nothing waits on you, and ${waiting} thread(s) still do: reply there or resolve them, or say \`${config.dispatch.commandPrefix} approve\`.`
    : `The newest commit, ${short}, is ${config.identity.expectedLogin}'s own, so it is not approved on your behalf. Read it, then say \`${config.dispatch.commandPrefix} approve\`, or enable auto-merge.`
  return [
    ...(buried.length ? [dismissProxy(buried)] : []),
    commentOnce(`${armedHold ? ARMED_HOLD_KEY : HOLD_KEY} ${head}`, ask),
  ]
}

/** The two keys the hold ask is posted under; `vouched` reads either back. */
const HOLD_KEY = 'proxy-held'
const ARMED_HOLD_KEY = 'proxy-held-armed'

/**
 * What the bot's approval does on this pass, in one word: `unread` when the
 * head commit or its author did not resolve, `held` when the head is the bot's
 * own and nobody vouched for it, `owed` otherwise. `proxyPlan` acts on it and
 * `status` reports it, so the board cannot promise a move the next pass
 * refuses. (why: docs/why.md#the-owners-pr-is-approved-by-the-bot)
 *
 * `getCommit` resolves `author` to null when the commit's email maps to no
 * account, and an unknown author could be the bot's own, so `unread` fails
 * closed: nothing is approved, and nothing is asked for either.
 */
export function proxyVerdict(s, config) {
  const head = s.pr?.head?.sha
  if (!head || !s.headCommittedAt || !s.headAuthor) return 'unread'
  if (!isBot(s.headAuthor, config)) return 'owed'
  return vouched(s, config) ? 'owed' : 'held'
}

/**
 * The author armed auto-merge themselves. The bot never arms an owner's PR,
 * and one it did is disarmed, so this is the owner's decision to merge.
 * (why: docs/why.md#the-owners-arming-vouches-for-the-bots-commits)
 */
function armedByAuthor(s) {
  const by = s.pr?.autoMergeBy
  return Boolean(s.pr?.autoMergeArmed) && !s.pr?.draft && Boolean(by) && lower(by) === lower(s.pr?.user?.login)
}

/**
 * The author vouches for the bot's head by arming auto-merge, while no thread
 * waits on them, or by saying `approve` after the bot asked them to, about
 * this head. A thread waiting on a person is the review asking for one, and
 * arming does not answer it. (why: docs/why.md#the-owners-arming-vouches-for-the-bots-commits)
 *
 * The ask is the clock, not the commit's own date. A session commits to a relay
 * branch and Actions lands it when the session ends, up to
 * `dispatch.timeoutsMinutes` later, so a vouch for the head that commit
 * replaced is newer than its committer date and would carry over to it — the
 * one thing the hold exists to stop.
 * (why: docs/why.md#the-owners-pr-is-approved-by-the-bot)
 */
function vouched(s, config) {
  if (armedByAuthor(s) && !threadsWaiting(s, config).length) return true
  const author = s.pr.user?.login
  const marks = [HOLD_KEY, ARMED_HOLD_KEY].map((k) => dispatcherMark(`${k} ${s.pr.head?.sha}`))
  // Either wording is an ask about this head, and the earliest is the clock.
  const asked = (s.comments || []).filter((c) => isBot(c.author, config) && marks.some((m) => String(c.body || '').startsWith(m)))
    .reduce((a, c) => (a && a.createdAt <= c.createdAt ? a : c), null)
  if (!asked) return false
  return (s.comments || []).some((c) => lower(c.author) === lower(author) && c.createdAt > asked.createdAt
    && parseVerb(c.body, config.dispatch, 'pr').verb === 'approve')
}
