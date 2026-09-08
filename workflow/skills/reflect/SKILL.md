---
name: reflect
description: Sunday's survey. Grade last week's changes, read the week's journals, report usage, refine the reviewer profile, and propose loop changes as a PR.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob
---

# Reflect

Sunday's survey. The loop reads its own week and proposes changes to itself, through the same
review-and-merge path as everything else — the loop's behaviour never changes without the user's
approval. Because routines clone `main` fresh each run, a merged change takes effect on the next
dispatch with no redeploy.

## Start by grading last week

**Before you look at this week at all, read the previous reflection PR and say whether it
worked.** Find it in this repo's merged PRs. For each change it made, state in one line whether
the failure it addressed recurred in the week just gone, with the count from the journals below.

A reflection that never checks its own past changes is not learning — it is opinion with a PR
attached. This section leads the new PR's body, and has three possible verdicts per change:

| Verdict | Then |
| --- | --- |
| **Held** — the failure did not recur | Say so and move on. This is the common case, and it should be boring |
| **Did not hold** — same failure, same shape | Do **not** re-propose the same fix harder. Say the model behind it was wrong, and propose a different one or nothing |
| **Too early** — the situation never arose | Say so. This is not evidence of anything, and licenses no follow-up |

With no previous reflection, say so in one line and continue.

## Evidence

Read. Do not recall. Every run starts with no memory of the last. `$ORG`, `$JOURNAL_REPO`, `$BOT`
and `$REVIEWER` come from `loop-config.json` (`org`, `journalRepo`, `identity.expectedLogin`,
`assignment.reviewer`) — never typed literally.

**A journal day is one issue: a title with the counts, a body with the usage tally, and one
comment per session.** The week is seven titles and seven bodies. Open a day's comments only when
its title reports a failure or an anomaly.

```
# the week's journal issues — one per day, all still open
mcp__github__search_issues  query:"repo:$ORG/$JOURNAL_REPO is:issue is:open label:ops-journal"
# title: "<Day> — <n> dispatches · <n> failed · <n> anomalies". Body: the <!-- tally --> block.
mcp__github__issue_read  method:get  owner:$ORG repo:$JOURNAL_REPO issue_number:<n>
# a flagged day only: one comment per session, newest first, small pages
mcp__github__issue_read  method:get_comments  issue_number:<n>  perPage:20  page:<from the comments count>

# what actually happened to the PRs
mcp__github__list_pull_requests  owner:$ORG repo:$REPO  state:all  perPage:40

# what the reviewer actually said — the loop's only window into their judgement
# $SCOPE = repo: qualifiers built from `repos` — never a bare org:, which reaches retired repositories
mcp__github__search_issues  query:"$SCOPE is:pr author:$BOT reviewed-by:$REVIEWER updated:>$WINDOW"
# per hit: pull_request_read method:get_reviews + method:get_review_comments,
# keep author == $REVIEWER and created_at inside the window — and READ THE TEXT, not the count
```

**`perPage` on a journal never exceeds 20.** One oversized reply once broke the run that read it.
(why: docs/why.md#ground-from-the-body-never-the-thread)

`$WINDOW` is the previous reflection PR's merge date (find it in this repo's merged PRs). With no
previous reflection, use seven days.

Each session comment starts with a `<!-- sydevs-dispatch-done v1 {…} -->` marker naming the
handler, the item, the session, and its failure count. Each dispatcher line starts with
`<!-- sydevs-dispatcher-anomaly v1 {…} -->`. Count from the markers, not from prose.

## What to look for

The useful signals are about **friction**, not volume, and the journal states them directly.
Count across the seven days before you conclude anything.

**Recurrence gates every change, not just profile edits.** One occurrence is weather — name it in
the PR body as observed, and nothing else. Propose a change only when the same failure, anomaly,
or friction appears **on two or more distinct days**, and state the count in the proposal. A rule
added for one bad night outlives its cause.
(why: docs/why.md#reflect-edits-the-profile-only-on-recurrence)

| Signal | What it suggests |
| --- | --- |
| The same `⚠️ Failed` bullet on 2+ days | A real defect, not an environment blip |
| A `🧭 Friction` entry repeating | The rule misfires in practice. The rule is usually wrong |
| `timed out` anomalies for one handler | Its `dispatch.timeoutsMinutes` is wrong, or the skill does not push and end |
| `session ended silently` anomalies | A handler skipped its journal or its summary comment |
| `ci-capped` on 2+ PRs | A flaky gate, or a change class the lean gate misses |
| `429` or `paused` anomalies on 2+ days | Usage is the binding constraint — say so in the usage report |
| PRs needing 3+ `address-review` sessions | Tickets are underspecified, or `implement-issue` is guessing |
| Rebuttals the reviewer then overrode | The bot argues where it should adopt — a profile gap |
| The same reviewer comment theme on 2+ PRs | A missing profile value, or a missing skill rule |
| The reviewer flagged something the adversarial review passed clean | A profile gap |
| Adversarial-review findings the reviewer resolved without change | The bot review over-flags — trim the profile, not the code |
| A PR under `review.skipWhen` that the reviewer then changed | The threshold is too generous |
| Proposals sitting unreviewed | Surveys outrun review capacity — lower `maxProposalsPerSurvey` |
| A recheck storm on one item | Humans comment while the bot works — a note for the usage report, not a rule |

Prefer **removing** a rule to adding one. Every dispatch reads its skill in full, and a skill that
grows a paragraph per incident becomes unreadable — how the previous three-fork workflow decayed.

**When your PR edits a skill, run the rule delta and account for every removal in the body:**

```bash
node workflow/lib/rule-delta.mjs --base main workflow/skills
```

It exits non-zero on a directive that vanished with no close match. Each one is a rule you meant
to drop, or a rule that fell out — only you can say which, since this repo cannot validate a skill
by running it. (why: docs/why.md#lint-measures-style-not-content)

## Report usage — feedback, never a gate

There is no WIP cap. The people who type the verbs are the throttle, and this report is what
they see. (why: docs/why.md#there-is-no-wip-cap)

From the seven titles and `<!-- tally -->` blocks, with no comment reads:

- dispatches per repo and per handler, beside last week's reflection PR's numbers,
- sessions per merged PR — the week's dispatches on PR items divided by the PRs merged,
- every item with **three or more sessions**, with its count and handlers,
- `address-review` sessions per PR, where a review arrived one comment at a time.

Then **one or two concrete suggestions to the humans**, each tied to a number: batch review
comments into one review, one verb at a time, split a ticket that took six sessions, a
`Re-check:` date on a ticket that was revised three times. Never a rule for the loop. Never a cap.

The report is a `## 📊 Usage` section of the reflection PR body. With no PR this week, it goes
into tonight's journal entry under `📄 Did`, fitted like any entry. The report is written every
week, even when nothing else is.

## Refining the reviewer profile

`review.profilePath` is the adversarial review's model of how $REVIEWER reviews. Refining it is
this survey's job, gated on recurrence: edit it only when **the same theme appears in the
reviewer's comments on two or more distinct PRs in the window**, or **they caught something
substantive the adversarial review had passed clean**. One comment is weather.
(why: docs/why.md#reflect-edits-the-profile-only-on-recurrence)

When the gate opens, work at the level of **intent, not incident**. Do not append "DON'T do X" —
ask what value made the reviewer write those comments, and state *that*, so the review
generalises to cases the week never showed. A profile that absorbs every remark verbatim
converges on a checklist nobody weighs. Each edit is one dated bullet under **Recent
refinements**, citing the PRs behind it. When several bullets turn out to be one value, fold them
into that value's section and delete the bullets. Profile edits ride the weekly reflection PR,
never a second one.

## Proposing

At most one PR to `claude-workflow` per week. Ticketless (`prAllowlistGlobs`). Scope it to changes
the evidence supports: a timeout, a threshold, a clarified instruction, a removed rule that never
fired, a profile refinement. Open it through `/workflow:finalize-pr` — it is a draft bot PR like
any other, and the dispatcher takes it through the critic to the reviewer.

The PR body must show the evidence **as arithmetic over the week, not impression**. Count the
anomaly markers rather than characterise them: "raise `timeoutsMinutes.implement` to 180: 4 of 9
implement sessions timed out at 150, and each resumed session finished." A proposal with no count
is a guess the reviewer cannot check.

**Lead the body with the grading section** from the top of this skill — what last week's changes
meant to fix, and whether they did. **Then the usage report.**

**Lessons that belong to a product repo, not the loop**, follow the evidence to that repo. A
recurring reviewer comment is often a convention nobody wrote down, and the fix belongs where the
next author reads it:

- **A small documentation fix** — a `CLAUDE.md`/`AGENTS.md` correction, a missing convention, a
  stale instruction — becomes a direct ticketless PR to that repo (its `prAllowlistGlobs` covers
  `**/*.md`). **Never touch anything under `.claude/`** — Protected Paths stall an unattended
  run, invisibly.
- **Anything structural** — new tooling, a hook, a workflow change, anything beyond prose — is a
  proposal issue in that repo instead, under `maxOpenProposals` like every survey proposal. The
  dispatcher sets its Status and `awaiting`.

If the week gives no clear signal, **say so and open no PR.** A quiet week is a legitimate
outcome, and an unneeded change to the machinery costs more than none. The usage report still
goes in the journal.

## Close the week's journals

Once the reflection PR is open, close every `label:ops-journal is:open` issue you read, each with
a one-line comment linking the reflection PR. They are working memory for a week, not a permanent
record — left open, they make next Sunday's read grow without bound and clutter the issue list.

Close them **last**. A crash midway through the reflection should leave the journals intact — they
are the only input that cannot be reconstructed. Leave today's issue open: tonight's entry still
goes on it.

## Hard rules

- **Never** change loop behaviour outside a reviewed PR.
- **Never** raise a timeout or a threshold without evidence it was the binding constraint.
- **Never** open a reflection PR while a previous one is unreviewed — stack findings into next week.
- **Never** propose a change on a single occurrence. Name it as observed and wait for a second.
- **Never** open the PR body without last week's grading at the top.
- **Never** ship a skill change and a ceiling change in one PR — split across weeks if both apply.
- **Never** turn the usage report into a rule or a cap. It is feedback to people.
- **Never** read a journal's comments with `perPage` above 20.
