#!/usr/bin/env bash
# Back up the rows only production writes: privacy objections, correction
# reports, opt-in analytics, invites, MCP feedback and estate agent opt-outs. Release data is rebuilt from db-snapshot.sh
# dumps; these tables are not, so they need their own backups.
#   tools/backup-prod-data.sh <backup-dir> [extra docker compose -f files...]
# Keeps the newest $KEEP (default 30) backups. Example crontab (03:15 daily):
#   15 3 * * * cd /srv/close-knit/deploy && tools/backup-prod-data.sh /srv/backups -f docker-compose.prod.yml
# Copy <backup-dir> off the host (rsync, restic, object storage) as well.
set -euo pipefail
dir="${1:?usage: backup-prod-data.sh <backup-dir> [-f overlay.yml ...]}"; shift
deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose -f "$deploy_dir/docker-compose.yml" "$@")
mkdir -p "$dir"
out="$dir/close-knit-prod-data-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
"${compose[@]}" exec -T database pg_dump -U close_knit -d close_knit \
    --data-only --no-owner --no-privileges \
    --table=property_objection --table=correction_report --table=profile_analytics_event --table=access_invite --table=mcp_feedback --table=mcp_call_note --table=product_event \
    --table=agency_opt_out --table=site_feedback \
    | gzip -9 > "$out.tmp"
mv "$out.tmp" "$out"
chmod 600 "$out"
echo "backup-prod-data: wrote $out ($(du -h "$out" | cut -f1))"
# Restore: gunzip -c <file> | docker compose ... exec -T database psql -U close_knit -d close_knit
ls -1t "$dir"/close-knit-prod-data-*.sql.gz | tail -n +"$(( ${KEEP:-30} + 1 ))" \
    | while IFS= read -r old; do rm -f "$old"; done
