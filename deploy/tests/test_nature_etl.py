"""Nature ETL: NDVI scaling, the ~100 m window, tree rows, wildlife presence and the schema's own percentiles."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import etl_nature  # noqa: E402

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "064-nature.sql").read_text()


class SchemaTests(unittest.TestCase):
    def test_nature_keeps_its_own_ranks(self):
        # Other themes add London ranks in parallel: Nature never touches area_london_rank (now area_rank).
        self.assertNotIn("area_london_rank", MIGRATION.split("-- Nature keeps")[1].split("\n", 1)[1])
        self.assertIn("CREATE OR REPLACE FUNCTION public.rebuild_area_nature()", MIGRATION)

    def test_top_trees_skip_the_catch_all_name(self):
        self.assertIn("common_name <> 'Other'", MIGRATION)

    def test_nearer_site_ranks_higher_and_score_needs_all_three(self):
        self.assertIn("ORDER BY n.site_metres DESC", MIGRATION)
        self.assertIn("green_percentile IS NOT NULL AND trees_percentile IS NOT NULL AND site_percentile IS NOT NULL",
                      MIGRATION)


class NumpyTests(unittest.TestCase):
    def setUp(self):
        try:
            import numpy  # noqa: F401
        except ImportError:
            self.skipTest("numpy not installed")

    def test_ndvi_applies_the_c1_offset_and_drops_nodata(self):
        import numpy as np

        red = np.array([1500, 0, 1000], dtype=np.uint16)   # 0.05 reflectance; nodata; 0.0
        nir = np.array([4500, 3000, 1000], dtype=np.uint16)  # 0.35; -; 0.0
        value = etl_nature.ndvi(red, nir)
        self.assertAlmostEqual(float(value[0]), 0.75, places=5)
        self.assertTrue(np.isnan(value[1]))
        self.assertTrue(np.isnan(value[2]))  # zero reflectance in both bands: no ratio

    def test_window_sums_clip_at_the_edges(self):
        import numpy as np

        grid = np.ones((5, 5), dtype=np.int32)
        sums = etl_nature.window_sums(grid, 1, np.array([0, 2]), np.array([0, 2]))
        self.assertEqual(sums.tolist(), [4, 9])

    def test_cells_count_rows_from_the_northern_edge(self):
        rows, cols = etl_nature.cell_of([500_005, 569_995], [209_995, 150_005])
        self.assertEqual((rows.tolist(), cols.tolist()), ([0, 5999], [0, 6999]))


class TreeRowTests(unittest.TestCase):
    def test_duplicates_get_a_suffix_and_trees_outside_london_are_dropped(self):
        header = "borough,lat,lon,uniqueid,taxon_species,common_name,taxon_genus,gla_name,maintainer\n"
        body = ("Barnet,51.63,-0.14,69,Acer,Maple,Acer,Maple,LB Barnet\n"
                "Barnet,51.64,-0.15,69,Tilia,Lime,Tilia,Lime,\n"
                "Barnet,53.0,-1.0,70,Acer,Maple,Acer,Maple,LB Barnet\n"
                "Barnet,,,71,Acer,Maple,Acer,Maple,LB Barnet\n")
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as handle:
            handle.write("﻿" + header + body)
        rows = list(etl_nature.tree_rows(handle.name))
        self.assertEqual([row[0] for row in rows], ["Barnet:69", "Barnet:69#2"])
        self.assertEqual(rows[1][3:], ("Lime", "Tilia", "Barnet"))

    def test_sizes_read_as_recorded_with_a_number_for_the_dot(self):
        # The forms in the Nov 2025 list (migration 066).
        self.assertEqual(etl_nature.measure("8 m"), ("8 m", 8.0))
        self.assertEqual(etl_nature.measure("7.5 m"), ("7.5 m", 7.5))
        self.assertEqual(etl_nature.measure("5 to 10 m"), ("5–10 m", 7.5))
        self.assertEqual(etl_nature.measure("<3 m"), ("under 3 m", 3.0))
        self.assertEqual(etl_nature.measure("15+ m"), ("15+ m", 15.0))
        self.assertEqual(etl_nature.measure("Up to 10 cm"), ("up to 10 cm", 10.0))
        self.assertEqual(etl_nature.measure("Over 150 cm"), ("over 150 cm", 150.0))
        self.assertEqual(etl_nature.measure("32cm"), ("32 cm", 32.0))
        self.assertEqual(etl_nature.measure("Multi-stemmed"), ("Multi-stemmed", None))
        self.assertEqual(etl_nature.measure("Not recorded"), (None, None))
        self.assertEqual(etl_nature.measure(None), (None, None))

    def test_tree_size_keeps_age_unless_not_given(self):
        row = {"height_m": "10 m", "canopy_m": "8 m", "girth_dbh": "Sapling", "age_cat": "Mature (31-80)"}
        self.assertEqual(etl_nature.tree_size(row), ("10 m", "8 m", "Sapling", 8.0, "Mature (31-80)"))
        unknown = {"height_m": "Not recorded", "canopy_m": "90 m", "girth_dbh": "", "age_cat": "Not provided"}
        self.assertEqual(etl_nature.tree_size(unknown), (None, "90 m", None, None, None))


class SiteNameTests(unittest.TestCase):
    def test_upper_case_names_read_as_names(self):
        self.assertEqual(etl_nature.site_name("SYDENHAM HILL WOOD AND DULWICH WOOD"), "Sydenham Hill Wood and Dulwich Wood")
        self.assertEqual(etl_nature.site_name("THE COPSE"), "The Copse")


class WildlifeTests(unittest.TestCase):
    TAXA = {"1": {"name": "Erinaceus europaeus", "class": 359, "order": 10, "family": 11, "species": 1},
            "2": {"name": "Felis catus", "class": 359, "order": 12, "family": 13, "species": 2},
            "3": {"name": "Alcedo atthis", "class": 212, "order": 14, "family": 15, "species": 3},
            "4": {"name": "Turdus merula", "class": 212, "order": 16, "family": 17, "species": 4},
            "5": {"name": "Pieris rapae", "class": 216, "order": 18, "family": 19, "species": 5}}
    NOTABLES = {"Hedgehog": ("species", 1), "Kingfisher": ("species", 3), "Bats": ("order", 734)}

    def test_species_only_in_blurred_records_are_dropped(self):
        everything = {"count": 10, "species": {1: 4, 3: 2, 4: 4}}
        imprecise = {"count": 3, "species": {3: 2, 4: 1}}
        self.assertEqual(etl_nature.precise_species(everything, imprecise), {1: 4, 4: 3})

    def test_summary_counts_wild_groups_and_names_notables_in_list_order(self):
        summary = etl_nature.summarise({3: 1, 1: 2, 2: 5, 4: 1, 5: 1}, self.TAXA, self.NOTABLES)
        self.assertEqual((summary["bird"], summary["mammal"], summary["amphibian"]), (2, 1, 0))  # no cat, no butterfly
        self.assertEqual(summary["notable"], ["Hedgehog", "Kingfisher"])



class LayerTests(unittest.TestCase):
    TAXA = WildlifeTests.TAXA
    NOTABLES = WildlifeTests.NOTABLES

    def test_shares_are_of_all_records_and_thin_areas_stay_unknown(self):
        row = {"records": 400, "species": {"1": 20, "2": 50, "3": 4, "4": 326}}
        self.assertEqual(etl_nature.species_shares(row, self.TAXA, self.NOTABLES),
                         {"Hedgehog": 5.0, "Kingfisher": 1.0, "Bats": 0.0})
        self.assertIsNone(etl_nature.species_shares({"records": 199, "species": {"1": 20}}, self.TAXA, self.NOTABLES))

    def test_band_rises_smoothly_between_the_species_own_thresholds(self):
        thresholds = etl_nature.band_thresholds([0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
        self.assertEqual(thresholds, (3, 5, 7))
        score = lambda share: etl_nature.band_score(share, thresholds)
        self.assertEqual([score(0), score(2), score(3), score(4), score(5), score(6), score(7), score(20)],
                         [0.0, 1.0, 1.0, 1.5, 2.0, 2.5, 3.0, 3.0])
        self.assertIsNone(etl_nature.band_thresholds([0, 0]))  # never recorded anywhere
        self.assertEqual(etl_nature.band_score(5, None), 0.0)

    def test_every_legend_step_is_labelled_and_links_the_guide(self):
        self.assertTrue(all(stop["label"] for stop in etl_nature.NATURE_DEFINITION["legend"]))
        self.assertEqual([stop["label"] for stop in etl_nature.BAND_LEGEND], ["No record", "Rarely", "Sometimes", "Often"])
        self.assertEqual([stop["value"] for stop in etl_nature.BAND_LEGEND], [0, 1, 2, 3])
        self.assertEqual(etl_nature.NATURE_DEFINITION["methodologyPath"], "/guide/nature")

    def test_layer_ids(self):
        self.assertEqual(etl_nature.layer_id("House sparrow"), "wildlife-house-sparrow")


if __name__ == "__main__":
    unittest.main()
