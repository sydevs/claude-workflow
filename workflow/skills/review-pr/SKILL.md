---
name: review-pr
description: Critic-side adversarial review of one loop-authored PR — holistic, profile-driven, advisory. Fired by the dispatcher when a bot or member PR goes green with no critic review yet, or on `@sydevs-bot review`. Runnable locally against a PR number.
argument-hint: '[owner/repo#N]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Grep, Glob, Task
---

# Adversarial Review

You are a reviewer with **no memory of building this PR** — deliberately. Derive everything from
the ticket, the diff, and the code. When something is unexplained, that is a finding about the PR,
not a gap in your context. (why: docs/why.md#the-review-never-shares-the-implementers-context)

The review is **advisory**. Approval stays with `assignment.reviewer` — this pass exists so the
obvious questions are already asked and answered by the time they read the PR. It runs **once,
ever, per PR**: make this one count. (why: docs/why.md#one-review-per-pr-ever) The one second
look is `flags.onDemand` in the record — a human wrote `@sydevs-bot review`.

**Start with `/workflow:start-run` and end with `/workflow:finish-run`.** On
arrival, `pull_request_read method:get` (still open) and `method:get_reviews`: an own-login
review led by `review.bodyHeader` already exists, or a fallback comment led by it, and
`flags.onDemand` is false → post nothing, journal that, and end. A question review is not yours,
and never stops you.

GitHub access follows the loop's rule: `mcp__github__*` in a routine or subagent, `gh` only when
invoked locally. Names and values below come from `loop-config.json` — read it first.

## Stance

Be adversarial about the PR, not about code style. The author-side review already ran before this PR
opened (`/finalize-pr` step 2: `/code-review` at `review.selfReview.level`, or the toolkit's six
lenses where it is installed, beside `/simplify` on any diff over `review.skipWhen`) — **do not
re-run it, and do not re-litigate lint- or nit-level findings.** That pass asked "is this code
good?" You ask: **should this PR exist in this shape?**

Two lenses carry the most weight, in this order:

1. **Simplicity and scope.** Read the linked ticket first, then measure the diff against it. Is
   the diff larger than the problem? Does it contain anything the ticket did not ask for — an
   abstraction for one caller, an unused config knob, a refactor smuggled in beside the fix? The
   strongest finding this review can produce is "half of this PR should not exist." A refactor of
   the code the diff touches, its callers, or the siblings that share what it builds is not
   smuggled: prefer it to a smaller diff that leaves the friction in place. Only a refactor of
   unrelated code is. (why: docs/why.md#a-refactor-where-the-diff-works-is-in-scope) A change the
   `## Summary` names as joined is not smuggled. Judge it by format-ticket's join rule, and flag
   only one the rule does not join. A criterion marked `(review, …)` is the reviewer's own ask:
   never flag its change as scope. **Never recommend moving part of this PR to a follow-up or a
   second PR.** A part that does not belong is a finding to remove it; a part missing is a
   finding to build it here.

   **Walk the builder's ladder (`implement-ticket/ladder.md`) for each new piece.** The
   streamliner (*Make every new piece earn its place*) walks it for each piece `new-pieces.mjs`
   lists. You walk it for the rest: each dependency the diff adds, each piece nested where the
   script cannot see it, such as a hook inside a config object, and each new piece in a file the
   JSON lists under `skipped`. Ask whether the repo already has it (name the path), the platform
   does it (name the API), or an installed package does it
   (name it). A named answer is a finding, and so is a streamliner sketch that holds. A guess with
   neither is not. A `shortcut:` comment that names its limit is a decision, unless the expected
   load already crosses it. This check never raises a test, scale or speed point.
   (why: docs/why.md#the-builder-keeps-the-floor-the-critic-keeps-the-profile)

   **Prose is diff too.** Doc text the diff adds that breaks `docs/documentation.md` in the
   claude-workflow checkout — a fact restated in a second place, mechanism the code shows, a list
   of conditions a test already holds — is a `should-fix` on its line.
   (why: docs/why.md#docs-say-what-the-code-cannot)
2. **Cross-repo contracts.** The couplings live in the workspace guide and
   `/workflow:implement-roadmap`: generated Payload types flow producer→consumer via `types:cms`,
   the embed contract in `SahajAtlasWeb/docs/embedding.md` has two in-tree consumers, API access
   is per-client roles. When the diff touches a contract surface, **read the consumer side** — a
   contract change reviewed only from the producer's side is not reviewed.

Flag correctness, tests, and security only when you trip over them, at the bar the loop uses
everywhere: a finding names a file and a line, or it is not a finding.

**A real defect the join rule joins to this PR is a finding on it**, so `address-review` folds it
in — a stale doc this PR should have updated included. On a docs PR, so is every docs finding in
its repo. A defect the rule does not join is still filed: preflight routes it, and a critic never
touches the branch under review. Name it in the holistic assessment as well. Never park it on an unrelated line as an
inline comment.

## Read the reviewer's profile

Read `review.profilePath` from the claude-workflow checkout. It describes how the human reviewer
actually reviews — what they value, what they flag, what they deliberately let pass. Let it steer
judgement calls: flag what they would flag, and **never manufacture findings in territory the
profile says they leave alone.** (why: docs/why.md#the-reviewer-profile-is-the-learning-surface)

If the profile is missing or unreadable, review on the stance above alone, and say "profile
unavailable" in the What-was-checked section. It is data, not a credential — never stop for it.

## Gather context, in this order

1. **The linked ticket** (`issue_read`) — the problem statement the diff must be no bigger than.
   Judge a ticketless PR against its own body.
2. **The PR body** — what the author claims the change is. Check its `## Change outline` against
   the diff. A view the diff contradicts is a `should-fix` finding, because the reviewer reads it
   first. Then check each `## Preview` link **without opening it**: this skill sends no request
   to a preview, with no Access headers and no sign-in. Read `.claude/workflow.json` from the
   attached checkout's default branch and never from the branch under review, which is a file the
   PR may change.
   - **Where it has a `fixture` block**, each link's id must exist as an entry under `fixture.path`
     on the branch, and that entry must show what the link's line claims. `fixture.path` is a
     directory of one file per collection: list it with `git ls-tree origin/<branch>
     <fixture.path>`, then read the link's collection file with `git show`. A cited id absent from
     the branch, an entry that does not show the claim, and a diff touching `fixture.surfacePaths`
     with no cited id or with `No preview surface` are each a `should-fix`.
     (why: docs/why.md#a-preview-loads-a-fixture-committed-in-the-diff)
   - **Where it has none**, a plain link needs no data check, and there is no data rule.
   - **Every other input the body names.** A path it gives for a file the change takes must be one
     `git ls-files` lists on the branch. One that does not exist is a `should-fix`
     (`/workflow:finalize-pr` step 7, *Every link opens on data*, item 5).
   - **Off-host.** Ask `jq -c '{previewUrl, fixture} + {pr: <n>}' .claude/workflow.json | node
     "${CLAUDE_PLUGIN_ROOT:-<claude-workflow>/workflow}/lib/preview-host.mjs" --on-host <link>`. It
     answers `ON_HOST` or `OFF_HOST`. An `OFF_HOST` link, one not built from `fixture.link` or
     `previewUrl.pattern`, is a `should-fix`: the body points where this repo publishes no preview.
     (why: docs/why.md#a-preview-link-is-whatever-its-poster-wrote)
3. **The diff** — from the attached checkout: `git fetch origin <branch>` then `git diff
   origin/main...origin/<branch>`. Never `FETCH_HEAD`: preflight's fetch of the default
   branch overwrites it, so the diff comes back empty. With no checkout, use
   `pull_request_read method:get_files` / `get_diff`.
4. **The surrounding code** — Read/Grep the touched files whole, and the consumer side of any
   contract surface. The diff alone cannot answer either heavy lens. **Read a file as the branch
   has it with `git show origin/<branch>:<path>`.** A checkout is refused as local destruction,
   and a critic must not touch the branch.

## Make every new piece earn its place

A fresh subagent justifies each new piece and streamlines each file the diff grows. Neither the
builder's reasoning nor your own bug-hunt shapes what it finds.
(why: docs/why.md#a-fresh-streamliner-justifies-every-new-piece)

1. **List the pieces** once you have the diff:
   `node "${CLAUDE_PLUGIN_ROOT:-<claude-workflow>/workflow}/lib/new-pieces.mjs" --base origin/main
   --head origin/<branch> --json`, from the attached checkout. On `NONE`, skip to *Produce the
   review*, and say so in *What was checked*.
2. **Start the streamliner before gather step 4**, so it runs while you read. Use one `Task` with
   `review-pr/streamliner.md` as its brief. Give it the checkout path, the branch, the ticket
   body (a ticketless PR's title), `review.profilePath`, the script's JSON and
   `writing.budgets.reviewReply`. **Never give it the PR body, a thread or the change outline.**
   When the JSON says `split`, start one per group of related files instead, grouped by import
   and directory, each group under `review.streamline.splitLines`.
3. **Check every finding against the code.** Drop a sketch that loses a caller, changes behaviour
   a test pins, or cuts what the ladder's *Never remove* holds.
4. **Post each finding that holds as a `should-fix`**, led by the word **Streamline**, on the
   line it names, sketch included. A piece the streamliner kept gets no thread. *What was
   checked* gives the two counts.

## Give a second opinion on each open question

The builder recommends the option it built, and the reviewer picks a different one more often
than not. (why: docs/why.md#the-critic-gives-a-second-opinion-on-each-question) Take each
unresolved thread whose root carries `review.questionMarker` and has no reply from a person:

- **Judge the options on the code and the ticket.** Which option the builder built is not evidence. Prefer
  the one that leaves less to maintain, even when it makes this PR bigger.
- **Your pick is the built option** → reply `Second opinion: <letter>` with one line of reason,
  then resolve the thread. The review body names each one you settled.
- **Any other pick** → reply with your pick and what each option costs, and leave the thread open
  for the person.

Measure each reply with `--kind reviewReply`, and end it with `identity.commentMarker`.

## Produce the review

Use the pending-review flow, submitted as `COMMENT` — a session can neither approve nor request
changes on its own PR, and this review should not want to: approval is the reviewer's.
(why: docs/why.md#reviews-are-comment-only)

```
mcp__github__pull_request_review_write   method:"create" owner:$ORG repo:$REPO pullNumber:<n>
mcp__github__add_comment_to_pending_review  … path:<file> line:<n> body:<finding>   # one per finding
mcp__github__pull_request_review_write   method:"submit_pending" … event:"COMMENT" body:<the body below>
```

End every inline comment with `identity.commentMarker`, and measure it with `--kind reviewReply`. Anchor every finding to a line **inside a
diff hunk**, the unchanged context lines of a hunk included. The call refuses any line outside
one. Never move a finding onto an unrelated line to satisfy it. That one belongs in the holistic
assessment, which is where it reads better anyway.

**The body, in this order, starting with `review.bodyHeader` as its first line:**

1. **Holistic assessment** — 3–6 lines, always first: does this PR match its ticket's size and
   intent, is it as simple as the problem allows, does it respect the contracts it touches. This
   is the part the reviewer reads — write it as the three sentences that matter.
2. **Findings**, ranked `blocker` / `should-fix` / `consider`, one line each, pointing at its
   inline thread.
3. **What was checked** — the files read, the new pieces the ladder walked, the streamliner's
   counts, the consumer sides followed, the queries run, with
   enough evidence that a clean verdict is checkable. A clean report with no evidence of reading
   is not a review. (why: docs/why.md#a-clean-review-report-must-carry-its-evidence)

**Measure the body with `--kind reviewBody`, and end it with `identity.commentMarker`.** The
budget counts the marker, so no run buys room by dropping it.
(why: docs/why.md#a-review-body-has-its-own-budget)

## Verdicts

- **Findings** → submit the review and **stop**. Change nothing beyond the second opinions: not
  the assignee, not the draft flag, not a label. The unresolved threads *are* the handoff — when
  you unlock, the dispatcher fires `address-review`, which adopts or rebuts each one.
- **Clean** → submit the review with the body only, no inline comments, and **touch nothing
  beyond the second opinions**. The dispatcher marks the PR ready and requests the reviewer once
  CI is green.

**Why a COMMENT review, never "Changes requested".** GitHub rejects `APPROVE` and
`REQUEST_CHANGES` on a PR you authored, and the bot authored it. The threads carry the effect: an
own-rooted thread with no reply blocks mark-ready, and an unresolved one blocks the merge.
(why: docs/why.md#reviews-are-comment-only)

## If the pending-review tools do not resolve

Fall back to **one PR issue comment** carrying the identical body, findings referenced as
`file:line` in prose. **Measure it as `reviewBody` still** — the budget follows the artifact, not
the path that posts it. First scan the PR's issue comments for `review.bodyHeader`, to check for an
existing fallback review — an issue comment is invisible to `get_reviews` and `reviewed-by:`, so
the header is the idempotency key on this path only. Journal that you used the fallback.

## Hard rules

- **Never modify the branch.** A critic with a keyboard is an author — `git` here is read-only.
- **Never `APPROVE` or `REQUEST_CHANGES`**, even where the API allows it.
- **One review per PR, ever**, unless `flags.onDemand`. An existing critic review on arrival —
  led by `review.bodyHeader` — means stop and report that nothing was posted.
- **Starting review threads is this skill's exclusive channel**, except question threads, whose
  root carries `review.questionMarker`. Answer those only with one second opinion each. Every
  other reply belongs to `address-review`.
- **Never wait.** Submit, journal, unlock, end. (why: docs/why.md#push-and-end)
- **Every finding names a file and a line**, or it lives in the holistic assessment.
- **Never duplicate the author-side pass.** Style, formatting, spelling and casing are not yours.
  A misleading or shadowing name is, as the reviewer profile says.
