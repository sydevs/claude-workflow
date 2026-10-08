---
name: implement-roadmap
description: Turn one approved roadmap goal into implementation tickets a reviewer can take one PR at a time. Researches the code and the packages, splits only at reviewability seams, orders producers first, adopts existing tickets, and writes every child through write-ticket. Re-plans the children when the goal changes. Fired by `@sydevs-bot implement` on a roadmap ticket. Runnable locally against an issue number.
argument-hint: '[owner/repo#N]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Grep, Glob, Task, WebFetch, WebSearch
---

# Implement roadmap

The goal is approved. Your output is a set of implementation tickets that the loop can build with
no further question, each giving its reviewer a PR they can understand on its own. You write no
code. **Start with `/workflow:start-run` and end with `/workflow:finish-run`.** The rules for both
tiers are `/workflow:format-ticket`. Read it first.

The record's `flags.mode` is `plan` (first time, or after every child closed) or `replan` (the
goal changed under existing children).

## 1. Read

- The goal's body — its `## Decisions` are binding — and its `roadmap.notesMarker` comment.
- Its current sub-issues, open and closed, and every ticket the notes comment names as related.
- The code in every repo the goal touches, and the docs of every package the plan leans on.

**Any unticked open question → stop.** Comment that `implement` waits on it, and file nothing.

## 2. Settle every fact

Verify each claim the plan rests on, in the code or the package's own docs and source. A fact you
cannot settle without a person is a decision. Then:

1. Write it into the goal's `## Open questions`, in plain language, with options and a
   recommendation.
2. File nothing, and end.

The dispatcher hands the goal back to the reviewer. (why: docs/why.md#a-late-decision-goes-to-the-goal)

## 3. Design the split

Apply format-ticket's split rule, and nothing else. **The test for each child: can a reviewer
judge its PR without holding another PR in their head?**

- Split off a general capability the goal then uses: a schema, an endpoint, a shared component.
- Split apart parts with little connective tissue between them.
- Never split coupled work, and never split for size — a large child is built in `## Phases`.

(why: docs/why.md#split-at-reviewability-seams)

Across repos, follow `cross-repo.md`: producer first, and no child for a re-sync. Between any two
children likely to touch the same files, add a `Blocked by:` too — unblocked children run in
parallel.

**Write the plan into the notes comment before you file anything**: each child's one-line purpose,
its repo, what it provides and consumes, and its order. A resumed run continues from it.

## 4. Adopt, then file

Follow `adoption.md` for every existing ticket. Then file each new child by running
`/workflow:write-ticket` in `create` mode in its own subagent (Task). Give it:

- the repo;
- the child's intent;
- the parent's URL;
- the siblings and the interfaces between them;
- its `Blocked by:` lines.

Each child lands as a native sub-issue of the goal.

## 5. Re-plan (`replan`)

Compare every child with the goal as it now reads:

| Child | Do |
| --- | --- |
| Still right | Leave it. |
| Needs to change, no PR open | Update it through `write-ticket`, and say what changed on the child. |
| No longer needed | Close it as not planned, with one line saying why. |
| Missing | File it as in step 4. |
| Has an open PR | Leave it. Name the drift on the goal instead. |

## 6. Reply on the goal

One comment, inside `writing.budgets.comment`, with `identity.commentMarker`:

- the children in build order, one line each: `org/repo#N — what it delivers`;
- which wait on which;
- the next step: *read them, then `@sydevs-bot implement` here approves them all.*

## Hard rules

- **Never write code, branch, or push.** This skill writes tickets.
- **Never leave a child with an open question.** A decision goes to the goal.
- **Never split for size, and never split coupled work.**
- **Never file a Bug from a goal**, and never file a child for a contract re-sync.
- **Never authorise a child.** Only a human's `implement` does.
- **Every unit is idempotent.** Search for an existing child before you file one.
