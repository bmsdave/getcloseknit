"""Noise: levels under the mapping threshold stay NULL and shares cover every dwelling."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "009-noise.sql").read_text()
MIGRATION_090 = (Path(__file__).resolve().parents[1] / "migrations" / "090-noise-road-median-mapped.sql").read_text()


class RoadMedianMappedTests(unittest.TestCase):
    """#187: the road Lden median must ignore unmapped (<40 dB) homes, not count them as 0 dB."""

    def test_median_orders_by_the_level_not_zero_for_unmapped(self):
        self.assertNotIn("ORDER BY coalesce(road_lden, 0)", MIGRATION_090)
        self.assertIn("FILTER (WHERE road_lden IS NOT NULL)", MIGRATION_090)

    def test_median_is_null_when_under_half_the_homes_are_mapped(self):
        self.assertIn("road_lden IS NOT NULL)::int) >= 0.5", MIGRATION_090)

    def test_the_mapped_share_is_stored_on_area_noise(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS road_lden_mapped_share", MIGRATION_090)
        self.assertIn("road_lden_mapped_share", MIGRATION_090.split("INSERT INTO area_noise", 1)[1])

    def test_existing_rows_are_rebuilt_with_the_current_source_release(self):
        self.assertIn("PERFORM rebuild_area_noise", MIGRATION_090)

    def test_the_55_db_shares_still_count_unmapped_homes_as_quiet(self):
        self.assertIn("coalesce(road_lden, 0) >= 55", MIGRATION_090)
        self.assertIn("coalesce(rail_lden, 0) >= 55", MIGRATION_090)


MIGRATION_093 = (Path(__file__).resolve().parents[1] / "migrations" / "093-noise-aircraft-share.sql").read_text()


class EtlNoiseAirTests(unittest.TestCase):
    """#190: the loader samples aircraft Lden when the tiles are present and says so honestly."""

    @staticmethod
    def _source():
        return (Path(__file__).resolve().parents[1] / "tools" / "etl_noise.py").read_text()

    def test_loader_samples_aircraft_tiles_when_present(self):
        source = self._source()
        self.assertIn("air_tiles_present", source)
        self.assertIn("aircraft_lden", source)
        self.assertIn("src-defra-noise-round4-2022-road-rail-air", source)

    def test_loader_no_longer_claims_aircraft_is_never_part_of_the_maps(self):
        self.assertNotIn("Aircraft noise is not part of these maps", self._source())


class AircraftShareTests(unittest.TestCase):
    """#190: the noise data includes aircraft; the schema must carry it."""

    def test_dwelling_noise_stores_aircraft_levels(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS aircraft_lden", MIGRATION_093)

    def test_area_noise_exposes_the_air_share(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS air_55_share", MIGRATION_093)
        self.assertIn("air_55_share", MIGRATION_093.split("INSERT INTO area_noise", 1)[1])

    def test_the_loudest_home_level_includes_aircraft(self):
        self.assertIn("coalesce(n.aircraft_lden, 0)", MIGRATION_093)
        self.assertIn("coalesce(aircraft_lden, 0) >= 55", MIGRATION_093)

    def test_is_self_contained_with_the_090_road_median_fix(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS road_lden_mapped_share", MIGRATION_093)
        self.assertIn("FILTER (WHERE road_lden IS NOT NULL)", MIGRATION_093)


class NoiseSchemaTests(unittest.TestCase):
    def test_area_shares_count_unmapped_homes_as_quiet(self):
        self.assertIn("coalesce(road_lden, 0) >= 55", MIGRATION)
        self.assertIn("loudest >= 65", MIGRATION)

    def test_areas_cover_lsoa_msoa_and_borough(self):
        self.assertIn("UNION ALL SELECT msoa", MIGRATION)
        self.assertIn("UNION ALL SELECT borough", MIGRATION)


class RasterSampleTests(unittest.TestCase):
    def test_sampling_reads_rows_from_the_northern_edge(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("numpy not installed")
        import etl_noise

        raster = etl_noise.Raster.__new__(etl_noise.Raster)
        data = np.full((1000, 1000), -96.0, dtype=np.float32)
        data[0, 0] = 70.0      # north-west corner cell
        data[999, 999] = 50.0  # south-east corner cell
        raster.tiles = {(500_000, 150_000): data}
        self.assertEqual(raster.sample(500_005, 159_995), 70.0)
        self.assertEqual(raster.sample(509_995, 150_005), 50.0)
        self.assertIsNone(raster.sample(505_000, 155_000))  # under 40 dB: not mapped
        self.assertIsNone(raster.sample(600_000, 155_000))  # outside the extent


if __name__ == "__main__":
    unittest.main()
