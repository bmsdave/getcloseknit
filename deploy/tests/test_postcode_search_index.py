"""Address search trigram indexes (migration 037): idempotent, and
matching the expressions evidence:address-search filters on."""
import re
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
MIGRATION = (DEPLOY / "migrations" / "037-postcode-search-index.sql").read_text()
SEARCH = (DEPLOY.parent / "api" / "area_api" / "evidence.py").read_text()


class PostcodeSearchIndexTests(unittest.TestCase):
    def test_every_statement_is_safe_to_run_again(self):
        statements = [s.strip() for s in re.sub(r"--[^\n]*", "", MIGRATION).split(";") if s.strip()]
        self.assertTrue(statements)
        for statement in statements:
            self.assertRegex(statement, r"IF NOT EXISTS")

    def test_indexes_cover_the_address_search_filters(self):
        self.assertIn("ON address USING gin (display_address gin_trgm_ops)", MIGRATION)
        self.assertIn("ON address USING gin ((replace(postcode, ' ', '')) gin_trgm_ops)", MIGRATION)
        # #291 added ESCAPE for like_escape(); the indexed expressions are unchanged.
        self.assertIn("a.display_address ILIKE %s ESCAPE '\\\\' OR replace(a.postcode, ' ', '') ILIKE %s ESCAPE '\\\\'", SEARCH)


if __name__ == "__main__":
    unittest.main()
