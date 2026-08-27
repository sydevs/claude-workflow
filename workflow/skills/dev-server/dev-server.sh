#!/bin/bash
# Worktree-scoped dev server.
#
# Identity is the **git worktree**, not the project directory. That is the whole point:
# /implement-issue works in a worktree by default, so a server keyed on the project root
# either refuses to start there (the old behaviour) or — worse — serves another branch's
# code to a test that believes it is testing this one.
#
# Three properties follow from that:
#   1. Each worktree gets its own deterministic port, so two agents never collide.
#   2. Each worktree records the HEAD it booted from; `status`/`health` compare it against
#      the caller's HEAD and shout when they differ. Stale-code testing becomes visible
#      instead of silent.
#   3. Where the app owns a database (`isolateDatabase` in workflow.json), each worktree
#      gets its own. Port isolation alone is not enough when Drizzle `push` syncs a
#      divergent schema into one shared Postgres.
#
# Per-repo settings come from <worktree>/.claude/workflow.json → devServer.

set -euo pipefail

command -v git >/dev/null || { echo "dev-server: git not found" >&2; exit 1; }
WORKTREE="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "dev-server: not inside a git worktree" >&2; exit 1; }

CONFIG="$WORKTREE/.claude/workflow.json"
[ -f "$CONFIG" ] || { echo "dev-server: no $CONFIG — this repo has no devServer config" >&2; exit 1; }

# --- read config -------------------------------------------------------------
read_cfg() {
  python3 - "$CONFIG" "$1" "${2-}" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1])).get('devServer') or {}
val = cfg.get(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else '')
print('' if val is None else ('1' if val is True else '' if val is False else val))
PY
}

CMD_START="$(read_cfg command)"
BASE_PORT="$(read_cfg basePort 3000)"
HEALTH_PATH="$(read_cfg healthPath /)"
ISOLATE_DB="$(read_cfg isolateDatabase)"
DB_URL_ENV="$(read_cfg databaseUrlEnv DATABASE_URL)"
DB_TEMPLATE="$(read_cfg databaseNameTemplate)"
[ -n "$CMD_START" ] || { echo "dev-server: devServer.command missing in $CONFIG" >&2; exit 1; }

# --- worktree identity -------------------------------------------------------
# basename keeps it readable; the path hash keeps two worktrees with the same basename apart.
SLUG="$(basename "$WORKTREE" | tr -c 'a-zA-Z0-9_-' '_')_$(printf '%s' "$WORKTREE" | cksum | cut -d' ' -f1)"
# Deterministic per-worktree offset, so the same worktree always lands on the same port.
OFFSET=$(( $(printf '%s' "$SLUG" | cksum | cut -d' ' -f1) % 20 ))
PORT="${PORT:-$(( BASE_PORT + OFFSET ))}"

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/sydevs-dev-server"
STATE_FILE="$STATE_DIR/$SLUG.json"
LOG_FILE="$STATE_DIR/$SLUG.log"
mkdir -p "$STATE_DIR"

HEAD_NOW="$(git -C "$WORKTREE" rev-parse HEAD 2>/dev/null || echo unknown)"
BRANCH_NOW="$(git -C "$WORKTREE" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

DB_NAME=""
if [ -n "$ISOLATE_DB" ] && [ -n "$DB_TEMPLATE" ]; then
  DB_NAME="${DB_TEMPLATE//\{slug\}/$(printf '%s' "$SLUG" | tr 'A-Z-' 'a-z_')}"
fi

# --- state helpers -----------------------------------------------------------
state_get() {
  [ -f "$STATE_FILE" ] || { echo ""; return; }
  python3 -c "
import json,sys
try: print(json.load(open(sys.argv[1])).get(sys.argv[2],'') or '')
except Exception: print('')
" "$STATE_FILE" "$1"
}

state_write() {
  python3 - "$STATE_FILE" "$1" "$PORT" "$WORKTREE" "$BRANCH_NOW" "$HEAD_NOW" "$LOG_FILE" "$DB_NAME" <<'PY'
import json, sys, datetime
f, pid, port, wt, branch, head, log, db = sys.argv[1:9]
json.dump({"pid": int(pid), "port": int(port), "worktree": wt, "branch": branch,
           "head": head, "logFile": log, "database": db or None,
           "startedAt": datetime.datetime.now(datetime.timezone.utc)
                        .strftime('%Y-%m-%dT%H:%M:%SZ')},
          open(f, 'w'), indent=2)
PY
}

running() { local p; p="$(state_get pid)"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

# Is whatever holds $PORT ours? Compare against the WORKTREE, not the project dir —
# that single change is what makes this work inside .claude/worktrees/*.
port_holder_is_ours() {
  local pid cwd
  pid="$(lsof -t -i :"$PORT" 2>/dev/null | head -1)" || return 1
  [ -n "$pid" ] || return 1
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2-)"
  [ "$cwd" = "$WORKTREE" ]
}

# --- the guard that protects test correctness --------------------------------
warn_head_drift() {
  local booted_head booted_branch
  booted_head="$(state_get head)"; booted_branch="$(state_get branch)"
  [ -n "$booted_head" ] || return 0
  if [ "$booted_head" != "$HEAD_NOW" ]; then
    cat >&2 <<EOF

  ⚠  THIS SERVER IS SERVING DIFFERENT CODE THAN YOUR WORKING TREE.
       running: ${booted_branch} @ ${booted_head:0:12}
       you are on: ${BRANCH_NOW} @ ${HEAD_NOW:0:12}
     Anything you test against it is testing the older commit.
     Run \`dev-server.sh restart\` before trusting a result.

EOF
    return 1
  fi
}

ensure_database() {
  [ -n "$DB_NAME" ] || return 0
  if ! psql -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
    echo "  creating isolated database $DB_NAME"
    createdb "$DB_NAME" 2>/dev/null || echo "  (createdb failed — is Postgres running?)" >&2
  fi
}

wait_for_health() {
  local n=0
  while [ $n -lt 60 ]; do
    if curl -fsS -o /dev/null "http://localhost:$PORT$HEALTH_PATH" 2>/dev/null; then return 0; fi
    kill -0 "$(state_get pid)" 2>/dev/null || { echo "  process died — see $LOG_FILE" >&2; return 1; }
    sleep 1; n=$((n+1))
  done
  echo "  health check timed out after 60s — see $LOG_FILE" >&2; return 1
}

cmd_start() {
  if running; then
    echo "already running: pid $(state_get pid) on :$(state_get port)"
    warn_head_drift || true
    return 0
  fi
  if lsof -i :"$PORT" >/dev/null 2>&1 && ! port_holder_is_ours; then
    echo "port $PORT is held by another process (not this worktree)." >&2
    echo "start elsewhere with:  PORT=$((PORT+100)) $0 start" >&2
    return 1
  fi
  ensure_database
  # Frameworks disagree about how to be told a port: Next.js reads $PORT, Vite ignores it
  # entirely and needs --port. So the command is a template and {port} is substituted here.
  local run="${CMD_START//\{port\}/$PORT}"
  echo "starting: $run"
  echo "  worktree $WORKTREE"
  echo "  branch   $BRANCH_NOW @ ${HEAD_NOW:0:12}"
  echo "  port     $PORT"
  [ -n "$DB_NAME" ] && echo "  database $DB_NAME"
  ( cd "$WORKTREE" && \
    env PORT="$PORT" ${DB_NAME:+"$DB_URL_ENV=postgresql://postgres:postgres@localhost:5432/$DB_NAME"} \
    nohup bash -lc "$run" >"$LOG_FILE" 2>&1 & echo $! >"$STATE_DIR/$SLUG.pid" )
  state_write "$(cat "$STATE_DIR/$SLUG.pid")"
  wait_for_health && echo "healthy: http://localhost:$PORT"
}

# `pnpm dev` / `pnpm devsafe` exec a child (vite, next-server) that is the process which
# actually holds the port. Killing only the recorded pid orphans that grandchild, leaving a
# listener behind that the next `start` then mistakes for "someone else's process". So stop
# the recorded pid AND whatever still holds our port, once we have confirmed it is ours.
kill_port_holder() {
  local pid
  pid="$(lsof -t -i :"$PORT" 2>/dev/null | head -1)" || return 0
  [ -n "$pid" ] || return 0
  port_holder_is_ours || { echo "  :$PORT held by a process outside this worktree — leaving it"; return 0; }
  echo "  killing orphaned listener $pid on :$PORT"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -9 "$pid" 2>/dev/null || true
}

cmd_stop() {
  local pid; pid="$(state_get pid)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "stopping pid $pid"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -9 "$pid" 2>/dev/null || true
  else
    echo "no tracked process"
  fi
  kill_port_holder
  rm -f "$STATE_FILE"
  if lsof -i :"$PORT" >/dev/null 2>&1; then
    echo "stopped (WARNING: :$PORT is still held)" >&2
  else
    echo "stopped (:$PORT released)"
  fi
}

cmd_teardown() {
  cmd_stop
  if [ -n "$DB_NAME" ]; then
    echo "dropping $DB_NAME"
    dropdb --if-exists "$DB_NAME" 2>/dev/null || echo "  (dropdb failed)" >&2
  fi
  rm -f "$LOG_FILE"
  echo "torn down $SLUG"
}

cmd_status() {
  echo "worktree : $WORKTREE"
  echo "slug     : $SLUG"
  echo "port     : $PORT"
  [ -n "$DB_NAME" ] && echo "database : $DB_NAME"
  if running; then
    echo "state    : running (pid $(state_get pid), booted $(state_get branch) @ $(state_get head | cut -c1-12))"
    warn_head_drift || return 1
    curl -fsS -o /dev/null "http://localhost:$PORT$HEALTH_PATH" 2>/dev/null \
      && echo "health   : ok" || echo "health   : NOT RESPONDING"
  else
    echo "state    : stopped"
  fi
}

case "${1:-default}" in
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  restart)  cmd_stop; cmd_start ;;
  teardown) cmd_teardown ;;
  status)   cmd_status ;;
  logs)     tail -n "${2:-100}" -f "$LOG_FILE" ;;
  health)   curl -fsS -o /dev/null "http://localhost:$PORT$HEALTH_PATH" && echo ok || { echo "unhealthy"; exit 1; } ;;
  default)  cmd_start; warn_head_drift || true; tail -n 100 -f "$LOG_FILE" ;;
  *)        echo "usage: $0 [start|stop|restart|teardown|status|logs [n]|health]"; exit 1 ;;
esac
