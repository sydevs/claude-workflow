# Cross-repo order

Reference for `implement-roadmap`. There is no atomic commit across these repositories. A goal
that spans them spans PRs, and the merge order is part of the plan. Record it in GitHub, as
`Blocked by:` lines and native relationships — never in prose alone.

## The three couplings

Each has a fixed direction.

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

## Children across repos

1. **Identify producer and consumers.** The producer is the repo whose change forces the others —
   SahajCloud for schema, SahajAtlasWeb for the embed contract. Consumers follow.
2. **The producer's child gets a `## Downstream impact` section** naming each consumer and what it
   must do.
3. **One child per consumer that has work to decide.** **A consumer whose only work is a re-sync
   gets no child.** A copied contract in `contractSync` — the generated types, the atlas URL
   contract — is re-synced by the dispatcher in a bot PR once the producer merges, and
   `audit-contracts` opens any it missed. Name that consumer in `## Downstream impact` with
   "re-synced automatically". (why: docs/why.md#a-contract-sync-is-a-pr-not-a-ticket)
4. **Each consumer child is blocked by the producer child**, with the exact marker in its body:

   ```markdown
   Blocked by: https://github.com/sydevs/<producer>/issues/<N> — `pnpm types:cms` reads from `main`, so running it before that merges silently pulls the old shape
   ```

   The dispatcher converts the line into the native relationship and applies `blocked`. A
   blocker recorded only in the panel gets no label, and a session reading the body never sees
   it. **Cross-repo relationships need the full issue URL** — `owner/repo#N` is rejected as
   `invalid issue format` by `gh issue edit --add-blocked-by`.

Locally you may also link it at once, and verify both directions — a silent no-op here loses the
ordering constraint entirely:

```bash
gh issue edit <child> --repo sydevs/<consumer> --add-blocked-by "https://github.com/sydevs/<producer>/issues/<N>"
gh api repos/sydevs/<consumer>/issues/<child>/dependencies/blocked_by --jq '.[].number'
gh api repos/sydevs/<producer>/issues/<N>/dependencies/blocking   --jq '.[].number'
```

## Ordering rules

- **Producer merges first, always.** A consumer child is never built against a shape that does not
  exist on `main` yet.
- **The consumer step runs `types:cms` against `main`, not a branch.** If a consumer must develop
  early, say so in its child and note its types are provisional.
- **One PR per repo.** No mechanism coordinates a simultaneous merge, so do not try.
- **The WordPress contract diff fails loudly, on purpose.** Never weaken the CI check to unblock a
  consumer — update the copy instead.
- **Never** file a child for a re-sync. The contract sync opens that PR.
