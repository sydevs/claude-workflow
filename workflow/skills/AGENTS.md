# Writing a skill

- **Frontmatter is a security surface.** `allowed-tools` on a `SKILL.md` instructs an agent with
  write access to five repositories. An over-broad line here is this repo's equivalent of an RCE.
  `securityReview.triggerPattern` covers every skill `.md`, every hook, `workflow/lib`, the dispatcher and its workflows for that reason. Grant the
  narrowest set that works — compare `file-ticket` (`Bash(gh issue:*)`,
  `Bash(gh api:*)`, …) against the pipeline skills that genuinely need `Bash(*)`.
- **`disable-model-invocation: true` unless the skill is a helper.** Every user- or
  routine-invoked skill carries it, so nothing fires on a stray phrase. Only helpers invoked *by*
  other skills omit it.
- **Write for one busy reader.** The loop's own writing rules (lead with the outcome, detail in
  `<details>`, no throat-clearing) live in `start-run/SKILL.md` and apply to skill bodies
  as much as to what they emit.
- **The rule lives in the skill. The story lives in [`docs/why.md`](../../docs/why.md).** Move a
  retrospective justification one hop away: add a heading in `docs/why.md` named after the rule,
  and cite it as `(why: docs/why.md#anchor)`.
  **Never let a story be a rule's only statement.** Check that the instruction survives inline as
  an imperative before you move the narrative.
