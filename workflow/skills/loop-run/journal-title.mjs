#!/usr/bin/env node

/**
 * Compute today's ops-journal title from what the loop actually did:
 *
 *   Wed — 2 new, 1 revised, 2 merged, 1 closed
 *
 * Zero terms are omitted; a day with nothing to show is `Wed — no changes`.
 *
 * ## Why a script and not a sentence
 *
 * The title was free prose, rewritten by the model on every run — nine times a
 * day, each one re-reading the day's work to re-summarise it, and each one a
 * chance to describe activity the run only believes happened. Counts come from
 * queries, cost nothing to regenerate, and are the same on the ninth run as on
 * the first. The *narrative* still belongs in the body, where it has room.
 *
 * ## Definitions, because "the day's work" has edges
 *
 * The unit is a WORK ITEM — an issue and the PR that closes it are one thing, not
 * two. `Closes #N` in a PR body is what pairs them, so a ticket and its PR never
 * double-count.
 *
 *   new      issues (never PRs) the bot opened today. Journals are excluded:
 *            the journal counting itself is how a quiet day reads as a busy one.
 *   revised  work items handed back to the reviewer today — an `assigned` event
 *            naming the reviewer, actor the bot. The hand-back IS the completion
 *            of a revision under the baton model, so it is both the cheapest
 *            signal and the truest one: a push that stalled before the hand-back
 *            has not delivered anything a reviewer can act on. Items whose issue
 *            was opened today are excluded — those are `new`.
 *   merged   PRs the bot authored that merged today.
 *   closed   work items closed today WITHOUT merging. An issue auto-closed by its
 *            own merged PR is the merge, counted once, under `merged`.
 *
 * Everything is scoped to the bot's own authorship. The journal is the loop's
 * record, and a headline that silently absorbed the reviewer's merges would
 * report their afternoon as its own.
 *
 * ## The day is a Vancouver day
 *
 * Ranges are built with the zone's real UTC offset, so the query means the same
 * thing in August and December. GitHub's search date qualifiers take an ISO8601
 * offset; without one they mean UTC, which splits each local day across two
 * journals, which is why `journal.timezone` exists at all.
 *
 * ## Usage
 *
 *   journal-title.mjs [--date YYYY-MM-DD] [--config path] [--json]
 *
 * `--date` is a Vancouver date and defaults to today. Exits non-zero only when
 * the config or `gh` is unusable; a day with no activity is a success with the
 * `no changes` title.
 */

import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const JSON_OUT = args.includes('--json')

/** Pages of 100 issue events per repo. Three days of this org's traffic fits in one. */
const EVENT_PAGE_CAP = 5

/** Walk up from a starting point looking for loop-config.json. */
function findConfig() {
  const explicit = flag('config')
  if (explicit) return resolve(explicit)

  const starts = [process.cwd(), join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')]
  for (const start of starts) {
    let dir = resolve(start)
    for (;;) {
      const candidate = join(dir, 'loop-config.json')
      if (existsSync(candidate)) return candidate
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  return null
}

const configPath = findConfig()
if (!configPath) {
  console.error('loop-config.json not found. Run from the claude-workflow checkout or pass --config.')
  process.exit(1)
}
const config = JSON.parse(readFileSync(configPath, 'utf-8'))

const ORG = config.org
const BOT = config.assignment?.bot
const REVIEWER = config.assignment?.reviewer
const JOURNAL_LABEL = config.labels?.journal
const ZONE = config.journal?.timezone || 'America/Vancouver'

if (!ORG || !BOT || !REVIEWER) {
  console.error('loop-config.json is missing org / assignment.bot / assignment.reviewer.')
  process.exit(1)
}

/**
 * The zone's UTC offset on a given date, as `+HH:MM`. Derived from
 * `Intl.DateTimeFormat` rather than hardcoded, so a DST boundary shifts the
 * window instead of silently mis-slicing the day by an hour.
 */
function offsetFor(date, timeZone) {
  const at = new Date(`${date}T12:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value
  const m = /GMT([+-]\d{2}:\d{2})/.exec(parts || '')
  return m ? m[1] : '+00:00'
}

const DAY = flag('date') || new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date())
const OFFSET = offsetFor(DAY, ZONE)
const FROM = `${DAY}T00:00:00${OFFSET}`
const TO = `${DAY}T23:59:59${OFFSET}`
const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(
  new Date(`${DAY}T12:00:00Z`),
)

/** One search page is enough: a day the loop touches 100 items is not a day this title can describe. */
function search(query) {
  const out = execFileSync(
    'gh',
    ['api', '-X', 'GET', 'search/issues', '-f', `q=${query}`, '-F', 'per_page=100'],
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 },
  )
  return JSON.parse(out).items || []
}

/** One page. `--paginate` is deliberately NOT used: it overrides an explicit
 *  `page=` and walks the whole feed, which is the opposite of the early exit the
 *  reverse-chronological read depends on. */
function api(path) {
  const out = execFileSync('gh', ['api', path], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  })
  return JSON.parse(out)
}

/** `sydevs/SahajCloud#181` from any issue/PR search item, via its API url. */
function keyOf(item) {
  const m = /repos\/([^/]+\/[^/]+)\/issues\/(\d+)/.exec(item.url)
  return m ? `${m[1]}#${m[2]}` : item.html_url
}

function repoOf(item) {
  return /repos\/([^/]+\/[^/]+)\//.exec(item.url)?.[1] || null
}

/**
 * The issue a PR closes, as a pair key — the whole reason a ticket and its PR
 * count once.
 *
 * Asked of GitHub rather than parsed out of the body. `closingIssuesReferences`
 * is the same resolution the merge itself uses, so it agrees with what actually
 * closes; a regex over the body agrees only with the convention. It also picks up
 * links made through the sidebar, which leave no text at all, and it resolves
 * cross-repo references without guessing which repo a bare `#12` meant.
 *
 * The body regex survives as a fallback for a token that cannot reach GraphQL —
 * wrong pairing is recoverable (an item counted twice), a crash is not.
 */
const pairCache = new Map()
export function closesFrom(item) {
  const repo = repoOf(item)
  const num = /\/issues\/(\d+)/.exec(item.url)?.[1]
  if (!repo || !num) return []

  const cacheKey = `${repo}#${num}`
  if (pairCache.has(cacheKey)) return pairCache.get(cacheKey)

  let keys
  try {
    const [owner, name] = repo.split('/')
    const q = `{repository(owner:"${owner}",name:"${name}"){pullRequest(number:${num}){closingIssuesReferences(first:20){nodes{number repository{nameWithOwner}}}}}}`
    const out = execFileSync('gh', ['api', 'graphql', '-f', `query=${q}`], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const nodes =
      JSON.parse(out).data?.repository?.pullRequest?.closingIssuesReferences?.nodes || []
    keys = nodes.map((n) => `${n.repository.nameWithOwner}#${n.number}`)
  } catch {
    keys = closesFromBody(item.body, repo)
  }

  pairCache.set(cacheKey, keys)
  return keys
}

/** Fallback: both reference forms GitHub honours in a PR body. */
export function closesFromBody(body, repo) {
  const keys = new Set()
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/gi
  for (const m of String(body || '').matchAll(re)) keys.add(`${m[1] || repo}#${m[2]}`)
  return [...keys]
}

/**
 * Pair keys the bot handed to the reviewer today.
 *
 * Two stages, because neither endpoint answers the question alone.
 *
 * FIND with each repo's `issues/events` feed. It is reverse-chronological, so
 * paging stops at the first event older than the window — five calls, where a
 * search-then-timeline pass made one call per candidate and took 23 seconds on a
 * rung that runs nine times a day. It is also the more correct net: every search
 * qualifier for "was active today" really filters on the item's CURRENT
 * `updated_at`, so an item touched again later still matches while one that fell
 * out of the index does not. The event feed is the record itself.
 *
 * CONFIRM with the item's own timeline, because the repo feed's `actor` on an
 * `assigned` event is the ASSIGNEE, not whoever assigned them. Measured, not
 * assumed: the feed reports SahajAtlasWeb#171 at 15:30 as `actor=Ardnived`, and
 * the timeline for the same event reads `->Ardnived by sydevs-bot`. Trusting the
 * feed's actor would have counted the reviewer's own triage as the loop's work —
 * silently, and only ever upward.
 */
function handBacksToday() {
  const from = new Date(FROM).toISOString()
  const to = new Date(TO).toISOString()
  const candidates = new Map()

  for (const repo of config.repos || []) {
    const slug = `${ORG}/${repo}`
    for (let page = 1; page <= EVENT_PAGE_CAP; page++) {
      let events
      try {
        events = api(`repos/${slug}/issues/events?per_page=100&page=${page}`)
      } catch {
        break
      }
      if (!events?.length) break

      for (const e of events) {
        if (e.event !== 'assigned' || e.assignee?.login !== REVIEWER) continue
        if (e.created_at < from || e.created_at > to || !e.issue) continue
        candidates.set(`${slug}#${e.issue.number}`, { repo: slug, issue: e.issue })
      }
      // Reverse-chronological: once a page ends before the window opens, so does
      // every page after it.
      if (events[events.length - 1].created_at < from) break
    }
  }

  return [...candidates.values()].filter(({ repo, issue }) => {
    let timeline
    try {
      timeline = api(`repos/${repo}/issues/${issue.number}/timeline?per_page=100`)
    } catch {
      return false
    }
    return timeline.some(
      (e) =>
        e.event === 'assigned' &&
        e.assignee?.login === REVIEWER &&
        e.actor?.login === BOT &&
        e.created_at >= from &&
        e.created_at <= to,
    )
  })
}

const journalFilter = JOURNAL_LABEL ? ` -label:${JOURNAL_LABEL}` : ''

// ── new ─────────────────────────────────────────────────────────────────────
const newIssues = search(
  `org:${ORG} is:issue author:${BOT} created:${FROM}..${TO}${journalFilter}`,
)
const newKeys = new Set(newIssues.map(keyOf))

// ── merged ──────────────────────────────────────────────────────────────────
const mergedPrs = search(`org:${ORG} is:pr author:${BOT} merged:${FROM}..${TO}`)
const mergedIssueKeys = new Set(mergedPrs.flatMap(closesFrom))

// ── closed (without merging) ────────────────────────────────────────────────
const closedPrs = search(
  `org:${ORG} is:pr author:${BOT} is:unmerged is:closed closed:${FROM}..${TO}`,
)
const closedPrIssueKeys = new Set(closedPrs.flatMap(closesFrom))

const closedIssues = search(
  `org:${ORG} is:issue author:${BOT} is:closed closed:${FROM}..${TO}${journalFilter}`,
)
// An issue already accounted for by a PR — merged or closed — is that PR's pair,
// not a second item. Everything else closed today stands alone.
const orphanClosedIssues = closedIssues.filter(
  (i) => !mergedIssueKeys.has(keyOf(i)) && !closedPrIssueKeys.has(keyOf(i)),
)
const closed = closedPrs.length + orphanClosedIssues.length

// Every pair key that reached a terminal outcome today, in either bucket. A pair
// counted here is not ALSO counted as revised — a ticket revised at 15:30 whose
// PR merges at 16:14 is one work item finishing, and `1 revised, 1 merged` would
// read as two. The terminal outcome wins: it is the one that ended the story.
const settledKeys = new Set([
  ...mergedPrs.map(keyOf),
  ...mergedIssueKeys,
  ...closedPrs.map(keyOf),
  ...closedPrIssueKeys,
  ...orphanClosedIssues.map(keyOf),
])

// ── revised ─────────────────────────────────────────────────────────────────
const revisedKeys = new Set()
for (const { repo, issue } of handBacksToday()) {
  if (!issue) continue
  const own = `${repo}#${issue.number}`
  // A PR counts under its ticket's key, so revising the pair twice — once on the
  // issue, once on the PR — is still one item.
  const key = issue.pull_request ? closesFrom({ url: issue.url, body: issue.body })[0] || own : own
  if (newKeys.has(key) || settledKeys.has(key) || settledKeys.has(own)) continue
  revisedKeys.add(key)
}

// ── title ───────────────────────────────────────────────────────────────────
const counts = {
  new: newIssues.length,
  revised: revisedKeys.size,
  merged: mergedPrs.length,
  closed,
}

const parts = Object.entries(counts)
  .filter(([, n]) => n > 0)
  .map(([label, n]) => `${n} ${label}`)

const title = `${WEEKDAY} — ${parts.length ? parts.join(', ') : 'no changes'}`

// The item keys ride along in --json so the body can cite what the title counts,
// and so a surprising number is checkable without re-deriving the queries.
const items = {
  new: newIssues.map(keyOf),
  revised: [...revisedKeys],
  merged: mergedPrs.map(keyOf),
  closed: [...closedPrs.map(keyOf), ...orphanClosedIssues.map(keyOf)],
}

if (JSON_OUT) console.log(JSON.stringify({ title, date: DAY, zone: ZONE, counts, items }, null, 2))
else console.log(title)
