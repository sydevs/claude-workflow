/**
 * Config lookup and argv parsing for the loop's scripts.
 *
 * This file used to wrap `gh`. It does not any more, and the reason is the
 * constraint the whole script layer is built around: **a routine cannot reach the
 * GitHub API by any client** (why: docs/why.md#a-routine-cannot-reach-the-github-api).
 * A helper that fetches would only ever run on a maintainer's laptop, which makes
 * it a second implementation of a rule the cloud path executes some other way —
 * and the loop's worst bug to date was exactly that shape.
 *
 * So: the run fetches with MCP, and the scripts here take data and return a
 * decision. Nothing under `workflow/` opens a network connection to GitHub.
 */

import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

/**
 * Locate and parse `loop-config.json`, walking up from the cwd and then from this
 * file. Throws rather than defaulting: a script that silently assumed the wrong
 * org or bot would produce confident, wrong answers.
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
