// node --test workflow/lib/review-scope.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reviewSkipPatterns } from './config.mjs'
import { classify, parseNumstat } from './review-scope.mjs'

// Fixture pre-mortem: the entries below copy the shape of SahajCloud's and
// SahajAtlasWeb's real `generatedFiles` and `securityReview` blocks, read on
// 2026-11-24, with `review: "skip"` where their config PRs set it. The paths
// and line counts are SahajCloud#1216's real numstat. The threshold is the
// real one, read from loop-config.json, not a copy.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const skipWhen = JSON.parse(readFileSync(join(root, 'loop-config.json'), 'utf8')).review.skipWhen

const sahajCloud = JSON.stringify({
  generatedFiles: [
    { pattern: '^src/payload-types\\.ts$', review: 'skip' },
    { pattern: '^src/app/\\(payload\\)/admin/importMap\\.js$' },
    { pattern: '^src/migrations/.+\\.json$', review: 'skip' },
    { pattern: '^src/migrations/.+\\.ts$' },
  ],
  securityReview: { triggerPattern: 'src/plugins/access/|webhook' },
})

const pr1216 = [
  { path: 'seeds/wm-web-translations/data.en.json', lines: 7 },
  { path: 'src/globals/WeMeditateWebTranslations/translationsSchema.json', lines: 4 },
  { path: 'src/migrations/20261118_233000_wm_web_menu_key.json', lines: 29621 },
  { path: 'src/migrations/20261118_233000_wm_web_menu_key.ts', lines: 74 },
  { path: 'src/migrations/index.ts', lines: 6 },
  { path: 'src/payload-types.ts', lines: 4 },
]

test('only an entry that opts out is skipped: the snapshot and types go, the migration SQL stays', () => {
  const r = classify(pr1216, { skip: reviewSkipPatterns(sahajCloud), skipWhen })
  assert.deepEqual(r.skipped.map((f) => f.path), [
    'src/migrations/20261118_233000_wm_web_menu_key.json',
    'src/payload-types.ts',
  ])
  assert.equal(r.files, 4)
  assert.equal(r.lines, 91)
  assert.equal(r.verdict, 'FULL')
})

test('a path the security trigger names stays in review, opted out or not', () => {
  const atlas = JSON.stringify({ generatedFiles: [{ pattern: '^pnpm-lock\\.yaml$', review: 'skip' }] })
  const files = [{ path: 'pnpm-lock.yaml', lines: 20 }]
  const r = classify(files, { skip: reviewSkipPatterns(atlas), trigger: /package\.json|pnpm-lock\.yaml/, skipWhen })
  assert.deepEqual(r.skipped, [])
  assert.deepEqual(r.review.map((f) => f.path), ['pnpm-lock.yaml'])
})

test('a diff at both limits is TINY, and one over either is FULL', () => {
  const at = Array.from({ length: skipWhen.maxFiles }, (_, i) => ({ path: `f${i}.ts`, lines: 0 }))
  at[0].lines = skipWhen.maxLines
  assert.equal(classify(at, { skipWhen }).verdict, 'TINY')
  assert.equal(classify([...at, { path: 'extra.ts', lines: 0 }], { skipWhen }).verdict, 'FULL')
  assert.equal(classify([{ path: 'a.ts', lines: skipWhen.maxLines + 1 }], { skipWhen }).verdict, 'FULL')
})

test('an unreadable threshold or config fails toward FULL and skips nothing', () => {
  assert.equal(classify([{ path: 'a.ts', lines: 1 }], { skipWhen: null }).verdict, 'FULL')
  assert.deepEqual(reviewSkipPatterns('not json'), [])
  assert.deepEqual(reviewSkipPatterns(JSON.stringify({ generatedFiles: [{ pattern: '(', review: 'skip' }] })), [])
  assert.deepEqual(reviewSkipPatterns(JSON.stringify({ generatedFiles: [{ pattern: '^dist/' }] })), [])
})

test('numstat parsing counts a binary file as zero lines and keeps odd paths whole', () => {
  const text = '3\t4\tsrc/a b.ts\0-\t-\tpublic/logo.png\0'
  assert.deepEqual(parseNumstat(text), [
    { path: 'src/a b.ts', lines: 7 },
    { path: 'public/logo.png', lines: 0 },
  ])
})
