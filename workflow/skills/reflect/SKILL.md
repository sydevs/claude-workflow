---
name: reflect
description: Read the week's journal, PR outcomes, and the reviewer's review activity; refine the reviewer profile and propose changes to the loop's own configuration and skills as a PR. Sunday's survey — the loop improving itself through its own pipeline.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob
---

# Reflect

Sunday's survey. The loop reads how its own week went and proposes changes to itself. Those changes
go through the same review-and-merge path as everything else, so nothing about the loop's behaviour
changes without the user approving it — and because routines clone `main` fresh each run, a merged
change takes effect on the next run with no redeploy.

## Evidence

Read, do not recall — every run starts with no memory of the last. `$ORG`, `$JOURNAL_REPO`, `$BOT`
and `$REVIEWER` come from `loop-config.json` (`org`, `journalRepo`, `assignment.bot`,
`assignment.reviewer`), never typed literally.

```
# the week's journal issues — one per day, all still open
mcp__github__search_issues  query:"repo:$ORG/$JOURNAL_REPO is:issue is:open label:ops-journal"
# then, per issue: the body is the day's summary, the comments are the per-run detail
mcp__github__issue_read  method:get_comments  owner:$ORG repo:$JOURNAL_REPO issue_number:<n>

# what actually happened to the PRs
mcp__github__list_pull_requests  owner:$ORG repo:$REPO  state:all  perPage:40

# what the reviewer actually said — the loop's only window into their judgement
# $SCOPE = repo: qualifiers built from `repos` — never a bare org:, which reaches retired repositories
mcp__github__search_issues  query:"$SCOPE is:pr author:$BOT reviewed-by:$REVIEWER updated:>$WINDOW"
# per hit: pull_request_read method:get_reviews + method:get_review_comments,
# keep author == $REVIEWER and created_at inside the window — and READ THE TEXT, not the count
```

`$WINDOW` is the previous reflection PR's merge date (find it in this repo's merged PRs); with no
previous reflection, seven days.

## What to look for

The useful signals are about **friction**, not volume:

| Signal | What it suggests |
| --- | --- |
| A ceiling hit every run | The ceiling is wrong, or the rung above it is not clearing work |
| PRs needing 3+ revision rounds | The tickets are underspecified, or `implement-issue` is guessing |
| CI fix-loop capping out repeatedly | A flaky gate, or a class of change the lean gate does not catch |
| Proposals sitting unreviewed | Surveys are outrunning review capacity — lower `maxProposalsPerSurvey` |
| The same reviewer comment theme on 2+ PRs | A value missing from the reviewer profile, or a rule missing from a skill |
| The reviewer flagged something substantive on a PR the adversarial review passed clean | A profile gap — the bot review is not yet seeing what they see |
| Adversarial-review findings the reviewer resolved without change, or overrode | The bot review is over-flagging — trim the profile, not the code |
| A rung never reached | Everything above it is saturated; say so plainly |
| Runs that did nothing | Cadence is wrong for the actual pace of work |

Prefer **removing** a rule to adding one. These skills are read in full on every run, and a skill
that has grown a paragraph per incident becomes a document nobody can follow — which is how the
previous three-fork workflow decayed.

## Refining the reviewer profile

`review.profilePath` is the adversarial review's model of how $REVIEWER reviews. Refining it is
this survey's job, and the gate is recurrence: edit it only when **the same theme appears in the
reviewer's comments on two or more distinct PRs in the window**, or when **they caught something
substantive that the adversarial review had passed clean**. One comment is weather.
(why: docs/why.md#reflect-edits-the-profile-only-on-recurrence)

When the gate opens, work at the level of **intent, not incident**. Do not append "DON'T do X" —
ask what value made the reviewer write those comments, and state *that*, so the review generalises
to cases the week never showed. A profile that absorbs every remark verbatim converges on a
checklist nobody weighs. Each edit is one dated bullet under **Recent refinements**, citing the
PRs behind it; when several bullets turn out to be one value, fold them into the section where
that value belongs and delete the bullets — the profile obeys the same prefer-removal rule as the
skills. Profile edits ride the weekly reflection PR; they are not a second PR.

## Proposing

One PR to `claude-workflow` per week, at most. Ticketless (`prAllowlistGlobs`). Scope it to changes
the evidence supports: a ceiling number, a clarified instruction, a removed rule that never fired,
a profile refinement.

The PR body must show the evidence for each change — "raise `maxWorkItemsPerRun` to 3: hit the
cap on 4 of 6 runs, leaving PRs #12 and #15 waiting a full day for a one-line fix". A proposal
without its evidence is a guess, and the reviewer has no way to check it.

**Lessons that belong to a product repo, not to the loop**, follow the week's evidence out to that
repo — a recurring reviewer comment is often a convention nobody wrote down, and the fix belongs
where the next author will read it:

- **A small documentation fix** — a `CLAUDE.md`/`AGENTS.md` correction, a missing convention, a
  stale instruction — becomes a direct ticketless PR to that repo (its `prAllowlistGlobs` covers
  `**/*.md`), bounded by `wipCapPerRepo` like any loop PR. **Never touch anything under
  `.claude/`** — Protected Paths stall an unattended run, invisibly.
- **Anything structural** — new tooling, a hook, a workflow change, anything beyond prose — is a
  `Stage: Proposed` issue in that repo instead, under `maxOpenProposals` like every survey
  proposal.

If the week gives no clear signal, **say so and open no PR.** A quiet week is a legitimate outcome,
and an unnecessary change to the machinery is more expensive than none.

## Close the week's journals

After the reflection PR is open, close every `label:ops-journal is:open` issue you read, each with a
one-line comment linking the reflection PR. They are a week's working memory, not a permanent record;
leaving them open makes next Sunday's read grow without bound and clutters the repo's issue list.

Close them **last**. A crash midway through the reflection should leave the journals intact, because
they are the only input that cannot be reconstructed.

## Hard rules

- **Never** change loop behaviour outside a reviewed PR.
- **Never** raise a ceiling without evidence it was the binding constraint.
- **Never** open a reflection PR while a previous one is still unreviewed — stack the findings into
  the next week instead.
- **Never** ship a skill change and a ceiling change in the same PR — split them across weeks if
  the evidence demands both.
