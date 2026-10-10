---
name: audit-deps
description: Fix dependency vulnerabilities with PRs that account for breaking changes — in one repo, when the dispatcher's daily Dependabot check finds an alert due — and batch routine minor/patch updates on alternate Mondays. Files PRs directly, not tickets.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob
---

# Audit dependencies

**Raise PRs, not tickets.** A version bump carries its own description. A ticket that says
"bump X" only adds a round trip. Two jobs:

| Job | Started by | Scope |
| --- | --- | --- |
| **Vulnerabilities** | The dispatcher's daily check: a repo-mode record, `flags.mode: "vulnerabilities"` | The record's repo |
| **Routine updates** | `run-audit`, on the Mondays `auditCalendar` gives it | Every pnpm repo |

## Vulnerabilities

The dispatcher fired this because Dependabot has a high or critical runtime alert due in this repo:
opened in the last day, or still open with a fix on `deps.catchUpDay`. It never judged whether the
alert applies to us. You do. (why: docs/why.md#a-vulnerability-is-checked-before-a-session-is-spent)

```bash
pnpm audit --audit-level=high --json
```

An open `deps.branchPrefix` branch with no PR is a session that died. Continue it.

For each finding, in this order:

1. **Does it apply to us?** A high-severity advisory in a transitive dev-only package that never
   runs in production is not worth a PR. Journal it and move on. Reachability beats severity — the
   CVSS score describes the vulnerable code, not our use of it.
2. **Is a fix available?** No patched version means no PR. Journal it. If the risk is genuinely
   live, file a `Bug` through `/workflow:write-ticket` in `create` mode, and set its `Hold Until`
   field to the date the fix is likely, saying why in a comment. The dispatcher parks it as
   `blocked` until then, and rechecks it on that date.
3. **Read the changelog before you bump.** A major needs its breaking-changes section read and its
   call sites checked. This is why this is an audit, not Dependabot.

## Routine updates (alternate Mondays)

Batch minor and patch updates, one PR per repo. Bump majors one at a time, each with its own PR and
its changelog read — never batched, never combined with a security fix.

Skip anything pinned deliberately. A pin usually carries a comment saying why: `@schedule-x/*` is
pinned at `2.36.0` in SahajAtlasWeb, and `patches/` exists for a reason.

## Shipping

Branch `deps.branchPrefix` + `<scope>`, then run `/workflow:finalize-pr`. These PRs are ticketless —
`prAllowlistGlobs` covers them because review is mechanical. They open as drafts. The dispatcher
runs CI and marks them ready. Push and end.

State each dependency's **from → to, why (advisory ID or "routine"), and what you checked for
breakage.** "Bumped 6 packages" is not reviewable.

## Hard rules

- **Never** bump a major and a security fix in one PR. If it needs reverting, both go.
- **Never** silence an advisory to make a run pass. A judgement that one does not apply goes in
  the journal entry, with the reason.
- **Never** skip a major's changelog because tests pass. Tests cover only what we thought to test.
