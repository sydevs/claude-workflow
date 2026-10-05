# PR body template

**This is the structure, not a suggestion.** Use these headings, in this order. Delete a section
only when the notes say to. Never rename one, and never add your own. A skill that owns a section
names its heading here and never states the order itself. A reviewer reading their fifth PR of the
week should find what they need without reading the whole thing.

The order is the priority. The reviewer's first screen is a brief summary, the change's shape,
and where to see it running. Everything else follows.

**Never shorten the Change outline, the Preview, or the two `reflect` sections to meet a length
goal.** Keep every other section short. Put its depth in `<details>` — reasoning, rejected
alternatives, measurements — and let the reviewer decide what to open.

```markdown
## Summary

[1–2 short bullets: what changed and why, at the level of outcomes. Leave
the detail to the outline.]

- [bullet]

## Change outline

[The reviewer's map of the diff. Build it per `change-outline.md`: one `###`
view per shape that changed, never a file list. No length limit applies.
Optional at or under `review.skipWhen`, where the diff is its own outline.]

## Preview

[Preview URL(s) deep-linked to the changed routes: the PR-number host
where `previewUrl.pattern` names one, else the BRANCH alias. See
`finalize-pr/SKILL.md` step 7.]

- [what changed] — <url>

## Grading last week

[The `reflect` PR only. Write it per `reflect/SKILL.md`. Otherwise delete.]

## 📊 Usage

[The `reflect` PR only. Write it per `reflect/SKILL.md`. Otherwise delete.]

## Phases

[ONLY when implement-issue builds the ticket across sessions. One box per
phase, in build order, ticked once the phase is pushed with its review done.
The dispatcher reads this list: while a box is unticked it starts the next
implement session instead of the critic. Carry it forward on every refresh,
ticks included. Otherwise delete this section.]

- [x] [phase 1 — what it leaves working]
- [ ] [phase 2]

## Email previews

[ONLY when the diff touches `src/plugins/email/` or `src/emails/`. Mailpit links
from the relevant `scripts/preview-*-emails.ts` run; they stay live 7 days.
Otherwise delete this section.]

- [scenario] — <mailpit url>

## Contract impact

[Include ONLY when the diff touches something a consumer observes: the atlas
embed contract, generated Payload types, the atlas URL contract. Name the
consumer repos. A copied contract is re-synced in a bot PR after this merges;
link an issue only for consumer work that needs one. Otherwise delete this
section.]

## Migration

[SahajCloud only, and only when a migration was added. Otherwise delete.]

- New migration: `src/migrations/<timestamp>_<name>.ts`
- Impact: [tables affected, data preserved or transformed]
- Reversible: yes / no — [explain]

## Test results

- Lean gate: ✓ / ✗ [what ran]
- Targeted specs: X passed
- Build: ✓ / N/A

## Manual verification

[Steps a reviewer must do by hand — UI changes, content workflows, edge cases
automated tests do not reach. Omit when genuinely nothing applies.]

1. [step]

## Notes for reviewer

[Only what changes how they review: a judgement call you want checked, a known
follow-up, an area wanting extra scrutiny. Dismissed review findings and why.]

<details>
<summary>Detail</summary>

[Everything true and worth keeping that nobody needs on first read: alternatives
rejected and why, measurements, file-by-file rationale, tool limitations hit.]

</details>

Closes #NNN
```

## Title

The issue title (`<type>(<scope>): <subject>`), or close to it. If scope shifted during
implementation, use your discretion, and say so in the notes.

## Length

Keep summary bullets to ≤ 100 characters. State test results as facts, with no editorializing. A
short, focused description with clear test results beats a long one that is vague about them.
**None of this applies to the Change outline, the Preview, or the two `reflect` sections.** Those
take the room they need.

## Avoid

- Restating what each commit did — the commit list is right there.
- A file-by-file changelog dressed as an outline — show shapes, not edits.
- "This should fix the bug" — say what it does, not what you hope.
- "Made some refactors" — name the refactor, or omit the line.
- Repeating the acceptance criteria verbatim — `Closes #N` already links them.
