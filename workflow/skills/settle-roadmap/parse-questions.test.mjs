import test from 'node:test'
import assert from 'node:assert/strict'
import { parseQuestions } from './parse-questions.mjs'

const BODY = `## The goal
Something.

## Decisions
- **Old question?** → yes (Ardnived, 2026-10-09)

## Open questions
- [ ] **1. Does the admin library stay in this goal?** Reopened on review.
  - **A — Keep it here:** every library lands together.
    The stand-in is small.
  - **B — Make it its own goal (recommended):** the web libraries ship sooner.
- [ ] **2. How are the admin's components sorted?** Only if 1A.
  - Reopened 2026-10-10 by antontcymbal. Was: regroup into tiers (Ardnived, 2026-10-09).
  - **A — Regroup into tiers:** one menu rule.
  - **B — Keep today's folders (recommended):** nothing moves.
- [x] **3. Already settled?**
  - **A — Yes:** done.

## Notes
- [ ] **9. Not a question:** it sits outside the section.
`

test('reads every question, its options and the recommendation', () => {
  const { questions } = parseQuestions(BODY)
  assert.deepEqual(questions.map((q) => [q.n, q.ticked]), [[1, false], [2, false], [3, true]])
  const q1 = questions[0]
  assert.equal(q1.text, 'Does the admin library stay in this goal?')
  assert.equal(q1.context, 'Reopened on review.')
  assert.deepEqual(q1.options.map((o) => [o.letter, o.label, o.recommended]), [['A', 'Keep it here', false], ['B', 'Make it its own goal', true]])
  assert.equal(q1.options[0].text, 'every library lands together. The stand-in is small.')
})

test('a Reopened line names the previous answer and marks its option', () => {
  const q2 = parseQuestions(BODY).questions[1]
  assert.deepEqual(q2.reopened, { date: '2026-10-10', by: 'antontcymbal', was: 'regroup into tiers (Ardnived, 2026-10-09).' })
  assert.deepEqual(q2.options.map((o) => o.previous), [true, false])
})

test('an "only if" condition is read from the question', () => {
  assert.deepEqual(parseQuestions(BODY).questions[1].conditional, { question: 1, option: 'A' })
  assert.equal(parseQuestions(BODY).questions[0].conditional, null)
})

test('a body with no open questions section yields none', () => {
  assert.deepEqual(parseQuestions('## The goal\nx\n'), { questions: [] })
})
