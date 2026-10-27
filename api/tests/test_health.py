"""Health layers (migration 061): air pollution, summer heat and GP access with their card notes."""
import datetime
import os
import unittest
from unittest import mock

from area_api import health, regions

# The air figures are behind CLOSE_KNIT_AIR_QUALITY (test_air_quality_flag.py covers it off).
_AIR_ON = mock.patch.dict(os.environ, {"CLOSE_KNIT_AIR_QUALITY": "1"})


def setUpModule():
    _AIR_ON.start()


def tearDownModule():
    _AIR_ON.stop()


def _row(**extra):
    return {"geography_id": "uk:lsoa:E01002718", "no2": 31.24, "pm25": 10.61, "air_year": 2019,
            "air_pct": 72.5, "no2_pct": 75.0, "pm25_pct": 66.0, "heat": 32.1, "heat_unit": "°C", "heat_year": 2018,
            "heat_pct": 85.0, "gp_patients_per_fte": 2140.6, "gp_practices": 3, "gp_nearest_m": 312.0,
            "gp_month": datetime.date(2026, 9, 1), "gp_pct": 64.0,
            "air_release_id": "src-laei", "heat_release_id": "src-heat", "gp_release_id": "src-gp", **extra}


class HealthValueTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {"CLOSE_KNIT_AIR_QUALITY": "1"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_value_and_notes(self):
        value = health.health_value(_row())
        self.assertEqual(value["air"], {"no2": 31.2, "pm25": 10.6, "year": 2019, "gridMetres": 20, "regionPercentile": 72.5,
                                        "no2Percentile": 75.0, "pm25Percentile": 66.0})
        self.assertEqual(value["gp"]["patientsPerGp"], 2141)
        self.assertEqual(value["gp"]["nearestMetres"], 310)
        self.assertEqual(value["gp"]["month"], "2026-09-01")
        self.assertEqual(value["notes"], [
            "NO₂ 31.2 µg/m³, PM2.5 10.6 µg/m³: within UK limits, above WHO guidelines (10 and 5)",
            "One of London's warmer areas on summer nights",
            "2,141 patients per GP at the 3 practices within 1 km",
        ])

    def test_limits_cool_and_no_practice(self):
        value = health.health_value(_row(no2=44.0, pm25=21.0, heat_pct=10.0, gp_practices=0,
                                         gp_patients_per_fte=None, gp_nearest_m=None))
        self.assertEqual(value["notes"], [
            "NO₂ 44 µg/m³, PM2.5 21 µg/m³: above the UK legal limit for NO₂ and PM2.5",
            "One of London's cooler areas on summer nights",
            "No GP surgery within 1 km",
        ])
        self.assertIsNone(value["gp"]["patientsPerGp"])

    def test_wider_areas_count_practices_inside(self):
        value = health.health_value(_row(geography_id="uk:msoa:E02000554", gp_nearest_m=None, gp_practices=41))
        self.assertEqual(value["notes"][-1], "2,141 patients per GP at the 41 practices in the area")

    def test_unloaded_parts_are_none(self):
        value = health.health_value(_row(no2=None, heat=None, gp_practices=None))
        self.assertEqual((value["air"], value["heat"], value["gp"], value["notes"]), (None, None, None, []))


class No2SingleRoundingTests(unittest.TestCase):
    """Issue #159: the overview rounds the stored (unrounded) mean once, exactly like the
    air-no2 layer rounds the raw mean: round(x, 1) on the same value, never a double rounding."""

    def test_overview_matches_the_layer_for_each_raw_mean(self):
        for raw, expected in ((24.15, 24.1), (24.152, 24.2), (24.1549, 24.2), (24.149, 24.1)):
            with self.subTest(raw=raw):
                # etl_health.air_table_rows stores the unrounded dwelling mean.
                value = health.health_value(_row(no2=raw, pm25=9.74))
                self.assertEqual(value["air"]["no2"], expected)
                self.assertEqual(value["air"]["no2"], round(raw, 1))
                self.assertEqual(value["air"]["pm25"], 9.7)
                self.assertIn(f"NO₂ {expected} µg/m³", value["notes"][0])


class No2SingleRoundingTests(unittest.TestCase):
    """Issue #159: the overview rounds the stored (unrounded) mean once, exactly like the
    air-no2 layer rounds the raw mean: round(x, 1) on the same value, never a double rounding."""

    def test_overview_matches_the_layer_for_each_raw_mean(self):
        for raw, expected in ((24.15, 24.1), (24.152, 24.2), (24.1549, 24.2), (24.149, 24.1)):
            with self.subTest(raw=raw):
                # etl_health.air_table_rows stores the unrounded dwelling mean.
                value = health.health_value(_row(no2=raw, pm25=9.74))
                self.assertEqual(value["air"]["no2"], expected)
                self.assertEqual(value["air"]["no2"], round(raw, 1))
                self.assertEqual(value["air"]["pm25"], 9.7)
                self.assertIn(f"NO₂ {expected} µg/m³", value["notes"][0])


class HealthRowsTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {"CLOSE_KNIT_AIR_QUALITY": "1"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_rows_are_empty_when_the_layers_are_not_loaded(self):
        class Missing:
            def execute(self, sql, params=()):
                raise RuntimeError("relation area_health does not exist")

        self.assertEqual(health.health_rows(Missing(), ["uk:lsoa:E01000001"]), {})

    def test_rows_carry_their_sources(self):
        class Loaded:
            def execute(self, sql, params=()):
                self.marker = sql.split("\n", 1)[0]
                if self.marker == "-- evidence:area-health":
                    return [_row(heat_release_id=None, heat=None)]
                raise AssertionError(self.marker)

        value = health.health_rows(Loaded(), ["uk:lsoa:E01002718"])["uk:lsoa:E01002718"]
        self.assertEqual(value["sourceVersions"], ["src-gp", "src-laei"])
        self.assertIsNone(value["heat"])

    def test_rows_notes_name_the_area_region(self):
        class Loaded:
            def execute(self, sql, params=()):
                return [_row(geography_id="uk:lsoa:E01005000")]

        regions.set_for_tests({"uk:lsoa:E01005000": "E12000002"})
        self.addCleanup(regions.set_for_tests, {})
        notes = health.health_rows(Loaded(), ["uk:lsoa:E01005000"])["uk:lsoa:E01005000"]["notes"]
        self.assertIn("One of North West's warmer areas on summer nights", notes)

    def test_every_statement_has_a_marker(self):
        for sql in (health.AREA_HEALTH_SQL, health.SOURCES_SQL):
            self.assertTrue(sql.startswith("-- evidence:"))


class LaeiFlagTests(unittest.TestCase):
    """The air figures come from the LAEI grid, so they wait for CLOSE_KNIT_AIR_QUALITY."""

    def setUp(self):
        patcher = mock.patch.dict(os.environ)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("CLOSE_KNIT_AIR_QUALITY", None)

    def test_air_is_null_and_unnoted_while_the_flag_is_off(self):
        value = health.health_value(_row())
        self.assertIsNone(value["air"])
        self.assertEqual(value["gp"]["practices"], 3)
        self.assertEqual(value["heat"]["value"], 32.1)
        self.assertFalse([note for note in value["notes"] if "NO₂" in note])

    def test_rows_leave_the_air_source_out_while_the_flag_is_off(self):
        class Loaded:
            def execute(self, sql, params=()):
                return [_row()]

        value = health.health_rows(Loaded(), ["uk:lsoa:E01002718"])["uk:lsoa:E01002718"]
        self.assertEqual(value["sourceVersions"], ["src-gp", "src-heat"])

    def _payload(self):
        class Reader:
            def _connect(self):
                return Connection()

        class Connection:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql, params=()):
                marker = sql.split("\n", 1)[0]
                if "active_product_release" in sql:
                    return [{"release_id": "rel-test"}]
                if marker == "-- evidence:area-exists":
                    return [{"?column?": 1}]
                if marker == "-- evidence:area-health":
                    return [_row()]
                if marker == "-- evidence:area-health-sources":
                    return [{"id": i, "source_url": "u", "licence": "l", "attribution": "a"} for i in params[0]]
                raise AssertionError(marker)

        return health.area_health(Reader(), "uk:lsoa:E01002718")

    def test_endpoint_withholds_laei_air_while_off(self):
        payload = self._payload()
        self.assertEqual(payload["withheld"], ["laeiAir"])
        self.assertIsNone(payload["air"])
        self.assertNotIn("src-laei", [source["release"] for source in payload["sources"]])
        self.assertNotIn(health.AIR_CAVEAT, payload["caveats"])

    def test_endpoint_serves_air_when_on(self):
        os.environ["CLOSE_KNIT_AIR_QUALITY"] = "1"
        payload = self._payload()
        self.assertEqual(payload["withheld"], [])
        self.assertEqual(payload["air"]["no2"], 31.2)
        self.assertIn("src-laei", [source["release"] for source in payload["sources"]])
        self.assertIn(health.AIR_CAVEAT, payload["caveats"])


if __name__ == "__main__":
    unittest.main()
