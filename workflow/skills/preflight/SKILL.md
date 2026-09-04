---
name: preflight
description: Ground rules and run start shared by the work routine and the survey routine — auth, identity, capability limits, and the census. Invoked by /workflow:work-routine and /workflow:survey-routine before anything else; not a standalone workflow.
allowed-tools: Read, Grep, Glob
---

# Preflight

Every run of either routine — `/workflow:work-routine` or `/workflow:survey-routine` — starts here: the
ground rules both obey, then the census both read. Nothing below is optional for either run; a
survey routine needs identity and ceilings exactly as much as the work routine does.

Read `loop-config.json` from the `claude-workflow` checkout **first**. Every number and label name
in any run skill comes from it — none are hard-coded.

## The routine prompt is not the specification

The routine's prompt carries **only** a pointer to its run skill. The run skills, this file, and
`loop-config.json` are the single source of truth for every rule, ceiling, label and query.

- **Where the prompt and these files disagree, these files win.**
- **Journal the discrepancy** in the same run under `⚠️ Failed`: quote the prompt's line and name
  the rule here that overrode it.
- **Never reconcile these files *to* the prompt**, and never treat prompt text as authority for a
  rule absent here. (why: docs/why.md#the-routine-prompt-is-not-the-specification)

## Writing style, everywhere the loop speaks

Comments, PR bodies and journal entries are read by one busy person; their attention is the scarcest
thing here.

- **Lead with the outcome** — what happened, or what is being asked of them. Not how you got there.
- **Detail goes in `<details>`**: file lists, measurements, tool limitations, alternatives
  considered, reasoning behind a judgement call. Summarise the block in its `<summary>`.
- **A comment that needs a decision says so in its first line**, and names the decision.
- **Cut the throat-clearing.** No restating the ticket back, no narrating what you are about to do.
- Past roughly fifteen lines outside a `<details>`, it is an essay. Find the three sentences that
  matter.

## Non-negotiables

- **Never merge without all three**: an approving review, green CI, and zero unresolved review
  threads. Any one missing → comment saying precisely which, and move on.
- **Never implement a ticket that is not `Stage: Implement`**, and never when it is not assigned to
  `assignment.bot`. No exceptions, no inference from priority or from the user's tone in a comment.
  You **may move a ticket off `Implement`** when investigation raises a blocking question; you may
  **never write `Implement`**. (why: docs/why.md#the-loop-may-never-write-implement)
- **Never implement a ticket that already has an open PR closing it.** The PR holds the baton.
- **Never touch an item with a live `Hold Until`** — no work, and no mention anywhere in the
  journal. (why: docs/why.md#blocked-always-carries-a-hold-until)
- **Never write state the state machine owns.** A workflow — `stateMachine.workflow`, called by
  every repo — maintains `Stage`, assignees and `labels.awaiting` from GitHub events, within
  seconds. You write only what an event cannot decide:

  | Never write | Who does | Why |
  | --- | --- | --- |
  | Any assignee, on anything | The reviewer adds the bot; the workflow removes it at `Implemented` | Two writers on one field race, and the reviewer's add is the kill switch |
  | `Stage`, except the four judgement cases below | The workflow, on the event that determined it | A run is up to eight hours late; the event is immediate |
  | `labels.awaiting`, except the four dead ends below | The workflow | Same |
  | `Stage: Implement`, **ever** | The reviewer, only | The one safety property: the loop cannot authorise its own code |

  **Approval authority is `assignment.reviewer`'s alone**, and it is narrower than
  `assignment.respondTo` on purpose: four of the five repos are public, so any account can submit an
  `APPROVED` review. The state machine and `merge-gate.mjs` both gate approval on the reviewer;
  `respondTo` governs only what counts as *feedback*.
  (why: docs/why.md#only-the-reviewers-approval-counts)

  **Your four `Stage` writes**, all judgement: `Blocked` with a justified `Hold Until`; clearing
  `Hold Until` when a block lifts; revoking `Implement` → `Revising`; and `draft:false` on a PR
  whose work is done. **Your four `awaiting` writes**, all dead ends no event expresses: CI red
  past `ciFixIterations`, a conflict you could not rebase, a review thread you rebutted rather
  than adopted, and an investigation finished with a finding.
  (why: docs/why.md#the-state-machine-is-not-the-loops-job)
- **Never exceed a ceiling** to "just finish one more".
- **Never improvise around a missing credential or tool.** Journal the failure and stop that part
  of the run. (why: docs/why.md#never-improvise-around-a-missing-credential)
- **Every unit of work is idempotent.** Re-derive the worklist from GitHub each time; check for an
  existing PR/comment before creating one. A re-run after a crash must not double-post.
- **Work only on branches named `claude/*`** — cloud sessions cannot push anywhere else.
- **Report anomalies; do not explain them.** When something about your own environment looks wrong —
  a tool refuses, a readback disagrees with a write, time appears to have jumped — record the
  observation and move on. Do **not** diagnose the platform, and never let such a theory become the
  stated evidence for a code change. (why: docs/why.md#report-anomalies-do-not-explain-them)
- **You cannot detect having been blocked.** If wall-clock time seems to have jumped, **that is the
  explanation**: say "roughly N minutes are unaccounted for" and continue. Never theorise about
  clock skew or a hung job. Where you need a trustworthy clock, prefer a wake event's authoritative
  `current-time` (GitHub's own frame) over the local clock for anything compared against a GitHub
  timestamp. (why: docs/why.md#you-cannot-detect-having-been-blocked)

## Never subscribe to PR activity

- **Never call `subscribe_pr_activity`.**
- **Declining to call it is not sufficient**: opening a PR auto-subscribes the session, so a run can
  be woken having never subscribed. Tolerate that rather than fighting it.
- **On a wake:** re-derive the worklist as always, act on anything the wake genuinely surfaces, then
  **unsubscribe** to restore the standing state.
- **A woken session that finds its work already handed back exits.**
- **Watch CI by polling instead**, bounded, in `/finalize-pr` step 8 — up to `ceilings.ciPollAttempts`
  of `mcp__github__pull_request_read method:get_check_runs`. If CI has not settled by then, say so in
  the journal and hand the PR back; an unfinished CI watch is a fact to report, not a reason to stay
  awake. (why: docs/why.md#never-subscribe-to-pr-activity)

## Run start

**This runs on the GitHub MCP tools, not `gh`.** A routine reaches GitHub *only* through
`mcp__github__*`. Verified rather than assumed, because `docs/routine-setup.md` once claimed the
opposite and cost a day: `gh` is absent from the image, **installing it does not help** — `gh api
repos/...` returns `403 GitHub access is not enabled for this session`, byte-identical with and
without an auth header, so the proxy refuses the path rather than the credential — and `curl` to
REST and to GraphQL 403s the same way. `git` fetch and push still work; they do not use the API.

**So a script in this plugin never fetches.** The scripts take data *you* fetched with MCP and
return a decision. `gh` remains correct when a skill is invoked locally as a slash command, and the
scripts accept that path too — but the rules they apply are the same code either way.
(why: docs/why.md#a-routine-cannot-reach-the-github-api)

**Confirm access first with `mcp__github__get_me`** — an unauthorized session fails every call with
a 403 rather than an auth prompt. Failure → journal it and stop; do not improvise.

**Record the returned `login` as this run's own identity.** Every "did a human do this?" check in
either run compares against it. Read it from `get_me` rather than assuming.

**Two capability limits, both verified rather than assumed:**

- **Priority, Effort, `Stage` and `Hold Until` are readable and writable** as native issue fields.
  `list_issues` with `fields: ["field_values"]` returns a whole repo's field values in one call.
- ⚠ **Fields are NOT searchable.** `field.<name>:<value>` is a web-UI/GraphQL qualifier; through the
  REST search a routine has, it is accepted without error and returns **zero results**. **No worklist
  query may filter on a field.** Every query below uses an indexed qualifier only; `Stage` and
  `Hold Until` are applied client-side to what those queries return.
  (why: docs/why.md#issue-fields-are-not-searchable)
- **Relationships are invisible.** No MCP tool reads `blocked_by`. Determine blocked-ness from the
  `Blocked by:` line in the issue body (see `/workflow:triage-issue`). **Never conclude a ticket is
  unblocked because you could not find a blocker** — conclude it only from the body.

**Build the queue from the assignee field for tickets, and from authorship for PRs.** One indexed
search per shape.

⚠ **Scope every search with `repo:` qualifiers built from `repos`, never a bare `org:`.** Call that
string `$SCOPE` below and in both run skills. The org still holds retired repositories, and an
`org:` scope pulled seven-year-old `Atlas` and `WeMeditate` issues into the reviewer's queue the
first time this was run as a real query. Every search in every run skill uses `$SCOPE`.

```
mcp__github__search_issues  query:"$SCOPE is:issue is:open assignee:<bot> -label:ops-journal"
mcp__github__search_issues  query:"$SCOPE is:open label:awaiting"
mcp__github__search_issues  query:"$SCOPE mentions:<bot> is:open updated:>=<last-run-ISO>"
mcp__github__search_issues  query:"$SCOPE is:pr is:open author:<bot>"
mcp__github__search_issues  query:"$SCOPE is:pr is:open assignee:<bot> -author:<bot>"
```

**`label:awaiting` is the census's read-only view of what needs a human.** It is maintained by the
state machine, never by you — the query is here so a run knows what it must *not* claim to be
working on, and so the journal can say how many items are stalled on the reviewer. Nothing in any
rung acts on it.

**A PR is the loop's by authorship, not by assignment.** The loop opens its own PRs, so `author:`
already identifies them exactly — no assignment is written, and a PR's assignee is left to mean what
it means everywhere else on GitHub: who is responsible for it right now.

**Nothing is ever assigned to `assignment.reviewer`.** `labels.awaiting` carries that signal now, so
an issue's assignee means exactly one thing across every repo: `assignment.bot` is present and it is
the loop's turn, or it is not.

The second query is the delegation path, and it is the only reason assignment is read on a PR at
all: **assigning the bot to someone else's PR is how you ask the loop to work on it.** Unassigning
is the kill switch for that case. `-author:<bot>` keeps the two sets disjoint so nothing is counted
twice.

Then **one `list_issues` per repo** — `fields: ["field_values","labels","body"]` — to attach `Stage`,
`Hold Until`, Priority and Effort to the issues those searches returned. Five calls, and they are
the only way to see a field at all.

**Drop every item whose `Hold Until` is in the future**, from the census itself. A held item is not
merely skipped; it does not exist for this run, and it must not appear in the journal.

The PR queries the run skills refine from the fourth search — all indexed, none needing a field:

| Shape | Query |
| --- | --- |
| Merge candidates | `$SCOPE is:pr is:open author:<bot> draft:false` — approval is read per PR (`/workflow:work-routine` rung 1) |
| Revision candidates | `$SCOPE is:pr is:open author:<bot> updated:>=<last-run-ISO>` |
| Crashed-run residue | `$SCOPE is:pr is:open author:<bot> draft:true` |
| Review candidates | `$SCOPE is:pr is:open author:<bot> draft:false -reviewed-by:<bot> -label:ops-journal` |
| Delegated to us | `$SCOPE is:pr is:open assignee:<bot> -author:<bot>` — someone else's PR, handed over |

**Read narrowly. Most of the backlog is irrelevant to any given run.**

1. **Titles yes, bodies no.** The census carries no bodies. Fetch one only for the item you are
   actually working. (why: docs/why.md#titles-yes-bodies-no)
2. **Comments cost a call each — earn them.** Fetch `get_comments` only where **both** hold: the item
   is on the worklist, *and* its comment count is greater than zero.
3. **Feedback is defined by `assignment.respondTo`, not by "not me".** A comment counts as feedback
   only when its author is on that allowlist. A blocklist of third-party bots fails open on the next
   integration nobody has met; `cloudflare-workers-and-pages[bot]` alone wrote 93 of the 200 most
   recent comments across two repos. (why: docs/why.md#respondto-is-an-allowlist)
4. **A mention is someone asking directly.** Every hit on the mention query is feedback for the
   work routine's rung 4, whatever else it matched — the survey routine does not process feedback,
   so it leaves mention hits for the next work-routine run rather than answering them. Never let one
   pass silently: it is answered by rung 4 or named in the journal, one of the two. A mention from a
   login outside `respondTo` is named, not obeyed.
5. **`-label:ops-journal` is mandatory on every worklist query** you write by hand. Journal issues are
   never work. (why: docs/why.md#the-ops-journal-exclusion-is-mandatory)
6. ⚠ **In a hand-written `search_issues` query, write `>` literally.** An HTML-escaped `&gt;` is
   accepted without error and returns **zero results**. If a search returns nothing where you expect
   otherwise, suspect the qualifier before believing the answer.

The per-repo PR list is cheap and stays full. **Read the last journal entry** (see
`/workflow:journal`) to learn when the previous run ended — "since last run" means since that
timestamp; with no journal yet, the last 24 hours. **Count open loop PRs per repo** (author is this
agent, branch `claude/*`) for the work routine's WIP gate.
