# Why each rule exists

The rules live in the skills. **This file holds the failure that produced each one, and nothing
else.** No rule appears here unless a `SKILL.md` already states it as an imperative.

The split is deliberate. `start-run`, `finish-run` and the handler's own skill load on every run.
Extra length there costs tokens every time, and dilutes the rules it carries. But a rule with no
story behind it is a rule a model can talk itself out of, the first time it meets a case the
wording did not predict. So the story stays one hop away, cited from the rule as
`(why: docs/why.md#anchor)`.

**Read an entry when a rule seems not to fit the case in front of you. Never read one to decide
whether to follow the rule.** If a story and its imperative disagree, the imperative wins, and the
disagreement is a bug in this file.

**Keeping it short.** An entry is at most 15 lines: the failure, its evidence (issue refs, dates,
numbers), and why the rule fixes it. Edit an entry in place rather than appending a correction.
When a rule is replaced, move its entry under `# Retired` as a heading, a **Replaced by:** line and
at most four lines of evidence. Never rename a heading: skills cite it by anchor.

This file lives in the `sydevs/claude-workflow` checkout, next to `loop-config.json`.

---

# The runs — work-routine, run-audit, preflight, journal

## The routine prompt is not the specification

The two scheduled routine prompts are set through an API, not stored in this repo, so no PR can
review or diff them. For a while they restated about a dozen of `work-routine`'s hard rules "for
safety," and that copy went stale twice:

- One prompt named a `journalIssue` config key months after `loop-config.json` replaced it with
  the `journal` object.
- Another still told the run to unsubscribe from PR activity in a form the skill had since changed.

Neither divergence was visible from this repo or raised an error; the run just followed the stale
copy. Precedence must live where a run can read it: the skill itself.

## Never improvise around a missing credential

A guess made without data reads exactly like a measurement in everything the run writes afterward,
and the journal is the only record anyone reads. Doing nothing is better.

## Report anomalies, do not explain them

Four runs reasoned soundly from an unmeasured premise: a permission refusal read as absence, an MCP
readback read as a failed write, a rendered page read as an uncollapsed `<details>` block, and a
time gap read as clock skew. Each explanation was coherent, detailed, wrong, and recorded in the
journal as measured fact. Diagnosing the harness is a human's job; a harness theory cited as
evidence for a code change puts a wrong premise into `main`.

## A blocked run cannot see that it is blocked

An approval prompt in an unattended run does not fail. It **waits**, and the run resumes with no
memory of the gap. One WeMeditateWeb run lost about 75 minutes this way, against Claude Code's
Protected Paths guard. When wall-clock time jumps, being blocked *is* the explanation.

From outside it is visible: the routines API reports a stalled session as
`worker_status: requires_action` within about 90 seconds. Six consecutive `loop-WeMeditateWeb` runs
sat in that state on WeMeditateWeb#97, each burning its full 150-minute lease, because the
dispatcher does not poll for it. Until that known gap closes, `start-run`'s protected-path check is
what keeps runs out of the trap.

Wake events carry an authoritative `current-time` in GitHub's own frame. Prefer it over the local
clock for anything compared against a GitHub timestamp.

## Titles yes, bodies no

Titles make the backlog legible to the deciding run and the journal's reader at almost no cost.
Reading every body every run is the single largest avoidable cost in this system.

## The ops-journal exclusion is mandatory

`claude-workflow` is both a worked repo and the journal's home. Without `-label:ops-journal` on
every worklist query, the loop reads its own diary as backlog: an entry mentioning a ticket becomes
a ticket, and each entry looks like fresh activity to the next run, so the failure compounds.

An HTML-escaped `&gt;` in a search qualifier is accepted without error and returns **zero results**,
which reads as "nothing to do."

## CI truth lives in check runs

For the loop's first week, rung 1 read CI with `get_status` alone. That returns commit statuses, and
no repo here posts one for tests: GitHub Actions reports check runs, which `get_status` cannot see.
Measured on two live PRs on 2 September, it was wrong both ways:

- **sydevs/SahajAtlasWeb#181** — `get_status`: `state: "pending"`, `total_count: 0`,
  `statuses: []`; `get_check_runs`: five runs, all `conclusion: "success"`. Green read as "still
  running," forever.
- **sydevs/SahajCloud#672** — `get_status` returned one `success`, Railway's deploy
  (`created_at: 21:14:17Z`). The test check run finished at `21:31:40Z`: seventeen minutes of green
  while tests ran. A rung-1 run in that window, on an approved PR, would have merged untested code
  while following the skill exactly.

`workflow/lib/merge-gate.mjs` now owns the definition of "green," including why an empty check-run
list never passes (a merge conflict schedules zero runs) and why `skipped` and `neutral` count. This
entry keeps only the incident that forced the split.

## Never subscribe to PR activity

Declining `subscribe_pr_activity` is not enough. **Opening a PR auto-subscribes the session**:
GitHub fires `subscription.created`, `from="system"`, at PR-open time. This was measured after the
skill claimed otherwise, so a run can wake having never subscribed. Tolerate it. Nor can a run end
its session: sessions stayed `active` a full day after finishing, even ones that unsubscribed.

**The released lock is the backstop.** A woken session first re-reads the lock label it removed,
finds it gone, and stops, so re-entry is a no-op. That matters because the wake carries the
harness's drive-to-green posture (fix CI, answer reviews, stay until merge); a session that took it
would push to an item the next dispatch holds and race `fix-ci` with no lease of its own.

**So unsubscribe on the way out.** Each further wake spends a turn re-reading a lock the run no
longer owns. 8 sessions across 6 days of 2026-10-04..17 were woken this way; two of the last three
unsubscribed on their own judgement and one did not, the divergence the rule removes. This bounds
the wakes; it cannot prevent the platform's first subscription.

## An investigation must not be forced into a PR

An empty PR filed to fit the pipeline costs a review slot and buries the real answer inside a
description. The pipeline serves the work, not the other way around.

## respondTo is an allowlist

Its own account first let the loop tell feedback from its own writing; replying to itself burns the
reply ceiling and makes a thread argue with itself. But *"the author is not me"* is a one-entry
blocklist that fails open on everyone it has not met.

Of the 200 most recent issue comments across SahajCloud and SahajAtlasWeb, 100 came from
`Ardnived`, **93 from `cloudflare-workers-and-pages[bot]`**, and 7 from `antontcymbal`. Under "not
me," the preview-URL bot would have been the largest source of work, and each new integration would
silently add more. `assignment.respondTo` names the logins whose comments count, so unknown authors
stay inert; adopting a reviewing bot such as Copilot needs one entry in `loop-config.json`.

## Issue fields are not searchable

`Stage` and `Hold Until` are read every run but can never appear in a query. GitHub documents a
`field.<name>:<value>` qualifier that works in the web UI (GraphQL). Through the REST search
endpoint, the only one a routine reaches, it is **accepted without error and matches nothing**.
Against `sydevs/SahajCloud`: `field.priority:high` returned 0 though an issue with `Priority: High`
exists, the control query returned 24, and the negation also returned 0 — impossible for a working
qualifier.

Like an HTML-escaped `&gt;`, it fails silently. So worklist queries use only indexed qualifiers
(`assignee:`, `author:`, `is:pr`, `draft:`, `review:`), and field values come afterward from
`list_issues(fields:["field_values"])` — one call per repo, five in total, cheaper than the census
it replaced.

## The loop may never write Implement

The property that keeps the loop safe to leave running: **it cannot authorize its own code.** A
`ready-to-implement` label once carried this; `Stage: Implement` carries it now. The asymmetry
carried over intact: the loop may move a ticket *off* `Implement`, never onto it, because revoking
only reduces its own autonomy.

The field version is riskier: the loop legitimately writes four other `Stage` values, so writing
one is habit, not exception. That is why the rule is a bare imperative in `preflight`,
`format-ticket`, and `implement-ticket`, not inferred from an ownership table.

## A request in prose is not permission

> The Stage field and the rung-4 table below are retired. The rule stands: today the authorisation
> is a `respondTo` human's `@sydevs-bot implement`, and prose asking for work only scopes it.

The middle row of the rung-4 table failed quietly: a comment asking for work reads like permission
to do it. `Stage: Implement` was the gate; a request in prose asks to *scope* work, not start it.

## A run with nobody to ask files the finding

Nine sessions in the week to 2026-10-03 (listed on `sydevs/claude-workflow#146`) found real
SahajCloud defects while implementing other work. Each read `AGENTS.md:21` (*"Ask before you edit or
close a GitHub PR or issue, and before you create or edit an issue"*) as forbidding an unattended
ticket, and put its finding in an unrelated PR body; the merges took the findings along. Four
were access-control gaps, e.g. a field `read` lock gating output but not `where`, so
`managers?where[email][equals]=` still answered whether an address was held.

The guide's own *"A new PR needs no prior approval"* already split new work from mutating items;
what was missing was **precedence** between a product guide and these skills. The loop's rule was
inconsistent too: `implement-ticket` capped nothing, the handlers that became `write-ticket` capped
at one, and `review-pr` gave a critic's off-PR finding nowhere to go. `run-audit` exempts findings
you trip over, so the cost was review capacity, never a ceiling breach. Rejected: **PR body only**
(loses every merged finding; the prose handlers and critic open no PR) and **one standing ticket
per repo** (a new `-label:` exclusion in every query, like `ops-journal`; `awaiting` forever).
So findings are routed, never dropped: owning PR, ticketless PR if small, else a ticket. The
`SahajCloud/AGENTS.md:21` carve-out was extended, not deleted (SahajCloud#949): attended sessions
ask first; unattended runs follow `start-run`.

## Every claim names the call that produced it

Building the old `📋 Awaiting you` table from a live query, not memory, once closed a real gap
between what a run narrated and what GitHub held. This rule generalizes that fix. Two runs produced
confident, **wrong** claims that read as measured fact:

- a fabricated clock skew, reasoned from an unexplained time gap
- a claim that `<details>` blocks were stripped on write, reasoned from an MCP readback

Neither named a call, and "inferred from" in front of either would have exposed it as a theory. A
journal that mixes measurement and inference unmarked is worse than a shorter one: the reader cannot
tell where to apply skepticism.

## The journal day is a local date

Keying to UTC would split a local day across two issues: the nightly run creates its issue at 1am
Vancouver time, 08:00Z, so the UTC date matches only by coincidence. Creation time is intrinsic and
cannot drift, so there is no date field to set or read.

## details survives the write path

Writes stay intact and render collapsed: REST (`gh api`) showed every tag, 8 pairs in a PR body and
2 in a journal comment, on 2026-08-31. The MCP *read* path strips `<details>`/`<summary>` while
returning `<table>`, `<a>`, and `<sub>` verbatim. One run built a long case that "the write path
drops them" from this evidence. The evidence was real; the read layer, not the write layer, strips.

## Sessions linger

`persist_session: false` controls whether the *next* fire reuses a session, not whether this one
dies. Lingering is platform behavior, not a fault to work around.

## The run-audit is not a ladder

The nightly run, now `run-audit`, was then the survey routine, split out so a busy queue could never
starve it. Both still shared one skill file and one rung numbering, implying a ladder no run
descended: the nightly run executed "rung 6" without rungs 1–5, the loop run stepped over 6 on its
way to 7, and the shared bookends, preflight and journal, carried rung numbers.

Inserting one loop rung forced a renumbering sweep across four files for an unchanged nightly run,
and the nightly spec silently dropped preflight — identity, auth, ceilings — because "rung 0" read
as the ladder's business. So the runs are now two skills over shared bookends, and **rung means one
thing**: a step of the loop run's ladder.

## One review per PR, ever

A re-reviewing bot argues with itself across revisions and doubles the reviewer's reading; the human
approver judges revision quality anyway. One review also keeps the rung cheap to make idempotent.
The key is an existing own-login review, read from GitHub just before writing — never search, a
lagging derived index, and never memory, which a crashed run lacks.

## Reviews are COMMENT-only

GitHub rejects `APPROVE` and `REQUEST_CHANGES` on your own PR, and the loop authors the PRs it
reviews. Even where allowed, a human skimming, or a future rule, could read an approving bot review
as merge authority, which belongs to the reviewer's approving review alone.

## A rebutted critic thread is resolved

The ruleset merges only with every thread resolved. A critic thread that `address-review` rebutted
stayed open "for the reviewer," who then had to read a debate between two sessions and resolve the
bot's thread by hand. The critic is advisory, its point was answered with evidence, and the summary
comment links every rebuttal, so a rebuttal on an own-login thread resolves it without loss. It
stays open only for a question the reviewer must answer; a human's thread is still theirs to
resolve. The rebuttal must be legitimate: in #269, two "on scope" rebuttals were relevant doc
fixes that should have been adopted
([A docs fix is a PR, not a ticket](#a-docs-fix-is-a-pr-not-a-ticket)).

## The author filter's one exception

The filter (why: #respondto-is-an-allowlist) keeps the loop from treating its own words as
instructions. The adversarial review is the one artifact meant to address itself, so it needs a key
the filter can honor without a carve-out swallowing the rule: **comment type plus thread root**.
GitHub separates review threads from conversation comments, and the loop starts review threads in
exactly one place, so "an unresolved thread rooted by the loop's own login" identifies the review
with no marker string to drift or leak. The key holds only while that is exclusive, which is why
starting a review thread is rung 5's privilege alone.

## The review never shares the implementer's context

A critic that inherits the builder's reasoning inherits its blind spots, and a session that just
argued a design into existence cannot turn adversarial toward it. A fresh subagent with an empty
context and only the PR's coordinates comes closest to independent eyes. That is also why PRs opened
earlier in the same run are eligible: waiting a run was only ever a stand-in for fresh eyes.

## The reviewer profile is the learning surface

The skill loads on every review, so it stays short, stable, and philosophical; taste accretes in a
separate document the Sunday reflection can edit without a ticket. The profile was seeded from the
reviewer's full backfilled review-comment history across the five repos and shipped in the PR that
introduced this rung. The reviewer correcting their own portrait in that review was its first
calibration pass.

---

# finalize-pr

## simplify fans out

`/simplify` edits the working tree, and its fixes can land minutes after dispatch, well after its
first message. Editing the same files at the same time makes a patch fail an assertion, or a file
read back unexpectedly. The first suspicion is always a corrupted edit, not a second writer.

## A clean review report must carry its evidence

An empty result is harder to notice than a wrong one. Nothing about it looks like a failure. One
reviewer returned "no correctness bugs, production ready" after a **single tool call** over a
~2,800-line diff. A manual re-read then found a relationship's stored order silently dropped, so
`og:image` unfurled the wrong photo.

## Documentation lives outside .claude/

Writes under `.claude/` hit Claude Code's Protected Paths guard. It requires interactive approval
and runs *before* `permissions.allow`, so an unattended run stalls there without knowing it is
blocked. So the guides are nested `AGENTS.md` files, each with a `CLAUDE.md` symlink beside it:
they load when Claude reads files in that directory, and stay freely editable. Two corrections to
the rule as long stated here: **`.claude/worktrees` is exempt**, so a worktree does not stall a run
and `--no-worktree` was never the remedy; and **the guard reaches well beyond `.claude/`**.
`.npmrc`, `.gitconfig`, `.pre-commit-config.yaml` and the rest of the list in `AGENTS.md` stall a
run the same way. Six consecutive runs died on a one-line `.npmrc` change.

## Contract surfaces are mandatory

`docs/embedding.md` and `CHANGELOG.md` are the only documents an embedding site ever reads. The
SahajAtlasWeb README once spent months telling hosts to load a filename the build had never emitted.
References to guide paths also hide in `.env`, CSS, test files, and `.distignore`, so a docs sweep
limited to markdown leaves links pointing at deleted files.

## Link the branch alias, never a commit alias

A commit alias pins to the SHA it was built from, so every later push silently makes it stale, and
a reviewer sees old code with no way to tell. #181 carried links three pushes stale, including one
to a component the review had asked to delete. Telling a run the rule failed twice. The second
break came with a confident rationale: "these are per-deployment aliases, so they stay pinned to
this commit." That reasoning came, correctly, from a script built for a consumer that must test the
exact SHA it was handed. A run handed one tool for two conflicting requirements satisfies whichever
one the tool argues for, so the fix needed a second tool, not a firmer instruction.

The alias is discovered, never constructed: Cloudflare labels it `Branch Preview URL` in both the
Pages check-run summary and the Workers comment. Two branches agreeing on their first 28 characters
produce one alias, which answers 200 while serving the wrong branch. A wrong link that 404s makes a
bad Preview section; a wrong link that works makes a bad review.
`workflow/skills/finalize-pr/SKILL.md` owns the mechanism and the exact commands.

## Construct a number, discover a slug

*"Preview URLs are discovered, never constructed"* was written from Cloudflare and applied to
Railway, where it is wrong. The hosts differ in their **key**, not their platform, and the keys fail
in opposite directions. A **pull request number** cannot collide, so constructing it risks nothing,
while discovering it costs a read that may not have landed, and the *"preview pending"* a run writes
instead is never revisited, because the run ends at the push ([Push and end](#push-and-end)). A
**branch slug** is truncated, so constructing one risks a link that works and lies
([Link the branch alias, never a commit alias](#link-the-branch-alias-never-a-commit-alias)).
`workflow/skills/finalize-pr/SKILL.md` owns the mechanism and the config key for the host kind.

## A preview link must open on data

SahajCloud#874 ran for eighteen phases. Its Preview section linked three admin pages (country list,
state list, import batches). Every phase refreshed it, the critic read the body once, and no one
opened a link. The preview database held one row, the admin account the deploy provisions, so the
country list was empty and the Import tab the PR was about was unreachable. The manual-verification
steps named `tests/fixtures/event-import-sample.csv`, never committed. The links passed every check
(right host, existing paths), because the rule never asked whether the route showed the change.
Seeding the preview by hand afterwards found three import defects: nine of thirteen German
addresses geocoded to the wrong town, which any reviewer with data would have seen in a minute.

A Railway preview keeps its Postgres volume across deploys, so seeding costs one run per PR. Anyone
with the URL and the admin address can reach it, so the seed uses synthetic or anonymised people:
the 874 seed replaced 495 coordinator identities with `atlas-manager-<id>@preview.invalid`. A
Railway host builds only after its PR opens, so the run that opens the PR must wait. Leaving it to
the next run failed: a single-phase PR with a clean critic has no next run before a human reads it.

## Show the shape, not the file list

The body used to open with Summary, Phases, then an optional `## Changes` file list, so a reviewer
rebuilt the change's shape from file diffs: which contract moved, which call now runs where, which
component owns the new state. Prose summaries answered that badly. The outline answers it as small
`diff` views, and the Preview shows it running, so both lead the body and are exempt from every
length rule: "keep the visible body short" was written against essays, and applied to the outline
it cuts the one part the body exists for.

The views come from `visual-pr` in humanlayer/skills, ported rather than installed. Installed, it
fails the loop four ways: **a routine loads no plugins**
([A skill can name a plugin no routine has](#a-skill-can-name-a-plugin-no-routine-has)); **it
replaces the whole body**, dropping `## Phases` and `Closes #N`, which the dispatcher reads; **it
writes with `gh`**, which a routine lacks; **it opens its own PR when none exists**, a second path
beside `finalize-pr`. The `review-pr` check exists because a view that disagrees with the diff
points the review, which reads the outline first, at the wrong thing.

## The template owns the reflect PR's sections

In #148, seven rule statements in three files (three in `improve-loop`, four in `finalize-pr` and
its template) said what Sunday's `improve-loop` PR body leads with, and disagreed: the grading
first, or the outline and Preview first. A fourth turned up during the fix. #147 hit the collision
first and chose in a preamble. Its critic asked for a ticket, so one PR a week re-made the
judgement. It also shipped with no `## Summary`, which no file allowed deleting.

Naming `improve-loop` as the template's exception leaves
[Show the shape, not the file list](#show-the-shape-not-the-file-list) arguing against it. Moving
the grading out of the body needs a new `writing.budgets` kind (#147's grading section is 3527
characters, 2327 over `comment`, 2027 over `journalEntry`, and
[only bodies are unbudgeted](#budgets-not-adjectives)), and `AGENTS.md` forbids that config edit
riding the skill edit, so it costs two PRs across two weeks. So the template gained the two
headings `improve-loop` needs, as conditional sections below `## Preview`. The dispatcher reads only
`## Phases` (`dispatcher/markers.mjs`), a scan that breaks at the next heading of any level, so a
new `##` costs it nothing. The length exemption now covers the grading section, and `finalize-pr`
step 7 cites `pr-template.md` instead of stating the outline's position itself.

## A routine cannot reach the GitHub API

Not "should not." **Cannot**, by any client. Measured in a routine on 2026-09-02:

| Path or call | Result |
| --- | --- |
| `gh` (`command -v gh` · `ls /usr/bin/gh` · `find / -name gh -type f`) | absent; downloaded to `/tmp` it runs, `gh version 2.63.2` |
| `gh api repos/<in-session repo>`; `curl` `repos/…` with the token **and** without | **403**, byte-identical: "GitHub access is not enabled for this session. An org admin must connect the Claude GitHub App" |
| `search/issues` | **403**: "sessions are bound to their configured repositories. Use repository-scoped endpoints" |
| `graphql` | **403**: "only the pinned set of PR-review operations is served" |
| `/user` · `mcp__github__*` | **200** · works, scoped to the session's configured repositories |

`api.github.com` connects to `peer=127.0.0.1` behind a `CN=CCR Upstream Proxy CA (staging);
O=Anthropic` certificate: a TLS-intercepting proxy that allowlists **by path, regardless of
credential**. An invalid PAT, `Bearer` or `token`, or no auth header draws the same 403, so **a
self-managed PAT buys nothing**, and connecting the org's Claude GitHub App, as the 403 asks,
changed nothing. `example.com`, `de.sentry.io`, Railway apps, `raw.githubusercontent.com` and
`codeload.github.com` answer, and `git` fetch and push work through the credential helper.
**Decided 2026-09-02: no self-hosted relay.** The merge gate already works (MCP fetches,
`merge-verdict.mjs` decides), and a relay costs a service and a five-repo PAT in an environment with
no secret store, for a cosmetic win. Search and GraphQL are the real ceiling: search is
cross-repository by design, and the worklist (`assignee:<bot>` over five repos), the journal counts
and the awaiting-you table are all searches. `/user` answering 200 makes the token look healthy and
the repo look missing. **So a script never fetches.** `docs/routine-setup.md` claimed for weeks
that `gh` "ships in the image", the licence to write scripts that pass locally and fail silently.

## A routine cannot send SMTP

A routine reaches the network only through an HTTPS proxy, so SMTP to Mailpit's Railway TCP proxy
times out whatever the credentials (SahajCloud#807), and for weeks no loop PR carried an email
preview. #847 and #853 blamed a missing `SMTP_URL`, and this repo's setup guide said to add
`SMTP_URL` to the cloud environment, which could never have worked. The preview scripts post to
Mailpit's HTTP send API (`POST /api/v1/send`) instead, which a routine and a laptop reach alike
(SahajCloud#854). The cloud environment carries the ordinary Mailpit login, `MAILPIT_UI_AUTH`, which
reads every captured message. That is safe only because none is real: previews have their own
databases, and production mail goes to Resend. If Mailpit ever captures production mail, the
routine needs a send-only credential (`MP_SEND_API_AUTH`). `SMTP_URL` still matters, but only where
the **app** sends mail: Railway previews and a local `pnpm dev`.

## Draft is the PR's baton

**Pull requests have no fields**, so a PR's state must come from something GitHub already models.
`draft` fits: one bit, indexed (`draft:true` / `draft:false`), visible in every list view, and
already meaning "the author is still working on this" to every human. The old model moved the
assignee instead, a hand-back on every unit of work and a hand-forward from the reviewer, so
assignment answered *whose is this* and *is it finished* at once, ambiguous in exactly the cases
that mattered. Two invariants make the new model work:

- **A PR opens as a draft and is marked ready exactly once.** It never reverts, so `draft:false`
  means "has been ready at least once", and the adversarial review fires once only.
- **The loop never writes a PR's assignee, at all.** It finds its own PRs by `author:<bot>`. An
  early migration assigned the bot to every open PR so `assignee:<bot>` would find them, which
  doubled up with the reviewer's own assignment and made the field mean two things at once.

Leaving the field alone lets **a human delegate a PR the bot did not write by assigning it to the
bot**, and withdraw the delegation by unassigning it.

## A PR question is a thread on the line

The docs route told a run to put a decision point under `## Open questions` in the PR body. The
template had no such section and forbade adding one, so a run broke the template or dropped the
question. Even where it landed, a body section is read once, above the diff, and nothing makes
anyone answer it before the merge. A review thread on the line fixes all three: the reviewer meets
it inside the diff, the ruleset refuses to merge while it is unresolved, and a reply is an event
the dispatcher already routes to `address-review`. The run builds its recommended option first, so
a different answer costs one commit. Every question carries options, their implications and a
recommendation: a bare question makes the reader redo the analysis the run already did.

**Why a marker, not the review state.** The dispatcher treats an own-rooted thread with no reply as
the critic's finding and fires `address-review`. GitHub refuses `REQUEST_CHANGES` from a PR's own
author, so critic findings and questions are both `COMMENT` reviews by the bot. So each question's
root carries `review.questionMarker`, which the dispatcher reads as the person's turn, and which
exempts it from `review-pr`'s exclusive right to start threads.

## The board is a lens

The org project (`projects.url`) shows every open issue and PR in a `Status` lane, Awaiting for
anything needing a human. **The dispatcher derives `Status` after every plan, and no session reads
or writes the board.** At first GitHub's built-in workflows set `Status`. The
dispatcher took that write over with every other mechanical write, and the built-in `Status`
workflows are off so two writers never race. **Routines cannot reach Projects v2 at all**: probed
live on 2026-09-03, zero `mcp__github__projects*` tools resolve in the routine environment. **The
board is derived, so it lags**: a run reading it would hit `#search-lags-the-review-that-feeds-it`
in full, so the dispatcher writes `Status` from the record, relationships and PR, never as input
(why: docs/why.md#status-is-derived-never-read). The journal dropped its
`📋 Awaiting you` table for the same reason: the board answers "what needs me" continuously, so
restating it every run was a second implementation of one rule. The journal keeps what the board
cannot show: why a run failed, what a ceiling cost, which rule misfired.

## The rules cost more than the output

Measured, after the loop's comments looked like the problem:

| | |
| --- | --- |
| Skills loaded every run — `preflight` + `work-routine` + `journal` + config | **~148,600 tokens a day** |
| Every bot comment ever written, in total | ~152,000 tokens |

The output was never the largest line. **Bot ticket bodies run shorter than the reviewer's** (4,854
characters against 5,610), so bodies were never the problem. **One journal thread ran to 134,000
characters**, and a single response returned 97,279 of them and broke the run that read it. Every
paragraph in a run-loaded skill gets read eleven times a day, for as long as it exists. The
register, Simplified Technical English (ASD-STE100), is vendored into `preflight` because the
upstream skill runs 16,260 characters. `workflow/lib/ste-lint.py` is vendored from
`github.com/danyuchn/asd-ste100-skill` (MIT).

## Budgets, not adjectives

The rule this replaced read: *"Past roughly fifteen lines outside a `<details>`, it is an essay."*
Across 80 bot comments, **51% of all bytes sat inside `<details>`**, beyond the rule's reach though
still read at full token cost. The visible half ran to 3,364 characters, about forty lines.

- **A limit that exempts a container names where to hide.** `budget.mjs` counts the whole
  artifact, `<details>` included.
- **A limit with a discretionary exit is not a limit.** "Roughly" let every entry count as roughly
  compliant. The script returns over or under, and no clause permits an explained overage.

Ticket and PR bodies stay unbudgeted on purpose: they are state, and the grounding rule reads them
instead of the thread.

## A verdict word, not an exit code

`check()` has always returned `UNBUDGETED` for a kind `writing.budgets` does not name, and the CLI
exited **0** on it, so a typo'd or unnamed `--kind` read as a pass. That is how a review body spent
three weeks measured against `comment`'s 1200 (#145). `--fit` already exited 1 on `UNBUDGETED`, and
`finish-run` read that as *"cut prose from Friction"*, so a run that mistyped the kind was told,
forever, to cut text never over budget. The exit code cannot carry the difference, because both
answers are "not OK". So every verdict but `OK` now exits 1, and the skills act on the printed
word: `OVER` means cut, `UNBUDGETED` means fix the kind and cut nothing. Fixing only one half would
have left the loop acting on the wrong signal.

## A review body has its own budget

`writing.budgets` had three kinds, and a submitted review body was none of them, so `review-pr`
measured it as `comment` (1200) while asking for a holistic assessment, ranked findings, and a
What-was-checked section with enough evidence to check a clean verdict. SahajAtlasWeb#237 hit
1200/1200 only after cutting evidence. SahajCloud#874 dropped a PR-size note that was not wrong,
only last. SahajAtlasWeb#233 shipped with **no `identity.commentMarker`** (body 1197, marker 124).
SahajCloud#861 took nine trim passes to fit three sections and five findings.

**2000 is measured, not guessed.** Marker 124, harness attribution footer 58, `review.bodyHeader`
24: 206 before a word of review. Observed prose ran 1318 to 1913, so 2000 clears the 1318–1659 band
and still binds at the outlier. Raising `comment` was refused: it would loosen every ticket and PR
comment. What may never be cut (the marker included) is a general rule, so it lives in `start-run`
beside "shorten by leaving things out, never by compressing", since `write-ticket` and
`address-review` also fit the marker in `comment`'s 1200. An unnamed kind returned `UNBUDGETED`
with exit 0, which hid this gap for three weeks, so `workflow/lib/budget.test.mjs` now fails for
any `--kind` a skill names that `writing.budgets` does not.

## The marker check belongs in the script

`start-run` says to append `identity.commentMarker` to every comment, and that the budget may never
cut it. Both are prose, and SahajAtlasWeb#233 shipped a review with no attribution while following
them. `CLAUDE.md` gives a mechanical rule to a script, and `budget.mjs` already holds the artefact
on stdin and the marker through `loadLoopConfig()`.

- **A sibling of `writing.budgets`, not a shape change.** Turning each budget into
  `{chars, marker}` would break `budget.mjs`'s two number lookups, the fallback's `deepEqual`, and
  every `--kind` call. `journalEntry` is absent from `writing.markerRequired`: `finish-run` posts
  no marker, which is also why `--fit` never checks.
- **Presence, not position.** A loop comment carries the harness footer after the marker, so an
  ends-with test would fail a correct artefact. What #233 shipped was no marker at all.
- **Unconditional, not behind a flag.** A run that forgot a flag would get the silence this rule
  removes, so `check()` defaults the marker on and a budget-only measure needs an explicit opt-out.
- **New kinds declare themselves.** Listing the one exemption instead is the safer polarity, worth
  revisiting. A test requires every budgeted kind to be in `markerRequired` or its exemption set.

## Ground from the body, never the thread

`format-ticket` has always said *"comments are conversation; the body is state."* Nothing enforced
it, so a run grounding a ticket pulled the whole thread, body plus six comments, about 27,000
characters, to learn what 4,854 already held. Reading the body alone costs a third of that, and
**when the body does not carry what a run needs, the body is the bug**: fixing it improves every
future read. The journal is the sharp case: one day's thread reached 134,000 characters, and a
single `get_comments` call returned 97,279 of them, exceeding the token limit and breaking the run.
The journal is now one rewritten document per day, and **no run calls `get_comments` on a journal
issue** — except `improve-loop`, once a week, at `perPage` 20 on the days whose title or tally
block names something only a comment carries.

## Lint measures style, not content

`ste-lint.py` counts passive voice, semicolons, and long sentences. `rule-delta.mjs` extracts every
bold-or-heading imperative and diffs the set, so it answers **is every rule still there?** The
`journal` rewrite took violations from 16 to 4, cut a third of the bytes, and dropped **Never read
the board back**, half of `#the-board-is-a-lens`. Lint scored it a clear improvement; the rule delta
named the loss in one line. Nobody can validate a skill by running it: an edit takes effect next
session, merging is the deploy, and a dropped rule surfaces weeks later with nothing to blame.

Markdown wraps a directive across lines, so whitespace must collapse before matching: skipping this
once reported `Never force-push someone else's branch` as deleted when it had never moved. A raw
diff of #48 reported 14 disappearances, 11 of them `Do not X` becoming `Never X`, so rewordings are
filtered; three survived, one genuine. It is a tripwire, not a proof: a plain-prose rule is
invisible to it, and `Never X` weakened to `Avoid X` fuzzy-matches and passes clean.

## hasWorkflows is a filesystem check

`mcp__github__list_workflows` is not in the routine's MCP build. Four runs in a row journaled its
absence under `⚠️ Failed`, for a fact on disk the whole time: every repo in `repos` is cloned into
the run before Claude starts, so `.github/workflows/*.yml` answers `hasWorkflows` exactly, for
free, and cannot 403. **When the run already holds the checkout, read the checkout.** The failure
was harmless (an absent `hasWorkflows` reads as *this repo has CI*, so the gate stayed closed), but
a recurring `⚠️ Failed` line trains a reader to skim the section that exists to be read.

## A search with no is: qualifier cannot see a PR

For three runs on 2026-09-04 the census reported **`label:awaiting` returns zero, while PRs
demonstrably carry the label**, and blamed the label or the index. `mcp__github__search_issues`
says *"Already scoped to is:issue"* in its own description, and the census query read
`$SCOPE is:open label:awaiting`. Every `awaiting` item that day was a PR. Measured in the 19:03Z run:

| Query | Returned |
| --- | --- |
| `$SCOPE is:open label:awaiting` | 0 |
| `$SCOPE is:pr is:open label:awaiting` | 3 — SahajCloud #692, #691, #686 |
| `repo:sydevs/SahajCloud is:issue is:open label:awaiting` | 0 |
| `repo:sydevs/SahajCloud is:open author:sydevs-bot` (control) | 8, **all issues**, no PRs |

The census read blank while three PRs waited on the reviewer, and two runs spent their `⚠️ Failed`
line on a false fact (`#hasworkflows-is-a-filesystem-check`). Since the fix the PR census sees
`awaiting` on PRs and the survey drift sweep reads it, so a run newly stripping `awaiting` off PRs
is doing it because of this change. `search_issues` with a hand-written `is:pr` stays the one tool
over `search_pull_requests`: one tool with one syntax is easier to check than two defaults.

## Search lags the review that feeds it

SahajCloud#679 was approved at 04:45:57Z. At 05:12Z, rung 1's `is:pr is:open author:<bot>
draft:false review:approved` returned **zero results**, though `pull_request_read
method:get_reviews` showed `Ardnived` / `APPROVED` against `51fdbeb`, the head commit. The PR merged
that run only because rung 2 read `get_reviews` on it for an unrelated reason. An empty result is
indistinguishable from "nothing qualifies", so the loop would have journaled "nothing qualified for
merge" as fact while approved, green work sat for a cycle. Rung 5 already re-checked `get_reviews`
before writing (*"Search is a derived index and can lag. This read is authoritative."*); rung 1
treated `review:approved` as a free filter. `draft:` is ours, so the index cannot lag us on it.
`review:`, `-reviewed-by:` and `commenter:` describe other people's writes, and need an
authoritative read before anything irreversible depends on them.

## Only the reviewer's approval counts

Once it was clear no MCP call returns `reviewDecision`, rung 1's first derivation counted the latest
state-bearing review from every login **except our own**. An adversarial pass caught it before
merge: `claude-workflow`, `SahajCloud`, `SahajAtlasWeb` and `WeMeditateWeb` are public, so one
drive-by `APPROVED` from any account would have satisfied `merge-verdict.mjs` in four repos where a
merge is the deploy. The stand-in was wider than what it replaced: GitHub's `reviewDecision` is
computed against branch protection and requested reviewers. A derivation replacing a field must
stay narrower than it, or it is a new policy under the old name. Until that PR the gate had never
fired (`reviewDecision` was always absent, so rung 1 held everything), which hid the
permissiveness. As `preflight` says of blocklists, *a one-name blocklist of ourselves fails open on
everyone we have not met.* `assignment.reviewer` already defines approval authority, and
`reviewDecisionFrom` now enforces it.

## A review list arrives one page at a time

`SahajCloud#714` collected **60 reviews**, and the loop declined to merge it three runs running,
each time telling the reviewer their last review was `CHANGES_REQUESTED`. They had approved twice.
`pull_request_read method:get_reviews` returns 30 without `perPage`, and
`github.rest.pulls.listReviews` 30 without `per_page`, so both readers saw the same first 30. **One
inline reply is one `COMMENTED` review**, and a long revision round posted about 45. The last
state-bearing review in that window was a day-old `CHANGES_REQUESTED` on a commit four merges old;
the approvals sat at positions 57 and 59. The `synchronize` handler read the same stale page, so
every merge of `main` re-added `awaiting` to an approved PR: the label was the hold's twin, not its
cause. Truncation drops the newest rows, where the decision lives, and fails both ways: a stale
`CHANGES_REQUESTED` holds an approved PR forever, and a stale `APPROVED` would merge rejected work.
So `reviewsLookTruncated` makes the gate refuse a list that ends on a page boundary, where "I cannot
tell" is the correct verdict.

## A conflicted PR schedules zero CI runs

A conflicted PR has no computable merge commit, so GitHub schedules **zero** workflow runs for it,
silently. The checks list shows only non-Actions entries (a Railway or Cloudflare deploy still
happens, since those build the branch head), and the run list stays empty. It reads like a stuck
scheduler. Waiting is futile. A run that predates the base moving is stale, and it makes a
conflicted PR look tested when it is not.

## A conflicted draft is resolved too

The dispatcher fired `resolve-conflicts` only on a ready PR. Almost every loop PR is a draft until
the critic has run, and a conflicted PR schedules no CI. So a conflicted draft never went green,
`fix-ci` told itself "Actions dispatches resolve-conflicts" and stopped, and the PR sat until the
orphan sweep. Drafts are resolved now, since a conflict prevents the green CI that the critic waits
on. Because `resolve-conflicts` pushes nothing on a semantic conflict, a second fire on the same
head is refused, as `fix-ci`'s is: the PR waits on a person, and a push asks again.

## Every revision starts from the current base

`address-review` was forbidden from merging the base, even when asked, and `dispatcher/decide.mjs`
fires `resolve-conflicts` on `CONFLICTING` alone, so no handler could merge a PR that was merely
behind. On 2026-10-16 SahajCloud#912's reviewer asked for something needing `JobStageView`, merged
to `main` in #972 an hour earlier. The session could not import it (TS2307), pushed nothing, and
asked a human to click *Update branch* and mention the bot again. The refused merge was clean.

Now every `address-review` run merges the base first. A fix cannot miss what the base added, the
lean gate tests the code that would land, and a conflict surfaces while a session is on the branch.
This settles sydevs/claude-workflow#160: an `@sydevs-bot` request needs no special authorisation.
The ban came from SahajCloud#769: three conflict essays in twenty-five minutes, costly for the
essays, not the merges, so a clean merge earns one line and a semantic conflict aborts the merge,
not the run. Accepted cost: *changes since your last review* now includes what the base gained.
Retired reasons, not to come back: `claude-workflow` has no merge queue (`ci.noCi`); a preview
builds the branch head ([A conflicted PR schedules zero CI runs](#a-conflicted-pr-schedules-zero-ci-runs));
and the re-flagged approval ([A review list arrives one page at a time](#a-review-list-arrives-one-page-at-a-time))
is gone, as the `synchronize` handler makes a bot push a `note` now.

## A test fixture defines the world the test lives in

A run's unit fixture declared `Managers.roles` at the top level, "because that was easier to write
than the real config." In the real collection `roles` sits inside a `tabs` field, so the fix under
test was **completely inert on the branch, while lint, typecheck, and 1,527 unit tests all
passed.** Only two integration assertions caught it. More tests cannot fix this: a wrong fixture
defines the world every assertion in that file is evaluated against. A one-line pre-mortem is cheap
because it happens before the fixture exists, while the assumption is still conscious.

## A script here never fetches

Every script under `workflow/` takes JSON on stdin and returns a decision. None opens a connection
to GitHub. Four scripts once shipped calling `gh`: all passed every local test, none could run in a
routine, and they were abandoned within a day. Keeping them meant two implementations of every rule,
one local and one in skill prose running eight times a day. That is the defect that made the merge
gate unsafe: `get_status` versus check runs was never a fetching bug, but two readings of "green"
with no single home. **The run gathers, the script decides.** That gives up a scripted census's
token savings for one implementation, exercised identically everywhere. A script earns its place
when its input is small enough to transfer and its logic subtle enough to get wrong in prose:
`merge-gate` and `branch-preview-url` clear both bars, while a census, a count, and a markdown table
clear neither.

---

# reflect

## Reflect edits the profile only on recurrence

One comment is weather. Two PRs with the same theme make a pattern. A profile that absorbs every
remark verbatim converges on exactly the long DO/DON'T checklist the profile-plus-stance design was
chosen to avoid — a document the review skims instead of weighing. The gate keeps the profile a
model of the reviewer's *intent*, which generalizes to cases the week never showed, rather than a
transcript of their incidents, which does not. It also keeps the weekly diff small enough for the
reviewer to actually audit their own portrait.

---

# The plugin itself

## One copy of each skill, the differences as data

The four product repos once kept separate copies of the same workflow skills, held to a spec that
required byte-for-byte matches. By the time this plugin was written the copies had drifted 90 to
250 lines apart, steps had different names in each repo, and the drift audit compared against a
directory that no longer existed. Prose copied several times cannot stay in sync. So there is one
copy of each skill, here, and what genuinely differs lives as data in one `.claude/workflow.json`
per repo.

## An installed plugin does not track main

`AGENTS.md` said "no version bump matters," because `main` is consumed live. That holds for the
cloud routines, which fetch skills fresh each run. It was never true of `/plugin install
workflow@sydevs`: the install records a `gitCommitSha` in `~/.claude/plugins/installed_plugins.json`
and unpacks into `~/.claude/plugins/cache/sydevs/workflow/<version>/`, and neither is revisited.
While `version` read `0.1.0`, every session on that machine loaded install-day `main` forever.

On 2026-09-04 a maintainer's session filed a ticket with no Type, Priority, Effort, or Stage. The
loaded `file-ticket` was commit `864e72e`, the repo's first, pinned at install on 2026-08-27 and 53
commits behind a `main` that had since grown `format-ticket`, the native issue fields and `Stage`.
Twelve of seventeen skills were missing from that cache, and the marketplace clone sat nine commits
behind. `version` is the cache key, the only thing that invalidates it, so bumping the manifest is
a required part of any skill change, not a release ceremony.

## A missed version declaration passes CI

`cut-release` named three places SahajAtlasWordpress declares its version: the plugin header,
`readme.txt`'s `Stable tag`, and `package.json`. `package.json` there is dev tooling, declares no
version, and `.distignore` keeps it out of the zip. The list omitted `SAHAJ_ATLAS_VERSION` in
`sahaj-atlas.php` and `version` in `blocks/embed/block.json`. `SAHAJ_ATLAS_VERSION` is the `$ver`
on every enqueued asset, so a missed bump runs new PHP against the previous release's cached
`atlas-page.css` and `atlas-page.js`. `release.yml` compares the tag against the plugin header
only, so the build stays green. The v0.2.0 run caught it only by grepping for the old version.

A list of declarations is a copy of the repo's shape and goes stale; grep for the old version
instead. Since sydevs/SahajAtlasWordpress#33, that repo's CI checks the four known declarations on
every PR. The grep stays, for a fifth.

## Merging a version bump is the release

`cut-release` ended with the run pushing a `v*` tag once the bump PR merged. On 2026-09-25 the push
got `HTTP 403`: a cloud session pushes `claude/*` refs only, and no MCP tool creates a tag or
Release. It was also unreachable: the bump run ends before the merge (`#push-and-end`), and no
handler runs after one. The v0.2.0 bump merged 2026-09-18 and sat untagged a week while 13 sites
stayed on 0.1.0 (sydevs/SahajAtlasWordpress#31, sydevs/claude-workflow#126).

Such a write normally goes to a person (`#a-write-we-cannot-make-is-handed-over-not-thrown`), but
Actions can make this one. So `release.yml` runs on every push to `main` and, when the header names
an unreleased version, tags, builds and publishes; the human decision is the bump PR's approval. It
stays one job, because a tag pushed with `GITHUB_TOKEN` starts no other workflow. `GITHUB_TOKEN`
also may tag only a commit whose `.github/workflows/` matches a branch tip, which v0.2.0's bump
predated (sydevs/SahajAtlasWordpress#34). So it tags the bump commit, else `main`'s tip if plugin
files are byte-identical, else fails naming the manual command. A failed publish shows red on
`main`; Friday's publish check turns it into a ticket.

## Fit the journal, do not negotiate with it

`budget.mjs` answered only over or under, so a run that went over regenerated the whole body and
re-checked. On 2026-09-07 the 17:03 run did that thirteen times between 17:38:45 and 17:49:38,
shedding 1,557 characters in steps of 3 to 800. It reached 3,999 of 4,000 at 17:41:46, then wrote
a fresher `Last:` timestamp and spent four more re-checks getting back under. The 15:04 run spent
1 minute 43 of its twelve on five such rewrites. Each applied a fixed, written rule: drop the
oldest `📄 Did` lines first, never cut a failure. A fixed rule evaluated by a model eleven times a
day is eleven chances to differ, the same reason `merge-gate.mjs` exists. So the script cuts, and
the run writes.

A 200-character reserve came from that run, because the `Last:` rewrite broke a body fitted to the
last character. Since #71 the entry is a write-once per-session comment, and the headroom only
over-cut: it ate the whole `📄 Did` section of a 1,355-character entry against a 1,500 budget
("532 to spare"), and took a second line off a 1,599-character one already cut to 1,433. `--fit`
now cuts to the budget and stops.

## Actions observes, classifies, locks, and fires

The polling loop paid the same census on every fire. On 2026-09-07 it fired eleven times. Four
consecutive runs, 12:05 to 15:04, started nothing at rung 3 because three PRs awaited one Approve
click, and each paid for the census and a journal rewrite. A run that shipped a PR then watched CI
for twelve minutes, and its 47-minute length left thirteen before the next fire.

Every rung waited on a GitHub event, and the clock was a proxy for them. GitHub Actions already ran
on every one, so the dispatcher is that workflow grown up: it classifies the event with no tokens,
applies the lock, and fires one routine per handler with a pointer. Routine GitHub triggers could
not do this: they see `pull_request`, `issues` and `release` only, never a comment, review or
check, and carry no author filter.

## GitHub owns the merge

The dispatcher used to merge on its own verdict: one approval, every thread resolved, CI green.
That derivation failed three ways, each with its own heading. A stranger's drive-by `APPROVED`
would have satisfied it, in four public repos where a merge is the deploy
([Only the reviewer's approval counts](#only-the-reviewers-approval-counts)). It read 30 of 60
reviews and declined an approved PR three runs running
([A review list arrives one page at a time](#a-review-list-arrives-one-page-at-a-time)). Its
reading of *"green"* lived in two places ([A script here never fetches](#a-script-here-never-fetches)).

Each was a bug in re-deriving a verdict GitHub already computes from the same conditions. So
`mergeVerdict` is gone from `gather`, and the ruleset decides, with the merge queue rebasing and
testing in the four repos that have one. The dispatcher only **arms** auto-merge at mark-ready, the
first moment GitHub permits it (auto-merge is refused on a draft, and every bot PR opens as one). A
refused arming is handed over
([A write we cannot make is handed over, not thrown](#a-write-we-cannot-make-is-handed-over-not-thrown)).
`mergePolicy.loopMayNotMerge` names repos never armed, because merging `claude-workflow` is the
deploy and a ruleset cannot express *"a person decides this one."*

## The lock label is the lease

Two sessions on one item write over each other, and neither can tell. The label the dispatcher
applies before it fires, and the session removes as its last write, says which. While it is on, the
dispatcher fires nothing else at that item and records new events as rechecks; when it comes off,
the dispatcher re-derives from live state and dispatches whatever is pending.

One label, `bot:working`, serves issues and PRs, since a PR has no fields. Handler, attempt and
session link live in a status comment the dispatcher edits. The session reads the label before its
first write and before every push; gone means stop. The sweeper removes a label whose session
passed its deadline. The label is the lease a session **reads**; it does not decide a contest
between two dispatcher passes — see *The lease is a ref, not a label* below.

## Push and end

`finalize-pr` step 8 polled CI up to twenty times. On 2026-09-07 the 17:03 run pushed at 17:36 and
CI went green at 17:45; in between it started five overlapping waiters, called `get_check_runs`
eight times, and had one foreground `sleep` refused by the hook. CI completion is an event: Actions
settles the head SHA with `merge-gate.mjs`, dispatches `fix-ci` on red or the critic or mark-ready
on a green draft, and arms auto-merge at mark-ready. So a session pushes and ends, and never holds a
lock while doing nothing.

**The one exception is the preview deploy, in `finalize-pr` step 7b.** A preview build is not an
event the dispatcher routes, and no other run fills the preview with data, so a PR opened before
its preview exists reaches the reviewer with empty links (see
[A preview link must open on data](#a-preview-link-must-open-on-data)). The wait is bounded by
`preview.deployWaitMinutes`, allows one waiter, and reads deploy status only, never CI.

## The bot-actor exception

The dispatcher ignores the bot's own comments and reviews, or every reply would fire an empty run.
One bot event is load-bearing: the adversarial review, a `COMMENT` review by the bot on the bot's
own PR whose body starts with `review.bodyHeader`. Its threads are the critic's findings, which
`address-review` adopts or rebuts. The dispatcher keys on all three (header, author, PR author), so
an on-demand review of a human's PR never dispatches the bot to answer itself. The other bot events
that matter are pushes, which cause CI.

## The payload is a pointer

The `/fire` endpoint wraps whatever the caller sent in a block the session is told not to obey. The
caller is our workflow, but its bearer token could leak and fire any text. So the dispatch record
carries pointers only: repo, number, handler, lock, deadline, journal. `payload.mjs` validates the
shape and refuses anything else, and the session re-reads every fact from GitHub.

## One routine per repo, one prompt

The polling routines' prompt restated nothing, because restated rules went stale twice. The first
event-driven design had thirteen routines and prompts, one per handler. Nothing that differed
needed a routine: the handler is a record field, and `handlers.<handler>.skill` in
`loop-config.json` names the skill. A routine fixes which repos it clones, and every handler works
on one item in one repo. So there is one routine per repo, cloning it and its producer, and one
prompt kept verbatim in `docs/routine-setup.md`. It restates two rules — the lock is the lease,
push and end — because they must hold even when the `claude-workflow` clone fails.

The cost is one model and tool grant per repo: a short `write-ticket` answer runs on the same Opus
as `implement`, five to eight turns. "Never pushes" is a skill rule now; the lock label and the
dispatcher's actor filter were always the controls that mattered.

## A closed item is nobody's turn

sydevs/SahajCloud#747 merged while a session held the lock. Two minutes later the unlock path
re-derived the PR, got only a Status write, called it idle, and gave a merged PR `awaiting`. The
idle test asks whether the plan contains a fire, an arming or a mark-ready; on a closed PR the
answer is no by definition, because the work is finished. So the unlock path checks PR state first,
and a closed PR clears `awaiting` and `stuck` instead of gaining them.

## The critic skips small PRs

An adversarial review costs an Opus session, a CI cycle, and a round of the reviewer's attention on
the rebuttals, and a two-file, twenty-line PR rarely has the shape problem the critic exists to
find. Below `review.skipWhen` the dispatcher marks the PR ready at once and notes the skip.
`@sydevs-bot review` forces a review at any size.

## There is no WIP cap

The polling loop capped open bot PRs per repo at `wipCapPerRepo` because it chose its own work and
could otherwise start every approved ticket in one pass. Under event dispatch nothing starts without
a human verb, so whoever types `@sydevs-bot implement` is the throttle; a queue would only delay a
decision already taken and add an "approved but waiting" state. So `implement` fires at once, and
`Approved` is the Status of an authorised ticket, not a queue. A drag to `Approved` is still not a
verb; the dispatcher requires the comment.

Visibility replaces the cap. Each day's journal carries a sweeper-kept tally (dispatches per handler
and repo, items that took the most sessions), and the weekly reflect reports usage from seven of
them — a PR that needed six sessions, a review that fired `address-review` once per comment. That
is feedback to the people who type the verbs, never a limit.

## A resolved thread fires no workflow

`pull_request_review_thread` is a webhook event, not an Actions trigger, and naming it under `on:`
makes GitHub reject the whole workflow file: every event in that repo stops being handled, with only
a failed run named after the file path. It shipped that way in the caller merged on 2026-09-08, and
`gh workflow run` finally printed `Unexpected value 'pull_request_review_thread'`.

Resolving the last thread on an approved PR changes the merge verdict and nothing else. So the
sweeper re-derives every open, unlocked, non-draft bot PR on each 30-minute pass, which also covers
a CI event GitHub dropped. The cost is latency: up to half an hour.

## The board is a lens, so it may fail alone

The first live dispatch stopped on `TypeError: Cannot read properties of null (reading 'status')`.
The plan (`label, react, status:revising, fire:answer`) was right and the labels were written, but
setting Status threw and **the fire never happened**. `projectV2(number: 2)` returns `null`, with no
GraphQL error, when the token cannot see the org project; the code read `.status` off it. It now
throws `BoardUnreachable`, carrying the fix in its message.

A day later `itemOf` declared `$n` and never used it, GraphQL rejected the query, and
`BoardUnreachable` misreported it as a missing permission. The message now says what went wrong
first and guesses a cause only when the error reads like one, and a test fails on any query variable
declared but unused. The board is a lens over state the status comment already carries, so **a
board write that fails must never stop the dispatch** — an option the board lacks included. Every Projects call degrades: the run
fires and one `board-unreachable` anomaly goes in the journal.

## The journal pointer is an optimisation

The second live dispatch died on `POST /repos/.../issues` — 403, `Resource not accessible by
personal access token` — while creating the day's journal issue to name it in the record, before
the fire. `journal.issue` only saves the handler a search. So `ensureJournalDay` never throws: it
returns `0`, `payload.mjs` accepts it, and `finish-run` finds or creates today's issue itself, as
the nightly survey already does. The rule for anything the dispatcher writes: **the fire is the
work, and everything else is bookkeeping around it.** Failed bookkeeping should be visible, not
fatal.

## One journal a day, and the oldest one wins

The first day of event dispatch produced two journal issues. The nightly survey wrote #77 at 08:16
in its own format, with no `<!-- ops-journal:YYYY-MM-DD -->` marker, and a dispatch later wrote #78.
The session journalled to one and the anomalies went to the other, and each title counted half.

Both causes are closed. An issue matched by creation date for lack of a marker is **stamped with
the marker**, so later lookups are exact. Two `act` jobs can both find nothing and create, so after
creating, the dispatcher looks again and **closes its own issue if an older one appeared** — a rule
racing jobs agree on without talking. The scheduled journal job sweeps up leftovers every half hour,
keeping the oldest; it never runs on an event, so it never races itself. `improve-loop` counts a
week from these titles, and a day counted twice at half strength is worse than once.

## The marker reader matches words, not punctuation

`relationships.bodyMarkerFormat` is what the loop writes: `Blocked by: <url>`, exact. The reader
demanded the same: a line starting with `Blocked by:` and a full issue URL. Four live tickets on
2026-09-09 said `**Blocked by sydevs/SahajCloud#695.**` and the reader saw no blocker in any. Three
runs on 2026-09-08 journaled *"`Blocked by:` ships in three shapes"* under friction, and none acted.

A false positive makes a run skip a ticket and say why; a false negative makes it code against a
contract that does not exist. So the reader strips leading emphasis and bullets, matches the words
with or without the colon, and takes a URL or `owner/repo#N`. It stays closed where openness is
wrong: a bare `#N` names no repo, a PR is not an issue, another org is not ours, and a
struck-through line is a cleared blocker.

A fenced line is the fifth. `format-ticket/SKILL.md` documents the format inside a code fence, and
both the reader and `stripBlockedBy` acted on that example: swept over every tracked `.md`, it was
the one file that would have related `SahajCloud#632` and then had its own documentation deleted.

The rule belongs below the readers, not in them. `parseOpenQuestions` carried its own flag, and
adding one to `parseBlockedBy` would have left `parseRecheck` and `parseSentry` out — so a ticket
fencing an example `Re-check:` would have parked itself until that date. So `liveLines` drops
fenced blocks once and all four readers go through it. `stripBlockedBy` keeps its own loop, because
it must emit every unit it does not drop and each unit carries its own line ending; it shares
`isFence`. A reader-only fix would have related nothing and still deleted the documentation.

## A converted blocker line is deleted

The dispatcher used to convert a `Blocked by:` line into a native relationship and leave the line.
Every later `issues.edited` pass re-read it, so a blocker a reviewer cleared by hand was re-POSTed,
with `blocked` re-applied, on the next unrelated edit. On `sydevs/SahajAtlasWeb#266` a run
improvised a clear, `- ~~Blocked by: …~~`; the reader tested for the strike before removing the
bullet, so it read the line as live and restored the relationship. So the line is write-only: the
pass that makes the relationship deletes it.

- **The strip runs where the POST does**, in `apply`. A line goes when every in-org target ended
  related (already there in any state, or POSTed OK); one failed POST keeps it for the next edit.
- **It re-reads the body just before the PUT**, since `issues.edited` takes no lock.
- **There is no sender filter.** The bot's strip fires an echo `issues.edited` that finds no marker.
- **Only a pass that read the body strips it.** A stranger's line is never converted, so never
  stripped (why: docs/why.md#a-strangers-marker-is-text); a `block on` verb leaves the body alone.

The strike ordering was fixed too, or a misread line would relate and delete evidence in one pass.
The edit history keeps the `— <reason>` prose. A session cannot read relationships over MCP, so the
dispatcher's pre-fire check is the gate.

## An unresolved blocker line is reported

`sydevs/SahajCloud#987` said `Blocked by: …/pull/912`. `parseBlockedBy` returns `[]` for that line
— GitHub's relationship takes an issue — so nothing was created, no `blocked` went on, and no word
was said. `stripBlockedBy` leaves the line, rightly: it is the only record of the author's intent.
The result is a ticket that reads as blocked to every human and as ready to the machinery. The
`block on` verb has refused loudly in exactly this situation since it shipped; the body-marker path
had no equivalent.

So an unresolved line gets one comment naming it and the two accepted spellings. Nothing else moves
for it: `blocked` follows the relationship, and this line made none. The comment says that, rather
than "not blocked" — a sibling line that did resolve can be applying `blocked` in the same plan.

- **Report narrower than you read.** The matcher is loose by design, and that entry priced a false
  positive as a run skipping a ticket. A comment on a live ticket is dearer, so only a line that
  names a ref-shaped target and resolves none is reported. `Blocked by the lack of staging
  credentials.` is prose, and the first draft of this would have nagged its author.
- **Keyed on the targets, not the line.** There is no comment id on this path. The whole line
  would make the reason prose part of the identity, so rewording after the em dash — the edit
  people actually make — would re-post advice already read, and any later tidying of the matcher
  would re-nag every open ticket. A corrected target still yields a key never reached. The key
  sorts them, so their order is not part of the identity either: an author correcting one of two
  targets usually rewrites the pair.
- **The line is quoted as written**, bullet off and nothing else. The matcher's intermediate
  strips leading emphasis only, so quoting it returns `Blocked by #12.**` to its author and reads
  as the dispatcher having mis-seen the line.
- **A line that resolved one target stays silent.** That ticket is related and carries `blocked`,
  so the human and the machinery agree. A PR URL beside a resolved issue is as often reason prose
  — "until that PR merges" — as a second blocker, and reporting it would be a guess.

## A date belongs in a date field

A park used to be `Re-check: 2026-10-01` in `## Notes`, parsed by regex — a shape inherited from
`Blocked by:`, which must be prose because no session tool writes a native relationship. A date
never had that constraint: `Hold Until` is an org issue field a session writes with `issue_write`
and the dispatcher reads directly. It cannot be malformed, sorts and filters on the board, and
clears in one call that leaves Priority alone. `Re-check:` is still read for tickets written before
2026-09-09, until nothing carries it. So `issueFields.holdUntil` is load-bearing again after the
cutover slated it for deletion; only `Stage` goes.

## The lease covers the branch, not the item

`bot:working` sits on the issue an implement session was given; its PR carries no lock. But the
session owns the **branch** and keeps running for minutes after `finalize-pr` pushes. Every PR
event asked only whether the PR was locked. CI usually hides that window, but `claude-workflow` has
no CI, so `ci.noCi` calls a draft green the instant it opens, and the critic would fire against a
branch implement was still pushing to. So a PR is held while any issue it closes carries the lock,
at one issue read per bot-PR event: one session per piece of work, not per item.

## A PR is the answer to an implement verb

A dispatcher comment is never the bot's last word, so a refusal cannot silence a verb. But an
implement session answers with a **pull request**, so on unlock the verb still read as pending.
Every implement re-dispatched itself, hit the in-flight guard and refused: an act job, a comment,
and `awaiting` on a ticket whose PR was already open.

On unlock, an `implement` verb with an open PR closing the issue is now consumed, the ticket goes to
`Done`, and `awaiting` comes off. Any other verb still re-derives (a `revise` typed mid-session is
owed a run), as does an implement verb with no PR. `sweep-awaiting` undid this within the hour: an
`answer` or `revise` comment on a ticket with an open PR made the bot last speaker, so the sweep put
the label back and called its own correct write an `awaiting-drift` anomaly. An issue with an open
PR closing it is the PR's turn, in the sweep as at session end.

## Our own check runs are not CI

`ci.ignoreCheckNames` exists because the dispatcher runs on `pull_request_target`, so its jobs
appear as check runs on the PR head. It listed `dispatch / act` and matched by equality, but GitHub
names a matrix leg `dispatch / act (sydevs, SahajCloud, sydevs/SahajCloud, pr, 742, review, …)`, so
it never matched. `act` jobs are serialized per item with `cancel-in-progress`, and a cancelled run
reads as failing. The dispatcher called its own cancelled jobs red CI and fired `fix-ci` against a
PR whose only real check passed: five sessions, three on one PR, then the cap, then `awaiting` on
sydevs/SahajCloud#742 with the reason naming its own job.

The list now matches a name or that name plus a matrix suffix (not any longer name, so `dispatch /
actions-other` is not ignored), and `dispatch / journal` and `legacy` joined it. Anything the
dispatcher does on a PR becomes input it reads, so every filter must match what GitHub actually
emits. Since [Only required checks are CI](#only-required-checks-are-ci), the list matters only when
the ruleset cannot be read, and every check counts again.

## A stacked PR is never armed

The loop does not stack. A PR based on another PR's branch has no ruleset behind it, so it needs a
second review merged in order, the parent's squash and branch deletion retarget it with the parent's
commits back in its diff, and it splits "a change you ask for on a PR is built on that PR" across
two. SahajAtlasWeb#340, stacked on #318 by a rule that keyed on author, was the only one in the
last 100 PRs of each repo (2026-10-27), and was merged back into #318. So a stacked PR found anyway
reads Awaiting with one comment and runs nothing. Never arming it is the guard behind that: GitHub
refused #340 only because it was clean ("Pull request is in clean status"); with checks pending it
arms, and merges unreviewed when they pass. That refusal came as a GraphQL `UNPROCESSABLE` with no
HTTP status, so `handOver` now reads `errors[].type` too.

## A write we cannot make is handed over, not thrown

`markPullRequestReadyForReview` came back `FORBIDDEN` on sydevs/SahajCloud#744. The job died on the
unhandled error, so the reviewer request and label after it never ran, and a finished PR sat in
draft with nothing said. A bug should throw, because a loud job is how we find it. **A permission we
do not hold is not a bug**; dying on it only skips the rest of the plan. So a denied write hands
the step over: the plan finishes, the item gets `awaiting`, one comment names the step the token
could not take, and the journal records a `handed-over` anomaly. This is the third instance after
the board and the journal: **the dispatcher's job is to get the work to a person or a session.**

## Quote the refusal, do not name a cause

The hand-over comment blamed the dispatch token for every refusal. Three merges failed that way
with no usable explanation: the token was fine and the branch ruleset said no. A missing scope and a
branch rule both answer 403, and the rule can also answer 405 or 422, which the old test missed. Only
GitHub's sentence distinguishes them, and a guessed cause sends the reader to the wrong fix, such as
rotating a credential that was never the problem. So the comment carries 220 characters of what
GitHub said and names the step, nothing else — the runs' anomaly rule
([Report anomalies, do not explain them](#report-anomalies-do-not-explain-them)) applied to the
dispatcher.

## A draft that is ready is not an orphan

Eight draft PRs sat six hours on 2026-09-09, each told *"This draft has had no CI activity for
hours and no session holds it."* They were green and critic-reviewed; the one step left was
mark-ready, which the dispatch token was refused. The sweeper re-derived only **non-draft** PRs,
because the conflict scan it borrowed skips drafts, so a draft was reachable only through the
six-hour orphan rule. **Re-deriving recovers a missed event** and belongs on every pass, on every
open unlocked bot PR. **The orphan notice admits defeat** and belongs at the end of a long timer.
Now the derivation runs every pass, and the notice only when it found nothing left to do.

## An anomaly says itself once a day

Thursday 2026-09-10 posted **44 comments** on its journal and **zero** sessions ran. Forty-three
were dispatcher anomalies carrying **eleven distinct facts**. `sydevs/SahajCloud#754` alone produced
12 `ci-capped` and 6 `orphan` lines that day, 22 of Saturday's 25, and was re-reported four days
later. `attempts-exhausted`, `ci-capped`, `orphan` and `handed-over` each paired a keyed
`commentOnce` on the item with an unconditional `postAnomaly` on the journal, so the journal got one
per sweep pass, forever. (`sweep-orphan` re-runs `evaluatePr`, so a stuck PR cost three a pass.)

**The journal is `improve-loop`'s only input**: a title reading *37 anomalies* when eleven things
are wrong loses the number that matters, and the `<!-- tally -->` count inherits it. The key is the
**visible line**: same kind, same item is one fact however many dispatch ids produced it, and a
changed reason posts. A listing the dispatcher cannot read falls through to posting, because a
duplicate is cheaper than a silence.

## A quiet awaiting item is swept in silence

Guarding `postAnomaly` stopped the journal repeating, not the repetition. The review on #95 noted
`sydevs/SahajCloud#754`, capped and already `awaiting`, still drew a `label`, a `commentOnce` and
an `anomaly` call on **every** pass — 48 a day for a condition no pass could clear — and the label
write was not deduplicated at all.

`awaiting` is the dispatcher's record that it has said everything and the item is a human's.
**Anything that clears `awaiting` is new activity, and every way to clear it — a comment, a review,
a push, a verb — is an event the dispatcher already wakes on.** So a pass that finds `awaiting` on
and derives no move has found the state the last pass left: it runs the derivation and drops the
plan. The gate is on the plan, not the fetch: `sweep-pr` still gathers, the only way to see a
resolved thread or a refused write (why: docs/why.md#a-resolved-thread-fires-no-workflow). Those
show up as a move (`merge`, `markReady`, `fire`), so they pass the gate.

## A review comment is feedback, whatever its association

A `CHANGES_REQUESTED` review with four inline comments on `sydevs/SahajAtlasWeb#212` at
`00:56:35Z` dispatched nothing until the reviewer asked why eleven minutes later. Two faults
compounded. **GitHub stamps a review comment `CONTRIBUTOR` for the same login it stamps `MEMBER` on
issue comments.** `resolve.mjs` routed review comments to `issue_comment`, gated on
`hasAccess(association)`; both survivors logged `comment by Ardnived without write access — not
feedback`, a redundant check over the `respondTo(author)` allowlist that could only subtract. And
**a review with inline comments emits five events in one second**, in one concurrency group: one
runs, one pends, three were cancelled, including the only ungated path,
`pull_request_review.submitted`. The survivors returned a `note` before `evaluatePr`, breaking
`dispatcher.yml`'s invariant that cancelling is "safe only because the decision is re-derived".

The fix: review comments get their own reason and re-derive through `evaluatePr` (`gather.mjs`
fetches threads), so any surviving leg on a bot PR reads whole state; `association` left the facts.
The critic's review relies on its `unlock` re-derive. On human PRs, a verb in a review body with
inline comments can still be lost until `gather.mjs` collects review-comment bodies. All 76 tests
passed with and without the patch, so the new cases were written first and committed red.

## A routine clone is not a developer's checkout

`worktreeSetup` was named only in `implement-ticket` step 6, so other handlers never installed, and
a fresh clone ships no `node_modules`. **37 sessions across five days** paid in the week to
2026-09-27 (17 on Monday), 30-odd the week before. Runs worked around it (`npm pack
payload@3.86.0`, registry `curl`, `unpkg`, `jsdelivr`) or without: one critic left its two key
files unread, four `revise` runs cited repo-side lines. `/security-review` runs `git diff
origin/HEAD...`, which a routine clone lacks: **11 sessions across four days**, each fixed with
`git remote set-head origin main`. Both belong to the checkout, so the rule moved to the file every
handler reads; the key keeps its name in protected `.claude/workflow.json`.

**A third, hidden gap:** a stale `origin/<default-branch>`, **11 sessions across four days** to
2026-10-03. SahajCloud#859's critic read 83 files and 32,953 insertions for a 3-file diff;
SahajAtlasWordpress#47's nearly filed a false release blocker; SahajAtlasWordpress#50's clone sat 9
commits behind. So step 6 fetches first, and `FETCH_HEAD` is no recipe (a later fetch emptied
`review-pr`'s diff three times). `rule-delta.mjs`, `comment-lint.mjs`, `comment-fingerprint.mjs`
need that fetch via `base-ref.mjs`: on a tree equal to `origin/main`, `--base main` read 25 skill
files behind. **The install is deferred** to the first node command: 11 read-only sessions skipped
it, but three could not then settle a claim and one curled `unpkg`.

## A skill can name a plugin no routine has

`finalize-pr` step 2 named `/pr-review-toolkit:review-pr all` as its whole review pass for three
weeks. `ListPlugins` returns nothing in a routine — **14 sessions across four days** in the week to
2026-09-27, on top of 17 across four the week before — and every one substituted `/simplify`'s
lenses, `/code-review`, `/security-review` unprompted. So the step names both and says to check
which it has. The heading above is the same class with a different missing thing, so each keeps its
own story.

## A contract sync is a PR, not a ticket

**Amended by [Docs fixes and re-syncs ride the feature](#docs-fixes-and-re-syncs-ride-the-feature).** A goal's consumer PR takes the re-sync as a commit.

A consumer's copy of a producer's file — SahajCloud's generated types in WeMeditateWeb and
SahajAtlasWeb, the atlas URL contract in the WordPress plugin — has one correct content: the
producer's, on `main`. Yet Thursday's survey filed a `Task` for a stale copy, and
`implement-roadmap` filed a child in every consumer, each waiting on a proposal review, a human
`implement` verb and a session to run one command. So `contractSync` in `loop-config.json` names
each copy's producer sources and consumer command and paths; when a merged producer PR touches a
source, the dispatcher runs the command on the consumer's `main` and opens one bot PR. Red CI goes
to `fix-ci`, the survey opens any missed sync, and `implement-roadmap` files a child only for work
that needs a decision. The same holds for audit-contracts findings where the source is plainly
right (a misdescribing doc, a missing changelog entry, a dead command); a ticket is kept for when
the code may be the wrong side.

## The lease is a ref, not a label

The label was taken too late to be a mutex: `gather` read `locked`, `decide` ran on that snapshot,
and `apply` wrote the label after `ensureJournalDay` and up to twenty issue reads, so a second pass
in that window also saw `locked: false` and both fired. `decide`'s `conflict-scan` and cross-repo
`unblock-check` targets drain inside the running job, and a group is scoped to the calling repo
(`dispatcher.yml` is reusable), so SahajCloud's `dispatch-WeMeditateWeb-144` and WeMeditateWeb's
own never serialize. **No concurrency group can serialize cross-repo work.** A status-comment
read-back fails too: `PATCH /issues/comments/:id` is last-writer-wins, and W1-write, W1-read,
W2-write, W2-read has each pass read its own id back.

`POST /repos/:owner/:repo/git/refs` is a compare-and-swap: 422 when the ref exists, so one create
wins. `refs/sydevs-lease/<number>` is taken before the label and deleted wherever the lock is
released; its existence is the lease, outside `refs/heads` and `refs/tags`. An orphaned ref is a
permanent lock, so every release path deletes it, a throw before the fire releases it,
`sweep-timeout` deletes it on reclaim, and `sweep-lease` reclaims one with no lock or session.

## A session past its deadline owns nothing

The sweeper's timeout removes the lock, releases the lease, and re-fires the same handler, which
re-adds `bot:working` in the same pass. Sessions linger past their deadline
([Sessions linger](#sessions-linger)): a slow one re-checks before a push, finds the label, pushes
onto attempt 2's branch, and its `finish-run` strips attempt 2's lock. The label cannot say whose it
is; the record's deadline can. So the re-check reads both, and a session past its deadline neither
pushes nor unlocks. The re-check applies only where the run holds a lock: read literally, it
stopped cron, repo and local runs at their first push.

## A failed release says so

Every release path called `releaseLease` and dropped its boolean. A ref that would not delete (a
403, a protected-ref rule, an outage) left the lease standing, and the next `takeLease` got 422
`already exists`, read as contention, the one path that posts no anomaly. The item stopped for good
with nothing journalled. The release now posts a `lease-release-failed` anomaly, itself guarded so a
failed post cannot break an already-failing exit path.

## One target per item

A concurrency group does not queue three legs: one runs, one pends, a newer pending cancels the
older, as `dispatcher.yml` records. The sweeper produced three for one blocked, stale, open draft
bot PR — `unblock-check`, `sweep-pr`, `sweep-orphan` — so the middle one was silently dropped. Now
`resolve` emits one target per `repo#number` carrying every reason, and `act` drains them in order
in one leg, as it already did for emitted targets. The decision is re-derived per reason anyway.

## A dispatch id is unique per fire

The stamp dropped sub-second digits, so two fires in one second shared an id. SahajCloud#867: one
`review-pr` id, two journal entries one second apart, indistinguishable in `rec.dispatches`, the
tally and the status comment. Milliseconds alone still collide within the millisecond where two
passes of one event land. A four-hex-digit random suffix carries uniqueness; the millisecond stamp
stays so ids sort by time.

## A fix-ci fire is keyed to its head

The three `fix-ci` dispatches on SahajCloud#861 and on SahajAtlasWeb#245 were serial and
lock-respecting, each re-deriving a decision the first session had made and stood down from. A red
run emits several `workflow_run`, `check_suite` and `status` events per push, each its own `act`
run; `evaluatePr` fired `fix-ci` on any failing check under the ceiling, keyed on nothing, and the
first session's unlock re-derived the same plan. Only `ceilings.ciFixIterations` stopped it, which
is why it was exhausted and then refused the real fix. Now a session that already ran and ended
against this head sha, whatever its outcome, means no second fire; a new sha asks again.
`rec.dispatches` keeps 20 entries, so a long-lived PR can age one out; the ceiling is the backstop.

## A queue failure is a CI failure

SahajCloud#959 entered the merge queue about 60 times between 2026-10-15 and 2026-10-23 and failed
typecheck every time, on one identical queue commit for the last 40 tries. #957 had merged a new
importer of the export #959 removed, and the PR's own head never contained it, so its own CI stayed
green. A queue run tests a temporary `gh-readonly-queue/<base>/pr-<n>-<sha>` commit that no PR
points at, so `resolve` found no PR for its `workflow_run` and dropped it. GitHub disarmed
auto-merge, and the next `sweep-pr` saw approved, green and unarmed, and re-armed it — straight
back into the same failure. `fix-ci` never fired, the ceiling never counted, and no anomaly reached
the journal. Now the branch name maps a failed queue run to its PR. The failure is kept in the
status record against the head it failed on, and while that head stays unarmed it is repaired
under `ciFixIterations` like red CI, never re-armed. `cancelled` is not a failure: the queue
cancels a run when it rebuilds a group after another entry failed. A PR still armed is that
rebuild, so it is left alone.

## The journal tally needs a writer that cannot stop

Monday 2026-09-28 reported 22 dispatches and 1 anomaly against 37 and 4; Thursday 2026-10-01, 84
and 6 against 97 and 7. Monday's counted set was exactly its first 22 session comments, so the
counter stopped rather than miscounted. `refreshTally` had one caller, `journalTick`, reachable only
from the scheduled `journal` job. The tick was unguarded, so a throw in `closeDuplicateDays` skipped
the tally; nothing revisited a day once `localDate` moved on; and `dispatch / journal` is in
`ci.ignoreCheckNames`, with no anomaly posted, so failure was invisible.

**The schedule is also not the schedule.** 212 runs from 2026-09-09 to 2026-10-06 — about eight a
day against a declared fifty, two to five hours apart, all `success`. #134 froze at 00:31Z with 6.5
hours of its day left. So no tick is guaranteed near midnight: each step is guarded, a failure posts
a `journal-tally` anomaly to the day's issue, and **every** tick re-counts yesterday under its own
weekday as well as today, writing nothing when counts agree. The weekly reflection builds its usage
report from the seven titles and tally blocks alone, so these are the one input a crashed week
cannot reconstruct.

## A review body is feedback

The dispatcher fired `address-review` whenever a `respondTo` review had a non-empty body, but
`address-review` looked only at unresolved threads and the newest conversation comment. A review
whose feedback sat in its body — *"rename X; drop the fallback"* — started a session that found no
thread, did nothing, and ended. Now each distinct point in a `respondTo` review body submitted after
the bot's last comment is an item, answered like a thread: adopt with a commit, rebut with evidence,
or ask. The summary comment quotes each point with the SHA or evidence, and being newer than the
review's `submitted_at` marks it handled — the dispatcher's `since` test — so a resumed run never
answers twice.

## Subscribe only to what resolves

The callers subscribed to `assigned`, `field_added` and `field_removed` long after the state machine
that needed them retired; `resolve.mjs` had no rule for them, so each started a run that resolved to
zero targets. `unlabeled` was worse: only the lock coming off matters, but the dispatcher removes
`awaiting`, `stuck` and `proposal` on most passes with a token whose events trigger workflows, so
nearly every dispatch paid for a second, empty one. Now the `types:` list names only actions
`resolve.mjs` turns into work, and the caller's job-level `if:`, evaluated before any runner starts,
filters an `unlabeled` for any label but the lock and an `edited` that left the body alone (the only
part the dispatcher reads markers from). The lock's name is literal there, since a caller cannot
read `loop-config.json`. Change `labels.lock` and the five callers together.

---

# Roadmap, tickets and audits

## The roadmap tier

A ticket used to carry what someone wanted, how the code should change, and the unsettled
questions at once. When this tier was designed, 25 of the 59 open issues had a `## Open questions`
section, most waiting on a human: a technical reader could not build them until someone decided,
and a product reader could not decide through file paths. So there are two tiers. A **Roadmap
ticket** is a public plain-language goal (why, success, not included, every decision as options
with a recommendation). An **implementation ticket** is Claude-ready: no open questions, an
approach, an executable checklist. Bugs and small tickets skip the roadmap, which would only add a
round trip. A human approves the goal once its decisions are settled, and its children in one verb.
A goal lives in its milestone's one home repo, and `revise-roadmap` asks the dispatcher to move a
childless goal there (why: docs/why.md#a-session-asks-actions-acts).

## A stranger's marker is text

The project went public with a "Suggest a goal" form, so anyone can open an issue the dispatcher
reads. Until then every body came from a member or the bot, and a `Blocked by:` line was trusted on
sight (a native relationship, a `blocked` label, later an `unblock-check` that fires a session); a
`Re-check:` line parked the ticket. From a stranger each is a write nobody chose: a relationship
naming SahajCloud#632, a recheck session paid for when it closes. So the dispatcher reads
`author_association`: on `issues.opened` by a non-member it converts no marker and honours no
`Re-check:` park. On `issues.edited` the editor decides; only the author, the bot or a maintainer
can edit a body, so the one edit refused is a non-member author's own. A member's edit makes it
state.

## A dispatcher-owned marker is qualified by its author

A stranger's *body* marker is text, read against `author_association`. Four markers the dispatcher
writes into its own *comments* had no such test, and a comment needs no association at all.

`commentOnce` deduped an advisory on `body.startsWith(mark)` alone, and every key is guessable from
the item: 16 of the 18 on `main` prefix a fixed word with a head sha, a comment id or a PR number,
and `blocked` and `approve-open-questions` are bare words. So anyone who could comment could
pre-post `<!-- sydevs-dispatcher: blocked -->` and silence that advisory for the item's life — the
dispatcher reads its own marker back and logs `already posted`. `loadRecord` was worse: it returned
the first comment that parsed, so a comment starting with `MARKER` seeded `current`, `pending`,
`fixCi` and `dispatches`, naming a handler and an attempt nobody dispatched.

The journal carries the other two, and it is a public issue in this repo. `postAnomaly` deduped on
the visible line, so a hand-posted `⚠️ **<kind>** · <text>` silences that anomaly for the day — its
own doc comment said *"said once a day, like the `commentOnce` beside it"*, and the resemblance was
exact. `refreshTally` counted every author's `sydevs-dispatch-done` marker, so a stranger could
inflate the day's title and the tally block `improve-loop` reads as the loop's usage evidence.

Every filter is the one clause `isBot` already applies elsewhere: the author must be
`identity.expectedLogin`. None costs a call — the listings all four seams already make carry
`user.login`. Each seam applies it in the idiom its signature already uses: `postAnomaly` and
`refreshTally` take `config`, so they call `isBot`; `commentOnce` and `loadRecord` take scalars
only, as `inSetBuild` does with `lock`, so the login is threaded in and `isLogin` holds the compare
`isBot` is now a one-liner over. The filter lives in `loadRecord`, not `parseRecord`, which sees a
body and no author, and in the journal's `ownComments`, not in its two readers: a session's own
entry is a comment too, but `finish-run` posts it as `identity.expectedLogin`, so filtering at the
listing keeps it and a third reader inherits the clause.

A missing expected login throws. Refusing every comment instead would be quiet in the wrong place:
`loadRecord` would report no record at all, and `sweep.mjs` reads a lock with no record as a
timed-out lease, so a seam that forgot to thread the login would break live sessions rather than
fail.

A comment the bot wrote under a former login stops being recognised, so on first contact every
advisory re-posts once and every record is re-created once. That one-off duplicate across the open
items in five repos is cheaper than a reconciliation path, and was chosen over one
(sydevs/claude-workflow#205).

## An outsider feeds, a member fires

A member's new goal is reviewed on arrival. Opened to the public, that would let anyone spend an
Opus session by filing an issue, and every handler is a cloud session with write access to five
repos, so a stranger's text inside one is a prompt-injection surface. Ignoring strangers would lose
the suggester's answers, often a review's best evidence. So a goal's author is the one non-member
whose comments count, as input only: they set `awaiting` with no session, and the next
member-started run reads them as data, never instructions. A non-member's goal waits `awaiting`
until a member says `@sydevs-bot revise` (accept) or closes it as not planned (decline). Verbs
already worked this way (why: docs/why.md#respondto-is-an-allowlist).

## A decision is settled before the build

An `implement` session that meets an unsettled decision either guesses, and the review argues it
inside a PR where it is most expensive to change, or stops, and a fire, a clone and a lease bought
nothing. Whether a decision is open is a checkbox count: `parseOpenQuestions` reads the `- [ ]`
lines under `## Open questions` (an option bullet is not one). So the dispatcher refuses
`implement` for free on either tier, says how many questions remain and how to answer, and starts
no session.

## A session asks, Actions acts

A session can write a comment, but not a transfer, a dispatch or a dispatcher-owned label
(why: docs/why.md#awaiting-has-one-writer). The roadmap tier needs all three: moving a goal to its
milestone's repo, re-planning a changed goal's children, and handing a parent to you when a child
raises a decision. So, as with `Blocked by:`, the session writes a marker the dispatcher acts on:
`<!-- sydevs-request {...} -->` in its own comment. Only `replan`, `escalated` and `transfer` are
read, and a transfer must name one of our repos. A request older than the session that just ended
is ignored, so old comments never replay. The transfer runs last, as it changes the issue number.

## Children are approved together

**Amended by [One verb plans and approves](#one-verb-plans-and-approves).** The first `implement` now plans and approves.

`implement-roadmap` turns one goal into ordered implementation tickets. One verb per child costs a
round trip each, and blocked ones rely on someone remembering for weeks to return when the blocker
merges. So `implement` on a **planned** goal approves every open child in one comment. Planned means
`implement-roadmap` has run: a review attaches existing tickets as sub-issues so the progress bar is
true from day one, and those were never planned. The first `implement` plans (adopting what is
attached); only the next approves, and a re-plan request before any plan is ignored. A free child
starts at once; a blocked one records `pendingImplement` and starts when a recheck confirms its
blocker cleared, with no second verb. The order lives in the `Blocked by` relationships. The
approval stays a human's (why: docs/why.md#the-loop-may-never-write-implement), and a child with an
open question still waits.

## A goal is verified, not assumed

Every child closing is not the goal shipping: a child can close as not planned, a plan can miss a
piece. When this tier was designed, SahajCloud#702 was open with every child closed. So the last
child closing fires `revise-roadmap` in verify mode, which notes what shipped and checks it against
`## What success looks like`: a match closes the goal, a gap sets `awaiting`, and `implement` then
files only what is missing. If a session holds the goal, the check is owed and runs on unlock,
unless that session was the check and no child closed after it fired. Children close seconds apart,
so a sibling's leg re-arms a running check: SahajCloud#897 was verified twice. When every child
closed as not planned, the fire carries `withdrawn`, so the run reports the goal unstarted and
rewrites the notes instead of hunting for merged PRs (SahajCloud#897).

## A late decision goes to the goal

A decision found while writing or building a child binds the goal. Left on the child, whoever reads
that ticket answers it, the siblings never hear of it, and goal readers never see it. So the session
adds it to the parent's `## Open questions` with options and a recommendation, links it from the
child, and sets `escalated` in its request marker. The dispatcher gives the parent `awaiting`, not
the child, so the question reaches you once. `implement-roadmap` files nothing until a decision
found while planning is answered.

## One author writes every implementation ticket

Tickets were written by `draft-ticket`, `cross-repo-issue` and three surveys, and rewritten by
`revise-ticket` and `answer-ticket`, each with its own idea of a complete body. So every bot-filed
proposal got an automatic `revise` session on arrival, because so many arrived half-specified:
sydevs/claude-workflow#160 was filed naming two dangling `docs/why.md` anchors, and the revision
found seven. A net under a weak author costs a session per filing. So `write-ticket` is the only
writer (for `file-ticket`, `implement-roadmap` per child, audits and rechecks), the automatic revise
is gone, and the `proposal` label marks a ticket until a human gives a verdict.

## Related findings share a ticket

**This amends [Split at reviewability seams](#split-at-reviewability-seams).** That rule said
where a split is allowed, not when to join, so "separable" became a reason to file two tickets.

The address-review run on SahajAtlasWeb#284 filed SahajAtlasWeb#285 (a unit-lane time budget) and
SahajAtlasWeb#286 (one shared `src/` walker for nine specs) 18 seconds apart. Each named the other
as sibling, both verified with `time pnpm test:run` (median of three), and #286's walker limited
what #285 could buy. Findings went to `write-ticket` singly and `create` sought only duplicates, so
the reviewer paid two triages, verbs, PRs, critic rounds and reviews for one sitting's judgement —
the costs [A ticket is built in phases, never split](#a-ticket-is-built-in-phases-never-split)
lists. So work one reviewer would judge together shares a ticket by default, each change keeping its
own Approach part and criteria; a run's ticket-bound findings go to `write-ticket` in one call;
`create` looks for a home, and an unapproved open ticket can absorb related work (an approved one
cannot); and `revise absorb #N` merges two existing tickets. Findings are never dropped or capped.

## The work you hold takes what joins it

**Amended by [The reviewer's ask is the spec](#the-reviewers-ask-is-the-spec).** Size no longer sends a joined part to a new ticket.

**This amends [Related findings share a ticket](#related-findings-share-a-ticket)**, which never
applied to the ticket in flight. Runs read "Never widen a PR" ("not part of") as "not listed in":
- **SahajCloud#920**, filed while implementing #899: the same URL-pattern collision binning
  proposal fields on another path. It said it "shares a root cause".
- **SahajCloud#939**, filed while implementing #938 (Next's upload body cap): a 413 masked as a 500,
  three contradictory size declarations, and #938's premise ("bodies over 50 MB already get
  Payload's 413") false. Only the ceiling needed a person; #940's critic point was "routed" there.

`review-pr` called anything unlisted scope creep, and `address-review` ticketed "anything that
generalises", against the reviewer's habit of sending a fix back to apply system-wide. So
format-ticket's join rule, plus same root cause and disproved premise, decides for tickets and PRs:
a joined finding folds into the work in flight with its own Summary bullet, any decision a question
thread with the recommended option built. Only a part that would not fit the run was filed.

## Decisions come with options

*"How should old atlas links behave?"* hands the reader a design task, and the ticket waits for
someone's free afternoon. *"A — permanent redirect (recommended), B — temporary until 2027"*,
each with its consequence, asks for a one-line choice. So every decision the bot raises (goal,
escalation, re-hold cap, direct ticket) is numbered, given options with consequences and a
recommendation. `@sydevs-bot revise 1A` or free text answers it; the bot ticks it and moves it to
`## Decisions` with the answer, who and when. A recommendation is not a decision: the bot waits.

## Push back before filing

When the roadmap was seeded, one goal (a safe intake for visitor submissions) already had fifteen
tickets across three repos bearing on it, fourteen closed, and nothing at filing had pointed new
authors at them. So `file-ticket` first searches open and closed tickets, roadmap `## Decisions`,
tickets closed as not planned, and each repo's `AGENTS.md`, `docs/` and `docs/why.md`. Work already
in the pipeline gets a recommendation to comment there; a request contradicting a recorded decision
gets it quoted back. The user can override, but deliberately.

## Experiments answer facts

A fact posed as an open question waits for a human to go and find out, and blocks the build, since
`implement` refuses while any question is unticked
(why: docs/why.md#a-decision-is-settled-before-the-build). So only a decision (product, policy,
ownership, budget) becomes a question. A fact is settled from code, docs or an experiment: a local
script, an installed package's source, a throwaway `claude/spike-*` branch for a preview URL, or a
read-only call to production SahajCloud or a vendor API. **Never a production write:** the routine
environment has read-only keys, having no secret store. **A spike is throwaway:** the session
deletes it, and the dispatcher ignores every `claude/spike-*` PR (no critic, `fix-ci` or orphan
notice).

## Effort was removed

Every author set Effort (Easy, Moderate, Hard), and only `implement-ticket` read it, to phase a
`Hard` ticket. After `split-ticket` was retired nothing else did, and it was a filing-time guess
re-estimated at each revision. `write-ticket` now writes `## Phases` from the code it has just read,
and a guessed size could only disagree with that. So the field is gone, and Priority, the
consequence of not doing the work, is the one field every ticket carries.

## Three audit rotations

`survey-analysis` ran Wednesdays only, stepping ten angles by ISO week, so each came round every ten
weeks and Saturday ran nothing; and correctness or security needs a ticket, performance or
accessibility a decision, a behaviour-preserving cleanup a ticketless PR. So `audit-code` runs
Tuesday (**risk**: Bug or Task tickets), Thursday (**experience**: tickets) and Saturday
(**hygiene**: prefers ticketless PRs; `comment-cleanup` became one angle). No family runs twice in a
row; each angle recurs every four to eight weeks. Hygiene's ticketless PRs, beside the docs and
test routes, are an exception to `prAllowlistGlobs` for a comment sweep `comment-fingerprint.mjs`
proves comment-only, dead code proven unreferenced, and a doc fix where the code is plainly right
(any family now sends docs fixes to a PR:
[A docs fix is a PR, not a ticket](#a-docs-fix-is-a-pr-not-a-ticket)). The proof replaces the
ticket, not the review. Rotations count their day's runs by date from `auditCalendar.rotationEpoch`,
so an override delays an angle rather than skipping it; a weekday can hold a list that takes turns.
`audit-contracts` overrode the first Saturday, then moved to Mondays, alternating with
`audit-deps`'s routine updates, when the dispatcher took vulnerability fixes.
([A vulnerability is checked before a session is spent](#a-vulnerability-is-checked-before-a-session-is-spent))

## Intake asks with options

`file-ticket` asked in prose and waited for a typed reply. With `AskUserQuestion`, each question
has options, consequences and a recommendation
([Decisions come with options](#decisions-come-with-options)) and one click answers it; each also
offers `Leave it on the ticket`, since the filer is often not the decider. The `gh` login is
compared with `assignment.reviewer`, read from `loop-config.json` so the rule stays a data edit.
Anyone else, or no login, is non-technical: technical questions go to the ticket unasked (a
"defer" pick is still uninformed), the preview is a plain summary (the body is written for a cold
run), and the hand-over is never offered (starting a build is the reviewer's call, and a comment
from outside `respondTo` authorises nothing).

## An answer before filing is the request

`## Decisions` records who settled what and when
([Decisions come with options](#decisions-come-with-options)), which earns its place once people
have read a ticket. Before filing, the answerer is the asker, and listing the answer as a decision
makes a fresh ticket read as argued over and splits one request across two sections. So an intake
answer goes into the section it shapes: a scope cut into `## Not included`, a behaviour into the
goal or criteria. After filing, the old rule stands.

## A docs fix is a PR, not a ticket

Sixteen docs-only fixes became tickets between 2026-08-15 and 2026-10-09; ten predate the ticketless
routes (#132, #152). The six since followed the rules: the handlers that find most drift
(`revise-roadmap`, `write-ticket`, `review-pr`, `address-review`) never push (SahajCloud#901,
SahajAtlasWeb#261); a comment fix fell outside `**/*.md` in `prAllowlistGlobs` (SahajAtlasWeb#264);
`write-ticket` widened a doc fix into code with a guard test (SahajCloud#810, #862). Only three
needed a ticket: a decision (SahajAtlasWeb#173), a browser measurement (SahajAtlasWeb#263), another
repo's copy (SahajAtlasWeb#226). So a docs-only fix where the code is plainly right is a ticketless
PR of any size, from any handler, on its own branch, the one exception to "never push". One that
must be a ticket is a `Bug`, off the roadmap.
**Widen before you open.** The next day, on SahajAtlasWeb#264, a session found five more comments
with the same retired premise; one needed a decision, so all became SahajAtlasWeb#270, and
`address-review` routed the critic's twin sentence on #269 there too *on scope*. A CSP measurement
for #263 produced SahajAtlasWeb#272. So a doc on the subject or stale premise of the work you hold
is that work's; else an open docs ticket gets a line, or an open bot docs PR (not locked or
approved) a commit, before a new PR. Decisions become question threads, unknowns are measured.

## A test fix is a PR, not a ticket

SahajAtlasWeb#285 and #286, from one review of #284, touched only specs, test helpers and config,
but the ticketless routes covered docs and `prAllowlistGlobs` (lockfiles, Markdown, generated types),
so both became tickets for changes that could not alter behaviour. So a test-only change takes the
docs route, except each is its own ticketless PR, never batched, unless the join rule sends it to
the work in flight. `findings.testGlobs` sets the scope; `test-only.mjs` proves a branch stays
inside it by path only, so a spec that loosens its own assertion passes and the reviewer still
judges each test. **Neither route reaches claude-workflow's own skills:** there `workflow/**` and
`loop-config.json` *are* what ships, and a drive-by fix would bypass the version bump,
`rule-delta.mjs` and improve-loop's recurrence bar, so those go to `🧭 Friction`.

## Only required checks are CI

GitHub merges on required checks: one in SahajCloud, three each in WeMeditateWeb and SahajAtlasWeb,
two in SahajAtlasWordpress. The loop counted every check and status but its own, and from 2026-08-28
to 2026-10-09, 19 of 53 `fix-ci` runs chased an unrequired red:

- **A Railway outage on 2026-10-07** turned SahajCloud#879, #880 and #885 red via commit status;
  `fix-ci` fired six times with nothing to fix (claude-workflow#164).
- **WeMeditateWeb#144** had two CI runs on one head; `cancel-in-progress` cancelled one, and
  `filter=latest` dedupes only within a suite, so it read as failing: three runs, then the cap.
- **A stalled Cloudflare Pages build** held WeMeditateWeb#109.

So `gather` keeps only the base branch's required contexts, newest run each; an unreported one
counts as queued. An unrequired red is said once on the PR and fires nothing. If the rules cannot
be read or require nothing, every check counts, since calling an untested PR green ships breakage.
`fix-ci` gets the list via `ci.reason`. `Smoke` waits on the Pages preview, so false reds narrow
but do not end.

## A bot PR answers a mention or a review

Any comment from a `respondTo` human on a bot PR dispatched `address-review`, so a note to a
colleague, a "will look tomorrow" or a thank-you each cost an Opus session hunting for something to
answer. Issues already required a mention. So on every surface a conversation comment reaches the
bot only through `@sydevs-bot`; a review on a bot PR, or a thread reply (which GitHub records as a
review), needs none. The check sits in the derivation as well as the event row, so the 30-minute
sweep agrees and leaves `awaiting` alone. A `review` verb asks for the critic, not a reply.

## A vulnerability is checked before a session is spent

`audit-deps` ran every Monday in every repo regardless, so a Tuesday alert waited six days;
SahajCloud's nodemailer alerts were open from 2026-09-30. Dependabot already knows severity,
production reach and whether a patch exists. So the dispatcher reads alerts daily and fires
`audit-deps` only for a high or critical runtime alert opened in the last day (or, on Monday, one
with a fix still open) where no dependency PR is open; reachability and major-version breakage stay
the session's call. The check keeps no memory: an alert judged unreachable returns on Monday, and a
failed fire is not retried. The first run found `SYDEVS_BOT_PAT` lacked the Dependabot permission
(four 403s), so unreadable alerts fall back to the Monday run, logged daily: losing the read must
never lose the audit. SahajAtlasWordpress ships no production dependencies and is skipped. With no
item there is no lock: a `kind: "repo"` record, accepted by `payload.mjs` only for a `scope: "repo"`
handler, kept idempotent by the daily cron and open-PR check. Routine updates stay on the calendar,
alternating Mondays with `audit-contracts`.

## Dependency review checks what a PR adds

SahajAtlasWeb required a `Dependency Audit` of the whole lockfile. From 2026-09-30 to 2026-10-03,
advisories against dependencies already on main (undici, then braces) failed
SahajAtlasWeb#233, #237, #243 and #248, none touching a dependency, and `fix-ci` rewrote overrides
and the audit baseline on them, leaving two in a merge-order hazard. A PR check should stop a PR
*adding* a vulnerable dependency, so `dependency-review-action` compares only what it changes; main's
advisories are the daily check's. It is a reusable workflow called from each repo's own CI, never
`dispatcher.yml`, because pausing with `BOT_DISPATCH` skips the dispatcher and an unreported
required check blocks every merge. It runs in the merge queue against the queue's base and passes
at once on other events, so the required name always reports.

## A push from a person resets the repair count

The cap comment promised *"A mention or a push from you starts me again"*, but `rec.fixCi` grew at
each session start and never reset, so a person's own fix to a capped PR got nothing: the next red
run went straight back to `awaiting`. So a head the cap has not seen, pushed by a `respondTo`
person, resets the count and fires `fix-ci`. The bot's pushes never reset it, or the cap would mean
nothing. `gather` fetches the head author only once the cap is reached, costing ordinary reds
nothing.

## An infrastructure failure is re-run, not repaired

Every red required check fired `fix-ci`, which cannot fix a Railway outage, a 25-minute job limit or
an unpublished preview: on 2026-10-07 one outage drew six fires on three SahajCloud PRs
(claude-workflow#164), and a capped PR sat `awaiting` for a cleared fault. So `gather` sorts them:

| Failure | Counted as | What happens |
| --- | --- | --- |
| Timed out, never started, or cancelled with no newer run | infrastructure | re-run |
| A failure carrying an error annotation titled `ci.infraLabel` | infrastructure | re-run |
| Any other failure | the change | `fix-ci`, as before |

All-infrastructure reds re-run the failed jobs, up to `ceilings.ciInfraReruns` per head, then go to
a person, with no session; a mix still fires `fix-ci`, whose push re-runs all. A check marks itself
with `echo "::error title=infrastructure-failure::Railway published no preview within 15 minutes"`
before `exit 1`, and still goes red. The PAT lacks Actions scope, so re-runs use the caller's
`GITHUB_TOKEN` (`actions: write`); a refused one counts against the cap.

## A failed preview is read from its log

A failing Railway preview arrived as a commit status, not a check run, so the infrastructure path
never saw it. On 2026-10-07 three SahajCloud previews failed within 90 seconds while GitHub's tests
passed (claude-workflow#164), with nothing saying whether the change or Railway broke. Ignoring
the status was ruled out. So the dispatcher links each red status's `target_url` in the advisory
comment and `ci.advisory`; the session confirms it via `pull_request_read method:get_status`, and
`workflow/lib/railway.mjs` parses the deployment id (`?id=` on `railway.com/project/<p>/service/<s>`)
into a GraphQL log request the session sends; no script holds the token. **The token** is a Railway
workspace token (`railway.tokenEnvVar`): no secret store, every token can deploy, and a project
token covers one existing environment while each preview gets its own, so it reaches production
too. Without it, the link is commented for a person; there is no off switch. **The pass:** a failed
preview with green required CI fires `fix-ci` in `deploy` mode once per head, never mid-phases and
never touching `rec.fixCi`, so a flaky preview cannot starve a real failure. A repo cause is fixed;
an outside one gets a comment naming the log line. It never redeploys, a write to a vendor account.

## A reopened question says what it reopens

A reopened decision left `## Decisions` and came back with fresh options and no trace of the
previous choice. On 2026-10-10 four of the owner's decisions on SahajCloud#902 and #906 were
reopened in one afternoon, and finding each old answer meant reading the earlier body and thread
for prose like *"as decided on 2026-10-09"*, which no rule required. So a reopened question carries
one line before its options: when, by whom, and the previous answer with attribution, verbatim, so
the answerer sees what they reverse and `settle-roadmap` can mark it without guessing.

## Technical notes live in the body

The notes were one comment per goal, "created once, then edited in place", but the MCP surface edits
bodies, never comments, so each revise run posted another: by 2026-10-11 SahajCloud#902 had five,
the fourth opening *"a new comment rather than an edit of the third"*, each long prose split to the
1,200-character budget. So the notes are the body's last block, after `roadmap.notesMarker`, in one
`<details>`: one copy, edited in place, collapsed under the goal, and the MCP read path keeps the
content. Style: TL;DR first, facts in tables, one collapsible per topic, superseded facts replaced
(edit history keeps them). `writing.budgets.notes` is measured, never refused: prune, but record.

## A goal is settled in the terminal

Answering on GitHub costs a fixed-shape reply (`@sydevs-bot revise 1A 2B`), a cloud session and a
wait, and can be lost: a verb posted during a lock re-fires on unlock only if newer than the bot's
last comment. On 2026-10-09 an owner's answers to SahajCloud#902 were swallowed so; the review
renumbered the questions, and the answers pointed at different ones. The same owner answered about
forty questions in an afternoon via local `AskUserQuestion`. So `settle-roadmap` is preferred: it
writes decisions into the body (a human's edit, which later runs reconcile around) and posts one
comment with no bot mention, so nothing fires or races. It shows a diff first and re-reads a body
changed since reading. Replying on GitHub still works without a local session.

## A goal gets one ticket per repo

**This supersedes [Split at reviewability seams](#split-at-reviewability-seams)**, and the split
rule it introduced: a split at any seam where each part "can be reviewed alone", or for "a general
capability, built first". `implement-roadmap` designed the split, so it found seams every time:

- SahajAtlasWeb#259, one safe intake, became 15 tickets across three repos and at least nine PRs,
  split by layer: schema, screening and delivery, cutover. Five tickets (#796–800) were filed and
  closed the same day by one PR, SahajCloud#801.
- SahajCloud#664, passwordless sign-in, became five sequential PRs: session refactor, plugin and
  endpoints, sign-in pages, invite email, cutover.
- SahajCloud#897, transcripts, became four children and six PRs, one a docs cleanup for claims its
  siblings had made stale.

The rule had been tightened twice (seams, then "related findings share a ticket"), and the reviewer
still read every child, sent a second verb, and reviewed each PR against a feature that did not yet
exist. A third rewording would keep the step that produced the splits, so the step is gone: a goal
gets at most one implementation ticket per repo, carrying all that repo's work, because the repo is
the one split no commit can cross. A large ticket is built in one session
(see [A feature is built in one session](#a-feature-is-built-in-one-session)). Two unstarted tickets
in one repo are absorbed into one, the other closed as a duplicate; when `implement` finds that on a
goal planned under the old rule, it re-plans before approving.

## One verb plans and approves

**This amends [Children are approved together](#children-are-approved-together)**, which kept two
verbs on a goal: the first planned, the reviewer read the children, and the second approved them.
With one child per repo, reading the children repeats the goal's Technical notes, where
`revise-roadmap` now writes the build plan, one line per repo, before anyone says `implement`.

So the first `implement` does both. The dispatcher records `approveOnPlan` and fires
`implement-roadmap`; a plan with no open question approves every unstarted child, and one that
raises a decision approves nothing and returns the goal to the reviewer. A re-plan of an approved
goal keeps the approval. The approval is still the human's verb, carried forward, never invented
(why: docs/why.md#the-loop-may-never-write-implement).

## A feature is built in one session

**This supersedes [A ticket is built in phases, never split](#a-ticket-is-built-in-phases-never-split).**
Phases kept one ticket on one PR, which still holds. But each phase was a session: tickets
pre-planned `## Phases`, each phase got its own review pass, a session stopped early whenever the
next phase might not fit its 150-minute lease, and the next waited for green CI on a half-built
draft:

- SahajCloud#874 took ten implement sessions over about ten hours. It went ready after 17 hours and
  67 commits, then needed a hardening pass for duplicate classes and lost data.
- SahajCloud#968 grew its Phases list from four to ten; the extra six were review rounds, including
  a data-model rewrite after review had been requested.
- 29 items carry "did not finish after N attempts".

Every session re-read the ticket, branch and thread to rebuild what the last one knew. So a session
now builds the whole ticket on a 360-minute lease, pushing checkpoint commits only as insurance.
The draft PR opens once every criterion is met, so the critic and reviewer meet the whole feature
once. Only when the deadline leaves no room does a session push, say what remains, and end with a
`continue` request; the dispatcher starts the next at once, with the same flags, up to
`dispatch.maxAttempts` in a row. `address-review` uses the same request for an oversized review.

## A cross-repo set is built together

A goal across repos had one child per repo, and each consumer waited for its producer to merge
before it was even built. The reviewer judged the feature in pieces days apart, and a consumer
could ship against a shape that had moved on: after SahajAtlasWeb#259's cutover, both atlas write
paths still POSTed to SahajCloud endpoints the cutover had deleted (SahajAtlasWeb#214).

So children whose only blockers are each other build as one set: one `implement` session in `set`
mode, on the goal's lock, builds producer and consumers together. A consumer builds against the
producer's branch with the generated types copied by hand, since `types:cms` reads `main`. Every PR
opens once the set is built, naming its siblings, and the goal's lock holds every set PR
(see [The lease covers the branch, not the item](#the-lease-covers-the-branch-not-the-item)).

The consumer's `Blocked by:` line now orders the merge, not the build. A consumer PR is reviewed
beside its producer, but auto-merge is armed only once its ticket has no open blocker. The producer
merging closes its ticket, which frees the consumer through `unblock-check` with no recheck
session, and the contract re-sync lands on the consumer's PR
(see [Docs fixes and re-syncs ride the feature](#docs-fixes-and-re-syncs-ride-the-feature)). A
child blocked by anything outside the set still waits, and starts alone once its blocker clears.

## The reviewer's ask is the spec

**This amends [The work you hold takes what joins it](#the-work-you-hold-takes-what-joins-it)**,
which still let "a part that will not fit this run" go to a new ticket, and let `address-review`
rebut a human's point on scope. Both leaks were used against the reviewer's own asks:

- **SahajCloud#912:** eleven simplification threads, answered "All of it". The reply was "Filed as
  #960 … not another 2k lines on a 153-file PR". The reviewer said "integrate", then "Implement the
  rest of the work now", then "Complete the work now"; still open after ten days, 67 human comments.
- **SahajCloud#849:** a restyle request got "Not in this PR", and needed two more comments.
- **SahajCloud#861:** an unmet criterion became "a follow-up ticket". The reviewer: "Make the
  necessary changes in this PR, not in a follow-up."
- **SahajCloud#845, #919:** better designs deferred as out of scope ("I would land this first")
  came back with "expand the ticket … implement in this PR".

The bot treated working code as proven and the reviewer's design as optional. So a reviewer's ask
is built on its PR, whatever its size, across sessions if need be; only a fact may be rebutted. An
added requirement goes into the criteria as `(review, <who>, <date>)`, one spec for later sessions,
the critic and the completion check. A strong case for a separate ticket is proposed in the thread,
never acted on: *A — build it in this PR* (what it adds, delays), *B — file it as its own ticket*
(what merges without it, what stays inconsistent); the open thread holds the merge. Not a habit:
SahajCloud#714 asked "fold it in or follow up?" on six threads, and got "Fold into this PR" six times.

## Docs fixes and re-syncs ride the feature

**This amends [A docs fix is a PR, not a ticket](#a-docs-fix-is-a-pr-not-a-ticket), [A test fix is
a PR, not a ticket](#a-test-fix-is-a-pr-not-a-ticket) and [A contract sync is a PR, not a
ticket](#a-contract-sync-is-a-pr-not-a-ticket).** Those routes kept small fixes out of tickets, and
put each in a PR of its own. Of 255 bot PRs in the eight weeks to 2026-10-20, 32 merged at 30 lines
or fewer: 17 copied-contract re-syncs and 20 docs-only PRs, each with its own review.

So a docs or test fix a run trips over goes first into the PR it holds in that repo, whatever area
it touches, with its own Summary bullet. The ticketless PR remains for a run that holds none. A
contract re-sync is a commit on the consumer PR its goal built beside the producer: `contracts-plan`
finds it through the producer ticket's `blocking` relationship, and `contracts-sync` pushes there.
The standalone sync PR remains for a merge no goal is building against, or a push the feature
branch refuses.
# The Status lifecycle

## Status is derived, never read

Items fell into a dead zone with none of `awaiting`, `blocked` or `bot:working`: sydevs/SahajAtlasWeb#328
and #318, sydevs/WeMeditateWeb#124, #146, #150, #168 and #198 on 2026-10-27. Each label was set on a
transition, so a transition missed — a 503, a refused fire, a branch no row handled — left nothing.
Now `status.mjs` derives one of Awaiting, Blocked, Hold, Pending, Working and Done from the record,
the relationships, Hold Until, the lock and the PR, and `apply` writes it after every plan. No row
names a Status. The board is never read to decide; `rec.status` remembers the last value written,
so a different one on the board is a drag, reverted and journalled as `board-drag`.
`bot:working` stays: it is the lease a session reads, the unlock event Actions wakes on, and the
kill switch, and no session can read or write the board (why: docs/why.md#the-board-is-a-lens).

## Approval lives in the record

`Approved` was a Status, so writing the board was writing the approval, and a board that failed or
lagged lost it. `implement` now writes `approved: {by, at}` to the status comment. It survives a
blocker (Pending, not Blocked) and is spent by `hold`, `revise`, a reopen, an abandoned PR, and a
build that ends with no PR, whose comment says why. Pending is approval waiting; Awaiting is a
verdict owed. `pendingImplement` folded into it; `approveOnPlan` stays, as the order to approve the
children when the plan ends.

## Pending has a due, Awaiting has a reason

An approved, armed PR waited days with no owner (sydevs/SahajAtlasWeb#328, WeMeditateWeb#198): the
merge was GitHub's, the question holding it was nobody's. A wait the machinery owns now starts a
clock, `rec.pendingSince`; past `dispatch.pendingDueMinutes` the reconciler reads it again, up to
`dispatch.maxAttempts` checks, then hands it back with the reason (`pending-overdue`). A wait on
another open item — a blocker, a producer PR, a goal's children — has no due. A hand-back
(`rec.handback`) replaces `stuck` and every "your turn" label: it reads Awaiting until you act.
A blocker or hold outranks it, because nothing you do moves the item until that clears.

## A hold is a date, not a recheck

A recheck session confirmed a fact a date or a closed issue already held, and re-held quietly up to
`maxRehold` times. Now the date passing makes the ticket yours (one comment says so), and a blocker
closing starts an approved ticket at once or tells you about any other; the build stops with a
question if it is not free after all. `hold [until] <N days|weeks|months|date>` sets the date,
withdraws approval, and caps at `holdUntil.maxHorizonDays`; a bare `hold` spreads a batch across
`holdUntil.defaultDays`. `block until <reason>` asks a session to make it a relationship or a hold.

## A PR is merged or closed, never held

A held PR rots against its base and keeps its review threads open. `hold` and `block` on a PR are
refused with one reply: close it, and reopen it when it can go.

## The reconciler replaces the drift window

The drift sweep read only items updated in the last two hours, on a `*/30` cron that lands every
two to seven, so sydevs/WeMeditateWeb#124 and #150 sat unlisted for days. `reconcile.mjs` reads every
open item's labels, relationships, open PR, Hold Until and board Status in two GraphQL pages per repo,
and gathers in full only an item whose board value those facts rule out, or, on the cron, every
Pending item for its due. An event run checks its own repo too, capped at
`dispatch.reconcileMaxPerEvent`. A dispatch on a repo's `workflow-state.yml` is the on-demand full pass.

## A lease past its deadline is reclaimed

A 503 between the lease and the label left `refs/sydevs-lease/318` and `/146` with a `current` past
its deadline, and every later fire read the ref as contention, silently, for days. `sweep-lease` now
reads a session on record with no lock as the unlock it was, and times out a locked one past its
deadline, whatever the label says.

## A refused fire is Pending, not silent

A fire the lease refused recorded only `recheck`, which an unlock drains — and the item that held
the lease never unlocked. Now it also sets `rec.pending` with a retry in ten minutes, so the item
reads Pending and the reconciler fires it again. An unlock drops a refused retry and re-derives.

## A GitHub 5xx is retried, not fatal

One 503 mid-plan ended the `act` leg with the lease taken and no label written. Every call the
dispatcher makes now passes through `installRetry`, which retries a 5xx or a dropped connection
`dispatch.githubRetry.attempts` times with doubling backoff. A 4xx is an answer and is never retried.

## A member's PR gets the loop

A member's PR (`assignment.respondTo`) got nothing unless mentioned, so their own PRs sat outside
every lane. Now a ready member PR gets the critic once, a reviewer request and auto-merge like the
bot's. The reviewer is `assignment.reviewer`, or the other member when the reviewer wrote it: GitHub
refuses a request to the author (sydevs/SahajAtlasWeb#318). A member's draft is left alone until it
is ready or they mention the bot, and only a thread the bot rooted or another person's review asks
it for work. A member branch outside `claude/*` is reached through [the relay](#the-relay).
Anyone else's PR answers a mention and nothing more.

## The branch decides where a session pushes

address-review asked "is this PR mine?" by its author, and opened a stacked PR on any other. On
sydevs/SahajAtlasWeb#318, Ardnived's PR on the bot's own `claude/feat-147-submit-a-class` branch,
that produced #340: 15 commits a session could have pushed straight to #318 (2026-10-27).
#217 had fixed the same question in resolve-conflicts only. A cloud session can push to any
`claude/*` branch, whoever opened the PR, and to nothing else, so the branch is the only fact that
answers it. The dispatcher computes it once, as `flags.push` on every session it fires at a PR:
`direct`, `relay`, or `none` for a fork or a PR the loop only answers. start-run holds the one rule.

## The relay

Member PRs are mostly on their own branches (`fix/*`, `feat/*`, Copilot's `copilot/*`), which a
session cannot push to. Posting a patch in a comment handed the work back to the person, and a
suggested change only covers lines in the diff. Actions' token can write any branch in the repo, so
the session pushes to `claude/relay-<pr>-<sha>` on top of the PR's head and asks for it in a
`sydevs-request`. On the unlock the dispatcher checks the request against the PR as gathered now,
then fast-forwards the PR's branch (never forced), or merges server-side if the member pushed
meanwhile. A conflict, a moved relay ref or a refused write (a commit touching `.github/workflows/`
needs the token's `workflow` scope) is handed back in GitHub's words, and the relay branch is kept.

## An approved PR names what holds it

GitHub merges only once every thread is resolved, and an approved PR held by a bot question thread
showed nothing (sydevs/SahajAtlasWeb#328). An unresolved thread whose last word is the bot's now makes
the PR Awaiting, and an approved one gets a comment linking each such thread, once.

## A resolved conflict is not a new question

sydevs/SahajAtlasWeb#328 was approved three times: each conflict resolution ended in an idle unlock,
which labelled the PR `awaiting` and put it back on the reviewer's list. Approvals were never
dismissed. Now an approved PR a session touched derives Pending. Only a hunk the session asks about,
as a question thread, makes it Awaiting.

## Unknown mergeability is not clean

GitHub computes `mergeable` lazily: REST answers null, GraphQL `UNKNOWN`, and both were read as clean,
so an approved PR whose conflict was never computed waited forever. `gather` asks GraphQL when REST
is still null, and past the due an approved PR still `UNKNOWN` gets `resolve-conflicts`.

## A merge is pushed only with work

`address-review` pushed a clean base merge even when it adopted nothing, which re-ran CI and, with a
review requested on push, re-asked for a review nothing had changed. A base merge now opens every
`address-review`, `fix-ci` and continued `implement`, and is pushed only with the work or when it
resolved a conflict.

# Retired

Each entry is a failure someone paid for, under a mechanism that no longer exists. It stays so the
lesson is met, not re-learned. The line under each heading says what took its place.

### You cannot push to a human's PR

**Replaced by:** [The branch decides where a session pushes](#the-branch-decides-where-a-session-pushes), and [the relay](#the-relay) for a member's own branch.

The rule keyed on author and answered with a stacked PR into the human's branch. On #318 that branch
was `claude/*` and pushable, and #340 then needed a second review it could not be armed for.

### awaiting has one writer

**Replaced by:** [Status is derived, never read](#status-is-derived-never-read): no label says whose turn it is, so there is no second writer to drift.

`awaiting` drifted because two writers set it; then one writer set it on transitions only, and an item
whose transition was missed (sydevs/WeMeditateWeb#168, approved and labelled nothing) stayed unlisted.

### blocked and awaiting are exclusive

**Replaced by:** [Status is derived, never read](#status-is-derived-never-read): one value per item, so two labels cannot disagree.

sydevs/SahajCloud#780 got `awaiting` and `blocked` two seconds apart from one `issues.opened` plan.

### blocked follows the relationship

**Replaced by:** Status reads the native relationship on every pass, and the [reconciler](#the-reconciler-replaces-the-drift-window) reads it for every open item.

Four tickets had correct relationships and no `blocked` label, so the sweeper, which read the label,
never re-checked them. `is:blocked` in issue search matches a label, not the relationship.

### A park stops the dispatch, not the session

**Replaced by:** [A hold is a date, not a recheck](#a-hold-is-a-date-not-a-recheck): `implement` on a held ticket clears the hold and starts it.

A ticket parked with no label would have been dispatched, so the gate read the date and recorded a
refused `implement` as an approval waiting on a recheck.

### A locked item is never awaiting

**Replaced by:** [Status is derived, never read](#status-is-derived-never-read): a locked item derives Working, whatever row ran.

`opened` and `typed` ran in either order, and seven goals sat in the Awaiting view while the bot
worked on them.

### A roadmap ticket has no status

**Replaced by:** goals get a Status like any item, derived from their own verdict first and their children after ([Status is derived, never read](#status-is-derived-never-read)).

A lane from ticket rules (`Approved` for weeks) misdescribed a goal, so goals carried none and lived
in a Roadmap view. That left a goal awaiting its plan approval invisible on the board's Awaiting view.

### Recheck before awaiting

**Replaced by:** [A hold is a date, not a recheck](#a-hold-is-a-date-not-a-recheck).

A recheck session re-held quietly up to `maxRehold` times. Three re-holds of sydevs/WeMeditateWeb#146
ended in a dead zone after a 503, and every recheck cost a session to confirm a fact a date already held.

### A proposal is reviewed before you read it

**Replaced by:** one author writes every implementation ticket, so a proposal arrives fully
specified and no session revises it on arrival.

`issues.opened` fired `revise` on every bot-filed ticket, because the weakest part was written from
memory. sydevs/claude-workflow#160, filed naming two dangling anchors, was rescoped to seven by the
revision before a human spent a verb on it.

### A Hard ticket that will not fit one run is split

**Replaced by:** one ticket, one PR, built in phases. A split survives only at a reviewability seam.

`split-ticket` filed up to `ceilings.maxChildrenPerSplit` ordered children, each needing its own
verb, PR and review. [A ticket is built in phases, never split](#a-ticket-is-built-in-phases-never-split)
says what that cost.

### Rung 2 competes for the same budget

**Replaced by:** the ladder is gone; every handler is its own session.

Unblocking a PR and starting new work had to share one budget, and a blocked PR often delays
several tickets that depend on it.

### The adversarial review runs last and may starve

**Replaced by:** the critic fires on its own event, so nothing can starve it.

The pre-review rung ran only on budget nothing else claimed, so on a saturated day it did not run
at all.

### Rung 4 writes awaiting when it asks a question

**Replaced by:** `awaiting` has one writer, and it is Actions.

Rung 4 both forbade touching `labels.awaiting` and, twelve lines later, required adding it; the
2026-09-05 journal recorded the clash twice. `state-machine.yml:194` returned early for `sydevs-bot`,
so the loop's own reply re-raised nothing, and a ticket could end needing a human with no signal.

### Selection favours new work and blockers

**Replaced by:** nothing selects work; a human's verb does.

Rung 3 ordered by oldest `updatedAt` until 2026-09-07. One backfill of Type and Priority bumped 22
tickets in a single pass that day, reordering a queue nobody had touched. On 2026-09-07 the reviewer
also kept blockers inside their own `Priority` band, so a `Low` blocker of a `High` ticket stalled it.

### Derive the window from comment timestamps

**Replaced by:** there is no run window; an event carries its own item.

Field writes, label changes and bulk metadata passes all bump `updated_at`. One migration made all
38 open issues look like fresh feedback, on 2026-08-28.

### Blocked always carries a Hold Until

**Replaced by:** a park is the `Hold Until` field, and a blocker is a relationship.

Three journals in a row called a ticket "blocked" after its blocker had already merged.

### Unblocking never restores Implement

**Replaced by:** a recheck session decides whether the block lifted. Only an `implement` given
before the block starts the build afterwards, and only a human gave it.

No MCP tool reads an issue timeline, and the REST field-change event carries no field name or old
value, so the prior `Stage` was stored as `(was: X)` in the `Blocked by:` marker. A restored
`Implement` would have let the loop build a ticket no human had re-read, so it reverted to `Revising`.

### A PR's assignee is a record, never a signal

**Replaced by:** no assignee means anything now.

The state machine assigned the bot to its own PR once, on `opened`. Re-asserting it on `reopened` or
`synchronize` would undo a human's removal — the kill switch — on the next push. Reading it would
make authorship and assignment two answers to one question (`#the-state-machine-is-not-the-loops-job`).

### Mark the PR ready despite unsettled CI

**Replaced by:** Actions marks a PR ready, and only on green.

The reviewer's queue is built from `draft:false`, so a PR left in draft over uncertain CI vanished
from it, and that silence was indistinguishable from a crashed run.

---

### A ticket is built in phases, never split

**Replaced by:** [A feature is built in one session](#a-feature-is-built-in-one-session). One ticket is still one PR, no longer a series of sessions.

Size splits went stale: in the week to 2026-09-27, three of the five children of SahajCloud#664 met
this — #838 found *"three acceptance criteria are obsolete"* after #847 shipped, SahajAtlasWeb#223
went *"stale a second time"*, and WeMeditateWeb#135's revise could not ground its central claim. The
reviewer also judged each child PR against half a feature.

**Amended by [Split at reviewability seams](#split-at-reviewability-seams).** Splitting came back
for one reason only: a seam where each part can be reviewed alone. A split on size is still
retired, and a large implementation ticket is still built in phases on one PR.

### Split at reviewability seams

**Replaced by:** [A goal gets one ticket per repo](#a-goal-gets-one-ticket-per-repo). The repository is the only split.

**This amends [A ticket is built in phases, never split](#a-ticket-is-built-in-phases-never-split).**
It allowed a split only where a reviewer could understand each PR alone — separable parts, or a
general capability the goal then uses — never on size or across tightly coupled work.

**Amended by [Related findings share a ticket](#related-findings-share-a-ticket).** A seam
permits a split. It does not require one.

### Assignment alone is not the implementation gate

**Replaced by:** the gate is a `respondTo` human's verb.

At backfill time, four tickets already had open PRs closing them, and all four would have been
re-implemented had assignment alone been the gate.

### Fetch fields only where a search answered

**Replaced by:** there is no census to fetch fields for.

The census fetched every repo's issues to read `Stage`, at 8 to 29 KB each, measured on 2026-09-07.
Four consecutive runs that day (12:05 to 15:04) stopped at `wipCapPerRepo` with no work to start,
and each paid for all five.

### The state machine is not the loop's job

**Replaced by:** the state machine is deleted; the dispatcher owns every mechanical write.

The loop made event-determined writes up to eight hours late, and could forget them. An actor guard
(`github.actor != 'sydevs-bot'`) skipped the bot's own transitions; an author guard on `issues: opened`
left non-bot tickets with no `Stage` or `awaiting`. `synchronize` after `changes_requested` was
missed at first (sydevs/claude-workflow#42); see `#issue-fields-are-not-searchable` and `#only-the-reviewers-approval-counts`.

### Do not pin the journal

**Replaced by:** the journal is found by a body marker, not by position.

`pinIssue` is GraphQL-only, and a routine session's GraphQL serves only PR-review operations, so the
call could not succeed.

### Correcting an earlier claim

**Replaced by:** the journal is comments, and a comment is never rewritten.

The MCP surface cannot edit a comment but can edit a body, so corrections went into the issue body
while comments stayed as the record of what each run believed at the time.
