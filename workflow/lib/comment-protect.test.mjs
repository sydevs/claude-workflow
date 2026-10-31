// node --test workflow/lib/comment-protect.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { census, globToRe, RULES } from './comment-fingerprint.mjs'

// Paths and comment text only. `fingerprint()` needs the target repo's own
// typescript, and this repo installs nothing, so a test built on it could
// never run here. Paths are repo-relative, as `git diff --name-only` prints
// them, because that is what `census()` is handed.
const docblock = { text: "/**\n   * Button size\n   * @default 'md'\n   */" }
const line = { text: '// internal' }
const block = { text: '/* not a docblock */' }

const k5 = (comments, path) => census(comments, RULES, path).K5

// A component's own file, not an examples file: Storybook prints these
// docblocks as the component's description and as each prop's row.
for (const path of [
  'components/atoms/Button/Button.tsx',
  'src/components/atoms/Chip/Chip.tsx',
  'src/views/EventView/EventView.tsx',
]) {
  test(`a prop docblock in ${path} is protected`, () => {
    assert.equal(k5([docblock], path), 1)
  })
}

// Two and three segments deep, where every story file in both repos sits.
// The last path is outside every component tree, so only `**/*.stories.tsx`
// reaches it.
for (const path of [
  'src/components/organisms/Mapbox/Mapbox.stories.tsx',
  'components/organisms/Header/Header.stories.tsx',
  'src/stories/Theme/Theme.stories.tsx',
]) {
  test(`a docblock in ${path} is protected`, () => {
    assert.equal(k5([docblock], path), 1)
  })
}

// A `//` or plain block comment is never printed, so it stays sweepable.
// Under the old `^` pattern, deleting one reported a PROTECTED VIOLATION.
test('a non-docblock comment in a component file is not protected', () => {
  assert.equal(k5([line, block], 'components/atoms/Button/Button.tsx'), 0)
  assert.equal(k5([line, block, docblock], 'components/atoms/Button/Button.tsx'), 1)
})

for (const path of ['src/lib/geo.ts', 'server/entry.ts']) {
  test(`a docblock in ${path} is not protected`, () => {
    assert.equal(k5([docblock, line], path), 0)
  })
}

// `**` spans zero, one and three segments; `*` stays inside one.
for (const [glob, path, want] of [
  ['src/components/**/*.tsx', 'src/components/Chip.tsx', true],
  ['src/components/**/*.tsx', 'src/components/atoms/Chip.tsx', true],
  ['src/components/**/*.tsx', 'src/components/a/b/c/Chip.tsx', true],
  ['src/components/**/*.tsx', 'src/views/Chip.tsx', false],
  ['src/components/**/*.tsx', 'src/components/atoms/Chip.ts', false],
  ['**/*.stories.tsx', 'Chip.stories.tsx', true],
  ['**/*.stories.tsx', 'a/Chip.stories.tsx', true],
  ['**/*.stories.tsx', 'a/b/c/Chip.stories.tsx', true],
  ['src/*.tsx', 'src/a/Chip.tsx', false],
]) {
  test(`${glob} ${want ? 'matches' : 'misses'} ${path}`, () => {
    assert.equal(globToRe(glob).test(path), want)
  })
}

// The old single-string key is what a repo's own `protectedComments` uses.
test('a rule with a single `pathGlob` string still scopes', () => {
  const rules = { frozen: [], keep: [{ id: 'S', pathGlob: 'src/**/*.ts', pattern: '^' }] }
  assert.equal(census([line], rules, 'src/a/b/c.ts').S, 1)
  assert.equal(census([line], rules, 'lib/c.ts').S, 0)
})

// One fixture per rule, each matching exactly that rule.
test('the unscoped rules count the same on every path', () => {
  const fixtures = [
    '// prettier-ignore',
    '// Copyright 2024 Sahaj Yoga',
    '/**\n * Plugin Name: Sahaj Atlas\n */',
    '/**\n * @package SahajAtlas\n */',
    '/*\n translators: %s is a city\n */',
    '// ⚠ load-bearing',
    '// keep in sync with the widget',
    '// see #42',
    '// see lib/geo.ts',
    '// shortcut: one process only, move to a shared store when we scale out',
  ].map((text) => ({ text }))
  const want = { F1: 1, F2: 1, F3: 1, F4: 1, F5: 1, K1: 1, K2: 1, K3: 1, K4: 1, K6: 1 }
  for (const path of ['src/lib/geo.ts', 'components/atoms/Button/Button.tsx', 'sahaj-atlas.php']) {
    const { K5, ...rest } = census(fixtures, RULES, path)
    assert.deepEqual(rest, want, path)
  }
})

// `comment-sweep.mjs` builds its KEEP list from the rules without `pathGlob`,
// and a rule there stops tier 2 collapsing every comment it matches. A scoped
// rule under any other key would stop it collapsing any docblock anywhere.
test('no rule the codemod applies everywhere protects a plain docblock', () => {
  const everywhere = RULES.keep
    .filter((r) => !r.pathGlob)
    .filter((r) => new RegExp(r.pattern, (r.flags || '') + 'm').test(docblock.text))
  assert.deepEqual(everywhere.map((r) => r.id), [])
})
