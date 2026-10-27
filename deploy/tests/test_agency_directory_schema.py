"""Estate agent directory (migration 051): idempotent, view built on the same
domain rule as the Python twin, opt-outs applied, and no personal data in any table."""
import re
import sys
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY.parent / "pipelines" / "area-analytics-ingest"))

from area_analytics.agency_crawl import urls  # noqa: E402

MIGRATION = (DEPLOY / "migrations" / "051-agency-directory.sql").read_text()
CODE = re.sub(r"--[^\n]*", "", MIGRATION)
STATEMENTS = [s.strip() for s in re.split(r";\s*$", CODE, flags=re.M) if s.strip()]  # ';' inside a line is data
TABLE_COLUMNS = "\n".join(re.findall(r"CREATE TABLE IF NOT EXISTS \w+ \((.*?)\n\)", CODE, re.S))
VIEW = next(s for s in STATEMENTS if s.startswith("CREATE OR REPLACE VIEW agency_office"))


class AgencyDirectorySchemaTests(unittest.TestCase):
    def test_every_statement_is_safe_to_run_again(self):
        self.assertTrue(STATEMENTS)
        for statement in STATEMENTS:
            self.assertRegex(statement, r"IF NOT EXISTS|CREATE OR REPLACE VIEW")

    def test_view_uses_the_python_domain_twin(self):
        self.assertIn(urls.SITE_DOMAIN_SQL, VIEW)
        self.assertEqual(VIEW.count(urls.SITE_DOMAIN_SQL), 1)

    def test_opt_out_scope_values(self):
        self.assertIn("CHECK (scope IN ('listings', 'everything'))", MIGRATION)

    def test_nothing_personal_is_stored(self):
        self.assertIn("company_number", TABLE_COLUMNS)
        for word in ("officer", "phone", "photo", "description", "html"):
            self.assertNotIn(word, TABLE_COLUMNS.lower())

    def test_opt_out_domain_must_be_a_bare_lower_case_domain(self):
        self.assertIn("CHECK (domain IS NULL OR (domain ~ '^[a-z0-9-]+(\\.[a-z0-9-]+)+$' AND domain !~ '^www\\.'))",
                      TABLE_COLUMNS)

    def test_view_takes_the_first_of_several_websites_before_the_domain_rule(self):
        for column in ("o.tags->>'website'", "o.tags->>'contact:website'", "v.website"):
            self.assertIn(f"nullif(btrim(split_part({column}, ';', 1)), '')", VIEW)
        self.assertLess(VIEW.index("split_part("), VIEW.index("FROM place p"))

    def test_view_drops_opted_out_offices(self):
        self.assertRegex(VIEW, r"agency_opt_out[\s\S]*'everything'")

    def test_view_columns_and_website_office_rules(self):
        for column in ("id", "name", "brand", "website", "domain", "location", "sources", "confidence",
                       "company_number"):
            self.assertRegex(VIEW, rf"\b{column}\b")
        self.assertIn("category = 'estate_agent'", VIEW)
        self.assertIn("ST_DWithin", VIEW)
        self.assertIn("300", VIEW)
        self.assertIn("< 3", VIEW)
        self.assertIn("'web:' || ", VIEW)
        self.assertIn("0.6", VIEW)

    def test_indexes_and_overture_website_column(self):
        for index in ("agency_site_company (domain)", "agency_opt_out (domain)", "agency_opt_out (place_id)"):
            self.assertIn(f"ON {index}", MIGRATION)
        self.assertIn("ALTER TABLE overture_place ADD COLUMN IF NOT EXISTS website text", MIGRATION)


if __name__ == "__main__":
    unittest.main()
