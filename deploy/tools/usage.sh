#!/usr/bin/env bash
# Product usage (api/area_api/usage.py, docs/product-analytics.md). On the server, from deploy/:
#   tools/usage.sh report     active people, funnel, click-outs, retention, search quality, MCP use
#   tools/usage.sh purge      delete events older than 180 days (the API also does it hourly)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T api \
    python -m area_api.usage "${@:-report}"
