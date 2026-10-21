---
name: address-review
description: Answer every open thread on one PR after a review or comment. Build every reviewer ask on this PR, rebut only a fact, offer a split only as the reviewer's choice, then push and end. Fired by the dispatcher on review activity. Runnable locally against a PR number.
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
  `reviewDecisionFrom` through `${CLAUDE_PLUGIN_ROOT:-<claude-workflow>/workflow}/lib/merge-verdict.mjs`, never from memory.
- `method:get_comments` — **the newest page only**, `perPage` small, the page computed from the
  `comments` count on `get`.
- The linked ticket's body, for scope. Then `git fetch origin <base> <branch>` and the touched files.

## Merge the base first

**Before any thread, merge `origin/<base>` into the branch when the branch is behind it.** Every
run on a PR you can push to, asked or not, so each fix is built on the current base and the lean gate tests the merged
result. A merge commit only, resolved as `resolve-conflicts` steps 2-4 say: both sides' intent,
both behaviours kept. Push it even when no thread is adopted. In the summary comment a clean merge
gets one line, and a resolved conflict gets a line per hunk whose choice was not obvious.
**On a semantic conflict, `git merge --abort`**, ask in format-ticket's options shape, and address
the threads on the unmerged branch.
(why: docs/why.md#every-revision-starts-from-the-current-base)

## What counts as a thread to address

Any one of these, and nothing else:

- an unresolved thread whose last comment comes from a login in `assignment.respondTo`,
- an unresolved thread the own login rooted, with no reply — the adversarial review. A root
  carrying `review.questionMarker` is a question thread instead: it waits on the person, and
  becomes work only once they reply,
- **a review body** from a login in `assignment.respondTo`, non-empty, submitted after the own
  login's last comment. Each distinct point in it is one item. General feedback lives here as
  often as in file threads — a review whose body you skip is a review you ignored.
  (why: docs/why.md#a-review-body-is-feedback)
- the newest conversation comment comes from a login in `assignment.respondTo`, is newer than
  the own login's last comment, and mentions `dispatch.commandPrefix` with any verb but
  `review` or its alias. An unmentioned comment is the reviewer talking to the PR, not to you.
  (why: docs/why.md#a-bot-pr-answers-a-mention-or-a-review)

A preview-URL, coverage, or CI bot sits off the allowlist. None of them starts a revision.
(why: docs/why.md#respondto-is-an-allowlist) **Actions filtered the trigger. You still filter
every thread.** The one exception points inward: the own-rooted threads are the critic's, and
they are work. Comment type and thread root together are the key.
(why: docs/why.md#the-author-filters-one-exception)

## The reviewer's ask is the spec

**A human reviewer's ask is built on this PR** — a fix, a redesign, a wider scope, the same fix
across the system. The PR is done when it meets the ticket and every ask, not when its code works.
Never rebut an ask on scope, size or design, never call the PR proven to merge first, and never
defer an ask to a follow-up. (why: docs/why.md#the-reviewers-ask-is-the-spec)

- **An ask that adds or changes a requirement** goes into the ticket's `## Acceptance criteria`
  as format-ticket's review line, in the same run. A small fix does not.
- **A strong case that part of an ask belongs in its own ticket** — little connective tissue
  with this PR, or a size that dwarfs it — is the reviewer's choice, never yours. Build it here
  anyway. Then ask in the thread, in format-ticket's options shape: *A — keep it here (built)*,
  *B — revert it, and file it as its own ticket*. Only their *B* files it.
- **Ask before you build** only what cannot be built here: work in another repo, or a decision
  the goal owns. Another repo's part of a goal belongs on that repo's sibling PR, or its child.
- **Too much for this run** → push what is built, and reply only to the threads it finishes.
  End the summary comment with what remains, then `<!-- sydevs-request {"continue":true} -->`:
  the dispatcher starts the next run at once. Never answer a thread with a promise.

## Per thread

| Decision | Do |
| --- | --- |
| **Adopt** | One commit per thread, `fix(<scope>): <thread in five words>`. Reply in the thread: what changed and the SHA, inside `writing.budgets.reviewReply`. **Resolve the thread.** |
| **Rebut a fact** | Only when the ask rests on a premise the code disproves. Reply with the evidence — a file and line, or the ticket line it satisfies. **On a human's thread, leave it open.** Only they settle it. |
| **Rebut the critic** | On a thread the own login rooted, any point may be rebutted with evidence. **Resolve it:** your evidence settles a bot's point. (why: docs/why.md#a-rebutted-critic-thread-is-resolved) |
| **An answer to a question thread** | Build the chosen option in one commit, or keep the built one. A split answered *B* → revert that part, and file it through `/workflow:write-ticket` in `create` mode. Reply with the SHA, the new ticket, or that the built option stands. **Resolve the thread.** |
| **Ambiguous** | **Ask. Do not guess.** Reply with the question in format-ticket's options shape: each option with what it implies, your recommendation first. Leave it open — on the critic's thread too, but only for a question the reviewer must answer, never for visibility. |

On a docs PR, every docs point in its repo is this PR's. Adopt it.
(why: docs/why.md#a-docs-fix-is-a-pr-not-a-ticket)

A thread with a reply from the own login newer than its last human comment is already handled.
Skip it. A review body is handled once a summary comment from the own login is newer than its
`submitted_at`. Those two rules are what make a resumed run safe.

**A review body has no thread to reply in.** Adopt, rebut or ask exactly as for a thread, one
commit per adopted point, and answer every point in step 6's summary comment: quote it, then give
the SHA or the evidence. An ask becomes a question thread on the line it concerns
(`/workflow:finalize-pr` step 7c), and the summary links it.

## Then

1. Security review, when the push touches `securityReview.triggerPattern`
   (`/workflow:finalize-pr` step 3). A reviewer's ask can widen `allowed-tools` too.
2. Lean gate, from `.claude/workflow.json` (`/workflow:finalize-pr` step 4).
3. Docs sync (`/workflow:finalize-pr` step 5).
4. `git push`. Never force-push. Never rebase.
5. Refresh the PR title and body **where this push made either one false**, as `pr-template.md`'s
   *Refresh* says — a `## Change outline` view the new commits contradict is false, and
   `review-pr` step 2 reads it first.
6. **One summary comment**, inside `writing.budgets.comment`: adopted, rebutted, asked — each
   linking its thread, or quoting its review-body point — with `identity.commentMarker`. **A revision that pushes and says nothing
   is invisible.** The comment is what Actions and the reviewer read.

**Push and stop.** Actions reads CI when it completes. (why: docs/why.md#push-and-end)

## A human's PR

`flags.delegated`, or the PR author is not the own login. **You cannot push to it.** A cloud
session pushes only to `claude/*`. In order:

1. **Answer every thread** — adopt it, or push back with evidence, in one summary comment. Do
   this even when nothing else happens.
2. **Open a stacked PR** from `claude/<type>-<number>-<slug>` targeting **their branch**, not
   `main`, through `/workflow:finalize-pr` with `base:<their branch>`. Name it in the summary.
3. **Build every ask in the stacked PR.** A part you would split goes to them as a choice,
   exactly as on a bot PR.

⚠ **Check the stacked PR's base is their branch before you open it.**
(why: docs/why.md#you-cannot-push-to-a-humans-pr)

## Hard rules

- **Never start a new review thread**, except a question thread. That channel belongs to
  `review-pr` alone. Reply inside existing threads only.
  (why: docs/why.md#the-author-filters-one-exception, docs/why.md#a-pr-question-is-a-thread-on-the-line)
- **Never `APPROVE` or `REQUEST_CHANGES`.** (why: docs/why.md#reviews-are-comment-only)
- **Never force-push, rebase, or squash history.**
- **Never write state** (start-run's list). Actions owns it.
- **Never wait for CI.** Push and end.
