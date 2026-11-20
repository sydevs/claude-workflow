// node --test workflow/lib/doc-weight.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLog, weigh } from './doc-weight.mjs'

const log = [
  '\0a1\tfeat: one\n',
  '10\t2\tsrc/a.ts\n',
  '3\t1\tsrc/AGENTS.md\n',
  '400\t0\tpnpm-lock.yaml\n',
  '-\t-\tlogo.png\n',
  '\0b2\tdocs: guide\n',
  '5\t5\tsrc/AGENTS.md\n',
  '2\t0\tdocs/x.mdx\n',
  '\0c3\tfix: two\tthree\n',
  '6\t0\tsrc/b.ts\n',
  '900\t0\tsrc/payload-types.ts\n',
].join('')

test('parseLog keeps subjects whole and drops binary rows', () => {
  const commits = parseLog(log)
  assert.deepEqual(
    commits.map((c) => [c.sha, c.subject, c.files.length]),
    [
      ['a1', 'feat: one', 3],
      ['b2', 'docs: guide', 2],
      ['c3', 'fix: two\tthree', 2],
    ],
  )
})

test('weigh splits doc from other lines, skipping lockfiles and generated files', () => {
  const r = weigh(parseLog(log), [/^src\/payload-types\.ts$/])
  assert.equal(r.commits, 3)
  assert.equal(r.docLines, 4 + 10 + 2)
  assert.equal(r.codeLines, 12 + 6)
  assert.equal(r.docShare, Math.round((100 * 16) / 34))
  assert.deepEqual(r.mostTouched[0], { path: 'src/AGENTS.md', count: 2 })
})

test('heaviest lists only commits that changed both sides', () => {
  const r = weigh(parseLog(log))
  assert.deepEqual(
    r.heaviest.map((h) => [h.sha, h.docShare]),
    [['a1', 25]],
  )
})

test('an empty history weighs nothing', () => {
  assert.deepEqual(weigh([]), {
    commits: 0,
    docLines: 0,
    codeLines: 0,
    docShare: 0,
    mostTouched: [],
    heaviest: [],
  })
})
