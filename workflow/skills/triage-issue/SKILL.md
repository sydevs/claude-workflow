---
name: triage-issue
description: The metadata rules for sydevs tickets — issue type, the Priority, Effort, Stage and Hold Until fields, assignment, relationships, and the standard body format. Shared by draft-ticket, the survey skills, and the loop, so every ticket looks the same whoever filed it.
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
and `work-routine` all read this rather than each carrying their own copy — the divergence that produced
three forks of the workflow started exactly this way.

## The fields

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
| **Priority** | `Critical` | Data loss, outage, or security exposure. Drop other work. |
| | `High` | User-visible breakage, or it blocks other work. |
| | `Medium` | Planned work. **The default** — most tickets are this. |
| | `Low` | Do when nothing above it waits. Deferred or speculative. |
| **Effort** | `Easy` / `Moderate` / `Hard` | Rough size. Set it honestly — the loop uses it to avoid starting something it cannot finish in one run. |

Priority measures the **consequence of not doing it**, never effort or appetite. A one-line fix to
a broken signup path is `High`. A month of pleasant refactoring is `Low`.

**The two fields have different owners.** The reviewer sets **Priority**, because consequence to the
product is a business judgement. **You set Effort, always** — it estimates work, and you just read
the code.

**Always set Effort.** If you understood the ticket well enough to write it, you understood it well
enough to size it. When you truly cannot, say what makes it unsizable rather than leave it empty.
A run once wrote out a full estimate and then discarded it as "yours to set".

```
mcp__github__issue_write  method:update  owner:$ORG  repo:$REPO  issue_number:<n>
  issue_fields:[{field_name:"Priority", field_option_name:"High"},
                {field_name:"Effort",   field_option_name:"Moderate"}]
```

By **name** — the tool validates the option before it calls. Read values back with
`list_issues(fields:["field_values"])`, one call per repo.

⚠ **Fields are readable and writable, but NOT searchable.** `field.<name>:<value>` returns zero
results through the REST search, without an error. **No worklist query may filter on a field.**
Build the set from an indexed qualifier, then filter client-side.
(why: docs/why.md#issue-fields-are-not-searchable)

<details><summary>Raw REST equivalent, if you ever need it</summary>

```bash
gh api -X PUT repos/$ORG/$REPO/issues/<n>/issue-field-values --input - <<< \
  '[{"field_id":14337938,"value":"High"}]'
```

The `value` must be the option **name** — an option id returns `422 must be a string option name`.
`PATCH`ing the issue with a `fields` key returns 200 and silently does nothing. **And the PUT
replaces the issue's entire field-value set** — a PUT carrying only Priority silently clears an
existing Effort. Include every field you want kept. Field ids are in `loop-config.json` →
`issueFields`.
</details>

### The baton — assignment is the queue, and only the user moves it

**The assignee field says whose turn it is.** It is not a hint; it is the worklist.

| Assignee | Meaning | The loop |
| --- | --- | --- |
| `assignment.bot` | The loop's turn | Acts on the next run |
| Anyone else, or nobody | Not the loop's turn | Does not touch it |

`assignee:<bot>` is one indexed query per repo, and it replaced a census that scanned every open
item and diffed `created_at` against the last run. That census had to be narrowed from 38 issues to
2 for cost, and it broke outright when a bulk issue-field migration bumped every `updated_at` in the
repo and made the whole backlog look like fresh feedback. Do not reintroduce timestamp reasoning to
decide what to work on.

**Only the user assigns the bot, and nothing is ever assigned to the reviewer.** That is the entire
kill switch: unassign the bot on any item and the loop stops touching it, with nothing else to
configure. An issue's assignee therefore means exactly one thing, everywhere — `assignment.bot` is
present and it is the loop's turn, or it is not.

**The loop writes no assignee at all.** Not on a ticket, not on a PR, not to hand work to a future
run. The one automated removal — dropping the bot from a ticket once its PR exists — belongs to the
state machine, which sees `pull_request: opened` the moment it happens.

| Surface | Assignee means | Written by |
| --- | --- | --- |
| Issue | `assignment.bot` present = the loop's turn | The reviewer (adding) · the state machine (removing at `Implemented`) |
| PR | Nothing on ours — found by `author:`. On someone else's, `assignment.bot` = please work on this | The reviewer only |

**`labels.awaiting` is what says a human is needed**, which is why the reviewer is no longer
assigned anything: two fields for one fact is this repo's oldest failure, and the assignment was the
half that nothing ever cleared.

**Never set or change a PR's assignee at all.** A PR's turn is carried by its `draft` flag: draft
means the loop is still working, ready-for-review means it is waiting on a human. And a PR is the
loop's **by authorship** — every rung finds its own PRs with `author:<bot>`, so no assignment is
needed to claim one.

That leaves a PR's assignee free to mean one thing, pointing the other way: **assigning the bot to a
PR it did not write is how you ask the loop to work on that PR.** Unassigning withdraws the request.
The loop reads that field and never writes it.

### `Stage` and `Hold Until` — where the ticket sits, and when to look again

Two more native org fields, alongside Priority and Effort. Between them they replaced five labels —
`ready-to-implement`, `proposal`, `needs-info`, `blocked-upstream` and `hold` — whose meanings
overlapped and, in one case, contradicted each other outright.

| `Stage` | The loop | Who writes it |
| --- | --- | --- |
| *(empty)* | Nothing. Untriaged backlog, inert | — |
| `Proposed` | Nothing — filed, awaiting a first verdict | either |
| `Revising` | **Not a gate.** Being worked out; whose turn it is is the last comment's author | either |
| `Blocked` | Nothing while `Hold Until` is live | either |
| `Implement` | Implement it, open the PR, then `Implemented` and unassign | **the reviewer only** |
| `Implemented` | Nothing — a PR is in flight | either |

**The loop works a ticket when all three hold**, and not otherwise:

1. `assignment.bot` is among the assignees, **and**
2. `Hold Until` is absent or already past, **and**
3. `Stage` is neither `Blocked` nor `Implemented`.

What it then does is decided by the ticket, not by the field. `Stage: Implement` means write code; a
comment from `assignment.respondTo` newer than the loop's own last comment means revise or answer;
acceptance criteria describing a decision mean investigate.

`Revising` deliberately covers both halves of a conversation — the loop asked, and the user
answered. **The last comment's author already says which half it is in**, and unlike a field that
someone must remember to flip, it cannot go stale. So nobody has to touch `Stage` to answer a
question: comment, and the next run picks it up.

### `Stage: Implement` — the loop may revoke, never grant

- **Never write `Implement`.** This is the safety property that makes the loop safe to leave
  running: it cannot authorise its own code. It carries over from the retired `ready-to-implement`
  label unchanged, because the risk it guards did not change when the mechanism did.
- **You may move a ticket off `Implement`**, to `Revising`, when investigation raises a question
  that must be answered first. Revoking only ever reduces the loop's own autonomy, so it is safe.

Revoking is never silent. Pair it with a comment saying what is now unresolved, and put the
questions in the body's `## Open questions` list — otherwise the reviewer sees a field change with
no explanation.

**Merge authority is an approving review**, plus green CI and zero unresolved threads. It is never a
field; `Stage` does not apply to PRs at all.

### `Hold Until` — a date, and the promise to look again

The answer to *"why is this not in my queue, and when does it come back?"*

- **Every `Blocked` ticket carries one.** A block with no re-check date is a ticket that quietly
  disappears; this field is the difference between parked and lost.
- **Justify the date in the same comment** — no silent default. Say what you expect to have changed
  by then. Cap the horizon at `issueFields.holdUntil.maxHorizonDays`.
- **It is not only for blocks.** Anything that should wait takes one: a dependency that will settle
  on its own, a decision deferred to next quarter.
- **A live `Hold Until` means invisible, not merely idle.** No work on it, *and* no mention in the
  journal at all, and the state machine clears `labels.awaiting`. The one exception is naming it as another ticket's
  blocker.
- **Clear it the moment the reason goes away.** That is what returns the ticket to active
  consideration, and it is a single-field delete, so Priority and Effort survive untouched:
  ```
  mcp__github__issue_write  method:update  owner:$ORG  repo:$REPO  issue_number:<n>
    issue_fields:[{field_name:"Hold Until", delete:true}]
  ```
- An **expired** `Hold Until` on a `Blocked` ticket is a re-evaluation, and re-evaluating is real
  work: it counts against `maxWorkItemsPerRun` like anything else.

### `assignment.respondTo` — whose comments count as feedback

An **allowlist** of logins. A comment is feedback only when its author is on it — everywhere, in
every skill, replacing the older test of *"the author is not the loop's own login"*.

A blocklist of known third-party bots fails open on the next integration nobody has met yet. Of the
200 most recent issue comments across SahajCloud and SahajAtlasWeb, 93 were from
`cloudflare-workers-and-pages[bot]`; under a "not the bot" test the preview-URL bot would have been
the single largest source of work. An allowlist fails closed, and it is also how a reviewing bot
such as Copilot is adopted later: one entry in `loop-config.json`, no skill change.

**A mention is still never silent.** A `mentions:<bot>` hit from a login outside the list is named
in the journal rather than acted on — an outside contributor is not ignored, just not obeyed.

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
Blocked by: https://github.com/sydevs/SahajCloud/issues/632 — the endpoint this consumes does not exist until that merges (was: Implement)
```

**The `(was: <Stage>)` suffix is how a block is undone.** A single-select field cannot remember its
own previous value, no MCP tool reads the issue timeline, and the REST timeline event for a field
change carries no field name and no old value — so if the prior `Stage` is not written down here it
is gone. On unblock, restore what the suffix records, with one exception: **`Implement` is never
restored automatically**, it becomes `Revising`. A blocker usually changes the shape of the work,
and auto-restoring `Implement` would let the loop write code against a ticket nobody has re-read
since the block cleared. No suffix → `Revising`.

**No MCP tool exposes Relationships**, so a cloud routine is blind to them — it reads this line
instead. A ticket whose blocker exists only in the Relationships panel will be picked up as ready
and implemented against a shape that does not exist yet. The line is also the version a human
reads without opening a side panel.

`loop-config.json` → `relationships.recheckProbe` records how to test whether the MCP tools have
appeared; the day they do, the body line becomes redundant.

**Priority and relationships together decide implementation order**: the loop takes the
highest-priority ticket whose blockers are all closed and whose `Hold Until` has passed. A `Critical` behind an open blocker waits
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

## Filing from a cloud run: what MCP reaches, and the one thing it does not

A cloud run has no `gh` — every call 403s (`/workflow:preflight`) — so `mcp__github__issue_write` is
the filing path, not a fallback.

- ⚠ **The one thing it cannot do is write a blocked-by dependency.** No MCP tool writes them, which
  is the whole reason `relationships.bodyMarker` exists. A blocker recorded only as a native
  relationship is invisible to every cloud run, so the `Blocked by:` line in the body is what
  actually blocks — and it is the half of checklist item 5 a cloud run must satisfy.
- **Issue type** — `issue_write`'s `type` parameter, validated against `list_issue_types`. This used
  to be unreachable, which is why the first cloud run filed an untyped ticket; it is reachable now,
  so an untyped ticket is a mistake rather than a limitation.
- **Priority, Effort, `Stage`, `Hold Until`** — `issue_fields`, with `field_option_name` for the
  single-selects so the option is validated before the call.

If a call genuinely fails, **journal the failure and file nothing.** An unfiled finding can be
re-derived next run; a malformed backlog has to be cleaned up by hand.

## Filing checklist

- [ ] Type set
- [ ] Priority field set (reviewer's, so leave an existing value alone) **and Effort set — always, by you**
- [ ] `Stage: Proposed` and `labels.awaiting` — **only when filing locally**; in a routine the state machine sets both on `issues: opened`. Assign nobody
- [ ] `Hold Until` set if `Stage` is `Blocked`, with the date justified in a comment
- [ ] Blockers mirrored as a `Blocked by:` line in the body — always — **and** set as Relationships
      where the run can (local `gh` only; a cloud run cannot, see above)
- [ ] Body in the format above; checklist items are executable
- [ ] Searched for a duplicate first (`search_issues`), including closed ones

## Hard rules

- **Never** write `Stage: Implement`. That value is the user's signal to the loop, and writing it is
  indistinguishable from self-authorizing work.
- **Never** add `assignment.bot` to a ticket or a PR, and **never** change a PR's assignee at all.
- **Never** leave a ticket at `Blocked` without a `Hold Until`.
- **Never** leave a ticket without a Priority field value.
- **Never** record a blocker only as a Relationship — a cloud run cannot see it.
- **Never** file without searching for a duplicate.
