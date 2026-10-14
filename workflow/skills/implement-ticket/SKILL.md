---
name: implement-ticket
description: Implement one authorised ticket in an isolated worktree, open a draft PR through /finalize-pr, push, and end. Fired by the dispatcher on `@sydevs-bot implement`. Runnable locally with an issue number.
argument-hint: '[issue-number] [--no-worktree]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Implement Issue

Policy and sequencing only. Existing tools do the work: worktrees by `git worktree`, review by
`/code-review` (`pr-review-toolkit` where installed), shipping by `/workflow:finalize-pr`, the gate by `workflow.json`. A
repo-specific step belongs in `.claude/workflow.json`, not here.

**Start with `/workflow:start-run` and end with `/workflow:finish-run`.** The
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

   **A draft PR whose `## Phases` has an unticked box is your plan.** The dispatcher fired you to
   continue it. Read the branch diff first, then work from the first unticked phase. Never
   re-plan a ticked phase.

3. **Refuse what the dispatcher could not see.** It already checked for an open PR closing this
   ticket, the `blocked` label and the open native blockers. You still read the body: a
   `Blocked by:` line it has not converted yet that names an open issue, or a `Re-check:` date in
   the future → comment which, and stop.

4. **Decide what "done" looks like before you plan how.** Most tickets end in a PR. A ticket
   whose acceptance criteria describe a *decision* — "evaluate", "determine whether",
   "investigate" — ends in a **comment carrying the finding** plus a body update. No branch, no
   PR. (why: docs/why.md#an-investigation-must-not-be-forced-into-a-pr)

   **Not implementable as written** — criteria contradict the code, or a decision was never made
   → do not guess. Settle every fact yourself. A decision goes in `## Open questions` with options
   and a recommendation — on the roadmap parent when `## Goal context` links one, following
   `write-ticket`'s Escalate steps. Comment what is unresolved, and stop. The dispatcher sets
   `awaiting` when you unlock — on the ticket, or on its roadmap parent when you escalated.
   (why: docs/why.md#awaiting-has-one-writer, docs/why.md#a-late-decision-goes-to-the-goal)

   **A decision only part of the work turns on does not stop the build.** Build the recommended
   option, and ask the decision as a question thread (`/workflow:finalize-pr` step 7c).

   **A ticket that will not fit one run is built in phases, on this one branch and one PR.**
   Never split it into child tickets or several PRs here: splitting is planning, done before
   approval by `implement-roadmap` at reviewability seams, never by a build run on size. Order the
   phases so each leaves the branch green and the next builds on it — schema before endpoint
   before UI. A ticket that carries `## Phases` is your plan: copy it, and change only what the
   code disproves. Write them as the `## Phases` checklist in the PR body (`pr-template.md`). A
   ticket that fits one run has no phases.
   (why: docs/why.md#a-ticket-is-built-in-phases-never-split, docs/why.md#split-at-reviewability-seams)

   **File what you trip over**, as preflight's incidental-finding rule routes it. A finding the
   join rule joins to this ticket is this PR's, listed or not: fold it in, with its own
   `## Summary` bullet. On a docs ticket, so is every docs finding in the repo.
   (why: docs/why.md#the-work-you-hold-takes-what-joins-it)

5. **Plan.** Proceed when the ticket is clear. Locally, pause on genuine ambiguity or
   destructive work. In a routine nobody can answer, a decision goes as step 4 says.

6. **Worktree by default, on its final branch.** `EnterWorktree` names its own branch, and a
   rename afterwards breaks `ExitWorktree`. Create the worktree yourself, then enter it by path:
   ```bash
   git worktree add .claude/worktrees/<slug> -b claude/<type>-<number>-<slug> origin/<default-branch>
   ```
   Then `EnterWorktree path:.claude/worktrees/<slug>`. The branch is
   **`claude/<type>-<number>-<slug>`** — a cloud session pushes only to `claude/*`, and the
   number is what step 2 finds next time. `--no-worktree` falls back to a plain branch. Set the
   checkout up as preflight says, then `/workflow:dev-server` if the work needs one.

7. **Implement** in incremental conventional commits, HEREDOC bodies, with the repo's
   `Co-Authored-By` trailer.

   **In phases, close each one before the next:** the lean gate, then `/code-review high` and
   `/simplify` over that phase's commits, triaged as `/workflow:finalize-pr` step 2 says. Then
   tick its box. Skip this for the phase that ends the session, because step 11 reviews the
   whole branch.

   **Before you open a phase, check the record's `deadline`.** If the phase and step 11 will not
   both fit, ship what is ticked and end. The dispatcher starts the next session once CI is
   green. **Every session ends with at least one more box ticked.** A phase too big for one
   session is split into smaller boxes, and you tick the part you finished. A session that ticks
   nothing stalls the PR, and it becomes the reviewer's turn — so when a decision stops you, ask
   it as a question thread (`/workflow:finalize-pr` step 7c) and end.

8. **Contract step.** Run `contractStep.command` from `workflow.json` where the change needs
   it — Payload migrations in SahajCloud, `types:cms` in the consumers, the URL-contract diff in
   the WordPress plugin. Honour `onExit124` where set: hand off rather than retry.

9. **Tests.** Write them for what changed, and own the coverage check: every changed behaviour has
   a test that fails without it. Watch each one fail before you keep it. No routine has
   `pr-test-analyzer` (`/workflow:finalize-pr` step 2), so nothing after you checks this.

   **Fixture pre-mortem, before you write a fixture.** State in one line what it assumes about
   the real configuration, then open the real config and verify it. Name the file you checked in
   the PR body. (why: docs/why.md#a-test-fixture-defines-the-world-the-test-lives-in)

10. **Collect the review aids** the PR body needs. **A preview host keyed on the pull request number is
    constructed; one keyed on a branch slug is discovered** — `/workflow:finalize-pr` step 7
    is the canonical rule. Either way, link the pages a reviewer should open, not the root, and
    make sure each one opens on data (*Every link opens on data*). **Email previews** when the
    diff touches `src/plugins/email/` or `src/emails/`: run the matching `scripts/preview-*-emails.ts` against Mailpit and paste the
    `/view/<id>` links.

11. **Ship.** Hand to `/workflow:finalize-pr`. It opens the PR **as a draft** and pushes. Never
    hand-roll the push or the PR. **Re-check the lock before the push** (preflight).

12. **Clean up, after the push.** `git rev-parse HEAD` equals `git rev-parse origin/<branch>` →
    `/workflow:dev-server teardown`, `ExitWorktree action:"keep"`, `git worktree remove <path>`.
    **Never pass `discard_changes`.** Do not wait for CI first.
    (why: docs/why.md#push-and-end)

13. **Touch no state.** Opening the PR is the event. The dispatcher moves the ticket to Done and
    the PR to Revising, reads CI, starts the next phase or fires the critic, marks the PR ready,
    and requests the reviewer. You write no Status, no label but the lock, no assignee, no draft flag.
    (why: docs/why.md#actions-observes-classifies-locks-and-fires)

14. **Report** in the journal entry: the PR, what needs manual verification, what you filed on
    the way. Locally, say the same to the person who ran you.

## Hard rules

- **Never implement a ticket nobody authorised.** In a routine the dispatch record is the
  authorisation. Locally, the person running you is.
- **Never implement a ticket that already has an open PR closing it.** Refresh that PR instead.
- **Never write state** (start-run's list). The dispatcher owns it.
- **Never edit files in the main checkout while a worktree is active.**
- **Never hand-roll shipping** — `/workflow:finalize-pr` is the only path to a PR.
- **Never wait for CI, mark a PR ready, or merge.** Push and end.
- **Never remove a worktree before its branch is pushed.**
- **Never write a test fixture without verifying its shape against the real configuration.**
- **Never open a second branch or PR for a ticket that has one.** A docs- or test-only finding
  the join rule does not join is not a second PR for it: preflight routes it.
- **Never split a ticket** into child tickets or several PRs. A big ticket is built in phases.
- **Never resolve a product decision yourself.** It goes to `## Open questions` with options, or
  to a question thread with the recommended option built (step 4).

## References

- Why each rule exists: `docs/why.md` in `sydevs/claude-workflow`
