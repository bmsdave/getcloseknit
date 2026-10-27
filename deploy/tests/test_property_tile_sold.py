"""Migration 022 adds the recorded sale's £/m² to the property tile without losing suppression."""
import unittest
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
TILE_022 = (MIGRATIONS / "022-property-tile-sold-ppm.sql").read_text()
TILE_007 = (MIGRATIONS / "007-property-objection.sql").read_text()


def tile(sql: str) -> str:
    return sql.split("CREATE OR REPLACE FUNCTION public.property_tile", 1)[1]


class PropertyTileSoldTests(unittest.TestCase):
    def test_parcels_and_dwellings_carry_sppm_from_the_recorded_sale(self):
        body = tile(TILE_022)
        self.assertIn("v.sale_price_per_square_metre AS sppm", body)
        parcels = body.split("parcel_features AS", 1)[1].split("), point_features", 1)[0]
        points = body.split("point_features AS", 1)[1]
        self.assertIn("round(parcels.sppm) AS sppm", parcels)
        self.assertIn("round(valued.sppm) AS sppm", points)

    def test_still_excludes_suppressed_dwellings_and_keeps_blocks_restated(self):
        body = tile(TILE_022)
        valued = body.split("valued AS NOT MATERIALIZED", 1)[1].split("), parcels AS", 1)[0]
        self.assertIn("NOT EXISTS (SELECT 1 FROM suppressed_dwelling", valued)
        blocks = body.split("block_features AS", 1)[1].split("), tile_parcels", 1)[0]
        self.assertNotIn("sppm", blocks)

    def test_only_adds_sppm_to_migration_007(self):
        without = "\n".join(line for line in tile(TILE_022).splitlines() if "sppm" not in line)
        original = "\n".join(line for line in tile(TILE_007).splitlines()
                             if "v.confidence, v.sale_period" not in line
                             and "parcels.value, parcels.confidence" not in line
                             and "round(valued.ppm) AS ppm, valued.value" not in line)
        self.assertEqual(without.strip(), original.strip())


if __name__ == "__main__":
    unittest.main()
