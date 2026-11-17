#!/usr/bin/env node
/**
 * Where a repo's PR preview lives, so a link can be checked against it.
 *
 * ## Why this is a script
 *
 * `review-pr` reads `## Preview` links out of a PR body that a stranger may have
 * written, and needs one answer to "is this link on a host the repo publishes?".
 * A computation re-derived on every dispatch is a chance to derive it
 * differently, so it is derived here once, from the repo's own
 * `.claude/workflow.json`.
 *
 * It holds no credential and never fetches or opens a connection: no skill sends
 * a request to a preview any more, so the check is only whether a link is the
 * repo's own. (why: docs/why.md#a-preview-link-is-whatever-its-poster-wrote,
 * docs/why.md#a-script-here-never-fetches)
 *
 * Usage, from `review-pr`:
 *
 *   jq -c '{previewUrl, fixture} + {pr: 7}' .claude/workflow.json | node <claude-workflow>/workflow/lib/preview-host.mjs
 *
 * stdin: `{ previewUrl, fixture, pr }` — the repo's two blocks and the PR number.
 * stdout: `{ host, fixtureHost }`: the origin each block names, or null.
 * exit: 0, or 1 when stdin holds no JSON.
 *
 * With `--on-host <url>` it answers `ON_HOST` or `OFF_HOST` for that one URL
 * instead: `ON_HOST` when the URL's origin is `host` or `fixtureHost`.
 */

import { flag } from './config.mjs'
import { extractJson } from './payload.mjs'

const text = (value) => (typeof value === 'string' && value ? value : null)

// Digits only: an interpolated `1@evil.example/x` would otherwise move the whole
// origin, since the `{pr}` slot sits inside the hostname.
const isPr = (pr) => /^\d+$/.test(String(pr))

/**
 * `previewUrl.pattern` with `{pr}` filled, or null.
 *
 * ⚠ **`https:` only.** A `http:` pattern would name a cleartext host and a
 * `file:` one the disk. A pattern is a protected-path config value rather than
 * caller input, but it is checked where it is read rather than trusted where it
 * is written.
 */
export function previewHost(previewUrl, pr) {
  const pattern = text(previewUrl?.pattern)
  if (!pattern || !isPr(pr)) return null

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
 * The origin `fixture.link` names for this PR, or null.
 *
 * The template carries `{pr}`, `{collection}` and `{id}`; only `{pr}` can sit in
 * the host, so the other two are filled with placeholders to parse it. Same
 * `https:`-only and digits-only rules as `previewHost`.
 */
export function fixtureHost(fixture, pr) {
  const link = text(fixture?.link)
  if (!link || !isPr(pr)) return null

  let url
  try {
    url = new URL(
      link.replaceAll('{pr}', String(pr)).replaceAll('{collection}', 'x').replaceAll('{id}', '1'),
    )
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return url.origin
}

/** Every verdict this script can print. The skills key on these words. */
export const VERDICTS = ['ON_HOST', 'OFF_HOST']

/**
 * Whether a URL is on `host`: https, and the same origin, nothing else.
 *
 * ⚠ **A `## Preview` link is whatever its poster wrote.** The dispatcher fires
 * `review-pr` on a stranger's PR whenever a person asks for one, so a body can
 * point anywhere. The origin is compared here rather than eyeballed in prose, so
 * `host.evil.example`, a port, `http:` and another PR's host all fail.
 */
export function onHost(host, url) {
  if (!host || !url) return false
  let target
  try {
    target = new URL(String(url))
  } catch {
    return false
  }
  if (target.protocol !== 'https:') return false
  try {
    return target.origin === new URL(host).origin
  } catch {
    return false
  }
}

/** The hosts a repo publishes previews on, for this PR. */
export function previewPlan(input) {
  return {
    host: previewHost(input?.previewUrl, input?.pr),
    fixtureHost: fixtureHost(input?.fixture, input?.pr),
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
      const plan = previewPlan(extractJson(stdin))
      const target = flag(argv, 'on-host')
      // A verdict word, so a caller reads the answer and never an exit code.
      const verdict =
        onHost(plan.host, target) || onHost(plan.fixtureHost, target) ? 'ON_HOST' : 'OFF_HOST'
      console.log(target ? verdict : JSON.stringify(plan, null, 2))
    } catch (err) {
      console.error(`preview-host: ${err.message}`)
      process.exit(1)
    }
  })
}
