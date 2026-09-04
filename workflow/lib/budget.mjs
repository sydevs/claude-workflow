#!/usr/bin/env node
/**
 * Character budgets for everything the loop writes.
 *
 * ## Why this is a script
 *
 * The rule it replaces was prose — "past roughly fifteen lines outside a
 * `<details>`, it is an essay" — and it failed in both directions at once.
 * Measured over 80 bot comments: the visible half ran to 3,364 characters
 * (about forty lines), and 51% of all bytes had migrated INSIDE `<details>`,
 * where the rule did not reach and the tokens still cost full price on read.
 *
 * So the count here is of the whole artefact, `<details>` included. A budget
 * that exempts a container is a budget that names where to hide.
 *
 * ## No discretionary overage
 *
 * `check()` returns over/under and nothing else. There is deliberately no
 * "unless you explain why" clause: the fifteen-line rule had one, and that is
 * what it died of.
 *
 * Takes text on stdin, never fetches, so a routine and a laptop agree.
 * (why: docs/why.md#budgets-not-adjectives)
 */

/** Fallback budgets. `loop-config.json` → `writing.budgets` is authoritative. */
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
    try {
      const fs = require('node:fs')
      budgets = JSON.parse(fs.readFileSync('loop-config.json', 'utf8'))?.writing?.budgets || DEFAULT_BUDGETS
    } catch { /* defaults */ }
    const r = check(text, kind, budgets)
    const d = detailsShare(text)
    console.log(`${r.verdict} — ${r.reason}${d.pct ? ` (${d.pct}% inside <details>, counted)` : ''}`)
    process.exit(r.verdict === 'OVER' ? 1 : 0)
  })
}
