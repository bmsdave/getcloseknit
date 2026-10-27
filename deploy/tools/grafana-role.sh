#!/usr/bin/env bash
# Give the analytics UI's read-only role (migration 050) its login, with
# CLOSE_KNIT_GRAFANA_DB_PASSWORD from deploy/.env. Idempotent; run on the server after
# applying 050 and after changing that password. The password goes to psql on stdin, never
# on a command line.
#   tools/grafana-role.sh [-f docker-compose.prod.yml]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
overlay="${2:-docker-compose.prod.yml}"
password="$(sed -n 's/^CLOSE_KNIT_GRAFANA_DB_PASSWORD=//p' .env | tail -1)"
[[ "$password" =~ ^[A-Za-z0-9]{24,}$ ]] \
    || { echo "grafana-role: set CLOSE_KNIT_GRAFANA_DB_PASSWORD in .env (24+ letters or digits)" >&2; exit 1; }
printf "ALTER ROLE close_knit_analytics LOGIN PASSWORD '%s';\n" "$password" \
    | docker compose -f docker-compose.yml -f "$overlay" exec -T database \
        psql -q -v ON_ERROR_STOP=1 -U close_knit -d close_knit
echo "grafana-role: close_knit_analytics can log in (read-only: product_event, profile_analytics_event, mcp_feedback, mcp_call_note, site_feedback)"
