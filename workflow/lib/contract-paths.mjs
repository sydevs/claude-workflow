#!/usr/bin/env node
/**
 * Does `contractSync` still name files the consumers have?
 *
 * ## Why this exists
 *
 * `contractSync.consumers.<repo>.paths` is what the three contract guards
 * compare, and a path the consumer moved makes each one go quiet rather than
 * loud: an absent path is in no diff, and `git status` is clean on a file no
 * command writes. So all three report success about a file the repo no
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
 * to both. A `sources` entry the producer moved stops the dispatcher firing a
 * sync, and that staleness reaches the audit's diff instead.
 *
 * A `paths` entry must name a file as the tree spells it, since membership is
 * exact. `contract-paths.test.mjs` holds the real config to that. The caller
 * fetches: nothing under `workflow/` does, so a stale `origin/main` answers
 * about the commit it was left at.
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ws = process.argv[2] || '..'
  const consumers = loadLoopConfig().contractSync?.consumers || {}

  const rows = []
  for (const [repo, c] of Object.entries(consumers)) {
    const paths = c.paths || []
    if (!paths.length) continue
    const dir = join(ws, repo)
    // A missing checkout would throw inside git and read as a missing ref.
    if (!existsSync(dir)) {
      console.error(`no checkout for ${repo} at ${dir}`)
      process.exit(2)
    }
    const found = present(dir, paths)
    if (!found) {
      console.error(`${repo}: cannot read ${REF}. Is it a checkout, and fetched?`)
      process.exit(2)
    }
    for (const path of paths) rows.push({ repo, path, found: found.has(path) })
  }

  // No rows would read as "all present", the silence this script exists to
  // break. Nothing to check means it cannot tell.
  if (!rows.length) {
    console.error('contractSync.consumers names no paths — nothing to check.')
    process.exit(2)
  }

  for (const r of rows) console.log(`  ${r.found ? 'ok      ' : 'MISSING '} ${r.repo} ${r.path}`)
  const absent = rows.filter((r) => !r.found).length
  const word = absent ? 'PATHS MISSING' : 'PATHS PRESENT'
  console.log(`\n${word} — ${absent} of ${rows.length} configured copies absent.`)
  process.exit(absent ? 1 : 0)
}
