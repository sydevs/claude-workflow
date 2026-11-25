// node --test workflow/lib/hooks.test.mjs
//
// The hooks' contract is stdin JSON in, exit code and stdout out. Each case
// runs the real script as a child process against a throwaway git repo, so
// the tests see what Claude Code sees. A blocking hook that false-positives
// costs a working session (hooks/AGENTS.md), so the allowed shapes are
// tested as hard as the denied ones.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const hooks = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks')

let tmp, repo, sibling, plain

/** A git repo, optionally holding `.claude/workflow.json`. */
function makeRepo(name, config) {
  const dir = join(tmp, name)
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  if (config !== undefined) {
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude', 'workflow.json'), typeof config === 'string' ? config : JSON.stringify(config))
  }
  return dir
}

/** Run a hook script with `stdin` as its payload, inside `root`. */
function run(script, stdin, root = repo) {
  const r = spawnSync(process.execPath, [join(hooks, script)], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf-8',
  })
  return { code: r.status, out: r.stdout.trim() }
}

const bash = (command, root) => run('block-wrong-bash.mjs', { tool_input: { command } }, root)
const edit = (file_path, root) => run('block-generated-files.mjs', { tool_input: { file_path } }, root)

function assertDenied(r, reasonPattern) {
  assert.equal(r.code, 0, 'a denial still exits 0; the decision is in stdout')
  const o = JSON.parse(r.out).hookSpecificOutput
  assert.equal(o.hookEventName, 'PreToolUse')
  assert.equal(o.permissionDecision, 'deny')
  if (reasonPattern) assert.match(o.permissionDecisionReason, reasonPattern)
}

function assertAllowed(r) {
  assert.equal(r.code, 0)
  assert.equal(r.out, '', 'an allowed call prints nothing')
}

before(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hooks-test-')))
  repo = makeRepo('repo', {
    packageManager: 'pnpm',
    generatedFiles: [
      { pattern: '^src/payload-types\\.ts$', reason: 'Run `pnpm generate:types`.' },
      { pattern: '(', reason: 'a malformed pattern, which must be skipped' },
      { pattern: '^migrations/.*\\.json$', reason: 'Migration snapshots are generated.' },
    ],
  })
  sibling = makeRepo('sibling', {})
  plain = join(tmp, 'plain')
  mkdirSync(plain)
})

after(() => rmSync(tmp, { recursive: true, force: true }))

// --- block-wrong-bash -------------------------------------------------------

test('block-wrong-bash: wrong package manager is denied, and the right one is named', () => {
  const denied = [
    'npm install',
    'npm i left-pad',
    'npm run build',
    'yarn add react',
    'yarn test',
    'cd app && npm test',
    'pnpm build && npm ci',
    'echo hi; npm exec foo',
    'ls | npm run x',
  ]
  for (const command of denied) assertDenied(bash(command), /pnpm/)
})

test('block-wrong-bash: the named package manager comes from workflow.json', () => {
  const other = makeRepo('pm-bun', { packageManager: 'bun' })
  assertDenied(bash('npm install', other), /uses bun/)
  const none = makeRepo('pm-default')
  assertDenied(bash('yarn add x', none), /uses pnpm/)
})

test('block-wrong-bash: commands that only mention a package manager pass', () => {
  const allowed = [
    'pnpm install',
    'npm view left-pad version',
    'npm why left-pad',
    'echo "npm install is wrong"',
    'grep -r "yarn add" docs',
    'git commit -m "docs: npm install"',
    'node script.mjs',
    'npmrc-check',
    '',
  ]
  for (const command of allowed) assertAllowed(bash(command))
})

test('block-wrong-bash: git -C and cd-then-git are denied for the own repo', () => {
  const denied = [
    'git -C . status',
    `git -C ${repo} log`,
    `git -C ${join(repo, 'sub')} diff`,
    'git -C ../repo status',
    `cd ${repo} && git status`,
    'cd . && git status',
    'echo x && git -C . fetch',
    'ls; cd sub && git add .',
  ]
  for (const command of denied) assertDenied(bash(command), /already|git already/)
})

test('block-wrong-bash: git on a sibling repo, or a non-repo directory, is exempt', () => {
  const allowed = [
    `git -C ${sibling} status`,
    `cd ${sibling} && git status`,
    `git -C '${sibling}' log`,
    `git -C ${join(sibling, 'a-file.txt')} log`,
    `git -C ${plain} status`,
    `cd ${plain} && git status`,
  ]
  for (const command of allowed) assertAllowed(bash(command))
})

test('block-wrong-bash: a session rooted outside any repo treats every git target as a sibling', () => {
  assertAllowed(bash(`git -C ${repo} status`, plain))
  assertAllowed(bash(`cd ${sibling} && git status`, plain))
  // The package-manager rule does not depend on a repo.
  assertDenied(bash('npm install', plain), /pnpm/)
})

test('block-wrong-bash: no command, or unusable input, passes silently', () => {
  assertAllowed(run('block-wrong-bash.mjs', {}))
  assertAllowed(run('block-wrong-bash.mjs', { tool_input: {} }))
  assertAllowed(run('block-wrong-bash.mjs', 'not json'))
  assertAllowed(run('block-wrong-bash.mjs', ''))
})

// --- block-generated-files --------------------------------------------------

test('block-generated-files: a path matching a rule is denied with that rule reason', () => {
  assertDenied(edit(join(repo, 'src/payload-types.ts')), /generate:types/)
  assertDenied(edit('src/payload-types.ts'), /generate:types/)
  assertDenied(edit(join(repo, 'migrations/20260101_x.json')), /snapshots are generated/)
})

test('block-generated-files: other paths pass, including near misses', () => {
  for (const p of [
    join(repo, 'src/other.ts'),
    join(repo, 'src/payload-types.tsx'),
    join(repo, 'nested/src/payload-types.ts'),
    join(repo, 'migrations/20260101_x.ts'),
  ])
    assertAllowed(edit(p))
})

test('block-generated-files: a malformed pattern is skipped, not fatal', () => {
  // The "(" rule sits between two valid ones, and the later rule still applies.
  assertDenied(edit(join(repo, 'migrations/a.json')), /snapshots/)
})

test('block-generated-files: missing, empty or malformed config blocks nothing', () => {
  const missing = makeRepo('gf-missing')
  const empty = makeRepo('gf-empty', { generatedFiles: [] })
  const broken = makeRepo('gf-broken', '{ not json')
  for (const root of [missing, empty, broken]) assertAllowed(edit(join(root, 'src/payload-types.ts'), root))
})

test('block-generated-files: no file_path, or unusable input, passes silently', () => {
  assertAllowed(run('block-generated-files.mjs', {}))
  assertAllowed(run('block-generated-files.mjs', { tool_input: {} }))
  assertAllowed(run('block-generated-files.mjs', 'garbage'))
})

// --- prettier-format and eslint-fix -----------------------------------------

const SILENT = { continue: true, suppressOutput: true }

test('prettier-format and eslint-fix: a file they do not handle passes silently', () => {
  const cases = [
    ['prettier-format.mjs', 'README.md'],
    ['prettier-format.mjs', 'notes.txt'],
    ['prettier-format.mjs', ''],
    ['eslint-fix.mjs', 'styles.css'],
    ['eslint-fix.mjs', 'data.json'],
    ['eslint-fix.mjs', 'README.md'],
  ]
  for (const [script, file_path] of cases) {
    const r = run(script, { tool_input: { file_path } })
    assert.equal(r.code, 0, `${script} ${file_path}`)
    assert.deepEqual(JSON.parse(r.out), SILENT, `${script} ${file_path}`)
  }
})

test('prettier-format and eslint-fix: a missing tool never blocks an edit', () => {
  // A repo whose package manager is not installed: the formatter cannot run,
  // and a formatter is not a gate.
  const root = makeRepo('no-tools', { packageManager: 'definitely-not-a-package-manager' })
  const file = join(root, 'a.mjs')
  writeFileSync(file, 'export const x = 1\n')
  for (const script of ['prettier-format.mjs', 'eslint-fix.mjs']) {
    const r = run(script, { tool_input: { file_path: file } }, root)
    assert.equal(r.code, 0, script)
    assert.deepEqual(JSON.parse(r.out), SILENT, script)
  }
})

test('prettier-format and eslint-fix: unusable input passes silently', () => {
  for (const script of ['prettier-format.mjs', 'eslint-fix.mjs']) {
    for (const stdin of ['', 'not json', {}]) {
      const r = run(script, stdin)
      assert.equal(r.code, 0)
      assert.deepEqual(JSON.parse(r.out), SILENT)
    }
  }
})

// --- stamp-ownership --------------------------------------------------------

/** A repo with one commit, so a worktree can be added to it. */
function committedRepo(name) {
  const dir = makeRepo(name)
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: dir })
  return dir
}
const gitOut = (cwd, ...args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}
let callId = 0

/** Run the hook either side of `act`, as Claude Code does around one tool call. */
function aroundCall(tool, tool_input, cwd, act) {
  const payload = { session_id: 'stamp-session', tool_use_id: `toolu_${++callId}`, tool_name: tool, tool_input, cwd }
  const pre = run('stamp-ownership.mjs', { ...payload, hook_event_name: 'PreToolUse' }, cwd)
  act()
  const post = run('stamp-ownership.mjs', { ...payload, hook_event_name: 'PostToolUse' }, cwd)
  for (const r of [pre, post]) assertAllowed(r)
}
const branchStamp = (r, b) => gitOut(r, 'config', '--get', `branch.${b}.claudeSession`)
const worktreeStamp = (wt) => {
  try {
    return readFileSync(join(gitOut(wt, 'rev-parse', '--absolute-git-dir'), 'claude-session'), 'utf-8').trim()
  } catch {
    return null
  }
}

test('stamp-ownership: stamps the worktree and branch a call creates, from a workspace cwd', () => {
  const r = committedRepo('stamped')
  const command = 'cd stamped && git worktree add .claude/worktrees/fix -b claude/fix'
  aroundCall('Bash', { command }, tmp, () => {
    execFileSync('git', ['worktree', 'add', '-q', '.claude/worktrees/fix', '-b', 'claude/fix'], { cwd: r })
    // Another session's branch, made while this call ran: new, but not named.
    execFileSync('git', ['branch', 'claude/fix-2'], { cwd: r })
  })
  assert.equal(worktreeStamp(join(r, '.claude/worktrees/fix')), 'stamp-session')
  assert.equal(branchStamp(r, 'claude/fix'), 'stamp-session')
  assert.equal(branchStamp(r, 'claude/fix-2'), null)
})

test('stamp-ownership: EnterWorktree stamps the worktree it names, and its branch', () => {
  const r = committedRepo('entered')
  aroundCall('EnterWorktree', { name: 'ew' }, r, () => {
    execFileSync('git', ['worktree', 'add', '-q', '.claude/worktrees/ew', '-b', 'worktree-ew'], { cwd: r })
  })
  assert.equal(worktreeStamp(join(r, '.claude/worktrees/ew')), 'stamp-session')
  assert.equal(branchStamp(r, 'worktree-ew'), 'stamp-session')
})

test('stamp-ownership: an existing branch a call only names stays unstamped', () => {
  const r = committedRepo('existing')
  execFileSync('git', ['branch', 'claude/old'], { cwd: r })
  aroundCall('Bash', { command: 'git switch claude/old' }, r, () => execFileSync('git', ['switch', '-q', 'claude/old'], { cwd: r }))
  assert.equal(branchStamp(r, 'claude/old'), null)
})

test('stamp-ownership: unusable input, and a call outside any repo, pass silently', () => {
  for (const stdin of ['', 'not json', {}, { tool_name: 'Bash', tool_input: { command: 'git status' } }]) {
    assertAllowed(run('stamp-ownership.mjs', stdin))
  }
  aroundCall('Bash', { command: 'git init x' }, plain, () => {})
  // A post with no pre (the pre failed, or ran in an older plugin) does nothing.
  assertAllowed(run('stamp-ownership.mjs', { session_id: 's', tool_use_id: 'toolu_none', tool_name: 'Bash', tool_input: { command: 'git x' }, hook_event_name: 'PostToolUse', cwd: repo }))
})
