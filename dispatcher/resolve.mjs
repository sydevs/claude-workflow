/**
 * Event → targets. Each target is one issue or PR the `act` job will
 * re-derive a decision for, in its own concurrency group. Direct events
 * need no API call here; CI events and the schedule do.
 */

import { isBot } from './decide.mjs'
import { listSweepTargets } from './sweep.mjs'

function repoOf(context) {
  return { owner: context.repo.owner, name: context.repo.repo, full: `${context.repo.owner}/${context.repo.repo}` }
}

export async function resolve({ github, context, config, now = new Date() }) {
  const repo = repoOf(context)
  const ev = context.payload
  const action = ev.action
  const name = context.eventName
  const one = (kind, number, reason, facts = {}) => [{ repo, kind, number, reason, event: `${name}.${action || ''}`.replace(/\.$/, ''), facts }]

  if (name === 'issues') {
    const n = ev.issue.number
    if (action === 'unlabeled') {
      if (ev.label?.name !== config.labels.lock) return []
      return one('issue', n, 'unlock', {})
    }
    if (['opened', 'edited', 'reopened', 'transferred', 'closed'].includes(action)) return one('issue', n, `issues.${action}`, {})
    return []
  }

  if (name === 'issue_comment' && action === 'created') {
    const c = ev.comment
    return one(ev.issue.pull_request ? 'pr' : 'issue', ev.issue.number, 'issue_comment', {
      author: c.user?.login, body: c.body, association: c.author_association, commentId: c.id, triggerType: 'comment',
    })
  }

  if (name === 'pull_request' || name === 'pull_request_target') {
    const pr = ev.pull_request
    const n = pr.number
    if (action === 'unlabeled') {
      if (ev.label?.name !== config.labels.lock) return []
      return one('pr', n, 'unlock', {})
    }
    if (action === 'synchronize') return one('pr', n, 'pull_request.synchronize', { pusherIsBot: isBot(ev.sender?.login, config) })
    if (action === 'closed') return one('pr', n, 'pull_request.closed', { merged: Boolean(pr.merged) })
    if (['opened', 'reopened', 'ready_for_review'].includes(action)) return one('pr', n, `pull_request.${action}`, {})
    return []
  }

  if (name === 'pull_request_review' && (action === 'submitted' || action === 'dismissed')) {
    const r = ev.review
    return one('pr', ev.pull_request.number, 'review', { author: r.user?.login, body: r.body, state: r.state, reviewId: r.id, triggerType: 'review' })
  }

  if (name === 'pull_request_review_comment' && action === 'created') {
    const c = ev.comment
    return one('pr', ev.pull_request.number, 'issue_comment', { author: c.user?.login, body: c.body, association: c.author_association, commentId: c.id, triggerType: 'review_comment' })
  }

  if (name === 'pull_request_review_thread') {
    return one('pr', ev.pull_request.number, 'thread', {})
  }

  if (name === 'workflow_run' || name === 'check_suite' || name === 'status') {
    const sha = ev.workflow_run?.head_sha || ev.check_suite?.head_sha || ev.sha
    if (!sha) return []
    let prs = (ev.workflow_run?.pull_requests || ev.check_suite?.pull_requests || []).map((p) => p.number)
    if (!prs.length) {
      const { data } = await github.rest.repos.listPullRequestsAssociatedWithCommit({ owner: repo.owner, repo: repo.name, commit_sha: sha })
      prs = data.filter((p) => p.state === 'open').map((p) => p.number)
    }
    const out = []
    for (const n of prs) {
      const { data: pr } = await github.rest.pulls.get({ owner: repo.owner, repo: repo.name, pull_number: n })
      if (pr.state !== 'open' || pr.head.sha !== sha) continue
      out.push(...one('pr', n, 'ci', { sha }))
    }
    return out
  }

  if (name === 'schedule' || name === 'workflow_dispatch') {
    return listSweepTargets({ github, config, repo, now })
  }

  return []
}
