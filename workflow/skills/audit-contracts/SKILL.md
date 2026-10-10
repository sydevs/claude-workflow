---
name: audit-contracts
description: Check that the published contracts between the sydevs repos still describe reality — the embed guide, copied types, changelogs, and the shared code-comments rule. Alternate Mondays.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob
---

# Audit contracts

Alternate Mondays, taking turns with `audit-deps` (`auditCalendar.monday`). Prose documents the
couplings between these repos, and nothing enforces them, so they drift silently. This sweep catches the drift and
**fixes it in a PR** — a sync is the fix, not a proposal, so it needs no ticket.
(why: docs/why.md#a-contract-sync-is-a-pr-not-a-ticket)

Real precedent: SahajAtlasWeb's README told host sites to load a filename the build had never
emitted, for months (#93). Nothing broke. The document was simply wrong, and only a reader
could tell.

## What to check

### 1. The embed contract — `SahajAtlasWeb/docs/embedding.md`

The only documentation a host site reads. Verify it against the source, not against itself:

- **Script-URL parameters** — every parameter the loader accepts (`src/loader/`) is documented, and
  every documented one still exists.
- **CSP and Permissions-Policy** — the directive table matches what the widget needs. Enumerate
  capabilities from the rendered control list and its libraries, **not** from a grep:
  `navigator.geolocation` appears nowhere in our source because the call lives inside mapbox-gl,
  and `geolocation`, `clipboard-write`, `web-share` all fail *silently* when denied.
- **Sizing and routing** — both have inverted once. An unsized element makes the map a fixed
  full-viewport overlay. `routing=path` needs a canonical embed on the client record.
- **Origins** — the guide lists every host the widget fetches from.

Then check the two in-tree consumers still match: `WeMeditateWeb/lib/atlas-embed.ts` and the
WordPress plugin's templates.

### 2. Copied contracts are current

`contractSync` in `loop-config.json` names each copy: the producer's `sources`, and each
consumer's `command` and `paths`. The dispatcher runs that sync whenever a merged producer PR
touches a source, so this check catches only what it missed — a push straight to `main`, or a sync
PR closed unmerged.

Run the consumer's `command` in its checkout, on `origin/main`. A clean `git status -- <paths>`
means current. A diff means stale: a consumer behind `main` has types that are quietly wrong, not
broken — no build error, just a shape that no longer matches the API.

**Stale → open the sync PR yourself**, on `contractSync.branch`, through `/workflow:finalize-pr`.
An open PR on that branch already → push your commit onto it instead.

### 3. Changelogs

`SahajAtlasWeb/CHANGELOG.md` must cover every host-observable change merged since its last entry.
Check the merge log against it.

### 4. The shared code-comments rule

`docs/code-comments.md` here is canonical. Each product repo carries a copy at
`docs/rules/code-comments.md`, symlinked into `.claude/rules/`, and four copies drift silently —
that drift is exactly what this plugin exists to prevent.

Compare the block between the `canonical:start` and `canonical:end` markers. Below those markers
each repo keeps its own carve-outs, which must differ:

```bash
node workflow/lib/comment-rule-sync.mjs ..      # exits 1 on drift
```

Check the symlink still resolves too. A rule file that stops loading fails open and silently:

```bash
ls -l <repo>/.claude/rules/code-comments.md
```

Fix it in one PR per drifted repo, copying the canonical block into the copy.

## Fixing

**Open one PR per drifted contract, not a ticket.** A copy that is behind, a document that
misdescribes the code, a missing changelog entry — each is fixed by making the copy or the
document match its source. Branch `claude/<type>-contract-<scope>` (`contractSync.branch` for a
copied contract), then run `/workflow:finalize-pr`. The PR opens as a draft, and the dispatcher
carries it from there. Name the source you checked it against in the body.

**File a ticket only when the code may be the wrong side** — when the document describes what a
host needs and the code does something else, which is right is a decision, not a sync. Then file
through `/workflow:write-ticket` in create mode, type `Task`, never by hand, with an open roadmap
ticket it clearly serves as the parent. Never file a roadmap ticket.
(why: docs/why.md#one-author-writes-every-implementation-ticket, docs/why.md#the-roadmap-tier)
Set priority by who is hurt: `High` for a wrong embed guide (it breaks integrations we do not
control), lower where only our own code reads the contract.

Do not bundle: each contract is fixed by a different change at a different time.

## Hard rules

- **Never** trust a document as evidence about itself — check it against the code it describes.
- **Never** bundle unrelated drift into one PR or one ticket.
- **Never** file a ticket for a sync. A copy that is behind its source gets a PR.
