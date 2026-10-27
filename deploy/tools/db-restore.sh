#!/usr/bin/env bash
# Restore a db-snapshot.sh dump into the compose database, then verify.
#   tools/db-restore.sh <snapshot.dump> [extra docker compose -f files...]
# Run from any directory; uses deploy/docker-compose.yml (+ overlays you pass).
set -euo pipefail

# Tables that only production writes (privacy objections, correction reports,
# opt-in analytics). The snapshot carries their definitions but never their
# rows; once they exist on the target, a restore must not drop and recreate
# them, or every confirmed "hide my home" request would be lost.
PRODUCTION_ONLY_TABLES="property_objection correction_report profile_analytics_event access_invite mcp_feedback mcp_call_note product_event agency_opt_out site_feedback"

# filter_list <tables...>: read a `pg_restore -l` list on stdin and drop
# extension entries plus every entry belonging to the named tables (the table,
# its indexes, constraints, sequences, defaults and comments).
filter_list() {
    local alternation
    alternation="$(printf '%s|' "$@")"; alternation="${alternation%|}"
    if [ -z "$alternation" ]; then
        grep -vE ' (EXTENSION|COMMENT - EXTENSION) '
    else
        grep -vE ' (EXTENSION|COMMENT - EXTENSION) ' \
            | grep -vE " public (${alternation})( |_)"
    fi
}
if [ "${1:-}" = "--filter-list" ]; then shift; filter_list "$@"; exit 0; fi

dump="${1:?usage: db-restore.sh <snapshot.dump> [-f overlay.yml ...]}"; shift
deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose -f "$deploy_dir/docker-compose.yml" "$@")
[ -f "$dump" ] || { echo "db-restore: $dump not found" >&2; exit 1; }
if [ -f "$dump.manifest.json" ]; then
    expected="$(sed -n 's/.*"sha256":"\([0-9a-f]*\)".*/\1/p' "$dump.manifest.json")"
    actual="$(shasum -a 256 "$dump" | cut -d' ' -f1)"
    [ "$expected" = "$actual" ] || { echo "db-restore: sha256 mismatch against manifest" >&2; exit 1; }
fi

container="$("${compose[@]}" ps -q database)"
[ -n "$container" ] || { echo "db-restore: database service is not running (docker compose up -d database)" >&2; exit 1; }
"${compose[@]}" exec -T database pg_isready -U close_knit -d close_knit >/dev/null

echo "db-restore: copying $(du -h "$dump" | cut -f1) into the database container"
docker cp "$dump" "$container:/tmp/close-knit.dump"
echo "db-restore: restoring (schema objects are replaced, existing release data dropped)"
# Extensions (PostGIS) belong to the image; older dumps may still list them.
# Production-only tables that already exist are left out of the list entirely.
keep=()
for table in $PRODUCTION_ONLY_TABLES; do
    exists="$("${compose[@]}" exec -T database psql -U close_knit -d close_knit -Atc \
        "select to_regclass('public.$table') is not null")"
    [ "$exists" = "t" ] && keep+=("$table")
done
echo "db-restore: keeping existing production tables: ${keep[*]:-none}"
# Their foreign keys into release tables (address, property, product_release)
# would block --clean from dropping those tables, and could not be re-added if
# a rebuilt release no longer holds a referenced row. Kept tables reference
# release rows by value from here on; the suppression view joins on values.
for table in ${keep[@]+"${keep[@]}"}; do
    "${compose[@]}" exec -T database psql -U close_knit -d close_knit -Atq -v ON_ERROR_STOP=1 -c "
        DO \$\$ DECLARE c record; BEGIN
          FOR c IN SELECT conname FROM pg_constraint
                   WHERE conrelid = 'public.$table'::regclass AND contype = 'f' LOOP
            EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', '$table', c.conname);
          END LOOP; END \$\$;"
done
objections_before=0
if [[ " ${keep[*]:-} " == *" property_objection "* ]]; then
    objections_before="$("${compose[@]}" exec -T database psql -U close_knit -d close_knit -Atc \
        "select count(*) from property_objection")"
fi
"${compose[@]}" exec -T database pg_restore -l /tmp/close-knit.dump \
    | filter_list ${keep[@]+"${keep[@]}"} \
    | "${compose[@]}" exec -T database sh -c "cat > /tmp/close-knit.list"
"${compose[@]}" exec -T database pg_restore -U close_knit -d close_knit \
    --use-list=/tmp/close-knit.list \
    --clean --if-exists --no-owner --no-privileges --exit-on-error --jobs="${RESTORE_JOBS:-4}" /tmp/close-knit.dump
"${compose[@]}" exec -T database rm -f /tmp/close-knit.dump /tmp/close-knit.list

release="$("${compose[@]}" exec -T database psql -U close_knit -d close_knit -Atc \
    "select release_id from active_product_release limit 1")"
[ -n "$release" ] || { echo "db-restore: restore finished but no active product release" >&2; exit 1; }
"${compose[@]}" exec -T database psql -U close_knit -d close_knit -Atc \
    "select count(*) from pg_views where viewname = 'suppressed_dwelling'" | grep -qx 1 \
    || { echo "db-restore: suppressed_dwelling view missing after restore" >&2; exit 1; }
objections_after="$("${compose[@]}" exec -T database psql -U close_knit -d close_knit -Atc \
    "select count(*) from property_objection")"
[ "$objections_after" = "$objections_before" ] \
    || { echo "db-restore: property_objection rows changed ($objections_before -> $objections_after)" >&2; exit 1; }
echo "db-restore: active release $release; restart the api so it re-reads readiness:"
echo "  ${compose[*]} restart api"
