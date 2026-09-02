# Why each rule exists

The rules live in the skills. **This file holds the failure that produced each one**, and nothing
else — no rule appears here that is not already stated as an imperative in a `SKILL.md`.

The split is deliberate. `loop-run/SKILL.md` is read fresh on every run, roughly eleven times a day
across five repos; length there costs tokens on every run *and* dilutes the rules it carries. But a
rule with no story behind it is a rule a model talks itself out of when it meets a case the wording
did not anticipate. So the story keeps its place — one hop away, cited from the rule as
`(why: docs/why.md#anchor)`.

**Read an entry when a rule seems not to fit the case in front of you — never to decide whether to
follow it.** If the story and the imperative ever disagree, the imperative wins and the discrepancy
is a bug in this file.

This file lives in the `sydevs/claude-workflow` checkout, beside `loop-config.json`.

---

# loop-run

## The routine prompt is not the specification

The two scheduled routine prompts are set through an API, not stored as files in this repo, so they
cannot be reviewed in a PR and cannot be diffed against the skills. For a while they restated about
a dozen of `loop-run`'s hard rules "for safety". That duplication has gone stale twice:

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

## Filter feedback by author

Having its own account is the whole reason the loop can tell feedback from its own writing. Replying
to itself burns the reply ceiling and produces a thread that argues with itself.

## Derive the window from comment timestamps

A field write, a label change or a bulk metadata pass all bump `updated_at` without anyone having
said anything. A single migration made all 38 open issues look like fresh feedback on 2026-08-28.

## A request in prose is not permission

The middle row of the rung-4 table is the one that goes wrong quietly: a comment asking for work
reads like permission to do it, and it is not. The label is the gate — a request in prose is a
request to *scope* the work, not to start it.

## Legacy identity comments

Comments written before 2026-08-29 carry the loop's **old** identity, which was a real person's
account (`antontcymbal`). Those are indistinguishable from that person's own comments, so the loop
may reply once to a legacy comment of its own. That is bounded and one-time, and a dated exclusion
rule would outlive the problem it solved.

## Every claim names the call that produced it

Building `📋 Awaiting you` from a live query rather than from memory fixed a real divergence between
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

The identical 403 with and without an auth header is the part that settles it: the proxy is refusing
the *path*, not the credential, so installing a binary or finding a better token cannot help.

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

## CI is check runs, not commit statuses

`pull_request_read method:get_status` returns **commit statuses**. Every repo here runs GitHub
Actions, which report **check runs**. They are separate GitHub surfaces and the first cannot see the
second, so the gate failed in both directions at once.

The dangerous direction: on SahajCloud#672 the only commit status was Railway's deploy, green at
21:14:17Z, while `Lint, Test & Smoke` — a check run — ran until 21:31:40Z. For seventeen minutes an
approved PR read as green with its test suite still running, and a run that merged in that window
would have been following the skill exactly.

The harmless direction, same call: SahajAtlasWeb#181 with five of five check runs green read as
`pending` forever, so the loop declined a healthy PR on every pass.

Two further clauses the merged reading still needs. **At least one check run**, not merely one
context — a Railway or Cloudflare deploy posts its own status and would otherwise stand in for a test
job that was never scheduled. And **a repo with no Actions at all is not a repo with unfinished
CI**: `claude-workflow` has no `.github/workflows/`, so its PRs carry zero checks, and treating that
as pending meant commenting "checks have not finished" on the loop's own PRs every run, forever.
That case is derived from the repo's workflow count rather than configured, so it cannot go stale the
day someone adds a workflow.

## A conflicted PR schedules zero CI runs

A conflicted PR has no computable merge commit, so GitHub schedules **zero** workflow runs for it —
silently. The checks list shows only the non-Actions entries (a Railway or Cloudflare deploy still
happens, since those build the branch head) and the run list is simply empty. It reads as a stuck
scheduler, and waiting is futile.

A run that predates the base moving is stale, and makes a conflicted PR look tested.

## Hand the baton back even with CI unsettled

An item with an uncertain status is still *someone's*. An item assigned to nobody has fallen out of
the system entirely, because every worklist query is keyed on an assignee.

A PR still assigned to the bot is not necessarily a fault — blocked and deferred work legitimately
stays there. But a PR that is green and reviewed should never sit in the bot's queue.

---

# implement-issue

## Assignment alone is not the implementation gate

At backfill time four tickets had open PRs closing them, and all four would have been re-implemented
had assignment alone been the gate. Neither an open blocker nor an in-flight PR is visible through
assignment, which is why they are separate rows.

## A test fixture defines the world the test lives in

A run's unit fixture declared `Managers.roles` at the top level, "because that was easier to write
than the real config". In the real collection `roles` sits inside a `tabs` field. The fix under test
was therefore **completely inert on the branch while lint, typecheck and 1,527 unit tests passed** —
only two integration assertions caught it.

This is the failure mode more tests cannot fix. Every other kind of bug is, in principle, catchable by
another assertion; a wrong fixture is not, because it defines the world every assertion in that file
is evaluated against. The one-line pre-mortem is cheap precisely because it happens before the
fixture exists, when the assumption is still conscious.
