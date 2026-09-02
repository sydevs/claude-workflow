#!/usr/bin/env node

/**
 * The journal body's `📋 Awaiting you` table, rendered ready to paste.
 *
 * ⚠ **LOCAL ONLY** — it shells out to `gh`, which a routine cannot use. A cloud run builds the
 * same table from `search_issues assignee:<reviewer>`. The column set and the rules are here.
 *
 * This is the one section a reader trusts, and the skill has always said to build
 * it *from a query, never from memory* — which is a rule a run can follow
 * imperfectly and nobody can audit afterwards. Building it here makes "from a
 * query" structural: there is no path by which a remembered item reaches the
 * table, and no path by which a resolved one survives in it.
 *
 * A table rather than a bullet list because this is a triage surface, not prose:
 * the reviewer is scanning for *what needs me and how long has it waited*, and
 * columns let that be read down rather than parsed out of each line. `Since` is
 * the column bullets could never carry — an item waiting nine days looks exactly
 * like one waiting an hour when both are a sentence.
 *
 * ## What lands in it
 *
 * Everything assigned to `assignment.reviewer`, plus any open `proposal` that is
 * not (a proposal exists to be judged, so an unassigned one is still waiting on
 * a verdict). Nothing else — an item assigned to the bot is the loop's own work
 * and belongs in a different section.
 *
 * Usage:
 *   awaiting-review.mjs [--config path] [--json]
 */

import { search, loadLoopConfig, flag, repoScope } from '../../lib/gh.mjs'
import { readPr, ciVerdict } from '../../lib/merge-gate.mjs'

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const config = loadLoopConfig(flag(argv, 'config'))

const REVIEWER = config.assignment.reviewer
const JOURNAL = config.labels.journal
const JOURNAL_REPO = config.journalRepo
const SCOPE = repoScope(config)

const repoOf = (i) => /repos\/([^/]+\/[^/]+)\//.exec(i.url)?.[1] || ''
const numOf = (i) => Number(/\/issues\/(\d+)/.exec(i.url)?.[1])

/** `org/repo#N`, or a bare `#N` inside the journal's own repo where it resolves. */
function ref(item) {
  const repo = repoOf(item)
  return repo.endsWith(`/${JOURNAL_REPO}`) ? `${repo.split('/')[1]}#${numOf(item)}` : `${repo}#${numOf(item)}`
}

/** How long it has been waiting, at the granularity a reviewer cares about. */
function since(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 86_400_000)
  if (days >= 1) return `${days}d`
  const hours = Math.floor((Date.now() - new Date(iso)) / 3_600_000)
  return hours >= 1 ? `${hours}h` : 'today'
}

const byKey = new Map()
for (const item of search(`${SCOPE} is:open assignee:${REVIEWER} -label:${JOURNAL}`)) {
  byKey.set(item.html_url, item)
}
for (const item of search(`${SCOPE} is:issue is:open label:${config.labels.proposal} -label:${JOURNAL}`)) {
  if (!byKey.has(item.html_url)) byKey.set(item.html_url, item)
}

const rows = []
for (const item of byKey.values()) {
  const labels = (item.labels || []).map((l) => l.name)
  let icon = '👀'
  let waiting = 'Your input'

  if (item.pull_request) {
    // CI is read for PRs only, and its failure is not fatal: a table that omits
    // one clause still tells the reviewer the PR is waiting, where a crash tells
    // them nothing at all.
    let ci = null
    try {
      ci = ciVerdict(readPr(repoOf(item), numOf(item)), repoOf(item))
    } catch {
      ci = null
    }
    waiting = ci ? `Review — ${ci.green ? 'CI green' : ci.reason}` : 'Review'
  } else if (labels.includes(config.labels.proposal)) {
    icon = '💡'
    waiting = 'Verdict on the proposal'
  } else if (labels.includes(config.labels.needsInfo)) {
    icon = '❓'
    waiting = 'Your answer'
  }

  rows.push({
    icon,
    ref: ref(item),
    title: item.title,
    url: item.html_url,
    waiting,
    since: since(item.updated_at),
    sortKey: item.updated_at,
  })
}
rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

if (JSON_OUT) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  console.log('## 📋 Awaiting you\n')
  if (!rows.length) {
    // Never omitted, never "none" in a table with no rows: a reader must be able
    // to stop reading here rather than scroll to learn there is nothing to do.
    console.log('Nothing — the queue is clear.')
  } else {
    console.log('| | Item | Waiting for | Since |')
    console.log('| --- | --- | --- | --- |')
    for (const r of rows) {
      const title = r.title.replace(/\|/g, '\\|')
      console.log(`| ${r.icon} | [${r.ref} — ${title}](${r.url}) | ${r.waiting} | ${r.since} |`)
    }
  }
}
