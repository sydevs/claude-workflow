---
name: cleanup
description: End-of-session cleanup for a local session. Stops the dev and Ladle servers this session started, removes its worktrees, local branches and dev databases once their work is safely pushed, prunes what older sessions left behind, and reports what is still outstanding — unpushed or uncommitted work, PRs that need you, follow-up tickets discussed but never filed, and cross-repo steps still owed. Touches nothing a running session uses, and never deletes a branch on GitHub. User-invoked only.
disable-model-invocation: true
allowed-tools: Bash(node *skills/cleanup/cleanup.mjs*), Bash(git fetch:*), Bash(git -C:*), Bash(gh pr list:*), Bash(gh api graphql:*), Bash(jq -c .contractSync*), Bash(gh search issues:*), Bash(gh search prs:*), Read, TaskStop, CronList, CronDelete, AskUserQuestion, mcp__playwright__browser_close
---

# Cleanup

Run at the end of a session, when the user believes they are done. Leave nothing of this session
running or on disk that it no longer needs, and tell the user everything they still have to do.
**A missed warning costs more than a leftover worktree.** When in doubt, keep the thing and report
it.

`cleanup.mjs` below is `${CLAUDE_PLUGIN_ROOT:-<claude-workflow>/workflow}/skills/cleanup/cleanup.mjs`.
Spell the full path in every command: shell variables do not survive between commands. **Stop
and delete only through the script, never by hand.** It decides what belongs to this session and
what a live session claims, and re-checks both as it acts.
(why: docs/why.md#cleanup-touches-only-its-own-session)

Ask every question with `AskUserQuestion`, recommended option first.

## 1. Is any work still in progress?

Before anything is stopped, review what this session still has running: background Bash tasks,
Monitors, `CronList` jobs and `/loop`s, subagents and workflows, and the Playwright browser.

- **No longer needed** — finished, or its result was already used: stop it (`TaskStop`,
  `CronDelete`, `mcp__playwright__browser_close`).
- **Still in progress** — a build or test still running, an agent still working, a loop or
  `/steward` still watching an open PR, a deploy still rolling out: **stop the cleanup here.**
  Tell the user what is still running and why it looks live, and ask: wait for it, clean up
  around it (leave it running), or stop it anyway.

Servers are not work in progress. Step 3 stops them.

## 2. Fetch PR heads, then scan

In each repo of the workspace, in parallel:

```bash
git -C <repo> fetch -q origin '+refs/pull/*/head:refs/cleanup/pull/*' &   # …one per repo
wait
```

In the repo the session is rooted in, run `git fetch` with no `-C`: `block-wrong-bash` refuses
`git -C` at its own root. GitHub keeps a PR's head after a squash merge deletes the branch, so
the script counts a commit one holds as safe. Then `node cleanup.mjs scan`:

| Key | Meaning |
| --- | --- |
| `servers` | Listening processes this session started |
| `checkouts` | Checkouts this session created (`createdThisSession`) or changed. `session: true` marks a `dirty` file or `unpushed` commit this session made |
| `stashes` | Stashes made since the session began |
| `branches` | Local branches no worktree has checked out. `session: true` marks one this session named; `unsafe` holds commits found nowhere else |
| `olderWorktrees` | Worktrees of earlier sessions |
| `otherServers` | Servers of other sessions, or of a terminal (`session: null`) |

## 3. Stop this session's servers

`node cleanup.mjs stop <pid>…` with every `servers[].pid`. Report any refusal and move on.

## 4. Check each branch's PR

For every entry in `checkouts` that has a branch:

```bash
gh pr list --repo <remote> --head <branch> --state all \
  --json number,url,state,isDraft,headRefOid,reviewDecision,mergeable,statusCheckRollup
```

For an open PR, count unresolved review threads:

```bash
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}}}}}' -F o=<owner> -F r=<name> -F n=<number>
```

Record as outstanding: session commits with **no PR**; a PR that is a **draft**, has **failing or
pending checks**, **conflicts** (`mergeable` `CONFLICTING`), **changes requested**, or
**unresolved threads**; and a merged PR whose `headRefOid` is not the local HEAD — commits made
after the merge are on no PR.

## 5. Remove this session's worktrees and branches

`node cleanup.mjs remove <path>…` with every checkout that has `createdThisSession`. A removed
worktree takes its local branch and isolated database with it. Then
`node cleanup.mjs drop-branch <repo> <branch>…` with the `branches` entries marked `session: true`.

**Never delete a branch on GitHub.** Report each thing the script keeps, with its printed reason,
as outstanding.

## 6. Session work left behind

From every checkout still on disk: `dirty` files and `unpushed` commits with `session: true`, and
every entry in `stashes`. Each is outstanding: name the file or commit and the step that finishes
it (commit, push, `/workflow:finalize-pr`, apply and drop the stash). Mention changes that were
there before the session only as a count.

## 7. Follow-up tickets

Read back through this session for follow-up work the user and Claude agreed belongs in a ticket:
"file a ticket for …", a deferred decision, a bug found and set aside, a step postponed to another
PR. For each, look for it:

```bash
gh search issues --owner <org> --state open "<distinctive words>"
gh search prs --owner <org> "<distinctive words>"
```

Flag each one **not found** as outstanding, with a one-line summary the user can hand to
`/workflow:file-ticket`. Never file it yourself. List only follow-ups the session actually
discussed — not ideas of your own.

## 8. Cross-repo steps still owed

Check the `changedFiles` of every session checkout against the cross-repo contracts in the
workspace `CLAUDE.md`, and against `contractSync`:

```bash
jq -c .contractSync <claude-workflow>/loop-config.json   # no checkout, no check: say so
```

Report each one that applies, as a step the user still owes:

- A change to a `contractSync` source in the producer: after that PR merges, a sync PR opens in
  each consumer and waits for an approval.
- A change to what the claude-workflow plugin ships: after it merges, run `/plugin` → update to
  use it locally.
- A SahajCloud field the mobile app reads, removed or renamed: it needs the two-step removal.
- Session PRs in both a producer and its consumer: the producer merges first.

## 9. Older sessions' leftovers

Prune what earlier sessions left, without asking:

- `node cleanup.mjs prune` — dead server state, and records of worktrees whose directory is gone.
- `node cleanup.mjs remove --stale <path>…` with every `olderWorktrees` path.
- `node cleanup.mjs drop-branch <repo> <branch>…` with the `branches` entries left, one call per repo.

Never stop an `otherServers` entry: report it. Report what was kept as counts by reason, and by
name only what holds work found nowhere else.

## 10. Report

Lead with **Outstanding**, the things the user must do, grouped by repo, each with its link or
path and its next step. If nothing is outstanding, say so in one line. Then **Cleaned up**: the
servers stopped, the worktrees removed, the branches and databases dropped, as counts with names.
Then **Reminders** (step 8), and **Found, not touched** (other sessions' servers, and the older
worktrees and branches kept). Leave out any section that is empty.
