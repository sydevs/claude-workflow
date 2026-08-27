---
name: implement-issue
description: Implement a GitHub issue end-to-end in an isolated worktree, then ship it via /finalize-pr. Applies the repo's autonomy gate to decide between a draft PR and filing findings back to the issue. User-invoked only — does not run unless explicitly triggered.
argument-hint: '[issue-number] [--no-worktree] [--draft]'
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

2. **Fetch the issue.** `gh issue view <n> --json title,body,labels`. If it has no acceptance
   criteria, ask (locally) or comment on the issue and stop (non-interactively). Do not invent
   criteria — an issue too vague to implement is a `/draft-ticket` problem, not an implementation
   problem.

3. **Apply the autonomy gate.** Compare the issue's expected file surface against
   `prAllowlistGlobs` in `.claude/workflow.json`.

   - **Every path inside the allowlist** → implement and open a **draft PR**. These are the changes
     whose review is mechanical: dependency bumps, lint and format sweeps, `types:cms` re-sync,
     test-only additions, documentation corrections.
   - **Anything outside it** → do not implement. Post the implementation plan as an issue comment,
     say why it is gated, and stop. Contract surfaces, access control, migrations and the widget's
     public API are reviewed by a human before code exists, not after.
   - `--draft` forces the draft-PR path for a gated issue. Local invocation only; it is ignored
     when `NONINTERACTIVE=1`, so a runner can never self-authorize past the gate.

4. **Plan.** Auto-proceed when the ticket is clear. Pause only on missing criteria, genuine
   ambiguity, deviation from the ticket, or destructive work.

5. **Worktree by default.** `EnterWorktree`, branch named `<type>/<slug>`. `--no-worktree` falls
   back to a plain branch. Run `worktreeSetup` from `workflow.json`, then start the dev server with
   `/dev-server` if the work needs one — it is worktree-scoped, so it will pick its own port and
   database.

6. **Implement** in incremental conventional commits, HEREDOC bodies, with the repo's
   `Co-Authored-By` trailer.

7. **Contract step.** Run `contractStep.command` from `workflow.json` if the change requires it —
   Payload migrations in SahajCloud, `types:cms` in the consumers, the URL-contract diff in the
   WordPress plugin. Honour `onExit124` where set: hand off rather than retrying.

8. **Tests.** Write them for what changed. Coverage adequacy is judged in `/finalize-pr` by
   `pr-test-analyzer`, so do not duplicate that analysis here.

9. **Ship.** Hand to `/finalize-pr`. Never hand-roll the push, the PR, or the CI loop.

10. **Clean up.** `ExitWorktree` only after the PR is open, CI is green, and
    `git rev-parse HEAD` equals `git rev-parse origin/<branch>`. Tear down the worktree's dev server
    and database first: `/dev-server teardown`.

11. **Report.** PR link, CI status, worktree removed, how to continue locally, and what needs
    manual verification.

## Hard rules

- **Never** implement past the autonomy gate without an explicit local `--draft`.
- **Never** edit files in the main checkout while a worktree is active.
- **Never** hand-roll shipping — `/finalize-pr` is the only path to a PR.
- **Never** remove a worktree before its branch is pushed and green.
