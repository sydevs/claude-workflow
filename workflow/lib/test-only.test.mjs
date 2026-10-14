// node --test workflow/lib/test-only.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify, verdict } from './test-only.mjs'

// Fixture pre-mortem: these paths assume the real layouts of the four product
// repos, checked with `git ls-files` in each on 2026-10-13 — SahajCloud's
// tests/ and seeds/tests/, SahajAtlasWeb's co-located *.test.ts and
// src/test-support/, both frontends' vitest.*.config.ts, the plugin's tests/.
// The globs are the real ones, read from loop-config.json, not a copy.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const globs = JSON.parse(readFileSync(join(root, 'loop-config.json'), 'utf8')).findings.testGlobs

test('every test layout the four repos use is inside the globs', () => {
  const paths = [
    'tests/unit/next-config-body-limit.spec.ts',
    'tests/int/collections-smoke.int.spec.ts',
    'seeds/tests/check-tags.ts',
    'src/config/translations.test.ts',
    'src/components/atoms/Icons/Icons.usage.test.tsx',
    'src/test-support/source-tree.ts',
    'vitest.config.ts',
    'vitest.smoke.config.ts',
    'playwright.config.ts',
    'tests/fixtures/mesmerize/page.html',
  ]
  assert.deepEqual(classify(paths, globs).outside, [])
})

test('product code, generated files and protected config stay outside', () => {
  const paths = [
    'src/lib/status/spec.ts', // a product module that happens to be named spec
    'src/payload.config.ts',
    'src/mocks/events.ts', // also feeds Storybook, so not test-only
    '.claude/hooks/unit-test.mjs',
    'package.json',
    'docs/testing.md',
  ]
  assert.deepEqual(classify(paths, globs).inside, [])
})

test('one product file makes the whole branch NOT TEST-ONLY', () => {
  const r = classify(['src/a.test.ts', 'src/a.ts'], globs)
  assert.equal(verdict(r), 'NOT TEST-ONLY')
  assert.deepEqual(r.outside, ['src/a.ts'])
})

test('no change at all is EMPTY, never TEST-ONLY', () => {
  assert.equal(verdict(classify([], globs)), 'EMPTY')
})
