#!/usr/bin/env node
/**
 * End-of-session cleanup for a local Claude Code session.
 *
 *   cleanup.mjs scan                           JSON report, changes nothing
 *   cleanup.mjs stop <pid>...                  stop servers this session started
 *   cleanup.mjs remove [--orphans] <path>...   remove worktrees, with their branch and database
 *   cleanup.mjs prune                          dead dev-server state, `git worktree prune`
 *   cleanup.mjs drop-branch [--orphans] <repo> <branch>...  delete local branches
 *
 * Common flags: --session <id> (default $CLAUDE_CODE_SESSION_ID), --transcript <path>.
 *
 * Ownership is read from stamps, never guessed from what a transcript
 * mentions, because several sessions share one laptop and each one's cleanup
 * prints the others' names (why: docs/why.md#cleanup-touches-only-its-own-session):
 *
 * - A server is this session's when its environment carries this
 *   session's `CLAUDE_CODE_SESSION_ID`.
 * - A worktree or local branch belongs to the session that created it, as
 *   `hooks/stamp-ownership.mjs` stamped it. A stamp of this session's is
 *   `self`, of another live session's (`~/.claude/sessions/<pid>.json`) is
 *   `live`, and anything else — a dead session's, or no stamp — is an
 *   `orphan`. `--orphans` lets a mutation take orphans; a worktree only
 *   under `.claude/worktrees/`. Nothing `live` is ever touched.
 * - A change is this session's when it is in a worktree the session owns,
 *   or the transcript holds its trace — the edited file's path, or the
 *   `[<branch> <sha>]` line `git commit` prints — or it is newer than the
 *   session in a checkout the session worked in.
 * - Nothing is removed that a process sits in, except this command and the
 *   shells above it: at the end of its life, the worktree the session
 *   worked in is the one to remove, but a build still running there keeps it.
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
import { branchStamps, worktreeStamp } from '../../lib/stamps.mjs'

const DEV_SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'dev-server', 'dev-server.sh')
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const SAFE = ['--remotes', '--glob=refs/cleanup/pull/*']
const WORKTREES = `${sep}.claude${sep}worktrees${sep}`

// --- plumbing ----------------------------------------------------------------

/**
 * Run a command. `out` is stdout on success; `err` says why not, ENOENT
 * included. It runs at `/` unless told otherwise: an `lsof` started inside a
 * worktree lists itself as a process holding it.
 */
function attempt(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: '/', ...opts })
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

const AFTER = /[\w.-]/ // a path may continue into the directory with `/`

/**
 * Which paths some text names as a whole token, so `/r/a.ts` is not named by
 * `/r/a.tsx`. One pass over each text however many paths: live transcripts
 * run to hundreds of megabytes.
 */
export function namedIn(texts, needles) {
  const want = [...new Set(needles.filter(Boolean))].sort((a, b) => b.length - a.length)
  const found = new Set()
  if (!want.length) return found
  const byLatin1 = new Map(want.map((n) => [Buffer.from(n, 'utf8').toString('latin1'), n]))
  // Zero-width, so every needle starting here is seen: an alternation would
  // report only its longest, losing `/r/wt` to `/r/wt/src`. The lookbehind is
  // the opening boundary, and AFTER the closing one.
  const re = new RegExp(`(?<![\\w./-])(?=(${[...byLatin1.keys()].map(escapeRe).join('|')}))`, 'g')
  for (const text of texts) {
    re.lastIndex = 0
    for (let m; (m = re.exec(text)); re.lastIndex = m.index + 1) {
      for (const [latin, needle] of byLatin1) {
        if (found.has(needle) || !text.startsWith(latin, m.index)) continue
        if (!AFTER.test(text[m.index + latin.length] ?? '')) found.add(needle)
      }
      if (found.size === want.length) return found
    }
  }
  return found
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

/** A transcript and its subagents' — a subagent's edits are recorded only in its own. */
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

/** Every other session running now: its id and its cwd. */
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
  return {
    ids: new Set(sessions.map((s) => s.id)),
    /** Pids of the sessions whose cwd sits inside `path`. */
    within: (path) => sessions.filter((s) => s.cwd && inside(s.cwd, path)).map((s) => s.pid),
  }
}

/** Who a stamp says made a thing: `self`, `live` (another running session), or `orphan`. */
export function ownerOf(stamp, selfId, liveIds) {
  return stamp === selfId ? 'self' : liveIds.has(stamp) ? 'live' : 'orphan'
}

// --- processes -----------------------------------------------------------------

const SESSION_KEY = 'CLAUDE_CODE_SESSION_ID='

/** The Claude session whose environment a process carries, or null. */
function sessionOf(pid) {
  const environ = `/proc/${pid}/environ`
  let env = []
  try {
    // macOS has no /proc: `ps -E` appends the environment, own processes only.
    env = existsSync(environ)
      ? readFileSync(environ, 'utf8').split('\0')
      : (run('ps', ['-wwE', '-o', 'command=', '-p', String(pid)]) ?? '').split(/\s+/)
  } catch {
    env = []
  }
  return env.find((e) => e.startsWith(SESSION_KEY))?.slice(SESSION_KEY.length) ?? null
}
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

/** `owner/name` of origin on GitHub, for `gh --repo`. */
const remoteSlug = (repo) =>
  git(repo, 'remote', 'get-url', 'origin')?.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null

const defaultBranch = (repo) =>
  git(repo, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD')?.replace(/^origin\//, '') ?? 'main'

/**
 * Local branches, each with its owner and whether deleting it would lose a
 * commit. One rev-list per repo.
 */
function localBranches(repo, worktrees, selfId, liveIds) {
  const unsafe = new Set(lines(git(repo, 'rev-list', '--branches', '--not', ...SAFE)))
  const stamps = branchStamps(repo)
  const base = defaultBranch(repo)
  return lines(git(repo, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads')).map((l) => {
    const [branch, head] = l.split(' ')
    return {
      repo,
      branch,
      head,
      isDefault: branch === base,
      checkedOut: worktrees.some((w) => w.branch === branch),
      owner: ownerOf(stamps.get(branch), selfId, liveIds),
      // A tip no safe ref reaches exists only here, whatever its ancestors.
      unsafe: unsafe.has(head),
    }
  })
}

const LIVE = 'another live session created it'
const NOT_MINE = 'not created by this session — pass --orphans to take it'

/** Why a local branch may not be deleted now, or null when it may. */
export function branchBlocker(b, { orphans = false } = {}) {
  if (b.isDefault) return 'default branch'
  if (b.checkedOut) return 'checked out in a worktree'
  if (b.owner === 'live') return LIVE
  if (b.owner === 'orphan' && !orphans) return NOT_MINE
  if (b.unsafe) return 'commits on no remote branch or PR'
  return null
}

/**
 * Everything that would be lost or forgotten if this checkout went away,
 * each change marked with whether this session made it.
 */
function inspectCheckout(session, wt, liveIds) {
  const since = session.startedAt
  const owner = wt.main ? null : ownerOf(worktreeStamp(wt.path), session.id, liveIds)
  const workedHere = owner === 'self' || session.cwds.some((c) => inside(c, wt.path))

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
  // Where the session worked, every recent change is its own: no transcript search.
  const named = workedHere ? new Set() : namedIn(session.texts, dirty.filter((d) => d.recent).map((d) => d.path))
  const changes = dirty.map(({ status, file, path, recent }) => ({ status, file, session: recent && (workedHere || named.has(path)) }))

  const branch = wt.branch ?? null
  const unpushed = lines(git(wt.path, 'log', '--format=%H %ct %s', 'HEAD', '--not', ...SAFE)).map((l) => {
    const [sha, ct, ...subject] = l.split(' ')
    // One text at a time: joining hundreds of megabytes throws RangeError.
    const re = !workedHere && branch && new RegExp(`\\[${escapeRe(branch)}( \\(root-commit\\))? ${sha.slice(0, 7)}`)
    const printed = re && session.texts.some((t) => re.test(t))
    return { sha, subject: subject.join(' '), session: Number(ct) * 1000 >= since && (workedHere || Boolean(printed)) }
  })
  return { path: wt.path, repo: wt.repo, main: wt.main, locked: wt.locked, branch, head: wt.head, owner, dirty: changes, unpushed }
}

/** Why a worktree may not be removed now, or null when it may. */
export function removalBlocker(info, { orphans = false } = {}) {
  if (info.main) return 'main checkout'
  if (info.owner === 'live') return LIVE
  if (info.owner !== 'self' && !orphans) return NOT_MINE
  if (info.owner !== 'self' && !info.path.includes(WORKTREES)) return 'not under .claude/worktrees — remove it by hand'
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
 * Whether a database name has the shape this repo's main checkout gives an
 * isolated one. The template comes from the main checkout alone, never from
 * a branch's worktree, and needs a literal prefix — `{slug}` alone would
 * match every database on the machine.
 */
export function isOwnDatabase(template, name) {
  const [pre, post] = template?.split('{slug}') ?? []
  return Boolean(pre && name) && name.startsWith(pre) && name.endsWith(post)
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
  const { ids: liveIds } = otherSessions(session.id)

  // Another live session's things are only counted: they are its to report.
  const checkouts = []
  const orphanWorktrees = []
  let liveWorktrees = 0
  for (const wt of worktrees) {
    const info = inspectCheckout(session, wt, liveIds)
    if (info.owner === 'live') liveWorktrees++
    else if (info.owner === 'self' || info.dirty.some((d) => d.session) || info.unpushed.some((c) => c.session)) {
      const point = info.branch ? git(wt.path, 'merge-base', `origin/${defaultBranch(wt.repo)}`, 'HEAD') : null
      checkouts.push({ ...info, remote: remoteSlug(wt.repo), changedFiles: point ? lines(git(wt.path, 'diff', '--name-only', point, 'HEAD')) : [] })
    } else if (!wt.main) orphanWorktrees.push({ path: wt.path, branch: info.branch })
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

  const loose = repos.flatMap((r) =>
    localBranches(r, worktrees.filter((w) => w.repo === r), session.id, liveIds).filter((b) => !b.isDefault && !b.checkedOut),
  )
  const branches = loose
    .filter((b) => b.owner !== 'live')
    .map(({ repo, branch, head, unsafe, owner }) => ({ repo, branch, head, unsafe, owner }))
  const live = { worktrees: liveWorktrees, branches: loose.length - branches.length }
  const report = { servers, checkouts, stashes, branches, orphanWorktrees, live, otherServers }
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

/** Delete one local branch unless `branchBlocker` keeps it. 1 when kept. */
function deleteBranch(repo, branches, name, { orphans, label = name }) {
  const b = branches.find((x) => x.branch === name)
  const blocker = !b ? 'no such branch' : branchBlocker(b, { orphans })
  return settle(label, blocker, () => attempt('git', ['branch', '-D', name], { cwd: repo }).err, `deleted (was ${b?.head.slice(0, 12)})`)
}

function remove(argv) {
  const session = loadSession(argv)
  const orphans = argv.includes('--orphans')
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
    const info = inspectCheckout(session, wt, others.ids)
    const dev = devServerInfo(path)
    const holders = [
      ...new Set([...cwds.filter(([, cwd]) => inside(cwd, path)).map(([pid]) => pid), ...others.within(path)]),
    ]
    // teardown drops dev.database, and a worktree we did not create took that
    // name from its own branch's .claude/workflow.json. Trust only a name the
    // main checkout's template shapes.
    const foreignDb =
      dev?.database && info.owner !== 'self' && !isOwnDatabase(devServerInfo(repo)?.databaseTemplate, dev.database)
    const blocker =
      removalBlocker(info, { orphans }) ??
      (foreignDb ? `its database ${dev.database} is not this repo's to drop — remove it by hand` : null) ??
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
    // Listed again: the worktree is gone, so its branch is no longer checked
    // out. It goes with its worktree even unstamped (`gh pr checkout` names no
    // branch), but never when another live session created it.
    const branches = localBranches(repo, listWorktrees(repo), session.id, others.ids)
    deleteBranch(repo, branches, info.branch, { orphans: true, label: `  branch ${info.branch}` })
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
  const all = localBranches(root, listWorktrees(root), session.id, otherSessions(session.id).ids)
  const orphans = argv.includes('--orphans')
  let kept = 0
  for (const name of names) kept += deleteBranch(root, all, name, { orphans })
  return kept
}

const COMMANDS = { scan, stop, remove, prune, 'drop-branch': dropBranch }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const cmd = COMMANDS[argv[0]]
  if (!cmd) fail(`usage: cleanup.mjs ${Object.keys(COMMANDS).join('|')} …`)
  process.exitCode = cmd(argv) ? 1 : 0
}
