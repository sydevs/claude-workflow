// node --test workflow/lib/budget.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check, fit } from './budget.mjs'

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
// 1300 the FIT_RESERVE headroom targets. A 1,355-character entry lost its
// whole Did section here and was told it had 532 characters to spare.
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
