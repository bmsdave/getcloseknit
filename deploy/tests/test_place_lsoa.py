"""Each place's LSOA (migration 038): re-runnable, and the column custom criteria
read to count the places inside each area's boundary."""
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
MIGRATION = (DEPLOY / "migrations" / "038-place-lsoa.sql").read_text()
CRITERIA = (DEPLOY.parent / "api" / "area_api" / "custom_criteria.py").read_text()


class PlaceLsoaTests(unittest.TestCase):
    def test_columns_indexes_and_fill_are_safe_to_run_again(self):
        for table in ("place", "place_poi"):
            self.assertIn(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS lsoa_id text;", MIGRATION)
            self.assertIn(f"ON {table} (lsoa_id);", MIGRATION)
            self.assertIn(f"UPDATE {table} p SET lsoa_id = g.id", MIGRATION)
        self.assertEqual(MIGRATION.count("WHERE p.lsoa_id IS NULL AND g.kind = 'lsoa' AND ST_Intersects(g.geometry, p.location)"), 2)
        self.assertIn("CREATE INDEX IF NOT EXISTS area_geography_geometry_gix ON area_geography USING gist (geometry)",
                      MIGRATION)
        self.assertNotIn("CREATE INDEX place", MIGRATION.replace("CREATE INDEX IF NOT EXISTS", ""))

    def test_custom_criteria_read_the_column(self):
        self.assertIn('lsoa="p.lsoa_id" if stored_lsoa else LSOA_JOIN_SQL', CRITERIA)


if __name__ == "__main__":
    unittest.main()
