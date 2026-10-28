/**
 * The reconciler: a cheap view of every open item in one repo, and the
 * targets where that view and the board disagree.
 *
 * It replaced a drift sweep that looked only at items updated in the last two
 * hours, on a cron that lands every two to seven, so an item that went quiet
 * between passes was never looked at again (sydevs/WeMeditateWeb#124, #150).
 * Two GraphQL pages per repo read labels, relationships, the open PR, the Hold
 * Until date and the board's Status together; only an item whose cheap facts
 * rule its Status out is gathered in full. On the cron, every Pending item is
 * gathered too, for its due. (why: docs/why.md#the-reconciler-replaces-the-drift-window)
 */

import { fullTreatment, isBot } from './decide.mjs'

const STATUS_FIELD = 'fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } }'

const ISSUES = `query($o:String!,$n:String!,$after:String){ repository(owner:$o,name:$n){
  issues(states:OPEN, first:50, after:$after){ pageInfo{ hasNextPage endCursor } nodes{
    number issueType{ name } labels(first:20){ nodes{ name } }
    blockedBy(first:20){ nodes{ state } }
    closedByPullRequestsReferences(first:5){ nodes{ state } }
    issueFieldValues(first:10){ nodes{ ... on IssueFieldDateValue { value field{ ... on IssueFieldDate { name } } } } }
    projectItems(first:5){ nodes{ project{ number } ${STATUS_FIELD} } } } } } }`

const PRS = `query($o:String!,$n:String!,$after:String){ repository(owner:$o,name:$n){
  pullRequests(states:OPEN, first:50, after:$after){ pageInfo{ hasNextPage endCursor } nodes{
    number isDraft author{ login } labels(first:20){ nodes{ name } }
    projectItems(first:5){ nodes{ project{ number } ${STATUS_FIELD} } } } } } }`

async function pages(github, query, vars, pick) {
  const out = []
  let after = null
  for (;;) {
    const d = await github.graphql(query, after ? { ...vars, after } : vars)
    const page = pick(d)
    if (!page) break
    out.push(...(page.nodes || []))
    if (!page.pageInfo?.hasNextPage) break
    after = page.pageInfo.endCursor
  }
  return out
}

/** The board's Status name for this item, `undefined` when it is not on the board. */
function boardOf(node, config) {
  const item = (node.projectItems?.nodes || []).find((i) => i.project?.number === config.projects?.number)
  if (!item) return undefined
  return item.fieldValueByName?.name || null
}

/**
 * Every open issue and PR in the repo, in the shape `driftTargets` reads.
 * Empty on a read failure: a reconcile that cannot see reconciles nothing,
 * and the next pass tries again.
 */
export async function cheapView(github, config, owner, name) {
  const vars = { o: owner, n: name }
  const holdName = config.issueFields?.holdUntil?.name || 'Hold Until'
  try {
    const issues = await pages(github, ISSUES, vars, (d) => d?.repository?.issues)
    const prs = await pages(github, PRS, vars, (d) => d?.repository?.pullRequests)
    return [
      ...issues.map((i) => ({
        kind: 'issue',
        number: i.number,
        type: i.issueType?.name || null,
        labels: (i.labels?.nodes || []).map((l) => l.name),
        blockedOpen: (i.blockedBy?.nodes || []).filter((b) => b.state === 'OPEN').length,
        prOpen: (i.closedByPullRequestsReferences?.nodes || []).some((p) => p.state === 'OPEN'),
        holdUntil: (i.issueFieldValues?.nodes || []).find((v) => v?.field?.name === holdName)?.value?.slice(0, 10) || null,
        board: boardOf(i, config),
      })),
      ...prs.map((p) => ({
        kind: 'pr',
        number: p.number,
        labels: (p.labels?.nodes || []).map((l) => l.name),
        draft: Boolean(p.isDraft),
        author: p.author?.login || '',
        board: boardOf(p, config),
      })),
    ]
  } catch {
    return []
  }
}

/**
 * The Status keys an item's cheap facts allow. The record — approval, a
 * retry, a hand-back — is not in the cheap view, so a set can hold more
 * than one; a board value outside it is drift, whoever wrote it.
 */
export function allowedStatuses(v, config, now = new Date()) {
  const locked = v.labels.includes(config.labels.lock)
  if (locked) return ['working']
  if (v.kind === 'pr') {
    if (!fullTreatment(v.author, config)) return ['awaiting']
    if (v.draft) return isBot(v.author, config) ? ['pending', 'awaiting'] : ['awaiting']
    return ['awaiting', 'pending']
  }
  if (v.prOpen) return ['done']
  if (v.type === (config.roadmap?.type || 'Roadmap')) return ['awaiting', 'pending', 'blocked', 'hold']
  if (v.blockedOpen) return ['blocked', 'pending']
  if (v.holdUntil && v.holdUntil > now.toISOString().slice(0, 10)) return ['hold', 'pending']
  return ['awaiting', 'pending']
}

/**
 * The targets a cheap view calls for. `full` is the cron: every Pending item
 * is gathered too, since its due lives in the record. An event run passes
 * `limit` and gathers only the disagreements.
 */
export function driftTargets(view, config, repo, { now = new Date(), full = false, limit = Infinity, skip = new Set() } = {}) {
  const names = config.projects?.status || {}
  const keyOf = Object.fromEntries(Object.entries(names).map(([k, v]) => [v, k]))
  const out = []
  for (const v of view) {
    if (out.length >= limit) break
    if (v.labels.includes(config.labels.journal) || skip.has(v.number)) continue
    const key = v.board ? keyOf[v.board] : null
    const drift = v.board === undefined || !key || !allowedStatuses(v, config, now).includes(key)
    if (drift || (full && key === 'pending')) {
      out.push({ repo, kind: v.kind, number: v.number, reason: 'reconcile', event: 'reconcile', facts: { board: v.board ?? null } })
    }
  }
  return out
}
