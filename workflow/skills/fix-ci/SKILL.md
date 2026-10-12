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

1. `git fetch origin <branch>` and check it out in a worktree
   (`/workflow:implement-ticket` step 6).
2. Reproduce locally when the log is not enough: `leanGate.full` from `.claude/workflow.json`.
3. Fix in one commit, `fix(ci): <what, in five words>`.
4. Lean gate. A failure that also exists on `main` is still yours to fix here — say so in the
   commit body. (why: docs/why.md#ci-truth-lives-in-check-runs)
5. `git push`. **Then end.** Actions reads the next CI result.

**Cannot fix it in one pass?** Comment what remains and what you tried, with
`identity.commentMarker`. Push nothing broken. Stop.

## Deploy mode

`flags.mode: "deploy"` means a Railway preview failed while every required check passed. The
dispatcher fires it once per head, and it spends no `ceilings.ciFixIterations` pass.
(why: docs/why.md#a-failed-preview-is-read-from-its-log)

Two rules in **Reads** change. The failed preview in the record's `ci.advisory` **is** yours,
though `ci.reason` names no check. The dispatcher cannot re-run it, so a cause outside the repo
ends with your comment. The stale-head check still applies.

1. `node <claude-workflow>/workflow/lib/railway.mjs < record.json > railway.json`. Each entry in
   `deployments` is one failed preview, with its `targetUrl` and a ready `request`. Keep only an
   entry whose `targetUrl` a failing status in `pull_request_read method:get_status` also carries.
   None left → journal it, and stop.
2. `tokenSet: false` → comment one line: the log could not be read, with each `targetUrl`. Journal
   the missing credential. Stop.
3. Read each preview's logs, `[0]` first, then any others. This is Railway, not GitHub, so `curl`
   is the client. Never print the token.
   ```bash
   jq -c '.deployments[0].request' railway.json | curl -sS "$(jq -r .apiBase railway.json)" \
     -H "$(jq -r .tokenHeader railway.json): $(printenv "$(jq -r .tokenEnvVar railway.json)")" \
     -H 'Content-Type: application/json' --data-binary @- > logs.json
   ```
   Read the errors and the last lines of each log, not the whole file. An `errors` array, or no
   lines at all → step 2's comment, quoting Railway's error.
4. A cause in the repo is normal work: a type error, a missing build-time variable, a Nixpacks or
   Dockerfile fault. Follow **Do**, and quote the log line in the commit body.
5. A cause outside the repo, or none you can name, gets one comment: the log line and the
   `targetUrl`. A builder OOM, an image pull failure and a rate limit all qualify. Push nothing.
   Stop.

## Hard rules

- **Never weaken, skip, or delete a test to make it pass.** A red test that is wrong is a
  finding for the comment, not a deletion.
- **Never `--no-verify`, force-push, or rebase.**
- **Never mark the PR ready, re-run CI, or wait for it.** (why: docs/why.md#push-and-end)
- **Never redeploy, restart, or change anything on Railway.** The token can. Each is a write to a
  vendor account.
- **Never touch a label other than the lock, the draft flag, or an assignee.**
