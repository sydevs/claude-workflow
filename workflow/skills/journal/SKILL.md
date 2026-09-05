---
name: journal
description: Write the run's flight-recorder entry, then end the run — the closing step for /workflow:work-routine and /workflow:survey-routine, not standalone.
allowed-tools: Read, Grep, Glob
---

# Journal

Every run of either routine ends here. **One issue per day**, in `journalRepo`, labelled
`labels.journal`. The day's first run creates it.

## One document, rewritten. No comments.

**Every run rewrites the issue body. No run posts a comment.** The day is one document, never a
thread — a threaded version once broke a run on a single 97,279-character reply. A rewritten
document holds the same facts in about 2,500 characters.
(why: docs/why.md#ground-from-the-body-never-the-thread)

**Budget: `writing.budgets.journalComment`, counted with `<details>` included.**

```bash
printf '%s' "$BODY" | ${CLAUDE_PLUGIN_ROOT}/lib/budget.mjs --kind journalComment
```

Over budget means cut, oldest `📄 Did` lines first — GitHub already records those events. Never
cut a failure.

## What the journal is for

**The board shows what needs doing. The journal records what happened.** `projects.url` already
covers current state. The journal keeps only what nothing else records:

| Section | Why nothing else has it |
| --- | --- |
| `⚠️ Failed` | A tool refused, a gate broke, or a claim proved wrong |
| `⏭️ Ceiling` | Skipped work, and the cap that stopped it |
| `🧭 Friction` | A misfired rule, a prompt-skill mismatch, drift a sweep corrected |
| `📄 Did` | One line per unit of work, with links |

`/workflow:reflect` reads this on Sunday and counts what recurred. A human reads the board.

**Never write a `📋 Awaiting you` table.** It moved to the board. The body carries only one
`[Board]` link from `projects.url`. **Never read the board back** — it is a lens over state this
run already derived, and no tool here reaches it. (why: docs/why.md#the-board-is-a-lens)

## Evidence — for failures, not for bookkeeping

**Required** in `⚠️ Failed`, `🧭 Friction`, any ceiling claim, and any number a reader cannot
re-derive. Name the call that produced it, or mark the claim as inference.

**Banned** for merges, pushes, CI status and review counts — GitHub already records those, and a
restating `<details>` block once cost half the loop's output.
(why: docs/why.md#every-claim-names-the-call-that-produced-it)

**Never diagnose the harness.** `/workflow:preflight`'s anomaly rule applies here in full.

## Finding today's issue — by creation date

The title changes every run, so it cannot be the key. Search
`repo:$ORG/$JOURNAL_REPO is:issue is:open label:ops-journal`, then take the issue created today in
`journal.timezone`. (why: docs/why.md#the-journal-day-is-a-local-date)

**Create it lazily** — a day the loop does nothing has no issue. On creation, apply
`labels.journal`, assign nobody, never add `labels.awaiting`, and **do not pin it**.
(why: docs/why.md#do-not-pin-the-journal)

## The title reports health

```
Wed — 8 runs · 2 failed · 3 ceiling stops
```

Counts of what went wrong, not what got done — the board already shows volume.

| Term | Counts |
| --- | --- |
| `runs` | Rows in the run table, plus this run |
| `failed` | Runs that recorded a `⚠️ Failed` line |
| `ceiling stops` | `⏭️ Ceiling` lines across the day |

A clean day reads `Wed — 6 runs, all clean`. Derive every number from the body, never memory.

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
````

## Rules

- **Append lines to existing sections. Never delete another run's lines**, except to stay in
  budget — then cut only from `📄 Did`.
- **Every line starts with its run's `HH:MM`**, so Sunday can attribute a failure without a thread.
- **`⚠️ Failed` always appears.** Its absence looks the same as forgetting it. "none" is complete.
- **Omit `⏭️ Ceiling`, `🧭 Friction` and `📄 Did` when empty.**
- **Name the ceiling and the cost**: "rung 5 — `maxWorkItemsPerRun`, 3 PRs unreviewed", not
  "skipped, out of budget".
- **Every link carries the ticket title** — a bare number costs the reader a tab.
- **Use the full `org/repo#N` outside `journalRepo`** — a bare `#N` resolves against the
  rendering repo.
- Emoji are a closed set: 🔀 merged · 📦 built · 💬 replied · 🧐 reviewed · 🔬 investigated ·
  🔍 surveyed · 🛑 not started.

## `<details>` survives the write — MCP readback lies

- **Trust the write.** A 200 from `issue_write` means the write stored the tags.
- **The MCP read path strips `<details>`.** A run checking its own write sees the block missing.
  The write did not fail. Do not re-post it, and do not file a ticket about it.
- **WebFetch is not a check either** — its markdown conversion renders the content as plain text.
  (why: docs/why.md#details-survives-the-write-path)

**Edit an earlier line in place** — the body is the record, so correct an error there and never
append a new line about it. (why: docs/why.md#correcting-an-earlier-claim)

## Ending

Write the body, then stop. Do not poll. Do not wait for a review. Do not keep a timer alive.
**Do not try to end the session** — a run cannot. A lingering session has nothing to wake it and
nothing to do if it wakes. (why: docs/why.md#sessions-linger)

Close with two lines: what failed, and what the next run picks up.
