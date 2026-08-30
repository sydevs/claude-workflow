---
name: loop-run
description: One run of the autonomous pipeline across the sydevs repos — merge PRs you approved, revise PRs and tickets on feedback, implement approved tickets, run the day's survey, and journal it. Invoked by the scheduled routines; runnable locally with --dry-run.
argument-hint: '[--dry-run] [--kind morning|evening]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Loop Run

One pass down a fixed ladder of work across the five sydevs repos — the four product repos plus
`claude-workflow`, which holds these very skills. Runs unattended in a Claude
Routine twice a day, and locally with `--dry-run` for testing.

**The ladder is ordered by how much it respects the user's attention**, not by how interesting the
work is. Merging something they already approved, and answering something they already asked, both
beat producing anything new. Descend only while ceilings allow; stop when one is hit and say so.

## Inputs

- `RUN_KIND` — `morning` (rungs 0–6) or `evening` (rungs 0–4, then 6). Defaults to `morning`.
  `--kind` overrides.
- `--dry-run` — do everything read-only. Print the worklist each rung *would* act on and stop.
  Never comment, commit, push, merge, or label.

Read `loop-config.json` from the `claude-workflow` checkout **first**. Every number and label name
below comes from it — none are hard-coded here.

## Writing style, everywhere the loop speaks

Comments, PR bodies and journal entries are all read by one busy person. Treat their attention as
the scarcest thing in this system.

- **Lead with the outcome.** What happened, or what is being asked of them. Not how you got there.
- **Detail goes in `<details>`.** File lists, measurements, tool limitations, alternatives
  considered, reasoning behind a judgement call — all real, all worth keeping, none of it worth
  making someone scroll past. Summarise the block in its `<summary>` so they can judge whether to
  open it.
- **A comment that needs a decision says so in its first line**, and names the decision.
- **Cut the throat-clearing.** No restating the ticket back, no narrating what you are about to do.
- If a reply runs past roughly fifteen lines outside a `<details>`, it is an essay. Find the three
  sentences that matter.

## Non-negotiables

- **Never merge without all three**: an approving review, green CI, and zero unresolved review
  threads. Any one missing → comment saying precisely which, and move on.
- **Never implement a ticket without the `ready-to-implement` label**, and never when it is not
  assigned to `assignment.bot`. No exceptions, no inference from priority or from the user's tone in
  a comment. You **may remove** that label when investigation raises a blocking question; you may
  never add it.
- **Never implement a ticket that already has an open PR closing it.** The PR holds the baton, and a
  second implementation duplicates the work against the same acceptance criteria.
- **Reassigning to `assignment.reviewer` is the final action on any unit of work**, and it means
  *done* — not *replied*. Keeping the assignment is correct when the work is blocked or deferred;
  journal it as queued. A crashed run is identified by a stale `claimLabel`, never by assignment.
- **Never exceed a ceiling** to "just finish one more".
- **Never improvise around a missing credential or tool.** Journal the failure and stop the rung.
  An agent that guesses when it lacks data is worse than one that does nothing.
- **Every rung is idempotent.** Re-derive the worklist from GitHub each time; check for an existing
  PR/comment before creating one. A re-run after a crash must not double-post.
- Work only on branches named `claude/*` — cloud sessions cannot push anywhere else.

## Rung 0 — Preflight

**This runs on the GitHub MCP tools, not `gh`.** A routine sandbox has no `gh` binary and its
session prompt mandates `mcp__github__*` for all GitHub work. Everything below is expressed in
those tools. `gh` remains correct when a skill is invoked locally as a slash command.

Confirm access before doing anything, because an unauthorized session fails every call with a 403
rather than an auth prompt:

```
mcp__github__get_me
```

Failure → journal it and stop. Do not improvise.

**Record the returned `login` as this run's own identity.** Every "did a human do this?" check below
compares against it. The loop runs as a dedicated machine account (`sydevs-bot`), so author alone is
a reliable signal — but read it from `get_me` rather than assuming, so a future identity change needs
no edit to this skill.

**Two capability limits shape the rungs below**, both verified rather than assumed:

- **Priority and Effort are readable and writable** as native issue fields. `list_issues` with
  `fields: ["field_values"]` returns the whole backlog's priorities in one call.
- **Relationships are invisible.** No MCP tool reads `blocked_by`. Blocked-ness is determined from
  the `Blocked by:` line in the issue body (see `/workflow:triage-issue`). Never conclude a ticket
  is unblocked because you could not find a blocker — conclude it only from the body.


**Read narrowly. Most of the backlog is irrelevant to any given run**, and reading all of it every
time is the single largest avoidable cost here. Three rules:

1. **Titles yes, bodies no.** The census needs `number`, **`title`**, `labels`, `field_values`,
   `comments` (the count) and `updated_at`. Titles are what make the backlog legible — to you while
   deciding, and to the reader of the journal — and they cost almost nothing. Bodies are the
   expensive part, and only the ticket actually being worked needs one.

2. **Let the server filter.** `search_issues` narrows before anything reaches the context window;
   `list_issues` then reading and discarding does not:

   ```
   mcp__github__search_issues  query:"org:sydevs is:issue is:open label:ready-to-implement -label:ops-journal"
   mcp__github__search_issues  query:"org:sydevs is:issue is:open label:proposal -label:ops-journal"
   mcp__github__search_issues  query:"org:sydevs is:issue is:open updated:><last-run-ISO-date> -label:ops-journal"
   ```

   **`-label:ops-journal` is mandatory on every worklist query.** `claude-workflow` is both a repo
   the loop works on *and* the home of the journal, so without the exclusion the loop reads its own
   diary as a backlog item — an entry mentioning a ticket becomes a ticket, and each run's entry
   looks like fresh activity to the next. Journal issues are never work.

   ⚠ Write the `>` literally. An HTML-escaped `&gt;` is accepted without error and returns **zero
   results** — a silently-empty search that reads as "nothing to do". If a search returns nothing
   and you have any reason to expect otherwise, suspect the qualifier before believing the answer.

   The third is the only candidate set that can contain new feedback. An issue untouched since the
   last run cannot have a new comment on it.

3. **Comments cost a call each — earn them.** Fetch `get_comments` only where **both** hold: the
   issue appears in the `updated:>=` set, *and* its `comments` count is greater than zero. On a
   typical run that is one or two issues, not the whole backlog.

4. **Check mentions.** The user writes `@sydevs-bot` to pull attention to something that other
   filters would miss — an old ticket, a PR comment, a thread the window does not cover. Search for
   them explicitly, and treat every hit as a rung-4 candidate regardless of what else it matched:

   ```
   mcp__github__search_issues  query:"org:sydevs mentions:sydevs-bot is:open updated:><last-run>"
   ```

   A mention is the user asking directly. Answer it or say why not — never let one pass silently.

The per-repo PR list is cheap and stays full — there are rarely more than a handful open:

Read the last journal entry (rung 6) to learn when the previous run ended — "since last run" below
means since that timestamp. If there is no journal yet, treat the window as the last 24 hours.

Count **open loop PRs per repo** (author is this agent, branch `claude/*`) for the WIP gate.

## Rung 1 — Merge and sequence

For every open PR with `reviewDecision == APPROVED`:

1. Confirm **green CI** and **no unresolved threads**, both
   surfaced by:
   ```
   mcp__github__pull_request_read  method:get_status          owner:$ORG repo:$REPO pullNumber:<n>
   mcp__github__pull_request_read  method:get_review_comments owner:$ORG repo:$REPO pullNumber:<n>
   ```
   Threads carry `isResolved`; an unresolved one blocks the merge even with an approval.
2. **Order before merging.** If several are ready, merge producers before consumers — read
   `dependencies/blocked_by` on each PR's linked issue. A consumer merged first is a consumer
   reviewed against a shape that does not exist yet.
   ```
   # Relationships have no MCP tool — read the `Blocked by:` lines from each linked issue's body
   mcp__github__issue_read  method:get  owner:$ORG repo:$REPO issue_number:<linked-issue>
   ```
3. Merge: `mcp__github__merge_pull_request  owner:$ORG repo:$REPO pullNumber:<n>  merge_method:"squash"`.
4. **Rebase the survivors.** Every other open loop PR in that repo gets rebased onto the new `main`
   so the next review is against current code. Conflicts → leave it, comment saying so, flag in the
   journal. Never force-push someone else's branch.
5. **Resolve the Sentry issue** if the merged work closed a ticket carrying a `Sentry:` link (see
   `survey-sentry` for the footer convention):
   ```bash
   API=$(jq -r '.sentry.apiBase' loop-config.json)   # DE region — sentry.io 404s here
   curl -sX PUT "$API/issues/<id>/" \
     -H "Authorization: Bearer $SENTRY_CLAUDE_WORKFLOW_TOKEN" \
     -H 'Content-Type: application/json' -d '{"status":"resolved"}'
   ```

Approved but **not** mergeable → one comment naming the blocker (red check, unresolved thread),
then move on. Do not fix CI here; that is rung 2.

## Rung 2 — PR health

Ceilings: `maxPrRevisionsPerRun` for your own PRs, `maxHumanPrReviewsPerRun` for the user's.
Highest-priority linked ticket first.

**Red CI on our own PR** → diagnose via `actions_get` on the failing run, fix, push. Cap at
`ciFixIterations`; on cap-out, comment with the remaining failure and journal it.

**Change-request review** → what you can do depends on *whose branch it is*, and the difference is
structural rather than a matter of judgement.

**On a `claude/*` PR — your own.** Implement the feedback, then:
- Reply to each review comment individually, saying what changed or why it was not done. Append
  `identity.commentMarker`. A silent push leaves the reviewer re-deriving what you did.
- Refresh the PR **title and body** from the current `origin/main...HEAD` — the story may have moved.
- Resolve the threads you actually addressed.

**On a human's PR — you cannot push to it.** A cloud session may only push to `claude/*`, and a
human's branch additionally carries their commits and backs their open PR. Two of the three
rejection conditions, so this is a wall, not a permission to ask for.

Do this instead, in order:

1. **Triage every thread and answer it** — adopted, or pushed back with the evidence. One comment
   summarising, detail in `<details>`. This is the part that has to happen even if nothing else does.
2. **Open a stacked PR carrying the adopted changes**, from `claude/<type>-<slug>` targeting **their
   branch**, not `main`. They merge it in one click and their PR updates. Say in the summary comment
   that it exists and what it contains.
3. **File a follow-up ticket** for anything the review raised that generalises beyond this PR.

Ceiling: `maxHumanPrReviewsPerRun`, which is **separate from `maxImplementationsPerRun`**. Unblocking
a PR the user is waiting on should neither starve new work nor be starved by it — a blocked PR often
holds up several tickets behind it.

⚠ A stacked PR's base is their branch. Confirm that before opening it: based on `main` by mistake,
it will show every commit of theirs as part of your diff and be unreviewable.

Feedback that is ambiguous or architectural → **ask, do not guess.** Reply with the specific
question, add `needs-info` to the linked ticket, move on.

## Waking outside a run

`subscribe_pr_activity` on a PR keeps **this session** subscribed after the run ends. A later
approval, review comment or CI change wakes it, and it acts then — independently of the schedule,
and even while the routines are disabled, because the subscription belongs to the session rather
than to the routine.

That is useful: an approval gets acted on in minutes instead of waiting for the next run. Two rules
so it stays predictable:

- **Re-verify from primary sources.** The event that woke you is a notification, not evidence. Check
  the review state, CI, and threads yourself before merging — the same three gates, no shortcuts.
- **A section walked earlier in the run is not re-walked when its precondition changes later.** If
  the session is awake it acts on the wake; if it has ended, the work waits for the next scheduled
  run. Do not re-enter the whole ladder to catch a condition that turned true afterwards — the
  next run is minutes-to-hours away and idempotent, and chasing it makes a run's behaviour depend
  on how long it happened to stay alive.
- **Edit the journal entry, do not append a new one** (see the journal section). The run's entry is
  now wrong, and a correction filed underneath leaves the original still lying to anyone who stops
  reading there.

## Rung 3 — Implement

**Two kinds of work live here.** Implementation needs `ready-to-implement`. **Investigation does not** — an
unlabelled ticket may be investigated, measured and answered, so long as nothing is committed. See
`/workflow:triage-issue` for the full table; the short version is that the label gates code, not
thought, and `hold` freezes everything.

Investigations count against `maxImplementationsPerRun` too: they cost a run's attention even
though they produce no PR.

Ceiling: `maxImplementationsPerRun` (1). Skip the *implementation* path entirely when:

- the repo is at `wipCapPerRepo` open loop PRs, or
- there are no `ready-to-implement` tickets that are unblocked.

**Unblocked** means: no `Blocked by:` line in the body naming a still-open issue, and the ticket
carries neither `hold` nor `blocked-upstream`. Resolve each `Blocked by:` URL with `issue_read` and
check its state — a closed blocker does not block.

Selection: highest **Priority** field (`Urgent` → `Low`), then oldest `updatedAt`. Pull the whole
candidate set in one call:

```
mcp__github__list_issues  state:OPEN  labels:["ready-to-implement"]  fields:["field_values","labels","body"]
```

Use **Effort** as a tie-break and a sanity check: an `Effort: High` ticket that cannot plausibly
finish within one run should be split rather than started, since an implementation is never carried
across runs. Then hand to
`/workflow:implement-issue`, which owns worktree, contract step, and shipping.

**Cross-repo side effects are exempt from the WIP cap.** If the implementation forces a consumer
change (a `types:cms` re-sync, an embed-contract update), open that PR too — it is usually small,
and withholding it leaves `main` inconsistent across repos. Use `/workflow:cross-repo-issue` for
the ordering.

**An investigation is not a code change, and must not be forced into one.** A ticket whose
deliverable is a *finding* — "evaluate X", "work out whether Y", "investigate Z" — is finished by
posting the finding as a comment on the ticket and updating its body with what was learned. No
branch, no PR. Read `Effort` and the acceptance criteria to tell the difference: if the criteria
describe a decision rather than a behaviour change, the output is prose.

Filing an empty PR to satisfy the shape of the pipeline is worse than no PR — it costs a review slot
and buries the actual answer in a description.

A ticket too large or too vague to finish in one run → do not start it. Comment with what is
missing, add `needs-info`, and pick the next one.

## Rung 4 — Ticket feedback

Ceiling: `maxTicketRepliesPerRun`. Issues where **the user** commented since the last run
(ignore your own comments).

**Filter by author first.** A comment counts as feedback only when
`comment.author.login != <own login from rung 0>`. This is the whole reason the loop has its own
account: replying to yourself burns the reply ceiling and produces a thread that argues with itself.

**Start from the `updated:>=` search set, not from the whole backlog** — see the census rules. Then
fetch comments only for those with a non-zero comment count, and **derive the window from comment
timestamps, never from `updated_at`.** A field write, a label change or
a bulk metadata pass all bump `updated_at` without anyone having said anything — a single migration
can make all 38 issues look like fresh feedback, which is exactly what happened on 2026-08-28. Pull
the issues that have comments at all, then filter each comment by `created_at` against the window
and by author.

**First decide what the comment is asking for**, because the three cases have different endings:

| The comment | What to do |
| --- | --- |
| **A question** | Answer it. Reply, update the ticket if the answer changes it, done. |
| **A request for work** — "investigate this", "can you look at…", "we should also…" | Do **not** implement it. Work needs the `ready-to-implement` gate like everything else. Reply with what you would do and what it would cost, update the ticket body to specify it, and say plainly that it needs `ready-to-implement` to start. |
| **A correction or new evidence** | Verify it against source before accepting, then rewrite the affected part of the ticket. |

The middle case is the one that goes wrong quietly: a comment asking for work reads like permission
to do it, and it is not. The label is the gate — a request in prose is a request to *scope* the
work, not to start it.

Reply substantively: answer the question, or say what you will change. Then update the ticket
itself where the comment changes it — title, body, priority, type, relationships. A reply that
agrees to a change but leaves the ticket saying the old thing has not done the job.

**Append the marker** (`identity.commentMarker` in `loop-config.json`) to every comment you write,
here and in every other rung. It tells a human reading the thread what wrote it, and gives the author
filter a second signal.

One known wrinkle, accepted deliberately: comments written before 2026-08-29 carry the loop's **old**
identity, which was a real person's account. Those are indistinguishable from that person's own
comments, so the loop may reply once to a legacy comment of its own. Bounded and one-time — do not
add a dated exclusion rule for it.

Remove `needs-info` once answered. If the comment reads as approval ("yes, do it"), say that the
`ready-to-implement` label is what actually starts work — **do not add it yourself.**

## Rung 5 — Survey (morning only)

Look up today's weekday in `surveyCalendar` and invoke that skill. `null` → skip.

Before filing anything, check the standing proposal ceiling:

```
mcp__github__search_issues  query:"org:$ORG is:issue is:open label:proposal"
```

At or over `maxOpenProposals` → **do not file.** Record what you found in the journal instead and
move on. The finding is not lost; it waits for review capacity.

## Rung 6 — Journal

**One journal issue per day**, in `journalRepo`, labelled `labels.journal`, **pinned**, and carrying
the day's full date in the **`Start date`** issue field (`journal.startDateFieldId`).

### Finding today's issue — by field, not by title

The title changes on every run (see below), so it cannot be the key. Fetch the open journals — there
are at most a week of them — and match the field:

```
mcp__github__search_issues  query:"repo:sydevs/claude-workflow is:issue is:open label:ops-journal"
                            fields:["field_values"]
```

Pick the one whose `Start date` equals today's **Vancouver** date. Keying to UTC splits a local day
across two issues.

**Create it lazily** if absent — no issue exists for a day the loop does nothing. On creation:

1. Set `Start date` to today (`gh api -X PUT .../issue-field-values` with `[{"field_id":<id>,"value":"YYYY-MM-DD"}]`).
2. Apply `labels.journal`.
3. Leave it **unassigned** — a journal is not work, and assigning it puts the loop's diary in someone's queue.
4. **Pin it, and unpin every other pinned issue in the repo.** Exactly one journal is pinned at a
   time: the current day's. Yesterday's stays open until the weekly reflection closes it, but it is
   no longer the thing to look at.

### The title is a headline, rewritten every run

```
<Day> — <what changed today, in a clause or two>
```

`Sun — Turnstile gated on the atlas; feedback banner handed back`

- **Day of week, not a date.** The reader is looking at a pinned issue and wants to know what
  happened, not to parse `2026-08-30`. The full date lives in `Start date`, which is sortable and
  filterable in a way a title string is not.
- **Rewrite it every run**, so it always describes the day *so far*. An empty day is
  `Sun — no changes`.
- **Describe outcomes, not activity.** "Turnstile gated on the atlas" beats "implemented #182".
  Someone scanning the repo's issue list should learn what the loop did without opening anything.

### Two surfaces, two jobs

| Surface | Job |
| --- | --- |
| **A new comment**, one per run | Append-only detail. This run's entry, in the format below |
| **The issue body**, rewritten every run | The rolling summary of the whole day: what is done, and what awaits the reviewer |

The body is rewritten, not appended to, which is the point: **the MCP surface cannot edit a comment,
but it can edit a body.** That is what makes the summary always current without addendum machinery.
Never leave a stale `📋 Awaiting you` in the body — it is the one section a reader trusts, and a
wrong one is worse than none.

**Build `📋 Awaiting you` from a query, not from memory.** It is
`assignee:<reviewer>` across the five repos, plus open proposals. Writing it from what this run
believes it did lets the journal and GitHub disagree, and the journal is the half people read.

**Write for someone reading at 6am who was not here yesterday.** Never use the words "rung" or
"ladder" — they are this skill's internal scaffolding and mean nothing to a reader in six months.
Use the section headings below verbatim.

### Format

````markdown
### <ISO timestamp> · <morning|evening> · [session](<url>)

Window since the last entry: ~Nh.

## 📋 Awaiting you
- 👀 [repo#N — <ticket title>](url) — ready for review, CI green
- ❓ [repo#N — <ticket title>](url) — blocked on your answer
- 💡 [repo#N — <ticket title>](url) — proposal, awaiting your verdict

## ✅ Merged
- 🔀 [repo#N — <title>](url) · closed [repo#M](url)

## 🔧 Changed
- ✏️ [repo#N — <title>](url) — <what changed, one clause>
- 💬 [repo#N — <title>](url) — replied about <topic>

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

<!-- Everything a reader only wants when they doubt a line above:
     file lists, commit SHAs, CI durations, counts checked, tool
     limitations hit, reasoning behind a judgement call. -->

</details>
````

### Rules

- **`## 📋 Awaiting you` is always first and never omitted.** Empty is "nothing awaiting you" — a
  reader must never scroll to learn there is nothing to do.
- **Omit any other section that is empty**, rather than printing "none". Exception: `⚠️ Failed`,
  which always appears, because its absence is indistinguishable from forgetting it.
- **Every bullet carries the ticket title inside the link.** A bare number forces the reader to
  open a tab to learn what it was about, which defeats the point of a scannable list.
- **Full `org/repo#N` for anything outside `journalRepo`** — a bare `#N` resolves against the repo
  the comment renders in and silently links somewhere wrong.
- **One line per bullet.** Anything longer belongs in the collapsible block.
- **The summary line is scannable prose, not a status code.** "declined — the Atlas form it mirrors
  does not exist yet" beats "declined (blocked)".
- Emoji are a fixed vocabulary, not decoration: 🔀 merged · ✏️ revised · 💬 replied · 📦 built ·
  🔬 investigated · 🛑 not started · 👀 needs review · ❓ needs an answer · 💡 proposal · 🔍 surveyed.

### `<details>` survives the write path — do not re-investigate this

**`<details>` and `<summary>` written through `mcp__github__*` are stored intact and render
collapsed.** Verified on 2026-08-30: 8 tag pairs in a PR body, 2 in a journal comment, all present
when read back.

A previous run concluded the opposite and wrote a long evidence section about it. Its mistake is the
trap worth naming: it fetched the **rendered HTML page** and found the section text present in the
DOM, and inferred the block was not collapsed. `<details>` content is *always* in the DOM — the
browser hides it with CSS. Fetched HTML cannot distinguish collapsed from absent.

If you ever doubt whether a write landed, **read it back through the same API that wrote it**. Do not
fetch the web page; it answers a different question than the one being asked.

### The body: what the rolling summary looks like

Rewritten in full by every run. Short — it is an index, not a second copy of the entries.

````markdown
**<N> runs today.** Last: <ISO timestamp>.

## 📋 Awaiting you
- 👀 [repo#N — <title>](url) — ready for review, CI green
- ❓ [repo#N — <title>](url) — blocked on your answer

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

**Correcting an earlier claim** no longer needs an addendum: fix it in the body, where the reader
looks. The comment stays as the historical record of what that run believed at the time, which is
what a log is for. Only add a correcting comment when the error would change what someone *did* —
otherwise the body edit is the correction.


## This month
| When | Run | Outcome |
| --- | --- | --- |
| 29 Aug 21:17 | [morning](<comment url>) | 1 built · 2 replied · ⚠ [addendum](<url>) |
```

That gives the record one authoritative surface even though the entries themselves are immutable:
someone catching up reads the body, not eight comments in sequence.

## Ending, and actually ending

Posting the journal is **not** the end of the run. A `subscribe_pr_activity` subscription keeps the
session alive afterwards, and every later comment or CI change wakes it for a full turn — so a run
that looks finished can keep spending for hours, and its journal entry silently goes stale.

So, in this order:

1. Finish the ladder.
2. **Unsubscribe from every PR you subscribed to this run** (`unsubscribe_pr_activity`), unless you
   are still mid-CI-fix-loop on your own PR — that is the one case where staying awake is doing
   work rather than waiting for it.
3. Post the journal.
4. Stop. Do not poll, do not wait for a review, do not keep a timer alive "in case".

The next scheduled run is hours away at most and re-derives everything. Responsiveness comes from
the schedule, not from a session that refuses to end — and an ended session cannot post a stale
addendum against work a later run has already redone.

## Ending

Close with a two-line summary: what awaits the user, and what the next run will pick up. If the
run hit a ceiling every rung, say so — that is the signal to retune `loop-config.json`, which the
Sunday `reflect` rung acts on.
