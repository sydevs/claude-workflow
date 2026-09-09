# Going back to the hourly loop

The sydevs loop moved from two scheduled cloud routines to GitHub-event dispatch on
2026-09-08. This file is the way back. Someone who was not there can follow it without reading anything
else first.

**Nothing here is a plan to carry out.** It is a plan to have. If the event loop works, close
the tab. Its opposite is [`docs/cleanup.md`](../cleanup.md), which deletes what this file needs —
after that runs, the fast path below stops working.

## When you would use it

- Dispatch is firing sessions nobody asked for, and pausing the routines is not enough.
- GitHub Actions is failing across all five repos and you need work to continue.
- Something in the event model turns out to be wrong in a way that needs a rewrite, and you
  want a working loop while you do it.

**When you would not.** A single bad handler is `dispatch.enabledHandlers` in
`loop-config.json`, not a rollback. A noisy day is `BOT_DISPATCH=off`, which stops the
dispatcher and starts nothing. One misbehaving item is closing it, or removing `bot:working`.

## What still exists, deliberately

The cutover deleted nothing. Every piece of the old loop is still on `main` and still works.

| Piece | Where |
| --- | --- |
| `work-routine`, `preflight`, `journal` skills | `workflow/skills/` |
| The old state machine | `.github/workflows/state-machine.yml` |
| Its caller job | the `legacy` job in each repo's `.github/workflows/workflow-state.yml`, gated on `BOT_DISPATCH == 'off'` |
| `sydevs-work-hourly` | routine `trig_01BUwH4WjazMXjG2bnC3TVRL`, **disabled** 2026-09-08 |
| `sydevs-survey-nightly` | routine `trig_01WzJ2EnTKEk9BJ2Xf6AQ4x6`, enabled, shared by both models |
| Org field `Stage` | id `46423931` — **values untouched by the cutover** |
| Org field `Hold Until` | id `46423871` — values untouched |
| `ceilings.wipCapPerRepo`, `ciPollAttempts`, `maxWorkItemsPerRun` | `loop-config.json`, kept for exactly this |
| The last polling-era plugin | tag `v0.3.1` |

The backfill wrote Status, labels, `Re-check:` lines and comments. **It never wrote `Stage` or
`Hold Until`**, so the old loop's own inputs are exactly as it left them. That is what makes
this cheap.

The one thing it did take away: it **unassigned `sydevs-bot`** from 30 items. The old loop's
worklist is `assignee:sydevs-bot`, so that has to come back. Both files you need are here.

## The fast path — minutes, no merge

Do these four in order. After step 2 the old loop is running.

```bash
# 1. Stop the dispatcher. The `legacy` job starts on the next event.
gh variable set BOT_DISPATCH --org sydevs --visibility all --body off
gh variable list --repo sydevs/<repo>          # delete any repo-level override you find

# 2. Start the hourly routine again (or do it in the routines UI).
#    RemoteTrigger update trig_01BUwH4WjazMXjG2bnC3TVRL  {"enabled": true}

# 3. Put the assignees and `awaiting` back.
node docs/rollback/migrate-to-status.mjs \
  --config loop-config.json \
  --restore docs/rollback/cutover-snapshot-2026-09-08.json --apply

# 4. Pause the five per-repo routines so nothing can fire mid-run.
#    loop-SahajCloud          trig_01CiCX4hDrAiP32S2FAM2phy
#    loop-SahajAtlasWeb       trig_01P1f8mXn767iQ6Ve6nZ5jcW
#    loop-WeMeditateWeb       trig_01Gdqck1nQggS1Rxmrz9GuW9
#    loop-SahajAtlasWordpress trig_0144RjvvF3qRkqfugMyR6oY2
#    loop-claude-workflow     trig_013eDcX1APf1f5NfUzodGE75
```

**Wait for any in-flight session to end before step 4**, or its final write lands after you
have moved on. Look for open items carrying `bot:working`; the longest lease is
`dispatch.timeoutsMinutes.implement`, 150 minutes.

`--restore` is idempotent and additive. It re-adds `awaiting` and `sydevs-bot` where the
snapshot had them and deletes nothing, so running it twice is harmless. A dry run without
`--apply` prints the 30 writes it would make.

## Then revert the skills

The fast path leaves the **new** skills on `main`. The old `work-routine` calls `finalize-pr`,
which no longer watches CI and no longer marks a PR ready. A PR opened after rollback would sit
in draft forever, invisible to everyone.

So revert the flip, in its own PR, and bump the plugin version — it is a cache key, and a
locally installed plugin ignores `main` until it changes.

```bash
git revert --no-commit 4b46afb        # feat(loop)!: the flip (#71)
# bump workflow/.claude-plugin/plugin.json to 1.1.0 (or higher than whatever is live)
```

Revert only that commit. **Leave the four fixes after it alone** (#73, #75, #76, #79, #80) —
they touch `dispatcher/` and `docs/`, and reverting them buys nothing.

Check `finalize-pr` afterwards. It must have step 8 (watch CI) and step 9 (mark ready) back,
and `implement-issue` must have its four-gate table. `node workflow/lib/rule-delta.mjs --base
main workflow/skills` names anything that did not come back.

## What you can leave alone

- **Labels.** `bot:working`, `stuck`, `blocked` and `proposal` mean nothing to the old loop. It
  reads `awaiting`, `ops-journal` and `Stage`. Leaving them costs nothing and makes rolling
  forward again free.
- **Board Status.** The old loop never reads Projects v2.
- **`Blocked by:` and `Re-check:` lines.** Prose in `## Notes`. Harmless.
- **The five routines and their tokens.** Paused is enough. Deleting them is a one-way door:
  the API cannot create a routine token, so re-creating one means the UI, once per repo.
- **`dispatcher/` and `dispatcher.yml`.** Inert under `BOT_DISPATCH=off`.

## What you cannot get back

**A parked ticket's old `Stage`.** Parking used to be `Stage: Blocked` plus a `Hold Until`
date, and the `(was: <Stage>)` suffix recorded what to restore on unblock. The event model
dropped the suffix. The cutover parked eleven tickets. The snapshot holds their `stage`
and `hold` values, so `--restore` could write them back, but it does not today. Nothing ever
modified those field values, so in practice they still hold.

**The 20 re-authorized tickets.** `sydevs/claude-workflow#74` lists every ticket that held
`Stage: Implement` at the cutover, grouped by repo. It is the human-readable half of the
snapshot, and it survives even if these files do not.

## Check it worked

| Check | Expect |
| --- | --- |
| Any repo's next event | the `legacy` job runs and GitHub skips `dispatch` |
| `gh issue list --label awaiting` | roughly the 13 items in the snapshot |
| `assignee:sydevs-bot` across the five repos | roughly 30 items |
| The next hourly fire | a journal entry in the old body-rewrite format |
| An open bot PR | `finalize-pr` marks it ready once CI is green |

## Rolling forward again

`BOT_DISPATCH=on`, re-enable the five routines, un-revert the flip. The event model needs no
migration a second time: Status, labels and markers were never removed, so the board is still
correct. The one repeat step is unassigning `sydevs-bot`, which the old loop starts writing again the
moment it runs.
