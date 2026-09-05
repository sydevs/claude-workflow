# PR body template

**This is the structure, not a suggestion.** Use these headings, in this order. Delete a section
only when the notes say to. Never rename one, and never add your own. A reviewer reading their
fifth PR of the week should find what they need without reading the whole thing.

Keep the visible body short. Put depth in `<details>` — reasoning, rejected alternatives,
measurements, file-by-file notes — and let the reviewer decide what to open.

```markdown
## Summary

[2–3 bullets on what changed and why. User-facing or behaviour-level outcomes,
not implementation detail.]

- [bullet]
- [bullet]

## Changes

[Optional. Only when the file list does not make it obvious — multi-file
refactors where the structural change is not apparent from individual diffs.]

- `path/to/file.ts` — [what changed]

## Preview

[BRANCH-alias preview URL(s), deep-linked to the changed routes. See
`finalize-pr/SKILL.md` step 7 for the branch-vs-commit-alias rule.]

- [what changed] — <url>

## Email previews

[ONLY when the diff touches `src/plugins/email/` or `src/emails/`. Mailpit links
from the relevant `scripts/preview-*-emails.ts` run; they stay live 7 days.
Otherwise delete this section.]

- [scenario] — <mailpit url>

## Contract impact

[Include ONLY when the diff touches something a consumer observes: the atlas
embed contract, generated Payload types, the atlas URL contract. Name the
consumer repos and link their issues. Otherwise delete this section.]

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

## Avoid

- Restating what each commit did — the commit list is right there.
- "This should fix the bug" — say what it does, not what you hope.
- "Made some refactors" — name the refactor, or omit the line.
- Repeating the acceptance criteria verbatim — `Closes #N` already links them.
