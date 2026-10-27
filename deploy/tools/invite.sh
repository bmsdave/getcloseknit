#!/usr/bin/env bash
# Counted invite links for the private preview (access-private.caddy). On the
# server, from deploy/:
#   tools/invite.sh create 20 "friends"   new link that opens the site 20 times
#   tools/invite.sh list                  codes, uses, notes
#   tools/invite.sh revoke <code>         no more uses (browsers already let in keep access)
# Every browser let in keeps access for 30 days; a new CLOSE_KNIT_INVITE_TOKEN
# in .env (then ship.sh) revokes them all.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
. ./.env
psql() { docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T database \
    psql -v ON_ERROR_STOP=1 -U close_knit -d close_knit -At "$@"; }
case "${1:-}" in
    create)
        uses="${2:?usage: invite.sh create <uses> [note]}"; note="${3:-}"
        [[ "$uses" =~ ^[1-9][0-9]*$ ]] || { echo "invite: uses must be a positive number" >&2; exit 1; }
        [ "${#CLOSE_KNIT_INVITE_TOKEN}" -ge 20 ] || { echo "invite: set CLOSE_KNIT_INVITE_TOKEN (20+ chars) in .env and ship first" >&2; exit 1; }
        code="$(openssl rand -hex 8)"
        # psql expands :'vars' only in script input, not in -c.
        psql -v code="$code" -v uses="$uses" -v note="$note" >/dev/null <<'SQL'
insert into access_invite (code, max_uses, note) values (:'code', :uses, nullif(:'note', ''));
SQL
        echo "${CLOSE_KNIT_PUBLIC_URL%/}/?invite=$code  ($uses opens${note:+, $note})" ;;
    list)
        psql -F $'\t' -c "select code, used || '/' || max_uses, coalesce(note, ''), to_char(created_at, 'YYYY-MM-DD'),
            coalesce(to_char(last_used_at, 'YYYY-MM-DD HH24:MI'), 'never') from access_invite order by created_at" ;;
    revoke)
        code="${2:?usage: invite.sh revoke <code>}"
        psql -v code="$code" <<'SQL'
update access_invite set max_uses = greatest(used, 1), used = greatest(used, 1) where code = :'code';
SQL
        ;;
    *) sed -n '2,9p' "$0"; exit 1 ;;
esac
