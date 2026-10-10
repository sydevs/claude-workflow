// node --test workflow/lib/base-ref.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveBaseRef, BaseRefError } from './base-ref.mjs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../..', import.meta.url))
const lib = join(root, 'workflow', 'lib')

/**
 * A throwaway repo in the shape a routine clone actually has: HEAD on a
 * `claude/*` branch, `refs/remotes/origin/main` current, and `refs/heads/main`
 * left wherever the clone was seeded.
 *
 * ## Fixture pre-mortem
 *
 * This fixture assumes nothing about any sydevs repo. It asserts against git's
 * own behaviour, built here commit by commit, which is why the stale ref is
 * written with `update-ref` rather than mocked: `git merge-base main HEAD`
 * returning the stale commit is the exact property that makes merge-base alone
 * insufficient, and a mock would let that property be assumed instead of
 * shown. The one real-world fact it leans on is that `origin` is the remote
 * name, which `start-run` step 6 (`git remote set-head origin …`) fixes too.
 */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'base-ref-'))
  const g = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()

  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 'bot@example.invalid')
  g('config', 'user.name', 'test')
  g('config', 'commit.gpgsign', 'false')

  const skill = (text) => {
    mkdirSync(join(dir, 'skills', 'one'), { recursive: true })
    writeFileSync(join(dir, 'skills', 'one', 'SKILL.md'), text)
  }
  const commit = (message) => {
    g('add', '-A')
    g('commit', '-q', '-m', message)
    return g('rev-parse', 'HEAD')
  }

  return { dir, g, skill, commit }
}

const cleanup = (dir) => rmSync(dir, { recursive: true, force: true })

/** One directive per line, in the bold form `rule-delta.mjs` recognises. */
const body = (...rules) => rules.map((r) => `- **${r}**\n`).join('')

test('a bare name prefers origin/<name> and warns when the local ref differs', () => {
  const { dir, g, skill, commit } = repo()
  try {
    skill(body('Never do the first thing'))
    const first = commit('first')
    skill(body('Never do the first thing', 'Never do the second thing'))
    const second = commit('second')

    g('update-ref', 'refs/remotes/origin/main', second)
    g('update-ref', 'refs/heads/main', first)
    g('checkout', '-q', '-b', 'claude/fix-1', second)

    const warnings = []
    const r = resolveBaseRef('main', { root: dir, onWarn: (m) => warnings.push(m) })

    assert.equal(r.named, 'refs/remotes/origin/main')
    assert.equal(r.baseline, second)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /local main is \w{7} and origin\/main is \w{7}/)
  } finally {
    cleanup(dir)
  }
})

test('a local ref that agrees with its remote counterpart warns nothing', () => {
  const { dir, g, skill, commit } = repo()
  try {
    skill(body('Never do the first thing'))
    const first = commit('first')
    g('update-ref', 'refs/remotes/origin/main', first)

    const warnings = []
    const r = resolveBaseRef('main', { root: dir, onWarn: (m) => warnings.push(m) })

    assert.deepEqual(warnings, [])
    assert.equal(r.baseline, first)
  } finally {
    cleanup(dir)
  }
})

test('merge-base alone does not rescue a stale ref, so the remote wins first', () => {
  const { dir, g, skill, commit } = repo()
  try {
    skill(body('Never do the first thing'))
    const first = commit('first')
    skill(body('Never do the first thing', 'Never do the second thing'))
    const second = commit('second')

    g('update-ref', 'refs/remotes/origin/main', second)
    g('update-ref', 'refs/heads/main', first)
    g('checkout', '-q', '-b', 'claude/fix-1', second)

    // The property that makes resolution, not merge-base, the fix.
    assert.equal(g('merge-base', 'refs/heads/main', 'HEAD'), first)
    assert.equal(resolveBaseRef('main', { root: dir, onWarn() {} }).baseline, second)
  } finally {
    cleanup(dir)
  }
})

test('the baseline is the branch point, so commits the base gained stay out', () => {
  const { dir, g, skill, commit } = repo()
  try {
    skill(body('Never do the first thing'))
    const branchPoint = commit('first')

    g('checkout', '-q', '-b', 'claude/fix-1')
    skill(body('Never do the first thing', 'Never do a branch thing'))
    const head = commit('on the branch')

    g('checkout', '-q', 'main')
    skill(body('Never do the first thing', 'Never do a base thing'))
    const advanced = commit('on the base')
    g('update-ref', 'refs/remotes/origin/main', advanced)
    g('checkout', '-q', 'claude/fix-1')

    const r = resolveBaseRef('main', { root: dir, onWarn() {} })
    assert.equal(r.resolved, advanced)
    assert.equal(r.branchPoint, branchPoint)
    assert.equal(r.baseline, branchPoint)
    assert.equal(g('rev-parse', 'HEAD'), head)
  } finally {
    cleanup(dir)
  }
})

test('a ref with a slash, and a sha, are taken as given', () => {
  const { dir, g, skill, commit } = repo()
  try {
    skill(body('Never do the first thing'))
    const first = commit('first')
    g('update-ref', 'refs/remotes/origin/main', first)

    const warnings = []
    const slashed = resolveBaseRef('origin/main', { root: dir, onWarn: (m) => warnings.push(m) })
    assert.equal(slashed.named, 'origin/main')

    const sha = resolveBaseRef(first, { root: dir, onWarn: (m) => warnings.push(m) })
    assert.equal(sha.named, first)
    assert.deepEqual(warnings, [])
  } finally {
    cleanup(dir)
  }
})

test('a base ref that does not resolve throws, rather than reading as empty', () => {
  const { dir, skill, commit } = repo()
  try {
    skill(body('Never do the first thing'))
    commit('first')
    assert.throws(() => resolveBaseRef('no-such-ref', { root: dir }), BaseRefError)
    assert.throws(() => resolveBaseRef('', { root: dir }), BaseRefError)
  } finally {
    cleanup(dir)
  }
})

// ------------------------------------------------- the three CLI readers

const cliCases = [
  { script: 'rule-delta.mjs', args: ['--base', 'no-such-ref', 'skills'] },
  { script: 'comment-lint.mjs', args: ['--base', 'no-such-ref'] },
  { script: 'comment-fingerprint.mjs', args: ['--base', 'no-such-ref'] },
]

for (const { script, args } of cliCases) {
  test(`${script} fails on an unresolvable base with one message`, () => {
    const { dir, skill, commit } = repo()
    try {
      skill(body('Never do the first thing'))
      commit('first')
      const r = spawnSync(process.execPath, [join(lib, script), ...args], {
        cwd: dir,
        encoding: 'utf8',
      })

      assert.notEqual(r.status, 0, `${script} exited 0`)
      const out = `${r.stdout}${r.stderr}`
      assert.doesNotMatch(out, /No directive disappeared/)
      assert.doesNotMatch(out, /at \S+ \(/, 'printed a stack trace')
      assert.equal(r.stderr.trim().split('\n').length, 1)
      assert.match(r.stderr, /does not resolve to a commit/)
    } finally {
      cleanup(dir)
    }
  })
}

test('rule-delta reports a clean delta on a clean tree whose local main is stale', () => {
  const { dir, g, skill, commit } = repo()
  try {
    skill(body('Never do the first thing'))
    const first = commit('first')
    skill(body('Never do the first thing', 'Never do the second thing'))
    const second = commit('second')

    g('update-ref', 'refs/remotes/origin/main', second)
    g('update-ref', 'refs/heads/main', first)
    g('checkout', '-q', '-b', 'claude/fix-1', second)

    const r = spawnSync(process.execPath, [join(lib, 'rule-delta.mjs'), '--base', 'main', 'skills'], {
      cwd: dir,
      encoding: 'utf8',
    })

    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /No directive disappeared/)
    assert.doesNotMatch(r.stdout, /ADDED/)
    assert.match(r.stderr, /Comparing against origin\/main/)
  } finally {
    cleanup(dir)
  }
})
