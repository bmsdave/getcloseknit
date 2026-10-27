#!/usr/bin/env bash
# A throwaway PostGIS for the database-backed tests (CLOSE_KNIT_TEST_DATABASE_URL). It boots the way production
# does on an empty volume: the compose image, schema.sql, then every migration through migrate.sh (initdb), and
# then the two-LAD seed postgis-seed.sql (Camden in London, Epping Forest in the East of England).
#   eval "$(deploy/tests/postgis-fixture.sh start)"   exports CLOSE_KNIT_TEST_DATABASE_URL and
#                                                      CLOSE_KNIT_TEST_DATABASE_CONTAINER
#   deploy/tests/postgis-fixture.sh stop [container]   removes it (default: $CLOSE_KNIT_TEST_DATABASE_CONTAINER)
# Data lives on a tmpfs and fsync is off: the database is gone with the container.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deploy="$(dirname "$here")"
image="${CLOSE_KNIT_TEST_POSTGIS_IMAGE:-postgis/postgis:18-3.6}"
platform="${CLOSE_KNIT_DATABASE_PLATFORM:-linux/amd64}"

start() {
    local name="close-knit-test-db-$$-$RANDOM" port
    docker run -d --name "$name" --platform "$platform" \
        -e POSTGRES_DB=close_knit -e POSTGRES_USER=close_knit -e POSTGRES_PASSWORD=test \
        --tmpfs /var/lib/postgresql:rw -p 127.0.0.1::5432 \
        -v "$deploy/schema.sql:/docker-entrypoint-initdb.d/001-schema.sql:ro" \
        -v "$deploy/migrations:/close-knit/migrations:ro" \
        -v "$deploy/migrate.sh:/close-knit/migrate.sh:ro" \
        -v "$deploy/initdb-migrate.sh:/docker-entrypoint-initdb.d/900-migrate.sh:ro" \
        -v "$here/postgis-seed.sql:/docker-entrypoint-initdb.d/950-seed.sql:ro" \
        "$image" postgres -c fsync=off -c synchronous_commit=off -c full_page_writes=off >/dev/null
    # Over TCP: during initdb the temporary server answers on the Unix socket only.
    for _ in $(seq 1 300); do
        if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" != true ]; then
            docker logs "$name" 2>&1 | grep -E "ERROR|FATAL|migrate:" | tail -20 >&2
            docker rm -f "$name" >/dev/null 2>&1 || true
            echo "postgis-fixture: the database stopped during initdb (logs above)" >&2; exit 1
        fi
        docker exec "$name" pg_isready -q -h 127.0.0.1 -U close_knit -d close_knit 2>/dev/null && break
        sleep 1
    done
    docker exec "$name" pg_isready -q -h 127.0.0.1 -U close_knit -d close_knit \
        || { docker rm -f "$name" >/dev/null; echo "postgis-fixture: not ready after 300 s" >&2; exit 1; }
    port="$(docker port "$name" 5432/tcp | head -1 | sed 's/.*://')"
    echo "export CLOSE_KNIT_TEST_DATABASE_CONTAINER=$name"
    echo "export CLOSE_KNIT_TEST_DATABASE_URL=postgresql://close_knit:test@127.0.0.1:$port/close_knit"
}

case "${1:-}" in
    start) start ;;
    stop) docker rm -f "${2:-${CLOSE_KNIT_TEST_DATABASE_CONTAINER:?nothing to stop}}" >/dev/null ;;
    *) echo "usage: postgis-fixture.sh start | stop [container]" >&2; exit 2 ;;
esac
