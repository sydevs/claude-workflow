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
 ROADMAP — needs a decision, or spans repos           DIRECT — a bug or one repo's change

 a goal is filed: file-ticket, the public             file-ticket
 "Suggest a goal" form, or an improve-loop proposal        │
      │                                                    ▼
      ▼                                               write-ticket writes the spec
 revise-roadmap ⇄ you answer: @sydevs-bot revise 1A        │
 (the build plan, one line per repo, is in its notes)      │
      │                                                    │
      ▼                                                    ▼
 you: @sydevs-bot implement                           you: @sydevs-bot implement
      │                                                    │
      ▼                                                    │
 implement-roadmap files one ticket per repo,              │
 approved by that same verb                                │
      │                                                    │
      ▼                                                    ▼
 implement-ticket builds the set in one session       implement-ticket builds it in one session
      │                                                    │
      └──────────────────────────┬─────────────────────────┘
                                 ▼
     draft PR(s) ─► CI ─► review-pr ─► address-review ─► ready ─► you approve ─► GitHub merges
                                 │                         (a consumer merges after its producer)
                                 ▼
     a goal's last child closes ─► revise-roadmap verifies it ─► goal closed, or Awaiting
```

- **Who can start the bot.** Only the members in `assignment.respondTo`, with write access. Their
  `@sydevs-bot` verbs count. Anyone else's comment starts nothing.
- **The public gate.** Anyone can suggest a goal. It lands as a Roadmap ticket reading Awaiting,
  and nothing runs until a member says `@sydevs-bot revise`. The author's replies are read on the
  next member-started run. They never start a session.
- **Holds and blockers.** A hold is a date: when it passes the ticket is yours again, with its
  reason in the body. When a blocker closes, an approved ticket starts at once and any other comes
  back to you. No session rechecks either first.
- **One verb.** `implement` on a goal files at most one ticket per repo and approves them. The
  children free together build as one set, in one session. A child blocked outside the set keeps
  its approval, reads Pending, and starts when its blocker closes, with no second verb.
- **One session per feature.** A build opens its PR only once every criterion is met. A session
  near its deadline pushes, says what remains, and asks for the next session, which starts at once.
- **Your review is the spec.** A change you ask for on a PR is built on that PR and written into
  the ticket's criteria. A separate ticket is only ever proposed, with options, for you to choose.
- **The completion check.** When a goal's last child closes, `revise-roadmap` compares what shipped
  with *What success looks like*. It closes the goal, or names the gap and the goal reads Awaiting.
- **Merging.** GitHub merges a PR once the ruleset is met: your approval, every thread resolved, CI
  green. `claude-workflow` is never auto-merged, because merging it is the deploy.

Every open issue and PR — Roadmap tickets too — has one board **Status**, derived by the
dispatcher after every event from the item's own state. Nobody sets it; a drag on the board is put
back on the item's next pass.

| Status | Means | Leaves when |
| --- | --- | --- |
| **Awaiting** | Your turn. The newest bot comment says what for. | You give a verb, a review, an answer or a push. |
| **Blocked** | Not approved, and waits on an open blocker. | The blocker closes: it comes back to you. |
| **Hold** | Not approved, and waits on a Hold Until date. | The date passes: it comes back to you. `implement` clears it and starts. |
| **Pending** | The machinery owes the next move: an approved build, a retry, CI, the merge queue, a goal in delivery. | It moves. A wait the bot owns is checked after `dispatch.pendingDueMinutes`, then handed to you with the reason. |
| **Working** | A session holds the `bot:working` lock. | The session ends. |
| **Done** | Closed, or an issue whose PR is open. | — |

| Label | Means |
| --- | --- |
| `bot:working` | A session holds this item. Its status comment links the session. |
| `proposal` | The bot filed it, and no human has given a verdict. |

Only the dispatcher writes labels and Status; a session only removes its own `bot:working`.
Approval lives in the item's status comment, not on the board.

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
| `/workflow:file-ticket` | File a bug, a change or a roadmap goal. It checks for duplicates and past decisions first, asks each open question with a recommendation (or leaves it on the ticket), then files in the right tier. A docs- or test-only fix becomes a PR instead. | `/workflow:file-ticket the map flickers when zooming on Safari` |
| `/workflow:settle-roadmap` | Answer the open questions on roadmap goals in the terminal instead of on GitHub. It briefs each goal, asks each question with a recommendation (and your earlier answer, when one is reopened), researches anything you ask back, then writes the decisions into the ticket on your yes. No cloud session is spent. | `/workflow:settle-roadmap` or `/workflow:settle-roadmap sydevs/SahajCloud#902` |
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
| Roadmap ticket | `@sydevs-bot implement` | `implement-roadmap` files one ticket per repo, absorbing the ones the review attached, and the build starts when it ends. Already planned: every unstarted child is approved. |
| Implementation ticket | `@sydevs-bot revise <what to change>` | `write-ticket` updates the ticket, or answers your question from the code. |
| Implementation ticket | `@sydevs-bot implement` | `implement-ticket` builds it into a draft PR. On a blocked ticket the approval waits (Pending); on a held one the hold is cleared and it starts. |
| Any issue | `@sydevs-bot hold` · `hold 3 weeks` · `hold until 2026-12-01` | Sets Hold Until and withdraws any approval. Alone, it picks a date 30–90 days out; never more than 180. |
| Any issue | `@sydevs-bot block on sydevs/SahajCloud#632` | Adds a native blocked-by link. An approval is kept, and the build starts when that issue closes. |
| Any issue | `@sydevs-bot block until legal signs off` | A short session turns the reason into a blocker or a hold, and writes it into the body. |
| Bot or member PR | a review or thread reply; a comment only with a mention | `address-review` builds each ask on the PR, rebuts only a fact, and proposes any separate ticket as options for you to choose. |
| Any PR | `@sydevs-bot review` (or `revise`) | `review-pr` writes one critic review. |
| Anyone else's PR | `@sydevs-bot address` (or a bare mention) | `address-review` answers the threads, and builds nothing. |
| Any PR | `@sydevs-bot hold` or `block …` | Refused: a PR is merged or closed. |

A PR by a member (`assignment.respondTo`) gets what a bot PR gets once it is ready: the critic,
the other member asked to review, fixes for CI and conflicts, and auto-merge. A member's draft is
left alone until it is ready or you mention the bot. A fix lands on your branch: directly on a
`claude/*` branch, and through the **relay** on your own (`fix/*`, `copilot/*`) — the session pushes
to `claude/relay-<pr>-<sha>`, and Actions moves your branch to it, merging if you pushed meanwhile.
Pull before your next push. The loop never stacks a PR on another; one it finds is handed back.

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

**A plain comment with no mention does nothing**, on an issue or a PR. On a bot or member PR, a review or a thread reply needs no mention.

## Automated skills

Fired by the dispatcher (GitHub Actions) on events:

| Skill | Fired by | Produces |
| --- | --- | --- |
| `revise-roadmap` | a member's new goal; `revise`; `block until <reason>`; the last child closing | a plain-language goal, decisions as options, technical notes in the body; or the completion verdict |
| `implement-roadmap` | the first `implement` on a goal; a re-plan request | one implementation ticket per repo, as sub-issues in merge order, absorbing existing tickets |
| `write-ticket` | `revise` on a ticket; `block until <reason>` | the updated ticket, or an answer from the code |
| `implement-ticket` | `implement`; a goal's approval; the blocker of an approved ticket closing; its own continue request | a draft PR once the ticket is built, or a goal's set of PRs |
| `review-pr` | a bot draft PR going green (skipped for tiny PRs); `review` | one advisory critic review |
| `address-review` | a review, thread reply or mention on a bot PR; its own continue request | a commit per ask, a rebuttal only of a fact, or a ticket proposed as options — review-body points included |
| `fix-ci` | a red required check on a bot PR, up to 3 times; a failed Railway preview, once per head | one fix commit, or a comment naming the log line |
| `audit-deps` | the daily check finding a Dependabot alert due | PRs that fix the vulnerable dependencies in that repo |
| `resolve-conflicts` | a bot PR that conflicts, draft or ready, once per head | `main` merged in, conflicts resolved |

Run by the nightly routine through `run-audit`:

| Skill | Produces |
| --- | --- |
| `audit-deps` | alternate Mondays: routine minor and patch updates, one PR per repo |
| `audit-code` | one angle a night from that day's family. Risk and experience file tickets. Hygiene opens ticketless PRs it can prove safe (comment sweep, dead code). Any family sends a docs- or test-only fix straight to a PR. |
| `audit-sentry` | Bug tickets for production errors worth fixing |
| `cut-release` | the changelog and version-bump PR; merging it publishes the release |
| `audit-contracts` | alternate Mondays: checks the cross-repo contracts, and opens PRs where the source is plainly right |
| `improve-loop` | grades the week, reports usage, and proposes loop changes as a PR, and goals as Roadmap proposals |

Every run begins with `start-run` and ends with `finish-run`, which writes one comment on the day's
`ops-journal` issue in this repo. Every ticket follows `format-ticket`. A merged SahajCloud PR that
changes a file a consumer copies re-syncs that consumer, with no ticket: a commit on the consumer PR
its goal built beside it, or else a sync PR.

## Setup and safety

**Bootstrap** the loop on a new account with [docs/routine-setup.md](docs/routine-setup.md): GitHub
metadata, Mailpit, Sentry, the cloud environment and the routines, in order.

**Kill switches**, narrowest first:

- **Remove `bot:working`** from an item. Its session checks the label before each write and push,
  and stops. The dispatcher then re-derives the item, so a verb still pending can start it again.
- **`dispatch.enabledHandlers`** in `loop-config.json`: a list of the handlers allowed to fire
  (`null` = all).
- **`BOT_DISPATCH`** org variable: `dry` logs every plan and writes nothing. `off` runs nothing.
- **Pause the routines** at claude.ai/code/routines. That stops every session. Fires fail, read
  Pending, and retry later.

**Per-repo settings** live in each repo's `.claude/workflow.json`: `packageManager`, the
`leanGate` test gate, `contractStep`, `securityReview` patterns, `generatedFiles`,
`prAllowlistGlobs` (where any run's small ticketless fix may open; docs- and test-only fixes have their own route), `previewUrl`, `worktreeSetup`,
`worktreeNotes`, `deployTarget` and `devServer`. Loop-wide
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
node --test workflow/lib/*.test.mjs
node --test dispatcher/test/*.test.mjs
```

## Licence

MIT. `finalize-pr/change-outline.md` is adapted from humanlayer's `visual-pr` (MIT).
