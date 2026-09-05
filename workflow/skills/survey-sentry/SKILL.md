---
name: survey-sentry
description: Sweep Sentry for unresolved production errors across the three instrumented repos and file well-formed Bug tickets for the ones worth fixing. Tuesday's survey.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Grep, Glob
---

# Survey Sentry

Tuesday's survey. Turn production errors into tickets a human can approve — **not** into fixes.
An error's fix is usually a judgement call about intended behaviour, and `Stage: Implement`
exists to capture that call.

SahajAtlasWordpress ships no Sentry. Org, project slugs, and **`apiBase`** all come from
`loop-config.json`. The token is `SENTRY_CLAUDE_WORKFLOW_TOKEN` in the cloud environment. On a
missing token, journal the failure and stop. Do not silently skip.

**Use `apiBase`, never `sentry.io` directly.** This org lives on Sentry's **DE** region. The
global host answers `404` for these projects, which reads like a wrong project slug and sends you
chasing the wrong problem. The token also has no `org:read`, so `/organizations/<slug>/` returns
`403` — expected. Only two endpoints are needed, and both work.

## Sweep

```bash
API=$(jq -r '.sentry.apiBase' loop-config.json)
ORG=$(jq -r '.sentry.org' loop-config.json)
curl -s "$API/projects/$ORG/$PROJECT/issues/?query=is:unresolved&statsPeriod=14d" \
  -H "Authorization: Bearer $SENTRY_CLAUDE_WORKFLOW_TOKEN" \
  | jq '.[] | {id, title, culprit, count, userCount, firstSeen, lastSeen, permalink}'
```

## Rank by consequence, not volume

Order candidates by:

1. **Users affected** — `userCount`, not `count`. One user hitting a loop 4,000 times is one
   broken user, not an emergency.
2. **Newly appeared** — `firstSeen` in the window suggests a regression, cheapest to fix while
   fresh.
3. **Still live** — recent `lastSeen`. An error that stopped a month ago was probably fixed.

Ignore bot and scraper noise, browser-extension errors, and any stack that never enters our code.

## Before filing anything

**Read the stack trace and find the actual code.** A ticket quoting Sentry's title with no file
and line wastes the reviewer's time and cannot be estimated. If the trace leads nowhere in our
repos, do not file it.

**Search for a duplicate, including closed tickets.** A recurring error often has a ticket closed
as fixed. Reopen it with new evidence — that beats a second ticket.

## Filing

Follow `/workflow:triage-issue`. Type `Bug`. The state machine sets `Stage` and `labels.awaiting`
on `issues: opened`. Assign nobody. Set priority by consequence: `Critical` for data loss or a
security path, `High` for a broken user journey, `Medium` for a degraded one, `Low` for a logged
error nobody experiences.

The `## Notes` section must carry the link back, in this exact form, so rung 1 can find it on
merge:

```markdown
Sentry: https://sy-developers.sentry.io/issues/<id>/  (id: <id>)
```

Respect `maxProposalsPerSurvey`. Over the ceiling, journal what you found and file nothing.

## Hard rules

- **Never** file a ticket you have not traced into our source.
- **Never** resolve a Sentry issue here. Rung 1 resolves it when the fix merges.
- **Never** file more than the ceiling, even for a bad week.
