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

function headersOf(e) {
  const h = e?.response?.headers || e?.headers || {}
  return (name) => {
    const v = h[name] ?? h[name.toLowerCase()]
    return v === undefined || v === null ? null : String(v)
  }
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
  const header = headersOf(e)
  const remaining = header('x-ratelimit-remaining')
  const reset = Number(header('x-ratelimit-reset'))
  if (remaining === '0' && Number.isFinite(reset) && reset > 0) return Math.max(1000, reset * 1000 - now)
  // Tested for absence first: `Number(null)` is 0, which would read a 403
  // carrying no rate-limit header at all as "wait no time and try again".
  const after = header('retry-after')
  if (after !== null && Number.isFinite(Number(after)) && Number(after) >= 0) return Math.max(1000, Number(after) * 1000)
  return null
}

/**
 * Run `fn`, retrying a retriable failure `attempts - 1` times, waiting `baseMs`,
 * then twice that, and so on. A rate limit instead waits exactly as long as the
 * response says, and only while that is within `rateLimitMaxWaitMs`.
 */
export async function withRetry(fn, { attempts = 3, baseMs = 2000, rateLimitMaxWaitMs = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  for (let i = 1; ; i += 1) {
    try {
      return await fn()
    } catch (e) {
      const wait = rateLimitWait(e, now())
      if (wait !== null) {
        if (i >= attempts || wait > rateLimitMaxWaitMs) throw e
        await sleep(wait)
        continue
      }
      if (i >= attempts || !retriable(e)) throw e
      await sleep(baseMs * 2 ** (i - 1))
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
  github.hook.wrap('request', (request, req) => withRetry(() => {
    counts[/\/graphql\b/.test(String(req?.url || '')) ? 'graphql' : 'rest'] += 1
    return request(req)
  }, options))
  github.__sydevsRetry = true
  return github
}
