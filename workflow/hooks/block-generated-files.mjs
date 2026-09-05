#!/usr/bin/env node

/**
 * Block Generated Files (PreToolUse / Edit|Write)
 *
 * Denies edits to files that tooling produces, not files written by hand.
 * Tells the caller how to regenerate the file instead.
 *
 * The rules are per-repo data, not code. They come from `generatedFiles` in
 * `.claude/workflow.json`. Each entry is `{ pattern, reason }`. `pattern` is
 * a JS regex tested against the worktree-relative path.
 */

import { readInput, loadConfig, worktreeRoot, relativePath, deny } from './lib/workflow-config.mjs'

const input = readInput()
const filePath = input?.tool_input?.file_path
if (!filePath) process.exit(0)

const root = worktreeRoot()
const rel = relativePath(filePath, root)
const rules = loadConfig(root).generatedFiles ?? []

for (const rule of rules) {
  let re
  try {
    re = new RegExp(rule.pattern)
  } catch {
    continue // a malformed pattern must not break the session
  }
  if (re.test(rel)) deny(rule.reason)
}

process.exit(0)
