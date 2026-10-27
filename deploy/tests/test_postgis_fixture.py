"""The throwaway PostGIS of the database tests (tests/postgis-fixture.sh, backlog #20) boots as production does.

The API's database tests are only as good as the database they run on: the fixture must use the compose
image and the same initdb steps (schema.sql, then every migration through migrate.sh), the seed coming last,
and gate.sh and CI must start it. api/tests/test_postgis.py asserts on what it holds.
"""
from pathlib import Path
import re
import unittest

DEPLOY = Path(__file__).resolve().parents[1]
ROOT = DEPLOY.parent
FIXTURE = (DEPLOY / "tests" / "postgis-fixture.sh").read_text()


class PostgisFixtureTests(unittest.TestCase):
    def test_the_fixture_uses_the_compose_image_and_initdb_steps(self):
        compose = (DEPLOY / "docker-compose.yml").read_text()
        image = re.search(r"^\s+image: (postgis/\S+)$", compose, re.M).group(1)
        self.assertIn(f"CLOSE_KNIT_TEST_POSTGIS_IMAGE:-{image}", FIXTURE)
        for mount in ("schema.sql:/docker-entrypoint-initdb.d/001-schema.sql:ro", "migrations:/close-knit/migrations:ro",
                      "migrate.sh:/close-knit/migrate.sh:ro", "initdb-migrate.sh:/docker-entrypoint-initdb.d/900-migrate.sh:ro"):
            self.assertIn(f"./{mount}", compose)
            self.assertIn(f'$deploy/{mount}"', FIXTURE)
        seed = re.search(r"postgis-seed\.sql:/docker-entrypoint-initdb\.d/(\d+)-seed\.sql", FIXTURE)
        self.assertGreater(int(seed.group(1)), 900)  # after every migration

    def test_the_seed_activates_a_release_over_two_regions(self):
        seed = (DEPLOY / "tests" / "postgis-seed.sql").read_text()
        self.assertIn("'E09000007', 'Camden'", seed)  # London
        self.assertIn("'E07000072', 'Epping Forest'", seed)  # East of England
        self.assertIn("SELECT activate_product_release('fixture-2026-06');", seed)

    def test_gate_and_the_push_hook_run_the_api_tests_on_it(self):
        gate = (ROOT / "gate.sh").read_text()
        start, api = gate.index("postgis-fixture.sh\" start"), gate.index('step "api tests"')
        self.assertLess(start, api)
        self.assertIn("postgis-fixture.sh\" stop' EXIT", gate)
        self.assertIn("CLOSE_KNIT_TEST_DATABASE_URL= unit \"$here/deploy\"", gate)
        self.assertLess(api, gate.index('exit 0'))  # --fast stops after the unit suites, not before
        self.assertIn("gate.sh\" --fast", (ROOT / ".githooks" / "pre-push").read_text())
        self.assertFalse((ROOT / ".github" / "workflows").exists())  # no hosted CI: the account doesn't pay for Actions

if __name__ == "__main__":
    unittest.main()
