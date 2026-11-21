#!/usr/bin/env node
/**
 * Does `contractSync` still name files the consumers have?
 *
 * ## Why this exists
 *
 * `contractSync.consumers.<repo>.paths` is the only thing the three contract
 * guards read, and each one goes quiet rather than loud when a consumer moves
 * its copy. `.github/actions/contract-check` diffs an absent path, finds
 * nothing touched and passes. `contracts-sync` finds `git status` clean on a
 * path its command never writes, and opens no PR. `audit-contracts` reads that
 * same clean status as current. So all three report success about a file the
 * repo no longer builds from, which is the silence `wisdom_sidetext` was
 * hand-edited into a copy under (WeMeditateWeb#269).
 *
 * Failing a consumer's CI on an absent configured path would redden every PR
 * in that repo until the config caught up — the shape WeMeditateWeb#310 was
 * rejected for. So the config is checked where drift on `main` is already
 * fixed, in the audit, and a miss is fixed by a `loop-config.json` PR.
 * (why: docs/why.md#a-contract-check-checks-what-a-pr-changes)
 *
 * ## What it does NOT prove
 *
 * It reads names in a tree, never contents. A copy that exists and is stale is
 * step 2's diff, not this, and a copy the config never named is invisible to
 * both. It trusts `start-run` step 6 for a current `origin/main` in each
 * checkout, because nothing under `workflow/` fetches.
 * (why: docs/why.md#a-routine-clone-is-not-a-developers-checkout)
 *
 * ## Usage
 *
 *   contract-paths.mjs <workspace-dir>   # the directory holding the checkouts
 *
 * Prints `PATHS PRESENT`, or `PATHS MISSING` naming each repo and path. Act on
 * the verdict word. Exits 1 on `PATHS MISSING`, and 2 when it cannot tell.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadLoopConfig } from './config.mjs'

/** The one ref a copy is judged against: what the repo really builds from. */
export const REF = 'origin/main'

/** Every configured copy as a `{repo, path}` pair, in config order. */
export function configuredPaths(consumers = {}) {
  return Object.entries(consumers).flatMap(([repo, c]) =>
    (c.paths || []).map((path) => ({ repo, path })),
  )
}

/** The pairs `exists(repo, path)` cannot find. */
export function missing(pairs, exists) {
  return pairs.filter(({ repo, path }) => !exists(repo, path))
}

/** The verdict word for a set of missing pairs. */
export function verdict(gone) {
  return gone.length ? 'PATHS MISSING' : 'PATHS PRESENT'
}

const git = (dir, args) => {
  try {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Does `dir` have `REF` at all? Without it, absence proves nothing. */
export function hasRef(dir) {
  return git(dir, ['rev-parse', '--verify', '--quiet', `${REF}^{commit}`])
}

/** Is `path` a file in `dir`'s `REF` tree? */
export function inTree(dir, path) {
  return git(dir, ['cat-file', '-e', `${REF}:${path}`])
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ws = process.argv[2] || '..'
  const pairs = configuredPaths(loadLoopConfig().contractSync?.consumers)

  // An empty answer would read as "all present", which is the failure this
  // script exists to stop. Nothing to check means it cannot tell.
  if (!pairs.length) {
    console.error('contractSync.consumers names no paths — nothing to check.')
    process.exit(2)
  }

  for (const repo of new Set(pairs.map((p) => p.repo))) {
    const dir = join(ws, repo)
    if (!existsSync(dir)) {
      console.error(`no checkout for ${repo} at ${dir}`)
      process.exit(2)
    }
    if (!hasRef(dir)) {
      console.error(`${repo} has no ${REF} — fetch it as start-run step 6 says`)
      process.exit(2)
    }
  }

  const gone = missing(pairs, (repo, path) => inTree(join(ws, repo), path))
  for (const { repo, path } of pairs) {
    const bad = gone.some((g) => g.repo === repo && g.path === path)
    console.log(`  ${bad ? 'MISSING  ' : 'ok       '} ${repo} ${path}`)
  }

  console.log(`\n${verdict(gone)} — ${gone.length} of ${pairs.length} configured copies absent.`)
  process.exit(gone.length ? 1 : 0)
}
