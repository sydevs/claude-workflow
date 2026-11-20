/**
 * The vocabulary every plan is written in: the actions a plan is made of, and
 * the predicates that read a snapshot.
 *
 * `decide.mjs` and `approvals.mjs` both write plans, and `decide.mjs` imports
 * `approvals.mjs`, so anything they share lives here instead of in either —
 * imported one way, by both, with no cycle to resolve at module scope.
 * Nothing here fetches, and nothing here is specific to one plan.
 */

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
/** Turn off an auto-merge the bot armed on the owner's own PR: arming it is theirs. */
export const disarmAutoMerge = () => ({ type: 'disarmAutoMerge' })
/** Approve the owner's own PR at `sha`, standing in for the approval GitHub refuses its author. */
export const proxyApprove = (sha) => ({ type: 'proxyApprove', sha })
/** Dismiss the bot's own approvals, by review id: a commit of its own sits on top of them. */
export const dismissProxy = (ids) => ({ type: 'dismissProxy', ids })
/** Dismiss a person's approvals, by review id: a commit of the bot's own landed after them. */
export const dismissStale = (ids) => ({ type: 'dismissStale', ids })
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
export const lower = (s) => String(s || '').toLowerCase()

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
/** The snapshot's own clock, so a test fixes `now` and every date a plan writes follows it. */
export const nowOf = (s) => s.now || new Date()

/**
 * A thread the bot rooted to ask a human something. It waits on that human:
 * only their reply, caught by the rule before it, makes it the bot's turn.
 */
export function isQuestion(root, config) {
  const marker = config.review?.questionMarker || '<!-- sydevs-question -->'
  return isBot(root.author, config) && String(root.body || '').includes(marker)
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
