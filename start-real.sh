#!/bin/bash
# Start Close Knit with real validated data (local review stack).
# Services: Postgres+PostGIS (.pgdata) :5433, FastAPI :8080, Next.js :4180.
# Local-only: pg_hba trusts loopback; nothing is exposed beyond this machine.
#   AE_DB_URL=postgresql://…  use an already running database (e.g. Docker)
#                             instead of the local .pgdata cluster
#   AE_PG_BIN=/path/to/bin    Postgres 18 + PostGIS binaries (default: PATH)
set -u

AE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"
PG_BIN="${AE_PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || echo /nonexistent/pg_ctl)")}"
API_URL="http://127.0.0.1:8080"
WEB_URL="http://127.0.0.1:4180"
DB_URL="${AE_DB_URL:-postgresql://close_knit@127.0.0.1:5433/close_knit}"

fail() { echo "real-data: ERROR: $1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

have node || fail "node not found (expected mise shims on PATH)."
have npm || fail "npm not found."
[ -x "$AE/.ae-venv/bin/uvicorn" ] || fail "API venv missing at $AE/.ae-venv."

if [ -n "${AE_DB_URL:-}" ]; then
  echo "real-data: using database $AE_DB_URL"
else
  [ -x "$PG_BIN/pg_ctl" ] || fail "Postgres runtime missing at $PG_BIN (set AE_PG_BIN, or AE_DB_URL for a Docker database; see REAL-DATA.md)."
  [ -d "$AE/.pgdata" ] || fail "Database cluster missing at $AE/.pgdata."

  SHMMAX="$(sysctl -n kern.sysv.shmmax 2>/dev/null || echo 0)"
  if [ "$SHMMAX" -lt 134217728 ]; then
    fail "macOS shared-memory limit too small (kern.sysv.shmmax=$SHMMAX). Run: sudo sysctl -w kern.sysv.shmmax=1073741824 kern.sysv.shmall=262144 kern.sysv.shmmni=128"
  fi

  if "$PG_BIN/pg_isready" -h 127.0.0.1 -p 5433 -U close_knit >/dev/null 2>&1; then
    echo "real-data: postgres already running"
  else
    "$PG_BIN/pg_ctl" -D "$AE/.pgdata" -l "$AE/.pg.log" -o "-k /tmp -p 5433" start \
      || fail "postgres did not start; see $AE/.pg.log"
  fi
  for _ in $(seq 1 30); do
    "$PG_BIN/pg_isready" -h 127.0.0.1 -p 5433 -U close_knit >/dev/null 2>&1 && break
    sleep 1
  done
  "$PG_BIN/pg_isready" -h 127.0.0.1 -p 5433 -U close_knit >/dev/null 2>&1 \
    || fail "postgres not ready; see $AE/.pg.log"
fi

if curl -fsS -m 3 "$API_URL/api/v1/metrics" >/dev/null 2>&1; then
  echo "real-data: api already running"
else
  if [ -f "$AE/.api.pid" ]; then
    kill "$(cat "$AE/.api.pid")" 2>/dev/null || true
    rm -f "$AE/.api.pid"
  fi
  # The pidfile may be stale (a dead restart) while an older server still
  # holds :8080; a new server would then fail to bind while health checks
  # keep passing against the stale one. Clear any straggler before starting.
  pkill -f "area_api.app:app" 2>/dev/null || true
  sleep 1
  (cd "$AE/api" && CLOSE_KNIT_DATABASE_URL="$DB_URL" \
    nohup "$AE/.ae-venv/bin/uvicorn" area_api.app:app --host 127.0.0.1 --port 8080 \
    >>"$AE/.api.log" 2>&1 & echo $! > "$AE/.api.pid")
fi
for _ in $(seq 1 30); do
  curl -fsS -m 3 "$API_URL/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS -m 3 "$API_URL/health" >/dev/null 2>&1 \
  || fail "api not ready; see $AE/.api.log"

RELEASE_ID="$(curl -fsS -m 5 "$API_URL/api/v1/metrics" 2>/dev/null | node -e "let s='';process.stdin.on('data',(d)=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).productReleaseId)}catch{}})" 2>/dev/null || true)"
if [ -n "$RELEASE_ID" ]; then
  echo "real-data: release $RELEASE_ID"
  export NEXT_PUBLIC_AE_DEFAULT_MODE=real NEXT_PUBLIC_AE_DEFAULT_RELEASE="$RELEASE_ID"
fi
if curl -fsS -m 3 "$WEB_URL/api/v1/metrics" >/dev/null 2>&1; then
  echo "real-data: web already running"
else
  (cd "$AE/web" && CLOSE_KNIT_API_URL="$API_URL" PORT=4180 \
    NEXT_TELEMETRY_DISABLED=1 nohup npm run dev \
    >>"$AE/.web.log" 2>&1 & echo $! > "$AE/.web.pid")
fi
echo "real-data: waiting for web (first compile takes a minute)..."
for _ in $(seq 1 90); do
  curl -fsS -m 3 "$WEB_URL/api/v1/metrics" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS -m 3 "$WEB_URL/api/v1/metrics" >/dev/null 2>&1 \
  || fail "web not ready; see $AE/.web.log"

echo "real-data: metrics: $(curl -fsS -m 5 "$API_URL/api/v1/metrics" | head -c 220)"
if [ -n "${RELEASE_ID:-}" ]; then
  echo "real-data: READY  web $WEB_URL?mode=real&release=$RELEASE_ID  api $API_URL  db ${DB_URL##*@}"
else
  echo "real-data: READY  web $WEB_URL  api $API_URL  db ${DB_URL##*@}"
fi
