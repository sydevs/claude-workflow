// node --test workflow/lib/base-ref.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveBaseRef, repoRoot, BaseRefError } from './base-ref.mjs'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const lib = dirname(fileURLToPath(import.meta.url))

/** One directive per line, in the bold form `rule-delta.mjs` recognises. */
const body = (...rules) => rules.map((r) => `- **${r}**\n`).join('')

/**
 * A throwaway repo.
 *
 * ## Fixture pre-mortem
 *
 * This fixture assumes nothing about any sydevs repo. It asserts against git's
 * own behaviour, built here commit by commit, which is why `stale()` below
 * writes the stale ref with `update-ref` rather than mocking it: `git
 * merge-base main HEAD` returning the stale commit is the exact property that
 * makes merge-base alone insufficient, and a mock would let that property be
 * assumed instead of shown. The one real-world fact it leans on is that
 * `origin` is the remote name, which `start-run` step 6 (`git remote set-head
 * origin …`) settles too.
 *
 * `maintenance.auto` is off because git otherwise forks a `git maintenance
 * run` per commit, in repos deleted a second later.
 */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'base-ref-'))
  const g = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'bot@example.invalid',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'bot@example.invalid',
      },
    }).trim()

  g('init', '-q', '-b', 'main', '--template=')
  g('config', 'maintenance.auto', 'false')

  const skill = (text) => {
    mkdirSync(join(dir, 'skills', 'one'), { recursive: true })
    writeFileSync(join(dir, 'skills', 'one', 'SKILL.md'), text)
  }
  const commit = (message) => {
    g('add', '-A')
    g('commit', '-q', '--no-gpg-sign', '-m', message)
    return g('rev-parse', 'HEAD')
  }

  return { dir, g, skill, commit }
}

/**
 * The shape a routine clone actually has: HEAD on a `claude/*` branch,
 * `refs/remotes/origin/main` current at `second`, and `refs/heads/main` left
 * at `first` where the clone was seeded.
 */
function stale() {
  const r = repo()
  r.skill(body('Never do the first thing'))
  const first = r.commit('first')
  r.skill(body('Never do the first thing', 'Never do the second thing'))
  const second = r.commit('second')

  r.g('update-ref', 'refs/remotes/origin/main', second)
  r.g('update-ref', 'refs/heads/main', first)
  r.g('checkout', '-q', '-b', 'claude/fix-1', second)
  return { ...r, first, second }
}

/** One commit, with `refs/heads/main` and `refs/remotes/origin/main` agreeing. */
function synced() {
  const r = repo()
  r.skill(body('Never do the first thing'))
  const first = r.commit('first')
  r.g('update-ref', 'refs/remotes/origin/main', first)
  return { ...r, first }
}

const cleanup = (dir) => rmSync(dir, { recursive: true, force: true })

test('a bare name prefers origin/<name> and warns when the local ref differs', () => {
  const { dir, g, second } = stale()
  try {
    const warnings = []
    const r = resolveBaseRef('main', { root: dir, onWarn: (m) => warnings.push(m) })

    assert.equal(r.named, 'refs/remotes/origin/main')
    assert.equal(r.baseline, second)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /local main is \w{7} and origin\/main is \w{7}/)

    // The property that makes resolution, not merge-base, the fix: the stale
    // ref is an ancestor of HEAD, so merge-base alone returns it unchanged.
    assert.equal(g('merge-base', 'refs/heads/main', 'HEAD'), g('rev-parse', 'refs/heads/main'))
  } finally {
    cleanup(dir)
  }
})

test('a local ref that agrees with its remote counterpart warns nothing', () => {
  const { dir, first } = synced()
  try {
    const warnings = []
    const r = resolveBaseRef('main', { root: dir, onWarn: (m) => warnings.push(m) })

    assert.deepEqual(warnings, [])
    assert.equal(r.baseline, first)
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
  const { dir, first } = synced()
  try {
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

/**
 * `start-run` step 6 creates `refs/remotes/origin/HEAD` in every routine
 * clone, so a pseudoref that fell through the bare-name branch resolved to the
 * default branch instead of itself — silently, because `refs/heads/HEAD` does
 * not exist for the divergence warning to compare against.
 */
test('HEAD means HEAD, not origin/HEAD', () => {
  const { dir, g, skill, commit, second } = stale()
  try {
    g('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    skill(body('Never do the first thing', 'Never do a third thing'))
    const head = commit('on the branch')
    assert.notEqual(head, second, 'the fixture must put HEAD past origin/main')

    const warnings = []
    const r = resolveBaseRef('HEAD', { root: dir, onWarn: (m) => warnings.push(m) })

    assert.equal(r.named, 'HEAD')
    assert.equal(r.baseline, head)
    assert.deepEqual(warnings, [])
  } finally {
    cleanup(dir)
  }
})

test('a base ref that does not resolve throws, rather than reading as empty', () => {
  const { dir } = synced()
  try {
    assert.throws(() => resolveBaseRef('no-such-ref', { root: dir }), BaseRefError)
    assert.throws(() => resolveBaseRef('', { root: dir }), BaseRefError)
    assert.throws(() => resolveBaseRef('--json', { root: dir }), BaseRefError)
  } finally {
    cleanup(dir)
  }
})

test('repoRoot answers the worktree root from a subdirectory', () => {
  const { dir, g } = synced()
  try {
    const top = g('rev-parse', '--show-toplevel')
    assert.equal(repoRoot(join(dir, 'skills', 'one')), top)
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
    const { dir } = synced()
    try {
      const r = spawnSync(process.execPath, [join(lib, script), ...args], {
        cwd: dir,
        encoding: 'utf8',
      })

      assert.notEqual(r.status, 0, `${script} exited 0`)
      assert.equal(r.stderr.trim().split('\n').length, 1)
      assert.match(r.stderr, /does not resolve to a commit/)
    } finally {
      cleanup(dir)
    }
  })
}

/**
 * Outside a worktree, the two comment readers hand-rolled `git rev-parse
 * --show-toplevel` and threw an uncaught stack — the one failure mode this
 * module exists to remove. `repoRoot()` falls back to the cwd instead, the
 * base ref then fails to resolve, and all three reach the same one message.
 */
for (const { script, args } of cliCases) {
  test(`${script} outside a worktree gives one message, not a stack`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'base-ref-nogit-'))
    try {
      const r = spawnSync(process.execPath, [join(lib, script), ...args], {
        cwd: dir,
        encoding: 'utf8',
      })

      assert.equal(r.status, 2, r.stdout + r.stderr)
      assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr)
      assert.doesNotMatch(r.stderr, /fatal:/)
    } finally {
      cleanup(dir)
    }
  })
}

test('rule-delta reports a clean delta on a clean tree whose local main is stale', () => {
  const { dir } = stale()
  try {
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

test('rule-delta never reports an unresolvable base as a clean delta', () => {
  const { dir } = synced()
  try {
    const r = spawnSync(
      process.execPath,
      [join(lib, 'rule-delta.mjs'), '--base', 'no-such-ref', 'skills'],
      { cwd: dir, encoding: 'utf8' },
    )
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /No directive disappeared/)
  } finally {
    cleanup(dir)
  }
})

/**
 * `git show <rev>:<path>` is root-relative and `mdFiles` is cwd-relative, so
 * from a subdirectory every read failed and the swallowing `catch` turned the
 * empty before-set into `No directive disappeared.` at exit 0 — the silent
 * all-clear this module exists to end, reached by a second route.
 */
test('rule-delta reads the base from a subdirectory, not an empty set', () => {
  const { dir } = stale()
  try {
    const r = spawnSync(process.execPath, [join(lib, 'rule-delta.mjs'), '--base', 'main', 'one'], {
      cwd: join(dir, 'skills'),
      encoding: 'utf8',
    })

    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /directives: 2 → 2/)
    assert.doesNotMatch(r.stdout, /ADDED/)
    assert.doesNotMatch(r.stderr, /fatal:/)
  } finally {
    cleanup(dir)
  }
})
