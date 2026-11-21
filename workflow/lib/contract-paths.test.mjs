// node --test workflow/lib/contract-paths.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configuredPaths, hasRef, inTree, missing, verdict, REF } from './contract-paths.mjs'

// Fixture pre-mortem: nothing here stands in for the config. The pairs come
// from the real loop-config.json, so a consumer added or a path moved is
// read, not assumed. The temp repo stands in only for a checkout, and it is
// built by git itself — `refs/remotes/origin/main` is written by hand because
// a clone is what normally writes it, and this test has no network.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const config = JSON.parse(readFileSync(join(root, 'loop-config.json'), 'utf8'))

test('every configured copy comes out as one repo-and-path pair', () => {
  const pairs = configuredPaths(config.contractSync.consumers)
  const expected = Object.values(config.contractSync.consumers).reduce((n, c) => n + c.paths.length, 0)
  assert.equal(pairs.length, expected)
  assert.ok(pairs.length > 0)
  for (const { repo, path } of pairs) {
    assert.ok(config.repos.includes(repo), `${repo} is not one of loop-config.json repos`)
    assert.ok(path && !path.startsWith('/'), `${path} is not a repo-relative path`)
  }
})

test('a path the repo does not have is named with its repo', () => {
  const pairs = [
    { repo: 'WeMeditateWeb', path: 'server/payload-types.ts' },
    { repo: 'SahajAtlasWordpress', path: 'tests/atlas-url-contract.json' },
  ]
  const gone = missing(pairs, (repo) => repo !== 'WeMeditateWeb')
  assert.deepEqual(gone, [{ repo: 'WeMeditateWeb', path: 'server/payload-types.ts' }])
  assert.equal(verdict(gone), 'PATHS MISSING')
})

test('all present is the only quiet verdict', () => {
  const pairs = configuredPaths(config.contractSync.consumers)
  assert.equal(verdict(missing(pairs, () => true)), 'PATHS PRESENT')
  assert.equal(verdict([]), 'PATHS PRESENT')
})

test('a consumer with no paths contributes none, and no crash', () => {
  assert.deepEqual(configuredPaths({ Repo: {} }), [])
  assert.deepEqual(configuredPaths(), [])
})

test(`a moved copy is absent from ${REF}, where the old path once was`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'contract-paths-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  mkdirSync(join(dir, 'server'))
  writeFileSync(join(dir, 'server/payload-types.ts'), 'export type Config = {}\n')
  git('add', '-A')
  git('commit', '-qm', 'the copy where the config says it is')

  // No remote ref yet: absence cannot be distinguished from an unfetched repo.
  assert.equal(hasRef(dir), false)

  git('update-ref', `refs/remotes/${REF}`, 'HEAD')
  assert.equal(hasRef(dir), true)
  assert.equal(inTree(dir, 'server/payload-types.ts'), true)
  assert.equal(inTree(dir, 'types/payload/payload-types.ts'), false)

  // The repo moves its copy, as WeMeditateWeb did, and the config lags.
  mkdirSync(join(dir, 'types/payload'), { recursive: true })
  renameSync(join(dir, 'server/payload-types.ts'), join(dir, 'types/payload/payload-types.ts'))
  git('add', '-A')
  git('commit', '-qm', 'move the copy')
  git('update-ref', `refs/remotes/${REF}`, 'HEAD')

  const pairs = [{ repo: 'consumer', path: 'server/payload-types.ts' }]
  const gone = missing(pairs, (_repo, path) => inTree(dir, path))
  assert.deepEqual(gone, pairs)
  assert.equal(verdict(gone), 'PATHS MISSING')
})
