#!/usr/bin/env node
/**
 * Does `contractSync` still name files the consumers have?
 *
 * ## Why this exists
 *
 * `contractSync.consumers.<repo>.paths` is the only thing the three contract
 * guards read, and a path the consumer moved makes each one go quiet rather
 * than loud: an absent path is in no diff, and `git status` is clean on a file
 * no command writes. So all three report success about a file the repo no
 * longer builds from. Failing a consumer's CI on it would redden every PR
 * there until the config caught up, the shape WeMeditateWeb#310 was rejected
 * for, so the config is checked where drift on `main` is already fixed — in
 * the audit, whose fix is a `loop-config.json` PR.
 * (why: docs/why.md#a-contract-check-checks-what-a-pr-changes)
 *
 * ## What it does NOT prove
 *
 * It reads names in a tree, never contents. A copy that exists and is stale is
 * the audit's diff, not this, and a copy the config never named is invisible
 * to both. It trusts `start-run` step 6 for a current `origin/main` in each
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

/**
 * Which of `paths` are files in `dir`'s `REF` tree, or `null` when the repo
 * has no `REF` to ask. One `ls-tree` answers both: it lists the pathspecs it
 * finds, and exits non-zero on a ref it cannot resolve. Absence without the
 * ref would prove nothing, so the two cases stay apart.
 */
export function present(dir, paths) {
  let out
  try {
    out = execFileSync('git', ['ls-tree', '-r', '--name-only', REF, '--', ...paths], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
  return new Set(out.split('\n').filter(Boolean))
}

/** The verdict word for rows carrying a `found` flag each. */
export function verdict(rows) {
  return rows.every((r) => r.found) ? 'PATHS PRESENT' : 'PATHS MISSING'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ws = process.argv[2] || '..'
  const pairs = configuredPaths(loadLoopConfig().contractSync?.consumers)

  // No pairs would read as "all present", the silence this script exists to
  // break. Nothing to check means it cannot tell.
  if (!pairs.length) {
    console.error('contractSync.consumers names no paths — nothing to check.')
    process.exit(2)
  }

  const rows = []
  for (const repo of new Set(pairs.map((p) => p.repo))) {
    const dir = join(ws, repo)
    // A missing checkout would throw inside git and read as a missing ref.
    if (!existsSync(dir)) {
      console.error(`no checkout for ${repo} at ${dir}`)
      process.exit(2)
    }
    const paths = pairs.filter((p) => p.repo === repo).map((p) => p.path)
    const found = present(dir, paths)
    if (!found) {
      console.error(`${repo} has no ${REF} — fetch it as start-run step 6 says`)
      process.exit(2)
    }
    for (const path of paths) rows.push({ repo, path, found: found.has(path) })
  }

  for (const r of rows) console.log(`  ${r.found ? 'ok      ' : 'MISSING '} ${r.repo} ${r.path}`)
  const absent = rows.filter((r) => !r.found).length
  console.log(`\n${verdict(rows)} — ${absent} of ${rows.length} configured copies absent.`)
  process.exit(absent ? 1 : 0)
}
