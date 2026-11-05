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
 *   echo '{"previewUrl":{…},"pr":7}' | node <claude-workflow>/workflow/lib/preview-auth.mjs
 *
 * stdin: `{ previewUrl, pr }` — the repo's `previewUrl` block and the PR number.
 * stdout: `{ host, seedsPreviews, access, signIn, accounts, seed }`. `access`
 * names each token variable and says only whether it is set, never its value.
 * `signIn` is null where the repo publishes no gated preview.
 * exit: 0, or 1 when stdin holds no JSON or `loop-config.json` is missing.
 */

import { loadLoopConfig, flag } from './config.mjs'
import { extractJson } from './payload.mjs'

/** `previewUrl.pattern` with `{pr}` filled, or null when either is missing. */
export function previewHost(previewUrl, pr) {
  const pattern = previewUrl?.pattern
  if (typeof pattern !== 'string' || !pattern) return null
  if (pr === undefined || pr === null || String(pr) === '') return null
  return pattern.replaceAll('{pr}', String(pr)).replace(/\/+$/, '')
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
 */
export function accessPlan(config, env = process.env) {
  const block = config?.previewAccess || {}
  const name = (key) => (typeof block[key] === 'string' && block[key] ? block[key] : null)
  const idVar = name('clientIdEnvVar')
  const secretVar = name('clientSecretEnvVar')
  const ref = (variable) => ['$', variable].join('')
  return {
    clientId: { envVar: idVar, set: Boolean(idVar && env[idVar]) },
    clientSecret: { envVar: secretVar, set: Boolean(secretVar && env[secretVar]) },
    // Shell references, so the command a session runs carries the value without
    // this plan ever holding it.
    headers:
      idVar && secretVar
        ? [`CF-Access-Client-Id: ${ref(idVar)}`, `CF-Access-Client-Secret: ${ref(secretVar)}`]
        : [],
  }
}

/**
 * Everything a session needs, from the repo's `previewUrl` block and the PR.
 *
 * `seedsPreviews` is the one verdict both skills read. It is true where the repo
 * declares `previewUrl.auth` or `.seed` — a config key, not a repo name typed
 * into a skill — and it is what turns the body line that admits "no data" from
 * an accepted disclosure into a finding: where a repo's own CI goes red on a
 * preview it could not fill, the red check is the gate and a sentence is not.
 * (why: docs/why.md#a-red-seed-check-outranks-a-line-in-the-body)
 *
 * The route and the account are the producing repo's, carried in its own
 * `.auth` block; nothing here knows either, so nothing here goes stale when
 * they change.
 */
export function authPlan(input, config, env = process.env) {
  const previewUrl = input?.previewUrl || {}
  const auth = previewUrl.auth || null
  const host = previewHost(previewUrl, input?.pr)
  const seed = typeof previewUrl.seed === 'string' && previewUrl.seed ? previewUrl.seed : null

  const path = typeof auth?.signInPath === 'string' ? auth.signInPath : null
  const account = typeof auth?.account === 'string' ? auth.account : null
  const field = typeof auth?.accountField === 'string' ? auth.accountField : 'email'

  return {
    host,
    seedsPreviews: Boolean(auth || seed),
    access: accessPlan(config, env),
    signIn:
      host && path && account
        ? {
            method: 'POST',
            url: `${host}${path}`,
            body: { [field]: account },
            // Where the session reads the session token out of the answer.
            tokenField: typeof auth.tokenField === 'string' ? auth.tokenField : 'token',
          }
        : null,
    // The page listing which accounts the preview holds, for a run that wants
    // one other than the configured account.
    accounts: host && typeof auth?.accountsPage === 'string' ? `${host}${auth.accountsPage}` : null,
    seed,
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const argv = process.argv.slice(2)
  let text = ''
  process.stdin.on('data', (d) => {
    text += d
  })
  process.stdin.on('end', () => {
    try {
      const input = extractJson(text)
      const config = loadLoopConfig(flag(argv, 'config'))
      console.log(JSON.stringify(authPlan(input, config), null, 2))
    } catch (err) {
      console.error(`preview-auth: ${err.message}`)
      process.exit(1)
    }
  })
}
