"""Future transport: the curated scheme list parses and validates, and the nearest new station per
area rolls up from LSOAs to MSOAs and boroughs so the levels agree."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import etl_future_transport as ft  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "future_transport" / "schemes.yaml"
MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "088-future-transport.sql").read_text()


class ParseTests(unittest.TestCase):
    def test_yaml_subset_reads_lists_of_mappings_scalars_and_comments(self):
        doc = ft.parse_yaml(FIXTURE.read_text())
        first, second = doc["schemes"]
        self.assertEqual(first["scheme"], "HS2: Old Oak Common")
        self.assertIsNone(first["expected_year"])
        self.assertEqual(second["expected_year"], 2040)
        self.assertEqual(second["stations"][1], {"name": "Old Kent Road 2", "lat": 51.4815, "lon": -0.0595,
                                                 "placed": "official route map"})

    def test_stations_flatten_schemes_with_stable_ids(self):
        stations = ft.stations(ft.parse_yaml(FIXTURE.read_text()))
        self.assertEqual([s.id for s in stations], ["old-oak/old-oak-common", "blx/old-kent-road-1", "blx/old-kent-road-2"])
        self.assertEqual(stations[1].status, "proposed")
        self.assertEqual(stations[1].scheme, "Bakerloo line extension")
        self.assertFalse(stations[1].counted)
        self.assertTrue(stations[0].counted)

    def test_bad_entries_are_refused(self):
        good = ft.parse_yaml(FIXTURE.read_text())
        cases = {
            "status": ("status", "coming soon"),
            "host": ("source_url", "https://www.example.com/blx"),
            "http": ("source_url", "http://tfl.gov.uk/blx"),
            "mode": ("mode", "hovercraft"),
            "year": ("expected_year", 1990),
        }
        for name, (key, value) in cases.items():
            doc = ft.parse_yaml(FIXTURE.read_text())
            doc["schemes"][1][key] = value
            with self.subTest(name), self.assertRaises(ValueError):
                ft.stations(doc)
        outside = ft.parse_yaml(FIXTURE.read_text())
        outside["schemes"][0]["stations"][0]["lat"] = 52.2
        with self.assertRaises(ValueError):
            ft.stations(outside)
        twice = ft.parse_yaml(FIXTURE.read_text())
        twice["schemes"][1]["stations"].append(dict(twice["schemes"][1]["stations"][0]))
        with self.assertRaises(ValueError):
            ft.stations(twice)
        self.assertEqual(len(ft.stations(good)), 3)


class CuratedFileTests(unittest.TestCase):
    def test_the_curated_list_is_valid_and_official(self):
        stations = ft.stations(ft.parse_yaml(ft.SCHEMES.read_text()))
        self.assertGreaterEqual(len(stations), 5)
        self.assertTrue(any(s.counted for s in stations), "the layer needs a station under construction or consented")
        for station in stations:
            self.assertIn(station.status, ft.STATUSES)
            self.assertTrue(ft.official(station.source_url), station.source_url)


class AggregateTests(unittest.TestCase):
    # Three LSOAs in two MSOAs of one borough, on the British National Grid (metres).
    POINTS = {"uk:lsoa:E01000001": (500_000, 180_000), "uk:lsoa:E01000002": (501_000, 180_000),
              "uk:lsoa:E01000003": (504_000, 180_000)}
    HOMES = {"uk:lsoa:E01000001": 600, "uk:lsoa:E01000002": 200, "uk:lsoa:E01000003": 400}
    PARENTS = {"uk:lsoa:E01000001": "uk:msoa:E02000001", "uk:lsoa:E01000002": "uk:msoa:E02000001",
               "uk:lsoa:E01000003": "uk:msoa:E02000002", "uk:msoa:E02000001": "uk:lad:E09000001",
               "uk:msoa:E02000002": "uk:lad:E09000001"}

    def setUp(self):
        stations = ft.stations(ft.parse_yaml(FIXTURE.read_text()))
        # Old Oak Common (counted) 3 km west of the first LSOA; a proposed station right beside the third.
        self.placed = [(stations[0], 497_000, 180_000), (stations[1], 504_300, 180_400)]

    def test_nearest_station_of_any_status_per_area_msoa_is_the_closest_of_its_lsoas(self):
        areas, _ = ft.aggregate(self.POINTS, self.HOMES, self.PARENTS, self.placed)
        by_id = {row[0]: row for row in areas}
        self.assertEqual(by_id["uk:lsoa:E01000001"], ["uk:lsoa:E01000001", "old-oak/old-oak-common", 3000,
                                                      "under construction", None])
        self.assertEqual(by_id["uk:lsoa:E01000003"][1:4], ["blx/old-kent-road-1", 500, "proposed"])
        self.assertEqual(by_id["uk:msoa:E02000001"][1:3], ["old-oak/old-oak-common", 3000])
        self.assertEqual(by_id["uk:lad:E09000001"][1:3], ["blx/old-kent-road-1", 500])

    def test_metric_counts_only_built_or_consented_and_rolls_up_by_homes(self):
        _, values = ft.aggregate(self.POINTS, self.HOMES, self.PARENTS, self.placed)
        by_id = {row[0]: row for row in values}
        self.assertEqual(by_id["uk:lsoa:E01000003"][3], 7.0)   # Old Oak, not the proposed station beside it
        self.assertEqual(by_id["uk:lsoa:E01000001"][1:3], [ft.METRIC_ID, ft.PERIOD])
        # MSOA: (3 km × 600 + 4 km × 200) / 800 homes; borough: every LSOA's homes.
        self.assertEqual(by_id["uk:msoa:E02000001"][3], 3.25)
        self.assertEqual(by_id["uk:lad:E09000001"][3], round((3 * 600 + 4 * 200 + 7 * 400) / 1200, 2))
        msoa_mean = (3.25 * 800 + 7.0 * 400) / 1200
        self.assertAlmostEqual(by_id["uk:lad:E09000001"][3], msoa_mean, places=2)
        self.assertEqual([by_id[g][4] for g in sorted(self.POINTS)], [0, 50, 100])  # closer = lower percentile
        self.assertEqual(by_id["uk:lsoa:E01000002"][5:], [200, "observed"])

    def test_no_counted_station_means_no_metric(self):
        _, values = ft.aggregate(self.POINTS, self.HOMES, self.PARENTS, self.placed[1:])
        self.assertEqual(values, [])

    def test_definition_runs_close_green_to_far_red_in_km(self):
        definition = ft.definition()
        legend = definition["legend"]
        self.assertEqual([stop["value"] for stop in legend], sorted(stop["value"] for stop in legend))
        self.assertEqual(legend[0]["colour"], "#3a7d44")
        self.assertIn("proposed", " ".join(definition["caveats"]).lower())


class MigrationTests(unittest.TestCase):
    def test_tables_and_status_check(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS future_transport", MIGRATION)
        self.assertIn("CREATE TABLE IF NOT EXISTS area_future_transport", MIGRATION)
        for status in ft.STATUSES:
            self.assertIn(f"'{status}'", MIGRATION)


if __name__ == "__main__":
    unittest.main()
