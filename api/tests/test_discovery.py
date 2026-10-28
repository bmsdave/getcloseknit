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
# Gemini CLI extension manifest at the repo root: `gemini extensions install https://github.com/bmsdave/getcloseknit`.
ROOT = Path(__file__).resolve().parents[2]
GEMINI_EXTENSION = ROOT / "gemini-extension.json"
CLAUDE_PLUGIN_MCP = ROOT / "agents" / "claude" / "plugin" / ".mcp.json"


class IconFileTests(unittest.TestCase):
    def test_every_icon_is_a_file_the_site_serves_at_its_declared_size(self):
        """Directories fetch these URLs: each must be a web/public file, a PNG as big as its sizes say."""
        for icon in json.loads(SERVER_JSON.read_text(encoding="utf-8"))["icons"]:
            path = ROOT / "web" / "public" / icon["src"].removeprefix("https://getcloseknit.com/")
            self.assertTrue(path.is_file(), path)
            if icon["mimeType"] == "image/png":
                head = path.read_bytes()[:24]
                self.assertEqual(head[:8], b"\x89PNG\r\n\x1a\n", path)
                width, height = int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
                self.assertEqual([f"{width}x{height}"], icon["sizes"], path)

    def test_a_512_px_png_comes_first_for_the_directories(self):
        first = json.loads(SERVER_JSON.read_text(encoding="utf-8"))["icons"][0]
        self.assertEqual((first["src"], first["sizes"]), ("https://getcloseknit.com/icon.png", ["512x512"]))


class ClaudePluginDirectoryTests(unittest.TestCase):
    def test_the_plugin_reads_no_environment_variable(self):
        """The Claude directory holds a plugin whose .mcp.json reads the installer's environment."""
        text = CLAUDE_PLUGIN_MCP.read_text(encoding="utf-8")
        self.assertNotRegex(text, r"\$\{(?!user_config\.)", "use a fixed value or ${user_config.KEY}")


class GeminiExtensionTests(unittest.TestCase):
    def test_manifest_points_at_the_public_mcp_and_the_find_a_home_skill(self):
        manifest = json.loads(GEMINI_EXTENSION.read_text(encoding="utf-8"))

        self.assertRegex(manifest["name"], r"^[a-z0-9-]+$")
        self.assertTrue(manifest["version"] and manifest["description"])
        servers = manifest["mcpServers"]
        self.assertEqual(list(servers), ["close-knit"], "no underscores: Gemini parses mcp_<server>_<tool>")
        server = servers["close-knit"]
        self.assertNotIn("trust", server, "extensions may not set trust")
        claude_url = json.loads(CLAUDE_PLUGIN_MCP.read_text(encoding="utf-8"))["mcpServers"]["close-knit"]["url"]
        self.assertEqual(server["httpUrl"], claude_url, "same server as the Claude plugin")
        context = manifest["contextFileName"]
        self.assertNotIn("..", context)
        self.assertTrue((ROOT / context).is_file(), context)


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
        self.assertIn("England, London in depth", published["description"], "the server answers England (G-E11)")
        self.assertLessEqual(len(published["title"]), 100)
        self.assertTrue(published["icons"])
        for icon in published["icons"]:
            self.assertTrue(icon["src"].startswith("https://"))
            self.assertLessEqual(len(icon["src"]), 255)

    def test_manifest_defaults_to_request_base_url(self):
        manifest = self.client.get("/.well-known/mcp/server.json").json()
        self.assertEqual(manifest["remotes"][0]["url"], "http://testserver/mcp")

    def test_domain_pointer_names_the_endpoint_and_manifest(self):
        response = self.client.get("/.well-known/mcp.json")
        self.assertEqual(response.status_code, 200)
        pointer = response.json()
        self.assertEqual(pointer["endpoint"], "http://testserver/mcp")
        self.assertEqual(pointer["transport"], "streamable-http")
        self.assertEqual(pointer["manifest"], "http://testserver/.well-known/mcp/server.json")
        self.assertEqual(pointer["version"], json.loads(SERVER_JSON.read_text(encoding="utf-8"))["version"])

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
