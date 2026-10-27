"""Health layers (migration 061, etl_health.py): parsing, sampling and the rebuild's shape."""
import datetime
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import etl_health  # noqa: E402

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "061-area-health.sql").read_text()


class SchemaTests(unittest.TestCase):
    def test_rebuild_covers_every_level_and_ranks_within_a_kind(self):
        self.assertIn("UNION ALL SELECT msoa", MIGRATION)
        self.assertIn("UNION ALL SELECT borough", MIGRATION)
        self.assertIn("PARTITION BY kind", MIGRATION)
        self.assertIn("ST_DWithin(p.location::geography, c.point::geography, 1000)", MIGRATION)

    def test_ratio_ignores_practices_without_a_workforce_return(self):
        self.assertEqual(MIGRATION.count("FILTER (WHERE p.gp_fte > 0) / nullif(sum(p.gp_fte), 0)"), 2)


class MemberTests(unittest.TestCase):
    def test_pick_member_tells_no2_from_nox_and_prefers_the_year(self):
        names = ["LAEI2022_V1_NOx.csv", "LAEI2022_V1_NO2.csv", "LAEI2030_V1_NO2.csv", "LAEI2022_V1_PM25.csv", "read.me"]
        self.assertEqual(etl_health.pick_member(names, r"(?<![a-z])no2(?![a-z0-9])", "2022"), "LAEI2022_V1_NO2.csv")
        self.assertEqual(etl_health.pick_member(names, r"pm2\.?5", "2022"), "LAEI2022_V1_PM25.csv")
        with self.assertRaises(SystemExit):
            etl_health.pick_member(names, r"pm10")


class GridTests(unittest.TestCase):
    def setUp(self):
        try:
            import numpy  # noqa: F401
        except ImportError:
            self.skipTest("numpy not installed")

    def test_point_grid_samples_the_nearest_centre(self):
        grid = etl_health.read_point_grid([{"x": "500010", "y": "180010", "conc": "30.5"},
                                           {"x": "500030", "y": "180010", "conc": "40"},
                                           {"x": "500010", "y": "180030", "conc": "bad"}])
        self.assertEqual(grid.sample(500012, 180004), 30.5)
        self.assertEqual(grid.sample(500035, 180015), 40.0)
        self.assertIsNone(grid.sample(500010, 180030))  # unparsed cell
        self.assertIsNone(grid.sample(400000, 180010))  # outside

    def test_lsoa_means_skip_homes_off_the_grid(self):
        no2 = {(1, 1): 20.0, (2, 2): 30.0, (3, 3): 40.0}.get
        pm = {(1, 1): 10.0}.get
        means = etl_health.lsoa_means([("a", 1, 1), ("a", 2, 2), ("b", 3, 3), ("c", 9, 9)],
                                      lambda e, n: no2((e, n)), lambda e, n: pm((e, n)))
        self.assertEqual(means, {"a": (2, [25.0, 10.0]), "b": (1, [40.0, None])})


class PracticeTests(unittest.TestCase):
    def test_practices_join_workforce_and_london_postcodes(self):
        patients = [
            {"EXTRACT_DATE": "01OCT2026", "TYPE": "GP", "CODE": "F83001", "POSTCODE": "N1  1AA", "SEX": "ALL",
             "AGE": "ALL", "NUMBER_OF_PATIENTS": "12,400"},
            {"EXTRACT_DATE": "01OCT2026", "TYPE": "GP", "CODE": "F83002", "POSTCODE": "N11AB", "SEX": "ALL",
             "AGE": "ALL", "NUMBER_OF_PATIENTS": "5000"},
            {"EXTRACT_DATE": "01OCT2026", "TYPE": "GP", "CODE": "B82001", "POSTCODE": "LS1 1AA", "SEX": "ALL",
             "AGE": "ALL", "NUMBER_OF_PATIENTS": "9000"},
            {"EXTRACT_DATE": "01OCT2026", "TYPE": "ICB", "CODE": "QMJ", "POSTCODE": "N1 1AA", "SEX": "ALL",
             "AGE": "ALL", "NUMBER_OF_PATIENTS": "1"},
        ]
        workforce = [{"PRAC_CODE": "F83001", "TOTAL_GP_EXTGL_FTE": "6.2"}, {"PRAC_CODE": "F83002", "TOTAL_GP_EXTGL_FTE": "NA"}]
        grid = {"N1 1AA": (531000.0, 184000.0), "N1 1AB": (531100.0, 184100.0)}
        rows, month = etl_health.practice_rows(patients, workforce, grid)
        self.assertEqual(month, datetime.date(2026, 10, 1))
        self.assertEqual(rows, [("F83001", "N1 1AA", 531000.0, 184000.0, 12400, 6.2),
                                ("F83002", "N1 1AB", 531100.0, 184100.0, 5000, None)])

    def test_onspd_grid_keeps_wanted_postcodes_in_the_coverage(self):
        import area_coverage as coverage

        def row(postcode, region, east, north, terminated="", grid="1"):
            return {"pcds": postcode, "rgn26cd": region, "east1m": east, "north1m": north, "doterm": terminated,
                    "gridind": grid}

        rows = [row("LS1 1AA", "E12000003", "430000", "433000"),
                row("N1 1AA", "E12000007", "531000", "184000", terminated="202001"),
                row("N1 1AA", "E12000007", "531001", "184001"),
                row("CF1 1AA", "W99999999", "318000", "176000"),
                row("N1 9ZZ", "E12000007", "", ""),
                row("N1 1AB", "E12000007", "531100", "184100", grid="9")]
        wanted = {"LS1 1AA", "N1 1AA", "CF1 1AA", "N1 9ZZ", "N1 1AB"}
        self.assertEqual(etl_health.onspd_grid(rows, wanted, coverage.ENGLAND),
                         {"LS1 1AA": (430000.0, 433000.0), "N1 1AA": (531001.0, 184001.0)})
        self.assertEqual(etl_health.onspd_grid(rows, wanted, coverage.LONDON), {"N1 1AA": (531001.0, 184001.0)})

    def test_months_and_postcodes(self):
        self.assertEqual(etl_health.parse_month("2026-10-01"), datetime.date(2026, 10, 1))
        self.assertIsNone(etl_health.parse_month("soon"))
        self.assertEqual(etl_health.normalise_postcode(" sw1a2aa "), "SW1A 2AA")



class No2RoundingTests(unittest.TestCase):
    """Issue #159: the overview and the air-no2 layer round the same raw LAEI mean once."""

    def test_air_table_rows_store_the_unrounded_mean(self):
        rows = etl_health.air_table_rows({"uk:lsoa:E01003984": (259, [24.152, 9.74])})
        self.assertEqual(rows, [("uk:lsoa:E01003984", 259, 24.152, 9.74,
                                 etl_health.AIR_YEAR, etl_health.AIR_SOURCE_ID)])

    def test_layer_rounds_the_raw_mean_once(self):
        for raw, expected in ((24.15, 24.1), (24.152, 24.2), (24.1549, 24.2), (24.149, 24.1)):
            with self.subTest(raw=raw):
                [row] = etl_health.air_layer_values({"uk:lsoa:E01003984": (259, [raw, 9.7])})
                self.assertEqual(row[2], expected)

    def test_rebuild_does_not_round_no2_or_pm25(self):
        migration = (Path(__file__).resolve().parents[1] / "migrations"
                     / "091-air-single-rounding.sql").read_text()
        self.assertNotIn("round(no2, 2)", migration)
        self.assertNotIn("round(pm25, 2)", migration)


class GeoRasterCrsTests(unittest.TestCase):
    """GLA's heat map is ETRS89-LAEA (EPSG:3035) as a user-defined projection; homes must be read in it."""

    def write(self, geokeys, params=None):
        import tempfile
        try:
            import numpy as np
            import tifffile
        except ImportError:
            self.skipTest("numpy/tifffile not installed")
        path = tempfile.NamedTemporaryFile(suffix=".tif", delete=False).name
        extratags = [(33550, "d", 3, (250.0, 250.0, 0.0), False), (33922, "d", 6, (0.0, 0.0, 0.0, 3575304.0, 3249120.0, 0.0), False),
                     (34735, "H", len(geokeys), geokeys, False)]
        if params:
            extratags.append((34736, "d", len(params), params, False))
        tifffile.imwrite(path, np.full((2, 2), 16.0, dtype=np.float32), extratags=extratags)
        return path

    def test_user_defined_laea_reads_as_3035(self):
        keys = (1, 1, 0, 3, 1024, 0, 1, 1, 3074, 0, 1, 32767, 3075, 0, 1, 10)
        raster = etl_health.GeoRaster(self.write(keys, (4321000.0, 3210000.0, 10.0, 52.0)))
        self.assertEqual(raster.srid, 3035)
        self.assertEqual(raster.sample(3575304.0 + 10, 3249120.0 - 10), 16.0)

    def test_british_national_grid_stays_27700(self):
        keys = (1, 1, 0, 2, 1024, 0, 1, 1, 3072, 0, 1, 27700)
        self.assertEqual(etl_health.GeoRaster(self.write(keys)).srid, 27700)

    def test_other_projections_are_refused(self):
        keys = (1, 1, 0, 2, 1024, 0, 1, 1, 3072, 0, 1, 32630)
        with self.assertRaises(SystemExit):
            etl_health.GeoRaster(self.write(keys))


if __name__ == "__main__":
    unittest.main()
