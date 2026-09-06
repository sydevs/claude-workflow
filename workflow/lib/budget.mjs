#!/usr/bin/env node
/**
 * Character budgets for everything the loop writes.
 *
 * ## Why this is a script
 *
 * The old rule was prose: "past roughly fifteen lines outside a `<details>`,
 * it is an essay." It failed in both directions at once. A measurement of
 * 80 bot comments found the visible half ran to 3,364 characters, about
 * forty lines. It also found that 51% of all bytes had moved INSIDE
 * `<details>`, where the rule could not reach, and those tokens still cost
 * full price to read.
 *
 * So this script counts the whole artefact, `<details>` included. A budget
 * that exempts a container just names where to hide text.
 *
 * ## No discretionary overage
 *
 * `check()` returns only over or under. It has no "unless you explain why"
 * clause on purpose. The fifteen-line rule had one. That clause is what
 * killed the rule.
 *
 * This script reads text from stdin. It never fetches data. So a routine
 * and a laptop always agree.
 * (why: docs/why.md#budgets-not-adjectives)
 */

import { loadLoopConfig } from './config.mjs'

/**
 * Fallback budgets. `loop-config.json` → `writing.budgets` is authoritative.
 *
 * The fallback is reached only when no `loop-config.json` exists above this
 * file or the cwd. Keep these numbers equal to the config's, so both paths
 * agree. The CLI names which path it took, so a run reports the answer
 * rather than assuming it.
 */
export const DEFAULT_BUDGETS = {
  comment: 1200,
  reviewReply: 600,
  journalComment: 2500,
}

/**
 * Measure one artefact against its budget.
 *
 * `chars` counts the whole string. Markdown, HTML tags and `<details>`
 * contents all count, because a later run pays for every one of them.
 */
export function check(text, kind, budgets = DEFAULT_BUDGETS) {
  const limit = budgets?.[kind]
  const chars = typeof text === 'string' ? text.length : 0
  if (typeof limit !== 'number') {
    return { kind, chars, limit: null, verdict: 'UNBUDGETED', reason: `no budget for "${kind}"` }
  }
  const over = chars - limit
  return over > 0
    ? { kind, chars, limit, over, verdict: 'OVER', reason: `${chars} chars, ${over} over the ${limit} budget — cut and re-check` }
    : { kind, chars, limit, over: 0, verdict: 'OK', reason: `${chars}/${limit}` }
}

/** How much of the text hides inside `<details>`. Reported, never exempted. */
export function detailsShare(text = '') {
  const inside = (String(text).match(/<details[\s\S]*?<\/details>/g) || [])
    .reduce((n, m) => n + m.length, 0)
  const total = String(text).length || 1
  return { inside, total, pct: Math.round((inside / total) * 100) }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const kind = (process.argv.find((a) => a.startsWith('--kind=')) || '').split('=')[1]
    || process.argv[process.argv.indexOf('--kind') + 1]
  let text = ''
  process.stdin.on('data', (d) => { text += d })
  process.stdin.on('end', () => {
    let budgets = DEFAULT_BUDGETS
    let source = 'fallback'
    try {
      const configured = loadLoopConfig()?.writing?.budgets
      if (configured) { budgets = configured; source = 'config' }
    } catch (err) {
      // Two failures land here, and only one is routine. A missing file is
      // the fallback's whole purpose. A file that EXISTS and will not parse
      // is the silent-wrong-number bug this script was fixed for, so say it.
      if (!/not found/.test(err.message)) source = `fallback, loop-config.json unreadable: ${err.message}`
    }
    const r = check(text, kind, budgets)
    const d = detailsShare(text)
    console.log(`${r.verdict} — ${r.reason} (${source})${d.pct ? ` (${d.pct}% inside <details>, counted)` : ''}`)
    process.exit(r.verdict === 'OVER' ? 1 : 0)
  })
}
