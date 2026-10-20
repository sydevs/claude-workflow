# claude-workflow — contributor guide

[`README.md`](README.md) explains what the plugin *is* and what each skill does. Read it first.
This file covers only what is dangerous or surprising about **editing** this repo.

## What makes this repo different from the other four

The other four sydevs repos ship a product. This one ships **the instructions the agent is running
right now**, to all five repos, including itself.

### ⚠ Merging to `main` IS the deploy

There is no release step or artifact. But "consumed live" is true for only one consumer, and the
gap has already cost a maintainer eight days of stale skills:

| Consumer | Reads | A merge reaches it |
| --- | --- | --- |
| The cloud routines — one per repo, fired by the dispatcher, plus the nightly audit's | `loop-config.json` and the skills fresh from `main` on every run — see `deployTarget` in [.claude/workflow.json](.claude/workflow.json) | **Next run.** Genuinely live. |
| `/plugin install workflow@sydevs` | The commit that `main` pointed at **when it was installed**, cached under `~/.claude/plugins/cache/sydevs/workflow/<version>/` | **Never**, until `version` in `workflow/.claude-plugin/plugin.json` changes or the maintainer runs `/plugin` → update. |

So a merge's blast radius is *the next run of the routines* — **nothing else**. There is no
rollback except another PR. A routine may fire before you finish writing one.

⚠ **The installed plugin is pinned by commit and keyed by version.** `installed_plugins.json`
records a `gitCommitSha` and never revisits it. The cache directory is named after `version`, so an
unchanged version string keeps the old cache, however far `main` has moved. `version` is **not**
decorative here: it is the one thing a skill change must always update.
(why: docs/why.md#an-installed-plugin-does-not-track-main)
`.claude-plugin/marketplace.json`, one level above `workflow/`, must stay valid alongside
`plugin.json`, or an install fails.

### ⚠ You cannot test a change by running it

A skill edit takes effect on the **next** session, never the current one — the skill body is
already loaded in context. The usual "make it, run it, see it work" loop does not exist here.

- **Prefer small, reversible edits**, and default to one behaviour per PR. That is a default,
  not a prohibition. Ship related changes together when each stays separately revertable — one
  commit per behaviour, each named in the PR body — and say in the body why they belong in one
  PR. A change too small to be worth its own review round is not worth splitting.
- **The one hard split: never ship a skill change and a ceiling change in the same PR.** Both
  move the next run's output in the same direction, so a combined PR leaves you unable to say
  which one did it — and you cannot re-run to find out.
- **State the failure the change prevents, in the PR body.** That reasoning is the only evidence
  available before merge.

### ⚠ The journal lives here too

`claude-workflow` is both a worked repo and the home of the loop's daily journal: issues carrying
the `ops-journal` label (`labels.journal` in `loop-config.json`). Journal issues are a diary,
never work. Any worklist query must exclude them (`-label:ops-journal`), or the loop treats its
own entries as tickets. Check this exclusion in every query you add to a skill.

## The gate

**`claude plugin validate`, the first half of `leanGate.command`, is the entire automated gate
for the plugin's prose** — there is no CI here. It checks only the plugin manifest and skill
frontmatter, never whether the prose is *right*, because the skills are prose. The lib suite, its
second half, tests the `workflow/lib/` scripts that own mechanical rules. It must pass from the
checkout **and** from a `.claude/worktrees/<slug>` worktree, because `implement-ticket` runs the
gate from one.

⚠ **`.github/workflows/` exists, and it is not CI.** It holds `dispatcher.yml` — the reusable
workflow that observes every GitHub event in all five repos, classifies it, locks the item, fires
the cloud session, and does every mechanical write — plus this repo's own thin caller. Editing it
changes behaviour in every sydevs repo on the next event, with no merge anywhere else, so it
carries a skill's blast radius and the same rules: keep the edit small and reversible, and state
what failure it prevents. `dispatcher/` beside it is the code, with
`node --test dispatcher/test/*.test.mjs` as its gate.
(why: docs/why.md#actions-observes-classifies-locks-and-fires)

One file there **is** CI, for the other four: `dependency-review.yml`, which each product repo's
own CI calls and whose `Dependency Review / review` check their rulesets require. A broken edit to
it blocks every merge in four repos at once.
(why: docs/why.md#dependency-review-checks-what-a-pr-adds)

The real gate is a **supervised dispatch**: `BOT_DISPATCH=dry` logs every plan without writing,
and a scratch `@sydevs-bot revise …` watched end to end (`docs/routine-setup.md` §6). A green
workflow run means only that no infrastructure error occurred — task-level failures appear only
in the session transcript and its journal comment.

## No package manager

The hooks are plain node `.mjs` files that Claude Code runs directly, so they may use **only**
the node standard library.

Do not add a dependency. If a hook needs something outside `node:*`, that is a sign it does too
much.

## ⚠ A skill's length is a running cost

`start-run`, `finish-run`, the handler's own skill, and `loop-config.json` are read
on **every** dispatch — 25 to 40 times a day. A paragraph added to any of them is paid for on
every one, forever.
Before you add prose to a run-loaded skill, check the rule is not stated elsewhere already. Put
the story in `docs/why.md`, behind an anchor. (why: docs/why.md#the-rules-cost-more-than-the-output)

Everything the loop writes carries a character budget from `writing.budgets`, checked by
`workflow/lib/budget.mjs`, `<details>` included. That script also decides whether a comment
carries `identity.commentMarker`, from `writing.markerRequired`. Read the verdict word it prints,
never its exit code. (why: docs/why.md#a-verdict-word-not-an-exit-code)

**Run `rule-delta.mjs` on any PR that rewrites a skill**, and say in the body what each removal was:

```bash
node workflow/lib/rule-delta.mjs --base origin/main workflow/skills
```

`ste-lint.py` measures a skill's **style**. `rule-delta.mjs` measures its **content**. A rewrite
can pass the first and fail the second, shrinking and reading cleaner while it drops a rule
outright. Neither is part of the automated gate — `leanGate.command` alone — but both are run
steps: `improve-loop` runs `rule-delta.mjs` on a skill edit, `audit-code` runs
`ste-lint.py --json` on its comments angle.
(why: docs/why.md#lint-measures-style-not-content)

**Nothing in a skill hard-codes a number or a label name.** Those values come from
`loop-config.json` on purpose, so a tuning change stays a data edit, reviewable on its own. Move a
threshold there instead of typing it into a `SKILL.md`.

**And nothing but values goes in `loop-config.json`.** Three homes, no overlap: the **value** here,
the **rule** in the skill that enforces it, the **story** in `docs/why.md`. A `$comment` earns its
place only when a bare value is unclear alone, and then in one line.

**Scripts, not prose, own mechanical rules.** No script here talks to GitHub — a routine cannot
reach the API by any client, with any credential, so the run gathers data with MCP and a script
only decides, on JSON piped to stdin. (why: docs/why.md#a-routine-cannot-reach-the-github-api)
`workflow/lib/merge-gate.mjs` and the scripts under `skills/*/` exist for the same reason: a
computation re-derived nine times a day is nine chances to derive it differently. Evaluate a rule
wherever a rule can be evaluated. (why: docs/why.md#a-script-here-never-fetches)

A skill runs its own script as `${CLAUDE_PLUGIN_ROOT:-<claude-workflow>/workflow}/skills/<name>/<script>`:
a routine has no `CLAUDE_PLUGIN_ROOT`, and reads the skills from the checkout.

## Writing a skill

Read [`workflow/skills/AGENTS.md`](workflow/skills/AGENTS.md) before you edit a skill.

## Editing a hook

Read [`workflow/hooks/AGENTS.md`](workflow/hooks/AGENTS.md) before you edit a hook.

## ⚠ Protected paths, and why the docs are where they are

Claude Code's **Protected Paths** guard never auto-approves a write to a small set of files and
directories. It runs *before* `permissions.allow`, so no allowlist entry pre-empts it — not in a
repo's `.claude/settings.json`, and not in a routine's `allowed_tools`. In an unattended run the
write is **prompted**, and the prompt does not fail: the session waits until its lease expires,
having written nothing. One WeMeditateWeb run lost about 75 minutes this way, and six consecutive
runs later stalled on `.npmrc` for WeMeditateWeb#97.

**The set is much wider than `.claude/`**, and that is the part that keeps catching runs out. The
authoritative list is in [Claude Code's docs](https://code.claude.com/docs/en/permission-modes#protected-paths).
What bites this org:

- **Package-manager config** — `.npmrc`, `.yarnrc`, `.yarnrc.yml`, `.pnpmfile.cjs`, `bunfig.toml`
- **Git config** — `.gitconfig`, `.gitmodules`, and the `.git` and `.config/git` directories
- **Hook and tooling config** — `.pre-commit-config.yaml`, `lefthook.*`, `.husky/`, `.bazelrc`
- **Claude's own config** — `.mcp.json`, `.claude.json`, and `.claude/`
- Shell rc files, `.devcontainer/`, `.vscode/`, `.idea/`, `.cargo/`, `.yarn/`, `.mvn/`

**`.claude/worktrees` is exempt.** `git worktree add .claude/worktrees/<slug>`, and every edit
inside that worktree, are ordinary writes. `implement-ticket` step 6 is correct as written, and
`--no-worktree` is not a workaround for this guard. Several past runs took it believing otherwise,
and journalled the belief as fact.

Documentation still lives **outside** `.claude/` in all five repos — this file, the nested
`AGENTS.md` guides in the product repos, and `docs/` — because the rest of `.claude/` really is
protected. Here the only protected file is `.claude/workflow.json`. Note that `.claude-plugin/` and
`workflow/.claude-plugin/` are *not* under `.claude/`, and stay freely writable.

When a change genuinely needs a protected path edited, expect the prompt and do the edit attended.
A handler that finds one in its way hands the ticket back rather than attempting the write — see
`start-run`.

## Conventions

- **Use conventional commits.** Derive the scopes in use from `git log --oneline -30`. The body
  carries the *reasoning*, on purpose — it is the only record a prose change leaves behind.
- **Branches are `claude/*`.** Cloud sessions cannot push anywhere else.
- **Open the PR. Never merge it.** This repo is `loopMayNotMerge`: merging it is the deploy, so
  no auto-merge is armed here and no queue runs. You merge it, deliberately.
- **No ticket is needed for anything in this repo.** `prAllowlistGlobs` is `**` — open the PR
  directly. This repo ships prose and config, so the PR body *is* the proposal. File a ticket only
  when the change needs a **decision** before code — competing designs, or a cost worth agreeing
  on before it is paid.
- There is no WIP cap — the human who types the verb is the throttle. The skill/ceiling split
  above binds harder now that nothing upstream forces a pause, and a PR carrying more than one
  behaviour still owes one commit per behaviour.
