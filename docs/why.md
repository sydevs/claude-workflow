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

# The runs — work-routine, survey-routine, preflight, journal

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

## You cannot detect having been blocked

An approval prompt in an unattended run does not fail. It **waits, invisibly**, and the run resumes
with no memory of the gap. One WeMeditateWeb run lost about 75 minutes this way, against Claude
Code's Protected Paths guard. So when wall-clock time jumps, being blocked *is* the explanation. Do
not look for a second one.

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

## Rung 2 competes for the same budget

Unblocking a PR the user is waiting on should not starve new work, and new work should not starve
it either. A blocked PR often delays several tickets that depend on it.

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
`preflight`, `triage-issue`, and `implement-issue`, rather than something inferred from an ownership
table.

## Blocked always carries a Hold Until

Three journals in a row called a ticket "blocked" after its blocker had already merged.

A block with no re-check date is not parked. It is lost. Nothing brings it back except a human
happening to re-read it. `Hold Until` is the promise to look again, and the date makes that promise
checkable.

This is also why a held item stays *invisible*, not merely skipped. Listing it in the board's
`awaiting` view would ask for attention that was deliberately deferred, and a queue full of things
nobody can act on is a queue people stop reading.

## Unblocking never restores Implement

A single-select field cannot remember its previous value, and nothing available to a routine can
reconstruct it. No MCP tool reads an issue timeline, and the REST timeline event for a field change
carries an actor and a timestamp, but no field name and no old value. So the prior `Stage` gets
written into the `Blocked by:` body marker as `(was: X)` — the same trick, for the same reason, that
mirrors the relationship there in the first place.

Restoring that value verbatim is right for every case but one. A blocker usually changes the shape
of the work it was blocking. An `Implement` restored automatically would let the loop write code
against a ticket no human has re-read since the situation changed, which is the one thing this whole
gate exists to prevent. So `Implement` reverts to `Revising` instead, and the reviewer re-approves.

## Derive the window from comment timestamps

A field write, a label change, or a bulk metadata pass all bump `updated_at`, even when nobody said
anything. One migration made all 38 open issues look like fresh feedback, on 2026-08-28.

## Selection favours new work and blockers

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

## A request in prose is not permission

The middle row of the rung-4 table fails quietly. A comment asking for work reads like permission to
do it. It is not. `Stage: Implement` is the gate. A request in prose asks to *scope* the work, not
to start it.

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

## Do not pin the journal

`pinIssue` is GraphQL-only, and a routine session's GraphQL serves only PR-review operations, so the
call cannot succeed. Recency does the job instead. The day's journal is the most recently active
`ops-journal` issue, so it sorts to the top of the issue list on its own.

## Correcting an earlier claim

The MCP surface **cannot edit a comment, but it can edit a body.** That asymmetry is what keeps the
rolling summary always current, with no addendum machinery needed.

So correcting an earlier claim needs no addendum. Fix it in the body, where the reader looks. The
comment stays as the historical record of what that run believed at the time — which is what a log
is for. The record then has one authoritative surface, even though its entries stay immutable.
Someone catching up reads the body, not eight comments in sequence.

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

## The survey routine is not a ladder

The two routines diverged on purpose — the survey was split out so a busy queue could never starve
it. But for a while, both still shared one skill file and one rung numbering. That numbering implied
a ladder no run ever descended. The nightly run executed "rung 6" without climbing rungs 1 through
5. The loop run stepped over 6 on its way to 7. The shared bookends, preflight and journal, carried
rung numbers despite being steps of nothing.

The cost was concrete. Inserting one loop rung forced a renumbering sweep across four files, for a
nightly run that had not changed. And the nightly run's spec silently dropped preflight — identity,
auth, ceilings — because "rung 0" read as the ladder's business, not every run's. So the runs are
now two skills over shared bookends, and **rung means one thing**: a step of the loop run's ladder.

## The adversarial review runs last and may starve

A pre-filter for the reviewer is worth only the budget nothing else claims. Every rung above it
serves the reviewer more directly — merging what they approved, fixing what they flagged,
implementing what they green-lit. Reserving a slot for reviews would tax the very work reviews exist
to smooth. On a saturated day, this rung simply does not run. The reviewer reads unreviewed PRs as
they always did, and nothing promised is lost. Starving is the design working as intended.

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
and runs *before* `permissions.allow`, so an unattended run stalls there forever, unable to even
perceive it is blocked. That is why the guides are nested `AGENTS.md` files, each with a `CLAUDE.md`
symlink beside it — they load when Claude reads files in that directory, and stay freely editable.

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

The org project (`projects.url`) shows every open issue grouped by `Stage`, every PR in a `Status`
lane, and `labels.awaiting` on anything needing a human. The loop neither reads nor writes any of
it. Three measured facts force that shape:

- **Project views render org issue fields directly.** A board grouped by `Stage` updates the moment
  the field is written. Nothing needs to sync, so nothing can drift.
- **Routines cannot reach Projects v2 at all.** Probed live on 2026-09-03: zero
  `mcp__github__projects*` tools resolve in the routine environment. The board could not be
  load-bearing, even if we wanted it to be.
- **The one project-native field, PR `Status`, is written only by GitHub's built-in workflows**, and
  read only by humans. If the loop read it, `#search-lags-the-review-that-feeds-it` would apply in
  full — a derived surface lags the event, and the loop reads sources instead.

This is also why the journal dropped its `📋 Awaiting you` table. The board answers "what needs me"
continuously and cannot go stale, so restating it every run was a second implementation of one rule
— exactly the failure this repo exists to avoid. The journal instead keeps what the board cannot
show: why a run failed, what a ceiling cost, which rule misfired.

## The state machine is not the loop's job

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
The skills patched around it: `draft-ticket`, `cross-repo-issue` and `implement-issue` each carried
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

Bodies stay unbudgeted on purpose. They are state, and the grounding rule reads them instead of the
thread.

## Ground from the body, never the thread

`triage-issue` has always said, *"comments are conversation; the body is state."* Nothing enforced
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

## A PR's assignee is a record, never a signal

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

## Mark the PR ready despite unsettled CI

A PR with an uncertain CI status is still *someone's*. A PR left in draft disappears from the system
entirely — the reviewer's queue is built from `draft:false`, so nobody is waiting on it, and nobody
knows it exists.

Marking it ready, with a note like "CI unsettled after N polls, last seen lint green," gives the
reviewer a fact they can act on. Leaving it in draft gives them silence, and silence is
indistinguishable from the run having crashed.

---

# implement-issue

## Assignment alone is not the implementation gate

At backfill time, four tickets already had open PRs closing them. All four would have been
re-implemented, had assignment alone been the gate. Assignment shows none of an open blocker, an
in-flight PR, or a live `Hold Until`, which is why each gets its own row.

Assignment answers one question — *is this the loop's to touch* — and it answers that well
precisely because it answers nothing else.

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
reflection found the cause was not judgment. The loaded `draft-ticket` was commit `864e72e`, the
repo's **first** commit, pinned at install on 2026-08-27. It ran 53 commits behind a `main` that
had since grown `triage-issue`, the native issue fields, and `Stage` itself, so the skill it ran
genuinely ended at "create the issue, return the URL." Twelve of the seventeen skills did not exist
in that cache at all, and the marketplace clone itself sat nine commits behind.

`version` was the only thing that could have invalidated it, and the guide had told every
contributor, explicitly, that `version` did not matter. That is why bumping the manifest is now a
required part of any skill change, not a release ceremony. This repo has no releases. It does have a
cache key, and a cache key that never changes is a cache that never updates.

## Rung 4 writes awaiting when it asks a question

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

The reserve exists because of the second half of that run. A body fitted to the last character
breaks again on the next edit, and the next edit is a timestamp the journal step always writes.
200 characters buys that edit room. It sits in the script rather than `loop-config.json` so the
fix could ship without a ceiling change beside it.

## Fetch fields only where a search answered

Issue fields are readable but not searchable, so the census fetches a whole repo's issues to see
`Stage` at all. That call is unavoidable. Making it five times a run is not.

The searches above it already name every repo with a candidate. A repo none of them named holds
nothing to attach a field to, so its response — 8 to 29 KB, measured on 2026-09-07 — is read,
carried through the rest of the run's context, and used for nothing.

Four consecutive runs that day (12:05 to 15:04) stopped at `wipCapPerRepo` with no work to start.
Each paid for all five.

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

## The lock label is the lease

Two sessions on one item write over each other, and neither can tell. GitHub offers no
compare-and-swap. What it offers is a label the dispatcher applies before it fires and the
session removes as its last write. While the label is on, the dispatcher fires nothing else at
that item and records any new event as a recheck. When the label comes off, that event is the
handoff: the dispatcher re-derives from live state and dispatches whatever is pending.

One label, `bot:working`, serves issues and PRs alike. A field cannot: a PR has none. The handler
name, the attempt and the session link live in a status comment the dispatcher edits. The session
reads the label before its first write and before every push. Gone means stop. The sweeper
removes a label whose session passed its deadline, so a dead session holds nothing forever.

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

The cost is one model and one tool grant per repo rather than per handler. `answer` runs on the
same Opus as `implement`, five to eight turns. The rule that `answer` never pushes is a skill
rule now, not a routine grant; the lock label and the dispatcher's actor filter were always the
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
carries the `0`, `payload.mjs` accepts it, and `handler-journal` finds or creates today's issue
itself — the same path the nightly survey already takes, with no record at all.

The pattern is the same as the board's, and worth stating once for anything the dispatcher
writes: **the fire is the work, and everything else is bookkeeping around it.** Bookkeeping that
fails should be visible and should not be fatal. A run that never started leaves nothing to
notice.
