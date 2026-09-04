---
name: journal
description: Write the run's flight-recorder entry and end the run — the closing step shared by /workflow:work-routine and /workflow:survey-routine; not a standalone workflow.
allowed-tools: Read, Grep, Glob
---

# Journal

Every run of either routine ends here. **One issue per day**, in `journalRepo`, labelled
`labels.journal`, created lazily by the day's first run.

## One document, rewritten. No comments.

**Every run rewrites the issue body. No run posts a comment.** The day is one document that grows a
few lines per run, not a thread.

The thread version cost 134,000 characters a day. One of them returned 97,279 characters in a single
response and broke the run that read it. A rewritten document holds the same facts in about 2,500.
(why: docs/why.md#ground-from-the-body-never-the-thread)

**Budget: `writing.budgets.journalComment`, counted with `<details>` included.**

```bash
printf '%s' "$BODY" | ${CLAUDE_PLUGIN_ROOT}/lib/budget.mjs --kind journalComment
```

Over budget means cut. Cut the oldest `📄 Did` lines first — they are the least load-bearing, and
GitHub records the same events natively. Never cut a failure.

## What the journal is for

**The board shows what needs doing. The journal records what happened.** `projects.url` answers
current state continuously, so any table here that restates it is a second copy of one fact.

The journal keeps only what nothing else records:

| Section | Why nothing else has it |
| --- | --- |
| `⚠️ Failed` | A tool refused, a gate broke, a claim proved wrong. GitHub records outcomes, never causes |
| `⏭️ Ceiling` | Work that did **not** happen, and the cap that stopped it. Nothing else records a non-event |
| `🧭 Friction` | Rules that misfired, prompt and skill discrepancies, drift a sweep corrected |
| `📄 Did` | One line per unit of work, with links |

**Its reader is `/workflow:reflect`**, on Sunday, counting what recurred. A human reads the board.

**Never write a `📋 Awaiting you` table.** It moved to the board. The body carries one `[Board]`
link from `projects.url`, and nothing more: **never read the board back.** It is a lens over state
this run already derived from sources, and no tool a routine holds reaches it.
(why: docs/why.md#the-board-is-a-lens)

## Evidence — for failures, not for bookkeeping

**Required** in `⚠️ Failed` and `🧭 Friction`, for any ceiling claim, and for any number a reader
cannot re-derive. Name the call or the query that produced it, or mark the claim as inference.

**Banned** for merges, pushes, CI status and review counts. GitHub records those, and a `<details>`
block restating them cost 51% of every byte the loop wrote.
(why: docs/why.md#every-claim-names-the-call-that-produced-it)

**Never diagnose the harness** — `/workflow:preflight`'s anomaly rule applies here in full.

## Finding today's issue — by creation date

The title changes every run, so it cannot be the key. Search
`repo:$ORG/$JOURNAL_REPO is:issue is:open label:ops-journal`, then take the issue whose `created_at`
falls on today's date in `journal.timezone`.
(why: docs/why.md#the-journal-day-is-a-local-date)

**Create it lazily.** A day the loop does nothing has no issue. On creation apply `labels.journal`,
assign nobody, never add `labels.awaiting`, and **do not pin it**
(why: docs/why.md#do-not-pin-the-journal).

## The title reports health

```
Wed — 8 runs · 2 failed · 3 ceiling stops
```

Counts of what went wrong, not of what got done. The board shows volume.

| Term | Counts |
| --- | --- |
| `runs` | Rows in the run table, after this run adds its own |
| `failed` | Runs that recorded at least one `⚠️ Failed` line |
| `ceiling stops` | `⏭️ Ceiling` lines across the day |

A clean day reads `Wed — 6 runs, all clean`. Derive every number from the body you are about to
write, never from memory.

## Format — the whole body

````markdown
**<N> runs today.** Last: <ISO timestamp>. · [Board](<projects.url>)

## ⚠️ Failed
- `<HH:MM>` <what broke, one line> — <the call that showed it>

## ⏭️ Ceiling
- `<HH:MM>` <rung> — <which ceiling, and what it left undone>

## 🧭 Friction
- `<HH:MM>` <a rule that misfired, a discrepancy, drift a sweep corrected>

## 📄 Did
- `<HH:MM>` 🔀 [repo#N — <title>](url) · closed [repo#M](url)
- `<HH:MM>` 📦 [repo#N — <title>](url) — implements [repo#M](url) · CI green
- `<HH:MM>` 💬 [repo#N — <title>](url) — replied about <topic>
- `<HH:MM>` 🧐 [repo#N — <title>](url) — reviewed: <clean, or N findings>
- `<HH:MM>` 🔍 <survey name> — <verdict, one line>

| Run | Window |
| --- | --- |
| 04:00 | ~2h |
| 06:00 | ~2h |
````

## Rules

- **Append your lines to the existing sections. Never delete another run's lines**, except to stay
  inside budget, and then only from `📄 Did`.
- **Every line starts with its run's `HH:MM`**, so Sunday can attribute a failure without a thread.
- **`⚠️ Failed` always appears.** Its absence looks the same as forgetting it. "none" is complete.
- **Omit `⏭️ Ceiling`, `🧭 Friction` and `📄 Did` when empty.**
- **A ceiling line names the ceiling and the cost**: "rung 5 — `maxWorkItemsPerRun`, no adversarial
  review, 3 PRs now unreviewed". "Skipped, out of budget" tells Sunday nothing.
- **Every link carries the ticket title.** A bare number costs the reader a tab.
- **Full `org/repo#N` outside `journalRepo`.** A bare `#N` resolves against the rendering repo.
- Emoji are a fixed vocabulary: 🔀 merged · 📦 built · 💬 replied · 🧐 reviewed · 🔬 investigated ·
  🔍 surveyed · 🛑 not started.

## `<details>` survives the write path — MCP readback lies

- **Trust the write.** A 200 from `issue_write` means the tags are stored.
- **The MCP read path strips `<details>`**, so a run that verifies its own write sees the block
  missing. It did not fail. Do not re-post. Do not file a ticket about it.
- **WebFetch is not a check either** — its markdown conversion renders the content as plain text.
  (why: docs/why.md#details-survives-the-write-path)

**Correct an earlier line in place.** The body is the record, so an error is edited, not appended
to. (why: docs/why.md#correcting-an-earlier-claim)

## Ending

Write the body, then stop. Do not poll. Do not wait for a review. Do not keep a timer alive.
**Do not try to end the session** — a run cannot. A lingering session has nothing to wake it and
nothing to do if it wakes. (why: docs/why.md#sessions-linger)

Close with two lines: what failed, and what the next run picks up.
