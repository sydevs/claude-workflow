# claude-workflow — contributor guide

Guidance for AI coding agents — Claude Code, OpenAI Codex, Cursor, and other
AGENTS.md-compatible tools — working in this repository.

> `CLAUDE.md` is a symlink to this file, so both tool ecosystems read one guide that cannot
> drift. This matches SahajCloud, WeMeditateWeb and SahajAtlasWordpress.

[`README.md`](README.md) explains what the plugin *is* and what each skill does — read it first,
and do not restate it here. This file covers only what is dangerous or surprising about **editing**
this repo.

## What makes this repo different from the other four

The other four sydevs repos ship a product. This one ships **the instructions the agent is running
right now**, to all five repos including itself. Everything below follows from that.

### ⚠ Merging to `main` IS the deploy

There is no release step, no version bump that matters, no artifact. `main` is consumed live:

- the two scheduled cloud routines read `loop-config.json` and the skills fresh from `main` on every
  run — see `deployTarget` in [.claude/workflow.json](.claude/workflow.json);
- `/plugin install workflow@sydevs` installs from `main` via
  [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json).

So the blast radius of a merge is *the next run of everything*. There is no rollback other than
another PR, and a routine may fire before you have written it.

### ⚠ You cannot validate a change by running it

A skill edit takes effect on the **next** session, never the current one — the loaded skill body is
already in context. So the usual "make the change, run it, see it work" loop does not exist here.
The consequences:

- **Prefer small, reversible edits.** One behaviour per PR.
- **Never ship a skill change and a ceiling change in the same PR.** When the next run behaves
  oddly, you need to know which one did it.
- **Reason about the failure the change prevents**, and say so in the PR body. That reasoning is the
  only evidence available before merge.

This rule lived here *and* in `.claude/workflow.json`, with an instruction to keep the two copies in
agreement — which is a maintenance task the values-only rule below exists to abolish. The copy is
gone; this is the statement.

### ⚠ The journal lives here too

`claude-workflow` is both a worked repo *and* the home of the loop's daily journal — issues carrying
the `ops-journal` label (`labels.journal` in `loop-config.json` — the only label the loop reads, now
that ticket state lives in the `Stage` and `Hold Until` fields). They are a diary, never work. Any
query that builds a worklist must exclude them (`-label:ops-journal`), or the loop picks up its own
entries as tickets. If you add a query anywhere in a skill, check it carries the exclusion.

## The gate

```bash
claude plugin validate ./workflow --strict     # leanGate.command
claude --plugin-dir ./workflow                 # load the plugin without installing it
```

**That validator is the entire automated gate for the plugin's prose.** There is no test suite and
no CI for it.

⚠ **`.github/workflows/` now exists, and it is not CI.** It holds
`state-machine.yml` — the reusable workflow that owns every mechanical `Stage`, assignee and
`awaiting` transition for all five repos — plus this repo's own thin caller. The old "no workflows
here at all" rule was a consequence of having nothing to test; it stopped being true when this repo
started shipping *automation* alongside prose. Editing `state-machine.yml` changes behaviour in
every sydevs repo on the next event, with no merge anywhere else, so it carries the same blast
radius as a skill and the same rule: one behaviour per PR, and say what failure the change prevents.
(why: docs/why.md#the-state-machine-is-not-the-loops-job) `validate` checks the plugin manifest and the skill frontmatter;
it cannot check whether the prose is *right*, because the skills are prose.

The real gate is a **supervised loop run**: `/workflow:work-routine --dry-run` locally, or a manually
fired routine whose journal entry *and* transcript you then read. `docs/routine-setup.md` §6
describes the supervised-bootstrap procedure, and its warning generalises — a green run status only
means no infrastructure error; task-level failures appear only in the transcript.

## No package manager

There is no `package.json`, no lockfile, no `node_modules`, and nothing to install. The hooks are
plain node `.mjs` files that Claude Code executes directly, so they may use **only** the node
standard library. `packageManager` is `"none"` in `.claude/workflow.json` — the shared hooks read
that key to name the right command, and here there is no right command to name.

Do not add a dependency. If a hook needs something it cannot get from `node:*`, that is a signal the
hook is doing too much.

## Layout

| Path | Holds |
| --- | --- |
| `workflow/skills/<name>/SKILL.md` | One skill each — frontmatter plus prose. The README table lists them. |
| `workflow/hooks/*.mjs` | The four hooks, wired in `workflow/hooks/hooks.json`, sharing `hooks/lib/workflow-config.mjs`. |
| `workflow/lib/*.mjs` | Shared by the skills' scripts — `config.mjs` (config lookup, argv) and `merge-gate.mjs` (the one definition of "green" and "mergeable"). |
| `workflow/skills/<name>/*.mjs` | A skill's own scripts. Run with `${CLAUDE_PLUGIN_ROOT}/skills/<name>/<script>`. **None of them fetch** — see below. |
| `workflow/.claude-plugin/plugin.json` | The plugin manifest. |
| `.claude-plugin/marketplace.json` | The **marketplace** manifest — a different file, one level up. Both must be valid for an install to work. |
| `loop-config.json` | Every **value** the loop reads: `ceilings`, `labels`, `assignment`, `issueFields`, `projects`, `stateMachine`, `mergePolicy`, `identity`, `surveyCalendar`, `sentry`, `journal`. Values only — never rules, never rationale. Read fresh from `main` each run. |
| `.github/workflows/state-machine.yml` | The mechanical state machine, called by all five repos. **Not CI** — see the warning above. |
| `.claude/workflow.json` | This repo's own per-repo **values**, in the same shape every product repo uses. Values only, same rule as `loop-config.json`. |
| `docs/routine-setup.md` | Standing the loop up on a new Claude account, in dependency order. |
| `docs/why.md` | The failure behind each rule, one heading per rule. Skills cite it as `(why: docs/why.md#anchor)`. |

### ⚠ A skill's length is a running cost

`preflight` + `work-routine` + `journal` + `loop-config.json` are read on **every** run — about
9,250 tokens, eleven times a day. A paragraph added to one of those is paid for daily, forever.
Before adding prose to a run-loaded skill, check the rule is not already stated elsewhere, and put
the story in `docs/why.md` behind an anchor. (why: docs/why.md#the-rules-cost-more-than-the-output)

Everything the loop writes carries a character budget from `writing.budgets`, checked with
`workflow/lib/budget.mjs`, counted including `<details>`. `workflow/lib/ste-lint.py` checks register
locally; it is a development tool, never a run step.

**Nothing in a skill hard-codes a number or a label name.** They come from `loop-config.json`, and
that is deliberate — a tuning change should be a data edit reviewable on its own. Keep it that way:
if you find yourself typing a threshold into a `SKILL.md`, add it to `loop-config.json` instead.

**And nothing but values goes in it.** The file once carried 7.9KB of prose in 27 `$comment` and
`*Note` keys — 72% of its bytes — and every one of those rules was *also* stated in a skill or in
`docs/why.md`. That is two sources of truth for every rule, in the repo whose entire failure history
is duplication drifting apart. Three homes, no overlap: the **value** here, the **rule** in the skill
that enforces it, the **story** in `docs/why.md`. A `$comment` earns its place only when a bare value
is ambiguous on sight, and then it is one line.

**No script here talks to GitHub.** A routine cannot reach the API by any client — not `curl`, not
`gh` even after installing it, not with any credential — so a fetching script would run only on a
maintainer's laptop, and a rule with a local implementation and a separate cloud one is precisely the
shape of the bug that made the merge gate unsafe. The run gathers with MCP; the script decides.
Scripts take JSON on stdin and return a verdict. (why: docs/why.md#a-routine-cannot-reach-the-github-api)

**A script beats a prose rule wherever the rule is mechanical.** `workflow/lib/merge-gate.mjs` exists
because the merge gate's table was wrong in two directions at once and nobody could see it; the
scripts under `skills/*/` exist because a computation re-derived nine times a day is nine chances to
derive it differently. Prose is for judgment. If a rule can be evaluated, evaluate it.

## Writing a skill

- **Frontmatter is a security surface.** `allowed-tools` on a `SKILL.md` is an instruction to an
  agent holding write access to five repositories; an over-broad line here is this repo's equivalent
  of an RCE, which is why `securityReview.triggerPattern` covers every `SKILL.md` and every hook.
  Grant the narrowest set that works — compare `cross-repo-issue` (`Bash(gh issue edit:*)`,
  `Bash(gh api:*)`, …) against the pipeline skills that genuinely need `Bash(*)`.
- **`disable-model-invocation: true` unless the skill is a helper.** Every user- or routine-invoked
  skill carries it, so nothing fires on inference from a stray phrase. Only `dev-server` and
  `triage-issue` — both invoked *by* other skills — omit it.
- **Write for one reader who is busy.** The loop's own writing rules (lead with the outcome, detail
  in `<details>`, no throat-clearing) live in `preflight/SKILL.md` and apply to the skill bodies
  themselves as much as to what they emit.
- **The rule lives in the skill; the story lives in [`docs/why.md`](docs/why.md).** `work-routine` is
  re-read on every run — roughly eleven times a day — so length there costs tokens each time *and*
  dilutes the rules it carries. Retrospective justification ("a run once concluded X, wrongly",
  "this cost us a night") earns its keep, but one hop away: add a heading in `docs/why.md` named
  after the rule and cite it as `(why: docs/why.md#anchor)`.
  **Never let a story be a rule's only statement.** Before moving narrative, check that what it
  asks for survives inline as an imperative — if the instruction exists only inside the anecdote,
  write the imperative first, then move the anecdote.

## Editing a hook

Hooks run in a maintainer's own session with their credentials, on every matching tool call.

- Resolve paths against the **git worktree root**, not `CLAUDE_PROJECT_DIR` — `/implement-issue`
  works in a worktree by default. `worktreeRoot()` in `hooks/lib/workflow-config.mjs` is the one
  place that decides this; use it.
- **Never break a session on bad input.** `loadConfig()` returns `{}` for a missing or malformed
  `workflow.json`, and `readInput()` returns `null` on anything unparseable. A repo that has not
  been onboarded must still be usable.
- A blocking hook is a false-positive risk that costs someone a working session. `block-wrong-bash`
  has already inverted once against the exact cross-repo shape it exists to permit (#16) — test the
  session shapes, not just the happy path.

## ⚠ Protected paths, and why the docs are where they are

Claude Code's **Protected Paths** guard makes any write under `.claude/` require interactive
approval, and that guard runs *before* `permissions.allow` — so no allowlist entry can pre-empt it.
An unattended run does not fail on the prompt; it **waits, invisibly**, and cannot perceive that it
is blocked. One WeMeditateWeb run burned ~75 minutes that way.

That is the reason documentation lives **outside** `.claude/` across all five repos: this file, the
nested `AGENTS.md` guides in the product repos, and `docs/`. Here the only protected file is
`.claude/workflow.json` — note that `.claude-plugin/` and `workflow/.claude-plugin/` are *not* under
`.claude/` and are freely writable.

When a change genuinely needs `.claude/workflow.json` edited, expect the prompt and do it
attended.

## Conventions

- **Conventional commits**; derive the scopes actually in use from `git log --oneline -30`
  (`loop`, `hooks`, `docs`, `fields`, …). The body carries the *reasoning* — read a few, they are
  long on purpose, because the reasoning is the only artifact a prose change leaves behind.
- **Branches are `claude/*`.** Cloud sessions cannot push anywhere else.
- **Open the PR; never merge it.** Merge authority is an approving review plus zero unresolved
  threads — never a label, and there is no CI here to be green.
- **No ticket is needed for anything in this repo.** `prAllowlistGlobs` is `**`: open the PR. The
  ticket gate exists so the loop does not write code nobody asked for, and it buys nothing here —
  this repo ships prose and config, so the PR body *is* the proposal, and a ticket restating it only
  adds a round trip before the same reviewer reads the same argument. File one anyway when the change
  needs a **decision** before code: competing designs, or a cost worth agreeing before it is paid.
- What still gates the work is the part that matters, and is unchanged: **merge authority is an
  approving review**, `wipCapPerRepo` bounds how many loop PRs may be open here at once, and the
  two rules above — one behaviour per PR, never a skill change and a ceiling change together — bind
  harder now that nothing upstream forces a pause.
