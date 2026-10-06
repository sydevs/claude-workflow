// node --test workflow/lib/budget.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check, fit, DEFAULT_BUDGETS, DEFAULT_MARKER, DEFAULT_MARKER_REQUIRED, VERDICTS } from './budget.mjs'
import { loadLoopConfig } from './config.mjs'
import { fileURLToPath } from 'node:url'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../..', import.meta.url))
const config = join(root, 'loop-config.json')
const cli = join(root, 'workflow', 'lib', 'budget.mjs')
const loop = loadLoopConfig(config)

// `cwd` is pinned to this checkout because `loadLoopConfig()` resolves from it
// first, and an ancestor checkout's config is not the one under test.
function run(args, text) {
  return spawnSync(process.execPath, [cli, ...args], { input: text, encoding: 'utf8', cwd: root })
}

// Frozen fixtures, not a copy of the config. The `fit()` tests below size
// their input against these exact numbers to reproduce a real incident, so a
// retune must not slide them. `reviewBody` is absent on purpose.
const budgets = { comment: 1200, reviewReply: 600, journalEntry: 1500 }

/**
 * A journal comment in `handler-journal`'s shape: Did leads with the PR the
 * run pushed. `didPad` grows each Did line, so one cut can cover the overage.
 */
function entry(padding = '', didPad = '') {
  return [
    '📦 **implement** · [sydevs/SahajCloud#725](url) · `13:30`–`14:35`',
    '',
    '### ⚠️ Failed',
    '- none',
    '',
    '### 🧭 Friction',
    `- a rule misfired${padding}`,
    '',
    '### 📄 Did',
    `- 📦 [sydevs/SahajCloud#801](https://github.com/sydevs/SahajCloud/pull/801) — pushed \`fad29fc\`, draft${didPad}`,
    `- a second line${didPad}`,
    `- the least important line${didPad}`,
  ].join('\n')
}

// Sized into the band `--fit` used to eat: under the 1500 budget, over the
// 1300 its headroom aimed at. A 1,355-character entry lost its whole Did
// section here and was told it had 532 characters to spare.
test('an entry inside its budget is returned untouched', () => {
  const text = entry('z'.repeat(1100))
  assert.ok(text.length > budgets.journalEntry - 200)
  assert.ok(text.length <= budgets.journalEntry)
  const f = fit(text, 'journalEntry', budgets)
  assert.equal(f.dropped, 0)
  assert.equal(f.text, text)
  assert.equal(f.verdict, 'OK')
})

test('a cut takes the LAST Did line, and keeps the PR the run pushed', () => {
  const text = entry('', 'y'.repeat(500))
  assert.ok(text.length > budgets.journalEntry)
  const f = fit(text, 'journalEntry', budgets)
  assert.ok(f.dropped > 0)
  assert.ok(f.text.includes('SahajCloud/pull/801'))
  assert.ok(!f.text.includes('the least important line'))
})

// The 200-character headroom `--fit` used to target cut past the budget. One
// line takes this entry to 1,433 — inside the 1,500 budget, outside the 1,300
// the headroom aimed at — so a second line went with it.
test('a cut stops at the budget, not below it', () => {
  const text = entry('x'.repeat(900), 'z'.repeat(140))
  assert.ok(text.length > budgets.journalEntry)
  const f = fit(text, 'journalEntry', budgets)
  assert.equal(f.dropped, 1)
  assert.ok(f.chars > budgets.journalEntry - 200)
  assert.ok(f.text.includes('a second line'))
})

test('a failure is never cut, whatever the overage', () => {
  const f = fit(entry('x'.repeat(4000)), 'journalEntry', budgets)
  assert.ok(f.text.includes('### ⚠️ Failed'))
  assert.ok(f.text.includes('- none'))
})

test('check still reports over and under on the whole artefact', () => {
  const noMarker = { markerRequired: [] }
  assert.equal(check('x'.repeat(1201), 'comment', budgets, noMarker).verdict, 'OVER')
  assert.equal(check('x'.repeat(1200), 'comment', budgets, noMarker).verdict, 'OK')
})

test('an unbudgeted kind is reported, not cut', () => {
  const f = fit(entry(), 'review', budgets)
  assert.equal(f.verdict, 'UNBUDGETED')
  assert.equal(f.dropped, 0)
})

// `budget.mjs`'s own doc comment requires the fallback to equal the config,
// and the CLI reports which path it took — so a drift makes two runs of the
// same command disagree about the limit. Checked here instead of by hand.
//
// The path is explicit because `loadLoopConfig()` resolves from the cwd first.
// Run from an ancestor checkout, it read that checkout's config and failed on
// a drift that was not in the branch under test.
test('the fallback budgets equal loop-config.json', () => {
  assert.deepEqual(DEFAULT_BUDGETS, loop.writing.budgets)
})

// `check()` returns UNBUDGETED for a kind no config names. The CLI exited 0 on
// it until #155, so a typo'd or unnamed `--kind` read as a pass, and a review
// body went three weeks measured against the wrong budget behind that silence.
// Every kind a skill actually names still has to be a key.
test('every --kind a skill names is budgeted', () => {
  const skills = join(root, 'workflow', 'skills')
  const named = new Set()
  for (const file of readdirSync(skills, { recursive: true })) {
    if (!String(file).endsWith('SKILL.md')) continue
    const text = readFileSync(join(skills, String(file)), 'utf8')
    for (const m of text.matchAll(/--kind\s+([A-Za-z][\w-]*)/g)) named.add(m[1])
  }
  const budgets = loop.writing.budgets
  assert.ok(named.size > 0, 'no skill names a --kind, so this test checks nothing')
  assert.deepEqual([...named].filter((kind) => !(kind in budgets)), [])
})

// The CLI exited 0 on UNBUDGETED until #155, so a typo'd or missing `--kind`
// read as a pass. Every verdict but OK exits 1, and the word says which.
test('the CLI fails an unbudgeted kind, and names it', () => {
  const r = run(['--kind', 'nosuchkind'], 'x')
  assert.notEqual(r.status, 0)
  assert.match(r.stdout, /UNBUDGETED/)
  assert.match(r.stdout, /nosuchkind/)
})

// An absent `--kind` used to read `process.argv[0]` and report the node binary
// as the kind. It is an empty kind now, reported on the usual stream.
test('the CLI reports an absent --kind as unbudgeted, not as the node binary', () => {
  const r = run([], 'x')
  assert.notEqual(r.status, 0)
  assert.match(r.stdout, /UNBUDGETED/)
  assert.ok(!r.stdout.includes(process.execPath))
})

test('the CLI passes a kind inside its budget', () => {
  const r = run(['--kind', 'journalEntry'], 'x')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^OK/)
})

// `--fit` writes the verdict to stderr, because handler-journal redirects
// stdout to the fitted file.
test('the --fit CLI reports its verdict on stderr, and fails', () => {
  const r = run(['--fit', '--kind', 'nosuchkind'], 'x')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /UNBUDGETED/)
  assert.equal(r.stdout, 'x')
})

// One round trip for the marker, to prove the CLI passes the config's
// `markerRequired` and marker into `check()` at all.
test('the CLI fails a marker-required kind with no marker', () => {
  const r = run(['--kind', 'comment'], 'x')
  assert.notEqual(r.status, 0)
  assert.match(r.stdout, /MISSING_MARKER/)
})

// Frozen, like the budgets above. The drift test below is what ties these
// fixtures to the config, so no live value is threaded through a unit test.
const markerRequired = ['comment']
const marker = '<sub>marker</sub>'

test('a marker-required kind fails without the marker', () => {
  assert.equal(check('x', 'comment', budgets, { markerRequired, marker }).verdict, 'MISSING_MARKER')
})

test('a marker-required kind passes with the marker', () => {
  assert.equal(check(`x${marker}`, 'comment', budgets, { markerRequired, marker }).verdict, 'OK')
})

// The harness attribution footer follows the marker in a real loop comment,
// so the check is presence, not position.
test('a marker followed by the attribution footer still passes', () => {
  const body = `x${marker}\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_`
  assert.equal(check(body, 'comment', budgets, { markerRequired, marker }).verdict, 'OK')
})

test('a kind outside markerRequired passes without a marker', () => {
  assert.equal(check('x', 'journalEntry', budgets, { markerRequired, marker }).verdict, 'OK')
})

// MISSING_MARKER comes first because the marker is 124 characters and counts.
test('a missing marker is reported before an overage', () => {
  const over = 'x'.repeat(budgets.comment + 1)
  assert.equal(check(over, 'comment', budgets, { markerRequired, marker }).verdict, 'MISSING_MARKER')
})

// Same contract as DEFAULT_BUDGETS: the fallback must equal the config, or a
// run with no reachable config enforces a different rule.
test('the marker fallbacks equal loop-config.json', () => {
  assert.equal(DEFAULT_MARKER, loop.identity.commentMarker)
  assert.deepEqual(DEFAULT_MARKER_REQUIRED, loop.writing.markerRequired)
})

// `markerRequired` is an allowlist, so a new budget kind would otherwise be
// silently exempt — the shape of the silence #155 removes. Every budgeted kind
// is listed there or exempt here, so adding one fails until someone decides.
const MARKER_EXEMPT = ['journalEntry']

test('every budgeted kind declares whether it carries the marker', () => {
  const required = loop.writing.markerRequired
  const undeclared = Object.keys(loop.writing.budgets)
    .filter((kind) => !required.includes(kind) && !MARKER_EXEMPT.includes(kind))
  assert.deepEqual(undeclared, [])
  assert.deepEqual(required.filter((kind) => !(kind in loop.writing.budgets)), [])
})

// The skills key on the printed verdict word, so a word a skill names and the
// script cannot print is prose/script drift — the class `rule-delta.mjs` and
// the `--kind` test above exist to close.
test('every verdict word a skill names is one the script can print', () => {
  const skills = join(root, 'workflow', 'skills')
  const named = new Set()
  for (const file of readdirSync(skills, { recursive: true })) {
    if (!String(file).endsWith('SKILL.md')) continue
    const text = readFileSync(join(skills, String(file)), 'utf8')
    for (const m of text.matchAll(/`([A-Z][A-Z_]+)`\s*(?:means|→)/g)) named.add(m[1])
  }
  assert.ok(named.size > 0, 'no skill keys on a verdict word, so this test checks nothing')
  assert.deepEqual([...named].filter((word) => !VERDICTS.includes(word)), [])
})
