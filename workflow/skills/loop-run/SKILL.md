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

**Two capability limits shape the rungs below**, both verified rather than assumed:

- **Priority and Effort are readable and writable** as native issue fields. `list_issues` with
  `fields: ["field_values"]` returns the whole backlog's priorities in one call.
- **Relationships are invisible.** No MCP tool reads `blocked_by`. Blocked-ness is determined from
  the `Blocked by:` line in the issue body (see `/workflow:triage-issue`). Never conclude a ticket
  is unblocked because you could not find a blocker — conclude it only from the body.


Census, across all repos in `repos`:

```
mcp__github__list_pull_requests  owner:$ORG repo:$REPO state:open
mcp__github__list_issues         owner:$ORG repo:$REPO state:OPEN \
                                 fields:["field_values","labels","body"]
```

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

A ticket too large or too vague to finish in one run → do not start it. Comment with what is
missing, add `needs-info`, and pick the next one.

## Rung 4 — Ticket feedback

Ceiling: `maxTicketRepliesPerRun`. Issues where **the user** commented since the last run
(ignore your own comments).

**Derive this from comment timestamps, never from `updated_at`.** A field write, a label change or
a bulk metadata pass all bump `updated_at` without anyone having said anything — a single migration
can make all 38 issues look like fresh feedback, which is exactly what happened on 2026-08-28. Pull
the issues that have comments at all, then filter each comment by `created_at` against the window
and by author.

Reply substantively: answer the question, or say what you will change. Then update the ticket
itself where the comment changes it — title, body, priority, type, relationships. A reply that
agrees to a change but leaves the ticket saying the old thing has not done the job.

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

Append one comment to the pinned `Ops journal — YYYY-MM` issue in `journalRepo`. On the first run
of a calendar month, open the new month's issue, pin it, and close the previous one with a link.

Keep entries scannable — this is read at 6am:

```markdown
### <ISO timestamp> · <morning|evening> · <session URL>

**Merged** — sydevs/SahajCloud#657 · rebased #654 onto main
**Awaiting you** — sydevs/SahajAtlasWeb#175 (ready for review) · sydevs/SahajCloud#661 (proposal)
**Revised** — sydevs/WeMeditateWeb#66 (addressed 3 review comments)
**Implemented** — sydevs/SahajCloud#629 → PR #662
**Survey** — survey-deps: 1 vulnerability PR, 2 advisories triaged as non-applicable
**Skipped** — rung 3: SahajAtlasWeb at WIP cap (2 open)
**Failed** — none
```

Rules: every item links. "Awaiting you" is the section the user acts on, so it is never omitted,
even when empty ("nothing awaiting you"). Failures are stated plainly, never softened — a run that
hides a failure behind a green status is worse than one that fails visibly.

## Ending

Close with a two-line summary: what awaits the user, and what the next run will pick up. If the
run hit a ceiling every rung, say so — that is the signal to retune `loop-config.json`, which the
Sunday `reflect` rung acts on.
