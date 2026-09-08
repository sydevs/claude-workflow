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
  journalEntry: 1500,
  journalComment: 4000,
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

/**
 * How much room `--fit` leaves below the budget.
 *
 * A body fitted to the last character breaks again on the next edit. One
 * 2026-09-07 run converged at 3,999 of 4,000, then wrote a fresher timestamp
 * into the same body and spent four more re-checks getting back under.
 *
 * This is a script constant, not a `loop-config.json` value, so that this
 * change ships without a ceiling change beside it. Override with `--reserve`.
 */
export const FIT_RESERVE = 200

// `##` in the day's journal body, `###` in a run's journal comment. Both are the Did section.
const DID_HEADING = /^#{2,3}\s+(?:\u{1F4C4}\s*)?Did\s*$/u
const SECTION_HEADING = /^#{2,3}\s/
const DROPPABLE = /^-\s/

/**
 * Cut an over-budget journal body to fit, instead of asking a run to guess.
 *
 * `check()` answers over or under and nothing else. A run that went over used
 * to regenerate the whole body and re-check. One 2026-09-07 run did that
 * thirteen times across eleven minutes to shed 1,557 characters.
 *
 * The cut order is not a judgement call. `journal/SKILL.md` fixes it: drop the
 * oldest `\u{1F4C4} Did` lines first, because GitHub already records those events, and
 * never cut a failure. A fixed rule belongs in a script.
 * (why: docs/why.md#fit-the-journal-do-not-negotiate-with-it)
 *
 * Nothing outside the `\u{1F4C4} Did` section is ever touched, so a failure, a ceiling
 * and a friction line all survive a fit. The run table survives too — it is
 * not a list item. When the section empties, the heading goes with it, which
 * is what the skill already requires of an empty section.
 */
export function fit(text, kind, budgets = DEFAULT_BUDGETS, reserve = FIT_RESERVE) {
  const limit = budgets?.[kind]
  if (typeof limit !== 'number') {
    return { text: String(text), dropped: 0, verdict: 'UNBUDGETED', reason: `no budget for "${kind}"` }
  }
  const target = Math.max(0, limit - reserve)
  let lines = String(text).split('\n')
  let dropped = 0

  while (lines.join('\n').length > target) {
    const head = lines.findIndex((l) => DID_HEADING.test(l))
    if (head === -1) break

    let end = lines.length
    for (let i = head + 1; i < lines.length; i += 1) {
      if (SECTION_HEADING.test(lines[i])) { end = i; break }
    }

    const victim = lines.slice(head + 1, end).findIndex((l) => DROPPABLE.test(l))
    if (victim === -1) {
      const cutTo = lines[head + 1] === '' ? head + 2 : head + 1
      lines = [...lines.slice(0, head), ...lines.slice(cutTo)]
      continue
    }
    lines.splice(head + 1 + victim, 1)
    dropped += 1
  }

  // A Did section that lost its last line keeps its heading only while the
  // loop is still cutting. Once the text fits, drop an empty heading too —
  // the skill omits an empty section, and an orphaned heading reads as one.
  if (dropped > 0) {
    const head = lines.findIndex((l) => DID_HEADING.test(l))
    if (head !== -1) {
      let end = lines.length
      for (let i = head + 1; i < lines.length; i += 1) {
        if (SECTION_HEADING.test(lines[i])) { end = i; break }
      }
      if (!lines.slice(head + 1, end).some((l) => DROPPABLE.test(l))) {
        const cutTo = lines[head + 1] === '' ? head + 2 : head + 1
        lines = [...lines.slice(0, head), ...lines.slice(cutTo)]
      }
    }
  }

  const out = lines.join('\n')
  const chars = out.length
  const shed = dropped === 1 ? '1 line' : `${dropped} lines`
  return chars > limit
    ? { text: out, dropped, chars, limit, target, verdict: 'OVER',
        reason: `${chars} chars after dropping ${shed}, still ${chars - limit} over ${limit} — cut prose, never a failure` }
    : { text: out, dropped, chars, limit, target, verdict: 'OK',
        reason: `${chars}/${limit}, ${limit - chars} to spare, dropped ${shed}` }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const argv = process.argv
  const kind = (argv.find((a) => a.startsWith('--kind=')) || '').split('=')[1]
    || argv[argv.indexOf('--kind') + 1]
  const wantsFit = argv.includes('--fit')
  const reserveRaw = (argv.find((a) => a.startsWith('--reserve=')) || '').split('=')[1]
    ?? (argv.includes('--reserve') ? argv[argv.indexOf('--reserve') + 1] : undefined)
  const reserve = Number.isFinite(Number(reserveRaw)) ? Number(reserveRaw) : FIT_RESERVE
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
    if (wantsFit) {
      // The fitted body goes to stdout so the caller can redirect it. The
      // verdict goes to stderr, so a redirect never swallows the report.
      const f = fit(text, kind, budgets, reserve)
      process.stdout.write(f.text)
      console.error(`${f.verdict} — ${f.reason} (${source})`)
      process.exit(f.verdict === 'OK' ? 0 : 1)
    }

    const r = check(text, kind, budgets)
    const d = detailsShare(text)
    console.log(`${r.verdict} — ${r.reason} (${source})${d.pct ? ` (${d.pct}% inside <details>, counted)` : ''}`)
    process.exit(r.verdict === 'OVER' ? 1 : 0)
  })
}
