#!/usr/bin/env node

/**
 * One PR's CI verdict, for the bounded watch in `/finalize-pr` step 8.
 *
 * ⚠ **LOCAL ONLY** — it shells out to `gh`, which a routine cannot use. `merge-verdict.mjs` is
 * the routine-side equivalent, fed by MCP, and shares this definition of green.
 *
 * Shares `lib/merge-gate.mjs` with the loop's rung 1 ON PURPOSE. The same wrong
 * reading — commit statuses standing in for check runs — was live in both places,
 * and a second prose copy of "what green means" is how it stayed wrong in both.
 * (sydevs/claude-workflow#26)
 *
 * Exit codes are the interface, so a caller need not parse anything:
 *   0  green
 *   1  red — `--json` names the failing checks
 *   2  still running, or gave up waiting
 *
 * Usage:
 *   ci-status.mjs [--repo owner/name] [--pr N] [--attempts N] [--interval SEC] [--json]
 */

import { execFileSync } from 'child_process'
import { flag, loadLoopConfig } from '../../lib/gh.mjs'
import { readPr, ciVerdict, checksOf } from '../../lib/merge-gate.mjs'

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')

let attempts = Number(flag(argv, 'attempts', '0'))
if (!attempts) {
  try {
    attempts = loadLoopConfig().ceilings.ciPollAttempts
  } catch {
    attempts = 20
  }
}
const intervalMs = Number(flag(argv, 'interval', '30')) * 1000

const repo =
  flag(argv, 'repo') ||
  JSON.parse(
    execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], { encoding: 'utf-8' }),
  ).nameWithOwner

const number =
  Number(flag(argv, 'pr', '0')) ||
  JSON.parse(execFileSync('gh', ['pr', 'view', '--json', 'number'], { encoding: 'utf-8' })).number

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (let attempt = 1; attempt <= attempts; attempt++) {
  const pr = readPr(repo, number)
  const ci = ciVerdict(pr, repo)
  const settled = ci.green || ci.failing.length > 0

  if (settled || attempt === attempts) {
    const result = {
      repo,
      pr: number,
      green: ci.green,
      reason: ci.reason,
      attempt,
      checks: checksOf(pr),
    }
    if (JSON_OUT) console.log(JSON.stringify(result, null, 2))
    else console.log(`${repo}#${number}  ${ci.green ? 'GREEN' : 'NOT GREEN'}  — ${ci.reason}`)
    process.exit(ci.green ? 0 : ci.failing.length ? 1 : 2)
  }

  console.error(`[${attempt}/${attempts}] ${ci.reason}`)
  await sleep(intervalMs)
}
