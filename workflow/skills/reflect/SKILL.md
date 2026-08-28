---
name: reflect
description: Read the week's journal and PR outcomes, and propose changes to the loop's own configuration and skills as a PR. Sunday's survey — the loop improving itself through its own pipeline.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob
---

# Reflect

Sunday's survey. The loop reads how its own week went and proposes changes to itself. Those changes
go through the same review-and-merge path as everything else, so nothing about the loop's behaviour
changes without the user approving it — and because routines clone `main` fresh each run, a merged
change takes effect on the next run with no redeploy.

## Evidence

Read, do not recall — every run starts with no memory of the last:

```
# the week's journal entries
mcp__github__issue_read  method:get_comments  owner:$ORG repo:claude-workflow issue_number:<journal>

# what actually happened to the PRs
mcp__github__list_pull_requests  owner:$ORG repo:$REPO  state:all  perPage:40
```

## What to look for

The useful signals are about **friction**, not volume:

| Signal | What it suggests |
| --- | --- |
| A ceiling hit every run | The ceiling is wrong, or the rung above it is not clearing work |
| PRs needing 3+ revision rounds | The tickets are underspecified, or `implement-issue` is guessing |
| CI fix-loop capping out repeatedly | A flaky gate, or a class of change the lean gate does not catch |
| Proposals sitting unreviewed | Surveys are outrunning review capacity — lower `maxProposalsPerSurvey` |
| The same review comment recurring | A missing rule in a skill, or a convention nobody wrote down |
| A rung never reached | Everything above it is saturated; say so plainly |
| Runs that did nothing | Cadence is wrong for the actual pace of work |

Prefer **removing** a rule to adding one. These skills are read in full on every run, and a skill
that has grown a paragraph per incident becomes a document nobody can follow — which is how the
previous three-fork workflow decayed.

## Proposing

One PR to `claude-workflow` per week, at most. Ticketless (`prAllowlistGlobs`). Scope it to changes
the evidence supports: a ceiling number, a clarified instruction, a removed rule that never fired.

The PR body must show the evidence for each change — "raise `maxPrRevisionsPerRun` to 3: hit the
cap on 4 of 6 runs, leaving PRs #12 and #15 waiting a full day for a one-line fix". A proposal
without its evidence is a guess, and the reviewer has no way to check it.

If the week gives no clear signal, **say so and open no PR.** A quiet week is a legitimate outcome,
and an unnecessary change to the machinery is more expensive than none.

## Hard rules

- **Never** change loop behaviour outside a reviewed PR.
- **Never** raise a ceiling without evidence it was the binding constraint.
- **Never** open a reflection PR while a previous one is still unreviewed — stack the findings into
  the next week instead.
