---
name: survey-sentry
description: Sweep Sentry for unresolved production errors across the three instrumented repos and file well-formed Bug tickets for the ones worth fixing. Tuesday's survey.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Grep, Glob
---

# Survey Sentry

Tuesday's survey. Turns production errors into tickets a human can approve — **not** into fixes.
An error's fix is usually a judgement call about intended behaviour, which is exactly what the
`ready-to-implement` gate exists to capture.

SahajAtlasWordpress ships no Sentry. Org, project slugs, and **`apiBase`** all come from
`loop-config.json`.

### Resolving the token, and the failure that hid for a night

Read the credential from the first of `sentry.tokenEnvVar` or `sentry.tokenEnvVarAliases` that is
set:

```bash
TOKEN=""
for V in $(jq -r '.sentry.tokenEnvVar, .sentry.tokenEnvVarAliases[]?' loop-config.json); do
  eval "CANDIDATE=\$$V"
  [ -n "$CANDIDATE" ] && { TOKEN="$CANDIDATE"; TOKEN_VAR="$V"; break; }
done
```

**Distinguish the two failures, because they look identical and mean opposite things:**

- **No Sentry variable set at all** → Sentry is genuinely not configured. Journal "not configured"
  and skip. This is a legitimate state; the surveys degrade rather than fail.
- **A Sentry-ish variable exists under a name nothing reads** → this is a *misconfiguration*, not
  an absence, and it must be journalled loudly with the variable name found. An overnight run
  reported "not configured" while a perfectly valid 64-character token sat in
  `SENTRY_CLAUDE_WORKFLOW_KEY`, because the config read `..._TOKEN`. A whole night's survey was
  lost to a name.

```bash
[ -z "$TOKEN" ] && env | grep -o '^SENTRY[A-Z_0-9]*' | sort
```

Report any name that turns up there. **Never print a value** — only names, lengths and status
codes. A token echoed into a run log is a leaked credential.

**Use `apiBase`, never `sentry.io` directly.** This org lives on Sentry's **DE** region, and the
global host answers `404` for these projects — which reads like a wrong project slug and sends you
chasing the wrong problem. The token also has no `org:read`, so `/organizations/<slug>/` returns
`403`; that is expected. Only two endpoints are needed, and both work.

## Sweep

```bash
API=$(jq -r '.sentry.apiBase' loop-config.json)
ORG=$(jq -r '.sentry.org' loop-config.json)
curl -s "$API/projects/$ORG/$PROJECT/issues/?query=is:unresolved&statsPeriod=14d" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.[] | {id, title, culprit, count, userCount, firstSeen, lastSeen, permalink}'
```

## Rank by consequence, not volume

Order candidates by, in priority:

1. **Users affected** — `userCount`, not `count`. One user hitting a loop 4,000 times is one
   broken user, not a top-of-list emergency.
2. **Newly appeared** — `firstSeen` within the window suggests a regression from a recent deploy,
   and is the cheapest class to fix while the change is fresh.
3. **Still live** — `lastSeen` recent. An error that stopped a month ago was probably already fixed.

Ignore: noise from bots and scrapers, errors originating in browser extensions, and anything whose
stack never enters our code.

## Before filing anything

**Read the stack trace and find the actual code.** A ticket that quotes Sentry's title back without
naming a file and line wastes the reviewer's time and cannot be estimated. If the trace does not
lead anywhere in our repos, do not file it.

**Search for a duplicate**, including closed tickets — a recurring error often has a ticket that was
closed as fixed, and reopening it with new evidence is far more useful than a second ticket.

## Filing

Per `/workflow:triage-issue`. Type `Bug`, `proposal` label, priority by consequence:
`Critical` for data loss or a security path, `High` for a broken user journey, `Medium` for a
degraded one, `Low` for a logged error nobody experiences.

The `## Notes` section must carry the link back, in this exact form so rung 1 can find it on merge:

```markdown
Sentry: https://sy-developers.sentry.io/issues/<id>/  (id: <id>)
```

Respect `maxProposalsPerSurvey`. Over the ceiling → journal what was found and file nothing.

## Hard rules

- **Never** file a ticket you have not traced into our source.
- **Never** resolve a Sentry issue here. Rung 1 resolves it when the fix merges.
- **Never** file more than the ceiling, even for a bad week.
