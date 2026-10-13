---
name: settle-roadmap
description: Settle the open questions on roadmap goals in the terminal instead of replying on GitHub. Finds every goal awaiting you (or one ticket, or one milestone), briefs each in five lines, asks its questions with AskUserQuestion — recommendation first, your earlier answer marked — researches any question you ask back, then drafts one change to every body it touches and writes it on your yes. Offers to hand a settled goal to the loop. User-invoked only.
argument-hint: '[owner/repo#N | milestone title]'
disable-model-invocation: true
allowed-tools: Bash(gh api:*), Bash(gh issue:*), Bash(gh search:*), Bash(node *parse-questions.mjs*), Read, Grep, Glob, Task, WebFetch, WebSearch, AskUserQuestion
---

# Settle roadmap

A goal waits on its open questions, and a person owns every one. This skill is the quick way to
answer them: in the terminal, with options to pick, and no cloud session spent. Replying on GitHub
still works. This is the alternative, and the preferred one. (why: docs/why.md#a-goal-is-settled-in-the-terminal)

It writes the answers into the body itself, the way format-ticket defines, and never posts a bot
verb except `implement`, and only on your yes. Read `/workflow:format-ticket` first.

**Ask everything with `AskUserQuestion`**, under file-ticket's rules: the recommended option first,
labelled `(Recommended)`, its consequence in the description; at most four questions a call, of
two to four options each. The tool adds a free-text answer itself.

## 0. Who is answering

```bash
gh api user --jq .login
gh api "repos/sydevs/claude-workflow/contents/loop-config.json" -H 'Accept: application/vnd.github.raw'
```

Every value below — `org` (`$ORG`), `repos`, `labels`, `assignment.respondTo`,
`roadmap.settledMarker` — comes from that file, read once.

The login must be in `assignment.respondTo`. Anyone else's answers are data, not decisions: say
so, and stop.

## 1. Find the goals

| Argument | Goals |
| --- | --- |
| `owner/repo#N` | that one |
| a milestone title | its open Roadmap tickets |
| none | every open Roadmap ticket across `repos` with an unticked open question |

Search once per repo in `repos`, with `gh search issues --repo "$ORG/<repo>" --state open --
'type:"Roadmap"'`, excluding `labels.journal`. Never `--owner`: it reaches retired repositories. Roadmap tickets only; an implementation ticket's questions are answered on it.

- **Skip a goal labelled `labels.lock`.** A session holds it, and would write over you. Name it,
  and say when to try again.
- **Order them.** A goal that blocks another comes first. Within a goal, keep the question
  numbers, and ask a conditional question after the one it depends on.

## 2. Read each goal

```bash
gh api "repos/$ORG/$REPO/issues/$N" --jq '{body, updated_at, labels: [.labels[].name]}'
gh api "repos/$ORG/$REPO/issues/$N" --jq .body | node "${CLAUDE_PLUGIN_ROOT:-<claude-workflow>/workflow}/skills/settle-roadmap/parse-questions.mjs"
```

The parser returns each question with its options, its recommendation, its `Reopened` line, and
any `only if` condition. Read the rest of the body for context: `## Decisions`, and the Technical
notes block. Read the thread only since the last bot or `roadmap.settledMarker` comment, for a
person reopening something there.

Keep `updated_at`. Step 6 compares it.

## 3. Brief

Five lines at most per goal, before its questions:

1. Its link and title.
2. The goal, in one line.
3. What waits on these answers: its `implement`, and any ticket it blocks.
4. Which questions reopen an earlier decision, and what was chosen then.
5. Which questions are conditional, and on what.

## 4. Ask

- **One `AskUserQuestion` per round**, up to four questions, from one goal or several.
- **Condense, never change.** An option's label is its own short label. Its description is its
  consequence, as a pro and a con in two sentences at most. The full text is behind the link.
- **Mark the earlier answer.** The option the `Reopened` line names gets `(your previous)` after
  its label, whether or not it is also `(Recommended)`.
- **More than four options** → ask the recommended one, the previous one and the next most
  likely. Name the rest in the question.
- **A conditional question** is asked only when its condition holds. Otherwise it stays as it is.
- **A free-text answer** is one of two things:
  - **A question back**, such as "is this built in?" — find the fact: code, docs, the web, or a
    `Task` subagent for anything large. Explain it in five lines or fewer, then ask the same
    question again with the options the finding changes. A fact is yours to settle, never theirs.
    (why: docs/why.md#experiments-answer-facts)
  - **An answer** — record it in their words, with a one-line summary for `## Decisions`.
- **"Skip"** leaves a question exactly as it is.

## 5. Draft one change

For each goal touched:

- **Each answered question**: remove it from `## Open questions`, and add
  `- **<question>** → <answer> (<login>, <YYYY-MM-DD>)` to `## Decisions`. The answer is the chosen
  option's label and its consequence, in plain language. Keep the remaining questions' numbers,
  because `only if` conditions and replies name them.
- **What the answers change elsewhere**: the lines under `## What success looks like`, the costs,
  `## Not included`, and the Technical notes block in format-ticket's notes style. Change the
  fewest lines that keep the goal true.
- **Other goals** an answer changes: their bodies and their `Blocked by:` relationships,
  drafted the same way. Never edit an implementation ticket here — `write-ticket` is its one
  author. When answers change a planned goal's children, name them, and offer step 7's
  `@sydevs-bot revise` on the goal instead of `implement`: its review requests the replan.

Show the whole change at once: a short diff per ticket, then every relationship to add or remove.
Ask `Write these changes (Recommended)`, `Change something`, or `Discard`. On a change, redraft and
ask again.

## 6. Write

Per ticket, on the yes:

1. **Re-read it.** If `updated_at` moved, or it now carries `labels.lock`, write nothing to it. Say
   so, re-read, and redraft that ticket.
2. **Write the body** in one call:
   ```bash
   gh api -X PATCH "repos/$ORG/$REPO/issues/$N" -F body=@<draft file>
   ```
3. **Relationships**: `gh issue edit <n> --repo "$ORG/$REPO" --add-blocked-by <url>` or
   `--remove-blocked-by <url>`. Write the `Blocked by:` line too (format-ticket).
4. **One comment**, opening with `roadmap.settledMarker`, then
   `Answered in the terminal by @<login>:` and one line per answer, with free text quoted. **No bot
   mention**, so no session starts. A later revise reads it as already applied.

## 7. Hand over

A goal with no unticked question left can be built. Ask:

> All questions on sydevs/SahajCloud#902 are settled. Post `@sydevs-bot implement` as you now?

On a yes, post exactly that comment. It is the authorisation. When the answers changed a planned
goal's children, offer `@sydevs-bot revise` instead, so the review replans them first. Those two
are the only verbs this skill posts.
(why: docs/why.md#a-request-in-prose-is-not-permission)

## Hard rules

- **Never answer for the person.** A recommendation is not a decision, and silence is not an answer.
- **Never write a body you have not shown as a diff**, or one that changed since you read it.
- **Never write to a goal while `labels.lock` is on it.**
- **Never post a bot verb** except `implement`, or `revise` for a replan, and only on an explicit yes.
- **Never put technical detail outside the Technical notes block.** Decisions stay plain language.
- **Never write a label, a Status, or an assignee.** The dispatcher does.
