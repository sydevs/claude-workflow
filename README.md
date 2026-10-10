# claude-workflow

The shared [Claude Code](https://claude.com/claude-code) workflow for the
[sydevs](https://github.com/sydevs) projects. It turns GitHub issues into reviewed pull requests
across **SahajCloud**, **SahajAtlasWeb**, **WeMeditateWeb**, **SahajAtlasWordpress** and this repo.
Why each rule exists, and why the plugin does, is in [docs/why.md](docs/why.md).

```bash
/plugin marketplace add sydevs/claude-workflow
/plugin install workflow@sydevs
```

## The loop

A comment signed *Written by the sydevs autonomous loop* comes from `sydevs-bot`: a Claude Code
cloud session that GitHub Actions started because a member asked for something. Apart from the
nightly audit, work starts only on an event. Each session does one job, pushes, and ends.

```
 ROADMAP — needs a decision, or more than one PR      DIRECT — a bug or a small ticket

 a goal is filed: file-ticket, the public             file-ticket
 "Suggest a goal" form, or an improve-loop proposal        │
      │                                                    ▼
      ▼                                               write-ticket writes the spec
 revise-roadmap ⇄ you answer: @sydevs-bot revise 1A        │
      │                                                    │
      ▼                                                    │
 you: @sydevs-bot implement                                │
      │                                                    │
      ▼                                                    │
 implement-roadmap files the implementation tickets        │
      │                                                    │
      ▼                                                    ▼
 you: @sydevs-bot implement  (approves every child)   you: @sydevs-bot implement
      │                                                    │
      └────────────────► implement-ticket ◄────────────────┘
                               │
                               ▼
     draft PR ─► CI ─► review-pr ─► address-review ─► ready ─► you approve ─► GitHub merges
                               │
                               ▼
     a goal's last child closes ─► revise-roadmap verifies it ─► goal closed, or awaiting
```

- **Who can start the bot.** Only the members in `assignment.respondTo`, with write access. Their
  `@sydevs-bot` verbs count. Anyone else's comment starts nothing.
- **The public gate.** Anyone can suggest a goal. It lands as a Roadmap ticket with `awaiting`, and
  nothing runs until a member says `@sydevs-bot revise`. The author's replies set `awaiting` and
  are read on the next member-started run. They never start a session.
- **Holds and rechecks.** When a hold's date passes or its blocker closes, a short recheck reads why
  it was held. Still blocked: it is quietly re-held, with no ping. You get `awaiting` only when the
  ticket is ready, needs a decision, or has been re-held 3 times in a row.
- **Bulk approval.** `implement` on a goal approves every open child. Free children start at once.
  Blocked ones record `pending: implement` and start when a recheck confirms they are free, with
  no second verb.
- **The completion check.** When a goal's last child closes, `revise-roadmap` compares what shipped
  with *What success looks like*. It closes the goal, or names the gap and sets `awaiting`.
- **Merging.** GitHub merges a PR once the ruleset is met: your approval, every thread resolved, CI
  green. `claude-workflow` is never auto-merged, because merging it is the deploy.

| Label | Means |
| --- | --- |
| `awaiting` | Your turn: ready, a decision is needed, or the bot gave up. |
| `blocked` | Waits on an open blocker or a Hold Until date. A recheck decides when it is free. |
| `bot:working` | A session holds this item. Its status comment links the session. |
| `stuck` | The machinery owes a retry (usage limit, paused routine, dead session). Nothing needed yet. |
| `proposal` | The bot filed it, and no human has given a verdict. |

The board's Status (Proposed, Revising, Approved, Done) tracks implementation tickets and PRs. A
Roadmap ticket has none: its milestone, its sub-issue progress, and whether it is closed say where
it is. Only the dispatcher writes labels and Status; a session only removes its own `bot:working`.

**Nightly audits**, 08:00 UTC, one per day:

| Mon | Tue | Wed | Thu | Fri | Sat | Sun |
| --- | --- | --- | --- | --- | --- | --- |
| `audit-deps` and `audit-contracts`, taking turns | `audit-code` risk | `audit-sentry` | `audit-code` experience | `cut-release` | `audit-code` hygiene | `improve-loop` |

**Vulnerabilities** don't wait for Monday. Once a day the dispatcher reads each repo's Dependabot
alerts, and fires `audit-deps` there only when a high or critical runtime alert is due and no
dependency PR is open. A quiet day costs no session.

**CI, to the loop, is the ruleset's required checks.** A red preview deploy or Railway status is
noted on the PR and fires nothing. Each product repo's CI also calls the shared
`dependency-review.yml`, which fails a PR only for a vulnerable dependency it adds.

## Skills you run

| Skill | Use it to | Example |
| --- | --- | --- |
| `/workflow:file-ticket` | File a bug, a change or a roadmap goal. It checks for duplicates and past decisions first, asks each open question with a recommendation (or leaves it on the ticket), then files in the right tier. A docs-only fix becomes a PR instead. | `/workflow:file-ticket the map flickers when zooming on Safari` |
| `/workflow:finalize-pr` | Finish your own branch: simplify, review, gate, push, open or refresh a draft PR. It never merges. | `/workflow:finalize-pr` |
| `/workflow:dev-server` | Start, stop or check this worktree's dev server. Each worktree gets its own port and database. | `/workflow:dev-server status` |

`write-ticket`, `implement-ticket`, `revise-roadmap`, `implement-roadmap` and `review-pr` also run
locally against an issue or PR number, for example `/workflow:implement-ticket 41` or
`/workflow:review-pr sydevs/SahajCloud#880`.

## Talking to the bot on GitHub

Start the comment with `@sydevs-bot`. Case does not matter.

| On | Say | What happens |
| --- | --- | --- |
| Roadmap ticket | `@sydevs-bot revise` (or `review`, or a bare mention) | `revise-roadmap` reviews the goal or reads your answers. On a non-member's suggestion, this accepts it. |
| Roadmap ticket | `@sydevs-bot implement` | Not planned yet: `implement-roadmap` plans the children, adopting the ones the review attached. Planned: every open child is approved. |
| Implementation ticket | `@sydevs-bot revise <what to change>` | `write-ticket` updates the ticket, or answers your question from the code. |
| Implementation ticket | `@sydevs-bot implement` | `implement-ticket` builds it into a draft PR. On a blocked ticket the approval waits. |
| Any issue | `@sydevs-bot block until 2026-11-15 — waiting on Payload 3.x` | Sets Hold Until and `blocked`, and keeps the reason. The date must be within 30 days. |
| Any issue | `@sydevs-bot block on sydevs/SahajCloud#632` | Adds a native blocked-by link and `blocked`. Rechecked when that issue closes. |
| Any issue | `@sydevs-bot block waiting on legal sign-off` | A short session picks what to watch and a recheck date. |
| Bot PR | a review or thread reply; a comment only with a mention | `address-review` adopts or rebuts each point. |
| Any PR | `@sydevs-bot review` (or `revise`) | `review-pr` writes one critic review. |
| Your own PR | `@sydevs-bot address` (or a bare mention) | `address-review` answers the threads. Code changes arrive as a stacked PR into your branch. |

`implement` is refused while the ticket's **Open questions** has an unticked item.

**Answering a decision.** The bot asks every decision as numbered options with a recommendation:

```markdown
- [ ] **1. Should old atlas links redirect permanently?**
  - **A — Permanent redirect (recommended):** links in old emails keep working.
  - **B — Temporary until 2027:** the old paths can be reused later.
```

Reply `@sydevs-bot revise 1A` (or `1A 2B` for several), or answer in your own words after the
mention. The bot ticks the item and moves it to **Decisions**, with who answered and when.

**Declining a suggestion.** Close it as *not planned*.

**A plain comment with no mention does nothing**, on an issue or a PR, except that a roadmap ticket's own author marks it `awaiting`. On a bot PR, a review or a thread reply needs no mention.

## Automated skills

Fired by the dispatcher (GitHub Actions) on events:

| Skill | Fired by | Produces |
| --- | --- | --- |
| `revise-roadmap` | a member's new goal; `revise`; `block <reason>`; a recheck; the last child closing | a plain-language goal, decisions as options, a notes comment; or the completion verdict |
| `implement-roadmap` | the first `implement` on a goal; a re-plan request | implementation tickets as ordered sub-issues, adopting existing tickets |
| `write-ticket` | `revise` on a ticket; a recheck; `block <reason>` | the updated ticket, or an answer from the code |
| `implement-ticket` | `implement`; a bulk approval; a recheck that frees an approved ticket | a draft PR, continued phase by phase |
| `review-pr` | a bot draft PR going green (skipped for tiny PRs); `review` | one advisory critic review |
| `address-review` | a review, thread reply or mention on a bot PR | a commit or a rebuttal per point, including points in a review's main body, not only file threads |
| `fix-ci` | a red required check on a bot PR, up to 3 times | one fix commit |
| `audit-deps` | the daily check finding a Dependabot alert due | PRs that fix the vulnerable dependencies in that repo |
| `resolve-conflicts` | an approved bot PR that conflicts | `main` merged in, conflicts resolved |

Run by the nightly routine through `run-audit`:

| Skill | Produces |
| --- | --- |
| `audit-deps` | alternate Mondays: routine minor and patch updates, one PR per repo |
| `audit-code` | one angle a night from that day's family. Risk and experience file tickets. Hygiene opens ticketless PRs it can prove safe (comment sweep, dead code). Any family sends a docs-only fix straight to a PR. |
| `audit-sentry` | Bug tickets for production errors worth fixing |
| `cut-release` | the changelog and version-bump PR; merging it publishes the release |
| `audit-contracts` | alternate Mondays: checks the cross-repo contracts, and opens PRs where the source is plainly right |
| `improve-loop` | grades the week, reports usage, and proposes loop changes as a PR, and goals as Roadmap proposals |

Every run begins with `start-run` and ends with `finish-run`, which writes one comment on the day's
`ops-journal` issue in this repo. Every ticket follows `format-ticket`. A merged SahajCloud PR that
changes a file a consumer copies opens a sync PR in that consumer, with no ticket.

## Setup and safety

**Bootstrap** the loop on a new account with [docs/routine-setup.md](docs/routine-setup.md): GitHub
metadata, Mailpit, Sentry, the cloud environment and the routines, in order.

**Kill switches**, narrowest first:

- **Remove `bot:working`** from an item. Its session checks the label before each write and push,
  and stops. The dispatcher then re-derives the item, so a verb still pending can start it again.
- **`dispatch.enabledHandlers`** in `loop-config.json`: a list of the handlers allowed to fire
  (`null` = all).
- **`BOT_DISPATCH`** org variable: `dry` logs every plan and writes nothing. `off` runs nothing.
- **Pause the routines** at claude.ai/code/routines. That stops every session. Fires fail as
  `stuck` and retry later.

**Per-repo settings** live in each repo's `.claude/workflow.json`: `packageManager`, the
`leanGate` test gate, `contractStep`, `securityReview` patterns, `generatedFiles`,
`prAllowlistGlobs` (where a ticketless PR may open), `worktreeSetup` and `devServer`. Loop-wide
values live in [`loop-config.json`](loop-config.json).

**Installing in a repo.** Each repo declares the marketplace in `.claude/settings.json`.
`enabledPlugins` must be an object map — the array form installs the plugin disabled, with no
error. Each person still runs `/plugin install` once.

```json
{
  "extraKnownMarketplaces": {
    "sydevs": { "source": { "source": "github", "repo": "sydevs/claude-workflow" } }
  },
  "enabledPlugins": { "workflow@sydevs": true }
}
```

The plugin also ships four hooks: `block-generated-files`, `block-wrong-bash`, `prettier-format`
and `eslint-fix`. Code review, security review and type-checking on edit come from official
plugins instead (`pr-review-toolkit`, `/security-review` with `security-guidance`,
`typescript-lsp` and `php-lsp`).

**Developing this repo.** Read [`AGENTS.md`](AGENTS.md) first — merging to `main` is the deploy.

```bash
claude --plugin-dir ./workflow    # load without installing
claude plugin validate ./workflow --strict
node --test dispatcher/test/*.test.mjs
```

## Licence

MIT. `finalize-pr/change-outline.md` is adapted from humanlayer's `visual-pr` (MIT).
