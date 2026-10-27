"""Counted invite links for the private preview (CLOSE_KNIT_ACCESS=private).

Caddy (deploy/access-private.caddy) sends /?invite=<code> here when the
browser has no access cookie yet. GET shows a one-button page, so link
previews (Telegram, WhatsApp fetch with GET) never spend a use; the POST
spends one use and sets the cookie Caddy checks on every request. Codes live
in access_invite (deploy/migrations/011-access-invite.sql) and are created
with deploy/tools/invite.sh.
"""
import html
import os
import re
from typing import Any, Callable

COOKIE = "ae_invite"
COOKIE_MAX_AGE = 30 * 24 * 3600
CODE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

REMAINING_SQL = "SELECT max_uses - used AS remaining FROM access_invite WHERE code = %s"
REDEEM_SQL = """UPDATE access_invite SET used = used + 1, last_used_at = now()
WHERE code = %s AND used < max_uses
RETURNING max_uses - used AS remaining"""

USED_UP = "This invite link has been used up. Ask the person who sent it to you for a new one."
INVALID = "This invite link is not valid. Ask the person who sent it to you for a new one."


def access_secret() -> str | None:
    """The cookie value Caddy accepts; invites are off unless it is 20+ characters."""
    secret = os.environ.get("CLOSE_KNIT_INVITE_TOKEN", "").strip()
    return secret if len(secret) >= 20 else None


def remaining(connect: Callable[[], Any], code: str) -> int | None:
    """Uses left on a code, or None when the code is malformed or unknown."""
    if not CODE_PATTERN.match(code or ""):
        return None
    with connect() as connection:
        rows = list(connection.execute(REMAINING_SQL, (code,)))
    return rows[0]["remaining"] if rows else None


def redeem(connect: Callable[[], Any], code: str) -> bool:
    """Spend one use atomically; False when the code is unknown or used up."""
    if not CODE_PATTERN.match(code or ""):
        return False
    with connect() as connection:
        return bool(list(connection.execute(REDEEM_SQL, (code,))))


def cookie_header(secret: str) -> str:
    return (f"{COOKIE}={secret}; Path=/; Max-Age={COOKIE_MAX_AGE}; "
            "HttpOnly; Secure; SameSite=Lax")


def page(title: str, body: str, code: str | None = None) -> str:
    """A self-contained page; with a code it carries the one-button redeem form."""
    form = "" if code is None else (
        '<form method="post" action="/access/redeem">'
        f'<input type="hidden" name="code" value="{html.escape(code)}">'
        '<button type="submit">Open the map</button></form>'
        "<p class=\"note\">This opens London Close Knit on this device for 30 days.</p>")
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:,">
<title>{html.escape(title)} · London Close Knit</title>
<style>
:root {{ color-scheme: light dark; --bg: #f5f3ed; --ink: #17322b; --muted: #55625d; --accent: #e9c46a; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg: #141a18; --ink: #eef1ec; --muted: #a9b4ae; }} }}
body {{ margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px;
  box-sizing: border-box; background: var(--bg); color: var(--ink);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }}
main {{ max-width: 26rem; display: grid; gap: 14px; }}
.mark {{ width: 44px; height: 44px; display: grid; place-items: center; border-radius: 12px;
  background: #17322b; color: var(--accent); font: 700 24px Georgia, serif; }}
h1 {{ margin: 0; font: 600 26px/1.2 Georgia, serif; }}
p {{ margin: 0; color: var(--muted); }}
button {{ min-height: 48px; width: 100%; border: 0; border-radius: 12px; background: var(--ink);
  color: var(--bg); font: 700 16px system-ui, sans-serif; cursor: pointer; }}
.note {{ font-size: 13px; margin-top: 8px; }}
</style></head>
<body><main><div class="mark" aria-hidden="true">A</div>
<h1>{html.escape(title)}</h1><p>{html.escape(body)}</p>{form}</main></body></html>"""
