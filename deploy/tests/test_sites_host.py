"""The server's own name (CLOSE_KNIT_SITES_HOST) holds private sites and must never be indexed."""
from pathlib import Path
import re
import unittest

CADDYFILE = (Path(__file__).resolve().parents[1] / "Caddyfile").read_text()


class SitesHostTests(unittest.TestCase):
    def block(self):
        start = CADDYFILE.index("{$CLOSE_KNIT_SITES_HOST")
        return CADDYFILE[start:CADDYFILE.index("\n}\n", start)]

    def test_every_response_is_noindex(self):
        self.assertIn('header X-Robots-Tag "noindex, nofollow"', self.block())

    def test_its_own_robots_txt_disallows_everything(self):
        block = self.block()
        self.assertIn("handle /robots.txt", block)
        self.assertRegex(block, r"Disallow: /\n")
        # Answered before the catch-all redirect, which would hand out the public domain's Allow: /.
        self.assertLess(block.index("handle /robots.txt"), block.index("redir https://"))

    def test_no_private_site_is_named(self):
        """The repo is published (bmsdave/getcloseknit): the private sites' paths and users stay on the host."""
        readme = (Path(__file__).resolve().parents[1] / "README.md").read_text()
        for text in (CADDYFILE, readme):
            self.assertIsNone(re.search(r"(?i)\bmuse\b", text))


if __name__ == "__main__":
    unittest.main()
