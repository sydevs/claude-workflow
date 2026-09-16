#!/usr/bin/env node
/**
 * Which comments a branch ADDED that the code-comments rule forbids.
 *
 * ## Why this exists
 *
 * The rule steers the writing and the cleanup skill reclaims the residue, but
 * neither is reliable on its own: an agent's default commenting survives a
 * rule, a memory entry and a hook, and a human contributor never read the rule
 * at all. This is the last place a banned comment can be caught before it
 * lands, and the only comment check that covers SahajAtlasWordpress, where
 * there is no formatter, no phpcs and no ESLint.
 *
 * ## Advisory, on purpose
 *
 * It reports and exits 0 unless asked to bite. A false positive that stalls an
 * unattended loop run costs more than a comment that slips through, and
 * `block-wrong-bash` already inverted once against the exact cross-repo shape
 * it existed to permit (#16). Harden with `--strict` once a real sweep has
 * measured the false-positive rate.
 *
 * ## What it does NOT prove
 *
 * It judges wording, never substance. It cannot tell a bloated *why* from a
 * tight one — `ste-lint.py` scores that — and it cannot tell whether a comment
 * is true. It only catches the phrasings that are wrong no matter what they
 * describe: a sentence addressed to a diff reviewer, and a pointer into a
 * document that will be renumbered.
 *
 * ## Usage
 *
 *   comment-lint.mjs --base main              # report, exit 0
 *   comment-lint.mjs --base main --strict     # exit 1 on any finding
 *   comment-lint.mjs --selftest
 */

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { commentRanges } from './comment-fingerprint.mjs'

/**
 * Only phrasings that are wrong whatever they describe.
 *
 * Kept deliberately narrow. A loose list turns this into noise, and a check
 * people learn to ignore is worse than no check — it still costs a run, and it
 * teaches the reader that findings here do not matter.
 */
export const RULES = [
  {
    id: 'change-narration',
    re: /\b(as requested|as discussed|per (the )?(feedback|review|comment)|updated? to (use|be|match)|changed? to (use|be)|switch(ed)? (this )?to|removed? the old|no longer (uses|needed)|renamed (from|to)|fixed the|this fixes)\b/i,
    say: 'addressed to a diff reviewer — belongs in the commit message',
  },
  {
    id: 'section-pointer',
    re: /\b((spec|specification|requirements?|design doc|rfc)\s*(§|section|para|part)?\s*\d|(§|section)\s*\d+(\.\d+)*)/i,
    say: 'points at a section number, the canonical moving target — encode the substance',
  },
  {
    id: 'block-end',
    re: /(^|\})\s*(\/\/|#)\s*end (of )?(if|for|while|loop|function|switch|block|class)\b/i,
    say: 'marks a block end — the code already shows where it closes',
  },
  {
    id: 'ai-aside',
    re: /\b(here(?:'|\u2019)s (the|a|what)|let(?:'|\u2019)s |I(?:'|\u2019)m going to|note that we|as an AI|placeholder for now)\b/i,
    say: 'reads as a message to the reader of a chat, not of a file',
  },
]

const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/

/** Comment texts present on the new side and absent from the base. */
export function addedComments(baseSrc, headSrc, path, ts) {
  const before = new Set(commentRanges(baseSrc, path, ts).ranges.map((r) => baseSrc.slice(r.pos, r.end)))
  return commentRanges(headSrc, path, ts)
    .ranges.map((r) => ({
      text: headSrc.slice(r.pos, r.end),
      line: headSrc.slice(0, r.pos).split('\n').length,
    }))
    .filter((c) => !before.has(c.text))
}

/**
 * Comments the protected list already covers are never findings.
 *
 * Calibrating against real branches flagged this, in a spec file:
 * "⚠ That asymmetry is the point, and it used to be a bug." The marker means
 * the author paid for that sentence, and "used to be a bug" is the rejected
 * alternative, not a note to a reviewer. Six of six matches on `used to be`
 * were that shape, so the phrase left the rule and this guard stayed.
 */
const PROTECTED = /\u26A0|(?<![\w\/])#\d{1,4}\b|((keep|kept|stay|stays) in sync|must match|source of truth)/i

export function findings(comments) {
  const out = []
  for (const c of comments) {
    if (PROTECTED.test(c.text)) continue
    for (const rule of RULES) {
      if (!rule.re.test(c.text)) continue
      // Point at the offending line inside a block comment. Reporting the
      // block's first line shows the reader `/**`, which names nothing.
      const lines = c.text.split('\n')
      const hit = lines.findIndex((l) => rule.re.test(l))
      out.push({
        ...c,
        line: c.line + Math.max(hit, 0),
        excerpt: (hit === -1 ? lines[0] : lines[hit]).trim(),
        id: rule.id,
        say: rule.say,
      })
      break
    }
  }
  return out
}

// ---------------------------------------------------------------- CLI

const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'ignore'] })

function selftest() {
  const cases = [
    ['// updated to use the v2 client', 'change-narration'],
    ['// as requested, skip the cache', 'change-narration'],
    ['/* per the requirements doc section 3.2 */', 'section-pointer'],
    ['// see spec §7', 'section-pointer'],
    ['// end if', 'block-end'],
    ['} // end if', 'block-end'],
    ['// \u26A0 that asymmetry is the point, and it used to be a bug', null],
    ['// updated to use the v2 client (#812)', null],
    ['// Bacs needs 3 clear working days, not +3 calendar days (WAGE-1234)', null],
    ['// keep in sync with the router target groups', null],
    ['// timeout must stay under the interval — ALB rule', null],
    ['// the cache, which is what lets an editor see a save they just made', null],
    ['// Here\u2019s the thing: we retry twice', 'ai-aside'],
  ]
  let fails = 0
  for (const [text, want] of cases) {
    const got = findings([{ text, line: 1 }])[0]?.id ?? null
    const ok = got === want
    if (!ok) fails++
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${want ?? 'clean'}: ${text}`)
  }
  console.log(fails ? `\n${fails} failure(s)` : '\nAll selftests pass, catching and sparing.')
  return fails
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const args = process.argv.slice(2)
  if (args.includes('--selftest')) process.exit(selftest() ? 1 : 0)

  const ri = args.indexOf('--repo')
  const root =
    ri !== -1
      ? resolve(args[ri + 1])
      : execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const bi = args.indexOf('--base')
  if (bi === -1) {
    console.error('usage: comment-lint.mjs --base <ref> [--repo <dir>] [--strict] | --selftest')
    process.exit(2)
  }
  const base = args[bi + 1]

  const ts = (() => {
    try {
      return createRequire(join(root, 'package.json'))('typescript')
    } catch {
      return null
    }
  })()
  if (!ts) {
    console.error(`typescript not resolvable from ${root} — skipping`)
    process.exit(0)
  }

  const files = git(root, ['diff', '--name-only', '--diff-filter=ACM', base])
    .split('\n')
    .filter((f) => f && EXT.test(f))

  const all = []
  for (const path of files) {
    let baseSrc = ''
    try {
      baseSrc = git(root, ['show', `${base}:${path}`])
    } catch {
      baseSrc = ''
    }
    let headSrc
    try {
      headSrc = readFileSync(join(root, path), 'utf8')
    } catch {
      continue
    }
    for (const f of findings(addedComments(baseSrc, headSrc, path, ts))) all.push({ ...f, path })
  }

  if (!all.length) {
    console.log(`${files.length} changed file(s). No banned comment added.`)
    process.exit(0)
  }

  console.log(`${all.length} comment(s) this branch added that the rule forbids:\n`)
  for (const f of all) {
    console.log(`  ${f.path}:${f.line}`)
    console.log(`    ${(f.excerpt ?? f.text.split('\n')[0]).slice(0, 90)}`)
    console.log(`    ${f.say}\n`)
  }
  console.log(args.includes('--strict') ? 'Fix each, or say in the PR body why it stays.' : 'Advisory — nothing is blocked.')
  process.exit(args.includes('--strict') ? 1 : 0)
}
