---
name: reflect
description: Grade last week's changes, then read the week's flight-recorder journals, PR outcomes and the reviewer's review activity; refine the reviewer profile and propose changes to the loop's own configuration and skills as a PR. Sunday's survey — the loop improving itself through its own pipeline.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob
---

# Reflect

Sunday's survey. The loop reads how its own week went and proposes changes to itself. Those changes
go through the same review-and-merge path as everything else, so nothing about the loop's behaviour
changes without the user approving it — and because routines clone `main` fresh each run, a merged
change takes effect on the next run with no redeploy.

## Start by grading last week

**Before looking at this week at all, read the previous reflection PR and say whether it worked.**
Find it in this repo's merged PRs; for each change it made, state in one line whether the failure it
addressed recurred in the week just gone — with the count, from the journals below.

A reflection that never checks its own past changes is not learning, it is opinion with a PR
attached. This section leads the new PR's body, and it has three possible verdicts per change:

| Verdict | Then |
| --- | --- |
| **Held** — the failure did not recur | Say so and move on. This is the common case and it should be boring |
| **Did not hold** — same failure, same shape | Do **not** re-propose the same fix harder. Say the model behind it was wrong, and propose a different one or nothing |
| **Too early** — the situation never arose | Say so. Not evidence of anything, and it does not license a follow-up |

With no previous reflection, say so in one line and continue.

## Evidence

Read, do not recall — every run starts with no memory of the last. `$ORG`, `$JOURNAL_REPO`, `$BOT`
and `$REVIEWER` come from `loop-config.json` (`org`, `journalRepo`, `assignment.bot`,
`assignment.reviewer`), never typed literally.

**A journal is one document now, so the week is seven reads.** Each day's body carries that day's
`⚠️ Failed`, `⏭️ Ceiling` and `🧭 Friction` lines, each stamped with its run's time. **Journals have
no comments — never call `get_comments` on one.**

```
# the week's journal issues — one per day, all still open
mcp__github__search_issues  query:"repo:$ORG/$JOURNAL_REPO is:issue is:open label:ops-journal"
# the body IS the day. Seven of these is the whole week.
mcp__github__issue_read  method:get  owner:$ORG repo:$JOURNAL_REPO issue_number:<n>

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

The useful signals are about **friction**, not volume — and the journal now states them directly
rather than leaving them to be inferred. Count across the seven days before concluding anything.

**Recurrence is the gate for every change, not just profile edits.** One occurrence is weather: it
gets named in the PR body as observed and nothing else. Propose a change when the same failure,
ceiling or friction appears **on two or more distinct days**, and say the count in the proposal.
A rule added for a single bad night is a rule that outlives its cause.
(why: docs/why.md#reflect-edits-the-profile-only-on-recurrence)

| Signal | What it suggests |
| --- | --- |
| The same `⚠️ Failed` bullet on 2+ days | A real defect in the machinery, not an environment blip |
| A `🧭 Friction` entry repeating | A rule that misfires in practice — usually the rule is wrong, not the run |
| The `awaiting` drift sweep correcting the same shape twice | The state machine has a gap; fix the workflow, not the sweep |
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

**When your PR edits a skill, run the rule delta and account for every removal in the body:**

```bash
node workflow/lib/rule-delta.mjs --base main workflow/skills
```

It exits non-zero on a directive that vanished with no close match. Each one is a rule you meant to
drop or a rule that fell out, and only you can say which — this repo cannot validate a skill by
running it. (why: docs/why.md#lint-measures-style-not-content)

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

The PR body must show the evidence for each change, **as arithmetic over the week, not as
impression**. The `⏭️ Ceiling` bullets are counted, not characterised: "raise `maxWorkItemsPerRun`
to 4: it was the binding constraint on 5 of 7 days, and cost 3 adversarial reviews and 2 ticket
replies". A proposal without its count is a guess, and the reviewer has no way to check it.

**Lead the body with the grading section** from the top of this skill — what last week's changes
were meant to fix, and whether they did.

**Lessons that belong to a product repo, not to the loop**, follow the week's evidence out to that
repo — a recurring reviewer comment is often a convention nobody wrote down, and the fix belongs
where the next author will read it:

- **A small documentation fix** — a `CLAUDE.md`/`AGENTS.md` correction, a missing convention, a
  stale instruction — becomes a direct ticketless PR to that repo (its `prAllowlistGlobs` covers
  `**/*.md`), bounded by `wipCapPerRepo` like any loop PR. **Never touch anything under
  `.claude/`** — Protected Paths stall an unattended run, invisibly.
- **Anything structural** — new tooling, a hook, a workflow change, anything beyond prose — is a
  proposal issue in that repo instead, under `maxOpenProposals` like every survey proposal — the
  state machine sets its `Stage` and `labels.awaiting`.

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
- **Never** propose a change on a single occurrence. Name it as observed and wait for the second.
- **Never** open the PR body without the grading of last week's changes at the top.
- **Never** ship a skill change and a ceiling change in the same PR — split them across weeks if
  the evidence demands both.
