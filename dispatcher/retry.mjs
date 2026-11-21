/**
 * Retry a GitHub 5xx, with backoff, under every call the dispatcher makes.
 *
 * One 503 mid-plan used to end the leg: the lease was taken, the lock never
 * written, and every later fire for the item was refused as contention
 * (sydevs/SahajAtlasWeb#318, sydevs/WeMeditateWeb#146). A 4xx is an answer
 * and is never retried; a 5xx or a dropped connection is weather.
 * (why: docs/why.md#a-github-5xx-is-retried-not-fatal)
 *
 * A rate limit is weather too, and the one 4xx that is: the budget comes back
 * at a time GitHub states in the response. Every dispatcher run from 23:00Z to
 * the 23:10Z reset on 2026-11-20 failed, one of them stranding a lease, because
 * a 403 was thrown at once. (why: docs/why.md#a-rate-limited-call-waits-for-the-reset)
 *
 * The same hook counts what a run spends, so a leg's cost is measurable.
 */

const RETRIED = new Set([500, 502, 503, 504])
const RATE_LIMITED = new Set([403, 429])

export function retriable(e) {
  return RETRIED.has(e?.status) || (!e?.status && /ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|other side closed/i.test(String(e?.message || '')))
}

/**
 * How long to wait before this error's budget comes back, in milliseconds, or
 * null when it is not a rate limit.
 *
 * `x-ratelimit-remaining: 0` is the primary limit, and `x-ratelimit-reset` is
 * when it refills. `retry-after` is a secondary limit, in seconds. A 403 with
 * neither is a permission refusal, which no wait fixes.
 */
export function rateLimitWait(e, now = Date.now()) {
  if (!RATE_LIMITED.has(e?.status)) return null
  // Octokit lowercases what it parses, and carries it on `response` for a
  // request error and at the top level for a few older shapes.
  const h = e?.response?.headers || e?.headers || {}
  const reset = Number(h['x-ratelimit-reset'])
  if (String(h['x-ratelimit-remaining']) === '0' && Number.isFinite(reset) && reset > 0) return Math.max(1000, reset * 1000 - now)
  // Converted only once the header is known to be there: `Number(undefined)`
  // is NaN but `Number(null)` is 0, which would read a 403 carrying no
  // rate-limit header at all as "wait no time and try again".
  const after = h['retry-after']
  if (after === undefined || after === null) return null
  const seconds = Number(after)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.max(1000, seconds * 1000) : null
}

/**
 * Run `fn`, retrying a retriable failure `attempts - 1` times, waiting `baseMs`,
 * then twice that, and so on. A rate limit instead waits exactly as long as the
 * response says, and only while that is within `rateLimitMaxWaitMs`.
 *
 * One `delay` for both: a third class of retriable failure is one more arm
 * here, not one more copy of the attempt bookkeeping.
 */
export async function withRetry(fn, { attempts = 3, baseMs = 2000, rateLimitMaxWaitMs = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  for (let i = 1; ; i += 1) {
    try {
      return await fn()
    } catch (e) {
      const wait = rateLimitWait(e, now())
      const delay = wait !== null
        ? (wait <= rateLimitMaxWaitMs ? wait : null)
        : (retriable(e) ? baseMs * 2 ** (i - 1) : null)
      if (i >= attempts || delay === null) throw e
      await sleep(delay)
    }
  }
}

/** What this client has spent: one count per request actually sent, retries included. */
export function apiCounts(github) {
  return github?.__sydevsApi || { rest: 0, graphql: 0 }
}

/** `api: <n> REST, <m> GraphQL`, for a log line at the end of a run or a leg. */
export function apiCountLine(github) {
  const { rest, graphql } = apiCounts(github)
  return `api: ${rest} REST, ${graphql} GraphQL`
}

/**
 * Wrap the Octokit client's request hook once. REST, `paginate` and GraphQL
 * all pass through it. A client without a hook is left as it is.
 */
export function installRetry(github, config, opts = {}) {
  if (!github?.hook?.wrap || github.__sydevsRetry) return github
  const r = config.dispatch?.githubRetry || {}
  const options = { attempts: r.attempts ?? 3, baseMs: (r.baseSeconds ?? 2) * 1000, rateLimitMaxWaitMs: (r.rateLimitMaxWaitSeconds ?? 0) * 1000, ...opts }
  const counts = { rest: 0, graphql: 0 }
  github.__sydevsApi = counts
  github.hook.wrap('request', (request, req) => {
    // Classified once per request, counted once per attempt: a retry spends a
    // second call against the budget, so it is a second count.
    const kind = /\/graphql\b/.test(String(req?.url || '')) ? 'graphql' : 'rest'
    return withRetry(() => { counts[kind] += 1; return request(req) }, options)
  })
  github.__sydevsRetry = true
  return github
}
