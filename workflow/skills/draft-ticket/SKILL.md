---
name: draft-ticket
description: Draft a GitHub issue from a feature request, bug report, or enhancement. Clarify ambiguity first, then produce a body with acceptance criteria and a verification checklist. User-invoked only. It does not create the issue without explicit approval.
disable-model-invocation: true
allowed-tools: Bash(git log:*), Bash(git diff:*), Bash(gh issue edit:*), Bash(gh api:*), Read, Grep, Glob
---

# Draft Ticket

Produce a GitHub issue someone can implement without having been in the room when it was
discussed. The issue **is** the spec — these repos keep no committed `specs/` layer — so it must
carry enough resolved detail to survive being picked up cold, possibly by an automated run.

## Workflow

1. **Classify.** Feature / bug / refactor / enhancement / docs / chore.

2. **Gather context.** Read the related code, recent PRs (`list_pull_requests`), and similar past
   issues (`search_issues`). Never draft blindly — a duplicate of a closed issue, or a ticket that
   contradicts a recent PR, costs more than it saves.

3. **Clarify — resolve ambiguity before drafting, not during review.** List the underspecified
   decisions in the request and settle each one. Ask the user only where the codebase cannot
   answer it. Otherwise resolve it from the code and *state the resolution in the ticket*, so the
   implementer inherits the decision instead of re-making it.

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

   Record unresolved ambiguity under `## Open questions` — do not paper over it. A ticket with two
   named open questions is more useful than one that hides them in vague wording.

4. **Write the title** as a conventional commit: `<type>(<scope>): <subject>`, ≤ 70 chars,
   imperative mood ("add", not "added"). Derive the scopes from `git log --oneline -50` rather
   than inventing one.

5. **Write the body.** Be specific. Use `file:line` references. Avoid "improve X" / "make Y
   better".

6. **Add the verification checklist**, distinct from acceptance criteria: criteria say what must
   be *true*, the checklist says what someone must *do* to confirm it. Each item names a concrete
   command, route, or observation, executable with no other context — this is what checks an
   automated implementation run.

7. **Plan-mode approval is the sign-off.** This skill runs in plan mode. The user reviews the
   title and body in the plan file and approves with `ExitPlanMode` — plan approval authorizes the
   create call, with no separate "ready to create?" prompt.

8. **Create the issue** with `mcp__github__issue_write`, which takes the body directly:

   ```
   mcp__github__issue_write  method:create  owner:$ORG  repo:$REPO
     title:"<title>"  body:"<body>"  type:"Feature"
     issue_fields:[{field_name:"Priority", field_option_name:"Medium"}]
   ```

   No temp file, no `--body-file` — the body is a parameter, so the markdown-fidelity problem that
   made `--body` unusable with `gh` never arises. Setting type and fields here also stops a ticket
   landing untyped.

9. **File it and let the dispatcher place it.** `issues.opened` sets Status Proposed and
   `awaiting` for every author, so set neither. Assign nobody.

   Then ask whether to hand it to the loop now. One comment authorises code, and only a
   `respondTo` human can write it. Ask explicitly. Never post it on your own initiative, and
   never infer it from enthusiasm in the request:

   > Filed as sydevs/SahajCloud#661 (Feature, Medium, Proposed). Hand it to the loop now — I
   > will comment `@sydevs-bot implement` as you — or leave it with you to review first?

   On a yes:

   ```
   mcp__github__add_issue_comment  owner:$ORG  repo:$REPO  issue_number:<n>  body:"@sydevs-bot implement"
   ```

   That comment is the authorisation. The dispatcher moves the ticket to Approved and fires a
   session within a minute. On a no, leave it exactly as filed. `Proposed` plus `awaiting` is not
   a parking space — it is the queue for things genuinely needing a verdict, which is what this
   is. (why: docs/why.md#a-request-in-prose-is-not-permission)

## Body structure, type, priority and relationships

All of it is defined once in **`/workflow:triage-issue`** — read it and follow it. This skill owns
the *conversation* that produces a good ticket. `triage-issue` owns what the ticket must look like
when it lands, so a hand-filed ticket is indistinguishable from one the loop files.

The most common omission: **a blocker is a `Blocked by: <url>` line in the body** (see
`triage-issue`'s Relationships section). The dispatcher converts the line into the native
relationship and the `blocked` label. A blocker recorded only in the Relationships panel gets no
label, and a session reading the body never sees it.

## Cross-repo work

If the change spans repos — most often a SahajCloud schema change that consumers must re-sync —
**stop and use `/cross-repo-issue` instead.** It files the tracking issue upstream and the linked
children downstream in the right order. A single issue in one repo silently loses the
producer-before-consumer constraint.

## Quality bar

- "Improve X" — name the measurable end state.
- No acceptance criteria — the implementer cannot know when they are done.
- No reproduction steps on a bug — describe the smallest path to the symptom.
- Three features in one body — draft three tickets.
- Scope touching a published contract — say so explicitly, and use `/workflow:cross-repo-issue`.
