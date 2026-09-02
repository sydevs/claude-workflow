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

## 0b. A machine account for the loop

**Do this before anything else touches GitHub.** A routine acts as whatever GitHub account is
connected to the Claude account — the routines docs are explicit: *"Anything a routine does through
your connected GitHub identity appears as you."* There is no per-routine identity and no GitHub App
option.

If that connected account is a human's, the loop **cannot tell its own comments from that person's**,
and the rung that answers maintainer feedback will reply to itself. This is not theoretical: it was
found on the second supervised run here.

1. Create a GitHub account used only by the loop — `sydevs-bot`. GitHub's Terms permit this
   explicitly: *"no more than one free machine account in addition to a free personal account"*,
   set up by a human who accepts the Terms on its behalf.
2. Enable 2FA on it.
3. Invite it to the org with **write** access to every repo the loop touches, and accept from the
   bot account. Public repos consume no seat.
4. Connect it as the Claude account's GitHub identity — `/web-setup` from a terminal signed in as
   the bot, or the browser flow at claude.ai/code in a private window.
5. Verify from a routine: `mcp__github__get_me` must return the bot's login, not a person's.

> ⚠ Every cloud session on that Claude account then acts as the bot, not just routines. Local
> sessions are unaffected. The resulting split — cloud = bot, local = human — is the intended shape.

> ⚠ A machine account is `type: User`, not `type: Bot`; only a GitHub App gets the `[bot]` suffix,
> and routines cannot act as one. So filter by **login**, never by `type`.

**Switching identity later leaves residue.** Comments the loop already wrote keep the old login
permanently, so it will read them as human feedback. Bounded and one-time; not worth a dated
exclusion rule that would misfire once the previous account comments for real.

## 1. GitHub metadata

## 1. GitHub metadata

The loop's queue **is** GitHub metadata. Without this it has nothing to read.

### Issue types (organization level)

Settings → Organization → Planning → Issue types. Three: `Bug`, `Feature`, `Task`. These are
org-scoped and cannot be set per-repo.

### Issue fields (organization level)

Priority and Effort are GitHub's **native org-level issue fields** — not Projects v2, not labels.
Configure once for the org at **Settings → Organization → Planning → Issue fields**; they then apply
to every repository with no per-repo setup.

| Field | Type | Options |
| --- | --- | --- |
| Priority | single select | Critical · High · Medium · Low |
| Effort | single select | Easy · Moderate · Hard |

```bash
gh api orgs/<org>/issue-fields --jq '.[] | "\(.name) id=\(.id) \([.options[]?.name]|join("/"))"'
```

Record the ids in `loop-config.json` → `issueFields`. Setting a value locally:

```bash
gh api -X PUT repos/OWNER/REPO/issues/N/issue-field-values --input - <<< \
  '[{"field_id":14337938,"value":"High"}]'
```

> ⚠ The `value` must be the option **name**. Passing an option id returns
> `422 must be a string option name`. The endpoint is `issue-field-values` (hyphens) and takes a
> **top-level array**; `PATCH`ing the issue itself with a `fields` key returns 200 and silently
> does nothing.

Field values are reachable from a routine: `list_issues(fields:["field_values"])` returns the whole
backlog's priorities in one call, and `issue_write(issue_fields:[{field_name, field_option_name}])`
sets them.

### Labels (every repo, identical)

Labels carry **pipeline state only** — priority and effort are fields, and type is a native issue
type. Keeping a priority label alongside the field is a second source of truth for the same fact.

### The Ops journal

One issue **per day** in `claude-workflow`, labelled `ops-journal`, created lazily by the first run
of the day — nothing to pre-create beyond the label:

```bash
gh label create "ops-journal" --repo sydevs/claude-workflow --color 0052cc --description "Run log for the autonomous loop" --force
```

The run finds today's issue by matching the issue's **creation date** to the current Vancouver day (the
title is a rewritten headline, so it is never the key). **Journals are not pinned** — `pinIssue` is
GraphQL-only and a routine's GraphQL serves only PR-review operations, so the call cannot succeed
from the loop. Recency surfaces the current journal instead. The weekly reflection closes the
week's journals.

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

Three rules in that script each bought with a dead run:

- **Best-effort, never `set -e` across the database block.** A setup script that exits non-zero
  aborts the session at zero turns — no census, no journal. A missing test database is worth a
  warning, not the whole run.
- **Own cluster directory, never the package's.** `/var/lib/postgresql/16/main` has `PG_VERSION`
  but no `postgresql.conf` (Debian keeps config in `/etc/postgresql/16/main`), so any script that
  checks `PG_VERSION` and then `pg_ctl -D`s the data dir starts a half-cluster and dies.
- **`/var/run/postgresql` must exist** — the socket directory is compiled into Debian's binaries —
  and the postgres log is `cat`ed on failure, because the container is gone by the time anyone reads
  the abort message.

⚠ **`gh` is NOT in the routine image, and neither is raw GitHub HTTP.** An earlier revision of this
line claimed it ships at `/usr/bin/gh` v2.98.0; that was wrong, and it is the kind of wrong that
costs a day — it reads as a licence to write scripts that shell out to `gh`, which then pass every
local test and fail silently in the only environment that matters.

Measured in a routine on 2026-09-02:

| Call | Result |
| --- | --- |
| `command -v gh`, `ls /usr/bin/gh`, `find / -name gh -type f` | absent; nothing on the filesystem |
| `curl https://api.github.com/user` | **200** — returns the bot's login |
| `curl https://api.github.com/repos/<any in-session repo>` | **403** |
| `curl https://api.github.com/graphql` | **403** — *"only the pinned set of PR-review operations is served"* |
| `mcp__github__*` | **works**, and is scoped to the session's configured repositories |
| `curl` to `example.com`, `de.sentry.io`, Railway, `raw.githubusercontent.com`, `codeload.github.com` | **all reachable** — only GitHub's API is gated |

`api.github.com` connects to `peer=127.0.0.1` behind a certificate issued by `CN=CCR Upstream Proxy
CA (staging); O=Anthropic` — a TLS-intercepting proxy (`CCR_AGENT_PROXY_ENABLED`,
`NODE_EXTRA_CA_CERTS`) that allowlists by **path, not credential**. Bringing your own PAT does not
change the answer; it was tested with a deliberately invalid one and drew the identical 403, and
`GH_TOKEN` in the sandbox reads as the literal string `proxy-injected`. **Connecting the Claude
GitHub App for the org — what the 403 asks for — was tried and changed nothing.**

Two further refusals, which no amount of repo access would lift:

| Path | Message |
| --- | --- |
| `search/issues` | "sessions are bound to their configured repositories. Use repository-scoped endpoints" |
| `graphql` | "only the pinned set of PR-review operations is served" |

Search is cross-repository by nature and a session is bound to its repositories, so **the loop's
worklist can only ever be an MCP call.** Do not spend another afternoon on this; the probes are
recorded in `docs/why.md#a-routine-cannot-reach-the-github-api`.

So a routine reaches GitHub **only through the MCP tools**. `/user` answering 200 while every
`repos/...` path 403s is the trap: it makes the token look fine and the repo look missing, when the
proxy is refusing the path. `git` fetch and push do work — those go through the credential helper,
not the API.

`git`, `jq`, `yq`, `ripgrep` and `node` (v22) **are** present. Anything a script needs from GitHub
must therefore be handed to it, not fetched by it.

**GitHub access** — the piece most likely to be missing, and it fails in a way that looks like
something else. A session whose GitHub connection is not set up 403s on *every* `gh` call with
`GitHub access is not enabled for this session`, while `gh auth status` separately reports the
token invalid because `GH_TOKEN` reads as the literal string `proxy-injected`.

Two ways to connect, per the docs, and **either is sufficient**:

| Method | How |
| --- | --- |
| **`/web-setup`** | Run it in a local terminal; it syncs your local `gh` token to your Claude account. Best if you already use `gh` — and the session then acts as *your* GitHub identity |
| **Claude GitHub App** | Authorize it during web onboarding at claude.ai/code |

> ⚠ **Installing the Claude GitHub App on the organization is not the fix**, however much the error
> message sounds like it. The docs are explicit: a cloud session "can access any repository the
> connecting GitHub account can see, not just the repositories the Claude GitHub App is installed
> on. App installation enables PR webhooks for Auto-fix; **it is not a session-level access
> control**." We had the App installed org-wide with write permissions and every call still 403'd.

Whichever you choose determines **which GitHub account the loop acts as** — every issue, comment
and PR it creates is attributed to that identity. Check it from a session with
`gh api user --jq .login`.

**Network access:** `Full` is the practical setting. A curated allowlist is tighter, but the
implementation rung does real research — reading changelogs, upstream issues, library docs — and a
blocked host fails as an opaque `403 host_not_allowed` mid-task. If you do curate it, these are
load-bearing: `raw.githubusercontent.com` (`pnpm types:cms` fetches from it), the Sentry regional
host, the Mailpit host and TCP proxy, and `*.up.railway.app` / `*.pages.dev` / `*.workers.dev` for
preview smoke.

---

## 5. The routines

Two, split by **function** rather than by time of day, both attaching all five repos, both
pointing at the same skill:

| | `sydevs-loop` | `sydevs-survey-nightly` |
| --- | --- | --- |
| Cron (UTC) | `0 1,12,13,14,15,16,17,18,19,21,23 * * *` | `0 8 * * *` |
| Local (PT) | hourly 05:00–12:00, then 14:00 · 16:00 · 18:00 | 01:00 |
| RUN_KIND | `loop` | `nightly` |
| Rungs | 0–5, 7 | 6, the reconciliation sweeps, 7 |
| Model | opus | opus |

The split guarantees the survey runs daily — as a rung below merge/revise/implement it could be
starved for days by a busy queue with nothing looking wrong. The nightly run also carries the
dropped-baton and stale-claim sweeps, which would re-flag the same items on every pass if they
lived in the two-hourly loop.

Cron is **always UTC**; the PT equivalents shift by an hour across DST and that is accepted rather
than corrected. Minimum interval is 1 hour. The morning is hourly because that is when the
maintainer reviews — replies land within the hour while the conversation is warm; afternoons drop
to every two hours. Eleven small runs beat two large ones: smaller blast radius per failure,
fresher context per item, and most runs find an empty queue and exit cheaply.

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
| `sydevs-survey-nightly` | `trig_016XeEsVa7dfSCum7t4Vmeuw` | `0 8 * * *` (01:00 PT daily) |
| `sydevs-loop` | `trig_01GyUCMWmPLekwTzYL7Xzobi` | `0 1,12,13,14,15,16,17,18,19,21,23 * * *` (hourly 05:00–12:00 PT, then 14/16/18) |

Environment: `WeMeditate` = `env_0132ox9g3YUmZVB8GjQrJKoR`. Manage at
<https://claude.ai/code/routines> — the API cannot delete a routine.

---

## 6. Supervised bootstrap

Do not schedule straight away. For ~3 days:

1. Fire manually (`RemoteTrigger` `action: "run"`).
2. Read the journal entry **and** the transcript (`list_runs` → `get_run_log`).
3. Fix what it got wrong; merge; the next run picks it up.

Cover one of each deliberately: a merge, a PR revision, an implementation, an adversarial review,
a survey.

> **A green run status only means no infrastructure error.** Task-level failures, blocked network
> requests and missing tools appear *only* in the transcript and the journal. That asymmetry is why
> rung 7 exists and why its "Failed" line is never softened.

Then set `enabled: true` on both.

---

## 7. Verification checklist

- [ ] Every open issue has exactly one type and one priority
- [ ] `gh issue list --label approved` returns only things you approved
- [ ] Mailpit UI: `200` with credentials, `401` without
- [ ] A message sent through the SMTP proxy appears, and its `/view/<id>` link resolves
- [ ] Sentry: read `200` on every project; `PUT /issues/<id>/` `200`
- [ ] Cloud session: `pg_isready` reports the cluster up, and `pnpm test:int` passes in SahajCloud (67 files)
- [ ] `gh issue edit <n> --add-blocked-by "<full URL>"` works from a cloud session
- [ ] A dry-run of the ladder produces a correct worklist against the real backlog
- [ ] One full cycle observed: proposal → approve → PR → review → revision → merge

---

## Issue Relationships are unreachable from a routine

GitHub calls them **Relationships**; the REST resource is `dependencies/blocked_by` and
`dependencies/blocking`, and the issue object carries `issue_dependencies_summary`.

`github/github-mcp-server` **does** ship `issue_dependency_read` / `issue_dependency_write`
(PR #2839, full read/write, cross-repo), gated behind the `issue_dependencies` feature flag —
which is in `AllowedFeatureFlags`, so it is user-toggleable via `X-MCP-Features`. None of that
helps here. Every route to switching it on was tested and all fail at the same wall:

| Route | Fails at |
| --- | --- |
| Repo `.mcp.json`, multi-repo routine | Config never read — session root is `/home/user`, repos are subdirectories, so no repo is the project root |
| Repo `.mcp.json`, single-repo routine | Config **is** read, then: `Dynamic Client Registration rejected (HTTP 403): This GitHub API path is not available: sessions are bound to their configured repositories` |
| Routine `mcp_connections` | `headers: Extra inputs are not permitted`, and `connector_uuid` is required |
| A custom claude.ai connector | Same proxy, same non-repo-scoped path — no reason to expect a different result |
| `curl https://api.github.com/...` with `GH_TOKEN` | 403 on every endpoint; the proxy declines rather than substituting |

The blocker is not the flag, the header, or where the config lives: **a session cannot open a
second GitHub MCP connection at all**, because `api.githubcopilot.com/mcp/` is not a
repository-scoped path and the proxy refuses it during the handshake.

**Consequence for the loop:** it cannot read whether a ticket is blocked. Until this changes,
Relationships are set **locally** (where `gh` works and the GitHub UI graph is the point) and
mirrored into the issue body as a `Blocked by: <url>` line that a cloud run can grep. Re-test the
`select:` probe after any GitHub MCP release; the day the tools appear, the body line becomes
redundant.

Issue **fields** have no such problem — `list_issue_fields`, `issue_read.field_values`,
`list_issues(fields:["field_values"])` and `issue_write(issue_fields:[...])` all work from a
routine, so Priority and Effort are fully usable.

## Webhook triggers were evaluated and rejected

`RemoteTrigger` exposes `create_webhook_trigger`, which can fire a routine from a GitHub event. It
was tested against a live trigger and **not adopted**. Recorded here so nobody re-derives it.

**The API validates almost nothing.** Only `hook_type` (`app` | `url`), the `plugin_id` /
`routine_trigger_id` xor, and `source` (`github`, `gitlab`, `bitbucket`, and enterprise variants).
Field validation runs *before* the trigger lookup, so probing with a nonexistent
`routine_trigger_id` is side-effect free.

**Everything else is accepted and silently discarded**, including unknown keys and invalid event
names. A `filter` key was sent and is **absent from the stored object**, with `warnings: []`:

```json
{"events":["pull_request_review","issue_comment"], "extra_env":{}, "hook_type":"app",
 "scope_id":"github.com/sydevs/sahajatlasweb", "source":"github",
 "trigger_id":"a84a3cd8-2f99-4173-a266-1219e6f91f89"}
```

So **there is no author filtering.** Every matching event fires the routine, including events the
bot itself generates — which means any infinite-loop guard has to live in the handler, never in the
trigger. `scope_id` is one repository, normalised to `github.com/org/repo`, so org-wide coverage
would need four triggers.

**Why rejected.** With no filter, subscribing to `pull_request` or `issues` is all-or-nothing per
event type: every `synchronize`, `labeled` and `edited` would fire a handler, including the loop's
own pushes. And a reply typed into a review thread fires `pull_request_review_comment`, not
`pull_request_review`, so the most common follow-up is the easiest event to miss. The baton model
makes polling cheap enough that the latency gain does not justify four triggers and a new class of
silent misconfiguration.

**A live test trigger still exists**: `a84a3cd8-2f99-4173-a266-1219e6f91f89`, pointing at the
disabled routine `zz-webhook-probe2-DELETEME`. No delete action for webhook triggers is exposed;
deleting the owning routine is the presumed removal path.

## Failure modes worth recognising

| Symptom | Cause |
| --- | --- |
| Every `gh` call 403s with "GitHub access is not enabled for this session" | The account's GitHub connection is missing. Run `/web-setup` locally, or authorize the Claude GitHub App. Installing the App **on the org** does not fix this — per the docs it "is not a session-level access control" |
| `gh` reports "The token in GH_TOKEN is invalid" | Expected when the proxy handles auth: `GH_TOKEN` reads as the literal `proxy-injected`. Only a real 403 on an API call indicates a problem |
| `gh issue list --json issueType` 403s | It routes through GraphQL, and the proxy serves only pinned PR-review operations. Use the REST form |
| `railway` exits 1 silently, even `--help` | pnpm blocked the postinstall that downloads the binary. `pnpm approve-builds -g`, or run `npm-install/postinstall.js` by hand |
| Mailpit UI `502`, container logs healthy | `PORT` not set to `8025` |
| Mailpit crash-loops on first deploy | Volume not attached at `/data` |
| Sentry `401 Invalid token` | Client Secret copied instead of Token |
| Sentry `404` on a project that exists | Wrong regional host |
| Plugin installs but reports `disabled` | `enabledPlugins` written as an array; it must be an object map |
| Cross-repo `--add-blocked-by` "invalid issue format" | Needs the full URL, not `owner/repo#N` |
| A newly created label vanishes | Case-insensitive collision with a label deleted in the same run |
| The loop answers review feedback but pushes nothing | It cannot push to a human's branch — only `claude/*`. It opens a stacked PR into that branch instead |
| A `<details>` block seems missing when read back through MCP | The write landed. The MCP **read** path strips `<details>`/`<summary>` (while keeping `<table>`, `<sub>`, `<a>`); REST shows the stored tags intact. From a routine, trust the write's 200 — do not re-post or file a bug |
| A run dies in seconds with `Setup script failed` and zero turns | The setup script exited non-zero; the session never starts. Keep optional dependencies best-effort. Known Postgres traps: `/var/run/postgresql` missing (compiled-in socket dir), and the package's half-cluster at `16/main` — `PG_VERSION` present, config in `/etc` — which `pg_ctl -D` cannot start |
| A `search_issues` query returns zero unexpectedly | The `>` in a `updated:>…` qualifier was HTML-escaped to `&gt;`; it fails silently rather than erroring |
| Loop implements nothing, no error | Correct — nothing is both assigned to the bot and labelled `ready-to-implement`. That is the gate working |
