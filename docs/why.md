# Why each rule exists

The rules live in the skills. **This file holds the failure that produced each one**, and nothing
else — no rule appears here that is not already stated as an imperative in a `SKILL.md`.

The split is deliberate. `work-routine/SKILL.md` is read fresh on every run, roughly eleven times a day
across five repos; length there costs tokens on every run *and* dilutes the rules it carries. But a
rule with no story behind it is a rule a model talks itself out of when it meets a case the wording
did not anticipate. So the story keeps its place — one hop away, cited from the rule as
`(why: docs/why.md#anchor)`.

**Read an entry when a rule seems not to fit the case in front of you — never to decide whether to
follow it.** If the story and the imperative ever disagree, the imperative wins and the discrepancy
is a bug in this file.

This file lives in the `sydevs/claude-workflow` checkout, beside `loop-config.json`.

---

# The runs — work-routine, survey-routine, preflight, journal

## The routine prompt is not the specification

The two scheduled routine prompts are set through an API, not stored as files in this repo, so they
cannot be reviewed in a PR and cannot be diffed against the skills. For a while they restated about
a dozen of `work-routine`'s hard rules "for safety". That duplication has gone stale twice:

- a prompt referred to a `journalIssue` config key months after it was deleted from
  `loop-config.json` and replaced by the `journal` object;
- a prompt kept instructing the run to unsubscribe from PR activity in a form the skill had since
  changed, so the run followed a rule that no longer existed.

Neither divergence was visible from inside this repo, and neither produced an error — a run simply
followed the stale copy. Precedence has to be stated somewhere a run can read it, and the only such
place is the skill itself.

## Never improvise around a missing credential

An agent that guesses when it lacks data is worse than one that does nothing: the guess is
indistinguishable from a measurement in everything it writes afterwards, and the journal is the only
record anyone reads.

## Report anomalies; do not explain them

Four separate runs have now reasoned soundly from an unmeasured premise:

- a permission refusal read as absence;
- an MCP readback read as a failed write;
- a rendered page read as an uncollapsed `<details>` block;
- a time gap read as clock skew.

Each explanation was coherent, detailed, and wrong. All four read as measured fact in the journal.
Diagnosis of the harness is a human's job, and a harness theory that becomes the stated evidence for
a code change puts a wrong premise into `main`.

## You cannot detect having been blocked

An approval prompt in an unattended run does not fail — it **waits, invisibly**, and the run resumes
with no memory of the gap. One WeMeditateWeb run burned about 75 minutes that way against Claude
Code's Protected Paths guard. So when wall-clock time appears to have jumped, being blocked *is* the
explanation, and there is no need to reach for a second one.

Wake events carry an authoritative `current-time` in GitHub's own frame, which is why it is preferred
over the local clock for anything compared against a GitHub timestamp.

## Titles yes, bodies no

Titles are what make the backlog legible — to the run while it is deciding, and to the reader of the
journal — and they cost almost nothing. Bodies are the expensive part, and reading the whole backlog
every run is the single largest avoidable cost in this system.

## The ops-journal exclusion is mandatory

`claude-workflow` is both a repo the loop works on *and* the home of the journal. Without
`-label:ops-journal` on every worklist query, the loop reads its own diary as a backlog item: an
entry that mentions a ticket becomes a ticket, and each run's entry looks like fresh activity to the
next run. The failure compounds rather than showing up once.

An HTML-escaped `&gt;` in a search qualifier is accepted without error and returns **zero results** —
a silently-empty search that reads as "nothing to do".

## CI truth lives in check runs

Rung 1 read CI with `get_status` alone for the loop's first week. That call returns commit statuses,
and no repo here posts a commit status for its tests — GitHub Actions reports as check runs, a
separate surface `get_status` cannot see. Measured on two live PRs on 2 September, it was wrong in
both directions at once:

- **sydevs/SahajAtlasWeb#181** — `get_status` returned `state: "pending"`, `total_count: 0`,
  `statuses: []`, while `get_check_runs` returned five check runs all `conclusion: "success"`. A
  fully green PR that the loop would have called "still running" on every run, forever.
- **sydevs/SahajCloud#672** — `get_status` returned one status, `success`: Railway's deploy
  (`context: "sahajcloud - SahajCloud"`, `created_at: 21:14:17Z`). The test job, `Lint, Test &
  Smoke`, is a check run that did not complete until `21:31:40Z`. For those seventeen minutes the
  gate said green while the tests were still running.

The second is the one that matters. A rung-1 run waking in that window on an approved PR would have
merged untested code **while following the skill exactly** — the failure mode a safety gate exists to
make impossible.

The "at least one check run" clause was added at the same time and is not decoration: a merge
conflict makes GitHub schedule zero workflow runs, so `check_runs` comes back empty. Without the
clause, "every check run succeeded" is vacuously true of nothing and a conflicted PR reads as green.
The mirror-image clause for statuses is deliberately absent — a repo with no deploy integration
legitimately has none.

`skipped` and `neutral` count as passing because a strict `conclusion == "success"` test would
reproduce the SahajAtlasWeb failure one level down: a conditionally-skipped job would read as
not-green forever, and the loop would comment on a healthy PR on every run rather than merging it.
Whether a skip is *legitimate* is CI's own problem, and the repos already solve it — SahajAtlasWeb's
smoke lane fails a same-repo PR outright rather than skipping quietly, precisely so that a skip on
that job cannot be mistaken for a pass.

## Never subscribe to PR activity

Declining to call `subscribe_pr_activity` is not sufficient. **Opening a PR auto-subscribes the
session**: a `subscription.created` event with `from="system"`, at PR-open time, before the run does
anything else. That was measured, not assumed, after the skill claimed otherwise. So a run can be
woken having never subscribed, and fighting it is not an option — tolerating it is.

The subscription is also not the only thing that can let GitHub reach a finished run, and a run
cannot end its own session: sessions were observed `active` a full day after their work completed,
including ones that unsubscribed exactly as instructed. So the subscription, not the session, is the
part we control.

**The baton is the backstop, and it is why this is now safe.** A woken session's first act is to
re-derive the worklist from `assignee:sydevs-bot` — and the item it was working on has been handed
back to the reviewer, so it finds nothing and exits. Under the old timestamp census a woken session
would have seen fresh `updated_at` values and found real work to do. Handing back the baton is what
makes re-entry a no-op.

## Rung 2 competes for the same budget

Unblocking a PR the user is waiting on should neither starve new work nor be starved by it — a
blocked PR often holds up several tickets behind it.

## You cannot push to a human's PR

A cloud session may only push to `claude/*`, and a human's branch additionally carries their commits
and backs their open PR. That is two of the three rejection conditions at once, which is why this is
a wall rather than a permission worth asking for. A silent push would also leave the reviewer
re-deriving what changed, which is the reason each thread gets its own reply.

A stacked PR based on their branch is one click for them to merge, and their PR updates. Based on
`main` by mistake, it shows every commit of theirs as part of your diff, and is unreviewable.

## An investigation must not be forced into a PR

Filing an empty PR to satisfy the shape of the pipeline is worse than no PR: it costs a review slot
and buries the actual answer in a description. The pipeline serves the work, not the reverse.

## respondTo is an allowlist

Having its own account is what first let the loop tell feedback from its own writing — replying to
itself burns the reply ceiling and produces a thread that argues with itself. But *"the author is
not me"* is a blocklist with one entry, and it fails open on everything nobody has met yet.

The measurement: of the 200 most recent issue comments across SahajCloud and SahajAtlasWeb, 100 were
`Ardnived`, **93 were `cloudflare-workers-and-pages[bot]`**, and 7 were `antontcymbal`. Under a
"not me" test the preview-URL bot would have been the single largest source of work in the system,
and every new integration would silently add more.

`assignment.respondTo` names the logins whose comments are feedback, so an unknown author is inert
by default. It is also the extension point: adopting a reviewing bot such as Copilot is one entry in
`loop-config.json` rather than a change to any skill.

## Issue fields are not searchable

`Stage` and `Hold Until` are read on every run, and neither can ever appear in a query.

GitHub documents a `field.<name>:<value>` search qualifier, and it works — in the web UI, which
runs on GraphQL. Through the REST search endpoint, the only search a routine can reach, it is
**accepted without error and matches nothing**. Measured against `sydevs/SahajCloud`:
`field.priority:high` returned 0 where an issue with `Priority: High` demonstrably exists, and the
control query returned 24. The negation returned 0 too, which is the tell — a working qualifier
cannot have both a term and its negation empty.

This is the same failure shape as an HTML-escaped `&gt;` in a query: silence, not an error. So every
worklist query is built from indexed qualifiers only (`assignee:`, `author:`, `is:pr`, `draft:`,
`review:`), and field values are attached afterwards from `list_issues(fields:["field_values"])` —
one call per repo, five in total, which is cheaper than the census this replaced.

## The loop may never write Implement

The property that makes the loop safe to leave running is that **it cannot authorise its own code**.

That used to be the `ready-to-implement` label; it is now `Stage: Implement`. The mechanism changed
and the risk did not, so the asymmetry moved across intact: the loop may move a ticket *off*
`Implement`, never onto it. Revoking can only ever reduce its own autonomy, which is why revoking is
safe and granting never is.

The danger of the field version is that the loop legitimately writes four other `Stage` values, so
the write is a habit rather than an exception. Hence the rule is stated as a bare imperative in
`preflight`, `triage-issue` and `implement-issue` rather than inferred from the ownership table.

## Blocked always carries a Hold Until

Three consecutive journals described a ticket as "blocked" whose blocker had already merged.

A block with no re-check date is not parked, it is lost: nothing brings it back, and the only thing
that would is a human happening to re-read it. `Hold Until` is the promise to look again, and the
date is what makes the promise checkable.

It is also why a held item is *invisible* rather than merely skipped. Listing it under
the board's `awaiting` view asks for attention that was explicitly deferred, and a queue that lists
things you cannot act on is a queue people stop reading.

## Unblocking never restores Implement

A single-select field cannot remember its previous value, and nothing available to a routine can
reconstruct it: no MCP tool reads an issue timeline, and the REST timeline event for a field change
carries an actor and a timestamp but no field name and no old value. So the prior `Stage` is written
into the `Blocked by:` body marker as `(was: X)` — the same trick, for the same reason, as mirroring
the relationship there in the first place.

Restoring it verbatim is right for every value but one. A blocker usually changes the shape of the
work it was blocking, so an `Implement` restored automatically would let the loop write code against
a ticket no human has re-read since the situation changed — which is the one thing the whole gate
exists to prevent. `Implement` therefore comes back as `Revising`, and the reviewer re-approves.

## Derive the window from comment timestamps

A field write, a label change or a bulk metadata pass all bump `updated_at` without anyone having
said anything. A single migration made all 38 open issues look like fresh feedback on 2026-08-28.

## A request in prose is not permission

The middle row of the rung-4 table is the one that goes wrong quietly: a comment asking for work
reads like permission to do it, and it is not. `Stage: Implement` is the gate — a request in prose
is a request to *scope* the work, not to start it.

## Every claim names the call that produced it

Building the old `📋 Awaiting you` table from a live query rather than from memory fixed a real divergence between
what a run narrated and what GitHub actually held. The general form of that fix is this rule.

Two runs produced confident, detailed, **wrong** claims that read as measured fact:

- a fabricated clock skew, reasoned from an unexplained time gap;
- a conclusion that `<details>` blocks were stripped on write, reasoned from an MCP readback.

Both would have been caught by having to name the call: neither claim had one, and writing "inferred
from" in front of either would have made it visible as a theory. A journal that mixes measurement and
inference without marking which is which is worse than a shorter journal, because the reader cannot
tell where to apply scepticism.

## The journal day is a local date

Keying to UTC splits a local day across two issues — the nightly run creates the issue at 1am
Vancouver, which is 08:00Z, so the UTC date matches only by coincidence. Creation time is intrinsic
and cannot drift from the truth, which is why there is no date field to set or read.

## Do not pin the journal

`pinIssue` is GraphQL-only and a routine session's GraphQL serves only PR-review operations, so the
call cannot succeed. Recency does the job instead: the day's journal is the most recently active
`ops-journal` issue, so it sorts to the top of the issue list on its own.

## The body is rewritten, not appended

The MCP surface **cannot edit a comment, but it can edit a body.** That asymmetry is what makes the
rolling summary always current without any addendum machinery.

## Correcting an earlier claim

Correcting an earlier claim no longer needs an addendum: fix it in the body, where the reader looks.
The comment stays as the historical record of what that run believed at the time, which is what a log
is for. That gives the record one authoritative surface even though the entries themselves are
immutable — someone catching up reads the body, not eight comments in sequence.

## details survives the write path

Writes are stored intact and render collapsed. REST (`gh api`) shows every tag: 8 pairs in a PR body,
2 in a journal comment, verified 2026-08-31. But the MCP *read* path strips `<details>`/`<summary>`
from what it returns — in the same responses where `<table>`, `<a>` and `<sub>` come back verbatim.

One run concluded "the write path drops them" from exactly this evidence and wrote a long case for
it. The evidence was real; the inference was wrong at the read layer, not the write layer.

## Sessions linger

`persist_session: false` governs whether the *next* fire reuses a session, not whether this one dies.
Lingering is the platform's behaviour, not a fault to work around.

## The survey routine is not a ladder

The two routines diverged — the survey was split out precisely so a busy queue could not starve
it — but for a while both kept sharing one skill file and one rung numbering. That numbering
implied a ladder no run ever descended: the nightly run executed "rung 6" without climbing rungs
1–5, the loop run stepped over 6 on its way to 7, and the shared bookends (preflight, journal)
wore rung numbers despite being priority steps of nothing. The costs were concrete: inserting one
loop rung forced a renumbering sweep across four files for a nightly run that had not changed, and
the nightly run's spec silently omitted preflight — identity, auth, ceilings — because "rung 0"
read as the ladder's business rather than every run's. So the runs are now two skills over shared
bookends, and **rung means one thing**: a step of the loop run's ladder.

## The adversarial review runs last and may starve

A pre-filter for the reviewer is worth exactly the budget nothing else claimed. Every rung above it
serves the reviewer more directly — merging what they approved, fixing what they flagged,
implementing what they green-lit — so reserving a slot for reviews would tax the very work the
reviews exist to smooth. On a saturated day the rung goes without, the reviewer reads unreviewed
PRs as they always did, and nothing is lost that was ever promised. Starving is the design working.

## One review per PR, ever

A bot that re-reviews argues with itself across revisions and doubles the reviewer's reading — the
second opinion of the same critic is noise, and the human is the approver anyway, so revision
quality gets its judgement at approval time. Ever-once also makes the rung cheap to make idempotent:
the key is an existing own-login review read directly from GitHub just before writing, never search
(a derived index that lags) and never memory (a crashed run has none).

## Reviews are COMMENT-only

Two reasons, one mechanical and one about authority. GitHub rejects `APPROVE` and `REQUEST_CHANGES`
on your own pull request, and the loop authors the PRs it reviews. And even where the API would
allow it, an approving bot review could be read — by a human skimming, or by a future rule — as
merge authority, which belongs to the reviewer's approving review alone.

## The author filter's one exception

The filter (why: #filter-feedback-by-author) exists so the loop never treats its own words as
instructions. The adversarial review is the one deliberately self-addressed artifact in the system,
so it needs a key the filter can honour without a carve-out swallowing the rule: **comment type
plus thread root**. GitHub already separates review threads from conversation comments, and the
loop starts review threads in exactly one place — so "unresolved thread rooted by the own login"
identifies the adversarial review with no marker string to drift, leak, or forget. The invariant
that holds this together is exclusivity: the moment any other rung starts a review thread, the key
stops meaning anything, which is why starting one is rung 5's exclusive privilege.

## The review never shares the implementer's context

A critic that inherits the builder's reasoning inherits its blind spots — the assumptions that made
a bug invisible while writing it make the same bug invisible while reviewing it, and a session that
just argued a design into existence cannot be adversarial toward it. A fresh subagent with an empty
context, handed nothing but the PR's coordinates, is the closest available thing to independent
eyes. The isolation is also why PRs opened earlier in the same run are eligible: waiting a run was
only ever a proxy for fresh eyes, and the subagent is the real thing.

## The reviewer profile is the learning surface

The skill is read on every review, so it must stay short, stable, and philosophical; taste accretes
instead in a document the Sunday reflection can edit ticketlessly. The profile was seeded from the
full backfilled history of the reviewer's review comments across the five repos and shipped in the
PR that introduced the rung — the reviewer correcting their own portrait in that review was its
first calibration pass.

---

# finalize-pr

## simplify fans out

`/simplify` edits the working tree, and its fixes can land minutes after dispatch, well after its
first message. Editing the same files in parallel makes a patch fail an assertion or a file read back
unexpectedly — and the first suspicion is always a corrupted edit rather than a second writer.

## A clean review report must carry its evidence

An empty result is harder to notice than a wrong one: nothing about it looks like a failure. A
reviewer returned "no correctness bugs, production ready" after a **single tool call** over a
~2,800-line diff. A manual re-read then found a relationship's stored order being silently dropped,
so `og:image` unfurled the wrong photo.

## Documentation lives outside .claude/

Writes under `.claude/` hit Claude Code's Protected Paths guard, which requires interactive approval
and runs *before* `permissions.allow` — so an unattended run stalls there indefinitely and cannot even
perceive that it is blocked. That is why the guides are nested `AGENTS.md` files (with a `CLAUDE.md`
symlink beside each), which load when Claude reads files in that directory and are freely editable.

## Contract surfaces are mandatory

`docs/embedding.md` and `CHANGELOG.md` are the only documents an embedding site ever reads, and the
SahajAtlasWeb README once spent months telling hosts to load a filename the build had never emitted.

References to guide paths also hide in `.env`, CSS, test files and `.distignore`, so a docs sweep
restricted to markdown leaves links pointing at deleted files.

## Link the branch alias, never a commit alias

A commit alias is pinned to the SHA it was built from, so every later push silently strips the body of
its value — a reviewer opening it sees old code and has no way to tell. #181 carried links three
pushes stale, including one to a component the review had asked be deleted.

**Telling a run this was not enough, twice.** The rule was already written here, and the body was
still fixed and re-broken, the second time with a confident rationale: "these are per-deployment
aliases, so they stay pinned to this commit." That reasoning came from
`get-cloudflare-preview-url.mjs`, whose docblock argues — correctly, for its own consumer — that a
per-deployment alias beats a branch alias because it "names one immutable build." That script feeds
the CI smoke gate, which must test the exact SHA it was handed. The PR body wants the opposite. A run
handed one tool for two requirements will satisfy the one the tool argues for, so the fix is a second
tool, not a firmer instruction.

**And the alias is discovered, not constructed.** Cloudflare labels it — `Branch Preview URL` in both
the Pages check-run summary and the Workers comment — so there is no reason to derive it. The
documented slug rule (non-alphanumerics to `-`, truncate to 28) is a guess about a host we do not own,
and it is not merely fragile at the boundary: two branches agreeing in their first 28 characters
produce one alias, which answers 200 while serving the other branch. A wrong link that 404s is a bad
Preview section; a wrong link that works is a bad review.

## A routine cannot reach the GitHub API

Not "should not" — *cannot*, by any client. Measured in a routine on 2026-09-02:

| Call | Result |
| --- | --- |
| `command -v gh` · `ls /usr/bin/gh` · `find / -name gh -type f` | absent |
| `gh` downloaded and run from `/tmp` | installs fine, `gh version 2.63.2` |
| `gh api repos/<in-session repo>` | **403** — "GitHub access is not enabled for this session" |
| `curl https://api.github.com/repos/…`, with the token **and** without it | **403**, byte-identical |
| `curl https://api.github.com/graphql` | **403** — "only the pinned set of PR-review operations is served" |
| `curl https://api.github.com/user` | **200** |
| `mcp__github__*` | works, scoped to the session's configured repositories |

The mechanism, since knowing it stops the next person re-testing the same dead ends: `api.github.com`
resolves to GitHub's real address but connects to `peer=127.0.0.1`, and the certificate is issued by
`CN=CCR Upstream Proxy CA (staging); O=Anthropic`, trusted through `NODE_EXTRA_CA_CERTS`
(`CCR_AGENT_PROXY_ENABLED`, `CCR_UPSTREAM_PROXY_ENABLED`). It is a TLS-intercepting proxy that
allowlists **by path, regardless of credential** — a deliberately invalid PAT draws the same 403 as
the harness token, under both `Bearer` and `token` schemes, on REST and on GraphQL. **A
self-managed PAT therefore buys nothing**, and defeating the interception is defeating a sandbox
control.

What is NOT gated is everything else: `example.com`, `de.sentry.io`, Railway apps,
`raw.githubusercontent.com` and `codeload.github.com` all answer. Arbitrary HTTPS egress works — which
is how the Sentry and Mailpit rungs already work, and the only route by which a script could ever
reach GitHub state directly (a self-hosted relay holding its own token). That is a real option with a
real cost, not a workaround: it re-grants, under our own credential, access the proxy deliberately
gates.

The community recipe for this (`gh-setup-hooks`, dev.to) installs `gh` and sets `GH_TOKEN` to a
personal token. Its first half works here — `gh` downloads and runs. Its second cannot: the proxy
answers before it considers a credential, so the token is never read. That recipe targets Claude Code
*on the web*, which evidently has a laxer proxy than Routines; it is not wrong, it does not transfer.

**Decided 2026-09-02: we are not building that relay.** The gate that could merge untested code
already works in a routine — the run fetches with MCP, `merge-verdict.mjs` decides — so a relay would
only move counting and formatting into scripts. Against that it means a service to keep alive and a
five-repo PAT living in an environment with no secret store, which would undo the per-session repo
scoping the proxy exists to enforce. A cosmetic win is not worth a standing credential. Revisit only
if the token cost of the census becomes the binding constraint; the finding above is what makes it a
decision rather than an assumption.

The identical 403 with and without an auth header is the part that settles it: the proxy is refusing
the *path*, not the credential, so installing a binary or finding a better token cannot help.
Connecting the **Claude GitHub App for the org** — which is what the 403 itself asks for — was tried
and changed nothing.

**Three different refusals, and the other two are the real ceiling.** They matter more than the first,
because they would survive any widening of repo access:

| Path | Message |
| --- | --- |
| `repos/…` | "GitHub access is not enabled for this session. An org admin must connect the Claude GitHub App" |
| `search/issues` | "sessions are bound to their configured repositories. Use repository-scoped endpoints" |
| `graphql` | "only the pinned set of PR-review operations is served" |

**Search is refused by design, not by configuration** — a session is bound to its repositories, and
search is inherently cross-repository. The loop's worklist *is* a search (`assignee:<bot>` over five
repos), as are the journal counts and the awaiting-you table. So even if `repos/…` opened tomorrow,
those three could not become scripts. Only per-repo reads and pure decisions can.

Two traps in that table. `/user` answering 200 while every `repos/...` path 403s makes the token look
healthy and the repository look missing, when neither is true — and `git` fetch and push work
throughout, because they go through the credential helper rather than the API, which makes a session
feel far more capable than it is.

**The consequence for this plugin: a script never fetches.** It takes data the run already has and
returns a decision. That split is the right one regardless — the merge gate's two failures were never
in the fetching, they were in deciding what the fetched values meant, and that half had no single
home. `docs/routine-setup.md` asserted the opposite for weeks (`gh` "ships in the image,
`/usr/bin/gh`, v2.98.0"), which is exactly the licence needed to write four scripts that pass every
local test and fail silently where it counts.

## Draft is the PR's baton

Tickets carry their state in fields. **Pull requests have no fields at all**, so a PR's state has to
come from something GitHub already models — and `draft` is exactly the right thing: it is one bit,
it is indexed (`draft:true` / `draft:false`), it is visible in every list view, and it already means
"the author is still working on this" to every human who sees it.

The alternative was to keep moving the assignee, which is what this replaced. That cost a hand-back
on every unit of work and then a hand-forward from the reviewer to continue it, and it made
assignment answer two questions at once — *whose is this* and *is it finished* — which is why it was
ambiguous in exactly the cases that mattered.

Two invariants make it work, and both are load-bearing:

- **A PR opens as a draft and is marked ready exactly once.** It never goes back. `draft:false`
  therefore means "has been ready at least once", which is what lets the adversarial review fire
  once and only once.
- **The loop never writes a PR's assignee, at all.** Its own PRs are found by `author:<bot>`, which
  is exact and needs no field. Writing an assignee would only overwrite something the reviewer might
  be using.

That second invariant was learned the hard way. The first migration assigned the bot to every open
PR so that `assignee:<bot>` would find them — which worked, but doubled up with the reviewer's own
assignment on all three and made the field mean two things at once. Authorship was the answer
already sitting there: the loop writes its own PRs, so `author:` identifies them with no write and
no migration.

Leaving the field alone also gives it a use the old model had no room for: **assigning the bot to a
PR it did not write is how a human hands one over**, and unassigning withdraws that. One field, one
direction, read but never written.

## The board is a lens

The org project (`projects.url`) shows every open issue grouped by `Stage`, every PR in a `Status`
lane, and `labels.awaiting` on anything needing a human — and the loop neither reads nor writes any
of it. Three measured facts force that shape:

- **Project views render org issue fields directly.** A board grouped by `Stage` updates the moment
  the field is written. There is nothing to sync, so nothing can drift.
- **Routines cannot reach Projects v2 at all.** Probed live on 2026-09-03 (session
  `cse_0188Trog41g4Zt2j9oQS9crB`): zero `mcp__github__projects*` tools resolve in the routine
  environment. The board could not be load-bearing even if we wanted it to be.
- **The one project-native field, PR `Status`, is written only by GitHub's built-in workflows** and
  read only by humans. If the loop read it, `#search-lags-the-review-that-feeds-it` would apply in
  full: a derived surface lags the event, and the loop reads sources.

This is also why the journal stopped carrying a `📋 Awaiting you` table. The board answers "what
needs me" continuously and cannot go stale; a table restating it every run was a second
implementation of one rule, which is the failure this repo exists to avoid. What the journal keeps
is what the board cannot show: why a run failed, what a ceiling cost, which rule misfired.

## The state machine is not the loop's job

Almost every state write the loop used to make was **mechanical** — an event determined it, no
judgement was involved — and the loop made them late, at up to eight hours' remove, and could
forget. `stateMachine.workflow` makes them from the event instead, within seconds, and cannot
forget.

The prize is larger than punctuality. Every *"as your final action, reassign / set Stage"* rule left
the skills entirely, and with them a whole class of instruction that was only ever bookkeeping. What
remains in the skills is judgement: choosing a `Hold Until` date, deciding a block has lifted,
revoking `Implement`, deciding the work is done. Those need a model. Setting `Implemented` because a
PR opened does not.

The split is a rule, not a preference: **if an event determines the answer, the workflow owns it.**
Two writers on one field race, and the loser's write is silent.

Recursion is bounded by idempotency rather than an actor guard. Every writer in the workflow reads
current state first and returns early when it already matches, so a write that re-fires `field_added`
costs one free no-op run. An actor guard was tried first and was wrong: the bot authors its own
issues and PRs, so `github.actor != 'sydevs-bot'` skips exactly the transitions that matter.

## awaiting is the one label that earns its place

Six labels were retired when `Stage` and `Hold Until` arrived, on the rule that ticket state belongs
in a field. `awaiting` is not ticket state — it is *whose turn it is*, and that is a different fact
with two properties `Stage` cannot supply:

- **It spans issues and pull requests.** Issue fields are issues-only; a PR shows an empty `Stage`
  cell forever. Nothing else can mark both.
- **It is searchable.** `field.<name>:<value>` returns zero through the REST search a routine has
  (`#issue-fields-are-not-searchable`), so no field can ever be a worklist query or a board filter.

It is deliberately a boolean. Sub-labels (`awaiting:review`, `awaiting:merge`) were considered and
rejected: a boolean cannot be self-inconsistent, and the *kind* of attention is already legible from
where the item sits — issues in a `Stage` column, PRs in a `Status` lane.

The staleness it could suffer is answered by who writes it. The state machine clears it on any
`respondTo` human's comment or review, within seconds, so it cannot outlive the reply that answered
it. The four adds the loop still owns are the dead ends no event expresses: CI red past
`ciFixIterations`, a conflict it could not rebase, a thread it rebutted rather than adopted, and an
investigation finished with a finding.

Two transitions were missing from the first draft and are worth naming, because both are silent
failures rather than loud ones. **`synchronize` is the revision handover**: `changes_requested`
clears `awaiting` because the ball is the loop's, and pushing the fix puts it back with the reviewer
— but no other event says so, so a revised PR would have waited unlabelled forever. It is guarded on
the reviewer's latest review still being `CHANGES_REQUESTED`, so ordinary mid-work pushes do not
flag a PR nobody is waiting on. (Found by the loop itself, in `sydevs/claude-workflow#42`, about the
journal query this label replaced — the same gap in a different surface.) And **approval is gated on
`assignment.reviewer`, never on `respondTo`** — the same allowlist, for the same reason, that
`reviewDecisionFrom` applies in the merge gate (`#only-the-reviewers-approval-counts`). One rule,
enforced at both sites where an approval is read. The nightly drift sweep is the backstop, and it journals
every correction, because a silent fix hides a broken workflow.

## hasWorkflows is a filesystem check

`mcp__github__list_workflows` is not in the routine's MCP build. Four consecutive runs journalled
its absence under `⚠️ Failed`, each time for a fact that was sitting on disk the whole time: every
repo in `repos` is cloned into the run before Claude starts, so `.github/workflows/*.yml` answers
`hasWorkflows` exactly, for free, and cannot 403.

The general rule this is an instance of: **when the run already holds the checkout, read the
checkout.** An API call for a fact on disk buys nothing and adds a way to fail. It is also the
reason the failure was harmless — an absent `hasWorkflows` reads as *this repo has CI*, so the gate
stayed closed rather than opening — but a recurring `⚠️ Failed` line trains a reader to skim the
section that exists to be read.

## Search lags the review that feeds it

SahajCloud#679 was approved at 04:45:57Z. At 05:12Z — twenty-six minutes later — rung 1's
`is:pr is:open author:<bot> draft:false review:approved` returned **zero results**. The approval was
real and current: `pull_request_read method:get_reviews` showed `Ardnived` / `APPROVED` against
`51fdbeb`, the head commit. The PR merged that run only because rung 2 read `get_reviews` on it for
an unrelated reason and the run noticed.

**An empty search result is indistinguishable from "nothing qualifies".** That is what makes this
worse than a slow index: the failure is silent, and the loop would have journalled "nothing
qualified for merge" as a measured fact. Approved, green work would have sat for a whole cycle, and
the journal would have said the system was working.

Rung 5 already knew this — *"Search is a derived index and can lag; this read is authoritative"* —
and re-checks `get_reviews` immediately before writing. Rung 1 had no equivalent because
`review:approved` looked like a free filter. It is free; it is just not true yet.

The rule that generalises: **a search qualifier is safe only for facts the loop itself wrote.**
`draft:` is ours, so the index cannot be behind us on it. `review:`, `-reviewed-by:` and
`commenter:` describe other people's writes, and those need an authoritative read before anything
irreversible depends on them.

## Only the reviewer's approval counts

The first draft of rung 1's derivation — written once it was clear no MCP call returns
`reviewDecision` — counted the latest state-bearing review from every login **except our own**. An
adversarial pass on the PR carrying it caught the consequence before it merged: `claude-workflow`,
`SahajCloud`, `SahajAtlasWeb` and `WeMeditateWeb` are all public, so any GitHub account can submit a
review on an open PR in them. One drive-by `APPROVED` from a stranger would have satisfied
`merge-verdict.mjs`, in four repos where a merge is the deploy.

Two things make it worth a heading rather than a fix in silence.

**It was wider than the thing it replaced.** GitHub's own `reviewDecision` is computed against branch
protection and requested reviewers, not "anyone who clicked approve" — so a stand-in that admits
every login is not a stand-in. A derivation replacing a field has to be *narrower* than the field, or
it is a new policy wearing the old one's name.

**Until that PR the gate had never fired.** `reviewDecision` was always absent, so rung 1 held
everything and the permissiveness was invisible: nothing in the loop's history would have shown it,
and no test could have, because the wrong behaviour needed a stranger to appear. The rule that
generalises is the one `preflight` already states about blocklists — *a one-name blocklist of
ourselves fails open on everyone we have not met.* `assignment.reviewer` is where approval authority
is already defined; the allowlist just says so where it is enforced, in `reviewDecisionFrom`.

## A conflicted PR schedules zero CI runs

A conflicted PR has no computable merge commit, so GitHub schedules **zero** workflow runs for it —
silently. The checks list shows only the non-Actions entries (a Railway or Cloudflare deploy still
happens, since those build the branch head) and the run list is simply empty. It reads as a stuck
scheduler, and waiting is futile.

A run that predates the base moving is stale, and makes a conflicted PR look tested.

## Hand the baton back even with CI unsettled

A PR with an uncertain CI status is still *someone's*. A PR left in draft has fallen out of the
system entirely: the reviewer's queue is built from `draft:false`, so nobody is waiting on it and
nobody knows it exists.

Marking it ready with "CI unsettled after N polls, last seen lint green" is a fact the reviewer can
act on. Leaving it in draft is silence, and silence is indistinguishable from the run having
crashed.

---

# implement-issue

## Assignment alone is not the implementation gate

At backfill time four tickets had open PRs closing them, and all four would have been re-implemented
had assignment alone been the gate. Neither an open blocker, an in-flight PR, nor a live `Hold Until`
is visible through assignment, which is why they are separate rows.

Assignment answers one question — *is this the loop's to touch* — and it answers it well precisely
because it answers nothing else.

## A test fixture defines the world the test lives in

A run's unit fixture declared `Managers.roles` at the top level, "because that was easier to write
than the real config". In the real collection `roles` sits inside a `tabs` field. The fix under test
was therefore **completely inert on the branch while lint, typecheck and 1,527 unit tests passed** —
only two integration assertions caught it.

This is the failure mode more tests cannot fix. Every other kind of bug is, in principle, catchable by
another assertion; a wrong fixture is not, because it defines the world every assertion in that file
is evaluated against. The one-line pre-mortem is cheap precisely because it happens before the
fixture exists, when the assumption is still conscious.

## A script here never fetches

Every script under `workflow/` takes JSON on stdin and returns a decision. None opens a connection to
GitHub, and that is a rule rather than a convenience.

The alternative was tried and abandoned within a day. Four scripts shipped calling `gh`; all four
passed every local test and none could run in a routine, where the loop does nearly all its work.
Keeping them would have meant two implementations of every rule they encoded — a local one that gets
exercised while developing, and a prose one in the skill that executes eight times a day. That is the
exact shape of the defect that made the merge gate unsafe: `get_status` versus check runs was never a
fetching bug, it was two readings of "green" with no single home.

So the boundary is: **the run gathers, the script decides.** It costs the token savings a scripted
census would have given, and buys the only thing that was ever load-bearing — one implementation,
exercised identically everywhere. A script earns its place when its input is small enough to hand
over and its logic is subtle enough to get wrong in prose. `merge-gate` and `branch-preview-url`
clear both bars. A census, a count and a markdown table clear neither.

---

# reflect

## Reflect edits the profile only on recurrence

One comment is weather; two PRs with the same theme is a pattern. A profile that absorbs every
remark verbatim converges on exactly the long DO/DON'T checklist the profile-plus-stance design
was chosen to avoid — a document the review skims instead of weighs. The gate keeps the profile a
model of the reviewer's *intent*, which generalises to cases the week never showed, rather than a
transcript of their incidents, which does not. It also keeps the weekly diff small enough that the
reviewer can actually audit their own portrait.
