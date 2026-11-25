#!/usr/bin/env node
/**
 * End-of-session cleanup for a local Claude Code session.
 *
 *   cleanup.mjs scan                           JSON report, changes nothing
 *   cleanup.mjs stop <pid>...                  stop servers this session started
 *   cleanup.mjs remove [--stale] <path>...     remove worktrees, with their branch and database
 *   cleanup.mjs prune                          dead dev-server state, `git worktree prune`
 *   cleanup.mjs drop-branch <repo> <branch>... delete local branches
 *   cleanup.mjs drop-db <repo> <name>...       drop isolated dev databases with no worktree
 *
 * Common flags: --session <id> (default $CLAUDE_CODE_SESSION_ID), --transcript <path>.
 *
 * Ownership is proved, never guessed, because several sessions share one
 * laptop (why: docs/why.md#cleanup-touches-only-its-own-session):
 *
 * - A server is this session's when its environment carries this
 *   session's `CLAUDE_CODE_SESSION_ID`.
 * - A worktree is this session's when the transcript names it and git
 *   registered it after the transcript began. `--stale` lifts that for an
 *   older one, but only under `.claude/worktrees/`.
 * - A change is this session's when the transcript holds its trace — the
 *   edited file's path, or the `[<branch> <sha>]` line `git commit` prints —
 *   or when it is newer than the session in a checkout the session worked in.
 * - Nothing is touched that a live session (`~/.claude/sessions/<pid>.json`)
 *   names, or that any process outside this command sits in.
 * - A commit is safe to lose locally when a remote branch or a PR head
 *   holds it. The skill fetches PR heads into `refs/cleanup/pull/*`: GitHub
 *   keeps them after a squash merge deletes the branch.
 *
 * `scan` is advisory. Every mutation re-derives those facts as it acts. The
 * script never talks to GitHub, and only ever deletes local branches.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flag } from '../../lib/config.mjs'

const DEV_SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'dev-server', 'dev-server.sh')
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const SAFE = ['--remotes', '--glob=refs/cleanup/pull/*']
const WORKTREES = `${sep}.claude${sep}worktrees${sep}`

// --- plumbing ----------------------------------------------------------------

/** Run a command. `out` is stdout on success; `err` says why not, ENOENT included. */
function attempt(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts })
  if (r.status === 0) return { out: r.stdout, err: null }
  return { out: null, err: (r.stderr || r.error?.message || `${cmd} exited ${r.status}`).trim() }
}
const run = (cmd, args, opts) => attempt(cmd, args, opts).out
// Only the trailing newline goes: porcelain lines can start with a space.
const git = (cwd, ...args) => run('git', args, { cwd })?.replace(/\n$/, '') ?? null
const lines = (s) => (s ? s.split('\n').filter(Boolean) : [])
const inside = (p, dir) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const alive = (pid) => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const fail = (msg) => {
  console.error(`cleanup: ${msg}`)
  process.exit(2)
}

/** The repo a path belongs to, as its main checkout's path. */
function repoOf(dir) {
  const common = git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  return common ? dirname(common) : null
}

// --- naming: does a transcript name this? --------------------------------------

const BEFORE = /[\w./-]/
const AFTER_PATH = /[\w.-]/ // a path may continue into the directory with `/`
const AFTER_NAME = /[\w./-]/

/**
 * Which needles some text names as a whole token, so `fix` is not named by
 * `fix-2`, nor `claude/a` by `claude/a-b`. One pass over each text however
 * many needles: live transcripts run to hundreds of megabytes.
 */
export function namedIn(texts, needles) {
  const want = [...new Set(needles.filter(Boolean))].sort((a, b) => b.length - a.length)
  const found = new Set()
  if (!want.length) return found
  const byLatin1 = new Map(want.map((n) => [Buffer.from(n, 'utf8').toString('latin1'), n]))
  // The lookahead finds overlapping candidates; the boundaries are checked by hand.
  const re = new RegExp(`(?=(${[...byLatin1.keys()].map(escapeRe).join('|')}))`, 'g')
  for (const text of texts) {
    re.lastIndex = 0
    for (let m; (m = re.exec(text)); re.lastIndex = m.index + 1) {
      for (const [latin, needle] of byLatin1) {
        if (found.has(needle) || !text.startsWith(latin, m.index)) continue
        const before = text[m.index - 1] ?? ''
        const after = text[m.index + latin.length] ?? ''
        const isPath = needle.startsWith(sep) || needle.startsWith('.')
        if (!BEFORE.test(before) && !(isPath ? AFTER_PATH : AFTER_NAME).test(after)) found.add(needle)
      }
      if (found.size === want.length) return found
    }
  }
  return found
}

/** The two ways a transcript names a worktree: its path, or `.claude/worktrees/<name>`. */
const worktreeNeedles = (path) => {
  const i = path.indexOf(WORKTREES)
  return i === -1 ? [path] : [path, path.slice(i + 1)]
}

// --- transcripts and sessions --------------------------------------------------

function findTranscript(id) {
  const projects = join(CONFIG_DIR, 'projects')
  for (const d of existsSync(projects) ? readdirSync(projects) : []) {
    const p = join(projects, d, `${id}.jsonl`)
    if (existsSync(p)) return p
  }
  return null
}

/** A transcript and its subagents' — a subagent's worktree is named only in its own. */
function transcriptFiles(transcript) {
  const files = [transcript]
  const sub = join(transcript.replace(/\.jsonl$/, ''), 'subagents')
  if (existsSync(sub)) for (const f of readdirSync(sub)) if (f.endsWith('.jsonl')) files.push(join(sub, f))
  return files
}

function loadSession(argv) {
  const id = flag(argv, 'session') ?? process.env.CLAUDE_CODE_SESSION_ID
  if (!id) fail('no session id — pass --session or run inside Claude Code')
  const transcript = flag(argv, 'transcript') ?? findTranscript(id)
  if (!transcript || !existsSync(transcript)) fail(`no transcript for session ${id}`)
  const texts = transcriptFiles(transcript).map((f) => readFileSync(f, 'latin1'))
  let startedAt = Infinity
  const cwds = new Set()
  for (const line of texts.flatMap(lines)) {
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (rec.timestamp) startedAt = Math.min(startedAt, Date.parse(rec.timestamp))
    if (typeof rec.cwd === 'string') cwds.add(rec.cwd)
  }
  if (!Number.isFinite(startedAt)) fail(`transcript ${transcript} has no timestamps`)
  return { id, transcript, startedAt, cwds: [...cwds], texts }
}

/**
 * Every other session running now: its cwd, and its transcripts, read once
 * and only when asked. A session with no transcript yet has named nothing.
 */
function otherSessions(selfId) {
  const dir = join(CONFIG_DIR, 'sessions')
  const sessions = []
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!f.endsWith('.json')) continue
    let rec
    try {
      rec = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    } catch {
      continue
    }
    if (rec.sessionId && rec.sessionId !== selfId && alive(rec.pid)) sessions.push({ pid: rec.pid, id: rec.sessionId, cwd: rec.cwd ?? null })
  }
  let texts = null
  return {
    /** The needles any of them names. */
    naming(needles) {
      texts ??= sessions.flatMap((s) => {
        const t = findTranscript(s.id)
        return t ? transcriptFiles(t).map((f) => readFileSync(f, 'latin1')) : []
      })
      return namedIn(texts, needles)
    },
    /** Pids of the sessions whose cwd sits inside `path`. */
    within: (path) => sessions.filter((s) => s.cwd && inside(s.cwd, path)).map((s) => s.pid),
  }
}

// --- processes -----------------------------------------------------------------

function processEnv(pid) {
  if (existsSync(`/proc/${pid}/environ`)) {
    try {
      return readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')
    } catch {
      return []
    }
  }
  // macOS: `ps -E` appends the environment, for the caller's own processes only.
  return (run('ps', ['-wwE', '-o', 'command=', '-p', String(pid)]) ?? '').split(/\s+/)
}
const sessionOf = (pid) =>
  processEnv(pid)
    .find((e) => e.startsWith('CLAUDE_CODE_SESSION_ID='))
    ?.slice('CLAUDE_CODE_SESSION_ID='.length) ?? null
const parentOf = (pid) => Number(run('ps', ['-o', 'ppid=', '-p', String(pid)])?.trim()) || null
const commandOf = (pid) => run('ps', ['-ww', '-o', 'command=', '-p', String(pid)])?.trim() ?? ''

/** `lsof -F pn` as [pid, name] pairs. */
function lsof(...args) {
  const out = []
  let pid = null
  for (const l of lines(run('lsof', [...args, '-Fpn']))) {
    if (l[0] === 'p') pid = Number(l.slice(1))
    else if (l[0] === 'n' && pid) out.push([pid, l.slice(1)])
  }
  return out
}

function listeners() {
  const ports = new Map()
  for (const [pid, name] of lsof('-nP', '-iTCP', '-sTCP:LISTEN')) {
    if (!ports.has(pid)) ports.set(pid, new Set())
    ports.get(pid).add(Number(name.slice(name.lastIndexOf(':') + 1)))
  }
  const pids = [...ports.keys()]
  const cwds = new Map(pids.length ? lsof('-a', '-d', 'cwd', '-p', pids.join(',')) : [])
  return pids.map((pid) => ({ pid, ports: [...ports.get(pid)].sort((a, b) => a - b), cwd: cwds.get(pid) ?? null }))
}

/** This command and the shells above it, which stand in the worktree they act on. */
function ownAncestry() {
  const own = new Set()
  for (let p = process.pid; p && p > 1 && !own.has(p); p = parentOf(p)) own.add(p)
  return own
}

/** The listener plus its ancestors that belong to this session, below Claude itself. */
function sessionTree(pid, sessionId) {
  const claude = Number(process.env.CLAUDE_PID) || null
  const tree = [pid]
  for (let p = parentOf(pid); p && p > 1 && p !== claude && sessionOf(p) === sessionId; p = parentOf(p)) tree.push(p)
  return tree
}

// --- repos, worktrees, branches ------------------------------------------------

/**
 * Every repo the session worked in: each cwd's own repo, plus the git repos
 * directly under a cwd that is not one — a multi-root workspace.
 */
function discoverRepos(session) {
  const repos = new Set()
  for (const cwd of session.cwds) {
    if (!existsSync(cwd)) continue
    const own = repoOf(cwd)
    if (own) repos.add(own)
    else
      for (const d of readdirSync(cwd, { withFileTypes: true }))
        if (d.isDirectory() && existsSync(join(cwd, d.name, '.git'))) repos.add(repoOf(join(cwd, d.name)))
  }
  return [...repos].filter(Boolean).sort()
}

function listWorktrees(repo) {
  const out = []
  let cur = null
  for (const line of lines(git(repo, 'worktree', 'list', '--porcelain'))) {
    const [key, ...rest] = line.split(' ')
    const val = rest.join(' ')
    if (key === 'worktree') out.push((cur = { path: val, repo, main: out.length === 0, locked: false }))
    else if (key === 'branch') cur.branch = val.replace(/^refs\/heads\//, '')
    else if (key === 'HEAD') cur.head = val
    else if (key === 'locked') cur.locked = val || true
    else if (key === 'prunable') cur.prunable = true
  }
  return out
}

/** When git registered a linked worktree: the birth of its admin directory. */
function registeredAt(wt) {
  if (wt.main) return null
  try {
    const admin = readFileSync(join(wt.path, '.git'), 'utf8').match(/^gitdir: (.*)$/m)?.[1]
    const s = statSync(resolve(wt.path, admin))
    return s.birthtimeMs || s.ctimeMs
  } catch {
    return null
  }
}

/** `owner/name` of origin on GitHub, for `gh --repo`. */
const remoteSlug = (repo) =>
  git(repo, 'remote', 'get-url', 'origin')?.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null

const defaultBranch = (repo) =>
  git(repo, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD')?.replace(/^origin\//, '') ?? 'main'

/** Local branches, each with whether deleting it would lose a commit. One rev-list per repo. */
function localBranches(repo, worktrees) {
  const unsafe = new Set(lines(git(repo, 'rev-list', '--branches', '--not', ...SAFE)))
  const base = defaultBranch(repo)
  return lines(git(repo, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads')).map((l) => {
    const [branch, head] = l.split(' ')
    return {
      repo,
      branch,
      head,
      isDefault: branch === base,
      checkedOut: worktrees.some((w) => w.branch === branch),
      // A tip no safe ref reaches exists only here, whatever its ancestors.
      unsafe: unsafe.has(head),
    }
  })
}

/** Why a local branch may not be deleted now, or null when it may. */
export function branchBlocker(b) {
  if (b.isDefault) return 'default branch'
  if (b.checkedOut) return 'checked out in a worktree'
  if (b.unsafe) return 'commits on no remote branch or PR'
  return null
}

/**
 * Everything that would be lost or forgotten if this checkout went away,
 * each change marked with whether this session made it.
 */
function inspectCheckout(session, wt) {
  const since = session.startedAt
  const workedHere = session.cwds.some((c) => inside(c, wt.path))
  const at = registeredAt(wt)
  const createdThisSession = at !== null && at >= since && namedIn(session.texts, worktreeNeedles(wt.path)).size > 0

  const entries = (git(wt.path, 'status', '--porcelain=v1', '-z', '--untracked-files=all') ?? '').split('\0')
  const dirty = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (!e) continue
    if (e[0] === 'R' || e[0] === 'C') i++ // -z puts a rename's old path next
    const file = join(wt.path, e.slice(3))
    const mtime = statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? null
    dirty.push({ status: e.slice(0, 2), file: e.slice(3), path: file, recent: mtime === null || mtime >= since })
  }
  const named = namedIn(session.texts, dirty.filter((d) => d.recent).map((d) => d.path))
  const changes = dirty.map(({ status, file, path, recent }) => ({ status, file, session: recent && (workedHere || named.has(path)) }))

  const branch = wt.branch ?? null
  const unpushed = lines(git(wt.path, 'log', '--format=%H %ct %s', 'HEAD', '--not', ...SAFE)).map((l) => {
    const [sha, ct, ...subject] = l.split(' ')
    // One text at a time: joining hundreds of megabytes throws RangeError.
    const re = branch && new RegExp(`\\[${escapeRe(branch)}( \\(root-commit\\))? ${sha.slice(0, 7)}`)
    const printed = re && session.texts.some((t) => re.test(t))
    return { sha, subject: subject.join(' '), session: Number(ct) * 1000 >= since && (workedHere || Boolean(printed)) }
  })
  return { path: wt.path, repo: wt.repo, main: wt.main, locked: wt.locked, branch, head: wt.head, createdThisSession, dirty: changes, unpushed }
}

/** Why a worktree may not be removed now, or null when it may. */
export function removalBlocker(info, { stale = false } = {}) {
  if (info.main) return 'main checkout'
  if (!info.createdThisSession && !stale) return 'not created by this session'
  if (!info.createdThisSession && !info.path.includes(WORKTREES)) return 'not under .claude/worktrees — remove it by hand'
  if (info.locked) return `locked${typeof info.locked === 'string' ? `: ${info.locked}` : ''}`
  if (info.dirty.length) return `${info.dirty.length} uncommitted or untracked file(s)`
  if (info.unpushed.length) return `${info.unpushed.length} commit(s) on no remote branch or PR`
  return null
}

// --- dev-server state, owned by dev-server.sh ------------------------------------

/** dev-server.sh's own answer for a worktree: slug, state dir, database. Null where unconfigured. */
function devServerInfo(path) {
  try {
    return JSON.parse(run('bash', [DEV_SERVER, 'info'], { cwd: path }) ?? 'null')
  } catch {
    return null
  }
}

/**
 * Isolated databases that no registered worktree owns. `infos[0]` is the
 * main checkout's: the template comes from it alone, never from a branch's
 * worktree, and needs a literal prefix — `{slug}` alone would match every
 * database on the machine.
 */
function orphanDatabases(infos) {
  const [pre, post] = infos[0]?.databaseTemplate?.split('{slug}') ?? []
  if (!pre) return []
  const owned = new Set(infos.map((i) => i?.database))
  return lines(run('psql', ['-lqtA', '-F', '|']))
    .map((l) => l.split('|')[0])
    .filter((n) => !owned.has(n) && n.startsWith(pre) && n.endsWith(post))
}

/**
 * State files no running server needs. The state directory is shared by
 * every repo on the laptop, so a slug's files stay while its process lives,
 * and a live worktree keeps its log.
 */
function staleStateFiles(infos) {
  const live = new Set(infos.map((i) => i.slug))
  const out = []
  for (const dir of new Set(infos.map((i) => i.stateDir))) {
    const groups = new Map()
    for (const f of existsSync(dir) ? readdirSync(dir) : []) {
      const [, slug, ext] = f.match(/^(.*)\.(json|pid|log)$/) ?? []
      if (slug) groups.set(slug, { ...groups.get(slug), [ext]: join(dir, f) })
    }
    for (const [slug, g] of groups) {
      // The json holds the pid, old script and new alike. A surviving .pid is
      // a crashed start's leftover whose number may now belong to anything,
      // so trusting it would keep dead state forever.
      let pid = null
      try {
        if (g.json) pid = JSON.parse(readFileSync(g.json, 'utf8')).pid
      } catch {
        pid = null
      }
      if (alive(pid)) continue
      out.push(...[g.json, g.pid, live.has(slug) ? null : g.log].filter(Boolean))
    }
  }
  return out
}

// --- commands --------------------------------------------------------------------

function scan(argv) {
  const session = loadSession(argv)
  const repos = discoverRepos(session)
  const worktrees = repos.flatMap(listWorktrees).filter((w) => !w.prunable && existsSync(w.path))

  const checkouts = []
  const olderWorktrees = []
  for (const wt of worktrees) {
    const info = inspectCheckout(session, wt)
    if (info.createdThisSession || info.dirty.some((d) => d.session) || info.unpushed.some((c) => c.session)) {
      const point = info.branch ? git(wt.path, 'merge-base', `origin/${defaultBranch(wt.repo)}`, 'HEAD') : null
      checkouts.push({ ...info, remote: remoteSlug(wt.repo), changedFiles: point ? lines(git(wt.path, 'diff', '--name-only', point, 'HEAD')) : [] })
    } else if (!wt.main) olderWorktrees.push({ path: wt.path, branch: info.branch })
  }

  const stashes = repos.flatMap((repo) =>
    lines(git(repo, 'stash', 'list', '--format=%H|%ct|%gd|%gs'))
      .map((l) => l.split('|'))
      .filter(([, ct]) => Number(ct) * 1000 >= session.startedAt)
      .map(([sha, , ref, subject]) => ({ repo, sha, ref, subject })),
  )

  const servers = []
  const otherServers = []
  for (const l of listeners()) {
    const owner = sessionOf(l.pid)
    if (owner === session.id) servers.push({ ...l, command: commandOf(l.pid) })
    // A null session is a server started outside Claude: a terminal's.
    else if (l.cwd && worktrees.some((w) => inside(l.cwd, w.path))) otherServers.push({ ...l, session: owner })
  }

  const branches = repos.flatMap((r) => {
    const all = localBranches(r, worktrees.filter((w) => w.repo === r)).filter((b) => !b.isDefault && !b.checkedOut)
    // One pass per repo says which of them this session worked on.
    const mine = namedIn(session.texts, all.map((b) => b.branch))
    return all.map(({ repo, branch, head, unsafe }) => ({ repo, branch, head, unsafe, session: mine.has(branch) }))
  })
  const orphans = repos.flatMap((r) =>
    orphanDatabases(worktrees.filter((w) => w.repo === r).map((w) => devServerInfo(w.path))).map((name) => ({ repo: r, name })),
  )
  const report = { servers, checkouts, stashes, branches, olderWorktrees, orphanDatabases: orphans, otherServers }
  console.log(JSON.stringify(report, null, 2))
  return 0
}

function stop(argv) {
  const session = loadSession(argv)
  const pids = positionals(argv).map(Number)
  if (!pids.length || pids.some((p) => !Number.isInteger(p))) fail('stop needs pids')
  const trees = []
  for (const pid of pids) {
    if (!alive(pid)) console.log(`${pid}: already gone`)
    else if (sessionOf(pid) !== session.id) console.log(`${pid}: REFUSED — not started by this session`)
    else trees.push(sessionTree(pid, session.id))
  }
  // Signal every tree, then wait once: SIGTERM, and SIGKILL after 10 s.
  const all = trees.flat()
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    for (const p of all.filter(alive)) {
      try {
        process.kill(p, sig)
      } catch {}
    }
    for (let waited = 0; all.some(alive) && waited < 10_000; waited += 50) pause(50)
  }
  for (const tree of trees) console.log(alive(tree[0]) ? `${tree[0]}: STILL RUNNING` : `${tree[0]}: stopped (${tree.join(' ')})`)
  return pids.length - trees.length
}

/** Positional arguments: everything that is not a flag or a flag's value. */
function positionals(argv) {
  const valued = new Set(['--session', '--transcript'])
  return argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !valued.has(all[i - 1]))
}

/** Act unless blocked, and print the outcome. Returns 1 when the thing was kept. */
function settle(label, blocker, act, done) {
  const kept = blocker ?? act()
  console.log(kept ? `${label}: KEPT — ${kept}` : `${label}: ${done}`)
  return kept ? 1 : 0
}

const NAMED = 'a live session names it'

function remove(argv) {
  const session = loadSession(argv)
  const stale = argv.includes('--stale')
  const paths = positionals(argv).map((p) => resolve(p))
  if (!paths.length) fail('remove needs at least one worktree path')
  const others = otherSessions(session.id)
  const own = ownAncestry()
  const cwds = lsof('-d', 'cwd').filter(([pid]) => !own.has(pid))
  let kept = 0
  for (const path of paths) {
    const repo = repoOf(path)
    const wt = repo && listWorktrees(repo).find((w) => w.path === path)
    if (!wt) {
      kept += settle(path, 'not a registered worktree')
      continue
    }
    const info = inspectCheckout(session, wt)
    const dev = devServerInfo(path)
    const holders = [...new Set([...cwds.filter(([, cwd]) => inside(cwd, path)).map(([pid]) => pid), ...others.within(path)])]
    const blocker =
      removalBlocker(info, { stale }) ??
      (others.naming([...worktreeNeedles(path), dev?.database]).size ? NAMED : null) ??
      (holders.length ? `a process still runs in it (pid ${holders.join(', ')})` : null)
    const removed = !settle(
      path,
      blocker,
      () => {
        // teardown drops the worktree's database and its server state, and
        // needs the worktree, so it cannot wait for the removal to succeed.
        const tornDown = dev && !attempt('bash', [DEV_SERVER, 'teardown'], { cwd: path }).err
        const err = attempt('git', ['worktree', 'remove', path], { cwd: repo }).err
        // Keeping the worktree does not bring the database back. Say so.
        return err && tornDown && dev.database ? `${err} (database ${dev.database} was already dropped)` : err
      },
      `removed${dev?.database ? `, database ${dev.database} dropped` : ''}`,
    )
    if (!removed) kept++
    if (!removed || !info.branch) continue
    const b = localBranches(repo, listWorktrees(repo)).find((x) => x.branch === info.branch)
    settle(
      `  branch ${info.branch}`,
      (b && branchBlocker(b)) ?? (others.naming([info.branch]).size ? NAMED : null),
      () => attempt('git', ['branch', '-D', info.branch], { cwd: repo }).err,
      'deleted',
    )
  }
  return kept
}

function prune(argv) {
  const session = loadSession(argv)
  const repos = discoverRepos(session)
  for (const repo of repos) {
    const gone = listWorktrees(repo).filter((w) => w.prunable).length
    git(repo, 'worktree', 'prune')
    if (gone) console.log(`${repo}: pruned ${gone} missing worktree record(s)`)
  }
  const infos = repos.flatMap(listWorktrees).map((w) => devServerInfo(w.path)).filter(Boolean)
  const stale = staleStateFiles(infos)
  for (const f of stale) rmSync(f, { force: true })
  console.log(`removed ${stale.length} stale dev-server state file(s)`)
  return 0
}

function dropBranch(argv) {
  const session = loadSession(argv)
  const [repo, ...names] = positionals(argv)
  if (!repo || !names.length) fail('drop-branch needs <repo> <branch>...')
  const root = resolve(repo)
  const all = localBranches(root, listWorktrees(root))
  const named = otherSessions(session.id).naming(names)
  let kept = 0
  for (const name of names) {
    const b = all.find((x) => x.branch === name)
    const blocker = !b ? 'no such branch' : (branchBlocker(b) ?? (named.has(name) ? NAMED : null))
    kept += settle(name, blocker, () => attempt('git', ['branch', '-D', name], { cwd: root }).err, `deleted (was ${b?.head.slice(0, 12)})`)
  }
  return kept
}

function dropDb(argv) {
  const session = loadSession(argv)
  const [repo, ...names] = positionals(argv)
  if (!repo || !names.length) fail('drop-db needs <repo> <name>...')
  const root = resolve(repo)
  const orphans = orphanDatabases(listWorktrees(root).map((w) => devServerInfo(w.path)))
  const named = otherSessions(session.id).naming(names)
  let kept = 0
  for (const name of names) {
    const blocker = !orphans.includes(name) ? `not an orphaned dev database of ${root}` : named.has(name) ? NAMED : null
    kept += settle(name, blocker, () => attempt('dropdb', ['--if-exists', name]).err, 'dropped')
  }
  return kept
}

const COMMANDS = { scan, stop, remove, prune, 'drop-branch': dropBranch, 'drop-db': dropDb }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const cmd = COMMANDS[argv[0]]
  if (!cmd) fail(`usage: cleanup.mjs ${Object.keys(COMMANDS).join('|')} …`)
  process.exitCode = cmd(argv) ? 1 : 0
}
