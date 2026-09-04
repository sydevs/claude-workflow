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
| `/workflow:triage-issue` | The metadata rules: type, the Priority, Effort, Stage and Hold Until fields, assignment, relationships, body format. Shared by everything that files a ticket. |
| `/workflow:implement-issue` | Implement a `Stage: Implement` issue in a worktree, then ship via `finalize-pr`. |
| `/workflow:finalize-pr` | Simplify → review → conditional security review → lean gate → docs sync → push → PR → capped CI loop. Never merges. |
| `/workflow:cross-repo-issue` | File a change spanning repos as a tracking issue plus linked children, in dependency order. |
| `/workflow:dev-server` | One dev server per **git worktree**, with its own port and database. |
| `/workflow:work-routine` | One pass down the working-day ladder: merge, revise, implement, adversarially review. Invoked by the `sydevs-work-hourly` routine; `--dry-run` locally. |
| `/workflow:survey-routine` | The once-a-night run: the day's survey and the reconciliation sweeps. Invoked by the `sydevs-survey-nightly` routine; `--dry-run` locally. |
| `/workflow:preflight` | Ground rules and run start shared by both runs — auth, identity, the census. Invoked by the two run skills, not on its own. |
| `/workflow:journal` | The run's journal entry and ending, shared by both runs. Invoked by the two run skills, not on its own. |
| `/workflow:survey-deps` | Monday: vulnerabilities → PRs; monthly routine updates. |
| `/workflow:survey-sentry` | Tuesday: production errors → tickets. |
| `/workflow:survey-analysis` | Wednesday: one rotating angle on the codebase → proposals. |
| `/workflow:survey-contracts` | Thursday: do the published contracts still describe reality? |
| `/workflow:cut-release` | Friday: tag, changelog, GitHub Release where work has accumulated. |
| `/workflow:reflect` | Sunday: read the week's journal and the reviewer's review activity; refine the reviewer profile and propose changes to the loop itself. |
| `/workflow:adversarial-review` | Critic-side adversarial pass on one loop-authored PR — advisory, profile-driven, always in a fresh context; the human stays the approver. |

Plus four hooks: `block-generated-files`, `block-wrong-bash`, `prettier-format`, `eslint-fix`.

## The loop

Two scheduled cloud routines work all five repos — the four product repos and this one — each with
its own run skill, both starting with `preflight` and ending with `journal`. `sydevs-work-hourly` runs
`work-routine` hourly through the Vancouver morning and every two hours in the afternoon — one pass
down a ladder of rungs ordered by how much they respect your attention: merge what you approved,
revise what you commented on, implement what you cleared, adversarially review what it built.
`sydevs-survey-nightly` runs `survey-routine` once at night — no ladder, just the day's survey and the
unheard-replies sweep. Splitting the survey out guarantees it runs even on days the queue is busy.
State lives entirely in GitHub — **the assignee field is the queue**, PRs are the work, a daily issue
is the memory, and `loop-config.json` holds the knobs.

**The baton.** `assignee:sydevs-bot` is the worklist: one indexed query per repo, rather than a scan
of every open item. **You are the only one who assigns it**, and it stays put until you take it back
— so assignment answers exactly one question, *is this the loop's to touch*, and never drifts. The
loop's one assignment write is removing itself from a ticket once the PR exists. Unassign the bot on
anything and it stops touching that thing: a per-item kill switch that needs no documentation to
understand.

**What needs you is one label: `awaiting`.** It is the primary signal, it works on issues and PRs
alike, and it is maintained by a workflow from GitHub events rather than by the loop — so it appears
the moment a PR is ready and disappears the moment you reply, not on the loop's next run. Filter any
board view by `label:awaiting` and that is your queue.

**What kind of turn it is** lives in two org-level issue fields, next to Priority and Effort:

| `Stage` | Means |
| --- | --- |
| `Proposed` | Filed, awaiting your verdict |
| `Revising` | Being worked out — whose turn it is is whoever commented last |
| `Blocked` | Parked, with a `Hold Until` date saying when it comes back |
| `Implement` | You cleared it for code |
| `Implemented` | A PR is in flight |

`Hold Until` is a date. While it is in the future the item is not merely skipped — it is invisible,
including in the journal, because the loop has already promised to look again on that day.

**PRs have no fields, so a PR's turn is its `draft` flag.** The loop opens every PR as a draft and
clears it once CI is green. Draft means it is still working; ready-for-review means it is your turn.
It finds its own PRs by `author:sydevs-bot` and never writes an assignee on one — so a PR's assignee
is free to mean the opposite thing: **assign the bot to a PR it did not write and it will work on
that PR.**

Three properties make it safe to leave running:

- **`Stage: Implement` is the only code gate**, and only you can set it. The loop never writes that
  value and never implements without it. It *may* move a ticket off it when a question must be
  answered first — revoking only ever reduces its own autonomy. Everything it finds on its own is
  filed as `Proposed` for you to judge.
- **Merging needs all three of** an approving review, green CI, and zero unresolved threads. No
  field authorises a merge.
- **Assignment gates attention.** If it is not assigned to the bot, the bot does not touch it.

Ceilings in `loop-config.json` bound what one run can spend — a cloud session cannot read your
remaining quota, so spend is rationed by work-item counts rather than token math. The Sunday
reflection survey proposes adjustments to those numbers as a PR, so the loop tunes itself through the
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
| `prAllowlistGlobs` | Where a **ticketless** PR may be opened (dep bumps, doc fixes, type re-syncs). `**` in `claude-workflow`, where the PR body is itself the proposal. Everywhere else, ticket work is gated on `Stage: Implement` instead. |
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

**[`AGENTS.md`](AGENTS.md) is the contributor guide** (`CLAUDE.md` is a symlink to it) — what is
hazardous about editing a repo whose `main` branch is consumed live, the layout, and the
conventions for skills and hooks.

## Licence

MIT
