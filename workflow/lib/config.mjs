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

/** `--name value` from argv, with a default. */
export function flag(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
