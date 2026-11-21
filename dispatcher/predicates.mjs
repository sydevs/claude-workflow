/**
 * The predicates the dispatcher reads a login, a config or a snapshot with.
 *
 * These answer questions no one decider owns: whether a login is the loop's
 * own, whether a PR gets the loop at all, what the snapshot's clock says.
 * Most of the directory asks them, so they live below all of it. This module
 * imports nothing, so anything may import it.
 */

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
