#!/usr/bin/env bash
# Local merge gate; there is no hosted CI. .githooks/pre-push runs `./gate.sh --fast` (enable once per clone with
# deploy/tools/install-hooks.sh). Swift/Kotlin contract suites run in Xcode / Gradle.
# Use the full gate as the evidence for a merge and before every release.
#   ./gate.sh            unit suites (the API's against a throwaway PostGIS), contracts, web build, Playwright desktop
#   ./gate.sh --fast     unit suites, PostGIS tests, contracts, web unit + typecheck; no build, no Playwright
#   ./gate.sh --mobile   also the Playwright mobile project
#   ./gate.sh --smoke    also deploy/smoke-test.sh (needs Docker; several minutes)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# A worktree has no venv of its own: fall back to the main checkout's.
main_checkout="$(cd "$here" && cd "$(git rev-parse --git-common-dir)/.." && pwd)"
py="${PYTHON:-$here/.ae-venv/bin/python}"
[ -x "$py" ] || py="$main_checkout/.ae-venv/bin/python"
[ -x "$py" ] || py=python3
mobile=0; smoke=0; fast=0
for arg in "$@"; do
    case "$arg" in
        --mobile) mobile=1 ;;
        --smoke) smoke=1 ;;
        --fast) fast=1 ;;
        *) echo "gate: unknown option $arg" >&2; exit 2 ;;
    esac
done
step() { printf '\n== %s\n' "$1"; }

unit() { # dir — print the unittest summary lines only; fail on FAILED
    (cd "$1" && "$py" -m unittest discover -s tests 2>&1 | grep -E "^(Ran |OK|FAILED)")
}
unit_coverage() { # dir package — unit under coverage.py: the total here, per module in <dir>/coverage.txt
    (cd "$1" && "$py" -m coverage run --branch --source="$2" -m unittest discover -s tests 2>&1 \
        | grep -E "^(Ran |OK|FAILED)" && "$py" -m coverage report >coverage.txt && tail -1 coverage.txt)
}
step "pipeline tests"
unit "$here/pipelines/area-analytics-ingest"
# The API's database tests (CLOSE_KNIT_TEST_DATABASE_URL) run against a throwaway PostGIS built by the
# migration runner plus a two-LAD seed (deploy/tests/postgis-fixture.sh); a URL already set is used instead.
if [ -z "${CLOSE_KNIT_TEST_DATABASE_URL:-}" ]; then
    step "postgis fixture"
    fixture="$("$here/deploy/tests/postgis-fixture.sh" start)"  # an assignment, so set -e sees a failed start
    eval "$fixture"
    trap '"$here/deploy/tests/postgis-fixture.sh" stop' EXIT
    echo "postgis fixture up ($CLOSE_KNIT_TEST_DATABASE_CONTAINER)"
fi
step "api tests"
if "$py" -c "import coverage" 2>/dev/null; then
    unit_coverage "$here/api" area_api
else
    echo "gate: coverage.py is not installed (pip install coverage): no coverage report"
    unit "$here/api"
fi
step "deploy tests"
# deploy's database tests need a loaded release (council tax, HMO...), not the two-LAD fixture: they skip.
CLOSE_KNIT_TEST_DATABASE_URL= unit "$here/deploy"
step "map topology (database)"
# The built area shapes and tiles (migration 119): every level a valid coverage, parents the union of their
# children, no overlap or gap in sample tiles z5-12 (deploy/tools/area_topology.py). The local copy by default.
topology_db="${CLOSE_KNIT_TOPOLOGY_DATABASE_URL:-postgresql://postgres@localhost:5434/area_explorer}"
if "$py" -c "import psycopg, sys; psycopg.connect(sys.argv[1], connect_timeout=3).execute('SELECT 1 FROM area_shape_zoom LIMIT 1')" "$topology_db" 2>/dev/null; then
    (cd "$here/deploy" && CLOSE_KNIT_TOPOLOGY_DATABASE_URL="$topology_db" "$py" -m unittest tests.test_area_topology 2>&1 | grep -E "^(Ran |OK|FAILED)")
else
    echo "skipped: no database with migration 119 at $topology_db (set CLOSE_KNIT_TOPOLOGY_DATABASE_URL)"
fi
step "contracts"
"$py" -c 'import json, pathlib; json.loads(pathlib.Path("contracts/style-contract.json").read_text())'
# contracts/openapi.yaml and web/src/lib/api-types.gen.ts are generated from the API's models: fail when stale.
[ -x "$here/web/node_modules/.bin/openapi-typescript" ] \
    || (cd "$here/web" && npm ci --no-audit --no-fund >/dev/null && echo "web deps installed")
"$py" "$here/deploy/tools/gen_openapi.py" --check && echo "contracts ok"
step "history comments"
"$py" "$here/scripts/check_history_comments.py"
step "compose config (base + prod overlay)"
(cd "$here/deploy" && CLOSE_KNIT_DB_PASSWORD=gate CLOSE_KNIT_OBJECTION_SALT=gate \
    CLOSE_KNIT_DOMAIN=gate.example CLOSE_KNIT_PUBLIC_URL=https://gate.example \
    docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet && echo "compose ok")

step "web unit + typecheck"
[ -d "$here/web/node_modules" ] || (cd "$here/web" && npm ci --no-audit --no-fund >/dev/null && echo "web deps installed")
(cd "$here/web" && npm test 2>&1 | grep -E "^ℹ (pass|fail)" && npm run typecheck >/dev/null && echo "web typecheck ok")
if [ "$fast" = 1 ]; then
    printf '\ngate --fast: all steps passed\n'
    exit 0
fi
step "web build"
(cd "$here/web" && npm run build >/dev/null && echo "web build ok")

step "playwright desktop"
# A stale test server on 4280 (left by an interrupted run) makes every project
# fail with "webServer was not able to start" — clear it first. Workers are
# set per project in web/playwright.config.ts (map specs fewer than DOM ones).
stale="$(lsof -ti :4280 || true)"
[ -z "$stale" ] || { echo "gate: killing stale test server on :4280 ($stale)"; kill $stale; sleep 1; }
(cd "$here/web" && npx playwright test --project=desktop 2>&1 | tail -3)
if [ "$mobile" = 1 ]; then
    step "playwright mobile"
    (cd "$here/web" && npx playwright test --project=mobile --grep-invert "layout sweep" 2>&1 | tail -3)
    # Sitemap + journey routes x 320/768/1024/1440 x Day/Night: overflow,
    # menus on screen, CLS, console errors (e2e/layout-sweep.spec.ts, three shards, ~9 min).
    step "layout sweep"
    sweep_start=$SECONDS
    (cd "$here/web" && npx playwright test e2e/layout-sweep.spec.ts --project=mobile 2>&1 | tail -3)
    echo "layout sweep took $((SECONDS - sweep_start))s"
fi
if [ "$smoke" = 1 ]; then
    step "compose smoke test"
    (cd "$here/deploy" && ./smoke-test.sh 2>&1 | tail -2)
fi
printf '\ngate: all steps passed\n'
