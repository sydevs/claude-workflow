---
name: survey-deps
description: Survey dependency vulnerabilities across the sydevs repos and raise PRs that fix them, accounting for breaking changes. Monthly, also batches routine minor/patch updates. Files PRs directly, not tickets.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob
---

# Survey Dependencies

Monday's survey. **Raises PRs, not tickets** — a version bump carries its own description, and a
ticket saying "bump X" only adds a round trip.

## Vulnerabilities (every Monday)

```bash
pnpm audit --audit-level=high --json    # the three pnpm repos
```

SahajAtlasWeb has a **baselined allowlist** at `scripts/audit-baseline.json` and its own
`pnpm audit:check` — use that, and respect the baseline rather than re-litigating entries
somebody already assessed.

For each finding, in this order:

1. **Does it apply to us?** A high-severity advisory in a transitive dev-only package that never
   runs in production is not worth a PR. Say so in the journal and move on. Reachability beats
   severity — the CVSS score describes the vulnerable code, not our use of it.
2. **Is a fix available?** No patched version → no PR. Record it in the journal; if it is genuinely
   exposed, file a `Bug` ticket with `blocked-upstream` instead.
3. **Read the changelog before bumping.** A major bump needs the breaking-changes section read and
   the affected call sites checked. This is the whole reason this is a survey and not Dependabot.

## Routine updates (first Monday of the month)

Minor and patch, batched per repo, one PR each. Majors go **one at a time**, each with its own PR
and its changelog read — never batched, never combined with a security fix.

Skip anything pinned deliberately. Pins usually carry a comment saying why; `@schedule-x/*` is
pinned at `2.36.0` in SahajAtlasWeb, and `patches/` exists for a reason.

## Shipping

Branch `claude/chore-deps-<scope>`, then `/workflow:finalize-pr`. These are ticketless — they are
in `prAllowlistGlobs` precisely because review is mechanical.

The PR body must say, per dependency: **from → to, why (advisory ID or "routine"), and what was
checked for breakage.** "Bumped 6 packages" is not reviewable.

## Hard rules

- **Never** bump a major and a security fix in one PR — if it needs reverting, both go.
- **Never** weaken or extend an audit baseline to make a run pass.
- **Never** skip reading a major's changelog because tests pass. Tests cover what we thought to test.
