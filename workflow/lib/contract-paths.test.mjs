// node --test workflow/lib/contract-paths.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { present, REF } from './contract-paths.mjs'

// Fixture pre-mortem: nothing here stands in for the config. Every repo name
// and path comes from the real loop-config.json, so a consumer added or a copy
// moved is read, not assumed. The temp checkouts stand in only for clones, and
// git builds them — `refs/remotes/origin/main` by hand, since a clone is what
// normally writes it and this test has no network.
const here = dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(readFileSync(join(here, '..', '..', 'loop-config.json'), 'utf8'))
const consumers = config.contractSync.consumers
const script = join(here, 'contract-paths.mjs')

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })

/** A checkout per consumer, each holding the copies the config names. */
function workspace(t, { ref = true } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'contract-ws-'))
  t.after(() => rmSync(ws, { recursive: true, force: true }))
  for (const [repo, c] of Object.entries(consumers)) {
    const dir = join(ws, repo)
    mkdirSync(dir)
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.email', 'test@example.com')
    git(dir, 'config', 'user.name', 'test')
    for (const p of c.paths) {
      mkdirSync(join(dir, dirname(p)), { recursive: true })
      writeFileSync(join(dir, p), '// the copy\n')
    }
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'the copies where the config says they are')
    if (ref) git(dir, 'update-ref', `refs/remotes/${REF}`, 'HEAD')
  }
  return ws
}

const run = (ws) => spawnSync(process.execPath, [script, ws], { encoding: 'utf8' })

test('every configured copy names a repo, and is spelled as a tree spells it', () => {
  let copies = 0
  for (const [repo, c] of Object.entries(consumers)) {
    assert.ok(config.repos.includes(repo), `${repo} is not one of loop-config.json repos`)
    for (const path of c.paths || []) {
      copies++
      // Membership against ls-tree is exact, so a `./` prefix, a trailing
      // slash or a `..` hop would report a present file as MISSING.
      assert.match(path, /^[\w.-]+(\/[\w.-]+)*$/, `${path} is not spelled as a tree spells it`)
      const hops = path.split('/').filter((s) => s === '.' || s === '..')
      assert.deepEqual(hops, [], `${path} spells a hop a tree never names`)
    }
  }
  assert.ok(copies > 0)
})

test(`a moved copy leaves ${REF}, and no ref at all is not an answer`, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'contract-paths-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  mkdirSync(join(dir, 'server'))
  writeFileSync(join(dir, 'server/payload-types.ts'), 'export type Config = {}\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'the copy where the config says it is')

  // Unfetched, so absence would prove nothing: null, never an empty answer.
  assert.equal(present(dir, ['server/payload-types.ts']), null)

  git(dir, 'update-ref', `refs/remotes/${REF}`, 'HEAD')
  assert.deepEqual(present(dir, ['server/payload-types.ts']), new Set(['server/payload-types.ts']))
  assert.deepEqual(present(dir, ['types/payload/payload-types.ts']), new Set())

  // The repo moves its copy, as WeMeditateWeb did, and the config lags.
  mkdirSync(join(dir, 'types/payload'), { recursive: true })
  renameSync(join(dir, 'server/payload-types.ts'), join(dir, 'types/payload/payload-types.ts'))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'move the copy')
  git(dir, 'update-ref', `refs/remotes/${REF}`, 'HEAD')

  const paths = ['server/payload-types.ts', 'types/payload/payload-types.ts']
  assert.deepEqual(present(dir, paths), new Set(['types/payload/payload-types.ts']))
})

test('the real config passes against checkouts holding what it names', (t) => {
  const r = run(workspace(t))
  assert.match(r.stdout, /PATHS PRESENT/)
  assert.equal(r.status, 0)
})

test('a copy a consumer moved is named with its repo, and fails', (t) => {
  const ws = workspace(t)
  const [repo, c] = Object.entries(consumers)[0]
  const path = c.paths[0]
  unlinkSync(join(ws, repo, path))
  git(join(ws, repo), 'add', '-A')
  git(join(ws, repo), 'commit', '-qm', 'move the copy out of the configured path')
  git(join(ws, repo), 'update-ref', `refs/remotes/${REF}`, 'HEAD')

  const r = run(ws)
  assert.equal(r.status, 1)
  assert.match(r.stdout, /PATHS MISSING/)
  const line = r.stdout.split('\n').find((l) => l.includes(`${repo} ${path}`))
  assert.match(line, /MISSING/)
})

test('a checkout it cannot read is never a pass', (t) => {
  const empty = mkdtempSync(join(tmpdir(), 'contract-ws-'))
  t.after(() => rmSync(empty, { recursive: true, force: true }))
  const missing = run(empty)
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, new RegExp(Object.keys(consumers)[0]))

  const unfetched = run(workspace(t, { ref: false }))
  assert.equal(unfetched.status, 2)
  assert.match(unfetched.stderr, new RegExp(REF))
})
