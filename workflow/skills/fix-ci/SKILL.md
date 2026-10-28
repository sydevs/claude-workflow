---
name: fix-ci
description: One iteration on a red check run of a loop-authored PR — read the failing job's log, fix, run the lean gate, push, end. In deploy mode, the same for a failed Railway preview's log. Fired by the dispatcher on CI completion. Runnable locally against a PR number.
argument-hint: '[owner/repo#N]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Fix CI

One PR, one red run, one pass. Actions counts the passes and stops dispatching at
`ceilings.ciFixIterations`. `flags.mode: "deploy"` is the one exception — see **Deploy mode**.
**Start with `/workflow:start-run` and end with `/workflow:finish-run`.**

## Reads

- `mcp__github__pull_request_read method:get` — **if the PR's `head.sha` differs from the
  record's `head.sha`, the failure is stale.** Stop, and journal it.
- `method:get_check_runs` — which check failed. **Fix only a check the record's `ci.reason` names.**
  Those are the ruleset's required checks. Any other red check is advisory, and not yours.
  (why: docs/why.md#only-required-checks-are-ci)
- `mcp__github__actions_get` — the failing job's log. Read the failure, not the whole log.
- **A check the dispatcher counts as infrastructure is not yours.** Its job timed out, never
  started, or was cancelled, or it carries an error annotation titled `ci.infraLabel`. The
  dispatcher re-runs those itself, so fix only the others.
  (why: docs/why.md#an-infrastructure-failure-is-re-run-not-repaired)
- **`mergeable: false` means a conflict, not a red check.** A conflicted PR schedules no CI at
  all. Comment one line, and stop — Actions dispatches `resolve-conflicts`.
  (why: docs/why.md#a-conflicted-pr-schedules-zero-ci-runs)

## Do

1. `git fetch origin <base> <branch>`, then `git worktree add .claude/worktrees/<slug> origin/<branch>
   -B <branch>`. This is the PR's existing branch: never `-b` off the default branch. Behind
   `origin/<base>` → merge it first, as address-review's *Merge the base first* says, so the fix is
   tested against the base it lands on; it is pushed with the fix, never alone.
   (why: docs/why.md#a-merge-is-pushed-only-with-work)
2. Reproduce locally when the log is not enough: `leanGate.full` from `.claude/workflow.json`.
3. Fix in one commit, `fix(ci): <what, in five words>`.
4. Lean gate. A failure that also exists on `main` is still yours to fix here — say so in the
   commit body. (why: docs/why.md#ci-truth-lives-in-check-runs)
5. `git push`. **Then end.** Actions reads the next CI result.

**Cannot fix it in one pass?** Comment what remains and what you tried, with
`identity.commentMarker`. Push nothing broken. Stop.

## Deploy mode

`flags.mode: "deploy"` means a Railway preview failed while every required check passed. The
dispatcher fires it once per head, and it spends no `ceilings.ciFixIterations` pass. The failed
preview in the record's `ci.advisory` **is** yours, though `ci.reason` names no check, and the
dispatcher cannot re-run it. The stale-head check still applies.
(why: docs/why.md#a-failed-preview-is-read-from-its-log)

1. `node <claude-workflow>/workflow/lib/railway.mjs < record.json > railway.json`. Keep only a
   `deployments` entry whose `targetUrl` a failing status in `pull_request_read method:get_status`
   also carries. None left → journal it, and stop.
2. Read each one's logs with `curl`. Never print the token. Read the errors and the last lines,
   not the whole file.
   ```bash
   jq -c '.deployments[0].request' railway.json | curl -sS "$(jq -r .apiBase railway.json)" \
     -H "Authorization: Bearer $(printenv "$(jq -r .tokenEnvVar railway.json)")" \
     -H 'Content-Type: application/json' --data-binary @- > logs.json
   ```
3. A cause in the repo — a type error, a missing build-time variable, a Nixpacks or Dockerfile
   fault — is normal work. Follow **Do**, and quote the log line in the commit body.
4. Anything else gets one comment with the `targetUrl`, then stop and push nothing: a cause
   outside the repo (a builder OOM, an image pull failure, a rate limit) with its log line, or no
   log at all (`tokenSet: false`, an `errors` array, no lines) with Railway's error.

## Hard rules

- **Never weaken, skip, or delete a test to make it pass.** A red test that is wrong is a
  finding for the comment, not a deletion.
- **Never `--no-verify`, force-push, or rebase.**
- **Never mark the PR ready, re-run CI, or wait for it.** (why: docs/why.md#push-and-end)
- **Never redeploy, restart, or change anything on Railway.** The token can. Each is a write to a
  vendor account.
- **Never write state** (start-run's list). Touch no label but the lock.
