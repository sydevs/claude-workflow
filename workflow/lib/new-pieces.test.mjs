// node --test workflow/lib/new-pieces.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify, declarations, parseDiff } from './new-pieces.mjs'

// The thresholds and globs are the real ones, read from loop-config.json.
const here = dirname(fileURLToPath(import.meta.url))
const streamline = JSON.parse(readFileSync(join(here, '..', '..', 'loop-config.json'), 'utf8')).review.streamline
const added = (...texts) => texts.map((text, i) => ({ line: i + 1, text }))
const file = (path, n, { isNew = true, deleted = 0, texts = [] } = {}) => ({
  path,
  added: isNew,
  deleted,
  lines: [...added(...texts), ...Array.from({ length: Math.max(0, n - texts.length) }, (_, i) => ({ line: texts.length + i + 1, text: '  x' }))],
})

test('top-level declarations are pieces, nested ones are not', () => {
  const found = declarations('src/a.ts', added(
    'export async function load(id) {',
    '  function inner() {}',
    'export const route = () => {}',
    'const LIMIT = 5',
    'export default class Store {}',
    'export type Row = { id: string }',
    'interface Props {}',
    'import { x } from "y"',
  ))
  assert.deepEqual(found.map((p) => `${p.kind}:${p.name}:${p.line}`), [
    'function:load:1', 'const:route:3', 'const:LIMIT:4', 'class:Store:5', 'type:Row:6', 'type:Props:7',
  ])
})

test('a PHP method counts at any indent; prose and CSS have no declarations', () => {
  assert.deepEqual(declarations('includes/class-atlas.php', added('class Atlas {', '  public static function render( $atts ) {')).map((p) => p.name), ['Atlas', 'render'])
  assert.deepEqual(declarations('docs/guide.md', added('function looks like code')), [])
  assert.deepEqual(declarations('src/a.css', added('.row { }')), [])
})

test('the diff parser numbers added lines on the branch and drops deletions', () => {
  const diff = [
    'diff --git a/src/new.ts b/src/new.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/new.ts',
    '@@ -0,0 +1,2 @@',
    '+export function a() {}',
    '+export function b() {}',
    'diff --git a/src/old.ts b/src/old.ts',
    '--- a/src/old.ts',
    '+++ b/src/old.ts',
    '@@ -10,2 +10,0 @@',
    '-gone',
    '-gone too',
    '@@ -40,0 +38,1 @@',
    '+export const c = 1',
    'diff --git a/src/dead.ts b/src/dead.ts',
    'deleted file mode 100644',
    '--- a/src/dead.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-x',
  ].join('\n')
  const files = parseDiff(diff)
  assert.deepEqual(files.map((f) => [f.path, f.added, f.deleted, f.lines.map((l) => l.line)]), [
    ['src/new.ts', true, 0, [1, 2]],
    ['src/old.ts', false, 2, [38]],
  ])
})

test('a file is streamlined whole when new at the threshold or grown by its own', () => {
  const r = classify([
    file('src/big.ts', streamline.newFileLines),
    file('src/small.ts', streamline.newFileLines - 1),
    file('src/grown.ts', streamline.grownLines + 10, { isNew: false, deleted: 10 }),
    file('src/churned.ts', streamline.grownLines + 10, { isNew: false, deleted: 11 }),
  ], { streamline }, () => 400)
  assert.deepEqual(r.files.map((f) => [f.path, f.wholeFile]), [['src/big.ts', true], ['src/grown.ts', true]])
  assert.equal(r.wholeFileLines, 800)
})

test('a small file is still listed for the pieces it adds', () => {
  const r = classify([file('src/helper.ts', 20, { texts: ['export function helper() {'] })], { streamline }, () => 0)
  assert.deepEqual(r.files.map((f) => [f.path, f.wholeFile, f.pieces.map((p) => p.name)]), [['src/helper.ts', false, ['helper']]])
  assert.equal(r.verdict, 'PIECES')
})

test('fixtures, mocks and stories are in; tests, data, generated and vendored files are out', () => {
  const big = (path) => file(path, streamline.newFileLines)
  const r = classify([
    big('tests/browser/fixtures.ts'),
    big('src/mocks/wire.ts'),
    big('src/components/Map.stories.tsx'),
    big('tests/smoke/embed.smoke.test.ts'),
    big('tests/unit/limits.spec.ts'),
    big('seeds/translations/data.en.json'),
    big('src/payload-types.ts'),
    big('vendor/lib/thing.php'),
  ], { streamline, generated: [/^src\/payload-types\.ts$/, /^vendor\//] }, () => 150)
  assert.deepEqual(r.files.map((f) => f.path), ['tests/browser/fixtures.ts', 'src/mocks/wire.ts', 'src/components/Map.stories.tsx'])
  assert.equal(r.skipped.length, 5)
})

test('past splitLines in total the streamliner is split', () => {
  const r = classify([file('src/a.ts', 200), file('src/b.ts', 200)], { streamline }, () => streamline.splitLines / 2 + 1)
  assert.equal(r.split, true)
  assert.equal(classify([], { streamline }, () => 0).verdict, 'NONE')
})

test('the CLI reads a remote-style head without a checkout', () => {
  const repo = mkdtempSync(join(tmpdir(), 'new-pieces-'))
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 't')
  mkdirSync(join(repo, '.claude'))
  writeFileSync(join(repo, '.claude', 'workflow.json'), JSON.stringify({ generatedFiles: [{ pattern: '^gen/' }] }))
  git('add', '.')
  git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feature')
  mkdirSync(join(repo, 'src'))
  mkdirSync(join(repo, 'gen'))
  writeFileSync(join(repo, 'src', 'a.ts'), 'export function a() {}\n')
  writeFileSync(join(repo, 'gen', 'b.ts'), 'export function b() {}\n')
  git('add', '.')
  git('commit', '-qm', 'feature')
  git('checkout', '-q', 'main')
  const out = execFileSync('node', [join(here, 'new-pieces.mjs'), '--base', 'main', '--head', 'feature', '--json'], { cwd: repo, encoding: 'utf8' })
  const r = JSON.parse(out)
  assert.deepEqual(r.files.map((f) => [f.path, f.pieces.map((p) => p.name)]), [['src/a.ts', ['a']]])
  assert.deepEqual(r.skipped, ['gen/b.ts'])
})
