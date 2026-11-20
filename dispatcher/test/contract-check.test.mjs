// .github/actions/contract-check/check.sh, run against a throwaway git repo.
// It lives outside dispatcher/, but this is the suite ci.yml runs.
// (why: docs/why.md#a-contract-check-checks-what-a-pr-changes)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const CHECK = join(root, '.github/actions/contract-check/check.sh')
const CONFIG = join(root, 'loop-config.json')
const COPY = 'server/payload-types.ts'
const SIBLING = 'server/other-contract.json'

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim()

/** A repo whose base commit holds `v1`, plus `seed`, and a clone carrying one PR commit made by `change`. */
function pr(change, seed = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'contract-check-'))
  const origin = join(dir, 'origin')
  execFileSync('mkdir', ['-p', join(origin, 'server')])
  git(dir, 'init', '-q', '-b', 'main', origin)
  writeFileSync(join(origin, COPY), 'v1\n')
  writeFileSync(join(origin, 'other.txt'), 'a\n')
  seed(origin)
  git(origin, 'add', '.')
  git(origin, 'commit', '-qm', 'base')
  const base = git(origin, 'rev-parse', 'HEAD')
  const work = join(dir, 'work')
  git(dir, 'clone', '-q', origin, work)
  change(work)
  git(work, 'add', '-A')
  git(work, 'commit', '-qm', 'pr', '--allow-empty')
  return { dir, work, base }
}

function check({ work, base, dir }, upstream, env = {}) {
  const source = join(dir, 'upstream')
  writeFileSync(source, upstream)
  const r = spawnSync('bash', [CHECK], {
    cwd: work, encoding: 'utf8',
    env: { ...process.env, CONFIG, REPO_NAME: 'WeMeditateWeb', BASE_SHA: base, RECHECK_SECONDS: '0', INPUT_PATHS: COPY, INPUT_COMMAND: `cp ${source} ${COPY}`, ...env },
  })
  return { code: r.status, out: r.stdout + r.stderr }
}

test('a PR that leaves the copy alone passes, however far the source moved', () => {
  const r = check(pr((w) => writeFileSync(join(w, 'other.txt'), 'b\n')), 'v2\n')
  assert.equal(r.code, 0)
  assert.match(r.out, /nothing to check/)
  const broken = check(pr((w) => writeFileSync(join(w, 'other.txt'), 'b\n')), 'v2\n', { INPUT_COMMAND: 'false' })
  assert.equal(broken.code, 0, 'an untouched copy never runs the command')
})

test('a changed copy passes only when it is exactly what the command writes', () => {
  assert.equal(check(pr((w) => writeFileSync(join(w, COPY), 'v2\n')), 'v2\n').code, 0)
  const hand = check(pr((w) => writeFileSync(join(w, COPY), 'v2 plus a hand edit\n')), 'v2\n')
  assert.equal(hand.code, 1)
  assert.match(hand.out, /::error file=server\/payload-types\.ts,title=Contract check::/)
  const gone = check(pr((w) => unlinkSync(join(w, COPY))), 'v1\n')
  assert.equal(gone.code, 1, 'a deleted copy the command writes back is a change')
})

test('a copy synced correctly passes while a sibling copy the PR never touched has drifted', () => {
  const p = pr((w) => writeFileSync(join(w, COPY), 'v2\n'), (o) => writeFileSync(join(o, SIBLING), 'w1\n'))
  const sibling = join(p.dir, 'upstream-sibling')
  writeFileSync(sibling, 'w2\n')
  const r = check(p, 'v2\n', {
    INPUT_PATHS: `${COPY} ${SIBLING}`,
    INPUT_COMMAND: `cp ${join(p.dir, 'upstream')} ${COPY} && cp ${sibling} ${SIBLING}`,
  })
  assert.equal(r.code, 0, "drift in an untouched copy belongs to the contract sync, not to this PR")
  assert.match(r.out, /Changed copies: server\/payload-types\.ts$/m)
})

test('a command that fails is infrastructure, re-run rather than repaired', () => {
  const r = check(pr((w) => writeFileSync(join(w, COPY), 'v2\n')), 'v2\n', { INPUT_COMMAND: 'false' })
  assert.equal(r.code, 1)
  assert.match(r.out, /::error title=infrastructure-failure::/)
})

test('defaults come from contractSync; a repo with no entry fails, and a push has nothing to compare', () => {
  const p = pr((w) => writeFileSync(join(w, 'other.txt'), 'b\n'))
  const none = check(p, 'v1\n', { REPO_NAME: 'SahajCloud', INPUT_PATHS: '', INPUT_COMMAND: '' })
  assert.equal(none.code, 1)
  assert.match(none.out, /no contractSync entry/)
  const configured = check(p, 'v1\n', { INPUT_PATHS: '', INPUT_COMMAND: '' })
  assert.equal(configured.code, 0, 'WeMeditateWeb reads its paths from loop-config.json')
  assert.match(configured.out, /server\/payload-types\.ts/)
  const push = check(p, 'v1\n', { BASE_SHA: '' })
  assert.equal(push.code, 0)
  assert.match(push.out, /Not a pull request or merge group/)
})
