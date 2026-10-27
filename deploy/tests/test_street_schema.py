"""Street names for street-level search (migration 042): idempotent, and
indexed for the ILIKE that evidence:street-search filters on."""
import re
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
MIGRATION = (DEPLOY / "migrations" / "042-street.sql").read_text()
SEARCH = (DEPLOY.parent / "api" / "area_api" / "evidence.py").read_text()
LOADER = (DEPLOY.parent / "pipelines" / "area-analytics-ingest" / "area_analytics" / "streets.py").read_text()


class StreetSchemaTests(unittest.TestCase):
    def test_every_statement_is_safe_to_run_again(self):
        statements = [s.strip() for s in re.sub(r"--[^\n]*", "", MIGRATION).split(";") if s.strip()]
        self.assertTrue(statements)
        for statement in statements:
            self.assertRegex(statement, r"IF NOT EXISTS")

    def test_trigram_index_covers_the_street_search_filter(self):
        self.assertIn("ON street USING gin (name gin_trgm_ops)", MIGRATION)
        self.assertIn("WHERE s.name ILIKE %s", SEARCH)

    def test_streets_carry_no_house_numbers_or_addresses(self):
        columns = re.search(r"CREATE TABLE IF NOT EXISTS street \((.*?)\n\);", MIGRATION, re.S)[1]
        self.assertNotRegex(columns, r"\b(address|uprn|number|paon)\b")

    def test_loader_columns_match_the_table(self):
        for column in ("id", "name", "locality", "postcode_district", "easting", "northing",
                       "geography_id", "borough_id", "source_release_id"):
            self.assertRegex(MIGRATION, rf"\n    {column} ")
            self.assertIn(column, LOADER)


if __name__ == "__main__":
    unittest.main()
