# PR body template

Stage this in an `mktemp` file and pass it to `gh pr create --body-file` / `gh pr edit --body-file`.

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

[Non-obvious things: alternatives considered, known follow-ups, areas wanting
extra scrutiny. Include dismissed review findings and why.]

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
