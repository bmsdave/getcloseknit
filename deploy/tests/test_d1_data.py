"""v4 D1 data: psql bundles (release_bundle.py), the noise and air map layers, good value (migration 069)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import etl_health  # noqa: E402
import etl_noise_layer as nl  # noqa: E402
import release_bundle as rb  # noqa: E402

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "069-area-good-value.sql").read_text()
STAGE = (Path(__file__).resolve().parents[1] / "tools" / "stage_release.py").read_text()


class BundleTests(unittest.TestCase):
    def test_literals_quote_and_null(self):
        self.assertEqual(rb.literal(None), "NULL")
        self.assertEqual(rb.literal("it's"), "'it''s'")
        self.assertEqual(rb.literal(3), "3")
        self.assertEqual(rb.text_array(["a", "b"]), "ARRAY['a', 'b']::text[]")

    def test_copy_block_writes_null_as_an_empty_field_and_ends_the_data(self):
        block = rb.copy_sql("t", ("a", "b"), [("x,y", None), ("z", 1.5)])
        self.assertEqual(block, 'COPY t (a, b) FROM stdin WITH (FORMAT csv);\n"x,y",\nz,1.5\n\\.')

    def test_metric_replaces_definition_and_values(self):
        sql = rb.metric_sql("noise", "lsoa", "%", "higher-is-more", {"label": "Noise"}, "src-x",
                            [("uk:lsoa:E01000001", "2022-12-01", 10.0, 3, 50, "observed")])
        self.assertIn("ON CONFLICT (id) DO UPDATE", sql)
        self.assertIn("DELETE FROM metric_value WHERE metric_id = 'noise';", sql)
        self.assertIn("uk:lsoa:E01000001,noise,2022-12-01,10.0,3,50,observed,src-x", sql)

    def test_stage_matches_stage_release_and_is_a_noop_on_rerun(self):
        sql = rb.stage_sql("air", ["src-a", "src-b"], ["src-gla-laei-layer"])
        self.assertIn("LIKE ANY(ARRAY['src-gla-laei-layer%']::text[])", sql)
        self.assertIn("already holds", sql)
        for step in ("rebuild_area_rank", "rebuild_area_good_value", "activate_product_release"):
            self.assertIn(step, sql)
            self.assertIn(step, STAGE if step != "activate_product_release" else sql)
        self.assertLess(sql.index("rebuild_area_rank"), sql.index("rebuild_area_good_value"))
        self.assertLess(STAGE.index("rebuild_area_rank()"), STAGE.index("rebuild_area_good_value()"))


class NoiseBundleTests(unittest.TestCase):
    DEFRA = {"id": "src-defra-noise-round4-2022-road-rail-air", "source_url": "https://example.test",
             "release_date": "2022-12-31", "sha256": "ab", "licence": "OGL-3.0", "attribution": "Defra"}

    def test_bundle_guards_the_defra_load_and_names_the_layer_by_its_rows(self):
        values = nl.aggregate({"uk:lsoa:E01000001": (200, 0.1), "uk:lsoa:E01000002": (3, 0.5)})
        parts = nl.bundle_parts(self.DEFRA, values)
        self.assertIn("IS DISTINCT FROM ARRAY['src-defra-noise-round4-2022-road-rail-air']", parts[0])
        self.assertRegex(parts[1], r"'src-defra-noise-layer-[0-9a-f]{8}'")
        self.assertIn("uk:lsoa:E01000002,noise,2022-12-01,,,3,suppressed", parts[2])
        self.assertIn("'-noise-layer'", parts[3])
        self.assertEqual(parts, nl.bundle_parts(self.DEFRA, values))  # same rows, same source id


class AirLayerTests(unittest.TestCase):
    def test_values_rank_cleanest_first_and_suppress_few_homes(self):
        means = {"uk:lsoa:E01000003": (50, [30.04, 12.0]), "uk:lsoa:E01000001": (200, [18.26, None]),
                 "uk:lsoa:E01000002": (4, [25.0, None])}
        self.assertEqual(etl_health.air_layer_values(means), [
            ("uk:lsoa:E01000001", "2022-12-01", 18.3, 0, 200, "observed"),
            ("uk:lsoa:E01000002", "2022-12-01", None, None, 4, "suppressed"),
            ("uk:lsoa:E01000003", "2022-12-01", 30.0, 100, 50, "observed"),
        ])

    def test_definition_runs_clean_green_to_dirty_red_and_names_the_source(self):
        definition = etl_health.air_layer_definition()
        legend = definition["legend"]
        self.assertEqual(legend[0]["colour"], "#3a7d44")
        self.assertEqual(legend[-1]["colour"], "#b23a48")
        self.assertEqual([stop["value"] for stop in legend], sorted(stop["value"] for stop in legend))
        self.assertIn(etl_health.AIR_ATTRIBUTION, definition["caveats"])
        self.assertEqual(definition["label"], "Clean air")


class GoodValueSchemaTests(unittest.TestCase):
    def test_vector_is_six_ranks_and_never_price_or_people(self):
        self.assertIn("safety smallint", MIGRATION)
        for rank in ("best-primary", "station-walk", "quiet", "park-distance", "'air-no2'", "'crime'"):
            self.assertIn(rank, MIGRATION)
        vector = MIGRATION.split("CREATE TABLE IF NOT EXISTS area_score_vector", 1)[1].split(");", 1)[0]
        for word in ("price", "income", "depriv", "census", "social"):
            self.assertNotIn(word, vector)

    def test_hidden_under_twenty_sales_and_fifty_peers(self):
        self.assertIn("b.sales >= 20", MIGRATION)
        self.assertIn("CHECK (sales >= 20)", MIGRATION)
        self.assertIn("LIMIT 50", MIGRATION)
        self.assertIn("d.shared >= 4", MIGRATION)


if __name__ == "__main__":
    unittest.main()
