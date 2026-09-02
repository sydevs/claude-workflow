---
name: survey-routine
description: The once-a-night run — the day's survey, the dropped-baton and stale-claim sweeps, and the journal. Invoked by the sydevs-survey-nightly routine; runnable locally with --dry-run.
argument-hint: '[--dry-run]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Survey Routine

The once-a-night pass across the five sydevs repos. **This is not a ladder** — nothing here
competes for budget or descends by priority. It is a fixed set of once-a-day tasks that were split
out of the working-day loop precisely so a busy queue can never starve them, plus two sweeps that
would re-flag the same untouched items on every pass if they ran hourly.
(why: docs/why.md#the-survey-routine-is-not-a-ladder)

**Begin with `/workflow:preflight`** — the ground rules and the census apply to this run in full —
**and end with `/workflow:journal`.** In between, the three tasks below, in order.

`--dry-run`: do everything read-only. Print what each task *would* act on and stop. Never comment,
commit, push, merge, or label.

## Survey

Look up today's weekday in `surveyCalendar` and invoke that skill. `null` → skip.

Before filing anything, check the standing proposal ceiling with
`search_issues query:"$SCOPE is:issue is:open label:proposal"`. At or over `maxOpenProposals` →
**do not file.** Record what you found in the journal instead; it waits for review capacity.

**The ceiling governs proposals you went looking for, not defects you tripped over.**

| Where it came from | Capped? |
| --- | --- |
| A survey — you set out to find candidates | **Yes.** Respect `maxOpenProposals` and `maxProposalsPerSurvey` |
| Work on something else — a real defect surfaced while implementing, reviewing or investigating | **No. File it, every time, even over the ceiling** |

The two differ in kind. A survey manufactures candidates on demand and will produce more whenever
asked, so a stock cap is the right governor. An incidental finding is evidence you already hold:
you were in the code, something was wrong, and the alternative to filing is that the knowledge dies
with the run. **Never discard a real finding to respect a number**, and never ask permission to file
one — a `proposal` commits nobody to anything, which is the whole point of the label.

Say where it came from, and keep the bar: what is wrong, what it costs, and what to do. A finding
you cannot point at a line for is a journal note, not a ticket — that bar is about evidence, not
about the ceiling.

## Reconciliation sweeps

**Dropped batons.** Items where the reviewer replied but kept the baton:

```
mcp__github__search_issues  query:"$SCOPE is:open assignee:<reviewer> -label:hold -label:ops-journal"
```

For each, check whether the **newest comment is the reviewer's own** — that shape means they
answered and forgot to reassign. **Do not pick these up.** Name them in tonight's journal under a
`### Possibly awaiting a handoff` line. Anything with `hold` is excluded.

**Stale claims.** Any item still carrying `labels.claim` older than an hour is a crashed run's
residue. Remove the label, journal which items were cleared, and **leave the item assigned as
found** — assignment is the queue, not the crash signal.

## Journal

Hand off to `/workflow:journal` — this run's entry is marked `nightly`, and its `🔍 Surveyed`
section carries the survey's one-line verdict.
