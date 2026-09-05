---
name: survey-analysis
description: Examine the codebase from one rotating angle — correctness, simplicity, performance, security, tests, a11y, i18n, observability, UX, best practice. Propose the findings worth acting on. Wednesday's survey.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Grep, Glob, Task
---

# Survey Analysis

Wednesday's survey. One angle rotates each week, so the codebase gets checked from every
direction over a quarter, not from the same direction every week.

## Choosing the angle

```bash
week=$(date -u +%V); idx=$(( (10#$week - 1) % $(jq '.analysisAngles | length' loop-config.json) ))
jq -r ".analysisAngles[$idx]" loop-config.json
```

The ISO week decides the angle, so a missed run does not break the rotation. Name the angle and
the week in the journal.

## Choosing where to look

Do **not** sweep all five repos — that produces shallow findings everywhere. Pick the one or two
areas where this angle has the most purchase, and say why in the journal. Useful heuristics:

- Where the angle's failure mode costs the most: security → public write paths, i18n →
  anything user-facing with a locale.
- What changed recently (`git log --since='3 months ago' --name-only`) — new code has had the
  least scrutiny.
- What the repo's own docs flag as delicate: nested `AGENTS.md` guides, `docs/`.

## The bar for filing

Propose something only when you can state all three: what is wrong, what it costs, and what to do
instead. A finding that fails any of those is an observation. File it in the journal, not the
backlog.

Do not file:

- Style preferences with no functional consequence.
- "Consider adding tests" without naming the untested behaviour and why it matters.
- Refactors whose only argument is that the code is old.
- Anything an open ticket already covers — search first.

Deliberate decisions are not findings. These repos record their reasoning in nested `AGENTS.md`
guides, `docs/`, and ticket bodies — read those first. Re-proposing an argued position (`auto.js`
vs `embed.js`, the CSS reset instead of shadow DOM) as a discovery wastes review time and costs
trust in the rest of your findings.

## Filing

Follow `/workflow:triage-issue`. The state machine sets `Stage` and `labels.awaiting` on
`issues: opened`. Assign nobody. Set type by the work — usually `Task` for a refactor, `Bug` for
a defect analysis found. Set priority by consequence, honestly: most findings are `Medium` or
`Low`, and inflating one makes the field useless.

Respect `maxProposalsPerSurvey` (3) and the standing `maxOpenProposals` ceiling. Fewer, better
findings win — the user is the only reviewer.

## Hard rules

- **Never** file a finding you have not traced to specific code.
- **Never** re-propose a documented decision without new evidence that changes it.
- **Never** fill the quota for its own sake. Zero findings is a valid, honest result.
