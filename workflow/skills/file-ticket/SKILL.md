---
name: file-ticket
description: Raise a new ticket — a bug, a small change, or a roadmap goal. Pushes back first when the work is already in the pipeline or contradicts a recorded decision, classifies it, then files it in the right tier. Proposes a milestone when related goals have none. User-invoked only; it files nothing without your yes.
argument-hint: '[what you want, in your own words]'
disable-model-invocation: true
allowed-tools: Bash(git log:*), Bash(gh issue:*), Bash(gh api:*), Read, Grep, Glob
---

# File ticket

Intake only. This skill decides **whether** a ticket should exist and **which tier** it belongs
to. The writing is done by the same skills the loop uses, so what you file is indistinguishable
from what the loop files. The format is `/workflow:format-ticket`. Read it first.

## 1. Understand the request

Get the intent, not the design: who is affected, what they see today, what they should see. For a
bug, the smallest path to the symptom. Ask only what the code and the backlog cannot answer.

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

The person can override any of these. Record their reason in the ticket.
(why: docs/why.md#push-back-before-filing)

## 3. Classify

Use format-ticket's rule. A request that needs a product decision, or more than one reviewable
PR, is a **Roadmap** ticket. A Bug is always direct.

## 4a. A roadmap goal

1. **Write the body** in the roadmap template, in plain language. Name the decisions you can see,
   each with options and a recommendation. Leave technical findings out of the body. If you
   gathered any, post them afterwards as the `roadmap.notesMarker` comment.
2. **Pick the repo.** A goal in a launch lives in that milestone's repo. Otherwise, the product
   repo whose users feel the outcome.
3. **Show the person** the title, body, repo and milestone, and file on their yes:
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
name a visitor understands, a one-line description, and its home repo. On a yes:

```bash
gh api "repos/$ORG/<home>/milestones" -f title="<name>" -f description="<one line>"
gh issue transfer <n> "$ORG/<home>" --repo "$ORG/<repo>"   # each goal not already in <home>
gh issue edit <n> --repo "$ORG/<home>" --milestone "<name>"
```

Transfer only a goal with no children yet. A milestone lives in one repo, and so do its goals.

## 4b. A bug or a small ticket

Run `/workflow:write-ticket` in `create` mode with the repo and the intent. It researches the
code, writes the full implementation ticket, shows it to the person, and files it on their yes.

## 5. Hand over

Never authorise work on your own initiative. For an implementation ticket, ask explicitly:

> Filed as sydevs/SahajCloud#661 (Bug, High). Hand it to the loop now — I will comment
> `@sydevs-bot implement` as you — or leave it for review first?

On a yes, post `@sydevs-bot implement` with `mcp__github__add_issue_comment`. That comment is
the authorisation. (why: docs/why.md#a-request-in-prose-is-not-permission) A roadmap goal is
never handed over here — its `implement` comes after its open questions are settled.

## Hard rules

- **Never file without searching**, closed tickets and recorded decisions included.
- **Never hide a pushback.** Say what you found, even when the person overrides it.
- **Never write an implementation ticket here.** `write-ticket` does.
- **Never set a label, a Status, or an assignee.** The dispatcher does.
