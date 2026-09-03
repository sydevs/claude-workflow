---
name: survey-routine
description: The once-a-night run — the day's survey, the unheard-replies sweep, and the journal. Invoked by the sydevs-survey-nightly routine; runnable locally with --dry-run.
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

**Everything filed here is `Stage: Proposed`, assigned to `assignment.reviewer`.** A proposal
exists to be judged, so it goes to the person who judges it; the Stage is what keeps the loop from
acting on its own suggestion next run.

Before filing anything, check the standing proposal ceiling. There is no query for a field, so take
the indexed half and filter the rest:

```
mcp__github__search_issues  query:"$SCOPE is:issue is:open author:<bot> -label:ops-journal"
```

then count those at `Stage: Proposed` from the field values `/workflow:preflight` already read. At
or over `maxOpenProposals` → **do not file.** Record what you found in the journal instead; it waits
for review capacity.

⚠ **`author:<bot>` is load-bearing, not an optimisation.** The ceiling governs what the loop
proposes, and a bare `Stage: Proposed` count would sweep in the reviewer's own unreviewed tickets —
so a busy human backlog would silently switch the surveys off.

**The ceiling governs proposals you went looking for, not defects you tripped over.**

| Where it came from | Capped? |
| --- | --- |
| A survey — you set out to find candidates | **Yes.** Respect `maxOpenProposals` and `maxProposalsPerSurvey` |
| Work on something else — a real defect surfaced while implementing, reviewing or investigating | **No. File it, every time, even over the ceiling** |

The two differ in kind. A survey manufactures candidates on demand and will produce more whenever
asked, so a stock cap is the right governor. An incidental finding is evidence you already hold:
you were in the code, something was wrong, and the alternative to filing is that the knowledge dies
with the run. **Never discard a real finding to respect a number**, and never ask permission to file
one — `Stage: Proposed` commits nobody to anything, which is the whole point of it.

Say where it came from, and keep the bar: what is wrong, what it costs, and what to do. A finding
you cannot point at a line for is a journal note, not a ticket — that bar is about evidence, not
about the ceiling.

## Reconciliation sweeps

**Unheard replies.** Someone commented, but the ticket is not the loop's to act on — so nothing
will ever pick it up, and they may be waiting:

```
mcp__github__search_issues  query:"$SCOPE is:open commenter:<reviewer> updated:>=<24h> -label:ops-journal"
```

Keep the ones **not** assigned to `assignment.bot` and with no live `Hold Until`, then check that
the newest comment is genuinely theirs and not a reply to the loop's own last word. **Do not pick
these up** — assigning the bot is the user's call and only theirs. Name them in tonight's journal
under a `### Possibly awaiting a handoff` line.

This replaced a sweep for *"the reviewer replied but forgot to reassign"*, which meant something
only while the loop handed work back. It no longer does: an item stays assigned to the bot until the
user unassigns it, so the failure worth catching is now the opposite one — a comment on something
the loop was never holding.

## Journal

Hand off to `/workflow:journal` — this run's entry is marked `nightly`, and its `🔍 Surveyed`
section carries the survey's one-line verdict.
