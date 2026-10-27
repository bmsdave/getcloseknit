"""Read-path indexes of 2026-10-25: streets by borough (migration 117) and schools by distance (118). Each is
idempotent, and on the expression its reads filter on."""
import re
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
API = DEPLOY.parent / "api" / "area_api"


def statements(name: str) -> list[str]:
    text = (DEPLOY / "migrations" / name).read_text()
    return [s.strip() for s in re.sub(r"--[^\n]*", "", text).split(";") if s.strip()]


class ReadIndexTests(unittest.TestCase):
    def test_safe_to_run_again(self):
        street = statements("117-street-borough-index.sql")
        school = statements("118-school-geography-index.sql")
        self.assertIn("CREATE INDEX IF NOT EXISTS street_borough_id_idx ON street (borough_id)", street)
        self.assertIn("CREATE INDEX IF NOT EXISTS school_location_geog_gix ON school USING gist ((location::geography))", school)
        for statement in street + school:
            self.assertTrue(statement.startswith(("CREATE INDEX IF NOT EXISTS", "ANALYZE")), statement)

    def test_the_reads_filter_on_the_indexed_expressions(self):
        self.assertIn("JOIN street s ON s.borough_id = 'uk:lad:' || p.borough_code", (API / "street_home.py").read_text())
        self.assertIn("ST_DWithin(s.location::geography, area.point, %s)", (API / "schools.py").read_text())


if __name__ == "__main__":
    unittest.main()
