/**
 * The relay: how a session's commits reach a PR branch it cannot push to.
 *
 * A cloud session pushes only to `claude/*`. A member's own branch, or
 * Copilot's, is outside that, so the session pushes its work to
 * `<dispatch.relayBranchPrefix><pr>-<shortsha>`, built on the PR's head, and
 * asks for it in a `sydevs-request`. Actions, whose token writes any branch in
 * the repo, moves the PR branch there: a fast-forward when nothing else moved
 * it, a server-side merge when the member pushed meanwhile. A conflict, or a
 * write the token may not make, is handed back with GitHub's own words, and
 * the relay branch is kept so nothing is lost. (why: docs/why.md#the-relay)
 */

/**
 * Where a session that works this PR may push, one of:
 *
 * - `direct` — the head is a `claude/*` branch in this repo, whoever wrote the PR
 * - `relay`  — another branch in this repo, on a PR the loop works in full
 * - `none`   — a fork, or a PR the loop only answers: threads, no code
 *
 * The branch decides, never the author: a member's PR on a `claude/*` branch
 * is pushed to like the bot's own. (why: docs/why.md#the-branch-decides-where-a-session-pushes)
 */
export function pushRoute(s, config, fullTreatment) {
  const pr = s.pr
  if (!pr) return 'none'
  if (pr.head?.repo && pr.head.repo !== s.repo?.full) return 'none'
  if (String(pr.head?.ref || '').startsWith(config.dispatch?.sessionBranchPrefix || 'claude/')) return 'direct'
  return fullTreatment(pr.user?.login, config) ? 'relay' : 'none'
}

/**
 * Why a relay request may not be applied to this PR, or null when it may.
 * The request is the session's; only the PR, as gathered now, vouches for it.
 */
export function relayRefusal(s, config, req, fullTreatment) {
  const pr = s.pr
  if (!pr || pr.state !== 'open') return 'the PR is not open'
  if (pushRoute(s, config, fullTreatment) !== 'relay') return 'this PR is not a relay PR'
  const prefix = `${config.dispatch?.relayBranchPrefix || 'claude/relay-'}${pr.number}-`
  if (!String(req.branch).startsWith(prefix)) return `the relay branch \`${req.branch}\` is not \`${prefix}*\``
  if (req.head !== pr.head?.ref) return `the request names \`${req.head}\`, but the PR's branch is \`${pr.head?.ref}\``
  return null
}

const words = (e) => String(e?.message || '').replace(/\s+/g, ' ').trim().slice(0, 220)

/**
 * Moves the PR's branch to the relay. Returns `{ landed, refusal }`: a
 * refusal is `{ what, why }` for the hand-over, with GitHub's words in `why`.
 * Never throws for a refused or conflicting write; an unexpected error does.
 */
export async function applyRelay(gh, { owner, repo }, { branch, head, sha }, log = () => {}) {
  const args = { owner, repo }
  let at = null
  try {
    ({ data: { object: { sha: at } } } = await gh.rest.git.getRef({ ...args, ref: `heads/${branch}` }))
  } catch (e) {
    if (e?.status !== 404) throw e
  }
  if (at !== sha) {
    return { landed: false, refusal: { what: 'apply the relay', why: at ? `${branch} is at ${at.slice(0, 7)}, not the requested ${sha.slice(0, 7)}` : `${branch} does not exist` } }
  }
  let landed = false
  try {
    await gh.rest.git.updateRef({ ...args, ref: `heads/${head}`, sha, force: false })
    landed = true
    log(`relay ${branch} fast-forwarded ${head} to ${sha.slice(0, 7)}`)
  } catch (e) {
    // 422 is GitHub's "not a fast forward": the member pushed meanwhile.
    // A workflow-scope refusal is a 422 too, and a merge would hit the same
    // wall, so it is handed back as said. (why: docs/why.md#quote-the-refusal-do-not-name-a-cause)
    if (e?.status !== 422 || /workflow/i.test(words(e))) {
      if ([403, 404, 422].includes(e?.status)) return { landed: false, refusal: { what: 'apply the relay', why: words(e) } }
      throw e
    }
    try {
      const r = await gh.rest.repos.merge({ ...args, base: head, head: branch, commit_message: `Merge ${branch} into ${head}` })
      landed = true
      log(r?.status === 204 ? `relay ${branch}: ${head} already holds it` : `relay ${branch} merged into ${head}`)
    } catch (e2) {
      if (e2?.status === 409) return { landed: false, refusal: { what: 'merge the relay', why: `${branch} conflicts with ${head}: ${words(e2)}` } }
      if ([403, 404, 422].includes(e2?.status)) return { landed: false, refusal: { what: 'merge the relay', why: words(e2) } }
      throw e2
    }
  }
  try {
    await gh.rest.git.deleteRef({ ...args, ref: `heads/${branch}` })
  } catch (e) {
    log(`relay branch ${branch} not deleted — ${e?.status || '?'} ${words(e)}`)
  }
  return { landed, refusal: null }
}
