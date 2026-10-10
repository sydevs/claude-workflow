---
name: file-ticket
description: Raise a new ticket — a bug, a small change, or a roadmap goal. Pushes back first when the work is already in the pipeline or contradicts a recorded decision, classifies it, asks each open question with a recommendation, then files it in the right tier. A docs-only fix becomes a PR instead. Proposes a milestone when related goals have none. User-invoked only; it files nothing without your yes.
argument-hint: '[what you want, in your own words]'
disable-model-invocation: true
allowed-tools: Bash(git log:*), Bash(gh issue:*), Bash(gh api:*), Read, Grep, Glob, AskUserQuestion
---

# File ticket

Intake only. This skill decides **whether** a ticket should exist and **which tier** it belongs
to. The writing is done by the same skills the loop uses, so what you file is indistinguishable
from what the loop files. The format is `/workflow:format-ticket`. Read it first.

**Ask every question with `AskUserQuestion`**: the clarifying ones, a pushback, each open
question, the yes before filing, a milestone, the hand-over. Fall back to prose only when the tool
is missing. Put the recommended option first, labelled `(Recommended)`, with its consequence in
the description. A call takes at most four questions, of two to four options each, and the tool
always adds a free-text answer. (why: docs/why.md#intake-asks-with-options)

## 0. Who is filing

```bash
gh api user --jq .login
gh api "repos/$ORG/claude-workflow/contents/loop-config.json" -H 'Accept: application/vnd.github.raw' --jq .assignment.reviewer
```

The same login → **technical**. A different login, or `gh` not logged in → **non-technical**:

- write every question and preview in plain language;
- never ask a technical question (see **Ask**);
- never offer the hand-over in step 5.

## 1. Understand the request

Get the intent, not the design: who is affected, what they see today, what they should see. For a
bug, the smallest path to the symptom. Ask only what the code and the backlog cannot answer, and
offer your best readings as the options.

## 2. Push back first

A ticket that duplicates one in flight, or quietly reverses a decision, costs more than it saves.
Before you write anything, search:

- open **and closed** tickets in the likely repos (`search_issues`), including ones closed as not
  planned;
- every open Roadmap ticket, and the `## Decisions` sections of all of them;
- the repo's `AGENTS.md`, `docs/`, and `claude-workflow/docs/why.md` for a recorded position.

Then say plainly what you found:

| Found | Recommend |
| --- | --- |
| The same work, open | Don't file. Comment on it, or attach it to the goal it serves. |
| The same work, closed as done | Don't file. Show what shipped, and what — if anything — is missing. |
| A recorded decision against it | Don't file without new evidence. Quote the decision and where it lives. |
| A goal this would serve | File it as a child of that goal, or fold it into the goal's body. |

Ask it as one question: your recommendation first, `File it anyway` after it. The person can
override any of these. Record their reason in the ticket. (why: docs/why.md#push-back-before-filing)

## 3. Classify

Use format-ticket's rule. A request that needs a product decision, or more than one reviewable
PR, is a **Roadmap** ticket. A Bug is always direct.

**A docs-only fix needs no ticket** — a doc says one thing, and the code plainly does the right
other thing. Ask `Fix it in a PR now (Recommended)` or `File a Bug anyway`. On the PR, branch
`claude/docs-<scope>-<slug>` in that repo, fix only the docs, and ship through
`/workflow:finalize-pr`. (why: docs/why.md#a-docs-fix-is-a-pr-not-a-ticket)

## 4a. A roadmap goal

1. **Write the body** in the roadmap template, in plain language. Name the decisions you can see,
   each with options and a recommendation. Leave technical findings out of the body. If you
   gathered any, post them afterwards as the `roadmap.notesMarker` comment.
2. **Pick the repo.** A goal in a launch lives in that milestone's repo. Otherwise, the product
   repo whose users feel the outcome.
3. **Run Ask** on the draft, below, then file on the yes:
   ```
   mcp__github__issue_write  method:create  owner:$ORG  repo:$REPO
     title:"<plain sentence>"  body:"<body>"  type:"Roadmap"
     issue_fields:[{field_name:"Priority", field_option_name:"Medium"}]
   ```
   Then set the milestone with `gh issue edit <n> --repo "$ORG/$REPO" --milestone "<title>"`.
4. **Stop.** The dispatcher starts `revise-roadmap` on a member's goal within a minute. The review
   and its questions continue on GitHub.

### Propose a milestone

When the goal sits with two or more related open goals that have no milestone, propose one: a
name a visitor understands, a one-line description, and its home repo. Ask
`Create it (Recommended)` or `No milestone`. On a yes:

```bash
gh api "repos/$ORG/<home>/milestones" -f title="<name>" -f description="<one line>"
gh issue transfer <n> "$ORG/<home>" --repo "$ORG/<repo>"   # each goal not already in <home>
gh issue edit <n> --repo "$ORG/<home>" --milestone "<name>"
```

Transfer only a goal with no children yet. A milestone lives in one repo, and so do its goals.

## 4b. A bug or a small ticket

Run `/workflow:write-ticket` in `create` mode with the repo and the intent. It researches the
code, writes the full implementation ticket, runs **Ask** on it, and files it on the yes.

## Ask — the open questions, then the yes

Before anything is filed:

1. **List the decisions the draft raises.** Only a decision a person owns, never a fact — the
   format-ticket rule.
2. **A non-technical person is never asked a technical question** — one whose options take
   knowing the code, a package or a platform to weigh. Leave it in `## Open questions`, and name
   it in the yes.
3. **Ask the rest**, up to four a call. Each offers the recommended option, at most two others,
   then `Leave it on the ticket`. A question left there goes into `## Open questions`, with its
   options and recommendation, for the review on GitHub. On a Bug or a small ticket, that ticket
   is its home, and `implement` waits for the answer.
4. **Fold each answer into the body**, in the section it shapes: the goal, what success looks
   like, `## Not included`; or the summary, the approach, the criteria. State it as what the
   ticket wants. It is not a `## Decisions` entry, and not a ticked question: before filing, an
   answer is the request itself. After filing, answers go to `## Decisions` as format-ticket says.
   (why: docs/why.md#an-answer-before-filing-is-the-request)
5. **The yes.** Ask `File it (Recommended)` with the title, repo, type, Priority and body as its
   `preview`, then `Change something` and `Don't file`. A non-technical person's preview is a
   plain summary of what will happen. On a change, edit the draft and ask again.

## 5. Hand over

Never authorise work on your own initiative, and **never offer this to a non-technical person**.
For a technical person and an implementation ticket, ask:

> Filed as sydevs/SahajCloud#661 (Bug, High). Hand it to the loop now? I would comment
> `@sydevs-bot implement` as you.

Recommend `Hand it to the loop` only when the ticket has no open question, and `Leave it for
review` otherwise. On a hand-over, post `@sydevs-bot implement` with
`mcp__github__add_issue_comment`. That comment is the authorisation.
(why: docs/why.md#a-request-in-prose-is-not-permission) A roadmap goal is never handed over here —
its `implement` comes after its open questions are settled.

## Hard rules

- **Never file without searching**, closed tickets and recorded decisions included.
- **Never hide a pushback.** Say what you found, even when the person overrides it.
- **Never ask in prose** while `AskUserQuestion` is available.
- **Never record an intake answer under `## Decisions`.** Fold it into the body.
- **Never write an implementation ticket here.** `write-ticket` does.
- **Never set a label, a Status, or an assignee.** The dispatcher does.
