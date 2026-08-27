/**
 * Shared config loader for the sydevs workflow hooks.
 *
 * Every hook here is repo-agnostic; the per-repo data lives in
 * `<worktree>/.claude/workflow.json`. Resolving against the *worktree* root
 * rather than `CLAUDE_PROJECT_DIR` matters because `/implement-issue` works in a
 * worktree by default, and a hook keyed on the main checkout would read the
 * wrong repo's rules — or none.
 */

import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/** The git worktree root, falling back to the project dir when git is unavailable. */
export function worktreeRoot() {
  const fallback = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: fallback,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || fallback
  } catch {
    return fallback
  }
}

/**
 * Load `.claude/workflow.json`. Returns `{}` when absent or malformed — a hook
 * must never break a session because a repo has not been onboarded yet.
 */
export function loadConfig(root = worktreeRoot()) {
  const path = join(root, '.claude', 'workflow.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

/** Read the hook payload from stdin. Returns null on anything unparseable. */
export function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf-8'))
  } catch {
    return null
  }
}

/** Path relative to the worktree root, for matching against config globs. */
export function relativePath(filePath, root) {
  return filePath.startsWith(root + '/') ? filePath.slice(root.length + 1) : filePath
}

/** Emit a PreToolUse denial and exit. */
export function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  )
  process.exit(0)
}

/** Emit a silent pass-through and exit. */
export function passSilently() {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }))
  process.exit(0)
}
