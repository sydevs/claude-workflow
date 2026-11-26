#!/usr/bin/env node

/**
 * Stamp Ownership (PreToolUse, PostToolUse, PostToolUseFailure / Bash, EnterWorktree)
 *
 * Records which session created each worktree and local branch, so
 * `/workflow:cleanup` can tell its own from a neighbour's without guessing.
 * Around a call that can create one — `git worktree`, `branch`, `switch`,
 * `checkout`, `gh pr checkout`, or EnterWorktree without a `path` — it
 * snapshots the nearby repos' worktrees and branches, then stamps whatever
 * is new (`lib/stamps.mjs`). The first stamp wins, so a neighbour's branch
 * made during this call keeps its own owner when that neighbour's call ends
 * first, as it usually does. (why: docs/why.md#cleanup-touches-only-its-own-session)
 *
 * The repos come from the call's own `cwd`, not `worktreeRoot()`: a call may
 * create in a sibling repo, and the stamp goes on the main checkout's git dir.
 *
 * It never blocks a call and never prints. A failure leaves the item
 * unstamped, and cleanup treats an unstamped item as an orphan: pruned only
 * when nothing would be lost.
 */

import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { readInput } from './lib/workflow-config.mjs'
import { stampBranch, stampWorktree } from '../lib/stamps.mjs'

const CREATES = /\b(?:worktree|branch|switch|checkout)\b/
const DAY = 86_400_000

const git = (cwd, ...args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\n$/, '')
  } catch {
    return null
  }
}
const lines = (s) => (s ? s.split('\n').filter(Boolean) : [])

/** The repo a path belongs to, as its main checkout's path. */
const repoOf = (dir) => {
  const common = git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir')
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
 * The repos a call could touch: the cwd's own and its siblings, or the repos
 * directly under a cwd that is not one (a multi-root workspace).
 */
function nearbyRepos(cwd) {
  const own = repoOf(cwd)
  return [...new Set((own ? [own, ...childRepos(dirname(own))] : childRepos(cwd)).filter(Boolean))]
}

/** Each repo's worktree paths, each with its branch, and its local branches. */
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

/** Whether a call can create a worktree or a local branch. */
function creates(input) {
  const t = input.tool_input ?? {}
  if (input.tool_name === 'EnterWorktree') return !t.path
  return /\b(?:git|gh)\b/.test(t.command ?? '') && CREATES.test(t.command)
}

function main() {
  const input = readInput()
  const session = input?.session_id
  if (!session || !input.tool_use_id || !creates(input)) return

  const dir = join(tmpdir(), 'claude-stamp-ownership')
  const file = join(dir, `${input.tool_use_id.replace(/[^\w-]/g, '_')}.json`)

  if (input.hook_event_name === 'PreToolUse') {
    const repos = nearbyRepos(resolve(input.cwd || process.cwd()))
    if (!repos.length) return
    mkdirSync(dir, { recursive: true })
    // A denied or interrupted call never reaches a post event: drop its snapshot after a day.
    for (const f of readdirSync(dir)) {
      const age = Date.now() - (statSync(join(dir, f), { throwIfNoEntry: false })?.mtimeMs ?? Date.now())
      if (age > DAY) rmSync(join(dir, f), { force: true })
    }
    writeFileSync(file, JSON.stringify(snapshot(repos)))
    return
  }
  // PostToolUse, or PostToolUseFailure: `git worktree add x && pnpm install` creates though it fails.
  if (!existsSync(file)) return
  const before = JSON.parse(readFileSync(file, 'utf-8'))
  rmSync(file, { force: true })
  for (const [repo, now] of Object.entries(snapshot(Object.keys(before)))) {
    for (const path of Object.keys(now.worktrees)) if (!(path in before[repo].worktrees)) stampWorktree(path, session)
    for (const b of now.branches) if (!before[repo].branches.includes(b)) stampBranch(repo, b, session)
  }
}

try {
  main()
} catch {
  // A stamp is a convenience for cleanup. It must never cost a session a tool call.
}
process.exit(0)
