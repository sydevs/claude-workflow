---
name: journal
description: Write the run's journal entry and end the run — the closing step shared by /workflow:work-routine and /workflow:survey-routine; not a standalone workflow.
allowed-tools: Read, Grep, Glob
---

# Journal

Every run of either routine ends here. **One journal issue per day**, in `journalRepo`, labelled
`labels.journal`, created lazily by the day's first run — whichever routine that is.

## Every claim names the call that produced it

A journal entry is read as measured fact, so **every factual claim about system state either names
the tool call or query that produced it, or is explicitly marked as inference.**

- **Scope: claims of fact about system state** — counts, statuses, timestamps, what a tool returned,
  what a PR or repo contains, whether something ran. Not every sentence.
- **Cite in the `<details>` block**: the query string, the tool name, a PR/issue URL, or a command
  and its exit status. One citation may cover several bullets from the same call.
- **Mark inference as inference** ("appears to", "inferred from"). If you cannot name a call for a
  claim of fact, either make the call or delete the claim.
- **Never diagnose the harness in a journal entry** — the anomaly rule in `/workflow:preflight`'s
  Non-negotiables applies here in full.
  (why: docs/why.md#every-claim-names-the-call-that-produced-it)

## Finding today's issue — by creation date, not by title

The title changes on every run, so it cannot be the key. Fetch the open journals — at most a week of
them — with `search_issues query:"repo:$ORG/$JOURNAL_REPO is:issue is:open label:ops-journal"`,
and pick the one whose `created_at`, converted to **Vancouver time** (`journal.timezone`), falls on
today's Vancouver date. (why: docs/why.md#the-journal-day-is-a-local-date)

**Create it lazily** if absent — no issue exists for a day the loop does nothing. On creation:
apply `labels.journal`; leave it **unassigned**, because a journal is not work; and **do not pin
it** (why: docs/why.md#do-not-pin-the-journal).

## The title is computed, not written

```
Wed — 2 filed, 1 opened, 2 merged, 1 closed
```

**Counts, never prose.** A sentence costs a re-read of the whole day on every run and describes what
the run *believes* happened; four numbers describe what the queries returned. Derive them from the
searches below and nothing else — never from memory of what this run did.

| Term | Counts |
| --- | --- |
| `filed` | Issues the bot opened today. Never PRs; journals excluded |
| `opened` | PRs the bot opened today, draft or not |
| `merged` | PRs the bot authored that merged today |
| `closed` | Work items closed today without merging |

**All four are searches.** The term this replaced, `revised`, was defined as hand-backs — items
where an `assigned` event named the reviewer with the bot as actor. There are no hand-backs any
more, and there never was a way to count them: no MCP tool reads an issue timeline, and the REST
timeline event for a field change carries no field name and no old value. A number nothing can
measure does not belong in a title that is read as measured fact.

- **A work item is an issue and its PR together**, paired through
  `closingIssuesReferences`, so a ticket and its PR never count twice.
- **The buckets are exclusive.** A PR that opened and merged on the same day counts as `merged`
  only — the terminal outcome is the one that ended its story.
- **Zero terms are dropped**; a day with nothing is `Wed — no changes`.
- **Day of week, not a date.** The full date is the issue's creation time, which is sortable and
  filterable in a way a title string is not.

Each count is one search, scoped by `repo:` qualifiers over `repos`, with `<from>..<to>` spanning the
Vancouver day (use the zone's real UTC offset — `-07:00` or `-08:00` — since a bare date means UTC and
splits the day across two journals):

```
is:issue author:<bot> created:<from>..<to> -label:ops-journal      → filed
is:pr    author:<bot> created:<from>..<to>                          → opened
is:pr    author:<bot> merged:<from>..<to>                           → merged
is:pr    author:<bot> is:unmerged is:closed closed:<from>..<to>  ┐
is:issue author:<bot> is:closed closed:<from>..<to>              ┘ → closed, deduped
```

## Two surfaces, two jobs

| Surface | Job |
| --- | --- |
| **A new comment**, one per run | Append-only detail. This run's entry, in the format below |
| **The issue body**, rewritten every run | The rolling summary of the whole day: what is done, and what awaits the reviewer |

- **Rewrite the body in full every run; never append to it.**
  (why: docs/why.md#the-body-is-rewritten-not-appended)
- **Never leave a stale `📋 Awaiting you` in the body** — it is the one section a reader trusts, and
  a wrong one is worse than none.
- **Build `📋 Awaiting you` from queries, not from memory.** Two searches and one field filter,
  from what `/workflow:preflight` already fetched. **Scope by `repo:` qualifiers, never `org:`** —
  the org still holds retired repositories, and a bare org scope put seven-year-old `Atlas` and
  `WeMeditate` issues in the reviewer's queue the first time this was run as a query.

  | | Row | Comes from | `Since` |
  | --- | --- | --- | --- |
  | 💡 | `Stage: Proposed` | `$SCOPE is:issue is:open assignee:<reviewer>` | the issue's `created_at` |
  | ❓ | `Stage: Revising` **whose last comment is the loop's** | that same set, plus `$SCOPE is:issue is:open assignee:<bot>` | that comment's `created_at` |
  | 👀 | Ready for review | `$SCOPE is:pr is:open assignee:<bot> draft:false review:none` | the PR's `created_at` |

- **A live `Hold Until` excludes an item from this table and from the whole entry.** Held work is
  not "awaiting you" — the loop has promised to look again on a date, and listing it asks for
  attention that was explicitly deferred. The one exception is naming it as another ticket's blocker.
- **The ❓ row is derived, never stored.** A `Revising` ticket whose last word is the loop's is
  waiting on the reviewer by construction; one whose last word is theirs is the loop's work next run
  and belongs in no row here. This is why there is no "needs info" field to leave stale.
- ⚠ **Never use `updated_at` for `Since`.** A field write bumps it, so a ticket the loop merely
  re-Staged would read as fresh. Use the timestamps named in the table.
  (why: docs/why.md#derive-the-window-from-comment-timestamps)
- **It is a table, not a list.** This is a triage surface: the reviewer is scanning for *what needs
  me and how long has it waited*, which reads down a column and does not read out of a sentence.
  `Since` is the column a bullet list could not carry at all — an item waiting nine days and one
  waiting an hour look identical when both are prose. **Oldest first.**
- **One row per work item.** An issue and the PR that closes it are one thing; link the PR, since
  that is where the reviewing happens.
- **Write for someone reading at 6am who was not here yesterday.** Never use the words "rung" or
  "ladder". Use the section headings below verbatim.

## Format

````markdown
### <ISO timestamp> · <loop|nightly> · [session](<url>)

Window since the last entry: ~Nh.

## 📋 Awaiting you

| | Item | Waiting for | Since |
| --- | --- | --- | --- |
| 👀 | [repo#N — <ticket title>](url) | Review — CI green | 2d |
| ❓ | [repo#N — <ticket title>](url) | Your answer | 4h |
| 💡 | [repo#N — <ticket title>](url) | Verdict on the proposal | today |

## ✅ Merged
- 🔀 [repo#N — <title>](url) · closed [repo#M](url)

## 🔧 Changed
- ✏️ [repo#N — <title>](url) — <what changed, one clause>
- 💬 [repo#N — <title>](url) — replied about <topic>
- 🧐 [repo#N — <title>](url) — reviewed: <clean, or "N findings, handed back">

## 🚀 Built
- 📦 [repo#N — <title>](url) — implements [repo#M](url) · CI green
- 🔬 [repo#N — <title>](url) — investigated · verdict: <one clause>
- 🛑 [repo#N — <title>](url) — not started: <why, one clause>

## 🔍 Surveyed
- <survey name> — <verdict in one line>

## ⏭️ Skipped
- <section> — <why: empty, or which ceiling>

## ⚠️ Failed
- <plainly, or "none">

<details>
<summary>Evidence and detail</summary>

<!-- The queries and tool calls behind each claim above, plus file lists,
     commit SHAs, CI durations, counts checked, tool limitations hit, and
     the reasoning behind a judgement call. -->

</details>
````

## Rules

- **`## 📋 Awaiting you` is always first and never omitted.** Empty is "nothing awaiting you" — a
  reader must never scroll to learn there is nothing to do.
- **Omit any other section that is empty**, rather than printing "none". Exception: `⚠️ Failed`,
  which always appears, because its absence is indistinguishable from forgetting it.
- **Every bullet carries the ticket title inside the link.** A bare number forces the reader to open
  a tab to learn what it was about.
- **Full `org/repo#N` for anything outside `journalRepo`** — a bare `#N` resolves against the repo
  the comment renders in and silently links somewhere wrong.
- **One line per bullet.** Anything longer belongs in the collapsible block.
- **The summary line is scannable prose, not a status code.** "declined — the Atlas form it mirrors
  does not exist yet" beats "declined (blocked)".
- Emoji are a fixed vocabulary, not decoration: 🔀 merged · ✏️ revised · 💬 replied · 📦 built ·
  🔬 investigated · 🛑 not started · 👀 needs review · ❓ needs an answer · 💡 proposal · 🔍 surveyed ·
  🧐 reviewed.

## `<details>` survives the write path — MCP readback lies about it

- **Trust the write.** A 200 from `issue_write` / `pull_request_write` means the tags are stored,
  whatever a subsequent MCP read shows.
- **The MCP read path strips `<details>`/`<summary>`** from what it returns, so a run verifying its
  own write via `pull_request_read` / `issue_read` sees its collapsible sections missing. It did not
  fail. **Do not "fix" it, do not re-post, do not file a ticket about it.**
- **WebFetch is not a check either** — its markdown conversion renders `<details>` content as
  visible text, so "the public page shows plain prose" is the conversion, not the page.
- The only faithful readback is REST, which a cloud session does not have.
  (why: docs/why.md#details-survives-the-write-path)

## The body: what the rolling summary looks like

Rewritten in full by every run. Short — it is an index, not a second copy of the entries.

````markdown
**<N> runs today.** Last: <ISO timestamp>.

## 📋 Awaiting you

| | Item | Waiting for | Since |
| --- | --- | --- | --- |
| 👀 | [repo#N — <title>](url) | Review — CI green | 2d |
| ❓ | [repo#N — <title>](url) | Your answer | 4h |
| 💡 | [repo#N — <title>](url) | Verdict on the proposal | today |

## ✅ Done today
- 🔀 merged [repo#N — <title>](url)
- 📦 built [repo#N — <title>](url)

## ⚠️ Failed today
- <plainly, or omit the section>

| Run | Entry |
| --- | --- |
| 04:00 | [detail](<comment url>) |
| 06:00 | [detail](<comment url>) |
````

**The body's `📋 Awaiting you` is the one the reviewer reads**, so it is the table in full — the
comment's copy is a snapshot of one run, this is the current state of the queue. `Since` is why it is
a table at all: an item waiting nine days and one waiting an hour are indistinguishable in prose.

There is **no month table.** The journal is one issue per day; a month's worth of runs is what the
Sunday `reflect` survey reads across issues, not something a single day's body carries.

**Correct an earlier claim in the body, not with an addendum comment.** The comment stays as the
historical record of what that run believed at the time. Only add a correcting comment when the
error would change what someone *did*. (why: docs/why.md#correcting-an-earlier-claim)

## Ending

Post the journal, then stop. Do not poll, do not wait for a review, do not keep a timer alive "in
case". **Do not attempt to end the session** — a run has no way to. What matters is that a lingering
session has nothing to wake it (never subscribe) and nothing to do if it does wake (the baton was
handed back). Responsiveness comes from the schedule. (why: docs/why.md#sessions-linger)

Close with a two-line summary: what awaits the user, and what the next run will pick up. If the run
hit a ceiling at every step, say so — that is the signal to retune `loop-config.json`, which the
Sunday `reflect` survey acts on.
