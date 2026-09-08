/**
 * The `/fire` client. Builds the dispatch record (a pointer, never
 * instructions) and starts one session on the repo's routine; the
 * record's `handler` field selects the skill inside that session.
 * (why: docs/why.md#the-payload-is-a-pointer)
 */

const ENDPOINT = 'https://api.anthropic.com/v1/claude_code/routines'
const BETA = 'experimental-cc-routine-2026-04-01'

/** `SahajCloud` → `SAHAJCLOUD`, `claude-workflow` → `CLAUDE_WORKFLOW`. One routine per repo. */
export function secretKey(repoName) {
  return String(repoName).toUpperCase().replace(/-/g, '_')
}

/** Routine id from the environment (`ROUTINE_ID_<REPO>`), else `dispatch.routines[repo]`. */
export function routineIdFor(repoName, config, env = process.env) {
  const fromEnv = env[`${config.dispatch.routineIdVarPrefix || 'ROUTINE_ID_'}${secretKey(repoName)}`]
  if (fromEnv) return fromEnv
  return config.dispatch.routines?.[repoName] || null
}

/** Bearer token from the environment (`ROUTINE_TOKEN_<REPO>`). */
export function tokenFor(repoName, config, env = process.env) {
  return env[`${config.dispatch.routineTokenSecretPrefix || 'ROUTINE_TOKEN_'}${secretKey(repoName)}`] || null
}

export function buildRecord({ handler, target, snapshot, flags, attempt, journalNumber, config, now }) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const minutes = config.dispatch.timeoutsMinutes?.[handler] ?? 60
  const deadline = new Date(now.getTime() + minutes * 60_000).toISOString()
  const pr = snapshot.pr
  return {
    v: 1,
    id: `${target.repo.name}-${target.number}-${handler}-${stamp}`,
    handler,
    repo: target.repo.full,
    kind: target.kind,
    number: target.number,
    url: snapshot.item?.htmlUrl || `https://github.com/${target.repo.full}/${target.kind === 'pr' ? 'pull' : 'issues'}/${target.number}`,
    head: pr ? { ref: pr.head?.ref || null, sha: pr.head?.sha || null } : null,
    event: target.event || target.reason,
    trigger: { type: target.facts?.triggerType || target.reason, id: target.facts?.commentId ?? target.facts?.reviewId ?? null, author: target.facts?.author || null },
    lock: config.labels.lock,
    flags: { onDemand: flags?.onDemand === true, delegated: flags?.delegated === true },
    attempt,
    fixCi: snapshot.record?.fixCi || 0,
    ci: snapshot.ci ? { green: snapshot.ci.green, reason: snapshot.ci.reason } : null,
    deadline,
    journal: { repo: `${config.org}/${config.journalRepo}`, issue: journalNumber },
    firedAt: now.toISOString(),
  }
}

/**
 * POST the record. Returns one of:
 *   { ok: true, status: 200, session, url }
 *   { ok: false, status: 429, retryAfter }   // ISO time to retry at
 *   { ok: false, status: 400 }               // routine paused
 *   { ok: false, status: <other>, error }
 */
export async function fireRoutine({ token, routineId, record, fetchImpl = globalThis.fetch, now = new Date(), config }) {
  const res = await fetchImpl(`${ENDPOINT}/${routineId}/fire`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': BETA,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: JSON.stringify(record) }),
  })
  if (res.status === 200) {
    const j = await res.json()
    return { ok: true, status: 200, session: j.claude_code_session_id, url: j.claude_code_session_url }
  }
  if (res.status === 429) {
    const ra = res.headers.get('retry-after')
    let retryAt
    if (ra && /^\d+$/.test(ra)) retryAt = new Date(now.getTime() + Number(ra) * 1000)
    else if (ra && !Number.isNaN(Date.parse(ra))) retryAt = new Date(ra)
    else retryAt = new Date(now.getTime() + (config?.dispatch?.fireRetry?.default429Seconds ?? 600) * 1000)
    return { ok: false, status: 429, retryAfter: retryAt.toISOString(), retryAfterSeconds: Math.max(0, Math.round((retryAt - now) / 1000)) }
  }
  let error = ''
  try { error = (await res.text()).slice(0, 500) } catch { /* ignore */ }
  return { ok: false, status: res.status, error }
}
