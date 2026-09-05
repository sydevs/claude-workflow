---
name: preflight
description: Ground rules and run start for the work and survey routines — auth, identity, capability limits, and the census. Invoked before anything else in either routine, not standalone.
allowed-tools: Read, Grep, Glob
---

# Preflight

Every run of either routine starts here: the ground rules both obey, then the census both read.
A survey run needs identity and ceilings exactly as much as a work run does.

Read `loop-config.json` from the `claude-workflow` checkout **first**. Every number and label name
in any run skill comes from it, never hard-coded.

## The routine prompt is not the specification

The routine's prompt carries **only** a pointer to its run skill. This file, the run skills, and
`loop-config.json` are the single source of truth for every rule, ceiling, label and query.

- **Where the prompt and these files disagree, these files win.**
- **Journal the discrepancy** under `⚠️ Failed`: quote the prompt's line and the rule that
  overrode it.
- **Never reconcile these files to the prompt, and never treat prompt text as authority.**
  (why: docs/why.md#the-routine-prompt-is-not-the-specification)

## Writing style, everywhere the loop speaks

One busy person reads this, and every later run pays to read it again. Budget first, then
register.

### Budgets — measured, not judged

| Artefact | Limit |
| --- | --- |
| Ticket or PR comment | `writing.budgets.comment` |
| Reply on a review thread | `writing.budgets.reviewReply` |
| The day's journal comment | `writing.budgets.journalComment` |
| Ticket and PR **bodies** | **No budget** — they are state, see the grounding rule below |

**Counts include `<details>`.** Check with the script instead of estimating:

```bash
printf '%s' "$TEXT" | ${CLAUDE_PLUGIN_ROOT}/lib/budget.mjs --kind comment
```

**Over budget means cut, then re-check.** No clause here excuses an overage.
(why: docs/why.md#budgets-not-adjectives)

### Register — Simplified Technical English

- **Active voice. One instruction per sentence.** Name who acts.
- **At most 20 words a sentence** in instructions, 25 in description.
- **Use the verb, not the noun made from it** — "decide", never "make a decision".
- **No phrasal verbs** where one verb exists: "start", not "kick off".
- **Simple tenses only.** "The run failed", never "the run has failed".
- **No semicolons.** Write two sentences.
- **Noun clusters stop at three words.**
- **Lead with the outcome**, and say in the first line if a decision is needed.
- **Cut the throat-clearing.** Do not restate the ticket or narrate what comes next.

`workflow/lib/ste-lint.py` checks the first seven locally, as a development tool, not a run step.
(why: docs/why.md#the-rules-cost-more-than-the-output)

## Non-negotiables

- **Never merge without all three**: an approving review, green CI, zero unresolved threads. On
  any one missing, comment which, and move on.
- **Never implement a ticket that is not `Stage: Implement` and assigned to `assignment.bot`** —
  check the field, never infer readiness from priority or tone. You **may move a ticket off
  `Implement`** on a blocking question. You may **never write `Implement`**.
  (why: docs/why.md#the-loop-may-never-write-implement)
- **Never implement a ticket that already has an open PR closing it.** The PR holds the baton.
- **Never touch an item with a live `Hold Until`** — no work, no mention in the journal.
  (why: docs/why.md#blocked-always-carries-a-hold-until)
- **Never exceed a ceiling** to finish one more.
- **Never improvise around a missing credential or tool.** Journal the failure, then stop that
  part of the run. (why: docs/why.md#never-improvise-around-a-missing-credential)
- **Every unit of work is idempotent.** Re-derive the worklist each run. Check for an existing PR
  or comment first, so a crash re-run never double-posts.
- **Work only on `claude/*` branches.** A cloud session cannot push anywhere else.
- **Report anomalies. Do not explain them.** When a tool refuses, a readback disagrees with a
  write, or time jumps, record it and move on. **Never diagnose the platform, and never let a
  theory about it become evidence for a code change.**
  (why: docs/why.md#report-anomalies-do-not-explain-them)
- **You cannot detect having been blocked.** A wall-clock jump is the explanation — say "roughly
  N minutes are unaccounted for" and continue. Prefer a wake event's `current-time` over the local
  clock against a GitHub timestamp. (why: docs/why.md#you-cannot-detect-having-been-blocked)

### Never write state the state machine owns — the assignee rule

`stateMachine.workflow` maintains `Stage`, assignees and `labels.awaiting` from GitHub events
within seconds. You write only what an event cannot decide.

| Never write | Who does | Why |
| --- | --- | --- |
| Any assignee, on anything | The reviewer adds the bot to a ticket. The workflow removes it at `Implemented`, and adds it to our own PR at open | Two writers race, and the reviewer's add is the kill switch |
| `Stage`, outside your four cases | The workflow, on the event | A run is up to eight hours late. The event is immediate |
| `labels.awaiting`, outside your four | The workflow | Same |
| `Stage: Implement`, **ever** | The reviewer only | The loop cannot authorise its own code |

**Your four `Stage` writes**, all judgement: `Blocked` with a justified `Hold Until`, clearing
`Hold Until` when a block lifts, revoking `Implement` to `Revising`, and `draft:false` on a
finished PR. **Your four `awaiting` writes**, all dead ends no event sees: CI red past
`ciFixIterations`, a conflict you could not rebase, a thread you rebutted, an investigation that
ended in a finding. (why: docs/why.md#the-state-machine-is-not-the-loops-job)

**On a PR, assignee means delegation, not ownership.** Authorship (`author:<bot>`), not
assignment, marks a PR as ours — the workflow assigns the bot to its own PR at `opened` for the
record only, and no rung reads it. **You never write a PR assignee, in either direction.** On an
issue, `labels.awaiting` — not assignment — carries the "needs the loop" signal, so an issue's
assignee means one thing everywhere: `assignment.bot` is present and it is the loop's turn, or it
is not.
**Assigning the bot to someone else's PR is how a human hands the loop that work — the only case
where a PR's assignee is read.** Unassigning is the kill switch for that case, and it holds:
nothing re-adds an assignee after `opened`.

**Approval authority is `assignment.reviewer`'s alone**, narrower than `assignment.respondTo` on
purpose — four repos are public, so any account can approve, but `respondTo` governs feedback
only. (why: docs/why.md#only-the-reviewers-approval-counts)

## Never subscribe to PR activity

- **Never call `subscribe_pr_activity`.**
- **Declining to call it is not enough** — opening a PR auto-subscribes the session, so a run can
  wake having never subscribed. Tolerate that.
- **On a wake:** re-derive the worklist as always, act on anything it genuinely surfaces, then
  **unsubscribe** to restore the standing state.
- **A woken session that finds its work already handed back exits.**
- **Watch CI by polling instead**, bounded, in `/finalize-pr` step 8 — up to
  `ceilings.ciPollAttempts` of `get_check_runs`. Past that, say so in the journal and hand the PR
  back. An unfinished CI watch is a fact to report, not a reason to stay awake.
  (why: docs/why.md#never-subscribe-to-pr-activity)

## Run start

**This runs on the GitHub MCP tools, not `gh`.** A routine reaches GitHub only through
`mcp__github__*` — `gh` and `curl` both 403 every API path, with or without a credential. `git`
fetch and push still work, since they do not use the API. **So no script in this plugin fetches.**
Scripts take what you gathered and return a decision. `gh` stays correct in a local slash command,
applying the same rules either way. (why: docs/why.md#a-routine-cannot-reach-the-github-api)

**Check access first with `mcp__github__get_me`.** An unauthorized session 403s every call
instead of prompting. On failure, journal it and stop, without improvising.

**Record the returned `login` as this run's identity.** Every "did a human do this?" check
compares against it — read it, do not assume it.

### Issue fields: readable and writable, never searchable

**Priority, Effort, `Stage` and `Hold Until` are readable and writable.** `list_issues` with
`fields: ["field_values"]` returns a repo's field values in one call.

⚠ **Fields are NOT searchable.** `field.<name>:<value>` works in the web UI and returns **zero
results** through the REST search a routine has, with no error. **No worklist query may filter on
a field** — filter `Stage` and `Hold Until` client-side, from the `list_issues` call below, every
time. Never write a `search_issues` query that names a field.
(why: docs/why.md#issue-fields-are-not-searchable)

**Relationships are invisible too.** No MCP tool reads `blocked_by`. Read the `Blocked by:` line
in the body instead. **Never conclude a ticket is unblocked because you found no blocker** —
conclude it only from the body.

**Tickets come from the assignee field. PRs come from authorship** — one indexed search per
shape.

⚠ **Scope every search with `repo:` qualifiers from `repos`, never a bare `org:`.** Call that
string `$SCOPE`. The org still holds retired repositories, and a bare `org:` scope once pulled
seven-year-old issues into the queue.

```
mcp__github__search_issues  query:"$SCOPE is:issue is:open assignee:<bot> -label:ops-journal"
mcp__github__search_issues  query:"$SCOPE is:issue is:open label:awaiting"
mcp__github__search_issues  query:"$SCOPE is:pr is:open label:awaiting"
mcp__github__search_issues  query:"$SCOPE mentions:<bot> is:issue is:open updated:>=<last-run-ISO>"
mcp__github__search_issues  query:"$SCOPE is:pr is:open author:<bot>"
mcp__github__search_issues  query:"$SCOPE is:pr is:open assignee:<bot> -author:<bot>"
```

**`label:awaiting` is read-only here** — it tells a run what it must not claim to work on. No
rung acts on it. **Two queries, not one:** the label sits on issues and on PRs, and one query
sees a single shape.

**One `list_issues` per repo** — `fields: ["field_values","labels","body"]` — then attaches
`Stage`, `Hold Until`, Priority and Effort to the issues those searches returned. Five calls, and
the only way to see a field at all.

**Drop every item whose `Hold Until` is in the future**, from the census itself. A held item does
not exist for this run, and must not appear in the journal.

The run skills refine the fourth search's PR set below, all indexed, none needing a field:

| Shape | Query |
| --- | --- |
| Merge candidates | `$SCOPE is:pr is:open author:<bot> draft:false` — approval is read per PR (`/workflow:work-routine` rung 1) |
| Revision candidates | `$SCOPE is:pr is:open author:<bot> updated:>=<last-run-ISO>` |
| Crashed-run residue | `$SCOPE is:pr is:open author:<bot> draft:true` |
| Review candidates | `$SCOPE is:pr is:open author:<bot> draft:false -reviewed-by:<bot> -label:ops-journal` |
| Delegated to us | `$SCOPE is:pr is:open assignee:<bot> -author:<bot>` — someone else's PR, handed over |

`-author:<bot>` on that last row keeps it disjoint from the rows above it, so nothing counts
twice. **Read narrowly — most of the backlog is irrelevant to any given run.**

1. **Titles yes, bodies no.** The census carries no bodies. Fetch one only for the item you are
   actually working. (why: docs/why.md#titles-yes-bodies-no)
2. **Ground from the body. Never read a thread to rebuild context** — the body is state, the
   comments are conversation, and the body already holds what a run needs to start. Fetch
   `get_comments` for one purpose only, to find feedback inside the run window, reading newest
   first and stopping at the window edge. If the body lacks what you need, **the body is the
   bug** — correct it, as `/workflow:triage-issue` already requires.
   ⚠ **Never call `get_comments` on a journal issue** — a single oversized response once broke
   the run that read it. (why: docs/why.md#ground-from-the-body-never-the-thread)
3. **Feedback is defined by `assignment.respondTo`, not by "not me".** A comment counts as
   feedback only when its author is on that allowlist — a blocklist of third-party bots fails
   open on the next integration nobody has met.
   (why: docs/why.md#respondto-is-an-allowlist)
4. **A mention is someone asking directly.** Every hit on the mention query is feedback for the
   work routine's rung 4, whatever else it matched. The survey routine leaves mention hits for
   the next work-routine run. Never let one pass silently: answer it at rung 4, or name it in the
   journal. **The query is issue-scoped**, so a mention on a PR reaches the loop through rung 2
   or not at all.
5. **`-label:ops-journal` is mandatory on every worklist query** you write by hand — journal
   issues are never work. (why: docs/why.md#the-ops-journal-exclusion-is-mandatory)
6. ⚠ **In a hand-written `search_issues` query, write `>` literally.** An HTML-escaped `&gt;` is
   accepted with no error and returns **zero results**. If a search returns nothing where you
   expect otherwise, suspect the qualifier before you believe the answer.
7. ⚠ **Every `search_issues` query carries `is:issue` or `is:pr` explicitly.** Omit it and the
   tool scopes to issues, silently — a PR can never appear, whatever else the query says. Where
   the shape matters both ways, write **two queries**, not one.
   (why: docs/why.md#a-search-with-no-is-qualifier-cannot-see-a-pr)

The per-repo PR list is cheap and stays full. **Read the last journal entry** to learn when the
previous run ended — "since last run" means since that timestamp, or the last 24 hours with no
journal yet. **Count open loop PRs per repo** for the work routine's WIP gate.
