---
name: revise-ticket
description: Expand or reshape one ticket from the codebase, per the human's instruction — approach with file:line references, criteria, an executable checklist, open questions. Fired by `@sydevs-bot revise`. Runnable locally against an issue number.
argument-hint: '[owner/repo#N]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Grep, Glob, Task
---

# Revise ticket

A deep pass, not a tidy-up. The human asked for the ticket to grow, narrow, or change shape, and
the answer comes from the code. **Start with `/workflow:handler-preflight` and end with
`/workflow:handler-journal`.**

## Reads

- `mcp__github__issue_read method:get` — the body is state. The instruction is in the comment
  the record points at (`trigger.id`).
- **The comments newer than the body's last edit.** This is the one handler that reads the
  thread on purpose: when the body lacks what the thread settled, the body is the bug.
  (why: docs/why.md#ground-from-the-body-never-the-thread)
- **The code.** The files the ticket names, their callers and their consumers — across repos
  where a contract crosses one — the tests that cover them, and `git log` of the area. Run a
  targeted spec or the lean gate when a claim needs proof.

## Writes

Rewrite the body in the `/workflow:triage-issue` format, preserving what the human wrote and
correcting what the code disproves:

- `## Approach` with `file:line` references. Name the seam, the call sites, and the tests to
  touch.
- `## Acceptance criteria` that are true or false, and a `## Verification checklist` a run can
  execute with no other context.
- `## Open questions` for what the code could not settle. Tick what the thread already answered.
- `## Downstream impact` when a consumer repo changes.
- `## Notes`: keep every `Blocked by:`, `Re-check:` and `Sentry:` line. Add a `Blocked by:` line
  when the code shows a dependency the ticket missed.
- The **Effort** field, re-estimated with `mcp__github__issue_write`. Leave **Priority** alone —
  it is the reviewer's.
- **One summary comment**, inside `writing.budgets.comment`, saying what changed and why, with
  `identity.commentMarker`.

When the revision reveals two tickets, say so in the comment and name `@sydevs-bot split`. Do not
split here.

## Hard rules

- **Never branch, commit, or push.** This handler writes prose.
- **Never change the title's type silently.** Say so in the comment.
- **Never write `labels.awaiting`, `labels.blocked`, an assignee, or a Status.** Actions owns
  them. (why: docs/why.md#awaiting-has-one-writer)
- **Never file more than one incidental ticket.** Name the rest in the comment.
- **A request in the thread is not permission to implement.** Say that `@sydevs-bot implement`
  starts work. (why: docs/why.md#a-request-in-prose-is-not-permission)
