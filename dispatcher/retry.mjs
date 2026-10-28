/**
 * Retry a GitHub 5xx, with backoff, under every call the dispatcher makes.
 *
 * One 503 mid-plan used to end the leg: the lease was taken, the lock never
 * written, and every later fire for the item was refused as contention
 * (sydevs/SahajAtlasWeb#318, sydevs/WeMeditateWeb#146). A 4xx is an answer
 * and is never retried; a 5xx or a dropped connection is weather.
 * (why: docs/why.md#a-github-5xx-is-retried-not-fatal)
 */

const RETRIED = new Set([500, 502, 503, 504])

export function retriable(e) {
  return RETRIED.has(e?.status) || (!e?.status && /ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|other side closed/i.test(String(e?.message || '')))
}

/** Run `fn`, retrying a retriable failure `attempts - 1` times, waiting `baseMs`, then twice that, and so on. */
export async function withRetry(fn, { attempts = 3, baseMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 1; ; i += 1) {
    try {
      return await fn()
    } catch (e) {
      if (i >= attempts || !retriable(e)) throw e
      await sleep(baseMs * 2 ** (i - 1))
    }
  }
}

/**
 * Wrap the Octokit client's request hook once. REST, `paginate` and GraphQL
 * all pass through it. A client without a hook is left as it is.
 */
export function installRetry(github, config, opts = {}) {
  if (!github?.hook?.wrap || github.__sydevsRetry) return github
  const r = config.dispatch?.githubRetry || {}
  const options = { attempts: r.attempts ?? 3, baseMs: (r.baseSeconds ?? 2) * 1000, ...opts }
  github.hook.wrap('request', (request, req) => withRetry(() => request(req), options))
  github.__sydevsRetry = true
  return github
}
