#!/usr/bin/env node

/**
 * Block Wrong Bash Commands (PreToolUse / Bash)
 *
 * Denies invocations that are known-wrong for these repos and names the right
 * one, failing fast rather than letting Claude try, fail and retry.
 *
 * Reconciled from three forks. The sibling-repo exemption is SahajCloud's — it
 * was the only copy that had it, and its absence elsewhere is what blocked
 * cross-repo work. The package-manager rule is SahajAtlasWeb's, which covered
 * yarn as well as npm.
 */

import { execFileSync } from 'child_process'
import { existsSync, statSync } from 'fs'
import { homedir } from 'os'
import { dirname, isAbsolute, resolve } from 'path'
import { readInput, loadConfig, worktreeRoot, deny } from './lib/workflow-config.mjs'

const input = readInput()
const command = input?.tool_input?.command ?? ''
if (!command) process.exit(0)

const ROOT = worktreeRoot()
const PM = loadConfig(ROOT).packageManager ?? 'pnpm'

// Anchored to command position — start of line, or after && ; | || — so we do
// not false-positive on these tokens appearing inside an echoed string.
const CMD_START = '(?:^|&&|;|\\|\\||\\|)\\s*'

/** Strip quotes, expand `~`, resolve relatives against the worktree root. */
function resolvePath(raw) {
  if (!raw) return null
  let p = raw.trim().replace(/^['"]|['"]$/g, '')
  if (p === '~') p = homedir()
  else if (p.startsWith('~/')) p = homedir() + p.slice(1)
  return isAbsolute(p) ? resolve(p) : resolve(ROOT, p)
}

/** A directory's git top-level, or null when it is not inside a repository. */
function gitTopLevel(dir) {
  if (!dir || !existsSync(dir)) return null
  try {
    return (
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || null
    )
  } catch {
    return null
  }
}

/**
 * True when a captured path belongs to a DIFFERENT repository than this session.
 *
 * The two git rules exist because *within* a repo the cwd is already its root,
 * so `git -C` and `cd … && git` are redundant and trigger permission prompts.
 * That rationale does not hold for a sibling checkout, and cross-repo work is
 * routine here (`/cross-repo-issue`, the shared workspace).
 *
 * This compares REPOSITORIES, not directory containment, because containment
 * gets the multi-root case exactly backwards. `worktreeRoot()` falls back to the
 * project dir when `git rev-parse` fails, so a session rooted at the workspace
 * folder — which is not itself a repo — takes ROOT to be that folder, and every
 * sibling checkout then sits *under* it. The old containment test therefore read
 * each sibling as "inside this worktree" and fired the very rules the exemption
 * exists to lift, blocking all cross-repo git in the one session shape that
 * needs it most.
 */
function targetsSiblingRepo(match) {
  const p = resolvePath(match?.[1])
  if (!p) return false

  const ownRepo = gitTopLevel(ROOT)
  // Session root is not a repository at all (the multi-root workspace): there is
  // no "this repo" for the rules to be about, so every target is a sibling.
  if (!ownRepo) return true

  const dir = existsSync(p) && statSync(p).isDirectory() ? p : dirname(p)
  const targetRepo = gitTopLevel(dir)
  // Outside any repo — the rules have nothing to say about it.
  if (!targetRepo) return true

  return targetRepo !== ownRepo
}

const rules = [
  {
    test: new RegExp(
      `${CMD_START}(npm|yarn)\\s+(install|i|run|test|exec|add|remove|rm|update|up|ci|dlx)\\b`,
    ),
    reason:
      `This project uses ${PM}. Replace \`npm\`/\`yarn <verb>\` with \`${PM} <verb>\` ` +
      `(e.g. \`${PM} install\`, \`${PM} dev\`, \`${PM} exec …\`). ` +
      '`npm view` and `npm why` remain allowed for read-only registry queries.',
  },
  {
    test: new RegExp(`${CMD_START}git\\s+-C\\s+(\\S+)`),
    exempt: targetsSiblingRepo,
    reason:
      'Avoid `git -C <path>` for paths inside this repo — the working directory is already its ' +
      'root. Sibling repos in the workspace are exempt; run git directly here.',
  },
  {
    test: new RegExp(`${CMD_START}cd\\s+(\\S+).*?&&\\s*git\\b`),
    exempt: targetsSiblingRepo,
    reason:
      'Never prepend `cd <path> && …` to a git command for paths inside this repo — git already ' +
      'operates on the current working tree, and the compound triggers a permission prompt. ' +
      'Sibling repos in the workspace are exempt.',
  },
]

for (const rule of rules) {
  const match = command.match(rule.test)
  if (match && !rule.exempt?.(match)) deny(rule.reason)
}

process.exit(0)
