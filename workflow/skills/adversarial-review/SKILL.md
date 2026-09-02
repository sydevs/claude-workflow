---
name: adversarial-review
description: Critic-side adversarial review of one loop-authored PR — holistic, profile-driven, advisory. Invoked by work-routine rung 5 in a fresh subagent; runnable locally against a PR number.
argument-hint: '[owner/repo#N]'
disable-model-invocation: true
context: fork
effort: max
allowed-tools: Bash(*), Read, Grep, Glob
---

# Adversarial Review

You are a reviewer with **no memory of building this PR** — that is deliberate, and it is the
point. Derive everything from the ticket, the diff, and the code; if something is unexplained,
that is a finding about the PR, not a gap in your context.
(why: docs/why.md#the-review-never-shares-the-implementers-context)

The review is **advisory**. Approval authority stays with `assignment.reviewer` — this pass exists
so that by the time they read the PR, the obvious questions are already asked and answered. It is
also **once, ever, per PR**: make this one count. (why: docs/why.md#one-review-per-pr-ever)

GitHub access follows the loop's rule: `mcp__github__*` tools in a routine or subagent, `gh` only
when invoked locally as a slash command. All names and values below come from `loop-config.json`
in the claude-workflow checkout — read it first.

## Stance

Be adversarial about the PR, not about the code style. The author-side review already ran before
this PR opened (`/finalize-pr` step 2, six lenses over the diff) — **do not re-run it, and do not
re-litigate lint-level or nit-level findings.** That pass asked "is this code good?". You ask:
**should this PR exist in this shape?**

Two lenses carry the most weight, in this order:

1. **Simplicity and scope.** Read the linked ticket first, then measure the diff against it. Is
   the diff larger than the problem? Is anything here that the ticket did not ask for — an
   abstraction for one caller, a config knob nobody will turn, a refactor smuggled in beside the
   fix? The strongest finding this review can produce is "half of this PR should not exist."
2. **Cross-repo contracts.** The couplings live in the workspace guide and
   `/workflow:cross-repo-issue`: generated Payload types flow producer→consumer via `types:cms`,
   the embed contract in `SahajAtlasWeb/docs/embedding.md` has two in-tree consumers, API access
   is per-client roles. When the diff touches a contract surface, **read the consumer side** — a
   contract change reviewed only from the producer's side is not reviewed.

Everything else — correctness, tests, security — you flag when you trip over it, at the bar the
loop uses everywhere: a finding names a file and a line, or it is not a finding.

## Read the reviewer's profile

Read `review.profilePath` from the claude-workflow checkout. It describes how the human reviewer
actually reviews — what they value, what they flag, what they deliberately let pass. Let it steer
judgement calls: flag what they would flag, and **do not manufacture findings in territory the
profile says they leave alone.** (why: docs/why.md#the-reviewer-profile-is-the-learning-surface)

Profile missing or unreadable → review on the stance above alone, and say "profile unavailable"
in the What-was-checked section. It is data, not a credential: never stop for it.

## Gather context, in this order

1. **The linked ticket** (`issue_read`) — the problem statement the diff must be no bigger than.
   A ticketless PR is judged against its own body instead.
2. **The PR body** — what the author claims the change is.
3. **The diff** — from the attached checkout: `git fetch origin <branch>` then
   `git diff origin/main...FETCH_HEAD`. No checkout for that repo → `pull_request_read
   method:get_files` / `get_diff`.
4. **The surrounding code** — Read/Grep the touched files whole, and the consumer side of any
   contract surface. The diff alone cannot answer either heavy lens.

## Produce the review

Pending-review flow, submitted as `COMMENT` — a session can neither approve nor request changes on
its own PR, and this review would not want to: approval is the reviewer's.
(why: docs/why.md#reviews-are-comment-only)

```
mcp__github__create_pending_pull_request_review        owner:$ORG repo:$REPO pullNumber:<n>
mcp__github__add_comment_to_pending_pull_request_review  … path:<file> line:<n> body:<finding>   # one per finding
mcp__github__submit_pending_pull_request_review        … event:"COMMENT" body:<the body below>
```

Every inline comment ends with `identity.commentMarker`. Every finding is anchored to the diff
line it is about; a finding that has no line belongs in the holistic assessment.

**The body, in this order, starting with `review.bodyHeader` as its first line:**

1. **Holistic assessment** — 3–6 lines, always first: does this PR match its ticket's size and
   intent, is it as simple as the problem allows, does it respect the contracts it touches. This
   is the part the reviewer reads; write it as the three sentences that matter.
2. **Findings**, ranked `blocker` / `should-fix` / `consider`, one line each, pointing at its
   inline thread.
3. **What was checked** — the files read, the consumer sides followed, the queries run, with
   enough evidence that a clean verdict is checkable. A clean report that shows no reading is not
   a review. (why: docs/why.md#a-clean-review-report-must-carry-its-evidence)

## Verdicts

- **Findings** → submit the review, then assign the PR to `assignment.bot`
  (`pull_request_write method:update`). A later run's rung 2 treats the unresolved threads as a
  change request — that handoff is the assignment, nothing else.
- **Clean** → submit the review with the body only, no inline comments, and **touch nothing
  else** — no reassignment, no labels. The reviewer sees a checked PR, not a changed one.

## If the pending-review tools do not resolve

Fall back to **one PR issue comment** carrying the identical body, findings referencing
`file:line` in prose. Before writing it, re-check for an existing fallback review by scanning the
PR's issue comments for `review.bodyHeader` — an issue comment is invisible to `get_reviews` and
`reviewed-by:`, so the header is the idempotency key on this path only. Journal that the fallback
was used.

## Hard rules

- **Never modify the branch.** A critic with a keyboard is an author; you have no Edit, no Write,
  and `git` is for reading only.
- **Never `APPROVE` or `REQUEST_CHANGES`**, even where the API would allow it.
- **One review per PR, ever.** If you find any existing own-login review on arrival, stop and
  report that nothing was posted.
- **Starting review threads is this skill's exclusive channel** — but reply threads belong to
  rung 2; do not answer feedback here.
- **Every finding names a file and a line**, or it lives in the holistic assessment as a judgement
  about shape.
- **Do not duplicate the author-side pass.** Style, formatting, naming taste: not yours.
