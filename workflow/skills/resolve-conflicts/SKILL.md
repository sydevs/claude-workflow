---
name: resolve-conflicts
description: Resolve one loop-authored PR that GitHub reports as conflicting, from both sides' intent, then push and end. Fired only when the branch genuinely no longer merges. Runnable locally against a PR number.
argument-hint: '[owner/repo#N]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Resolve conflicts

One PR that GitHub reports as `CONFLICTING`. **Start with `/workflow:handler-preflight` and end
with `/workflow:handler-journal`.**

**Never merge the base branch in to keep a PR fresh.** The merge queue rebases every PR against
`main` before it lands, so a PR that is merely behind needs nothing. Acting anyway is what
produced three separate conflict essays on one PR in twenty-five minutes.
(why: docs/why.md#the-queue-owns-staleness-you-own-conflicts)

## Reads

- `mcp__github__pull_request_read method:get` — head branch, base, author, `mergeable`.
  `mergeable: true` → nothing to do. Journal it, and stop.
- The linked ticket's body, for what the PR intends.
- `git log origin/<base> -- <file>` for each conflicted file, for what `main` intends.

## Do

1. Worktree on the PR branch (`/workflow:implement-issue` step 6):
   `git fetch origin <base> <branch>`, then `git merge origin/<base>`.
2. Resolve every hunk from both sides' intent. **Keep both behaviours where both are wanted.**
   Never take one side wholesale to make the merge go away.
3. Lean gate, from `.claude/workflow.json`. Run the specs that cover the conflicted files.
4. Commit the merge. Keep the merge commit — the history is the evidence.
5. `git push`. **Then end.** CI runs on the push, and Actions reads it.

## Say it in a line

One comment, and keep it to what the diff cannot show: which side each hunk took, and why, where
the choice was not obvious. A conflict resolved the only way it could be resolved needs a
sentence, not a section. (why: docs/why.md#the-queue-owns-staleness-you-own-conflicts)

**A semantic conflict** — `main` removed what this PR extends, or changed a contract it relies on
— is not yours to guess. Comment the question with `identity.commentMarker`, push nothing, and
stop.

**A human's PR** (`flags.delegated`, or the author is not the own login): you cannot push to it.
Comment the resolution as a patch or a description, and stop.
(why: docs/why.md#you-cannot-push-to-a-humans-pr)

## Hard rules

- **Never merge `main` in unless GitHub reports the PR conflicting.** Being behind is the
  queue's problem, not yours.
- **Never `rebase`, `--force`, or `--force-with-lease`.** A merge commit only.
- **Never squash or rewrite history.**
- **Never mark the PR ready, or wait for CI.** (why: docs/why.md#push-and-end)
- **Never touch a label other than the lock, the draft flag, or an assignee.**
