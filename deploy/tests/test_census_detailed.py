"""Detailed Census tables (migration 059): the topic check admits them, the rebuild keeps the MSOA-only
topics' rows and sums them into boroughs, the file can run again, and it is listed in
the release checklist."""
import re
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
MIGRATION = (DEPLOY / "migrations" / "059-census-detailed.sql").read_text()
COUNTRY = (DEPLOY / "migrations" / "047-census-country-of-birth.sql").read_text()
TOPICS = ("ethnicity", "religion", "qualification", "occupation", "economic-activity", "tenure",
          "accommodation", "age", "household-type", "country-of-birth", "country-of-birth-detailed",
          "ethnicity-detailed", "country-of-birth-extended", "passports", "national-identity", "religion-detailed",
          "main-language", "year-of-arrival")
KEPT = "\n       AND NOT (g.kind = 'msoa' AND c.topic IN ('ethnicity-detailed', 'country-of-birth-extended', 'passports', 'national-identity', 'religion-detailed'));"
SUMMED = """
    UNION ALL
    SELECT m.parent_id, c.topic, c.category, sum(c.count), min(c.source_release_id)
    FROM area_census_count c
    JOIN area_geography m ON m.id = c.geography_id
    WHERE m.kind = 'msoa' AND c.topic IN ('ethnicity-detailed', 'country-of-birth-extended', 'passports', 'national-identity', 'religion-detailed')
    GROUP BY 1, 2, 3;"""


def rebuild(sql: str) -> str:
    return sql[sql.index("CREATE OR REPLACE FUNCTION public.rebuild_area_people()"):]


class CensusDetailedTests(unittest.TestCase):
    def test_the_topic_check_lists_every_topic(self):
        check = re.search(r"CHECK \(topic IN \((.*?)\)\)", MIGRATION, re.S)[1]
        self.assertEqual(re.findall(r"'([a-z-]+)'", check), list(TOPICS))

    def test_it_is_safe_to_run_again(self):
        self.assertLess(MIGRATION.index("DROP CONSTRAINT IF EXISTS census_category_topic_check"),
                        MIGRATION.index("ADD CONSTRAINT"))
        self.assertIn("CREATE OR REPLACE FUNCTION public.rebuild_area_people()", MIGRATION)

    def test_the_rebuild_keeps_msoa_rows_sums_them_into_boroughs_and_is_otherwise_047(self):
        self.assertIn(KEPT, MIGRATION)
        self.assertIn(SUMMED, MIGRATION)
        self.assertEqual(rebuild(MIGRATION).replace(KEPT, ";").replace(SUMMED, ";"), rebuild(COUNTRY))

    def test_listed_in_the_checklist(self):
        checklist = (DEPLOY.parent / "RELEASE-CHECKLIST.md").read_text()
        self.assertIn("059-census-detailed.sql", checklist)
        for download in ("for t in ts013 ts015 ts022 ts028 ts031;", "area_analytics.census_api fetch",
                         "area_analytics.census_picks write"):
            self.assertIn(download, checklist)

    def test_the_msoa_topics_are_the_loaders(self):
        import sys
        sys.path.insert(0, str(DEPLOY.parent / "pipelines" / "area-analytics-ingest"))
        from area_analytics import census_people
        self.assertEqual(census_people.MSOA_TOPICS, tuple(re.findall(r"'([a-z-]+)'", KEPT.split(" IN ")[1])))


if __name__ == "__main__":
    unittest.main()
