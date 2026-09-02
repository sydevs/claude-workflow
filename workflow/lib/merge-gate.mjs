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
 * GraphQL's `statusCheckRollup` merges both surfaces into one list, so the split
 * that caused #26 does not exist here. The "no CI" case is DERIVED from the
 * repo's workflow count rather than configured, so it cannot go stale the day
 * someone adds a workflow.
 */

import { api, graphql } from './gh.mjs'

/** Terminal check-run conclusions that do not block a merge. */
const OK_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
/** Terminal statuses that do. Anything else is still running. */
const BAD_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'])

const workflowCache = new Map()

/** Does this repo run GitHub Actions at all? Derived, so it cannot go stale. */
export function repoHasWorkflows(repo) {
  if (!workflowCache.has(repo)) {
    let count = 0
    try {
      count = api(`repos/${repo}/actions/workflows`)?.total_count ?? 0
    } catch {
      count = 0
    }
    workflowCache.set(repo, count > 0)
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
