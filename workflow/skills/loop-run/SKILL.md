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

**Verify GitHub access before anything else.** `gh` ships in the sandbox image, but the session's
GitHub proxy has to be authorized separately, and an unauthorized session fails *every* call with a
403 rather than an auth prompt:

```bash
gh api repos/$ORG/claude-workflow --jq .full_name
```

- `403 GitHub access is not enabled for this session` → the account's GitHub connection is missing.
  Fixed by running `/web-setup` locally, or by authorizing the Claude GitHub App. **Journal it and
  stop the run** — do not fall back to the GitHub MCP tools and carry on. They can read issues and
  post comments, but they reach neither issue **types** nor **blocked-by dependencies**, so a run
  that continues on them files untyped tickets and cannot tell a blocked ticket from a ready one.
  That is worse than not running.
- `403 This GraphQL query is not enabled for this session` on a specific command → the proxy serves
  only pinned PR-review GraphQL operations. Use the REST form via `gh api repos/{owner}/{repo}/...`,
  which the error message itself names.

```bash
gh auth status                                   # fail loudly if unauthenticated
jq -e . loop-config.json >/dev/null              # config parses
date -u +%A | tr 'A-Z' 'a-z'                     # today's survey key
```

Census, across all repos in `repos`:

```bash
gh pr list  --repo "$ORG/$REPO" --state open --json number,title,headRefName,isDraft,reviewDecision,labels
gh issue list --repo "$ORG/$REPO" --state open --limit 100 \
  --json number,title,labels,issueType,updatedAt,comments
```

Read the last journal entry (rung 6) to learn when the previous run ended — "since last run" below
means since that timestamp. If there is no journal yet, treat the window as the last 24 hours.

Count **open loop PRs per repo** (author is this agent, branch `claude/*`) for the WIP gate.

## Rung 1 — Merge and sequence

For every open PR with `reviewDecision == APPROVED`:

1. Confirm **green CI** (`gh pr checks <n>`) and **no unresolved threads**. Unresolved threads are
   not visible in `gh pr view`; query them:
   ```bash
   gh api repos/$ORG/$REPO/pulls/<n>/comments --jq '[.[] | select(.in_reply_to_id == null)] | length'
   gh pr view <n> --json reviewThreads --jq '[.reviewThreads[] | select(.isResolved == false)] | length'
   ```
2. **Order before merging.** If several are ready, merge producers before consumers — read
   `dependencies/blocked_by` on each PR's linked issue. A consumer merged first is a consumer
   reviewed against a shape that does not exist yet.
   ```bash
   gh api repos/$ORG/$REPO/issues/<linked-issue>/dependencies/blocked_by --jq '.[].number'
   ```
3. Merge: `gh pr merge <n> --squash --delete-branch`.
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

**Red CI on our own PR** → diagnose (`gh run view <id> --log-failed`), fix, push. Cap at
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

**Unblocked** means `dependencies/blocked_by` is empty or fully closed, and the ticket carries
neither `hold` nor `blocked-upstream`.

Selection: highest priority (`Critical` → `Low`), then oldest `updatedAt`. Then hand to
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

Reply substantively: answer the question, or say what you will change. Then update the ticket
itself where the comment changes it — title, body, priority, type, relationships. A reply that
agrees to a change but leaves the ticket saying the old thing has not done the job.

Remove `needs-info` once answered. If the comment reads as approval ("yes, do it"), say that the
`approved` label is what actually starts work — **do not add it yourself.**

## Rung 5 — Survey (morning only)

Look up today's weekday in `surveyCalendar` and invoke that skill. `null` → skip.

Before filing anything, check the standing proposal ceiling:

```bash
# open, loop-created, still unreviewed, across all repos
gh search issues --owner "$ORG" --state open --label proposal --json number | jq length
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
