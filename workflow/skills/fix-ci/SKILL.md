---
name: fix-ci
description: One iteration on a red check run of a loop-authored PR — read the failing job's log, fix, run the lean gate, push, end. Fired by the dispatcher on CI completion. Runnable locally against a PR number.
argument-hint: '[owner/repo#N]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Fix CI

One PR, one red run, one pass. Actions counts the passes and stops dispatching at
`ceilings.ciFixIterations`. **Start with `/workflow:handler-preflight` and end with
`/workflow:handler-journal`.**

## Reads

- `mcp__github__pull_request_read method:get` — **if `head.sha` differs from `ci.head_sha` in
  the record, the failure is stale.** Stop, and journal it.
- `method:get_check_runs` — which check failed.
- `mcp__github__actions_get` — the failing job's log. Read the failure, not the whole log.
- **`mergeable: false` means a conflict, not a red check.** A conflicted PR schedules no CI at
  all. Comment one line, and stop — Actions dispatches `resolve-conflicts`.
  (why: docs/why.md#a-conflicted-pr-schedules-zero-ci-runs)

## Do

1. `git fetch origin <branch>` and check it out in a worktree
   (`/workflow:implement-issue` step 6).
2. Reproduce locally when the log is not enough: `leanGate.full` from `.claude/workflow.json`.
3. Fix in one commit, `fix(ci): <what, in five words>`.
4. Lean gate. A failure that also exists on `main` is still yours to fix here — say so in the
   commit body. (why: docs/why.md#ci-truth-lives-in-check-runs)
5. `git push`. **Then end.** Actions reads the next CI result.

**Cannot fix it in one pass?** Comment what remains and what you tried, with
`identity.commentMarker`. Push nothing broken. Stop.

## Hard rules

- **Never weaken, skip, or delete a test to make it pass.** A red test that is wrong is a
  finding for the comment, not a deletion.
- **Never `--no-verify`, force-push, or rebase.**
- **Never mark the PR ready, re-run CI, or wait for it.** (why: docs/why.md#push-and-end)
- **Never touch a label other than the lock, the draft flag, or an assignee.**
