---
name: implement-issue
description: Implement an approved GitHub issue end-to-end in an isolated worktree, then ship it via /finalize-pr. Gated on the `Stage: Implement` field; collects preview and email-preview links for the PR. User-invoked only — does not run unless explicitly triggered.
argument-hint: '[issue-number] [--no-worktree]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Implement Issue

Policy and sequencing only. The work itself is done by tools that already exist: worktrees by
`EnterWorktree`, review by `pr-review-toolkit`, shipping by `/finalize-pr`, the gate by
`workflow.json`. If you find yourself writing repo-specific steps here, they belong in
`.claude/workflow.json` instead.

## Trigger-agnostic

Runs from a local session **and** from a GitHub event via `claude-code-action` (an `@claude`
mention or a labelled issue). Assume no TTY, no dev server, no `.env.local`, and nobody available
to answer. Set `NONINTERACTIVE=1` when `$GITHUB_ACTIONS` is present, and take the non-interactive
branch at every decision point below rather than stalling.

## Steps

1. **Clean tree.** Stop if there are uncommitted changes that are not ours.

2. **Fetch the issue.** `mcp__github__issue_read  method:get`. If it has no acceptance
   criteria, ask (locally) or comment on the issue and stop (non-interactively). Do not invent
   criteria — an issue too vague to implement is a `/draft-ticket` problem, not an implementation
   problem.

3. **Apply the gates — all four.** Ticket work needs every one of these. Check them before starting,
   not after.

   | Gate | Pass | Fail |
   | --- | --- | --- |
   | **Assigned to the bot** | `assignment.bot` is among the assignees | Not our turn — stop |
   | **`Stage: Implement`** | The field says `Implement` | Investigate and reply instead; do not write code |
   | **No live `Hold Until`** | Absent, or already past | Stop — it comes back on that date |
   | **No open blockers** | Every `Blocked by:` target is closed | Stop, and name the blocker |
   | **No open PR already closing it** | Nothing in flight | Stop — the PR carries the baton, not the ticket |

   None of the last three is visible through assignment, which is exactly why they are listed
   separately. **Never write `Stage: Implement` yourself.** You *may* move a ticket off it — see
   step 4. (why: docs/why.md#the-loop-may-never-write-implement,
   docs/why.md#assignment-alone-is-not-the-implementation-gate)

   `prAllowlistGlobs` in `.claude/workflow.json` gates the **ticketless** paths — dependency bumps,
   reflection config PRs, and **every change in `claude-workflow`, where the glob is `**`**. A
   ticketless change has no issue to carry a label or an assignee, so this whole table is skipped:
   branch, change, and hand to `/finalize-pr`, whose PR body carries the reasoning a ticket would
   have. `wipCapPerRepo` still applies, and merging still needs an approving review.

   **Blockers.** Locally the Relationships are authoritative:
   ```bash
   gh api repos/$ORG/$REPO/issues/<n>/dependencies/blocked_by \
     --jq '[.[] | select(.state == "open")] | length'
   ```
   **When a blocker turns out to be closed, strike the line in the body** — see `/workflow:work-routine`.
   Leaving it live makes every future run re-derive the same answer and reads as a blocker to anyone
   who does not.

   **From a cloud run** no MCP tool exposes them, so read the `Blocked by:` line(s) in the body and
   resolve each with `issue_read`.

   **Open PR already closing it.** A ticket whose PR is open is already in flight; implementing it
   again produces a duplicate PR against the same acceptance criteria:
   ```
   mcp__github__search_issues  query:"repo:$ORG/$REPO is:pr is:open linked:issue"
   ```
   or resolve directly with the GraphQL `closingIssuesReferences` on each open PR.

4. **Decide what "done" looks like before planning how.** Most tickets end in a PR. A ticket whose
   acceptance criteria describe a *decision* rather than a behaviour change — "evaluate", "determine
   whether", "investigate" — ends in a **comment on the ticket** carrying the finding, plus a body
   update recording it. No branch, no PR, and skip to the report step.

   An empty PR opened to satisfy the pipeline's shape costs a review slot and hides the answer in a
   description. The pipeline serves the work, not the reverse.

   **If the ticket turns out not to be implementable as written** — the criteria contradict the code,
   a decision was never made, the scope hides a second ticket — then **revoke rather than guess**:

   1. Set `Stage: Revising`. This is one of your four judgement writes — a revocation, which only
      ever reduces the loop's own autonomy.
   2. Comment saying precisely what is unresolved. A field that changes without explanation reads
      as a malfunction. Your comment is also what the state machine cannot infer, so add
      `labels.awaiting` here yourself.
   3. Add the questions to the ticket body's `## Open questions` list, which is the canonical record.
   4. Stop. **Leave assignment alone** — the ticket stays the bot's, and your comment being the last
      word is why you add `labels.awaiting` here — no event will.

   **File what you trip over.** Implementation is where real defects surface — a failing test that
   exposes a pre-existing gap, a shortcut that turns out to be actively wrong. **File it and keep going** — when a routine files it the state machine sets
   `Stage: Proposed` and `labels.awaiting`; locally, set both yourself, since no bot event fires. Do not ask permission, and do not let `maxOpenProposals` stop you:
   that ceiling governs proposals a survey went looking for, not evidence you already hold. Do not
   fix it here either, unless it is genuinely part of this ticket — say what is wrong, what it costs
   and what to do, then carry on with the work you were sent to do.

   Revoking only ever *reduces* the loop's own autonomy, so it is always safe. Guessing at an
   ambiguous criterion and shipping it is not.

5. **Plan.** Auto-proceed when the ticket is clear. Pause only on missing criteria, genuine
   ambiguity, deviation from the ticket, or destructive work.

6. **Worktree by default.** `EnterWorktree`, branch named **`claude/<type>-<slug>`** — cloud
   sessions can only push to `claude/*`, so the prefix is required for a routine run and harmless
   locally. `--no-worktree` falls back to a plain branch. Run `worktreeSetup` from
   `workflow.json`, then start the dev server with `/dev-server` if the work needs one — it is
   worktree-scoped, so it picks its own port and database.

7. **Implement** in incremental conventional commits, HEREDOC bodies, with the repo's
   `Co-Authored-By` trailer.

8. **Contract step.** Run `contractStep.command` from `workflow.json` if the change requires it —
   Payload migrations in SahajCloud, `types:cms` in the consumers, the URL-contract diff in the
   WordPress plugin. Honour `onExit124` where set: hand off rather than retrying.

9. **Tests.** Write them for what changed. Coverage adequacy is judged in `/finalize-pr` by
   `pr-test-analyzer`, so do not duplicate that analysis here.

   **Fixture pre-mortem — before you write a test fixture, not after.** State in **one line** what
   the fixture assumes about the real configuration, then **open the real config and verify that
   assumption.** Name the file and the path you checked, in the PR body or the commit message.

   A fixture defines the world its tests live in, so a wrong fixture cannot be caught by adding more
   tests — every assertion in the file is evaluated against it, and they all pass.
   (why: docs/why.md#a-test-fixture-defines-the-world-the-test-lives-in)

10. **Collect the review aids** the PR body needs, so the reviewer does not have to reproduce the
   change to see it.

   **Preview URLs are discovered, never constructed, and always the BRANCH alias** — a per-commit
   alias goes stale on your next push and the reviewer cannot tell:
   ```bash
   ${CLAUDE_PLUGIN_ROOT}/skills/finalize-pr/branch-preview-url.mjs   # Cloudflare: SahajAtlasWeb / WeMeditateWeb
   pnpm tsx scripts/get-railway-preview-url.ts                       # SahajCloud — per-PR host, already stable
   ```
   `scripts/get-cloudflare-preview-url.mjs` is the CI smoke gate's tool and prefers commit-pinned
   aliases by design — not for the body.
   (why: docs/why.md#link-the-branch-alias-never-a-commit-alias)

   Deep-link to the routes actually changed, not just the root. A preview appears minutes after the
   push, so run this after `finalize-pr` has pushed, and refresh the body once it resolves.

   **Email previews** when the diff touches `src/plugins/email/` or `src/emails/`: run the matching
   `scripts/preview-*-emails.ts` against Mailpit and paste the `/view/<id>` links. They stay live
   for 7 days, which is what makes them worth putting in a PR at all.

11. **Ship.** Hand to `/finalize-pr`. Never hand-roll the push, the PR, or the CI loop.

12. **Clean up.** `ExitWorktree` only after the PR is open, CI is green, and
    `git rev-parse HEAD` equals `git rev-parse origin/<branch>`. Tear down the worktree's dev server
    and database first: `/dev-server teardown`.

13. **Do not close the ticket out — the state machine already did.** Opening the PR fired
    `pull_request: opened`, which set `Stage: Implemented` and unassigned the bot within seconds.
    Write neither. Touch no assignee and no `Stage` here at all.

    If the work is genuinely not finished — blocked on another ticket, or out of budget — then no
    PR exists, nothing fired, and the ticket is still yours: say so in the journal. That is the
    next run's queue, not a fault.

14. **Report.** PR link, CI status, worktree removed, how to continue locally, and what needs
    manual verification.

## Hard rules

- **Never** implement a ticket that is not assigned to the bot, or that is not `Stage: Implement`,
  or that has a live `Hold Until`.
- **Never** write `Stage: Implement` yourself. Moving a ticket off it is allowed; onto it never is.
- **Never** write an assignee, a `Stage` or `labels.awaiting` outside the revocation in step 4.
  The state machine owns the rest and is immediate; you would only race it.
- **Never** implement a ticket that already has an open PR closing it.
- **Never** edit files in the main checkout while a worktree is active.
- **Never** hand-roll shipping — `/finalize-pr` is the only path to a PR.
- **Never** remove a worktree before its branch is pushed and green.
- **Never** write a test fixture without verifying its shape against the real configuration.

## References

- Why each rule exists: `docs/why.md` in `sydevs/claude-workflow`
