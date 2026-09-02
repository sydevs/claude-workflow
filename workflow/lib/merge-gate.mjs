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
 * `normalizeMcp()` accepts exactly what the three documented MCP calls return, so
 * the loop's cloud path and a maintainer's local path reach the same code.
 */

import { api, graphql } from './gh.mjs'

/** Terminal check-run conclusions that do not block a merge. */
const OK_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
/** Terminal statuses that do. Anything else is still running. */
const BAD_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'])

const workflowCache = new Map()

/**
 * Does this repo run GitHub Actions at all? Derived rather than configured, so it
 * cannot go stale the day someone adds a workflow.
 *
 * Pre-seed it with `setRepoWorkflows()` where there is no fetch path — a routine
 * reads the count with `mcp__github__list_workflows` and passes it in. Unknown
 * defaults to TRUE: assuming a repo has CI makes a missing check block a merge,
 * where assuming it has none would call an untested PR green.
 */
export function setRepoWorkflows(repo, hasWorkflows) {
  workflowCache.set(repo, Boolean(hasWorkflows))
}

export function repoHasWorkflows(repo) {
  if (!workflowCache.has(repo)) {
    try {
      workflowCache.set(repo, (api(`repos/${repo}/actions/workflows`)?.total_count ?? 0) > 0)
    } catch {
      return true
    }
  }
  return workflowCache.get(repo)
}

const PR_QUERY = (owner, name, number) => `{
  repository(owner:"${owner}",name:"${name}"){
    pullRequest(number:${number}){
      number title isDraft url
      author{login}
      reviewDecision mergeable mergeStateStatus
      headRefName baseRefName
      assignees(first:10){nodes{login}}
      reviewRequests(first:10){nodes{requestedReviewer{... on User{login}}}}
      reviewThreads(first:100){nodes{isResolved isOutdated}}
      closingIssuesReferences(first:20){nodes{number repository{nameWithOwner}}}
      commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){nodes{
        __typename
        ... on CheckRun{name conclusion status}
        ... on StatusContext{context state}
      }}}}}}
    }
  }
}`

/**
 * Read one PR. `mergeable` is computed lazily by GitHub and comes back `UNKNOWN`
 * on a cold read, so one retry — a verdict of "conflicted" on a value GitHub has
 * not computed yet would strand a healthy PR.
 */
export function readPr(repo, number) {
  const [owner, name] = repo.split('/')
  let pr = graphql(PR_QUERY(owner, name, number))?.repository?.pullRequest
  if (pr && pr.mergeable === 'UNKNOWN') {
    pr = graphql(PR_QUERY(owner, name, number))?.repository?.pullRequest
  }
  return pr
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


/**
 * Build the shape `mergeVerdict` wants from what the MCP tools return, so a
 * routine reaches the same decision code a local `gh` run does.
 *
 * Inputs are the three documented calls:
 *   get               → draft, mergeable, mergeable_state, requested_reviewers
 *   get_check_runs    → { check_runs: [{ name, status, conclusion }] }
 *   get_review_comments → { review_threads: [{ isResolved }] }
 *
 * `reviewDecision` has no MCP call of its own, so it is derived from
 * `list_pull_requests`' reviewDecision where available, or passed explicitly.
 * Absent, it is treated as NOT approved — the safe direction, since the only
 * error that can merge something is one that invents an approval.
 */
export function normalizeMcp({ pr, checkRuns, statuses, reviewThreads, reviewDecision }) {
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
    reviewDecision: reviewDecision || pr?.reviewDecision || null,
    reviewThreads: { nodes: (reviewThreads?.review_threads || []).map((t) => ({ isResolved: t.isResolved })) },
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: checks } } } }] },
  }
}
