#!/usr/bin/env node
/**
 * The mechanical half of a comment sweep.
 *
 * ## Why this exists
 *
 * Three of the five tiers in a comment sweep need no judgement at all, and
 * doing them by hand across 877 files is both slow and less safe than a
 * codemod — a tired reader deletes the wrong line, a script does not.
 *
 * Tier 5, compressing a bloated *why* down to the fact a reader needs, is the
 * opposite: every case needs a model that has read the surrounding code. That
 * tier is not here, and should not be. This tool exists so that the human and
 * the model spend their attention on tier 5 rather than on scaffolding.
 *
 * ## Run it from Bash, never through the Edit tool
 *
 * The workflow plugin fires `prettier-format` and `eslint-fix` as PostToolUse
 * on the Edit and Write TOOLS. A codemod invoked from Bash trips neither. The
 * same sweep driven through Edit would be roughly 900 edits and 1,800 hook
 * processes in SahajCloud alone, each spawning the package manager.
 *
 * ## What it does NOT do
 *
 * It never judges whether a comment is TRUE, and never rewrites prose. It
 * moves scaffolding and deletes restatement, both by structure. Where a
 * decision needs reading, it reports a candidate instead of acting — tier 3's
 * `--report` list is exactly that, and is meant to be handed to a model in
 * batches, not applied blind.
 *
 * It also refuses to touch anything `comment-protect.json` protects. That
 * refusal is a floor, not a proof: run `comment-fingerprint.mjs` afterwards,
 * which is what actually holds the guarantee.
 *
 * ## Usage
 *
 *   comment-sweep.mjs --repo <dir> --tier 1 --dry-run
 *   comment-sweep.mjs --repo <dir> --tier 1,2 --write
 *   comment-sweep.mjs --repo <dir> --tier 3 --report      # candidates only
 */

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { commentRanges, RULES } from './comment-fingerprint.mjs'

const FROZEN = RULES.frozen.map((r) => new RegExp(r.pattern, (r.flags || '') + 'm'))
const KEEP = RULES.keep.filter((r) => !r.pathGlob).map((r) => new RegExp(r.pattern, (r.flags || '') + 'm'))

/** A protected comment is never rewritten, never moved, never deleted. */
const protectedComment = (text) =>
  FROZEN.some((re) => re.test(text)) || KEEP.some((re) => re.test(text))

/**
 * A rule line: the `// ======` border of a section banner.
 *
 * Two dialects exist in this workspace and a single pattern misses one.
 * SahajCloud writes a three-line block; SahajAtlasWeb writes the label inline
 * between two short runs, already one line, and so is left alone.
 */
const RULE_LINE = /^\/\/\s*[=\-*_#]{6,}\s*$/
const INLINE_BANNER = /^\/\/\s*[=\-]{3,}\s*(.+?)\s*[=\-]{3,}\s*(\/\/)?$/

/**
 * Tier 1 — a three-line banner becomes one line, keeping its label.
 *
 * The label is navigation, and deleting it costs a reader more than the two
 * lines save. Only the borders go.
 */
export function tier1(src, ranges) {
  const edits = []
  const singles = ranges.filter((r) => src.slice(r.pos, r.end).startsWith('//'))
  for (let i = 0; i < singles.length; i++) {
    const text = (r) => src.slice(r.pos, r.end).trim()
    if (!RULE_LINE.test(text(singles[i]))) continue

    // Collect the label lines up to the closing border.
    const label = []
    let j = i + 1
    while (j < singles.length && label.length <= 3 && !RULE_LINE.test(text(singles[j]))) {
      const body = text(singles[j]).replace(/^\/\/\s?/, '').trim()
      if (!body) break
      label.push(body)
      j++
    }
    if (j >= singles.length || !RULE_LINE.test(text(singles[j])) || !label.length) continue
    if (label.some((l) => protectedComment(l))) continue

    const words = label.join(' ')
    const pretty = words.length > 3 && words === words.toUpperCase()
      ? words.charAt(0) + words.slice(1).toLowerCase()
      : words

    edits.push({ from: singles[i].pos, to: singles[j].end, text: `// --- ${pretty} ---` })
    i = j
  }
  return edits
}

/**
 * Tier 2 — a single-sentence JSDoc block becomes a one-liner.
 *
 * ⚠ **Any `@` tag disqualifies the block, not just `@example`.** The
 * TypeScript language service reads `@param`, `@returns`, `@throws` and
 * `@deprecated` for editor hover documentation. Collapsing a tagged block
 * destroys that silently: nothing lints it and no test covers it.
 */
export function tier2(src, ranges, printWidth = 100) {
  const edits = []
  for (const r of ranges) {
    const text = src.slice(r.pos, r.end)
    if (!text.startsWith('/**') || !text.includes('\n')) continue
    if (text.includes('@')) continue
    if (protectedComment(text)) continue

    const lines = text
      .replace(/^\/\*\*/, '')
      .replace(/\*\/$/, '')
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter(Boolean)

    // Exactly one line of prose, never two joined.
    //
    // Splitting on sentence punctuation looked equivalent and was not: a
    // wrapped block whose first line simply ends without a full stop reads as
    // one sentence to a regex. Collapsing `Admin password for seed scripts
    // authentication` above `Minimum 8 characters` produced a run-on carrying
    // two facts and no punctuation between them — a worse comment than the
    // one it replaced, which is the only outcome this tier must never have.
    if (lines.length !== 1) continue
    const body = lines[0]
    if (!body) continue

    const indent = src.slice(src.lastIndexOf('\n', r.pos) + 1, r.pos).match(/^\s*/)[0]
    const line = `/** ${body} */`
    if (indent.length + line.length > printWidth) continue

    edits.push({ from: r.pos, to: r.end, text: line })
  }
  return edits
}

const STOP = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'in', 'on', 'and', 'or', 'this', 'that', 'its', 'it', 'we', 'up', 'from', 'with', 'into', 'by', 'as', 'at', 'is', 'are', 'be'])
const words = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w))
const identifiers = (line) =>
  new Set((line.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []).flatMap((id) => words(id.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))))

/**
 * Tier 3 — narration whose every word the next line already says.
 *
 * Deliberately narrow. `// Build status text` above `const statusText = …`
 * qualifies because the comment adds no token the code lacks. Anything with a
 * word the code does not carry is only a CANDIDATE, reported and never
 * deleted: that is where a real *why* hides, and an automatic deletion there
 * is the one mistake this whole exercise cannot take back.
 */
export function tier3(src, ranges) {
  const edits = []
  const candidates = []

  // A `//` run is ONE comment wearing several line markers, and only the whole
  // run means anything. Scoring its last line alone deleted `// listing.` off
  // the end of a four-line rationale, leaving "a region manager cannot act on
  // the" — a mangled sentence, from a rule meant to remove restatement. Only
  // an isolated single-line comment is eligible.
  const lineOf = (pos) => src.slice(0, pos).split('\n').length
  const commentLines = new Set(
    ranges.filter((r) => src.slice(r.pos, r.end).startsWith('//')).map((r) => lineOf(r.pos)),
  )

  for (const r of ranges) {
    const text = src.slice(r.pos, r.end)
    if (!text.startsWith('//') || text.includes('\n')) continue
    if (protectedComment(text)) continue

    // A banner is navigation, and its label naturally repeats the identifiers
    // in the section below it — the exact shape this rule scores as
    // restatement. Left unguarded it deleted the banners tier 1 had just
    // written, in the same run.
    if (/^\/\/\s*[=\-*_#\u2500-\u257F]{3,}/.test(text) || /[=\-\u2500-\u257F]{3,}\s*(\/\/)?$/.test(text)) continue

    // A trailing comment carries what a literal cannot say about itself —
    // units, an enum's spelling, why a zero is a zero. It sits beside the
    // identifiers it explains, so it always scores as covered.
    // `meditationTitleMap: Map<…> // meditation title → Meditation ID` and
    // `width: 0, // Dimension extraction disabled` both died to this rule.
    const lineStart = src.lastIndexOf('\n', r.pos) + 1
    if (src.slice(lineStart, r.pos).trim() !== '') continue

    const ln = lineOf(r.pos)
    if (commentLines.has(ln - 1) || commentLines.has(ln + 1)) continue

    const body = text.replace(/^\/\/\s?/, '').trim()
    const w = words(body)
    if (!w.length || w.length > 6) continue

    const after = src.slice(r.end).split('\n').slice(1).find((l) => l.trim()) || ''
    const ids = identifiers(after)
    const covered = w.filter((x) => ids.has(x)).length
    const line = src.slice(0, r.pos).split('\n').length

    if (covered === w.length) {
      // The whole line goes, not just the comment, when nothing else is on it.
      const lineEnd = src.indexOf('\n', r.end)
      edits.push({ from: lineStart, to: lineEnd !== -1 ? lineEnd + 1 : r.end, text: '' })
    } else if (covered / w.length >= 0.5) {
      candidates.push({ line, text: body, next: after.trim().slice(0, 70) })
    }
  }
  return { edits, candidates }
}

/** Apply edits back-to-front so earlier offsets stay valid. */
function apply(src, edits) {
  return [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce((out, e) => out.slice(0, e.from) + e.text + out.slice(e.to), src)
}

// ---------------------------------------------------------------- CLI

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const has = (name) => process.argv.includes(name)

const repo = resolve(arg('--repo', process.cwd()))
const tiers = String(arg('--tier', '1,2')).split(',').map(Number)
const write = has('--write')
const only = arg('--path', null)

const ts = createRequire(join(repo, 'package.json'))('typescript')
const files = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\n')
  .filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f))
  .filter((f) => !/payload-types\.ts|\/migrations\/|^vendor\/|node_modules/.test(f))
  .filter((f) => !only || f.startsWith(only))

let changedFiles = 0
let removed = 0
const allCandidates = []

for (const path of files) {
  const abs = join(repo, path)
  let src
  try {
    src = readFileSync(abs, 'utf8')
  } catch {
    continue
  }
  const { ranges } = commentRanges(src, path, ts)
  if (!ranges.length) continue

  let edits = []
  if (tiers.includes(1)) edits.push(...tier1(src, ranges))
  if (tiers.includes(2)) edits.push(...tier2(src, ranges))
  if (tiers.includes(3)) {
    const t3 = tier3(src, ranges)
    edits.push(...t3.edits)
    for (const c of t3.candidates) allCandidates.push({ path, ...c })
  }
  if (!edits.length) continue

  // Overlapping edits would corrupt the file. Keep the first of any pair.
  edits.sort((a, b) => a.from - b.from)
  const safe = []
  for (const e of edits) if (!safe.length || e.from >= safe[safe.length - 1].to) safe.push(e)

  const out = apply(src, safe)
  const delta = src.split('\n').length - out.split('\n').length
  removed += delta
  changedFiles++
  if (write) writeFileSync(abs, out)
}

console.log(
  `${write ? 'wrote' : 'DRY RUN'} tier ${tiers.join('+')} · ${files.length} files scanned · ` +
    `${changedFiles} would change · ${removed} lines removed`,
)

if (allCandidates.length) {
  console.log(`\n${allCandidates.length} tier-3 candidate(s) needing a read — not deleted:`)
  for (const c of allCandidates.slice(0, 40)) {
    console.log(`  ${c.path}:${c.line}  // ${c.text}`)
    console.log(`      next: ${c.next}`)
  }
  if (allCandidates.length > 40) console.log(`  … ${allCandidates.length - 40} more`)
}
