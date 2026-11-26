// node --test workflow/lib/cleanup.test.mjs
//
// cleanup.mjs deletes worktrees and branches, so the cases that matter are
// the refusals. Each case runs the real script against throwaway repos and a
// fake transcript. What it may remove is decided by the stamps
// hooks/stamp-ownership.mjs writes, never by what a transcript names.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isOwnDatabase, namedIn, ownerOf, removalBlocker } from '../skills/cleanup/cleanup.mjs'
import { stampBranch as writeBranchStamp, stampWorktree as writeWorktreeStamp } from './stamps.mjs'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'cleanup', 'cleanup.mjs')
const SESSION = 'test-session-0000'
const LIVE = 'other-live-session'

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
  return cleanupIn(repo, ...args)
}
function cleanupIn(cwd, ...args) {
  return spawnSync('node', [script, ...args, '--session', SESSION, '--transcript', transcript], {
    cwd,
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

/** Stamp a worktree as the hook does, by default as this session's. */
function stampWorktree(dir, id = SESSION) {
  writeWorktreeStamp(dir, id)
  return dir
}
const stampBranch = (branch, id = SESSION) => writeBranchStamp(repo, branch, id)

/** Register a live session, as Claude Code does, whose transcript says `says`. */
function liveSession(t, says = 'nothing') {
  const id = LIVE
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
  // As every sydevs repo does: the worktrees are not the main checkout's files.
  writeFileSync(join(repo, '.git', 'info', 'exclude'), '.claude/\n')
  git(repo, 'checkout', '-q', '-b', 'main')
  commit(repo, 'README')
  git(repo, 'push', '-q', 'origin', 'main')
  transcript = join(tmp, `${SESSION}.jsonl`)
})

after(() => rmSync(tmp, { recursive: true, force: true }))

test('namedIn matches whole paths, never a prefix of a longer one', () => {
  const text = 'Edit /r/src/a.tsx and /r/wt-2/b.ts'
  const found = namedIn([text], ['/r/src/a.ts', '/r/src/a.tsx', '/r/wt/b.ts', '/r/wt-2/b.ts'])
  assert.deepEqual([...found].sort(), ['/r/src/a.tsx', '/r/wt-2/b.ts'])
  assert.ok(namedIn(['"/r/wt/src/x.ts"'], ['/r/wt']).has('/r/wt'), 'a path continues into its directory')
  // Two needles can start at one index, and both are named there.
  assert.deepEqual([...namedIn(['cd /r/wt/src/x.ts'], ['/r/wt', '/r/wt/src'])].sort(), ['/r/wt', '/r/wt/src'])
})

test('scan owns the worktree its stamp names, not one its transcript names', (t) => {
  const mine = stampWorktree(addWorktree('scan-mine'))
  const named = addWorktree('scan-named')
  stampWorktree(addWorktree('scan-live'), LIVE)
  writeTranscript(`git worktree add ${named}`)
  liveSession(t)
  const out = JSON.parse(cleanup('scan').stdout)
  assert.deepEqual(out.checkouts.filter((c) => c.owner === 'self').map((c) => c.path), [mine])
  assert.ok(out.orphanWorktrees.some((w) => w.path === named))
  // Another live session's worktree is counted, never printed into this transcript.
  assert.ok(!JSON.stringify(out).includes('scan-live'))
  assert.ok(out.live.worktrees >= 1)
})

test('a dirty file is the session’s only when the transcript holds its path', () => {
  const wt = addWorktree('dirty')
  writeFileSync(join(wt, 'edited.txt'), 'a\n')
  writeFileSync(join(wt, 'stranger.txt'), 'b\n')
  writeTranscript(`Write ${join(wt, 'edited.txt')}`)
  const c = JSON.parse(cleanup('scan').stdout).checkouts.find((x) => x.path === wt)
  assert.deepEqual(Object.fromEntries(c.dirty.map((d) => [d.file, d.session])), { 'edited.txt': true, 'stranger.txt': false })
})

test('remove keeps a dirty worktree, an unpushed one, and one it did not create', () => {
  const dirty = stampWorktree(addWorktree('keep-dirty'))
  writeFileSync(join(dirty, 'wip.txt'), 'wip\n')
  const unpushed = stampWorktree(addWorktree('keep-unpushed'))
  commit(unpushed, 'f.txt')
  const foreign = addWorktree('keep-foreign')
  writeTranscript(`worktrees ${foreign}`)

  const r = cleanup('remove', dirty, unpushed, foreign)
  assert.equal(r.status, 1)
  assert.match(r.stdout, /keep-dirty: KEPT — 1 uncommitted/)
  assert.match(r.stdout, /keep-unpushed: KEPT — 1 commit\(s\) on no remote branch or PR/)
  assert.match(r.stdout, /keep-foreign: KEPT — not created by this session/)
  for (const p of [dirty, unpushed, foreign]) assert.ok(existsSync(p))
})

test('remove deletes a clean, pushed worktree and its local branch, never the remote one', () => {
  const wt = stampWorktree(addWorktree('done'))
  commit(wt, 'g.txt')
  git(wt, 'push', '-q', 'origin', 'HEAD:claude/done')
  writeTranscript('session')

  const r = cleanup('remove', wt)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /branch claude\/done: deleted/)
  assert.ok(!existsSync(wt))
  assert.equal(git(repo, 'branch', '--list', 'claude/done'), '')
  assert.ok(git(repo, 'ls-remote', 'origin', 'claude/done'))
})

test('remove takes its own worktree though a live session’s transcript names it', (t) => {
  // The failure this replaced: each cleanup printed every worktree, so every
  // open session's transcript named every other session's.
  const wt = stampWorktree(addWorktree('printed-elsewhere'))
  writeTranscript('session')
  liveSession(t, `orphanWorktrees: ${wt} .claude/worktrees/printed-elsewhere claude/printed-elsewhere`)
  const r = cleanup('remove', wt)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(!existsSync(wt))
})

test('remove --orphans takes an orphan, never a live session’s worktree', (t) => {
  const older = addWorktree('older')
  const dead = stampWorktree(addWorktree('dead'), 'a-session-long-gone')
  const claimed = stampWorktree(addWorktree('claimed'), LIVE)
  writeTranscript('nothing about any of them')
  liveSession(t)

  assert.match(cleanup('remove', older).stdout, /KEPT — not created by this session/)
  const r = cleanup('remove', '--orphans', older, dead, claimed)
  assert.match(r.stdout, /older: removed/)
  assert.match(r.stdout, /dead: removed/)
  assert.match(r.stdout, /claimed: KEPT — another live session created it/)
  assert.ok(!existsSync(older) && !existsSync(dead))
  assert.ok(existsSync(claimed))
})

test('remove --orphans leaves a worktree outside .claude/worktrees to a person', () => {
  const handMade = addWorktree('hand-made', join(tmp, 'hand-made'))
  writeTranscript('session')
  assert.match(cleanup('remove', '--orphans', handMade).stdout, /KEPT — not under \.claude\/worktrees/)
  assert.ok(existsSync(handMade))
})

test('remove takes the worktree it runs in', () => {
  // The failure this replaced: its own `lsof`, started in the worktree, held it.
  const wt = stampWorktree(addWorktree('rooted'))
  writeTranscript('session')
  const r = cleanupIn(wt, 'remove', wt)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(!existsSync(wt))
})

test('remove keeps a worktree a process still runs in', (t) => {
  const wt = stampWorktree(addWorktree('held'))
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { cwd: wt, stdio: 'ignore' })
  t.after(() => child.kill())
  for (let i = 0; i < 100 && !spawnSync('lsof', ['-a', '-d', 'cwd', '-p', String(child.pid)]).stdout?.length; i++) pause(20)
  writeTranscript('session')
  assert.match(cleanup('remove', wt).stdout, new RegExp(`held: KEPT — a process still runs in it \\(pid ${child.pid}\\)`))
  assert.ok(existsSync(wt))
})
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

test('drop-branch deletes only a local branch with nothing to lose', (t) => {
  git(repo, 'branch', 'claude/pushed', 'origin/main')
  stampBranch('claude/pushed')
  git(repo, 'branch', 'claude/stranger', 'origin/main')
  git(repo, 'branch', 'claude/named', 'origin/main')
  stampBranch('claude/named', LIVE)
  git(repo, 'checkout', '-q', '-b', 'claude/local-only', 'origin/main')
  stampBranch('claude/local-only')
  commit(repo, 'h.txt')
  git(repo, 'checkout', '-q', 'main')
  writeTranscript('session')
  liveSession(t)

  const r = cleanup('drop-branch', repo, 'claude/pushed', 'claude/local-only', 'claude/named', 'claude/stranger', 'main')
  assert.match(r.stdout, /claude\/pushed: deleted/)
  assert.match(r.stdout, /claude\/local-only: KEPT — commits on no remote branch or PR/)
  assert.match(r.stdout, /claude\/named: KEPT — another live session created it/)
  assert.match(r.stdout, /claude\/stranger: KEPT — not created by this session/)
  assert.match(r.stdout, /main: KEPT — default branch/)
  assert.match(cleanup('drop-branch', '--orphans', repo, 'claude/stranger', 'claude/named').stdout, /claude\/stranger: deleted[\s\S]*claude\/named: KEPT/)
})

test('a commit a PR head holds is safe, though its remote branch is gone', () => {
  // A squash merge deletes the branch; GitHub keeps the PR's head ref.
  git(repo, 'checkout', '-q', '-b', 'claude/squashed', 'origin/main')
  stampBranch('claude/squashed')
  commit(repo, 's.txt')
  git(repo, 'checkout', '-q', 'main')
  writeTranscript('session')
  assert.match(cleanup('drop-branch', repo, 'claude/squashed').stdout, /KEPT — commits on no remote/)
  git(repo, 'update-ref', 'refs/cleanup/pull/7', 'claude/squashed')
  assert.match(cleanup('drop-branch', repo, 'claude/squashed').stdout, /claude\/squashed: deleted/)
})

test('scan lists loose branches by owner, and only counts a live session’s', (t) => {
  git(repo, 'branch', 'claude/scan-b-mine', 'origin/main')
  stampBranch('claude/scan-b-mine')
  git(repo, 'branch', 'claude/scan-b-orphan', 'origin/main')
  git(repo, 'branch', 'claude/scan-b-live', 'origin/main')
  stampBranch('claude/scan-b-live', LIVE)
  writeTranscript('git switch claude/scan-b-orphan')
  liveSession(t)
  const out = JSON.parse(cleanup('scan').stdout)
  const owner = (b) => out.branches.find((x) => x.branch === b)?.owner
  assert.equal(owner('claude/scan-b-mine'), 'self')
  assert.equal(owner('claude/scan-b-orphan'), 'orphan', 'a transcript naming a branch does not make it the session’s')
  assert.equal(owner('claude/scan-b-live'), undefined)
  assert.ok(out.live.branches >= 1)
})

test('stop refuses a process this session did not start', () => {
  const r = cleanup('stop', String(process.pid))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /REFUSED — not started by this session/)
})

test('isOwnDatabase trusts only a name the main checkout template shapes', () => {
  const t = 'sahajcloud_dev_{slug}'
  assert.ok(isOwnDatabase(t, 'sahajcloud_dev_wt_123'))
  assert.ok(!isOwnDatabase(t, 'production'))
  // A template with no literal prefix would match every database on the machine.
  assert.ok(!isOwnDatabase('{slug}', 'production'))
  assert.ok(!isOwnDatabase(null, 'sahajcloud_dev_wt_123'))
  assert.ok(!isOwnDatabase(t, null))
})

test('ownerOf: self, a live session, or an orphan', () => {
  const live = new Set(['b'])
  assert.equal(ownerOf('a', 'a', live), 'self')
  assert.equal(ownerOf('b', 'a', live), 'live')
  assert.equal(ownerOf('gone', 'a', live), 'orphan')
  assert.equal(ownerOf(null, 'a', live), 'orphan')
})

test('removalBlocker: --orphans excuses an orphan, never a live session’s', () => {
  const base = { path: '/r/.claude/worktrees/x', main: false, owner: 'orphan', locked: false, dirty: [], unpushed: [] }
  assert.match(removalBlocker(base), /not created by this session/)
  assert.equal(removalBlocker(base, { orphans: true }), null)
  assert.equal(removalBlocker({ ...base, owner: 'self' }), null)
  assert.match(removalBlocker({ ...base, owner: 'live' }, { orphans: true }), /another live session/)
  assert.match(removalBlocker({ ...base, unpushed: [{}] }, { orphans: true }), /no remote branch or PR/)
  assert.equal(removalBlocker({ ...base, main: true }, { orphans: true }), 'main checkout')
})
