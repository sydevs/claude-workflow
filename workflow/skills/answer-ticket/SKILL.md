---
name: answer-ticket
description: Reply to one human comment on an issue — answer from source, correct the ticket where the answer changes it, say what starts work. Fired by `@sydevs-bot answer` or a mention with no verb. Runnable locally against an issue number.
argument-hint: '[owner/repo#N]'
disable-model-invocation: true
effort: medium
allowed-tools: Read, Grep, Glob, Bash(git log:*), Bash(git diff:*), Bash(git show:*), Bash(node:*)
---

# Answer ticket

One comment gets one substantive reply. **Start with `/workflow:handler-preflight` and end with
`/workflow:handler-journal`.**

## Reads

- `mcp__github__issue_read method:get` — the body is state.
- `method:get_comments`, **the newest page only** (`perPage: 5`). The comment the record points
  at (`trigger.id`) is the one to answer. Read older ones only when it refers to them.
- One `grep` or `git log` of source where the question needs a fact. Read files, never branch.

## Do

| The comment | Do |
| --- | --- |
| **A question** | Answer it from source, naming the file and line. When the answer changes the ticket, make that edit in the body. |
| **A request for work** | Do **not** implement it. Reply with what you would do and what it costs, put the specification in the body, and say that `@sydevs-bot implement` starts it. |
| **A correction or new evidence** | Check it against source. Rewrite the affected part of the body — a line, a criterion, a ticked question. |
| **A rewrite is what it really needs** | Say so, and name `@sydevs-bot revise`. Do not rewrite wholesale here. |

(why: docs/why.md#a-request-in-prose-is-not-permission)

- **Reply substantively**, inside `writing.budgets.comment`, with `identity.commentMarker`.
  Answer the question, or say what you changed.
- **Update the ticket itself.** Agreeing to a change in a reply while the body still states the
  old thing has not done the job.

## Hard rules

- **Never branch, commit, push, or implement.** The tool grant makes this mechanical.
- **Never read the whole thread.** The newest page, and what the comment cites.
- **Never write `labels.awaiting`, `labels.blocked`, an assignee, Priority, or a Status.**
  Actions owns the labels. The reviewer owns Priority. (why: docs/why.md#awaiting-has-one-writer)
- **Never file more than one incidental ticket.**
