---
name: journal
description: Write the run's flight-recorder entry and end the run — the closing step shared by /workflow:work-routine and /workflow:survey-routine; not a standalone workflow.
allowed-tools: Read, Grep, Glob
---

# Journal

Every run of either routine ends here. **One journal issue per day**, in `journalRepo`, labelled
`labels.journal`, created lazily by the day's first run — whichever routine that is.

## What the journal is for

**The board shows what needs doing; the journal records what happened.** Since
`projects.url` went live, current state — what is pending, what is `awaiting`, whose turn it is — is
answered continuously by a surface that cannot go stale, and any table here restating it is a second
implementation of one rule, which is this repo's oldest failure.

So the journal keeps only what nothing else records:

| Section | Why it cannot be derived elsewhere |
| --- | --- |
| `⚠️ Failed` | A tool that refused, a gate that broke, a claim that turned out wrong. GitHub records the outcome, never the cause |
| `⏭️ Ceiling` | Work that did **not** happen, and which cap stopped it. Nothing else records a non-event |
| `🧭 Friction` | Rules that misfired, prompt/skill discrepancies, drift the sweeps corrected |
| `📄 Did` | One line per unit of work, with links. The audit trail, not the status |

**Its reader is `/workflow:reflect`**, on Sunday, looking for what recurred. Write for that: state
each failure and each ceiling stop plainly enough that seven days of them can be counted without
re-deriving anything. A human reading at 6am is served by the board.

**Never write a `📋 Awaiting you` table.** It moved to the board, permanently.
(why: docs/why.md#the-board-is-a-lens)

## Every claim names the call that produced it

A journal entry is read as measured fact, so **every factual claim about system state either names
the tool call or query that produced it, or is explicitly marked as inference.**

- **Scope: claims of fact about system state** — counts, statuses, timestamps, what a tool returned,
  whether something ran. Not every sentence.
- **Cite in the `<details>` block**: the query string, the tool name, a PR/issue URL, or a command
  and its exit status. One citation may cover several bullets from the same call.
- **Mark inference as inference** ("appears to", "inferred from"). If you cannot name a call for a
  claim of fact, either make the call or delete the claim.
- **Never diagnose the harness** — the anomaly rule in `/workflow:preflight`'s Non-negotiables
  applies here in full. (why: docs/why.md#every-claim-names-the-call-that-produced-it)

## Finding today's issue — by creation date, not by title

The title changes on every run, so it cannot be the key. Fetch the open journals — at most a week of
them — with `search_issues query:"repo:$ORG/$JOURNAL_REPO is:issue is:open label:ops-journal"`,
and pick the one whose `created_at`, converted to **Vancouver time** (`journal.timezone`), falls on
today's Vancouver date. (why: docs/why.md#the-journal-day-is-a-local-date)

**Create it lazily** if absent — no issue exists for a day the loop does nothing. On creation:
apply `labels.journal`; leave it **unassigned** and never `labels.awaiting`, because a diary is not
work; and **do not pin it** (why: docs/why.md#do-not-pin-the-journal).

## The title is computed, and it reports health

```
Wed — 8 runs · 2 failed · 3 ceiling stops
```

**Counts of what went wrong, not of what got done.** Volume — filed, opened, merged, closed — is on
the board and in GitHub's own activity; repeating it here costs a re-read every run and tells the
Sunday reader nothing they could act on. What they can act on is where the machine stalled.

| Term | Counts |
| --- | --- |
| `runs` | Comments on today's journal issue, after this one is posted |
| `failed` | Runs whose entry carries at least one `⚠️ Failed` bullet |
| `ceiling stops` | `⏭️ Ceiling` bullets across the day, summed — one per rung skipped, not per run |

- **A clean day is `Wed — 6 runs, all clean`.** Say it in those words; a reader must be able to skip
  the day in one glance.
- **Derive the numbers by reading today's comments**, never from memory of what this run did.
- **Day of week, not a date.** The full date is the issue's creation time, which is sortable and
  filterable in a way a title string is not.

## Two surfaces, two jobs

| Surface | Job |
| --- | --- |
| **A new comment**, one per run | This run's entry, in the format below. Append-only |
| **The issue body**, rewritten every run | The day's index: a link per run, and today's failures collected |

- **Rewrite the body in full every run; never append to it.**
  (why: docs/why.md#the-body-is-rewritten-not-appended)
- The body carries **no queue and no state** — one line per run, then today's `⚠️ Failed` and
  `⏭️ Ceiling` bullets gathered so Sunday can read one comment per day instead of eight.

## Format

````markdown
### <ISO timestamp> · <loop|nightly> · [session](<url>)

Window since the last entry: ~Nh.

## ⚠️ Failed
- <what broke, in one line — then the call that showed it, in the details block>

## ⏭️ Ceiling
- <rung> — <which ceiling, and what it left undone>

## 🧭 Friction
- <a rule that misfired, a discrepancy, a drift the sweep corrected>

## 📄 Did
- 🔀 [repo#N — <title>](url) · closed [repo#M](url)
- 📦 [repo#N — <title>](url) — implements [repo#M](url) · CI green
- 💬 [repo#N — <title>](url) — replied about <topic>
- 🧐 [repo#N — <title>](url) — reviewed: <clean, or "N findings">
- 🔬 [repo#N — <title>](url) — investigated · verdict: <one clause>
- 🔍 <survey name> — <verdict in one line>

<details>
<summary>Evidence and detail</summary>

<!-- The queries and tool calls behind each claim above, plus file lists,
     commit SHAs, CI durations, counts checked, tool limitations hit, and
     the reasoning behind a judgement call. -->

</details>
````

## Rules

- **`⚠️ Failed` always appears**, because its absence is indistinguishable from forgetting it. "none"
  is a complete entry.
- **Omit `⏭️ Ceiling`, `🧭 Friction` and `📄 Did` when empty** rather than printing "none".
- **A ceiling bullet names the ceiling and the cost**: "rung 5 — `maxWorkItemsPerRun`, no
  adversarial review; 3 PRs are now unreviewed". "Skipped, out of budget" is not actionable in
  seven days' time.
- **Every bullet carries the ticket title inside the link.** A bare number forces a tab.
- **Full `org/repo#N` for anything outside `journalRepo`** — a bare `#N` resolves against the repo
  the comment renders in and silently links somewhere wrong.
- **One line per bullet.** Anything longer belongs in the collapsible block.
- Emoji are a fixed vocabulary, not decoration: 🔀 merged · 📦 built · 💬 replied · 🧐 reviewed ·
  🔬 investigated · 🔍 surveyed · 🛑 not started.
- **Never use the words "rung" or "ladder" outside `⏭️ Ceiling`**, where naming the rung is the
  point.

## `<details>` survives the write path — MCP readback lies about it

- **Trust the write.** A 200 from `issue_write` / `pull_request_write` means the tags are stored,
  whatever a subsequent MCP read shows.
- **The MCP read path strips `<details>`/`<summary>`** from what it returns, so a run verifying its
  own write sees its collapsible sections missing. It did not fail. **Do not "fix" it, do not
  re-post, do not file a ticket about it.**
- **WebFetch is not a check either** — its markdown conversion renders `<details>` content as
  visible text, so "the public page shows plain prose" is the conversion, not the page.
- The only faithful readback is REST, which a cloud session does not have.
  (why: docs/why.md#details-survives-the-write-path)

## The body

Rewritten in full by every run. An index, not a second copy of the entries.

````markdown
**<N> runs today.** Last: <ISO timestamp>. · [Board](<projects.url>)

## ⚠️ Failed today
- <every ⚠️ bullet from today's comments, or omit the section>

## ⏭️ Ceilings hit today
- <every ⏭️ bullet from today's comments, or omit the section>

| Run | Entry |
| --- | --- |
| 04:00 | [detail](<comment url>) |
| 06:00 | [detail](<comment url>) |
````

The Board link is `projects.url` from `loop-config.json` — a link and nothing more. **Never read the
board back**: it is a lens over state this run already derived from sources, and no tool available
to a routine reaches it. (why: docs/why.md#the-board-is-a-lens)

There is **no month table.** The journal is one issue per day; a month's worth is what the Sunday
`reflect` survey reads across issues.

**Correct an earlier claim in the body, not with an addendum comment.** The comment stays as the
historical record of what that run believed at the time. Only add a correcting comment when the
error would change what someone *did*. (why: docs/why.md#correcting-an-earlier-claim)

## Ending

Post the journal, then stop. Do not poll, do not wait for a review, do not keep a timer alive "in
case". **Do not attempt to end the session** — a run has no way to. What matters is that a lingering
session has nothing to wake it (never subscribe) and nothing to do if it does wake.
(why: docs/why.md#sessions-linger)

Close with two lines: what failed, and what the next run will pick up. If a ceiling stopped every
step, say so — that is the signal the Sunday `reflect` survey acts on.
