---
name: work-routine
description: One run of the working-day routine — merge, revise, implement, adversarially review, and journal, in that order down a fixed ladder. Invoked by the sydevs-work-hourly routine, runnable locally with --dry-run.
argument-hint: '[--dry-run]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Work Routine

One pass down a fixed ladder of work across the five sydevs repos, including `claude-workflow`,
which holds these skills. **The ladder is ordered by how much it respects the user's attention** —
descend only while ceilings allow, and stop and say so when one is hit.

**"Rung" means one thing: a step of this ladder.** The survey routine has no rungs — it is not a
ladder. (why: docs/why.md#the-survey-routine-is-not-a-ladder)

Every rule here stands on its own. Its failure lives in **`docs/why.md`**, cited `(why: …)` —
read an entry when a rule seems not to fit, never to decide whether to follow it.

**Start with `/workflow:preflight`** — the ground rules and the census — **and end with
`/workflow:journal`.** The rungs between them are this file.

`--dry-run`: do everything read-only. Print the worklist each rung *would* act on, then stop.
Never comment, commit, push, merge, or label.

## Rung 1 — Merge and sequence

**Merges do not count against `maxWorkItemsPerRun` — merge every PR that qualifies.** A merge
spends a decision the reviewer already made. Resolving a conflict or rebasing after the merge is
work, and counts.

**Candidates are every ready PR of ours. Read approval per PR, never from search.**

```
mcp__github__search_issues  query:"$SCOPE is:pr is:open author:<bot> draft:false"
```

⚠ **Never add `review:approved` to that query.** Search lags the review, so an empty result reads
exactly like "nothing is approved". (why: docs/why.md#search-lags-the-review-that-feeds-it)

`draft:false` is safe here — the loop sets that flag itself, so no third party's write can lag.

⚠ **No MCP call returns `reviewDecision`.** Neither `method:get` nor `list_pull_requests` carries
it. Derive it from `method:get_reviews`, one call per candidate, bounded by `wipCapPerRepo` ×
`repos`.

**Never derive the decision yourself.** `reviewDecisionFrom` in `merge-gate.mjs` is the one
definition, called by `merge-verdict.mjs` — put the `get_reviews` payload in the snapshot's
`reviews` key and leave `reviewDecision` out. **Only `assignment.reviewer`'s approval counts**,
since four repos are public and any account can approve.
(why: docs/why.md#only-the-reviewers-approval-counts)

**Never decide mergeability yourself.** Gather all six, then ask the script:

```
mcp__github__pull_request_read  method:get                 owner:$ORG repo:$REPO pullNumber:<n>
mcp__github__pull_request_read  method:get_reviews         owner:$ORG repo:$REPO pullNumber:<n>
mcp__github__pull_request_read  method:get_check_runs      owner:$ORG repo:$REPO pullNumber:<n>
mcp__github__pull_request_read  method:get_status          owner:$ORG repo:$REPO pullNumber:<n>
mcp__github__pull_request_read  method:get_review_comments owner:$ORG repo:$REPO pullNumber:<n>
# hasWorkflows — read the checkout, never the API:
#   ls $REPO/.github/workflows/*.yml $REPO/.github/workflows/*.yaml 2>/dev/null | head -1
```

```bash
echo '{"repo":"'$ORG/$REPO'","hasWorkflows":true,"reviews":[…],
       "pr":{…},"checkRuns":{…},"statuses":{…},"reviewThreads":{…}}' \
  | ${CLAUDE_PLUGIN_ROOT}/skills/work-routine/merge-verdict.mjs
```

| Script says | Do |
| --- | --- |
| `MERGE` | Merge, then the sequence below |
| `HOLD — no approving review` | Leave it — that waits on the reviewer, not on you |
| `HOLD — <anything else>` | **Do not merge.** Comment with that exact reason. Red CI is rung 2 |
| Two or more `MERGE` in one repo | **Producers before consumers**, ordered from each PR's linked issue and its `Blocked by:` lines |

**Exit `0` merges. Exit `1` does not, and prints the reason for the comment.**

⚠ **Never substitute `method:get_status` for the check runs.** Commit statuses are deploy
signals only, and can read green mid-test — pass both to the script. `merge-gate.mjs` alone
defines green. (why: docs/why.md#ci-truth-lives-in-check-runs)

**`hasWorkflows` comes from the filesystem** — every repo is already cloned, so the API call is
both unneeded and unavailable here. (why: docs/why.md#hasworkflows-is-a-filesystem-check)

**Omissions fail safe.** A missing `reviewDecision` reads as not approved. Unknown `hasWorkflows`
reads as CI present, so a missing check blocks. Pass only what you fetched — never populate a
field to force a merge.

**Repos in `mergePolicy.loopMayNotMerge` are held whatever the gate says** — merging
`claude-workflow` deploys the next run's own instructions, and a human reading the PR is its only
gate.

**The same code runs in a routine and on a laptop.** No script under `workflow/` fetches — you
gather, it decides. (why: docs/why.md#a-routine-cannot-reach-the-github-api)

The merge sequence, in order:

1. `mcp__github__merge_pull_request  owner:$ORG repo:$REPO pullNumber:<n>  merge_method:"squash"`
2. **Rebase the survivors** — every other open loop PR in that repo onto the new `main`, so the
   next review reads current code. On a conflict, leave it, comment, and journal it. **Never
   force-push someone else's branch.**
3. **Resolve the Sentry issue** when the merged work closed a ticket carrying a `Sentry:` link:
   ```bash
   API=$(jq -r '.sentry.apiBase' loop-config.json)   # DE region — sentry.io 404s here
   curl -sX PUT "$API/issues/<id>/" \
     -H "Authorization: Bearer $SENTRY_CLAUDE_WORKFLOW_TOKEN" \
     -H 'Content-Type: application/json' -d '{"status":"resolved"}'
   ```

## Rung 2 — PR health

Every item counts against `maxWorkItemsPerRun`. Take the highest-priority linked ticket first.
(why: docs/why.md#rung-2-competes-for-the-same-budget)

**A PR needs revision when any one of these holds:**

- an unresolved thread whose last comment comes from a login in `assignment.respondTo`,
- an unresolved thread the own login rooted, with no reply — rung 5's adversarial review,
- the last PR comment comes from a login in `assignment.respondTo`.

A preview-URL, coverage, or CI bot all sit off the allowlist, so none can start a revision.
(why: docs/why.md#respondto-is-an-allowlist)

**The allowlist has one exception, and it points inward** — rung 5's own threads are work. A
reply inside someone else's thread keeps their root, so the allowlist still governs it: comment
type and thread root together are the key. (why: docs/why.md#the-author-filters-one-exception)

| Condition | Do |
| --- | --- |
| **Red CI on our own PR** | Diagnose with `actions_get`, fix, and push. Cap at `ciFixIterations`. On cap-out, comment the remaining failure and journal it |
| **Change request on a `claude/*` PR** | Implement the feedback. Reply to **each** review comment with what changed or why not. Append `identity.commentMarker`, refresh title and body from `origin/main...HEAD`, and resolve the threads you addressed |
| **Change request on a human's PR** | **You cannot push to it.** A cloud session pushes only to `claude/*`. Take the three steps below |
| **Ambiguous or architectural feedback** | **Ask, do not guess.** Reply with the question and move on |
| **Unresolved own-rooted threads** | Treat as a change request on our own PR. **A thread you rebutted rather than adopted is a dead end — add `labels.awaiting`**, since only the reviewer settles it |
| **Our PR closed unmerged** | The state machine already set the ticket to `Revising` and marked it `awaiting`. Write neither. Comment saying why it was abandoned |

**Always end a revision with a comment** — the trigger is "the last word is not ours", so a
revision that pushes code and says nothing re-fires every run.

**Never set or change a PR's assignee, and never return a PR to draft.** Leave a delegated
assignment as found. `draft:false` means the PR was ready once, and rung 5 depends on that.
(why: docs/why.md#draft-is-the-prs-baton)

**Add `labels.awaiting` on a dead end, and only there.** Two live in this rung: CI red past
`ciFixIterations`, and a conflict you could not rebase. An event clears the label everywhere else.

On a human's PR, in order:

1. **Answer every thread** — adopt it, or push back with evidence, in one summary comment. Do
   this even when nothing else happens.
2. **Open a stacked PR** from `claude/<type>-<slug>` targeting **their branch**, not `main`, and
   name it in the summary comment.
3. **File a follow-up ticket** for anything that generalises beyond this PR.

⚠ **Check a stacked PR's base is their branch before you open it.**
(why: docs/why.md#you-cannot-push-to-a-humans-pr)

## Rung 3 — Implement

**Two kinds of work live here.** Implementation needs `Stage: Implement`. **Investigation does
not** — any Stage but `Blocked` or `Implemented` may be investigated and answered, committing
nothing. A live `Hold Until` freezes both, and investigations still count against
`maxWorkItemsPerRun`.

`wipCapPerRepo` bounds implementations. **Skip the implementation path** when the repo is at that
cap, or when no unblocked `Stage: Implement` ticket exists.

**Unblocked** means all three: no `Blocked by:` line naming a still-open issue, `Stage` is not
`Blocked`, and `Hold Until` is absent or past. Resolve each `Blocked by:` URL with `issue_read`.

**When a block clears, clear the field too.** Delete `Hold Until` in the same edit that strikes
the line, and restore the `Stage` the `(was: X)` suffix records — **except `Implement`, which
becomes `Revising`**. (why: docs/why.md#unblocking-never-restores-implement)

**Strike a closed blocker's line** so no future run pays to re-derive it:

```markdown
~~Blocked by: <url> — <original reason>~~ — cleared <YYYY-MM-DD>, that issue is closed
```

**Selection: highest `Priority`, then oldest `updatedAt`.** No query reaches `Stage`, so filter
the `list_issues` call `/workflow:preflight` already made, keeping what is bot-assigned, at
`Stage: Implement`, and not held.

Use **Effort** as a tie-break and a sanity check — **split an `Effort: Hard` ticket rather than
start it** when one run cannot finish it, since an implementation never carries across runs. Then
hand to `/workflow:implement-issue`.

**Cross-repo side effects are exempt from the WIP cap.** When the work forces a consumer change,
open that PR too — withholding it leaves `main` inconsistent. Order it with
`/workflow:cross-repo-issue`.

**Never force an investigation into a PR.** A ticket whose deliverable is a finding ends with a
comment and an updated body, with no branch and no PR. Acceptance criteria describing a decision,
not a behaviour change, mean the output is prose.
(why: docs/why.md#an-investigation-must-not-be-forced-into-a-pr)

**Never start a ticket too large or too vague to finish in one run.** Comment with what is
missing, set `Stage: Revising`, add `labels.awaiting`, and take the next one. Revoking `Implement`
is always allowed. Granting it never is.

## Rung 4 — Ticket feedback

Counts against `maxWorkItemsPerRun`. Bot-assigned issues carrying a comment from
`assignment.respondTo` newer than the loop's own last comment.

- **Filter by author first.** Only a login in `assignment.respondTo` writes feedback.
  (why: docs/why.md#respondto-is-an-allowlist)
- **Never touch `Stage` or `labels.awaiting` here** — the comment already fired
  `issue_comment: created`, so the state machine set `Revising` and cleared `awaiting` before this
  run started. Reply, revise the body, and stop.
- **Start from the `updated:>=` search set**, then read comments only where the count is
  non-zero.
- **Derive the window from comment timestamps, never from `updated_at`** — a field write bumps
  `updated_at`. (why: docs/why.md#derive-the-window-from-comment-timestamps)

| The comment | Do |
| --- | --- |
| **A question** | Answer it. Update the ticket when the answer changes it |
| **A request for work** | Do **not** implement it. Reply with what you would do and its cost, specify it in the body, and say `Stage: Implement` starts it |
| **A correction or new evidence** | Check it against source, then rewrite the affected part of the ticket |

(why: docs/why.md#a-request-in-prose-is-not-permission)

- **Reply substantively.** Answer the question, or say what you will change.
- **Update the ticket itself** — title, body, priority, type, relationships. Agreeing to a change
  in a reply, while the ticket still states the old thing, has not done the job.
- **Append `identity.commentMarker`** to every comment, here and in every rung.
- **When a comment reads as approval, say that `Stage: Implement` starts work. Never write it.**
- **Add `labels.awaiting` only when you asked a question or reported a finding.** No event sees
  either. When you simply answered, leave the label clear.

## Rung 5 — Adversarial review

Counts against `maxWorkItemsPerRun` and runs **only on leftover budget**. When rungs 2–4 spend the
slots, skip the rung and journal it. A reviewless busy day is the design.
(why: docs/why.md#the-adversarial-review-runs-last-and-may-starve)

**Every eligible loop-authored PR receives one adversarial review, ever**, before the reviewer
reads it. The review is advisory, and a run can neither approve nor request changes on its own PR, so
**every review submits as `COMMENT`**. (why: docs/why.md#reviews-are-comment-only)

```
mcp__github__search_issues  query:"$SCOPE is:pr is:open author:<own login> draft:false -reviewed-by:<own login> -label:ops-journal"
```

`draft:false` is the whole eligibility rule. Assignment says nothing here — the PR is ours because
we wrote it. (why: docs/why.md#draft-is-the-prs-baton)

Work candidates **oldest `created_at` first**, and **skip any at `CHANGES_REQUESTED`** —
mid-revision PRs are better reviewed after rung 2 answers. Take that verdict from
`reviewDecisionFrom` on `get_reviews`, never a `reviewDecision` field, since no MCP call carries
one. A PR marked ready earlier this run is eligible.

Per candidate, until the budget runs out:

- `pull_request_read method:get` — still open, still not draft.
- **Green by rung 1's definition** — same gathering, same script, reading only its `ci` verdict. A
  PR held only for want of an approval is still worth reviewing. Not green means skip.
- **Re-check for an existing review immediately before writing**, with `method:get_reviews`
  filtered to the own login. Search lags. Any own-login review of any state means skip. An
  own-login `PENDING` review is a crashed run's residue: delete it if a tool resolves, otherwise
  submit it, and journal either way. (why: docs/why.md#one-review-per-pr-ever)
- **Spawn a fresh subagent (`Task`) to conduct the review.** Its prompt carries the repo, the PR
  number, the checkout path, and one instruction: read
  `workflow/skills/adversarial-review/SKILL.md` and follow it. **Never review in this session** —
  a PR built here would be judged by the mind that built it.
  (why: docs/why.md#the-review-never-shares-the-implementers-context)
- One completed review is one work item. **Neither outcome touches assignment or draft.** The
  findings are unresolved threads, and rung 2 reads them next run.

**Starting a review thread is this rung's exclusive privilege.** No other rung creates an inline
review comment, because rung 2's structural key depends on it. Replying inside an existing thread
is allowed everywhere. (why: docs/why.md#the-author-filters-one-exception)

`--dry-run`: print each candidate's verdict and stop before spawning anything.

## Journal

Hand off to `/workflow:journal`. When a ceiling stopped every rung, say so — that is the signal
Sunday's `reflect` acts on.
