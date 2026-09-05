#!/usr/bin/env node

/**
 * Prettier Auto-Format (PostToolUse / Edit|Write)
 *
 * Formats the edited file. Stays silent when nothing changes, and reports
 * only when the file actually changed.
 *
 * Runs through the repo's package manager (`pnpm exec`), never `npx`. The
 * forked copies this hook replaced used `npx`. That breaks the pnpm-only
 * rule `block-wrong-bash` enforces, and in a pnpm workspace `npx` can
 * resolve a different binary, or fetch one from the registry.
 */

import { execFileSync } from 'child_process'
import { statSync } from 'fs'
import { readInput, loadConfig, worktreeRoot, relativePath, passSilently } from './lib/workflow-config.mjs'

const input = readInput()
const filePath = input?.tool_input?.file_path ?? ''

// Markdown is excluded on purpose. Prettier's table and heading formatting
// rewrites hand-formatted docs completely, turning a one-line edit into a
// large, unrelated diff. These repos maintain docs by hand. Do not add md
// back here.
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
  // Prettier is absent, or it failed (for example, the WordPress repo has no
  // JS toolchain).
  // A formatter is not a gate. Never block an edit because it could not run.
}

passSilently()
