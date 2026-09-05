/**
 * Is this PR safe to merge? Is its CI actually green?
 *
 * ## Why this is a script and not a table in a skill
 *
 * The prose table got the answer wrong twice, in opposite directions. One
 * error was dangerous:
 *
 *   - `pull_request_read method:get_status` returns COMMIT STATUSES. Our CI
 *     posts CHECK RUNS instead. On SahajCloud#672 the only commit status was
 *     Railway's deploy. That status went green at 21:14, while `Lint, Test &
 *     Smoke` ran until 21:31. For seventeen minutes an approved PR read as
 *     green while its tests still ran. A run merging there would have
 *     followed the skill exactly. (sydevs/claude-workflow#26)
 *   - The same call reported SahajAtlasWeb#181 as `pending` forever, even
 *     with five of five check runs green. The loop would decline it on
 *     every pass. (#26)
 *   - `claude-workflow` runs no CI at all, so no PR here can ever read as
 *     "green". The loop would comment "checks unfinished" every run, about
 *     checks that do not exist, on its own self-improvement PRs. (#29)
 *
 * ## Why it does no fetching
 *
 * A routine cannot reach the GitHub API by any client. Measured 2026-09-02:
 * `gh` is absent from the image. Installing it does not help. `gh api
 * repos/...` returns `403 GitHub access is not enabled for this session`,
 * byte-identical with or without an auth header, so the proxy refuses the
 * path, not the credential. `curl` 403s the same way, on this path and on
 * GraphQL. Only `mcp__github__*` has a route.
 *
 * So the verdict functions here are PURE. They take data the caller already
 * fetched (with MCP in a routine, with `gh` locally) and return a decision.
 * That split is the right one anyway. The bugs above were never in the
 * fetching. They were in deciding what the fetched values meant, and that
 * half had no single home.
 *
 * `normalizeMcp()` accepts exactly what the three documented MCP calls
 * return. There is no second, fetching path. One implementation runs
 * identically in a routine and on a laptop. That is the only way to test
 * the routine path at all.
 */

/** Terminal check-run conclusions that do not block a merge. */
const OK_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
/** Terminal statuses that do. Anything else is still running. */
const BAD_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'])

const workflowCache = new Map()

/**
 * Does this repo run GitHub Actions at all?
 *
 * The caller seeds this from the checkout: `ls <repo>/.github/workflows/*.yml`.
 * Unknown defaults to TRUE. The two errors are not symmetric. Assuming a
 * repo has CI makes a missing check block a merge. Assuming it has none
 * would call an untested PR green. Only the second error can ship something
 * broken.
 */
export function setRepoWorkflows(repo, hasWorkflows) {
  workflowCache.set(repo, Boolean(hasWorkflows))
}

export function repoHasWorkflows(repo) {
  return workflowCache.has(repo) ? workflowCache.get(repo) : true
}

/** Flatten the rollup into `{name, kind, state}` rows. */
export function checksOf(pr) {
  const nodes = pr?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes || []
  return nodes.map((n) =>
    n.__typename === 'CheckRun'
      ? { name: n.name, kind: 'check', state: n.conclusion || n.status || 'PENDING' }
      : { name: n.context, kind: 'status', state: n.state },
  )
}

/**
 * `{ green, reason, running, failing }`.
 *
 * There are three ways to be non-green, kept distinct because the loop
 * responds to each differently. Red means rung-2 work. Running means "come
 * back later." Absent-when-expected usually means a conflict: a conflicted
 * PR schedules ZERO workflow runs, silently.
 * (why: docs/why.md#a-conflicted-pr-schedules-zero-ci-runs)
 */
export function ciVerdict(pr, repo) {
  const checks = checksOf(pr)
  const hasWorkflows = repoHasWorkflows(repo)

  if (!hasWorkflows && checks.length === 0) {
    return { green: true, reason: 'no CI configured in this repo', running: [], failing: [] }
  }

  const failing = checks.filter((c) =>
    c.kind === 'check' ? BAD_CONCLUSIONS.has(c.state) : c.state === 'FAILURE' || c.state === 'ERROR',
  )
  const running = checks.filter((c) =>
    c.kind === 'check' ? !OK_CONCLUSIONS.has(c.state) && !BAD_CONCLUSIONS.has(c.state) : c.state === 'PENDING',
  )

  if (failing.length) {
    return { green: false, reason: `failing: ${failing.map((c) => c.name).join(', ')}`, running, failing }
  }
  if (running.length) {
    return { green: false, reason: `still running: ${running.map((c) => c.name).join(', ')}`, running, failing }
  }
  // This requires at least one CHECK RUN, not just one context. A Railway or
  // Cloudflare deploy posts its own status. Without this check, that status
  // would stand in for the test job that never got scheduled.
  if (hasWorkflows && !checks.some((c) => c.kind === 'check')) {
    return {
      green: false,
      reason: 'this repo runs Actions but the PR has no check runs — usually a merge conflict, which schedules none',
      running,
      failing,
    }
  }
  return { green: true, reason: `${checks.length} check(s) green`, running, failing }
}

/**
 * `{ verdict: 'MERGE' | 'HOLD', reason, ci }`. Order matters. This reports
 * the first wall the PR hits.
 *
 * `loopMayNotMerge` is checked FIRST. It is not a gate the loop can satisfy.
 * It exists because treating "no CI" as green (#29) had an edge the ticket
 * did not ask for: `claude-workflow` runs no Actions, so an approved PR
 * there would read as green and get merged. Merging there IS the deploy of
 * the instructions every later run executes. This repo is also ticketless
 * now, so review is the only gate its changes pass through.
 */
export function mergeVerdict(pr, repo, policy = {}) {
  const unresolved = (pr?.reviewThreads?.nodes || []).filter((t) => !t.isResolved).length
  const ci = ciVerdict(pr, repo)
  const name = repo.split('/')[1]

  if ((policy.loopMayNotMerge || []).includes(name))
    return { verdict: 'HOLD', reason: `${name} is merged by a human, never by the loop`, ci, unresolved }
  if (pr.isDraft) return { verdict: 'HOLD', reason: 'draft', ci, unresolved }
  if (pr.reviewDecision !== 'APPROVED')
    return { verdict: 'HOLD', reason: `no approving review (${pr.reviewDecision || 'NONE'})`, ci, unresolved }
  if (unresolved) return { verdict: 'HOLD', reason: `${unresolved} unresolved review thread(s)`, ci, unresolved }
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY')
    return { verdict: 'HOLD', reason: 'conflicts with the base branch', ci, unresolved }
  if (!ci.green) return { verdict: 'HOLD', reason: ci.reason, ci, unresolved }
  return { verdict: 'MERGE', reason: ci.reason, ci, unresolved }
}


/** Review states that carry a decision. `COMMENTED` never changes or clears one. */
const STATE_BEARING = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'])

/**
 * The review decision, derived from what `pull_request_read method:get_reviews`
 * returns. This comment is the canonical rationale for that derivation. Other
 * files should cite it, not restate it.
 *
 * ## Why this is a function
 *
 * No MCP call carries `reviewDecision`. The loop must derive it. The only
 * derivation error that can ship something bad is one that INVENTS an
 * approval. That error causes a merge that should not happen, in four repos
 * where merging is the deploy. We cannot afford that risk, so this rule runs
 * here once, instead of being re-derived from prose on every run.
 *
 * ## `authorized` is an allowlist, and it is the security property
 *
 * Approval authority belongs to `assignment.reviewer`. Four of the five
 * repos are PUBLIC, so any GitHub account can submit an `APPROVED` review on
 * an open PR. "Count everyone except ourselves" would let a stranger's
 * drive-by approval satisfy the gate. An allowlist is also strictly
 * narrower than the `reviewDecision` field it replaces, never wider.
 *
 * Excluding the agent's own login follows from this rule: the agent is not
 * the reviewer, so its own reviews never count.
 *
 * An empty or absent `authorized` returns `null`. No configured authority
 * means no derived approval. That is the safe direction.
 */
export function reviewDecisionFrom(reviews, { authorized = [] } = {}) {
  const allow = new Set((authorized || []).map((l) => String(l).toLowerCase()))
  if (!allow.size) return null

  // Latest state-bearing review per authorized login.
  const latest = new Map()
  for (const r of reviews || []) {
    const login = String(r?.user?.login || r?.author?.login || '').toLowerCase()
    const state = String(r?.state || '').toUpperCase()
    if (!login || !allow.has(login) || !STATE_BEARING.has(state)) continue
    const at = String(r?.submitted_at || r?.submittedAt || '')
    const prev = latest.get(login)
    if (!prev || at >= prev.at) latest.set(login, { state, at })
  }

  const states = [...latest.values()].map((v) => v.state)
  if (states.includes('CHANGES_REQUESTED')) return 'CHANGES_REQUESTED'
  return states.includes('APPROVED') ? 'APPROVED' : null
}

/**
 * Build the shape `mergeVerdict` wants from what the MCP tools return. This
 * lets a routine reach the same decision code a local `gh` run does.
 *
 * Inputs are the three documented calls:
 *   get               → draft, mergeable, mergeable_state, requested_reviewers
 *   get_check_runs    → { check_runs: [{ name, status, conclusion }] }
 *   get_review_comments → { review_threads: [{ is_resolved }] }
 *
 * ⚠ That key is snake_case. The MCP tool returns `is_resolved`. GraphQL
 * returns `isResolved`. Reading only the camelCase spelling once made EVERY
 * thread read as unresolved, so any PR ever reviewed inline was held
 * forever, fail-safe and silent. This code accepts both spellings. When
 * neither is present, a thread counts as unresolved, the safe direction.
 *
 * `reviewDecision` has no MCP call of its own, and no MCP call carries the
 * field: `pull_request_read method:get` omits it, and `list_pull_requests`
 * has no such member in its `fields` enum. So pass `reviews` (what
 * `pull_request_read method:get_reviews` returned) and `reviewAuthority`
 * (`assignment.reviewer`). `reviewDecisionFrom`, above, derives the decision
 * from those and carries the full rationale. An explicit `reviewDecision`
 * still wins, for a local `gh` caller that has the real field. Absent both,
 * the decision is NOT approved, the safe direction: the only error that can
 * merge something bad is one that invents an approval.
 */
export function normalizeMcp({ pr, checkRuns, statuses, reviewThreads, reviews, reviewAuthority, reviewDecision }) {
  const checks = [
    ...(checkRuns?.check_runs || []).map((c) => ({
      __typename: 'CheckRun',
      name: c.name,
      conclusion: (c.conclusion || '').toUpperCase() || null,
      status: (c.status || '').toUpperCase(),
    })),
    ...(statuses?.statuses || []).map((s) => ({
      __typename: 'StatusContext',
      context: s.context,
      state: (s.state || '').toUpperCase(),
    })),
  ]

  return {
    number: pr?.number,
    title: pr?.title,
    isDraft: Boolean(pr?.draft ?? pr?.isDraft),
    mergeable: pr?.mergeable === false ? 'CONFLICTING' : pr?.mergeable === true ? 'MERGEABLE' : 'UNKNOWN',
    mergeStateStatus: (pr?.mergeable_state || pr?.mergeStateStatus || '').toUpperCase(),
    reviewDecision:
      reviewDecision || pr?.reviewDecision || reviewDecisionFrom(reviews, { authorized: reviewAuthority }),
    reviewThreads: {
      nodes: (reviewThreads?.review_threads || []).map((t) => ({
        // Accept either spelling. See the is_resolved note above.
        isResolved: Boolean(t.is_resolved ?? t.isResolved),
      })),
    },
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: checks } } } }] },
  }
}
