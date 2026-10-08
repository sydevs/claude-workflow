---
name: run-audit
description: The once-a-night run — tonight's audit from the calendar, then the journal. Invoked by the sydevs-audit-nightly routine, runnable locally with --dry-run.
argument-hint: '[--dry-run]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Run audit

The once-a-night pass across the five sydevs repos. It is one task: tonight's audit. **This is
not a ladder** — nothing here competes for budget. The sweeps that used to run beside it —
`awaiting` drift, expired parks, unheard replies — are the dispatcher's now, on events and on
its 30-minute sweep. (why: docs/why.md#the-run-audit-is-not-a-ladder,
docs/why.md#awaiting-has-one-writer)

**Begin with `/workflow:start-run` in cron mode, and end with
`/workflow:finish-run` in cron mode.**

`--dry-run`: do everything read-only. Print what the audit *would* file, then stop. Never
comment, commit, push, or label.

`$SCOPE` is `repo:` qualifiers built from `repos`, never a bare `org:` — the org still holds
retired repositories. Every hand-written query carries `is:issue` or `is:pr`, and
`-label:ops-journal`.

## Audit

```bash
node <claude-workflow>/workflow/skills/run-audit/calendar.mjs
```

It prints tonight's `skill`, and for `audit-code` its `family` and `angle`. Invoke that skill,
passing `family` and `angle` to `audit-code`. A `null` skill means skip. Never re-derive the day or
the angle by hand: the script is the one reader of `auditCalendar` and `auditAngles`.
(why: docs/why.md#three-audit-rotations) Name the audit, its angle, and its one-line verdict in the
journal entry.

**File and stop — the dispatcher does the rest.** Everything filed here is bot-authored, so
`issues.opened` sets Status Proposed, `proposal`, and `awaiting` within seconds. **Never set any
of them, and assign nobody** — a proposal exists to be judged, and `awaiting` says so.

Before filing, check the standing proposal ceiling with one indexed search:

```
mcp__github__search_issues  query:"$SCOPE is:issue is:open label:proposal"
```

The dispatcher applies `proposal` only to bot-filed tickets, and removes it on the first human
verb, so the count is exactly the unreviewed proposals. At or over `maxOpenProposals`, **do not
file** — record what you found in the journal, to wait for review capacity.

**The ceiling governs proposals you went looking for, not defects you tripped over.**

| Where it came from | Capped? |
| --- | --- |
| An audit — you set out to find candidates | **Yes.** Respect `maxOpenProposals` and `maxProposalsPerSurvey` |
| A real defect found while implementing, reviewing, or investigating | **No. File it, every time, even over the ceiling** |

An audit manufactures candidates on demand, so a cap fits. An incidental finding is evidence you
already hold, and filing it costs nothing — `Proposed` commits nobody to anything. **Never discard
a real finding to respect a number.** `start-run` routes it.

Say where the finding came from, and keep the bar: what is wrong, what it costs, and what to do. A
finding you cannot point at a line for is a journal note, not a ticket.

## Journal

Hand off to `/workflow:finish-run` in cron mode. The handler is `audit-nightly`, the glyph
is 🔍, and `📄 Did` carries the audit's one-line verdict and every ticket or PR it filed.
