"""Geograph photos for postcode pages (migration 043): idempotent, indexed
for the nearest-photo lookup, and holding credits and points only, never images."""
import re
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
MIGRATION = (DEPLOY / "migrations" / "043-geograph-photo.sql").read_text()
LOOKUP = (DEPLOY.parent / "api" / "area_api" / "photos.py").read_text()
LOADER = (DEPLOY.parent / "pipelines" / "area-analytics-ingest" / "area_analytics" / "geograph.py").read_text()


class GeographPhotoSchemaTests(unittest.TestCase):
    def test_every_statement_is_safe_to_run_again(self):
        statements = [s.strip() for s in re.sub(r"--[^\n]*", "", MIGRATION).split(";") if s.strip()]
        self.assertTrue(statements)
        for statement in statements:
            self.assertRegex(statement, r"IF NOT EXISTS")

    def test_gist_index_serves_the_nearest_photo_order(self):
        self.assertIn("ON geograph_photo USING gist (location)", MIGRATION)
        self.assertIn("ORDER BY location <-> p.g", LOOKUP)

    def test_table_holds_no_image_addresses(self):
        columns = re.search(r"CREATE TABLE IF NOT EXISTS geograph_photo \((.*?)\n\);", MIGRATION, re.S)[1]
        self.assertNotRegex(columns, r"\b(url|thumb|image|hash)\b")

    def test_loader_columns_match_the_table(self):
        for column in ("id", "title", "photographer", "user_id", "taken", "location",
                       "geography_id", "source_release_id"):
            self.assertRegex(MIGRATION, rf"\n    {column} ")
            self.assertIn(column, LOADER)


if __name__ == "__main__":
    unittest.main()
