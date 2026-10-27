"""Migration 046: parcels in the property tile carry their area in m², so the map can tell a home's
plot from a Land Registry title covering a whole estate (web/src/lib/map-property-layers.ts)."""
import re
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
MIGRATION = (DEPLOY / "migrations" / "046-property-tile-parcel-area.sql").read_text()
TILE = MIGRATION.split("FUNCTION public.property_tile", 1)[1].split("$$;", 1)[0]
TILE_044 = (DEPLOY / "migrations" / "044-property-sale-band.sql").read_text().split(
    "FUNCTION public.property_tile", 1)[1].split("$$;", 1)[0]


def without_area(sql: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"--[^\n]*", "", sql)).strip()


class ParcelAreaTileTests(unittest.TestCase):
    def test_safe_to_run_again(self):
        self.assertIn("CREATE OR REPLACE FUNCTION public.property_tile", MIGRATION)
        self.assertNotRegex(MIGRATION, r"\b(DROP|DELETE|TRUNCATE|ALTER TABLE)\b")

    def test_parcels_carry_their_area_in_square_metres(self):
        parcels = TILE.split("), parcels AS", 1)[1].split("), parcel_features", 1)[0]
        # Cheap and within a fraction of a percent of the geodesic area at London's latitude.
        self.assertIn("ST_Area(tp.geometry) * 12392142400 * cos(radians(ST_Y(ST_Centroid(tp.geometry))))", parcels)
        self.assertNotIn("::geography", parcels)
        features = TILE.split("parcel_features AS", 1)[1].split("), point_features", 1)[0]
        self.assertIn("parcels.area", features)

    def test_otherwise_the_tile_of_044(self):
        added = [
            ",\n               round(ST_Area(tp.geometry) * 12392142400 * cos(radians(ST_Y(ST_Centroid(tp.geometry))))) AS area",
            "\n               parcels.area,",
        ]
        stripped = TILE
        for text in added:
            self.assertIn(text, stripped)
            stripped = stripped.replace(text, "", 1)
        self.assertEqual(without_area(stripped), without_area(TILE_044))


if __name__ == "__main__":
    unittest.main()
