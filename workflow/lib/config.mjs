/**
 * Config lookup and argv parsing for the loop's scripts.
 *
 * This file used to wrap `gh`. It no longer does. The reason is the
 * constraint the whole script layer is built around: a routine cannot reach
 * the GitHub API by any client (why: docs/why.md#a-routine-cannot-reach-the-github-api).
 * A helper that fetches would run only on a maintainer's laptop. That makes
 * it a second implementation of a rule the cloud path executes a different
 * way, and the loop's worst bug to date had exactly that shape.
 *
 * So the run fetches data with MCP. The scripts here take that data and
 * return a decision. Nothing under `workflow/` opens a network connection
 * to GitHub.
 */

import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

/**
 * Locate and parse `loop-config.json`. Walk up from the cwd, then from this
 * file. This throws instead of defaulting. A script that silently assumed
 * the wrong org or bot would give a confident, wrong answer.
 */
export function loadLoopConfig(explicit = null) {
  if (explicit) {
    const path = resolve(explicit)
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'))
    throw new Error(`loop-config.json not found at ${path}`)
  }

  for (const start of [process.cwd(), join(dirname(fileURLToPath(import.meta.url)), '..', '..')]) {
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
 * A repo's `generatedFiles` patterns as `RegExp`, from the text of its
 * `.claude/workflow.json`. The text comes in rather than a path because the
 * four readers reach the file two ways — two from disk, two from `git show`
 * of a base ref. Text that will not parse means no patterns: a caller
 * that cannot read the file skips nothing, which is the safe side here.
 *
 * `review` keeps only the entries that set it, so `{ review: 'skip' }` gives
 * the paths a repo leaves out of finalize-pr's review. Being generated is not
 * enough on its own: the list also names a lockfile and hand-vendored code,
 * and both still want a reviewer
 * (why: docs/why.md#generated-files-stay-out-of-review).
 *
 * An entry whose pattern is missing, empty or will not compile contributes
 * nothing, and costs the others nothing: an empty pattern would match every
 * path, and one bad pattern used to void the whole list.
 */
export function generatedPatterns(text, { review = null } = {}) {
  let entries
  try {
    entries = JSON.parse(text).generatedFiles
  } catch {
    return []
  }
  if (!Array.isArray(entries)) return []
  return entries.flatMap((g) => {
    if (review !== null && g?.review !== review) return []
    if (typeof g?.pattern !== 'string' || !g.pattern) return []
    try {
      return [new RegExp(g.pattern)]
    } catch {
      return []
    }
  })
}

/** `--name value` from argv, with a default. */
export function flag(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
