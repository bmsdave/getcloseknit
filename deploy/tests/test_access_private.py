"""The private preview's login (access-private.caddy): the legal pages and their static assets open,
every other page still asks for it, and a script's request never pops the browser's login dialog."""
import re
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from base64 import b64encode
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
SNIPPET = DEPLOY / "access-private.caddy"
IMAGE = "caddy:2"
USER, PASSWORD = "preview", "preview-test"
# caddy hash-password --plaintext preview-test
HASH = "$2a$14$SltCr.wzPBSs8wLzZq0nMeBBTulIBiiDtFwkuQRHhRH1KBuOiDe.S"
# The production Caddyfile proxies to containers that are not here; stand-ins answer instead.
HARNESS = """(proxy) {
	respond "proxied {args[0]}" 200
}
:80 {
	import access-private.caddy
	handle /tiles/* {
		respond "tile" 200
	}
	handle {
		respond "page" 200
	}
}
"""
OPEN_PAGES = ["/privacy", "/privacy/legitimate-interests", "/terms", "/about"]
OPEN_ASSETS = ["/_next/static/chunks/main-abc123.js", "/_next/static/css/app-abc123.css",
               "/_next/static/media/BricolageGrotesque-latin.abc123.woff2"]
LOCKED = ["/", "/area/lad/E09000009", "/guide", "/privacy-extra", "/terms/x", "/about/x", "/tiles/areas-1-lsoa.pmtiles",
          "/api/v1/areas", "/api/v1/usage", "/sw.js", "/_next/image?url=%2Fog.png&w=64&q=75", "/_next/data/b/x.json"]


def open_paths() -> list[str]:
    block = re.search(r"@locked \{\n\tnot path ([^\n]+)\n", SNIPPET.read_text())
    return block.group(1).split()


class LockedListTests(unittest.TestCase):
    def test_the_legal_pages_and_static_assets_are_open(self):
        for path in ["/privacy", "/privacy/*", "/terms", "/about", "/_next/static/*"]:
            self.assertIn(path, open_paths())

    def test_no_page_tree_api_wildcard_or_other_next_route_is_open(self):
        for path in ["/", "/*", "/area/*", "/api/v1/*", "/_next/*", "/_next/image", "/_next/data/*", "/sw.js"]:
            self.assertNotIn(path, open_paths())

    def test_the_preview_still_says_noindex(self):
        self.assertIn('header X-Robots-Tag "noindex, nofollow"', SNIPPET.read_text())


def _docker_caddy() -> bool:
    if not shutil.which("docker"):
        return False
    # Never pulls: the check runs where the image is already present (any host that ran the stack).
    found = subprocess.run(["docker", "image", "inspect", IMAGE], capture_output=True, check=False)
    return found.returncode == 0


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


@unittest.skipUnless(_docker_caddy(), f"needs docker and the {IMAGE} image")
class LiveCaddyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        Path(cls.dir.name, "Caddyfile").write_text(HARNESS)
        shutil.copy(SNIPPET, Path(cls.dir.name, "access-private.caddy"))
        cls.port = _free_port()
        cls.name = f"close-knit-access-test-{cls.port}"
        subprocess.run(["docker", "run", "-d", "--rm", "--name", cls.name, "-p", f"127.0.0.1:{cls.port}:80",
                        "-e", f"CLOSE_KNIT_ACCESS_USER={USER}", "-e", f"CLOSE_KNIT_ACCESS_HASH={HASH}",
                        "-v", f"{cls.dir.name}:/etc/caddy:ro", IMAGE], check=True, capture_output=True)
        deadline = time.monotonic() + 20
        while True:
            try:
                cls.get("/privacy")
                break
            except OSError:
                if time.monotonic() > deadline:
                    logs = subprocess.run(["docker", "logs", cls.name], capture_output=True, text=True).stderr
                    cls.tearDownClass()
                    raise RuntimeError(f"caddy did not start:\n{logs[-2000:]}")
                time.sleep(0.2)

    @classmethod
    def tearDownClass(cls):
        subprocess.run(["docker", "rm", "-f", cls.name], capture_output=True, check=False)
        cls.dir.cleanup()

    @classmethod
    def get(cls, path: str, mode: str | None = None, login: bool = False):
        request = urllib.request.Request(f"http://127.0.0.1:{cls.port}{path}")
        if mode:
            request.add_header("Sec-Fetch-Mode", mode)
        if login:
            request.add_header("Authorization", "Basic " + b64encode(f"{USER}:{PASSWORD}".encode()).decode())
        opener = urllib.request.build_opener(_NoRedirect)
        try:
            with opener.open(request, timeout=5) as response:
                return response.status, response.headers
        except urllib.error.HTTPError as error:
            return error.code, error.headers

    def test_legal_pages_and_their_assets_open_without_the_login(self):
        for path in OPEN_PAGES + OPEN_ASSETS:
            for mode in ("navigate", "no-cors", None):
                with self.subTest(path=path, mode=mode):
                    self.assertEqual(self.get(path, mode)[0], 200)

    def test_every_other_page_asks_for_the_login_on_a_page_load(self):
        for path in LOCKED:
            for mode in ("navigate", None):
                with self.subTest(path=path, mode=mode):
                    status, headers = self.get(path, mode)
                    self.assertEqual(status, 401)
                    self.assertIn("Basic", headers.get("WWW-Authenticate", ""))

    def test_a_scripts_request_to_a_locked_path_is_refused_without_a_challenge(self):
        for path in LOCKED:
            for mode in ("cors", "no-cors", "same-origin"):
                with self.subTest(path=path, mode=mode):
                    status, headers = self.get(path, mode)
                    self.assertEqual(status, 401)
                    self.assertIsNone(headers.get("WWW-Authenticate"))

    def test_the_login_still_opens_locked_paths(self):
        self.assertEqual(self.get("/", "navigate", login=True)[0], 200)
        self.assertEqual(self.get("/api/v1/usage", "cors", login=True)[0], 200)

    def test_open_pages_and_refusals_both_say_noindex(self):
        for path, mode in [("/privacy", "navigate"), ("/", "navigate"), ("/", "cors")]:
            with self.subTest(path=path, mode=mode):
                self.assertEqual(self.get(path, mode)[1].get("X-Robots-Tag"), "noindex, nofollow")


if __name__ == "__main__":
    unittest.main()
