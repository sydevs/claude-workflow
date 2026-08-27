---
name: dev-server
description: Start, stop, or check this worktree's dev server. Use when starting or restarting the dev server, checking server status, viewing server logs, or before testing a change that needs a running server. Each git worktree gets its own port and its own database.
allowed-tools: Bash, Read
---

# Dev Server

One server **per git worktree**, not per repo. `/implement-issue` works in a worktree by
default, so a server keyed on the repo either refuses to start there or — worse — serves
another branch's code to a test that believes it is testing this one.

```bash
${CLAUDE_PLUGIN_ROOT}/skills/dev-server/dev-server.sh            # start + tail logs
${CLAUDE_PLUGIN_ROOT}/skills/dev-server/dev-server.sh start|stop|restart|status|health|logs [n]
${CLAUDE_PLUGIN_ROOT}/skills/dev-server/dev-server.sh teardown   # stop + drop the database
```

Configuration comes from `<worktree>/.claude/workflow.json` → `devServer`:

| Key | Meaning |
| --- | --- |
| `command` | Start command. `{port}` is substituted — **required for Vite**, which ignores `$PORT`; Next.js reads `$PORT` and needs no placeholder. |
| `basePort` | Port floor. The actual port is `basePort + hash(worktree) % 20`, stable per worktree, overridable with `PORT=`. |
| `healthPath` | Path polled until the server answers (60s cap). |
| `isolateDatabase`, `databaseNameTemplate`, `databaseUrlEnv` | Give each worktree its own database. |

## The two things this exists to prevent

**Testing against another branch's code.** The server records the HEAD it booted from.
`status` and `health` compare that against your current HEAD and fail loudly on a mismatch.
If you see that warning, `restart` before trusting any result — the server is serving the
older commit.

**Two worktrees sharing one database.** SahajCloud runs Drizzle `push` outside production
(`src/payload.config.ts`), so every dev instance syncs its schema into whatever database it
points at. Two worktrees with divergent schemas corrupt each other silently, and a distinct
port does nothing to stop it. Where `isolateDatabase` is set, each worktree gets
`sahajcloud_dev_<slug>`, created on first start and dropped by `teardown`.

## Notes

- `stop` kills the recorded pid **and** the port's actual holder. `pnpm dev` execs a
  grandchild (vite, next-server) that owns the socket; killing only the tracked pid leaves a
  listener behind that the next `start` misreads as another user's process.
- State lives in `${XDG_STATE_HOME:-~/.local/state}/sydevs-dev-server/<slug>.json`, outside
  the repo, so removing a worktree never strands state inside it.
- `/implement-issue` runs `teardown` before `ExitWorktree`, so a finished ticket leaves no
  server and no database behind.
- A port held by something outside this worktree is never killed — the script says so and
  tells you to rerun with `PORT=`.
