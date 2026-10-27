"""CLOSE_KNIT_AIR_QUALITY (default off): the GLA LAEI air figures wait on the GLA's licence reply, so the
Health air block, the Air tile and the `air-no2` layer are left out until the flag is on (FLAGS.md)."""
import os
import unittest
from unittest import mock

from area_api import evidence, feature_flags, health, repository, standouts

ON = {"CLOSE_KNIT_AIR_QUALITY": "1"}
OFF = {"CLOSE_KNIT_AIR_QUALITY": ""}
HEALTH_ROW = {"geography_id": "uk:lsoa:E01002718", "no2": 31.24, "pm25": 10.61, "air_year": 2022, "air_pct": 72.5,
              "no2_pct": 75.0, "pm25_pct": 66.0, "heat": None, "gp_practices": None,
              "air_release_id": "src-laei", "heat_release_id": None, "gp_release_id": None}


def _definition(metric_id):
    return {"id": metric_id, "carrier": "lsoa", "unit": "%", "direction": "higher-is-more", "source_release_id": "src",
            "definition": {"label": metric_id, "shortLabel": metric_id, "description": "d", "legend": [],
                           "sourceId": "s", "sourceName": "S", "methodologyPath": "/guide/x"},
            "source_url": "https://example.org", "checksum": "0" * 64, "licence": "OGL-3.0", "attribution": "a",
            "transformation_version": "t", "periods": ["2022-12"]}


class Connection:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        marker = sql.lstrip().split("\n", 1)[0]
        if marker == "-- evidence:active-release":
            return [{"release_id": "rel-1"}]
        if marker == "-- evidence:metrics":
            return [_definition("noise"), _definition("air-no2"), _definition("mobile-4g-indoor")]
        if marker == "-- evidence:metric":
            return [_definition(params[0])]
        raise AssertionError(marker)


class AirQualityFlagTests(unittest.TestCase):
    def test_off_by_default(self):
        with mock.patch.dict(os.environ, OFF):
            self.assertFalse(feature_flags.air_quality())
            self.assertEqual(feature_flags.hidden_metrics(), {"air-no2"})
        with mock.patch.dict(os.environ, ON):
            self.assertTrue(feature_flags.air_quality())
            self.assertEqual(feature_flags.hidden_metrics(), frozenset())

    def test_health_air_block(self):
        with mock.patch.dict(os.environ, OFF):
            value = health.health_value(HEALTH_ROW)
            self.assertIsNone(value["air"])
            self.assertFalse(any("NO₂" in note for note in value["notes"]))
        with mock.patch.dict(os.environ, ON):
            self.assertEqual(health.health_value(HEALTH_ROW)["air"]["no2"], 31.2)

    def test_defra_background_air_outside_london_is_not_gated(self):
        """Outside London the air figures are Defra's 1 km PCM map (OGL v3): shown with the flag off too,
        marked coarse (gridMetres 1000), and its source listed."""
        row = {**HEALTH_ROW, "geography_id": "uk:lsoa:E01011229", "air_release_id": "src-defra-pcm-2022-england"}

        class Loaded:
            def execute(self, sql, params=()):
                return [row]

        with mock.patch.dict(os.environ, OFF):
            air = health.health_value(row)["air"]
            self.assertEqual((air["no2"], air["gridMetres"]), (31.2, 1000))
            self.assertEqual(health.health_rows(Loaded(), [row["geography_id"]])[row["geography_id"]]["sourceVersions"],
                             ["src-defra-pcm-2022-england"])
        with mock.patch.dict(os.environ, ON):
            self.assertEqual(health.health_value(HEALTH_ROW)["air"]["gridMetres"], 20)

    def test_health_rows_drop_the_laei_source(self):
        class Loaded:
            def execute(self, sql, params=()):
                return [HEALTH_ROW]

        with mock.patch.dict(os.environ, OFF):
            self.assertEqual(health.health_rows(Loaded(), ["uk:lsoa:E01002718"])["uk:lsoa:E01002718"]["sourceVersions"], [])
        with mock.patch.dict(os.environ, ON):
            self.assertEqual(health.health_rows(Loaded(), ["uk:lsoa:E01002718"])["uk:lsoa:E01002718"]["sourceVersions"],
                             ["src-laei"])

    def test_air_tile_has_no_value(self):
        raw = {"health": {"no2": 31.2, "air_pct": 72.5, "gp_practices": None, "gp_nearest_m": None}}
        with mock.patch.dict(os.environ, OFF):
            tiles = {tile["id"]: tile for tile in standouts.build_tiles(raw)}
            self.assertEqual(len(tiles), 12)
            self.assertFalse(tiles["air"]["available"])
        with mock.patch.dict(os.environ, ON):
            self.assertTrue({tile["id"]: tile for tile in standouts.build_tiles(raw)}["air"]["available"])

    def test_layer_left_out_of_metrics_and_refused(self):
        with mock.patch.dict(os.environ, OFF):
            reader = evidence.EvidenceReader(connect=Connection)
            self.assertEqual([m["id"] for m in reader.list_metrics()["metrics"]], ["noise", "mobile-4g-indoor"])
            with self.assertRaises(evidence.MetricNotFound):
                evidence._pinned_metric(Connection(), "air-no2")
            self.assertEqual(repository.range_rows(Connection(), [{"layer": "air-no2"}]), [])
        with mock.patch.dict(os.environ, ON):
            reader = evidence.EvidenceReader(connect=Connection)
            self.assertIn("air-no2", [m["id"] for m in reader.list_metrics()["metrics"]])
            self.assertEqual(evidence._pinned_metric(Connection(), "air-no2")["id"], "air-no2")


if __name__ == "__main__":
    unittest.main()
