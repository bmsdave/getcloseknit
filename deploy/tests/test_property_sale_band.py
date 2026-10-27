"""Migration 044: a sold home's coarse sale band in the property tile, built once per sales load.

The band is the one the property page states ("top quarter" ...), so the SQL must
follow api/area_api/price_bands.py: same bands, same thresholds, same level choice.
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent / "api"))
from area_api import price_bands  # noqa: E402

MIGRATION = (ROOT / "migrations" / "044-property-sale-band.sql").read_text()
REBUILD = MIGRATION.split("FUNCTION public.rebuild_property_sale_bands", 1)[1].split("$$;", 1)[0]
PROPERTY_TILE = MIGRATION.split("FUNCTION public.property_tile", 1)[1].split("$$;", 1)[0]
TILE_040 = (ROOT / "migrations" / "040-area-price-bands.sql").read_text().split(
    "FUNCTION public.property_tile", 1)[1].split("$$;", 1)[0]
SALE_TILE = MIGRATION.split("FUNCTION public.sale_tile", 1)[1].split("$$;", 1)[0]
SALE_TILE_040 = (ROOT / "migrations" / "040-area-price-bands.sql").read_text().split(
    "FUNCTION public.sale_tile", 1)[1].split("$$;", 1)[0]


class RebuildTests(unittest.TestCase):
    def test_idempotent(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS property_sale_band", MIGRATION)
        self.assertIn("CREATE OR REPLACE FUNCTION public.rebuild_property_sale_bands", MIGRATION)
        self.assertIn("CREATE OR REPLACE FUNCTION public.property_tile", MIGRATION)
        self.assertIn("DELETE FROM property_sale_band", REBUILD)
        self.assertNotRegex(MIGRATION, r"(?i)\bDROP TABLE property_sale_band\b")

    def test_band_column_holds_only_the_six_coarse_bands(self):
        self.assertEqual(len(price_bands.BANDS), 6)
        self.assertIn("band smallint NOT NULL CHECK (band BETWEEN 0 AND 5)", MIGRATION)

    def test_last_standard_sale_of_the_four_types_only(self):
        self.assertIn("ORDER BY s.address_id, s.completion_date DESC, s.price DESC", REBUILD)
        self.assertIn("last.ppd_category = 'A'", REBUILD)
        self.assertIn("last.property_type IN ('D', 'S', 'T', 'F')", REBUILD)

    def test_against_same_type_sales_that_year_from_area_price_year(self):
        for alias in ("yl", "ym", "yb"):
            self.assertRegex(REBUILD, rf"area_price_year {alias} ON {alias}\.geography_id = h\.\w+_id\s+"
                                      rf"AND {alias}\.property_type = h\.property_type AND {alias}\.year = h\.year")

    def test_thresholds_follow_the_property_page(self):
        self.assertEqual((price_bands.MIN_SALES, price_bands.ENOUGH_SALES), (5, 20))
        for alias in ("bl", "bm", "bb"):
            self.assertIn(f"{alias}.sales >= {price_bands.ENOUGH_SALES}", REBUILD)
            self.assertIn(f"{alias}.sales >= {price_bands.MIN_SALES}", REBUILD)
        for alias in ("yl", "ym", "yb"):
            self.assertIn(f"{alias}.sales >= {price_bands.MIN_SALES}", REBUILD)

    def test_band_boundaries_match_position_band(self):
        # A price on a boundary belongs to the band above it, as position_band does.
        for index, (_, _, lower, _) in enumerate(price_bands.BANDS):
            if lower:
                self.assertIn(f"WHEN h.price >= y.{lower} THEN {index}", REBUILD)
        self.assertIn("ELSE 0 END", REBUILD)

    def test_no_percentile_floor_area_or_value_is_stored(self):
        table = MIGRATION.split("CREATE TABLE IF NOT EXISTS property_sale_band", 1)[1].split(");", 1)[0]
        self.assertNotRegex(table, r"\bp\d\d\b|percent|price|floor|value")

    def test_wired_into_the_sales_load_after_the_area_bands(self):
        source = (ROOT / "tools" / "etl_sales.py").read_text()
        self.assertLess(source.index('"rebuild_area_price_bands(%s)"'), source.index('"rebuild_property_sale_bands(%s)"'))
        checklist = (ROOT.parent / "RELEASE-CHECKLIST.md").read_text()
        self.assertIn("044-property-sale-band.sql", checklist)


class TileTests(unittest.TestCase):
    def test_dwellings_and_single_home_parcels_carry_the_band(self):
        points = PROPERTY_TILE.split("point_features AS", 1)[1]
        self.assertIn("valued.band", points)
        parcels = PROPERTY_TILE.split("), parcels AS", 1)[1].split("), parcel_features", 1)[0]
        self.assertIn("CASE WHEN count(valued.uprn) = 1", parcels)

    def test_hidden_homes_are_never_coloured(self):
        valued = PROPERTY_TILE.split("valued AS NOT MATERIALIZED", 1)[1].split("), parcels AS", 1)[0]
        self.assertIn("NOT EXISTS (SELECT 1 FROM suppressed_dwelling s", valued)
        self.assertIn("LEFT JOIN property_sale_band", valued)
        # A parcel with any hidden home on it takes no band, even if one other home there sold.
        parcels = PROPERTY_TILE.split("), parcels AS", 1)[1].split("), parcel_features", 1)[0]
        self.assertIn("suppressed_dwelling", parcels)

    def test_only_adds_the_band_and_drops_sppm_from_migration_040(self):
        def strip(body: str) -> str:
            # 040's per-home £/m² columns, which 044 drops.
            body = re.sub(r"(round\(\w+\.sppm\)|percentile_cont\(0\.5\) WITHIN GROUP \(ORDER BY valued\.sppm\)"
                          r"|v\.sale_price_per_square_metre) AS sppm,", "", body)
            kept = [line for line in body.splitlines()
                    if "band" not in line and "suppressed_dwelling" not in line and "hidden" not in line]
            return re.sub(r"\s+", " ", "\n".join(kept)).strip()
        self.assertEqual(strip(PROPERTY_TILE), strip(TILE_040))


class NoPerHomePricePerAreaTests(unittest.TestCase):
    """While the EPC licence is pending no single home's £/m² (nor its floor area) leaves the database."""

    def test_property_tile_carries_no_per_home_price_per_area_or_floor_area(self):
        self.assertNotRegex(PROPERTY_TILE, r"(?i)sppm|sale_price_per_square_metre|floor_area")
        homes = PROPERTY_TILE.split("), tile_parcels", 1)[1]
        self.assertNotRegex(homes, r"(?i)\bppm\b|per_square_metre")
        # Street blocks keep their median, and only over three or more homes.
        self.assertIn("CASE WHEN b.dwellings >= 3 THEN round(b.median_price_per_square_metre) END AS ppm",
                      PROPERTY_TILE)

    def test_sale_pins_carry_no_per_sale_price_per_area(self):
        pins, cells = SALE_TILE.split("ELSIF z >= 11", 1)
        self.assertNotRegex(pins, r"(?i)\bppm\b|per_square_metre")
        self.assertIn("pin.last_price AS price", pins)
        # Cells keep a median £/m² over three or more homes, as before.
        self.assertIn("HAVING count(*) >= 3", cells)
        self.assertIn("percentile_cont(0.5) WITHIN GROUP (ORDER BY pin.last_price_per_square_metre)", cells)

    def test_sale_tile_only_drops_the_pin_ppm_from_migration_040(self):
        def strip(body: str) -> str:
            kept = [line for line in body.splitlines() if "round(pin.last_price_per_square_metre)" not in line]
            return re.sub(r"\s+", " ", "\n".join(kept)).strip()
        self.assertEqual(strip(SALE_TILE), strip(SALE_TILE_040))


if __name__ == "__main__":
    unittest.main()
