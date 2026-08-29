---
name: implement-issue
description: Implement an approved GitHub issue end-to-end in an isolated worktree, then ship it via /finalize-pr. Gated on the `approved` label; collects preview and email-preview links for the PR. User-invoked only — does not run unless explicitly triggered.
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

3. **Apply the autonomy gate.** For ticket work the gate is the **`approved` label**, applied by
   the user and by nobody else.

   - **`approved` present, no `hold`, no open blockers** → implement, open a PR.
   - **Not approved** → do not implement. This is not a failure: it is the queue working. Say so
     and stop.
   - `prAllowlistGlobs` in `.claude/workflow.json` still gates the **ticketless** paths — dependency
     bumps, reflection config PRs — which have no issue to carry a label.

   Check blockers before starting, not after. **Locally** the Relationships are authoritative:
   ```bash
   gh api repos/$ORG/$REPO/issues/<n>/dependencies/blocked_by \
     --jq '[.[] | select(.state == "open")] | length'
   ```
   **From a cloud run** no MCP tool exposes them, so read the `Blocked by:` line(s) in the body and
   resolve each with `issue_read`. Either way: an open blocker → stop, and say which issue blocks it.

4. **Decide what "done" looks like before planning how.** Most tickets end in a PR. A ticket whose
   acceptance criteria describe a *decision* rather than a behaviour change — "evaluate", "determine
   whether", "investigate" — ends in a **comment on the ticket** carrying the finding, plus a body
   update recording it. No branch, no PR, and skip to the report step.

   An empty PR opened to satisfy the pipeline's shape costs a review slot and hides the answer in a
   description. The pipeline serves the work, not the reverse.

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

10. **Collect the review aids** the PR body needs, so the reviewer does not have to reproduce the
   change to see it.

   **Preview URLs are discovered, never constructed.** Each repo already has a script that knows
   where to look, and CI uses the same ones:
   ```bash
   pnpm tsx scripts/get-railway-preview-url.ts        # SahajCloud — reads the Railway commit status
   node scripts/get-cloudflare-preview-url.mjs        # WeMeditateWeb / SahajAtlasWeb — reads the CF bot comment
   ```
   Deep-link to the routes actually changed, not just the root. A preview appears minutes after the
   push, so run this after `finalize-pr` has pushed, and refresh the body once it resolves.

   **Email previews** when the diff touches `src/plugins/email/` or `src/emails/`: run the matching
   `scripts/preview-*-emails.ts` against Mailpit and paste the `/view/<id>` links. They stay live
   for 7 days, which is what makes them worth putting in a PR at all.

11. **Ship.** Hand to `/finalize-pr`. Never hand-roll the push, the PR, or the CI loop.

12. **Clean up.** `ExitWorktree` only after the PR is open, CI is green, and
    `git rev-parse HEAD` equals `git rev-parse origin/<branch>`. Tear down the worktree's dev server
    and database first: `/dev-server teardown`.

13. **Report.** PR link, CI status, worktree removed, how to continue locally, and what needs
    manual verification.

## Hard rules

- **Never** implement a ticket without the `approved` label, and **never** apply that label yourself.
- **Never** edit files in the main checkout while a worktree is active.
- **Never** hand-roll shipping — `/finalize-pr` is the only path to a PR.
- **Never** remove a worktree before its branch is pushed and green.
