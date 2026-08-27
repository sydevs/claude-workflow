#!/usr/bin/env node

/**
 * Block Generated Files (PreToolUse / Edit|Write)
 *
 * Denies edits to files produced by tooling rather than written by hand, and
 * says how to regenerate them instead.
 *
 * The rules are per-repo data, not code: they come from `generatedFiles` in
 * `.claude/workflow.json`. Each entry is `{ pattern, reason }`, where `pattern`
 * is a JS regex tested against the worktree-relative path.
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
