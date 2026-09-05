# Bootstrap the loop on a new Claude account

Everything needed to rebuild the autonomous loop from nothing: a new Claude account, a fresh
Railway project, a new Sentry org, or all three. The pieces live in five different dashboards, and
none of them is discoverable from the repo.

**Time:** about 45 minutes, most of it waiting for deploys.
**Order matters.** Each section needs an identifier the one before it produced.

---

## 0. Prerequisites

| Thing | Why | Notes |
| --- | --- | --- |
| Claude Pro/Max/Team account | Routines are cloud sessions | Zero-Data-Retention orgs **cannot** use cloud sessions at all |
| GitHub access to `sydevs` | The loop reads and writes issues and PRs | Admin not required. Write access is enough |
| Railway account | Hosts Mailpit | Free tier is sufficient |
| Sentry org | Error surveys | Optional — the loop degrades gracefully without it |
| `gh` ≥ 2.94 locally | Native `--type`, `--parent`, `--blocked-by` | `gh --version` |

---

## 0b. A machine account for the loop

**Do this before anything else touches GitHub.** A routine acts as whatever GitHub account is
connected to the Claude account, with no per-routine identity and no GitHub App option. If that
account is a human's, the loop cannot tell its own comments from that person's, and the rung that
answers maintainer feedback replies to itself. Found, not theorized, on this project's second
supervised run.

1. Create a GitHub account used only by the loop — `sydevs-bot`. GitHub's Terms permit one free
   machine account alongside a personal account, registered by a human who accepts the Terms for it.
2. Enable 2FA on it.
3. Invite it to the org with **write** access to every repo the loop touches, and accept from the
   bot account. Public repos consume no seat.
4. Connect it as the Claude account's GitHub identity: `/web-setup` from a terminal signed in as
   the bot, or the browser flow at claude.ai/code in a private window.
5. Verify from a routine: `mcp__github__get_me` must return the bot's login, not a person's.

> ⚠ Every cloud session on that Claude account then acts as the bot, not just routines. Local
> sessions stay unaffected — cloud as the bot, local as the human, is the intended split.

> ⚠ A machine account is `type: User`, not `type: Bot`. Only a GitHub App gets the `[bot]` suffix,
> and a routine cannot act as one. Filter by **login**, never by `type`.

**Switching identity later leaves residue.** Comments the loop already wrote keep the old login, so
the loop reads them as human feedback. This is bounded and one-time, not worth a dated exclusion
rule.

## 1. GitHub metadata

The loop's queue **is** GitHub metadata. Without this it has nothing to read.

### Issue types (organization level)

Settings → Organization → Planning → Issue types. Three: `Bug`, `Feature`, `Task`. These are
org-scoped and cannot be set per-repo.

### Issue fields (organization level)

Four GitHub **native org-level issue fields** — not Projects v2, not labels. Configure them once, at
**Settings → Organization → Planning → Issue fields**. They then apply to every repository, with no
per-repo setup.

| Field | Type | Options |
| --- | --- | --- |
| Priority | single select | Critical · High · Medium · Low |
| Effort | single select | Easy · Moderate · Hard |
| Stage | single select | Proposed · Revising · Blocked · Implement · Implemented |
| Hold Until | date | — |

Creating them from the CLI needs `admin:org`. Every select **option** needs `name`, `color`, and
`priority` (omitting `priority` returns `422 object is missing required key: priority`). Valid
colors: `gray`, `blue`, `green`, `yellow`, `orange`, `red`, `pink`, `purple`.

```bash
gh api -X POST orgs/<org>/issue-fields --input - <<'JSON'
{"name":"Stage","data_type":"single_select","options":[
  {"name":"Proposed","color":"blue","priority":1},
  {"name":"Revising","color":"yellow","priority":2},
  {"name":"Blocked","color":"gray","priority":3},
  {"name":"Implement","color":"green","priority":4},
  {"name":"Implemented","color":"purple","priority":5}]}
JSON
gh api -X POST orgs/<org>/issue-fields -f name='Hold Until' -f data_type=date
```

> ⚠ **`Status` and `State` are reserved names** — both return
> `422 Name cannot have a reserved value`. That is why the field is called `Stage`.

```bash
gh api orgs/<org>/issue-fields --jq '.[] | "\(.name) id=\(.id) \([.options[]?.name]|join("/"))"'
```

Record the ids in `loop-config.json` → `issueFields`. To set a value locally:

```bash
gh api -X PUT repos/OWNER/REPO/issues/N/issue-field-values --input - <<< \
  '[{"field_id":14337938,"value":"High"}]'
```

> ⚠ The `value` must be the option **name**. Passing an option id returns
> `422 must be a string option name`. The endpoint is `issue-field-values` (hyphens), and it takes
> a **top-level array**. `PATCH`ing the issue itself with a `fields` key returns 200 and silently
> does nothing.

> ⚠ **The PUT replaces the issue's entire field-value set.** A PUT carrying only Priority silently
> clears Stage, Effort and Hold Until. Send every value you want kept, or use the single-field
> `DELETE .../issue-field-values/<field_id>` to clear just one.

A routine reads field values with `list_issues(fields:["field_values"])`, one call per repo. It
writes them with `issue_write`: `field_option_name` for a select, `value` for a date (ISO
`YYYY-MM-DD`), `delete:true` to clear one field without disturbing the others.

> ⚠ **Fields are not searchable through REST.** See `workflow/skills/preflight/SKILL.md` for the
> rule and the worklist-query pattern this forces.

### Labels (every repo, identical)

**There are two: `ops-journal` and `awaiting`** (see the board section below). Everything else the
loop reads about a ticket is a field or the assignee. Type is a native issue type. Six older ticket
labels are now retired, replaced by `Stage` and `Hold Until`.

### The Ops journal

One issue **per day** in `claude-workflow`, labelled `ops-journal`, created lazily by the first run
of the day — nothing to pre-create beyond the label:

```bash
gh label create "ops-journal" --repo sydevs/claude-workflow --color 0052cc --description "Run log for the autonomous loop" --force
```

The run finds today's issue by matching its **creation date** to the current Vancouver day. The
title is a rewritten headline, never the key. **Journals are not pinned** — a routine's GraphQL
access cannot reach `pinIssue` — so recency surfaces the current journal instead. The weekly
reflection closes the week's journals.

### The workflow board and the state machine

One org project — **[`Claude Workflow`, sydevs/projects/2](https://github.com/orgs/sydevs/projects/2)**
(`projects` in `loop-config.json`) — holds every open issue and PR across the five repos. Issues are
grouped by `Stage`, PRs by the project's own `Status`, and `awaiting` marks anything needing a
human. **The loop neither reads nor writes the board** (why: `docs/why.md#the-board-is-a-lens`).

**One workflow maintains all of it.** `.github/workflows/state-machine.yml` in this repo is a
`workflow_call` reusable workflow. Every repo, including this one, carries a ~20-line
`workflow-state.yml` that calls it: one copy of the rules, five callers, no drift.

```yaml
jobs:
  state:
    uses: sydevs/claude-workflow/.github/workflows/state-machine.yml@main
    secrets:
      token: ${{ secrets.ADD_TO_PROJECT_PAT }}
```

**The token.** Org Actions secret `ADD_TO_PROJECT_PAT` — a `sydevs-bot` fine-grained PAT with repo
**Issues: read/write**, **Pull requests: read/write**, and org **Projects: read/write**. It is used
throughout, since whether the default `GITHUB_TOKEN` covers the org-level field endpoint is
undocumented. A credentials error on a repo's runs usually means its access policy excludes this
secret.

> ⚠ **Recursion is bounded by idempotency, not by an actor guard.** The workflow's own writes
> re-fire `field_added`, but every writer checks current state first and skips a no-op match — one
> free extra run, nothing more. **Never add `if: github.actor != 'sydevs-bot'`.** The bot authors
> its own issues and PRs, so that guard would skip the transitions that matter most.

**Labels — there are two**, identical in every repo:

```bash
gh label create "ops-journal" --repo sydevs/<repo> --color 0052cc --description "Run log for the autonomous loop" --force
gh label create "awaiting"    --repo sydevs/<repo> --color D93F0B --description "A human is needed. The primary signal — maintained by the state-machine workflow." --force
```

**One-time UI configuration** (built-in project workflows and views have no API):

1. Project **⚙ Settings → Manage access**: `sydevs-bot` needs **write**.
2. **Workflows** sidebar — enable and map:
   | Workflow | Set |
   | --- | --- |
   | Item added to project · Item reopened | Status: **In progress** |
   | Code changes requested | Status: **Changes requested** |
   | Code review approved | Status: **Approved** |
   | Pull request merged · Item closed | Status: **Done** |
   | Auto-archive items | `is:closed updated:<2weeks` (optional) |

   Auto-add is **not** used. The reusable workflow adds items in every repo. The free plan's single
   auto-add slot could not.
3. **Views**:
   | View | Layout | Filter |
   | --- | --- | --- |
   | 🙋 Awaiting you | Table | `label:awaiting` — **the primary view** |
   | 🎫 Pipeline | Board, group by **Stage** | `is:issue has:stage` |
   | 🔀 Pull requests | Board, group by **Status** | `is:pr` |
   | 📥 Backlog | Table, sort Priority | `is:issue no:stage` |
   | ⏸ Parked | Table, sort **Hold Until** | `stage:Blocked` |

`Status` options were renamed via GraphQL to `In progress · Changes requested · Approved · Done`.
`Status` is per-project-item and GraphQL-only, which is why ticket state lives in the `Stage`
**issue field** instead: REST-writable, board-visible, one source of truth.

> **Why an issue, not a Discussion or the Wiki?** Neither is writable from a cloud session —
> Discussions is GraphQL-only and the proxy serves only pinned GraphQL operations, and the wiki is
> a separate git repo a routine cannot attach to. Issues use REST, and REST works.

---

## 2. Mailpit on Railway

Captures all non-production email. Replaces Ethereal, which deleted messages after a few hours —
too short for a PR link to survive until review.

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

Three traps:

- **`PORT=8025` is required.** Railway routes the generated domain to `$PORT`. Mailpit does not read
  it. Without this the UI returns `502`, while the container logs look healthy.
- **The volume must exist before the first successful boot.** `MP_DATABASE=/data/mailpit.db` points
  at a mount that does not exist yet, so the service crash-loops until the volume attaches.
- **`MP_SMTP_AUTH_ALLOW_INSECURE=true`** is needed because Railway's TCP proxy does not terminate
  TLS. Acceptable here — this path carries test mail to a capture inbox, never real delivery.

### SMTP ingress (TCP proxy)

The CLI does not expose this, but its GraphQL API accepts the CLI's own token, so no dashboard
visit is needed:

```bash
TOKEN=$(python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.railway/config.json')));print(d.get('user',{}).get('token') or d.get('token'))")
curl -s https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"mutation($input: TCPProxyCreateInput!){ tcpProxyCreate(input:$input){ domain proxyPort applicationPort } }",
       "variables":{"input":{"environmentId":"<env-id>","serviceId":"<mailpit-service-id>","applicationPort":1025}}}'
```

Returns the public host and port. Assemble `SMTP_URL=smtp://<user>:<pass>@<domain>:<port>`.

### Wire it up

- Add `SMTP_URL` to **every Railway PR preview environment**, so preview mail is captured.
- Add `MAILPIT_URL`, `MAILPIT_UI_AUTH`, `SMTP_URL` to `SahajCloud/.env.claude.local` (gitignored)
  for local use, and to the Claude cloud environment for the loop.
- **Never** put `SMTP_URL` in the tracked `.env`. It carries a credential (SahajCloud#570 tracks
  removing committed secrets from that file).

Preview environments cannot reach Resend anyway. `src/payload.config.ts` gates it on
`isProductionDeployment()` (Railway's environment name), not `NODE_ENV`. Railway previews also run
`NODE_ENV=production`, and once sent real mail to real addresses.

---

## 3. Sentry

Optional. Without it, `survey-sentry` journals "not configured" and skips, and rung 1's resolve
step no-ops.

1. Settings → Developer Settings → **New Internal Integration**.
2. Permissions: **Issue & Event: Read & Write**. Nothing else — `org:read` is not needed.
3. Save, then scroll to **Tokens** at the bottom and copy the token.

> ⚠ **Copy the Token, not the Client Secret.** Both are 64 hex characters on the same page. The
> Client Secret fails as `401 Invalid token`, which reads as a typo, not the wrong field.

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

At **claude.ai/code → Environments → New**. UI only — there is no API for this.

**Name:** anything. Note the id for the routines.

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

# --- PostgreSQL for SahajCloud's integration lane (67 files, ~4 min) ---
# Best-effort BY DESIGN: a database failure must degrade to "integration lane
# unavailable this session", never abort the session — a setup script that
# exits non-zero kills the run at zero turns.
#
# The image ships a Debian PACKAGE cluster at /var/lib/postgresql/16/main
# whose PG_VERSION exists but whose config lives in /etc/postgresql/16/main —
# a half-cluster that pg_ctl -D cannot start. So we build our own cluster in
# a directory we fully own and ignore the package one. /var/run/postgresql is
# Debian's compiled-in socket dir and must exist. The result matches
# SahajCloud's DEFAULT_TEST_DATABASE_URL
# (postgresql://postgres:postgres@localhost:5432/payload_test): no env var.
setup_pg() {
  set -e
  PGBIN=/usr/lib/postgresql/16/bin
  PGDATA=/var/lib/postgresql/loop
  id postgres >/dev/null 2>&1 || useradd -m postgres
  install -d -o postgres -g postgres /var/run/postgresql "$PGDATA"
  [ -s "$PGDATA/PG_VERSION" ] || su postgres -c "$PGBIN/initdb -D $PGDATA --auth=trust -U postgres"
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l /tmp/postgres.log start"
  "$PGBIN/pg_isready" -h 127.0.0.1 -t 30
  su postgres -c "$PGBIN/createdb -U postgres payload_test" 2>/dev/null || true
}
if ! ( setup_pg ); then
  echo "WARNING: Postgres bring-up failed — integration lane unavailable this session"
  cat /tmp/postgres.log 2>/dev/null || true
fi
```

Three rules in that script, each bought with a dead run and commented in place above: best-effort
only, never `set -e`, across the database block. A private cluster directory, never the package's
half-configured one. `/var/run/postgresql` created before `pg_ctl` starts.

⚠ **A routine cannot reach the GitHub API, by any client, with or without a credential.** Not `gh`
(it is not in the routine image), not raw HTTP. `git`, `jq`, `yq`, `ripgrep`, and `node` (v22) are
present, and `git` fetch and push work through the credential helper. Everything else GitHub-shaped
goes through the MCP tools only — a script never fetches from GitHub itself. Full evidence and the
proxy mechanism live in `docs/why.md#a-routine-cannot-reach-the-github-api`. Do not re-test this.

**GitHub access** is the piece most likely to be missing, and its failure looks like something
else. An unconnected session 403s on every `gh` call with `GitHub access is not enabled for this
session`. Connect it one of two ways, either sufficient:

| Method | How |
| --- | --- |
| **`/web-setup`** | Run it in a local terminal. It syncs your local `gh` token to your Claude account, and the session then acts as *your* GitHub identity. |
| **Claude GitHub App** | Authorize it during web onboarding at claude.ai/code. |

> ⚠ Installing the Claude GitHub App **on the organization** does not fix a 403, even though the
> error message suggests it. App installation enables PR webhooks. It grants no session-level
> access.

Whichever method you use sets **which GitHub account the loop acts as** — every issue, comment, and
PR it creates is attributed to that identity. Check it with `gh api user --jq .login`.

**Network access:** set `Full`. The implementation rung does real research — changelogs, upstream
issues, library docs — and a curated allowlist fails as an opaque `403 host_not_allowed` mid-task.
If you do curate it, `raw.githubusercontent.com`, the Sentry regional host, the Mailpit host and TCP
proxy, and `*.up.railway.app` / `*.pages.dev` / `*.workers.dev` are load-bearing.

---

## 5. The routines

Two routines, split by **function** rather than time of day. Both attach all five repos, each
pointing at its own skill, and both skills start with `/workflow:preflight` and end with
`/workflow:journal`:

| | `sydevs-work-hourly` | `sydevs-survey-nightly` |
| --- | --- | --- |
| Cron (UTC) | `0 1,12,13,14,15,16,17,18,19,21,23 * * *` | `0 8 * * *` |
| Local (PT) | hourly 05:00–12:00, then 14:00 · 16:00 · 18:00 | 01:00 |
| Skill | `work-routine` (the ladder, rungs 1–5) | `survey-routine` (survey, reconciliation sweeps) |
| Model | opus | opus |

The split guarantees the survey runs daily. As a low rung it could otherwise starve for days on a
busy queue, which is why survey-routine is **not** a ladder and has no rungs
(`docs/why.md#the-survey-routine-is-not-a-ladder`). It also carries the unheard-replies sweep,
which would re-flag the same items on every pass if it lived in the hourly loop instead.

Cron stays in **UTC**. The PT equivalents shift by an hour across DST, and that drift is accepted,
not corrected. Minimum interval is 1 hour. Mornings run hourly, since that is when the maintainer
reviews and replies land while the conversation is warm. Afternoons drop to every two hours. Eleven
small runs beat two large ones: smaller blast radius per failure, and most runs find an empty queue
and exit cheaply.

The prompt stays thin on purpose. All behaviour lives in the repo, so a merged change takes effect
on the next run with no redeploy. It names the skill, warns that restated rules go stale, and says
how to end. It enumerates nothing:

```
Read `claude-workflow/workflow/skills/work-routine/SKILL.md` and follow it exactly. It is the
single source of truth for this run — the complete specification, including every hard rule — and
it begins with the shared `preflight` skill and ends with the shared `journal` skill.
`claude-workflow/loop-config.json` holds the ceilings, labels, assignment and identity it refers
to. Read both before acting.

This prompt deliberately restates none of the rules. Earlier versions did, and the copies went
stale twice — once naming a config key that had been deleted, once retaining an instruction after
the rule changed. If this prompt and the skill ever disagree, **the skill wins, and journal the
discrepancy.**

Then stop. Do not try to end the session — you cannot, and lingering is expected. Just do not
leave anything that could wake you.
```

— identical for `sydevs-survey-nightly` with `survey-routine/SKILL.md` as the path.

Create them **disabled**, with the `RemoteTrigger` tool (`action: "create"`) or `/schedule`.

Two API quirks:

- **`environment_id` is not validated at create time.** A nonexistent id returns `HTTP 200` and
  fails only when the routine runs. Confirm it from the `/schedule` skill's environment listing —
  the claude.ai UI does not show it.
- **Connectors attach automatically.** Every MCP connector on the account gets added, unless you
  pass `clear_mcp_connections: true`. The loop needs none of them: GitHub comes from the session
  proxy, Sentry and Mailpit are plain HTTPS, and each connector costs context on every turn.

### Current routine ids

| Routine | Id | Schedule |
| --- | --- | --- |
| `sydevs-survey-nightly` | `trig_01WzJ2EnTKEk9BJ2Xf6AQ4x6` | `0 8 * * *` (01:00 PT daily) |
| `sydevs-work-hourly` | `trig_01BUwH4WjazMXjG2bnC3TVRL` | `0 1,12,13,14,15,16,17,18,19,21,23 * * *` (hourly 05:00–12:00 PT, then 14/16/18) |

Environment: `WeMeditate` = `env_0132ox9g3YUmZVB8GjQrJKoR`. Manage at
<https://claude.ai/code/routines> — the API cannot delete a routine.

---

## 6. Supervised bootstrap

Do not schedule straight away. For ~3 days:

1. Fire manually (`RemoteTrigger` `action: "run"`).
2. Read the journal entry **and** the transcript (`list_runs` → `get_run_log`).
3. Fix what it got wrong. Merge. The next run picks it up.

Cover one case of each on purpose: a merge, a PR revision, an implementation, an adversarial
review, a survey.

> **A green run status only means no infrastructure error.** Task-level failures, blocked network
> requests, and missing tools show up only in the transcript and the journal. That is why the
> journal exists, and why its "Failed" line is never softened.

Then set `enabled: true` on both.

---

## 7. Verification checklist

- [ ] Every open issue has exactly one type, one priority, and an effort
- [ ] Only issues you cleared are at `Stage: Implement`, and every `Blocked` one has a `Hold Until`
- [ ] Mailpit UI: `200` with credentials, `401` without
- [ ] A message sent through the SMTP proxy appears, and its `/view/<id>` link resolves
- [ ] Sentry: read `200` on every project, and `PUT /issues/<id>/` returns `200`
- [ ] Cloud session: `pg_isready` reports the cluster up, and `pnpm test:int` passes in SahajCloud (67 files)
- [ ] `gh issue edit <n> --add-blocked-by "<full URL>"` works from a cloud session
- [ ] A dry-run of the ladder produces a correct worklist against the real backlog
- [ ] One full cycle observed: Proposed → Implement → draft PR → ready for review → review → revision → merge

---

## Issue Relationships are unreachable from a routine

GitHub calls these **Relationships** (REST: `dependencies/blocked_by`, `dependencies/blocking`). No
MCP tool in a routine's build exposes them. Every tested route to a second GitHub MCP connection
fails at the same wall: a session cannot open one, since the required path is not repository-scoped
and the proxy refuses it during the handshake.

Set Relationships from a local session with `gh`, then mirror the same fact into the issue body as
a `Blocked by: <url>` line, so a cloud run can grep it. `workflow/skills/triage-issue/SKILL.md`
holds the exact commands and the body-marker format — this file only flags that the mechanism
exists and where it lives.

Issue **fields** have no such problem: `list_issue_fields`, `issue_read.field_values`,
`list_issues(fields:["field_values"])`, and `issue_write(issue_fields:[...])` all work from a
routine. Priority, Effort, Stage, and Hold Until are fully readable and writable, just not
searchable (see above).

## Webhook triggers were evaluated and rejected

`RemoteTrigger` exposes `create_webhook_trigger`, which can fire a routine from a GitHub event.
Tested against a live trigger, then **not adopted** — recorded here so nobody re-derives it.

The API validates almost nothing, and silently drops fields it does not recognize, including a
`filter` key sent during testing. **There is no author filtering**: every matching event fires the
routine, including events the bot itself generates, so an infinite-loop guard would have to live in
the handler, not the trigger. Subscribing to `pull_request` or `issues` is also all-or-nothing per event type. Every
`synchronize`, `labeled`, and `edited` would fire a handler. A review-thread reply also fires a
different event than an approval does, so the most common follow-up is the easiest to miss. The
baton model already polls cheaply enough that four webhook triggers, and this new failure mode,
were not worth it.

A live test trigger, `a84a3cd8-2f99-4173-a266-1219e6f91f89`, still points at the disabled routine
`zz-webhook-probe2-DELETEME`. No API deletes a webhook trigger. Delete the owning routine instead.

## Failure modes worth recognising

| Symptom | Cause |
| --- | --- |
| Every `gh` call 403s: "GitHub access is not enabled for this session" | The account's GitHub connection is missing. Run `/web-setup`, or authorize the Claude GitHub App. Installing the App **on the org** does not fix this. |
| `gh` reports "The token in GH_TOKEN is invalid" | Expected — the proxy handles auth, and `GH_TOKEN` reads as the literal `proxy-injected`. Only a real 403 signals a problem. |
| `gh issue list --json issueType` 403s | It routes through GraphQL, and the proxy serves only pinned PR-review operations. Use the REST form. |
| `railway` exits 1 silently, even `--help` | pnpm blocked the postinstall that downloads the binary. Run `pnpm approve-builds -g`, or run `npm-install/postinstall.js` by hand. |
| Mailpit UI `502`, container logs healthy | `PORT` not set to `8025`. |
| Mailpit crash-loops on first deploy | Volume not attached at `/data`. |
| Sentry `401 Invalid token` | Client Secret copied instead of Token. |
| Sentry `404` on a project that exists | Wrong regional host. |
| Plugin installs but reports `disabled` | `enabledPlugins` written as an array. It must be an object map. |
| Cross-repo `--add-blocked-by` "invalid issue format" | Needs the full URL, not `owner/repo#N`. |
| A newly created label vanishes | Case-insensitive collision with a label deleted in the same run. |
| The loop answers review feedback but pushes nothing | It can only push to `claude/*`, never a human's branch. It opens a stacked PR into that branch instead. |
| A `<details>` block seems missing on MCP readback | The write landed. MCP's **read** path strips `<details>`/`<summary>` (keeping `<table>`, `<sub>`, `<a>`). REST shows the tags intact. Trust the write's 200. Never re-post. |
| A run dies in seconds, `Setup script failed`, zero turns | The setup script exited non-zero, so the session never started. Keep optional dependencies best-effort (see the Postgres traps above). |
| A `search_issues` query returns zero unexpectedly | The `>` in `updated:>…` was HTML-escaped to `&gt;`. It fails silently, with no error. |
| Loop implements nothing, no error | Correct. Nothing is both assigned to the bot and at `Stage: Implement` — the gate is working. |
