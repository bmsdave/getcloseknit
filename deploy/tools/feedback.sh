#!/usr/bin/env bash
# Feedback sent through the MCP send_feedback tool (api/area_api/feedback.py). On the
# server, from deploy/:
#   tools/feedback.sh list              the last 30 days, oldest first
#   tools/feedback.sh list --days 7     a shorter window (--json for one object per line)
#   tools/feedback.sh purge             delete items older than 12 months (also done on each new one)
# Votes and reviews from the website (api/area_api/site_feedback.py), the same commands after "web":
#   tools/feedback.sh web list --days 7
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
module=area_api.feedback
if [ "${1:-}" = web ]; then
    module=area_api.site_feedback
    shift
fi
exec docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T api \
    python -m "$module" "${@:-list}"
