---
name: dev-server
description: Start, stop, or check this worktree's dev server. Use when starting or restarting the dev server, checking server status, viewing server logs, or before testing a change that needs a running server. Each git worktree gets its own port and its own database.
allowed-tools: Bash, Read
---

# Dev Server

One server runs per git worktree, not per repo. `/implement-issue` uses a worktree by default.
A server keyed to the repo either refuses to start there, or — worse — serves another branch's
code to a test that expects this one.

```bash
${CLAUDE_PLUGIN_ROOT}/skills/dev-server/dev-server.sh            # start + tail logs
${CLAUDE_PLUGIN_ROOT}/skills/dev-server/dev-server.sh start|stop|restart|status|health|logs [n]
${CLAUDE_PLUGIN_ROOT}/skills/dev-server/dev-server.sh teardown   # stop + drop the database
```

Configuration comes from `<worktree>/.claude/workflow.json` → `devServer`:

| Key | Meaning |
| --- | --- |
| `command` | Start command. `{port}` is a placeholder — Vite ignores `$PORT` and needs it. Next.js reads `$PORT` and needs no placeholder. |
| `basePort` | Port floor. The actual port is `basePort + hash(worktree) % 20`, stable per worktree. Override with `PORT=`. |
| `healthPath` | Path the script polls until the server answers. Cap: 60 seconds. |
| `isolateDatabase`, `databaseNameTemplate`, `databaseUrlEnv` | Give each worktree its own database. |

## Two failures this prevents

**Testing the wrong branch's code.** The server records the HEAD it booted from. `status` and
`health` compare that HEAD against your current HEAD and fail loudly on a mismatch. On that
warning, run `restart` first.

**Two worktrees sharing one database.** SahajCloud runs Drizzle `push` outside production
(`src/payload.config.ts`), so every dev instance syncs its schema into its own database. Two
worktrees on different schemas corrupt each other silently — a distinct port does not stop
this. Where `isolateDatabase` is set, each worktree gets `sahajcloud_dev_<slug>`, created on
first start and dropped by `teardown`.

## Notes

- `stop` kills the recorded pid and the port's actual holder. `pnpm dev` execs a grandchild
  (vite, next-server) that owns the socket, so killing only the tracked pid leaves a listener
  that the next `start` misreads as another user's process.
- State lives in `${XDG_STATE_HOME:-~/.local/state}/sydevs-dev-server/<slug>.json`, outside the
  repo, so removing a worktree strands no state.
- `/implement-issue` runs `teardown` before `ExitWorktree`, so a finished ticket leaves no
  server and no database behind.
- The script never kills a port held outside this worktree. It reports this and tells you to
  rerun with `PORT=`.
