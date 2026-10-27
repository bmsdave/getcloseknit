#!/usr/bin/env python3
"""Build the analytics UI's dashboards (deploy/grafana/dashboards/*.json) from the queries here.

  python3 deploy/tools/grafana_dashboards.py          rewrite the JSON files
  python3 deploy/tools/grafana_dashboards.py --check  fail if they are out of date (tests run this)

Metric definitions: docs/product-analytics.md. "People" are distinct anonymous browser ids on the
web; click-outs and the north star also count MCP conversations (a session tag) as people.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "grafana" / "dashboards"
DS = {"type": "grafana-postgresql-datasource", "uid": "close-knit-analytics"}
PERSON = "coalesce(visitor_id::text, session_id)"
ACTED = "name IN ('portal_click', 'watch_open', 'brief_share')"


def target(sql: str, fmt: str = "table") -> dict:
    return {"refId": "A", "datasource": DS, "editorMode": "code", "rawQuery": True, "format": fmt,
            "rawSql": " ".join(sql.split())}


def panel(kind: str, title: str, sql: str, x: int, y: int, w: int, h: int, *, fmt: str = "table",
          description: str = "", unit: str | None = None, options: dict | None = None,
          overrides: list | None = None, minimum: float | None = None) -> dict:
    defaults: dict = {}
    if unit:
        defaults["unit"] = unit
    if minimum is not None:
        defaults["min"] = minimum
    return {"type": kind, "title": title, "description": description, "datasource": DS,
            "gridPos": {"x": x, "y": y, "w": w, "h": h}, "targets": [target(sql, fmt)],
            "fieldConfig": {"defaults": defaults, "overrides": overrides or []}, "options": options or {}}


def stat(title: str, sql: str, x: int, y: int, description: str, unit: str | None = None, w: int = 4) -> dict:
    return panel("stat", title, sql, x, y, w, 4, description=description, unit=unit, options={
        "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
        "colorMode": "none", "graphMode": "none", "textMode": "value"})


def series(title: str, sql: str, x: int, y: int, w: int, description: str, unit: str | None = None,
           bars: bool = False) -> dict:
    p = panel("timeseries", title, sql, x, y, w, 8, fmt="time_series", description=description, unit=unit,
              options={"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}})
    p["fieldConfig"]["defaults"]["custom"] = {"drawStyle": "bars" if bars else "line", "fillOpacity": 30 if bars else 10,
                                              "lineWidth": 2, "pointSize": 5, "showPoints": "auto"}
    return p


def table(title: str, sql: str, x: int, y: int, w: int, h: int, description: str) -> dict:
    return panel("table", title, sql, x, y, w, h, description=description,
                 options={"showHeader": True, "cellHeight": "sm"})


def bars(title: str, sql: str, x: int, y: int, w: int, h: int, description: str) -> dict:
    # Bars start at zero: the default (the smallest value) would draw the smallest step empty.
    p = panel("bargauge", title, sql, x, y, w, h, description=description, minimum=0, options={
        "orientation": "horizontal", "displayMode": "basic", "showUnfilled": True, "valueMode": "text",
        "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": True}})
    # One calm colour: a count is not good or bad (Grafana's default thresholds turn bars red at 80).
    p["fieldConfig"]["defaults"]["color"] = {"mode": "fixed", "fixedColor": "blue"}
    return p


def row(title: str, y: int) -> dict:
    return {"type": "row", "title": title, "collapsed": False, "gridPos": {"x": 0, "y": y, "w": 24, "h": 1}, "panels": []}


def dashboard(uid: str, title: str, description: str, panels: list[dict], time_from: str) -> dict:
    for index, item in enumerate(panels, 1):
        item["id"] = index
    return {"uid": uid, "title": title, "description": description, "tags": ["close-knit"], "editable": False,
            "timezone": "browser", "schemaVersion": 41, "version": 1, "refresh": "",
            "time": {"from": time_from, "to": "now"}, "templating": {"list": []}, "annotations": {"list": []},
            "links": [{"type": "dashboards", "tags": ["close-knit"], "asDropdown": False, "title": "Dashboards"}],
            "panels": panels}


WEB = "channel = 'web'"


def product() -> dict:
    p = [
        row("Now", 0),
        stat("People today", f"SELECT count(DISTINCT visitor_id) FROM product_event WHERE {WEB} AND occurred_at >= now() - interval '1 day'",
             0, 1, "People (anonymous browser ids) with any web event in the last 24 hours."),
        stat("People, 7 days", f"SELECT count(DISTINCT visitor_id) FROM product_event WHERE {WEB} AND occurred_at >= now() - interval '7 days'",
             4, 1, "WAU: people in the last 7 days."),
        stat("People, 30 days", f"SELECT count(DISTINCT visitor_id) FROM product_event WHERE {WEB} AND occurred_at >= now() - interval '30 days'",
             8, 1, "MAU: people in the last 30 days."),
        stat("DAU ÷ MAU", f"""SELECT count(DISTINCT visitor_id) FILTER (WHERE occurred_at >= now() - interval '1 day')::float
             / nullif(count(DISTINCT visitor_id), 0) FROM product_event WHERE {WEB} AND occurred_at >= now() - interval '30 days'""",
             12, 1, "DAU ÷ MAU.", unit="percentunit"),
        stat("Acted ★, 7 days", f"SELECT count(DISTINCT {PERSON}) FROM product_event WHERE {ACTED} AND occurred_at >= now() - interval '7 days'",
             16, 1, "North star: people or MCP conversations that followed a portal link, opened the listing watch or shared a brief."),
        stat("Clicked out, 7 days", f"SELECT count(DISTINCT {PERSON}) FROM product_event WHERE name = 'portal_click' AND occurred_at >= now() - interval '7 days'",
             20, 1, "People or MCP conversations who followed at least one portal link (site and Claude)."),
        row("Use over time (the time picker applies from here)", 5),
        series("Active people and sessions per day", f"""SELECT $__timeGroupAlias(occurred_at, 1d), count(DISTINCT visitor_id) AS "people",
               count(DISTINCT session_id) AS "sessions" FROM product_event WHERE {WEB} AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY 1""",
               0, 6, 12, "Distinct anonymous ids and visits (a visit ends after 30 idle minutes) per day."),
        series("Acted ★ per week", f"""SELECT $__timeGroupAlias(occurred_at, 7d), count(DISTINCT {PERSON}) FILTER (WHERE channel = 'web') AS "site",
               count(DISTINCT {PERSON}) FILTER (WHERE channel <> 'web') AS "Claude / agents"
               FROM product_event WHERE {ACTED} AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY 1""",
               12, 6, 12, "North star by week: people (site) and conversations (Claude) that acted.", bars=True),
        bars("Funnel: people in the chosen period", f"""WITH people AS (
               SELECT visitor_id, bool_or(name = 'page_view') AS visited, bool_or(name IN ('search', 'match_run')) AS searched,
                      bool_or(name = 'area_open' OR (name = 'page_view' AND props->>'path' ~ '^/(area|property|postcode)/')) AS found,
                      bool_or(name = 'portal_click') AS clicked_out, bool_or({ACTED}) AS acted
               FROM product_event WHERE {WEB} AND visitor_id IS NOT NULL AND $__timeFilter(occurred_at) GROUP BY 1)
             SELECT '1 visited' AS step, count(*) FILTER (WHERE visited) AS people FROM people
             UNION ALL SELECT '2 searched', count(*) FILTER (WHERE searched) FROM people
             UNION ALL SELECT '3 found an area or home', count(*) FILTER (WHERE found) FROM people
             UNION ALL SELECT '4 clicked out to a portal', count(*) FILTER (WHERE clicked_out) FROM people
             UNION ALL SELECT '5 acted ★', count(*) FILTER (WHERE acted) FROM people ORDER BY 1""",
             0, 14, 12, 8, "Happy path: visit → search → find → portal. Each step counts people who did it at least once."),
        series("Engaged time per visit (median, minutes)", """SELECT $__timeGroupAlias(day, 1d), percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) / 60 AS "median",
               percentile_cont(0.9) WITHIN GROUP (ORDER BY seconds) / 60 AS "p90"
               FROM (SELECT session_id, min(occurred_at) AS day, sum((props->>'seconds')::numeric) AS seconds FROM product_event
                     WHERE name = 'engagement' AND $__timeFilter(occurred_at) GROUP BY 1) visits GROUP BY 1 ORDER BY 1""",
               12, 14, 12, "Seconds with the tab visible and the reader active in the last 30 s, summed per visit.", unit="m"),
        row("Click-outs to the portals", 22),
        table("By portal and channel", """SELECT channel, props->>'portal' AS portal, props->>'kind' AS kind, props->>'from' AS "from",
              count(DISTINCT coalesce(visitor_id::text, session_id, id::text)) AS people, count(*) AS clicks
              FROM product_event WHERE name = 'portal_click' AND $__timeFilter(occurred_at) GROUP BY 1, 2, 3, 4 ORDER BY people DESC""",
              0, 23, 12, 8, "listings = homes for sale or to rent; sold = Rightmove sold prices (research, not intent)."),
        table("Areas people clicked out from", """SELECT coalesce(props->>'area', '-') AS area, props->>'outcode' AS district,
              count(DISTINCT coalesce(visitor_id::text, session_id)) AS people, count(*) AS clicks
              FROM product_event WHERE name = 'portal_click' AND $__timeFilter(occurred_at) GROUP BY 1, 2 ORDER BY people DESC LIMIT 20""",
              12, 23, 12, 8, "Area ids are LSOAs (open /area/lsoa/<code> on the site)."),
        row("Retention and sources", 31),
        table("Weekly retention (share of each week's new people back later)", f"""WITH firsts AS (
              SELECT visitor_id, date_trunc('week', min(occurred_at)) AS cohort FROM product_event
              WHERE {WEB} AND visitor_id IS NOT NULL GROUP BY 1),
            weeks AS (SELECT DISTINCT visitor_id, date_trunc('week', occurred_at) AS week FROM product_event
              WHERE {WEB} AND visitor_id IS NOT NULL)
            SELECT f.cohort::date AS "week of", count(DISTINCT f.visitor_id) AS "new people",
              round(100.0 * count(DISTINCT w.visitor_id) FILTER (WHERE w.week = f.cohort + interval '1 week') / count(DISTINCT f.visitor_id)) AS "week 1 %",
              round(100.0 * count(DISTINCT w.visitor_id) FILTER (WHERE w.week = f.cohort + interval '2 weeks') / count(DISTINCT f.visitor_id)) AS "week 2 %",
              round(100.0 * count(DISTINCT w.visitor_id) FILTER (WHERE w.week = f.cohort + interval '4 weeks') / count(DISTINCT f.visitor_id)) AS "week 4 %"
            FROM firsts f JOIN weeks w USING (visitor_id) WHERE f.cohort >= now() - interval '12 weeks' GROUP BY 1 ORDER BY 1 DESC""",
              0, 32, 12, 8, "A home search lasts weeks to months: someone who clicked out and left may be a success, not churn."),
        bars("Where people come from", """SELECT coalesce(props->>'source', 'direct') AS source, count(DISTINCT visitor_id) AS people
             FROM product_event WHERE name = 'page_view' AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY people DESC LIMIT 10""",
             12, 32, 6, 8, "invite, a utm_source, or the referring site's name."),
        bars("Devices", f"""SELECT coalesce(device, 'unknown') AS device, count(DISTINCT visitor_id) AS people FROM product_event
             WHERE {WEB} AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY people DESC""",
             18, 32, 6, 8, "By screen width: mobile < 640 px, tablet < 1024 px."),
        row("What people look for", 40),
        table("Searches that found nothing", """SELECT props->>'query' AS query, count(*) AS times FROM product_event
              WHERE name = 'search_empty' AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY times DESC LIMIT 20""",
              0, 41, 8, 9, "Words as typed; a postcode keeps its district; anything else with digits is not kept."),
        table("Search quality", f"""SELECT count(*) FILTER (WHERE name = 'search') AS "results chosen",
              count(*) FILTER (WHERE name = 'search_empty') AS "searches with nothing",
              count(*) FILTER (WHERE name = 'match_run') AS "area matches",
              count(*) FILTER (WHERE name = 'match_run' AND (props->>'results')::int = 0) AS "matches with no area"
              FROM product_event WHERE {WEB} AND $__timeFilter(occurred_at)""",
              8, 41, 8, 4, "Zero-result rates show where search or matching lets people down."),
        table("Searches by kind", """SELECT props->>'kind' AS kind, count(*) AS chosen FROM product_event
              WHERE name = 'search' AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY chosen DESC""",
              8, 45, 8, 5, "What people pick from the search box: a home, a postcode page, an area level."),
        table("Searches people opted to share (budget bands)", """SELECT market, budget_band AS "budget up to", bedrooms, count(*) AS searches
              FROM profile_analytics_event WHERE $__timeFilter(created_at) GROUP BY 1, 2, 3 ORDER BY searches DESC LIMIT 20""",
              16, 41, 8, 9, "Only from people who ticked 'Share redacted usage data' under Your search."),
        row("Errors", 50),
        table("Pages that failed to load", """SELECT props->>'path' AS path, props->>'digest' AS digest, count(*) AS times,
              max(occurred_at) AS "last" FROM product_event WHERE name = 'client_error' AND $__timeFilter(occurred_at)
              GROUP BY 1, 2 ORDER BY times DESC LIMIT 20""",
              0, 51, 24, 6, "The digest matches the server's log line for the same failure."),
    ]
    return dashboard("close-knit-product", "Close Knit · Product",
                     "How the site is used, never who uses it (docs/product-analytics.md).", p, "now-30d")


MCP = "channel IN ('mcp', 'api')"


def agents() -> dict:
    p = [
        row("Claude and the agent API", 0),
        stat("Conversations, 7d", "SELECT count(DISTINCT session_id) FROM product_event WHERE channel = 'mcp' AND occurred_at >= now() - interval '7 days'",
             0, 1, "Distinct MCP sessions (one-way tags) with a tool call."),
        stat("Tool calls, 7d", f"SELECT count(*) FROM product_event WHERE name = 'tool_call' AND {MCP} AND occurred_at >= now() - interval '7 days'",
             4, 1, "MCP and /api/v2/tools."),
        stat("Errors, 7d", f"""SELECT count(*) FILTER (WHERE (props->>'ok')::boolean IS FALSE)::float / nullif(count(*), 0)
             FROM product_event WHERE name = 'tool_call' AND {MCP} AND occurred_at >= now() - interval '7 days'""",
             8, 1, "Share of tool calls that returned an error code.", unit="percentunit"),
        stat("Clicked out, 7d", "SELECT count(DISTINCT coalesce(session_id, id::text)) FROM product_event WHERE name = 'portal_click' AND channel <> 'web' AND occurred_at >= now() - interval '7 days'",
             12, 1, "Conversations whose listing links (through /go) someone opened."),
        stat("Feedback, 30d", "SELECT count(*) FROM mcp_feedback WHERE created_at >= now() - interval '30 days'",
             16, 1, "Items sent with send_feedback."),
        stat("Median rating", "SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY rating) FROM mcp_feedback WHERE rating IS NOT NULL AND created_at >= now() - interval '90 days'",
             20, 1, "1–5, last 90 days."),
        series("Tool calls per day", f"""SELECT $__timeGroupAlias(occurred_at, 1d), props->>'tool' AS metric, count(*) AS value
               FROM product_event WHERE name = 'tool_call' AND {MCP} AND $__timeFilter(occurred_at) GROUP BY 1, 2 ORDER BY 1""",
               0, 5, 12, "By tool.", bars=True),
        series("Conversations and click-outs per day", """SELECT $__timeGroupAlias(occurred_at, 1d),
               count(DISTINCT session_id) FILTER (WHERE name = 'tool_call' AND channel = 'mcp') AS "conversations",
               count(DISTINCT coalesce(session_id, id::text)) FILTER (WHERE name = 'portal_click' AND channel <> 'web') AS "clicked out"
               FROM product_event WHERE $__timeFilter(occurred_at) GROUP BY 1 ORDER BY 1""",
               12, 5, 12, "Conversations that used a tool, and those that led someone to a portal."),
        table("Tools", f"""SELECT props->>'tool' AS tool, count(*) AS calls, count(DISTINCT session_id) AS conversations,
              count(*) FILTER (WHERE (props->>'ok')::boolean IS FALSE) AS errors,
              count(*) FILTER (WHERE props->>'confidence' = 'none') AS "empty answers",
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (props->>'ms')::int)) AS "median ms",
              round(percentile_cont(0.95) WITHIN GROUP (ORDER BY (props->>'ms')::int)) AS "p95 ms"
              FROM product_event WHERE name = 'tool_call' AND {MCP} AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY calls DESC""",
              0, 13, 16, 9, "Empty answers: confidence 'none' (nothing found)."),
        table("Clients", f"""SELECT channel, coalesce(props->>'client', 'unknown') AS client, count(DISTINCT session_id) AS conversations,
              count(*) AS calls FROM product_event WHERE name = 'tool_call' AND {MCP} AND $__timeFilter(occurred_at)
              GROUP BY 1, 2 ORDER BY calls DESC""",
              16, 13, 8, 9, "The client name from MCP initialize (e.g. claude-ai)."),
        table("Errors by tool and code", f"""SELECT props->>'tool' AS tool, props->>'code' AS code, count(*) AS times, max(occurred_at) AS "last"
              FROM product_event WHERE name = 'tool_call' AND {MCP} AND (props->>'ok')::boolean IS FALSE AND $__timeFilter(occurred_at)
              GROUP BY 1, 2 ORDER BY times DESC LIMIT 20""",
              0, 22, 10, 8, "Codes as the REST mirror returns them."),
        table("Feedback from assistants", """SELECT created_at AS "when", kind, rating, array_to_string(tools, ', ') AS tools, client, message
              FROM mcp_feedback WHERE $__timeFilter(created_at) ORDER BY created_at DESC LIMIT 50""",
              10, 22, 14, 8, "send_feedback items: about the product, contact details removed before storing."),
        table("Requests and ratings from agents", """SELECT created_at AS "when", tool, client, ok, intent, rating, bad, fix, good
              FROM mcp_call_note WHERE $__timeFilter(created_at) AND (intent IS NOT NULL OR rating IS NOT NULL)
              ORDER BY created_at DESC LIMIT 100""",
              0, 30, 18, 10, "CLOSE_KNIT_MCP_REQUEST_NOTES: the agent's intent for a call and its rating of the answer."),
        table("Ratings by tool", """SELECT tool, count(rating) AS rated, count(*) AS calls, round(avg(rating), 1) AS "avg rating",
              count(*) FILTER (WHERE rating <= 2) AS "rated 1-2" FROM mcp_call_note WHERE $__timeFilter(created_at)
              GROUP BY 1 ORDER BY calls DESC""",
              18, 30, 6, 10, "Agents' 1-5 ratings of answers (rate_previous, rate_answer)."),
    ]
    return dashboard("close-knit-agents", "Close Knit · Claude and agents",
                     "MCP and agent API use: tools, conversations, errors, click-outs and feedback.", p, "now-30d")


# ---- Critical user journeys (docs/critical-user-journeys.md) ---------------------------------------------

FOUND = ("name = 'area_open' OR (name = 'match_run' AND (props->>'results')::int > 0) "
         "OR (name = 'page_view' AND props->>'path' ~ '^/(area|property|postcode)/')")
SHORTLISTED = "name = 'match_run' AND (props->>'results')::int > 0"


def funnel_sql(key: str, where: str, steps: list[tuple[str, str]]) -> str:
    """A strict funnel: each step counts the people (or conversations) who did it and every step before it
    in the chosen period, with the share of the start and of the step before."""
    flags = ", ".join(f"bool_or({condition}) AS s{index}" for index, (_, condition) in enumerate(steps, 1))
    rows = " UNION ALL ".join(
        f"SELECT {index} AS n, '{label}' AS step, count(*) FILTER (WHERE {' AND '.join(f's{i}' for i in range(1, index + 1))}) AS people FROM f"
        for index, (label, _) in enumerate(steps, 1))
    return (f"WITH f AS (SELECT {key} AS who, {flags} FROM product_event WHERE {where} AND $__timeFilter(occurred_at) GROUP BY 1), "
            f"steps AS ({rows}) "
            "SELECT step, people, round(100.0 * people / nullif(first_value(people) OVER (ORDER BY n), 0)) AS \"% of start\", "
            "round(100.0 * people / nullif(lag(people) OVER (ORDER BY n), 0)) AS \"% of previous\" FROM steps ORDER BY n")


# One calm colour for every bar: a share of the start is not good or bad by itself (Grafana's default
# thresholds would paint 100 % red).
PERCENT_COLUMNS = [
    {"matcher": {"id": "byName", "options": "step"}, "properties": [{"id": "custom.width", "value": 230}]},
    {"matcher": {"id": "byName", "options": "people"}, "properties": [{"id": "custom.width", "value": 80}]},
    {"matcher": {"id": "byName", "options": "% of start"},
     "properties": [{"id": "custom.width", "value": 170},
                    {"id": "custom.cellOptions", "value": {"type": "gauge", "mode": "basic", "valueDisplayMode": "text"}},
                    {"id": "color", "value": {"mode": "fixed", "fixedColor": "blue"}},
                    {"id": "min", "value": 0}, {"id": "max", "value": 100}, {"id": "unit", "value": "percent"}]},
    {"matcher": {"id": "byName", "options": "% of previous"},
     "properties": [{"id": "unit", "value": "percent"}, {"id": "custom.align", "value": "left"}]},
]


def funnel(title: str, sql: str, x: int, y: int, w: int, h: int, description: str) -> dict:
    return panel("table", title, sql, x, y, w, h, description=description, overrides=PERCENT_COLUMNS,
                 options={"showHeader": True, "cellHeight": "md"})


def journeys() -> dict:
    web = f"{WEB} AND visitor_id IS NOT NULL"
    p = [
        row("1 · Find my area: questions → shortlist → an area → act", 0),
        funnel("Find my area", funnel_sql("visitor_id", web, [
            ("1 opened Find my area", "name = 'wizard_open'"),
            ("2 answered the basics", "name = 'wizard_review'"),
            ("3 asked for areas", "name = 'wizard_show'"),
            ("4 got a shortlist", SHORTLISTED),
            ("5 opened an area from it", "name = 'area_open'"),
            (f"6 acted ★", ACTED)]),
            0, 1, 12, 11, "The main happy path. Strict: each step counts people who also did every step before it."),
        funnel("Look up a place: search → area page → portal", funnel_sql("visitor_id", web, [
            ("1 searched for a place", "name = 'search' AND props->>'kind' <> 'home'"),
            ("2 opened an area or postcode page", "name = 'page_view' AND props->>'path' ~ '^/(area|postcode)/'"),
            ("3 clicked out to a portal", "name = 'portal_click'")]),
            12, 1, 12, 6, "For people who already have a place in mind."),
        funnel("Check a home: home → portal or sold prices", funnel_sql("visitor_id", web, [
            ("1 opened a home", "(name = 'search' AND props->>'kind' = 'home') OR (name = 'page_view' AND props->>'path' = '/property/:id')"),
            ("2 followed its portal links", "name = 'portal_click' AND props->>'from' = 'home'")]),
            12, 7, 12, 5, "Someone weighing up a particular home."),
        row("2 · Claude: a conversation from shortlist to listings", 12),
        funnel("Claude conversation", funnel_sql("session_id", "channel = 'mcp' AND session_id IS NOT NULL", [
            ("1 used a tool", "name = 'tool_call'"),
            ("2 shortlisted areas", "name = 'tool_call' AND props->>'tool' IN ('find_areas', 'match_areas', 'find_similar_areas', 'open_shared_search') AND (props->>'ok')::boolean"),
            ("3 looked closer at an area", "name = 'tool_call' AND props->>'tool' = 'get_area_overview'"),
            ("4 got listing links", "name = 'tool_call' AND props->>'tool' = 'get_listing_search_links'"),
            ("5 someone opened a listing ★", "name = 'portal_click'")]),
            0, 13, 12, 9, "Per MCP conversation (a session tag). Step 5 comes from /go links opened by a person."),
        funnel("Share and come back", f"""WITH f AS (SELECT visitor_id AS who, bool_or(name = 'brief_share') AS shared,
              bool_or(name = 'page_view' AND props ? 'shared') AS opened_shared,
              bool_or({ACTED}) AS acted, count(DISTINCT occurred_at::date) AS days
              FROM product_event WHERE {web} AND $__timeFilter(occurred_at) GROUP BY 1),
            steps AS (SELECT 1 AS n, 'people in the period' AS step, count(*) AS people FROM f
              UNION ALL SELECT 2, 'shared a link', count(*) FILTER (WHERE shared) FROM f
              UNION ALL SELECT 3, 'arrived through a shared link', count(*) FILTER (WHERE opened_shared) FROM f
              UNION ALL SELECT 4, '…and then acted ★', count(*) FILTER (WHERE opened_shared AND acted) FROM f
              UNION ALL SELECT 5, 'came back on another day', count(*) FILTER (WHERE days > 1) FROM f)
            SELECT step, people, round(100.0 * people / nullif(first_value(people) OVER (ORDER BY n), 0)) AS "% of start"
            FROM steps ORDER BY n""",
            12, 13, 12, 9, "Not a strict funnel: each line is its own share of everyone in the period."),
        row("3 · Time to value and entry channels", 22),
        stat("New people who found an area or home", f"""WITH v AS (SELECT visitor_id, min(occurred_at) AS first_seen,
             min(occurred_at) FILTER (WHERE {FOUND}) AS found_at FROM product_event WHERE {web} GROUP BY 1)
             SELECT count(*) FILTER (WHERE found_at IS NOT NULL)::float / nullif(count(*), 0) FROM v WHERE $__timeFilter(first_seen)""",
             0, 23, "People first seen in the period who opened an area, home or postcode page, or got a shortlist.", unit="percentunit", w=8),
        stat("Median time to first area", f"""WITH v AS (SELECT visitor_id, min(occurred_at) AS first_seen,
             min(occurred_at) FILTER (WHERE {FOUND}) AS found_at FROM product_event WHERE {web} GROUP BY 1)
             SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM found_at - first_seen))
             FROM v WHERE $__timeFilter(first_seen) AND found_at IS NOT NULL""",
             8, 23, "From a new person's first page to their first area, home or shortlist.", unit="s", w=8),
        stat("New people who clicked out", f"""WITH v AS (SELECT visitor_id, min(occurred_at) AS first_seen,
             min(occurred_at) FILTER (WHERE name = 'portal_click') AS out_at FROM product_event WHERE {web} GROUP BY 1)
             SELECT count(*) FILTER (WHERE out_at IS NOT NULL)::float / nullif(count(*), 0) FROM v WHERE $__timeFilter(first_seen)""",
             16, 23, "People first seen in the period who followed a portal link (so far).", unit="percentunit", w=8),
        stat("Median time to first click-out", f"""WITH v AS (SELECT visitor_id, min(occurred_at) AS first_seen,
             min(occurred_at) FILTER (WHERE name = 'portal_click') AS out_at FROM product_event WHERE {web} GROUP BY 1)
             SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM out_at - first_seen))
             FROM v WHERE $__timeFilter(first_seen) AND out_at IS NOT NULL""",
             0, 27, "From a new person's first page to their first portal click: minutes means one sitting, days means they came back.", unit="s", w=8),
        stat("Opened Find my area but never asked", f"""WITH f AS (SELECT visitor_id, bool_or(name = 'wizard_open') AS opened, bool_or(name = 'wizard_show') AS showed
             FROM product_event WHERE {web} AND $__timeFilter(occurred_at) GROUP BY 1)
             SELECT count(*) FILTER (WHERE opened AND NOT showed)::float / nullif(count(*) FILTER (WHERE opened), 0) FROM f""",
             8, 27, "Opened the questions but never asked for areas.", unit="percentunit", w=8),
        stat("Shortlists with no area", f"""SELECT count(*) FILTER (WHERE (props->>'results')::int = 0)::float / nullif(count(*), 0)
             FROM product_event WHERE name = 'match_run' AND $__timeFilter(occurred_at)""",
             16, 27, "Area matches that ranked nothing: the search was too strict.", unit="percentunit", w=8),
        table("By entry channel: where people drop off", f"""WITH entry AS (
              SELECT DISTINCT ON (visitor_id) visitor_id, coalesce(props->>'source', 'direct') AS source FROM product_event
              WHERE name = 'page_view' AND visitor_id IS NOT NULL ORDER BY visitor_id, occurred_at),
            f AS (SELECT visitor_id, bool_or(name IN ('search', 'match_run', 'wizard_open')) AS searched, bool_or({FOUND}) AS found,
              bool_or(name = 'portal_click') AS clicked_out, bool_or({ACTED}) AS acted
              FROM product_event WHERE {web} AND $__timeFilter(occurred_at) GROUP BY 1)
            SELECT e.source AS "came from", count(*) AS people,
              round(100.0 * count(*) FILTER (WHERE searched) / count(*)) AS "searched %",
              round(100.0 * count(*) FILTER (WHERE found) / count(*)) AS "found %",
              round(100.0 * count(*) FILTER (WHERE clicked_out) / count(*)) AS "clicked out %",
              round(100.0 * count(*) FILTER (WHERE acted) / count(*)) AS "acted ★ %"
            FROM f JOIN entry e USING (visitor_id) GROUP BY 1 ORDER BY people DESC""",
              0, 31, 24, 8, "Each person's channel is where their very first visit came from (invite, claude, google, direct…)."),
    ]
    return dashboard("close-knit-journeys", "Close Knit · Journeys",
                     "Critical user journeys as funnels (docs/critical-user-journeys.md).", p, "now-30d")


FEEDBACK = "site_feedback WHERE $__timeFilter(created_at)"


def feedback() -> dict:
    p = [
        row("Reviews and votes in the chosen period", 0),
        stat("Reviews", f"SELECT count(*) FROM {FEEDBACK} AND kind = 'review'", 0, 1,
             "Star reviews sent from /feedback or the prompt after a first action."),
        stat("Average rating", f"SELECT round(avg(rating), 2) FROM {FEEDBACK} AND kind = 'review'", 4, 1,
             "Mean of 1-5 stars (CSAT). Read it with the count: a handful of reviews swing it."),
        stat("Rated 4-5", f"SELECT avg((rating >= 4)::int) FROM {FEEDBACK} AND kind = 'review'", 8, 1,
             "Share of reviews with 4 or 5 stars.", unit="percentunit"),
        stat("Votes", f"SELECT count(*) FROM {FEEDBACK} AND kind = 'vote'", 12, 1,
             "Thumbs up or down on area-page cards and Find my area shortlists (a changed vote counts once)."),
        stat("Thumbs up", f"SELECT avg((vote = 1)::int) FROM {FEEDBACK} AND kind = 'vote'", 16, 1,
             "Share of votes that were thumbs up.", unit="percentunit"),
        series("Rating per week", f"""SELECT $__timeGroupAlias(created_at, 7d), round(avg(rating), 2) AS "average rating",
               count(*) AS "reviews" FROM {FEEDBACK} AND kind = 'review' GROUP BY 1 ORDER BY 1""",
               0, 5, 12, "Weekly average stars and the number of reviews behind it."),
        bars("Ratings 1-5", f"""SELECT rating || CASE WHEN rating = 1 THEN ' star' ELSE ' stars' END AS rating, count(*) AS reviews
             FROM {FEEDBACK} AND kind = 'review' GROUP BY rating ORDER BY rating DESC""",
             12, 5, 12, 8, "How many reviews gave each number of stars."),
        row("What people find useful", 13),
        bars("Area cards: share of thumbs up", f"""SELECT target || ' (' || count(*) || ' votes)' AS card,
             round(100 * avg((vote = 1)::int)) AS "% thumbs up" FROM {FEEDBACK} AND surface = 'area_card'
             GROUP BY target ORDER BY 2, count(*) DESC""",
             0, 14, 12, 9, "Per area-page card, worst first: the share of votes that were thumbs up, with the number of votes."),
        series("Shortlist: share of thumbs up by week", f"""SELECT $__timeGroupAlias(created_at, 7d),
               avg((vote = 1)::int) FILTER (WHERE target = 'buy') AS "buy", avg((vote = 1)::int) FILTER (WHERE target = 'rent') AS "rent"
               FROM {FEEDBACK} AND surface = 'shortlist' GROUP BY 1 ORDER BY 1""",
               12, 14, 12, "Are Find my area's shortlists a good fit? The weekly share of thumbs up, by market.", unit="percentunit"),
        table("Top reasons", f"""SELECT surface, CASE WHEN kind = 'vote' THEN 'thumbs down'
              WHEN rating >= 4 THEN 'worked (4-5 stars)' ELSE 'got in the way (1-3 stars)' END AS feeling,
              reason, count(*) AS times FROM site_feedback, unnest(tags) AS reason WHERE $__timeFilter(created_at)
              GROUP BY 1, 2, 3 ORDER BY times DESC""",
              0, 23, 12, 9, "The reasons people tapped: after a thumbs down, and with a star review."),
        table("Areas with the most thumbs down", f"""SELECT area, target AS card, count(*) AS "thumbs down"
              FROM {FEEDBACK} AND surface = 'area_card' AND vote = -1 AND area IS NOT NULL
              GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25""",
              12, 23, 12, 9, "Area pages whose cards people found least useful."),
        row("What people wrote", 32),
        table("Latest comments", f"""SELECT updated_at AS "time", surface || coalesce(':' || target, '') AS about,
              coalesce(rating || '/5', CASE vote WHEN 1 THEN 'up' WHEN -1 THEN 'down' END) AS score,
              array_to_string(tags, ', ') AS reasons, message, path, device
              FROM {FEEDBACK} AND message IS NOT NULL ORDER BY updated_at DESC LIMIT 100""",
              0, 33, 24, 10, "Free text, newest first. Contact details were removed before storing; there is no way to reply."),
    ]
    return dashboard("close-knit-feedback", "Close Knit · Feedback",
                     "Votes and reviews people chose to send (docs/superpowers/specs/2026-10-14-user-feedback-design.md).",
                     p, "now-30d")


# ---- What people look at: time, analytics, places, searches -------------------------------------------

LAYER_NAME = ("CASE WHEN props->>'layer' = 'custom' THEN 'custom: ' || coalesce(props->>'preset', 'own · ' || coalesce(props->>'label', '?')) "
              "ELSE props->>'layer' END")
AREA_TITLE = "coalesce(l.friendly_name || coalesce(' · ' || l.postcode_district, ''), v.area)"


def heatmap(title: str, sql: str, x: int, y: int, w: int, h: int, description: str) -> dict:
    p = panel("geomap", title, sql, x, y, w, h, description=description)
    p["options"] = {
        "view": {"id": "coords", "lat": 51.505, "lon": -0.11, "zoom": 10.2},
        "controls": {"showZoom": True, "mouseWheelZoom": True, "showAttribution": True},
        # OpenStreetMap raster tiles: Grafana's default CARTO basemap now needs an API key.
        "basemap": {"type": "osm-standard", "name": "OpenStreetMap"},
        "layers": [{"type": "heatmap", "name": "Map views", "tooltip": True,
                    "location": {"mode": "coords", "latitude": "lat", "longitude": "lng"},
                    "config": {"blur": 22, "radius": 12, "weight": {"field": "views", "fixed": 1, "min": 0, "max": 1}}}],
    }
    return p


def content() -> dict:
    web = f"{WEB} AND visitor_id IS NOT NULL"
    p = [
        row("Time spent", 0),
        stat("Engaged hours, 7 days", "SELECT sum((props->>'seconds')::numeric) / 3600 FROM product_event WHERE name = 'engagement' AND occurred_at >= now() - interval '7 days'",
             0, 1, "Hours with the tab visible and the reader active in the last 30 s, all people.", unit="h", w=6),
        stat("Minutes a person spends a day", """SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) / 60 FROM (
             SELECT visitor_id, occurred_at::date, sum((props->>'seconds')::numeric) AS seconds FROM product_event
             WHERE name = 'engagement' AND visitor_id IS NOT NULL AND occurred_at >= now() - interval '7 days' GROUP BY 1, 2) d""",
             6, 1, "Median engaged minutes per person on the days they came, last 7 days.", unit="m", w=6),
        stat("Visit length", """SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM last - first)) FROM (
             SELECT session_id, min(occurred_at) AS first, max(occurred_at) AS last FROM product_event
             WHERE channel = 'web' AND session_id IS NOT NULL AND occurred_at >= now() - interval '7 days' GROUP BY 1
             HAVING count(*) > 1) v""",
             12, 1, "Median time from a visit's first to last event (wall-clock, idle included), last 7 days.", unit="s", w=6),
        stat("Map views, 7 days", "SELECT count(*) FROM product_event WHERE name = 'map_view' AND occurred_at >= now() - interval '7 days'",
             18, 1, "Pans and zooms people made (at most one counted every 2 s).", w=6),
        series("Engaged hours per day", """SELECT $__timeGroupAlias(occurred_at, 1d), sum((props->>'seconds')::numeric) / 3600 AS "hours"
               FROM product_event WHERE name = 'engagement' AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY 1""",
               0, 5, 8, "Total engaged time across everyone.", bars=True),
        bars("Time by page (minutes)", """SELECT props->>'path' AS page, round(sum((props->>'seconds')::numeric) / 60) AS minutes
             FROM product_event WHERE name = 'engagement' AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY minutes DESC LIMIT 12""",
             8, 5, 8, 8, "Where the time goes: / is the map; homes and postcodes are templates."),
        bars("Time by map layer (minutes)", """SELECT props->>'layer' AS layer, round(sum((props->>'seconds')::numeric) / 60) AS minutes
             FROM product_event WHERE name = 'layer_time' AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY minutes DESC LIMIT 15""",
             16, 5, 8, 8, "Engaged time on the map, split by the layer on screen. custom:<slug> is a ready-made criterion, custom:own one people built."),
        row("Analytics people open", 13),
        table("Top analytics (map layers)", f"""SELECT {LAYER_NAME} AS analytic,
              count(DISTINCT {PERSON}) FILTER (WHERE NOT coalesce((props->>'initial')::boolean, false)) AS "people who chose it",
              count(*) FILTER (WHERE NOT coalesce((props->>'initial')::boolean, false)) AS "times chosen",
              count(*) FILTER (WHERE (props->>'initial')::boolean) AS "opened with the page"
              FROM product_event WHERE name = 'layer_view' AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY 2 DESC, 4 DESC LIMIT 25""",
              0, 14, 12, 10, "Built-in metrics, My match (personal-match) and custom criteria. 'Opened with the page' is the layer a link or the default showed."),
        table("Custom criteria: ready-made and people's own", """SELECT props->>'custom' AS kind, coalesce(props->>'preset', props->>'label', '?') AS criterion,
              count(DISTINCT coalesce(visitor_id::text, session_id)) AS people, count(*) AS times
              FROM product_event WHERE name = 'layer_view' AND props->>'layer' = 'custom' AND $__timeFilter(occurred_at)
              GROUP BY 1, 2 ORDER BY people DESC LIMIT 20""",
              12, 14, 12, 10, "preset = one of the ready-made criteria (by slug); own = built by the reader from neutral place types (its label)."),
        table("Sub-views inside a topic", """SELECT props->>'layer' AS topic, props->>'view' AS view, count(DISTINCT visitor_id) AS people, count(*) AS times
              FROM product_event WHERE name = 'layer_subview' AND $__timeFilter(occurred_at) GROUP BY 1, 2 ORDER BY times DESC LIMIT 20""",
              0, 24, 12, 8, "Views and scales picked within a map topic."),
        bars("Area page cards opened", """SELECT props->>'section' AS card, count(DISTINCT visitor_id) AS people FROM product_event
             WHERE name = 'section_open' AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY people DESC""",
             12, 24, 12, 8, "Cards on the full area page (price, sales, living, schools, around, environment, planning, council, home); 'all' is Open all."),
        row("Places people look at", 32),
        heatmap("Where people look on the map", """SELECT (props->>'lat')::float AS lat, (props->>'lng')::float AS lng, count(*) AS views
                FROM product_event WHERE name = 'map_view' AND props ? 'lat' AND $__timeFilter(occurred_at) GROUP BY 1, 2""",
                0, 33, 14, 14, "Centres of the map after people's own pans and zooms, to about a kilometre."),
        table("Top areas", f"""WITH v AS (
              SELECT props->>'area' AS area, {PERSON} AS who FROM product_event
              WHERE name IN ('area_select', 'area_open', 'section_open') AND props ? 'area' AND $__timeFilter(occurred_at)
              UNION ALL
              SELECT 'uk:lsoa:' || substring(props->>'path' FROM '^/area/lsoa/([A-Z0-9]+)'), {PERSON} FROM product_event
              WHERE name = 'page_view' AND props->>'path' ~ '^/area/lsoa/' AND $__timeFilter(occurred_at))
            SELECT {AREA_TITLE} AS area, v.area AS id, count(DISTINCT who) AS people, count(*) AS looks
            FROM v LEFT JOIN area_label l ON l.geography_id = v.area GROUP BY 1, 2 ORDER BY people DESC, looks DESC LIMIT 25""",
              14, 33, 10, 14, "Areas selected on the map, the ranking or search, opened from a shortlist, or read on their page."),
        bars("Zoom levels people use", """SELECT 'zoom ' || lpad(floor((props->>'zoom')::float)::int::text, 2, '0') AS zoom, count(*) AS views FROM product_event
             WHERE name = 'map_view' AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY 1""",
             0, 47, 8, 9, "10 ≈ all London, 13 ≈ a neighbourhood, 16 ≈ streets."),
        bars("How areas get selected", """SELECT props->>'from' AS "from", count(*) AS times FROM product_event
             WHERE name = 'area_select' AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY times DESC""",
             8, 47, 6, 9, "map = a click on the map; ranking = My match list; search; match_map = shortlist pins; panel = a neighbouring area link."),
        table("Zones people set in Find my area", """SELECT props->>'kind' AS kind, coalesce(props->>'place', CASE WHEN props ? 'lat' THEN 'drawn near ' || (props->>'lat') || ', ' || (props->>'lng') END) AS place,
              count(*) FILTER (WHERE props->>'action' = 'add') AS added, count(*) FILTER (WHERE props->>'action' = 'remove') AS removed,
              count(DISTINCT visitor_id) AS people FROM product_event WHERE name = 'zone_change' AND $__timeFilter(occurred_at)
              GROUP BY 1, 2 ORDER BY added DESC LIMIT 20""",
              14, 47, 10, 9, "Stations, boroughs and neighbourhoods by name; a drawn shape by its rough centre."),
        row("Searches", 56),
        table("What people type", """SELECT props->>'query' AS query, count(*) AS times, count(DISTINCT visitor_id) AS people,
              mode() WITHIN GROUP (ORDER BY props->>'kind') AS "usually chose"
              FROM product_event WHERE name = 'search' AND props ? 'query' AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY times DESC LIMIT 25""",
              0, 57, 8, 10, "Typed text that led to a chosen result: words as typed, a postcode as its district, anything with a house number as [with digits]."),
        table("What they chose", f"""SELECT props->>'kind' AS kind, coalesce(props->>'label', {AREA_TITLE.replace('v.area', "props->>'area'")}, props->>'district') AS place,
              count(*) AS times FROM product_event LEFT JOIN area_label l ON l.geography_id = props->>'area'
              WHERE name = 'search' AND $__timeFilter(occurred_at) GROUP BY 1, 2 ORDER BY times DESC LIMIT 25""",
              8, 57, 8, 10, "An area by name; a home, street or postcode only by its district."),
        table("Searches that found nothing", """SELECT props->>'query' AS query, count(*) AS times FROM product_event
              WHERE name = 'search_empty' AND $__timeFilter(occurred_at) GROUP BY 1 ORDER BY times DESC LIMIT 25""",
              16, 57, 8, 10, "Where search lets people down."),
    ]
    return dashboard("close-knit-content", "Close Knit · What people look at",
                     "Time spent, the analytics and places people open, map use and searches (docs/product-analytics.md).", p, "now-30d")


def rendered() -> dict[str, str]:
    return {f"{name}.json": json.dumps(build(), indent=2, ensure_ascii=False) + "\n"
            for name, build in (("product", product), ("agents", agents), ("journeys", journeys), ("content", content),
                                ("feedback", feedback))}


def main(argv: list[str]) -> int:
    files = rendered()
    if "--check" in argv:
        stale = [name for name, text in files.items() if not (OUT / name).exists() or (OUT / name).read_text() != text]
        if stale:
            print(f"grafana_dashboards: out of date: {', '.join(stale)} (run without --check)", file=sys.stderr)
            return 1
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (OUT / name).write_text(text)
    print(f"wrote {', '.join(files)} to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
