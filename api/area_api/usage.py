"""How Close Knit is used, never who uses it: product usage events.

Pages send small batches to POST /api/v1/usage (through the web BFF) with an anonymous random
visitor id kept in the browser: none for EU time zones, nothing at all after "Analytics off" or
with Global Privacy Control (web/src/lib/usage.ts). The API itself records tool calls (MCP and
/api/v2/tools) and click-outs through /go/<portal>. No IP address, user agent, address, budget or
search profile is stored. Rows live in product_event (deploy/migrations/049-product-event.sql)
for RETENTION_DAYS and are summarised on the server with deploy/tools/usage.sh
(`python -m area_api.usage report|purge`). docs/product-analytics.md defines every event and metric.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import os
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Mapping
from urllib.parse import urlencode

logger = logging.getLogger(__name__)

RETENTION_DAYS = 180
MAX_BATCH = 40
MAX_TEXT = 120
PURGE_EVERY_SECONDS = 3600

# Event names and the props each may carry; anything else is dropped (old clients keep working).
WEB_EVENTS: dict[str, frozenset[str]] = {
    "page_view": frozenset({"path", "source", "landing", "shared"}),
    "engagement": frozenset({"path", "seconds"}),
    "search": frozenset({"kind", "results", "position", "query", "area", "label", "district"}),
    "search_empty": frozenset({"query"}),
    "match_run": frozenset({"market", "results"}),
    "area_open": frozenset({"from", "area"}),
    "portal_click": frozenset({"portal", "kind", "from", "market", "outcode", "area", "shape"}),
    "brief_share": frozenset({"audience", "outcome"}),
    "watch_open": frozenset({"from"}),
    "client_error": frozenset({"path", "digest"}),
    "wizard_open": frozenset({"from", "first"}),
    "wizard_review": frozenset(),
    "wizard_show": frozenset({"example"}),
    # Which analytics and places people look at (docs/product-analytics.md).
    "layer_view": frozenset({"layer", "custom", "preset", "label", "initial"}),
    "layer_subview": frozenset({"layer", "view"}),
    "layer_time": frozenset({"layer", "seconds"}),
    "area_select": frozenset({"area", "from"}),
    "map_view": frozenset({"zoom", "lat", "lng", "layer"}),
    "zone_change": frozenset({"action", "kind", "zones", "place", "walk", "areas", "corners", "lat", "lng"}),
    "section_open": frozenset({"section", "from", "area"}),
    # Tailor: how many of its 4 steps were answered, never the answers (personalisation-spec.md §5).
    "tailor_saved": frozenset({"steps"}),
    # A shared #profile= link that did not open in full: the failure kind and count, never the link.
    "profile_link": frozenset({"result", "version", "skipped"}),
    # My match's one list: what was done and to which kind of criterion, never a value or a place.
    "match_edit": frozenset({"action", "criterion", "criteria", "rank"}),
}
DEVICES = ("mobile", "tablet", "desktop")
VISITOR = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
SESSION = re.compile(r"^[A-Za-z0-9_-]{8,40}$")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
OUTCODE = re.compile(r"^[A-Z]{1,2}\d[A-Z\d]?$")
FULL_POSTCODE = re.compile(r"^([A-Z]{1,2}\d[A-Z\d]?) ?\d[A-Z]{2}$")
# Link previews and crawlers fetch links too; their visits are not people's.
BOT = re.compile(r"bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|"
                 r"embedly|headless|lighthouse|curl|wget|python-|go-http|claude-user|chatgpt-user|perplexity",
                 re.IGNORECASE)

GO_PORTALS = ("rightmove", "zoopla", "onthemarket", "openrent")
GO_SOURCES = ("mcp", "api", "web")

INSERT_SQL = """-- usage:insert
INSERT INTO product_event (channel, name, visitor_id, session_id, device, props)
VALUES (%s, %s, %s, %s, %s, %s::jsonb)"""
PURGE_SQL = """-- usage:purge
WITH gone AS (DELETE FROM product_event WHERE occurred_at < %s RETURNING 1) SELECT count(*) AS purged FROM gone"""

_last_purge = 0.0


def is_bot(user_agent: str | None) -> bool:
    return not user_agent or bool(BOT.search(user_agent))


def session_tag(raw: str | None) -> str | None:
    """A stable, non-reversible tag for an MCP session id (the header itself is never stored)."""
    return hashlib.sha256(raw.encode()).hexdigest()[:16] if raw else None


# A tag not taken from a session header starts with this, so the funnel can tell the two apart
# (session_id LIKE 'd-%'). Same length as session_tag's; matches SESSION, so /go links carry it too.
DERIVED_SESSION_PREFIX = "d-"


def derived_session_tag(client: str | None, user_agent: str | None, day: date | None = None,
                        salt: str | None = None) -> str | None:
    """A conversation tag for a client that sends no Mcp-Session-Id (#274): the same address and
    agent on the same UTC day share one. Salted and one-way, so nothing stored names the address."""
    if not client:
        return None
    day = day or datetime.now(timezone.utc).date()
    salt = os.environ.get("CLOSE_KNIT_OBJECTION_SALT", "close-knit-dev-salt") if salt is None else salt
    digest = hashlib.sha256(f"{salt}|{client}|{user_agent or ''}|{day.isoformat()}".encode()).hexdigest()
    return DERIVED_SESSION_PREFIX + digest[:14]


def _clean_value(value: Any) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value if abs(value) < 10**12 else None
    if isinstance(value, float):
        return round(value, 3) if math.isfinite(value) else None
    if isinstance(value, str):
        text = CONTROL.sub("", value).strip()[:MAX_TEXT]
        return text or None
    return None


def mask_query(query: Any) -> str | None:
    """A query that found nothing, kept to improve search. Words stay; a full postcode keeps only its
    district; anything else with a digit (a house number, an address) is not kept at all."""
    text = _clean_value(query)
    if not isinstance(text, str):
        return None
    text = " ".join(text.split())[:60]
    postcode = FULL_POSTCODE.match(text.upper())
    if postcode:
        return postcode.group(1)
    if OUTCODE.match(text.upper()):
        return text.upper()
    if re.search(r"\d", text):
        return "[with digits]"
    return text.lower()


def clean_props(name: str, props: Any, allowed: frozenset[str]) -> dict[str, Any]:
    if not isinstance(props, Mapping):
        return {}
    cleaned = {key: _clean_value(value) for key, value in props.items() if key in allowed}
    if name in ("search_empty", "search"):
        cleaned["query"] = mask_query(props.get("query"))
    if name == "search":
        district = str(cleaned.get("district") or "").upper()
        cleaned["district"] = district if OUTCODE.match(district) else None
    # Places on the map stay coarse (about a kilometre) whatever the page sends.
    for key in ("lat", "lng"):
        if key in cleaned:
            cleaned[key] = _coarse(cleaned[key], key)
    if "zoom" in cleaned:
        cleaned["zoom"] = round(cleaned["zoom"] * 2) / 2 if isinstance(cleaned["zoom"], (int, float)) and 0 <= cleaned["zoom"] <= 22 else None
    return {key: value for key, value in cleaned.items() if value is not None}


def _coarse(value: Any, key: str) -> float | None:
    """A latitude or longitude to two decimals, and only around Great Britain."""
    low, high = (49.0, 61.0) if key == "lat" else (-8.5, 2.5)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        return None
    return round(value, 2)


def clean_batch(payload: Any) -> list[tuple]:
    """Rows for INSERT_SQL from a page's batch; unknown events and props are dropped, never an error."""
    if not isinstance(payload, Mapping):
        return []
    visitor = payload.get("visitor")
    visitor = visitor if isinstance(visitor, str) and VISITOR.match(visitor) else None
    session = payload.get("session")
    session = session if isinstance(session, str) and SESSION.match(session) else None
    device = payload.get("device") if payload.get("device") in DEVICES else None
    events = payload.get("events")
    rows = []
    for event in events[:MAX_BATCH] if isinstance(events, list) else []:
        name = event.get("name") if isinstance(event, Mapping) else None
        if name not in WEB_EVENTS:
            continue
        props = clean_props(name, event.get("props"), WEB_EVENTS[name])
        rows.append(("web", name, visitor, session, device, json.dumps(props)))
    return rows


def store(connect: Callable[[], Any], rows: list[tuple]) -> int:
    """Insert rows; once an hour a process also purges rows past RETENTION_DAYS."""
    global _last_purge
    if not rows:
        return 0
    with connect() as connection:
        for row in rows:
            connection.execute(INSERT_SQL, row)
        if time.monotonic() - _last_purge > PURGE_EVERY_SECONDS:
            _last_purge = time.monotonic()
            connection.execute(PURGE_SQL, (_now() - timedelta(days=RETENTION_DAYS),))
    return len(rows)


def record(connect: Callable[[], Any] | None, channel: str, name: str, props: Mapping[str, Any],
           session: str | None = None) -> None:
    """One server-side event (a tool call, a click-out). Never raises: usage must not break a request."""
    if connect is None:
        return
    try:
        store(connect, [(channel, name, None, session, None,
                         json.dumps({key: value for key, value in props.items() if value is not None}))])
    except Exception:  # noqa: BLE001 - a missing table or database is logged, not raised
        logger.warning("usage event %s/%s not stored", channel, name, exc_info=True)


def tool_call_props(tool: str, started: float, result: Any = None, error_code: str | None = None,
                    client: str | None = None) -> dict[str, Any]:
    confidence = result.get("confidence") if isinstance(result, Mapping) else None
    return {"tool": tool, "ok": error_code is None, "code": error_code, "ms": round((time.monotonic() - started) * 1000),
            "confidence": confidence if isinstance(confidence, str) else None, "client": _clean_value(client)}


# ---- /go: counted click-outs to the portals ------------------------------------------------------------

def go_url(base: str, portal: str, *, outcode: str, market: str, max_price: int, min_bedrooms: int,
           source: str = "mcp", session: str | None = None, area: str | None = None) -> str:
    """A portal search through Close Knit's /go, which counts the visit and redirects to go_target."""
    query = {"kind": "listings", "outcode": outcode.upper(), "market": market, "max_price": max_price,
             "beds": min_bedrooms, "from": source}
    if area:
        query["area"] = area
    if session:
        query["s"] = session
    return f"{base.rstrip('/')}/go/{portal}?{urlencode(query)}"


def _int(value: str | None, low: int, high: int) -> int | None:
    try:
        number = int(value or "")
    except ValueError:
        return None
    return number if low <= number <= high else None


def go_target(portal: str, params: Mapping[str, str]) -> str | None:
    """The portal URL for a /go request, built from its parameters (never taken from them), or None."""
    from .home_search import portal_links  # home_search builds go links with this module
    from .portal_zones import with_search_id, zone_target

    outcode = (params.get("outcode") or "").upper()
    market = params.get("market") or "buy"
    zone = params.get("kind") == "zone"
    if portal not in GO_PORTALS or market not in ("buy", "rent") or not (zone or OUTCODE.match(outcode)):
        return None
    if params.get("kind") == "sold":
        return f"https://www.rightmove.co.uk/house-prices/{outcode.lower()}.html" if portal == "rightmove" else None
    max_price = _int(params.get("max_price"), 100, 100_000_000)
    beds = _int(params.get("beds"), 0, 10)
    if max_price is None or beds is None:
        return None
    target = zone_target(portal, market, params, max_price, beds) if zone else portal_links(outcode, market, max_price, beds).get(portal)
    # With the Close Knit extension installed, the link names the My match search it came from.
    return with_search_id(target, params.get("sid")) if target else None


def go_props(portal: str, params: Mapping[str, str]) -> dict[str, Any]:
    source = params.get("from")
    if portal.startswith("school-"):  # a school's Visit & links (school_links.py)
        return {"portal": portal, "kind": "school", "from": source if source in GO_SOURCES else None}
    kind = params.get("kind")
    return {"portal": portal, "kind": kind if kind in ("sold", "zone") else "listings",
            "shape": params.get("shape") if kind == "zone" and params.get("shape") in ("draw", "borough") else None,
            "from": source if source in GO_SOURCES else None, "market": params.get("market"),
            "outcode": (params.get("outcode") or "").upper() or None, "area": _clean_value(params.get("area"))}


# ---- Report ----------------------------------------------------------------------------------------------

REPORT_SQL: dict[str, str] = {
    "Active people (web, by anonymous id)": """
        SELECT count(DISTINCT visitor_id) FILTER (WHERE occurred_at >= now() - interval '1 day') AS dau,
               count(DISTINCT visitor_id) FILTER (WHERE occurred_at >= now() - interval '7 days') AS wau,
               count(DISTINCT visitor_id) AS mau,
               round(count(DISTINCT visitor_id) FILTER (WHERE occurred_at >= now() - interval '1 day')::numeric
                     / nullif(count(DISTINCT visitor_id), 0), 2) AS dau_per_mau,
               count(DISTINCT session_id) FILTER (WHERE visitor_id IS NULL) AS sessions_without_id
        FROM product_event WHERE channel = 'web' AND occurred_at >= now() - interval '30 days'""",
    "Daily active people, last 14 days": """
        SELECT occurred_at::date AS day, count(DISTINCT visitor_id) AS people, count(DISTINCT session_id) AS sessions,
               count(*) FILTER (WHERE name = 'page_view') AS page_views
        FROM product_event WHERE channel = 'web' AND occurred_at >= now() - interval '14 days'
        GROUP BY 1 ORDER BY 1""",
    "Engaged time per session (seconds, last 7 days)": """
        WITH per_session AS (
            SELECT session_id, sum((props->>'seconds')::numeric) AS seconds FROM product_event
            WHERE name = 'engagement' AND occurred_at >= now() - interval '7 days' GROUP BY 1)
        SELECT count(*) AS sessions, percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) AS median,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY seconds) AS p90 FROM per_session""",
    "Funnel, people in the last 7 days": """
        WITH people AS (
            SELECT visitor_id,
                   bool_or(name = 'page_view') AS visited,
                   bool_or(name IN ('search', 'match_run')) AS searched,
                   bool_or(name = 'area_open' OR (name = 'page_view' AND props->>'path' ~ '^/(area|property|postcode)/')) AS found,
                   bool_or(name = 'portal_click') AS clicked_out,
                   bool_or(name IN ('portal_click', 'watch_open', 'brief_share')) AS acted
            FROM product_event WHERE channel = 'web' AND visitor_id IS NOT NULL
              AND occurred_at >= now() - interval '7 days' GROUP BY 1)
        SELECT count(*) FILTER (WHERE visited) AS visited, count(*) FILTER (WHERE searched) AS searched,
               count(*) FILTER (WHERE found) AS found, count(*) FILTER (WHERE clicked_out) AS clicked_out,
               count(*) FILTER (WHERE acted) AS acted_north_star FROM people""",
    "Click-outs to the portals, last 30 days (people or MCP sessions, not clicks)": """
        SELECT channel, props->>'portal' AS portal, props->>'kind' AS kind,
               count(DISTINCT coalesce(visitor_id::text, session_id, id::text)) AS people, count(*) AS clicks
        FROM product_event WHERE name = 'portal_click' AND occurred_at >= now() - interval '30 days'
        GROUP BY 1, 2, 3 ORDER BY people DESC""",
    "Top areas clicked out from, last 30 days": """
        SELECT coalesce(props->>'area', props->>'outcode') AS area, count(DISTINCT coalesce(visitor_id::text, session_id)) AS people
        FROM product_event WHERE name = 'portal_click' AND occurred_at >= now() - interval '30 days'
        GROUP BY 1 ORDER BY people DESC LIMIT 10""",
    "Weekly retention: share of each week's new people back in later weeks": """
        WITH firsts AS (
            SELECT visitor_id, date_trunc('week', min(occurred_at)) AS cohort FROM product_event
            WHERE channel = 'web' AND visitor_id IS NOT NULL GROUP BY 1),
        weeks AS (
            SELECT DISTINCT visitor_id, date_trunc('week', occurred_at) AS week FROM product_event
            WHERE channel = 'web' AND visitor_id IS NOT NULL)
        SELECT f.cohort::date AS cohort, count(DISTINCT f.visitor_id) AS new_people,
               round(100.0 * count(DISTINCT w.visitor_id) FILTER (WHERE w.week = f.cohort + interval '1 week')
                     / count(DISTINCT f.visitor_id)) AS w1_pct,
               round(100.0 * count(DISTINCT w.visitor_id) FILTER (WHERE w.week = f.cohort + interval '2 weeks')
                     / count(DISTINCT f.visitor_id)) AS w2_pct,
               round(100.0 * count(DISTINCT w.visitor_id) FILTER (WHERE w.week = f.cohort + interval '4 weeks')
                     / count(DISTINCT f.visitor_id)) AS w4_pct
        FROM firsts f JOIN weeks w USING (visitor_id)
        WHERE f.cohort >= now() - interval '12 weeks' GROUP BY 1 ORDER BY 1""",
    "Where people come from, last 30 days": """
        SELECT coalesce(props->>'source', 'direct') AS source, count(DISTINCT visitor_id) AS people, count(*) AS visits
        FROM product_event WHERE name = 'page_view' AND occurred_at >= now() - interval '30 days'
          AND props ? 'source' GROUP BY 1 ORDER BY people DESC LIMIT 10""",
    "Search quality, last 30 days": """
        SELECT count(*) FILTER (WHERE name = 'search') AS chosen_results,
               count(*) FILTER (WHERE name = 'search_empty') AS searches_with_nothing,
               count(*) FILTER (WHERE name = 'match_run') AS area_matches,
               count(*) FILTER (WHERE name = 'match_run' AND (props->>'results')::int = 0) AS matches_with_nothing
        FROM product_event WHERE channel = 'web' AND occurred_at >= now() - interval '30 days'""",
    "Searches that found nothing, last 30 days": """
        SELECT props->>'query' AS query, count(*) AS times FROM product_event
        WHERE name = 'search_empty' AND occurred_at >= now() - interval '30 days'
        GROUP BY 1 ORDER BY times DESC LIMIT 15""",
    "MCP and agent API, last 30 days": """
        SELECT channel, props->>'tool' AS tool, count(*) AS calls, count(DISTINCT session_id) AS sessions,
               count(*) FILTER (WHERE (props->>'ok')::boolean IS FALSE) AS errors,
               count(*) FILTER (WHERE props->>'confidence' = 'none') AS empty,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY (props->>'ms')::int) AS p95_ms
        FROM product_event WHERE name = 'tool_call' AND occurred_at >= now() - interval '30 days'
        GROUP BY 1, 2 ORDER BY calls DESC""",
    "MCP clients, last 30 days": """
        SELECT coalesce(props->>'client', 'unknown') AS client, count(DISTINCT session_id) AS sessions, count(*) AS calls
        FROM product_event WHERE channel = 'mcp' AND occurred_at >= now() - interval '30 days'
        GROUP BY 1 ORDER BY sessions DESC""",
    "Client errors, last 7 days": """
        SELECT props->>'path' AS path, props->>'digest' AS digest, count(*) AS times FROM product_event
        WHERE name = 'client_error' AND occurred_at >= now() - interval '7 days' GROUP BY 1, 2 ORDER BY times DESC LIMIT 10""",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def report(connect: Callable[[], Any]) -> list[tuple[str, list[dict]]]:
    with connect() as connection:
        return [(title, [dict(row) for row in connection.execute(sql)]) for title, sql in REPORT_SQL.items()]


def purge(connect: Callable[[], Any]) -> int:
    with connect() as connection:
        return list(connection.execute(PURGE_SQL, (_now() - timedelta(days=RETENTION_DAYS),)))[0]["purged"]


def _format_table(rows: list[dict]) -> str:
    if not rows:
        return "  (none)"
    columns = list(rows[0])
    cells = [[str(row[column]) if row[column] is not None else "-" for column in columns] for row in rows]
    widths = [max(len(column), *(len(line[index]) for line in cells)) for index, column in enumerate(columns)]
    lines = ["  " + "  ".join(column.ljust(width) for column, width in zip(columns, widths))]
    lines += ["  " + "  ".join(cell.ljust(width) for cell, width in zip(line, widths)) for line in cells]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m area_api.usage", description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("report", help="active people, funnel, click-outs, retention, search and MCP use")
    commands.add_parser("purge", help=f"delete events older than {RETENTION_DAYS} days")
    args = parser.parse_args(argv)

    from .repository import close_pool, evidence_connection

    try:
        if args.command == "purge":
            print(f"purged {purge(evidence_connection)}")
            return 0
        for title, rows in report(evidence_connection):
            print(f"\n{title}\n{_format_table(rows)}")
        return 0
    finally:
        close_pool()


if __name__ == "__main__":
    raise SystemExit(main())
