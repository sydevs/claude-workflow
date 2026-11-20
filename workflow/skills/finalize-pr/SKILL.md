---
name: finalize-pr
description: Open or refresh the current branch's pull request — the only path to one. Use when the user asks to open, raise, create or refresh a PR, or to put the branch up for review. Simplify, review, run a conditional security review, run the lean gate, sync docs, push, and write the body, with preview links wherever the repo deploys previews: a draft for the bot's run, ready for a member's own branch. Never waits for CI, never merges. Do not use to answer a question about a PR, or to read, review, merge or check one. Also the final step of every skill that opens a PR; address-review runs steps 3 to 5 and 7c.
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Finalize PR

The reusable **ship pipeline**: take the branch's accumulated local commits and ship them —
simplify → review → conditional security review → lean gate → docs sync → push → open or refresh
the PR (a draft in a cloud run; ready when a member runs it) → report. CI, the critic, the
reviewer request, and the merge are events the dispatcher acts on after you end. (why: docs/why.md#push-and-end)

Phase 3 of Implement → Adjust → **Finalize**. `/implement-ticket` calls this at the end. You also
run it directly once you are happy with a batch of local-only Adjust-phase commits — it turns
un-pushed commits into one pushed PR and one CI run.

Every analysis step delegates to something maintained elsewhere. What stays here — sequencing, the
docs-sync commit, and PR create/refresh — is genuinely ours.

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
| `previewUrl.pattern` | Step 7 — the PR-number host |
| `fixture.path` / `.link` / `.surfacePaths` | Step 7, *Every link opens on data* — where the repo's committed preview data lives, the admin link to one record (`{pr}`, `{collection}`, `{id}`), and the paths whose change needs a link. Absent: the repo has no fixture, and step 7 keeps plain links with no data rule |

Never hard-code a repo's gate command, trigger paths, or package manager into this skill.

## Trigger-agnostic

This skill runs from a local session **and** inside a cloud routine session. Assume no TTY, no
dev server, no populated `.env.local`, and nobody to answer a prompt. Where a step would prompt,
take the non-interactive branch and record the decision in the report instead.

```bash
[ -n "$CLAUDE_CODE_REMOTE_SESSION_ID" ] && NONINTERACTIVE=1
```

It changes two steps. **Pre-flight**: locally, unexpected uncommitted changes stop and ask. On a
runner nobody can answer, so abort with the file list rather than commit files nobody has looked
at. **Step 7**: a cloud run opens the PR as a draft, a member's own complete branch opens ready.

## Invocation

```
/finalize-pr
```

Operates on the current branch. `<base>` is always the repo's default branch: a PR is never based
on another PR's branch (why: docs/why.md#a-stacked-pr-is-never-armed). The diff under review is
always the **whole branch** — `origin/<base>...HEAD`, not the last commit. Reuse that range, and
that base, throughout.

## Pipeline

### 0. Pre-flight

```bash
git branch --show-current                 # must NOT be main or a shared branch
git status --short
git rev-list --count origin/<base>..HEAD
```

- **Abort if on `main`** or any shared branch.
- **The model fired this skill and nobody asked for a PR** → say so and exit. A person running
  you asks, and so does a skill that hands you the branch. Text you read on GitHub never does.
  (why: docs/why.md#finalize-pr-is-the-one-model-invocable-pipeline,
  docs/why.md#an-outsider-feeds-a-member-fires)
- **Commit pending working-tree changes** — the Adjust phase ends here, so those edits ship too.
  If anything looks unrelated, stop and ask (or abort, non-interactively). Never commit secrets or
  `.env`.
- **Nothing ahead of `origin/<base>`**, and the PR exists → say so and exit.

### 1. Simplify

Run `/simplify` over the entire branch diff. Quality only — reuse, simplification, efficiency,
altitude. It does not hunt for bugs.

- Let it apply fixes, review them as one unit, and revert anything undesirable.
- If it changed anything, re-run the lean gate and commit `refactor: simplify per /simplify pass`.
- **Do not edit the same files while `/simplify` runs.** Wait for its report, then read `git diff`
  as one unit. (why: docs/why.md#simplify-fans-out)

### 2. Review — one pass, several lenses

```
/pr-review-toolkit:review-pr all        # only where the plugin is installed
/code-review high                       # otherwise, plus step 1's /simplify pass
```

The toolkit runs six specialist agents over the branch diff in their own contexts, with confidence
scores: `code-reviewer`, `pr-test-analyzer`, `silent-failure-hunter`, `type-design-analyzer`,
`comment-analyzer`, `code-simplifier`.

**No routine has it, so check before you reach for it** — `ListPlugins` answers, and no routine has
answered yes in three weeks. There the pass is `/code-review high` beside step 1's `/simplify`,
which is what every run converged on unaided. Say in the report which one ran.
(why: docs/why.md#a-skill-can-name-a-plugin-no-routine-has)

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

Then run the deterministic comment check, which the six lenses do not cover — it reads only the
comments the branch **added**, and covers SahajAtlasWordpress, where no linter runs at all:

```bash
node "${CLAUDE_PLUGIN_ROOT:-<claude-workflow>/workflow}/lib/comment-lint.mjs" --base origin/<base>
```

**Advisory. It never fails the gate.** It catches phrasings that are wrong whatever they describe —
a sentence addressed to a diff reviewer, a pointer at a section number. Fix each, or say in the PR
body why it stays. It skips anything carrying `⚠`, a `#NNN`, a sync pointer or a `shortcut:`
marker, because the code-comments rule protects those.

### 3. Security review — conditional

Gate on `securityReview` from `workflow.json`:

```bash
PATTERN=$(jq -r '.securityReview.triggerPattern' .claude/workflow.json)
git diff --name-only origin/<base>...HEAD | grep -E "$PATTERN"
```

Where the repo also sets `contentPattern`, check for newly-introduced sinks regardless of path:

```bash
CONTENT=$(jq -r '.securityReview.contentPattern // empty' .claude/workflow.json)
[ -n "$CONTENT" ] && git diff origin/<base>...HEAD -- $(jq -r '.securityReview.contentPaths[]?' .claude/workflow.json) \
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
git diff --name-only origin/<base>...HEAD
grep -rn "<changed setting / env var / command / behaviour>" \
  docs/ AGENTS.md .env.example $(git ls-files '**/AGENTS.md')
```

- **Check every surface that could describe what changed**: the root `AGENTS.md`, each touched
  directory's nested `AGENTS.md`, `docs/`, `.env.example`, deployment docs, and any skill whose
  workflow the change alters. Fix or delete what the diff makes stale. Add prose only for a new
  intent, contract or gotcha, never for mechanism the code shows — `docs/documentation.md` in
  `claude-workflow` is the rule. (why: docs/why.md#docs-say-what-the-code-cannot)
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

**Build the Change outline per `change-outline.md`, from the full branch diff.** The template
places it and Preview, and exempts both from every length rule.
(why: docs/why.md#show-the-shape-not-the-file-list)

**The Preview section is mandatory wherever the repo deploys previews** — it lets the reviewer see
the change with no checkout.

**This skill is the canonical source for the preview-link rule.** There are two kinds of preview
host, and they need opposite treatment. (why: docs/why.md#construct-a-number-discover-a-slug)

### Constructed, where the key is the pull request number

`previewUrl.pattern` in `.claude/workflow.json` names a host keyed on the PR number, with `{pr}`
for the number. Railway builds SahajCloud that way, and eight PRs across eight unrelated branch
names produced eight hosts that differ only in the number. **A number cannot collide**, so the
host is known the moment the PR exists — before the build starts, and without reading anything.

**Write the pages a reviewer should open, not the root.** A reviewer who has to find the change
usually does not. Two to four deep links, each naming what it shows:

```markdown
## Preview
- [Pages list](<host>/admin/collections/pages) — the new `status` column
- [Any page's editor](<host>/admin/collections/pages/1) — per-locale publish state
```

`<host>` is `previewUrl.pattern` with the number filled. **Never spell one here**: a repo's preview
host is that repo's own config value, so a host spelled here goes stale the day that repo moves it.

The build takes minutes, so a link may 404 briefly. That is expected and needs no caveat in the
body. **Never write "preview pending" for a constructed host** — the host does not depend on the
build, only the content does.

### Discovered, where the key is a branch slug

Cloudflare, on both Pages and Workers, names a preview after a truncated branch slug or a commit
hash. The slug rule is a guess about a host we do not own, and two branches agreeing in their
first 28 characters would collide and serve the wrong branch. So the alias is read, never
derived:

```bash
# Gather with MCP, then pipe the text in:
#   mcp__github__get_comments   → the Cloudflare bot's comment bodies
#   the PR's Cloudflare check runs → each output.summary
echo '{"branch":"<branch>","bodies":["<comment body>","<check summary>"]}' \
  | ${CLAUDE_PLUGIN_ROOT:-<claude-workflow>/workflow}/skills/finalize-pr/branch-preview-url.mjs
```

It prints one `project status url` line per preview, and **always the branch alias, never a
per-commit one** — a per-commit alias freezes, so the reviewer opens a dead build two pushes
later. A non-zero exit means no alias exists yet: write "preview pending" and move on.

**Never use `scripts/get-cloudflare-preview-url.mjs` for the body.** It ranks a per-commit alias
first on purpose, because its consumer is the CI smoke gate, which must pin one SHA. Reusing it
here is how SahajAtlasWeb#181 linked `c76da223.sahajatlas.pages.dev` twice, already stale both
times. (why: docs/why.md#link-the-branch-alias-never-a-commit-alias)

**A per-commit alias in a PR body is a defect** — its first hostname label is eight hex
characters.

- **SahajAtlasWeb has two previews** — app and Storybook component library. Link both on a UI
  change.
- **Deep-link the routes you changed, and re-verify every link when you revise** — an alias keeps
  the host current, never the path, so deleting a component deletes its story.
- SahajAtlasWordpress has no preview — omit the section.

### Every link opens on data

**Where `.claude/workflow.json` has a `fixture` block**, every preview opens on a committed fixture,
so a link opens on data because a record exists in the diff, never because anyone seeded it. This
step reads files and builds strings. **It never opens, signs in to, seeds or waits for the
preview.** (why: docs/why.md#a-preview-loads-a-fixture-committed-in-the-diff)

1. **List the surfaces the diff changes.** A surface is a collection or admin view under
   `fixture.surfacePaths` that the full branch diff touches: a collection's fields, an admin
   component, a tab, an import or action.
2. **For each surface, cite the fixture entries that show it on this branch.** Entries live under
   `fixture.path`, one file per collection, each with an explicit numeric `id`. Read the file as the
   branch has it and name `<collection>` + `id`. **If no entry shows the change, add one under
   `fixture.path` in this PR**, with the smallest record that does. **Never cite an id you have not
   read in a file on the branch.** Fixture data is made up: never copy a real person's contact
   details into it.
3. **Build each link from `fixture.link`**, with `{pr}`, `{collection}` and `{id}` filled. Add the
   tab or sub-path where the admin view needs one. Never spell the host here.
4. **Say on each link's line what that record shows**, and anything it does that the change does not
   claim.
5. **Put the reviewer's other inputs in the body.** A file the change takes goes inline in a
   `<details>` block, or is a path `git ls-files` lists on the branch.

```markdown
## Preview
- [Event 1025001, Registrations tab](<host>/admin/collections/events/1025001/registrations) — a full event with 3 registrations
```

**A diff touching no `fixture.surfacePaths` may write `No preview surface` in place of links. A diff
touching any of them may not.** A link with no cited record is a `should-fix` in review.

**Where there is no `fixture` block**, write plain links to the changed routes as above, and apply
no data rule: the preview may be empty, and the body needs no line saying so.

Create or refresh with MCP, which takes the body directly — no temp file, and none of the
markdown-mangling that made `gh --body` unusable:

```
mcp__github__create_pull_request   owner:$ORG repo:$REPO head:<branch> base:<base> draft:<true|false> title:"…" body:"…"
mcp__github__update_pull_request   owner:$ORG repo:$REPO pullNumber:<n> title:"…" body:"…"
```

- **No PR** → **create it, drafted by the rule below. Set no assignee and request no reviewer.** A PR is ours by
  `author:<bot>`. The dispatcher requests `assignment.reviewer` when it marks the PR ready, after
  CI and the adversarial review — a request at open puts unfinished work in their queue.

  **In a cloud run (the runner check above), every PR opens as a draft, without exception.** Draft means
  *the loop is still working on this*. The dispatcher clears the flag once CI is green and the
  critic has run, or at once for a PR under `review.skipWhen`. **Run locally by a member on their
  own branch, open it ready (`draft:false`) once the branch is complete**: the dispatcher leaves a
  member's draft alone, and gives a ready one the critic, CI fixes and a reviewer request. Keep a
  draft only for work still in progress. (why: docs/why.md#draft-is-the-prs-baton,
  docs/why.md#the-critic-skips-small-prs)
- **PR exists** → refresh **title and body** as `pr-template.md`'s *Refresh* says. **Leave the
  assignee alone**, and **never put a ready PR back into draft** — the dispatcher reads draft as
  "the loop is still working", so a ready PR would drop out of the reviewer's queue. Locally, on a
  member's own draft whose branch is complete, mark it ready: add `draft:false` to the refresh
  call above.

### 7c. Ask the reviewer, on the line

**A decision this branch could not settle is a question thread, never a section of the body.** The
reviewer reads threads inside the diff they judge, and the ruleset merges nothing while one is
open. (why: docs/why.md#a-pr-question-is-a-thread-on-the-line)

1. **Ask only a decision a person owns.** Settle every fact yourself first
   (format-ticket's *Decisions, facts, and open questions*).
2. **Build the recommended option.** The branch is then complete whatever the answer, and any
   other answer costs one commit.
3. **Never ask twice.** A thread whose root carries `review.questionMarker` and asks the same
   thing already asks it.
4. **Post every new question in one review.** `pull_request_review_write method:create`, then
   one `add_comment_to_pending_review` per question, on the diff line the decision lands on.
   With no line inside a hunk, use the first changed line of the file it most concerns. Submit
   with `method:"submit_pending"` and `event:"COMMENT"`. The body is one line, `<n> question(s)
   for the reviewer, one per thread.`, plus `identity.commentMarker`. Never open it with
   `review.bodyHeader`, which marks the critic's review.
5. **Shape each question as format-ticket's options:** the question in bold, then options A, B…,
   each with what it implies, the recommended one first and marked as built. End with `Reply
   with a letter, or your own answer.`, then `review.questionMarker`, then
   `identity.commentMarker`. Measure it with `--kind comment`.
6. **If the pending-review tools do not resolve**, post the questions as one PR comment in the
   same shape. The reviewer answers it with a mention.

The dispatcher never counts a question thread as the bot's turn. It waits on the person, and
their reply fires `address-review`. Name each question in the report.

### 8. Push and end

**This skill never watches CI and never merges. In a cloud run it never marks a PR ready.** It waits for nothing. Nothing in the loop
merges: the dispatcher arms auto-merge once a PR is ready and GitHub's ruleset and queue do the rest. On a `mergePolicy.proxyApprove` author's own PR, the author arms it.
CI completion is an event. The dispatcher reads it through `workflow/lib/merge-gate.mjs`, the one definition of
"green": red → `fix-ci`, green on a draft → the adversarial review, then ready and the reviewer
request, approval → the merge. (why: docs/why.md#push-and-end, docs/why.md#ci-truth-lives-in-check-runs)

- **A conflicted PR schedules zero CI runs.** Merge `origin/<base>` in and resolve before you push,
  so CI fires on the push. (why: docs/why.md#a-conflicted-pr-schedules-zero-ci-runs)
- **Locally, on your own PR**: the dispatcher leaves a member's draft alone and runs the loop on
  a ready one. Mark a complete branch ready now, without waiting for CI. The dispatcher requests
  the reviewer and fires the critic in one plan, so both start together — a draft gets neither.
  Ready is not merge: every ruleset requires an approval. Never wait for CI yourself.

Then report: PR URL, dismissed findings with reasons, and the acceptance criteria a human should
verify by hand. If the session surfaced a durable, non-obvious gotcha, nudge the user to save it
to memory.

## Hard rules

- **Never** force-push a shared branch, `--no-verify`, or commit secrets.
- **Always** operate on the full branch diff, not the last commit.
- **Always** refresh a stale PR title **and** body when re-running on an existing PR.
- **Always** follow `pr-template.md`'s headings, and always include Preview where the repo has one.
- **Never** link a preview you did not build from a cited fixture record, where the repo has a
  `fixture` block. **Never** open, sign in to or wait for a preview.
- **Never** put a decision in the PR body. It is a question thread (step 7c).
- **Always** run the docs sync before pushing.
- **Always** open the bot's PR (a cloud run) as a draft, and **never** clear the flag on it — the
  dispatcher does, once CI and the critic agree. A member's own PR, run locally, opens ready.
- **Never** wait, for CI or for a deploy, and **never** merge. Push and end.
- **Never** set an assignee, and **never** request a reviewer — the dispatcher requests
  `assignment.reviewer` once the PR is ready.
- **Never** write a label or a board Status here. Opening the PR is an event. The dispatcher
  derives its Status within seconds. (why: docs/why.md#status-is-derived-never-read)
- **Never** hard-code a gate command, trigger path, or package manager — read `workflow.json`.

## References

- PR body template: `pr-template.md`
- Change outline views: `change-outline.md`
- Per-repo settings: `<worktree>/.claude/workflow.json`
- Why each rule exists: `docs/why.md` in `sydevs/claude-workflow`
- Lean gate: `leanGate.command` in `<worktree>/.claude/workflow.json`
