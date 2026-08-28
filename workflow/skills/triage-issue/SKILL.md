---
name: triage-issue
description: The metadata rules for sydevs tickets — issue type, priority label, state labels, relationships, and the standard body format. Shared by draft-ticket, the survey skills, and the loop, so every ticket looks the same whoever filed it.
allowed-tools: Bash(gh issue:*), Bash(gh api:*), Read, Grep
---

# Triage Issue

One definition of what a well-formed sydevs ticket looks like. `draft-ticket`, the survey skills,
and `loop-run` all read this rather than each carrying their own copy — the divergence that produced
three forks of the workflow started exactly this way.

## The four fields

### Type — what kind of work (org-level issue types)

| Type | Use when |
| --- | --- |
| `Bug` | Something behaves other than intended. Includes regressions and defects found by survey. |
| `Feature` | New capability or a visible extension of one. |
| `Task` | Work with no user-visible behaviour change: refactors, chores, docs, investigations, decisions. |

```bash
gh issue edit <n> --repo "$ORG/$REPO" --type Bug
```

An investigation whose *outcome* is a decision is a `Task`, even when it may lead to a `Feature`.
Type describes the work being requested, not what it might become.

### Priority — one label, always exactly one

| Label | Means | Examples from this workspace |
| --- | --- | --- |
| `Critical` | Data loss, outage, or security exposure. Drop other work. | A public write path accepting arbitrary payloads; leaked production credential |
| `High` | User-visible breakage, or it blocks other work. | New users get no verification email; a form that will 404 the moment an upstream PR deploys |
| `Medium` | Planned work. **The default** — most tickets are this. | A new endpoint; an i18n migration |
| `Low` | Do when nothing above it waits. Deferred or speculative. | Analytics instrumentation; a nice-to-have collection |

Priority is about **consequence of not doing it**, not effort or excitement. A one-line fix to a
broken signup path is `High`; a month of pleasant refactoring is `Low`.

### State labels — where it sits in the pipeline

| Label | Meaning | Who applies it |
| --- | --- | --- |
| `approved` | Cleared for implementation. **The loop's only gate.** | **The user, only.** Never the loop, never inferred from a comment. |
| `proposal` | Loop-raised, awaiting a verdict. Counts against `maxOpenProposals`. | The loop, on anything it files |
| `hold` | Approved but paused. | Either |
| `needs-info` | Blocked on an answer. Removed when answered. | Either |
| `blocked-upstream` | Waiting on an external dependency or upstream fix. | Either |

`approved` + `hold` together means "cleared, but not now" — the loop skips it.

### Relationships — what must happen first

```bash
# same repo
gh issue edit <n> --repo "$ORG/$REPO" --add-blocked-by <m>
# cross-repo — needs the FULL URL; owner/repo#N is rejected as "invalid issue format"
gh issue edit <n> --repo "$ORG/$REPO" \
  --add-blocked-by "https://github.com/$ORG/<other>/issues/<m>"
```

Always verify — a silent no-op loses the constraint entirely:

```bash
gh api repos/$ORG/$REPO/issues/<n>/dependencies/blocked_by --jq '.[].number'
```

Use `--parent` for sub-issues only when the children are parts of one deliverable rather than
independent consumers reacting to a change. Sub-issues require the same repo owner.

**Priority and relationships together decide implementation order**: the loop takes the
highest-priority ticket whose blockers are all closed. A `Critical` behind an open blocker waits
behind an unblocked `Medium` — which is correct, and is why recording blockers matters more than
arguing about priority.

## Body format

Every ticket, whoever files it:

```markdown
## Summary
[What and why, ≤3 sentences. A reader who has never seen this repo should
understand the problem.]

## Approach
[How, in enough detail to start. `file:line` references. Omit on a bug report
where the fix is not yet known.]

## Acceptance criteria
- [ ] [Testable condition]

## Verification checklist
- [ ] [A concrete command, route, or observation that confirms the criteria]

## Notes
[Optional: alternatives rejected, prior art, links. Sentry links go here.]
```

**Acceptance criteria vs verification checklist**: criteria say what must be *true*; the checklist
says what someone must *do* to confirm it. The checklist is what an automated run is judged
against, so every item must be executable with no additional context — `pnpm test:unit`, `GET
/api/atlas/sitemap returns 200 with regions`, "the marker is maroon on sahajayoga.ca". Not
"check it works".

## Title

`<type>(<scope>): <subject>` — ≤70 chars, imperative. Derive scopes in use from
`git log --oneline -50` in that repo rather than inventing one.

## If GitHub access is unauthorized

`gh` is present in every environment we run in, but a cloud session whose GitHub proxy is not
authorized 403s on every call. **Do not fall back to the GitHub MCP tools to file anyway.** They
can create issues and comments, but they reach neither issue types nor blocked-by dependencies, so
what they produce silently fails the checklist below — the first cloud run filed an untyped ticket
exactly this way, and nobody would have noticed without reading the issue.

Journal the failure and file nothing. An unfiled finding can be re-derived next run; a malformed
backlog has to be cleaned up by hand.

## Filing checklist

- [ ] Type set
- [ ] Exactly one priority label
- [ ] `proposal` if loop-raised
- [ ] Blockers recorded and verified in both directions
- [ ] Body in the format above; checklist items are executable
- [ ] Searched for a duplicate first (`gh issue list --search`)

## Hard rules

- **Never** apply `approved`. That label is the user's signal to the loop, and applying it is
  indistinguishable from self-authorizing work.
- **Never** leave a ticket with two priority labels or none.
- **Never** file without searching for a duplicate.
