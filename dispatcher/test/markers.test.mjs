import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBlockedBy, parseRecheck, parseSentry, datePassed, parsePhases, parseOpenQuestions, parseRequest } from '../markers.mjs'

const body = `## Summary
x

## Notes
Blocked by: https://github.com/sydevs/SahajCloud/issues/632 — the endpoint does not exist yet
Blocked by: https://github.com/sydevs/SahajAtlasWeb/issues/12 and https://github.com/sydevs/SahajCloud/issues/7
~~Blocked by: https://github.com/sydevs/SahajCloud/issues/1 — old~~ — cleared 2026-09-01
Blocked by: https://github.com/other-org/repo/issues/9
Blocked by: https://github.com/sydevs/SahajCloud/pull/99
Re-check: 2026-10-01
Sentry: https://sy-developers.sentry.io/issues/123 (id: 123)
`

test('live in-org issue blockers are parsed; struck, foreign and PR lines are not', () => {
  assert.deepEqual(parseBlockedBy(body, 'sydevs'), [
    { owner: 'sydevs', repo: 'SahajCloud', number: 632 },
    { owner: 'sydevs', repo: 'SahajAtlasWeb', number: 12 },
    { owner: 'sydevs', repo: 'SahajCloud', number: 7 },
  ])
})

test('re-check and sentry lines', () => {
  assert.equal(parseRecheck(body), '2026-10-01')
  assert.deepEqual(parseSentry(body), { url: 'https://sy-developers.sentry.io/issues/123', id: '123' })
  assert.equal(parseRecheck('no markers'), null)
  assert.equal(parseSentry('no markers'), null)
})

test('datePassed compares ISO dates', () => {
  assert.equal(datePassed('2026-09-01', new Date('2026-09-08T00:00:00Z')), true)
  assert.equal(datePassed('2026-09-08', new Date('2026-09-08T12:00:00Z')), false)
  assert.equal(datePassed(null), false)
})

test('the reader matches the words, not the punctuation — the four live tickets', () => {
  // Verbatim from SahajAtlasWeb#195/#198 and WeMeditateWeb#78/#80 on 2026-09-09.
  // Each has a correct native relationship and prose the old reader missed.
  const one = parseBlockedBy('**Blocked by sydevs/SahajCloud#695.** Do not start integration until that PR merges.', 'sydevs')
  assert.deepEqual(one, [{ owner: 'sydevs', repo: 'SahajCloud', number: 695 }])
  const two = parseBlockedBy('**Blocked by sydevs/SahajCloud#705 and sydevs/SahajCloud#706.** Do not start until both merge.', 'sydevs')
  assert.deepEqual(two.map((b) => b.number), [705, 706])
  assert.deepEqual(parseBlockedBy('- Blocked by sydevs/WeMeditateWeb#80', 'sydevs').map((b) => b.number), [80])
  // The exact written format still parses, and a URL and shorthand for the
  // same issue count once.
  assert.deepEqual(
    parseBlockedBy('Blocked by: https://github.com/sydevs/SahajCloud/issues/718 and sydevs/SahajCloud#718', 'sydevs').map((b) => b.number),
    [718],
  )
})

test('loose matching stays closed to everything it should ignore', () => {
  assert.deepEqual(parseBlockedBy('~~Blocked by sydevs/SahajCloud#1~~', 'sydevs'), [], 'struck through')
  assert.deepEqual(parseBlockedBy('Blocked by: https://github.com/sydevs/SahajCloud/pull/9', 'sydevs'), [], 'a PR is not a blocker')
  assert.deepEqual(parseBlockedBy('This is blocked by sydevs/SahajCloud#5', 'sydevs'), [], 'mid-sentence prose')
  assert.deepEqual(parseBlockedBy('Blocked by: https://github.com/other/Repo/issues/3', 'sydevs'), [], 'another org')
  assert.deepEqual(parseBlockedBy('Blocked by #12', 'sydevs'), [], 'a bare number names no repository')
})

test('phases are counted from the PR body checklist, up to the next heading', () => {
  const b = '## Summary\n- [x] not a phase\n\n## Phases\n- [x] schema\n- [X] endpoint\n- [ ] admin UI\n* [ ] docs\n\n## Test results\n- [ ] not a phase either'
  assert.deepEqual(parsePhases(b), { total: 4, done: 2 })
})

test('a body without a phases checklist has no phases', () => {
  assert.equal(parsePhases('## Summary\n- [ ] x'), null)
  assert.equal(parsePhases('## Phases\n\nNone yet.'), null)
  assert.equal(parsePhases(''), null)
})

test('phases below a change outline count only the real checklist', () => {
  const b = [
    '## Summary', '- x', '',
    '## Change outline', '### Flow', '```diff', '## Phases', '- [ ] not a phase', '+- [x] nor this', '```', '',
    '## Preview', '- y', '',
    '## Phases', '- [x] schema', '- [ ] admin UI', '',
    'Closes #9',
  ].join('\n')
  assert.deepEqual(parsePhases(b), { total: 2, done: 1 })
})

test('a phases heading inside a code fence is not a plan', () => {
  assert.equal(parsePhases('## Notes\n```markdown\n## Phases\n- [ ] one\n```\n'), null)
})

test('open questions count checkboxes under their own heading, not option bullets', () => {
  const b = ['## Open questions', '- [ ] **1. Permanent redirect?**', '  - **A — Permanent (recommended):** links keep working', '  - **B — Temporary:** revisit in 2027', '- [x] **2. Who owns DNS?** Answered 2026-10-05', '', '## Notes', '- [ ] not a question'].join('\n')
  assert.deepEqual(parseOpenQuestions(b), { total: 2, open: 1 })
  assert.deepEqual(parseOpenQuestions('## Summary\nnone'), { total: 0, open: 0 })
  assert.deepEqual(parseOpenQuestions('```\n## Open questions\n- [ ] quoted\n```'), { total: 0, open: 0 })
})

test('a session request keeps only the keys the dispatcher acts on', () => {
  const repos = ['SahajAtlasWeb']
  assert.deepEqual(parseRequest('done <!-- sydevs-request {"replan":true,"merge":true} -->', repos), { replan: true })
  assert.deepEqual(parseRequest('<!-- sydevs-request {"transfer":{"repo":"Elsewhere"}} -->', repos), null, 'a repo outside the org list')
  assert.equal(parseRequest('<!-- sydevs-request {not json} -->', repos), null)
  assert.equal(parseRequest('no marker', repos), null)
})
