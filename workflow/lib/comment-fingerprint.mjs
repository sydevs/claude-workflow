#!/usr/bin/env node
/**
 * Prove a sweep commit changed comments and nothing else.
 *
 * ## Why this exists
 *
 * A comment sweep deletes thousands of lines across hundreds of files. No
 * reviewer can read that diff, and "I only touched comments" is a promise,
 * not evidence. This turns it into evidence.
 *
 * ## What it does NOT prove
 *
 * Hold it at its real strength. `codeHash` proves no code changed. That is
 * all it proves, and two of the traps this sweep most needs to avoid slip
 * straight past it:
 *
 * A deleted `prettier-ignore` passes. Stripping comments removes it from
 * both sides, so both sides normalize identically — and the file then
 * explodes on the next format run. A displaced comment passes too:
 * `jsx-sort-props --fix` moves props and leaves comments where they sat, so
 * the code is identical and the comment now documents its neighbour. That
 * shipped once already, in SahajAtlasWeb#161, with lint green.
 *
 * So read all three outputs, never `codeHash` alone. The census catches the
 * first. The anchor check catches the second. It is a tripwire, not a proof.
 *
 * It also cannot tell you a rewritten comment is still TRUE. Nothing can.
 * That is what the per-directory commits in a sweep PR are for.
 *
 * ## Usage
 *
 *   comment-fingerprint.mjs --base main           # git ref vs the working tree
 *   comment-fingerprint.mjs --base main --json
 *   comment-fingerprint.mjs --selftest            # break it on purpose, both ways
 *
 * Exits 1 on a changed codeHash, a shrunken protected census, a displaced
 * comment, or a WEAK file — each is a case that needs a human.
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const UNIT = String.fromCharCode(31)
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

export const RULES = JSON.parse(readFileSync(join(HERE, 'comment-protect.json'), 'utf8'))

/**
 * Load the target repo's OWN typescript and prettier.
 *
 * Deliberately not vendored here. Using the repo's compiler means the parser
 * always matches the language level the repo actually compiles at, and it
 * keeps this directory free of a dependency it would have to keep current
 * across three repos on three different TypeScript versions.
 */
function toolchain(repoRoot) {
  const req = createRequire(join(repoRoot, 'package.json'))
  const load = (n) => {
    try {
      return req(n)
    } catch {
      return null
    }
  }
  return { ts: load('typescript'), prettier: load('prettier') }
}

const SCRIPT_KIND = {
  '.ts': 'TS',
  '.mts': 'TS',
  '.cts': 'TS',
  '.tsx': 'TSX',
  '.js': 'JS',
  '.mjs': 'JS',
  '.cjs': 'JS',
  '.jsx': 'JSX',
}

/**
 * Every comment in the file, and only the comments.
 *
 * Neither TypeScript traversal is complete on its own, and both fail
 * silently. `forEachChild` never visits leaf tokens like `}` and `;`, and
 * trailing comments hang off exactly those — it returns zero of them and
 * looks like it worked. `getChildren` finds those but misses a comment that
 * is leading trivia of the end-of-file token. Measured, on a fixture holding
 * both: 5 of 6 each, 6 of 6 unioned. Take the union.
 *
 * The reason to go through the parser at all, rather than match a slash
 * pair, is that one appears inside string literals, regex literals, template
 * literals and JSX text, and a single slash is division or a regex opener
 * depending on context no regex can see. A stripper that gets that wrong
 * corrupts code while reporting success, which is the one failure this tool
 * exists to make impossible.
 */
export function commentRanges(src, path, ts) {
  const kind = ts.ScriptKind[SCRIPT_KIND[extname(path)] ?? 'TS']
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, kind)
  const out = new Map()
  const add = (rs) => {
    for (const r of rs || []) out.set(`${r.pos}:${r.end}`, r)
  }
  const visit = (n) => {
    add(ts.getLeadingCommentRanges(src, n.getFullStart()))
    add(ts.getTrailingCommentRanges(src, n.getEnd()))
  }
  ;(function byChildren(n) {
    visit(n)
    for (const k of n.getChildren(sf)) byChildren(k)
  })(sf)
  ;(function byForEach(n) {
    visit(n)
    ts.forEachChild(n, byForEach)
  })(sf)
  return { ranges: [...out.values()].sort((a, b) => a.pos - b.pos), sf }
}

/**
 * Non-trivia leaf tokens, in source order. The anchor check compares these.
 *
 * ⚠ **TypeScript puts JSDoc nodes in `getChildren()`.** A doc comment is
 * trivia, but the parser hangs a `JSDoc` node off the declaration it
 * documents, so a naive leaf walk returns the comment's own text as though it
 * were code. That made every JSDoc edit look like it moved the next comment:
 * collapsing one block reported `// --- Constants ---` below it as DISPLACED,
 * in a file whose code was untouched. Skip the whole JSDoc subtree.
 */
export function leafTokens(sf, ts) {
  const out = []
  ;(function walk(n) {
    if (ts.SyntaxKind[n.kind]?.startsWith('JSDoc')) return
    const kids = n.getChildren(sf)
    if (kids.length === 0) {
      const t = n.getText(sf)
      if (t) {
        out.push({ text: t, kind: ts.SyntaxKind[n.kind], pos: n.getStart(sf), end: n.getEnd() })
      }
      return
    }
    for (const k of kids) walk(k)
  })(sf)
  return out
}

/**
 * Blank lines are not semantic in JavaScript, so they must not count as code.
 *
 * Removing a whole-line comment that sat between two statements leaves the
 * blank line that followed it, and prettier preserves single blank lines. So
 * a pure comment deletion changes the formatted output by exactly one empty
 * line. Measured against the real sweep in SahajAtlasWeb 53d0d13: this alone
 * produced the single CODE CHANGED verdict on `Mapbox/layers.ts`, a file
 * whose non-comment lines were provably untouched.
 *
 * The one place a blank line IS semantic is inside a template literal, and
 * `templateHash` below covers exactly that, because this cannot.
 */
const collapseBlankLines = (text) =>
  text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .join('\n')

/**
 * Replace each comment with one space, never with nothing.
 *
 * Deleting the range glues the tokens either side together, so `a`, a block
 * comment, and `b` become the single identifier `ab` — a different program
 * that this tool would then report as unchanged, because both sides strip
 * the same way.
 */
function strip(src, ranges) {
  let out = ''
  let at = 0
  for (const r of ranges) {
    out += src.slice(at, r.pos) + ' '
    at = r.end
  }
  return out + src.slice(at)
}

/**
 * Normalize with the repo's own prettier, not a whitespace rule.
 *
 * Prettier adds a trailing comma when a call is multiline and drops it when
 * it fits on one line. Deleting a comment from inside an argument list
 * therefore changes real characters, and a hand-rolled "collapse whitespace"
 * normalizer reports that as a code change. It would false-positive on a
 * large share of every JSDoc collapse in the sweep.
 */
async function normalize(text, path, prettier, repoRoot) {
  if (!prettier) return { text, strength: 'WEAK', why: 'prettier not resolvable' }
  try {
    const cfg = (await prettier.resolveConfig(join(repoRoot, path))) || {}
    return { text: await prettier.format(text, { ...cfg, filepath: path }), strength: 'STRONG' }
  } catch (e) {
    return { text, strength: 'WEAK', why: `prettier: ${String(e.message).split('\n')[0]}` }
  }
}

/**
 * One side of one file.
 *
 * A WEAK result is not a pass. It means the code identity rests on a token
 * stream that tolerates whitespace but not prettier's trailing-comma
 * reflow, so the file needs a human eye. Never let one through silently.
 */
export async function fingerprint({ src, path, repoRoot, ts, prettier }) {
  const { ranges, sf } = commentRanges(src, path, ts)
  const parseErrors = sf.parseDiagnostics?.length ?? 0
  const tokens = leafTokens(sf, ts)
  const n = await normalize(strip(src, ranges), path, prettier, repoRoot)

  const comments = ranges.map((r) => ({
    text: src.slice(r.pos, r.end),
    line: src.slice(0, r.pos).split('\n').length,
    prev3: tokens
      .filter((t) => t.end <= r.pos)
      .slice(-3)
      .map((t) => t.text)
      .join(UNIT),
    next3: tokens
      .filter((t) => t.pos >= r.end)
      .slice(0, 3)
      .map((t) => t.text)
      .join(UNIT),
  }))

  const codeHash =
    n.strength === 'STRONG'
      ? sha(collapseBlankLines(n.text))
      : sha(collapseBlankLines(tokens.map((t) => t.text).join(UNIT)))

  // Template literal text, where a blank line genuinely is content.
  const templateHash = sha(
    tokens
      .filter((t) => t.kind && t.kind.includes('Template'))
      .map((t) => t.text)
      .join(UNIT),
  )

  return { codeHash, templateHash, strength: n.strength, why: n.why, parseErrors, comments }
}

const globToRe = (g) =>
  new RegExp('^' + g.replace(/\./g, '\\.').replace(/\*\*\//g, '(.*/)?').replace(/\*/g, '[^/]*') + '$')

/**
 * Count how many comments each protection rule matches. A census, not a scan.
 *
 * A rule scoped with `pathGlob` counts zero outside its own paths. Ignoring
 * that scope once made K5 — whose pattern matches any comment at all, because
 * what it protects is a POSITION in a stories file rather than a phrase —
 * count every comment in the repo, so any file that lost a comment reported a
 * protected-list violation.
 */
export function census(comments, rules = RULES, path = '') {
  const counts = {}
  for (const rule of [...rules.frozen, ...rules.keep]) {
    if (rule.pathGlob && !globToRe(rule.pathGlob).test(path)) {
      counts[rule.id] = 0
      continue
    }
    const re = new RegExp(rule.pattern, (rule.flags || '') + 'm')
    counts[rule.id] = comments.filter((c) => re.test(c.text)).length
  }
  return counts
}

/**
 * Compare two sides.
 *
 * `displaced` is the finding a code-identity check structurally cannot make:
 * the comment's own text is byte-identical, so it survived the sweep
 * untouched, but what sits next to it changed. That is a comment now
 * describing the wrong line.
 */
export function compare(before, after, rules = RULES, path = '') {
  const problems = []
  if (before.codeHash !== after.codeHash) problems.push({ kind: 'CODE CHANGED' })
  if (before.templateHash !== after.templateHash) problems.push({ kind: 'TEMPLATE CHANGED' })
  if (after.strength === 'WEAK') problems.push({ kind: 'WEAK', detail: after.why })
  if (after.parseErrors > before.parseErrors) {
    problems.push({ kind: 'PARSE ERRORS', detail: `${before.parseErrors} to ${after.parseErrors}` })
  }

  // Pair equal-text comments by their order of appearance, never by text alone.
  // A bare `//` spacer occurs dozens of times in one file, so a text-keyed map
  // compares every one of them against the last — which reported 40-odd phantom
  // displacements the first time this ran against a real sweep. Where the counts
  // differ the comment was edited, and an edited comment cannot be anchor-checked
  // at all.
  const group = (list) => {
    const m = new Map()
    for (const c of list) m.set(c.text, [...(m.get(c.text) || []), c])
    return m
  }
  const [gb, ga] = [group(before.comments), group(after.comments)]
  for (const [text, bs] of gb) {
    const as = ga.get(text)
    if (!as || as.length !== bs.length) continue
    for (let i = 0; i < bs.length; i++) {
      if (as[i].prev3 !== bs[i].prev3 || as[i].next3 !== bs[i].next3) {
        problems.push({
          kind: 'DISPLACED',
          detail: `line ${bs[i].line}: ${text.slice(0, 60).replace(/\n/g, ' ')}`,
        })
      }
    }
  }

  const [cb, ca] = [census(before.comments, rules, path), census(after.comments, rules, path)]
  for (const id of Object.keys(cb)) {
    if (ca[id] < cb[id]) {
      problems.push({ kind: 'PROTECTED VIOLATION', detail: `${id}: ${cb[id]} to ${ca[id]}` })
    }
  }

  return { problems, censusBefore: cb, censusAfter: ca }
}

// ---------------------------------------------------------------- CLI

const git = (repoRoot, args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 28 })

const SWEEPABLE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/

/**
 * What to check.
 *
 * Reads each repo's `generatedFiles` from its own `.claude/workflow.json`
 * rather than keeping a second list here. `block-generated-files.mjs`
 * already treats that key as the source of truth, and a second copy is a
 * second thing to forget.
 */
function targets(repoRoot, base) {
  const changed = git(repoRoot, ['diff', '--name-only', '--diff-filter=ACM', base])
    .split('\n')
    .filter(Boolean)
  const generated = (() => {
    const p = join(repoRoot, '.claude/workflow.json')
    if (!existsSync(p)) return []
    try {
      return (JSON.parse(readFileSync(p, 'utf8')).generatedFiles || []).map(
        (g) => new RegExp(g.pattern),
      )
    } catch {
      return []
    }
  })()
  const denied = RULES.denyPaths
    .filter((d) => d.pathGlob)
    .map((d) => new RegExp(d.pathGlob.replace(/\*\*/g, '.*').replace(/([^.])\*/g, '$1[^/]*')))
  return changed.filter(
    (f) => SWEEPABLE.test(f) && !generated.some((r) => r.test(f)) && !denied.some((r) => r.test(f)),
  )
}

async function run(repoRoot, base, asJson) {
  const { ts, prettier } = toolchain(repoRoot)
  if (!ts) {
    console.error(`typescript not resolvable from ${repoRoot} — install first`)
    process.exit(2)
  }

  const files = targets(repoRoot, base)
  const report = { files: files.length, ok: 0, problems: [], censusBefore: {}, censusAfter: {} }

  for (const path of files) {
    let beforeSrc
    try {
      beforeSrc = git(repoRoot, ['show', `${base}:${path}`])
    } catch {
      continue
    }
    const b = await fingerprint({ src: beforeSrc, path, repoRoot, ts, prettier })
    const a = await fingerprint({
      src: readFileSync(join(repoRoot, path), 'utf8'),
      path,
      repoRoot,
      ts,
      prettier,
    })
    const r = compare(b, a, RULES, path)
    for (const id of Object.keys(r.censusBefore)) {
      report.censusBefore[id] = (report.censusBefore[id] || 0) + r.censusBefore[id]
      report.censusAfter[id] = (report.censusAfter[id] || 0) + r.censusAfter[id]
    }
    if (r.problems.length) report.problems.push(...r.problems.map((p) => ({ ...p, path })))
    else report.ok++
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
    return report
  }

  console.log(`${report.files} files · ${report.ok} codeHash identical · ${report.problems.length} problems`)
  const line = (ids) =>
    ids.map((id) => `${id} ${report.censusBefore[id] ?? 0} to ${report.censusAfter[id] ?? 0}`).join(' · ')
  console.log(`protected: FROZEN  ${line(RULES.frozen.map((r) => r.id))}`)
  console.log(`           KEEP    ${line(RULES.keep.map((r) => r.id))}`)
  for (const p of report.problems) {
    console.log(`  ${p.kind.padEnd(20)} ${p.path}${p.detail ? '  ' + p.detail : ''}`)
  }
  if (!report.problems.length) console.log('\nComments changed. Code did not. No comment moved.')
  return report
}

/**
 * Break it on purpose, both ways.
 *
 * `SahajAtlasWordpress/tests/lint.php` states the rule this follows: before
 * you trust a green run, confirm the tool goes red. The prettier-ignore case
 * asserts both that the census fails and that codeHash still passes — the
 * hole documented in the header, kept honest by a test rather than a claim.
 */
async function selftest(repoRoot) {
  const { ts, prettier } = toolchain(repoRoot)
  if (!ts) {
    console.error(`typescript not resolvable from ${repoRoot} — pass --repo <a JS repo>`)
    return 1
  }
  const fp = (src, path = 'x.tsx') => fingerprint({ src, path, repoRoot, ts, prettier })
  const fails = []
  const check = (name, cond) => {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}`)
    if (!cond) fails.push(name)
  }

  const base = 'const a = 1 // why a\nconst b = 2\n'
  check('no-op is stable', (await fp(base)).codeHash === (await fp(base)).codeHash)
  check(
    'comment-only edit keeps codeHash',
    (await fp(base)).codeHash === (await fp('const a = 1\nconst b = 2\n')).codeHash,
  )
  check(
    'code edit changes codeHash',
    (await fp(base)).codeHash !== (await fp('const a = 2 // why a\nconst b = 2\n')).codeHash,
  )

  const propsBefore = 'const x = <B\n  // note for a\n  a={1}\n  b={2}\n/>\n'
  const propsAfter = 'const x = <B\n  // note for a\n  b={2}\n  a={1}\n/>\n'
  check(
    'displaced comment is caught',
    compare(await fp(propsBefore), await fp(propsAfter)).problems.some((p) => p.kind === 'DISPLACED'),
  )

  const ignBefore = 'const m = [\n  // prettier-ignore\n  [1, 2, 3],\n]\n'
  const ignAfter = 'const m = [\n  [1, 2, 3],\n]\n'
  const ignCmp = compare(await fp(ignBefore, 'x.ts'), await fp(ignAfter, 'x.ts'))
  check(
    'deleted prettier-ignore fails the census',
    ignCmp.problems.some((p) => p.kind === 'PROTECTED VIOLATION' && p.detail.startsWith('F1')),
  )
  check(
    'and codeHash still passes, which is the documented hole',
    !ignCmp.problems.some((p) => p.kind === 'CODE CHANGED'),
  )

  const strIn = 'const u = "http://x/#y" // real\nconst r = /a\\/\\/b/g\nconst t = `q // not`\n'
  const found = commentRanges(strIn, 'x.ts', ts).ranges.map((r) => strIn.slice(r.pos, r.end))
  check(
    'a slash pair inside string, regex and template is not a comment',
    found.length === 1 && found[0] === '// real',
  )

  const jsxIn = 'const j = <div>http:// text {/* real */}</div>\n'
  const jsxFound = commentRanges(jsxIn, 'x.tsx', ts).ranges.map((r) => jsxIn.slice(r.pos, r.end))
  check(
    'a JSX-expression comment is found and JSX text is not',
    jsxFound.length === 1 && jsxFound[0] === '/* real */',
  )

  check(
    'an end-of-file docblock is found (forEachChild alone misses it)',
    commentRanges('const a = 1\n/** tail */\n', 'x.ts', ts).ranges.length === 1,
  )

  console.log(fails.length ? `\n${fails.length} selftest failure(s)` : '\nAll selftests pass, in both directions.')
  return fails.length
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const args = process.argv.slice(2)
  const ri = args.indexOf('--repo')
  const repoRoot =
    ri !== -1
      ? resolve(args[ri + 1])
      : execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

  if (args.includes('--selftest')) process.exit((await selftest(repoRoot)) ? 1 : 0)

  const bi = args.indexOf('--base')
  if (bi === -1) {
    console.error('usage: comment-fingerprint.mjs --base <ref> [--repo <dir>] [--json] | --selftest')
    process.exit(2)
  }
  const r = await run(repoRoot, args[bi + 1], args.includes('--json'))
  process.exit(r.problems.length ? 1 : 0)
}
