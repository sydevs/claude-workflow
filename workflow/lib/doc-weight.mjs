#!/usr/bin/env node
/**
 * How much of a repo's recent change was prose about the code.
 *
 * ## Why this exists
 *
 * Every fact a guide restates is one more place a change has to reach, and an
 * agent trusts whichever copy it reads. A history where docs move as much as
 * code is the symptom. This measures it, so the `docs vs reality` audit angle
 * can watch the number and find the guides that keep moving.
 * (why: docs/why.md#docs-say-what-the-code-cannot)
 *
 * ## What it does NOT prove
 *
 * Lines are not facts. A doc-heavy commit can be right — a docs PR, a
 * contract change — and a light one can still restate a fact. This points the
 * audit at files. `docs/documentation.md` judges each sentence.
 *
 * ## Usage
 *
 *   doc-weight.mjs [--ref origin/main] [--since '6 weeks ago'] [--json]
 *
 * Reads first-parent commits on `--ref`, so a merged PR counts once. Lockfiles,
 * binaries and the repo's own `generatedFiles` are left out of both sides.
 * Prints the doc share of changed lines, the docs touched most often and the
 * heaviest commits. Never fails on a number: exits 1 only when git cannot
 * answer.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatedPatterns } from './config.mjs'

const DOC = /\.mdx?$/
const LOCKFILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|composer\.lock|pubspec\.lock)$/

/** `git log --numstat --format=%x00%h%x09%s` → [{ sha, subject, files: [{ path, lines }] }] */
export function parseLog(text) {
  return text
    .split('\0')
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [head, ...rows] = chunk.split('\n')
      const [sha, ...subject] = head.split('\t')
      const files = rows
        .map((row) => row.split('\t'))
        .filter((cols) => cols.length === 3 && cols[0] !== '-')
        .map(([added, deleted, path]) => ({ path, lines: Number(added) + Number(deleted) }))
      return { sha, subject: subject.join('\t'), files }
    })
}

/** Totals, the docs touched most often, and the commits with the highest doc share. */
export function weigh(commits, generated = [], top = 8) {
  const skip = (path) => LOCKFILE.test(path) || generated.some((re) => re.test(path))
  const touches = new Map()
  let docLines = 0
  let codeLines = 0
  const rows = commits.map(({ sha, subject, files }) => {
    let doc = 0
    let code = 0
    for (const { path, lines } of files) {
      if (skip(path)) continue
      if (DOC.test(path)) {
        doc += lines
        touches.set(path, (touches.get(path) || 0) + 1)
      } else code += lines
    }
    docLines += doc
    codeLines += code
    return { sha, subject, doc, code }
  })
  const share = (doc, code) => (doc + code ? Math.round((100 * doc) / (doc + code)) : 0)
  return {
    commits: commits.length,
    docLines,
    codeLines,
    docShare: share(docLines, codeLines),
    mostTouched: [...touches]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, top)
      .map(([path, count]) => ({ path, count })),
    heaviest: rows
      .filter((r) => r.doc && r.code)
      .map((r) => ({ ...r, docShare: share(r.doc, r.code) }))
      .sort((a, b) => b.docShare - a.docShare)
      .slice(0, top),
  }
}

function main(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(name)
    return i === -1 ? fallback : argv[i + 1]
  }
  const ref = arg('--ref', 'origin/main')
  const since = arg('--since', '6 weeks ago')
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 })
  let root
  let log
  try {
    root = git(['rev-parse', '--show-toplevel']).trim()
    log = git(['log', '--first-parent', '--numstat', '--format=%x00%h%x09%s', `--since=${since}`, ref])
  } catch (err) {
    console.error(`doc-weight: git could not answer — ${err.message.split('\n')[0]}`)
    process.exit(1)
  }
  const workflowJson = join(root, '.claude/workflow.json')
  const generated = generatedPatterns(existsSync(workflowJson) ? readFileSync(workflowJson, 'utf8') : '')
  const result = weigh(parseLog(log), generated)
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ref, since, ...result }, null, 2))
    return
  }
  console.log(
    `DOC WEIGHT ${result.docShare}% — ${result.docLines} doc lines, ${result.codeLines} other lines, ` +
      `${result.commits} commits since ${since} on ${ref}`,
  )
  if (result.mostTouched.length) {
    console.log('Docs touched most:')
    for (const { path, count } of result.mostTouched) console.log(`  ${String(count).padStart(3)}  ${path}`)
  }
  if (result.heaviest.length) {
    console.log('Heaviest commits (doc share of lines):')
    for (const r of result.heaviest) console.log(`  ${String(r.docShare).padStart(3)}%  ${r.sha} ${r.subject}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
