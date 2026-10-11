# Why each rule exists

The rules live in the skills. **This file holds the failure that produced each one, and nothing
else.** No rule appears here unless a `SKILL.md` already states it as an imperative.

The split is deliberate. `work-routine/SKILL.md` loads fresh on every run, about eleven times a day
across five repos. Extra length there costs tokens every run, and it dilutes the rules it carries.
But a rule with no story behind it is a rule a model can talk itself out of, the first time it
meets a case the wording did not predict. So the story stays one hop away, cited from the rule as
`(why: docs/why.md#anchor)`.

**Read an entry when a rule seems not to fit the case in front of you. Never read one to decide
whether to follow the rule.** If a story and its imperative disagree, the imperative wins, and the
disagreement is a bug in this file.

This file lives in the `sydevs/claude-workflow` checkout, next to `loop-config.json`.

---

# The runs — work-routine, run-audit, preflight, journal

## The routine prompt is not the specification

The two scheduled routine prompts are set through an API. They are not files in this repo, so
nobody can review them in a PR or diff them against the skills. For a while they restated about a
dozen of `work-routine`'s hard rules, "for safety." That duplication went stale twice:

- One prompt named a `journalIssue` config key months after `loop-config.json` deleted it and
  replaced it with the `journal` object.
- Another prompt still told the run to unsubscribe from PR activity in a form the skill had since
  changed, so the run followed a rule that no longer existed.

Neither divergence was visible from inside this repo, and neither produced an error. A run simply
followed the stale copy. Precedence must live somewhere a run can read it, and the only such place
is the skill itself.

## Never improvise around a missing credential

An agent that guesses when it lacks data is worse than one that does nothing. The guess reads
exactly like a measurement in everything it writes afterward, and the journal is the only record
anyone reads.

## Report anomalies, do not explain them

Four separate runs have reasoned soundly from an unmeasured premise:

- a permission refusal, read as absence
- an MCP readback, read as a failed write
- a rendered page, read as an uncollapsed `<details>` block
- a time gap, read as clock skew

Each explanation was coherent, detailed, and wrong. All four read as measured fact in the journal.
Diagnosing the harness is a human's job, and a harness theory that becomes the stated evidence for
a code change puts a wrong premise into `main`.

## A blocked run cannot see that it is blocked

An approval prompt in an unattended run does not fail. It **waits**, and the run resumes with no
memory of the gap. One WeMeditateWeb run lost about 75 minutes this way, against Claude Code's
Protected Paths guard. So when wall-clock time jumps, being blocked *is* the explanation. Do not
look for a second one.

From *inside* the run this is invisible. From outside it is not: the routines API reports a stalled
session as `worker_status: requires_action`, within about 90 seconds of it stalling. Six
consecutive `loop-WeMeditateWeb` runs sat in that state on WeMeditateWeb#97 — each burning its full
150-minute lease — because the dispatcher does not poll for it. That is a known gap, not a law of
nature. Until it is closed, a stalled run still costs a whole lease, and `start-run`'s
protected-path check is what keeps runs out of the trap in the first place.

Wake events carry an authoritative `current-time` in GitHub's own frame. Prefer it over the local
clock for anything compared against a GitHub timestamp.

## Titles yes, bodies no

Titles make the backlog legible, both to the run while it decides and to the journal's reader, and
they cost almost nothing. Bodies are the expensive part. Reading the whole backlog every run is the
single largest avoidable cost in this system.

## The ops-journal exclusion is mandatory

`claude-workflow` is both a repo the loop works on and the home of the journal. Without
`-label:ops-journal` on every worklist query, the loop reads its own diary as a backlog item. An
entry that mentions a ticket becomes a ticket, and each run's entry looks like fresh activity to the
next run. The failure compounds instead of showing up once.

An HTML-escaped `&gt;` in a search qualifier is accepted without error and returns **zero results**.
A silently empty search reads as "nothing to do."

## CI truth lives in check runs

Rung 1 read CI with `get_status` alone, for the loop's first week. That call returns commit
statuses. No repo here posts a commit status for its tests — GitHub Actions reports as check runs
instead, a separate surface `get_status` cannot see. Measured on two live PRs on 2 September, it was
wrong in both directions at once:

- **sydevs/SahajAtlasWeb#181** — `get_status` returned `state: "pending"`, `total_count: 0`,
  `statuses: []`. `get_check_runs` returned five check runs, all `conclusion: "success"`. A fully
  green PR would have read as "still running," on every run, forever.
- **sydevs/SahajCloud#672** — `get_status` returned one status, `success`: Railway's deploy
  (`created_at: 21:14:17Z`). The test job, a check run, did not finish until `21:31:40Z`. For those
  seventeen minutes, the gate said green while the tests still ran.

The second case is the one that matters. A rung-1 run waking in that window, on an approved PR,
would have merged untested code while following the skill exactly — the failure a safety gate
exists to prevent.

`workflow/lib/merge-gate.mjs` now owns the full definition of "green." It says why an empty
check-run list must never read as passing (a merge conflict schedules zero runs), and why `skipped`
and `neutral` count while a strict `success`-only test would not. This entry keeps only the incident
that forced the split.

## Never subscribe to PR activity

Declining to call `subscribe_pr_activity` is not enough. **Opening a PR auto-subscribes the
session**: GitHub fires a `subscription.created` event, `from="system"`, at PR-open time, before the
run does anything else. This was measured, not assumed, after the skill claimed otherwise. A run can
wake having never subscribed. Tolerate this. Do not try to fight it.

The subscription is not the only way GitHub can reach a finished run, and a run cannot end its own
session. Sessions stayed `active` a full day after their work finished, including ones that
unsubscribed exactly as instructed. So the subscription, not the session, is the part we control.

**The baton is the backstop, and it is why this stays safe.** A woken session's first act re-derives
the worklist from `assignee:sydevs-bot`. The item it was working on has already gone back to the
reviewer, so it finds nothing and exits. Under the old timestamp census, a woken session would have
seen fresh `updated_at` values and found real work. Handing back the baton is what makes re-entry a
no-op.

## You cannot push to a human's PR

A cloud session may only push to `claude/*`. A human's branch also carries their own commits and
backs their open PR — two of the three rejection conditions at once, so this is a wall, not a
permission worth asking for. A silent push would also leave the reviewer to re-derive what changed,
so each thread gets its own reply instead.

Base a stacked PR on their branch, and merging it is one click for them, updating their PR. Base it
on `main` by mistake, and it shows every one of their commits as part of your diff — unreviewable.

## An investigation must not be forced into a PR

Filing an empty PR just to fit the pipeline's shape is worse than no PR. It costs a review slot and
buries the real answer inside a description. The pipeline serves the work. Not the other way around.

## respondTo is an allowlist

Its own account is what first let the loop tell feedback from its own writing. Replying to itself
burns the reply ceiling and produces a thread that argues with itself. But *"the author is not me"*
is a blocklist with one entry, and it fails open on everyone it has not met yet.

The measurement: of the 200 most recent issue comments across SahajCloud and SahajAtlasWeb, 100 came
from `Ardnived`, **93 from `cloudflare-workers-and-pages[bot]`**, and 7 from `antontcymbal`. Under a
"not me" test, the preview-URL bot would have been the single largest source of work in the system,
and every new integration would add more, silently.

`assignment.respondTo` names the logins whose comments count as feedback, so an unknown author stays
inert by default. It is also the extension point: adopting a reviewing bot such as Copilot needs one
entry in `loop-config.json`, not a change to any skill.

## Issue fields are not searchable

`Stage` and `Hold Until` are read on every run. Neither can ever appear in a query.

GitHub documents a `field.<name>:<value>` search qualifier, and it works in the web UI, which runs
on GraphQL. Through the REST search endpoint, the only search a routine can reach, it is **accepted
without error and matches nothing**. Measured against `sydevs/SahajCloud`: `field.priority:high`
returned 0, though an issue with `Priority: High` demonstrably exists, while the control query
returned 24. The negation also returned 0, which is the tell. A working qualifier cannot have both a
term and its negation return empty.

This fails the same way an HTML-escaped `&gt;` fails in a query: silence, not an error. So every
worklist query uses only indexed qualifiers (`assignee:`, `author:`, `is:pr`, `draft:`, `review:`).
Field values get attached afterward, from `list_issues(fields:["field_values"])` — one call per
repo, five calls total, cheaper than the census it replaced.

## The loop may never write Implement

The property that keeps the loop safe to leave running: **it cannot authorize its own code.**

A `ready-to-implement` label once carried this. `Stage: Implement` carries it now. The mechanism
changed. The risk did not, so the same asymmetry carried over intact: the loop may move a ticket
*off* `Implement`, never onto it. Revoking only ever reduces its own autonomy, which is why revoking
is safe and granting never is.

The field version carries a real danger: the loop legitimately writes four other `Stage` values, so
writing one is a habit, not an exception. That is why the rule appears as a bare imperative in
`preflight`, `format-ticket`, and `implement-ticket`, rather than something inferred from an ownership
table.

## A request in prose is not permission

The middle row of the rung-4 table fails quietly. A comment asking for work reads like permission to
do it. It is not. `Stage: Implement` is the gate. A request in prose asks to *scope* the work, not
to start it.

## A run with nobody to ask files the finding

Nine sessions in the week to 2026-10-03 found real defects in SahajCloud while implementing
something else. Each read `AGENTS.md:21` — *"Ask before you edit or close a GitHub PR or issue, and
before you create or edit an issue"* — as forbidding an unattended ticket, and wrote its finding
into a PR body instead. Four of the nine were access-control gaps, among them a field `read` lock
that gated output but not `where`, so `managers?where[email][equals]=` still answered whether an
address was held. A PR body is read once, at review, and none of those PRs was the finding's owner.
The merges took the findings with them. The nine are listed on `sydevs/claude-workflow#146`.

Nobody was misreading the guide. Its own second sentence — *"A new PR needs no prior approval"* —
already separated new work product from mutating an existing item, and the other three product
repos carry no such line at all. What was missing was **precedence**: nothing said whether a
product repo's guide or these skills won, so nine sessions each resolved it conservatively, alone.

The loop's own rule was inconsistent too, so settling the repo-guide question alone would have left
the loss in place. `implement-ticket` capped nothing, the two ticket handlers that became
`write-ticket` capped at one, and `review-pr` was silent — a critic's finding that was not its PR's had nowhere to
go at all. The proposal ceiling was never in play: `run-audit` exempts a finding you tripped
over, so nine incidental tickets would have breached no number. The review-capacity cost was real.
The ceiling breach was not.

Two alternatives were rejected. **PR body only** is honest for `implement-ticket` and impossible for
the two prose handlers and the critic, which open no PR — and it loses every finding whose PR
merges, which is all of them. **One standing ticket per repo** needs a new label and a new
`-label:` exclusion in every worklist query the loop ever adds, the exact hazard `ops-journal`
already makes every author re-check, and the standing ticket itself would sit `awaiting` forever.

So the finding is routed, never dropped: into the PR that owns it, into a ticketless PR when the
fix is small enough to review on its own, and into a ticket otherwise. An ask-first instruction
cannot bind a run with nobody to ask. It still binds an attended session, so the carve-out on
`SahajCloud/AGENTS.md:21` is extended rather than that line deleted. That edit is still owed: the
run that added this entry had its `git push` to SahajCloud refused, so the line needs an attended
run.

## Every claim names the call that produced it

Building the old `📋 Awaiting you` table from a live query, instead of from memory, once fixed a
real gap between what a run narrated and what GitHub actually held. This rule generalizes that fix.

Two runs produced confident, detailed, **wrong** claims that read as measured fact:

- a fabricated clock skew, reasoned from an unexplained time gap
- a claim that `<details>` blocks were stripped on write, reasoned from an MCP readback

Naming the call would have caught both. Neither claim had one, and writing "inferred from" in front
of either would have exposed it as a theory. A journal that mixes measurement and inference, without
marking which is which, is worse than a shorter journal — the reader cannot tell where to apply
skepticism.

## The journal day is a local date

Keying to UTC would split a local day across two issues. The nightly run creates its issue at 1am
Vancouver time, which is 08:00Z, so the UTC date matches only by coincidence. Creation time is
intrinsic and cannot drift from the truth, so there is no date field to set or read.

## details survives the write path

Writes stay intact and render collapsed. REST (`gh api`) shows every tag: 8 pairs in a PR body, 2 in
a journal comment, verified on 2026-08-31. But the MCP *read* path strips `<details>`/`<summary>`
from what it returns, in the same responses where `<table>`, `<a>`, and `<sub>` come back verbatim.

One run concluded "the write path drops them," from this exact evidence, and wrote a long case for
it. The evidence was real. The inference was wrong — the read layer strips them, not the write
layer.

## Sessions linger

`persist_session: false` controls whether the *next* fire reuses a session. It does not control
whether this one dies. Lingering is the platform's behavior, not a fault to work around.

## The run-audit is not a ladder

The nightly run, now `run-audit`, was the survey routine then. The two routines diverged on purpose — the survey was split out so a busy queue could never starve
it. But for a while, both still shared one skill file and one rung numbering. That numbering implied
a ladder no run ever descended. The nightly run executed "rung 6" without climbing rungs 1 through
5. The loop run stepped over 6 on its way to 7. The shared bookends, preflight and journal, carried
rung numbers despite being steps of nothing.

The cost was concrete. Inserting one loop rung forced a renumbering sweep across four files, for a
nightly run that had not changed. And the nightly run's spec silently dropped preflight — identity,
auth, ceilings — because "rung 0" read as the ladder's business, not every run's. So the runs are
now two skills over shared bookends, and **rung means one thing**: a step of the loop run's ladder.

## One review per PR, ever

A bot that re-reviews argues with itself across revisions, and doubles the reviewer's reading. A
second opinion from the same critic is noise, and the human is the approver anyway, so revision
quality gets judged at approval time. Reviewing only once also keeps the rung cheap to make
idempotent. The key is an existing own-login review, read directly from GitHub just before writing —
never search, which is a derived index that lags, and never memory, since a crashed run has none.

## Reviews are COMMENT-only

Two reasons: one mechanical, one about authority. GitHub rejects `APPROVE` and `REQUEST_CHANGES` on
your own pull request, and the loop authors the PRs it reviews. And even where the API would allow
it, a human skimming, or a future rule, could read an approving bot review as merge authority. That
authority belongs to the reviewer's approving review alone.

## A rebutted critic thread is resolved

The ruleset merges only with every review thread resolved. A thread the critic opened and
`address-review` rebutted stayed open "for the reviewer", so the reviewer had to read a debate
between two sessions and resolve the bot's thread by hand before anything could merge. The critic
is advisory, and its point has been answered with evidence. The reviewer loses nothing when it
closes: the summary comment links every rebuttal.

So a rebuttal on a thread the own login rooted resolves it. It stays open only for a question the
reviewer must answer, never for visibility. A human's thread is still theirs to resolve. The
rebuttal must be legitimate: #269's two "on scope" rebuttals were relevant doc fixes that should
have been adopted ([A docs fix is a PR, not a ticket](#a-docs-fix-is-a-pr-not-a-ticket)).

## The author filter's one exception

The filter (why: #respondto-is-an-allowlist) exists so the loop never treats its own words as
instructions. The adversarial review is the one artifact in the system meant to address itself, so
it needs a key the filter can honor without a carve-out swallowing the rule: **comment type plus
thread root**. GitHub already separates review threads from conversation comments, and the loop
starts review threads in exactly one place. So "an unresolved thread rooted by the loop's own login"
identifies the adversarial review, with no marker string to drift, leak, or get forgotten. One
invariant holds this together: exclusivity. The moment any other rung starts a review thread, the
key stops meaning anything — which is why starting one is rung 5's exclusive privilege.

## The review never shares the implementer's context

A critic that inherits the builder's reasoning inherits its blind spots. The assumptions that hid a
bug while writing it hide the same bug while reviewing it, and a session that just argued a design
into existence cannot turn adversarial toward it. A fresh subagent, with an empty context and
nothing but the PR's coordinates, comes closest to independent eyes. This is also why PRs opened
earlier in the same run are eligible for review. Waiting a run was only ever a stand-in for fresh
eyes, and the subagent is the real thing.

## The reviewer profile is the learning surface

The skill loads on every review, so it must stay short, stable, and philosophical. Taste accretes
instead in a separate document, one the Sunday reflection can edit without a ticket. The profile was
seeded from the reviewer's full backfilled review-comment history across the five repos, and shipped
in the PR that introduced this rung. The reviewer correcting their own portrait, in that review, was
its first calibration pass.

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
and runs *before* `permissions.allow`, so an unattended run stalls there, unable from the inside to
perceive it is blocked. That is why the guides are nested `AGENTS.md` files, each with a `CLAUDE.md`
symlink beside it — they load when Claude reads files in that directory, and stay freely editable.

Two corrections to how this rule was long stated here. **`.claude/worktrees` is exempt** from the
guard, so working in a worktree is not what stalls a run, and `--no-worktree` was never the remedy.
And **the guard reaches well beyond `.claude/`** — `.npmrc`, `.gitconfig`, `.pre-commit-config.yaml`
and the rest of the list in `AGENTS.md` stall a run exactly the same way, which is how six
consecutive runs died on a one-line `.npmrc` change.

## Contract surfaces are mandatory

`docs/embedding.md` and `CHANGELOG.md` are the only documents an embedding site ever reads. The
SahajAtlasWeb README once spent months telling hosts to load a filename the build had never emitted.

References to guide paths also hide in `.env`, CSS, test files, and `.distignore`. A docs sweep
limited to markdown leaves links pointing at deleted files.

## Link the branch alias, never a commit alias

A commit alias pins to the SHA it was built from, so every later push silently strips its value. A
reviewer opening it sees old code, with no way to tell. #181 carried links three pushes stale,
including one to a component the review had asked to delete.

Telling a run this rule was not enough, twice. The second break came with a confident rationale:
"these are per-deployment aliases, so they stay pinned to this commit." That reasoning came,
correctly, from a script built for a different consumer, one that must test the exact SHA it was
handed. A run handed one tool for two conflicting requirements satisfies whichever one the tool
argues for. The fix needed a second tool, not a firmer instruction.

The alias is discovered, never constructed. Cloudflare labels it directly — `Branch Preview URL`, in
both the Pages check-run summary and the Workers comment. Guessing the slug is not just fragile: two
branches agreeing on their first 28 characters produce one alias, which answers 200 while serving
the wrong branch. A wrong link that 404s makes a bad Preview section. A wrong link that works makes
a bad review.

`workflow/skills/finalize-pr/SKILL.md` owns the mechanism and the exact commands now. This entry
keeps only the failure that forced them.

## Construct a number, discover a slug

*"Preview URLs are discovered, never constructed"* was written from Cloudflare and applied to
Railway, where it is wrong. The two hosts differ in their **key**, not their platform, and the two
keys fail in opposite directions.

A **pull request number** cannot collide, so constructing one risks nothing — while *discovering*
it costs a read that may not have landed, and the *"preview pending"* a run writes instead is never
revisited, because the run ends at the push ([Push and end](#push-and-end)). A **branch slug** is
truncated, so constructing one risks a link that works and lies
([Link the branch alias, never a commit alias](#link-the-branch-alias-never-a-commit-alias)).

That asymmetry is why one rule could never cover both. `workflow/skills/finalize-pr/SKILL.md` owns
the mechanism and the config key that says which kind of host a repo has.

## Show the shape, not the file list

The body used to open with Summary, then Phases, then an optional `## Changes` file list. A
reviewer had to rebuild the change's shape from the file diffs before judging it: which contract
moved, which call now runs where, which component owns the new state. A file list does not
answer that, and prose summaries answered it badly. The outline answers it directly, as small
`diff` views of the shapes that changed, and the Preview shows it running. So both lead the body.

They are also exempt from every length rule. The template's "keep the visible body short" rule
was written against essays. Applied to the outline, it cuts the one part the body exists for.

The views come from `visual-pr` in humanlayer/skills, ported rather than installed. Installed,
it fails the loop in four ways:

- **A routine loads no plugins.** It reads skill files from a clone. See
  [A skill can name a plugin no routine has](#a-skill-can-name-a-plugin-no-routine-has).
- **It replaces the whole body.** That drops `## Phases` and `Closes #N`, and the dispatcher
  reads both.
- **It writes with `gh`,** which a routine does not have.
- **It opens its own PR when none exists,** a second path beside `finalize-pr`.

The `review-pr` check exists because the reviewer reads the outline first. A view that
disagrees with the diff points the review at the wrong thing.

## The template owns the reflect PR's sections

#148 counted seven rule statements across three files that together told Sunday's `improve-loop` PR what
its body's first sections are. Three sat in `improve-loop`, four in `finalize-pr` and its template. They
disagreed: `improve-loop` put the grading at the top, `finalize-pr` put the outline and Preview there. A
fourth `improve-loop` statement turned up while fixing it, at the one place a run reads first. #147 hit
the collision first and chose, in a preamble. Its critic asked for a ticket rather than a comment,
so one PR a week re-made the judgement. #147 also shipped with no `## Summary`, which no file
allowed deleting.

`improve-loop` needs two headings the template never named, so any fix meant two new slots or one
exception covering both. Two of the three ways out were more expensive than they looked. Naming
`improve-loop` as the template's exception leaves
[Show the shape, not the file list](#show-the-shape-not-the-file-list) arguing against the
exception it now permits. Moving the grading out of the body needs a new `writing.budgets` kind.
#147's grading section measures 3527 characters — 2327 over `comment`, 2027 over `journalEntry`,
and [only bodies are unbudgeted](#budgets-not-adjectives). `AGENTS.md` forbids that config edit
riding the skill edit, so that way costs two PRs across two weeks.

So the template gained both headings as conditional sections, in the terse idiom `## Migration`
already uses. A new `##` costs the dispatcher nothing. The only body heading it reads is
`## Phases` (`dispatcher/markers.mjs`), and that scan breaks at the next heading of any level. Both
new slots sit below `## Preview`, so the outline still leads. The order now lives in the template,
and `improve-loop` makes no judgement about it.

Two things the ordering fix would have left behind, had the template taken only the headings. The
length rule exempted the outline and Preview alone, so the grading section — the loop's own review
content — was still told to keep short or hide in `<details>`, and next Sunday would have weighed
that instead. And the rule the fix relies on, that a skill names its slot and never states the
order, was false of `finalize-pr`, which stated the outline's position in its own step 7. That
line now cites the template instead. Both rules sit in `pr-template.md`, so the next skill wanting
a body section cannot rebuild the collision.

## A routine cannot reach the GitHub API

Not "should not." **Cannot**, by any client. Measured in a routine on 2026-09-02:

| Call | Result |
| --- | --- |
| `command -v gh` · `ls /usr/bin/gh` · `find / -name gh -type f` | absent |
| `gh` downloaded and run from `/tmp` | installs fine, `gh version 2.63.2` |
| `gh api repos/<in-session repo>` | **403** — "GitHub access is not enabled for this session" |
| `curl https://api.github.com/repos/…`, with the token **and** without it | **403**, byte-identical |
| `curl https://api.github.com/graphql` | **403** — "only the pinned set of PR-review operations is served" |
| `curl https://api.github.com/user` | **200** |
| `mcp__github__*` | works, scoped to the session's configured repositories |

The mechanism, so nobody re-tests the same dead ends: `api.github.com` resolves to GitHub's real
address, but connects to `peer=127.0.0.1`, behind a certificate issued by `CN=CCR Upstream Proxy CA
(staging); O=Anthropic`. This is a TLS-intercepting proxy, and it allowlists **by path, regardless
of credential**. A deliberately invalid PAT draws the same 403 as the harness token, under both
`Bearer` and `token` schemes, on REST and on GraphQL. It draws the same 403 with or without an auth
header too — the proxy refuses the *path*, not the credential. **A self-managed PAT buys nothing.**
Connecting the **Claude GitHub App for the org**, what the 403 itself asks for, changed nothing when
tried.

Everything else stays open: `example.com`, `de.sentry.io`, Railway apps, `raw.githubusercontent.com`,
and `codeload.github.com` all answer. The only route by which a script could ever reach GitHub state
directly is a self-hosted relay, holding its own token. **Decided 2026-09-02: we are not building
one.** The gate that could merge untested code already works in a routine — the run fetches with
MCP, and `merge-verdict.mjs` decides. A relay would only move counting and formatting into scripts.
Against that, it costs a service to keep alive and a five-repo PAT, sitting in an environment with
no secret store. A cosmetic win is not worth a standing credential.

**Three different refusals exist, and the other two are the real ceiling.** They matter more than
the first, since they would survive any widening of repo access:

| Path | Message |
| --- | --- |
| `repos/…` | "GitHub access is not enabled for this session. An org admin must connect the Claude GitHub App" |
| `search/issues` | "sessions are bound to their configured repositories. Use repository-scoped endpoints" |
| `graphql` | "only the pinned set of PR-review operations is served" |

**Search is refused by design, not by configuration.** A session is bound to its repositories, and
search is inherently cross-repository. The loop's worklist *is* a search (`assignee:<bot>` over five
repos), and so are the journal counts and the awaiting-you table, so even an open `repos/…` could
not turn those three into scripts. Only per-repo reads and pure decisions can.

Two traps sit in that table. `/user` answering 200 while every `repos/...` path 403s makes the token
look healthy and the repository look missing, when neither is true. And `git` fetch and push work
throughout, since they go through the credential helper, not the API, making a session feel far more
capable than it is.

**The consequence for this plugin: a script never fetches.** It takes data the run already has and
returns a decision. The merge gate's two failures were never in the fetching — they were in deciding
what the fetched values meant, and that half had no single home. `docs/routine-setup.md` claimed the
opposite for weeks, that `gh` "ships in the image," which is exactly the license needed to write
scripts that pass every local test and fail silently where it counts.

## A routine cannot send SMTP

A routine reaches the network only through an HTTPS proxy. SMTP to Mailpit's Railway TCP proxy
times out there, whatever the credentials (SahajCloud#807). So for weeks no loop PR carried an email
preview. #847 and #853 put that down to a missing `SMTP_URL`, and this repo's setup guide told you
to add `SMTP_URL` to the cloud environment — which could never have worked.

The preview scripts post to Mailpit's HTTP send API (`POST /api/v1/send`) instead, which a routine
and a laptop reach alike (SahajCloud#854). The cloud environment carries the ordinary Mailpit login, `MAILPIT_UI_AUTH`. It
reads every captured message, and that is safe only because none of them is real: previews have their
own databases, and production mail goes to Resend. If Mailpit ever captures production mail, the
routine needs a send-only credential (`MP_SEND_API_AUTH`) instead.

`SMTP_URL` still matters, but only where the **app** sends mail: Railway previews and a local
`pnpm dev`.

## Draft is the PR's baton

Tickets carry their state in fields. **Pull requests have no fields at all**, so a PR's state must
come from something GitHub already models. `draft` is exactly right: one bit, indexed (`draft:true`
/ `draft:false`), visible in every list view, and already meaning "the author is still working on
this" to every human who sees it.

The old model kept moving the assignee instead, costing a hand-back on every unit of work, then a
hand-forward from the reviewer to continue it. That made assignment answer two questions at once —
*whose is this* and *is it finished* — ambiguous in exactly the cases that mattered.

Two invariants make the new model work:

- **A PR opens as a draft and is marked ready exactly once.** It never reverts, so `draft:false`
  means "has been ready at least once," letting the adversarial review fire once, and only once.
- **The loop never writes a PR's assignee, at all.** It finds its own PRs by `author:<bot>`, exact
  and needing no field. Writing an assignee would only overwrite something the reviewer already
  uses.

The second invariant was learned the hard way. An early migration assigned the bot to every open PR,
so `assignee:<bot>` would find them. That doubled up with the reviewer's own assignment, and made
the field mean two things at once. Authorship was the answer already sitting there.

Leaving the field alone also gives it a use the old model had no room for: **a human delegates a PR
to the bot by assigning it to one the bot did not write**, and withdraws the delegation by
unassigning it.

## The board is a lens

The org project (`projects.url`) shows every open issue and PR, in a `Status` lane, with
`labels.awaiting` on anything needing a human. **The dispatcher writes `Status` from events, and no
session reads or writes the board.** It was first written when the loop wrote nothing there at all,
and `Status` came from GitHub's built-in workflows. The dispatcher took that write over when it took
over every mechanical write, and the built-in workflows that touch `Status` are switched off so two
writers never race. Two measured facts still hold:

- **Routines cannot reach Projects v2 at all.** Probed live on 2026-09-03: zero
  `mcp__github__projects*` tools resolve in the routine environment. The board could not be
  load-bearing, even if we wanted it to be.
- **The board is derived, so it lags.** If a run read it, `#search-lags-the-review-that-feeds-it`
  would apply in full. The dispatcher reads the labels, the relationships and the PR itself, and
  writes `Status` as a consequence, never as an input.

**A Roadmap ticket gets no `Status` at all.** Its milestone, its sub-issue progress and whether it
is closed already say where a goal stands, so a lane would be a second answer to the same question
(why: docs/why.md#a-roadmap-ticket-has-no-status).

This is also why the journal dropped its `📋 Awaiting you` table. The board answers "what needs me"
continuously and cannot go stale, so restating it every run was a second implementation of one rule
— exactly the failure this repo exists to avoid. The journal instead keeps what the board cannot
show: why a run failed, what a ceiling cost, which rule misfired.

## The rules cost more than the output

Measured, after the loop's comments looked like the problem:

| | |
| --- | --- |
| Skills loaded every run — `preflight` + `work-routine` + `journal` + config | **~148,600 tokens a day** |
| Every bot comment ever written, in total | ~152,000 tokens |

**The rules cost as much each day as every comment the loop has ever written.** The output was never
the largest line. Two facts came from that same measurement, and both reversed an assumption:

- **Bot ticket bodies run shorter than the reviewer's** — 4,854 characters against 5,610. Bodies
  were never the problem, and the grounding rule below depends on them staying rich.
- **One journal thread ran to 134,000 characters.** A single response returned 97,279 of them, and
  broke the run that read it.

So a skill's length is a running cost, not a style question. Every paragraph in a run-loaded skill
gets read eleven times a day, for as long as it exists. Prefer removing a rule to adding one. Keep
the story here, and the imperative in the skill. Never state the same rule in two places.

Simplified Technical English (ASD-STE100) supplies the register. The rules are vendored into
`preflight` rather than installed, since the upstream skill runs 16,260 characters — loading it
eleven times a day would cost more than the brevity it buys. `workflow/lib/ste-lint.py` is vendored
from `github.com/danyuchn/asd-ste100-skill` (MIT).

## Budgets, not adjectives

The rule this replaced read: *"Past roughly fifteen lines outside a `<details>`, it is an essay."*
It failed in both directions at once, and the measurement shows how.

Across 80 bot comments, **51% of all bytes sat inside `<details>`** — beyond the rule's reach, though
the tokens still cost full price on read. The visible half ran to 3,364 characters, about forty
lines, against a rule asking for fifteen.

Two lessons follow, and the second one generalizes:

- **A limit that exempts a container names where to hide.** `budget.mjs` counts the whole artifact,
  `<details>` included.
- **A limit with a discretionary exit is not a limit.** The old rule said "roughly," so every entry
  counted as roughly compliant. The script returns over or under, and nothing else. No clause
  permits an explained overage, since that clause is what killed the old rule.

Ticket and PR bodies stay unbudgeted on purpose. They are state, and the grounding rule reads them
instead of the thread.

## A verdict word, not an exit code

`check()` has always returned `UNBUDGETED` for a kind `writing.budgets` does not name, and the CLI
exited **0** on it. So a typo'd or unnamed `--kind` read as a pass. That silence is how a review
body spent three weeks measured against `comment`'s 1200 (#145): the kind was inert, and nothing
said so.

**Keying the response on the exit code was the second half of the same bug.** `--fit` already
exited 1 on `UNBUDGETED`, and `finish-run` read that as *"cut prose from Friction"* — so a
run that mistyped the kind was told, forever, to cut text that was never over budget. The exit code
cannot carry the difference, because both answers are "not OK".

So two things changed together. Every verdict but `OK` exits 1, and the skills act on the printed
verdict word instead: `OVER` means cut, `UNBUDGETED` means fix the kind and cut nothing. A fix to
only one of the two would have left the loop acting on the wrong signal.

## A review body has its own budget

`writing.budgets` had three kinds, and a submitted review body was none of them. So
`review-pr` measured its body as `comment` — 1200 — while asking that body for a holistic
assessment, ranked findings, and a What-was-checked section carrying enough evidence that a clean
verdict is checkable.

Six reviews show what the wrong limit bought. SahajAtlasWeb#237 landed at 1200/1200 only after
cutting evidence out of What-was-checked. SahajCloud#874 dropped a PR-size note that was not wrong,
only last. SahajAtlasWeb#233 shipped with **no `identity.commentMarker`** — the body measured 1197
and the marker is 124 characters. SahajCloud#861 took nine trim passes to fit three required
sections and five findings.

Trimming prose is what a budget is for. Dropping a finding is not, and neither is dropping the
attribution.

**2000 is measured, not guessed.** The marker is 124 characters, the harness attribution footer 58,
`review.bodyHeader` 24 — 206 before a word of review. Observed prose ran 1318 to 1913, so 2000
clears the 1318–1659 band with room and still binds at the outlier. A budget that never binds is not
one. Raising `comment` to buy that room was refused: it would loosen every ticket and PR comment the
loop writes to fix one artifact.

**The marker belongs on a review body.** `start-run` asks for it on every comment,
`review-pr` on every inline comment, and a submitted body is read more than either. Its 124
characters are inside the number for that reason, so no run has to buy them by cutting a finding.

**What may never be cut is a general rule, so it lives in `start-run`.** Nothing about
SahajAtlasWeb#233 dropping its marker was specific to a review body — `write-ticket` and
`address-review` both require the marker inside the 1200 of `comment`. The budget
paragraph every dispatch reads now says what "over means cut" may not cut, beside "shorten by
leaving things out, never by compressing", which until now named no exception.

**A kind no skill names is inert.** `check()` returns `UNBUDGETED` and the CLI exits 0 on it, which
is how this gap stayed invisible for three weeks. `workflow/lib/budget.test.mjs` now fails for any
`--kind` a skill names that `writing.budgets` does not.

## The marker check belongs in the script

`start-run` says to append `identity.commentMarker` to every comment, and says the budget
may never cut it. Both are prose, and prose is what SahajAtlasWeb#233 was following when it shipped
a review with no attribution at all. `CLAUDE.md` gives a mechanical rule to a script, and whether a
string ends with another string is as mechanical as a rule gets.

`budget.mjs` already held the artefact on stdin and `loadLoopConfig()` on the marker, so it is the
one place that can answer without a second tool.

**The list is a sibling of `writing.budgets`, not a shape change to it.** `budget.mjs` is the only
reader of that key, and both of its lookups require a number. Turning each budget into
`{chars, marker}` would break them, break the fallback's `deepEqual`, and break every `--kind` call
the skills make. `writing.markerRequired` beside the budgets costs none of that. `journalEntry` is
absent from it because `finish-run` posts no marker, which is also why `--fit` never checks.

**It tests presence, not position.** A loop comment carries the harness attribution footer after
the marker — this repo's own issue comments do — so an ends-with test would fail a correct
artefact to catch a failure nobody has made. What #233 shipped was no marker at all.

**And it is unconditional, not behind a flag.** A flag would have to be named in run-loaded prose,
and a run that forgot it would get the silence this rule exists to remove. So `check()` defaults
the marker on, exactly as it defaults the budgets on, and measuring a budget alone takes an
explicit opt-out. A maintainer measuring a draft before appending the marker is measuring
something that is not the artefact: 124 of its characters are missing, so the number was wrong
anyway.

**`markerRequired` lists the kinds that need it, so a new kind must declare itself.** Listing the
one exemption instead would default a new kind to checked, which is the safer polarity and is
worth revisiting. What closes the gap either way is a test: every budgeted kind is either in
`markerRequired` or named in the test's exemption set, so adding a budget kind fails the suite
until someone decides.

## Ground from the body, never the thread

`format-ticket` has always said, *"comments are conversation; the body is state."* Nothing enforced
it, so a run grounding a ticket pulled the whole thread instead — body plus six comments, about
27,000 characters, to learn what 4,854 already held.

Reading the body alone costs a third of that, and changes nothing already written, which makes it
the cheapest saving available. It also has a useful failure mode: **when the body does not carry
what a run needs, the body is the bug.** Fixing it improves every future read. Re-reading the thread
improves nothing.

The journal is the sharp case. One day's thread reached 134,000 characters, and a single
`get_comments` call returned 97,279 of them, exceeding the token limit and breaking the run. The
journal is now one rewritten document per day, and **no run calls `get_comments` on a journal
issue.**

## Lint measures style, not content

`ste-lint.py` counts passive voice, semicolons, and long sentences. `rule-delta.mjs` extracts every
bold-or-heading imperative and diffs the set. They measure different things, and only the second
answers the question that matters when a skill gets rewritten: **is every rule still there?**

The case that produced both tools: the `journal` rewrite took violations from 16 to 4, cut a third
of the bytes, and dropped **Never read the board back** — half of `#the-board-is-a-lens`. Lint
scored it a clear improvement. The rule delta named the loss in one line.

This matters more here than elsewhere, because nobody can validate a skill by running it. An edit
takes effect next session, merging is the deploy, and a dropped rule surfaces weeks later as a run
behaving oddly with nothing to blame.

Two details matter, not just tidiness. Whitespace must collapse before matching. Markdown wraps a
directive across lines, and a line-oriented match misses it — skipping this once reported `Never
force-push someone else's branch` as deleted, when it had never moved. Rewordings must also get
filtered out. A raw diff of #48 reported 14 disappearances, 11 of them `Do not X` becoming `Never
X`. A reviewer handed 14 items skims them, and skimming is how a real removal slips through — three
survived the filter, one of those genuine.

This is a tripwire, not a proof. It sees only bold imperatives and headings, so a rule written as
plain prose stays invisible to it, and `Never X` weakened to `Avoid X` fuzzy-matches and passes
clean.

## hasWorkflows is a filesystem check

`mcp__github__list_workflows` is not in the routine's MCP build. Four runs in a row journaled its
absence under `⚠️ Failed`, each time for a fact sitting on disk the whole time: every repo in
`repos` gets cloned into the run before Claude starts, so `.github/workflows/*.yml` answers
`hasWorkflows` exactly, for free, and cannot 403.

This is one case of a general rule: **when the run already holds the checkout, read the checkout.**
An API call for a fact already on disk buys nothing, and adds one more way to fail. The failure was
harmless here: an absent `hasWorkflows` reads as *this repo has CI*, so the gate stayed closed
rather than opening. But a recurring `⚠️ Failed` line still trains a reader to skim the section that
exists to be read.

## A search with no is: qualifier cannot see a PR

For three runs in a row on 2026-09-04, the census reported **`label:awaiting` returns zero, while
PRs demonstrably carry the label**, and journaled it as a failure of the label or the index. It was
neither. `mcp__github__search_issues` says so in its own description — *"Already scoped to
is:issue"* — and the census query at the time read `$SCOPE is:open label:awaiting`, with no `is:`
qualifier at all. Every item carrying `awaiting` that day was a pull request, so the query could not
have returned one.

Measured, not reasoned, in the 19:03Z run, against the same live data the failing runs saw:

| Query | Returned |
| --- | --- |
| `$SCOPE is:open label:awaiting` | 0 |
| `$SCOPE is:pr is:open label:awaiting` | 3 — SahajCloud #692, #691, #686 |
| `repo:sydevs/SahajCloud is:issue is:open label:awaiting` | 0 |
| `repo:sydevs/SahajCloud is:open author:sydevs-bot` (control) | 8, **all issues**, no PRs |

The control settles it. The same omission hides PRs from *any* query, not just a label one.

This is the expensive kind of wrong. An empty result always fails the same way, indistinguishable
from "nothing qualifies," so the census's one view of what needed a human read blank while three PRs
sat waiting on the reviewer. And since two runs blamed the *system* rather than the query, they spent
their `⚠️ Failed` section's most valuable line on a fact that was never true — the same
training-to-skim cost described under `#hasworkflows-is-a-filesystem-check`.

The rule that generalizes: **a qualifier a query omits is not a qualifier the tool leaves open.**
Where a label, an author, or a mention can land on either issues or PRs, seeing both needs two
queries.

The fix forced two decisions worth recording, so nobody reopens them by accident. **The PR census
now sees `awaiting` on PRs for the first time**, and the survey routine's drift sweep reads it — so a
run that starts stripping `awaiting` off PRs it never touched before is doing it because of this
change, worth knowing without a bisect. And **`search_issues`, with a hand-written `is:pr`, stays
the one tool**, rather than switching to the sibling `search_pull_requests`: one tool with one
syntax is easier to check than two tools with two defaults.

## Search lags the review that feeds it

SahajCloud#679 was approved at 04:45:57Z. At 05:12Z, twenty-six minutes later, rung 1's `is:pr
is:open author:<bot> draft:false review:approved` returned **zero results**. The approval was real
and current: `pull_request_read method:get_reviews` showed `Ardnived` / `APPROVED` against
`51fdbeb`, the head commit. The PR merged that run only because rung 2 read `get_reviews` on it for
an unrelated reason, and the run noticed.

**An empty search result is indistinguishable from "nothing qualifies."** That makes this worse
than a slow index — the failure stays silent, and the loop would have journaled "nothing qualified
for merge" as measured fact, while approved, green work sat for a whole cycle.

Rung 5 already knew this: *"Search is a derived index and can lag. This read is authoritative."* It
re-checks `get_reviews` immediately before writing. Rung 1 had no equivalent, since `review:approved`
looked like a free filter. It is free. It is just not true yet.

The rule that generalizes: **a search qualifier is safe only for facts the loop itself wrote.**
`draft:` is ours, so the index cannot lag behind us on it. `review:`, `-reviewed-by:`, and
`commenter:` describe other people's writes, and those need an authoritative read before anything
irreversible depends on them.

## Only the reviewer's approval counts

The first draft of rung 1's derivation, written once it became clear no MCP call returns
`reviewDecision`, counted the latest state-bearing review from every login **except our own**. An
adversarial pass on the PR carrying it caught the consequence before it merged: `claude-workflow`,
`SahajCloud`, `SahajAtlasWeb`, and `WeMeditateWeb` are all public, so any GitHub account can submit a
review on an open PR in them. One drive-by `APPROVED` from a stranger would have satisfied
`merge-verdict.mjs`, in four repos where a merge is the deploy.

Two things make this worth a heading, not just a silent fix. **It was wider than the thing it
replaced.** GitHub's own `reviewDecision` is computed against branch protection and requested
reviewers, not "anyone who clicked approve." A stand-in admitting every login is not really a
stand-in. A derivation replacing a field must stay *narrower* than it, or it is a new policy
wearing the old one's name. And **until that PR, the gate had never fired**: `reviewDecision` was
always absent, so rung 1 held everything, and the permissiveness stayed invisible until a stranger
actually appeared. The rule that generalizes is the one `preflight` already states about blocklists:
*a one-name blocklist of ourselves fails open on everyone we have not met.* `assignment.reviewer`
already defines approval authority — the allowlist just enforces it where an approval gets read, in
`reviewDecisionFrom`.

## A review list arrives one page at a time

`SahajCloud#714` collected **60 reviews**, and the loop declined to merge it three runs running,
each time telling the reviewer their last review was `CHANGES_REQUESTED`. They had approved it
twice by then, and said so.

Neither reader had asked for a second page. `pull_request_read method:get_reviews` returns 30
without `perPage`, and `github.rest.pulls.listReviews` returns 30 without `per_page`, so both saw
the same first 30 of 60. Inline review replies are what filled them: **one reply is one
`COMMENTED` review**, and a long revision round posted about 45. The reviewer's last state-bearing
review inside that window was a `CHANGES_REQUESTED` from the day before, on a commit four merges
old. Their two approvals sat at positions 57 and 59, unread.

The failure had a second face that looked like a separate bug. The state machine's `synchronize`
handler re-adds `awaiting` when the reviewer's latest review is `CHANGES_REQUESTED`, and it read
the same stale page — so every merge of `main` into the branch re-flagged a PR that was approved.
The label looked like the cause of the hold and was only its twin.

**An unpaginated read is fine for a set you filter and wrong for a set whose last element is the
answer.** Truncation drops the newest rows, which is exactly where a decision lives, and it is
unrecoverable in both directions: a stale `CHANGES_REQUESTED` holds an approved PR forever, and a
stale `APPROVED` would merge work the reviewer has since rejected. So `reviewsLookTruncated` makes
the gate refuse a list that ends on a page boundary rather than derive from it — the one case
where "I cannot tell" is the correct verdict, and a confident wrong reason cost three runs and a
reviewer's afternoon.

## A conflicted PR schedules zero CI runs

A conflicted PR has no computable merge commit, so GitHub schedules **zero** workflow runs for it,
silently. The checks list shows only non-Actions entries (a Railway or Cloudflare deploy still
happens, since those build the branch head), and the run list stays simply empty. It reads like a
stuck scheduler. Waiting is futile.

A run that predates the base moving is stale, and it makes a conflicted PR look tested when it is
not.

## Staleness is not yours, conflicts are

Three conflict essays landed on SahajCloud#769 inside twenty-five minutes. Each session merged
`main` in to keep the branch fresh, met the same hunks, and wrote the same comment. The branch was
never conflicting, so nothing had asked any of them to touch the base ref.

**The base ref belongs to a trigger, not to a session's judgement.** `dispatcher/decide.mjs` fires
`resolve-conflicts` only on a non-draft PR GitHub reports `CONFLICTING`, and that is the one state
in which merging a base is anyone's job. `address-review` also reaches a behind-but-mergeable PR,
and it was merging anyway — a handler acting outside its trigger. Three of them could do it at once
precisely because none of them owned the decision.

That reason needs no per-repo knowledge, which is why it replaced the first one written down. The
queue was that first reason, and it is narrower than it looks: `claude-workflow` has no queue and no
CI at all (`ci.noCi`). *"Being behind costs nothing"* was also too strong, since a preview builds the
branch head ([A conflicted PR schedules zero CI runs](#a-conflicted-pr-schedules-zero-ci-runs)).

So a reviewer can want the base merged in and be right, and they can merge it themselves. **Whether
a request through the `@sydevs-bot` channel authorises a session to do it is undecided** — both
skills forbid it today, and sydevs/claude-workflow#160 left the question open. Read this entry as
why the default is no, never as a reason to make an exception.

One cost this rule used to claim is retired. Merging `main` in once re-flagged an approved PR,
because the `synchronize` handler re-added `awaiting` from a stale review page
([A review list arrives one page at a time](#a-review-list-arrives-one-page-at-a-time)). That
handler makes a bot push a `note` now. Do not write the old cost down again.

## A test fixture defines the world the test lives in

A run's unit fixture declared `Managers.roles` at the top level, "because that was easier to write
than the real config." In the real collection, `roles` sits inside a `tabs` field. The fix under
test was therefore **completely inert on the branch, while lint, typecheck, and 1,527 unit tests
all passed.** Only two integration assertions caught it.

More tests cannot fix this failure mode. Every other kind of bug is, in principle, catchable by
another assertion. A wrong fixture is not, because it defines the world every assertion in that file
gets evaluated against. A one-line pre-mortem is cheap precisely because it happens before the
fixture exists, while the assumption is still conscious.

## A script here never fetches

Every script under `workflow/` takes JSON on stdin and returns a decision. None opens a connection
to GitHub. That is a rule, not a convenience.

The alternative was tried, and abandoned within a day. Four scripts shipped calling `gh`. All four
passed every local test, and none could run in a routine, where the loop does nearly all its work.
Keeping them would have meant two implementations of every rule they encoded — a local one,
exercised while developing, and a prose one in the skill, executing eight times a day. That is the
exact shape of the defect that made the merge gate unsafe: `get_status` versus check runs was never
a fetching bug. It was two readings of "green," with no single home.

So the boundary holds: **the run gathers, the script decides.** This costs the token savings a
scripted census would have given, and it buys the only thing that was ever load-bearing — one
implementation, exercised identically everywhere. A script earns its place when its input is small
enough to transfer, and its logic is subtle enough to get wrong in prose. `merge-gate` and
`branch-preview-url` clear both bars. A census, a count, and a markdown table clear neither.

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
required byte-for-byte matches. They did not match. By the time this plugin was written, the
copies had drifted 90 to 250 lines apart, and steps had different names in each repo. Even the
audit meant to catch the drift compared against a directory that no longer existed.

The cause was not discipline: prose copied several times cannot stay in sync. So there is one copy
of each skill, here, and what genuinely differs between repos lives as data, in one
`.claude/workflow.json` per repo.

## An installed plugin does not track main

`AGENTS.md` said, for the plugin's whole life, that "no version bump matters," because `main` is
consumed live. That is true of the two cloud routines, which fetch the skills fresh on every run. It
was never true of `/plugin install workflow@sydevs`, and nothing in the repo said so.

The install records a `gitCommitSha` in `~/.claude/plugins/installed_plugins.json`, and unpacks the
skills into `~/.claude/plugins/cache/sydevs/workflow/<version>/`. Neither gets revisited on its own.
The commit is a pin, and the cache directory is named after `version`. So while `version` still read
`0.1.0`, every session on that machine loaded the commit that was `main` on install day, forever,
with no signal anywhere that it had fallen behind.

On 2026-09-04, a maintainer's session filed a ticket with no Type, Priority, Effort, or Stage. The
reflection found the cause was not judgment. The loaded `file-ticket` was commit `864e72e`, the
repo's **first** commit, pinned at install on 2026-08-27. It ran 53 commits behind a `main` that
had since grown `format-ticket`, the native issue fields, and `Stage` itself, so the skill it ran
genuinely ended at "create the issue, return the URL." Twelve of the seventeen skills did not exist
in that cache at all, and the marketplace clone itself sat nine commits behind.

`version` was the only thing that could have invalidated it, and the guide had told every
contributor, explicitly, that `version` did not matter. That is why bumping the manifest is now a
required part of any skill change, not a release ceremony. This repo has no releases. It does have a
cache key, and a cache key that never changes is a cache that never updates.

## A missed version declaration passes CI

`cut-release` named three places SahajAtlasWordpress declares its version: the plugin header,
`readme.txt`'s `Stable tag`, and `package.json`. Two were right. `package.json` there is dev
tooling, declares no version at all, and `.distignore` keeps it out of the zip. The list omitted
`SAHAJ_ATLAS_VERSION` in `sahaj-atlas.php` and `version` in `blocks/embed/block.json`.

`SAHAJ_ATLAS_VERSION` is the `$ver` argument on every asset the plugin enqueues. Left behind, a
site that takes the update runs the new PHP against the previous release's cached
`atlas-page.css` and `atlas-page.js`.

Nothing downstream would have caught it. `release.yml` compares the tag against the plugin header
and nothing else, so the build stays green and the zip attaches. The v0.2.0 run found it only by
grepping for the old version before it committed.

A list of declarations is a copy of the repo's shape, and a copy goes stale. Grep for the version
being replaced instead.

Since sydevs/SahajAtlasWordpress#33, that repo's CI checks the four known declarations on every PR.
The grep stays, for a fifth.

## Merging a version bump is the release

`cut-release` ended with the run pushing a `v*` tag once the bump PR merged. That step never
worked. On 2026-09-25 the push to SahajAtlasWordpress got `HTTP 403`: a cloud session pushes
`claude/*` refs only, and no MCP tool creates a tag or a Release. The step was unreachable a second
way too. The run that writes the bump ends before the PR merges (`#push-and-end`), and no handler
runs after a merge. So the v0.2.0 bump merged on 2026-09-18 and sat untagged for a week while 13
sites stayed on 0.1.0 (sydevs/SahajAtlasWordpress#31, sydevs/claude-workflow#126).

A write the loop cannot make is normally handed to a person
(`#a-write-we-cannot-make-is-handed-over-not-thrown`). This one GitHub Actions can make, and a
person-owned step on every release is exactly the step that had just gone undone for a week. So
that repo's `release.yml` now runs on every push to `main`. When the plugin header names a version
with no released zip, it tags the commit that set the version, builds the zip, and publishes. The
human decision sits where a human already acts: the required approval on the bump PR.

It must stay one job. A tag pushed with `GITHUB_TOKEN` starts no other workflow, so a job that
only tagged, feeding the old tag-triggered build, would have published nothing and shown no error.

The first run found a third wall. `GITHUB_TOKEN` may push a tag only at a commit whose
`.github/workflows/` matches some branch tip, and v0.2.0's bump commit predated the workflow edits
that shipped release-on-merge, so GitHub refused the tag as a workflow edit
(sydevs/SahajAtlasWordpress#34). The job now tags the bump commit when it can, and `main`'s tip when
that ships byte-identical plugin files. Otherwise it fails, naming the one command a maintainer
runs to push the tag by hand.

A failed publish now shows red on `main`. Friday's publish check turns it into a ticket.

## Fit the journal, do not negotiate with it

`budget.mjs` answered one question — over or under — and returned nothing about where to cut or by
how much. So a run that went over regenerated the whole body, re-checked, and repeated.

On 2026-09-07 the 17:03 run did that thirteen times between 17:38:45 and 17:49:38, shedding 1,557
characters in steps of 3 to 800. It converged at 3,999 of 4,000 at 17:41:46, then wrote a fresher
`Last:` timestamp into the same body and spent four more re-checks getting back under. The 15:04
run, twelve minutes long in total, spent 1 minute 43 on five rewrites of the same kind.

Every one of those rewrites applied a rule that was already written down and already fixed: drop
the oldest `📄 Did` lines first, never cut a failure. A fixed rule evaluated by a model, once per
run, eleven times a day, is eleven chances to evaluate it differently — the same reason
`merge-gate.mjs` exists. So the script cuts, and the run writes.

A reserve of 200 characters below the budget came out of the second half of that run. A body
fitted to the last character breaks again on the next edit, and that edit was a `Last:` timestamp
the journal step rewrote every time.

Since #71 the entry is a per-session comment, written once, so nothing re-edits it — and against
a write-once comment the headroom only over-cut. It ate the whole `📄 Did` section of a
1,355-character entry against a 1,500 budget and reported "532 to spare", and it took a second
line off a 1,599-character one that the first cut had already brought to 1,433. `--fit` now cuts
to the budget and stops there.

## Actions observes, classifies, locks, and fires

The polling loop paid the same census on every fire whether anything had happened or not. On
2026-09-07 it fired eleven times. Four consecutive runs, 12:05 to 15:04, started nothing at rung
3 because three PRs still awaited one Approve click, and each paid for the census and a journal
rewrite to learn that. A run that shipped a PR then sat twelve minutes watching CI, and its
47-minute length left thirteen minutes before the next fire.

Every rung waited on a GitHub event: a review, a comment, an approval, a check completing. The
clock was a proxy for those events. GitHub Actions already ran on every one of them — the state
machine — so the dispatcher is that workflow grown up. It classifies the event with no tokens,
applies the lock, and fires one routine per handler with a pointer. Routine GitHub triggers could
not do this alone: they see `pull_request`, `issues` and `release` events only, never a comment,
a review or a check, and they carry no author filter.

## GitHub owns the merge

The dispatcher used to merge. It derived its own verdict — one approval, every review thread
resolved, CI green — and three of that derivation's failures have headings of their own. A
drive-by `APPROVED` from any stranger would have satisfied it, in four public repos where a merge
is the deploy ([Only the reviewer's approval counts](#only-the-reviewers-approval-counts)). It read
30 of 60 reviews and declined an approved PR three runs running
([A review list arrives one page at a time](#a-review-list-arrives-one-page-at-a-time)). And its
reading of *"green"* lived in two places at once
([A script here never fetches](#a-script-here-never-fetches)).

None of those was a bug in merging. Each was a bug in **re-deriving a verdict GitHub already
computes**, and the repository ruleset computes it from the same three conditions with no second
implementation to drift. So `mergeVerdict` is gone from `gather`, and the ruleset decides: one
approval, resolved threads, green CI, then — in the four repos that have one — the merge queue
rebases and tests before it lands.

What is left in code is one write. The dispatcher **arms** auto-merge at mark-ready, which is the
first moment GitHub permits it — auto-merge is refused on a draft, and every bot PR opens as one.
A refused arming is handed over rather than thrown
([A write we cannot make is handed over, not thrown](#a-write-we-cannot-make-is-handed-over-not-thrown)),
because a PR needing one click is a better outcome than a plan that stopped.

One condition could not become a rule. `mergePolicy.loopMayNotMerge` names the repos that are never
armed, because merging `claude-workflow` is the deploy and a ruleset cannot express *"a person
decides this one."* A rule the machinery cannot hold is held by the absence of the write.

## The lock label is the lease

Two sessions on one item write over each other, and neither can tell. The label a dispatcher
applies before it fires, and the session removes as its last write, is what says which. While the label is on, the dispatcher fires nothing else at
that item and records any new event as a recheck. When the label comes off, that event is the
handoff: the dispatcher re-derives from live state and dispatches whatever is pending.

One label, `bot:working`, serves issues and PRs alike. A field cannot: a PR has none. The handler
name, the attempt and the session link live in a status comment the dispatcher edits. The session
reads the label before its first write and before every push. Gone means stop. The sweeper
removes a label whose session passed its deadline, so a dead session holds nothing forever.

The label is the lease a session **reads**. It is not what decides a contest between two
dispatcher passes — see *The lease is a ref, not a label* below.

## Push and end

`finalize-pr` step 8 polled CI up to twenty times. On 2026-09-07 the 17:03 run pushed at 17:36
and CI went green at 17:45. In between it started five overlapping waiters, called
`get_check_runs` eight times, and had one foreground `sleep` refused by the hook. Twelve minutes
of an Opus session asking the same question.

CI completion is an event. Actions receives it, settles the head SHA with `merge-gate.mjs`, and
dispatches `fix-ci` on red, the critic or mark-ready on a green draft, the merge gate on a green
approved PR. So a session pushes and ends. Nothing it could learn by waiting is lost, and no
session ever holds a lock while doing nothing.

## The bot-actor exception

The dispatcher ignores the bot's own comments and reviews, or every reply it posts would fire a
run that finds nothing to do. One bot event is load-bearing: the adversarial review. It is a
`COMMENT` review by the bot, on the bot's own PR, whose body starts with `review.bodyHeader`.
Its threads are the critic's findings, and `address-review` adopts or rebuts them. The dispatcher
keys on all three — the header, the author, the PR's author — so an on-demand review of a human's
PR never dispatches the bot to answer itself.

The other bot events that matter are pushes. They cause CI, and CI is wanted.

## The payload is a pointer

The `/fire` endpoint wraps whatever the caller sent in a block the session is told not to obey.
The caller is our own workflow, but the bearer token that authorises it could leak, and a leaked
token could fire any text. So the dispatch record carries pointers only: repo, number, handler,
lock, deadline, journal. `payload.mjs` validates the shape and refuses anything else. The
session re-reads every fact from GitHub. An instruction inside the record is data.

## One routine per repo, one prompt

The two polling routines carried a prompt that restated nothing, because restated rules went
stale twice. The first event-driven design had thirteen routines, one per handler, and thirteen
prompts. Nothing that differed between them needed a routine: the handler is a field in the
dispatch record, and `handlers.<handler>.skill` in `loop-config.json` names the skill. What a
routine does fix is which repositories it clones, and every handler works on one item in one
repo. So there is one routine per repo, cloning that repo and its producer, and one prompt for
all of them, kept verbatim in `docs/routine-setup.md` so a change to it is a diff. It restates
two rules — the lock is the lease, push and end — because they must hold even when the
`claude-workflow` clone fails and no skill loads at all.

The cost is one model and one tool grant per repo rather than per handler. A short `write-ticket`
answer runs on the same Opus as `implement`, five to eight turns. The rule that it never pushes is
a skill rule now, not a routine grant; the lock label and the dispatcher's actor filter were always the
controls that mattered.

## awaiting has one writer

The `awaiting` label drifted because two writers set it: the state machine on events, and the
loop on its own dead ends. A nightly sweep recomputed the whole backlog to catch the
disagreements. Now the dispatcher is the only writer. It sets the label when the bot's turn ends
and clears it when a human acts. A session never touches it. The sweeper still re-derives, and
journals any correction it makes, because a correction is evidence of a missed event.

`stuck` is the other label with one writer. It means the machinery owes a retry — a usage limit,
a paused routine, a session that died — and no human is needed yet. The sweeper retries up to
`dispatch.maxAttempts`, then hands over to `awaiting`. The two never coexist.

## blocked and awaiting are exclusive

sydevs/SahajCloud#780 got `awaiting` at 08:23:07 and `blocked` at 08:23:09, two seconds apart, from
one `issues.opened` plan. The plan added `awaiting` unconditionally, then the blocked branch added
`blocked` and never removed the first.

Both labels answer one question — whose turn is it — and they answer it differently. A parked ticket
waits on its blocker, not on you. An item carrying both makes the worklist unreadable in the
direction that matters, because `awaiting` is the label a human scans and `blocked` is the reason
they should not have seen it.

So `issues.opened` decides `bornBlocked` before it writes anything, and the blocked write removes
`awaiting` in the same plan rather than in a later pass. The same exclusivity holds for `stuck`,
which [awaiting has one writer](#awaiting-has-one-writer) records.

## A closed item is nobody's turn

sydevs/SahajCloud#747 merged while a session still held the lock. The session unlocked two minutes
later, the unlock path re-derived the PR, got back nothing but a Status write, called the item idle,
and gave a merged PR `awaiting`.

The idle test is the right test and it inverts on a closed PR. It asks whether the plan contains a
fire, an arming or a mark-ready, and on a merged or closed PR the answer is no **by definition** —
there is nothing left to do because it is finished, not because a human is owed something. An idle
test can only distinguish "waiting on you" from "working" if the item is still open.

So the unlock path checks the PR's state before it reads the plan, and a closed PR clears `awaiting`
and `stuck` instead of gaining them. A merge is the one outcome that needs nobody told.

## The critic skips small PRs

An adversarial review costs an Opus session, a CI cycle, and a round of the reviewer's attention
on the rebuttals. A two-file, twenty-line PR rarely has the shape problem the critic exists to
find. Below `review.skipWhen` the dispatcher marks the PR ready at once and notes the skip on it.
`@sydevs-bot review` forces a review at any size.

## There is no WIP cap

The polling loop capped open bot PRs per repo at `wipCapPerRepo` because it chose its own work:
without a cap, one nightly pass could have started every approved ticket at once. Under event
dispatch nothing starts without a human verb, so the person who types `@sydevs-bot implement`
is the throttle — they can see the open PRs, and each verb is a decision to spend a session. A
queue behind a cap would only delay a decision already taken and add a state, approved but
waiting, to explain. So an `implement` verb fires at once, and `Approved` is the Status of a
ticket whose implementation was authorised, not a queue. A drag to `Approved` on the board is
still not a verb; the dispatcher requires the comment.

What replaces the cap is visibility. Each day's journal issue carries a tally the sweeper keeps
current — dispatches per handler and per repo, and the items that took the most sessions — and
the weekly reflect reads seven of those and reports usage back: a PR that needed six sessions,
a review that arrived one comment at a time and fired `address-review` for each. That is
feedback to the people who type the verbs, never a limit on them.

## A resolved thread fires no workflow

`pull_request_review_thread` is a webhook event. It is not a GitHub Actions trigger, and naming
it under `on:` makes GitHub reject the whole workflow file — every event in that repository stops
being handled, with the only sign a failed run named after the file path. It shipped that way
once, in the caller merged on 2026-09-08, and `gh workflow run` was what finally printed the
reason: `Unexpected value 'pull_request_review_thread'`.

The event mattered: a reviewer who resolves the last open thread on an approved PR changes the
merge verdict, and nothing else about the PR changes. So the sweeper re-derives every open,
unlocked, non-draft bot PR on each 30-minute pass. That is a handful of items per repo, each
already cheap, and it also covers a CI event GitHub dropped. The cost is latency: a merge that
an event would have made instant takes up to half an hour.

## The board is a lens, so it may fail alone

The first live dispatch stopped on `TypeError: Cannot read properties of null (reading 'status')`.
The plan was right — `label, react, status:revising, fire:answer` — and the labels were already
written. Setting Status then threw, the job failed, and **the fire never happened**. One
unreachable board had swallowed the whole run.

`projectV2(number: 2)` returns `null`, with no GraphQL error, when the token cannot see the
organization's project. That is a permission answer dressed as data, and the code read `.status`
off it. It now says so by name: `BoardUnreachable`, carrying the fix in its message.

A day later the same anchor caught a second failure, and this time the message lied. `itemOf`
declared `$n` and never used it, so GraphQL rejected the query — and `BoardUnreachable` reported
it as a missing permission, because that is what the first failure had been. The message now
says what went wrong first and guesses at a cause only when the error reads like one. A test
walks every query in the file and fails on a variable it declares but never uses.

The deeper rule is the one this violated. The board is a lens over state the labels and the
status comment already carry, so **a board write that fails must never stop the dispatch**. Every
Projects call now degrades: the plan continues, the run fires, and one `board-unreachable`
anomaly goes in the day's journal. A board that is merely stale is a cosmetic problem someone
notices. A dispatch that never fired is work that silently does not happen.

## The journal pointer is an optimisation

The second live dispatch got past the board and died on `POST /repos/.../issues` — 403,
`Resource not accessible by personal access token`. The dispatcher was creating the day's
journal issue so it could name it in the record, and the fire happened after that. One missing
token permission had again stopped the work.

The record's `journal.issue` saves the handler one search. It is not what makes a run possible.
So `ensureJournalDay` never throws: it returns `0` when it cannot list or create, the record
carries the `0`, `payload.mjs` accepts it, and `finish-run` finds or creates today's issue
itself — the same path the nightly survey already takes, with no record at all.

The pattern is the same as the board's, and worth stating once for anything the dispatcher
writes: **the fire is the work, and everything else is bookkeeping around it.** Bookkeeping that
fails should be visible and should not be fatal. A run that never started leaves nothing to
notice.

## One journal a day, and the oldest one wins

The first day of event dispatch produced two journal issues. The nightly survey wrote #77 at
08:16 in its own format, with no `<!-- ops-journal:YYYY-MM-DD -->` marker. Hours later a
dispatch wrote #78 for the same day. The session journalled to one and the dispatcher's
anomalies went to the other, so the day's record was split down the middle and the title on
each counted only its own half.

Two things caused it, and both are now closed. A journal issue that lacks the day marker is
matched by its creation date, which is correct but fragile — so an issue adopted that way is
**stamped with the marker**, and every later lookup is exact. And two `act` jobs can look at the
same instant, find nothing, and both create; so after creating, the dispatcher looks again and
**closes its own issue if an older one appeared.** The oldest issue for the day always wins,
which is a rule two racing jobs can agree on without talking.

The scheduled journal job sweeps up whatever still slips through, every half hour, keeping the
oldest. It runs on the schedule and never on an event, so it is never racing itself. A split
journal is not a lost run — but `improve-loop` counts a week from these titles, and a day counted
twice at half strength is worse than a day counted once.

## The marker reader matches words, not punctuation

`relationships.bodyMarkerFormat` is what the loop writes: `Blocked by: <url>`, exact, because a
machine writing to a machine has no reason to vary. The reader used to demand the same thing —
the line had to *start* with `Blocked by:` and name a full issue URL.

People do not write that. Four live tickets on 2026-09-09 said
`**Blocked by sydevs/SahajCloud#695.**` — bold, no colon, shorthand instead of a URL — and the
reader saw no blocker in any of them. Three separate runs on 2026-09-08 journaled *"`Blocked by:`
ships in three shapes"* under friction, and none acted on it.

The asymmetry decides the direction. A false positive makes a run skip a ticket and say why. A
false negative makes it write code against a contract that does not exist. So the reader is
generous: it strips leading emphasis and list bullets, matches the words with or without the
colon, and takes a URL or `owner/repo#N`. It stays closed where being open would be wrong — a
bare `#N` names no repository, a PR is not an issue, another org is not ours, and a
struck-through line is a cleared blocker.

## blocked follows the relationship

The four tickets above had **correct native relationships all along**. Someone had linked them in
the GitHub UI. What they lacked was the `blocked` label, because the dispatcher only wrote it
when it converted a marker, and no event had touched those tickets since.

That was nearly harmless and quietly not. The implement gate reads `blockedByOpen`, from the
relationship, so it refused them correctly. But `unblock-check` began with *"no label, nothing to
do"*, and the sweeper only ever looked at labelled items — so when the blocker finally closed,
the dependent would have been passed over in silence. The thing that tells you a ticket is ready
depended on a label nothing had applied.

So the label follows the relationship, in both directions, in one place. `unblock-check` applies
`blocked` when GitHub says the issue is blocked and we have not said so. When the last blocker
closes it fires a recheck, and the label comes off once that session finds the ticket free
(why: docs/why.md#recheck-before-awaiting).

Finding the candidates took two tries. `is:blocked` in issue search looked exactly right and is
not: **it matches the `blocked` label, not the relationship.** The first live sweep returned the
two tickets that already carried the label and none of the four that needed it — a search that
could only ever find what it was not looking for. The relationship is reachable through GraphQL
alone, as `blockedBy` on `Issue`, so the sweeper asks for every open issue with its labels and
its blockers in one paginated query per repo. That query also turned up a fifth ticket nobody had
named.

## A date belongs in a date field

A park used to be `Re-check: 2026-10-01` in `## Notes`, parsed with a regular expression. That
shape was inherited from `Blocked by:`, which has to be prose because no tool a session can reach
writes a native relationship. A date never had that constraint. `Hold Until` is an org issue
field, a session writes it with `issue_write`, and the dispatcher reads it straight off the issue.

So the field is the park. It cannot be malformed, it sorts and filters on the board, and clearing
it is one call that leaves Priority alone. The `Re-check:` line is still read, so a
ticket written before 2026-09-09 still parks, and it stays read until nothing carries it.

`issueFields.holdUntil` is therefore load-bearing again, after the cutover had it slated for
deletion beside `Stage`. The field survives; only `Stage` goes.

## A park stops the dispatch, not the session

The implement gate tested two things: the `blocked` label, and an open native blocker. Both are
about a blocker. Neither is about a date, so a ticket parked until October with no label — which
is every ticket parked before the label existed — would have been dispatched, and a session would
have started, cloned five repositories, read the ticket and stopped itself.

The refusal belongs in the dispatcher because that is where it is free. A session that stops on
arrival still cost a fire, a clone and a lease. So the gate now reads the park as well, and says
which of the three reasons applies rather than guessing at one.

The verb is not thrown away, though. A refused `implement` is recorded as an approval that waits,
and it starts once a recheck confirms the block has lifted
(why: docs/why.md#children-are-approved-together).

## The lease covers the branch, not the item

`bot:working` sits on the issue an implement session was given. The pull request it opens carries
no lock, and that is right — no session holds the PR. But the session still owns the **branch**,
and for a few minutes after `finalize-pr` pushes, it is still running.

Every PR event funnels into one derivation that asks whether the PR itself is locked. It never
asked whether the session that made it had finished. In a repo with CI that window is hidden: CI
takes minutes, and the PR is not green until long after the session ends. In `claude-workflow`
there is no CI, so `ci.noCi` calls a draft green the instant it opens — and the critic would fire
against a branch implement was still pushing to.

So a PR is held while any issue it closes carries the lock. The cost is one issue read per PR
event on a bot PR, and it buys the guarantee the lock was always supposed to give: one session per
piece of work, not one session per item.

## A PR is the answer to an implement verb

A dispatcher comment is never the bot's last word — that rule exists so a refusal cannot silence a
human's verb. It has a consequence nobody had followed through: an implement session answers with
a **pull request**, not a comment on the issue, so when it unlocks, the verb that started it still
reads as pending.

Every implement therefore ended by re-dispatching itself. The second pass hit the in-flight guard
and refused, which is correct and useless: an act job, a comment, and `awaiting` on a ticket whose
PR was already open. "Your turn" filled with work that was in flight.

The PR is the answer. On unlock, an `implement` verb with an open PR closing the issue is
consumed, the ticket goes to `Done`, and `awaiting` comes off. Any other verb still re-derives —
someone who typed `revise` while the session ran is still owed a run — and an implement verb with
no PR still re-derives too, because then nothing answered it.

The awaiting sweep obeys the same fact, or it undoes the unlock within the hour. `sweep-awaiting`
re-applies `awaiting` wherever the bot spoke last, and an `answer` or `revise` comment on a ticket
whose PR is open makes the bot the last speaker. The sweep put the label back, claiming the
reviewer on the PR and on a ticket with nothing left to do, and called its own correct write an
`awaiting-drift` anomaly. An issue with an open PR closing it is the PR's turn, in the sweep as at
session end.

## Our own check runs are not CI

`ci.ignoreCheckNames` exists because the dispatcher runs on `pull_request_target`, so its jobs
appear as check runs on the PR head. It listed `dispatch / act`, and it matched by equality.

GitHub does not name a matrix leg that. It names it `dispatch / act (sydevs, SahajCloud,
sydevs/SahajCloud, pr, 742, review, …)` — the job name, then every matrix parameter. The list
never matched a single one. And because the `act` jobs are serialized per item with
`cancel-in-progress`, cancelled legs are routine, and a cancelled run reads as failing.

So the dispatcher watched its own cancelled jobs, called CI red, and fired `fix-ci` against a PR
whose only real check had passed. Five sessions, three on one PR, then the cap, then `awaiting` on
sydevs/SahajCloud#742 with the reason naming its own job. The loop had found a way to spend
sessions arguing with itself.

The list now matches a name, or that name followed by a matrix suffix. `dispatch / journal` and
`legacy` joined it, since both are ours and both appear on the head. `dispatch / actions-other`
would not be ignored — the suffix has to be a matrix suffix, not any longer name.

The general shape is worth keeping in view: **anything the dispatcher does on a PR becomes input
the dispatcher reads.** That is what `pull_request_target` costs, and every filter over it has to
be written against what GitHub actually emits rather than what the workflow file says.

Since [Only required checks are CI](#only-required-checks-are-ci), the list matters only when the
ruleset cannot be read, and every check counts again.

## A write we cannot make is handed over, not thrown

`markPullRequestReadyForReview` came back `FORBIDDEN` on sydevs/SahajCloud#744 — the dispatch
token is not allowed to make it. The job died on the unhandled error, so the two actions after it
in the plan, the reviewer request and the label, never ran. A PR that was finished sat in draft
with nothing said, which is the worst of the three possible outcomes.

There are two kinds of failure here and they deserve opposite treatment. A bug should throw: it is
ours, and a loud job is how we find it. **A permission we do not hold is not a bug** — it is a
step this machinery cannot take. Nothing is gained by dying on it, and something is lost, because
everything after it in the plan is skipped.

So a denied write hands the step over. The plan finishes, the item gets `awaiting`, one comment
names the step and says the token could not take it, and the day's journal records a
`handed-over` anomaly. The reviewer sees a PR that needs one click rather than a PR that stopped.

This is the third time the same shape has come up, after the board and the day's journal, and the
rule generalises: **the dispatcher's job is to get the work to a person or a session.** Anything
that fails on the way should be visible and should not take the rest of the run with it.

## Quote the refusal, do not name a cause

The hand-over comment used to blame the dispatch token for every refusal it caught. Three merges
failed that way with no usable explanation, because the token was fine and the branch ruleset was
the thing saying no.

A refusal arrives as a status and a sentence. The status is nearly uninformative — a missing scope
and a branch rule both answer 403, and the rule can also answer 405 or 422, which the old test did
not catch at all. The sentence is the only part that distinguishes them, and it is GitHub's to
write. Naming a cause replaces the one piece of evidence with a guess, and a guessed cause sends
the reader to the wrong fix: rotating a credential that was never the problem.

So the comment carries 220 characters of what GitHub actually said, and names the step that could
not be taken. Nothing else. This is the same rule the runs follow about anomalies
([Report anomalies, do not explain them](#report-anomalies-do-not-explain-them)), applied to the
dispatcher, and for the same reason — an explanation written at the moment of failure is written
with the least information anyone will ever have about it.

## A draft that is ready is not an orphan

Eight draft PRs sat for six hours on 2026-09-09, and the sweeper told each of them the same
thing: *"This draft has had no CI activity for hours and no session holds it."* Every word was
true and the conclusion was wrong. They were green, they had been through the critic, and the one
step left was mark-ready — which the dispatch token was refused.

The sweeper re-derived only **non-draft** PRs each pass, because the conflict scan it borrowed
skips drafts. So a draft could only be reached through the orphan rule, which fires after six
hours and whose whole purpose is to give up and call a human.

Those are two different jobs. **Re-deriving is how a missed event is recovered**, and it should
happen every pass, on every open unlocked bot PR, because nothing else will notice a resolved
thread or a write the dispatcher was refused. **The orphan notice is how the loop admits
defeat**, and it belongs at the end of a long timer. Running them as one thing meant a PR with an
obvious next step waited six hours to be told it had none.

Now both run: the derivation on every pass, and the notice only when the derivation found nothing
left to do. A draft moving forward is never called an orphan again.

## An anomaly says itself once a day

Thursday 2026-09-10 posted **44 comments** on its journal and **zero** sessions ran. Forty-three
were dispatcher anomalies, and they carried **eleven distinct facts**: nine items whose attempts
were exhausted, one PR with red CI, the same PR orphaned. `sydevs/SahajCloud#754` alone produced
12 `ci-capped` lines and 6 `orphan` lines that day. Saturday it produced 22 of the day's 25
anomaly comments. It was still being re-reported four days later.

Every emitter already had the guard and only used half of it. `attempts-exhausted`, `ci-capped`,
`orphan` and `handed-over` each pair `commentOnce` on the item — keyed, skips a repeat — with
`postAnomaly` on the journal, which posted unconditionally. So the PR carried one comment and the
journal carried one per sweep pass, forever, for a condition no pass could clear. (`sweep-orphan`
re-runs `evaluatePr`, so a stuck PR spent three comments a pass, not one.)

The cost is not the API calls. It is that **the journal is `improve-loop`'s only input**, and the
reader who has to decide whether Thursday was a bad day. A day whose title reads *37 anomalies*
when eleven things are wrong has lost the number that mattered, and the `<!-- tally -->` count
inherits the same inflation.

The key is the **visible line**, not the marker: the same kind about the same item is one fact
however many dispatch ids produced it, and a changed reason — different failing checks, a
different attempt — is a new line that still posts. A listing the dispatcher cannot read falls
through to posting, because a duplicate is cheaper than a silence.

## A quiet awaiting item is swept in silence

Guarding `postAnomaly` stopped the journal repeating itself. It did not stop the repetition. The
review on #95 asked the question the other way round: `sydevs/SahajCloud#754` is capped and
already labelled `awaiting`, yet **every** sweep pass still re-derived it and still wrote — a
`label` call, a `commentOnce` call, an `anomaly` call — 48 passes a day, for a condition no pass
could clear. Three of those writes were merely deduplicated downstream. The fourth, the label,
was not deduplicated at all.

`awaiting` is the dispatcher's own record that it has said everything it has to say and the item
is now a human's. That makes the definition of *new activity* fall out of the label rather than
needing one of its own: **anything that clears `awaiting` is new activity, and every way to clear
it — a comment, a review, a push, a verb — is an event the dispatcher already wakes on.** So a
sweep pass that finds `awaiting` still on and derives no move has, by construction, found the
state the last pass left. It runs the derivation and drops the plan.

The gate is on the plan, not on the fetch. `sweep-pr` still gathers, because gathering is the
only thing that sees a resolved review thread or a write the dispatcher was refused, neither of
which fires a workflow (why: docs/why.md#a-resolved-thread-fires-no-workflow). Both of those show
up as a *move* — a `merge`, a `markReady`, a `fire` — so they pass the gate and act. What stops
is the writing, which is the half that was repeating.

## A review comment is feedback, whatever its association

A `CHANGES_REQUESTED` review with four inline comments landed on `sydevs/SahajAtlasWeb#212` at
`00:56:35Z` and dispatched nothing at all. The PR sat untouched until the reviewer wrote a plain
comment eleven minutes later asking why.

Two faults compounded, and either alone would have been survivable.

The first is that **GitHub stamps a review comment `CONTRIBUTOR` for the same login it stamps
`MEMBER` on every issue comment.** `resolve.mjs` sent review comments to reason `issue_comment`,
whose row gates on `hasAccess(association)` — `OWNER | MEMBER | COLLABORATOR`. Both surviving runs
logged the refusal verbatim: `comment by Ardnived without write access — not feedback`. The gate
was also redundant where it fired: the line above it already required `respondTo(author)`, a
hand-maintained allowlist of three logins. A second, payload-derived authorization check over an
explicit allowlist can only ever subtract, and here it did.

The second is that **submitting a review with inline comments emits five events in the same
second** — one `pull_request_review.submitted` plus one `pull_request_review_comment.created` per
comment — all resolving to the same target, so all five land in one concurrency group. One runs,
one pends, the rest are cancelled. Three of the five were, `pull_request_review.submitted` among
them: the only path with no association gate, and the only one that would have worked.

`dispatcher.yml` says cancelling is "safe only because the decision is re-derived". That is
exactly right, and exactly what the first fault broke. The survivors returned a `note` before
reaching `evaluatePr`, so nothing re-derived anything, and the invariant the concurrency block
rests on quietly stopped holding.

The fix restores that invariant rather than adding a second mechanism: review comments get their
own reason and re-derive through `evaluatePr`, as reviews already did. On a bot PR — every PR the
loop opens, and so every PR this outage can happen on — whichever of a human's five legs survives
now reads the PR's whole state, including the thread the cancelled comment created, since
`gather.mjs` fetches review threads for any open PR. Cancellation costs nothing again.
`association` left the facts with the reason, because nothing on the new path reads it.

**One storm still turns on which leg survives: the loop's own critic review.** Every
review-comment leg stops at the bot guard, so `pull_request_review.submitted` is the only leg that
re-derives, and cancelling it leaves nothing behind it. Nothing is lost, because the critic holds
the lock while it posts and the `unlock` that follows re-derives the PR — a different mechanism
than this one, and the reason the gap has never shown.

**The invariant is restored for bot PRs only, and that is worth knowing before the next outage.**
A human PR takes `case 'review'`'s verb tail instead, which reads the one body the event carried,
not the snapshot. Leave a verb in the review body, add inline comments, and a surviving
review-comment leg still parses text with no mention in it and stops. That gap predates this
change and is unchanged by it: the snapshot carries issue comments, not review-comment bodies, so
closing it means widening what `gather.mjs` collects. Nothing forces the rule structurally — every
PR-surface row still has to reach `evaluatePr` by hand, one case at a time.

Why prose could not catch this: nothing is wrong with any line in isolation. The gate reads
sensible, the concurrency comment states its own precondition correctly, and the association value
comes from GitHub. Only a live review with inline comments produces the combination, and no test
in this repo can post one. All 76 tests passed with and without the patch, because nothing covered
the mapping — which is why the new cases were written first and committed red.

## A routine clone is not a developer's checkout

`worktreeSetup` was named in one place: `implement-ticket` step 6, beside `git worktree add`. Every
other handler works the checkout directly and never read it. So the install never ran for them, and
a fresh clone ships no `node_modules`.

**37 sessions across five days paid for it**, in the week to 2026-09-27 — 17 on Monday alone — and
30-odd the week before. The cost is not only the 8 to 60 seconds of the install. Runs that did not
spot the cause worked around it: `npm pack payload@3.86.0` into the scratchpad, `curl` of the
registry tarball, reads off `unpkg` and `jsdelivr`. Runs that could not worked without: one
adversarial review left the two files its central claims rested on unread and said so, and four
`revise` runs rested every framework citation on a repo-side line instead.

`/security-review` has the same shape and a different missing thing. Its own prompt runs
`git diff origin/HEAD...`, and a clone made by a routine sets no `origin/HEAD`, so the skill aborts
before it reads a line — **11 sessions across four days**, each one fixing it with the same
`git remote set-head origin main`.

Both belong to the checkout, not to the worktree, so the rule moved to the one file every handler
reads. The `worktreeSetup` key keeps its name because it lives in each repo's
`.claude/workflow.json`, a protected path an unattended run cannot rewrite.

**There was a third missing thing, and naming only two of them hid it.** The clone's
`origin/<default-branch>` ref is whatever the image shipped, and nothing in the run refreshes it,
so every `git diff origin/main...` and every `git worktree add … origin/main` answered against a
ref days behind. **11 sessions across four days** in the week to 2026-10-03: SahajCloud#859's
critic read 83 files and 32,953 insertions for a 3-file diff, SahajAtlasWordpress#47's read a
version bump that was not in the PR and came close to filing a release-cutting blocker that did
not exist, SahajAtlasWordpress#50's clone sat 9 commits behind. A stale ref is worse than a
missing one: it answers, and the answer looks like a diff. So step 6 fetches first, and
`FETCH_HEAD` is no longer a recipe anywhere — a later fetch overwrites it, which is how
`review-pr`'s own diff step came back empty three times.

**Three scripts now depend on that fetch**, so trimming it breaks them silently.
`rule-delta.mjs`, `comment-lint.mjs` and `comment-fingerprint.mjs` resolve a bare `--base <name>`
through `base-ref.mjs` to `refs/remotes/origin/<name>`, because the clone's `refs/heads/<name>` is
stale for the same reason. On one clean tree identical to `origin/main`, `--base main` read 25
skill files behind and handed a human a rule removal nobody had made — the tripwire inverted, in
the one place a reviewer is told to trust it.

**The install is now deferred rather than owed.** A read-only handler runs no lane, so
`CI=true pnpm install` buys it nothing, and 11 sessions across four days in that same week
skipped it and spent a friction line justifying the skip. Blessing the skip alone would have kept
the half that costs something: three of them then could not settle a framework claim their finding
rested on, and one curled `unpkg` for a Payload tarball instead. So the rule defers the install to
the first node command and refuses the assertion in the meantime.

## A skill can name a plugin no routine has

`finalize-pr` step 2 named `/pr-review-toolkit:review-pr all` as the whole of its review pass, for
three weeks. `ListPlugins` returns nothing in a routine — **14 sessions across four days** in the
week to 2026-09-27, on top of 17 across four the week before. Every one of them substituted the
same thing without being told to: `/simplify`'s lenses, `/code-review`, `/security-review`. So the
step now names both, and says to check which it has. A skill that names one environment serves
whichever of its two readers it was written for.

The heading above is the same class with a different missing thing — a clone's `node_modules` and
`origin/HEAD` there, a plugin that was never installed here — so each rule keeps its own story.

## A ticket is built in phases, never split

`implement-ticket` used to meet an `Effort: Hard` ticket it could not finish in one run by calling
`split-ticket`: up to five child tickets, each with a `Blocked by:` line on the one before. Every
child then cost what a ticket costs — a `revise` session on filing, a human `implement` verb, its
own PR, critic and `address-review` rounds, and a human review. Two failures came with it.

**The children went stale.** A child is written against the unbuilt design of its siblings, and
the first sibling to merge rewrites that design. In the week to 2026-09-27, three of the five
children of SahajCloud#664 met this: #838's implement run found *"three acceptance criteria are
obsolete"* after #847 shipped a different design, SahajAtlasWeb#223 went *"stale a second time"*,
and WeMeditateWeb#135's revise could not ground its central claim at all.

**The reviewer reviewed half a feature.** Each child PR was judged against a whole that did not
exist yet, so the reviewer flagged gaps that later children had been planned to fill, and the
answer to each was "that is ticket N+2".

The split existed to keep each review surface small. It bought that at the human's expense, when
the reader who needs the small surface is the critic. So one ticket is now one branch and one PR,
built in phases. The PR body's `## Phases` checklist is the plan, and the dispatcher reads it: while
a box is unticked, a green draft starts the next `implement` session on the ticket's lock instead
of the critic. Inside a session each phase closes with the gate and a scoped `/code-review` and
`/simplify` pass in fresh contexts. The critic reads the whole PR once, at the end, and the human
reviews once.

Stacked sub-PRs merging into a feature branch were considered and rejected. Each sub-PR costs its
own critic, `address-review` and CI sessions. Nothing in the dispatcher or the rulesets knows a
base other than `main`. And the human still reviews the whole diff at the end.

**The bound is progress, not a count.** A continuation runs only if the last `implement` that
ended ticked at least one box, and a phase too large for one session is split into smaller boxes.
A session that ends with nothing ticked — or runs out of attempts — stalls the PR. It gets
`awaiting` and one comment, and any comment from the reviewer re-arms it. No ceiling was needed,
because the plan itself says how many sessions it should take.

**Amended by [Split at reviewability seams](#split-at-reviewability-seams).** Splitting came back
for one reason only: a seam where each part can be reviewed alone. A split on size is still
retired, and a large implementation ticket is still built in phases on one PR.

## A contract sync is a PR, not a ticket

A consumer's copy of a producer's file — SahajCloud's generated types in WeMeditateWeb and
SahajAtlasWeb, the atlas URL contract in the WordPress plugin — has exactly one correct content:
the producer's, on `main`. Bringing it up to date is not a decision. Yet Thursday's survey filed a
`Task` for a stale copy, and `implement-roadmap` filed a child in every consumer. Each then waited
for a proposal review, a human `implement` verb and a session, to run one command whose output
nobody could have chosen differently.

So a sync goes straight to a PR. `contractSync` in `loop-config.json` names each copy: the
producer's sources, and each consumer's command and paths. When a merged producer PR touches a
source, the dispatcher runs the consumer's command on its `main` and opens one bot PR, which the
loop carries like any other. If the new shape breaks the consumer, CI goes red and `fix-ci` adapts
the code. The survey opens any sync the dispatcher missed. `implement-roadmap` files a child only
for consumer work that needs a decision.

The same holds for the rest of audit-contracts' findings where the source is plainly right: a
document that misdescribes the code, a missing changelog entry, a command that no longer exists.
A ticket is kept for the case where the code may be the wrong side.

## The lease is a ref, not a label

The label was taken too late to be a mutex. `gather` read `locked` once, `decide` ran on that
snapshot, and `apply` wrote the label after the plan was decided — with `ensureJournalDay` and up
to twenty issue reads in between. Every call in that window was open: a second pass gathering
inside it also saw `locked: false`, and both fired.

Serializing the legs does not close it. The concurrency group is keyed on the item number, but
`decide` emits `conflict-scan` and cross-repo `unblock-check` targets that drain inside the
already-running job, where no group covers them. And a group is scoped to the repository whose
run it is: `dispatcher.yml` is a reusable workflow each repo calls from its own
`workflow-state.yml`, so SahajCloud's `dispatch-WeMeditateWeb-144` and WeMeditateWeb's own never
serialize. **No concurrency group can serialize cross-repo work.** Only state held in the target
repo spans those scopes.

A read-back of the status comment is not that state. `PATCH /issues/comments/:id` is
last-writer-wins, GitHub documents conditional requests on GET for caching rather than as a write
precondition, and the interleaving W1-write, W1-read, W2-write, W2-read has each pass reading its
own id back. Both fire. The delay that would fix it cannot be sized, because the bound is
GitHub's write visibility plus runner skew.

`POST /repos/:owner/:repo/git/refs` is the one GitHub write that *is* a compare-and-swap: it
answers 422 when the ref exists, so exactly one of two concurrent creates wins, with no read at
all. `refs/sydevs-lease/<number>` is taken before the label and deleted wherever the lock is
released. The ref's existence is the lease; where it points is never read. It sits outside
`refs/heads` and `refs/tags`, so it is not a branch or a tag, and the bot PAT's contents write
already covers it.

A ref that outlives its session is a permanent lock on that item — a worse failure than the
duplicate dispatch it replaces. So every release path deletes it, a throw between the create and
the fire releases it on the way out, `sweep-timeout` deletes unconditionally when it reclaims a
dead session, and `sweep-lease` reclaims a ref on an item carrying neither the lock nor a
recorded session.

## A failed release says so

Every release path called `releaseLease` and dropped its boolean. A ref that will not delete —
a 403, a protected-ref rule, an outage mid-write — left the lease standing, and the next
`takeLease` answers 422 `already exists`. That reads as contention, and contention is the one
`takeLease` path that posts no anomaly, because contention is normal. So the item stopped for
good with nothing journalled: the same invisibility the journal half of this change removes from
the tally.

The release now posts a `lease-release-failed` anomaly when the delete fails, and the posting is
itself guarded — an anomaly we cannot write must not break an exit path that is already failing.

## One target per item

A concurrency group does not queue three legs. One runs, one pends, and a newer pending cancels
the older — `dispatcher.yml` records that rule. The sweeper does produce three for one number: a
blocked, stale, open draft bot PR gets `unblock-check`, `sweep-pr` and `sweep-orphan`. So the
middle one was silently dropped.

Measuring which leg survives would only document the loss. `resolve` emits one target per
`repo#number` instead, carrying every reason it found, and `act` drains them in order inside the
one leg — which it already did for emitted targets. Nothing is lost, because the decision is
re-derived per reason anyway, and no two legs can share a group any more.

## A dispatch id is unique per fire

The stamp dropped the sub-second digits, so two fires in the same second produced the same id.
SahajCloud#867 is that case: one `review-pr` id, two journal entries one second apart,
indistinguishable in `rec.dispatches`, in the journal tally and in the status comment. An id that
two fires can share cannot carry a count, and cannot be the key for anything.

Milliseconds alone still collide inside one millisecond, which is exactly the window two passes
of one event land in. A four-hex-digit random suffix carries the uniqueness; the millisecond
stamp stays so the ids still sort by time.

## A fix-ci fire is keyed to its head

The three `fix-ci` dispatches on SahajCloud#861 and on SahajAtlasWeb#245 were not a concurrency
bug. They were serial, lock-respecting, and each one re-derived a decision the first session had
already made and stood down from.

A red run produces several `workflow_run`, `check_suite` and `status` events per push, each its
own `act` run. `evaluatePr` fired `fix-ci` on any failing check under the ceiling, keyed on
nothing, and the first session's own unlock re-derived the same plan on the same red head. So the
only thing that stopped the loop was `ceilings.ciFixIterations` — which is exactly why it was
exhausted, and why it then refused the real fix.

The head sha is what a `fix-ci` fire is about, so it is what the refusal keys on: a session that
already ran against this sha and ended, whatever its outcome, means no second fire. A push to a
new sha has no ended session against it, and asks again. `rec.dispatches` keeps 20 entries, so a
very long-lived PR can age one out; the ceiling remains the backstop.

## The journal tally needs a writer that cannot stop

Monday 2026-09-28 reported 22 dispatches and 1 anomaly against 37 and 4. Thursday 2026-10-01
reported 84 and 6 against 97 and 7. Monday's counted set was precisely its first 22 session
comments in chronological order, and its per-handler tally matched those 22 exactly, so the
counter did not miscount — it stopped.

`refreshTally` had one caller, `journalTick`, reachable only from the `journal` job on the
schedule. Three properties made one bad tick permanent. The tick was unguarded, so a throw in
`closeDuplicateDays` skipped the tally for that tick entirely. Nothing revisited a day once
`localDate` moved on, so yesterday's title stayed frozen at the last tick that succeeded.
And the failure was invisible by design: `dispatch / journal` is in `ci.ignoreCheckNames`, so a
red journal job is never CI the loop acts on, and nothing posted an anomaly.

**The schedule is also not the schedule.** 212 schedule runs span 2026-09-09 to 2026-10-06 —
about eight a day against a declared fifty, at gaps of two to five hours, every one of them
concluding `success`. So the loss is a cron GitHub mostly drops, not a throw, and a day can roll
with its last true count hours old. #134 froze at 00:31Z with 6.5 hours of its journal day left.

That is why the repair cannot be keyed on *which* cron fired: no tick is guaranteed to land near
midnight. Each step of the tick is guarded on its own, a failure posts a `journal-tally` anomaly
to the day's own issue, and **every** tick re-counts yesterday as well as today, under
yesterday's own weekday. The refresh writes nothing when the counts already agree, so running it
every tick costs one read and buys a day that closes with a true count.

It matters beyond tidiness because the weekly reflection builds its usage report from the seven
titles and tally blocks, with no comment reads. The journals are the one input a crashed week
cannot reconstruct.

## A review body is feedback

The dispatcher fired `address-review` whenever a `respondTo` review had a non-empty body: *"a
review asks for changes"*. `address-review` then looked for work in two places only, the unresolved
file threads and the newest conversation comment. It read the review list just to learn the
decision state. So a review whose only feedback sat in its main body started a session that found
no thread, did nothing, and ended. The general comments — *"rename X; drop the fallback"* — were
skipped in silence, by a session started for exactly them.

The fix gives the two halves one definition of work. Each distinct point in a `respondTo` review
body, submitted after the bot's last comment, is an item, and gets the same three answers a thread
gets: adopt it with a commit, rebut it with evidence, or ask. A body has no thread to reply in, so
the summary comment quotes each point and gives the SHA or the evidence. The summary being newer
than the review's `submitted_at` is what marks it handled, the same `since` test the dispatcher
uses, so a resumed run never answers it twice.

## A locked item is never awaiting

A ticket created with its type already set fires two events, `opened` and `typed`. They share a
concurrency group, so they run one after the other, in either order. On the first twelve roadmap
goals, `typed` ran first, took the lock and started the review. `opened` then ran its placement
row, which adds `awaiting` to every new ticket, onto an item a session already held. Seven goals
sat in the Awaiting view while the bot worked on them.

Every row could check the lock itself, but one more row would forget to. So the rule sits in one
place, after every row: on a locked item, no plan adds `awaiting`. Nothing is lost. The unlock
re-derives the item from its finished state, and that is where `awaiting` belongs.

## Subscribe only to what resolves

The callers subscribed to `assigned`, `field_added` and `field_removed` long after the state
machine that needed them retired. `resolve.mjs` had no rule for any of them, so each started a
workflow run, checked out this repo, and resolved to zero targets. `unlabeled` was worse: only the
lock coming off means anything, but the dispatcher itself removes `awaiting`, `stuck` and
`proposal` on most passes, with a token whose events do trigger workflows. So nearly every dispatch
paid for a second, empty one.

Two rules now. The `types:` list names only the actions `resolve.mjs` turns into work. What only
some instances of an action need is filtered in the caller's job-level `if:`, which GitHub
evaluates before any runner starts: an `unlabeled` for any label but the lock, and an `edited` that
left the body alone — the body is the only part of an issue the dispatcher reads markers from. The
lock's name appears there literally, because a caller cannot read `loop-config.json`. Change
`labels.lock` and the five callers together.

---

# Roadmap, tickets and audits

## The roadmap tier

A ticket used to carry three things at once: what someone wanted, how the code should change, and
the questions nobody had settled. When this tier was designed, 25 of the 59 open issues had a
`## Open questions` section, and most of them sat waiting on a human. A technical reader could not
build them until someone decided. A product reader could not decide without reading through file
paths.

So there are two tiers. A **Roadmap ticket** is a plain-language goal: why it matters, what
success looks like, what is not included, and every decision, offered as options with a
recommendation. Anyone can read one, and the org project shows them publicly as the roadmap. An
**implementation ticket** is Claude-ready: no open questions, an approach, an executable checklist.
The loop builds it with no further revision. Bugs and small tickets skip the roadmap, because a
tier that only relays them adds a round trip and nothing else.

A human approves at two points: the goal, once its decisions are settled, and its children, in one
verb. Everything between them is the loop's, and the aim is that a roadmap approval leads to
reviewable PRs with nothing in between.

A goal lives in its milestone's repo, so a launch's goals are in one place. Each milestone has
exactly one home repo, and `revise-roadmap` asks the dispatcher to move a childless goal there
(why: docs/why.md#a-session-asks-actions-acts).

## A roadmap ticket has no status

The board's `Status` lanes — Proposed, Revising, Approved, Done — describe one ticket on its way to
one PR. A goal does not travel that path. Its stages are suggested, committed, in delivery and
shipped, and GitHub already shows each one: no milestone and no children, a milestone, a sub-issue
progress bar, closed. A lane beside them is a second answer to the same question, written by rules
that mean something else on a goal. `Approved` on an `implement` verb would sit on a goal for the
weeks its children take, and tell the reader nothing the progress bar does not.

So `decide` turns every `Status` write a rule produces for a Roadmap ticket into one clear, and a
ticket typed Roadmap after it was filed loses its lane on the `typed` event. The Pipeline and
Backlog views filter `-type:Roadmap`, and the public Roadmap view shows goals alone.

## A stranger's marker is text

The project went public with a "Suggest a goal" form, so anyone can now open an issue the
dispatcher reads. Before that, every body it parsed came from a member or the bot, and a
`Blocked by:` line was trusted on sight: it became a native relationship, a `blocked` label, and
later an `unblock-check` that fires a session. A `Re-check:` line parked the ticket.

From a stranger, each of those is a write nobody chose, aimed at our own tickets — a relationship
naming SahajCloud#632, and a recheck session paid for when it closes. So the dispatcher reads
`author_association`. On `issues.opened` by someone outside the org it converts no marker and
honours no `Re-check:` park. On `issues.edited` the editor decides, not the author. Only the
author, the bot or a maintainer can edit a body, so the one edit to refuse is a non-member
author's own. A member who edits the same line in makes it state.

## An outsider feeds, a member fires

A member's new goal is reviewed on arrival, unprompted. Opened to the public, the same rule would
let anyone spend an Opus session by filing an issue. Every handler is a cloud session with write
access to five repositories, and a stranger's text inside one is a prompt-injection surface, however
carefully the skill is written.

Ignoring strangers outright would lose something, though. The person who suggested a goal knows
what they meant, and their answers are often the best evidence a review has. So a goal's author is
the one non-member whose comments count, and only as input. They set `awaiting`, with no session,
and the next run a member starts reads them as data, never as instructions. A non-member's goal is
not reviewed on arrival: it waits, `awaiting`, until a member says `@sydevs-bot revise`, which is
how a member accepts it. Closing it as not planned is how a member declines it.

Verbs already worked this way, since only a `respondTo` human's verb counts
(why: docs/why.md#respondto-is-an-allowlist). This extends the rule to the one place a stranger is
expected to talk.

## A decision is settled before the build

An `implement` session that meets an unsettled decision has two moves, and both cost. It guesses,
and the review then argues the decision inside a PR, where it is most expensive to change. Or it
stops, and a fire, a clone and a lease bought nothing.

Whether a decision is still open is a checkbox count. `parseOpenQuestions` reads the `- [ ]` lines
under `## Open questions`, and an option bullet under a question is not a checkbox. So the
dispatcher refuses `implement` for free, on either tier, says how many questions remain and how to
answer them, and starts no session.

## A session asks, Actions acts

A session can write a comment, but not a transfer, a dispatch or a label the dispatcher owns
(why: docs/why.md#awaiting-has-one-writer). The roadmap tier needs all three: a goal moves to its
milestone's repo, a changed goal re-plans its children, and a decision raised on a child hands the
parent to you.

The shape is the one `Blocked by:` already uses: the session writes a marker, and the dispatcher,
which can act, reads it. Here the marker is `<!-- sydevs-request {...} -->` in the session's own
comment. Three keys are read — `replan`, `escalated`, `transfer` — and anything else is dropped. A
transfer must name one of our repos. A request older than the session that just ended is ignored,
so an old comment never replays. The transfer runs last in the plan, because the issue's number
changes when it moves.

## Recheck before awaiting

A hold used to end mechanically. When the `Hold Until` date passed or the last blocker closed, the
dispatcher removed `blocked`, set `awaiting` and mentioned you. But a date passing is a cue to
look, not proof that anything changed. A ticket held for a release came back on the date whether
the release had shipped or not, and the only way to put it back was for you to read it and park it
again. A closed blocker can also ship something other than what the ticket assumed.

So the cue now fires a short recheck session — `write-ticket`, or `revise-roadmap` on a goal — that
reads why the ticket was held and decides:

- **Still blocked:** it re-holds with a new date and one line. Nothing pings you.
- **Free, and still valid:** a pre-approved ticket starts. Any other ticket becomes `awaiting`.
- **Changed by what landed:** the body is updated, and a decision reaches you with options.

A quiet re-hold is safe only if it cannot go on forever. After `holdUntil.maxRehold` in a row, the
dispatcher hands the ticket to you with three options: keep waiting, rework it around the blocker,
or close it. A blocker that never clears is a decision, not a wait. Any verb from you resets the
count.

The `block` verb feeds the same machine. `block until <date> — <reason>` and `block on <ref>` are
mechanical. `block <reason>` alone asks a session to choose what to watch and when. A date past
`holdUntil.maxHorizonDays` is refused, because a longer wait is better spent as a series of
rechecks, each one a chance to notice that the world moved.

## Children are approved together

`implement-roadmap` turns one goal into several implementation tickets, in order. Approving them
one verb at a time costs a human round trip per child. The blocked ones cost more: someone has to
remember to come back when the blocker merges, which is exactly the memory a person does not keep
for weeks.

The decision is the same for every child: build this plan. So `implement` on a **planned** goal
approves every open child, in one comment. Planned means `implement-roadmap` has run, not that
children exist: a review attaches the existing tickets it finds as sub-issues, so the roadmap's
progress bar tells the truth from day one, and those were never planned. The first `implement`
plans them, adopting what is attached; only the next one approves. A re-plan request before any
plan is ignored for the same reason. A free child starts at once. A blocked child records
`pendingImplement` and starts when a recheck confirms its blocker cleared, with no second verb. The
order needs no human either. It lives in the `Blocked by` relationships `implement-roadmap` wrote.

The approval is still a human's. The dispatcher carries a verb forward and never invents one
(why: docs/why.md#the-loop-may-never-write-implement). A child with an open question still waits,
approved or not.

## A goal is verified, not assumed

Every child closing is not the goal shipping. A child can close as not planned, a plan can miss a
piece, and the parent simply stays open: when this tier was designed, SahajCloud#702 was still open
with every child closed.

So the last child closing fires `revise-roadmap` in verify mode. It writes a plain-language note of
what shipped and checks it against `## What success looks like`. A match closes the goal. A gap
sets `awaiting` and names it, and `implement` on the goal then files only what is missing. If a
session holds the goal when its last child closes, the dispatcher records that a check is owed and
runs it on unlock.

## A late decision goes to the goal

A decision that turns up while writing or building a child is a decision about the goal. Left on
the child, it is answered by whoever reads that one ticket, and the siblings it also binds never
hear of it. It also hides from the people the roadmap exists for, who read goals, not
implementation tickets.

So it goes up. The session adds it to the parent's `## Open questions` in plain language, with
options and a recommendation, links it from the child, and sets `escalated` in its request marker.
The dispatcher gives the parent `awaiting`, and not the child, so the same question never reaches
you twice. `implement-roadmap` follows the same rule: a decision found while planning files nothing
until it is answered.

## One author writes every implementation ticket

Tickets used to be written by `draft-ticket`, `cross-repo-issue` and three surveys, and rewritten
by `revise-ticket` and `answer-ticket`. Each carried its own idea of a complete body, and this
plugin exists because prose copied several times does not stay in sync. The symptom was a safety
net: every bot-filed proposal got an automatic `revise` session on arrival, because it so often
arrived half-specified. sydevs/claude-workflow#160 shows what the net caught. It was filed naming
two dangling `docs/why.md` anchors, and the revision found seven.

A net under a weak author costs a session on every filing. Fixing the author is cheaper. So
`write-ticket` is the only writer of an implementation ticket, whether `file-ticket` calls it
locally, `implement-roadmap` once per child, an audit at filing, or a recheck. A proposal arrives
as fully specified as anything a human verb would produce, and the automatic revise is gone. The
`proposal` label still marks it until a human gives a verdict.

## Split at reviewability seams

**This amends [A ticket is built in phases, never split](#a-ticket-is-built-in-phases-never-split).**
That rule retired splitting because the splits of the time were made on size. SahajCloud#664's
children were written against their siblings' unbuilt design, went stale as each sibling merged,
and left the reviewer judging half a feature. Phases fixed that for one large ticket, and still do.

A roadmap goal has a different shape. "Anyone can submit a class or suggest a correction, safely"
already had tickets in SahajAtlasWeb and SahajCloud, and no commit spans repos. Some splits are
forced. Others are simply good: a general capability, built and reviewed on its own, that the goal
then uses.

So splitting is back, at one kind of place only — a **reviewability seam**, where a reviewer can
understand each PR without holding the others in their head:

- separable parts with little connective tissue between them, or
- a general capability the goal then uses.

Never split tightly coupled work, and never split on size. A large but coherent implementation
ticket is still one PR, built in `## Phases`. The stale-children failure needs connective tissue
to happen, and a seam is, by definition, where there is little.

## Decisions come with options

An open-ended question is a design task handed to the reader. *"How should old atlas links
behave?"* asks them to research and design something before they can reply, and a ticket that asks
that waits until someone has an afternoon. *"A — permanent redirect (recommended), B — temporary
until 2027"*, each with its consequence, asks them to choose, and a choice fits in one line.

So every decision the bot raises — on a goal, in an escalation, at the re-hold cap, on a direct
ticket — is numbered, offered as options with consequences, and carries a recommendation.
`@sydevs-bot revise 1A` answers it, and so does free text. The bot ticks the item and moves it to
`## Decisions` with the answer, who gave it and when, so the next reader and the next session can
see what was settled and by whom. A recommendation is not a decision: the bot still waits for the
reply.

## Push back before filing

The cheapest ticket to review is the one never filed. When the roadmap was seeded, one goal — a safe
intake for everything visitors submit — already had fifteen tickets across three repos bearing on
it, fourteen of them closed. Nothing at filing time had pointed each new author at the ones before.

So `file-ticket` searches before it writes: open and closed tickets, the `## Decisions` on roadmap
tickets, tickets closed as not planned, and each repo's `AGENTS.md`, `docs/` and `docs/why.md`.
Work already in the pipeline gets a recommendation to comment on the existing ticket instead. A
request that contradicts a recorded decision gets that decision quoted back, with a recommendation
not to file without new evidence. The user can still override. The point is that the override is
deliberate.

## Experiments answer facts

A fact posed as an open question costs twice. It waits for a human who must then go and find out —
read the code, try the package, call the vendor's API. And since `implement` refuses while any
question is unticked (why: docs/why.md#a-decision-is-settled-before-the-build), it also blocks the
build.

The bot can find out itself, and sooner. So only a decision — product, policy, ownership, budget —
becomes a question. A fact is settled from code, from docs, or from an experiment: a local script,
a package installed and its source read, a throwaway `claude/spike-*` branch pushed for a preview
URL, or a read-only call to production SahajCloud or a vendor API.

Two limits keep experiments safe. **Never a production write.** The routine environment carries
read-only keys only, because it has no secret store to protect anything stronger. **A spike is
throwaway.** The session deletes its spike branch before it ends, and the dispatcher ignores every
`claude/spike-*` PR, so no critic, `fix-ci` or orphan notice is spent on a branch nobody will merge.

## Effort was removed

Every author had to set the Effort field — Easy, Moderate or Hard — and one rule acted on it:
`implement-ticket` built a `Hard` ticket in phases. Once `split-ticket` was retired, nothing else
turned on its value, and that value was a guess made at filing, then re-estimated at each revision.

The phasing decision belongs where the evidence is. `write-ticket` writes `## Phases` into an
implementation ticket that will not fit one run, from the code it has just read, and
`implement-ticket` follows them. A guessed size beside that plan could only disagree with it. So
the field is gone, and Priority, which measures the consequence of not doing the work, is the one
field every ticket carries.

## Three audit rotations

`survey-analysis` ran on Wednesdays only, stepping through ten angles by ISO week, so each angle
came round once every ten weeks, and Saturday ran nothing. The angles also wanted different
outputs. A correctness or security finding needs a ticket. A performance or accessibility finding
usually needs a decision. A simplification or a comment fix preserves behaviour, and reviews well as
a ticketless PR. One rotation made each night re-decide which kind of night it was.

So `audit-code` runs three times a week, on Tuesday, Thursday and Saturday, evenly spaced, and each
day has its own family: **risk** files Bug or Task tickets, **experience** files tickets, and
**hygiene** prefers ticketless PRs. The old `comment-cleanup` skill became one hygiene angle. A
family never runs twice in a row, and each angle recurs every four to eight weeks.

Hygiene's ticketless PRs are the one deliberate exception to `prAllowlistGlobs`, and only three
kinds qualify — though any family now sends a docs-only fix to a PR
([A docs fix is a PR, not a ticket](#a-docs-fix-is-a-pr-not-a-ticket)): a comment sweep that `comment-fingerprint.mjs` proves changed comments only, a
dead-code removal proven unreferenced, and a doc fix where the code is plainly right. The proof
stands in for the ticket, because a ticket would only ask a human to agree to a change that cannot
alter behaviour. It does not stand in for the review: each PR still needs a human's approval to
merge. Anything less certain goes back to a ticket.

Each rotation counts the runs of its own day from `auditCalendar.rotationEpoch`, by date rather
than by journal. An overridden day is not a run, so a monthly override delays an angle instead of
skipping it, and a missed night does not break the count. A weekday can also hold a list, whose
skills take turns by the same count. `audit-contracts` used to override the first Saturday. When the
dispatcher took over vulnerability fixes, it moved to Mondays, taking turns with `audit-deps`'s
routine updates, and hygiene kept every Saturday.
([A vulnerability is checked before a session is spent](#a-vulnerability-is-checked-before-a-session-is-spent))

## Intake asks with options

`file-ticket` used to ask in prose and wait for a typed reply, so every clarification, pushback
and confirmation was an open-ended question in a terminal. With `AskUserQuestion`, each question
arrives with its options, its consequences and a recommendation — the same shape `## Open
questions` already uses ([Decisions come with options](#decisions-come-with-options)) — and one
click answers it. Every open question also offers `Leave it on the ticket`: the person filing is
often not the person who should decide, and the review on GitHub can settle it.

Who is filing decides what is asked. The login `gh` is signed in as is compared with
`assignment.reviewer`. Anyone else — or a session with no `gh` login — is treated as
non-technical:

- **Technical questions go to the ticket unasked.** Offering "defer" as the recommendation still
  invites an uninformed pick, and the reviewer will see the question on GitHub anyway.
- **The preview is a plain summary.** An implementation ticket's body is written for a run picking
  it up cold, not for the person who asked for it.
- **The hand-over is never offered.** Starting a build is the reviewer's call, and a comment from a
  login outside `respondTo` would authorise nothing.

Reading the reviewer from `loop-config.json` rather than naming them keeps the rule a data edit.

## An answer before filing is the request

`## Decisions` records who settled what, and when, so the next session does not ask again and the
next reader can see a choice was made ([Decisions come with options](#decisions-come-with-options)).
That record earns its place once a ticket exists and people have read it.

Before filing there is no earlier version for an answer to change. The person answering is the
person asking, and the answer is simply what they want. Listing it as a decision makes a fresh
ticket read as if it had been argued over, and splits one request across two sections. So an
intake answer is written into the section it shapes — a scope cut into `## Not included`, a
behaviour into the goal or the criteria — where the review reads it as the requirement it is.
After filing, the old rule stands.

## A docs fix is a PR, not a ticket

Sixteen documentation-only fixes became tickets between 2026-08-15 and 2026-10-09. Ten predate the
routes to a ticketless PR (#132, #152). The six since were routed exactly as the rules said, and
the rules were the cause:

- **The handlers that find most drift could not open a PR.** `revise-roadmap`, `write-ticket`,
  `review-pr` and `address-review` never push, so a one-file Markdown fix (SahajCloud#901,
  SahajAtlasWeb#261) cost a ticket, a verb and an implement session.
- **A comment fix fell outside `**/*.md`,** so `prAllowlistGlobs` sent it to a ticket
  (SahajAtlasWeb#264), though `comment-fingerprint.mjs` already proves a change comment-only.
- **`write-ticket` widened a doc fix into code.** It added a guard test (SahajCloud#810, #862),
  and then the work genuinely needed its ticket.

Only three of the sixteen needed one: a decision (SahajAtlasWeb#173), a browser measurement
(SahajAtlasWeb#263), and a copy owned by another repo (SahajAtlasWeb#226).

A ticket for a docs fix asks a human to agree to a change that cannot alter behaviour, then pays a
session to make it. The PR is the proposal, and the review still gates the merge. So a docs-only
fix where the code is plainly right is a ticketless PR, of any size, from any handler. It is the
one exception to the prose handlers' "never push", on a branch of its own, so it never touches a
PR under review. A doc the current ticket made stale is still fixed in that ticket's own PR.

When one must still be a ticket — the repo is out of the session's reach, or the code may be the
wrong side — it is a `Bug`. A doc that misdescribes the code is a defect, and a Bug never goes
through the roadmap.

**Widen before you open.** The day after that rule shipped, two more docs tickets were filed, and
each followed it. Implementing SahajAtlasWeb#264, a session found five more comments carrying the
same retired premise. It read "never widen a PR" as "not in the ticket's list", and one of the five
needed a decision, so all five became SahajAtlasWeb#270. The critic on that PR, #269, flagged the
twin of a sentence it fixed. `address-review` rebutted it *on scope* and routed it to #270 too.
Measuring a CSP for #263, another session found a refusal it could document and a question it
could not settle, so both became SahajAtlasWeb#272.

So docs findings gather where docs work already is. A doc on the subject of the ticket or PR you
hold, or carrying the stale premise it fixes, is that work's, listed or not. A docs ticket or PR
takes any docs finding in its repo. Without one in hand, an open docs ticket gets a line, and an
open bot docs PR gets a commit — but never one that is locked, which another session owns, or
approved, which auto-merge would land with commits the reviewer never saw. Only then is a new PR
opened. A point that needs a decision is a question in that PR's body, and an unknown the run can
measure, it measures. Neither splits a docs fix into a ticket.

## Only required checks are CI

GitHub merges on the ruleset's required checks: one in SahajCloud, three each in WeMeditateWeb and
SahajAtlasWeb, two in SahajAtlasWordpress. The loop counted every check run and status except its
own. Between 2026-08-28 and 2026-10-09, 19 of 53 `fix-ci` runs chased a red that GitHub did not
require:

- **A Railway outage on 2026-10-07** turned SahajCloud#879, #880 and #885 red through Railway's
  commit status. `fix-ci` fired six times with nothing in the PR to fix (claude-workflow#164).
- **WeMeditateWeb#144 got two CI runs on one head**, and `cancel-in-progress` cancelled one.
  `filter=latest` dedupes only within a check suite, so the cancelled rows read as failing
  forever: three runs, then the cap, while GitHub showed green.
- **A stalled Cloudflare Pages build** held WeMeditateWeb#109.

So `gather` reads the base branch's rules and keeps only the required contexts, newest run of each
name. A required check that has not reported yet counts as queued, so one late job cannot read as
green. A red check outside the list is said once on the PR, since a preview link may not open, and
fires nothing. When the rules cannot be read, or require nothing, every check counts as before:
calling an untested PR green is the error that ships something broken. `fix-ci` gets the same
list, through the record's `ci.reason`.

A required check can still fail on infrastructure — `Smoke` waits on the Pages preview — so this
narrows the false reds. It does not end them.

## A bot PR answers a mention or a review

A bot PR dispatched `address-review` on any comment from a `respondTo` human. A note to a
colleague, a "will look tomorrow", a thank-you: each cost an Opus session, which then had to find
something to reply to. Issues already required a mention.

So the rule is now the same on every surface: a conversation comment reaches the bot only through
`@sydevs-bot`. A review on a PR the bot opened needs none, and neither does a thread reply, which
GitHub records as a review — reviewing its PR is addressing it. The check sits in the derivation as
well as the event row, so the 30-minute sweep agrees: an unmentioned comment is owed no reply, and
leaves `awaiting` where it was. A `review` verb asks for the critic, so it is not also owed a reply.

## A vulnerability is checked before a session is spent

`audit-deps` ran every Monday across every repo, whatever there was to do, and an alert opened on a
Tuesday waited six days. SahajCloud's nodemailer alerts were open from 2026-09-30. Dependabot
already knows what that session would establish first: how severe an alert is, whether it reaches
production code, and whether a patched version exists.

So the dispatcher reads the alerts once a day, and fires `audit-deps` in a repo only when a high or
critical runtime alert opened in the last day — or, on Monday, one with a fix is still open — and
no dependency PR is already open there. Whether the vulnerable code is reachable, and what a
major's changelog breaks, stays the session's judgement.

The check keeps no memory. A session that judged an alert unreachable leaves it open, and Monday
shows it to a session again: the old weekly re-check, without the empty weeks. A failed fire is not
retried, because the alert is due again on Monday.

Reading alerts takes the Dependabot permission on `SYDEVS_BOT_PAT`, and the first run found the
token without it: four 403s. So alerts it cannot read fall back to the old weekly run — on Monday
it fires anyway, and the journal says why every day. Losing the read must never lose the audit.
SahajAtlasWordpress is not checked: it ships no production dependencies.

The fire has no item, so it has no lock. It is a repo-scope record, `kind: "repo"`, which
`payload.mjs` accepts only for a handler configured with `scope: "repo"`. The daily cron and the
open-PR check keep it idempotent. Routine minor and patch updates have nothing to detect, so they
stay on the calendar, taking turns on Mondays with `audit-contracts`.

## Dependency review checks what a PR adds

SahajAtlasWeb required a `Dependency Audit` that audited the whole lockfile. Between 2026-09-30 and
2026-10-03 new advisories against dependencies already on main — undici, then braces — failed
SahajAtlasWeb#233, #237, #243 and #248, none of which touched a dependency. `fix-ci` then rewrote
overrides and the audit baseline on those unrelated PRs, leaving two of them in a merge-order
hazard. A gate that fails a PR for something it did not cause is an outage, not a gate.

What a PR check should stop is a PR *adding* a vulnerable dependency. `dependency-review-action`
compares only the dependencies a PR changes. An advisory already on main is the daily check's.

It is a reusable workflow in this repo, called from each product repo's own CI, never through
`dispatcher.yml`. Pausing the loop with `BOT_DISPATCH` skips the whole dispatcher, and a required
check that never reports blocks every merge. It runs in the merge queue too, against the queue's
base, and passes at once on any other event, so the required name always reports.

# Retired

Each of these is a failure someone paid for, under a mechanism that no longer exists. They
stay so a future reader meets the lesson instead of re-learning it. The line under each
heading says what took its place.

### A proposal is reviewed before you read it

**Replaced by:** one author writes every implementation ticket, so a proposal arrives fully
specified and no session revises it on arrival.

A ticket the loop filed arrived with nobody to defend it, and its weakest part was the part written
from memory rather than from the tree. So `issues.opened` fired `revise` on every bot-filed ticket.
sydevs/claude-workflow#160 is what that bought: filed naming two dangling anchors, it was rescoped
to seven by the revision before a human spent a verb on it. *One author writes every implementation
ticket*, above, moved that care to the moment of writing.

### A Hard ticket that will not fit one run is split

**Replaced by:** one ticket, one PR, built in phases. A split survives only at a reviewability seam.

`split-ticket` filed up to `ceilings.maxChildrenPerSplit` ordered children, and each needed its own
verb, PR and review. *A ticket is built in phases, never split*, above, says what that cost.

### Rung 2 competes for the same budget

**Replaced by:** the ladder is gone; every handler is its own session.


Unblocking a PR the user is waiting on should not starve new work, and new work should not starve
it either. A blocked PR often delays several tickets that depend on it.

### The adversarial review runs last and may starve

**Replaced by:** the critic fires on its own event, so nothing can starve it.


A pre-filter for the reviewer is worth only the budget nothing else claims. Every rung above it
serves the reviewer more directly — merging what they approved, fixing what they flagged,
implementing what they green-lit. Reserving a slot for reviews would tax the very work reviews exist
to smooth. On a saturated day, this rung simply does not run. The reviewer reads unreviewed PRs as
they always did, and nothing promised is lost. Starving is the design working as intended.

### Rung 4 writes awaiting when it asks a question

**Replaced by:** `awaiting` has one writer, and it is Actions.


Rung 4 carried two rules that contradicted each other. One forbade touching `labels.awaiting` in
the rung at all. The other, twelve lines below it, required adding the label after a question or a
finding. A run reading them in order had no defined answer, and the 2026-09-05 journal recorded the
clash twice.

Both rules had a real reason, and only one of them survives contact with the event stream. The
prohibition exists because the **human's** comment already fired `issue_comment: created`, so the
state machine cleared `awaiting` seconds later — a run that clears it again is a second writer on a
field an event owns. That reasoning covers clearing the label. It says nothing about setting it.

Setting it is the case the state machine cannot see. `state-machine.yml:194` returns early when the
commenting login sits outside `RESPOND_TO`, and `sydevs-bot` does, so the loop's own reply fires no
transition at all. Nothing re-raises the label the human's comment cleared. Without a write here the
ticket ends the run needing a human and carrying no signal that it does. That is the same shape as
the loop's other `awaiting` writes: a dead end no event sees.

So the prohibition narrows to `Stage`, and the label write stays. The alternative — deleting the
label write — was rejected because it makes the loop ask a question into silence.

### Selection favours new work and blockers

**Replaced by:** nothing selects work; a human's verb does.


Rung 3 ordered by oldest `updatedAt` until 2026-09-07. That key carried two faults.

`updatedAt` is not a fact about the ticket. A field write, a label change, or a bulk metadata pass
bumps it, so the queue reorders itself when nobody touches the work. One backfill of Type and
Priority bumped 22 tickets in a single pass on 2026-09-07. `createdAt` never moves, so it replaces
it.

Oldest-first also worked the backlog from the bottom. A ticket filed today describes the code as it
stands. A ticket filed four months ago describes code that moved since, and a run that starts it
spends its budget on re-deriving the difference. Newest-first reads the freshest evidence.

A blocker rises only inside its own `Priority` band. Letting it rise further is the other
defensible design, and the reviewer rejected it on 2026-09-07: a `Low` blocker of another `Low`
ticket would then outrank an unrelated `High`, and `Priority` would stop measuring consequence.

That choice has a cost, and the cost is real. A `Low` blocker of a `High` ticket waits while any
`Medium` waits, so the `High` behind it stalls. The fix is to raise the blocker's own `Priority`.
That is a reviewer decision, and the field then shows it.

### Derive the window from comment timestamps

**Replaced by:** there is no run window; an event carries its own item.


A field write, a label change, or a bulk metadata pass all bump `updated_at`, even when nobody said
anything. One migration made all 38 open issues look like fresh feedback, on 2026-08-28.

### Blocked always carries a Hold Until

**Replaced by:** a park is the `Hold Until` field, and a blocker is a relationship.


Three journals in a row called a ticket "blocked" after its blocker had already merged.

A block with no re-check date is not parked. It is lost. Nothing brings it back except a human
happening to re-read it. `Hold Until` is the promise to look again, and the date makes that promise
checkable.

This is also why a held item stays *invisible*, not merely skipped. Listing it in the board's
`awaiting` view would ask for attention that was deliberately deferred, and a queue full of things
nobody can act on is a queue people stop reading.

### Unblocking never restores Implement

**Replaced by:** a recheck session decides whether the block lifted. Only an `implement` given
before the block starts the build afterwards, and only a human gave it.


A single-select field cannot remember its previous value, and nothing available to a routine can
reconstruct it. No MCP tool reads an issue timeline, and the REST timeline event for a field change
carries an actor and a timestamp, but no field name and no old value. So the prior `Stage` gets
written into the `Blocked by:` body marker as `(was: X)` — the same trick, for the same reason, that
mirrors the relationship there in the first place.

Restoring that value verbatim is right for every case but one. A blocker usually changes the shape
of the work it was blocking. An `Implement` restored automatically would let the loop write code
against a ticket no human has re-read since the situation changed, which is the one thing this whole
gate exists to prevent. So `Implement` reverts to `Revising` instead, and the reviewer re-approves.

### A PR's assignee is a record, never a signal

**Replaced by:** no assignee means anything now.


Rungs find the loop's PRs with `author:<bot>`. Nothing reads the assignee on a PR the bot wrote, so
for a long time nothing wrote it either, and the field sat empty. That was defensible and it read as
broken — a queue of PRs with no owner, in a UI whose every other row has one.

The state machine now assigns the bot to its own PR, **once, on `opened`**. It is bookkeeping. No
rung may start reading it, or authorship and assignment become two answers to one question, which
is the failure `#the-state-machine-is-not-the-loops-job` describes.

**Once is the whole rule.** On a PR the bot did not write, the assignee means the opposite thing —
a human handing the loop that work — and removing it is the kill switch. Re-asserting the
assignment on `reopened` or `synchronize` would undo a deliberate removal on the next push, so a
kill switch that only holds until the author pushes is not a kill switch. `opened` fires once in a
PR's life, which is why it is the only safe place for this write.

### Mark the PR ready despite unsettled CI

**Replaced by:** Actions marks a PR ready, and only on green.


A PR with an uncertain CI status is still *someone's*. A PR left in draft disappears from the system
entirely — the reviewer's queue is built from `draft:false`, so nobody is waiting on it, and nobody
knows it exists.

Marking it ready, with a note like "CI unsettled after N polls, last seen lint green," gives the
reviewer a fact they can act on. Leaving it in draft gives them silence, and silence is
indistinguishable from the run having crashed.

---

# implement-ticket

### Assignment alone is not the implementation gate

**Replaced by:** the gate is a `respondTo` human's verb.


At backfill time, four tickets already had open PRs closing them. All four would have been
re-implemented, had assignment alone been the gate. Assignment shows none of an open blocker, an
in-flight PR, or a live `Hold Until`, which is why each gets its own row.

Assignment answers one question — *is this the loop's to touch* — and it answers that well
precisely because it answers nothing else.

### Fetch fields only where a search answered

**Replaced by:** there is no census to fetch fields for.


Issue fields are readable but not searchable, so the census fetches a whole repo's issues to see
`Stage` at all. That call is unavoidable. Making it five times a run is not.

The searches above it already name every repo with a candidate. A repo none of them named holds
nothing to attach a field to, so its response — 8 to 29 KB, measured on 2026-09-07 — is read,
carried through the rest of the run's context, and used for nothing.

Four consecutive runs that day (12:05 to 15:04) stopped at `wipCapPerRepo` with no work to start.
Each paid for all five.

### The state machine is not the loop's job

**Replaced by:** the state machine is deleted; the dispatcher owns every mechanical write.


Almost every state write the loop used to make was **mechanical**. An event determined it, with no
judgment involved. But the loop made them late, up to eight hours late, and could forget them.
`stateMachine.workflow` makes them from the event instead, within seconds, and cannot forget.

The prize is larger than punctuality. Every *"as your final action, reassign / set Stage"* rule left
the skills entirely, taking with it a whole class of instruction that was only ever bookkeeping.
What remains in the skills is judgment: choosing a `Hold Until` date, deciding a block has lifted,
revoking `Implement`, deciding the work is done. Those need a model. Setting `Implemented` because a
PR opened does not.

The split is a rule, not a preference: **if an event determines the answer, the workflow owns it.**
Two writers racing on one field means the loser's write is silent.

Recursion is bounded by idempotency, not by an actor guard. Every writer in the workflow reads
current state first, and returns early when it already matches, so a write that re-fires
`field_added` costs one free no-op run. An actor guard was tried first, and it was wrong: the bot
authors its own issues and PRs, so `github.actor != 'sydevs-bot'` would skip exactly the transitions
that matter most.

One author guard survived that lesson, inverted, and cost the same thing. `issues: opened` set
`Stage: Proposed` and `awaiting` only when the **bot** filed the issue, so a ticket filed from a
local session, from the GitHub UI, or by an outside contributor landed with an empty `Stage` and no
`awaiting`. It was invisible on the board and absent from the one view that answers "what needs me".
The skills patched around it: `file-ticket`, `implement-roadmap` and `implement-ticket` each carried
a paragraph telling a local run to write that state itself, which is the two-writers shape this
whole anchor exists to forbid. The event is the same event whoever fires it, so the rule is now
about the event alone. `BOT` still names whose PR or assignment an event describes. It no longer
decides whether a rule applies.

`awaiting` is the one label the state machine still maintains, and the only one of six retired
labels to survive. `Stage` and `Hold Until` cover ticket state, but `awaiting` marks *whose turn it
is* — a different fact, with two properties no field supplies: it spans issues and pull requests (a
PR shows an empty `Stage` cell forever), and it is searchable, where `field.<name>:<value>` returns
zero through REST (`#issue-fields-are-not-searchable`). It stays a boolean on purpose. Sub-labels
such as `awaiting:review` were considered and rejected, since a boolean cannot contradict itself, and
the *kind* of attention is already legible from where the item sits.

The state machine clears `awaiting` on any `respondTo` human's comment or review, within seconds, so
it cannot outlive the reply that answered it. The loop itself still adds it for the dead-end cases no
event expresses, among them: CI red past `ciFixIterations`, a conflict it could not rebase, a thread
it rebutted rather than adopted, and an investigation that ended with a finding.

Two transitions were missing from the first draft, both failing silently rather than loudly.
`synchronize` is the revision handover. Pushing a fix after `changes_requested` returns the turn to
the reviewer, but no other event says so, so an unguarded rule would leave a revised PR
unlabelled forever. It is guarded on the reviewer's latest review still reading `CHANGES_REQUESTED`,
so an ordinary mid-work push does not flag a PR nobody is waiting on. (The loop found this gap
itself, in `sydevs/claude-workflow#42`.) And approval is gated on `assignment.reviewer`, never on
`respondTo` — the same allowlist that `reviewDecisionFrom` applies in the merge gate
(`#only-the-reviewers-approval-counts`), enforced at both sites where an approval is read. The
nightly drift sweep is the backstop, and it journals every correction it makes.

### Do not pin the journal

**Replaced by:** the journal is found by a body marker, not by position.


`pinIssue` is GraphQL-only, and a routine session's GraphQL serves only PR-review operations, so the
call cannot succeed. Recency does the job instead. The day's journal is the most recently active
`ops-journal` issue, so it sorts to the top of the issue list on its own.

### Correcting an earlier claim

**Replaced by:** the journal is comments, and a comment is never rewritten.


The MCP surface **cannot edit a comment, but it can edit a body.** That asymmetry is what keeps the
rolling summary always current, with no addendum machinery needed.

So correcting an earlier claim needs no addendum. Fix it in the body, where the reader looks. The
comment stays as the historical record of what that run believed at the time — which is what a log
is for. The record then has one authoritative surface, even though its entries stay immutable.
Someone catching up reads the body, not eight comments in sequence.
