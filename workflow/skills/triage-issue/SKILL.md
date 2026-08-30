---
name: triage-issue
description: The metadata rules for sydevs tickets — issue type, priority label, state labels, relationships, and the standard body format. Shared by draft-ticket, the survey skills, and the loop, so every ticket looks the same whoever filed it.
allowed-tools: Bash(gh issue:*), Bash(gh api:*), Read, Grep
---

# Triage Issue

## Tooling: MCP everywhere, `gh` for one thing

Every GitHub operation in these skills uses `mcp__github__*`. That is not a cloud concession — it
is simply the better interface in both places: bodies pass as parameters (no `mktemp`, no
`--body-file`, no markdown mangling), type and fields set in the same call as the create, and one
set of instructions that reads the same locally and in a routine.

**The single exception is Relationships**, which no MCP tool exposes. Those need `gh`, and
therefore a local session — see below. `git` itself is of course still `git`.

One definition of what a well-formed sydevs ticket looks like. `draft-ticket`, the survey skills,
and `loop-run` all read this rather than each carrying their own copy — the divergence that produced
three forks of the workflow started exactly this way.

## The four fields

### Type — what kind of work (org-level issue types)

| Type | Use when |
| --- | --- |
| `Bug` | Something behaves other than intended. Includes regressions and defects found by survey. |
| `Feature` | New capability or a visible extension of one. |
| `Task` | Work with no user-visible behaviour change: refactors, chores, docs, investigations, decisions. |

```
mcp__github__issue_write  method:update  owner:$ORG  repo:$REPO  issue_number:<n>  type:"Bug"
```

An investigation whose *outcome* is a decision is a `Task`, even when it may lead to a `Feature`.
Type describes the work being requested, not what it might become.

### Priority and Effort — native **fields**, not labels

GitHub's org-level issue fields, available on every `sydevs` repo with no per-repo setup. They are
**not** Projects v2 (which a cloud routine cannot reach) and **not** labels.

| Field | Options | Means |
| --- | --- | --- |
| **Priority** | `Urgent` | Data loss, outage, or security exposure. Drop other work. |
| | `High` | User-visible breakage, or it blocks other work. |
| | `Medium` | Planned work. **The default** — most tickets are this. |
| | `Low` | Do when nothing above it waits. Deferred or speculative. |
| **Effort** | `High` / `Medium` / `Low` | Rough size. Set it honestly — the loop uses it to avoid starting something it cannot finish in one run. |

Priority is about the **consequence of not doing it**, not effort or appetite. A one-line fix to a
broken signup path is `High`; a month of pleasant refactoring is `Low`. Effort is the separate axis,
which is exactly why it is a separate field.

```
mcp__github__issue_write  method:update  owner:$ORG  repo:$REPO  issue_number:<n>
  issue_fields:[{field_name:"Priority", field_option_name:"High"},
                {field_name:"Effort",   field_option_name:"Medium"}]
```

By **name**, and it validates the option against the field before calling. Read them back with
`list_issues(fields:["field_values"])`, which returns the whole backlog's priorities in one call —
that is how the loop sorts without a request per issue.

<details><summary>Raw REST equivalent, if you ever need it</summary>

```bash
gh api -X PUT repos/$ORG/$REPO/issues/<n>/issue-field-values --input - <<< \
  '[{"field_id":14337938,"value":"High"}]'
```

The `value` must be the option **name** — an option id returns `422 must be a string option name`.
`PATCH`ing the issue with a `fields` key returns 200 and silently does nothing. Field ids are in
`loop-config.json` → `issueFields`.
</details>

### The baton — assignment is the queue

**The assignee field holds the state.** It is not a hint; it is the worklist.

| Assignee | Meaning | The loop |
| --- | --- | --- |
| `sydevs-bot` | The bot's turn | Acts on the next run |
| A human | Their turn | Does not touch it |
| Nobody | Genuinely untriaged backlog | May propose, may not act |

`assignee:sydevs-bot` is one indexed query per repo, and it replaces the old census that scanned
every open item and diffed `created_at` against the last run. That census had to be narrowed from 38
issues to 2 for cost, and it broke outright when a bulk issue-field migration bumped every
`updated_at` in the repo and made the whole backlog look like fresh feedback. Do not reintroduce
timestamp reasoning to decide what to work on.

**Reassigning to the reviewer is the FINAL action on any unit of work, and it means "I am done."**
Not "I replied" — done, with nothing further until someone responds:

| The loop finishes… | It assigns to |
| --- | --- |
| Revising a ticket after feedback | the reviewer |
| Revising a PR after review | the reviewer |
| Investigating and reporting a finding | the reviewer |
| Opening a PR that is ready for review | the reviewer |
| Filing a new proposal from a survey | the reviewer — a proposal exists to be judged |

An item assigned to the bot but sitting idle is therefore an **unfinished run**, which is what the
recovery pass looks for. Carrying an assignment across runs should be rare; journal it when it
happens.

### Labels: one gates code, the rest are for humans

**Only the assignee field and `ready-to-implement` mean anything to the loop.**

| Label | Bot meaning | What it tells a human |
| --- | --- | --- |
| `ready-to-implement` | **Ticket-only.** Authorises writing code | A human cleared this for implementation |
| `hold` | **None** | Deliberately frozen — keeps it out of the active scan |
| `blocked-upstream` | **None** | Waiting on an external dependency |
| `needs-info` | **None** | Open questions outstanding; the body carries the list |
| `proposal` | **None** | Loop-raised, awaiting a verdict |
| `ops-journal` | Excluded from every worklist query | A daily journal issue, not real work |

`hold`, `needs-info` and `blocked-upstream` lost their bot meaning because *not being assigned*
already says it, more reliably and in a field visible in every list view. They are kept because they
tell a human **why** an item is parked, which assignment alone cannot.

### `ready-to-implement`: the loop may revoke, never grant

- **Never add it.** This is the safety property that makes the loop safe to leave running: it cannot
  authorise its own code.
- **You may remove it** when investigation raises a question that must be answered before
  implementation. Revoking can only ever reduce the loop's own autonomy, so it is safe.

Removing it is never silent. Pair it with a comment saying what is now unresolved, and put the
questions in the ticket body's `## Open questions` list — otherwise the reviewer sees a label vanish
with no explanation.

**Merge authority is an approving review**, plus green CI and zero unresolved threads. It is never a
label; `ready-to-implement` does not apply to PRs at all.

### Open questions live in the body

Comments are conversation; **the body is state.** Someone opening the ticket cold must see what is
outstanding without reconstructing it from a thread.

```markdown
## Open questions
- [ ] Does any host we support ship `!important` CSS that breaks the widget?
- [ ] Eager-load Turnstile at boot, or escalate when a form finds it blocked?
```

Tick items off in the body as they are answered.

### Relationships — what must happen first

GitHub calls these **Relationships**; the REST resource is `dependencies`.

**This is the one operation with no MCP tool** — everything else in this skill is `mcp__github__*`.
So Relationships are set with `gh`, which means they can only be set from a local session:

```bash
gh issue edit <n> --repo "$ORG/$REPO" --add-blocked-by <m>                     # same repo
gh issue edit <n> --repo "$ORG/$REPO" \
  --add-blocked-by "https://github.com/$ORG/<other>/issues/<m>"                # cross-repo: FULL URL
```

Cross-repo needs the full URL — `owner/repo#N` is rejected as `invalid issue format`. Verify both
directions, because a silent no-op loses the constraint entirely:

```bash
gh api repos/$ORG/$REPO/issues/<n>/dependencies/blocked_by --jq '.[].number'
```

**Also write the constraint into the body.** This is not redundant bookkeeping:

```markdown
Blocked by: https://github.com/sydevs/SahajCloud/issues/632 — the endpoint this consumes does not exist until that merges
```

**No MCP tool exposes Relationships**, so a cloud routine is blind to them — it reads this line
instead. A ticket whose blocker exists only in the Relationships panel will be picked up as ready
and implemented against a shape that does not exist yet. The line is also the version a human
reads without opening a side panel.

`loop-config.json` → `relationships.recheckProbe` records how to test whether the MCP tools have
appeared; the day they do, the body line becomes redundant.

**Priority and relationships together decide implementation order**: the loop takes the
highest-priority ticket whose blockers are all closed. An `Urgent` behind an open blocker waits
behind an unblocked `Medium` — which is correct, and is why recording blockers matters more than
arguing about priority.

## Body format

Every ticket, whoever files it:

```markdown
## Summary
[What and why, ≤3 sentences. A reader who has never seen this repo should
understand the problem.]

## Approach
[How, in enough detail to start. `file:line` references. Omit on a bug report
where the fix is not yet known.]

## Acceptance criteria
- [ ] [Testable condition]

## Verification checklist
- [ ] [A concrete command, route, or observation that confirms the criteria]

## Notes
[Optional: alternatives rejected, prior art, links. Sentry links go here.]
```

**Acceptance criteria vs verification checklist**: criteria say what must be *true*; the checklist
says what someone must *do* to confirm it. The checklist is what an automated run is judged
against, so every item must be executable with no additional context — `pnpm test:unit`, `GET
/api/atlas/sitemap returns 200 with regions`, "the marker is maroon on sahajayoga.ca". Not
"check it works".

## Referring to issues in other repositories

**Always write the full `org/repo#N`, every time — never a bare `#N` after a first full mention.**
GitHub resolves a bare `#171` against the repository the text is *rendered in*, so in a SahajCloud
comment `#171` silently links to SahajCloud#171 rather than the SahajAtlasWeb ticket meant. It is
not an error, just a wrong link, which makes it the kind of mistake that survives review.

The shorthand is only safe for issues in the same repository as the comment.

## Title

`<type>(<scope>): <subject>` — ≤70 chars, imperative. Derive scopes in use from
`git log --oneline -50` in that repo rather than inventing one.

## If GitHub access is unauthorized

`gh` is present in every environment we run in, but a cloud session whose GitHub proxy is not
authorized 403s on every call. **Do not fall back to the GitHub MCP tools to file anyway.** They
can create issues and comments, but they reach neither issue types nor blocked-by dependencies, so
what they produce silently fails the checklist below — the first cloud run filed an untyped ticket
exactly this way, and nobody would have noticed without reading the issue.

Journal the failure and file nothing. An unfiled finding can be re-derived next run; a malformed
backlog has to be cleaned up by hand.

## Filing checklist

- [ ] Type set
- [ ] Priority field set (and Effort, where the size is knowable)
- [ ] `proposal` if loop-raised
- [ ] Blockers set as Relationships **and** mirrored as a `Blocked by:` line in the body
- [ ] Body in the format above; checklist items are executable
- [ ] Searched for a duplicate first (`search_issues`), including closed ones

## Hard rules

- **Never** apply `ready-to-implement`. That label is the user's signal to the loop, and applying it is
  indistinguishable from self-authorizing work.
- **Never** leave a ticket without a Priority field value.
- **Never** record a blocker only as a Relationship — a cloud run cannot see it.
- **Never** file without searching for a duplicate.
