---
name: cross-repo-issue
description: File a change that spans two or more sydevs repos as one upstream tracking issue plus linked child issues in each consumer, in dependency order. Use when a SahajCloud schema change, an atlas embed-contract change, or any other producer change forces work in consumer repos.
disable-model-invocation: true
allowed-tools: Bash(gh issue create:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh issue comment:*), Bash(gh issue edit:*), Bash(git log:*), Bash(git diff:*), Bash(mktemp:*), Read, Grep, Glob
---

# Cross-Repo Issue

There is no atomic commit across these repositories, so a change that spans them is a change that
spans PRs — and the order they merge in is part of the change. This skill records that order in
GitHub rather than in someone's memory.

## When this applies

Three couplings cross repo boundaries. Each has a fixed direction.

**Generated Payload types are copied, not published.** `SahajAtlasWeb` and `WeMeditateWeb` each run
a `pnpm types:cms` that curls `payload-types.ts` from **SahajCloud's `main` branch**. So a schema
change is a three-step sequence: `pnpm generate:types` in SahajCloud → **merge to `main`** →
`pnpm types:cms` in each consumer. A consumer pointed at an unmerged branch silently keeps the old
shape — the failure is a type that is quietly wrong, not a build error.

**The embed contract lives in `SahajAtlasWeb/docs/embedding.md`.** Anything a host can observe —
script-URL parameters, CSP and Permissions-Policy requirements, sizing rules, the URL shape —
changes there and in `CHANGELOG.md` first, then in its two in-tree consumers:
`WeMeditateWeb/lib/atlas-embed.ts` and the WordPress plugin's templates.

**The atlas URL contract is asserted byte-for-byte.** `SahajAtlasWordpress/tests/atlas-url-contract.json`
is diffed against SahajCloud's copy in CI, so a change upstream fails the plugin's build until its
copy is updated.

## Workflow

1. **Identify producer and consumers.** The producer is the repo whose change forces the others.
   For schema, that is SahajCloud; for the embed contract, SahajAtlasWeb. Consumers follow.

2. **Draft the tracking issue in the producer repo.** Use `/draft-ticket`'s discipline — clarify
   pass, acceptance criteria, verification checklist. Add a `## Downstream impact` section listing
   each consumer and what it must do.

3. **Create the tracking issue first** and capture its URL. Children reference it, so it must exist
   before they do.

   ```bash
   BODY_FILE=$(mktemp -t tracking-body)
   gh issue create --repo sydevs/<producer> --title "<title>" --body-file "$BODY_FILE"
   ```

4. **Create one child issue per consumer**, then record the dependency natively so GitHub
   enforces and displays it — not just prose in the body.

   ```bash
   BODY_FILE=$(mktemp -t child-body)
   gh issue create --repo sydevs/<consumer> --title "<title>" --body-file "$BODY_FILE" \
     --type Feature --label Medium
   ```

   Then link it. **Cross-repo dependencies need the full issue URL** — `owner/repo#N` is
   rejected with `invalid issue format`:

   ```bash
   gh issue edit <child> --repo sydevs/<consumer> \
     --add-blocked-by "https://github.com/sydevs/<producer>/issues/<N>"
   ```

   Verify both directions, since a silent no-op here loses the ordering constraint entirely:

   ```bash
   gh api repos/sydevs/<consumer>/issues/<child>/dependencies/blocked_by --jq '.[].number'
   gh api repos/sydevs/<producer>/issues/<N>/dependencies/blocking   --jq '.[].number'
   ```

   **Then put the same constraint in the child's body.** This is load-bearing, not decoration:
   the autonomous loop runs in the cloud, where **no MCP tool can read Relationships**, so a
   blocker recorded only in the panel is invisible to it and the child gets picked up as ready.
   Use the exact marker the loop greps for:

   ```markdown
   Blocked by: https://github.com/sydevs/<producer>/issues/<N> — `pnpm types:cms` reads from `main`, so running it before that merges silently pulls the old shape
   ```

5. **Sub-issues** where the work is genuinely one deliverable split across repos (rather than
   independent consumers reacting to a change): `gh issue edit <child> --parent <N>`. Sub-issues
   require the **same repository owner** — fine within `sydevs` — and give the parent a progress
   bar. Prefer plain blocked-by when the consumers are independently valuable.

6. **Report** all issue URLs and the merge order in one block.

## Ordering rules

- **Producer merges first, always.** Never open the consumer PRs for review before the producer's
  is merged; they will be reviewed against a shape that does not exist yet.
- **The consumer step is `types:cms` against `main`**, not against a branch. If a consumer needs to
  develop before the producer merges, say so explicitly in the child issue and note that its types
  are provisional.
- **One PR per repo.** Do not try to coordinate a simultaneous merge; there is no mechanism for it.
- **The WordPress contract diff fails loudly** — that is intended. Do not weaken the CI check to
  unblock a consumer; update the copy.

## Hard rules

- **Never** file a cross-repo change as independent issues with no parent — the ordering constraint
  is the most important thing being recorded.
- **Never** file the children before the tracker exists.
- **Always** restate the blocking condition as a `Blocked by: <url>` line in each child's body — a
  cloud run cannot see the Relationship, only the line.
