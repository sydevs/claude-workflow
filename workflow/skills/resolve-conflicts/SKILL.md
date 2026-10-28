---
name: resolve-conflicts
description: Resolve one loop-authored PR, draft or ready, that GitHub reports as conflicting, from both sides' intent, then push and end. Fired only when the branch genuinely no longer merges, once per head. Runnable locally against a PR number.
argument-hint: '[owner/repo#N]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Resolve conflicts

One PR that GitHub reports as `CONFLICTING`. **Start with `/workflow:start-run` and end
with `/workflow:finish-run`.**

**Merge the base branch in only when GitHub reports the PR `CONFLICTING`.** A PR that is merely
behind is not this handler's work.
(why: docs/why.md#every-revision-starts-from-the-current-base)

## Reads

- `mcp__github__pull_request_read method:get` — head branch, base, author, `mergeable`.
  `mergeable: true` → nothing to do. Journal it, and stop.
- The linked ticket's body, for what the PR intends.
- `git log origin/<base> -- <file>` for each conflicted file, for what `main` intends.

## Do

1. Worktree on the PR's existing branch: `git fetch origin <base> <branch>`, then
   `git worktree add .claude/worktrees/<slug> origin/<branch> -B <branch>`, then
   `git merge origin/<base>`.
2. Resolve every hunk from both sides' intent. **Keep both behaviours where both are wanted.**
   Never take one side wholesale to make the merge go away.
3. Lean gate, from `.claude/workflow.json`. Run the specs that cover the conflicted files.
4. Commit the merge. Keep the merge commit — the history is the evidence.
5. `git push`. **Then end.** CI runs on the push, and Actions reads it.

## Say it in a line

One comment, and keep it to what the diff cannot show: which side each hunk took, and why, where
the choice was not obvious. A conflict resolved the only way it could be resolved needs a
sentence, not a section.

**A hunk a reviewer should confirm** — two readings were both defensible — gets a review thread on
that hunk carrying `review.questionMarker`, in format-ticket's options shape, the built choice
first. That thread is the only thing that puts an approved PR back on the person's list; a clean
resolution asks nothing. (why: docs/why.md#a-resolved-conflict-is-not-a-new-question)

**A semantic conflict** — `main` removed what this PR extends, or changed a contract it relies on
— is not yours to guess. Comment the question in format-ticket's options shape, with
`identity.commentMarker`, push nothing, and stop. The dispatcher fires nothing more on this head:
the PR becomes the person's turn until a push. (why: docs/why.md#a-conflicted-draft-is-resolved-too)

**A branch outside `claude/*`** (a member's own branch, Copilot's, `flags.delegated` on one): you
cannot push to it. Comment the resolution as a patch or a description, and stop. A member's PR on a
`claude/*` branch is pushed to like your own.
(why: docs/why.md#you-cannot-push-to-a-humans-pr)

## Hard rules

- **Never merge `main` in unless GitHub reports the PR conflicting.**
- **Never `rebase`, `--force`, or `--force-with-lease`.** A merge commit only.
- **Never squash or rewrite history.**
- **Never mark the PR ready, or wait for CI.** (why: docs/why.md#push-and-end)
- **Never write state** (start-run's list). Touch no label but the lock.
