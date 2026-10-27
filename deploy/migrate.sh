#!/usr/bin/env bash
# Migration runner. The journal table schema_migrations holds one row per applied file of
# deploy/migrations (name, number, sha256 of the file, when, how). Usage:
#   migrate.sh apply          apply every file not in the journal, in number order, each in one
#                             transaction together with its journal row; a second run does nothing
#   migrate.sh init           as apply, but first creates the journal: a new database only (initdb)
#   migrate.sh status         list pending and changed files; exit 1 if any, or if there is no journal
#   migrate.sh baseline NNN   once, on a database whose migrations were applied by hand: record every
#                             file numbered NNN or lower as applied, without running it
#   migrate.sh redo NAME      run an applied file again (all are safe to run again) and record its new
#                             checksum; the way out after an applied file was edited
# apply refuses to start without a journal (a database from before it needs `baseline` first) and
# when an applied file has changed, so nothing is re-run by accident.
# SQL goes to psql on stdin: CLOSE_KNIT_PSQL (default "psql", connection from the PG* environment),
# e.g. CLOSE_KNIT_PSQL="docker compose exec -T database psql -U close_knit -d close_knit".
# Files: CLOSE_KNIT_MIGRATIONS (default: migrations/ next to this script).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dir="${CLOSE_KNIT_MIGRATIONS:-$here/migrations}"
read -r -a psql_cmd <<<"${CLOSE_KNIT_PSQL:-psql}"
psql_run() { "${psql_cmd[@]}" -X -q -v ON_ERROR_STOP=1 "$@"; }
query() { psql_run -At -c "$1" </dev/null; }
die() { echo "migrate: $*" >&2; exit 1; }
sha() { { sha256sum "$1" 2>/dev/null || shasum -a 256 "$1"; } | cut -d' ' -f1; }
number() { echo $((10#${1%%-*})); }

journal_sql="CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,                -- file name in deploy/migrations, e.g. 118-school-geography-index.sql
    version integer NOT NULL,             -- its number
    checksum text NOT NULL,               -- sha256 of the file as applied
    applied_at timestamptz NOT NULL DEFAULT now(),
    how text NOT NULL CHECK (how IN ('applied', 'baseline', 'redo'))
);"

# Every migration file, in number order (then name, should two branches pick the same number).
files=()
while IFS= read -r f; do files+=("$f"); done < <(
    cd "$dir" && for f in [0-9]*.sql; do [ -e "$f" ] && echo "$f"; done | LC_ALL=C sort -t- -k1,1n -k2)
[ ${#files[@]} -gt 0 ] || die "no migrations in $dir"
for f in "${files[@]}"; do
    [[ "$f" =~ ^[0-9]+-[a-z0-9_.-]+\.sql$ ]] || die "unexpected file name $dir/$f"
done

has_journal() {
    local found
    found="$(query "SELECT to_regclass('public.schema_migrations') IS NOT NULL")" || die "cannot query the database"
    [ "$found" = t ]
}

# Fills `pending` (files without a row) and `changed` (rows whose file now has another checksum).
scan() {
    local applied f row
    applied="$(query "SELECT name || '|' || checksum FROM schema_migrations")"
    pending=(); changed=()
    for f in "${files[@]}"; do
        row="$(awk -F'|' -v n="$f" '$1 == n' <<<"$applied")"
        if [ -z "$row" ]; then pending+=("$f")
        elif [ "$row" != "$f|$(sha "$dir/$f")" ]; then changed+=("$f"); fi
    done
}

record_sql() { # name, how
    printf "INSERT INTO schema_migrations (name, version, checksum, how) VALUES ('%s', %d, '%s', '%s')" \
        "$1" "$(number "$1")" "$(sha "$dir/$1")" "$2"
}

run_file() { # name, how: the file and its journal row in one transaction
    echo "migrate: $2 $1"
    { echo "BEGIN;"; cat "$dir/$1"; printf '\n;\n'
      [ "$2" = redo ] && echo "DELETE FROM schema_migrations WHERE name = '$1';"
      record_sql "$1" "$2"; printf ';\nCOMMIT;\n'; } | psql_run >/dev/null
}

apply() {
    has_journal || die "this database has no migration journal. A new one: migrate.sh init. One whose migrations \
were applied by hand: migrate.sh baseline <number of the last one applied> (RELEASE-CHECKLIST.md)"
    scan
    [ ${#changed[@]} -eq 0 ] || die "applied files changed since: ${changed[*]-}. Revert the edit, or run it again with \
migrate.sh redo <name> (RELEASE-CHECKLIST.md)"
    [ ${#pending[@]} -gt 0 ] || { echo "migrate: up to date (${#files[@]} migrations)"; return; }
    local f
    for f in ${pending[@]+"${pending[@]}"}; do run_file "$f" applied; done
    echo "migrate: applied ${#pending[@]}"
}

case "${1:-}" in
    apply) apply ;;
    init) query "$journal_sql" >/dev/null; apply ;;
    status)
        has_journal || die "no migration journal (migrate.sh baseline, RELEASE-CHECKLIST.md)"
        scan
        for f in ${pending[@]+"${pending[@]}"}; do echo "pending  $f"; done
        for f in ${changed[@]+"${changed[@]}"}; do echo "changed  $f"; done
        [ ${#pending[@]} -eq 0 ] && [ ${#changed[@]} -eq 0 ] || exit 1
        echo "migrate: up to date (${#files[@]} migrations)" ;;
    baseline)
        upto="${2:?usage: migrate.sh baseline NNN}"
        [[ "$upto" =~ ^[0-9]+$ ]] || die "baseline takes a migration number, got $upto"
        upto=$((10#$upto))
        { echo "BEGIN;"; echo "$journal_sql"
          for f in "${files[@]}"; do
              [ "$(number "$f")" -le "$upto" ] && { record_sql "$f" baseline; echo " ON CONFLICT (name) DO NOTHING;"; }
          done; echo "COMMIT;"; } | psql_run >/dev/null
        echo "migrate: recorded every migration up to $upto as applied" ;;
    redo)
        name="${2:?usage: migrate.sh redo NAME}"
        printf '%s\n' "${files[@]}" | grep -qxF "$name" || die "no migration named $name"
        has_journal || die "no migration journal"
        run_file "$name" redo ;;
    *) die "usage: migrate.sh apply | init | status | baseline NNN | redo NAME" ;;
esac
