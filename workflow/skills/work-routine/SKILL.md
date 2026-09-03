---
name: work-routine
description: One run of the working-day routine — a pass down the ladder across the sydevs repos: merge PRs you approved, revise PRs and tickets on feedback, implement approved tickets, adversarially review what the loop built, and journal it. Invoked by the sydevs-work-hourly routine; runnable locally with --dry-run.
argument-hint: '[--dry-run]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Work Routine

One pass down a fixed ladder of work across the five sydevs repos — the four product repos plus
`claude-workflow`, which holds these very skills. **The ladder is ordered by how much it respects
the user's attention.** Descend only while ceilings allow; stop when one is hit and say so.

**"Rung" means one thing: a step of this ladder.** The survey routine — the once-a-night run in
`workflow/skills/survey-routine/SKILL.md` — is not a ladder and has no rungs.
(why: docs/why.md#the-survey-routine-is-not-a-ladder)

Every rule here is an imperative and stands on its own. The failure that produced each one lives in
**`docs/why.md`** in the `sydevs/claude-workflow` checkout, cited as `(why: …)`. Read a `why` entry
when a rule seems not to fit the case in front of you — never to decide whether to follow it.

**Begin with `/workflow:preflight`** — the ground rules and the census — **and end with
`/workflow:journal`.** The rungs between them are this file.

`--dry-run`: do everything read-only. Print the worklist each rung *would* act on and stop. Never
comment, commit, push, merge, or label.

## Rung 1 — Merge and sequence

**Merges do not count against `maxWorkItemsPerRun`. Merge every PR that qualifies.** The ceiling
governs work you *do* to an item — revising, implementing, investigating, replying. A merge consumes
a review decision that was already made: the gates are read, and if all three hold it is one API
call. Rationing it would leave approved, green work sitting while the run spent its budget elsewhere,
which is the opposite of the intent. Conflict resolution or a rebase that follows a merge is real
work and does count.

Candidates are one indexed query — no field is involved, because merge authority never was a field:

```
mcp__github__search_issues  query:"$SCOPE is:pr is:open assignee:<bot> draft:false review:approved"
```

A PR still in draft is the loop's own unfinished work and can never be a merge candidate; that is
the same fact `merge-verdict.mjs` enforces, and the query just avoids paying for it.

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
  | ${CLAUDE_PLUGIN_ROOT}/skills/work-routine/merge-verdict.mjs
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

**Exit `0` merges; exit `1` does not, and prints the reason to put in the comment.**

**Never substitute `method:get_status` for the check runs.** That call returns commit statuses; our
CI reports check runs. Reading it alone had SahajCloud#672 green for seventeen minutes while
`Lint, Test & Smoke` was still running, and had SahajAtlasWeb#181 — five of five checks green —
reading as `pending` forever. Pass `statuses` too if you have it; the script reads both surfaces and
requires **at least one check run**, so a deploy status cannot stand in for a test job that was
never scheduled. (why: docs/why.md#ci-truth-lives-in-check-runs)

Repos in `mergePolicy.loopMayNotMerge` are held whatever the gate says. `claude-workflow` is one:
merging there is the deploy of the instructions the next run executes, and since that repo is also
ticketless, a human reading the PR is the only gate its changes pass.

**This is the same code path in a routine and on a laptop.** No script under `workflow/` fetches
anything; you gather, it decides. (why: docs/why.md#a-routine-cannot-reach-the-github-api)

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

**A PR needs revision when any of these holds.** Derive them from the revision query in
`/workflow:preflight`, then read the threads:

- an **unresolved thread whose last comment is from a login in `assignment.respondTo`**, or
- an **unresolved thread rooted by the own login with no reply** — rung 5's adversarial review, or
- the **last PR comment is from a login in `assignment.respondTo`**.

Everything else is noise, by construction: a preview-URL comment, a coverage bot and a CI bot are
all off the allowlist, so none of them can start a revision pass.
(why: docs/why.md#respondto-is-an-allowlist)

| Condition | Verdict |
| --- | --- |
| **Red CI on our own PR** | Diagnose via `actions_get` on the failing run, fix, push. Cap at `ciFixIterations`; on cap-out, comment with the remaining failure and journal it |
| **Change request on a `claude/*` PR — ours** | Implement the feedback. Then: reply to **each** review comment individually, saying what changed or why it was not done, with `identity.commentMarker` appended; refresh the PR **title and body** from the current `origin/main...HEAD`; resolve the threads you actually addressed |
| **Change request on a human's PR** | **You cannot push to it** — a cloud session may only push to `claude/*`. This is a wall, not a permission to ask for. Take the three steps below instead |
| **Feedback that is ambiguous or architectural** | **Ask, do not guess.** Reply with the specific question and set `Stage: Revising` on the linked ticket, move on |
| **Unresolved review threads whose root comment is the own login** — rung 5's adversarial review | Treat exactly like a change request on our own PR: implement or rebut each thread with evidence, reply per thread, resolve the threads you actually addressed, refresh title and body |
| **Our PR closed without merging** | The linked ticket is stranded at `Implemented` and unassigned. Set it back to `Stage: Revising`, assign `assignment.reviewer`, and comment saying the PR was abandoned and why |

**Always end a revision with a comment.** That is the termination condition: the trigger is "the
last word is not ours", so a revision that pushes code and says nothing re-fires on the next run,
forever.

**Never change the PR's assignee, and never put it back into draft.** `draft:false` means it has
been ready for review at least once, and rung 5 depends on that staying true.
(why: docs/why.md#draft-is-the-prs-baton)

**The allowlist has exactly one exception, and it points inward.** A review thread whose **root
comment** the loop itself wrote exists only because rung 5's adversarial review created it, and it
is work, not self-chatter — so it counts even though the own login is not on `respondTo`. A reply of
ours inside someone else's thread keeps their root and is governed by the allowlist as usual; no
marker string is involved, the comment's type and its thread's root author are the whole key.
(why: docs/why.md#the-author-filters-one-exception)

On a human's PR, in order:

1. **Triage every thread and answer it** — adopted, or pushed back with the evidence. One comment
   summarising, detail in `<details>`. This happens even if nothing else does.
2. **Open a stacked PR carrying the adopted changes**, from `claude/<type>-<slug>` targeting **their
   branch**, not `main`. Say in the summary comment that it exists and what it contains.
3. **File a follow-up ticket** for anything the review raised that generalises beyond this PR.

⚠ **A stacked PR's base is their branch — confirm that before opening it.**
(why: docs/why.md#you-cannot-push-to-a-humans-pr)

## Rung 3 — Implement

**Two kinds of work live here.** Implementation needs `Stage: Implement`. **Investigation does
not** — a ticket at any Stage but `Blocked` or `Implemented` may be investigated, measured and
answered, so long as nothing is committed. A live `Hold Until` freezes everything. See
`/workflow:triage-issue` for the full table. **Investigations count against `maxWorkItemsPerRun`
too.**

The bound on implementations is `wipCapPerRepo`, a stock cap. **Skip the implementation path
entirely** when the repo is at `wipCapPerRepo` open loop PRs, or when no `Stage: Implement` ticket
is unblocked.

**Unblocked** means all three: no `Blocked by:` line in the body naming a still-open issue, `Stage`
is not `Blocked`, and `Hold Until` is absent or already past. Resolve each `Blocked by:` URL with
`issue_read` and check its state — a closed blocker does not block.

**When a block clears, clear the field too.** Delete `Hold Until` in the same edit that strikes the
line, and restore the `Stage` the marker's `(was: X)` suffix records — **except `Implement`, which
becomes `Revising`.** A blocker usually changes the shape of the work, so an `Implement` restored
without a human re-reading the ticket is the loop authorising its own code by the back door.
(why: docs/why.md#unblocking-never-restores-implement)

**When you find a blocker closed, strike the line.** Rewrite it in the body as:

```markdown
~~Blocked by: <url> — <original reason>~~ — cleared <YYYY-MM-DD>, that issue is closed
```

A live `Blocked by:` line against a closed issue is a standing cost and a standing trap. Every
future run pays an `issue_read` to re-derive the same answer, and the line reads as a blocker to
anyone — human or run — who does not resolve it. Three consecutive journals described one such
ticket as "blocked" when its blocker had already merged. Striking it costs one edit, once.

**Selection:** highest **Priority** field (`Critical` → `Low`), then oldest `updatedAt`. There is no
query for `Stage`, so pull the repo's open issues once and filter in memory:

```
mcp__github__list_issues  state:OPEN  fields:["field_values","labels","body"]
```

Keep the ones that are assigned to `assignment.bot`, are `Stage: Implement`, and have no live
`Hold Until`. This is the call `/workflow:preflight` already made — reuse it rather than repeating it.

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
missing, set `Stage: Revising`, and pick the next one. Setting `Revising` on a ticket the reviewer
marked `Implement` is a revocation, which the loop is always allowed to do — the reverse never is.

## Rung 4 — Ticket feedback

Counts against `maxWorkItemsPerRun`. Bot-assigned issues carrying a comment from
`assignment.respondTo` newer than the loop's own last comment.

- **Filter by author first.** A comment counts as feedback only when
  `comment.author.login` is in `assignment.respondTo`. (why: docs/why.md#respondto-is-an-allowlist)
- **Set `Stage: Revising` as you start**, unless the ticket is already there. It is a record of what
  is happening, not a gate — the comment is what triggered this, and the comment order is what says
  whose turn it is next.
- **Start from the `updated:>=` search set, not the whole backlog**, then fetch comments only for
  those with a non-zero comment count.
- **Derive the window from comment timestamps, never from `updated_at`.** Pull the issues that have
  comments at all, then filter each comment by `created_at` against the window and by author.
  (why: docs/why.md#derive-the-window-from-comment-timestamps)

**First decide what the comment is asking for**, because the three cases have different endings:

| The comment | What to do |
| --- | --- |
| **A question** | Answer it. Reply, update the ticket if the answer changes it, done. |
| **A request for work** — "investigate this", "can you look at…", "we should also…" | Do **not** implement it. Writing code needs `Stage: Implement` like everything else. Reply with what you would do and what it would cost, update the ticket body to specify it, and say plainly that it needs `Stage: Implement` to start. |
| **A correction or new evidence** | Verify it against source before accepting, then rewrite the affected part of the ticket. |

(why: docs/why.md#a-request-in-prose-is-not-permission)

- **Reply substantively** — answer the question, or say what you will change.
- **Update the ticket itself** where the comment changes it: title, body, priority, type,
  relationships. A reply that agrees to a change but leaves the ticket saying the old thing has not
  done the job.
- **Append `identity.commentMarker`** to every comment you write, here and in every other rung.
- **If the comment reads as approval** ("yes, do it"), say plainly that `Stage: Implement` is what
  actually starts work — **do not write it yourself.**
- **Leave `Stage` at `Revising` when you finish.** The loop having spoken last is exactly what puts
  the ticket in the reviewer's `📋 Awaiting you` table; no further field write is needed or wanted.

## Rung 5 — Adversarial review

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
mcp__github__search_issues  query:"$SCOPE is:pr is:open assignee:<bot> draft:false -reviewed-by:<own login> -label:ops-journal"
```

`draft:false` is the whole eligibility rule. A draft PR is the loop still working; the moment
`/workflow:finalize-pr` marks it ready for review it becomes reviewable, and it stays assigned to
the bot for its whole life, so assignment says nothing here and is not read.
(why: docs/why.md#draft-is-the-prs-baton)

Work the candidates **oldest `created_at` first**, skipping any with
`reviewDecision == CHANGES_REQUESTED` — those are mid-revision, and the once-ever review is better
spent after rung 2 has answered.

PRs marked ready earlier in this same run are eligible: isolation comes from the subagent below,
never from waiting a run.

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
- One completed review = one work item. **Neither outcome touches assignment or draft** — the
  findings are unresolved threads, and rung 2 picks those up on the next run by reading them.

**Starting a review thread is this rung's exclusive privilege.** No other rung may create an
inline review comment — the structural key above (own-login root = adversarial review) is only
sound while that holds. Replying inside an existing thread is not creating one, and stays allowed
everywhere. (why: docs/why.md#the-author-filters-one-exception)

`--dry-run`: print both groups with each candidate's verdict — eligibility, CI state, deferral
reason — and stop before spawning anything.

## Journal

Hand off to `/workflow:journal` — this run's entry is marked `loop`. If a ceiling stopped every
rung, the closing summary says so plainly; that is the signal the Sunday `reflect` survey acts on.
