---
name: survey-contracts
description: Check that the published contracts between the sydevs repos still describe reality — the embed guide, changelogs, generated type freshness, and documented commands. Thursday's survey.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Grep, Glob
---

# Survey Contracts

Thursday's survey. The couplings between these repos are documented in prose and enforced by
nothing, so they drift silently. This is the sweep that catches the drift.

This class of failure has real precedent here: SahajAtlasWeb's README told host sites to load a
filename the build had never emitted, and it said so for months (#93). Nothing failed — the
document was simply wrong, and only a reader could tell.

## What to check

### 1. The embed contract — `SahajAtlasWeb/docs/embedding.md`

The only documentation a host site ever reads. Verify against the source, not against itself:

- **Script-URL parameters** — every parameter the loader accepts (`src/loader/`) is documented, and
  every documented one still exists.
- **CSP and Permissions-Policy** — the directive table matches what the widget actually needs.
  Enumerate capabilities from the rendered control list and the libraries behind them, **not** from
  a grep: `navigator.geolocation` appears nowhere in our source because the call lives inside
  mapbox-gl, and `geolocation`, `clipboard-write` and `web-share` all fail *silently* when denied.
- **Sizing and routing** — both have inverted once. An unsized element makes the map a fixed
  full-viewport overlay; `routing=path` requires a canonical embed on the client record.
- **Origins** — every host the widget fetches from is listed.

Then check the two in-tree consumers still match: `WeMeditateWeb/lib/atlas-embed.ts` and the
WordPress plugin's templates.

### 2. Generated type freshness

```bash
curl -fsSL https://raw.githubusercontent.com/sydevs/SahajCloud/main/src/payload-types.ts \
  | diff -q - src/types/payload/payload-types.ts   # SahajAtlasWeb
# WeMeditateWeb: server/payload-types.ts
```

A consumer behind `main` has types that are quietly wrong rather than broken — no build error, just
a shape that no longer matches what the API returns. If stale, file a `Task` naming the drift.

### 3. Changelogs

`SahajAtlasWeb/CHANGELOG.md` must cover every host-observable change merged since its last entry.
Check the merge log against it.

### 4. Documented commands still exist

Commands quoted in `CLAUDE.md` / `AGENTS.md` should resolve against `package.json`. Cheap to check,
and stale commands are the first thing a new contributor — or a fresh cloud session — trips on.

```bash
grep -oE 'pnpm [a-z:]+' CLAUDE.md | sort -u   # then compare against package.json scripts
```

## Filing

One ticket per genuinely drifted contract, per `/workflow:triage-issue` — not one ticket listing
everything, because they will be fixed at different times by different changes.

Type `Task`; `Stage` and `labels.awaiting` come from the state machine, and nobody is assigned.
Priority by who is hurt: a wrong embed guide is `High` (it breaks
integrations on sites we do not control), a stale command in `CLAUDE.md` is `Low`.

## Hard rules

- **Never** trust a document as evidence about itself — check against the code that implements it.
- **Never** bundle unrelated drift into one ticket.
