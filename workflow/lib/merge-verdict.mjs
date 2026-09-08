#!/usr/bin/env node

/**
 * One PR's merge verdict, from data the caller already fetched.
 *
 * The rules, and why they are correct, live in `merge-gate.mjs`. See
 * `reviewDecisionFrom` and `mergeVerdict` there for the canonical rationale.
 * This script fetches nothing. It takes what the caller gathered — the
 * GitHub Actions dispatcher through Octokit, or a local session through
 * the MCP tools — and defers to those functions for the decision.
 *
 * Input on stdin is a JSON object:
 *
 *   {
 *     "repo": "sydevs/SahajCloud",
 *     "hasWorkflows": true,                  // whether the repo runs CI at all (see ci.noCi in loop-config.json)
 *     "pr":            { … },                // the pull request object
 *     "reviews":       [ … ],                // its reviews
 *     "checkRuns":     { … },                // check runs on the head SHA
 *     "statuses":      { … },                // combined commit status on the head SHA (optional)
 *     "reviewThreads": { … }                 // review threads with is_resolved / isResolved
 *   }
 *
 * Exit codes: 0 merge, 1 hold.
 *
 *   merge-verdict.mjs < snapshot.json
 *   merge-verdict.mjs --json < snapshot.json
 */

import { readFileSync } from 'fs'
import { loadLoopConfig, flag } from './config.mjs'
import { mergeVerdict, normalizeMcp, setRepoWorkflows } from './merge-gate.mjs'

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')

let input
try {
  input = JSON.parse(readFileSync(0, 'utf-8'))
} catch {
  console.error('merge-verdict: expected a JSON snapshot on stdin. See the header for its shape.')
  process.exit(1)
}

const repo = input.repo
if (!repo || !repo.includes('/')) {
  console.error('merge-verdict: `repo` must be "owner/name".')
  process.exit(1)
}

if (typeof input.hasWorkflows === 'boolean') setRepoWorkflows(repo, input.hasWorkflows)

let policy = {}
let reviewAuthority = []
try {
  const config = loadLoopConfig(flag(argv, 'config'))
  policy = config.mergePolicy || {}
  reviewAuthority = [config.assignment?.reviewer].filter(Boolean)
} catch {
  // No config found. Neither the repo-level "never merge here" rule nor the
  // approval allowlist can apply. Both fail closed: an empty authority
  // derives no approval at all. Report this instead of failing silently.
  console.error('merge-verdict: loop-config.json not found — mergePolicy and review authority NOT applied.')
}

// `reviewAuthority` comes last on purpose. The config's allowlist is the
// gate. A snapshot on stdin must never widen it by naming its own.
const verdict = mergeVerdict(normalizeMcp({ ...input, reviewAuthority }), repo, policy)

if (JSON_OUT) console.log(JSON.stringify({ repo, pr: input.pr?.number, ...verdict }, null, 2))
else console.log(`${repo}#${input.pr?.number}  ${verdict.verdict}  — ${verdict.reason}`)

process.exit(verdict.verdict === 'MERGE' ? 0 : 1)
