"""Every feature flag the API reads reaches its container (deploy/docker-compose.yml api environment).

A flag missing there is unset inside the API, so with CLOSE_KNIT_ACCESS=public it is off whatever deploy/.env says.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ComposeFlagTests(unittest.TestCase):
    def test_every_flag_is_passed_to_the_api(self):
        flags = set(re.findall(r'_on\("(CLOSE_KNIT_[A-Z0-9_]+)"\)',
                               (ROOT / "api/area_api/feature_flags.py").read_text()))
        compose = (ROOT / "deploy/docker-compose.yml").read_text()
        self.assertIn("CLOSE_KNIT_ENGLAND", flags)
        missing = sorted(f for f in flags if f"{f}: ${{{f}:-}}" not in compose)
        self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main()
