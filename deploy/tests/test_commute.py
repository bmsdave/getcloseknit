"""Commute routing release: matrix validation gates and itinerary legs from r5py output."""
import csv
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import commute_itineraries as ci  # noqa: E402
import etl_commute as ec  # noqa: E402

HUBS = [{"hub_id": "kings-cross"}, {"hub_id": "bank"}]
LSOAS = {"uk:lsoa:E01000001", "uk:lsoa:E01004447"}


def matrix(transit_kx=(12, 25)):
    rows = []
    for area, kx in zip(sorted(LSOAS), transit_kx):
        for hub in ("kings-cross", "bank"):
            for mode in ec.MODES:
                median = kx if (hub, mode) == ("kings-cross", "transit") else 30.0
                rows.append({"geography_id": area, "hub_id": hub, "mode": mode,
                             "travel_time_p10": median, "travel_time_p50": median, "travel_time_p90": median})
    return rows


class ValidateTests(unittest.TestCase):
    def test_complete_sane_matrix_passes(self):
        summary = ec.validate(matrix(), LSOAS, HUBS)
        self.assertEqual(summary["pairs"], 4)
        self.assertEqual(summary["transit_reachable_share"], 1.0)

    def test_missing_pair_blocks(self):
        with self.assertRaisesRegex(ValueError, "LSOA-hub pairs"):
            ec.validate(matrix()[1:], LSOAS, HUBS)

    def test_kings_cross_sanity_bounds_block(self):
        with self.assertRaisesRegex(ValueError, "sanity"):
            ec.validate(matrix(transit_kx=(12, 90)), LSOAS, HUBS)

    def test_unknown_hub_blocks(self):
        rows = matrix()
        rows[0]["hub_id"] = "atlantis"
        with self.assertRaisesRegex(ValueError, "unknown hub"):
            ec.validate(rows, LSOAS, HUBS)


class ItineraryTests(unittest.TestCase):
    def test_legs_named_from_gtfs_and_fastest_options_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            feed = Path(tmp) / "feed.zip"
            with zipfile.ZipFile(feed, "w") as archive:
                archive.writestr("routes.txt", "route_id,route_short_name\nvic,Victoria\n")
                archive.writestr("stops.txt", "stop_id,stop_name\nWWL,Walthamstow Central\nKSX,King's Cross St. Pancras\n")
            legs = Path(tmp) / "itineraries.csv"
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            writer.writerow(["from_id", "to_id", "option", "segment", "transport_mode", "travel_time", "wait_time",
                             "route_id", "start_stop_id", "end_stop_id"])
            for option, ride in ((0, "00:16:00"), (1, "00:25:00"), (2, "00:40:00")):
                writer.writerow(["uk:msoa:E02000895", "kings-cross", option, 0, "TransportMode.WALK", "0 days 00:06:00", "", "", "", ""])
                writer.writerow(["uk:msoa:E02000895", "kings-cross", option, 1, "TransportMode.SUBWAY", f"0 days {ride}",
                                 "0 days 00:02:00", "vic", "WWL", "KSX"])
            writer.writerow(["uk:msoa:E02000895", "kings-cross", 9, 0, "TransportMode.WALK", "0 days 01:30:00", "", "", "", ""])
            legs.write_text(buffer.getvalue())
            rows = ci.itinerary_rows(legs, "net-test", [feed])
        self.assertEqual([row[3] for row in rows], [1, 2])
        first = rows[0]
        self.assertEqual(first[4:7], [24, 0, 6])
        self.assertEqual(json.loads(first[7])[1], {"mode": "subway", "line": "Victoria", "from": "Walthamstow Central",
                                                   "to": "King's Cross St. Pancras", "minutes": 16, "waitMinutes": 2})


if __name__ == "__main__":
    unittest.main()


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "routing"))
import combine_matrix as cm  # noqa: E402


class CombineTests(unittest.TestCase):
    def test_views_combine_into_ranges(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "check").mkdir()
            (work / "check" / "cycle-observed.json").write_text(json.dumps({"osrm_vs_observed_median": 1.5, "speed_kmh_median_riders": 16}))
            header = "geography_id,hub_id,travel_time_p10,travel_time_p50,travel_time_p90,mode\n"
            (work / "matrix-full.csv").write_text(header + "a,kx,20,21,22,transit\na,kx,90,90,90,walk\na,kx,30,30,30,cycle\n")
            (work / "matrix-bike16-cycle.csv").write_text(header + "a,kx,25,25,25,cycle\n")
            (work / "osrm-matrix.csv").write_text("geography_id,hub_id,mode,minutes,km\na,kx,cycle,45,9\na,kx,car,20,10\n")
            (work / "lsoa-borough.csv").write_text("geography_id,borough_code\na,E09000001\n")
            (work / "hub-borough.csv").write_text("hub_id,borough_code\nkx,E09000007\n")
            original = cm.dft_speeds
            cm.dft_speeds = lambda ods: ({"E09000001": 10.0, "E09000007": 8.0}, 0.9)
            try:
                cm.main(work, Path("unused.ods"), work / "out.csv")
            finally:
                cm.dft_speeds = original
            rows = {row["mode"]: row for row in csv.DictReader(open(work / "out.csv"))}
        self.assertEqual(rows["transit"]["travel_time_p50"], "21")
        # OSRM 45 / 1.5 = 30 is the time; R5's 25 the other end of the range
        self.assertEqual([rows["cycle"][f"travel_time_{p}"] for p in ("p10", "p50", "p90")], ["25.0", "30.0", "30.0"])
        # 10 km: 5 km at 10 mph and 5 km at 8 mph, x 1.609 x 0.9 -> 20.7 + 25.9 = 46.6 min
        self.assertEqual((rows["car"]["travel_time_p10"], rows["car"]["travel_time_p50"]), ("20.0", "46.6"))

    def test_long_drives_keep_free_flow_in_the_middle(self):
        # 30 km in 30 min free-flow: 5 km at each end at 12.9 km/h-ish, 20 km at 60 km/h
        minutes = cm.morning_minutes(30, 30, 10.0, 8.0, 0.9)
        self.assertAlmostEqual(minutes, 20 + 5 / (10 * 1.609344 * 0.9) * 60 + 5 / (8 * 1.609344 * 0.9) * 60, places=6)
        self.assertEqual(cm.morning_minutes(30, 30, None, None, 0.9), 30)


class DistinctItineraryTests(unittest.TestCase):
    def test_the_next_train_is_not_an_alternative(self):
        def row(option, *lines):
            legs = [{"mode": "walk", "line": None}] + [{"mode": "subway", "line": line} for line in lines]
            return {"origin_geography_id": "m", "hub_id": "kx", "option": str(option), "legs": json.dumps(legs)}
        kept = ec.distinct_itineraries([row(1, "Victoria"), row(2, "Victoria"), row(3, "Overground", "Victoria")])
        self.assertEqual([(r["option"], r["_lines"]) for r in kept], [(1, ("Victoria",)), (2, ("Overground", "Victoria"))])
