#!/usr/bin/env node
/**
 * Which directives a prose change added or removed.
 *
 * ## Why this exists
 *
 * `ste-lint.py` measures a skill's STYLE. This measures its CONTENT. A rewrite
 * can score perfectly on the first and fail the second, and that is not
 * hypothetical: the rewrite of `journal/SKILL.md` took its violations from 16
 * to 4 and its size down by a third, and silently dropped
 * **Never read the board back** — half of `docs/why.md#the-board-is-a-lens`.
 * Lint called that rewrite a clear improvement, because by its measure it was.
 *
 * This repo has no way to validate a skill by running it: an edit takes effect
 * next session, and merging is the deploy. A dropped rule surfaces weeks later
 * as a run behaving oddly, with nothing to attribute it to. This is the closest
 * thing to a regression test that prose admits.
 *
 * ## What it does NOT prove
 *
 * Hold it at its real strength. It sees **bold imperatives only**, so a rule
 * written as plain prose is invisible to it. It cannot catch semantic weakening
 * — `Never X` to `Avoid X` fuzzy-matches and passes. It cannot tell you a
 * surviving rule is still correct, or still in the right file. It is a
 * tripwire, not a proof.
 *
 * ## Usage
 *
 *   rule-delta.mjs --base main                 # git ref vs the working tree
 *   rule-delta.mjs before/ after/              # two directories
 *
 * Exits 1 when a directive disappeared with no close match, which is the case
 * that needs a human. (why: docs/why.md#lint-measures-style-not-content)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * A directive is bold, or a heading. Both carry the same force in these skills,
 * and catching only the first makes a promotion to a heading look like a
 * deletion — which it did, for `Never write state the state machine owns`.
 */
const DIRECTIVE = /\*\*((?:Never|Always|Do not|Don.t)[^*]{5,110})\*\*|^#{2,4} ((?:Never|Always|Do not|Don.t)[^\n]{5,110})$/gim

/**
 * Pull every bold imperative out of one document.
 *
 * Whitespace collapses FIRST, and that is load-bearing rather than tidy:
 * markdown wraps a directive across lines, so a line-oriented match misses it.
 * Skipping this step produced a false "GONE" on `Never force-push someone
 * else's branch` — a rule that had never moved.
 */
export function directives(text) {
  const headings = new Set([...String(text).matchAll(/^#{2,4} ((?:Never|Always|Do not|Don.t)[^\n]{5,110})$/gim)]
    .map((m) => m[1].trim()))
  const flat = String(text).replace(/\s+/g, ' ')
  const bold = [...flat.matchAll(/\*\*((?:Never|Always|Do not|Don.t)[^*]{5,110})\*\*/gi)]
    .map((m) => m[1].trim())
  return new Set([...bold, ...headings])
}

/** Crude similarity, enough to tell a reworded rule from a deleted one. */
function similar(a, b) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean)
  const [x, y] = [new Set(norm(a)), new Set(norm(b))]
  const shared = [...x].filter((w) => y.has(w)).length
  return shared / Math.max(x.size, y.size, 1)
}

/**
 * Compare two directive sets.
 *
 * `removed` is what a reviewer must adjudicate: a directive with no close match
 * on the other side. Rewordings are filtered out on purpose — a raw diff of
 * this change reported 14 disappearances, 11 of which were `Do not X` becoming
 * `Never X`. A reviewer handed 14 items starts skimming, and skimming is how
 * the one real removal gets waved through.
 */
export function compare(before, after, threshold = 0.55) {
  const rewordings = []
  const removed = []
  for (const b of before) {
    if (after.has(b)) continue
    const near = [...after].map((a) => [similar(b, a), a]).sort((p, q) => q[0] - p[0])[0]
    if (near && near[0] >= threshold) rewordings.push([b, near[1]])
    else removed.push(b)
  }
  const added = [...after].filter((a) => !before.has(a) &&
    ![...before].some((b) => similar(a, b) >= threshold))
  return { removed, added, rewordings, counts: { before: before.size, after: after.size } }
}

// ---------------------------------------------------------------- CLI

const mdFiles = (dir) => {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...mdFiles(p))
    else if (e.endsWith('.md')) out.push(p)
  }
  return out
}

const collect = (dir) => {
  const all = new Set()
  for (const f of mdFiles(dir)) for (const d of directives(readFileSync(f, 'utf8'))) all.add(d)
  return all
}

/** Read the same paths out of a git ref. Local only — no network, so a routine can run it. */
const collectRef = (ref, dir) => {
  const all = new Set()
  for (const f of mdFiles(dir)) {
    let text = ''
    try { text = execFileSync('git', ['show', `${ref}:${f}`], { encoding: 'utf8' }) } catch { continue }
    for (const d of directives(text)) all.add(d)
  }
  return all
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const args = process.argv.slice(2)
  const baseIdx = args.indexOf('--base')
  const dir = args.find((a) => !a.startsWith('--') && a !== args[baseIdx + 1]) || 'workflow/skills'

  const [before, after] = baseIdx !== -1
    ? [collectRef(args[baseIdx + 1], dir), collect(dir)]
    : [collect(args[0]), collect(args[1])]

  const r = compare(before, after)
  console.log(`directives: ${r.counts.before} → ${r.counts.after}`)
  if (r.rewordings.length) console.log(`reworded:   ${r.rewordings.length} (filtered — not shown)`)
  if (r.added.length) {
    console.log(`\nADDED (${r.added.length}):`)
    for (const a of r.added) console.log('  +', a)
  }
  if (r.removed.length) {
    console.log(`\nREMOVED — adjudicate each (${r.removed.length}):`)
    for (const x of r.removed) console.log('  -', x)
    console.log('\nEach one is either a rule you meant to drop, or a rule that fell out.')
    console.log('Say which, in the PR body.')
  } else {
    console.log('\nNo directive disappeared.')
  }
  process.exit(r.removed.length ? 1 : 0)
}
