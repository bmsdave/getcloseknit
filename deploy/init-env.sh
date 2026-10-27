#!/usr/bin/env bash
# Create deploy/.env from .env.example with fresh secrets. Never overwrites.
set -euo pipefail
deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="$deploy_dir/.env"
if [ -e "$target" ]; then
    echo "init-env: $target already exists; edit it or remove it first" >&2
    exit 1
fi
secret() { openssl rand -hex 32; }
sed -e "s|^CLOSE_KNIT_DB_PASSWORD=.*|CLOSE_KNIT_DB_PASSWORD=$(secret)|" \
    -e "s|^CLOSE_KNIT_OBJECTION_SALT=.*|CLOSE_KNIT_OBJECTION_SALT=$(secret)|" \
    -e "s|^CLOSE_KNIT_INTERNAL_KEY=.*|CLOSE_KNIT_INTERNAL_KEY=$(secret)|" \
    -e "s|^CLOSE_KNIT_GRAFANA_ADMIN_PASSWORD=.*|CLOSE_KNIT_GRAFANA_ADMIN_PASSWORD=$(secret)|" \
    -e "s|^CLOSE_KNIT_GRAFANA_DB_PASSWORD=.*|CLOSE_KNIT_GRAFANA_DB_PASSWORD=$(secret)|" \
    "$deploy_dir/.env.example" > "$target"
chmod 600 "$target"
echo "init-env: wrote $target with generated secrets."
echo "init-env: now fill in CLOSE_KNIT_DOMAIN, PUBLIC_URL, CONTROLLER, CONTACT_EMAIL and a notification channel."
