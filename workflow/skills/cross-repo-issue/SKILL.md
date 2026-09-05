---
name: cross-repo-issue
description: File a change that spans two or more sydevs repos. Record it as one upstream tracking issue plus linked child issues in each consumer, in dependency order. Use when a SahajCloud schema change, an atlas embed-contract change, or any other producer change forces work in consumer repos.
disable-model-invocation: true
allowed-tools: Bash(gh issue edit:*), Bash(gh api:*), Bash(git log:*), Bash(git diff:*), Read, Grep, Glob
---

# Cross-Repo Issue

There is no atomic commit across these repositories. A change that spans them spans PRs, and the
merge order is part of the change. This skill records that order in GitHub, not in memory.

## When this applies

Three couplings cross repo boundaries. Each has a fixed direction.

**Generated Payload types are copied, not published.** `SahajAtlasWeb` and `WeMeditateWeb` each
run a `pnpm types:cms` that curls `payload-types.ts` from **SahajCloud's `main` branch**. A schema
change is a three-step sequence: `pnpm generate:types` in SahajCloud → **merge to `main`** →
`pnpm types:cms` in each consumer. A consumer pointed at an unmerged branch keeps the old shape
silently — a type quietly wrong, not a build error.

**The embed contract lives in `SahajAtlasWeb/docs/embedding.md`.** Anything a host can observe —
script-URL parameters, CSP and Permissions-Policy requirements, sizing, the URL shape — changes
there and in `CHANGELOG.md` first, then in its two in-tree consumers:
`WeMeditateWeb/lib/atlas-embed.ts` and the WordPress plugin's templates.

**The atlas URL contract is asserted byte-for-byte.** CI diffs
`SahajAtlasWordpress/tests/atlas-url-contract.json` against SahajCloud's copy, so a change
upstream fails the plugin's build until its copy is updated.

## Workflow

1. **Identify producer and consumers.** The producer is the repo whose change forces the others —
   SahajCloud for schema, SahajAtlasWeb for the embed contract. Consumers follow.

2. **Draft the tracking issue in the producer repo.** Follow `/draft-ticket`'s discipline — a
   clarify pass, acceptance criteria, a verification checklist — and add a `## Downstream impact`
   section naming each consumer and what it must do.

3. **Create the tracking issue first**, and capture its URL. Children reference it, so it must
   exist before they do.

   ```
   mcp__github__issue_write  method:create  owner:sydevs  repo:<producer>
     title:"<title>"  body:"<body>"  type:"Feature"
     issue_fields:[{field_name:"Priority", field_option_name:"<...>"},
                   {field_name:"Effort",   field_option_name:"<...>"},
                   {field_name:"Stage",    field_option_name:"Proposed"}]
     labels:["awaiting"]
   ```

   ⚠ This skill needs `gh` for Relationships, so it runs **locally as you**. No bot event fires
   here, so set `Stage` and `awaiting` yourself instead of leaving them to the state machine.
   Assign nobody.

4. **Create one child issue per consumer** with the same call as step 3, `repo:<consumer>`, then
   record the dependency natively so GitHub enforces and displays it — not just prose in the body.

   File the child `Proposed`, like anything else, **not** `Blocked` — the `Blocked by:` line and
   the native relationship already carry the ordering, and `Blocked` would need a `Hold Until` for
   a wait that ends at a merge, not a date.

   Then link it — the **one step with no MCP tool**, so it needs `gh` and a local session.
   **Cross-repo dependencies need the full issue URL.** `owner/repo#N` is rejected as
   `invalid issue format`:

   ```bash
   gh issue edit <child> --repo sydevs/<consumer> \
     --add-blocked-by "https://github.com/sydevs/<producer>/issues/<N>"
   ```

   Verify both directions — a silent no-op here loses the ordering constraint entirely:

   ```bash
   gh api repos/sydevs/<consumer>/issues/<child>/dependencies/blocked_by --jq '.[].number'
   gh api repos/sydevs/<producer>/issues/<N>/dependencies/blocking   --jq '.[].number'
   ```

   **Then put the same constraint in the child's body** — load-bearing, not decoration. The loop
   runs in the cloud, where **no MCP tool can read Relationships**, so a blocker recorded only in
   the panel is invisible to it, and the child gets picked up as ready. Use the exact marker the
   loop greps for:

   ```markdown
   Blocked by: https://github.com/sydevs/<producer>/issues/<N> — `pnpm types:cms` reads from `main`, so running it before that merges silently pulls the old shape
   ```

5. **Use sub-issues** (`mcp__github__sub_issue_write`) only when the work is one deliverable split
   across repos, not independent consumers reacting to a change. Sub-issues need the same
   repository owner and give the parent a progress bar. Prefer plain blocked-by otherwise.

6. **Report** all issue URLs and the merge order in one block.

## Ordering rules

- **Producer merges first, always.** Never open a consumer PR for review before the producer's
  merges — it would be reviewed against a shape that does not exist yet.
- **The consumer step runs `types:cms` against `main`, not a branch.** If a consumer must develop
  early, say so in the child issue and note its types are provisional.
- **One PR per repo.** No mechanism coordinates a simultaneous merge, so do not try.
- **The WordPress contract diff fails loudly, on purpose.** Never weaken the CI check to unblock a
  consumer — update the copy instead.

## Hard rules

- **Never** file a cross-repo change as independent issues with no parent. The ordering constraint
  is the most important thing this records.
- **Never** file the children before the tracker exists.
- **Always** restate the blocking condition as a `Blocked by: <url>` line in each child's body — a
  cloud run sees only the line, never the Relationship.
