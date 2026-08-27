---
name: draft-ticket
description: Draft a GitHub issue from a feature request, bug report, or enhancement — clarify ambiguity first, then produce a body with acceptance criteria and a verification checklist. User-invoked only; does not create the issue without explicit approval.
disable-model-invocation: true
allowed-tools: Bash(gh issue create:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh pr list:*), Bash(gh pr view:*), Bash(git log:*), Bash(git diff:*), Bash(mktemp:*), Read, Grep, Glob
---

# Draft Ticket

Produce a GitHub issue someone can implement without having been in the room when it was discussed.
The issue **is** the spec — there is no committed `specs/` layer in these repos — so it has to carry
enough resolved detail to survive being picked up cold, possibly by an automated run.

## Workflow

1. **Classify.** Feature / bug / refactor / enhancement / docs / chore.

2. **Gather context.** Read the related code, recent PRs (`gh pr list --limit 20`), and similar past
   issues (`gh issue list --search "<keyword>"`). Never draft blindly — a ticket that duplicates a
   closed issue or contradicts a recent PR costs more than it saves.

3. **Clarify — resolve ambiguity before drafting, not during review.**
   Enumerate the underspecified decisions in the request and settle each one. Ask the user only
   where the codebase cannot answer it; otherwise resolve it from the code and *state the resolution
   in the ticket* so the implementer inherits the decision rather than re-making it.

   Work through these axes and note which apply:

   | Axis | The question |
   | --- | --- |
   | Scope boundary | What is explicitly **out** of scope? |
   | Affected surface | Which collection, locale, route, user role, client? |
   | Behaviour | Expected vs. actual, stated concretely |
   | Contract impact | Does this change anything a host site or consumer repo observes? |
   | Data | Migration needed? Backfill? Reversible? |
   | Failure mode | What should happen when it goes wrong? |
   | Done | What observable condition means finished? |

   Record unresolved ambiguity explicitly under `## Open questions` rather than papering over it.
   A ticket with two named open questions is more useful than one that hides them in vague wording.

4. **Write the title** as a conventional commit: `<type>(<scope>): <subject>`, ≤ 70 chars,
   imperative mood ("add", not "added"). Derive the scopes in use from this repo rather than
   assuming — `git log --oneline -50` shows them, and the repo may carry a `conventions.md` beside
   its own skills.

5. **Write the body.** Be specific; use `file:line` references. Avoid "improve X" / "make Y better".

6. **Add the verification checklist.** Distinct from acceptance criteria: acceptance criteria say
   what must be *true*, the checklist says what someone must *do* to confirm it. Each item names a
   concrete command, route, or observation. This is what an automated implementation run is checked
   against, so it must be executable by someone with no additional context.

7. **Plan-mode approval is the sign-off.** This skill runs in plan mode; the user reviews the title
   and body in the plan file and approves via `ExitPlanMode`. No separate "ready to create?" prompt
   — plan approval authorizes the `gh issue create` call.

8. **Create the issue.** Stage the body in a session-unique temp file — never a fixed path like
   `/tmp/gh-issue-body.md`, which collides between parallel Claude instances and has caused data
   loss here before:

   ```bash
   BODY_FILE=$(mktemp -t gh-issue-body)
   # write the body to "$BODY_FILE" with the Write tool, then:
   gh issue create --title "<title>" --body-file "$BODY_FILE"
   ```

   `-t` already appends randomness, so no `.XXXXXX` template — and do not append an extension,
   which would name a path `mktemp` never created. The file-based form preserves markdown fidelity;
   `--body` mangles backticks and indentation.

9. **Return the issue URL.**

## Body structure

- `## Summary` — one paragraph: what and why.
- `## Proposed changes` (feature/refactor) **or** `## Observed behaviour` + `## Expected behaviour` (bug).
- `## Resolved decisions` — what step 3 settled, and on what basis. Omit only if nothing was ambiguous.
- `## Acceptance criteria` — a checklist of testable conditions.
- `## Verification checklist` — the concrete steps that confirm those criteria.
- `## Open questions` — unresolved ambiguity. Omit if empty.
- `## Files affected` *(optional)* — where a PR is expected to land.
- `## References` *(optional)* — related PRs, prior issues, external docs.

## Cross-repo work

If the change spans repos — most often a SahajCloud schema change that consumers must re-sync —
**stop and use `/cross-repo-issue` instead.** It files the tracking issue upstream and the linked
children downstream in the right order. A single issue in one repo silently loses the
producer-before-consumer constraint.

## Quality bar

- "Improve X" — what is the measurable end state?
- No acceptance criteria — how does the implementer know they are done?
- No reproduction steps on a bug — describe the smallest path to the symptom.
- Three features in one body — draft three tickets.
- Scope that touches a published contract — say so explicitly; it changes the autonomy gate in
  `/implement-issue` from "draft a PR" to "file and stop".
