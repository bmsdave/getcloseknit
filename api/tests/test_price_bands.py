"""Area price bands: percentile bands, boundaries, minimum samples and the bridge (pure)."""
import unittest

from area_api import price_bands as pb

Q = {"p10": 400_000, "p25": 500_000, "p50": 600_000, "p75": 700_000, "p90": 800_000}
AREAS = [("lsoa", {"id": "uk:lsoa:E01000004", "name": "Westminster 018A"}),
         ("msoa", {"id": "uk:msoa:E02000166", "name": "Westminster 018"}),
         ("borough", {"id": "uk:lad:E09000033", "name": "Westminster"})]
SALE = {"date": "2015-05-20", "price": 820_000, "standard": True}


def rows(**sales):
    """{geography id: quantile row} with the given sales per level."""
    ids = dict((level, area["id"]) for level, area in AREAS)
    return {ids[level]: {"geography_id": ids[level], "window_start": "2023-01", "period": "2026-10",
                         "sales": count, **Q} for level, count in sales.items()}


class PositionBandTests(unittest.TestCase):
    def test_every_band(self):
        cases = [(100_000, "bottom-10"), (450_000, "bottom-quarter"), (550_000, "lower-middle"),
                 (650_000, "upper-middle"), (750_000, "top-quarter"), (900_000, "top-10")]
        for price, band in cases:
            self.assertEqual(pb.position_band(price, Q), band, price)

    def test_boundaries_belong_to_the_band_above(self):
        self.assertEqual(pb.position_band(399_999, Q), "bottom-10")
        self.assertEqual(pb.position_band(400_000, Q), "bottom-quarter")
        self.assertEqual(pb.position_band(500_000, Q), "lower-middle")
        self.assertEqual(pb.position_band(600_000, Q), "upper-middle")
        self.assertEqual(pb.position_band(700_000, Q), "top-quarter")
        self.assertEqual(pb.position_band(800_000, Q), "top-10")

    def test_words_are_the_coarse_labels_only(self):
        self.assertEqual([words for _, words, _, _ in pb.BANDS],
                         ["bottom 10%", "bottom quarter", "lower middle", "upper middle", "top quarter", "top 10%"])


class BridgeTests(unittest.TestCase):
    def test_bridge_is_the_same_band_today_rounded(self):
        today = {"p10": 512_300, "p25": 581_000, "p50": 640_000, "p75": 721_400, "p90": 852_600}
        self.assertEqual(pb.bridge("top-10", today), {"from": 855_000, "to": None})
        self.assertEqual(pb.bridge("top-quarter", today), {"from": 720_000, "to": 855_000})
        self.assertEqual(pb.bridge("upper-middle", today), {"from": 640_000, "to": 720_000})
        self.assertEqual(pb.bridge("lower-middle", today), {"from": 580_000, "to": 640_000})
        self.assertEqual(pb.bridge("bottom-quarter", today), {"from": 510_000, "to": 580_000})
        self.assertEqual(pb.bridge("bottom-10", today), {"from": None, "to": 510_000})

    def test_rounding_is_coarse_and_never_zero(self):
        self.assertEqual(pb.round_price(682_499), 680_000)
        self.assertEqual(pb.round_price(682_500), 685_000)
        self.assertEqual(pb.round_price(1_000), 5_000)
        self.assertIsNone(pb.round_price(None))


class LevelTests(unittest.TestCase):
    def test_first_level_with_enough_sales(self):
        self.assertEqual(pb.pick_level({"lsoa": 25, "msoa": 90, "borough": 900}), "lsoa")
        self.assertEqual(pb.pick_level({"lsoa": 19, "msoa": 20, "borough": 900}), "msoa")

    def test_falls_back_to_the_largest_with_the_minimum(self):
        self.assertEqual(pb.pick_level({"lsoa": 3, "msoa": 8, "borough": 12}), "borough")
        self.assertEqual(pb.pick_level({"lsoa": 3, "msoa": 5, "borough": None}), "msoa")

    def test_minimum_sample_suppresses(self):
        self.assertIsNone(pb.pick_level({"lsoa": 4, "msoa": 4, "borough": 4}))
        self.assertIsNone(pb.pick_level({}))
        self.assertEqual(pb.pick_level({"borough": 5}), "borough")


class AreaPricesTests(unittest.TestCase):
    def test_range_position_and_bridge_on_one_geography(self):
        out = pb.area_prices("T", AREAS, rows(lsoa=41, msoa=300), rows(lsoa=9, msoa=60), SALE)
        self.assertEqual(out["propertyType"], "Terraced")
        self.assertEqual(out["range"]["level"], "lsoa")
        self.assertEqual((out["range"]["p25"], out["range"]["p75"], out["range"]["sales"]), (500_000, 700_000, 41))
        self.assertEqual(out["position"]["band"], "top-10")
        self.assertEqual(out["position"]["bandWords"], "top 10%")
        self.assertEqual(out["position"]["today"], {"from": 800_000, "to": None})
        self.assertIsNone(out["note"])

    def test_position_moves_up_with_the_range_when_the_year_is_thin(self):
        out = pb.area_prices("T", AREAS, rows(lsoa=41, msoa=300), rows(lsoa=4, msoa=60), SALE)
        self.assertEqual((out["range"]["level"], out["range"]["sales"]), ("msoa", 300))
        self.assertEqual(out["position"]["yearSales"], 60)

    def test_four_sales_show_nothing(self):
        out = pb.area_prices("T", AREAS, rows(lsoa=4, msoa=4, borough=4), rows(lsoa=9), SALE)
        self.assertIsNone(out["range"])
        self.assertIsNone(out["position"])
        self.assertEqual(out["note"], "Not enough sales of this type nearby to show a range.")

    def test_five_sales_are_enough_for_a_range_but_four_in_the_year_drop_the_position(self):
        out = pb.area_prices("T", AREAS, rows(borough=5), rows(borough=4), SALE)
        self.assertEqual((out["range"]["level"], out["range"]["sales"]), ("borough", 5))
        self.assertIsNone(out["position"])
        out = pb.area_prices("T", AREAS, rows(borough=5), rows(borough=5), SALE)
        self.assertEqual(out["position"]["band"], "top-10")

    def test_non_standard_or_missing_sale_and_other_types_have_no_position(self):
        for sale in (None, {**SALE, "standard": False}):
            out = pb.area_prices("T", AREAS, rows(lsoa=41), rows(lsoa=9), sale)
            self.assertIsNotNone(out["range"])
            self.assertIsNone(out["position"])
        for code in ("O", None):
            out = pb.area_prices(code, AREAS, rows(lsoa=41), rows(lsoa=9), SALE)
            self.assertIsNone(out["range"])

    def test_no_precise_percentile_leaves(self):
        out = pb.area_prices("T", AREAS, rows(lsoa=41), rows(lsoa=9), SALE)
        self.assertEqual(set(out["position"]), {"saleDate", "year", "band", "bandWords", "yearSales", "today"})
        self.assertEqual(out["minimumSales"], 5)


if __name__ == "__main__":
    unittest.main()
