#!/usr/bin/env node
/**
 * Has the shared code-comments rule drifted between its four copies?
 *
 * ## Why this exists
 *
 * The rule has to load every session in four repos, and the only mechanism
 * that reliably loads is a file each repo owns. So there are four copies,
 * which is the drift this plugin exists to prevent — accepted here because
 * the alternatives are worse. A plugin cannot ship standing context at all:
 * a `CLAUDE.md` at a plugin root is not loaded as project context. A single
 * copy at the workspace root reaches no teammate, no CI, and none of the
 * cloud routines, because each clones one repo on its own.
 *
 * Four copies with a weekly check beats four copies nobody compares.
 *
 * ## What it does NOT prove
 *
 * Only the canonical block is compared. Everything below `canonical:end` is
 * each repo's own carve-outs, which SHOULD differ — this cannot tell you a
 * carve-out is still true, or that a repo is missing one it now needs. It
 * also cannot see a rule that stopped loading: check the symlink separately.
 *
 * ## Usage
 *
 *   comment-rule-sync.mjs <workspace-dir>
 *
 * Exits 1 on drift, or on a copy that is missing or unreadable.
 */

import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

const START = '<!-- canonical:start'
const END = '<!-- canonical:end -->'
const CANON = 'claude-workflow/docs/code-comments.md'
const COPIES = ['SahajCloud', 'WeMeditateWeb', 'SahajAtlasWeb', 'SahajAtlasWordpress']

/**
 * The shared block, normalized for whitespace only.
 *
 * A copy wraps its prose at the same width, so a reflow is not drift. A
 * changed word is.
 */
export function canonicalBlock(text) {
  const a = text.indexOf(START)
  const b = text.indexOf(END)
  if (a === -1 || b === -1) return null
  return text
    .slice(text.indexOf('-->', a) + 3, b)
    .replace(/\s+/g, ' ')
    .trim()
}

const ws = process.argv[2] || '..'
const canonPath = join(ws, CANON)

if (!existsSync(canonPath)) {
  console.error(`canonical rule not found: ${canonPath}`)
  process.exit(2)
}

// The canonical file carries the rule as prose, not between markers — it is
// the source the copies are cut from, so take its whole "## The rule" section.
const canonText = readFileSync(canonPath, 'utf8')
const reference = (() => {
  const fromCopy = COPIES.map((r) => join(ws, r, 'docs/rules/code-comments.md'))
    .filter((p) => existsSync(p))
    .map((p) => canonicalBlock(readFileSync(p, 'utf8')))
    .filter(Boolean)
  return fromCopy[0] ?? null
})()

if (!reference) {
  console.error('no copy carries a canonical block — nothing to compare')
  process.exit(2)
}

let drifted = 0
for (const repo of COPIES) {
  const p = join(ws, repo, 'docs/rules/code-comments.md')
  if (!existsSync(p)) {
    console.log(`  MISSING   ${repo}`)
    drifted++
    continue
  }
  const block = canonicalBlock(readFileSync(p, 'utf8'))
  if (!block) {
    console.log(`  NO MARKERS ${repo}`)
    drifted++
    continue
  }

  const link = join(ws, repo, '.claude/rules/code-comments.md')
  let loads = false
  try {
    loads = existsSync(link) && realpathSync(link) === realpathSync(p)
  } catch {
    loads = false
  }

  if (block !== reference) {
    console.log(`  DRIFTED   ${repo}`)
    drifted++
  } else if (!loads) {
    console.log(`  NOT LOADED ${repo} — .claude/rules/code-comments.md does not resolve to the rule`)
    drifted++
  } else {
    console.log(`  ok        ${repo}`)
  }
}

// A canonical file whose prose no longer matches what the copies carry is
// drift too, in the direction nobody checks: the source moved and the copies
// did not.
const canonWords = canonText.replace(/\s+/g, ' ')
const missing = reference
  .split(/(?=- \*\*)/)
  .map((s) => s.trim())
  .filter((s) => s.startsWith('- **'))
  .map((s) => s.slice(4, s.indexOf('**', 4)))
  .filter((d) => d && !canonWords.includes(d))

if (missing.length) {
  console.log(`\n  SOURCE DRIFT — the copies carry directives ${CANON} does not:`)
  for (const m of missing) console.log(`    - ${m}`)
  drifted++
}

console.log(drifted ? `\n${drifted} problem(s).` : '\nAll four copies match, and all four load.')
process.exit(drifted ? 1 : 0)
