#!/usr/bin/env node
/**
 * How a session reaches a repo's PR preview, and whether that repo fills one
 * with data at all.
 *
 * ## Why this is a script
 *
 * Two skills need the same two answers. `finalize-pr` needs them to sign in and
 * seed before it writes a preview link; `review-pr` needs the second to decide
 * whether a line in the body may stand in for a link that shows nothing. A
 * computation re-derived on every dispatch is a chance to derive it differently,
 * so it is derived here once, from the repo's own `.claude/workflow.json`.
 *
 * It never fetches. The session sends the request with curl, so this file holds
 * no credential and never opens a connection.
 * (why: docs/why.md#a-script-here-never-fetches)
 *
 * Usage, from `finalize-pr` and `review-pr`:
 *
 *   jq -c '{previewUrl} + {pr: 7}' .claude/workflow.json | node <claude-workflow>/workflow/lib/preview-auth.mjs
 *
 * stdin: `{ previewUrl, pr }` — the repo's `previewUrl` block and the PR number.
 * stdout: `{ host, seedsPreviews, access, signIn, seed }`. `access` names each
 * token variable and says only whether it is set, never its value. `signIn` is
 * null where the repo publishes no gated preview.
 * exit: 0, or 1 when stdin holds no JSON or `loop-config.json` is missing.
 */

import { loadLoopConfig, flag } from './config.mjs'
import { extractJson } from './payload.mjs'

const text = (value) => (typeof value === 'string' && value ? value : null)

/**
 * `previewUrl.pattern` with `{pr}` filled, or null.
 *
 * ⚠ **`https:` only, and the credentials are why.** A session sends the Access
 * service token to whatever this returns, so a `http:` pattern would put the
 * pair on the wire in cleartext and a `file:` one would make a request of the
 * disk. A pattern is a protected-path config value rather than caller input,
 * but the cost of one typo here is a leaked token, so it is checked where it is
 * read rather than trusted where it is written.
 */
export function previewHost(previewUrl, pr) {
  const pattern = text(previewUrl?.pattern)
  if (!pattern) return null
  // Digits only: an interpolated `1@evil.example/x` would otherwise move the
  // whole origin, since the `{pr}` slot sits inside the hostname.
  if (!/^\d+$/.test(String(pr))) return null

  let url
  try {
    url = new URL(pattern.replaceAll('{pr}', String(pr)))
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    return null
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

/**
 * `host` + a route from the repo's own config, or null when the result would
 * not land on `host`.
 *
 * ⚠ **A route is joined, never resolved.** `new URL(path, host)` would let
 * `//evil.example/x` or `@evil.example/x` repoint the origin, and the caller
 * then sends the Access token there. The origin is compared after the join
 * because that is the property worth asserting — not any one of the spellings
 * that break it.
 */
function routeOn(host, path) {
  if (!host || !path || !path.startsWith('/') || path.startsWith('//')) return null
  if (/[@\\\s]|\.\./.test(path)) return null
  const url = `${host}${path}`
  try {
    if (new URL(url).origin !== new URL(host).origin) return null
  } catch {
    return null
  }
  return url
}

/**
 * Which token variables carry the loop's Access service token, and whether this
 * environment holds them.
 *
 * ⚠ **The names come from `loop-config.json`, never from a skill.** A value
 * typed into a `SKILL.md` is a tuning change that cannot be reviewed on its own.
 * `set` is reported per variable because the token is a pair: one half present
 * is a misconfiguration, and Cloudflare logs a blank client id as a failed
 * service-token attempt rather than ignoring it.
 *
 * ⚠ **So `headers` needs both halves SET, not merely named.** The names are
 * configured in every repo, so emitting the pair on a name alone hands a session
 * two headers that expand to empty — which is the failed attempt above, reported
 * to the run as a working credential. SahajCloud's `accessTokenHeaders` answers
 * the same question the same way; two answers here would be one too many.
 */
export function accessPlan(config, env = process.env) {
  const block = config?.previewAccess || {}
  const idVar = text(block.clientIdEnvVar)
  const secretVar = text(block.clientSecretEnvVar)
  const clientId = { envVar: idVar, set: Boolean(idVar && env[idVar]) }
  const clientSecret = { envVar: secretVar, set: Boolean(secretVar && env[secretVar]) }
  return {
    clientId,
    clientSecret,
    // Shell references, so the command a session runs carries the value without
    // this plan ever holding it.
    headers:
      clientId.set && clientSecret.set
        ? [`CF-Access-Client-Id: $${idVar}`, `CF-Access-Client-Secret: $${secretVar}`]
        : [],
  }
}

/**
 * Everything a session needs, from the repo's `previewUrl` block and the PR.
 *
 * `seedsPreviews` is the one verdict both skills read. It is true where the repo
 * declares a usable `previewUrl.seed` or `.auth` — a config key, not a repo name
 * typed into a skill — and it is what turns the body line that admits "no data"
 * from an accepted disclosure into a finding: where a repo's own CI goes red on
 * a preview it could not fill, the red check is the gate and a sentence is not.
 * (why: docs/why.md#a-red-seed-check-outranks-a-line-in-the-body)
 *
 * ⚠ **Usable, not merely present.** An `auth` block too incomplete to sign in
 * with would otherwise raise a finding on every empty preview in a repo where no
 * run can do anything about it — a `should-fix` no author can comply with.
 *
 * The route and the account are the producing repo's, carried in its own
 * `.auth` block; nothing here knows either, so nothing here goes stale when
 * they change.
 */
export function authPlan(input, config, env = process.env) {
  const previewUrl = input?.previewUrl || {}
  const auth = previewUrl.auth || null
  const host = previewHost(previewUrl, input?.pr)
  const seed = text(previewUrl.seed)

  const url = routeOn(host, text(auth?.signInPath))
  const account = text(auth?.account)
  const signIn = url && account && {
    method: 'POST',
    url,
    body: { [text(auth.accountField) ?? 'email']: account },
    // Where the session reads the session token out of the answer.
    tokenField: text(auth.tokenField) ?? 'token',
  }

  const access = accessPlan(config, env)
  return {
    host,
    seedsPreviews: Boolean(seed || signIn),
    // ⚠ The pair goes out only with a gated request. A repo that declares no
    // `.auth` has no Access in front of it, so attaching them there would send
    // the token to an ordinary host — and a preview host a repo has since moved
    // is a name anyone may claim.
    access: signIn ? access : { ...access, headers: [] },
    signIn: signIn || null,
    seed,
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const argv = process.argv.slice(2)
  let stdin = ''
  process.stdin.on('data', (d) => {
    stdin += d
  })
  process.stdin.on('end', () => {
    try {
      const input = extractJson(stdin)
      const config = loadLoopConfig(flag(argv, 'config'))
      console.log(JSON.stringify(authPlan(input, config), null, 2))
    } catch (err) {
      console.error(`preview-auth: ${err.message}`)
      process.exit(1)
    }
  })
}
