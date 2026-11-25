#!/usr/bin/env node

/**
 * Stamp Ownership (PreToolUse + PostToolUse / Bash, EnterWorktree)
 *
 * Records which session created each worktree and local branch, so
 * `/workflow:cleanup` can tell its own from a neighbour's without guessing.
 * Before the call it snapshots every nearby repo's worktrees and branches.
 * After the call it diffs them and stamps what is new:
 *
 * - a worktree: a `claude-session` file in its admin dir
 *   (`.git/worktrees/<name>/`), which `git worktree remove` deletes with it;
 * - a branch: `branch.<name>.claudeSession`, which `git branch -D` deletes.
 *
 * Something new is stamped only when the call names it — the branch name or
 * the worktree's path or directory name. Another session can create a branch
 * while a long command runs, and must not be stamped as this one's. A new
 * worktree's own branch is stamped with it. EnterWorktree names its worktree.
 * (why: docs/why.md#cleanup-touches-only-its-own-session)
 *
 * It never blocks a call and never prints. Any failure leaves the item
 * unstamped, and cleanup treats an unstamped item as an orphan: pruned only
 * when nothing would be lost.
 */

import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { readInput } from './lib/workflow-config.mjs'

export const STAMP_FILE = 'claude-session'
export const STAMP_KEY = 'claudeSession'

const git = (cwd, ...args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\n$/, '')
  } catch {
    return null
  }
}
const lines = (s) => (s ? s.split('\n').filter(Boolean) : [])
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** The repo a path belongs to, as its main checkout's path. */
const repoOf = (dir) => {
  const common = existsSync(dir) ? git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir') : null
  return common ? dirname(common) : null
}

const childRepos = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, '.git')))
      .map((d) => repoOf(join(dir, d.name)))
  } catch {
    return []
  }
}

/**
 * The repos a call could touch: the cwd's own, the repos directly under a cwd
 * that is not one (a multi-root workspace), and the siblings beside the repo.
 */
function nearbyRepos(cwd) {
  const own = repoOf(cwd)
  const found = own ? [own, ...childRepos(dirname(own))] : childRepos(cwd)
  return [...new Set(found.filter(Boolean))].sort()
}

/** Each repo's worktree paths (with their branch) and local branches. */
function snapshot(repos) {
  const out = {}
  for (const repo of repos) {
    const worktrees = {}
    let cur = null
    for (const l of lines(git(repo, 'worktree', 'list', '--porcelain'))) {
      if (l.startsWith('worktree ')) worktrees[(cur = l.slice(9))] = null
      else if (l.startsWith('branch ') && cur) worktrees[cur] = l.slice(7).replace(/^refs\/heads\//, '')
    }
    out[repo] = { worktrees, branches: lines(git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')) }
  }
  return out
}

/** Whether `text` holds `needle` as a whole token, so `fix` is not named by `fix-2`. */
export function names(text, needle) {
  return Boolean(needle) && new RegExp(`(?<![\\w./-])${escapeRe(needle)}(?![\\w.-])`).test(text)
}

/**
 * What a call created and named, from the snapshots either side of it.
 * Pure, so the attribution rule is testable without running git.
 */
export function created(before, after, text) {
  const worktrees = []
  const branches = new Set()
  for (const [repo, now] of Object.entries(after)) {
    const was = before[repo] ?? { worktrees: {}, branches: [] }
    for (const [path, branch] of Object.entries(now.worktrees)) {
      if (path in was.worktrees) continue
      if (!names(text, path) && !names(text, basename(path)) && !names(text, path.slice(repo.length + 1))) continue
      worktrees.push({ repo, path })
      if (branch && !was.branches.includes(branch)) branches.add(`${repo}\0${branch}`)
    }
    for (const b of now.branches) if (!was.branches.includes(b) && names(text, b)) branches.add(`${repo}\0${b}`)
  }
  return { worktrees, branches: [...branches].map((k) => k.split('\0')) }
}

/** Stamp each created item, unless it already carries a stamp. */
function stamp({ worktrees, branches }, sessionId) {
  for (const { path } of worktrees) {
    const admin = git(path, 'rev-parse', '--absolute-git-dir')
    if (admin && !existsSync(join(admin, STAMP_FILE))) writeFileSync(join(admin, STAMP_FILE), `${sessionId}\n`)
  }
  for (const [repo, branch] of branches) {
    if (git(repo, 'config', '--get', `branch.${branch}.${STAMP_KEY}`) === null) git(repo, 'config', `branch.${branch}.${STAMP_KEY}`, sessionId)
  }
}

/** The text of a call that names what it creates. */
function callText(input) {
  const t = input.tool_input ?? {}
  if (input.tool_name === 'EnterWorktree') return [t.name && `.claude/worktrees/${t.name}`, t.name, t.path].filter(Boolean).join(' ')
  return t.command ?? ''
}

function main() {
  const input = readInput()
  const sessionId = input?.session_id
  if (!sessionId || !input.tool_use_id) return
  const text = callText(input)
  if (input.tool_name === 'Bash' && !/\b(git|gh)\b/.test(text)) return
  if (!text) return

  const dir = join(tmpdir(), 'claude-stamp-ownership')
  const file = join(dir, `${input.tool_use_id.replace(/[^\w-]/g, '_')}.json`)
  const cwd = resolve(input.cwd || process.cwd())

  if (input.hook_event_name === 'PreToolUse') {
    const repos = nearbyRepos(cwd)
    if (!repos.length) return
    mkdirSync(dir, { recursive: true })
    // A denied or interrupted call never reaches PostToolUse: drop its snapshot after a day.
    for (const f of readdirSync(dir)) {
      if (Date.now() - (statSync(join(dir, f), { throwIfNoEntry: false })?.mtimeMs ?? Date.now()) > 86_400_000) rmSync(join(dir, f), { force: true })
    }
    writeFileSync(file, JSON.stringify({ repos, before: snapshot(repos) }))
    return
  }
  if (!existsSync(file)) return
  const { repos, before } = JSON.parse(readFileSync(file, 'utf-8'))
  rmSync(file, { force: true })
  stamp(created(before, snapshot(repos), text), sessionId)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch {
    // A stamp is a convenience for cleanup. It must never cost a session a tool call.
  }
  process.exit(0)
}
