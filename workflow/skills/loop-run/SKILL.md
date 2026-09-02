---
name: loop-run
description: One run of the autonomous pipeline across the sydevs repos — merge PRs you approved, revise PRs and tickets on feedback, implement approved tickets, adversarially review the loop's own PRs, run the day's survey, and journal it. Invoked by the scheduled routines; runnable locally with --dry-run.
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

- `RUN_KIND` — `loop` (rungs 0–5, then 7; hourly through the Vancouver morning, two-hourly
  afternoons) or `nightly` (rung 6's survey, the reconciliation sweeps, then rung 7; once, at
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

**This runs on the GitHub MCP tools, not `gh`.** A routine reaches GitHub *only* through
`mcp__github__*`. Verified rather than assumed, because `docs/routine-setup.md` once claimed the
opposite and cost a day: `gh` is absent from the image, **installing it does not help** — `gh api
repos/...` returns `403 GitHub access is not enabled for this session`, byte-identical with and
without an auth header, so the proxy refuses the path rather than the credential — and `curl` to
REST and to GraphQL 403s the same way. `git` fetch and push still work; they do not use the API.

**So a script in this plugin never fetches.** The scripts below take data *you* fetched with MCP and
return a decision. `gh` remains correct when a skill is invoked locally as a slash command, and the
scripts accept that path too — but the rules they apply are the same code either way.
(why: docs/why.md#a-routine-cannot-reach-the-github-api)

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

**Build the queue from the assignee field — it IS the worklist.** One indexed search per shape.

⚠ **Scope every search with `repo:` qualifiers built from `repos`, never a bare `org:`.** Call that
string `$SCOPE` below. The org still holds retired repositories, and an `org:` scope pulled
seven-year-old `Atlas` and `WeMeditate` issues into the reviewer's queue the first time this was run
as a real query. Every search in this skill uses `$SCOPE`.

```
mcp__github__search_issues  query:"$SCOPE is:pr is:open assignee:<bot>"
mcp__github__search_issues  query:"$SCOPE is:issue is:open assignee:<bot> -label:ops-journal"
mcp__github__search_issues  query:"$SCOPE mentions:<bot> is:open updated:>=<last-run-ISO>"
```

**Read narrowly. Most of the backlog is irrelevant to any given run.**

1. **Titles yes, bodies no.** The census carries no bodies. Fetch one only for the item you are
   actually working. (why: docs/why.md#titles-yes-bodies-no)
2. **Comments cost a call each — earn them.** Fetch `get_comments` only where **both** hold: the item
   is on the worklist, *and* its comment count is greater than zero.
3. **A mention is the user asking directly.** Every hit on the mention query is a rung-4 candidate
   whatever else it matched: answer it or say why not, but never let one pass silently.
4. **`-label:ops-journal` is mandatory on every worklist query** you write by hand. Journal issues are
   never work. (why: docs/why.md#the-ops-journal-exclusion-is-mandatory)
5. ⚠ **In a hand-written `search_issues` query, write `>` literally.** An HTML-escaped `&gt;` is
   accepted without error and returns **zero results**. If a search returns nothing where you expect
   otherwise, suspect the qualifier before believing the answer.

**Relationships are still invisible to MCP.** No tool reads `blocked_by`, so resolve the
`Blocked by:` lines from the ticket body with `issue_read`. **Never conclude a ticket is unblocked
because you could not find a blocker** — conclude it only from those lines.

The per-repo PR list is cheap and stays full. **Read the last journal entry** (rung 7) to learn when
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

**Never decide mergeability yourself.** Gather all five, then ask `merge-verdict.mjs`:

```
mcp__github__pull_request_read  method:get                 owner:$ORG repo:$REPO pullNumber:<n>
mcp__github__pull_request_read  method:get_check_runs      owner:$ORG repo:$REPO pullNumber:<n>
mcp__github__pull_request_read  method:get_status          owner:$ORG repo:$REPO pullNumber:<n>
mcp__github__pull_request_read  method:get_review_comments owner:$ORG repo:$REPO pullNumber:<n>
mcp__github__list_workflows     owner:$ORG repo:$REPO        # total_count > 0 → hasWorkflows
```

```bash
echo '{"repo":"'$ORG/$REPO'","reviewDecision":"…","hasWorkflows":true,
       "pr":{…},"checkRuns":{…},"statuses":{…},"reviewThreads":{…}}' \
  | ${CLAUDE_PLUGIN_ROOT}/skills/loop-run/merge-verdict.mjs
```

**The definition of green lives in `workflow/lib/merge-gate.mjs`, and only there.** It was wrong in
two directions at once for a week — a deploy status standing in for a test job that was still
running, and a fully green PR reading as `pending` forever — which is why it is code with its story
in `docs/why.md#ci-truth-lives-in-check-runs` rather than a paragraph re-derived here. In short:
check runs carry the test signal, commit statuses carry deploy signals, and both are read.

| Script says | Verdict |
| --- | --- |
| `MERGE` | Merge, then the merge sequence below |
| `HOLD — no approving review` | Not a rung-1 item at all. Leave it: it waits on the reviewer, not on you |
| `HOLD — <anything else>` | **Do not merge.** One comment naming that exact reason, then move on. Fixing red CI is rung 2 |
| Two or more `MERGE` in one repo | **Order first: producers before consumers.** A consumer merged first was reviewed against a shape that does not exist yet |

**Omissions fail safe, never open.** A missing `reviewDecision` reads as *not approved*; an unknown
`hasWorkflows` reads as *this repo has CI*, so a missing check blocks rather than passes. Pass what
you actually fetched and let it refuse — never fill a field in to get a merge.

Repos in `mergePolicy.loopMayNotMerge` are held whatever the gate says. `claude-workflow` is one:
merging there is the deploy of the instructions the next run executes, and since that repo is also
ticketless, a human reading the PR is the only gate its changes pass.

**This is the same code path in a routine and on a laptop.** No script under `workflow/` fetches
anything; you gather, it decides. (why: docs/why.md#a-routine-cannot-reach-the-github-api)

**Exit `0` merges; exit `1` does not, and prints the reason to put in the comment.**

**Never substitute `method:get_status` for the check runs.** That call returns commit statuses; our
CI reports check runs. Reading it alone had SahajCloud#672 green for seventeen minutes while
`Lint, Test & Smoke` was still running, and had SahajAtlasWeb#181 — five of five checks green —
reading as `pending` forever. Pass `statuses` too if you have it; the script reads both surfaces and
requires **at least one check run**, so a deploy status cannot stand in for a test job that was
never scheduled. (why: docs/why.md#ci-truth-lives-in-check-runs)

| Verdict | Do |
| --- | --- |
| `MERGE` | Merge, then the merge sequence below |
| `HOLD — no approving review` | Not a rung-1 item at all. Leave it: it waits on the reviewer, not on you |
| `HOLD — <anything else>` | One comment naming that exact reason, then move on. Fixing red CI is rung 2 |
| Two or more `MERGE` in one repo | **Order first: producers before consumers.** A consumer merged first was reviewed against a shape that does not exist yet |

**Omissions fail safe, never open.** A missing `reviewDecision` reads as *not approved*; an unknown
`hasWorkflows` reads as *this repo has CI*, so a missing check blocks rather than passes. Pass what
you actually fetched and let it refuse — never fill a field in to get a merge.

Repos in `mergePolicy.loopMayNotMerge` are held whatever the gate says. `claude-workflow` is one:
merging there is the deploy of the instructions the next run executes, and since that repo is also
ticketless, a human reading the PR is the only gate its changes pass.

Ordering reads each PR's linked issue and the `Blocked by:` lines on it.

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
| **Unresolved review threads whose root comment is the own login** — rung 5's adversarial review | Treat exactly like a change request on our own PR: implement or rebut each thread with evidence, reply per thread, resolve the threads you actually addressed, refresh title and body, reassign to `assignment.reviewer` |

**The author filter has exactly one exception.** Everywhere else, a comment counts as feedback only
when its author is not the own login — but a review thread whose **root comment** the loop itself
wrote exists only because rung 5's adversarial review created it, and it is work, not self-chatter.
A bot reply inside a human's thread keeps a human root and stays excluded; no marker string is
involved, the comment's type and its thread's root author are the whole key.
(why: docs/why.md#the-author-filters-one-exception)

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

## Rung 5 — Adversarial review (loop runs only)

Counts against `maxWorkItemsPerRun`, and runs **only on leftover budget**: if rungs 2–4 spent the
run's slots, skip the whole rung and journal it under `⏭️ Skipped`. Going reviewless on a busy day
is the design, not a failure. (why: docs/why.md#the-adversarial-review-runs-last-and-may-starve)

Every eligible loop-authored PR gets **one adversarial review, ever**, before the reviewer reads
it. The review is advisory — approval stays with `assignment.reviewer`, and a run can neither
approve nor request changes on its own PR anyway, so every review submits as `COMMENT`.
(why: docs/why.md#reviews-are-comment-only)

One server-side query derives the candidates — `reviewed-by:` matches reviews of every state, so
the census needs no per-PR review fetch:

```
mcp__github__search_issues  query:"$SCOPE is:pr is:open draft:false author:<own login> -reviewed-by:<own login> -label:ops-journal"
```

Work the candidates in two groups, oldest `created_at` first within each:

1. **PRs not assigned to `assignment.bot`** — already handed to the reviewer; a review that lands
   before they read the PR is the whole point of the rung.
2. **Bot-assigned PRs**, skipping any with `reviewDecision == CHANGES_REQUESTED` — those are
   mid-revision, and the once-ever review is better spent after rung 2 hands them back.

PRs opened earlier in this same run are eligible: isolation comes from the subagent below, never
from waiting a run.

Per candidate, until the leftover budget is spent:

- `pull_request_read method:get` — still open, still not draft.
- **Green by rung 1's definition** — same gathering, same `merge-verdict.mjs`, and read only its
  `ci` verdict here (a PR awaiting review is `HOLD` for want of an approval, which is not a reason
  to skip reviewing it). Do not restate the rule, and do not special-case a repo: `claude-workflow`
  having no CI is *derived* from its workflow count, not written down. Not green → skip; a no-op
  skip is free.
- **Re-check for an existing review immediately before writing** — `pull_request_read
  method:get_reviews`, filtered to the own login. Search is a derived index and can lag; this read
  is authoritative. Any own-login review of any state → skip silently. An own-login **`PENDING`**
  review is a crashed run's residue: delete it if a delete tool resolves, otherwise submit it
  as-is; journal either way. (why: docs/why.md#one-review-per-pr-ever)
- **Spawn a fresh subagent (Task) to conduct the review.** Its prompt carries only the repo, the
  PR number, the checkout path, and the instruction to read
  `workflow/skills/adversarial-review/SKILL.md` in the claude-workflow checkout and follow it
  exactly. Never review in this session — a PR built here would be judged by the mind that built
  it. (why: docs/why.md#the-review-never-shares-the-implementers-context)
- One completed review = one work item. A findings review leaves the PR assigned to
  `assignment.bot` (the subagent does this); a clean review touches nothing.

**Starting a review thread is this rung's exclusive privilege.** No other rung may create an
inline review comment — the structural key above (own-login root = adversarial review) is only
sound while that holds. Replying inside an existing thread is not creating one, and stays allowed
everywhere. (why: docs/why.md#the-author-filters-one-exception)

`--dry-run`: print both groups with each candidate's verdict — eligibility, CI state, deferral
reason — and stop before spawning anything.

## Rung 6 — Survey (nightly run only)

Look up today's weekday in `surveyCalendar` and invoke that skill. `null` → skip.

Before filing anything, check the standing proposal ceiling with
`search_issues query:"$SCOPE is:issue is:open label:proposal"`. At or over `maxOpenProposals` →
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
mcp__github__search_issues  query:"$SCOPE is:open assignee:<reviewer> -label:hold -label:ops-journal"
```

For each, check whether the **newest comment is the reviewer's own** — that shape means they
answered and forgot to reassign. **Do not pick these up.** Name them in tonight's journal under a
`### Possibly awaiting a handoff` line. Anything with `hold` is excluded; scope the query to the
five workflow repos.

**Stale claims.** Any item still carrying `labels.claim` older than an hour is a crashed run's
residue. Remove the label, journal which items were cleared, and **leave the item assigned as
found** — assignment is the queue, not the crash signal.

## Rung 7 — Journal

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

### The title is computed, not written

```
Wed — 2 new, 1 revised, 2 merged, 1 closed
```

**Counts, never prose.** A sentence costs a re-read of the whole day on every run and describes what
the run *believes* happened; four numbers describe what the queries returned. Derive them from the
searches below and nothing else — never from memory of what this run did.

| Term | Counts |
| --- | --- |
| `new` | Issues the bot opened today. Never PRs; journals excluded |
| `revised` | Work items handed back to the reviewer today — the hand-back *is* the revision |
| `merged` | PRs the bot authored that merged today |
| `closed` | Work items closed today without merging |

- **A work item is an issue and its PR together**, paired through
  `closingIssuesReferences`, so a ticket and its PR never count twice.
- **The buckets are exclusive.** An item that merged or closed today is not also `revised` — the
  terminal outcome is the one that ended its story.
- **Zero terms are dropped**; a day with nothing is `Wed — no changes`.
- **Day of week, not a date.** The full date is the issue's creation time, which is sortable and
  filterable in a way a title string is not.

Each count is one search, scoped by `repo:` qualifiers over `repos`, with `<from>..<to>` spanning the
Vancouver day (use the zone's real UTC offset — `-07:00` or `-08:00` — since a bare date means UTC and
splits the day across two journals):

```
is:issue author:<bot> created:<from>..<to> -label:ops-journal      → new
is:pr    author:<bot> merged:<from>..<to>                          → merged
is:pr    author:<bot> is:unmerged is:closed closed:<from>..<to>  ┐
is:issue author:<bot> is:closed closed:<from>..<to>              ┘ → closed, deduped
```

`revised` is the hand-backs: items where an `assigned` event named the reviewer today with the bot as
actor. **Read it from each item's own timeline, not from a repo-level event feed** — the repo feed
reports `actor` as the *assignee* on an `assigned` event, so it would count the reviewer's own triage
as the loop's work, silently and only ever upward.

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
  repos in `repos`, plus open `proposal` issues. **Scope by `repo:` qualifiers, never `org:`** — the
  org still holds retired repositories, and a bare org scope put seven-year-old `Atlas` and
  `WeMeditate` issues in the reviewer's queue the first time this was run as a query.
- **It is a table, not a list.** This is a triage surface: the reviewer is scanning for *what needs
  me and how long has it waited*, which reads down a column and does not read out of a sentence.
  `Since` is the column a bullet list could not carry at all — an item waiting nine days and one
  waiting an hour look identical when both are prose. **Oldest first.**
- **One row per work item.** An issue and the PR that closes it are one thing; link the PR, since
  that is where the reviewing happens.
- **Oldest first**, so what has waited longest is read first.
- **Write for someone reading at 6am who was not here yesterday.** Never use the words "rung" or
  "ladder". Use the section headings below verbatim.

### Format

````markdown
### <ISO timestamp> · <loop|nightly> · [session](<url>)

Window since the last entry: ~Nh.

## 📋 Awaiting you

| | Item | Waiting for | Since |
| --- | --- | --- | --- |
| 👀 | [repo#N — <ticket title>](url) | Review — CI green | 2d |
| ❓ | [repo#N — <ticket title>](url) | Your answer | 4h |
| 💡 | [repo#N — <ticket title>](url) | Verdict on the proposal | today |

## ✅ Merged
- 🔀 [repo#N — <title>](url) · closed [repo#M](url)

## 🔧 Changed
- ✏️ [repo#N — <title>](url) — <what changed, one clause>
- 💬 [repo#N — <title>](url) — replied about <topic>
- 🧐 [repo#N — <title>](url) — reviewed: <clean, or "N findings, handed back">

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
  🔬 investigated · 🛑 not started · 👀 needs review · ❓ needs an answer · 💡 proposal · 🔍 surveyed ·
  🧐 reviewed.

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

| | Item | Waiting for | Since |
| --- | --- | --- | --- |
| 👀 | [repo#N — <title>](url) | Review — CI green | 2d |
| ❓ | [repo#N — <title>](url) | Your answer | 4h |
| 💡 | [repo#N — <title>](url) | Verdict on the proposal | today |

## ✅ Done today
- 🔀 merged [repo#N — <title>](url)
- 📦 built [repo#N — <title>](url)

## ⚠️ Failed today
- <plainly, or omit the section>

| Run | Entry |
| --- | --- |
| 04:00 | [detail](<comment url>) |
| 06:00 | [detail](<comment url>) |
````

**The body's `📋 Awaiting you` is the one the reviewer reads**, so it is the table in full — the
comment's copy is a snapshot of one run, this is the current state of the queue. `Since` is why it is
a table at all: an item waiting nine days and one waiting an hour are indistinguishable in prose.

There is **no month table.** The journal is one issue per day; a month's worth of runs is what the
Sunday `reflect` rung reads across issues, not something a single day's body carries.

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
