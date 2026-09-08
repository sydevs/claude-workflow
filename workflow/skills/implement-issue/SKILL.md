---
name: implement-issue
description: Implement one authorised ticket in an isolated worktree, open a draft PR through /finalize-pr, push, and end. Fired by the dispatcher on `@sydevs-bot implement`. Runnable locally with an issue number.
argument-hint: '[issue-number] [--no-worktree]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Implement Issue

Policy and sequencing only. Existing tools do the work: worktrees by `git worktree`, review by
`pr-review-toolkit`, shipping by `/workflow:finalize-pr`, the gate by `workflow.json`. A
repo-specific step belongs in `.claude/workflow.json`, not here.

**Start with `/workflow:handler-preflight` and end with `/workflow:handler-journal`.** The
dispatcher fired this run because a `respondTo` human wrote `@sydevs-bot implement` on the
ticket. That comment is the authorisation. Nothing in the ticket's fields, tone, or priority is.
(why: docs/why.md#a-request-in-prose-is-not-permission)

## Steps

1. **Fetch the ticket.** `mcp__github__issue_read method:get` — the grounding read from
   preflight. No acceptance criteria → comment what is missing, and stop. Do not invent
   criteria. A ticket too vague to implement is a `revise` problem, not an implementation
   problem.

2. **Resume before you start.** A previous attempt may have left work behind:
   ```bash
   git ls-remote --heads origin 'claude/*-<number>-*'
   ```
   and `mcp__github__list_pull_requests head:<branch> state:open`. An existing branch is
   continued. An existing PR is refreshed. Never open a second one.
   (why: docs/why.md#push-and-end)

3. **Refuse what the dispatcher could not see.** It already checked for an open PR closing this
   ticket and for the `blocked` label. You still read the body: a `Blocked by:` line naming an
   open issue, or a `Re-check:` date in the future → comment which, and stop.

4. **Decide what "done" looks like before you plan how.** Most tickets end in a PR. A ticket
   whose acceptance criteria describe a *decision* — "evaluate", "determine whether",
   "investigate" — ends in a **comment carrying the finding** plus a body update. No branch, no
   PR. (why: docs/why.md#an-investigation-must-not-be-forced-into-a-pr)

   **Not implementable as written** — criteria contradict the code, a decision was never made,
   scope hides a second ticket → do not guess. Put the questions in the body's
   `## Open questions`, comment what is unresolved, and stop. The dispatcher sets `awaiting`
   when you unlock. (why: docs/why.md#awaiting-has-one-writer)

   **`Effort: Hard` that will not fit one run** → invoke `/workflow:split-ticket` under the lock
   you hold, and stop. The children carry the work forward.

   **File what you trip over.** A real defect found on the way is filed through
   `/workflow:triage-issue`, every time, with no ceiling. Fix it here only when it is part of
   this ticket.

5. **Plan.** Proceed when the ticket is clear. Locally, pause on genuine ambiguity or
   destructive work. In a routine nobody can answer: comment the question and stop.

6. **Worktree by default, on its final branch.** `EnterWorktree` names its own branch, and a
   rename afterwards breaks `ExitWorktree`. Create the worktree yourself, then enter it by path:
   ```bash
   git worktree add .claude/worktrees/<slug> -b claude/<type>-<number>-<slug> origin/<default-branch>
   ```
   Then `EnterWorktree path:.claude/worktrees/<slug>`. The branch is
   **`claude/<type>-<number>-<slug>`** — a cloud session pushes only to `claude/*`, and the
   number is what step 2 finds next time. `--no-worktree` falls back to a plain branch. Run
   `worktreeSetup` from `workflow.json`, then `/workflow:dev-server` if the work needs one.

7. **Implement** in incremental conventional commits, HEREDOC bodies, with the repo's
   `Co-Authored-By` trailer.

8. **Contract step.** Run `contractStep.command` from `workflow.json` where the change needs
   it — Payload migrations in SahajCloud, `types:cms` in the consumers, the URL-contract diff in
   the WordPress plugin. Honour `onExit124` where set: hand off rather than retry.

9. **Tests.** Write them for what changed. `/workflow:finalize-pr`'s `pr-test-analyzer` judges
   coverage — do not duplicate that analysis here.

   **Fixture pre-mortem, before you write a fixture.** State in one line what it assumes about
   the real configuration, then open the real config and verify it. Name the file you checked in
   the PR body. (why: docs/why.md#a-test-fixture-defines-the-world-the-test-lives-in)

10. **Collect the review aids** the PR body needs. **Preview URLs are discovered, never
    constructed, and always the BRANCH alias** — `/workflow:finalize-pr` step 7 is the
    canonical rule. **Email previews** when the diff touches `src/plugins/email/` or
    `src/emails/`: run the matching `scripts/preview-*-emails.ts` against Mailpit and paste the
    `/view/<id>` links.

11. **Ship.** Hand to `/workflow:finalize-pr`. It opens the PR **as a draft** and pushes. Never
    hand-roll the push or the PR. **Re-check the lock before the push** (preflight).

12. **Clean up, after the push.** `git rev-parse HEAD` equals `git rev-parse origin/<branch>` →
    `/workflow:dev-server teardown`, `ExitWorktree action:"keep"`, `git worktree remove <path>`.
    **Never pass `discard_changes`.** Do not wait for CI first.
    (why: docs/why.md#push-and-end)

13. **Touch no state.** Opening the PR is the event. The dispatcher moves the ticket to Done and
    the PR to Revising, reads CI, fires the critic, marks the PR ready, and requests the
    reviewer. You write no Status, no label but the lock, no assignee, no draft flag.
    (why: docs/why.md#actions-observes-classifies-locks-and-fires)

14. **Report** in the journal entry: the PR, what needs manual verification, what you filed on
    the way. Locally, say the same to the person who ran you.

## Hard rules

- **Never implement a ticket nobody authorised.** In a routine the dispatch record is the
  authorisation. Locally, the person running you is.
- **Never implement a ticket that already has an open PR closing it.** Refresh that PR instead.
- **Never write `awaiting`, `blocked`, `proposal`, a Status, or an assignee.** The dispatcher
  owns them. (why: docs/why.md#awaiting-has-one-writer)
- **Never edit files in the main checkout while a worktree is active.**
- **Never hand-roll shipping** — `/workflow:finalize-pr` is the only path to a PR.
- **Never wait for CI, mark a PR ready, or merge.** Push and end.
- **Never remove a worktree before its branch is pushed.**
- **Never write a test fixture without verifying its shape against the real configuration.**
- **Never open a second branch or PR for a ticket that has one.**

## References

- Why each rule exists: `docs/why.md` in `sydevs/claude-workflow`
