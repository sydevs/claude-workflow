#!/usr/bin/env node
/**
 * Prove a branch changed test files and nothing else.
 *
 * ## Why this exists
 *
 * A test-only fix skips the ticket and goes straight to a PR, from any
 * handler (start-run's incidental-finding table). That route is safe only
 * because a test change cannot alter what ships. "I only touched tests" is a
 * promise. This turns it into a check: every changed path must match
 * `findings.testGlobs` in `loop-config.json`.
 *
 * ## What it does NOT prove
 *
 * It reads paths, never contents. A spec that loosens its own assertion
 * passes. So does a test config that stops running half the suite. The
 * reviewer still judges whether each test is still a real guard. This only
 * proves no product file moved.
 *
 * ## Usage
 *
 *   test-only.mjs --base origin/main    # the branch point vs the working tree
 *   test-only.mjs --base origin/main --json
 *
 * Prints `TEST-ONLY`, `NOT TEST-ONLY` with every path outside the globs, or
 * `EMPTY`. Act on the verdict word. Exits 0 only on `TEST-ONLY`.
 */

import { execFileSync } from 'node:child_process'
import { matchesGlob } from 'node:path'
import { pathToFileURL } from 'node:url'
import { flag, loadLoopConfig } from './config.mjs'
import { repoRoot, resolveBaseRefOrExit } from './base-ref.mjs'

/** Split `paths` into those inside `globs` and those outside. */
export function classify(paths, globs) {
  const inside = []
  const outside = []
  for (const p of paths) (globs.some((g) => matchesGlob(p, g)) ? inside : outside).push(p)
  return { inside, outside }
}

/** The verdict word for a classification. */
export function verdict({ inside, outside }) {
  if (!inside.length && !outside.length) return 'EMPTY'
  return outside.length ? 'NOT TEST-ONLY' : 'TEST-ONLY'
}

const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean)

function changedPaths(root, baseline) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
  // Tracked changes against the branch point, committed or not, plus new
  // files git has not seen yet. A new file is still a changed path.
  const tracked = lines(git(['diff', '--name-only', baseline]))
  const untracked = lines(git(['ls-files', '--others', '--exclude-standard']))
  return [...new Set([...tracked, ...untracked])].sort()
}

function main(argv) {
  const base = flag(argv, 'base')
  if (!base) {
    console.error('Usage: test-only.mjs --base <ref> [--json] [--config <loop-config.json>]')
    process.exit(2)
  }
  const globs = loadLoopConfig(flag(argv, 'config'))?.findings?.testGlobs
  if (!Array.isArray(globs) || !globs.length) {
    console.error('loop-config.json has no findings.testGlobs.')
    process.exit(2)
  }
  const root = repoRoot()
  const { baseline } = resolveBaseRefOrExit(base, { root })
  const result = classify(changedPaths(root, baseline), globs)
  const word = verdict(result)
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ verdict: word, ...result }, null, 2))
  } else {
    console.log(`${word} — ${result.inside.length} test file(s), ${result.outside.length} outside findings.testGlobs`)
    for (const p of result.outside) console.log(`  outside: ${p}`)
  }
  process.exit(word === 'TEST-ONLY' ? 0 : 1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
