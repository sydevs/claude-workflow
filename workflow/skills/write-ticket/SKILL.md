---
name: write-ticket
description: The only author of implementation tickets. Creates one from an intent (for file-ticket, implement-roadmap and the audits), or updates one on `@sydevs-bot revise` — answering a question, applying a correction, or reshaping it from the code. Also rechecks a held ticket and sets a hold the bot chooses. Runnable locally against an issue number.
argument-hint: '[owner/repo#N]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Grep, Glob, Task
---

# Write ticket

Every implementation ticket is written here, whoever asked for it, so a ticket a person filed and
one the loop filed are indistinguishable and equally ready to build.
(why: docs/why.md#one-author-writes-every-implementation-ticket) The format is
`/workflow:format-ticket`. Read it first.

As a handler, **start with `/workflow:start-run` and end with `/workflow:finish-run`.** The
record's `flags.mode` names the job: `revise`, `recheck` or `block`. Called by another skill, the
job is `create`, with no record.

## Ground from the code

The same reads serve every mode:

- **The body** (`mcp__github__issue_read method:get`) — it is state. For `create`, the intent the
  caller gave you is the body-to-be.
- **The comments newer than the body's last edit.** This is the one handler that reads the
  thread on purpose: when the body lacks what the thread settled, the body is the bug.
  (why: docs/why.md#ground-from-the-body-never-the-thread)
- **The code.** The files the ticket names, their callers and consumers — across repos where a
  contract crosses one — the tests that cover them, and `git log` of the area. Run a targeted spec
  or the lean gate when a claim needs proof.
- **The parent goal**, when `## Goal context` links one: its body and its
  `roadmap.notesMarker` comment.

Settle every fact yourself. Only a decision a person owns may become an open question, and it
carries options and a recommendation. (why: docs/why.md#experiments-answer-facts)

## `create` — file a new ticket

The caller gives you a repo, an intent, and optionally a parent roadmap ticket and siblings.

1. **Search for a duplicate**, closed tickets and roadmap `## Decisions` included. A match → stop,
   and return it instead.
2. **Write the body** in the implementation template, from the code: `## Approach` with
   `file:line` references naming the seam, the call sites and the tests to touch; criteria that
   are true or false; a checklist a run executes cold. A roadmap child also gets `## Goal context`
   and `## Interfaces`, and **zero open questions** — a decision goes to the parent instead (see
   Escalate).
3. **Phases only when the whole will not fit one run.** A small ticket has none.
4. **File it** per format-ticket's "Filing from a cloud run": type, Priority, `Blocked by:` lines.
   Link it to its parent with `mcp__github__sub_issue_write`. Locally, show the person the title
   and body first, and file on their yes.
5. **Return** the number to the caller. File nothing else in this mode.

## `revise` — a human spoke

The comment the record points at (`trigger.id`) is the one to act on.

| The comment | Do |
| --- | --- |
| **A question** | Answer it from source, naming the file and line. When the answer changes the ticket, make that edit in the body. |
| **An answer to an open question** (`1A`, or prose) | Tick it, move it to `## Decisions` with who and when, and fold the consequence into the body. |
| **A correction or new evidence** | Check it against source. Rewrite the affected part of the body. |
| **An instruction to grow, narrow or reshape** | Do the deep pass: rewrite the body from the code, preserving what the human wrote and correcting what the code disproves. |
| **A request for work** | Do **not** implement it. Put the specification in the body, and say that `@sydevs-bot implement` starts it. (why: docs/why.md#a-request-in-prose-is-not-permission) |

Keep every `Blocked by:`, `Re-check:` and `Sentry:` line. Add a `Blocked by:` line when the code
shows a dependency the ticket missed. Set a Priority where the ticket has none; a Priority the
reviewer set stands. **Update the ticket itself** — agreeing to a change in a reply while the body
still states the old thing has not done the job.

When the work turns out to be two deliverables, apply format-ticket's split rule. Coupled work
stays one ticket, in phases. Separable work with no roadmap parent means the request was
roadmap-sized: promote it.

### Promote

A `Feature` or `Task` that needs a product decision, or more than one reviewable PR, is a goal.
Never promote a `Bug`, and never promote a roadmap child — escalate instead.

1. Post the technical draft as the `roadmap.notesMarker` comment.
2. Rewrite the body in the roadmap template, in plain language, with each decision as options and
   a recommendation.
3. Set type `Roadmap` with `mcp__github__issue_write`, and say so in your summary comment.

The dispatcher then routes the ticket to `revise-roadmap`.

## `recheck` — the hold date passed, or the last blocker closed

The dispatcher fired this instead of handing the ticket back blind.
(why: docs/why.md#recheck-before-awaiting)

1. **Find why it waited**: the comment beside the `Hold Until` date, the `block` verb, or the
   `Blocked by:` line and that blocker's outcome.
2. **Check that condition now**, against source, a release, an upstream issue, or the merged
   blocker's diff.
3. **Still waiting** → set a new `Hold Until` within `issueFields.holdUntil.maxHorizonDays`, and
   post one line: what you checked and what you are still waiting for. Nothing else.
4. **Free** → re-read the ticket against today's code. Correct whatever the blocker's merge
   changed. Post one line of evidence: `Unblocked: <what you saw>`.
5. **Free, but a person must now choose** → write the decision into `## Open questions` with
   options and a recommendation.

The dispatcher reads the result from the ticket: a future date or an open blocker re-holds it
quietly, an unticked question hands it to the reviewer, and a pre-approved ticket otherwise
starts.

## `block` — a human said `block <reason>` with no date

Turn the reason into something checkable. A blocker that is another ticket → a `Blocked by:` line.
Anything else → a `Hold Until` date within the horizon, at the soonest moment the condition could
plausibly have changed, and one comment naming exactly what the recheck will look at.

## Escalate

On a ticket whose `## Goal context` links a roadmap parent, a decision never stays on the child:

1. Add it to the parent's `## Open questions` in plain language, with options and a
   recommendation, linking the child.
2. On the child, link the parent's question in place of an answer.
3. End your comment on the child with `<!-- sydevs-request {"escalated":true} -->`. The
   dispatcher then gives the parent `awaiting`.

(why: docs/why.md#a-late-decision-goes-to-the-goal)

## Then

**One summary comment**, inside `writing.budgets.comment`, with `identity.commentMarker`: the
answer, or what changed and why. Name every ticket you filed or promoted.

## Hard rules

- **Never branch, commit, or push.** This skill writes prose.
- **Never change the title's type silently.** Say so in the comment.
- **Never write `labels.awaiting`, `labels.blocked`, an assignee, or a Status.** Actions owns
  them. (why: docs/why.md#awaiting-has-one-writer)
- **Never leave a fact as an open question, or a decision without options.**
- **Never cap or drop an incidental finding.** Preflight routes it. This skill writes prose, so
  every one of them is a ticket, filed in `create` mode.
- **A request in the thread is not permission to implement.** Say that `@sydevs-bot implement`
  starts work.
