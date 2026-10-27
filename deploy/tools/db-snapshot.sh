#!/usr/bin/env bash
# Snapshot the validated local database for shipping to production.
#   tools/db-snapshot.sh <output.dump> [database-url]
# Custom-format pg_dump of schema + data, minus operational tables that must
# start empty in production (objections, correction reports, analytics events)
# and the PostGIS-owned spatial_ref_sys. A sha256 manifest sits next to it.
set -euo pipefail
out="${1:?usage: db-snapshot.sh <output.dump> [database-url]}"
url="${2:-${CLOSE_KNIT_DATABASE_URL:-postgresql://close_knit@127.0.0.1:5433/close_knit}}"
pg_dump="${PG_DUMP:-pg_dump}"
command -v "$pg_dump" >/dev/null || { echo "db-snapshot: $pg_dump not found (set PG_DUMP)" >&2; exit 1; }

release="$(psql "$url" -Atc "select release_id from active_product_release limit 1" 2>/dev/null || true)"
[ -n "$release" ] || { echo "db-snapshot: no active product release in $url; refusing to snapshot" >&2; exit 1; }

# PostGIS itself comes from the image and schema.sql; the dump carries only our objects.
"$pg_dump" "$url" --format=custom --compress=6 --no-owner --no-privileges \
    --exclude-extension=postgis \
    --exclude-table-data=property_objection \
    --exclude-table-data=correction_report \
    --exclude-table-data=profile_analytics_event \
    --exclude-table-data=mcp_feedback \
    --exclude-table-data=product_event \
    --exclude-table-data=agency_opt_out \
    --exclude-table-data=site_feedback \
    --exclude-table-data=spatial_ref_sys \
    --file="$out"
sha="$(shasum -a 256 "$out" | cut -d' ' -f1)"
printf '{"file":"%s","sha256":"%s","activeRelease":"%s","dumpedAt":"%s","pgDumpVersion":"%s"}\n' \
    "$(basename "$out")" "$sha" "$release" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$("$pg_dump" --version | awk '{print $3}')" \
    > "$out.manifest.json"
echo "db-snapshot: $out ($(du -h "$out" | cut -f1)), release $release, sha256 $sha"
