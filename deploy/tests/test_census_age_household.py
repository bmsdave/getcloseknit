"""Residents' age and household type (migration 045): the topic check admits them, the file can run
again, and it is listed in the release checklist."""
import re
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
MIGRATION = (DEPLOY / "migrations" / "045-census-age-household.sql").read_text()
TOPICS = ("ethnicity", "religion", "qualification", "occupation", "economic-activity", "tenure",
          "accommodation", "age", "household-type")


class CensusAgeHouseholdTests(unittest.TestCase):
    def test_the_topic_check_lists_every_topic(self):
        check = re.search(r"CHECK \(topic IN \((.*?)\)\)", MIGRATION, re.S)[1]
        self.assertEqual(re.findall(r"'([a-z-]+)'", check), list(TOPICS))

    def test_it_is_safe_to_run_again(self):
        self.assertIn("DROP CONSTRAINT IF EXISTS census_category_topic_check", MIGRATION)
        self.assertLess(MIGRATION.index("DROP CONSTRAINT IF EXISTS"), MIGRATION.index("ADD CONSTRAINT"))

    def test_listed_in_the_checklist(self):
        checklist = (DEPLOY.parent / "RELEASE-CHECKLIST.md").read_text()
        self.assertIn("045-census-age-household.sql", checklist)
        self.assertIn("census2021-ts007a.zip", checklist)
        self.assertIn("census2021-ts003.zip", checklist)


if __name__ == "__main__":
    unittest.main()
