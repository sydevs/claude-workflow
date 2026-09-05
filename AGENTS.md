# claude-workflow — contributor guide

Guidance for AI coding agents — Claude Code, OpenAI Codex, Cursor, and other AGENTS.md tools —
working in this repository.

> `CLAUDE.md` is a symlink to this file, so both tool ecosystems read one guide that cannot drift
> — the same pattern SahajCloud, WeMeditateWeb, and SahajAtlasWordpress use.

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
| The two scheduled cloud routines | `loop-config.json` and the skills fresh from `main` on every run — see `deployTarget` in [.claude/workflow.json](.claude/workflow.json) | **Next run.** Genuinely live. |
| `/plugin install workflow@sydevs` | The commit that `main` pointed at **when it was installed**, cached under `~/.claude/plugins/cache/sydevs/workflow/<version>/` | **Never**, until `version` in `workflow/.claude-plugin/plugin.json` changes or the maintainer runs `/plugin` → update. |

So a merge's blast radius is *the next run of the routines* — **nothing else**. There is no
rollback except another PR. A routine may fire before you finish writing one.

⚠ **The installed plugin is pinned by commit and keyed by version.** `installed_plugins.json`
records a `gitCommitSha` and never revisits it. The cache directory is named after `version`, so an
unchanged version string keeps the old cache, however far `main` has moved. `version` is **not**
decorative here: it is the one thing a skill change must always update.
(why: docs/why.md#an-installed-plugin-does-not-track-main)

### ⚠ You cannot test a change by running it

A skill edit takes effect on the **next** session, never the current one — the skill body is
already loaded in context. The usual "make it, run it, see it work" loop does not exist here.

- **Prefer small, reversible edits.** One behaviour per PR.
- **Never ship a skill change and a ceiling change in the same PR.** If the next run behaves
  oddly, you need to know which change caused it.
- **State the failure the change prevents, in the PR body.** That reasoning is the only evidence
  available before merge.

### ⚠ The journal lives here too

`claude-workflow` is both a worked repo and the home of the loop's daily journal: issues carrying
the `ops-journal` label (`labels.journal` in `loop-config.json`). Journal issues are a diary,
never work. Any worklist query must exclude them (`-label:ops-journal`), or the loop treats its
own entries as tickets. Check this exclusion in every query you add to a skill.

## The gate

```bash
claude plugin validate ./workflow --strict     # leanGate.command
claude --plugin-dir ./workflow                 # load the plugin without installing it
```

**That validator is the entire automated gate for the plugin's prose** — there is no test suite or
CI here. It checks only the plugin manifest and skill frontmatter, never whether the prose is
*right*, because the skills are prose.

⚠ **`.github/workflows/` exists, and it is not CI.** It holds `state-machine.yml` — the reusable
workflow that owns every mechanical `Stage`, assignee, and `awaiting` transition for all five
repos, plus this repo's own thin caller. Editing it changes behaviour in every sydevs repo on the
next event, with no merge anywhere else, so it carries a skill's blast radius and rule: one
behaviour per PR, stating what failure the change prevents.
(why: docs/why.md#the-state-machine-is-not-the-loops-job)

The real gate is a **supervised loop run**: `/workflow:work-routine --dry-run` locally, or a
manually fired routine whose journal entry and transcript you then read (`docs/routine-setup.md`
§6). A green run status means only that no infrastructure error occurred — task-level failures
appear only in the transcript.

## No package manager

There is no `package.json`, lockfile, `node_modules`, or anything to install. The hooks are plain
node `.mjs` files that Claude Code runs directly, so they may use **only** the node standard
library. `packageManager` is `"none"` in `.claude/workflow.json` — the shared hooks read that key
to name the right command, and here there is none to name.

Do not add a dependency. If a hook needs something outside `node:*`, that is a sign it does too
much.

## Layout

| Path | Holds |
| --- | --- |
| `workflow/skills/<name>/SKILL.md` | One skill each — frontmatter plus prose. The README table lists them. |
| `workflow/hooks/*.mjs` | The four hooks, wired in `workflow/hooks/hooks.json`, sharing `hooks/lib/workflow-config.mjs`. |
| `workflow/lib/*.mjs` | Shared by the skills' scripts — `config.mjs` (config lookup, argv) and `merge-gate.mjs` (the one definition of "green" and "mergeable"). |
| `workflow/skills/<name>/*.mjs` | A skill's own scripts. Run with `${CLAUDE_PLUGIN_ROOT}/skills/<name>/<script>`. **None of them fetch** — see below. |
| `workflow/.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` | The plugin manifest, and the **marketplace** manifest one level up. Both must be valid for an install to work. |
| `loop-config.json` | Every **value** the loop reads: `ceilings`, `labels`, `assignment`, `issueFields`, `projects`, `stateMachine`, `mergePolicy`, `identity`, `surveyCalendar`, `sentry`, `journal`. Read fresh from `main` each run. |
| `.github/workflows/state-machine.yml` | The mechanical state machine, called by all five repos. **Not CI** — see the warning above. |
| `.claude/workflow.json` | This repo's own per-repo **values**, same shape as every product repo, same rule as `loop-config.json`. |
| `docs/routine-setup.md` | Bootstrapping the loop on a new Claude account, in dependency order. |
| `docs/why.md` | The failure behind each rule, one heading per rule. Skills cite it as `(why: docs/why.md#anchor)`. |

### ⚠ A skill's length is a running cost

`preflight`, `work-routine`, `journal`, and `loop-config.json` are read on **every** run — about
9,250 tokens, eleven times a day. A paragraph added to any of them is paid for daily, forever.
Before you add prose to a run-loaded skill, check the rule is not stated elsewhere already. Put
the story in `docs/why.md`, behind an anchor. (why: docs/why.md#the-rules-cost-more-than-the-output)

Everything the loop writes carries a character budget from `writing.budgets`, checked by
`workflow/lib/budget.mjs`, `<details>` included.

**Run `rule-delta.mjs` on any PR that rewrites a skill**, and say in the body what each removal was:

```bash
node workflow/lib/rule-delta.mjs --base main workflow/skills
```

`ste-lint.py` measures a skill's **style**. `rule-delta.mjs` measures its **content**. A rewrite
can pass the first and fail the second, shrinking and reading cleaner while it drops a rule
outright. Both are development tools, never run steps.
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

## Writing a skill

- **Frontmatter is a security surface.** `allowed-tools` on a `SKILL.md` instructs an agent with
  write access to five repositories. An over-broad line here is this repo's equivalent of an RCE.
  `securityReview.triggerPattern` covers every `SKILL.md` and every hook for that reason. Grant the
  narrowest set that works — compare `cross-repo-issue` (`Bash(gh issue edit:*)`,
  `Bash(gh api:*)`, …) against the pipeline skills that genuinely need `Bash(*)`.
- **`disable-model-invocation: true` unless the skill is a helper.** Every user- or
  routine-invoked skill carries it, so nothing fires on a stray phrase. Only `dev-server` and
  `triage-issue` — both invoked *by* other skills — omit it.
- **Write for one busy reader.** The loop's own writing rules (lead with the outcome, detail in
  `<details>`, no throat-clearing) live in `preflight/SKILL.md` and apply to skill bodies as much
  as to what they emit.
- **The rule lives in the skill. The story lives in [`docs/why.md`](docs/why.md).** `work-routine`
  is re-read about eleven times a day, so length there costs tokens each time and dilutes the
  rules it carries. Move a retrospective justification one hop away: add a heading in
  `docs/why.md` named after the rule, and cite it as `(why: docs/why.md#anchor)`.
  **Never let a story be a rule's only statement.** Check that the instruction survives inline as
  an imperative before you move the narrative.

## Editing a hook

Hooks run in a maintainer's own session with their credentials, on every matching tool call.

- Resolve paths against the **git worktree root**, not `CLAUDE_PROJECT_DIR` — `/implement-issue`
  works in a worktree by default. Use `worktreeRoot()` in `hooks/lib/workflow-config.mjs`, the one
  place that decides this.
- **Never break a session on bad input.** `loadConfig()` returns `{}` for a missing or malformed
  `workflow.json`. `readInput()` returns `null` on anything unparseable. An un-onboarded repo must
  stay usable.
- A blocking hook risks a false positive that costs someone a working session.
  `block-wrong-bash` has already inverted once against the exact cross-repo shape it exists to
  permit (#16). Test the session shapes, not just the happy path.

## ⚠ Protected paths, and why the docs are where they are

Claude Code's **Protected Paths** guard makes any write under `.claude/` require interactive
approval. That guard runs *before* `permissions.allow`, so no allowlist entry can pre-empt it. An
unattended run does not fail on the prompt — it **waits, invisibly**, with no way to detect the
block. One WeMeditateWeb run lost about 75 minutes this way.

That is why documentation lives **outside** `.claude/` in all five repos: this file, the nested
`AGENTS.md` guides in the product repos, and `docs/`. Here the only protected file is
`.claude/workflow.json`. Note that `.claude-plugin/` and `workflow/.claude-plugin/` are *not* under
`.claude/`, and stay freely writable.

When a change genuinely needs `.claude/workflow.json` edited, expect the prompt and do the edit
attended.

## Conventions

- **Use conventional commits.** Derive the scopes in use from `git log --oneline -30` (`loop`,
  `hooks`, `docs`, `fields`, …). The body carries the *reasoning*, on purpose — it is the only
  record a prose change leaves behind.
- **Branches are `claude/*`.** Cloud sessions cannot push anywhere else.
- **Open the PR. Never merge it.** Merge authority means an approving review plus zero unresolved
  threads — never a label. There is no CI here to turn green.
- **No ticket is needed for anything in this repo.** `prAllowlistGlobs` is `**` — open the PR
  directly. This repo ships prose and config, so the PR body *is* the proposal. File a ticket only
  when the change needs a **decision** before code — competing designs, or a cost worth agreeing
  on before it is paid.
- Merge authority is still **an approving review**, and `wipCapPerRepo` still bounds how many loop
  PRs may be open here at once. Both rules above — one behaviour per PR, never a skill change and
  a ceiling change together — bind harder now that nothing upstream forces a pause.
