/**
 * The predicates the dispatcher reads a login, a config or a snapshot with.
 *
 * These answer questions no one decider owns: whether a login is the loop's
 * own, whether a PR gets the loop at all, what the snapshot's clock says,
 * what kind of item this is. Membership is the whole small, pure family, not
 * only the members a cycle forced out — a line drawn where a cycle happened
 * to fall could not place the next one. `decide.mjs` keeps a predicate whose
 * dependency tail is its own, like `needsAddressReview`, and merge policy is
 * `approvals.mjs`'s. Most of the directory asks these, so they live below all
 * of it. This module imports nothing, so anything may import it.
 */

export const lower = (s) => String(s || '').toLowerCase()

/**
 * A login is the loop's own, case aside. `expected` is the list of logins it
 * may be — `dispatcherLogins`, at every call site — and anything else throws:
 * a seam that forgets to thread it would otherwise refuse every comment, which
 * `loadRecord` reports as no record at all and `sweep.mjs` then reads as a
 * timed-out lease on a live session. A bare string throws for the same reason,
 * loudly, rather than being read as a one-login list.
 *
 * The comparison is exact, never a normalised `[bot]` suffix. REST spells a
 * GitHub App `<slug>[bot]` and GraphQL spells the same actor `<slug>`, so both
 * spellings are listed in `identity.dispatcherLogins` instead: this predicate
 * gates the contract-sync approval, so the trusted set is exactly what the
 * config names, and no entry added later quietly gains a second trusted form.
 * (why: docs/why.md#a-dispatcher-owned-marker-is-qualified-by-its-author)
 */
export function isLogin(login, expected) {
  if (!Array.isArray(expected) || !expected.length || expected.some((e) => !e)) {
    throw new Error('isLogin: the expected login is required, as a list')
  }
  return expected.some((e) => lower(login) === lower(e))
}

/**
 * A GraphQL actor's login, spelled the way REST spells it. GraphQL names a
 * GitHub App by its bare slug and REST appends `[bot]`, so a query that feeds
 * `isLogin` must normalise before comparing — and it must normalise, rather
 * than the trusted list carrying the bare slug too.
 *
 * A bare slug is a name a user account can hold, and `findRecord`
 * authenticates the dispatcher's own state store by author login alone. In a
 * public repo, trusting `<slug>` would let anyone who registered that username
 * post a forged status comment and have the loop fire a privileged session on
 * it. `__typename` is what distinguishes the App from a user of the same name.
 * Select it beside `login` in every query whose author reaches `isBot`.
 * (why: docs/why.md#the-dispatcher-has-its-own-github-app)
 */
export function restLogin(actor) {
  const login = actor?.login || ''
  return login && actor?.__typename === 'Bot' ? `${login}[bot]` : login
}
/**
 * Every login the loop writes under: the sessions' and the dispatcher App's.
 * The dispatcher finds its own status comments, markers and PRs under any of
 * them, so an item written before the App switch keeps its record.
 * (why: docs/why.md#the-dispatcher-has-its-own-github-app)
 */
export function dispatcherLogins(config) {
  const list = (config.identity?.dispatcherLogins || []).filter(Boolean)
  // Both arms filtered, so a caller that must answer "no identity is
  // configured" softly can test `.length` instead of re-filtering.
  return list.length ? list : [config.identity?.expectedLogin].filter(Boolean)
}
export function isBot(login, config) {
  return isLogin(login, dispatcherLogins(config))
}
export function respondTo(login, config) {
  return (config.assignment?.respondTo || []).some((l) => lower(l) === lower(login))
}
export function isHuman(login, config) {
  return respondTo(login, config) && lower(login) !== 'copilot'
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
 * A PR based on another branch than the default. The loop never opens one
 * and never works one: it has no ruleset behind it, so armed it would merge
 * unreviewed. (why: docs/why.md#a-stacked-pr-is-never-armed)
 */
export function stackedPr(s) {
  const base = s.pr?.base
  return Boolean(base?.defaultBranch && base.ref !== base.defaultBranch)
}

/** A roadmap ticket: a plain-language goal whose state is its children. (why: docs/why.md#a-roadmap-ticket-has-no-status) */
export function isRoadmap(s, config) {
  return s.kind === 'issue' && Boolean(s.item?.type) && s.item.type === (config.roadmap?.type || 'Roadmap')
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
