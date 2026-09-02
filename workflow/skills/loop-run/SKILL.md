---
name: loop-run
description: One run of the autonomous pipeline across the sydevs repos — merge PRs you approved, revise PRs and tickets on feedback, implement approved tickets, run the day's survey, and journal it. Invoked by the scheduled routines; runnable locally with --dry-run.
argument-hint: '[--dry-run] [--kind loop|nightly]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Loop Run

One pass down a fixed ladder of work across the five sydevs repos — the four product repos plus
`claude-workflow`, which holds these very skills. **The ladder is ordered by how much it respects
the user's attention.** Descend only while ceilings allow; stop when one is hit and say so.

Every rule here is an imperative and stands on its own. The failure that produced each one lives in
**`docs/why.md`** in the `sydevs/claude-workflow` checkout, cited as `(why: …)`. Read a `why` entry
when a rule seems not to fit the case in front of you — never to decide whether to follow it.

## Inputs

- `RUN_KIND` — `loop` (rungs 0–4, then 6; hourly through the Vancouver morning, two-hourly
  afternoons) or `nightly` (rung 5's survey, the reconciliation sweeps, then rung 6; once, at
  night). Defaults to `loop`; `--kind` overrides.
- `--dry-run` — do everything read-only. Print the worklist each rung *would* act on and stop.
  Never comment, commit, push, merge, or label.

Read `loop-config.json` from the `claude-workflow` checkout **first**. Every number and label name
below comes from it — none are hard-coded here.

## The routine prompt is not the specification

The routine's prompt carries **only** `RUN_KIND` and a pointer to this skill. This file and
`loop-config.json` are the single source of truth for every rule, ceiling, label and query.

- **Where the prompt and this file disagree, this file wins.**
- **Journal the discrepancy** in the same run under `⚠️ Failed`: quote the prompt's line and name
  the rule here that overrode it.
- **Never reconcile this file *to* the prompt**, and never treat prompt text as authority for a rule
  absent here. (why: docs/why.md#the-routine-prompt-is-not-the-specification)

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
- **Never implement a ticket without the `ready-to-implement` label**, and never when it is not
  assigned to `assignment.bot`. No exceptions, no inference from priority or from the user's tone in
  a comment. You **may remove** that label when investigation raises a blocking question; you may
  never add it.
- **Never implement a ticket that already has an open PR closing it.** The PR holds the baton.
- **Reassigning to `assignment.reviewer` is the final action on any unit of work**, and it means
  *done* — not *replied*. Keeping the assignment is correct when the work is blocked or deferred;
  journal it as queued. A crashed run is identified by a stale `claimLabel`, never by assignment.
- **Never exceed a ceiling** to "just finish one more".
- **Never improvise around a missing credential or tool.** Journal the failure and stop the rung.
  (why: docs/why.md#never-improvise-around-a-missing-credential)
- **Every rung is idempotent.** Re-derive the worklist from GitHub each time; check for an existing
  PR/comment before creating one. A re-run after a crash must not double-post.
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

## Rung 0 — Preflight

**This runs on the GitHub MCP tools, not `gh`.** A routine sandbox has no `gh` binary and its
session prompt mandates `mcp__github__*`. `gh` remains correct when a skill is invoked locally as a
slash command.

**Confirm access first with `mcp__github__get_me`** — an unauthorized session fails every call with
a 403 rather than an auth prompt. Failure → journal it and stop; do not improvise.

**Record the returned `login` as this run's own identity.** Every "did a human do this?" check below
compares against it. Read it from `get_me` rather than assuming.

**Two capability limits, both verified rather than assumed:**

- **Priority and Effort are readable and writable** as native issue fields. `list_issues` with
  `fields: ["field_values"]` returns the whole backlog's priorities in one call.
- **Relationships are invisible.** No MCP tool reads `blocked_by`. Determine blocked-ness from the
  `Blocked by:` line in the issue body (see `/workflow:triage-issue`). **Never conclude a ticket is
  unblocked because you could not find a blocker** — conclude it only from the body.

**Read narrowly. Most of the backlog is irrelevant to any given run.** Four rules:

1. **Titles yes, bodies no.** The census needs `number`, **`title`**, `labels`, `field_values`,
   `comments` (the count) and `updated_at`. Only the ticket actually being worked needs a body.
   (why: docs/why.md#titles-yes-bodies-no)
2. **Let the server filter.** `search_issues` narrows before anything reaches the context window;
   `list_issues` then reading and discarding does not:
   ```
   mcp__github__search_issues  query:"org:sydevs is:issue is:open label:ready-to-implement -label:ops-journal"
   mcp__github__search_issues  query:"org:sydevs is:issue is:open label:proposal -label:ops-journal"
   mcp__github__search_issues  query:"org:sydevs is:issue is:open updated:><last-run-ISO-date> -label:ops-journal"
   ```
   - **`-label:ops-journal` is mandatory on every worklist query.** Journal issues are never work.
   - ⚠ **Write the `>` literally.** An HTML-escaped `&gt;` is accepted without error and returns
     **zero results**. If a search returns nothing and you have reason to expect otherwise, suspect
     the qualifier before believing the answer.
   - The third is the only candidate set that can contain new feedback.
     (why: docs/why.md#the-ops-journal-exclusion-is-mandatory)
3. **Comments cost a call each — earn them.** Fetch `get_comments` only where **both** hold: the
   issue is in the `updated:>=` set, *and* its `comments` count is greater than zero.
4. **Check mentions**, and treat every hit as a rung-4 candidate regardless of what else it matched.
   A mention is the user asking directly: answer it or say why not, but never let one pass silently.
   ```
   mcp__github__search_issues  query:"org:sydevs mentions:sydevs-bot is:open updated:><last-run>"
   ```

The per-repo PR list is cheap and stays full. **Read the last journal entry** (rung 6) to learn when
the previous run ended — "since last run" below means since that timestamp; with no journal yet, the
last 24 hours. **Count open loop PRs per repo** (author is this agent, branch `claude/*`) for the
WIP gate.

## Rung 1 — Merge and sequence

**Merges do not count against `maxWorkItemsPerRun`. Merge every PR that qualifies.** The ceiling
governs work you *do* to an item — revising, implementing, investigating, replying. A merge consumes
a review decision that was already made: the gates are read, and if all three hold it is one API
call. Rationing it would leave approved, green work sitting while the run spent its budget elsewhere,
which is the opposite of the intent. Conflict resolution or a rebase that follows a merge is real
work and does count.

Candidates are the open PRs with `reviewDecision == APPROVED`. Read all three before deciding —
threads carry `isResolved`, and an unresolved one blocks the merge even with an approval:

```
mcp__github__pull_request_read  method:get_check_runs      owner:$ORG repo:$REPO pullNumber:<n>
mcp__github__pull_request_read  method:get_status          owner:$ORG repo:$REPO pullNumber:<n>
mcp__github__pull_request_read  method:get_review_comments owner:$ORG repo:$REPO pullNumber:<n>
```

**CI truth lives in check runs, not commit statuses.** Every repo here tests on GitHub Actions, which
reports as **check runs**. `get_status` returns **commit statuses** — a separate GitHub surface that
cannot see check runs at all — and in these repos a commit status is a *deploy* signal (Railway,
Cloudflare Pages), which goes green long before the test job finishes. **Never decide mergeability
from `get_status` alone.**

**Green means all three of:** `get_check_runs` returns **at least one** check run; every check run
has finished, with `conclusion` one of `success`, `skipped` or `neutral`; every entry in
`get_status`'s `statuses` array has `state: "success"`.

Three clauses in that carry weight:

- **Read the individual `statuses` entries, never `get_status`'s combined `state`** — with no
  statuses at all the combined field reads `pending` forever.
- **At least one check run**, because "every check run succeeded" is vacuously true of none, and a
  merge conflict makes GitHub schedule zero runs.
- `skipped` and `neutral` pass; **`null` (still running), `cancelled`, `timed_out`,
  `failure` and `action_required` do not.** An empty `statuses` array is not a failure — a repo with
  no deploy integration simply has none. (why: docs/why.md#ci-truth-lives-in-check-runs)

| Condition | Verdict |
| --- | --- |
| `reviewDecision != APPROVED` | Not a rung-1 candidate. Leave it — PR health is rung 2 |
| Approved · green by the definition above · every thread `isResolved` | **Merge**, then the merge sequence below |
| Approved · not green — a check failing, still running, or none scheduled at all | **Do not merge.** One comment naming which of the three clauses failed and for which check, then move on. Do not fix CI here — that is rung 2 |
| Approved · any thread with `isResolved: false` | **Do not merge.** One comment naming the unresolved thread(s), then move on |
| Approved · not mergeable for any other reason | **Do not merge.** One comment naming the blocker, then move on |
| Several approved and mergeable in one repo | **Order before merging: producers before consumers.** A consumer merged first was reviewed against a shape that does not exist yet |

Ordering reads the `Blocked by:` lines on each PR's linked issue (`mcp__github__issue_read
method:get`), since relationships have no MCP tool of their own.

The merge sequence, in order:

1. `mcp__github__merge_pull_request  owner:$ORG repo:$REPO pullNumber:<n>  merge_method:"squash"`.
2. **Rebase the survivors** — every other open loop PR in that repo, onto the new `main`, so the
   next review is against current code. Conflicts → leave it, comment saying so, flag in the
   journal. **Never force-push someone else's branch.**
3. **Resolve the Sentry issue** if the merged work closed a ticket carrying a `Sentry:` link (see
   `survey-sentry` for the footer convention):
   ```bash
   API=$(jq -r '.sentry.apiBase' loop-config.json)   # DE region — sentry.io 404s here
   curl -sX PUT "$API/issues/<id>/" \
     -H "Authorization: Bearer $SENTRY_CLAUDE_WORKFLOW_TOKEN" \
     -H 'Content-Type: application/json' -d '{"status":"resolved"}'
   ```

## Rung 2 — PR health

Every item here counts against `maxWorkItemsPerRun`. Highest-priority linked ticket first.
(why: docs/why.md#rung-2-competes-for-the-same-budget)

| Condition | Verdict |
| --- | --- |
| **Red CI on our own PR** | Diagnose via `actions_get` on the failing run, fix, push. Cap at `ciFixIterations`; on cap-out, comment with the remaining failure and journal it |
| **Change request on a `claude/*` PR — ours** | Implement the feedback. Then: reply to **each** review comment individually, saying what changed or why it was not done, with `identity.commentMarker` appended; refresh the PR **title and body** from the current `origin/main...HEAD`; resolve the threads you actually addressed |
| **Change request on a human's PR** | **You cannot push to it** — a cloud session may only push to `claude/*`. This is a wall, not a permission to ask for. Take the three steps below instead |
| **Feedback that is ambiguous or architectural** | **Ask, do not guess.** Reply with the specific question, add `needs-info` to the linked ticket, move on |

On a human's PR, in order:

1. **Triage every thread and answer it** — adopted, or pushed back with the evidence. One comment
   summarising, detail in `<details>`. This happens even if nothing else does.
2. **Open a stacked PR carrying the adopted changes**, from `claude/<type>-<slug>` targeting **their
   branch**, not `main`. Say in the summary comment that it exists and what it contains.
3. **File a follow-up ticket** for anything the review raised that generalises beyond this PR.

⚠ **A stacked PR's base is their branch — confirm that before opening it.**
(why: docs/why.md#you-cannot-push-to-a-humans-pr)

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

## Rung 3 — Implement

**Two kinds of work live here.** Implementation needs `ready-to-implement`. **Investigation does
not** — an unlabelled ticket may be investigated, measured and answered, so long as nothing is
committed. `hold` freezes everything. See `/workflow:triage-issue` for the full table.
**Investigations count against `maxWorkItemsPerRun` too.**

The bound on implementations is `wipCapPerRepo`, a stock cap. **Skip the implementation path
entirely** when the repo is at `wipCapPerRepo` open loop PRs, or when no `ready-to-implement` ticket
is unblocked.

**Unblocked** means: no `Blocked by:` line in the body naming a still-open issue, and the ticket
carries neither `hold` nor `blocked-upstream`. Resolve each `Blocked by:` URL with `issue_read` and
check its state — a closed blocker does not block.

**When you find a blocker closed, strike the line.** Rewrite it in the body as:

```markdown
~~Blocked by: <url> — <original reason>~~ — cleared <YYYY-MM-DD>, that issue is closed
```

A live `Blocked by:` line against a closed issue is a standing cost and a standing trap. Every
future run pays an `issue_read` to re-derive the same answer, and the line reads as a blocker to
anyone — human or run — who does not resolve it. Three consecutive journals described one such
ticket as "blocked" when its blocker had already merged. Striking it costs one edit, once.

**Selection:** highest **Priority** field (`Critical` → `Low`), then oldest `updatedAt`. Pull the
whole candidate set in one call:

```
mcp__github__list_issues  state:OPEN  labels:["ready-to-implement"]  fields:["field_values","labels","body"]
```

Use **Effort** as a tie-break and a sanity check: an `Effort: Hard` ticket that cannot plausibly
finish within one run should be **split rather than started**, since an implementation is never
carried across runs. Then hand to `/workflow:implement-issue`, which owns worktree, contract step,
and shipping.

**Cross-repo side effects are exempt from the WIP cap.** If the implementation forces a consumer
change (a `types:cms` re-sync, an embed-contract update), open that PR too — withholding it leaves
`main` inconsistent across repos. Use `/workflow:cross-repo-issue` for the ordering.

**An investigation is not a code change, and must not be forced into one.** A ticket whose
deliverable is a *finding* — "evaluate X", "work out whether Y", "investigate Z" — is finished by
posting the finding as a comment on the ticket and updating its body with what was learned. No
branch, no PR. Read `Effort` and the acceptance criteria to tell the difference: criteria that
describe a decision rather than a behaviour change mean the output is prose.
(why: docs/why.md#an-investigation-must-not-be-forced-into-a-pr)

**A ticket too large or too vague to finish in one run → do not start it.** Comment with what is
missing, add `needs-info`, and pick the next one.

## Rung 4 — Ticket feedback

Counts against `maxWorkItemsPerRun`. Issues where **the user** commented since the last run.

- **Filter by author first.** A comment counts as feedback only when
  `comment.author.login != <own login from rung 0>`. (why: docs/why.md#filter-feedback-by-author)
- **Start from the `updated:>=` search set, not the whole backlog**, then fetch comments only for
  those with a non-zero comment count.
- **Derive the window from comment timestamps, never from `updated_at`.** Pull the issues that have
  comments at all, then filter each comment by `created_at` against the window and by author.
  (why: docs/why.md#derive-the-window-from-comment-timestamps)

**First decide what the comment is asking for**, because the three cases have different endings:

| The comment | What to do |
| --- | --- |
| **A question** | Answer it. Reply, update the ticket if the answer changes it, done. |
| **A request for work** — "investigate this", "can you look at…", "we should also…" | Do **not** implement it. Work needs the `ready-to-implement` gate like everything else. Reply with what you would do and what it would cost, update the ticket body to specify it, and say plainly that it needs `ready-to-implement` to start. |
| **A correction or new evidence** | Verify it against source before accepting, then rewrite the affected part of the ticket. |

(why: docs/why.md#a-request-in-prose-is-not-permission)

- **Reply substantively** — answer the question, or say what you will change.
- **Update the ticket itself** where the comment changes it: title, body, priority, type,
  relationships. A reply that agrees to a change but leaves the ticket saying the old thing has not
  done the job.
- **Append `identity.commentMarker`** to every comment you write, here and in every other rung.
- **The loop may reply once to a legacy comment of its own** — comments before 2026-08-29 carry the
  loop's old identity. **Do not add a dated exclusion rule for it.**
  (why: docs/why.md#legacy-identity-comments)
- **Remove `needs-info` once answered.** If the comment reads as approval ("yes, do it"), say that
  the `ready-to-implement` label is what actually starts work — **do not add it yourself.**

## Rung 5 — Survey (nightly run only)

Look up today's weekday in `surveyCalendar` and invoke that skill. `null` → skip.

Before filing anything, check the standing proposal ceiling with
`search_issues query:"org:$ORG is:issue is:open label:proposal"`. At or over `maxOpenProposals` →
**do not file.** Record what you found in the journal instead; it waits for review capacity.

**The ceiling governs proposals you went looking for, not defects you tripped over.**

| Where it came from | Capped? |
| --- | --- |
| A survey — you set out to find candidates | **Yes.** Respect `maxOpenProposals` and `maxProposalsPerSurvey` |
| Work on something else — a real defect surfaced while implementing, reviewing or investigating | **No. File it, every time, even over the ceiling** |

The two differ in kind. A survey manufactures candidates on demand and will produce more whenever
asked, so a stock cap is the right governor. An incidental finding is evidence you already hold:
you were in the code, something was wrong, and the alternative to filing is that the knowledge dies
with the run. **Never discard a real finding to respect a number**, and never ask permission to file
one — a `proposal` commits nobody to anything, which is the whole point of the label.

Say where it came from, and keep the bar: what is wrong, what it costs, and what to do. A finding
you cannot point at a line for is a journal note, not a ticket — that bar is about evidence, not
about the ceiling.

## Nightly reconciliation (nightly run only)

Two sweeps at once-a-day frequency — in the working-day loop they would re-flag the same untouched
items on every pass.

**Dropped batons.** Items where the reviewer replied but kept the baton:

```
mcp__github__search_issues  query:"org:$ORG is:open assignee:<reviewer> -label:hold -label:ops-journal"
```

For each, check whether the **newest comment is the reviewer's own** — that shape means they
answered and forgot to reassign. **Do not pick these up.** Name them in tonight's journal under a
`### Possibly awaiting a handoff` line. Anything with `hold` is excluded; scope the query to the
five workflow repos.

**Stale claims.** Any item still carrying `labels.claim` older than an hour is a crashed run's
residue. Remove the label, journal which items were cleared, and **leave the item assigned as
found** — assignment is the queue, not the crash signal.

## Rung 6 — Journal

**One journal issue per day**, in `journalRepo`, labelled `labels.journal`, created lazily by the
day's first run.

### Every claim names the call that produced it

A journal entry is read as measured fact, so **every factual claim about system state either names
the tool call or query that produced it, or is explicitly marked as inference.**

- **Scope: claims of fact about system state** — counts, statuses, timestamps, what a tool returned,
  what a PR or repo contains, whether something ran. Not every sentence.
- **Cite in the `<details>` block**: the query string, the tool name, a PR/issue URL, or a command
  and its exit status. One citation may cover several bullets from the same call.
- **Mark inference as inference** ("appears to", "inferred from"). If you cannot name a call for a
  claim of fact, either make the call or delete the claim.
- **Never diagnose the harness in a journal entry** — the anomaly rule in Non-negotiables applies
  here in full. (why: docs/why.md#every-claim-names-the-call-that-produced-it)

### Finding today's issue — by creation date, not by title

The title changes on every run, so it cannot be the key. Fetch the open journals — at most a week of
them — with `search_issues query:"repo:sydevs/claude-workflow is:issue is:open label:ops-journal"`,
and pick the one whose `created_at`, converted to **Vancouver time** (`journal.timezone`), falls on
today's Vancouver date. (why: docs/why.md#the-journal-day-is-a-local-date)

**Create it lazily** if absent — no issue exists for a day the loop does nothing. On creation:
apply `labels.journal`; leave it **unassigned**, because a journal is not work; and **do not pin
it** (why: docs/why.md#do-not-pin-the-journal).

### The title is a headline, rewritten every run

```
<Day> — <what changed today, in a clause or two>
```

`Sun — Turnstile gated on the atlas; feedback banner handed back`

- **Day of week, not a date.** The full date is the issue's creation time, which is sortable and
  filterable in a way a title string is not.
- **Rewrite it every run**, so it always describes the day *so far*. An empty day is
  `Sun — no changes`.
- **Describe outcomes, not activity.** "Turnstile gated on the atlas" beats "implemented #182".

### Two surfaces, two jobs

| Surface | Job |
| --- | --- |
| **A new comment**, one per run | Append-only detail. This run's entry, in the format below |
| **The issue body**, rewritten every run | The rolling summary of the whole day: what is done, and what awaits the reviewer |

- **Rewrite the body in full every run; never append to it.**
  (why: docs/why.md#the-body-is-rewritten-not-appended)
- **Never leave a stale `📋 Awaiting you` in the body** — it is the one section a reader trusts, and
  a wrong one is worse than none.
- **Build `📋 Awaiting you` from a query, not from memory**: `assignee:<reviewer>` across the five
  repos, plus open proposals.
- **Write for someone reading at 6am who was not here yesterday.** Never use the words "rung" or
  "ladder". Use the section headings below verbatim.

### Format

````markdown
### <ISO timestamp> · <loop|nightly> · [session](<url>)

Window since the last entry: ~Nh.

## 📋 Awaiting you
- 👀 [repo#N — <ticket title>](url) — ready for review, CI green
- ❓ [repo#N — <ticket title>](url) — blocked on your answer
- 💡 [repo#N — <ticket title>](url) — proposal, awaiting your verdict

## ✅ Merged
- 🔀 [repo#N — <title>](url) · closed [repo#M](url)

## 🔧 Changed
- ✏️ [repo#N — <title>](url) — <what changed, one clause>
- 💬 [repo#N — <title>](url) — replied about <topic>

## 🚀 Built
- 📦 [repo#N — <title>](url) — implements [repo#M](url) · CI green
- 🔬 [repo#N — <title>](url) — investigated · verdict: <one clause>
- 🛑 [repo#N — <title>](url) — not started: <why, one clause>

## 🔍 Surveyed
- <survey name> — <verdict in one line>

## ⏭️ Skipped
- <section> — <why: empty, or which ceiling>

## ⚠️ Failed
- <plainly, or "none">

<details>
<summary>Evidence and detail</summary>

<!-- The queries and tool calls behind each claim above, plus file lists,
     commit SHAs, CI durations, counts checked, tool limitations hit, and
     the reasoning behind a judgement call. -->

</details>
````

### Rules

- **`## 📋 Awaiting you` is always first and never omitted.** Empty is "nothing awaiting you" — a
  reader must never scroll to learn there is nothing to do.
- **Omit any other section that is empty**, rather than printing "none". Exception: `⚠️ Failed`,
  which always appears, because its absence is indistinguishable from forgetting it.
- **Every bullet carries the ticket title inside the link.** A bare number forces the reader to open
  a tab to learn what it was about.
- **Full `org/repo#N` for anything outside `journalRepo`** — a bare `#N` resolves against the repo
  the comment renders in and silently links somewhere wrong.
- **One line per bullet.** Anything longer belongs in the collapsible block.
- **The summary line is scannable prose, not a status code.** "declined — the Atlas form it mirrors
  does not exist yet" beats "declined (blocked)".
- Emoji are a fixed vocabulary, not decoration: 🔀 merged · ✏️ revised · 💬 replied · 📦 built ·
  🔬 investigated · 🛑 not started · 👀 needs review · ❓ needs an answer · 💡 proposal · 🔍 surveyed.

### `<details>` survives the write path — MCP readback lies about it

- **Trust the write.** A 200 from `issue_write` / `pull_request_write` means the tags are stored,
  whatever a subsequent MCP read shows.
- **The MCP read path strips `<details>`/`<summary>`** from what it returns, so a run verifying its
  own write via `pull_request_read` / `issue_read` sees its collapsible sections missing. It did not
  fail. **Do not "fix" it, do not re-post, do not file a ticket about it.**
- **WebFetch is not a check either** — its markdown conversion renders `<details>` content as
  visible text, so "the public page shows plain prose" is the conversion, not the page.
- The only faithful readback is REST, which a cloud session does not have.
  (why: docs/why.md#details-survives-the-write-path)

### The body: what the rolling summary looks like

Rewritten in full by every run. Short — it is an index, not a second copy of the entries.

````markdown
**<N> runs today.** Last: <ISO timestamp>.

## 📋 Awaiting you
- 👀 [repo#N — <title>](url) — ready for review, CI green
- ❓ [repo#N — <title>](url) — blocked on your answer

## ✅ Done today
- 🔀 merged [repo#N — <title>](url)
- 📦 built [repo#N — <title>](url)

## ⚠️ Failed today
- <plainly, or omit the section>

| Run | Entry |
| --- | --- |
| 04:00 | [detail](<comment url>) |
| 06:00 | [detail](<comment url>) |

## This month
| When | Run | Outcome |
| --- | --- | --- |
| 29 Aug 21:17 | [morning](<comment url>) | 1 built · 2 replied · ⚠ [addendum](<url>) |
````

**Correct an earlier claim in the body, not with an addendum comment.** The comment stays as the
historical record of what that run believed at the time. Only add a correcting comment when the
error would change what someone *did*. (why: docs/why.md#correcting-an-earlier-claim)

## Ending

Post the journal, then stop. Do not poll, do not wait for a review, do not keep a timer alive "in
case". **Do not attempt to end the session** — a run has no way to. What matters is that a lingering
session has nothing to wake it (never subscribe) and nothing to do if it does wake (the baton was
handed back). Responsiveness comes from the schedule. (why: docs/why.md#sessions-linger)

Close with a two-line summary: what awaits the user, and what the next run will pick up. If the run
hit a ceiling every rung, say so — that is the signal to retune `loop-config.json`, which the Sunday
`reflect` rung acts on.
