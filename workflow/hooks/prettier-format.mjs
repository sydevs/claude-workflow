#!/usr/bin/env node

/**
 * Prettier Auto-Format (PostToolUse / Edit|Write)
 *
 * Formats the single edited file. Silent on no-op; reports only when the file
 * actually changed.
 *
 * Runs through the repo's package manager (`pnpm exec`), not `npx`. The forked
 * copies used `npx`, which contradicts the pnpm-only rule these repos enforce
 * in `block-wrong-bash` and can resolve a different binary — or fetch one from
 * the registry — in a pnpm workspace.
 */

import { execFileSync } from 'child_process'
import { statSync } from 'fs'
import { readInput, loadConfig, worktreeRoot, relativePath, passSilently } from './lib/workflow-config.mjs'

const input = readInput()
const filePath = input?.tool_input?.file_path ?? ''

// Markdown is deliberately excluded: Prettier's table and heading normalization
// rewrites hand-formatted docs wholesale, turning a one-line edit into a large
// unrelated diff. Docs in these repos are maintained by hand — do not re-add md.
if (!filePath || !/\.(js|jsx|ts|tsx|json|css|mjs)$/.test(filePath)) passSilently()

const root = worktreeRoot()
const pm = loadConfig(root).packageManager ?? 'pnpm'

try {
  const before = statSync(filePath).mtimeMs
  execFileSync(pm, ['exec', 'prettier', '--write', '--log-level=warn', filePath], {
    cwd: root,
    encoding: 'utf-8',
    stdio: 'pipe',
  })
  const after = statSync(filePath).mtimeMs

  if (after !== before) {
    console.log(
      JSON.stringify({
        continue: true,
        additionalContext: `Prettier reformatted ${relativePath(filePath, root)}.`,
      }),
    )
    process.exit(0)
  }
} catch {
  // Prettier absent or failed (e.g. the WordPress repo has no JS toolchain).
  // A formatter is not a gate — never block an edit because it could not run.
}

passSilently()
