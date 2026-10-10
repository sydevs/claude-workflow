---
name: audit-code
description: Examine the codebase from tonight's angle, in one of three rotations — risk, experience, hygiene — chosen by run-audit's calendar. File the findings worth acting on through write-ticket, or open a ticketless PR where a hygiene change is provably safe.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Edit, Grep, Glob, Task
---

# Audit code

Three rotations, one per day this runs: **risk**, **experience**, **hygiene**. Each advances one
angle per run of its own day, so a week always mixes the three and the codebase is seen from
every direction over a quarter. (why: docs/why.md#three-audit-rotations)

## The angle

`run-audit` passes `family` and `angle`, from `calendar.mjs`. Run locally, take them from
`node <claude-workflow>/workflow/skills/run-audit/calendar.mjs [--date YYYY-MM-DD]`. Never pick an
angle by hand. Name the family and the angle in the journal.

## Choosing where to look

Do **not** sweep all five repos — that produces shallow findings everywhere. Pick the one or two
areas where this angle has the most purchase, and say why in the journal. Read
`families/<family>.md` (`risk.md`, `experience.md`, `hygiene.md`) for where each angle pays.
Always useful:

- What changed recently (`git log --since='3 months ago' --name-only`) — new code has had the
  least scrutiny.
- What the repo's own docs flag as delicate: nested `AGENTS.md` guides, `docs/`.

## The bar for filing

Propose something only when you can state all three: what is wrong, what it costs, and what to do
instead. A finding that fails any of those is an observation. File it in the journal, not the
backlog.

Do not file:

- Style preferences with no functional consequence.
- "Consider adding tests" without naming the untested behaviour and why it matters.
- Refactors whose only argument is that the code is old.
- Anything an open ticket already covers — search first.

Deliberate decisions are not findings. These repos record their reasoning in nested `AGENTS.md`
guides, `docs/`, and ticket bodies — read those first. Re-proposing an argued position (`auto.js`
vs `embed.js`, the CSS reset instead of shadow DOM) as a discovery wastes review time and costs
trust in the rest of your findings.

## Filing a ticket

**File through `/workflow:write-ticket` in create mode, never by hand.**
(why: docs/why.md#one-author-writes-every-implementation-ticket) Risk files a `Bug` for a defect
and a `Task` for the rest. Experience and hygiene set the type by the work, usually `Task`. Set
priority by consequence, honestly: most findings are `Medium` or `Low`, and inflating one makes
the field useless.

**Attach to the roadmap.** When a finding clearly serves an open ticket of type `roadmap.type`
(`search_issues "$SCOPE is:issue is:open type:<roadmap.type> -label:ops-journal"`), pass it to
`write-ticket` as the parent, which links a native sub-issue (`mcp__github__sub_issue_write`).
Never file a roadmap ticket from an audit. (why: docs/why.md#the-roadmap-tier)

Respect `maxProposalsPerSurvey` and the standing `maxOpenProposals` ceiling. Fewer, better
findings win — the user is the only reviewer.

## Ticketless PRs

**Any family:** a docs-only finding where the code is plainly right is a ticketless PR, as
preflight's incidental-finding rule routes it, never a ticket.
(why: docs/why.md#a-docs-fix-is-a-pr-not-a-ticket)

Hygiene also prefers a ticketless draft PR where the change is **provably** safe. The proof stands
in for the ticket, and these three are the one deliberate exception to `prAllowlistGlobs`: each
still waits for a human approval before it merges. (why: docs/why.md#three-audit-rotations)

- **Code comments** — run [`comment-sweep.md`](comment-sweep.md) on the chosen area. The PR is
  proven comment-only by `comment-fingerprint.mjs`, with its verdict pasted in the body.
- **Dead code and unused dependencies** — a ticketless PR only when the removal is provably
  unreferenced (`families/hygiene.md` says what proves it). Anything short of proof → a ticket.
- **Docs vs reality** — a doc that misdescribes correct code gets a doc-fix PR. When the code may
  be the wrong side, file a ticket.

Branch `claude/chore-<angle-slug>-<scope>`, then `/workflow:finalize-pr`. One PR per repo. Never mix a
code change into a comment or doc PR.

## Hard rules

- **Never** file a finding you have not traced to specific code.
- **Never** re-propose a documented decision without new evidence that changes it.
- **Never** fill the quota for its own sake. Zero findings is a valid, honest result.
- **Never** open a ticketless PR on a judgement call. No proof, no PR — file a ticket.
