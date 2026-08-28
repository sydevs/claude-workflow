---
name: survey-analysis
description: Examine the codebase from one rotating angle (correctness, simplicity, performance, security, tests, a11y, i18n, observability, UX, best practice) and propose the findings worth acting on. Wednesday's survey.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Grep, Glob, Task
---

# Survey Analysis

Wednesday's survey. One angle per week, rotating, so the codebase gets looked at from every
direction over a quarter rather than from the same direction every week.

## Choosing the angle

```bash
week=$(date -u +%V); idx=$(( (10#$week - 1) % $(jq '.analysisAngles | length' loop-config.json) ))
jq -r ".analysisAngles[$idx]" loop-config.json
```

Deterministic from the ISO week, so the rotation survives a missed run and is auditable after the
fact. Name the angle and the week in the journal.

## Choosing where to look

Do **not** sweep all four repos — that produces shallow findings everywhere. Pick the one or two
areas where this angle has the most purchase, and say in the journal why. Useful heuristics:

- Where the angle's failure mode would be most expensive (security → public write paths and access
  control; i18n → anything user-facing with a locale).
- What changed recently (`git log --since='3 months ago' --name-only`) — new code has had the least
  scrutiny.
- What the repo's own docs flag as delicate: `.claude/rules/`, `docs/embedding.md`, `CLAUDE.md`.

## The bar for filing

Propose something only if you can state **all three**: what is wrong, what it costs, and what to do
instead. A finding that fails any of those is an observation, and observations belong in the
journal, not in the backlog.

Specifically, do not file:

- Style preferences with no functional consequence.
- "Consider adding tests" without naming the untested behaviour and why it matters.
- Refactors whose only argument is that the code is old.
- Anything already covered by an open ticket — search first.

Deliberate decisions are not findings. These repos record their reasoning in `.claude/rules/`,
`.claude/docs/`, and ticket bodies; read before proposing. The split between `auto.js` and
`embed.js`, the CSS reset rather than shadow DOM, `push: true` in dev — all are argued positions
with open tickets. Re-proposing one as a discovery wastes review time and erodes trust in the rest
of the findings.

## Filing

Per `/workflow:triage-issue`. `proposal` label, type by the nature of the work (usually `Task` for
a refactor, `Bug` for a defect found by analysis). Priority by consequence, honestly — most
analysis findings are `Medium` or `Low`, and inflating them makes the priority field useless.

Respect `maxProposalsPerSurvey` (3) and the standing `maxOpenProposals` ceiling. **Fewer, better
findings.** Three well-argued tickets are worth more than ten that need triage — and the user is
the only reviewer.

## Hard rules

- **Never** file a finding you have not traced to specific code.
- **Never** re-propose a documented decision without new evidence that changes it.
- **Never** fill the quota for its own sake. Zero findings is a valid, honest result.
