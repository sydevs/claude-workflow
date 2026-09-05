#!/usr/bin/env node

/**
 * One PR's merge verdict, from data the caller already fetched.
 *
 * This is the cloud-viable half of the merge gate. The rules, and why they
 * are correct, live in `lib/merge-gate.mjs`. See `reviewDecisionFrom` and
 * `mergeVerdict` there for the canonical rationale. This script fetches
 * nothing. It gathers the three MCP calls' results and defers to those
 * functions for the decision.
 *
 * Input on stdin is a JSON object with what the documented calls returned:
 *
 *   {
 *     "repo": "sydevs/SahajCloud",
 *     "hasWorkflows": true,                  // ls <repo>/.github/workflows/*.yml (a filesystem check)
 *     "pr":            { … },                // pull_request_read method:get
 *     "reviews":       [ … ],                // pull_request_read method:get_reviews
 *     "checkRuns":     { … },                // pull_request_read method:get_check_runs
 *     "statuses":      { … },                // pull_request_read method:get_status  (optional)
 *     "reviewThreads": { … }                 // pull_request_read method:get_review_comments
 *   }
 *
 * Exit codes: 0 merge, 1 hold.
 *
 *   merge-verdict.mjs < snapshot.json
 *   merge-verdict.mjs --json < snapshot.json
 */

import { readFileSync } from 'fs'
import { loadLoopConfig, flag } from '../../lib/config.mjs'
import { mergeVerdict, normalizeMcp, setRepoWorkflows } from '../../lib/merge-gate.mjs'

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
