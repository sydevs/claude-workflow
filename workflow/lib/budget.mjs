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
 * ## The exit code says "not OK". The verdict word says why
 *
 * Every verdict but `OK` exits 1. Two of them need opposite responses, so a
 * caller reads the printed verdict word and never the exit code alone.
 * (why: docs/why.md#a-verdict-word-not-an-exit-code)
 *
 * This script reads text from stdin. It never fetches data. So a routine
 * and a laptop always agree.
 * (why: docs/why.md#budgets-not-adjectives)
 */

import { loadLoopConfig, flag } from './config.mjs'

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
  reviewBody: 2000,
  journalEntry: 1500,
}

/**
 * Which kinds must carry `identity.commentMarker`, and the marker itself.
 *
 * `loop-config.json` → `writing.markerRequired` and `identity.commentMarker`
 * are authoritative, and `budget.test.mjs` fails on a drift from either.
 * A journal entry is absent on purpose: `handler-journal` posts no marker.
 *
 * Test presence, never position: the harness attribution footer follows the
 * marker in a real comment. (why: docs/why.md#the-marker-check-belongs-in-the-script)
 */
export const DEFAULT_MARKER_REQUIRED = ['comment', 'reviewReply', 'reviewBody']

/** Every verdict this script can print. The skills key on these words. */
export const VERDICTS = ['OK', 'OVER', 'UNBUDGETED', 'MISSING_MARKER']

export const DEFAULT_MARKER = '<sub>🤖 Written by the sydevs autonomous loop — see [what this is](https://github.com/sydevs/claude-workflow#the-loop)</sub>'

/**
 * Measure one artefact against its budget, and against the marker rule.
 *
 * `chars` counts the whole string. Markdown, HTML tags and `<details>`
 * contents all count, because a later run pays for every one of them.
 *
 * The marker options default ON, like `budgets`, so a caller gets the rule
 * without asking. Measuring a budget alone takes an explicit
 * `{ markerRequired: [] }`.
 */
export function check(text, kind, budgets = DEFAULT_BUDGETS, options = {}) {
  const { markerRequired = DEFAULT_MARKER_REQUIRED, marker = DEFAULT_MARKER } = options
  const limit = budgets?.[kind]
  const chars = typeof text === 'string' ? text.length : 0
  if (typeof limit !== 'number') {
    return { kind, chars, limit: null, verdict: 'UNBUDGETED', reason: `no budget for "${kind}"` }
  }
  // Answered before the overage, because the marker is 124 characters and they
  // count. A draft measured without it is measured against the wrong length.
  if (marker && markerRequired.includes(kind) && !String(text).includes(marker)) {
    return { kind, chars, limit, verdict: 'MISSING_MARKER',
      reason: `${kind} carries no identity.commentMarker — append it and re-check` }
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
 * Two rules bound the cut, and both exist because breaking them lost the record
 * this script was written to protect.
 *
 * **It cuts to the budget, and no further.** The 200-character headroom it
 * used to target was for a body that gets re-edited, and since #71 a journal
 * entry is a per-session comment written once. Against that, the headroom only
 * over-cut: a 1,355-character entry against a 1,500 budget lost its whole
 * `\u{1F4C4} Did` section and was told it had "532 to spare", and a 1,599-character one
 * dropped a second line after the first left it at 1,433.
 *
 * **It cuts from the END of `\u{1F4C4} Did`.** `handler-journal`'s template leads that
 * section with the PR the run pushed, and the register rule leads with the
 * outcome, so the first line is the most important one. Cutting top-down took
 * the PR link from three entries in the week to 2026-09-20, and taught a
 * fourth run to order its Did section least-important-first to survive.
 * Nothing outside `\u{1F4C4} Did` is ever touched, so a failure, a ceiling and a
 * friction line all survive a fit.
 * (why: docs/why.md#fit-the-journal-do-not-negotiate-with-it)
 *
 * The run table survives too — it is not a list item. When the section empties,
 * the heading goes with it, which is what the skill already requires of an
 * empty section.
 */
export function fit(text, kind, budgets = DEFAULT_BUDGETS) {
  const limit = budgets?.[kind]
  if (typeof limit !== 'number') {
    return { text: String(text), dropped: 0, verdict: 'UNBUDGETED', reason: `no budget for "${kind}"` }
  }
  let lines = String(text).split('\n')
  let dropped = 0

  while (lines.join('\n').length > limit) {
    const head = lines.findIndex((l) => DID_HEADING.test(l))
    if (head === -1) break

    let end = lines.length
    for (let i = head + 1; i < lines.length; i += 1) {
      if (SECTION_HEADING.test(lines[i])) { end = i; break }
    }

    const victim = lines.slice(head + 1, end).findLastIndex((l) => DROPPABLE.test(l))
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
  if (chars > limit) {
    return { text: out, dropped, chars, limit, verdict: 'OVER',
      reason: `${chars} chars after dropping ${shed}, still ${chars - limit} over ${limit} — cut prose, never a failure` }
  }
  return { text: out, dropped, chars, limit, verdict: 'OK',
    reason: dropped === 0
      ? `${chars}/${limit}, nothing cut`
      : `${chars}/${limit} after dropping the last ${shed} of \u{1F4C4} Did` }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  // `process.argv` unsliced read the node binary as the kind when `--kind` was
  // missing. Sliced, an absent flag is an empty kind, which is UNBUDGETED.
  const argv = process.argv.slice(2)
  const kind = (argv.find((a) => a.startsWith('--kind=')) || '').split('=')[1]
    || flag(argv, 'kind', '')
  const wantsFit = argv.includes('--fit')
  let text = ''
  process.stdin.on('data', (d) => { text += d })
  process.stdin.on('end', () => {
    let budgets = DEFAULT_BUDGETS
    let markerRequired = DEFAULT_MARKER_REQUIRED
    let marker = DEFAULT_MARKER
    let source = 'fallback'
    try {
      const config = loadLoopConfig()
      const configured = config?.writing?.budgets
      if (configured) { budgets = configured; source = 'config' }
      if (config?.writing?.markerRequired) markerRequired = config.writing.markerRequired
      if (config?.identity?.commentMarker) marker = config.identity.commentMarker
    } catch (err) {
      // Two failures land here, and only one is routine. A missing file is
      // the fallback's whole purpose. A file that EXISTS and will not parse
      // is the silent-wrong-number bug this script was fixed for, so say it.
      if (!/not found/.test(err.message)) source = `fallback, loop-config.json unreadable: ${err.message}`
    }
    if (wantsFit) {
      // The fitted body goes to stdout so the caller can redirect it. The
      // verdict goes to stderr, so a redirect never swallows the report.
      const f = fit(text, kind, budgets)
      process.stdout.write(f.text)
      console.error(`${f.verdict} — ${f.reason} (${source})`)
      process.exit(f.verdict === 'OK' ? 0 : 1)
    }

    const r = check(text, kind, budgets, { markerRequired, marker })
    const d = detailsShare(text)
    console.log(`${r.verdict} — ${r.reason} (${source})${d.pct ? ` (${d.pct}% inside <details>, counted)` : ''}`)
    process.exit(r.verdict === 'OK' ? 0 : 1)
  })
}
