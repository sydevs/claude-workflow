// node --test workflow/lib/budget.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check, fit, DEFAULT_BUDGETS } from './budget.mjs'
import { loadLoopConfig } from './config.mjs'
import { fileURLToPath } from 'node:url'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../..', import.meta.url))
const config = join(root, 'loop-config.json')
const cli = join(root, 'workflow', 'lib', 'budget.mjs')

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
  assert.equal(check('x'.repeat(1201), 'comment', budgets).verdict, 'OVER')
  assert.equal(check('x'.repeat(1200), 'comment', budgets).verdict, 'OK')
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
  assert.deepEqual(DEFAULT_BUDGETS, loadLoopConfig(config).writing.budgets)
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
  const budgets = loadLoopConfig(config).writing.budgets
  assert.ok(named.size > 0, 'no skill names a --kind, so this test checks nothing')
  assert.deepEqual([...named].filter((kind) => !(kind in budgets)), [])
})

// The CLI exited 0 on UNBUDGETED, so a typo'd or unnamed `--kind` read as a
// pass. Every verdict but OK exits 1 now, and the verdict word says which.
test('the CLI fails an unbudgeted kind, and names it', () => {
  const r = run(['--kind', 'nosuchkind'], 'x')
  assert.notEqual(r.status, 0)
  assert.match(r.stdout, /UNBUDGETED/)
  assert.match(r.stdout, /nosuchkind/)
})

test('the CLI passes a kind inside its budget', () => {
  const r = run(['--kind', 'journalEntry'], 'x')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^OK/)
})

test('the CLI fails a kind over its budget', () => {
  const limit = loadLoopConfig(config).writing.budgets.journalEntry
  const r = run(['--kind', 'journalEntry'], 'x'.repeat(limit + 1))
  assert.notEqual(r.status, 0)
  assert.match(r.stdout, /OVER/)
})

// `--fit` writes its verdict to stderr, because handler-journal redirects
// stdout to the fitted file. Its exit code is half of why.md's argument.
test('the --fit CLI reports an unbudgeted kind on stderr, and fails', () => {
  const r = run(['--fit', '--kind', 'nosuchkind'], 'x')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /UNBUDGETED/)
  assert.equal(r.stdout, 'x')
})

test('the CLI fails when no --kind is given at all', () => {
  const r = run([], 'x')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /no --kind given/)
})
