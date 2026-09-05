---
name: survey-deps
description: Survey dependency vulnerabilities across the sydevs repos and raise PRs that fix them, accounting for breaking changes. Monthly, also batches routine minor/patch updates. Files PRs directly, not tickets.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob
---

# Survey Dependencies

Monday's survey. **Raise PRs, not tickets.** A version bump carries its own description. A ticket
that says "bump X" only adds a round trip.

## Vulnerabilities (every Monday)

```bash
pnpm audit --audit-level=high --json    # the three pnpm repos
```

SahajAtlasWeb has a **baselined allowlist** at `scripts/audit-baseline.json` and its own
`pnpm audit:check`. Use that, and respect the baseline — do not re-litigate an entry someone
already assessed.

For each finding, in this order:

1. **Does it apply to us?** A high-severity advisory in a transitive dev-only package that never
   runs in production is not worth a PR. Journal it and move on. Reachability beats severity — the
   CVSS score describes the vulnerable code, not our use of it.
2. **Is a fix available?** No patched version means no PR. Journal it. If the risk is genuinely
   live, file a `Bug` at `Stage: Blocked` with a `Hold Until` date for the likely fix, and say why.
3. **Read the changelog before you bump.** A major needs its breaking-changes section read and its
   call sites checked. This is why this is a survey, not Dependabot.

## Routine updates (first Monday of the month)

Batch minor and patch updates, one PR per repo. Bump majors one at a time, each with its own PR and
its changelog read — never batched, never combined with a security fix.

Skip anything pinned deliberately. A pin usually carries a comment saying why: `@schedule-x/*` is
pinned at `2.36.0` in SahajAtlasWeb, and `patches/` exists for a reason.

## Shipping

Branch `claude/chore-deps-<scope>`, then run `/workflow:finalize-pr`. These PRs are ticketless —
`prAllowlistGlobs` covers them because review is mechanical.

State each dependency's **from → to, why (advisory ID or "routine"), and what you checked for
breakage.** "Bumped 6 packages" is not reviewable.

## Hard rules

- **Never** bump a major and a security fix in one PR. If it needs reverting, both go.
- **Never** weaken or extend an audit baseline to make a run pass.
- **Never** skip a major's changelog because tests pass. Tests cover only what we thought to test.
