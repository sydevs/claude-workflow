/**
 * Read GitHub into one snapshot per target. Every decision in `decide.mjs`
 * is a function of this object, so the reads live here and nowhere else.
 * `merge-gate.mjs` is imported unchanged: it is the one definition of green
 * and mergeable. (why: docs/why.md#ci-truth-lives-in-check-runs)
 */

import { ciVerdict, mergeVerdict, normalizeMcp, setRepoWorkflows } from '../workflow/lib/merge-gate.mjs'
import { loadRecord } from './record.mjs'
import { parseBlockedBy, parseRecheck, parseSentry, datePassed } from './markers.mjs'
import { isBot, isDispatcherComment } from './decide.mjs'

function comment(c) {
  return { id: c.id, author: c.user?.login || '', createdAt: c.created_at, body: c.body || '', association: c.author_association }
}

async function newestComments(gh, { owner, repo, number }, total, perPage = 10) {
  const page = Math.max(1, Math.ceil((total || 0) / perPage))
  const { data } = await gh.rest.issues.listComments({ owner, repo, issue_number: number, per_page: perPage, page })
  const out = data.map(comment)
  if (page > 1 && out.length < perPage) {
    const { data: prev } = await gh.rest.issues.listComments({ owner, repo, issue_number: number, per_page: perPage, page: page - 1 })
    out.unshift(...prev.map(comment))
  }
  return out
}

async function reviewThreads(gh, { owner, repo, number }) {
  const q = `query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ pullRequest(number:$n){
    reviewThreads(first:100){ nodes { id isResolved comments(first:50){ nodes { author { login } createdAt body databaseId } } } } } } }`
  const d = await gh.graphql(q, { o: owner, r: repo, n: number })
  return (d.repository.pullRequest.reviewThreads.nodes || []).map((t) => ({
    id: t.id,
    isResolved: t.isResolved,
    comments: (t.comments.nodes || []).map((c) => ({ author: c.author?.login || '', createdAt: c.createdAt, body: c.body, id: c.databaseId })),
  }))
}

async function linkedIssues(gh, { owner, repo, number }) {
  const q = `query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ pullRequest(number:$n){ closingIssuesReferences(first:10){ nodes { number } } } } }`
  try {
    const d = await gh.graphql(q, { o: owner, r: repo, n: number })
    return d.repository.pullRequest.closingIssuesReferences.nodes.map((x) => x.number)
  } catch {
    return []
  }
}

async function openPrsClosing(gh, { owner, repo, number }) {
  const q = `query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){ closedByPullRequestsReferences(first:10){ nodes { number state isDraft } } } } }`
  try {
    const d = await gh.graphql(q, { o: owner, r: repo, n: number })
    return d.repository.issue.closedByPullRequestsReferences.nodes.filter((p) => p.state === 'OPEN').map((p) => p.number)
  } catch {
    return []
  }
}

async function dependencies(gh, { owner, repo, number }, which) {
  try {
    const { data } = await gh.request(`GET /repos/{owner}/{repo}/issues/{n}/dependencies/${which}`, { owner, repo, n: number, per_page: 100 })
    return (data || []).map((i) => ({ owner: i.repository?.owner?.login || owner, repo: i.repository?.name || repo, number: i.number, state: i.state }))
  } catch (e) {
    return { error: e.message }
  }
}

async function pollMergeable(gh, { owner, repo, number }, pr) {
  let cur = pr
  for (let i = 0; i < 5 && (cur.mergeable === null || cur.mergeable === undefined); i += 1) {
    await new Promise((r) => setTimeout(r, 3000))
    const { data } = await gh.rest.pulls.get({ owner, repo, pull_number: number })
    cur = data
  }
  return cur
}

export async function gather(gh, target, config, { now = new Date() } = {}) {
  const { owner, name } = target.repo
  const repo = name
  const number = target.number
  const bot = config.identity.expectedLogin
  const base = { owner, repo, number }

  const { data: issue } = await gh.rest.issues.get({ owner, repo, issue_number: number })
  const labels = (issue.labels || []).map((l) => l.name || l)
  const record = await loadRecord(gh, base)
  const comments = await newestComments(gh, base, issue.comments)
  const botLast = comments.filter((c) => isBot(c.author, config) && !isDispatcherComment(c.body)).map((c) => c.createdAt).sort().pop() || null
  const newestHuman = comments.filter((c) => !isBot(c.author, config) && !isDispatcherComment(c.body)).map((c) => c.createdAt).sort().pop() || null

  const s = {
    kind: issue.pull_request ? 'pr' : 'issue',
    repo: { owner, name: repo, full: `${owner}/${repo}` },
    item: { number, nodeId: issue.node_id, state: issue.state, title: issue.title, body: issue.body || '', labels, author: issue.user?.login || '', htmlUrl: issue.html_url, updatedAt: issue.updated_at },
    locked: labels.includes(config.labels.lock),
    record: record.rec,
    recordId: record.id,
    comments,
    botSpokeLast: Boolean(botLast && (!newestHuman || botLast > newestHuman)),
    now,
  }

  if (s.kind === 'issue') {
    const blockedBy = await dependencies(gh, base, 'blocked_by')
    const markerBlockers = parseBlockedBy(issue.body, config.org, config.relationships?.bodyMarker)
    const recheck = parseRecheck(issue.body, config.relationships?.recheckMarker)
    s.markers = { blockedBy: markerBlockers, recheck, recheckPassed: datePassed(recheck, now) }
    s.blockedByOpen = Array.isArray(blockedBy) ? blockedBy.filter((b) => b.state === 'open') : []
    s.blockedByError = Array.isArray(blockedBy) ? null : blockedBy.error
    s.openPrsClosingIt = await openPrsClosing(gh, base)
    const blocking = target.reason === 'issues.closed' ? await dependencies(gh, base, 'blocking') : []
    s.dependents = Array.isArray(blocking)
      ? blocking.filter((d) => d.state === 'open').map((d) => ({ repo: { owner: d.owner, name: d.repo, full: `${d.owner}/${d.repo}` }, kind: 'issue', number: d.number, facts: { closedNumber: number } }))
      : []
    return s
  }

  // ---- pull request ----------------------------------------------------
  let { data: pr } = await gh.rest.pulls.get({ owner, repo, pull_number: number })
  if (pr.state === 'open') pr = await pollMergeable(gh, base, pr)
  const reviews = await gh.paginate(gh.rest.pulls.listReviews, { owner, repo, pull_number: number, per_page: 100 })
  const threads = pr.state === 'open' ? await reviewThreads(gh, base) : []
  const ignore = new Set(config.ci?.ignoreCheckNames || [])
  const { data: cr } = await gh.rest.checks.listForRef({ owner, repo, ref: pr.head.sha, per_page: 100, filter: 'latest' })
  const checkRuns = { check_runs: (cr.check_runs || []).filter((c) => !ignore.has(c.name)).map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion })) }
  const { data: st } = await gh.rest.repos.getCombinedStatusForRef({ owner, repo, ref: pr.head.sha })
  const statuses = { statuses: (st.statuses || []).map((x) => ({ context: x.context, state: x.state })) }
  setRepoWorkflows(`${owner}/${repo}`, !(config.ci?.noCi || []).includes(repo))
  const inlineCounts = new Map()
  for (const t of threads) for (const c of t.comments) inlineCounts.set(c.author, (inlineCounts.get(c.author) || 0) + 1)
  const reviewsShaped = reviews.map((r) => ({ user: { login: r.user?.login }, state: r.state, body: r.body, submitted_at: r.submitted_at, inline_count: 0 }))
  const normalized = normalizeMcp({
    pr, checkRuns, statuses,
    reviewThreads: { review_threads: threads.map((t) => ({ is_resolved: t.isResolved })) },
    reviews: reviewsShaped,
    reviewAuthority: [config.assignment.reviewer],
  })
  s.pr = { number: pr.number, state: pr.state, merged: pr.merged, draft: pr.draft, user: { login: pr.user?.login }, head: { ref: pr.head?.ref, sha: pr.head?.sha }, base: { ref: pr.base?.ref }, changed_files: pr.changed_files, additions: pr.additions, deletions: pr.deletions, nodeId: pr.node_id, requestedReviewers: (pr.requested_reviewers || []).map((u) => u.login) }
  s.mergeable = normalized.mergeable
  s.reviews = reviewsShaped
  s.threads = threads
  s.normalized = normalized
  s.ci = ciVerdict(normalized, `${owner}/${repo}`)
  s.verdict = mergeVerdict(normalized, `${owner}/${repo}`, config.mergePolicy || {})
  s.linkedIssues = await linkedIssues(gh, base)
  if (target.reason === 'pull_request.closed' && target.facts?.merged) {
    s.linkedIssueDetails = []
    for (const n of s.linkedIssues) {
      const { data: li } = await gh.rest.issues.get({ owner, repo, issue_number: n })
      s.linkedIssueDetails.push({ number: n, sentry: parseSentry(li.body) })
    }
    const open = await gh.paginate(gh.rest.pulls.list, { owner, repo, state: 'open', per_page: 100 })
    s.otherOpenBotPrs = open.filter((p) => p.number !== number && !p.draft && isBot(p.user?.login, config)).map((p) => p.number)
  } else {
    s.otherOpenBotPrs = []
  }
  return s
}

