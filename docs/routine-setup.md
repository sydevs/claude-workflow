# Setting up the loop on a new Claude account

Everything needed to stand the autonomous loop back up from nothing: a new Claude account, a fresh
Railway project, a new Sentry org, or all three. Written because the pieces live in five different
dashboards and none of them is discoverable from the repo.

**Time:** about 45 minutes, most of it waiting for deploys.
**Order matters** — each section depends on identifiers produced by the one before it.

---

## 0. Prerequisites

| Thing | Why | Notes |
| --- | --- | --- |
| Claude Pro/Max/Team account | Routines are cloud sessions | Zero-Data-Retention orgs **cannot** use cloud sessions at all |
| GitHub access to `sydevs` | The loop reads and writes issues and PRs | Admin not required; write is enough |
| Railway account | Hosts Mailpit | Free tier is sufficient |
| Sentry org | Error surveys | Optional — the loop degrades gracefully without it |
| `gh` ≥ 2.94 locally | Native `--type`, `--parent`, `--blocked-by` | `gh --version` |

---

## 1. GitHub metadata

The loop's queue **is** GitHub metadata. Without this it has nothing to read.

### Issue types (organization level)

Settings → Organization → Planning → Issue types. Three: `Bug`, `Feature`, `Task`. These are
org-scoped and cannot be set per-repo.

### Labels (every repo, identical)

```bash
for r in SahajCloud SahajAtlasWeb WeMeditateWeb SahajAtlasWordpress claude-workflow; do
  gh label create "Critical"         --repo sydevs/$r --color b60205 --description "Drop everything: data loss, outage, or security exposure" --force
  gh label create "High"             --repo sydevs/$r --color d93f0b --description "Next up: user-visible breakage or blocks other work" --force
  gh label create "Medium"           --repo sydevs/$r --color fbca04 --description "Normal priority: the default for planned work" --force
  gh label create "Low"              --repo sydevs/$r --color d4d4d4 --description "Nice to have: do it when nothing above it is waiting" --force
  gh label create "approved"         --repo sydevs/$r --color 0e8a16 --description "Human-approved for implementation — the loop's gate" --force
  gh label create "proposal"         --repo sydevs/$r --color c2e0c6 --description "Raised by the loop, awaiting a human verdict" --force
  gh label create "hold"             --repo sydevs/$r --color e4e669 --description "Approved but paused — do not start" --force
  gh label create "needs-info"       --repo sydevs/$r --color d876e3 --description "Blocked on an answer from the maintainer" --force
  gh label create "blocked-upstream" --repo sydevs/$r --color 5319e7 --description "Waiting on an external dependency or upstream fix" --force
done
```

> ⚠ **GitHub label names are case-insensitive.** Deleting a legacy `critical` label also deletes a
> newly created `Critical` — silently, with no error. If you are also removing old labels, delete
> them **first**, then create the new set, and verify afterwards. We lost `Critical` from all four
> repos this way and only noticed on a listing.

### The Ops journal

One pinned issue per month in `claude-workflow`, labelled `ops-journal`:

```bash
gh label create "ops-journal" --repo sydevs/claude-workflow --color 0052cc --description "Run log for the autonomous loop" --force
gh issue create --repo sydevs/claude-workflow --title "Ops journal — $(date -u +%Y-%m)" --label ops-journal --body "..."
gh issue pin <n> --repo sydevs/claude-workflow
```

Record its number in `loop-config.json` → `journalIssue`.

> **Why an issue and not a Discussion or the Wiki?** Both were evaluated and neither is writable
> from a cloud session: Discussions is GraphQL-only and the session's GitHub proxy allows only a
> pinned set of GraphQL operations; the wiki is a separate git repo that cannot be attached to a
> routine. Issues are REST, and REST works.

---

## 2. Mailpit on Railway

Captures all non-production email. Replaces Ethereal, which deletes messages after a few hours —
too short for a link in a PR to survive until review.

```bash
railway login
railway link --project <project> --environment production
railway add --service mailpit --image axllent/mailpit:latest \
  --variables "MP_MAX_AGE=168h" \
  --variables "MP_DATABASE=/data/mailpit.db" \
  --variables "MP_UI_AUTH=<user>:<generated-password>" \
  --variables "MP_SMTP_AUTH=<user>:<generated-password>" \
  --variables "MP_SMTP_AUTH_ALLOW_INSECURE=true" \
  --variables "MP_MAX_MESSAGES=5000" \
  --variables "PORT=8025"

railway service mailpit
railway volume add --mount-path /data      # required: MP_DATABASE lives here, service crash-loops without it
railway redeploy --service mailpit --yes
railway domain --port 8025                 # public UI
```

Three things that are not obvious:

- **`PORT=8025` is required.** Railway routes the generated domain to `$PORT`, and Mailpit does not
  read it. Without this the UI returns `502` while the container logs look perfectly healthy.
- **The volume must exist before first successful boot.** `MP_DATABASE=/data/mailpit.db` points at
  a mount that does not exist yet, so the service crash-loops until the volume is attached.
- **`MP_SMTP_AUTH_ALLOW_INSECURE=true`** is needed because Railway's TCP proxy does not terminate
  TLS. Acceptable here: this path carries test mail to a capture inbox, never real delivery.

### SMTP ingress (TCP proxy)

Not exposed by the CLI, but the GraphQL API accepts the CLI's own token, so it needs no dashboard
visit:

```bash
TOKEN=$(python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.railway/config.json')));print(d.get('user',{}).get('token') or d.get('token'))")
curl -s https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"mutation($input: TCPProxyCreateInput!){ tcpProxyCreate(input:$input){ domain proxyPort applicationPort } }",
       "variables":{"input":{"environmentId":"<env-id>","serviceId":"<mailpit-service-id>","applicationPort":1025}}}'
```

Returns the public host and port. Assemble `SMTP_URL=smtp://<user>:<pass>@<domain>:<port>`.

### Wire it up

- `SMTP_URL` on **every Railway PR preview environment**, so preview mail is captured.
- `MAILPIT_URL`, `MAILPIT_UI_AUTH`, `SMTP_URL` into `SahajCloud/.env.claude.local` (gitignored) for
  local use, and into the Claude cloud environment for the loop.
- **Do not** put `SMTP_URL` in the tracked `.env`. It carries a credential, and SahajCloud#570 is
  an open ticket about removing committed secrets from exactly that file.

Preview environments cannot reach Resend anyway — `src/payload.config.ts` gates it on
`isProductionDeployment()` (Railway's environment name), not `NODE_ENV`, because **Railway previews
also run `NODE_ENV=production`** and used to send real mail to real addresses.

---

## 3. Sentry

Optional. Without it, `survey-sentry` journals "not configured" and skips, and rung 1's resolve
step no-ops.

1. Settings → Developer Settings → **New Internal Integration**.
2. Permissions: **Issue & Event: Read & Write**. Nothing else — `org:read` is not needed.
3. Save, then scroll to **Tokens** at the bottom and copy the token.

> ⚠ **Copy the Token, not the Client Secret.** Both are 64 hex characters and they sit on the same
> page. The Client Secret authenticates as `401 Invalid token`, which looks like a typo rather than
> the wrong field. We lost time to this.

4. Store as `SENTRY_CLAUDE_WORKFLOW_TOKEN` in the cloud environment.
5. Fill in `loop-config.json` → `sentry.org`, `sentry.projects`, and **`sentry.apiBase`**.

> ⚠ **Use the regional API host.** If the DSN reads `…ingest.de.sentry.io`, the org is on Sentry's
> DE region and the API base is `https://de.sentry.io/api/0`. The global `sentry.io` returns **404**
> for those projects — indistinguishable from a wrong project slug.

Verify before trusting it:

```bash
API=https://de.sentry.io/api/0     # or https://sentry.io/api/0
curl -s -o /dev/null -w "read: %{http_code}\n" \
  "$API/projects/<org>/<project>/issues/?query=is:unresolved&limit=1" \
  -H "Authorization: Bearer $SENTRY_CLAUDE_WORKFLOW_TOKEN"
```

`200` = working. `401` = wrong field copied. `404` = wrong region or slug. `403` on
`/organizations/<slug>/` is expected and harmless.

---

## 4. The Claude cloud environment

At **claude.ai/code → Environments → New**. UI only; there is no API for this.

**Name:** anything; note the id for the routines.

**Environment variables** (`.env` format):

```
SENTRY_CLAUDE_WORKFLOW_TOKEN=<the Token, not the Client Secret>
MAILPIT_URL=https://<mailpit-host>
MAILPIT_UI_AUTH=<user>:<password>
SMTP_URL=smtp://<user>:<password>@<proxy-host>:<port>
SAHAJCLOUD_API_KEY=<production key, for preview smoke reads>
```

> ⚠ **There is no secret store.** Anything here is readable by anyone who can use the environment.
> Scope every token to the minimum: the Sentry token is Issues-only, the SahajCloud key is a
> read-scoped client. Never put a production admin credential here.

**Setup script** (runs as root, must exit 0, ~5 min limit):

```bash
#!/bin/bash
set -e
corepack enable pnpm
service postgresql start
pg_isready -h localhost -p 5432 -t 30
```

Postgres 16 and Docker are pre-installed but **not running** — SahajCloud's integration lane needs
the service started, which is what that second line does.

**Network access:** `Full` is the practical setting. A curated allowlist is tighter, but the
implementation rung does real research — reading changelogs, upstream issues, library docs — and a
blocked host fails as an opaque `403 host_not_allowed` mid-task. If you do curate it, these are
load-bearing: `raw.githubusercontent.com` (`pnpm types:cms` fetches from it), the Sentry regional
host, the Mailpit host and TCP proxy, and `*.up.railway.app` / `*.pages.dev` / `*.workers.dev` for
preview smoke.

---

## 5. The routines

Two, both attaching all five repos, both pointing at the same skill:

| | Morning | Evening |
| --- | --- | --- |
| Cron (UTC) | `0 9 * * *` | `0 2 * * 2-6` |
| Local (PT) | 02:00 daily | 19:00 Mon–Fri |
| Rungs | 0–6 (includes the survey) | 0–4, 6 |
| Model | opus | opus |

Cron is **always UTC**; the PT equivalents shift by an hour across DST and that is accepted rather
than corrected. Minimum interval is 1 hour.

The prompt is deliberately thin — all behaviour lives in the repo, so a merged change takes effect
on the next run with no redeploy:

```
Read claude-workflow/workflow/skills/loop-run/SKILL.md and follow it exactly.
RUN_KIND=morning
Do not improvise around missing credentials or tools: journal the failure and stop.
```

Create them **disabled**, via the `RemoteTrigger` tool (`action: "create"`) or `/schedule`.

Two API quirks worth knowing:

- **`environment_id` is not validated at create time.** A nonexistent id is accepted with `HTTP 200`
  and fails only when the routine runs. Confirm the id from the `/schedule` skill's environment
  listing rather than assuming it, since it is not shown in the claude.ai UI.
- **Connectors are attached automatically.** Every MCP connector on the account gets added unless
  you pass `clear_mcp_connections: true`. The loop needs none of them — GitHub comes from the
  session proxy, Sentry and Mailpit are plain HTTPS — and each one costs context on every turn.

### Current routine ids

| Routine | Id | Schedule |
| --- | --- | --- |
| `sydevs-loop-morning` | `trig_016XeEsVa7dfSCum7t4Vmeuw` | `0 9 * * *` (02:00 PT daily) |
| `sydevs-loop-evening` | `trig_01GyUCMWmPLekwTzYL7Xzobi` | `0 2 * * 2-6` (19:00 PT Mon–Fri) |

Environment: `WeMeditate` = `env_0132ox9g3YUmZVB8GjQrJKoR`. Manage at
<https://claude.ai/code/routines> — the API cannot delete a routine.

---

## 6. Supervised bootstrap

Do not schedule straight away. For ~3 days:

1. Fire manually (`RemoteTrigger` `action: "run"`).
2. Read the journal entry **and** the transcript (`list_runs` → `get_run_log`).
3. Fix what it got wrong; merge; the next run picks it up.

Cover one of each deliberately: a merge, a PR revision, an implementation, a survey.

> **A green run status only means no infrastructure error.** Task-level failures, blocked network
> requests and missing tools appear *only* in the transcript and the journal. That asymmetry is why
> rung 6 exists and why its "Failed" line is never softened.

Then set `enabled: true` on both.

---

## 7. Verification checklist

- [ ] Every open issue has exactly one type and one priority
- [ ] `gh issue list --label approved` returns only things you approved
- [ ] Mailpit UI: `200` with credentials, `401` without
- [ ] A message sent through the SMTP proxy appears, and its `/view/<id>` link resolves
- [ ] Sentry: read `200` on every project; `PUT /issues/<id>/` `200`
- [ ] Cloud session: `service postgresql start` works, `pnpm test:unit` passes in SahajCloud
- [ ] `gh issue edit <n> --add-blocked-by "<full URL>"` works from a cloud session
- [ ] A dry-run of the ladder produces a correct worklist against the real backlog
- [ ] One full cycle observed: proposal → approve → PR → review → revision → merge

---

## Failure modes worth recognising

| Symptom | Cause |
| --- | --- |
| `railway` exits 1 silently, even `--help` | pnpm blocked the postinstall that downloads the binary. `pnpm approve-builds -g`, or run `npm-install/postinstall.js` by hand |
| Mailpit UI `502`, container logs healthy | `PORT` not set to `8025` |
| Mailpit crash-loops on first deploy | Volume not attached at `/data` |
| Sentry `401 Invalid token` | Client Secret copied instead of Token |
| Sentry `404` on a project that exists | Wrong regional host |
| Plugin installs but reports `disabled` | `enabledPlugins` written as an array; it must be an object map |
| Cross-repo `--add-blocked-by` "invalid issue format" | Needs the full URL, not `owner/repo#N` |
| A newly created label vanishes | Case-insensitive collision with a label deleted in the same run |
| Loop implements nothing, no error | Correct — nothing carries `approved`. That is the gate working |
