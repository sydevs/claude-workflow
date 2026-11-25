// node --test workflow/lib/cleanup.test.mjs
//
// cleanup.mjs deletes worktrees and branches, so the cases that matter are
// the refusals. Each case runs the real script against throwaway repos and a
// fake transcript: what it may remove is decided by what that names.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { namedIn, removalBlocker } from '../skills/cleanup/cleanup.mjs'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'cleanup', 'cleanup.mjs')
const SESSION = 'test-session-0000'

let tmp, repo, transcript
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()

function writeTranscript(...mentions) {
  const start = new Date(Date.now() - 60_000).toISOString()
  const recs = [
    { type: 'user', timestamp: start, cwd: repo, message: { content: 'begin' } },
    ...mentions.map((m) => ({ type: 'assistant', timestamp: new Date().toISOString(), cwd: repo, message: { content: m } })),
  ]
  writeFileSync(transcript, recs.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

function cleanup(...args) {
  return spawnSync('node', [script, ...args, '--session', SESSION, '--transcript', transcript], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, XDG_STATE_HOME: join(tmp, 'state'), CLAUDE_CONFIG_DIR: join(tmp, 'claude'), CLAUDE_PID: '' },
  })
}

function addWorktree(name, dir = join(repo, '.claude', 'worktrees', name)) {
  git(repo, 'worktree', 'add', '-q', '-b', `claude/${name}`, dir, 'origin/main')
  return dir
}

function commit(dir, file) {
  writeFileSync(join(dir, file), `${file}\n`)
  git(dir, 'add', file)
  git(dir, 'commit', '-q', '-m', file)
}

/** Register a live session, as Claude Code does, whose transcript says `says`. */
function liveSession(t, says) {
  const id = 'other-live-session'
  mkdirSync(join(tmp, 'claude', 'sessions'), { recursive: true })
  mkdirSync(join(tmp, 'claude', 'projects', 'p'), { recursive: true })
  writeFileSync(join(tmp, 'claude', 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: id, cwd: tmp }))
  writeFileSync(join(tmp, 'claude', 'projects', 'p', `${id}.jsonl`), JSON.stringify({ message: says }) + '\n')
  t.after(() => rmSync(join(tmp, 'claude', 'sessions'), { recursive: true, force: true }))
}

before(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'cleanup-test-')))
  const origin = join(tmp, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
  repo = join(tmp, 'repo')
  execFileSync('git', ['clone', '-q', origin, repo], { stdio: 'ignore' })
  git(repo, 'config', 'user.email', 't@example.com')
  git(repo, 'config', 'user.name', 't')
  git(repo, 'checkout', '-q', '-b', 'main')
  commit(repo, 'README')
  git(repo, 'push', '-q', 'origin', 'main')
  transcript = join(tmp, `${SESSION}.jsonl`)
})

after(() => rmSync(tmp, { recursive: true, force: true }))

test('namedIn matches whole paths and names, never a prefix of a longer one', () => {
  const text = 'cd /r/.claude/worktrees/fix-2 && git switch claude/a-b'
  const found = namedIn([text], ['/r/.claude/worktrees/fix', '/r/.claude/worktrees/fix-2', 'claude/a', 'claude/a-b'])
  assert.deepEqual([...found].sort(), ['/r/.claude/worktrees/fix-2', 'claude/a-b'])
  assert.ok(namedIn(['"/r/wt/src/x.ts"'], ['/r/wt']).has('/r/wt'), 'a path continues into its directory')
  // Two needles can start at one index, and both are named there.
  assert.deepEqual([...namedIn(['cd /r/wt/src/x.ts'], ['/r/wt', '/r/wt/src'])].sort(), ['/r/wt', '/r/wt/src'])
})

test('scan claims a worktree the transcript names, and not its prefix-sharing neighbour', () => {
  const mine = addWorktree('mine-2')
  const theirs = addWorktree('mine')
  writeTranscript(`git worktree add ${mine}`)
  const out = JSON.parse(cleanup('scan').stdout)
  assert.deepEqual(
    out.checkouts.filter((c) => c.createdThisSession).map((c) => c.path),
    [mine],
  )
  assert.ok(out.olderWorktrees.some((w) => w.path === theirs))
})

test('a dirty file is the session’s only when the transcript holds its path', () => {
  const wt = addWorktree('dirty')
  writeFileSync(join(wt, 'edited.txt'), 'a\n')
  writeFileSync(join(wt, 'stranger.txt'), 'b\n')
  writeTranscript(`created ${wt}`, `Write ${join(wt, 'edited.txt')}`)
  const c = JSON.parse(cleanup('scan').stdout).checkouts.find((x) => x.path === wt)
  assert.deepEqual(Object.fromEntries(c.dirty.map((d) => [d.file, d.session])), { 'edited.txt': true, 'stranger.txt': false })
})

test('remove keeps a dirty worktree, an unpushed one, and one it did not create', () => {
  const dirty = addWorktree('keep-dirty')
  writeFileSync(join(dirty, 'wip.txt'), 'wip\n')
  const unpushed = addWorktree('keep-unpushed')
  commit(unpushed, 'f.txt')
  const foreign = addWorktree('keep-foreign')
  writeTranscript(`worktrees ${dirty} ${unpushed}`)

  const r = cleanup('remove', dirty, unpushed, foreign)
  assert.equal(r.status, 1)
  assert.match(r.stdout, /keep-dirty: KEPT — 1 uncommitted/)
  assert.match(r.stdout, /keep-unpushed: KEPT — 1 commit\(s\) on no remote branch or PR/)
  assert.match(r.stdout, /keep-foreign: KEPT — not created by this session/)
  for (const p of [dirty, unpushed, foreign]) assert.ok(existsSync(p))
})

test('remove deletes a clean, pushed worktree and its local branch, never the remote one', () => {
  const wt = addWorktree('done')
  commit(wt, 'g.txt')
  git(wt, 'push', '-q', 'origin', 'HEAD:claude/done')
  writeTranscript(`worktree ${wt}`)

  const r = cleanup('remove', wt)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /branch claude\/done: deleted/)
  assert.ok(!existsSync(wt))
  assert.equal(git(repo, 'branch', '--list', 'claude/done'), '')
  assert.ok(git(repo, 'ls-remote', 'origin', 'claude/done'))
})

test('remove --stale takes an older worktree, unless a live session names it', (t) => {
  const older = addWorktree('older')
  const claimed = addWorktree('claimed')
  writeTranscript('nothing about either')
  liveSession(t, 'working in .claude/worktrees/claimed')

  assert.match(cleanup('remove', older).stdout, /KEPT — not created by this session/)
  const r = cleanup('remove', '--stale', older, claimed)
  assert.match(r.stdout, /older: removed/)
  assert.match(r.stdout, /claimed: KEPT — a live session names it/)
  assert.ok(!existsSync(older))
  assert.ok(existsSync(claimed))
})

test('remove --stale leaves a worktree outside .claude/worktrees to a person', () => {
  const handMade = addWorktree('hand-made', join(tmp, 'hand-made'))
  writeTranscript('session')
  assert.match(cleanup('remove', '--stale', handMade).stdout, /KEPT — not under \.claude\/worktrees/)
  assert.ok(existsSync(handMade))
})

test('drop-branch deletes only a local branch with nothing to lose', (t) => {
  git(repo, 'branch', 'claude/pushed', 'origin/main')
  git(repo, 'branch', 'claude/named', 'origin/main')
  git(repo, 'checkout', '-q', '-b', 'claude/local-only', 'origin/main')
  commit(repo, 'h.txt')
  git(repo, 'checkout', '-q', 'main')
  writeTranscript('session')
  liveSession(t, 'git switch claude/named')

  const r = cleanup('drop-branch', repo, 'claude/pushed', 'claude/local-only', 'claude/named', 'main')
  assert.match(r.stdout, /claude\/pushed: deleted/)
  assert.match(r.stdout, /claude\/local-only: KEPT — commits on no remote branch or PR/)
  assert.match(r.stdout, /claude\/named: KEPT — a live session names it/)
  assert.match(r.stdout, /main: KEPT — default branch/)
})

test('a commit a PR head holds is safe, though its remote branch is gone', () => {
  // A squash merge deletes the branch; GitHub keeps the PR's head ref.
  git(repo, 'checkout', '-q', '-b', 'claude/squashed', 'origin/main')
  commit(repo, 's.txt')
  git(repo, 'checkout', '-q', 'main')
  writeTranscript('session')
  assert.match(cleanup('drop-branch', repo, 'claude/squashed').stdout, /KEPT — commits on no remote/)
  git(repo, 'update-ref', 'refs/cleanup/pull/7', 'claude/squashed')
  assert.match(cleanup('drop-branch', repo, 'claude/squashed').stdout, /claude\/squashed: deleted/)
})

test('scan marks the loose branches this session named', () => {
  git(repo, 'branch', 'claude/scan-mine', 'origin/main')
  git(repo, 'branch', 'claude/scan-theirs', 'origin/main')
  writeTranscript('git switch claude/scan-mine')
  const branches = JSON.parse(cleanup('scan').stdout).branches
  const mark = (b) => branches.find((x) => x.branch === b)?.session
  assert.equal(mark('claude/scan-mine'), true)
  assert.equal(mark('claude/scan-theirs'), false)
})

test('stop refuses a process this session did not start', () => {
  const r = cleanup('stop', String(process.pid))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /REFUSED — not started by this session/)
})

test('removalBlocker: --stale excuses only who created it', () => {
  const base = { path: '/r/.claude/worktrees/x', main: false, createdThisSession: false, locked: false, dirty: [], unpushed: [] }
  assert.equal(removalBlocker(base), 'not created by this session')
  assert.equal(removalBlocker(base, { stale: true }), null)
  assert.match(removalBlocker({ ...base, unpushed: [{}] }, { stale: true }), /no remote branch or PR/)
  assert.equal(removalBlocker({ ...base, main: true }, { stale: true }), 'main checkout')
})
