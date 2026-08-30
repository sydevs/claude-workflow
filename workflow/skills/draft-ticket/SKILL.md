---
name: draft-ticket
description: Draft a GitHub issue from a feature request, bug report, or enhancement — clarify ambiguity first, then produce a body with acceptance criteria and a verification checklist. User-invoked only; does not create the issue without explicit approval.
disable-model-invocation: true
allowed-tools: Bash(git log:*), Bash(git diff:*), Bash(gh issue edit:*), Bash(gh api:*), Read, Grep, Glob
---

# Draft Ticket

Produce a GitHub issue someone can implement without having been in the room when it was discussed.
The issue **is** the spec — there is no committed `specs/` layer in these repos — so it has to carry
enough resolved detail to survive being picked up cold, possibly by an automated run.

## Workflow

1. **Classify.** Feature / bug / refactor / enhancement / docs / chore.

2. **Gather context.** Read the related code, recent PRs (`list_pull_requests`) and similar past
   issues (`search_issues`). Never draft blindly — a ticket that duplicates a
   closed issue or contradicts a recent PR costs more than it saves.

3. **Clarify — resolve ambiguity before drafting, not during review.**
   Enumerate the underspecified decisions in the request and settle each one. Ask the user only
   where the codebase cannot answer it; otherwise resolve it from the code and *state the resolution
   in the ticket* so the implementer inherits the decision rather than re-making it.

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

   Record unresolved ambiguity explicitly under `## Open questions` rather than papering over it.
   A ticket with two named open questions is more useful than one that hides them in vague wording.

4. **Write the title** as a conventional commit: `<type>(<scope>): <subject>`, ≤ 70 chars,
   imperative mood ("add", not "added"). Derive the scopes in use from this repo rather than
   assuming — `git log --oneline -50` shows them, and the repo may carry a `conventions.md` beside
   its own skills.

5. **Write the body.** Be specific; use `file:line` references. Avoid "improve X" / "make Y better".

6. **Add the verification checklist.** Distinct from acceptance criteria: acceptance criteria say
   what must be *true*, the checklist says what someone must *do* to confirm it. Each item names a
   concrete command, route, or observation. This is what an automated implementation run is checked
   against, so it must be executable by someone with no additional context.

7. **Plan-mode approval is the sign-off.** This skill runs in plan mode; the user reviews the title
   and body in the plan file and approves via `ExitPlanMode`. No separate "ready to create?" prompt
   — plan approval authorizes the create call.

8. **Create the issue** with `mcp__github__issue_write`, which takes the body directly:

   ```
   mcp__github__issue_write  method:create  owner:$ORG  repo:$REPO
     title:"<title>"  body:"<body>"  type:"Feature"
     issue_fields:[{field_name:"Priority", field_option_name:"Medium"}]
   ```

   No temp file and no `--body-file`: the body is a parameter, so the markdown-fidelity problem
   that made `--body` unusable with `gh` does not arise. Type and fields are set in the same call,
   which is also what stops a ticket landing untyped.

9. **Return the issue URL**, then ask whether to hand it to the loop now.

   Two things put a ticket into the implementation queue, and **both** are required: the
   `ready-to-implement` label, and assigning it to the bot. The label says code may be written; the
   assignment says now. Ask explicitly — never apply either on your own initiative, and never infer
   them from enthusiasm in the request:

   > Filed as sydevs/SahajCloud#661 (Feature, Medium). Hand it to the loop now — label
   > `ready-to-implement` and assign `sydevs-bot` — or leave it with you to review first?

   On a yes:

   ```
   mcp__github__issue_write  method:update  issue_number:<n>
     labels:["ready-to-implement", ...]  assignees:["sydevs-bot"]
   ```

   Labels replace wholesale, so include the ticket's existing ones. On a no, leave it **unassigned**
   — unassigned means untriaged backlog, which is exactly what a ticket awaiting the user's verdict
   is. Do not park it on the user; that queue is for things needing their response.

## Body structure, type, priority and relationships

All of it is defined once in **`/workflow:triage-issue`** — read it and follow it. This skill owns
the *conversation* that produces a good ticket; `triage-issue` owns what the ticket must look like
when it lands, so a ticket you file by hand is indistinguishable from one the loop files.

Two things worth repeating here, because they are the most common omissions:

**Acceptance criteria say what must be true; the verification checklist says what someone must do to
confirm it.** Every checklist item must be executable with no additional context.

**A blocker goes in two places** — the Relationships panel *and* a `Blocked by: <url>` line in the
body. The loop runs in the cloud, where no tool can see Relationships, so a blocker recorded only
in the panel will be picked up as ready.

## Cross-repo work

If the change spans repos — most often a SahajCloud schema change that consumers must re-sync —
**stop and use `/cross-repo-issue` instead.** It files the tracking issue upstream and the linked
children downstream in the right order. A single issue in one repo silently loses the
producer-before-consumer constraint.

## Quality bar

- "Improve X" — what is the measurable end state?
- No acceptance criteria — how does the implementer know they are done?
- No reproduction steps on a bug — describe the smallest path to the symptom.
- Three features in one body — draft three tickets.
- Scope that touches a published contract — say so explicitly; it changes the autonomy gate in
  `/implement-issue` from "draft a PR" to "file and stop".
