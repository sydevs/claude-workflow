# Retiring the polling loop

The event-driven loop went live on 2026-09-09. Every piece of the loop it replaced is still
here, on purpose: [`docs/rollback/`](rollback/) needs all of it. This file is the other half — how
to delete it once you no longer want that option.

**Do not start until the loop has run a supervised week**, including one Sunday `reflect`, and you
have seen the whole chain once: a verb, a draft PR, CI, the adversarial review, a revision, ready,
approval, merge. Deleting is the moment the switch stops being reversible.

Order matters only where it says so. Everything else is independent.

## 1. The config-only PR

Its own PR, no skill change beside it — the repo's oldest rule, so a behaviour change and a
number change are never confounded.

Remove from `loop-config.json`:

| Key | Why it can go |
| --- | --- |
| `ceilings.wipCapPerRepo` | no WIP cap; the human typing the verb is the throttle |
| `ceilings.ciPollAttempts` | nothing polls CI; completion is an event |
| `ceilings.maxWorkItemsPerRun` | there is no run to bound |
| `issueFields.stage` | the board's `Status` replaced it |
| `assignment.bot` | `identity.expectedLogin` is the login; no assignee means anything |
| `stateMachine` | the workflow it names is deleted in step 3 |
| `writing.budgets.journalComment` | the journal is comments now, budgeted by `journalEntry` |
| `relationships.cloudReadable`, `relationships.recheckProbe` | probes whose answers are recorded in `docs/why.md` |
| `projects.recheckProbe` | same |
| `relationships.recheckMarker` | **only once no open issue carries a `Re-check:` line.** Check first: `gh search issues "org:sydevs is:open \"Re-check:\""` |

**Keep `issueFields.holdUntil`.** It is where a park lives.
(why: `docs/why.md#a-date-belongs-in-a-date-field`)

## 2. The skills

`workflow/skills/work-routine/`, `preflight/` and `journal/` — delete all three, with their
scripts. Nothing reads them: `handler-preflight` and `handler-journal` replaced the bookends, and
the handlers replaced the ladder.

In the same PR:

- `README.md` — drop the three legacy rows from the skills table.
- `AGENTS.md` — the "skill's length is a running cost" section still names `preflight` and
  `work-routine`.
- `docs/why.md` — retire the anchors that describe rungs and the baton: `rung-2-competes-for-the-same-budget`, `the-adversarial-review-runs-last-and-may-starve`, `rung-4-writes-awaiting-when-it-asks-a-question`, `selection-favours-new-work-and-blockers`, `derive-the-window-from-comment-timestamps`, `blocked-always-carries-a-hold-until`, `unblocking-never-restores-implement`, `a-prs-assignee-is-a-record-never-a-signal`, `mark-the-pr-ready-despite-unsettled-ci`, `assignment-alone-is-not-the-implementation-gate`, `fetch-fields-only-where-a-search-answered`, `the-state-machine-is-not-the-loops-job`, `do-not-pin-the-journal`, `correcting-an-earlier-claim`.

  **Retire, do not delete.** Each one is a failure someone paid for. Move them under a
  `## Retired` heading with one line saying what replaced them, so a future reader meets the
  lesson rather than re-learning it.
- Bump `workflow/.claude-plugin/plugin.json`. It is a cache key, and an installed plugin ignores
  `main` until it changes.
- Run `node workflow/lib/rule-delta.mjs --base origin/main workflow/skills` and account for every
  removal in the PR body. It will be a long list. That is the point.

## 3. The old workflow

Delete `.github/workflows/state-machine.yml`, then the `legacy` job from **all five**
`workflow-state.yml` callers.

**The callers first, then the reusable workflow.** A caller naming a workflow that no longer
exists fails the whole run, so leaving `legacy` behind for even one repo breaks that repo's
dispatch. SahajCloud needs a PR; the other four take a direct commit.

Once the last `legacy` job is gone, `BOT_DISPATCH=off` no longer falls back to anything — it just
stops. Say so in `docs/rollback/`, which currently promises otherwise, and delete the old
`ADD_TO_PROJECT_PAT` org secret if it is still set.

## 4. The org field

Last, and irreversible.

```bash
gh api orgs/sydevs/issue-fields --jq '.[] | "\(.name) id=\(.id)"'
gh api -X DELETE orgs/sydevs/issue-fields/46423931   # Stage
```

**Only `Stage`.** Priority, Effort and Hold Until all stay.

Deleting it destroys every ticket's `Stage` value, which is the one input `docs/rollback/` cannot
reconstruct — the snapshot holds them, so keep
`docs/rollback/cutover-snapshot-2026-09-08.json` even after this. Re-creating the field later
gives it a new id.

Afterwards, remove the mirrored `Stage` column from the org project's field list if it lingers,
and check the project's description, which still describes the Stage model.

## 5. The routines

Delete `sydevs-work-hourly` (`trig_01BUwH4WjazMXjG2bnC3TVRL`) in the routines UI. The API creates
and updates a routine but never deletes one.

**This is a one-way door in a way the others are not.** The API also cannot mint a routine token,
so re-creating a routine means the UI, and re-issuing its secret. Leaving it disabled costs
nothing. Delete it only when you are certain.

## 6. The product repos

Confirmed for deletion during the cutover, each in that repo's own PR, with the `AGENTS.md`
references removed in the same PR:

| Repo | Delete |
| --- | --- |
| SahajCloud | `.agents/skills/railway-config` (empty), `.claude/output-styles/` |
| SahajAtlasWeb | `.claude/output-styles/` |
| WeMeditateWeb | `.claude/output-styles/`, `.claude/skills/dependency-updates`, `.claude/skills/git-push-troubleshooting`, `.claude/skills/batch-refactoring` |
| claude-workflow | `.claude/worktrees/` (a stale worktree holding a pre-split skill) |

Keep what the maintainer asked to keep: `reset-db`, the payload skill, `design-extraction`,
`component-development`, `ladle-processes`, and every `pr-prep/check.sh`.

Two stale permission entries to drop in the same pass: SahajCloud's `Bash(gh pr merge:*)` — no
session merges now — and the absolute `Read(//Users/devindra/…/claude-plugins/…)` path in
`settings.local.json`.

`batch-refactoring` is cited at `WeMeditateWeb/AGENTS.md:157` and `:265`. Replace each with one
sentence rather than a dangling link.

## 7. The sweep

```bash
grep -rn -i "stage: \|hold until\|holdUntil\|rung \|work-routine\|preflight\|/workflow:journal\|\
subscribe_pr_activity\|ciPollAttempts\|maxWorkItemsPerRun\|assignee:sydevs-bot\|state-machine\|\
ADD_TO_PROJECT_PAT\|wipCapPerRepo" \
  --include='*.md' --include='*.json' --include='*.yml' --include='*.mjs' .
```

Run it in all five repos. Expect hits in each product repo's `AGENTS.md`, in every
`.claude/workflow.json` `$comment` that describes the loop, and in the org project's own
description on GitHub. `docs/rollback/` and `docs/why.md`'s retired section are supposed to match —
they are the record.

Finish with `node workflow/lib/rule-delta.mjs` and `python3 workflow/lib/ste-lint.py` over the
final skill set.

## What is deliberately not on this list

- **`Hold Until`.** A park lives there.
- **`docs/rollback/`** and its snapshot. Keep both, and update the rollback doc in step 3 to say
  the fast path no longer exists.
- **The five `loop-*` routines and their tokens.** Obviously.
- **`dispatcher/` and `dispatcher.yml`.** That is the loop now.
