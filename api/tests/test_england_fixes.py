"""Fixes after the England deploy (2026-10-23): rows under a second member release, region words, migration 115."""
import re
import unittest
from pathlib import Path

from area_api import evidence, layers

MIGRATION = Path(__file__).resolve().parents[2] / "deploy" / "migrations" / "115-england-fixes.sql"


class LayerReleasesTest(unittest.TestCase):
    def test_values_read_every_member_release_of_the_metric(self):
        # flood-risk and noise outside London sit under their England releases while metric_definition names
        # the London one: the area card must read them as the map does.
        sql = re.sub(r"\s+", " ", layers.VALUES_SQL)
        self.assertNotIn("v.source_release_id = m.source_release_id", sql)
        self.assertIn("v.source_release_id IN ( SELECT r.source_release_id FROM product_release_member r "
                      "WHERE r.release_id = active.release_id)", sql)


class CatalogueTest(unittest.TestCase):
    def test_periods_by_skip_scan_not_a_distinct_over_every_row(self):
        for sql in (evidence.METRICS_SQL, evidence.METRIC_SQL):
            self.assertNotIn("array_agg(DISTINCT", sql)
            self.assertIn("WITH RECURSIVE step(period)", sql)
            self.assertIn("p.period > step.period", sql)


class PercentileMeaningTest(unittest.TestCase):
    def test_meaning_names_the_rows_region(self):
        regions = {"uk:lsoa:E01004849": "E12000002", "uk:lsoa:E01000001": "E12000007"}
        self.assertEqual(evidence._percentile_meaning(90, "uk:lsoa:E01004849", regions),
                         "90 = lower than 10% of North West LSOAs")
        self.assertEqual(evidence._percentile_meaning(90, "uk:lsoa:E01000001", regions),
                         "90 = lower than 10% of London LSOAs")
        self.assertEqual(evidence._percentile_meaning(40, "uk:lsoa:E01004849", None),
                         "40 = lower than 60% of London LSOAs")
        self.assertIsNone(evidence._percentile_meaning(None, "uk:lsoa:E01004849", regions))

    def test_summary_carries_it(self):
        row = {"geography_id": "uk:lsoa:E01004849", "name": "Bolton 005A", "metric_id": "flood-risk",
               "period": "2026-07", "value": 1.2, "region_percentile": 90, "country_percentile": None,
               "sample_count": None, "quality": "observed", "source_release_id": "src", "carrier": "lsoa"}
        metric = {"id": "flood-risk", "direction": "higher-is-more", "source_release_id": "src", "carrier": "lsoa"}
        summary = evidence._summary({"id": row["geography_id"], "name": row["name"]}, metric, "2026-07", row,
                                    region_map={"uk:lsoa:E01004849": "E12000002"})
        self.assertEqual(summary["percentileMeaning"], "90 = lower than 10% of North West LSOAs")


class Migration115Test(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text()

    def test_catalogue_index_is_in_the_repo(self):
        self.assertIn("CREATE INDEX IF NOT EXISTS metric_value_metric_release_period_idx\n"
                      "    ON metric_value (metric_id, source_release_id, period)", self.sql)

    def test_best_primary_ranks_in_the_areas_region(self):
        body = self.sql.split("CREATE OR REPLACE FUNCTION public.rebuild_area_london_rank()", 1)[1]
        primary = body.split("'best-primary'", 1)[1]
        # The pool is the area's region (area_rank_region of the LSOA), never the school's.
        self.assertIn("area_rank_region(g.id)", body)
        self.assertNotIn("PARTITION BY region ORDER BY value", primary)
        self.assertIn("pool.region IS NOT DISTINCT FROM best.area_region", primary)


if __name__ == "__main__":
    unittest.main()
