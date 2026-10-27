"""Country of birth (migration 047): the topic check admits TS004 regions and TS012 borough countries,
the rebuild keeps the borough-only rows, the file can run again, and it is listed
in the release checklist."""
import re
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
MIGRATION = (DEPLOY / "migrations" / "047-census-country-of-birth.sql").read_text()
PEOPLE = (DEPLOY / "migrations" / "015-people.sql").read_text()
TOPICS = ("ethnicity", "religion", "qualification", "occupation", "economic-activity", "tenure",
          "accommodation", "age", "household-type", "country-of-birth", "country-of-birth-detailed")


def rebuild(sql: str) -> str:
    return sql[sql.index("CREATE OR REPLACE FUNCTION public.rebuild_area_people()"):]


class CensusCountryOfBirthTests(unittest.TestCase):
    def test_the_topic_check_lists_every_topic(self):
        check = re.search(r"CHECK \(topic IN \((.*?)\)\)", MIGRATION, re.S)[1]
        self.assertEqual(re.findall(r"'([a-z-]+)'", check), list(TOPICS))

    def test_it_is_safe_to_run_again(self):
        self.assertIn("DROP CONSTRAINT IF EXISTS census_category_topic_check", MIGRATION)
        self.assertLess(MIGRATION.index("DROP CONSTRAINT IF EXISTS"), MIGRATION.index("ADD CONSTRAINT"))
        self.assertIn("CREATE OR REPLACE FUNCTION public.rebuild_area_people()", MIGRATION)

    def test_the_rebuild_keeps_borough_only_rows_and_is_otherwise_unchanged(self):
        kept = "     WHERE g.id = c.geography_id AND g.kind <> 'lsoa'\n       AND c.topic <> 'country-of-birth-detailed';"
        self.assertIn(kept, MIGRATION)
        self.assertEqual(rebuild(MIGRATION).replace(kept, "     WHERE g.id = c.geography_id AND g.kind <> 'lsoa';"),
                         rebuild(PEOPLE))

    def test_listed_in_the_checklist(self):
        checklist = (DEPLOY.parent / "RELEASE-CHECKLIST.md").read_text()
        self.assertIn("047-census-country-of-birth.sql", checklist)
        self.assertIn("census2021-ts004.zip", checklist)
        self.assertIn("census2021-ts012.zip", checklist)


if __name__ == "__main__":
    unittest.main()
