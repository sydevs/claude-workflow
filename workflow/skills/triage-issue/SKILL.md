---
name: triage-issue
description: The metadata rules for sydevs tickets — issue type, the Priority and Effort fields, the Blocked by and Re-check body markers, and the standard body format. Shared by draft-ticket, the survey skills, and every handler, so every ticket looks the same whoever filed it.
allowed-tools: Bash(gh issue:*), Bash(gh api:*), Read, Grep
---

# Triage Issue

## Tooling: MCP everywhere, `gh` for one thing

Every GitHub operation in these skills uses `mcp__github__*`. That is not a cloud concession — it
is the better interface in both places: bodies pass as parameters (no `mktemp`, no `--body-file`,
no markdown mangling), type and fields set in the same call as the create, and one set of
instructions reads the same locally and in a routine.

**The single exception is Relationships**, which no MCP tool exposes. A local session may set
them with `gh`. A cloud session writes the body marker instead, and the dispatcher converts it —
see below. `git` itself is still `git`.

This is the one definition of a well-formed sydevs ticket. `draft-ticket`, the survey skills, and
the handlers all read this rather than carry their own copy — the divergence that produced three
forks of the workflow started exactly this way.

## The fields

### Type — what kind of work (org-level issue types)

| Type | Use when |
| --- | --- |
| `Bug` | Something behaves other than intended. Includes regressions and survey-found defects. |
| `Feature` | New capability or a visible extension of one. |
| `Task` | Work with no user-visible behaviour change: refactors, chores, docs, investigations, decisions. |

```
mcp__github__issue_write  method:update  owner:$ORG  repo:$REPO  issue_number:<n>  type:"Bug"
```

An investigation whose *outcome* is a decision is a `Task`, even when it may lead to a `Feature` —
type describes the work requested, not what it might become.

### Priority and Effort — native **fields**, not labels

GitHub's org-level issue fields, available on every `sydevs` repo with no per-repo setup. They are
**not** Projects v2 and **not** labels.

| Field | Options | Means |
| --- | --- | --- |
| **Priority** | `Critical` | Data loss, outage, or security exposure. Drop other work. |
| | `High` | User-visible breakage, or it blocks other work. |
| | `Medium` | Planned work. **The default** — most tickets are this. |
| | `Low` | Do when nothing above it waits. Deferred or speculative. |
| **Effort** | `Easy` / `Moderate` / `Hard` | Rough size, set honestly — `implement-issue` splits a `Hard` ticket it cannot finish in one run. |

Priority measures the **consequence of not doing it**, never effort or appetite. A one-line fix to
a broken signup path is `High`. A month of pleasant refactoring is `Low`.

**The two fields have different owners.** The reviewer sets **Priority** — consequence to the
product is a business judgement. **You set Effort, always**, since it estimates work and you just
read the code.

**Always set Effort.** Understanding the ticket well enough to write it means understanding it
well enough to size it. When you truly cannot, say what makes it unsizable rather than leave it
empty — a run once wrote a full estimate, then discarded it as "yours to set".

```
mcp__github__issue_write  method:update  owner:$ORG  repo:$REPO  issue_number:<n>
  issue_fields:[{field_name:"Priority", field_option_name:"High"},
                {field_name:"Effort",   field_option_name:"Moderate"}]
```

By **name** — the tool validates the option before it calls. Read values back with
`list_issues(fields:["field_values"])`, one call per repo.

⚠ **Fields are readable and writable, but NOT searchable.** `field.<name>:<value>` returns zero
results through the REST search, without an error. **No worklist query may filter on a field.**
(why: docs/why.md#issue-fields-are-not-searchable)

<details><summary>Raw REST equivalent, if you ever need it</summary>

```bash
gh api -X PUT repos/$ORG/$REPO/issues/<n>/issue-field-values --input - <<< \
  '[{"field_id":14337938,"value":"High"}]'
```

`value` must be the option **name** — an option id returns `422 must be a string option name`.
`PATCH`ing the issue with a `fields` key returns 200 and does nothing. ⚠ **The PUT replaces the
issue's entire field-value set** — a PUT carrying only Priority silently clears an existing
Effort. Include every field you want kept. Field ids live in `loop-config.json` → `issueFields`.
</details>

### Whose turn it is — labels and Status, written by the dispatcher

No assignee carries meaning. The dispatcher (GitHub Actions) maintains every turn marker from
events, within seconds:

| Marker | Means |
| --- | --- |
| `awaiting` | Your turn. The bot finished, or gave up. |
| `bot:working` | A session holds the item. Its status comment names the handler and the session. |
| `stuck` | The machinery owes a retry. No human is needed yet. |
| `blocked` | An open `Blocked by:` target, or a `Re-check:` date still ahead. |
| `proposal` | Bot-filed, no human verdict yet. |
| Status `Proposed` / `Revising` / `Approved` / `Done` | Where the item sits on the board. |

**Never write any of them.** Set the fields and the body markers below. The dispatcher does the
rest. (why: docs/why.md#awaiting-has-one-writer)

**To hand a ticket to the loop, comment a verb**: `@sydevs-bot implement`, `revise`, `split`, or
`answer`. Only a `respondTo` human's verb counts, and only the verb authorises code — never a
field, a drag on the board, or a request in prose.
(why: docs/why.md#actions-observes-classifies-locks-and-fires)

### `assignment.respondTo` — whose comments count as feedback

An **allowlist** of logins. A comment is feedback only when its author is on it — everywhere, in
every skill, replacing the older test of *"the author is not the loop's own login"*. A blocklist
of known third-party bots fails open on the next integration nobody has met. An allowlist fails
closed, and lets a new reviewing bot such as Copilot join with one `loop-config.json` entry and no
skill change. (why: docs/why.md#respondto-is-an-allowlist)

### Open questions live in the body

Comments are conversation. **The body is state.** Someone opening the ticket cold must see what is
outstanding without reconstructing it from a thread.

```markdown
## Open questions
- [ ] Does any host we support ship `!important` CSS that breaks the widget?
- [ ] Eager-load Turnstile at boot, or escalate when a form finds it blocked?
```

Tick items off in the body as they are answered.

### Relationships — what must happen first

GitHub calls these **Relationships**. The REST resource is `dependencies`. **Write the
constraint into the body, always**, in exactly this form, one line per blocker, in `## Notes`:

```markdown
Blocked by: https://github.com/sydevs/SahajCloud/issues/632 — the endpoint this consumes does not exist until that merges
```

The dispatcher reads that line on `issues.opened` and `issues.edited`, creates the native
relationship, and applies `blocked`. When the last blocker closes it removes `blocked`, sets
`awaiting`, and mentions the reviewer. Nothing is implemented on unblock. In-org issue URLs only —
a PR URL or prose is ignored.

A local session may also set the native relationship directly. Cross-repo needs the full URL:

```bash
gh issue edit <n> --repo "$ORG/$REPO" --add-blocked-by "https://github.com/$ORG/<other>/issues/<m>"
```

### `Re-check:` — a date, and the promise to look again

Park a ticket on a date, not a blocker, with one line in `## Notes`:

```markdown
Re-check: 2026-10-01 — the upstream fix ships in their October release
```

Justify the date on the same line. The dispatcher applies `blocked` while the date is ahead. When
it passes, the sweeper removes `blocked`, sets `awaiting`, and mentions the reviewer. Keep the
horizon within about a month — a longer park is a ticket that quietly disappears.

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
[Optional: alternatives rejected, prior art, links. Sentry links, `Blocked by:` and `Re-check:` lines go here.]
```

**Acceptance criteria vs verification checklist**: criteria say what must be *true*. The checklist
says what someone must *do* to confirm it. An automated run is judged against the checklist, so
every item must be executable with no other context — `pnpm test:unit`, `GET /api/atlas/sitemap
returns 200 with regions`, "the marker is maroon on sahajayoga.ca". Not "check it works".

## Referring to issues in other repositories

**Always write the full `org/repo#N`, every time — never a bare `#N` after a first full mention.**
GitHub resolves a bare `#171` against the repository the text is *rendered in*, so in a SahajCloud
comment `#171` silently links to SahajCloud#171 rather than the SahajAtlasWeb ticket meant. It is
not an error, just a wrong link — the kind of mistake that survives review.

The shorthand is safe only for issues in the same repository as the comment.

## Title

`<type>(<scope>): <subject>` — ≤70 chars, imperative. Derive scopes in use from `git log
--oneline -50` in that repo rather than inventing one.

## Filing from a cloud run

`mcp__github__issue_write` is the filing path, not a fallback:

- **Issue type** — the `type` parameter, validated against `list_issue_types`. An untyped ticket
  is a mistake, not a limitation.
- **Priority and Effort** — `issue_fields`, with `field_option_name`, so the option is validated
  before the call.
- **Blockers** — the `Blocked by:` line. The dispatcher makes it a relationship.
- **No label, no Status, no assignee.** The dispatcher sets Proposed and `awaiting` on
  `issues.opened`, and `proposal` when the bot filed it.

If a call genuinely fails, **journal the failure and file nothing.** An unfiled finding can be
re-derived next run. A malformed backlog must be cleaned up by hand.

## Filing checklist

- [ ] Type set
- [ ] Priority set (reviewer's — leave an existing value alone) **and Effort set, always, by you**
- [ ] No label, no Status, no assignee
- [ ] Blockers as `Blocked by:` lines. A date park as a `Re-check:` line
- [ ] Body in the format above. Checklist items are executable
- [ ] Searched for a duplicate first (`search_issues`), including closed ones

## Hard rules

- **Never** write `awaiting`, `blocked`, `proposal`, `bot:working`, `stuck`, a Status, or an
  assignee. The dispatcher owns them.
- **Never** authorise work by editing a ticket. Only a `respondTo` human's `@sydevs-bot implement`
  does.
- **Never** leave a ticket without a Priority field value.
- **Never** park a ticket without a `Re-check:` line or a `Blocked by:` line.
- **Never** file without searching for a duplicate.
