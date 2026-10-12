#!/usr/bin/env node
/**
 * Which failed Railway previews a `fix-ci` deploy pass reads, and the exact
 * request that reads each one's logs.
 *
 * ## Why this is a script
 *
 * A failing preview reaches the loop only as a commit status, and no
 * `mcp__github__*` tool returns one. The dispatcher copies each red status
 * the ruleset does not require into the record's `ci.advisory`, with its
 * `target_url`. That URL holds the deployment id, so parsing it is the one
 * route to the build log. The dispatcher and the session both need the same
 * answer: the dispatcher to decide whether a pass is worth firing, the
 * session to know what to read. One definition serves both.
 *
 * It never fetches. The session sends the request with curl, so this file
 * holds no credential and never opens a connection.
 * (why: docs/why.md#a-failed-preview-is-read-from-its-log)
 *
 * Usage, from the `fix-ci` skill in `deploy` mode:
 *
 *   node <claude-workflow>/workflow/lib/railway.mjs < record.json
 *
 * stdout: `{ apiBase, tokenEnvVar, tokenHeader, tokenSet, deployments }`, where
 * each deployment is `{ name, targetUrl, projectId, serviceId, deploymentId,
 * environmentId, request }` and `request` is the GraphQL body to POST.
 * `tokenSet` says only whether the variable is set, never its value.
 * exit: 0, or 1 when stdin holds no JSON or `loop-config.json` is missing.
 */

import { loadLoopConfig, flag } from './config.mjs'
import { extractJson } from './payload.mjs'

/** A Railway project token authenticates with this header, not `Authorization`. */
export const TOKEN_HEADER = 'Project-Access-Token'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HOSTS = new Set(['railway.com', 'railway.app'])

/**
 * The ids in a Railway deployment link, or null for anything else.
 *
 * Railway's status links look like
 * `https://railway.com/project/<project>/service/<service>?id=<deployment>&environmentId=<environment>`
 * (sydevs/SahajCloud#879, 2026-10-12). Only that shape parses. A status
 * link is whatever its poster set, so every id must be a UUID.
 */
export function deploymentFrom(url) {
  let u
  try {
    u = new URL(String(url))
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) return null
  const m = /^\/project\/([^/]+)\/service\/([^/]+)\/?$/.exec(u.pathname)
  const deploymentId = u.searchParams.get('id') || ''
  if (!m || !UUID.test(m[1]) || !UUID.test(m[2]) || !UUID.test(deploymentId)) return null
  const environmentId = u.searchParams.get('environmentId') || ''
  return { projectId: m[1], serviceId: m[2], deploymentId, environmentId: UUID.test(environmentId) ? environmentId : null }
}

/**
 * The advisory rows that are failed Railway previews: a status whose context
 * `railway.statusContexts` lists, with a link that parses. Empty when the
 * config has no `railway` key, so a repo without one keeps the bare link.
 */
export function failedDeploys(advisory, config) {
  const contexts = new Set(config?.railway?.statusContexts || [])
  const out = []
  for (const a of advisory || []) {
    if (a?.kind !== 'status' || !contexts.has(a.name)) continue
    const ids = deploymentFrom(a.targetUrl)
    if (ids) out.push({ name: a.name, targetUrl: a.targetUrl, ...ids })
  }
  return out
}

/** The GraphQL body that reads one deployment's build log and its runtime log. */
export function logRequest(deploymentId, limit) {
  return {
    query: 'query deployLogs($deploymentId: String!, $limit: Int) { buildLogs(deploymentId: $deploymentId, limit: $limit) { timestamp message severity } deploymentLogs(deploymentId: $deploymentId, limit: $limit) { timestamp message severity } }',
    variables: { deploymentId, limit: Number.isInteger(limit) && limit > 0 ? limit : 500 },
  }
}

/** Everything a deploy pass needs to read its logs, from the record and the config. */
export function readPlan(record, config, env = process.env) {
  const r = config?.railway || {}
  const tokenEnvVar = typeof r.tokenEnvVar === 'string' && r.tokenEnvVar ? r.tokenEnvVar : null
  return {
    apiBase: r.apiBase || null,
    tokenEnvVar,
    tokenHeader: TOKEN_HEADER,
    tokenSet: Boolean(tokenEnvVar && env[tokenEnvVar]),
    deployments: failedDeploys(record?.ci?.advisory, config).map((d) => ({ ...d, request: logRequest(d.deploymentId, r.logLines) })),
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const argv = process.argv.slice(2)
  let text = ''
  process.stdin.on('data', (d) => { text += d })
  process.stdin.on('end', () => {
    try {
      const record = extractJson(text)
      const config = loadLoopConfig(flag(argv, 'config'))
      console.log(JSON.stringify(readPlan(record, config), null, 2))
    } catch (err) {
      console.error(`railway: ${err.message}`)
      process.exit(1)
    }
  })
}
