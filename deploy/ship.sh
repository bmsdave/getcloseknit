#!/usr/bin/env bash
# Ship the committed code (and, optionally, a data snapshot) to the server
# and (re)start the production stack. Run from your machine:
#   deploy/ship.sh ubuntu@host                     code only
#   deploy/ship.sh ubuntu@host close-knit.dump  code + restore this snapshot
# The server keeps its own deploy/.env (created there with ./init-env.sh);
# nothing secret leaves this machine. The repository may stay private: the
# code travels as a git archive of HEAD, not through a clone.
set -euo pipefail
target="${1:?usage: ship.sh user@host [snapshot.dump]}"
dump="${2:-}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
archive="$(mktemp -t close-knit-code).tar.gz"
trap 'rm -f "$archive"' EXIT

[ -z "$(git -C "$repo" status --porcelain)" ] || echo "ship: warning: uncommitted changes are not shipped" >&2
git -C "$repo" archive --format=tar.gz -o "$archive" HEAD
echo "ship: code $(git -C "$repo" rev-parse --short HEAD) -> $target"
scp -q "$archive" "$target:/tmp/close-knit-code.tar.gz"
# Caddy's config files are single-file bind mounts, so tar --overwrite writes them in place (the
# default unlink-and-recreate would leave the container reading the old file). Hashed before and
# after: Caddy is reloaded below only when they changed.
caddy_config_hash() {
    ssh "$target" "cd /srv/close-knit/deploy && cat Caddyfile access-public.caddy access-private.caddy 2>/dev/null | sha256sum"
}
caddy_before="$(caddy_config_hash)"
# Unpack, then prune: a file deleted from git (a page, an API route) must leave the server too, or the
# build still compiles it. Only the code folders are pruned; deploy/ keeps .env and server-side files.
ssh "$target" "set -e; export LC_ALL=C; cd /srv/close-knit; tar -xzf /tmp/close-knit-code.tar.gz --overwrite; \
  tar -tzf /tmp/close-knit-code.tar.gz | grep -v '/\$' | sort > /tmp/close-knit-tracked; \
  find web api pipelines agents contracts -type f 2>/dev/null | sort | comm -23 - /tmp/close-knit-tracked \
    | xargs -r -d '\n' rm -v --; \
  rm /tmp/close-knit-tracked /tmp/close-knit-code.tar.gz"

ssh "$target" "test -f /srv/close-knit/deploy/.env" \
    || { echo "ship: run 'cd /srv/close-knit/deploy && ./init-env.sh' on the server and fill in .env first" >&2; exit 1; }

if [ -n "$dump" ]; then
    echo "ship: snapshot $(du -h "$dump" | cut -f1) -> $target"
    scp -q "$dump" "$dump.manifest.json" "$target:/srv/close-knit-data/"
    ssh "$target" "cd /srv/close-knit/deploy && $compose up -d database && \
        until $compose exec -T database pg_isready -h 127.0.0.1 -U close_knit -d close_knit >/dev/null 2>&1; do sleep 2; done && \
        tools/db-restore.sh /srv/close-knit-data/$(basename "$dump") -f docker-compose.prod.yml"
fi

# Migrations before the new API that reads them: every file of deploy/migrations not in the database's journal, each
# in one transaction (migrate.sh). A failed, edited or unjournalled migration stops the ship here, the old API still up.
ssh "$target" "cd /srv/close-knit/deploy && \
    CLOSE_KNIT_PSQL='$compose exec -T database psql -U close_knit -d close_knit' ./migrate.sh apply </dev/null"

# The map's area tiles are static archives Caddy serves from /srv/close-knit-tiles (tools/area_pmtiles.py, ~20 s for
# England), built here when the database records none (the first ship with migration 127), before the new API that
# names them starts. A rebuild for new boundaries is RELEASE-CHECKLIST.md's step. A one-off api container has psycopg
# and the database URL; as root, to write the host's folder.
ssh "$target" "cd /srv/close-knit/deploy && \
    if [ \"\$($compose exec -T database psql -U close_knit -d close_knit -Atc 'SELECT count(*) FROM area_pmtiles' </dev/null)\" = 0 ]; then \
        $compose run --rm --no-deps --user 0 -v /srv/close-knit-tiles:/out -v /srv/close-knit/deploy/tools:/tools:ro \
            api python /tools/area_pmtiles.py /out </dev/null; fi"

# What the active release derives (api/area_api/release_build.py into release_artifact, migration 128), built by the
# new image in a one-off container before the new API starts: the serving API keeps answering from its own rows
# meanwhile, and every new worker starts with it built. Tier 0: periods, map chunks, the area tree, school pools,
# borough and MSOA standouts, the sections' region lists, ready-made criteria and ranking lenses (keyed by the code:
# rebuilt each deploy, about a minute); tier 1: every layer's start pieces (keyed by release: read back, seconds,
# unless the release is new). A failed task stops the ship here, the old stack still up.
ssh "$target" "cd /srv/close-knit/deploy && $compose build api mcp web"
ssh "$target" "cd /srv/close-knit/deploy && \
    $compose run --rm --no-deps -T api python -m area_api.release_build --tiers 0,1 --jobs 4 --budget 900 </dev/null" \
    || { echo "ship: the release build failed (see above); nothing was restarted" >&2; exit 1; }

# Rebuild and recreate only api, mcp and web (--no-deps): Caddy keeps serving, and its upstreams retry
# for lb_try_duration (Caddyfile) while the new api starts, so /mcp never answers 502 during a
# ship (#275). Caddy is created when missing (first ship), never recreated here, and reloaded
# only when its config changed; reload validates the new config and keeps the old one on error.
# Build cache older than a week is pruned afterwards so rebuilds do not fill the disk.
ssh "$target" "cd /srv/close-knit/deploy && $compose up -d --build --no-deps api mcp web && $compose up -d --no-recreate caddy \
    && { docker builder prune -f --filter until=168h >/dev/null || true; }"
# A reload cannot add a volume: a Caddy created before the area tiles' mount (/srv/tiles) is recreated once.
ssh "$target" "cd /srv/close-knit/deploy && \
    { $compose exec -T caddy test -d /srv/tiles </dev/null || $compose up -d --no-deps --force-recreate caddy; }"
if [ "$caddy_before" != "$(caddy_config_hash)" ]; then
    echo "ship: Caddy config changed; reloading"
    ssh "$target" "cd /srv/close-knit/deploy && $compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile"
fi
# The rest of the map's pieces (every other LAD, then the regions in between) into release_artifact in the background,
# once the new API answers.
ssh "$target" "cd /srv/close-knit/deploy && \
    for i in \$(seq 1 60); do $compose exec -T api python -c 'import urllib.request; urllib.request.urlopen(\"http://127.0.0.1:8080/api/v1/health\", timeout=5)' </dev/null >/dev/null 2>&1 && break; sleep 2; done; \
    $compose exec -d api python -m area_api.release_build --tiers 2,3 --jobs 2 --no-prune" \
    || echo "ship: the map's other pieces did not start building" >&2
# The price layer's fixed scale is computed by the web app from the API's numbers (release_artifact): once per web
# process and release, so the first visitor after a deploy does not wait for it (it took 10 s, perf/layer-load).
# Every warm-up sends the team header, so any usage it touches counts as ours (area_api.usage.traffic).
ssh "$target" 'cd /srv/close-knit/deploy && . ./.env && base="$CLOSE_KNIT_PUBLIC_URL";
    auth=""; [ "${CLOSE_KNIT_ACCESS:-public}" = private ] && auth="-u $CLOSE_KNIT_ACCESS_USER:$CLOSE_KNIT_ACCESS_PASSWORD";
    release="$(curl -fsS $auth -H "x-close-knit-team: 1" "$base/api/v1/map/coverage" | python3 -c "import json,sys; print(json.load(sys.stdin).get(\"productReleaseId\") or \"\")")";
    curl -fsS -o /dev/null --max-time 120 $auth -H "x-close-knit-team: 1" "$base/api/v1/price-scale?mode=real&release=$release"' \
    || echo "ship: the price scale did not warm" >&2
# Warm the extension's card and results line (a King's Cross point): the first card after a restart
# read the per-release caches and its area cold (11 s); afterwards an area takes well under a second.
# The body goes on stdin, so no JSON is quoted inside the remote command.
warm_post() {
    ssh "$target" 'cd /srv/close-knit/deploy && . ./.env && base="$CLOSE_KNIT_PUBLIC_URL";
        auth=""; [ "${CLOSE_KNIT_ACCESS:-public}" = private ] && auth="-u $CLOSE_KNIT_ACCESS_USER:$CLOSE_KNIT_ACCESS_PASSWORD";
        curl -fsS -o /dev/null --max-time 60 $auth -H "content-type: application/json" \
            -H "x-close-knit-analytics: off" -H "x-close-knit-team: 1" --data-binary @- "$base'"$1"'"' <<<"$2"
}
listing='"listingId":"warmup","url":"https://www.rightmove.co.uk/properties/warmup","lat":51.5308,"lng":-0.1238'
warm_post /api/v1/listing-card "{\"v\":1,\"portal\":\"rightmove\",$listing,\"askingPrice\":650000,\"bedrooms\":2}" \
    && warm_post /api/v1/listing-badges "{\"v\":1,\"portal\":\"rightmove\",\"items\":[{$listing}]}" \
    || echo "ship: the extension card did not warm" >&2
echo "ship: stack is up; running preflight"
ssh "$target" "cd /srv/close-knit/deploy && ./preflight.sh" || {
    echo "ship: preflight reported failures (see above)" >&2; exit 1; }
