---
name: implement-roadmap
description: Turn one approved roadmap goal into at most one implementation ticket per repo it touches, each carrying all of that repo's work. Researches the code and the packages, orders producers first, absorbs existing tickets, and writes every child through write-ticket. The verb that fired it also approves the children, so the build starts when the plan ends. Re-plans the children when the goal changes. Fired by `@sydevs-bot implement` on a roadmap ticket. Runnable locally against an issue number.
argument-hint: '[owner/repo#N]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Grep, Glob, Task, WebFetch, WebSearch
---

# Implement roadmap

The goal is approved. Your output is one implementation ticket per repo the goal touches, which
the loop builds with no further question. The `implement` verb that fired you also approves them:
nobody reads the children before the build starts, so each must be complete. You write no code.
**Start with `/workflow:start-run` and end with `/workflow:finish-run`.** The rules for both
tiers are `/workflow:format-ticket`. Read it first.

The record's `flags.mode` is `plan` (first time, or after every child closed) or `replan` (the
goal changed under existing children, or they were planned under the old split).

## 1. Read

- The goal's body — its `## Decisions` are binding — and its Technical notes block, after the
  `roadmap.notesMarker` line. An older goal may keep its notes in `v1` comments instead.
- Its current sub-issues, open and closed, and every ticket the notes name as related.
- The code in every repo the goal touches, and the docs of every package the plan leans on.

**Any unticked open question → stop.** Comment that `implement` waits on it, and file nothing.

## 2. Settle every fact

Verify each claim the plan rests on, in the code or the package's own docs and source, or by an
experiment in your scratchpad that pushes nothing. A fact only a person's access can settle — a
vendor account, production data — is written as a decision. Then:

1. Write it into the goal's `## Open questions`, in plain language, with options and a
   recommendation.
2. File nothing, and end.

The dispatcher hands the goal back to the reviewer, and approves nothing.
(why: docs/why.md#a-late-decision-goes-to-the-goal)

## 3. One child per repo

List the repos the goal touches. **Each gets exactly one child, carrying all of that repo's work
for the goal.** Never file two children in one repo — not by layer, not by size, not at a seam,
not for a "general capability first". A large child is built in one session, and continued if it
runs long. (why: docs/why.md#a-goal-gets-one-ticket-per-repo)

Across repos, follow `cross-repo.md`: the producer's child blocks each consumer's child, and a
consumer whose only work is a re-sync gets no child. That `Blocked by:` orders the **merge**, not
the build: the whole set is built together, in one session.

**Write the plan into the Technical notes block before you file anything**: each child's repo,
what it delivers, what it provides to and consumes from its siblings, and the merge order. A
resumed run continues from it.

## 4. Absorb, then file

Follow `adoption.md` for every existing ticket. Then file each new child by running
`/workflow:write-ticket` in `create` mode in its own subagent (Task). Give it:

- the repo;
- every part of the goal that lands in that repo;
- the parent's URL;
- the siblings and the interfaces between them;
- its `Blocked by:` lines.

Each child lands as a native sub-issue of the goal.

## 5. Re-plan (`replan`)

Compare every child with the goal as it now reads:

| Child | Do |
| --- | --- |
| Still right | Leave it. |
| Needs to change, no PR open | Update it through `write-ticket` in `update` mode, and say what changed on the child. |
| A second unstarted child in the same repo | Fold its work into that repo's child through `write-ticket` in `update` mode. Close it as a duplicate, with one line linking the child that absorbed it. |
| No longer needed | Close it as not planned, with one line saying why. |
| Missing | File it as in step 4. |
| Has an open PR | Leave it. Name the drift on the goal instead. |

## 6. Reply on the goal

One comment, inside `writing.budgets.comment`, with `identity.commentMarker`:

- the children in merge order, one line each: `org/repo#N — what it delivers`;
- that they are approved, and the build starts now — any child still blocked starts when its
  blocker clears.

## Hard rules

- **Never write code, branch, or push.** This skill writes tickets.
- **Never leave a child with an open question.** A decision goes to the goal.
- **Never file two unstarted children in one repo.**
- **Never file a Bug from a goal**, and never file a child for a contract re-sync.
- **Never authorise a child yourself.** The human's `implement` that fired you does, through the
  dispatcher.
- **Every unit is idempotent.** Search for an existing child before you file one.
