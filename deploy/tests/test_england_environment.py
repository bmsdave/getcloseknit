"""England environment ETLs (branch england/d6-environment): flood tiles, noise sampling, PCM air,
STATS19 coverage and regional ranks. Pure functions only; the loads are checked against ae-pgold."""
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import area_coverage as coverage  # noqa: E402
import england_air  # noqa: E402
import england_flood as ef  # noqa: E402
import england_noise as en  # noqa: E402
import etl_kids  # noqa: E402
import etl_noise_layer as nl  # noqa: E402


class FloodTileTests(unittest.TestCase):
    def test_sld_paints_each_band_its_own_grey(self):
        sld = ef.sld("rofsw")
        for band, level in (("Low", "#010101"), ("Medium", "#020202"), ("High", "#030303")):
            self.assertIn(f"<ogc:Literal>{band}</ogc:Literal>", sld)
            self.assertIn(level, sld)
        self.assertNotIn("Stroke", sld)  # no outline: a pixel's colour is only ever its band

    def test_band_raster_reads_the_grey_level_where_painted(self):
        from PIL import Image

        grey = np.zeros((ef.PIXELS, ef.PIXELS, 2), dtype=np.uint8)
        grey[0, 0] = (3, 255)
        grey[0, 1] = (2, 255)
        grey[0, 2] = (1, 0)  # transparent: not mapped, whatever the grey
        buffer = io.BytesIO()
        Image.fromarray(grey, "LA").save(buffer, "PNG")
        bands = ef.band_raster(buffer.getvalue())
        self.assertEqual(bands[0, :3].tolist(), [3, 2, 0])

    def test_reduce_tile_counts_land_bands_and_homes(self):
        label = np.zeros((ef.PIXELS, ef.PIXELS), dtype=np.int32)
        label[:10, :10] = 1        # LSOA index 0: 100 m2
        label[:10, 10:20] = 3      # LSOA index 2: 100 m2, half of it water
        water = np.zeros_like(label, dtype=bool)
        water[:10, 15:20] = True
        bands = np.zeros_like(label, dtype=np.uint8)
        bands[:5, :10] = 3         # 50 m2 high in LSOA 0
        bands[:10, 15:20] = 3      # high, but on water: not counted
        rasters = {"rivers-sea": bands, "surface-water": np.zeros_like(bands)}
        east, north = 100_000, 200_000
        # A home in LSOA 0's high corner (row 0 = northern edge) and one in its unmapped half.
        out = ef.reduce_tile(east, north, label, water, rasters, np.array([7, 9]),
                             np.array([east + 1.5, east + 1.5]), np.array([north + ef.TILE - 0.5, north + ef.TILE - 8.5]))
        self.assertEqual(out["lsoa"].tolist(), [0, 2])
        self.assertEqual(out["land"].tolist(), [100, 50])
        self.assertEqual(out["rivers_sea_high"].tolist(), [50, 0])
        self.assertEqual(out["surface_water_low"].tolist(), [0, 0])
        self.assertEqual(out["rivers_sea_home"].tolist(), [4, 1])  # high, very low
        self.assertEqual(out["home"].tolist(), [7, 9])


class NoiseTests(unittest.TestCase):
    def test_sample_follows_etl_noise_cells_and_thresholds(self):
        data = np.full((en.TILE // en.CELL, en.TILE // en.CELL), -99.0, dtype=np.float32)
        data[-1, 0] = 57.26   # south-west cell (row 0 is the northern edge)
        data[-1, 1] = 39.9    # under 40 dB: not mapped
        east, north = 400_000, 300_000
        got = en.sample(data, east, north + en.TILE, np.array([east + 5.0, east + 15.0, east + 25.0, east - 5.0]),
                        np.array([north + 5.0, north + 5.0, north + 5.0, north + 5.0]))
        self.assertEqual(got.tolist(), [573, 0, 0, 0])  # the last point is off the grid

    def test_sample_places_a_clipped_edge_tile_by_its_own_origin(self):
        data = np.full((3, 4), 60.0, dtype=np.float32)   # a 40 m x 30 m piece, west 1000, top 2030
        got = en.sample(data, 1000.0, 2030.0, np.array([1005.0, 1045.0, 1005.0]), np.array([2025.0, 2025.0, 1995.0]))
        self.assertEqual(got.tolist(), [600, 0, 0])

    def test_area_rows_match_rebuild_area_noise_rules(self):
        lookup = coverage.lsoa_lookup()
        code = sorted(lookup)[0]
        msoa, lad = lookup[code]
        lsoa = np.zeros(4, dtype=np.int64)
        road = np.array([56.0, 66.0, np.nan, 50.0])
        rail = np.array([np.nan, np.nan, 58.0, np.nan])
        rows = en.area_rows([code], lsoa, road, rail)
        dwellings, road55, rail55, any55, any65, median, mapped = rows[code]
        self.assertEqual((dwellings, road55, rail55, any55, any65), (4, 0.5, 0.25, 0.75, 0.25))
        self.assertEqual(mapped, 0.75)
        self.assertAlmostEqual(median, 56.0)  # percentile_cont over mapped road levels 50, 56, 66
        self.assertEqual(rows[msoa], rows[code])
        self.assertEqual(rows[lad], rows[code])

    def test_noise_layer_ranks_within_the_region(self):
        rows = {"a": (100, 0.1), "b": (100, 0.2), "c": (100, 0.9), "d": (100, 0.5)}
        regions = {"a": "R1", "b": "R1", "c": "R2", "d": "R2"}
        pct = {row[0]: row[4] for row in nl.aggregate(rows, regions=regions)}
        self.assertEqual(pct, {"a": 0, "b": 100, "c": 100, "d": 0})
        together = {row[0]: row[4] for row in nl.aggregate(rows)}
        self.assertEqual(together["c"], 100)
        self.assertEqual(together["b"], 33)


class AirTests(unittest.TestCase):
    def test_read_grid_keys_cells_by_their_south_west_corner(self):
        lines = ["Annual mean NO2 2022\n", "gridcode,x,y,no22022\n"]
        lines += [f"{i},{500 + 1000 * (i % 400)},{500 + 1000 * (i // 400)},{'MISSING' if i == 1 else i / 10}\n"
                  for i in range(100_001)]
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "map.csv")
            with open(path, "w") as handle:
                handle.writelines(lines)
            grid = england_air.read_grid(path)
        self.assertEqual(grid[(0, 0)], 0.0)
        self.assertNotIn((1000, 0), grid)  # MISSING
        self.assertEqual(grid[(2000, 0)], 0.2)
        got = england_air.sample(grid, np.array([2999.0, 50.0]), np.array([10.0, 10.0]))
        self.assertEqual(got.tolist(), [0.2, 0.0])

    def test_layer_values_rank_within_the_region_and_suppress_few_homes(self):
        means = {"x": (50, [20.0, 9.0]), "y": (50, [10.0, 7.0]), "z": (5, [30.0, 9.0])}
        rows = {r[0]: r for r in england_air.layer_values(means, {"x": "R", "y": "R", "z": "R"})}
        self.assertEqual(rows["x"][3], 100)
        self.assertEqual(rows["y"][3], 0)
        self.assertEqual(rows["z"][5], "suppressed")
        self.assertEqual(rows["x"][1], f"{england_air.YEAR}-12-01")


class Stats19Tests(unittest.TestCase):
    def test_coverage_keeps_english_districts_including_merged_ones(self):
        self.assertTrue(etl_kids.in_scope("E09000033", coverage.LONDON))
        self.assertFalse(etl_kids.in_scope("E08000035", coverage.LONDON))
        self.assertTrue(etl_kids.in_scope("E08000035", coverage.ENGLAND))
        self.assertTrue(etl_kids.in_scope("E07000026", coverage.ENGLAND))  # Allerdale, merged into Cumberland in 2023
        self.assertFalse(etl_kids.in_scope("W06000015", coverage.ENGLAND))
        self.assertFalse(etl_kids.in_scope("S12000036", coverage.ENGLAND))

    def test_collision_rates_rank_within_the_region(self):
        rates = etl_kids.collision_rates({"a": 1, "b": 5, "c": 10, "d": 1}, {"a": 1000, "b": 1000, "c": 1000, "d": 1000},
                                         1, {"a": "R1", "b": "R1", "c": "R2", "d": "R2"})
        self.assertEqual({k: v[1] for k, v in rates.items()}, {"a": 0, "b": 100, "c": 100, "d": 0})


if __name__ == "__main__":
    unittest.main()
