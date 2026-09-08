---
name: split-ticket
description: Break one ticket into ordered children, each in the triage format with its own approach, from a read of the codebase. Fired by `@sydevs-bot split`. Runnable locally against an issue number.
argument-hint: '[owner/repo#N]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Grep, Glob, Task
---

# Split ticket

The same analysis as `/workflow:revise-ticket`, ending in children instead of one body. **Start
with `/workflow:handler-preflight` and end with `/workflow:handler-journal`.**

## Reads

As `/workflow:revise-ticket`: the body, the comments newer than its last edit, the instruction in
the comment the record points at, and the code the ticket touches.

**One duplicate search per child** before filing it:

```
mcp__github__search_issues  query:"repo:$ORG/$REPO is:issue in:title <key words> -label:ops-journal"
```

A child that already exists, open or closed, is linked, not filed. (why:
docs/why.md#the-ops-journal-exclusion-is-mandatory)

## Writes

- At most `ceilings.maxChildrenPerSplit` children, each with `mcp__github__issue_write
  method:create`: the type, a `<type>(<scope>): <subject>` title, a body in the
  `/workflow:triage-issue` format with its own `## Approach`, **Priority** copied from the
  parent and **Effort** set by you. **Never assign anyone.**
- **Ordering is a `Blocked by:` line** in each child's `## Notes`, naming the child that must
  land first, in the `relationships.bodyMarkerFormat` shape. Actions turns the line into a
  native relationship and applies `labels.blocked`. A cloud run cannot write the relationship
  itself. (why: docs/why.md#the-lock-label-is-the-lease)
- The parent body gains a `## Children` list, in order, with full `org/repo#N` links.
- **One comment on the parent**, inside `writing.budgets.comment`, listing the children in order
  with one line each on why the seam sits there, with `identity.commentMarker`.

**Do not close the parent.** The reviewer decides whether it stays as the tracking issue.

**Resuming** (`attempt > 1`): a child whose title matches one already filed is not filed again.
Continue from the first missing child.

## Hard rules

- **Never branch, commit, or push.**
- **Never file a child you cannot point at a line for.** A child with no `## Approach` is a
  guess, and a guess is a comment on the parent, not an issue.
- **Never exceed `ceilings.maxChildrenPerSplit`.** Say in the comment what was left out.
- **Never write `labels.awaiting`, `labels.blocked`, an assignee, or a Status.** Actions owns
  them. (why: docs/why.md#awaiting-has-one-writer)
- **Never implement.** (why: docs/why.md#a-request-in-prose-is-not-permission)
