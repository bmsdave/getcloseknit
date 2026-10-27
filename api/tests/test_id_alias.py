"""Old LAD ids keep working after step R2 (uk:borough:<code> -> uk:lad:<code>, migration 129)."""
import dataclasses
import json
import unittest
from unittest import mock
from pathlib import Path

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from area_api import kinds, share_links, tools
from area_api.id_alias import AreaAliasMiddleware

FIXTURE = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "agent-share-links.json"
# The fixture's first case as the site encoded it before R2: its borough zone says uk:borough:E09000007.
OLD_LINK = "https://getcloseknit.com/#profile=v1.WzAsNTUwMDAwLDYwMDAwMCwyLDEsW1szLDQsMSxudWxsLG51bGxdLFs5LDMsMSw0MCxudWxsXSxbMSwwLDEsbnVsbCxudWxsXV0sW10sW1sicHJpbWFyeSJdLFtdLFtdLFtdLDNdLDAsW1swLCJvc206bjExOTI3NDQ2NCIsMTUsIktpbmcncyBDcm9zcyBTdCBQYW5jcmFzIl0sWzEsInVrOmJvcm91Z2g6RTA5MDAwMDA3Il0sWzIsWyJ1azpsc29hOkUwMTAwMDk1MSIsInVrOmxzb2E6RTAxMDAxMjM0Il0sIkNhZsOpICYgY28g4oCUIMO8bsOvY29kZSJdXV0"


async def echo(request: Request) -> JSONResponse:
    body = (await request.body()).decode()
    return JSONResponse({"path": request.url.path, "id": request.path_params.get("area_id"),
                         "query": dict(request.query_params), "body": body})


ECHO = AreaAliasMiddleware(Starlette(routes=[Route("/api/v1/areas/{area_id}", echo, methods=["GET", "POST"])]))


class KindsTests(unittest.TestCase):
    def test_old_ids_read_as_current(self):
        self.assertEqual(kinds.canonical_id("uk:borough:E09000001"), "uk:lad:E09000001")
        self.assertEqual(kinds.canonical_id("uk:lsoa:E01000001"), "uk:lsoa:E01000001")
        self.assertEqual(kinds.canonical_id("borough"), "borough")
        self.assertEqual(kinds.kind_of("uk:borough:E09000001"), "lad")
        self.assertEqual(kinds.canonical_value({"uk:borough:E09000002": ["uk:borough:E09000003", 3, None]}),
                         {"uk:lad:E09000002": ["uk:lad:E09000003", 3, None]})
        self.assertEqual(kinds.canonical_text("ids=uk%3Aborough%3AE09000001,uk:borough:E09000002"),
                         "ids=uk%3Alad%3AE09000001,uk:lad:E09000002")
        self.assertEqual(kinds.tile_kind("lad"), "borough")


class MiddlewareTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(ECHO)

    def test_path_and_query(self):
        answer = self.client.get("/api/v1/areas/uk:borough:E09000001?selected=uk%3Aborough%3AE09000002&carrier=borough").json()
        self.assertEqual(answer["id"], "uk:lad:E09000001")
        self.assertEqual(answer["query"], {"selected": "uk:lad:E09000002", "carrier": "borough"})

    def test_json_body(self):
        body = {"zones": [{"kind": "borough", "id": "uk:borough:E09000022"}]}
        answer = self.client.post("/api/v1/areas/uk:lad:E09000001", json=body).json()
        self.assertEqual(json.loads(answer["body"]), {"zones": [{"kind": "borough", "id": "uk:lad:E09000022"}]})

    def test_other_bodies_untouched(self):
        answer = self.client.post("/api/v1/areas/x", content=b"uk:borough:E09000001",
                                  headers={"content-type": "text/plain"}).json()
        self.assertEqual(answer["body"], "uk:borough:E09000001")


class ToolTests(unittest.TestCase):
    def test_tool_arguments_read_old_ids(self):
        # MCP and /tools: the tool sees the current id whatever the client held (the extension, an agent's memory).
        seen = {}
        spec = tools.TOOLS["get_area_metric"]

        def handler(context, args):
            seen["id"] = args.area_id
            return {"value": None}

        with mock.patch.dict(tools.TOOLS, {"get_area_metric": dataclasses.replace(spec, handler=handler)}):
            tools.call_tool("get_area_metric", None,
                            {"area_id": "uk:borough:E09000009", "metric_id": "crime", "period": "2026-06"})
        self.assertEqual(seen["id"], "uk:lad:E09000009")


class SharedLinkTests(unittest.TestCase):
    def test_a_link_from_before_r2_opens_with_lad_ids(self):
        case = json.loads(FIXTURE.read_text())["cases"][0]
        self.assertIn("uk:lad:E09000007", json.dumps(case["profile"]))
        self.assertEqual(share_links.profile_from_link(OLD_LINK), share_links.profile_from_link("x" + case["fragment"]))
        self.assertNotIn("uk:borough:", json.dumps(share_links.profile_from_link(OLD_LINK)))


if __name__ == "__main__":
    unittest.main()
