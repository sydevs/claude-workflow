#!/usr/bin/env node

/**
 * ESLint Auto-Fix (PostToolUse / Edit|Write)
 *
 * Runs `eslint --fix` on the edited file, and reports what it fixed and what
 * problems remain. Runs through the repo's package manager. See
 * prettier-format.mjs for why not `npx`.
 *
 * This hook survives the move to LSP diagnostics because it rewrites files.
 * The old `typecheck` hook did not survive: a language server reports
 * problems, it does not fix them, so `typescript-lsp` replaces it completely.
 */

import { execFileSync } from 'child_process'
import { readInput, loadConfig, worktreeRoot, relativePath, passSilently } from './lib/workflow-config.mjs'

const input = readInput()
const filePath = input?.tool_input?.file_path ?? ''
if (!filePath || !/\.(js|jsx|ts|tsx|mjs)$/.test(filePath)) passSilently()

const root = worktreeRoot()
const pm = loadConfig(root).packageManager ?? 'pnpm'

/** Run eslint, returning parsed results or null when it could not run at all. */
function runEslint(extraArgs = []) {
  try {
    const out = execFileSync(pm, ['exec', 'eslint', '--format', 'json', ...extraArgs, filePath], {
      cwd: root,
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    return JSON.parse(out || '[]')
  } catch (err) {
    // eslint exits non-zero when problems remain. That output is still valid.
    const stdout = err?.stdout?.toString?.() ?? ''
    if (stdout.trim().startsWith('[')) {
      try {
        return JSON.parse(stdout)
      } catch {
        return null
      }
    }
    return null
  }
}

const before = runEslint()
if (before === null) passSilently() // no eslint in this repo, or it failed to start

runEslint(['--fix'])
const after = runEslint() ?? []

const count = (results) =>
  results.reduce((n, r) => n + (r.errorCount ?? 0) + (r.warningCount ?? 0), 0)

const fixed = count(before) - count(after)
const remaining = after.flatMap((r) =>
  (r.messages ?? []).map((m) => `  ${m.line}:${m.column} ${m.message} (${m.ruleId ?? 'unknown'})`),
)

if (fixed > 0 || remaining.length > 0) {
  const rel = relativePath(filePath, root)
  const parts = []
  if (fixed > 0) parts.push(`ESLint auto-fixed ${fixed} problem(s) in ${rel}.`)
  if (remaining.length > 0) {
    parts.push(`${remaining.length} problem(s) remain in ${rel}:`, ...remaining.slice(0, 10))
    if (remaining.length > 10) parts.push(`  …and ${remaining.length - 10} more.`)
  }
  console.log(JSON.stringify({ continue: true, additionalContext: parts.join('\n') }))
  process.exit(0)
}

passSilently()
