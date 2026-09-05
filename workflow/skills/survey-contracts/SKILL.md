---
name: survey-contracts
description: Check that the published contracts between the sydevs repos still describe reality — the embed guide, changelogs, generated type freshness, and documented commands. Thursday's survey.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Grep, Glob
---

# Survey Contracts

Thursday's survey. Prose documents the couplings between these repos, and nothing enforces them, so
they drift silently. This sweep catches the drift.

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

### 2. Generated type freshness

```bash
curl -fsSL https://raw.githubusercontent.com/sydevs/SahajCloud/main/src/payload-types.ts \
  | diff -q - src/types/payload/payload-types.ts   # SahajAtlasWeb
# WeMeditateWeb: server/payload-types.ts
```

A consumer behind `main` has types that are quietly wrong, not broken — no build error, just a
shape that no longer matches the API. If stale, file a `Task` naming the drift.

### 3. Changelogs

`SahajAtlasWeb/CHANGELOG.md` must cover every host-observable change merged since its last entry.
Check the merge log against it.

### 4. Documented commands still exist

Commands quoted in `CLAUDE.md` / `AGENTS.md` should resolve against `package.json`. A stale
command is the first thing a new contributor, or a fresh cloud session, hits.

```bash
grep -oE 'pnpm [a-z:]+' CLAUDE.md | sort -u   # then compare against package.json scripts
```

## Filing

File one ticket per drifted contract, per `/workflow:triage-issue`. Do not list everything in one
ticket — each is fixed by a different change at a different time.

Type `Task`. The state machine sets `Stage` and `labels.awaiting`. Assign nobody. Set priority by
who is hurt: `High` for a wrong embed guide (it breaks integrations we do not control), `Low` for
a stale command.

## Hard rules

- **Never** trust a document as evidence about itself — check it against the code it describes.
- **Never** bundle unrelated drift into one ticket.
