import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBlockedBy, unresolvedBlockers, stripBlockedBy, parseRecheck, parseSentry, datePassed, parseOpenQuestions, parseRequest } from '../markers.mjs'

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
  assert.equal(parseRecheck('- Re-check: 2026-10-01\n- ~~Re-check: 2026-10-02~~'), null, 'a list item never reaches it, struck or not')
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
  assert.deepEqual(parseBlockedBy('- **Blocked by sydevs/WeMeditateWeb#9.**', 'sydevs').map((b) => b.number), [9], 'a bullet and bold together')
  // The exact written format still parses, and a URL and shorthand for the
  // same issue count once.
  assert.deepEqual(
    parseBlockedBy('Blocked by: https://github.com/sydevs/SahajCloud/issues/718 and sydevs/SahajCloud#718', 'sydevs').map((b) => b.number),
    [718],
  )
})

test('loose matching stays closed to everything it should ignore', () => {
  assert.deepEqual(parseBlockedBy('~~Blocked by sydevs/SahajCloud#1~~', 'sydevs'), [], 'struck through')
  assert.deepEqual(parseBlockedBy('- ~~Blocked by: https://github.com/sydevs/SahajCloud/issues/1~~', 'sydevs'), [], 'struck through, as a list item')
  assert.deepEqual(parseBlockedBy('- **~~Blocked by sydevs/SahajCloud#1~~**', 'sydevs'), [], 'struck through inside bold')
  assert.deepEqual(parseBlockedBy('Blocked by: https://github.com/sydevs/SahajCloud/pull/9', 'sydevs'), [], 'a PR is not a blocker')
  assert.deepEqual(parseBlockedBy('This is blocked by sydevs/SahajCloud#5', 'sydevs'), [], 'mid-sentence prose')
  assert.deepEqual(parseBlockedBy('Blocked by: https://github.com/other/Repo/issues/3', 'sydevs'), [], 'another org')
  assert.deepEqual(parseBlockedBy('Blocked by #12', 'sydevs'), [], 'a bare number names no repository')
})

// ---- an unresolved blocker line is reported (why: docs/why.md#an-unresolved-blocker-line-is-reported)

const PULL = 'Blocked by: https://github.com/sydevs/SahajCloud/pull/912 — until it merges'

test('a blocker line that names a target and resolves no in-org issue is reported', () => {
  // sydevs/SahajCloud#987 named the PR, not the issue that PR closes.
  assert.deepEqual(unresolvedBlockers(PULL, 'sydevs'), [
    { line: PULL, targets: ['https://github.com/sydevs/SahajCloud/pull/912'] },
  ])
  // The line is reported as written — bullet off, nothing else — so the comment
  // does not quote the parser's intermediate back at the author.
  assert.deepEqual(unresolvedBlockers('- **Blocked by #12.**', 'sydevs'), [
    { line: '**Blocked by #12.**', targets: ['#12'] },
  ])
  assert.deepEqual(unresolvedBlockers('Blocked by: https://github.com/other-org/repo/issues/9', 'sydevs'), [
    { line: 'Blocked by: https://github.com/other-org/repo/issues/9', targets: ['https://github.com/other-org/repo/issues/9'] },
  ], "another org names no issue of ours")
  assert.deepEqual(unresolvedBlockers('Blocked by other-org/repo#9', 'sydevs')[0].targets, ['other-org/repo#9'])
})

test('reporting is narrower than reading: a line naming no target is prose', () => {
  // The loose matcher's false positives must not become public comments.
  // (why: docs/why.md#the-marker-reader-matches-words-not-punctuation)
  assert.deepEqual(unresolvedBlockers('Blocked by the lack of staging credentials.', 'sydevs'), [])
  assert.deepEqual(unresolvedBlockers('**Blocked by the Payload upgrade.**', 'sydevs'), [])
})

test('nothing else is reported: a resolved line, a struck line, no line at all', () => {
  assert.deepEqual(unresolvedBlockers('Blocked by: https://github.com/sydevs/SahajCloud/issues/907', 'sydevs'), [])
  assert.deepEqual(
    unresolvedBlockers('Blocked by: https://github.com/sydevs/SahajCloud/issues/907 and https://github.com/sydevs/SahajCloud/pull/912', 'sydevs'),
    [],
    'one resolvable target on the line is enough',
  )
  assert.deepEqual(unresolvedBlockers('- ~~Blocked by: https://github.com/sydevs/SahajCloud/pull/912~~', 'sydevs'), [], 'struck through')
  assert.deepEqual(unresolvedBlockers('This is blocked by sydevs/SahajCloud/pull/912', 'sydevs'), [], 'mid-sentence prose is no line')
  assert.deepEqual(unresolvedBlockers('no markers', 'sydevs'), [])
  assert.deepEqual(unresolvedBlockers('', 'sydevs'), [])
})

test('the shared body reports its two unresolved lines, each once', () => {
  assert.deepEqual(unresolvedBlockers(body, 'sydevs').map((u) => u.targets), [
    ['https://github.com/other-org/repo/issues/9'],
    ['https://github.com/sydevs/SahajCloud/pull/99'],
  ])
  // Keyed on the targets, so the same targets twice are one report — and
  // rewording the reason does not make a second.
  assert.deepEqual(unresolvedBlockers('Blocked by #12\nBlocked by #12', 'sydevs').length, 1)
  const first = unresolvedBlockers('Blocked by #12 — until that lands', 'sydevs')[0]
  const after = unresolvedBlockers('Blocked by #12 — waiting on the backport', 'sydevs')[0]
  assert.deepEqual(first.targets, after.targets, 'the reason is not part of the identity')
  assert.notEqual(first.line, after.line, 'though the quoted line follows the edit')
  // An author correcting one of two targets often rewrites the pair, so the
  // order they end up in is not part of the identity either.
  assert.equal(unresolvedBlockers('Blocked by #12 and #13\nBlocked by #13 and #12', 'sydevs').length, 1)
})

// ---- a converted blocker line is deleted (why: docs/why.md#a-converted-blocker-line-is-deleted)
const two = { repo: 'SahajCloud', number: 2 }
const three = { repo: 'SahajAtlasWeb', number: 3 }

test('a converted line is stripped and the rest of the body survives byte for byte', () => {
  const live = '## Summary\r\nkeep  this\r\n\r\n## Notes\r\n\r\nBlocked by: https://github.com/sydevs/SahajCloud/issues/2 — the endpoint\r\n\r\nSee also #4.\r\n'
  const out = stripBlockedBy(live, 'sydevs', 'Blocked by', [two])
  assert.equal(out.body, '## Summary\r\nkeep  this\r\n\r\n## Notes\r\n\r\nSee also #4.\r\n', 'one blank where the line was, CRLF kept')
  assert.deepEqual(out.dropped, ['Blocked by: https://github.com/sydevs/SahajCloud/issues/2 — the endpoint'])
  // The heading stays when the line was all it held.
  assert.equal(stripBlockedBy('## Notes\n- **Blocked by sydevs/SahajCloud#2.**\n', 'sydevs', 'Blocked by', [two]).body, '## Notes\n')
  assert.equal(stripBlockedBy('## Notes\n\nBlocked by: sydevs/SahajCloud#2', 'sydevs', 'Blocked by', [two]).body, '## Notes\n')
})

test('a line stays while any in-org target on it is unrelated', () => {
  const live = '## Notes\nBlocked by: https://github.com/sydevs/SahajCloud/issues/2 and https://github.com/sydevs/SahajAtlasWeb/issues/3\n'
  assert.deepEqual(stripBlockedBy(live, 'sydevs', 'Blocked by', [two]), { body: live, dropped: [] })
  assert.equal(stripBlockedBy(live, 'sydevs', 'Blocked by', [two, three]).body, '## Notes\n')
})

test('the strip leaves every line the reader skips', () => {
  const live = [
    '~~Blocked by: https://github.com/sydevs/SahajCloud/issues/2~~',
    '- ~~Blocked by sydevs/SahajCloud#2~~',
    'Blocked by: https://github.com/other/Repo/issues/2',
    'Blocked by #2',
    'This is blocked by sydevs/SahajCloud#2',
  ].join('\n')
  assert.deepEqual(stripBlockedBy(live, 'sydevs', 'Blocked by', [two]), { body: live, dropped: [] })
})

// ---- a fenced line is documentation, not a blocker
// Verbatim from workflow/skills/format-ticket/SKILL.md, the one tracked file
// whose own example both readers used to act on.
const fenced = [
  '## Notes',
  '',
  '```',
  'Blocked by: https://github.com/sydevs/SahajCloud/issues/632 — the endpoint does not exist yet',
  '```',
  '',
  'See also #4.',
  '',
].join('\n')

test('a fenced Blocked by line is neither related nor stripped', () => {
  assert.deepEqual(parseBlockedBy(fenced, 'sydevs'), [])
  const out = stripBlockedBy(fenced, 'sydevs', 'Blocked by', [{ repo: 'SahajCloud', number: 632 }])
  assert.deepEqual(out, { body: fenced, dropped: [] }, 'the fence and its line survive byte for byte')
  assert.deepEqual(parseBlockedBy('```markdown\nBlocked by: sydevs/SahajCloud#632\n```', 'sydevs'), [], 'an info string opens the fence too')
})

test('the other two line readers skip a fence from the same place', () => {
  // `liveLines` owns the rule, so every reader over it inherits the skip.
  assert.equal(parseRecheck('```\nRe-check: 2026-12-01\n```'), null)
  assert.equal(parseSentry('```\nSentry: https://sy-developers.sentry.io/issues/9 (id: 9)\n```'), null)
  assert.equal(parseRecheck(`${fenced}Re-check: 2026-10-01\n`), '2026-10-01', 'and a live line outside one still reads')
})

test('a fence elsewhere in the body leaves a live line alone', () => {
  const mixed = `${fenced}Blocked by: https://github.com/sydevs/SahajCloud/issues/2 — live\n`
  assert.deepEqual(parseBlockedBy(mixed, 'sydevs'), [{ owner: 'sydevs', repo: 'SahajCloud', number: 2 }])
  const out = stripBlockedBy(mixed, 'sydevs', 'Blocked by', [two])
  assert.deepEqual(out.dropped, ['Blocked by: https://github.com/sydevs/SahajCloud/issues/2 — live'])
  assert.equal(out.body, fenced, 'only the live line goes')
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
