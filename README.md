# claude-workflow

The shared [Claude Code](https://claude.com/claude-code) workflow for the
[sydevs](https://github.com/sydevs) projects — one issue-to-PR pipeline for
**SahajCloud**, **SahajAtlasWeb**, **WeMeditateWeb**, and **SahajAtlasWordpress**.

## Why this exists

The four product repos once kept separate copies of the same workflow skills, held to a spec
requiring byte-for-byte matches. They did not match. By the time this plugin was written, the
copies had drifted 90–250 lines apart, and steps had different names in each repo. Even the audit
meant to catch the drift compared against a directory that no longer existed.

The cause was not discipline — prose copied three times cannot stay in sync. So per-repo
differences now live as data: one `.claude/workflow.json` per repo, and one copy of each skill.

## Install

```bash
/plugin marketplace add sydevs/claude-workflow
/plugin install workflow@sydevs
```

Each repo also declares the marketplace in `.claude/settings.json`, so a fresh clone can install it
once the folder is trusted:

```json
{
  "extraKnownMarketplaces": {
    "sydevs": { "source": { "source": "github", "repo": "sydevs/claude-workflow" } }
  },
  "enabledPlugins": { "workflow@sydevs": true }
}
```

`enabledPlugins` must be an **object map**, not an array. The array form installs the plugin, then
reports it `disabled`, with no error. This looks like a working install until you run
`claude plugin list`.

Project settings register the marketplace but do not auto-install a plugin from an external source,
so each person runs `claude plugin install` once.

## What it provides

| Skill | Purpose |
| --- | --- |
| `/workflow:draft-ticket` | Draft a GitHub issue: clarify ambiguity, then write acceptance criteria and a checklist. |
| `/workflow:triage-issue` | The metadata rules — type, Priority, Effort, Stage, Hold Until, assignment, relationships, body format. |
| `/workflow:implement-issue` | Implement a `Stage: Implement` issue in a worktree, then ship it via `finalize-pr`. |
| `/workflow:finalize-pr` | Simplify, review, security-review, lean-gate, sync docs, push, open the PR, poll CI. Never merges. |
| `/workflow:cross-repo-issue` | File a cross-repo change as one tracking issue plus linked children, in dependency order. |
| `/workflow:dev-server` | One dev server per **git worktree**, with its own port and database. |
| `/workflow:work-routine` | The working-day ladder: merge, revise, implement, adversarially review. Hourly, via `sydevs-work-hourly`. |
| `/workflow:survey-routine` | The nightly survey plus reconciliation sweeps. Via `sydevs-survey-nightly`. |
| `/workflow:preflight` | Ground rules and run start, shared by both run skills. |
| `/workflow:journal` | The run's journal entry and ending, shared by both run skills. |
| `/workflow:survey-deps` | Monday: vulnerabilities become PRs. Routines update monthly. |
| `/workflow:survey-sentry` | Tuesday: production errors become tickets. |
| `/workflow:survey-analysis` | Wednesday: one rotating angle on the codebase, as proposals. |
| `/workflow:survey-contracts` | Thursday: check published contracts against reality. |
| `/workflow:cut-release` | Friday: tag, update the changelog, cut a Release. |
| `/workflow:reflect` | Sunday: read the journal and review activity, refine the profile, propose loop changes. |
| `/workflow:adversarial-review` | An advisory, critic-side pass on one loop-authored PR, always fresh-context. The human approves. |

Plus four hooks: `block-generated-files`, `block-wrong-bash`, `prettier-format`, `eslint-fix`.

## The loop

Two scheduled cloud routines cover all five repos, each with its own run skill bracketed by
`preflight` and `journal`. `sydevs-work-hourly` runs `work-routine` on an hourly-then-two-hourly
cadence. It climbs a ladder of rungs, ordered by urgency:

1. Merge what you approved.
2. Revise what you commented on.
3. Implement what you cleared.
4. Adversarially review what it built.

`sydevs-survey-nightly` runs `survey-routine` once nightly, with no ladder — just the day's survey
and the unheard-replies sweep. It stays separate so it always runs, even on a busy queue. State
lives entirely in GitHub: **the assignee field is the queue**, PRs are the work, a daily issue is
the memory, `loop-config.json` holds the knobs.

**The baton.** `assignee:sydevs-bot` is the worklist. **Only you assign it**, and it stays assigned
until you take it back, so assignment answers one question: *is this the loop's to touch*. The
loop's one write is removing itself once a PR exists. Unassign the bot on anything and it stops
touching that thing — a per-item kill switch needing no documentation.

**One label, `awaiting`, marks what needs you.** It covers issues and PRs alike. A GitHub workflow,
not the loop, maintains it from events, so it appears the moment a PR is ready and clears the moment
you reply. Filter any board view by `label:awaiting` for your queue.

**Two org-level issue fields name the kind of turn it is:**

| `Stage` | Means |
| --- | --- |
| `Proposed` | Filed, awaiting your verdict |
| `Revising` | Being worked out — whoever commented last has the turn |
| `Blocked` | Parked, with a `Hold Until` date saying when it comes back |
| `Implement` | You cleared it for code |
| `Implemented` | A PR is in flight |

`Hold Until` is a date. While it is in the future, the item stays hidden, even from the journal,
because the loop has already promised to look again that day.

**A PR has no fields, so its `draft` flag marks its turn.** The loop opens every PR as a draft and
clears the flag once CI is green. Draft means it is still working. Ready-for-review means it is your
turn. The loop finds its own PRs by `author:sydevs-bot`. It never writes an assignee on one. That
frees a PR's assignee to mean the opposite: **assign the bot to a PR it did not write, and it works
on that PR.**

Three properties keep it safe to leave running:

- **`Stage: Implement` is the only code gate**, and only you can set it. The loop never writes that
  value, and never implements without it. It may move a ticket off `Implement` when a question needs
  an answer first — revoking only ever reduces its own autonomy. Everything else it finds is filed
  as `Proposed`, for you to judge.
- **A merge needs all three:** an approving review, green CI, and zero unresolved threads.
- **Assignment gates attention.** Unassigned from the bot means untouched by the bot.

`loop-config.json` sets ceilings on what one run can spend, since a cloud session cannot read its own
remaining quota. The Sunday reflection survey proposes changes to those numbers as a PR, so the loop
tunes itself through the same review path as everything else.

## Configuration

Everything repo-specific comes from `<repo>/.claude/workflow.json`:

| Key | Meaning |
| --- | --- |
| `packageManager` | Used by the hooks and any constructed command. |
| `leanGate.command` / `.full` | The pre-PR test gate. |
| `contractStep` | Migrations, `types:cms`, or the URL-contract diff. |
| `securityReview.triggerPattern` | Paths that trigger a branch-level security review. |
| `securityReview.contentPattern` / `.contentPaths` | Newly introduced sinks, regardless of path. |
| `generatedFiles` | `{ pattern, reason }` rules for `block-generated-files`. |
| `prAllowlistGlobs` | Where a **ticketless** PR may open (dep bumps, doc fixes, type re-syncs). `**` here, since the PR body is the proposal. Elsewhere, ticket work needs `Stage: Implement`. |
| `worktreeSetup` | Commands run after `EnterWorktree`. |
| `devServer` | `command`, `basePort`, `healthPath`, and optional database isolation. |

## Deliberately not here

A few things were dropped rather than ported, because something maintained elsewhere already covers
them:

- **Code review** → the official `pr-review-toolkit` plugin (six specialist agents), instead of one
  hand-rolled pass.
- **Security review** → the built-in `/security-review` plus the official `security-guidance`
  plugin. Both catch issues at edit time.
- **Type checking on edit** → the official `typescript-lsp` / `php-lsp` plugins. A language server
  reports diagnostics in the same turn as the edit. The old `typecheck` hook could not.
- **Session reflection** → the official `claude-md-management` plugin.
- **The `pr-prep` skill** → `workflow.json.leanGate`, pointing at each repo's own `check.sh`. The
  skill only wrapped that call.

`prettier-format` and `eslint-fix` survive because they *rewrite* files. No language server does
that.

## Bootstrap on a new account

**[docs/routine-setup.md](docs/routine-setup.md)** covers every dashboard, identifier, and gotcha,
in dependency order: GitHub metadata, Mailpit on Railway, the Sentry integration, the Claude cloud
environment, then the routines themselves. It is written so you can rebuild the loop from nothing,
on a different Claude account.

## Development

```bash
claude --plugin-dir ./workflow    # load without installing
claude plugin validate ./workflow --strict
```

**[`AGENTS.md`](AGENTS.md) is the contributor guide** (`CLAUDE.md` symlinks to it). It covers what
is hazardous about editing a repo whose `main` branch runs live, the file layout, and the
conventions for skills and hooks.

## Licence

MIT
