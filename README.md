# claude-workflow

The shared [Claude Code](https://claude.com/claude-code) workflow for the
[sydevs](https://github.com/sydevs) projects — one issue-to-PR pipeline used by
**SahajCloud**, **SahajAtlasWeb**, **WeMeditateWeb** and **SahajAtlasWordpress**.

## Why this exists

The four product repositories are developed in tandem, and for a while they each carried their own copy
of the same workflow skills, kept in sync by hand against a spec that required the copies stay
byte-identical. They did not. By the time this plugin was written the copies had diverged by
90–250 lines apiece, pipeline steps had been renamed between them, and the audit meant to catch the
drift had been comparing against a directory that no longer existed.

The problem was never discipline — it was that prose in triplicate has no enforcement. So the
per-repo differences are no longer prose. They live in one `.claude/workflow.json` per repo, and
there is exactly one copy of each skill.

## Install

```bash
/plugin marketplace add sydevs/claude-workflow
/plugin install workflow@sydevs
```

Each repo also declares it in `.claude/settings.json`, so a fresh clone picks up the marketplace
after the folder is trusted:

```json
{
  "extraKnownMarketplaces": {
    "sydevs": { "source": { "source": "github", "repo": "sydevs/claude-workflow" } }
  },
  "enabledPlugins": { "workflow@sydevs": true }
}
```

`enabledPlugins` must be an **object map**, not an array. The array form installs the plugin and
then reports it `disabled`, with no error anywhere — worth knowing, because it looks exactly like
a working install until you check `claude plugin list`.

Project settings register the marketplace but do not auto-install an external-source plugin, so
each person runs `claude plugin install` once.

## What it provides

| Skill | Purpose |
| --- | --- |
| `/workflow:draft-ticket` | Draft a GitHub issue — clarify ambiguity first, then acceptance criteria and a verification checklist. Your way into the pipeline. |
| `/workflow:triage-issue` | The metadata rules: type, priority, state labels, relationships, body format. Shared by everything that files a ticket. |
| `/workflow:implement-issue` | Implement an `ready-to-implement` issue in a worktree, then ship via `finalize-pr`. |
| `/workflow:finalize-pr` | Simplify → review → conditional security review → lean gate → docs sync → push → PR → capped CI loop. Never merges. |
| `/workflow:cross-repo-issue` | File a change spanning repos as a tracking issue plus linked children, in dependency order. |
| `/workflow:dev-server` | One dev server per **git worktree**, with its own port and database. |
| `/workflow:loop-run` | One pass of the autonomous ladder. Invoked by the scheduled routines; `--dry-run` locally. |
| `/workflow:survey-deps` | Monday: vulnerabilities → PRs; monthly routine updates. |
| `/workflow:survey-sentry` | Tuesday: production errors → tickets. |
| `/workflow:survey-analysis` | Wednesday: one rotating angle on the codebase → proposals. |
| `/workflow:survey-contracts` | Thursday: do the published contracts still describe reality? |
| `/workflow:cut-release` | Friday: tag, changelog, GitHub Release where work has accumulated. |
| `/workflow:reflect` | Sunday: read the week's journal and propose changes to the loop itself. |

Plus four hooks: `block-generated-files`, `block-wrong-bash`, `prettier-format`, `eslint-fix`.

## The loop

Two scheduled cloud routines run `loop-run` across all five repos — the four product repos and
this one. `sydevs-loop` runs every two hours through the Vancouver working day (rungs: merge what
you approved, revise what you commented on, implement what you cleared, journal it);
`sydevs-survey-nightly` runs once at night (the day's survey, the dropped-baton and stale-claim
sweeps, journal). Splitting the survey out guarantees it runs even on days the queue is busy. State lives entirely in GitHub — **the assignee field is the queue**, PRs
are the work, a pinned issue is the memory, and `loop-config.json` holds the knobs.

**The baton.** `assignee:sydevs-bot` is the worklist: one indexed query per repo, rather than a scan
of every open item. Reassigning to you is the final action on any unit of work and means *done*, so
your queue is everything waiting on you and nothing else. Unassign the bot on any PR and it stops
touching that PR — a per-item kill switch that needs no documentation to understand.

Three properties make it safe to leave running:

- **`ready-to-implement` is the only code gate.** Ticket-only. The loop never applies that label and
  never implements without it. It *may* remove it when a question must be answered first — revoking
  only ever reduces its own autonomy. Everything it finds on its own is filed as a `proposal` for
  you to judge.
- **Merging needs all three of** an approving review, green CI, and zero unresolved threads. No label
  authorises a merge.
- **Assignment gates attention.** If it is not assigned to the bot, the bot does not touch it.

Ceilings in `loop-config.json` bound what one run can spend — a cloud session cannot read your
remaining quota, so spend is rationed by work-item counts rather than token math. The Sunday
reflection rung proposes adjustments to those numbers as a PR, so the loop tunes itself through the
same review path as everything else.

## Configuration

Everything repo-specific comes from `<repo>/.claude/workflow.json`:

| Key | Meaning |
| --- | --- |
| `packageManager` | Used by the hooks and any constructed command. |
| `leanGate.command` / `.full` | The pre-PR test gate. |
| `contractStep` | Migrations, `types:cms`, or the URL-contract diff. |
| `securityReview.triggerPattern` | Paths that trigger a branch-level security review. |
| `securityReview.contentPattern` / `.contentPaths` | Newly-introduced sinks, regardless of path. |
| `generatedFiles` | `{ pattern, reason }` rules for `block-generated-files`. |
| `prAllowlistGlobs` | Where a **ticketless** PR may be opened (dep bumps, doc fixes, type re-syncs). Ticket work is gated on the `ready-to-implement` label instead. |
| `worktreeSetup` | Commands run after `EnterWorktree`. |
| `devServer` | `command`, `basePort`, `healthPath`, and optional database isolation. |

## Deliberately not here

Several things were dropped rather than ported, because something maintained elsewhere already
covers them:

- **Code review** → the official `pr-review-toolkit` plugin (six specialist agents with confidence
  scores) instead of a single hand-rolled pass.
- **Security review** → the built-in `/security-review` plus the official `security-guidance`
  plugin, which catches issues at edit time.
- **Type checking on edit** → the official `typescript-lsp` / `php-lsp` plugins. A language server
  reports diagnostics in the same turn as the edit; the old `typecheck` hook could not.
- **Session reflection** → the official `claude-md-management` plugin.
- **`pr-prep` skill** → `workflow.json.leanGate` pointing at each repo's own `check.sh`. The skill
  was a wrapper that added nothing.

`prettier-format` and `eslint-fix` survive because they *rewrite* files, which no language server
does.

## Standing this up on a new account

Every dashboard, identifier and gotcha involved is in
**[docs/routine-setup.md](docs/routine-setup.md)** — GitHub metadata, Mailpit on Railway, the Sentry
integration, the Claude cloud environment, and the routines themselves, in dependency order. Written
so the loop can be rebuilt from nothing on a different Claude account.

## Development

```bash
claude --plugin-dir ./workflow    # load without installing
claude plugin validate ./workflow --strict
```

## Licence

MIT
