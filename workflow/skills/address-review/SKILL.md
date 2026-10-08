---
name: address-review
description: Answer every open thread on one PR after a review or comment. Adopt with a commit, or rebut with evidence, then push and end. Fired by the dispatcher on review activity. Runnable locally against a PR number.
argument-hint: '[owner/repo#N]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Address review

One PR. Every thread that waits on us gets a reply, a commit or both. Then the branch is pushed
and the run ends. **Start with `/workflow:start-run` and end with
`/workflow:finish-run`.**

## Reads

- `mcp__github__pull_request_read method:get` — open, head branch, base, author, `mergeable`.
- `method:get_review_comments` — every thread, its root author, `is_resolved`.
- `method:get_reviews` — every review's **body** as well as its state. Derive the decision with
  `reviewDecisionFrom` through `${CLAUDE_PLUGIN_ROOT}/lib/merge-verdict.mjs`, never from memory.
- `method:get_comments` — **the newest page only**, `perPage` small, the page computed from the
  `comments` count on `get`.
- The linked ticket's body, for scope. Then `git fetch origin <branch>` and the touched files.

## What counts as a thread to address

Any one of these, and nothing else:

- an unresolved thread whose last comment comes from a login in `assignment.respondTo`,
- an unresolved thread the own login rooted, with no reply — the adversarial review,
- **a review body** from a login in `assignment.respondTo`, non-empty, submitted after the own
  login's last comment. Each distinct point in it is one item. General feedback lives here as
  often as in file threads — a review whose body you skip is a review you ignored.
  (why: docs/why.md#a-review-body-is-feedback)
- the newest conversation comment comes from a login in `assignment.respondTo`, and is newer
  than the own login's last comment.

A preview-URL, coverage, or CI bot sits off the allowlist. None of them starts a revision.
(why: docs/why.md#respondto-is-an-allowlist) **Actions filtered the trigger. You still filter
every thread.** The one exception points inward: the own-rooted threads are the critic's, and
they are work. Comment type and thread root together are the key.
(why: docs/why.md#the-author-filters-one-exception)

## Per thread

| Decision | Do |
| --- | --- |
| **Adopt** | One commit per thread, `fix(<scope>): <thread in five words>`. Reply in the thread: what changed and the SHA, inside `writing.budgets.reviewReply`. **Resolve the thread.** |
| **Rebut** | Reply in the thread with evidence — a file and line, or the ticket line it satisfies. **Leave it open.** Only the reviewer settles it. |
| **Ambiguous or architectural** | **Ask. Do not guess.** Reply with the question. Leave it open. |

A thread with a reply from the own login newer than its last human comment is already handled.
Skip it. A review body is handled once a summary comment from the own login is newer than its
`submitted_at`. Those two rules are what make a resumed run safe.

**A review body has no thread to reply in.** Adopt, rebut or ask exactly as for a thread, one
commit per adopted point, and answer every point in step 5's summary comment: quote it, then give
the SHA or the evidence. A point that generalises beyond this PR becomes a follow-up ticket,
filed through `/workflow:write-ticket`.

## Then

1. Lean gate, from `.claude/workflow.json` (`/workflow:finalize-pr` step 4).
2. Docs sync (`/workflow:finalize-pr` step 5).
3. `git push`. Never force-push. Never rebase.
4. Refresh the PR title and body from `origin/main...HEAD` **where this push made either one
   false** — a `## Change outline` view the new commits contradict is false, and
   `review-pr` step 2 reads it first (`/workflow:finalize-pr` step 7). Re-send the body
   preflight step 4 already read, with the delta applied; `update_pull_request` replaces the
   whole body, so never retype one from nothing. A body merely incomplete stays, and step 5's
   comment carries that delta.
5. **One summary comment**, inside `writing.budgets.comment`: adopted, rebutted, asked — each
   linking its thread, or quoting its review-body point — with `identity.commentMarker`. **A revision that pushes and says nothing
   is invisible.** The comment is what Actions and the reviewer read.

**Push and stop.** Actions reads CI when it completes. **Never merge `main` in to bring the branch
up to date, even when a reviewer asks.** A base merge belongs only to a PR GitHub reports
`CONFLICTING`. Reply on the thread instead.
(why: docs/why.md#push-and-end, docs/why.md#staleness-is-not-yours-conflicts-are)

## A human's PR

`flags.delegated`, or the PR author is not the own login. **You cannot push to it.** A cloud
session pushes only to `claude/*`. In order:

1. **Answer every thread** — adopt it, or push back with evidence, in one summary comment. Do
   this even when nothing else happens.
2. **Open a stacked PR** from `claude/<type>-<number>-<slug>` targeting **their branch**, not
   `main`, through `/workflow:finalize-pr` with `base:<their branch>`. Name it in the summary.
3. **File a follow-up ticket** for anything that generalises beyond this PR.

⚠ **Check the stacked PR's base is their branch before you open it.**
(why: docs/why.md#you-cannot-push-to-a-humans-pr)

## Hard rules

- **Never start a new review thread.** That channel belongs to `review-pr` alone. Reply
  inside existing threads only. (why: docs/why.md#the-author-filters-one-exception)
- **Never `APPROVE` or `REQUEST_CHANGES`.** (why: docs/why.md#reviews-are-comment-only)
- **Never force-push, rebase, or squash history.**
- **Never touch the draft flag, an assignee, a reviewer request, or a label other than the
  lock.** Actions owns them.
- **Never wait for CI.** Push and end.
