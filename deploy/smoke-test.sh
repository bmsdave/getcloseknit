#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose=(docker compose --project-name close-knit-smoke -f "$deploy_dir/docker-compose.yml")
export CLOSE_KNIT_DB_PASSWORD="close-knit-smoke-only"
export CLOSE_KNIT_OBJECTION_SALT="smoke-only-salt"
export CLOSE_KNIT_ACCESS=public  # the web container's meta robots; checked below

cleanup() {
    "${compose[@]}" down --volumes >/dev/null
}
trap cleanup EXIT

"${compose[@]}" up -d --build database api web
"${compose[@]}" exec -T database psql \
    -U close_knit -d close_knit -v ON_ERROR_STOP=1 \
    < "$deploy_dir/tests/seed-area.sql"

# The API and web come up on the freshly initialised schema: every migration
# applied, the objection/suppression objects present, rate limiting on.
for _ in $(seq 1 60); do
    curl -fsS -o /dev/null http://127.0.0.1:8080/api/v1/metrics 2>/dev/null && break
    sleep 2
done
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/health | grep -qE "200|503"
curl -sS -i "http://127.0.0.1:8080/api/v1/search?q=nowhere" | grep -qi "^x-ratelimit-limit"
"${compose[@]}" exec -T database psql -U close_knit -d close_knit -v ON_ERROR_STOP=1 -Atc \
    "select count(*) from pg_views where viewname = 'suppressed_dwelling'" | grep -qx 1
"${compose[@]}" exec -T database psql -U close_knit -d close_knit -v ON_ERROR_STOP=1 -Atc \
    "select property_tile(16, 32742, 21793) is not null" | grep -qx t
for _ in $(seq 1 60); do
    curl -fsS -o /dev/null http://127.0.0.1:4180/privacy 2>/dev/null && break
    sleep 2
done
curl -fsS http://127.0.0.1:4180/privacy | grep -q "legitimate interests"
# Public pages are indexable (no noindex; a private site says noindex), robots.txt keeps the API out.
privacy_page="$(curl -fsS http://127.0.0.1:4180/privacy)"
if grep -q 'name="robots" content="noindex' <<<"$privacy_page"; then echo "smoke: public /privacy says noindex" >&2; exit 1; fi
curl -fsS http://127.0.0.1:4180/robots.txt | grep -q "Disallow: /api/"
echo "smoke: database, api and web are up on a fresh schema"
