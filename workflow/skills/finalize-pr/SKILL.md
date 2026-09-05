---
name: finalize-pr
description: Finalize the current branch's PR. Simplify, review, run a conditional security review, run the lean gate, sync docs, push, and open or refresh the PR. Then watch CI with a capped fix loop. User-invoked. Also run by /implement-issue as its final step. Does not run unless explicitly triggered.
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Finalize PR

The reusable **ship pipeline**: take the branch's accumulated local commits and ship them —
simplify → review → conditional security review → lean gate → docs sync → push → open or refresh
the PR → get CI green → report.

Phase 3 of Implement → Adjust → **Finalize**. `/implement-issue` calls this at the end. You also
run it directly once you are happy with a batch of local-only Adjust-phase commits — it turns
un-pushed commits into one pushed PR and one CI run.

Every analysis step delegates to something maintained elsewhere. What stays here — sequencing, the
docs-sync commit, PR create/refresh, and the capped CI loop — is genuinely ours.

Rules here are imperatives. `docs/why.md` in `sydevs/claude-workflow` carries the failure each one
prevents, cited as `(why: …)`.

## Configuration

Read `.claude/workflow.json` from the **worktree root** first. It supplies what used to differ per
repo:

| Key | Used by |
| --- | --- |
| `leanGate.command` / `.full` | Step 4 |
| `securityReview.triggerPattern` | Step 3 — path regex |
| `securityReview.contentPattern` / `.contentPaths` | Step 3 — content regex, for repos gating on newly-introduced sinks rather than paths |
| `packageManager` | Any command you construct |

Never hard-code a repo's gate command, trigger paths, or package manager into this skill.

## Trigger-agnostic

This skill runs from a local session **and** from a GitHub event via `claude-code-action`. Assume
no TTY, no dev server, no populated `.env.local`, and nobody to answer a prompt. Where a step
would prompt, take the non-interactive branch and record the decision in the report instead.

```bash
[ -n "$GITHUB_ACTIONS" ] && NONINTERACTIVE=1
```

The one place this changes behaviour is pre-flight. Locally, unexpected uncommitted changes stop
and ask. On a runner nobody can answer, so abort with the file list rather than commit files
nobody has looked at.

## Invocation

```
/finalize-pr
```

Operates on the current branch, no arguments. The diff under review is always the **whole
branch** — `origin/main...HEAD`, not the last commit. Reuse that range throughout.

## Pipeline

### 0. Pre-flight

```bash
git branch --show-current                 # must NOT be main or a shared branch
git status --short
git rev-list --count origin/main..HEAD
```

- **Abort if on `main`** or any shared branch.
- **Commit pending working-tree changes** — the Adjust phase ends here, so those edits ship too.
  If anything looks unrelated, stop and ask (or abort, non-interactively). Never commit secrets or
  `.env`.
- **Nothing ahead of `origin/main`**, and the PR is already green → say so and exit.

### 1. Simplify

Run `/simplify` over the entire branch diff. Quality only — reuse, simplification, efficiency,
altitude. It does not hunt for bugs.

- Let it apply fixes, review them as one unit, and revert anything undesirable.
- If it changed anything, re-run the lean gate and commit `refactor: simplify per /simplify pass`.
- **Do not edit the same files while `/simplify` runs.** Wait for its report, then read `git diff`
  as one unit. (why: docs/why.md#simplify-fans-out)

### 2. Review — one pass, six lenses

```
/pr-review-toolkit:review-pr all
```

Six specialist agents run over the branch diff with confidence scores: `code-reviewer`,
`pr-test-analyzer`, `silent-failure-hunter`, `type-design-analyzer`, `comment-analyzer`,
`code-simplifier`. This replaces the single dispatched `/code-review` pass. The toolkit runs each
agent in its own context, so the main thread needs no wrapper subagent to stay lean.

Every comment this skill posts to GitHub carries `identity.commentMarker` from `loop-config.json`.

**Triage every finding — judge, do not defer.** A reviewer's finding can be wrong. Verify each
claim against the source before you act on it, and reject it with a stated reason when it does
not hold — including a suggested *simplification*, which can quietly cost something, such as a
"redundant" generic that was carrying type inference. Fix each valid finding in its own commit,
re-run the lean gate, and record dismissals with one-line reasons.

**A clean report must carry its evidence** — it names the files and paths it actually read.
**Treat a clean report with little or no reading as *not yet reviewed***: re-run that lens, or
read the highest-risk paths yourself. (why: docs/why.md#a-clean-review-report-must-carry-its-evidence)

For a deeper pass, the user can run the billed `/code-review ultra` themselves — Claude cannot
launch it.

### 3. Security review — conditional

Gate on `securityReview` from `workflow.json`:

```bash
PATTERN=$(jq -r '.securityReview.triggerPattern' .claude/workflow.json)
git diff --name-only origin/main...HEAD | grep -E "$PATTERN"
```

Where the repo also sets `contentPattern`, check for newly-introduced sinks regardless of path:

```bash
CONTENT=$(jq -r '.securityReview.contentPattern // empty' .claude/workflow.json)
[ -n "$CONTENT" ] && git diff origin/main...HEAD -- $(jq -r '.securityReview.contentPaths[]?' .claude/workflow.json) \
  | grep -E "^\+" | grep -E "$CONTENT"
```

- **Match** → run the built-in `/security-review` over the diff, triage and fix it as in step 2.
  `security-guidance` already flagged issues at edit time. This is the branch-level sweep.
- **No match** → skip, and say so in the report.

### 4. Lean gate

```bash
jq -r '.leanGate.command' .claude/workflow.json | sh
```

Plus any targeted specs for what changed. Fix and re-run on failure. CI runs the full suite on the
PR — that is the real gate. Do not reproduce it locally unless debugging a red run
(`leanGate.full`).

### 5. Docs sync

Documentation ships in the same push as the code it describes. Sweep the branch diff for doc
impact **before** pushing:

```bash
git diff --name-only origin/main...HEAD
grep -rn "<changed setting / env var / command / behaviour>" \
  docs/ AGENTS.md .env.example $(git ls-files '**/AGENTS.md')
```

- **Check every surface that could describe what changed**: the root `AGENTS.md`, each touched
  directory's nested `AGENTS.md`, `docs/`, `.env.example`, deployment docs, and any skill whose
  workflow the change alters. Update what the diff makes stale, and document what it introduces.
- **Grep beyond `.md` and `.json`** — guide-path references hide in `.env`, CSS, test files and
  `.distignore`. (why: docs/why.md#contract-surfaces-are-mandatory)
- **Never edit anything under `.claude/`.** Guides are nested `AGENTS.md` files with a `CLAUDE.md`
  symlink beside each. A docs-sync wanting to edit under `.claude/` signals wrong placement —
  propose the move instead. (why: docs/why.md#documentation-lives-outside-claude)
- **Contract surfaces are mandatory, not discretionary.** In SahajAtlasWeb, anything a host can
  observe — script-URL parameters, CSP or Permissions-Policy, sizing, the URL shape — changes in
  `docs/embedding.md` and `CHANGELOG.md` in the same PR, and its two in-tree consumers
  (`WeMeditateWeb/lib/atlas-embed.ts`, the WordPress plugin's templates) get checked too.

Commit as its own `docs(<scope>):` commit, the final commit before pushing. If nothing is stale,
say "docs checked, nothing stale" in the report.

### 6. Push

```bash
git push        # or: git push -u origin HEAD  on first push
```

Never force-push a shared branch. Never `--no-verify`.

### 7. Open or refresh the PR

```
mcp__github__list_pull_requests  owner:$ORG repo:$REPO  head:<branch>  state:open
```

**Read `pr-template.md` and follow its headings** as structure, not inspiration. Omit a section
the template says to omit. **Never rename one or add your own.**

**The Preview section is mandatory wherever the repo deploys previews** — it lets the reviewer see
the change with no checkout.

**This skill is the canonical source for the preview-link rule: always link the BRANCH alias,
never a per-commit alias.** A per-commit alias freezes the moment it is written, so the reviewer
opens a dead build days and pushes later. One script produces the branch alias, for both
Cloudflare projects and both platforms. It reads the alias Cloudflare itself labels — from the
bot's PR comments, or a check run's `output.summary` — and never derives one, because the
documented slug rule is a guess about a host we do not own, and two branch names agreeing in their
first 28 characters would collide under it.

```bash
# Gather with MCP, then pipe the text in:
#   mcp__github__get_comments   → the Cloudflare bot's comment bodies
#   the PR's Cloudflare check runs → each output.summary
echo '{"branch":"<branch>","bodies":["<comment body>","<check summary>"]}' \
  | ${CLAUDE_PLUGIN_ROOT}/skills/finalize-pr/branch-preview-url.mjs
```

It prints one `project status url` line per preview. A non-zero exit means no alias exists yet —
that is "preview pending", **not** a cue to fall back.

**Never use `scripts/get-cloudflare-preview-url.mjs` for the body.** That script exists for the CI
smoke gate, which must pin exactly one SHA, so it ranks a per-commit alias above the branch one —
correct there, wrong here. Reusing it for a PR body is how SahajAtlasWeb#181 linked
`c76da223.sahajatlas.pages.dev` twice, each link already stale.
(why: docs/why.md#link-the-branch-alias-never-a-commit-alias)

**A per-commit alias in a PR body is a defect** — its first hostname label is eight hex
characters, as above. When you are about to write one, write "preview pending" instead.

- **SahajCloud** uses Railway, whose preview host is already stable across pushes:
  `pnpm tsx scripts/get-railway-preview-url.ts`.
- **SahajAtlasWeb has two previews** — app and Ladle playground. Link both on a UI change.
- **Deep-link the routes you changed, not the root, and re-verify every link when you revise** —
  the alias keeps the host current, never the path, so deleting a component deletes its story.
- The preview builds minutes after the push. Create the PR, then refresh the body.
- SahajAtlasWordpress has no preview — omit the section.

Create or refresh with MCP, which takes the body directly — no temp file, and none of the
markdown-mangling that made `gh --body` unusable:

```
mcp__github__create_pull_request   owner:$ORG repo:$REPO head:<branch> base:main title:"…" body:"…"
mcp__github__pull_request_write    method:update  pullNumber:<n>  title:"…"  body:"…"
```

- **No PR** → **create it as a draft**, then one follow-up, from `loop-config.json`:
  ```bash
  gh pr edit <n> --repo "$ORG/$REPO" --add-reviewer <assignment.reviewer>
  ```
  **Set no assignee at all** — see `/workflow:triage-issue`'s baton section for the full rule. A
  PR is ours by `author:<bot>`, never by assignee. The state machine assigns the bot at `opened`,
  for the record only, and never again.

  **Every PR opens as a draft, without exception.** Draft is the PR's baton — it means *the loop
  is still working on this*, and step 9 clears it once CI is green. A PR born ready-for-review
  puts unfinished work in the reviewer's queue and makes rung 5 review a moving target.
  (why: docs/why.md#draft-is-the-prs-baton)

  **Always request the review, on every PR, the moment it opens** — including drafts, where it
  costs nothing and is already in place by ready-for-review. Assignment and review request answer
  different questions: the assignee is *who works on it*, the reviewer is *who must look*. Handing
  the PR back sets the first. Only this sets the second, and a PR with no request waits in a list
  the reviewer has no reason to open.
- **PR exists** → refresh **title and body**, both re-derived from the current
  `origin/main...HEAD`. **Leave the assignee alone**, and **never put a ready PR back into
  draft** — `draft:false` means "has been ready at least once", and rung 5's once-ever review
  depends on that staying true. Re-add the reviewer if a completed review dismissed the request
  and the PR has since changed.

### 8. Watch CI, fix, capped at 3

**`workflow/lib/merge-gate.mjs` is the one definition of "green".** Gather with MCP —
`get_check_runs`, `get_status`, and `actions_get` for a failing run's logs — and pipe the first two
to `merge-verdict.mjs`, which applies `merge-gate.mjs`'s rule and returns a verdict. Do not restate
the rule here or re-derive it from `get_status` alone: that surface reports commit statuses, our CI
reports check runs, and reading only `get_status` once held an approved SahajCloud PR green for
seventeen minutes while its test job still ran.
(why: docs/why.md#ci-truth-lives-in-check-runs)

```
mcp__github__pull_request_read  method:get_check_runs  owner:$ORG repo:$REPO pullNumber:<pr>
mcp__github__pull_request_read  method:get_status      owner:$ORG repo:$REPO pullNumber:<pr>
mcp__github__actions_get        # for a failing run's logs
```

- **`CONFLICTING` / `dirty`** → a conflicted PR has no computable merge commit, so GitHub schedules
  **zero** workflow runs for it, silently — waiting is futile. Merge the base branch in, resolve,
  push. CI fires on that push. (why: docs/why.md#a-conflicted-pr-schedules-zero-ci-runs)
- **Compare the last green run's `head_sha` against the current branch head** — a run that predates
  the base moving is stale.
- **Poll. Never call `subscribe_pr_activity`.** Poll up to `ceilings.ciPollAttempts` times. If CI has
  not settled by then, report that and hand the PR back — an unfinished watch is a fact to report,
  not a reason to stay awake. (why: docs/why.md#never-subscribe-to-pr-activity)
- **Green** → report.
- **Red** → fetch the failing job's logs via `actions_get`, diagnose, fix, re-run the relevant part
  of the lean gate, commit, push, re-watch.
- **Cap at 3 iterations.** Still red after three rounds → stop and summarize the remaining
  failures rather than looping.
- A failure **pre-existing on `main`** → fix it here and note it.

**This skill never merges.** Merge authority is the user's approving review. `/workflow:work-routine`
rung 1 performs the merge once approval, green CI, and zero unresolved threads all hold. Green CI
here means *ready for review*, not *done*. No field ever authorises a merge — `Stage: Implement`
says code may be written, never that it may ship.

### 9. Mark it ready for review, then report

- **Once CI is green, clear the draft flag** —
  `mcp__github__pull_request_write method:update pullNumber:<n> draft:false`. This is the run's
  final action, and it means *done*: nothing further until someone responds. It also fires
  `pull_request: ready_for_review`, so the state machine adds `labels.awaiting` for you — **do not
  add it yourself**, and do not touch `Stage` on the linked ticket, which went to `Implemented`
  when this PR opened.
- **Do not mark it ready while CI is red or a fix loop still runs** — that puts a broken PR into
  the reviewer's queue as though ready.
- **But an unsettled CI is not a reason to leave it in draft.** If the poll budget runs out with CI
  still in progress, mark it ready anyway and say so plainly — "marked ready with CI unsettled
  after N polls, last seen lint/typecheck green". A draft PR nobody works on is invisible to
  everyone, worse than a ready one with a caveat.
- **Never end a run leaving a PR you opened in draft**, and never change its assignee to do so.
  (why: docs/why.md#mark-the-pr-ready-despite-unsettled-ci)

Then report: PR URL, final CI status, dismissed findings with reasons, and the acceptance criteria
a human should verify by hand. If the session surfaced a durable, non-obvious gotcha, nudge the
user to save it to memory.

## Hard rules

- **Never** force-push a shared branch, `--no-verify`, or commit secrets.
- **Never** report success while CI is red.
- **Always** operate on the full branch diff, not the last commit.
- **Always** refresh a stale PR title **and** body when re-running on an existing PR.
- **Always** follow `pr-template.md`'s headings, and always include Preview where the repo has one.
- **Always** run the docs sync before pushing.
- **Cap** the CI fix loop at 3, then hand back.
- **Always** open a PR as a draft, and clear the flag only once CI is green — a PR that never
  leaves draft is invisible to the reviewer.
- **Never** set or change a PR's assignee, on creation or after — the state machine does it at
  `opened` (`/workflow:triage-issue`).
- **Never** write `labels.awaiting` or the linked ticket's `Stage` here. Opening the PR and
  clearing its draft flag are events. The state machine turns them into state within seconds.
- **Never** hard-code a gate command, trigger path, or package manager — read `workflow.json`.

## References

- PR body template: `pr-template.md`
- Per-repo settings: `<worktree>/.claude/workflow.json`
- Why each rule exists: `docs/why.md` in `sydevs/claude-workflow`
- Lean gate implementation: `<repo>/.claude/skills/pr-prep/check.sh`
