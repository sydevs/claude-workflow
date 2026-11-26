/**
 * Ownership stamps: which Claude session created a worktree or a local
 * branch. `hooks/stamp-ownership.mjs` writes them, `skills/cleanup/cleanup.mjs`
 * reads them. Both live inside git, so git deletes each with its thing:
 *
 * - a worktree: a `claude-session` file in its admin dir
 *   (`.git/worktrees/<name>/`), gone with `git worktree remove`;
 * - a branch: `branch.<name>.claudeSession`, gone with `git branch -D`.
 *
 * (why: docs/why.md#cleanup-touches-only-its-own-session)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = 'claude-session'
const KEY = 'claudeSession'

const git = (cwd, ...args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\n$/, '')
  } catch {
    return null
  }
}

/**
 * A linked worktree's admin directory, as git reports it. The two paths differ
 * only in a linked worktree, so a main checkout answers null — and so does a
 * worktree whose admin directory git has already dropped.
 */
function adminDir(worktree) {
  const [dir, common] = (git(worktree, 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir') ?? '').split('\n')
  return dir && dir !== common ? dir : null
}

/** The session that created a linked worktree, or null. */
export function worktreeStamp(worktree) {
  const admin = adminDir(worktree)
  try {
    return (admin && readFileSync(join(admin, FILE), 'utf8').trim()) || null
  } catch {
    return null
  }
}

/** Each stamped local branch of a repo, as branch name → session. */
export function branchStamps(repo) {
  const out = new Map()
  // git lowercases a variable name, never a subsection: the branch keeps its case.
  const key = KEY.toLowerCase()
  for (const l of (git(repo, 'config', '--get-regexp', `^branch\\..*\\.${key}$`) ?? '').split('\n')) {
    const m = l.match(new RegExp(`^branch\\.(.+)\\.${key} (.+)$`))
    if (m) out.set(m[1], m[2])
  }
  return out
}

/** Stamp a worktree with a session, unless it already has a stamp. */
export function stampWorktree(worktree, session) {
  const admin = adminDir(worktree)
  if (admin && !existsSync(join(admin, FILE))) writeFileSync(join(admin, FILE), `${session}\n`)
}

/** Stamp a branch with a session, unless it already has a stamp. */
export function stampBranch(repo, branch, session) {
  if (git(repo, 'config', '--get', `branch.${branch}.${KEY}`) === null) git(repo, 'config', `branch.${branch}.${KEY}`, session)
}
