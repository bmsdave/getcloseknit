#!/usr/bin/env bash
# Release preflight: run against a started compose stack before opening it to
# the public. Exit 0 means every check in RELEASE-CHECKLIST.md that a script
# can verify has passed. Usage:
#   ./preflight.sh                # production: expects https PUBLIC_URL and the prod overlay
#   ./preflight.sh --local        # local stack on http://localhost:4180 / :8080
set -uo pipefail
deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mode="prod"
[ "${1:-}" = "--local" ] && mode="local"
env_file="$deploy_dir/.env"
if [ -f "$env_file" ]; then
    set -a; . "$env_file"; set +a
fi

failures=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }
warn() { printf 'WARN  %s\n' "$1"; }
require() { # name, description
    if [ -n "${!1:-}" ]; then pass "$1 is set"; else fail "$1 is not set ($2)"; fi
}

echo "== Configuration ($env_file)"
require CLOSE_KNIT_DB_PASSWORD "database password; ./init-env.sh generates one"
require CLOSE_KNIT_OBJECTION_SALT "hash salt for objections; ./init-env.sh generates one"
require CLOSE_KNIT_INTERNAL_KEY "web-to-API key that charges a server render as one page view; see .env.example"
require CLOSE_KNIT_CONTROLLER "legal name of the data controller shown on /privacy"
require CLOSE_KNIT_CONTACT_EMAIL "privacy contact shown on /privacy"
# A public deployment processes personal data (sale + address): the ICO fee is due before launch.
if [ -n "${CLOSE_KNIT_ICO_NUMBER:-}" ]; then pass "CLOSE_KNIT_ICO_NUMBER is set"
elif [ "$mode" = "prod" ]; then
    fail "CLOSE_KNIT_ICO_NUMBER is not set — register (docs/legal/ico-registration.md) before going public"
else
    warn "CLOSE_KNIT_ICO_NUMBER is not set — register (docs/legal/ico-registration.md) before going public"; fi
if [ -n "${CLOSE_KNIT_SMTP_HOST:-}" ] || [ -n "${CLOSE_KNIT_CORRECTIONS_WEBHOOK:-}" ]; then
    smtp_state=no; [ -n "${CLOSE_KNIT_SMTP_HOST:-}" ] && smtp_state=yes
    webhook_state=no; [ -n "${CLOSE_KNIT_CORRECTIONS_WEBHOOK:-}" ] && webhook_state=yes
    pass "a notification channel is configured (smtp=$smtp_state webhook=$webhook_state)"
else
    fail "neither CLOSE_KNIT_SMTP_HOST nor CLOSE_KNIT_CORRECTIONS_WEBHOOK is set — hide-my-home confirmations cannot be delivered"
fi
if [ "$mode" = "prod" ]; then
    require CLOSE_KNIT_DOMAIN "public host for TLS"
    case "${CLOSE_KNIT_PUBLIC_URL:-}" in
        https://*) pass "CLOSE_KNIT_PUBLIC_URL is https" ;;
        *) fail "CLOSE_KNIT_PUBLIC_URL must be https:// in production (got '${CLOSE_KNIT_PUBLIC_URL:-}')" ;;
    esac
    web_url="${CLOSE_KNIT_PUBLIC_URL:-}"
    compose=(docker compose -f "$deploy_dir/docker-compose.yml" -f "$deploy_dir/docker-compose.prod.yml")
    if "${compose[@]}" config 2>/dev/null | grep -qE '^\s+published: "(8080|4180|3000|5432)"'; then
        fail "a service other than caddy publishes a port — TRUST_PROXY would be spoofable"
    else pass "only caddy publishes ports"; fi
else
    web_url="${CLOSE_KNIT_WEB_URL:-http://localhost:4180}"
    compose=(docker compose -f "$deploy_dir/docker-compose.yml")
fi

echo "== Schema"
# Every file of deploy/migrations is in the database's journal and unchanged (migrate.sh, RELEASE-CHECKLIST.md).
if CLOSE_KNIT_PSQL="${compose[*]} exec -T database psql -U close_knit -d close_knit" "$deploy_dir/migrate.sh" status; then
    pass "every migration is applied (migrate.sh status)"
else
    fail "migrations pending or changed (listed above): run deploy/migrate.sh apply, or see RELEASE-CHECKLIST.md"
fi

echo "== Data release (release_data_health(), migration 134; /health reports the same)"
# Every English region has a typical price for >= 95% of its LSOAs, and the active release has the artifacts its
# tier-0/1 build left (python -m area_api.release_build --tiers 0,1). Rows: ok|check|detail.
data_checks="$("${compose[@]}" exec -T database psql -U close_knit -d close_knit -At -F '|' \
    -c "SELECT ok, check_name, detail FROM release_data_health(true)" 2>&1)"
if [ -z "$data_checks" ] || ! printf '%s\n' "$data_checks" | grep -qE '^[tf]\|'; then
    fail "release_data_health() did not answer: ${data_checks:-no output} (migration 134 applied?)"
else
    while IFS='|' read -r ok name detail; do
        case "$ok" in
            t) pass "$name: $detail" ;;
            f) fail "$name: $detail" ;;
        esac
    done <<< "$data_checks"
fi

echo "== Notification channels (python -m area_api.notify test)"
probe="${CLOSE_KNIT_CONTACT_EMAIL:-preflight@example.invalid}"
if "${compose[@]}" exec -T api python -m area_api.notify test "$probe"; then
    pass "notification self-test delivered to every configured channel"
else
    fail "notification self-test failed (see output above)"
fi

echo "== Running stack ($web_url)"
# Every curl from here on (xargs included) reads this config: the team header marks the checks as ours
# (area_api.usage.traffic), and on a private site the login is added below.
export CURL_HOME="$(mktemp -d)"
trap 'rm -rf "$CURL_HOME"' EXIT
printf 'header = "X-Close-Knit-Team: 1"\n' > "$CURL_HOME/.curlrc"
if [ "${CLOSE_KNIT_ACCESS:-public}" = private ]; then
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$web_url/")"
    if [ "$code" = 401 ]; then pass "site is private (401 without the login)"; else
        fail "CLOSE_KNIT_ACCESS=private but / answers $code without a login"; fi
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$web_url/manifest.webmanifest")"
    if [ "$code" = 200 ]; then pass "manifest is open (200 without the login)"; else
        fail "/manifest.webmanifest answers $code without a login (access-private.caddy)"; fi
    # Assistant directories need these public while the rest of the preview is not.
    for page in /privacy /terms /about; do
        code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$web_url$page")"
        if [ "$code" = 200 ]; then pass "$page is open (200 without the login)"; else
            fail "$page answers $code without a login (access-private.caddy)"; fi
    done
    # Every curl below (xargs included) sends the login too.
    printf 'user = "%s:%s"\n' "${CLOSE_KNIT_ACCESS_USER:-}" "${CLOSE_KNIT_ACCESS_PASSWORD:-}" >> "$CURL_HOME/.curlrc"
elif [ "$mode" = prod ]; then
    warn "site is public (CLOSE_KNIT_ACCESS=public)"
fi
if [ "$mode" = prod ] && [ "${CLOSE_KNIT_ACCESS:-public}" = private ]; then
    if curl -sI -m 10 "$web_url/" | grep -qi '^x-robots-tag: noindex'; then pass "pages say noindex (X-Robots-Tag)"
    else fail "no X-Robots-Tag: noindex on / (access-private.caddy)"; fi
elif [ "$mode" = prod ]; then
    if curl -sI -m 10 "$web_url/" | grep -qi '^x-robots-tag: noindex'; then fail "public site sends X-Robots-Tag: noindex"
    else pass "public site is indexable (no X-Robots-Tag)"; fi
    # The web container's meta robots: noindex unless CLOSE_KNIT_ACCESS=public is set explicitly.
    if curl -s -m 10 "$web_url/about" | grep -q 'name="robots" content="noindex'; then
        warn "pages say noindex: set CLOSE_KNIT_ACCESS=public in .env to let search engines list the site"
    else pass "pages carry no noindex meta robots"; fi
fi
health="$(curl -fsS -m 10 "$web_url/api/v1/health" 2>/dev/null || curl -fsS -m 10 "$web_url/health" 2>/dev/null)"
if printf '%s' "$health" | grep -q '"status":"ready"'; then
    pass "health is ready ($(printf '%s' "$health" | grep -o '"productReleaseId":"[^"]*"'))"
else
    fail "health is not ready: ${health:-no response}"
fi
if curl -fsS -m 10 "$web_url/api/v1/search?q=SW1A&limit=3" 2>/dev/null | grep -q '"addressId"'; then
    pass "search answers with addresses (data loaded)"
else
    fail "search returns no addresses — restore a release (deploy/tools/db-restore.sh)"
fi
privacy="$(curl -fsS -m 10 "$web_url/privacy" 2>/dev/null)"
if printf '%s' "$privacy" | grep -qF "${CLOSE_KNIT_CONTROLLER:-__unset__}"; then
    pass "/privacy names the controller"
else
    fail "/privacy does not show CLOSE_KNIT_CONTROLLER (is the web container using deploy/.env?)"
fi
# Twice the per-minute allowance in parallel: the bucket refills while the
# burst runs, so a burst equal to the limit can pass on a slow stack.
# /api/v1/stations is the default class: its first (minute) window, else the legacy rate. (Not /api/v1/metrics:
# the web shares the catalogue for a minute, lib/evidence-service.ts fetchSharedEvidence, so it never reaches the limit.)
limit="$(printf '%s' "${CLOSE_KNIT_RATE_DEFAULT:-${CLOSE_KNIT_RATE_LIMIT:-120/minute}}" | cut -d, -f1 | cut -d/ -f1)"
burst=$((limit * 2))
codes="$(seq "$burst" | xargs -P 50 -I{} curl -s -o /dev/null -m 15 -w '%{http_code}\n' "$web_url/api/v1/stations?q=bank" 2>/dev/null | sort | uniq -c | tr -s ' ' | tr '\n' ' ')"
if printf '%s' "$codes" | grep -q ' 429'; then
    pass "burst of $burst requests hits the rate limit ($codes)"
else
    fail "no 429 in a burst of $burst requests ($codes)"
fi
# Right after the burst the bucket is still empty: a 429 must carry Retry-After through the web.
retry=""
for _ in 1 2 3 4 5; do
    head="$(curl -s -i -o /dev/null -D - -m 15 "$web_url/api/v1/stations?q=bank" | tr -d '\r')"
    if printf '%s' "$head" | head -1 | grep -q ' 429'; then
        retry="$(printf '%s\n' "$head" | grep -i '^retry-after:' | tr '\n' ' ')"
        break
    fi
done
if [ -n "$retry" ]; then pass "a 429 through the web carries Retry-After ($retry)"; else
    fail "no 429 with Retry-After on the web response after the burst"; fi

echo
if [ "$failures" -eq 0 ]; then echo "preflight: all checks passed"; exit 0; fi
echo "preflight: $failures check(s) failed"; exit 1
