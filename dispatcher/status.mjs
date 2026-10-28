/**
 * The board's Status, derived. One pure function of a snapshot, run by
 * `apply` after a plan's writes, so the board shows where the item stands
 * now. Nothing reads Status back to decide: a drag on the board is reverted
 * on the item's next pass. (why: docs/why.md#status-is-derived-never-read)
 *
 *   awaiting — a person must act; the newest bot comment says what
 *   blocked  — not approved, and waits on an open native relationship
 *   hold     — not approved, and waits on a Hold Until date
 *   pending  — the machinery owes the next move
 *   working  — a session holds this item's lock, and nothing else
 *   done     — closed, or an issue whose PR is open
 *
 * `due` marks a Pending wait the machinery owns, which the reconciler checks
 * after `dispatch.pendingDueMinutes`. A wait on another open item has none.
 * (why: docs/why.md#pending-has-a-due-awaiting-has-a-reason)
 */

import { isBot, isRoadmap, fullTreatment, needsAddressReview, loopMayNotMerge, threadsWaiting, stackedPr } from './decide.mjs'

const out = (key, reason, due = false) => ({ key, reason, due })
const refs = (list) => list.map((b) => `${b.owner && b.repo ? `${b.owner}/${b.repo}` : ''}#${b.number}`).join(', ')

/** A Hold Until date still ahead. */
export const held = (s) => Boolean(s.park?.until && !s.park.passed)

/** A child's Hold Until date, ahead of `now`. */
function childHeld(c, now) {
  return Boolean(c.holdUntil && c.holdUntil > now.toISOString().slice(0, 10))
}

export function deriveStatus(s, config, now = s.now || new Date()) {
  const lock = config.labels.lock
  const locked = (s.item?.labels || []).includes(lock)
  const rec = s.record || {}
  if (s.kind === 'pr') return prStatus(s, config, locked, rec)
  if (s.item?.state !== 'open') return out('done', 'closed')
  if (locked) return out('working', rec.current?.handler ? `${rec.current.handler} is running` : 'a session holds it')
  if (s.openPrsClosingIt?.length) return out('done', `#${s.openPrsClosingIt.join(', #')} is open for it`)
  if (rec.pending) return out('pending', `${rec.pending.handler}: ${rec.pending.reason}`, true)
  if (rec.recheck) return out('pending', 'an event arrived while it was locked', true)
  if (isRoadmap(s, config)) return goalStatus(s, config, rec, now)
  const approved = Boolean(rec.approved)
  // A blocker or a hold comes first, hand-back or not: nothing you do moves
  // the item until it clears. (why: docs/why.md#pending-has-a-due-awaiting-has-a-reason)
  if (s.blockedByOpen?.length) return approved ? out('pending', `approved — starts when ${refs(s.blockedByOpen)} close`) : out('blocked', `waits on ${refs(s.blockedByOpen)}`)
  if (held(s)) return out('hold', `until ${s.park.until}`)
  if (rec.handback) return out('awaiting', rec.handback.reason)
  if (s.openQuestions?.open) return out('awaiting', `${s.openQuestions.open} open question(s)`)
  if (approved) return s.parent?.setBuild ? out('pending', 'built in its goal\'s set') : out('pending', 'approved — implement is owed', true)
  return out('awaiting', 'needs a verdict')
}

/**
 * A goal is the human's while it needs a verdict of its own. Once approved,
 * it follows its children: Blocked only if every open one is, Hold only if
 * every open one is, otherwise in delivery.
 */
function goalStatus(s, config, rec, now) {
  // A plan only runs on an `implement`, so a goal planned before approval
  // lived in the record was approved all the same.
  const approved = Boolean(rec.approved) || (rec.dispatches || []).some((d) => d.handler === 'implement-roadmap')
  if (s.blockedByOpen?.length) return approved ? out('pending', `approved — plans when ${refs(s.blockedByOpen)} close`) : out('blocked', `waits on ${refs(s.blockedByOpen)}`)
  if (held(s)) return out('hold', `until ${s.park.until}`)
  if (rec.handback) return out('awaiting', rec.handback.reason)
  if (s.openQuestions?.open) return out('awaiting', `${s.openQuestions.open} open question(s)`)
  if (rec.verifyDue) return out('pending', 'the completion check is owed', true)
  const kids = s.children || []
  if (!approved) return out('awaiting', kids.length ? 'approve the plan with implement' : 'plan it with implement')
  if (!kids.length) return out('pending', 'the plan is owed', true)
  const open = kids.filter((c) => c.state === 'open')
  if (!open.length) return out('awaiting', 'every child closed, and the goal is still open')
  // A plan whose tickets nobody approved is still a plan awaiting its verdict.
  if (open.every((c) => c.proposal && !c.prs && !c.locked)) return out('awaiting', 'approve the plan\'s tickets with implement')
  const kind = (c) => (c.locked ? 'working' : c.prs ? 'done' : c.blockedByOpen?.length ? 'blocked' : childHeld(c, now) ? 'hold' : 'open')
  const kinds = open.map(kind)
  if (kinds.every((k) => k === 'blocked')) return out('blocked', 'every open child waits on a blocker')
  if (kinds.every((k) => k === 'hold')) return out('hold', 'every open child is held')
  const tally = Object.entries(kinds.reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {})).map(([k, n]) => `${n} ${k}`).join(', ')
  return out('pending', `in delivery — children: ${tally}`)
}

function prStatus(s, config, locked, rec) {
  const pr = s.pr
  if (!pr || pr.state !== 'open') return out('done', pr?.merged ? 'merged' : 'closed')
  if (locked) return out('working', rec.current?.handler ? `${rec.current.handler} is running` : 'a session holds it')
  if (s.linkedLocked?.length) return out('pending', `the session on ${s.linkedLocked[0]} owns this branch`)
  const author = pr.user?.login
  if (!fullTreatment(author, config)) return out('awaiting', 'outside PR — the bot answers a mention only')
  if (stackedPr(s)) return out('awaiting', `stacked on ${pr.base.ref} — merge it there, or retarget it to ${pr.base.defaultBranch}`)
  if (rec.handback) return out('awaiting', rec.handback.reason)
  if (pr.draft) return isBot(author, config) ? out('pending', 'draft — the build or the critic owes the next move', true) : out('awaiting', 'your draft — mark it ready, or mention the bot')
  if (rec.pending) return out('pending', `${rec.pending.handler}: ${rec.pending.reason}`, true)
  if (needsAddressReview(s, config)) return out('pending', 'a reply is owed', true)
  const waiting = threadsWaiting(s, config)
  if (waiting.length) return out('awaiting', `${waiting.length} thread(s) wait on your reply or resolution`)
  if (s.normalized?.reviewDecision !== 'APPROVED') {
    if (s.mergeable === 'CONFLICTING') return out('pending', 'conflicts with its base', true)
    if (s.ci?.failing?.length) return out('pending', 'CI is red', true)
    return out('awaiting', 'review')
  }
  if (loopMayNotMerge(s, config)) return out('awaiting', 'approved — merging it is yours')
  if (s.mergeable === 'CONFLICTING') return out('pending', 'approved — conflicts with its base', true)
  if (s.ci?.failing?.length) return out('pending', 'approved — CI is red', true)
  if (s.linkedBlockedOpen?.length) return out('pending', `approved — merges after ${s.linkedBlockedOpen.join(', ')}`)
  return out('pending', pr.autoMergeArmed ? 'approved — the merge queue owes it' : 'approved — auto-merge is owed', true)
}
