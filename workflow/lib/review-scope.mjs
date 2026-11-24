#!/usr/bin/env node
/**
 * Decide what finalize-pr's reviews read, and whether they fan out at all.
 *
 * ## Why this exists
 *
 * finalize-pr runs `/simplify`, `/code-review high` and, on a trigger,
 * `/security-review` over the branch diff. Two things about that diff are
 * mechanical, so a script owns them rather than each run's prose:
 *
 * - **Scope.** A path is left out of review only where the repo opts it out:
 *   a `generatedFiles` entry with `"review": "skip"`, such as a migration
 *   snapshot a command writes from a schema the diff already shows. A path
 *   `securityReview.triggerPattern` matches stays in review regardless,
 *   because the trigger is the repo saying "read this".
 * - **Tier.** At or under `review.skipWhen`, counted over the paths kept in
 *   review, the run reads the diff itself instead of starting two fan-outs.
 *
 * ## What it does NOT do
 *
 * It reads paths and line counts, never contents. It does not decide whether
 * the security review runs: that is step 3's trigger check over the whole
 * diff. `.claude/workflow.json` comes from the base, so a branch cannot widen
 * its own skip list (why: docs/why.md#generated-files-stay-out-of-review).
 * `loop-config.json` comes from the claude-workflow checkout, as every script
 * here reads it. Where none is at hand, as in a member's installed plugin, the
 * tier is FULL.
 *
 * ## Usage
 *
 *   review-scope.mjs --base origin/main
 *   review-scope.mjs --base origin/main --json
 *
 * Prints `TINY` or `FULL`, the counts, then one `review:` or `skip:` line per
 * changed path. Act on the verdict word. Anything it cannot read makes the
 * verdict `FULL` and skips nothing, and the reason is printed. A diff whose
 * every path would be skipped skips nothing, so something is always read.
 */

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { flag, loadLoopConfig, reviewSkipPatterns } from './config.mjs'
import { repoRoot, resolveBaseRefOrExit } from './base-ref.mjs'

export const VERDICTS = ['TINY', 'FULL']

/**
 * Parse `git diff --numstat -z --no-renames` output into `{ path, lines }`.
 * A binary file prints `-` for both counts and costs no lines.
 */
export function parseNumstat(text) {
  return text
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const [added, deleted, path] = record.split('\t')
      const n = (v) => (v === '-' ? 0 : Number(v) || 0)
      return { path, lines: n(added) + n(deleted) }
    })
}

/**
 * Split changed files into review and skip, and pick the tier.
 * `skipWhen` null means the threshold could not be read: the tier is FULL.
 */
export function classify(files, { skip = [], trigger = null, skipWhen = null }) {
  let review = []
  let skipped = []
  for (const f of files) {
    const kept = (trigger && trigger.test(f.path)) || !skip.some((re) => re.test(f.path))
    ;(kept ? review : skipped).push(f)
  }
  if (!review.length) [review, skipped] = [skipped, []]
  const lines = review.reduce((sum, f) => sum + f.lines, 0)
  const tiny = Boolean(skipWhen) && review.length <= skipWhen.maxFiles && lines <= skipWhen.maxLines
  return { verdict: tiny ? 'TINY' : 'FULL', files: review.length, lines, review, skipped }
}

/** A compiled trigger, or null when the repo sets none or it will not compile. */
function triggerFrom(text) {
  try {
    const pattern = JSON.parse(text).securityReview?.triggerPattern
    return pattern ? new RegExp(pattern) : null
  } catch {
    return null
  }
}

function main(argv) {
  const base = flag(argv, 'base')
  if (!base) {
    console.error('Usage: review-scope.mjs --base <ref> [--json] [--config <loop-config.json>]')
    process.exit(2)
  }
  const root = repoRoot()
  const { baseline } = resolveBaseRefOrExit(base, { root })
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'ignore'] })

  const notes = []
  let workflow = '{}'
  try {
    workflow = git(['show', `${baseline}:.claude/workflow.json`])
  } catch {
    notes.push('the base has no .claude/workflow.json, so nothing is skipped')
  }
  let skipWhen = null
  try {
    const w = loadLoopConfig(flag(argv, 'config'))?.review?.skipWhen
    if (Number.isFinite(w?.maxFiles) && Number.isFinite(w?.maxLines)) skipWhen = w
    else notes.push('loop-config.json has no review.skipWhen, so the tier is FULL')
  } catch {
    notes.push('loop-config.json not found, so the tier is FULL')
  }

  // --no-renames reports a rename as a delete and an add: it can only raise
  // the count, which errs toward FULL.
  let files
  try {
    files = parseNumstat(git(['diff', '--numstat', '-z', '--no-renames', baseline, 'HEAD']))
  } catch {
    console.log(`FULL — git diff ${baseline.slice(0, 7)} HEAD failed, so nothing is skipped and the reviews read the whole diff`)
    return
  }
  const result = classify(files, { skip: reviewSkipPatterns(workflow), trigger: triggerFrom(workflow), skipWhen })

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ...result, notes }, null, 2))
    return
  }
  console.log(`${result.verdict} — ${result.files} file(s), ${result.lines} line(s) in review, ${result.skipped.length} skipped`)
  for (const n of notes) console.log(`  note: ${n}`)
  for (const f of result.review) console.log(`  review: ${f.path}`)
  for (const f of result.skipped) console.log(`  skip: ${f.path}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
