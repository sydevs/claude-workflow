---
name: loop-run
description: One run of the autonomous pipeline across the sydevs repos — merge approved PRs, revise PRs and tickets on feedback, implement approved tickets, run the day's survey, and journal it. Invoked by the scheduled routines; runnable locally with --dry-run.
argument-hint: '[--dry-run] [--kind morning|evening]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Loop Run

One pass down a fixed ladder of work across the four sydevs repos. Runs unattended in a Claude
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

## Non-negotiables

- **Never merge without all three**: an approving review, green CI, and zero unresolved review
  threads. Any one missing → comment saying precisely which, and move on.
- **Never implement a ticket without the `approved` label.** No exceptions, no inference from
  priority or from the user's tone in a comment.
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

1. **Never fetch issue bodies in the census.** The census needs `number`, `labels`, `field_values`,
   `comments` (the count) and `updated_at` — nothing else. A body is fetched only for the one
   ticket actually being implemented, and only at that point.

2. **Let the server filter.** `search_issues` narrows before anything reaches the context window;
   `list_issues` then reading and discarding does not:

   ```
   mcp__github__search_issues  query:"org:sydevs is:issue is:open label:approved"
   mcp__github__search_issues  query:"org:sydevs is:issue is:open label:proposal"
   mcp__github__search_issues  query:"org:sydevs is:issue is:open updated:>=<last-run-ISO-date>"
   ```

   The third is the only candidate set that can contain new feedback. An issue untouched since the
   last run cannot have a new comment on it.

3. **Comments cost a call each — earn them.** Fetch `get_comments` only where **both** hold: the
   issue appears in the `updated:>=` set, *and* its `comments` count is greater than zero. On a
   typical run that is one or two issues, not the whole backlog.

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

Ceiling: `maxPrRevisionsPerRun`. Highest-priority linked ticket first.

**Red CI on our own PR** → diagnose via `actions_get` on the failing run, fix, push. Cap at
`ciFixIterations`; on cap-out, comment with the remaining failure and journal it.

**Change-request review** → implement the feedback, then:
- Reply to each review comment individually, saying what changed or why it was not done. A silent
  push leaves the reviewer re-deriving what you did.
- Refresh the PR **title and body** from the current `origin/main...HEAD` — the story may have moved.
- Resolve the threads you actually addressed.

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
- **Edit the journal entry, do not append a new one** (see the journal section). The run's entry is
  now wrong, and a correction filed underneath leaves the original still lying to anyone who stops
  reading there.

## Rung 3 — Implement

Ceiling: `maxImplementationsPerRun` (1). Skip this rung entirely when:

- the repo is at `wipCapPerRepo` open loop PRs, or
- there are no `approved` tickets that are unblocked.

**Unblocked** means: no `Blocked by:` line in the body naming a still-open issue, and the ticket
carries neither `hold` nor `blocked-upstream`. Resolve each `Blocked by:` URL with `issue_read` and
check its state — a closed blocker does not block.

Selection: highest **Priority** field (`Urgent` → `Low`), then oldest `updatedAt`. Pull the whole
candidate set in one call:

```
mcp__github__list_issues  state:OPEN  labels:["approved"]  fields:["field_values","labels","body"]
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
| **A request for work** — "investigate this", "can you look at…", "we should also…" | Do **not** implement it. Work needs the `approved` gate like everything else. Reply with what you would do and what it would cost, update the ticket body to specify it, and say plainly that it needs `approved` to start. |
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
`approved` label is what actually starts work — **do not add it yourself.**

## Rung 5 — Survey (morning only)

Look up today's weekday in `surveyCalendar` and invoke that skill. `null` → skip.

Before filing anything, check the standing proposal ceiling:

```
mcp__github__search_issues  query:"org:$ORG is:issue is:open label:proposal"
```

At or over `maxOpenProposals` → **do not file.** Record what you found in the journal instead and
move on. The finding is not lost; it waits for review capacity.

## Rung 6 — Journal

Append one comment to the pinned `Ops journal — YYYY-MM` issue in `journalRepo`. On the first run of
a calendar month, open the new month's issue, pin it, close the previous one with a link, and update
`journalIssue` in `loop-config.json`.

**Write for someone reading at 6am who was not here yesterday.** Never use the words "rung" or
"ladder" — they are this skill's internal scaffolding and mean nothing to a reader in six months.
Use the section headings below verbatim.

### Format

````markdown
### <ISO timestamp> · <morning|evening> · [session](<url>)

Window since the last entry: ~Nh.

## 📋 Awaiting you
- 👀 [repo#N](url) — ready for review, CI green
- ❓ [repo#N](url) — question asked, blocked until answered
- 💡 [repo#N](url) — proposal, awaiting your verdict

## ✅ Merged
- 🔀 [repo#N](url) — <what it was> · closed [repo#M](url)

## 🔧 Changed
- ✏️ [repo#N](url) — revised on your feedback: <what changed>
- 💬 [repo#N](url) — replied to your comment about <topic>

## 🚀 Built
- 📦 [repo#N](url) — implemented [repo#M](url) · CI green
- 🛑 [repo#N](url) — declined, and why in one line

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
- **Every item links.** A bare issue number costs the reader a search.
- **One line per bullet.** Anything longer belongs in the collapsible block.
- **The summary line is scannable prose, not a status code.** "declined — the Atlas form it mirrors
  does not exist yet" beats "declined (blocked)".
- Emoji are a fixed vocabulary, not decoration: 🔀 merged · ✏️ revised · 💬 replied · 📦 built ·
  🛑 declined · 👀 needs review · ❓ needs an answer · 💡 proposal · 🔍 surveyed.

### Correcting an entry after the fact

If something changes after the entry is posted — a PR merges on a subscription wake, CI turns red —
**edit the existing comment**, do not append a new one. Add a short `> **Updated <time>:** …`
line beneath the affected bullet and correct the bullet itself.

A journal is read top-to-bottom by someone catching up. A correction posted as a second comment
means the first one is now lying to anyone who stops reading there, which is the failure the journal
exists to prevent.

## Ending

Close with a two-line summary: what awaits the user, and what the next run will pick up. If the
run hit a ceiling every rung, say so — that is the signal to retune `loop-config.json`, which the
Sunday `reflect` rung acts on.
