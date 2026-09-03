---
name: finalize-pr
description: Finalize the current branch's PR — simplify, review, conditional security review, lean gate, docs sync, push, open or refresh the PR, then watch CI with a capped fix loop. User-invoked; also run by /implement-issue as its final step. Does not run unless explicitly triggered.
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob, Task
---

# Finalize PR

The reusable **ship pipeline**: take the branch's accumulated local commits and ship them —
simplify → review → conditional security review → lean gate → docs sync → push → open or refresh
the PR → get CI green → report.

Phase 3 of Implement → Adjust → **Finalize**. `/implement-issue` calls this at the end; you also
run it directly once you are happy with a batch of local-only Adjust-phase commits. It is what
turns un-pushed commits into one pushed PR and one CI run.

Every analysis step delegates to something maintained elsewhere. What is left here — sequencing,
the docs-sync commit, PR create/refresh, and the capped CI loop — is the part that is genuinely
ours.

Rules here are imperatives. The failure each one prevents lives in **`docs/why.md`** in the
`sydevs/claude-workflow` repo, cited as `(why: …)`.

## Configuration

Read `.claude/workflow.json` from the **worktree root** first. It supplies everything that used to
differ per repo:

| Key | Used by |
| --- | --- |
| `leanGate.command` / `.full` | Step 4 |
| `securityReview.triggerPattern` | Step 3 — path regex |
| `securityReview.contentPattern` / `.contentPaths` | Step 3 — content regex, for repos that gate on newly-introduced sinks rather than paths |
| `packageManager` | Any command you construct |

Never hard-code a repo's gate command, trigger paths, or package manager into this skill.

## Trigger-agnostic

This skill runs from a local session **and** from a GitHub event via `claude-code-action`. Nothing
below may assume a TTY, a dev server, a populated `.env.local`, or a human able to answer. Where a
step would prompt, take the non-interactive branch and record the decision in the report instead.

```bash
[ -n "$GITHUB_ACTIONS" ] && NONINTERACTIVE=1
```

The one place this changes behaviour is pre-flight: locally, unexpected uncommitted changes stop
and ask; on a runner there is nobody to ask, so abort with the file list rather than committing
files nobody has looked at.

## Invocation

```
/finalize-pr
```

Operates on the current branch, no arguments. The diff under review is always the **whole branch**
— `origin/main...HEAD`, not the last commit. Reuse that range throughout.

## Pipeline

### 0. Pre-flight

```bash
git branch --show-current                 # must NOT be main or a shared branch
git status --short
git rev-list --count origin/main..HEAD
```

- **Abort if on `main`** or any shared branch.
- **Commit pending working-tree changes** — the Adjust phase ends here, so those edits are part of
  what ships. If anything looks unrelated, stop and ask (or abort, non-interactively). Never commit
  secrets or `.env`.
- **Nothing ahead of `origin/main`** and the PR already green → say so and exit.

### 1. Simplify

Run `/simplify` over the entire branch diff. Quality only — reuse, simplification, efficiency,
altitude. It does not hunt for bugs.

- Let it apply fixes, then review them as one unit and revert anything undesirable.
- If it changed anything, re-run the lean gate and commit `refactor: simplify per /simplify pass`.
- **Do not edit the same files while `/simplify` runs.** Wait for its report, then read `git diff`
  as one unit. (why: docs/why.md#simplify-fans-out)

### 2. Review — one pass, six lenses

```
/pr-review-toolkit:review-pr all
```

Six specialist agents run over the branch diff with confidence scores: `code-reviewer`
(project-guideline compliance), `pr-test-analyzer` (coverage gaps, rated 1–10), `silent-failure-hunter`
(swallowed errors, inadequate logging), `type-design-analyzer` (invariants, encapsulation),
`comment-analyzer` (documentation that contradicts the code), `code-simplifier`.

This replaces the single dispatched `/code-review` pass. The toolkit runs its agents in their own
contexts, so the main thread does not need a wrapper subagent to stay lean.

Every comment this skill posts to GitHub carries `identity.commentMarker` from `loop-config.json`.

**Triage every finding — judging, not deferring.** A reviewer's finding can be wrong. Verify each
claim against the source before acting on it, and reject it with a stated reason when it does not
hold. Apply the same scepticism to a suggested *simplification*: confirm it does not quietly cost
something, such as dropping a "redundant" generic that was carrying type inference. Fix valid
findings each in its own commit, then re-run the lean gate. Record dismissals with one-line reasons
for the report.

**A clean report must carry its evidence.** If a lens returns nothing, check that it names the files
and code paths it actually read. **Treat a clean report that shows little or no reading as *not yet
reviewed*** — re-run that lens, or read the highest-risk paths yourself.
(why: docs/why.md#a-clean-review-report-must-carry-its-evidence)

For a deeper pass, note that the user can run the billed `/code-review ultra` themselves. Claude
cannot launch it.

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

- **Match** → run the built-in `/security-review` over the diff, triage and fix as in step 2.
  `security-guidance` has already flagged issues at edit time; this is the branch-level sweep.
- **No match** → skip and say so in the report.

### 4. Lean gate

```bash
jq -r '.leanGate.command' .claude/workflow.json | sh
```

Plus any targeted specs for what changed. Fix and re-run on failure. CI runs the full suite on the
PR — that is the real gate. Do not reproduce it locally unless debugging a red run
(`leanGate.full`).

### 5. Docs sync

Documentation ships in the same push as the code it describes. Sweep the branch diff for doc impact
**before** pushing:

```bash
git diff --name-only origin/main...HEAD
grep -rn "<changed setting / env var / command / behaviour>" \
  docs/ AGENTS.md .env.example $(git ls-files '**/AGENTS.md')
```

- **Check every surface that could describe what changed**: the root `AGENTS.md`, the nested
  `AGENTS.md` guide for each directory you touched, `docs/`, `.env.example`, deployment docs, and
  any skill whose workflow the change alters. Update what the diff makes stale and document what it
  introduces.
- **Grep beyond `.md` and `.json`** — references to guide paths hide in `.env`, CSS, test files and
  `.distignore`. (why: docs/why.md#contract-surfaces-are-mandatory)
- **Never attempt a docs edit under `.claude/`.** Guides are nested `AGENTS.md` files (with a
  `CLAUDE.md` symlink beside each). If a docs-sync wants to edit something under `.claude/`, that is
  a signal the content is in the wrong place: propose the move rather than attempting the edit.
  (why: docs/why.md#documentation-lives-outside-claude)
- **Contract surfaces are mandatory, not discretionary.** In SahajAtlasWeb, anything a host site can
  observe — script-URL parameters, CSP or Permissions-Policy requirements, sizing, the URL shape —
  changes in `docs/embedding.md` and `CHANGELOG.md` in this same PR. When a contract changes, also
  check its two in-tree consumers: `WeMeditateWeb/lib/atlas-embed.ts` and the WordPress plugin's
  templates.

Commit as its own `docs(<scope>):` commit — the final commit before pushing. If nothing is stale,
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

**Read `pr-template.md` and follow its headings.** Not as inspiration — as the structure: a PR that
invents its own sections loses exactly the ones the reviewer needs. Omit a section the template says
to omit; never rename one or add your own in its place.

**The Preview section is mandatory wherever the repo has a preview deploy.** It is how the reviewer
sees the change without checking out the branch.

**Always link the BRANCH alias, never a per-commit alias.** One script produces it, for both
Cloudflare projects and both platforms:

```bash
# Gather with MCP, then pipe the text in:
#   mcp__github__get_comments   → the Cloudflare bot's comment bodies
#   the PR's Cloudflare check runs → each output.summary
echo '{"branch":"<branch>","bodies":["<comment body>","<check summary>"]}' \
  | ${CLAUDE_PLUGIN_ROOT}/skills/finalize-pr/branch-preview-url.mjs
```

It prints one `project  status  url` line per preview, reading the alias out of the label Cloudflare
itself writes — `Branch Preview URL`, in both the Pages check-run summary and the Workers comment.
It exits non-zero when there is no alias yet: that is the "preview pending" case, **not** a cue to
fall back to something else.

**Do not use `scripts/get-cloudflare-preview-url.mjs` for the body.** That script ranks per-commit
aliases *above* branch aliases on purpose, because it feeds the CI smoke gate, which must test the
exact SHA. Its reasoning is sound and does not transfer: a body written from it goes stale on the
next push, and its docblock will talk you into it.
(why: docs/why.md#link-the-branch-alias-never-a-commit-alias)

**A per-commit alias in a PR body is a defect, not a fallback.** Its first hostname label is eight
hex characters — `c76da223.sahajatlas.pages.dev`,
`c14f4e66-wemeditate-web.contact-c66.workers.dev`. If you are about to write one, the answer is
"preview pending".

- **SahajCloud** uses Railway, whose preview host is per-PR and already stable across pushes:
  `pnpm tsx scripts/get-railway-preview-url.ts`. Nothing to correct there.
- SahajAtlasWeb has **two** previews and a UI change should link both: the app (`sahajatlas`) and the
  Ladle component playground (`sahajatlas-design`). The script returns both.
- **Deep-link to the routes actually changed, not the root** — a reviewer should land on the thing,
  not hunt for it.
- The preview builds a few minutes after the push, so create the PR, then refresh the body once the
  URL resolves.
- **Re-verify every deep link when you revise a PR.** Your own revision can invalidate a link — if
  the review asked you to delete a component, its Ladle story went with it. Branch aliases keep the
  *host* current; they do not keep the *path* valid.
- Only SahajAtlasWordpress has no preview deploy; there the section is omitted.

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
  **Set no assignee at all.** The PR is ours because we wrote it — every rung finds it by
  `author:<bot>` — so an assignment would add nothing and would overwrite a field that is the
  reviewer's to use. Assignment on a PR has exactly one meaning, and it points the other way:
  someone assigning the bot to *their* PR is asking the loop to work on it.

  **Every PR opens as a draft, without exception.** Draft is the PR's baton: it means *the loop is
  still working on this*, and step 9 clears it once CI is green. A PR that is born ready-for-review
  puts unfinished work in the reviewer's queue and makes rung 5 review a moving target.
  (why: docs/why.md#draft-is-the-prs-baton)

  **Always request the review, on every PR, at the moment it is opened** — including drafts, where it
  costs nothing and means the request is already in place at ready-for-review. Assignment and review
  request answer different questions: the assignee is *who is working on it*, the reviewer is *who
  must look*. Handing the PR back sets the first; only this sets the second, and a PR that never
  requests one waits in a list the reviewer has no reason to open.
- **PR exists** → refresh **title and body**, both re-derived from the current `origin/main...HEAD`.
  **Leave the assignee alone**, and **never put a ready PR back into draft** — `draft:false` means
  "has been ready at least once", and rung 5's once-ever review depends on that staying true. Re-add
  the reviewer if the request was dismissed by a completed review and the PR has since changed.

### 8. Watch CI, fix, capped at 3

**First confirm CI *can* run.** A conflicted PR has no computable merge commit, so GitHub schedules
**zero** workflow runs for it — silently, and waiting is futile.
(why: docs/why.md#a-conflicted-pr-schedules-zero-ci-runs)

```
mcp__github__pull_request_read  method:get_check_runs  owner:$ORG repo:$REPO pullNumber:<pr>
```

**Green means every check run has `conclusion: success` (or `neutral`/`skipped`), every commit
status is `success`, and there is at least one CHECK RUN.** Do not read `method:get_status` alone —
it returns commit statuses, our CI reports check runs, and reading only the first once had an
approved SahajCloud PR green for seventeen minutes while its test job was still running. A deploy
status is not a test signal. (why: docs/why.md#ci-truth-lives-in-check-runs)

`merge-verdict.mjs` applies exactly that definition — pipe it the same three calls and read its exit
code rather than restating the rule here.

- `CONFLICTING` / `dirty` → merge the base branch in, resolve, push. CI fires on that push. The
  script reports this as "no check runs — usually a merge conflict", because a conflicted PR
  schedules **zero** workflow runs, silently.
  (why: docs/why.md#a-conflicted-pr-schedules-zero-ci-runs)
- **Compare the last green run's `head_sha` against the current branch head** — a run that predates
  the base moving is stale.

```
mcp__github__pull_request_read  method:get_check_runs  owner:$ORG repo:$REPO pullNumber:<pr>
mcp__github__pull_request_read  method:get_status      owner:$ORG repo:$REPO pullNumber:<pr>
mcp__github__actions_get        # for a failing run's logs
```

- **Read CI from `get_check_runs`.** Our test jobs are GitHub Actions and report as **check runs**;
  `get_status` returns **commit statuses**, a separate surface that cannot see them, carrying only
  deploy signals here. Green is all three of: at least one check run; every check run finished with
  `conclusion` in `success`/`skipped`/`neutral`; every entry in the `statuses` array at
  `state: "success"` — the entries, not the combined `state`, which reads `pending` when there are
  none. (why: docs/why.md#ci-truth-lives-in-check-runs)
- **Poll; never `subscribe_pr_activity`.** Poll up to `ceilings.ciPollAttempts` times; if CI has not
  settled by then, report that and hand the PR back. An unfinished CI watch is a fact to report, not
  a reason to stay awake. (why: docs/why.md#never-subscribe-to-pr-activity)
- **`workflow/lib/merge-gate.mjs` implements exactly that definition**, and rung 1 reaches it through
  `merge-verdict.mjs`. If you ever find yourself refining the rule here, change it there too — or
  better, change it there only.
- **Green** → report.
- **Red** → fetch the failing job's logs via `actions_get`, diagnose, fix, re-run the relevant part
  of the lean gate, commit, push, re-watch.
- **Cap at 3 iterations.** Still red after three rounds → stop and summarize the remaining failures
  rather than looping.
- A failure **pre-existing on `main`** → fix it here and note it.

**This skill never merges.** Merge authority belongs to the user's approving review, and the merge
itself is performed by `/workflow:work-routine` rung 1 once all three of approval, green CI, and zero
unresolved review threads hold. Finishing here with green CI means *ready for review*, not *done*.

**No field ever authorises a merge.** `Stage: Implement` is ticket-only — it says code may be
written, never that it may be shipped. If you find yourself reading a field to decide whether to
merge, the gate you want is the approving review.

### 9. Mark it ready for review, then report

- **Once CI is green, clear the draft flag** —
  `mcp__github__pull_request_write method:update pullNumber:<n> draft:false`. This is the final
  action of the run and it means *done*: nothing further until someone responds.
- **Do not mark it ready while CI is red or a fix loop is still running** — that would put a broken
  PR into the reviewer's queue as though it were ready.
- **But an unsettled CI is not a reason to leave it in draft.** If the poll budget runs out with CI
  still in progress, mark it ready anyway and say so plainly — "marked ready with CI unsettled after
  N polls; last seen lint/typecheck green". A draft PR nobody is working on is invisible to
  everyone, which is strictly worse than a ready one with a caveat.
- **Never end a run leaving a PR you opened in draft**, and never change its assignee to do it.
  (why: docs/why.md#hand-the-baton-back-even-with-ci-unsettled)

Then report: PR URL, final CI status, dismissed findings with reasons, and the acceptance criteria a
human should verify by hand. If the session surfaced a durable non-obvious gotcha, nudge the user to save
it to memory.

## Hard rules

- **Never** force-push a shared branch; **never** `--no-verify`; **never** commit secrets.
- **Never** report success while CI is red.
- **Always** operate on the full branch diff, not the last commit.
- **Always** refresh a stale PR title **and** body when re-running on an existing PR.
- **Always** follow `pr-template.md`'s headings, and always include Preview where the repo has one.
- **Always** run the docs sync before pushing.
- **Cap** the CI fix loop at 3, then hand back.
- **Always** open a PR as a draft, and clear the draft flag only once CI is green. A PR that never
  leaves draft is invisible to the reviewer.
- **Never** set or change a PR's assignee, on creation or after. Ours are found by `author:`; an
  assignee on a PR is someone else's signal, not ours to write.
- **Never** hard-code a gate command, trigger path, or package manager — read `workflow.json`.

## References

- PR body template: `pr-template.md`
- Per-repo settings: `<worktree>/.claude/workflow.json`
- Why each rule exists: `docs/why.md` in `sydevs/claude-workflow`
- Lean gate implementation: `<repo>/.claude/skills/pr-prep/check.sh`
