#!/bin/bash
# Stop the Close Knit real-data review stack.
set -u
AE="$(cd "$(dirname "$0")" && pwd)"

stop_pid() {
  if [ -f "$1" ]; then
    kill "$(cat "$1")" 2>/dev/null || true
    rm -f "$1"
  fi
}

stop_pid "$AE/.web.pid"
stop_pid "$AE/.api.pid"
# Fallback: the pidfile may reference a dead restart while an older server
# still holds :8080 (pidfile was already overwritten). Clear any straggler.
pkill -f "area_api.app:app" 2>/dev/null || true
PG_BIN="${AE_PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || echo /nonexistent/pg_ctl)")}"
if [ -z "${AE_DB_URL:-}" ] && [ -x "$PG_BIN/pg_ctl" ] && [ -d "$AE/.pgdata" ]; then
  "$PG_BIN/pg_ctl" -D "$AE/.pgdata" -m fast stop 2>/dev/null || true
fi
echo "real-data: stopped"
