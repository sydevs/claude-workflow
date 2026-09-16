# Going back to the hourly loop

The sydevs loop moved from two scheduled cloud routines to GitHub-event dispatch on
2026-09-08. This file was the way back. On 2026-09-15 the cleanup ran and **the fast path
stopped existing**. Rolling back is now a rebuild, not a switch.

**Nothing here is a plan to carry out.** It is a plan to have. If the event loop works, close
the tab.

## Read this before anything else

Until the cleanup, the old loop sat on `main` beside the new one, gated on a variable. Flipping
`BOT_DISPATCH=off` started it. That is over. `off` now means **nothing runs** — not the old
loop, not the new one. Every caller says so in its own header.

What was deleted, and by what:

| Piece | Deleted by |
| --- | --- |
| `work-routine`, `preflight`, `journal` skills | [#101](https://github.com/sydevs/claude-workflow/pull/101) |
| `.github/workflows/state-machine.yml` | [#101](https://github.com/sydevs/claude-workflow/pull/101) |
| claude-workflow's own `legacy` caller job | [#101](https://github.com/sydevs/claude-workflow/pull/101) |
| The four product repos' `legacy` caller jobs | SahajCloud#793 · SahajAtlasWeb#210 · WeMeditateWeb#101 · SahajAtlasWordpress#26 |
| `ceilings.wipCapPerRepo`, `ciPollAttempts`, `maxWorkItemsPerRun` and nine more keys | [#100](https://github.com/sydevs/claude-workflow/pull/100) |
| Org field `Stage` (id `46423931`) | deleted by hand, 2026-09-15 |
| `sydevs-work-hourly` (`trig_01BUwH4WjazMXjG2bnC3TVRL`) | deleted by hand in the routines UI, 2026-09-15 |

## What survived, and why each one matters

| Piece | Where | What it buys you |
| --- | --- | --- |
| Tag **`v0.3.1`** (`f1b6e39`) | this repo | Every deleted file, whole and working. This is the recovery source, not a diff to reconstruct. |
| `cutover-snapshot-2026-09-08.json` | beside this file | The **only remaining copy** of every issue's old `Stage` and `Hold Until`. The field is gone; the values are here. |
| `migrate-to-status.mjs` | beside this file | `--restore` re-adds the `awaiting` set and the `sydevs-bot` assignments the old loop reads as its worklist. |
| Org field `Hold Until` (`46423871`) | org settings | Never retired. A park still lives there. |
| `sydevs/claude-workflow#74` | GitHub | The 20 tickets that held `Stage: Implement` at the cutover, grouped by repo. Human-readable, and it outlives these files. |

## Before you decide to do any of this

Three cheaper things stop the loop, and one of them is almost certainly what you want.

| Symptom | Reach for |
| --- | --- |
| One handler misbehaves | `dispatch.enabledHandlers` in `loop-config.json` — a list, and everything else stops |
| A noisy day, or dispatch firing sessions nobody asked for | `gh variable set BOT_DISPATCH --org sydevs --body off` — every repo goes quiet in one write |
| You want to see plans without writes | `BOT_DISPATCH=dry` |
| One item is stuck | close it, or remove its `bot:working` label |
| The platform is the problem | pause the five routines in the UI; the dispatcher degrades to `stuck` and the sweeper retries when you unpause |

`off` is instant, total and free. **A rollback is only for a wrong event model** — something
about the design turns out to be unworkable and you need a loop running while you rewrite it.
Anything short of that, stop at the table above.

## The rebuild, in the order it has to happen

Budget half a day, and do not start it tired. Steps 1 and 2 are irreversible-ish; the rest is
ordinary work.

### 1. Re-create the `Stage` org field, and record its new id

The delete was permanent and the new field gets a **new id**, so the config and the restored
skills both need editing.

```bash
gh api -X POST orgs/sydevs/issue-fields --input - <<'JSON'
{"name":"Stage","data_type":"single_select","options":[
  {"name":"Proposed","color":"blue","priority":1},
  {"name":"Revising","color":"yellow","priority":2},
  {"name":"Blocked","color":"gray","priority":3},
  {"name":"Implement","color":"green","priority":4},
  {"name":"Implemented","color":"purple","priority":5}]}
JSON
gh api orgs/sydevs/issue-fields --jq '.[] | "\(.name) id=\(.id)"'
```

Then write the new id into `loop-config.json` → `issueFields.stage` and into the restored
`state-machine.yml`, which hard-codes it.

`Status` and `State` are reserved names and return `422`. `Stage` is the workaround, and that is
the whole reason for the odd name.

### 2. Re-create the hourly routine

The API cannot create a routine or its token. This is the routines UI, by hand, once:
name `sydevs-work-hourly`, all five repos attached, opus, cron
`0 1,12,13,14,15,16,17,18,19,21,23 * * *` UTC (11 fires a day — hourly 05:00–12:00 PT, then
14/16/18), prompt naming `work-routine/SKILL.md`, `persist_session: false`. Then pause the five `loop-*` routines so nothing fires mid-run.

### 3. Restore the code from `v0.3.1`

Not a revert — the intervening commits contain fixes worth keeping, and `main` has moved a long
way. Take the deleted files back whole:

```bash
git checkout v0.3.1 -- \
  workflow/skills/work-routine workflow/skills/preflight workflow/skills/journal \
  .github/workflows/state-machine.yml
```

Then, in the same PR:

- **Revert `4b46afb`** (`feat(loop)!: the flip`, #71). The current `finalize-pr` does not watch
  CI and does not mark a PR ready, so a PR opened under the old loop would sit in draft forever.
- **Revert `138d613`** (`feat(loop)!: GitHub owns the merge`, #98). The old `work-routine` merges
  with `PUT /pulls/{n}/merge`; without this the loop arms auto-merge on a branch whose queue you
  are about to remove.
- **Restore the twelve config keys** #100 deleted. `git show 9547824 -- loop-config.json` names
  every one.
- **Bump `workflow/.claude-plugin/plugin.json`** above 2.0.0 — it is a cache key, and an
  installed plugin ignores `main` until the version changes.

Leave the fixes between the flip and today alone (#73, #75, #76, #79, #80, #95): they touch
`dispatcher/` and `docs/`, and reverting them buys nothing.

Check with `node workflow/lib/rule-delta.mjs --base main workflow/skills` — it names anything
that did not come back. It does **not** see deleted files, so read the restored tree yourself.

### 4. Put the five `legacy` caller jobs back

One per repo, in `.github/workflows/workflow-state.yml`, above the `dispatch` job:

```yaml
  legacy:
    if: vars.BOT_DISPATCH == 'off' && github.event_name != 'schedule' && github.event_name != 'workflow_dispatch'
    uses: sydevs/claude-workflow/.github/workflows/state-machine.yml@main
    secrets:
      token: ${{ secrets.SYDEVS_BOT_PAT }}
```

Fix each file's header comment too: it currently says `off` means nothing runs.

**Merge claude-workflow's `state-machine.yml` first.** A caller naming a workflow that does not
exist fails the entire run, and the only sign is a failed run named after the file path.

### 5. Undo the merge queue

The old loop merges with `PUT /pulls/{n}/merge`, which **a queue-protected branch rejects**. Skip
this and every approved PR fails to merge.

On SahajCloud, SahajAtlasWeb, WeMeditateWeb and SahajAtlasWordpress:

```bash
gh api repos/sydevs/<repo>/rulesets --jq '.[]|"\(.id) \(.name)"'
```

Drop the `merge_queue` rule from the ruleset, and set `required_approving_review_count` back to
`0` if you want the old loop to merge unattended as it used to. Leave `deletion`,
`non_fast_forward` and `pull_request` — none of them troubles the polling loop. `claude-workflow`
has no queue and needs nothing.

Leave `allow_auto_merge` on: harmless once nothing arms it. Leave the `merge_group` trigger in
each `ci.yml`: an event that never fires. Any PR still armed loses its arming with the rule.

### 6. Restore the worklist, then start it

```bash
gh variable set BOT_DISPATCH --org sydevs --visibility all --body off
gh variable list --repo sydevs/<repo>     # delete any repo-level override

node docs/rollback/migrate-to-status.mjs \
  --config loop-config.json \
  --restore docs/rollback/cutover-snapshot-2026-09-08.json --apply
```

`--restore` is idempotent and additive: it re-adds `awaiting` and `sydevs-bot` where the snapshot
had them, deletes nothing, and a run without `--apply` prints the 30 writes first.

It does **not** write `Stage` back, even though the snapshot holds every value. Until the
cleanup that did not matter — the field was untouched. Now the field is new and empty, so
either teach `--restore` to write `stage` from the snapshot, or accept that the old loop starts
with an empty worklist and re-authorize from #74.

**Wait for every in-flight session to end before you enable anything.** Look for open items
carrying `bot:working`; the longest lease is `dispatch.timeoutsMinutes.implement`, 150 minutes.

## Check it worked

| Check | Expect |
| --- | --- |
| Any repo's next event | the `legacy` job runs and GitHub skips `dispatch` |
| `gh issue list --label awaiting` | roughly the 13 items in the snapshot |
| `assignee:sydevs-bot` across the five repos | roughly 30 items, once `Stage` is back |
| The next hourly fire | a journal entry in the old body-rewrite format |
| An open bot PR | `finalize-pr` marks it ready once CI is green |
| An approved PR | merges within a minute, with no queue in the way |

## What you can leave alone

- **Labels.** `bot:working`, `stuck`, `blocked` and `proposal` mean nothing to the old loop. It
  reads `awaiting`, `ops-journal` and `Stage`. Leaving them costs nothing and makes rolling
  forward again free.
- **Board Status.** The old loop never reads Projects v2.
- **`Blocked by:` and `Re-check:` lines.** Prose in `## Notes`. Harmless.
- **The five `loop-*` routines and their tokens.** Paused is enough, and deleting them is a
  one-way door — the API cannot create a routine token, so each one costs a UI visit to rebuild.
- **`dispatcher/` and `dispatcher.yml`.** Inert once no caller reaches them.

## Rolling forward again

Un-revert the two commits, restore the `dispatch` job, delete the `legacy` job, `BOT_DISPATCH=on`,
re-enable the five routines. The event model needs no migration a second time: Status, labels and
markers were never removed, so the board is still correct. The one repeat step is unassigning
`sydevs-bot`, which the old loop starts writing again the moment it runs.
