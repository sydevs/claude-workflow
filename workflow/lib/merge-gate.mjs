/**
 * Is this PR safe to merge, and is its CI actually green?
 *
 * ## Why this is a script and not a table in a skill
 *
 * The prose table got it wrong twice, in opposite directions, and one of them was
 * dangerous:
 *
 *   - `pull_request_read method:get_status` returns COMMIT STATUSES. Our CI posts
 *     CHECK RUNS. On SahajCloud#672 the only commit status was Railway's deploy,
 *     which went green at 21:14 while `Lint, Test & Smoke` ran until 21:31 — a
 *     seventeen-minute window in which an approved PR read as green with its tests
 *     still running, and a run merging there would have been following the skill
 *     exactly. (sydevs/claude-workflow#26)
 *   - The same call reported SahajAtlasWeb#181 — five of five check runs green —
 *     as `pending` forever, so the loop would decline it on every pass. (#26)
 *   - `claude-workflow` runs no CI at all, so no PR here can ever be "green"; the
 *     loop would comment "checks unfinished" every run about checks that do not
 *     exist, on its own self-improvement PRs. (#29)
 *
 * ## Why it does no fetching
 *
 * **A routine cannot reach the GitHub API by any client.** Measured 2026-09-02:
 * `gh` is absent from the image; installing it does not help, because
 * `gh api repos/...` returns `403 GitHub access is not enabled for this session`
 * — byte-identical with and without an auth header, so the proxy is refusing the
 * path rather than the credential. `curl` to the same path, and to GraphQL, 403s
 * the same way. Only `mcp__github__*` has a route.
 *
 * So the verdict functions here are PURE: they take data the caller already
 * fetched — with MCP in a routine, with `gh` locally — and return a decision.
 * That split is the right one anyway. The bugs above were never in the fetching;
 * they were in deciding what the fetched values meant, which is the half that had
 * no single home.
 *
 * `normalizeMcp()` accepts exactly what the three documented MCP calls return.
 * There is no second, fetching path: one implementation, exercised identically in
 * a routine and on a laptop, is the only way the routine path gets tested at all.
 */

/** Terminal check-run conclusions that do not block a merge. */
const OK_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
/** Terminal statuses that do. Anything else is still running. */
const BAD_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'])

const workflowCache = new Map()

/**
 * Does this repo run GitHub Actions at all?
 *
 * Seeded by the caller from the checkout: `ls <repo>/.github/workflows/*.yml`.
 * **Unknown defaults to TRUE**, because the two errors are not symmetric:
 * assuming a repo has CI makes a missing check block a merge, while assuming it
 * has none would call an untested PR green. Only the second one can ship
 * something broken.
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
 * Three ways to be non-green, kept distinct because the loop's response differs:
 * red is rung-2 work, running is "come back later", and absent-when-expected is
 * usually a conflict — a conflicted PR schedules ZERO workflow runs, silently
 * (why: docs/why.md#a-conflicted-pr-schedules-zero-ci-runs).
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
  // At least one CHECK RUN, not merely one context: a Railway or Cloudflare deploy
  // posts its own status and would otherwise stand in for the test job that never
  // got scheduled.
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
 * `{ verdict: 'MERGE' | 'HOLD', reason, ci }`. Order matters: report the first wall hit.
 *
 * `loopMayNotMerge` is checked FIRST and is not a gate the loop can satisfy. It
 * exists because deriving "no CI" as green (#29) had an edge the ticket did not
 * ask for: `claude-workflow` runs no Actions, so an approved PR there now reads
 * as green and would be merged — and merging there IS the deploy of the
 * instructions every subsequent run executes. Now that the repo is also
 * ticketless, review is the only gate its changes pass at all.
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
 * The review decision, from what `pull_request_read method:get_reviews` returned.
 *
 * ## Why this is a function
 *
 * No MCP call carries `reviewDecision`, so the loop has to derive it — and the
 * only derivation error that can ever ship something is one that INVENTS an
 * approval. Its detector is a merge that should not have happened, in four repos
 * where merging is the deploy. That is not a detector we can afford to arm, so
 * the rule is evaluated here once rather than re-derived from prose on every run.
 *
 * ## `authorized` is an allowlist, and it is the security property
 *
 * Approval authority is `assignment.reviewer`'s. Four of the five repos are
 * **public**, so any GitHub account can submit an `APPROVED` review on an open PR
 * — which means "count everyone except ourselves" would let a stranger's drive-by
 * approval satisfy the gate. An allowlist is also strictly narrower than the
 * `reviewDecision` field this stands in for, rather than wider.
 *
 * Excluding the own login falls out of it: the agent is not the reviewer, so its
 * own reviews are never counted.
 *
 * **An empty or absent `authorized` returns `null`** — no configured authority
 * means no derived approval, which is the safe direction.
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
 * Build the shape `mergeVerdict` wants from what the MCP tools return, so a
 * routine reaches the same decision code a local `gh` run does.
 *
 * Inputs are the three documented calls:
 *   get               → draft, mergeable, mergeable_state, requested_reviewers
 *   get_check_runs    → { check_runs: [{ name, status, conclusion }] }
 *   get_review_comments → { review_threads: [{ is_resolved }] }
 *
 * ⚠ That key is snake_case. The MCP tool returns `is_resolved`; GraphQL returns
 * `isResolved`. Reading only the camelCase spelling made EVERY thread read as
 * unresolved, so any PR that had ever been reviewed inline was held forever —
 * fail-safe, and silent. Both spellings are accepted; absent, a thread counts
 * as unresolved, which is the safe direction.
 *
 * `reviewDecision` has no MCP call of its own and no MCP call carries the field:
 * `pull_request_read method:get` omits it, and `list_pull_requests` has no such
 * member in its `fields` enum. So pass `reviews` — what
 * `pull_request_read method:get_reviews` returned — and `reviewAuthority`
 * (`assignment.reviewer`), and `reviewDecisionFrom` derives it. An explicit
 * `reviewDecision` still wins, for a local `gh` caller that has the real field.
 * Absent both, it is NOT approved — the safe direction, since the only error that
 * can merge something is one that invents an approval.
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
        // MCP says `is_resolved`, GraphQL says `isResolved`. Take either;
        // neither present means unresolved, which is the safe direction.
        isResolved: Boolean(t.is_resolved ?? t.isResolved),
      })),
    },
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: checks } } } }] },
  }
}
