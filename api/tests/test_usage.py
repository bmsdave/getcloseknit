"""Product usage events: only known events and props are kept, nothing identifies a person, bots are
not counted, /go only ever opens the portals, and tool calls are recorded without breaking them."""
import json
import os
import time
from datetime import date
from pathlib import Path
import unittest
import unittest.mock
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

from area_api import home_search, mcp_server, usage
from area_api.tools import ToolContext

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api.repository import evidence_connection
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover
    TestClient = None

VISITOR = "2f1c7a4e-8b3d-4c6e-9a1f-0d2e3c4b5a69"
BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15"


class FakeUsageConnection:
    def __init__(self):
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- usage:insert":
            channel, name, visitor, session, device, props = params
            self.rows.append({"channel": channel, "name": name, "visitor": visitor, "session": session,
                              "device": device, "props": json.loads(props)})
            return []
        if marker == "-- usage:purge":
            return [{"purged": 0}]
        raise AssertionError(sql)


class CleanBatchTests(unittest.TestCase):
    def test_keeps_known_events_and_props_only(self):
        rows = usage.clean_batch({"visitor": VISITOR, "session": "s3ss10n-abc", "device": "mobile", "events": [
            {"name": "page_view", "props": {"path": "/area/lsoa/E01000001", "source": "invite", "email": "a@b.c"}},
            {"name": "made_up", "props": {}},
            {"name": "portal_click", "props": {"portal": "zoopla", "kind": "listings", "from": "shortlist",
                                               "outcode": "E8", "price": 650000}},
        ]})

        self.assertEqual([row[1] for row in rows], ["page_view", "portal_click"])
        self.assertEqual(json.loads(rows[0][5]), {"path": "/area/lsoa/E01000001", "source": "invite"})
        self.assertEqual(json.loads(rows[1][5]), {"portal": "zoopla", "kind": "listings", "from": "shortlist",
                                                  "outcode": "E8"})
        self.assertEqual(rows[0][:5], ("web", "page_view", VISITOR, "s3ss10n-abc", "mobile"))

    def test_journey_steps_and_shared_links_are_kept_without_their_contents(self):
        rows = usage.clean_batch({"events": [
            {"name": "page_view", "props": {"path": "/", "landing": True, "shared": "search", "hash": "#profile=v1.x"}},
            {"name": "wizard_open", "props": {"from": "map", "first": True}},
            {"name": "wizard_review", "props": {"budget": 650000}},
            {"name": "wizard_show", "props": {"example": False}},
        ]})
        self.assertEqual([json.loads(row[5]) for row in rows], [
            {"path": "/", "landing": True, "shared": "search"}, {"from": "map", "first": True}, {}, {"example": False}])

    def test_map_and_analytics_events_keep_places_coarse_and_searches_masked(self):
        rows = usage.clean_batch({"events": [
            {"name": "map_view", "props": {"zoom": 13.37, "lat": 51.54321, "lng": -0.05678, "layer": "crime"}},
            {"name": "map_view", "props": {"zoom": 40, "lat": 10.0, "lng": 100.0}},
            {"name": "search", "props": {"kind": "home", "query": "12 Mare Street", "district": "e8", "address": "12 Mare St"}},
            {"name": "search", "props": {"kind": "lsoa", "query": "Hackney Central", "area": "uk:lsoa:E01001234",
                                         "label": "Hackney 021A", "district": "not a district"}},
            {"name": "layer_view", "props": {"layer": "custom", "custom": "preset", "preset": "gyms", "initial": False}},
            {"name": "zone_change", "props": {"action": "add", "kind": "polygon", "corners": 5, "lat": 51.5555, "lng": -0.1111,
                                              "points": [[51.5, -0.1]]}},
            {"name": "section_open", "props": {"section": "schools", "from": "card", "area": "uk:lsoa:E01001234"}},
            {"name": "layer_time", "props": {"layer": "price-per-square-metre", "seconds": 35}},
        ]})
        props = [json.loads(row[5]) for row in rows]
        self.assertEqual(props[0], {"zoom": 13.5, "lat": 51.54, "lng": -0.06, "layer": "crime"})
        self.assertEqual(props[1], {})
        self.assertEqual(props[2], {"kind": "home", "query": "[with digits]", "district": "E8"})
        self.assertEqual(props[3], {"kind": "lsoa", "query": "hackney central", "area": "uk:lsoa:E01001234", "label": "Hackney 021A"})
        self.assertEqual(props[4]["preset"], "gyms")
        self.assertEqual(props[5], {"action": "add", "kind": "polygon", "corners": 5, "lat": 51.56, "lng": -0.11})
        self.assertEqual(props[6]["section"], "schools")
        self.assertEqual(props[7], {"layer": "price-per-square-metre", "seconds": 35})

    def test_an_invalid_visitor_session_or_device_is_dropped_not_the_event(self):
        rows = usage.clean_batch({"visitor": "me@example.org", "session": "x", "device": "fridge",
                                  "events": [{"name": "page_view", "props": {"path": "/"}}]})
        self.assertEqual(rows[0][2:5], (None, None, None))

    def test_batches_are_capped_and_garbage_is_ignored(self):
        events = [{"name": "page_view", "props": {"path": "/"}}] * 100
        self.assertEqual(len(usage.clean_batch({"events": events})), usage.MAX_BATCH)
        for payload in (None, [], "x", {"events": "x"}, {"events": [None, 3, "page_view"]}):
            self.assertEqual(usage.clean_batch(payload), [])

    def test_values_are_scalars_and_short(self):
        rows = usage.clean_batch({"events": [{"name": "engagement", "props": {
            "path": "/" + "x" * 500, "seconds": float("nan")}}]})
        props = json.loads(rows[0][5])
        self.assertEqual(len(props["path"]), usage.MAX_TEXT)
        self.assertNotIn("seconds", props)


class MaskQueryTests(unittest.TestCase):
    def test_words_stay_and_numbers_never_do(self):
        self.assertEqual(usage.mask_query("  Stoke   Newington "), "stoke newington")
        self.assertEqual(usage.mask_query("e8 3aa"), "E8")
        self.assertEqual(usage.mask_query("sw1a"), "SW1A")
        self.assertEqual(usage.mask_query("12 Acacia Avenue"), "[with digits]")
        self.assertIsNone(usage.mask_query(None))

    def test_search_empty_props_are_masked(self):
        rows = usage.clean_batch({"events": [{"name": "search_empty", "props": {"query": "Flat 4, 10 Mare St"}}]})
        self.assertEqual(json.loads(rows[0][5]), {"query": "[with digits]"})


class GoTests(unittest.TestCase):
    def test_round_trip_opens_the_same_portal_search(self):
        url = usage.go_url("https://getcloseknit.com", "rightmove", outcode="e8", market="buy", max_price=650_000,
                           min_bedrooms=2, session="abcdef0123456789", area="uk:lsoa:E01000001")
        parts = urlsplit(url)
        self.assertEqual(parts.path, "/go/rightmove")
        params = {key: values[0] for key, values in parse_qs(parts.query).items()}
        self.assertEqual(usage.go_target("rightmove", params),
                         home_search.portal_links("E8", "buy", 650_000, 2)["rightmove"])
        self.assertEqual(usage.go_props("rightmove", params)["from"], "mcp")

    def test_sold_prices_are_rightmove_only(self):
        self.assertEqual(usage.go_target("rightmove", {"kind": "sold", "outcode": "N16"}),
                         "https://www.rightmove.co.uk/house-prices/n16.html")
        self.assertIsNone(usage.go_target("zoopla", {"kind": "sold", "outcode": "N16"}))

    def test_never_an_open_redirect(self):
        good = {"outcode": "E8", "market": "buy", "max_price": "650000", "beds": "2"}
        for portal, params in (("evil.example", good), ("rightmove", {**good, "outcode": "//evil.example"}),
                               ("rightmove", {**good, "market": "steal"}), ("rightmove", {**good, "beds": "x"}),
                               ("openrent", {**good, "max_price": "1"})):
            with self.subTest(portal=portal, params=params):
                self.assertIsNone(usage.go_target(portal, params))
        # OpenRent lists rentals only.
        self.assertIsNone(usage.go_target("openrent", good))

    def test_link_previews_and_agents_are_bots(self):
        for agent in ("TelegramBot (like TwitterBot)", "WhatsApp/2.23", "Slackbot-LinkExpanding 1.0",
                      "Mozilla/5.0 (compatible; Claude-User/1.0)", "curl/8.5.0", None, ""):
            self.assertTrue(usage.is_bot(agent), agent)
        self.assertFalse(usage.is_bot(BROWSER))


class ToolCallTests(unittest.TestCase):
    def test_listing_links_go_through_close_knit_and_keep_the_direct_ones(self):
        search = {"outcode": "NW1", "areaIds": ["uk:lsoa:E01000001"],
                  "links": home_search.portal_links("NW1", "buy", 600_000, 2)}
        args = home_search.ListingLinksInput(area_ids=["uk:lsoa:E01000001"], max_price=600_000, min_bedrooms=2)
        counted = home_search._counted(search, "abcdef0123456789", args)

        self.assertEqual(counted["portalUrls"], search["links"])
        for portal, link in counted["links"].items():
            params = {key: values[0] for key, values in parse_qs(urlsplit(link).query).items()}
            self.assertEqual(urlsplit(link).path, f"/go/{portal}")
            self.assertEqual(params["s"], "abcdef0123456789")
            self.assertEqual(usage.go_target(portal, params), search["links"][portal])

    @unittest.mock.patch.dict(os.environ, {"CLOSE_KNIT_MCP_DATA": "1"})
    def test_mcp_calls_are_recorded_with_session_and_client(self):
        connection = FakeUsageConnection()
        reader = SimpleNamespace(_connect=lambda: connection)
        context = ToolContext(reader=reader, session="abcdef0123456789")
        with unittest.mock.patch.object(mcp_server, "call_tool", return_value={"confidence": "high"}):
            mcp_server._call_with_codes("find_areas", context, {}, "claude-ai")
        with unittest.mock.patch.object(mcp_server, "call_tool", side_effect=ValueError("bad budget")):
            with self.assertRaises(mcp_server.ToolError):
                mcp_server._call_with_codes("find_areas", context, {}, "claude-ai")

        ok, failed = connection.rows
        self.assertEqual((ok["channel"], ok["name"], ok["session"]), ("mcp", "tool_call", "abcdef0123456789"))
        self.assertEqual({key: ok["props"][key] for key in ("tool", "ok", "confidence", "client")},
                         {"tool": "find_areas", "ok": True, "confidence": "high", "client": "claude-ai"})
        self.assertFalse(failed["props"]["ok"])
        self.assertIn("code", failed["props"])

    def test_a_broken_store_never_breaks_the_tool(self):
        def broken():
            raise RuntimeError("no database")
        usage.record(broken, "mcp", "tool_call", {"tool": "find_areas"})
        usage.record(None, "mcp", "tool_call", {"tool": "find_areas"})

    def test_request_identity_hashes_the_session_and_reads_the_client(self):
        request_context = SimpleNamespace(
            request=SimpleNamespace(headers={"mcp-session-id": "raw-session"}),
            session=SimpleNamespace(client_params=SimpleNamespace(client_info=SimpleNamespace(name="claude-ai"))))
        session, client = mcp_server.request_identity(SimpleNamespace(request_context=request_context))
        self.assertEqual(session, usage.session_tag("raw-session"))
        self.assertNotIn("raw-session", session)
        self.assertEqual(client, "claude-ai")
        self.assertEqual(mcp_server.request_identity(None), (None, None))

    def test_a_request_without_the_session_header_gets_a_derived_tag(self):
        def identity(agent="claude-ai/1.0", forwarded="203.0.113.9"):
            headers = {"user-agent": agent}
            scope = {"headers": [(b"x-forwarded-for", forwarded.encode())], "client": ("10.0.0.2", 4000)}
            request_context = SimpleNamespace(request=SimpleNamespace(headers=headers, scope=scope),
                                              session=SimpleNamespace(client_params=None))
            return mcp_server.request_identity(SimpleNamespace(request_context=request_context))

        with unittest.mock.patch.dict(os.environ, {"CLOSE_KNIT_TRUST_PROXY": "1"}):
            session, client = identity()
            self.assertTrue(session.startswith(usage.DERIVED_SESSION_PREFIX))
            self.assertRegex(session, usage.SESSION)  # /go links carry it like a real session tag
            self.assertEqual(session, identity()[0])  # the same client and agent share one conversation
            self.assertNotEqual(session, identity(agent="other-agent/2")[0])
            self.assertNotEqual(session, identity(forwarded="198.51.100.7")[0])
            self.assertNotIn("203.0.113.9", session)
            self.assertIsNone(client)
        self.assertNotEqual(usage.derived_session_tag("203.0.113.9", "a", date(2026, 10, 20)),
                            usage.derived_session_tag("203.0.113.9", "a", date(2026, 10, 21)))
        self.assertIsNone(usage.derived_session_tag(None, "a"))
        # A real header still wins and never carries the prefix.
        self.assertFalse(usage.session_tag("raw-session").startswith(usage.DERIVED_SESSION_PREFIX))

    def test_the_context_argument_is_hidden_from_clients(self):
        server = mcp_server.build_server(lambda: ToolContext(reader=SimpleNamespace()))
        tool = server._tool_manager.get_tool("find_areas")
        self.assertEqual(tool.context_kwarg, mcp_server.CONTEXT_ARG)
        self.assertNotIn(mcp_server.CONTEXT_ARG, json.dumps(tool.parameters))


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class UsageHttpTests(unittest.TestCase):
    def setUp(self):
        self.connection = FakeUsageConnection()
        app_module._connect = lambda: self.connection
        self.addCleanup(setattr, app_module, "_connect", evidence_connection)
        without_rate_limits(self)
        self.client = TestClient(app_module.app)

    def wait_for_rows(self, count):
        deadline = time.monotonic() + 2
        while len(self.connection.rows) < count and time.monotonic() < deadline:
            time.sleep(0.01)
        return self.connection.rows

    def test_a_batch_is_stored_and_answered_204(self):
        response = self.client.post("/api/v1/usage", headers={"user-agent": BROWSER}, json={
            "visitor": VISITOR, "session": "s3ss10n-abc", "events": [{"name": "page_view", "props": {"path": "/"}}]})
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.wait_for_rows(1)[0]["visitor"], VISITOR)

    def test_bots_and_garbage_are_ignored_quietly(self):
        for headers, body in (({"user-agent": "Googlebot/2.1"}, {"events": [{"name": "page_view"}]}),
                              ({"user-agent": BROWSER}, {"events": "nope"})):
            self.assertEqual(self.client.post("/api/v1/usage", headers=headers, json=body).status_code, 204)
        self.assertEqual(self.client.post("/api/v1/usage", headers={"user-agent": BROWSER},
                                          content=b"not json").status_code, 204)
        time.sleep(0.05)
        self.assertEqual(self.connection.rows, [])

    def test_go_redirects_to_the_portal_and_counts_people_not_previews(self):
        link = usage.go_url("http://testserver", "zoopla", outcode="E8", market="rent", max_price=2500,
                            min_bedrooms=1, session="abcdef0123456789")
        path = link.replace("http://testserver", "")
        response = self.client.get(path, headers={"user-agent": BROWSER}, follow_redirects=False)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["location"], home_search.portal_links("E8", "rent", 2500, 1)["zoopla"])
        self.client.get(path, headers={"user-agent": "TelegramBot"}, follow_redirects=False)

        rows = self.wait_for_rows(1)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["channel"], rows[0]["name"], rows[0]["session"]),
                         ("mcp", "portal_click", "abcdef0123456789"))
        self.assertEqual(rows[0]["props"]["portal"], "zoopla")

    def test_go_refuses_anything_but_a_portal_search(self):
        response = self.client.get("/go/evil?outcode=E8&max_price=1000&beds=1", follow_redirects=False)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.connection.rows, [])


if __name__ == "__main__":
    unittest.main()


class TrafficTests(unittest.TestCase):
    """live, team or tech, so the dashboards can show live use only (docs/product-analytics.md "Traffic")."""

    def test_clients_are_told_apart_by_name_and_the_team_header(self):
        for client in ("ck-check", "CK-board", None):
            self.assertEqual(usage.traffic(client, "1"), "team", client)
        # Our check scripts, by the names they send.
        for client in ("ck-smoke", "board-shots", "release-check", "doc-check", "recheck", "check"):
            self.assertEqual(usage.traffic(client), "team", client)
        # claude-code is people using the plugin: live unless the call carries the team header.
        self.assertEqual(usage.traffic("claude-code"), "live")
        self.assertEqual(usage.traffic("claude-code", "1"), "team")
        self.assertEqual(usage.traffic("claude-code", "0"), "live")
        # MCP client names seen on prod in October 2026, and directory scanners.
        for client in ("FaceabotProbe", "BrickBlueBot", "rokmcp-probe", "agent-collector", "sentinel-probe",
                       "directory-kit-check", "python-httpx", "probe", "glama-inspector", "smithery-scan",
                       "LobeHub", "cursor.directory", "mcp-registry"):
            self.assertEqual(usage.traffic(client), "tech", client)
        for client in ("claude-ai", "chatgpt", "openai-mcp", "cursor", "mcp-browser", None):
            self.assertEqual(usage.traffic(client), "live", client)
        self.assertEqual(usage.traffic("claude-ai", "1"), "team")
        self.assertEqual(usage.traffic("claude-ai", "0"), "live")

    def test_a_script_or_uptime_agent_without_a_client_name_is_tech(self):
        for agent in ("curl/8.5.0", "Python-urllib/3.12", "python-requests/2.32", "Go-http-client/2.0",
                      "Mozilla/5.0+(compatible; UptimeRobot/2.0)"):
            self.assertEqual(usage.request_traffic({"user-agent": agent}), "tech", agent)
        self.assertEqual(usage.request_traffic({"user-agent": "curl/8.5.0", "x-close-knit-team": "1"}), "team")
        self.assertEqual(usage.request_traffic({"user-agent": BROWSER}), "live")
        self.assertEqual(usage.traffic("claude-ai", None, "python-httpx/0.27"), "live", "a named client's agent is its SDK")

    def test_reports_and_lists_take_a_traffic_filter_that_defaults_to_live(self):
        self.assertEqual(usage.parse_traffic("live"), ("live",))
        self.assertEqual(usage.parse_traffic("team,tech,team"), ("team", "tech"))
        self.assertEqual(usage.parse_traffic("all"), usage.TRAFFIC)
        for text in ("", "people", "live,bots"):
            with self.assertRaises(Exception):
                usage.parse_traffic(text)
        for sql in usage.REPORT_SQL.values():
            filtered = usage.traffic_filtered(sql)
            self.assertEqual(filtered.count("FROM product_event"), filtered.count(usage.LIVE_SQL), filtered)

        class Recording:
            def __init__(self):
                self.params = []

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def execute(self, sql, params=None):
                self.params.append(params)
                return []

        connection = Recording()
        usage.report(lambda: connection)
        self.assertEqual({json.dumps(params) for params in connection.params}, {'{"traffic": ["live"]}'})

    def test_live_tool_calls_carry_no_traffic_prop(self):
        started = time.monotonic()
        self.assertIsNone(usage.tool_call_props("find_areas", started)["traffic"])
        self.assertEqual(usage.tool_call_props("find_areas", started, traffic_kind="tech")["traffic"], "tech")
        self.assertIsNone(usage.tool_call_props("find_areas", started, traffic_kind="made-up")["traffic"])

    def test_a_team_browser_batch_is_marked_and_names_its_visitor(self):
        batch = {"visitor": VISITOR, "team": True, "events": [{"name": "page_view", "props": {"path": "/"}}]}
        rows = usage.clean_batch(batch)
        self.assertEqual(json.loads(rows[0][5]), {"path": "/", "traffic": "team"})
        self.assertEqual(usage.team_visitor(batch), VISITOR)
        for payload in ({**batch, "team": "yes"}, {**batch, "visitor": "me@example.org"}, None):
            self.assertIsNone(usage.team_visitor(payload))
        page = usage.clean_batch({"events": [{"name": "page_view", "props": {"path": "/", "traffic": "team"}}]})
        self.assertEqual(json.loads(page[0][5]), {"path": "/"}, "a page cannot mark itself")

    def test_the_team_header_marks_a_batch_and_automation_is_tech(self):
        batch = {"visitor": VISITOR, "events": [{"name": "page_view", "props": {"path": "/"}}]}
        self.assertEqual(json.loads(usage.clean_batch(batch, "1")[0][5])["traffic"], "team")
        self.assertEqual(usage.team_visitor(batch, "1"), VISITOR)
        self.assertIsNone(usage.team_visitor(batch, "0"))
        automated = {**batch, "automated": True}
        self.assertEqual(json.loads(usage.clean_batch(automated)[0][5])["traffic"], "tech")
        self.assertEqual(json.loads(usage.clean_batch({**automated, "team": True})[0][5])["traffic"], "team")
        self.assertNotIn("traffic", json.loads(usage.clean_batch({**batch, "automated": "yes"})[0][5]))

    def test_the_mcp_request_reads_the_team_header(self):
        def kind(headers, client=None):
            context = SimpleNamespace(request_context=SimpleNamespace(request=SimpleNamespace(headers=headers)))
            return mcp_server.request_traffic(context, client)

        self.assertEqual(kind({"x-close-knit-team": "1"}, "claude-ai"), "team")
        self.assertEqual(kind({}, "claude-ai"), "live")
        self.assertEqual(kind({}, "claude-code"), "live")
        self.assertEqual(kind({"x-close-knit-team": "1"}, "claude-code"), "team")
        self.assertEqual(kind({}, "rokmcp-probe"), "tech")
        self.assertEqual(kind({"user-agent": "Python-urllib/3.12"}), "tech")
        self.assertEqual(mcp_server.request_traffic(None, "ck-check"), "team")

    def test_the_backfill_uses_the_same_patterns(self):
        sql = (Path(__file__).resolve().parents[2] / "deploy" / "migrations" / "136-analytics-traffic.sql").read_text()
        self.assertIn(f"~* '{usage.TECH_CLIENT.pattern}'", sql)
        # Before the launch claude-code was the team's own sessions; 137 makes later ones live again.
        self.assertIn(f"~* '{usage.TEAM_CLIENT.pattern.replace('^(', '^(claude-code|')}'", sql)
