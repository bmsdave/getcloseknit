"""MCP surface: the same registry served over Streamable HTTP at /mcp must
answer identically to the REST mirror at /api/v2/tools/{name}."""
import json
import os
import re
import unittest
from pathlib import Path
from unittest import mock

from tests.test_production_evidence import OLD_RELEASE, seed_production_fixture

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    import anyio

    from area_api import feature_flags, mcp_server, tools
    from area_api.evidence import EvidenceReader
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

MCP_HEADERS = {"Accept": "application/json, text/event-stream",
               "Content-Type": "application/json"}
SERVER_JSON = Path(__file__).resolve().parents[2] / "server.json"


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class McpHttpTests(unittest.TestCase):
    def setUp(self):
        env = mock.patch.dict(os.environ, {"CLOSE_KNIT_MCP_DATA": "1"})
        env.start()
        self.addCleanup(env.stop)
        tools.clear_catalogue_cache()
        connection = seed_production_fixture()
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=lambda: connection)
        self.client = TestClient(app_module.app)
        self.client.__enter__()
        self.session = self._initialize()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        app_module._reader = self._previous

    def _rpc(self, method, params=None, id=1):
        body = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        if id is not None:
            body["id"] = id
        headers = dict(MCP_HEADERS)
        if getattr(self, "session", None):
            headers["mcp-session-id"] = self.session
        return self.client.post("/mcp", json=body, headers=headers)

    def _initialize(self, client="test"):
        self.session = None
        response = self._rpc("initialize", {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": client, "version": "0"}})
        self.assertEqual(response.status_code, 200, response.text)
        session = response.headers.get("mcp-session-id")
        self.session = session
        self._rpc("notifications/initialized", id=None)
        return session

    def test_a_browser_opening_the_address_lands_on_the_agents_page(self):
        page = self.client.get("/mcp", headers={"accept": "text/html,application/xhtml+xml"}, follow_redirects=False)
        self.assertEqual(page.status_code, 302)
        self.assertEqual(page.headers["location"], "/agents")
        client = self.client.get("/mcp", headers={"accept": "application/json, text/event-stream"},
                                 follow_redirects=False)
        self.assertNotEqual(client.status_code, 302, "an MCP client's GET still reaches the transport")

    def test_tools_list_exposes_registry_with_flat_schemas(self):
        result = self._rpc("tools/list").json()["result"]

        listed = {tool["name"]: tool for tool in result["tools"]}
        self.assertEqual(set(listed), set(tools.TOOLS))
        search = listed["search_areas"]
        self.assertEqual(set(search["inputSchema"]["properties"]), {"q", "limit"})
        self.assertIn("ONS code", search["inputSchema"]["properties"]["q"]["description"])
        self.assertEqual(search["inputSchema"]["required"], ["q"])
        self.assertTrue(search["description"].startswith("Resolve free text"))

    def test_every_tool_declares_its_directory_hints(self):
        listed = self._rpc("tools/list").json()["result"]["tools"]

        for tool in listed:
            hints = tool["annotations"]
            writes = tool["name"] in mcp_server.WRITE_TOOLS
            self.assertTrue(tool["title"], tool["name"])
            self.assertEqual((hints["readOnlyHint"], hints["destructiveHint"]), (not writes, False), tool["name"])
        self.assertEqual({t["title"] for t in listed if t["name"] == "find_areas"}, {"Find areas"})
        self.assertEqual({t["name"] for t in listed if t["annotations"]["openWorldHint"]},
                         {"get_listing_search_links", "send_feedback"})

    def test_initialize_fills_server_info_from_server_json(self):
        published = json.loads(SERVER_JSON.read_text(encoding="utf-8"))
        response = self.client.post("/mcp", headers=MCP_HEADERS, json={
            "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "0"}}})

        info = response.json()["result"]["serverInfo"]
        self.assertEqual(info["name"], "close-knit")
        self.assertTrue(info["version"])
        self.assertEqual(info["version"], published["version"])
        self.assertEqual((info["title"], info["description"], info["websiteUrl"], info["icons"]),
                         (published["title"], published["description"], published["websiteUrl"], published["icons"]))

    def test_closed_tools_say_coming_soon_in_their_metadata(self):
        def metadata(value):
            with mock.patch.dict(os.environ, {"CLOSE_KNIT_MCP_DATA": value}):
                server = mcp_server.build_server(lambda: None)
                return server.instructions, {tool.name: tool.description for tool in anyio.run(server.list_tools)}

        instructions, closed = metadata("0")
        self.assertIn("coming soon", instructions.lower())
        self.assertEqual(set(closed), set(tools.TOOLS), "closed tools stay listed")
        for name, description in closed.items():
            self.assertEqual("coming soon" in description.lower(), name != "send_feedback", name)
        instructions, opened = metadata("1")
        self.assertNotIn("coming soon", instructions.lower())
        self.assertEqual([name for name, text in opened.items() if "coming soon" in text.lower()], [])

    def test_tool_call_matches_rest_mirror(self):
        arguments = {"area_id": "uk:lsoa:E01000004", "metric_id": "crime", "period": "2026-06"}

        mcp = self._rpc("tools/call", {"name": "get_area_metric", "arguments": arguments}).json()
        rest = self.client.post("/api/v2/tools/get_area_metric", json=arguments)

        self.assertEqual(rest.status_code, 200, rest.text)
        self.assertFalse(mcp["result"].get("isError"), mcp)
        self.assertEqual(mcp["result"]["structuredContent"], rest.json())
        self.assertEqual(rest.json()["productReleaseId"], OLD_RELEASE)

    def test_tool_errors_carry_the_rest_error_code(self):
        arguments = {"area_id": "uk:lsoa:E09999999", "metric_id": "crime", "period": "2026-06"}

        mcp = self._rpc("tools/call", {"name": "get_area_metric", "arguments": arguments}).json()
        rest = self.client.post("/api/v2/tools/get_area_metric", json=arguments)

        self.assertTrue(mcp["result"]["isError"])
        self.assertIn("area-not-found", mcp["result"]["content"][0]["text"])
        self.assertEqual(rest.status_code, 404)
        self.assertEqual(rest.json()["detail"]["error"], "area-not-found")

    def test_unexpected_failure_is_logged_not_leaked(self):
        def broken(*_):
            raise RuntimeError("relation secret_table does not exist")
        original = mcp_server.call_tool
        mcp_server.call_tool = broken
        self.addCleanup(setattr, mcp_server, "call_tool", original)
        arguments = {"area_id": "uk:lsoa:E01000001", "metric_id": "crime", "period": "2026-06"}

        with self.assertLogs("area_api.mcp_server", level="ERROR"):
            mcp = self._rpc("tools/call", {"name": "get_area_metric", "arguments": arguments}).json()

        text = mcp["result"]["content"][0]["text"]
        self.assertTrue(mcp["result"]["isError"])
        self.assertIn("internal-error: internal error", text)
        self.assertNotIn("secret_table", text)

    def test_home_search_tools_carry_the_widget(self):
        listed = {tool["name"]: tool for tool in self._rpc("tools/list").json()["result"]["tools"]}

        for name in mcp_server.WIDGET_TOOLS:
            self.assertEqual(listed[name]["_meta"]["ui"]["resourceUri"], mcp_server.WIDGET_URI, name)
        self.assertNotIn("ui", (listed["search_places"].get("_meta") or {}))

    def test_widget_resource_is_an_mcp_app(self):
        resources = self._rpc("resources/list").json()["result"]["resources"]
        self.assertEqual([r["uri"] for r in resources], [mcp_server.WIDGET_URI])

        content = self._rpc("resources/read", {"uri": mcp_server.WIDGET_URI}).json()["result"]["contents"][0]

        self.assertEqual(content["mimeType"], "text/html;profile=mcp-app")
        self.assertIn("ui/initialize", content["text"])
        self.assertNotIn("<script src=", content["text"])  # the board renders without the network
        # Only the map reaches out, and only to the domains the resource declares.
        csp = content["_meta"]["ui"]["csp"]
        self.assertEqual(csp, {"resourceDomains": ["https://cdn.jsdelivr.net"],
                               "connectDomains": ["https://tiles.openfreemap.org"]})
        external = set(re.findall(r'"(https://[^/"]+)/', content["text"])) - {
            "https://openfreemap.org", "https://www.openstreetmap.org"}  # attribution links, not fetched
        self.assertEqual(external, set(csp["resourceDomains"]) | set(csp["connectDomains"]))
        # ChatGPT wants a dedicated widget origin before it accepts the app.
        self.assertEqual(content["_meta"]["ui"]["domain"], "https://getcloseknit.com")
        self.assertEqual(content["_meta"]["ui"]["prefersBorder"], True)

    def test_claude_gets_the_widget_without_a_domain(self):
        # Claude refuses to draw a ui.domain that is not its own claudemcpcontent.com hash.
        for client in ("claude-ai", "Claude Desktop"):
            self._initialize(client)
            content = self._rpc("resources/read", {"uri": mcp_server.WIDGET_URI}).json()["result"]["contents"][0]
            self.assertNotIn("domain", content["_meta"]["ui"], client)
            self.assertIn("csp", content["_meta"]["ui"], client)

    def test_find_a_home_prompt_starts_the_guided_search(self):
        prompts = self._rpc("prompts/list").json()["result"]["prompts"]
        self.assertEqual([p["name"] for p in prompts], ["find-a-home"])

        result = self._rpc("prompts/get", {"name": "find-a-home",
                                           "arguments": {"situation": "renting, 1 bed"}}).json()["result"]

        text = result["messages"][0]["content"]["text"]
        self.assertIn("find_areas", text)
        self.assertTrue(text.endswith("renting, 1 bed"))

    def test_no_demo_fixture_tools(self):
        listed = self._rpc("tools/list").json()["result"]["tools"]

        self.assertNotIn("get_valuation", {tool["name"] for tool in listed})
        self.assertFalse([tool["name"] for tool in listed if "dataMode=demo" in tool["description"]])


    def test_tool_calls_get_public_flag_defaults_in_the_private_preview(self):
        # /mcp bypasses the preview login, so a stranger must never see what the public site withholds.
        seen = {}

        def spy(name, context, arguments):
            seen.update(preview=feature_flags.preview(), withheld=feature_flags.withheld())
            return {"ok": True}
        original = mcp_server.call_tool
        mcp_server.call_tool = spy
        self.addCleanup(setattr, mcp_server, "call_tool", original)
        arguments = {"area_id": "uk:lsoa:E01000001", "metric_id": "crime", "period": "2026-06"}

        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ACCESS": "private"}):
            os.environ.pop("CLOSE_KNIT_PER_HOME_VALUATION", None)
            mcp = self._rpc("tools/call", {"name": "get_area_metric", "arguments": arguments}).json()
            self.assertTrue(feature_flags.preview())  # the site itself keeps the preview

        self.assertFalse(mcp["result"].get("isError"), mcp)
        self.assertFalse(seen["preview"])
        self.assertIn("valuation", seen["withheld"])

    def test_home_prices_description_is_the_public_wording(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ACCESS": "private"}):
            os.environ.pop("CLOSE_KNIT_PER_HOME_VALUATION", None)
            server = mcp_server.build_server(lambda: None)
            listed = {tool.name: tool for tool in anyio.run(server.list_tools)}

        self.assertIn("never say what the home is worth", listed["get_home_prices"].description)

    def test_data_tools_answer_coming_soon_while_the_flag_is_off(self):
        called = []
        original = mcp_server.call_tool
        mcp_server.call_tool = lambda name, context, arguments: called.append(name) or {"ok": True}
        self.addCleanup(setattr, mcp_server, "call_tool", original)
        arguments = {"area_id": "uk:lsoa:E01000001", "metric_id": "crime", "period": "2026-06"}

        for value in ("", "0"):
            # The private preview's "flags on" never opens /mcp: only CLOSE_KNIT_MCP_DATA=1 does.
            with mock.patch.dict(os.environ, {"CLOSE_KNIT_MCP_DATA": value, "CLOSE_KNIT_ACCESS": "private"}):
                result = self._rpc("tools/call", {"name": "get_area_metric", "arguments": arguments}).json()["result"]
                listed = self._rpc("tools/list").json()["result"]["tools"]
            self.assertFalse(result.get("isError"), result)
            self.assertEqual(result["structuredContent"]["status"], "coming-soon")
            self.assertIsNone(result["structuredContent"]["value"])
            self.assertIn("get_area_metric", {tool["name"] for tool in listed})
        self.assertEqual(called, [])

    def test_feedback_still_works_while_the_flag_is_off(self):
        called = []
        original = mcp_server.call_tool
        mcp_server.call_tool = lambda name, context, arguments: called.append(name) or {"ok": True}
        self.addCleanup(setattr, mcp_server, "call_tool", original)

        with mock.patch.dict(os.environ, {"CLOSE_KNIT_MCP_DATA": "0"}):
            self._rpc("tools/call", {"name": "send_feedback", "arguments": {"kind": "praise", "message": "Works well for me."}})

        self.assertEqual(called, ["send_feedback"])

@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class RestMirrorTests(unittest.TestCase):
    def setUp(self):
        tools.clear_catalogue_cache()
        connection = seed_production_fixture()
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=lambda: connection)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_unknown_tool_is_404_and_bad_arguments_400(self):
        self.assertEqual(self.client.post("/api/v2/tools/nope", json={}).status_code, 404)
        bad = self.client.post("/api/v2/tools/search_areas", json={"q": "x", "limit": 0})
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json()["detail"]["error"], "invalid-arguments")

    def test_personal_tools_are_never_cached(self):
        response = self.client.post("/api/v2/tools/get_listing_search_links",
                                    json={"area_ids": ["uk:lsoa:E01000004"], "max_price": 500000})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("no-store", response.headers["cache-control"])
        self.assertEqual(response.json()["value"]["searches"][0]["outcode"], "SW1A")

    def test_match_areas_is_private_and_validated(self):
        bad = self.client.post("/api/v2/tools/match_areas", json={"profile": {"schemaVersion": "x"}})
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json()["detail"]["error"], "invalid-profile")

    def test_v2_tools_index_lists_registry(self):
        index = self.client.get("/api/v2/tools")
        self.assertEqual(index.status_code, 200)
        self.assertEqual({t["name"] for t in index.json()["tools"]}, set(tools.TOOLS))
        self.assertIn("inputSchema", index.json()["tools"][0])


if __name__ == "__main__":
    unittest.main()
