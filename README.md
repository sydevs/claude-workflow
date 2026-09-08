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
| `/workflow:triage-issue` | The metadata rules — type, Priority, Effort, `Blocked by:` and `Re-check:` markers, body format. |
| `/workflow:implement-issue` | Implement an authorised ticket in a worktree, open a draft PR through `finalize-pr`, push, end. |
| `/workflow:finalize-pr` | Simplify, review, security-review, lean-gate, sync docs, push, open the PR as a draft. Never waits, never merges. |
| `/workflow:cross-repo-issue` | File a cross-repo change as one tracking issue plus linked children, in dependency order. |
| `/workflow:dev-server` | One dev server per **git worktree**, with its own port and database. |
| `/workflow:handler-preflight` | Ground rules and run start for every dispatched handler: identity, the record, the lock. |
| `/workflow:handler-journal` | The run's journal comment, then the unlock — the closing step of every handler. |
| `/workflow:address-review` | Answer every open thread on one PR: adopt with a commit, or rebut with evidence. |
| `/workflow:fix-ci` | One fix commit for a red CI run on a bot PR, then push. |
| `/workflow:resolve-conflicts` | Merge `main` into a conflicting bot PR, resolve from both sides' intent, push. |
| `/workflow:adversarial-review` | An advisory, critic-side COMMENT review of one bot PR, once per PR. The human approves. |
| `/workflow:revise-ticket` | A deep pass: expand a ticket from the codebase, per the human's instruction. |
| `/workflow:split-ticket` | Split a ticket into ordered children with `Blocked by:` lines. |
| `/workflow:answer-ticket` | Answer a question on a ticket from source. Never pushes. |
| `/workflow:survey-routine` | The nightly survey. Via `sydevs-survey-nightly`. |
| `/workflow:survey-deps` | Monday: vulnerabilities become PRs. Routines update monthly. |
| `/workflow:survey-sentry` | Tuesday: production errors become tickets. |
| `/workflow:survey-analysis` | Wednesday: one rotating angle on the codebase, as proposals. |
| `/workflow:survey-contracts` | Thursday: check published contracts against reality. |
| `/workflow:cut-release` | Friday: tag, update the changelog, cut a Release. |
| `/workflow:reflect` | Sunday: grade last week, read the journals, report usage, refine the profile, propose loop changes. |
| `/workflow:work-routine`, `preflight`, `journal` | **Legacy** — the hourly ladder. Unused once `BOT_DISPATCH` is `on`. Deleted after the cutover. |

Plus four hooks: `block-generated-files`, `block-wrong-bash`, `prettier-format`, `eslint-fix`.

## The loop

Nothing runs on a clock. **GitHub Actions observes every event, classifies it, and fires one
cloud session per unit of work.** A reusable workflow, `dispatcher.yml`, is called by a thin
`workflow-state.yml` in each of the five repos. Sessions do judgement only. They push and end.
Everything an event determines — merge, mark ready, board Status, the `awaiting` label, Sentry
resolve, unblocking — is mechanical and free.
(why: docs/why.md#actions-observes-classifies-locks-and-fires)

**You start work with a verb.** On an issue, a comment from a `respondTo` human:
`@sydevs-bot implement`, `revise`, `split`, or `answer` (case-insensitive, unknown → `answer`).
Nothing happens on an issue without a mention. On a bot PR, any review, comment, or thread reply
from you dispatches `address-review` with no mention needed. `@sydevs-bot review` asks for a
second adversarial review.

**One label, `bot:working`, is the lease.** Actions applies it before it fires. The session
removes it as its last write. A comment that lands while the lock is held is not lost — the
dispatcher re-derives on unlock. (why: docs/why.md#the-lock-label-is-the-lease)

**A bot PR's life is a chain of events**: draft → CI green → adversarial review (one COMMENT
review, skipped under `review.skipWhen`) → `address-review` adopts or rebuts each thread → CI
green → **ready + reviewer requested** → your approval → squash merge. Red CI fires `fix-ci`, at
most `ciFixIterations` times. An approved PR with conflicts gets `resolve-conflicts`, then merges
on the next green run. Nobody waits for CI, ever. (why: docs/why.md#push-and-end)

**Labels say whose turn it is. Status says where it sits.**

| Marker | Means | Writer |
| --- | --- | --- |
| `awaiting` | Your turn. | Actions only |
| `bot:working` | A session holds it. Its status comment names the handler and links the session. | Actions applies, the session removes |
| `stuck` | The machinery owes a retry — usage limit, paused routines, a dead session. Nothing needed from you yet. | Actions only |
| `blocked` | An open `Blocked by:` target, or a `Re-check:` date still ahead. Cleared with a mention. | Actions only |
| `proposal` | Bot-filed, no verdict yet. | Actions only |
| Status `Proposed` / `Revising` / `Approved` / `Done`, none = backlog | The board column. | Actions only |

**There is no WIP cap.** Every session follows a human's verb or a human's event, so the person
typing is the throttle. Each day's journal issue carries a usage tally, and the Sunday reflection
reports usage back as feedback. (why: docs/why.md#there-is-no-wip-cap)

**Three properties keep it safe to leave running:**

- **Only a `respondTo` human's `@sydevs-bot implement` authorises code.** Not a field, not a drag
  on the board, not a request in prose.
- **A merge needs all three:** your approving review, green CI, and zero unresolved threads.
  `loopMayNotMerge` repos never auto-merge.
- **Nothing is lost in an outage.** A fire that fails, or a session that dies, leaves the item
  `stuck`. A 30-minute Actions sweeper retries up to `dispatch.maxAttempts`, then hands it to you
  as `awaiting`. Pausing the routines in the UI is the only kill switch, and it is global.

State lives entirely in GitHub. A daily `ops-journal` issue is the memory: one comment per
session, one line per dispatcher anomaly, the counts in the title. `loop-config.json` holds the
knobs. The Sunday reflection proposes changes to them as a PR, so the loop tunes itself through
the same review path as everything else.

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
| `prAllowlistGlobs` | Where a **ticketless** PR may open (dep bumps, doc fixes, type re-syncs). `**` here, since the PR body is the proposal. Elsewhere, ticket work needs a human's `@sydevs-bot implement`. |
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
