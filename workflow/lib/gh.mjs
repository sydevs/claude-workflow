/**
 * Thin `gh` wrappers shared by the loop's scripts.
 *
 * Scripts use `gh`, not the MCP tools, because a script cannot call MCP — and
 * that turns out to be an advantage. See `merge-gate.mjs`: the split between
 * commit statuses and check runs that made the merge gate unsafe is an artifact
 * of the REST endpoints the MCP tools wrap, and GraphQL's `statusCheckRollup`
 * simply does not have it.
 */

import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const MAX_BUFFER = 32 * 1024 * 1024

/** `gh api <path>`, parsed. Throws with gh's own stderr, which is the useful part. */
export function api(path, { paginate = false } = {}) {
  const argv = ['api', path]
  if (paginate) argv.push('--paginate')
  const out = execFileSync('gh', argv, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_BUFFER,
  })
  return out.trim() ? JSON.parse(out) : null
}

/** A GraphQL query, returning `data`. */
export function graphql(query) {
  const out = execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_BUFFER,
  })
  return JSON.parse(out).data
}

/** One page of `search/issues`. A run that touches 100 items has other problems. */
export function search(query) {
  const out = execFileSync(
    'gh',
    ['api', '-X', 'GET', 'search/issues', '-f', `q=${query}`, '-F', 'per_page=100'],
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER },
  )
  return JSON.parse(out).items || []
}

/**
 * Locate and parse `loop-config.json` by walking up from the cwd, then from this
 * file. Fails loudly: a script that silently defaulted to the wrong org or bot
 * would produce confident, wrong answers.
 */
export function loadLoopConfig(explicit = null) {
  const starts = explicit
    ? [resolve(explicit)]
    : [process.cwd(), join(dirname(fileURLToPath(import.meta.url)), '..', '..')]

  for (const start of starts) {
    if (explicit) {
      if (existsSync(start)) return JSON.parse(readFileSync(start, 'utf-8'))
      break
    }
    let dir = resolve(start)
    for (;;) {
      const candidate = join(dir, 'loop-config.json')
      if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf-8'))
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  throw new Error('loop-config.json not found — run from the claude-workflow checkout or pass --config.')
}

/**
 * Search qualifiers restricting a query to the workflow repos.
 *
 * NOT `org:<org>` — the org holds long-retired repositories, and a bare org scope
 * dragged seven-year-old issues out of `Atlas` and `WeMeditate` into the
 * reviewer's queue on the first run of `awaiting-review`. The five repos are
 * enumerated in config for exactly this reason; use them.
 */
export function repoScope(config) {
  return config.repos.map((r) => `repo:${config.org}/${r}`).join(' ')
}

/** `--name value` from argv, with a default. */
export function flag(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
