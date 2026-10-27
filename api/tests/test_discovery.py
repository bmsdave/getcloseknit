"""Discovery surface for non-MCP agents: manifest, server card, llms.txt, OpenAPI."""
import json
import os
import unittest
from pathlib import Path
from unittest import mock

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api import tools
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

# The MCP Registry's copy (published by hand with mcp-publisher); the API serves the same values.
SERVER_JSON = Path(__file__).resolve().parents[2] / "server.json"


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app_module.app)

    def test_manifest_is_server_json_with_this_hosts_remote(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_PUBLIC_URL": "https://api.example.test/"}):
            manifest = self.client.get("/.well-known/mcp/server.json").json()

        self.assertEqual(manifest.pop("remotes"), [{"type": "streamable-http", "url": "https://api.example.test/mcp"}])
        published = json.loads(SERVER_JSON.read_text(encoding="utf-8"))
        published.pop("remotes")
        self.assertEqual(manifest, published)
        self.assertFalse({"packages", "openapi", "llms", "tools"} & set(manifest))

    def test_server_json_meets_directory_limits(self):
        text = SERVER_JSON.read_text(encoding="utf-8")
        published = json.loads(text)

        github = {line.strip() for line in text.splitlines() if "github.com" in line}
        self.assertEqual(github, {'"url": "https://github.com/bmsdave/close-knit-mcp",'},
                         "only the public close-knit-mcp repo: close-knit itself is private, a link would 404")
        self.assertLessEqual(len(published["description"]), 100)
        self.assertLessEqual(len(published["title"]), 100)
        self.assertTrue(published["icons"])
        for icon in published["icons"]:
            self.assertTrue(icon["src"].startswith("https://"))
            self.assertLessEqual(len(icon["src"]), 255)

    def test_manifest_defaults_to_request_base_url(self):
        manifest = self.client.get("/.well-known/mcp/server.json").json()
        self.assertEqual(manifest["remotes"][0]["url"], "http://testserver/mcp")

    def test_server_card_matches_server_json(self):
        response = self.client.get("/.well-known/mcp/server-card.json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/json")
        self.assertEqual(response.headers["access-control-allow-origin"], "*")
        card = response.json()
        published = json.loads(SERVER_JSON.read_text(encoding="utf-8"))
        self.assertEqual(card["serverInfo"]["version"], published["version"])
        self.assertEqual(card["description"], published["description"])
        self.assertEqual(card["iconUrl"], published["icons"][0]["src"])
        self.assertEqual(card["transport"], {"type": "streamable-http", "endpoint": "/mcp"})
        self.assertEqual(card["tools"], "dynamic")  # SEP-1649: clients read the tools from tools/list

    def test_registry_auth_serves_the_public_key_proof(self):
        response = self.client.get("/.well-known/mcp-registry-auth")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.text.startswith("v=MCPv1; k=ed25519; p="))

    def test_glama_claim_is_public_json(self):
        response = self.client.get("/.well-known/glama.json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["$schema"], "https://glama.ai/mcp/schemas/connector.json")
        self.assertTrue(response.json()["claim"].startswith("glama_claim_"))

    def test_llms_txt_lists_every_tool_and_the_envelope(self):
        response = self.client.get("/llms.txt")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("text/plain"))
        for name in tools.TOOLS:
            self.assertIn(f"- {name} [", response.text)
        self.assertIn("dataMode=demo", response.text)
        self.assertIn("/api/v2/tools/{name}", response.text)

    def test_openapi_documents_agent_tools(self):
        spec = self.client.get("/openapi.json").json()

        self.assertEqual(spec["openapi"][:2], "3.")
        self.assertIn("/api/v2/tools/{tool_name}", spec["paths"])
        self.assertIn("/api/v2/tools", spec["paths"])
        self.assertIn("/llms.txt", spec["paths"])
        self.assertIn("evidence envelope", spec["info"]["description"])


if __name__ == "__main__":
    unittest.main()
