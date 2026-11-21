#!/usr/bin/env node
/**
 * List what a branch adds that has to earn its place: each new top-level
 * declaration, and each file it adds or grows enough to be streamlined whole.
 *
 * ## Why this exists
 *
 * review-pr's streamliner justifies every new piece a PR adds. A list the
 * critic remembers drops pieces without a trace, and one computed here makes
 * its coverage checkable. (why: docs/why.md#a-fresh-streamliner-justifies-every-new-piece)
 *
 * ## What it does NOT do
 *
 * It finds declarations by regex on added lines, not by parsing: column 0 for
 * JS and TS, any indent for PHP. A function nested in an object literal, such
 * as a Payload hook, is not listed. The whole-file pass covers it once its
 * file qualifies.
 *
 * ## Usage
 *
 *   new-pieces.mjs --base origin/main --head origin/<branch> [--json]
 *
 * Prints `PIECES` with one line per file, or `NONE`. Act on the verdict word.
 * Files outside `review.streamline.sourceGlobs`, inside its `skipGlobs`, or
 * matching the repo's `generatedFiles` (read from the base, never the branch)
 * are listed as skipped.
 */

import { execFileSync } from 'node:child_process'
import { matchesGlob } from 'node:path'
import { pathToFileURL } from 'node:url'
import { flag, generatedPatterns, loadLoopConfig } from './config.mjs'

const NAME = '([A-Za-z_$][\\w$]*)'
const SCRIPT = [
  ['function', new RegExp(`^(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\b\\s*\\*?\\s*${NAME}`)],
  ['class', new RegExp(`^(?:export\\s+(?:default\\s+)?)?(?:abstract\\s+)?class\\s+${NAME}`)],
  ['type', new RegExp(`^(?:export\\s+)?(?:declare\\s+)?(?:type|interface|enum)\\s+${NAME}`)],
  ['const', new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+${NAME}`)],
]
const PHP = [
  ['function', /^\s*(?:(?:public|protected|private|static|final|abstract)\s+)*function\s+&?\s*(\w+)\s*\(/],
  ['class', /^\s*(?:(?:final|abstract)\s+)?(?:class|trait|interface|enum)\s+(\w+)/],
]
const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/

/** The words this script prints, for budget.test.mjs's check that a skill names only real ones. */
export const VERDICTS = ['PIECES', 'NONE']

/** The new top-level declarations among a file's added lines. */
export function declarations(path, added) {
  const rules = path.endsWith('.php') ? PHP : SCRIPT_FILE.test(path) ? SCRIPT : []
  const out = []
  for (const { line, text } of added) {
    const hit = rules.find(([, re]) => re.test(text))
    if (hit) out.push({ name: text.match(hit[1])[1], kind: hit[0], line })
  }
  return out
}

/**
 * Split a `git diff -M -U0` into files: path, whether git calls it new, and
 * each added line with its number on the branch. Deleted files are dropped.
 *
 * A header is only read before the first `@@`. Inside a hunk every line is
 * content, and content that is itself a diff — a `diff` block in a skill or a
 * doc — carries lines starting `++ ` and `-- `. Read as headers those
 * silently rename the file and lose its walk.
 */
export function parseDiff(text) {
  const files = []
  let file = null
  let line = 0
  let inHunk = false
  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      file = { path: null, added: false, lines: [], deleted: 0 }
      inHunk = false
      files.push(file)
    } else if (!file) {
      continue
    } else if (raw.startsWith('@@')) {
      line = Number(raw.match(/\+(\d+)/)[1])
      inHunk = true
    } else if (inHunk) {
      if (raw.startsWith('+')) file.lines.push({ line: line++, text: raw.slice(1) })
      else if (raw.startsWith('-')) file.deleted++
    } else if (raw.startsWith('new file mode')) {
      file.added = true
    } else if (raw.startsWith('+++ ')) {
      file.path = raw === '+++ /dev/null' ? null : raw.slice(6)
    }
  }
  return files.filter((f) => f.path)
}

/**
 * Decide, per file, what the streamliner owes it. `length` gives a file's
 * line count on the branch; only a file streamlined whole needs one.
 */
export function classify(files, { streamline, generated = [] }, length) {
  const skipped = []
  const kept = []
  for (const f of files) {
    const outside = !streamline.sourceGlobs.some((g) => matchesGlob(f.path, g))
    if (outside || streamline.skipGlobs.some((g) => matchesGlob(f.path, g)) || generated.some((re) => re.test(f.path))) {
      skipped.push(f.path)
      continue
    }
    const growth = f.lines.length - f.deleted
    const wholeFile = f.added ? f.lines.length >= streamline.newFileLines : growth >= streamline.grownLines
    const pieces = declarations(f.path, f.lines)
    if (!wholeFile && !pieces.length) continue
    kept.push({ path: f.path, status: f.added ? 'added' : 'modified', growth, wholeFile, lines: wholeFile ? length(f.path) : null, pieces })
  }
  const wholeFileLines = kept.reduce((n, f) => n + (f.lines ?? 0), 0)
  return { verdict: kept.length ? 'PIECES' : 'NONE', files: kept, skipped, wholeFileLines, split: wholeFileLines > streamline.splitLines }
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'ignore'] })

/** A file as `ref` has it, or '' when it is absent. */
const show = (ref, path) => {
  try {
    return git(['show', `${ref}:${path}`])
  } catch {
    return ''
  }
}

function main(argv) {
  const base = flag(argv, 'base')
  const head = flag(argv, 'head')
  if (!base || !head) {
    console.error('Usage: new-pieces.mjs --base <ref> --head <ref> [--json] [--config <loop-config.json>]')
    process.exit(2)
  }
  const streamline = loadLoopConfig(flag(argv, 'config'))?.review?.streamline
  if (!streamline) {
    console.error('loop-config.json has no review.streamline.')
    process.exit(2)
  }
  // Three dots, against a remote head: the critic never checks the branch
  // out, so base-ref.mjs's merge base with HEAD would measure the wrong tree.
  let diff
  try {
    diff = git(['diff', '-M', '-U0', '--no-color', `${base}...${head}`])
  } catch {
    console.error(`${base}...${head} does not resolve. Fetch both refs first.`)
    process.exit(2)
  }
  const length = (path) => git(['show', `${head}:${path}`]).split('\n').length
  // generatedFiles comes from the base: the branch under review may change it.
  const generated = generatedPatterns(show(base, '.claude/workflow.json'))
  const result = classify(parseDiff(diff), { streamline, generated }, length)
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(`${result.verdict} — ${result.files.length} file(s), ${result.wholeFileLines} line(s) to streamline whole${result.split ? ', split' : ''}`)
  for (const f of result.files) {
    const names = f.pieces.map((p) => `${p.name}:${p.line}`).join(', ')
    console.log(`  ${f.wholeFile ? 'whole' : 'piece'} ${f.path}${names ? ` — ${names}` : ''}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
