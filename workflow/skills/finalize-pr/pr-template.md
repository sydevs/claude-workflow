# PR body template

**This is the structure, not a suggestion.** Use these headings, in this order. Delete a section
the notes say to delete; never rename one or substitute your own. A reviewer reading their fifth PR
of the week should know where to look without reading the whole thing.

Keep the visible body short and put depth in `<details>` — reasoning, alternatives rejected,
measurements, file-by-file notes. The reviewer decides what to open.

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

[BRANCH-alias preview URL(s) from `branch-preview-url.mjs`, deep-linked to the
routes this PR changes — not just the root. Never a per-commit alias: an eight-hex
first label (`c76da223.…`) means the link freezes at this push and the reviewer
cannot tell. Omit the section entirely for repos with no preview deploy
(SahajAtlasWordpress). Say "preview pending" only if it genuinely had not built
by the time the body was written, and refresh once it does.]

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

The issue title (`<type>(<scope>): <subject>`), or close to it. Implementer's discretion when scope
shifted during implementation — but then say so in the notes.

## Length

Summary bullets ≤ 100 chars. Test results factual, no editorializing. A short focused description
with clear test results beats a long one that is vague about them.

## Avoid

- Restating what each commit did — the commit list is right there.
- "This should fix the bug" — say what it does, not what you hope.
- "Made some refactors" — be specific or omit.
- Repeating the acceptance criteria verbatim — `Closes #N` already links them.
