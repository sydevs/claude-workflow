---
name: survey-routine
description: The once-a-night run — the day's survey, the unheard-replies sweep, and the journal. Invoked by the sydevs-survey-nightly routine, runnable locally with --dry-run.
argument-hint: '[--dry-run]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Survey Routine

The once-a-night pass across the five sydevs repos. **This is not a ladder** — nothing here
competes for budget or descends by priority. It is a set of once-a-day tasks, split out of the
working-day loop so a busy queue can never starve them, plus two sweeps that would re-flag the
same items on every pass if they ran hourly.
(why: docs/why.md#the-survey-routine-is-not-a-ladder)

**Begin with `/workflow:preflight`** — its ground rules and census apply in full — **and end with
`/workflow:journal`.** In between, the three tasks below, in order.

`--dry-run`: do everything read-only. Print what each task *would* act on, then stop. Never
comment, commit, push, merge, or label.

## Survey

Look up today's weekday in `surveyCalendar` and invoke that skill. `null` means skip.

**File and stop — the state machine does the rest.** Everything filed here is bot-authored, so
`issues: opened` sets `Stage: Proposed` and `labels.awaiting` within seconds. **Never set either
yourself, and assign nobody** — a proposal exists to be judged, and `awaiting` says so.

Before filing, check the standing proposal ceiling. No query reaches a field, so take the indexed
half and filter the rest:

```
mcp__github__search_issues  query:"$SCOPE is:issue is:open author:<bot> -label:ops-journal"
```

Count those at `Stage: Proposed` from the field values `/workflow:preflight` already read. At or
over `maxOpenProposals`, **do not file** — record what you found in the journal, to wait for
review capacity.

⚠ **`author:<bot>` is load-bearing, not an optimisation.** A bare `Stage: Proposed` count would
sweep in the reviewer's own unreviewed tickets, silently switching the surveys off on a busy day.

**The ceiling governs proposals you went looking for, not defects you tripped over.**

| Where it came from | Capped? |
| --- | --- |
| A survey — you set out to find candidates | **Yes.** Respect `maxOpenProposals` and `maxProposalsPerSurvey` |
| A real defect found while implementing, reviewing or investigating | **No. File it, every time, even over the ceiling** |

A survey manufactures candidates on demand, so a cap fits. An incidental finding is evidence you
already hold, and filing it costs nothing — `Stage: Proposed` commits nobody to anything. **Never
discard a real finding to respect a number**, and never ask permission to file one.

Say where the finding came from, and keep the bar: what is wrong, what it costs, and what to do. A
finding you cannot point at a line for is a journal note, not a ticket.

## Reconciliation sweeps

**`awaiting` drift.** The state machine is event-driven, so it can only be wrong where no event
fired — a dropped webhook, a failed workflow run, or one of the loop's own dead-end adds that a
later run resolved without clearing. Recompute the label across the open backlog with the rules
below, correct what disagrees, and **journal every correction under `🧭 Friction`** — an unlogged
correction hides a broken workflow, and this sweep is the only thing that would notice.

| Should carry `awaiting` | Should not |
| --- | --- |
| `Stage: Proposed` | Any live `Hold Until`, or `Stage: Blocked` |
| `Stage: Revising` whose last comment is the loop's | `Stage: Revising` whose last comment is a `respondTo` human's |
| `Stage: Implement` with the bot **not** assigned | `Stage: Implement` with the bot assigned, or `Implemented` |
| A ready PR with no review, or approved in a `loopMayNotMerge` repo | A PR with changes requested, merged, or closed |

**Unheard replies.** Someone commented, but the ticket is not the loop's to act on, so nothing will
ever pick it up, and they may be waiting:

```
mcp__github__search_issues  query:"$SCOPE is:issue is:open commenter:<reviewer> updated:>=<24h> -label:ops-journal"
```

`is:issue` is deliberate — this sweep covers **tickets** only, not the reviewer's own PRs.
Omitting it would not widen the sweep anyway — see `/workflow:preflight` rule 7.

Keep only tickets **not** assigned to `assignment.bot`, with no live `Hold Until`, and check that
the newest comment is genuinely theirs, not a reply to the loop's last word. **Do not act on these** —
assigning the bot is the user's call alone. Name them under `### Possibly awaiting a handoff` in
tonight's journal.

This replaced a sweep for the reviewer forgetting to reassign, which mattered only when the loop
handed work back. Now an item stays assigned until the user unassigns it, so the sweep instead
catches a comment on something the loop never held.

## Journal

Hand off to `/workflow:journal`. Mark this run's entry `nightly`, and give its `🔍 Surveyed`
section the survey's one-line verdict.
