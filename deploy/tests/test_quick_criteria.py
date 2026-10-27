"""Quick criteria ETL (migration 028): visible disorder, step-free stations, Progress 8, EPC A-C."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import crime_rates  # noqa: E402
import etl_quick_criteria  # noqa: E402
import etl_schools  # noqa: E402

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "028-quick-criteria.sql").read_text()


def _cell(n, asb, **cats):
    return {"n": n, "asb": asb, "cats": {"Criminal damage and arson": cats.get("damage", 0),
                                         "Public order": cats.get("order", 0), "Burglary": cats.get("burglary", 0)}}


class DisorderTests(unittest.TestCase):
    def test_disorder_counts_asb_damage_and_public_order_only(self):
        self.assertEqual(crime_rates.disorder_count({"asb": 4, "cats": {"Criminal damage and arson": 2,
                                                                         "Public order": 1, "Burglary": 9}}), 7)

    def test_rates_per_thousand_ascending_percentiles_and_snap_gap_fallback(self):
        months = crime_rates.month_list("2026-08", 12)
        monthly = {month: {} for month in months}
        monthly["2026-08"] = {"E1": _cell(50, 10, damage=5, order=5),  # 20 in 1,000 residents
                              "E2": _cell(50, 2, damage=1, order=1),   # 4 in 1,000 residents
                              "E3": _cell(0, 0)}                       # crimes snapped to neighbours
        lsoas = {"uk:lsoa:E1": ("E1", "m"), "uk:lsoa:E2": ("E2", "m"), "uk:lsoa:E3": ("E3", "m")}
        population = {"E1": 1000, "E2": 1000, "E3": 1000}
        rows = {row[0]: row for row in crime_rates.disorder_utilities(lsoas, monthly, population, "2026-08")}
        self.assertEqual(rows["uk:lsoa:E1"][1:7], ["disorder", "2026-08-01", 100, 20.0, "per 1,000", "uk:lsoa:E1"])
        self.assertEqual(rows["uk:lsoa:E2"][3:5], [0, 4.0])
        self.assertEqual(rows["uk:lsoa:E3"][4:], [8.0, "per 1,000", "m", "fallback"])  # the MSOA's 24 per 3,000

    def test_hotspot_lsoa_keeps_its_own_disorder_rate(self):
        """#204: disorder follows the same snap_gap ceiling, so it can't drift from crime.

        Westminster 013A has 433 own offences (23 public order + 4 criminal
        damage) and must keep its own disorder rate, not its MSOA's.
        """
        monthly = {month: {} for month in crime_rates.month_list("2026-08", 12)}
        monthly["2026-08"] = {
            "E01035716": _cell(10139, 0, order=238, damage=80),   # 013G
            "E01004763": _cell(6859, 0, order=214, damage=61),     # 013B
            "E01004765": _cell(2354, 0, order=79, damage=28),      # 013D
            "E01004715": _cell(433, 0, order=23, damage=4),        # 013A
        }
        lsoas = {f"uk:lsoa:{code}": (code, "uk:msoa:E02000972")
                 for code in ("E01035716", "E01004763", "E01004765", "E01004715")}
        population = {"E01035716": 2274, "E01004763": 2190, "E01004765": 1907, "E01004715": 1987}
        rows = {row[0]: row for row in crime_rates.disorder_utilities(lsoas, monthly, population,
                                                                       "2026-08")}
        row = rows["uk:lsoa:E01004715"]
        self.assertEqual(row[6:8], ["uk:lsoa:E01004715", "observed"])
        self.assertAlmostEqual(row[4], round(27 / 1987 * 1000, 2))  # its own 27 disorder offences


class StepFreeTests(unittest.TestCase):
    @staticmethod
    def point(naptan, stop_type, lift=None, station=None, children=()):
        props = [] if lift is None else [{"category": "Accessibility", "key": "AccessViaLift", "value": lift}]
        return {"naptanId": naptan, "stopType": stop_type, "stationNaptan": station,
                "additionalProperties": props, "children": list(children)}

    def test_own_flag_wins_else_any_entrance_with_a_lift(self):
        payload = {"stopPoints": [
            self.point("S1", "NaptanMetroStation", "No", children=[self.point("E1", "NaptanMetroEntrance", "Yes")]),
            self.point("S2", "NaptanMetroStation", children=[self.point("E2", "NaptanMetroEntrance", "Yes")]),
            self.point("E3", "NaptanMetroEntrance", "No", station="S3"),
            self.point("S4", "NaptanRailStation"),
        ]}
        flags = etl_quick_criteria.step_free_flags([payload])
        self.assertEqual(flags, {"S1": False, "S2": True, "S3": False})

    def test_station_flag_is_true_or_unknown_and_dlr_trams_are_step_free(self):
        flags = {"S1": False, "S2": True}
        self.assertTrue(etl_quick_criteria.station_flag(["S1", "S2"], flags, ["tube"]))
        self.assertIsNone(etl_quick_criteria.station_flag(["S1"], flags, ["tube"]))  # no lift is not "steps"
        self.assertTrue(etl_quick_criteria.station_flag([], flags, ["dlr"]))

    def test_crime_end_reads_the_window_from_the_release_id(self):
        self.assertEqual(etl_quick_criteria.crime_end("src-police-uk-crime-12m-2025-09-2026-08-r2"), "2026-08")
        with self.assertRaises(SystemExit):
            etl_quick_criteria.crime_end("src-other")


class Progress8Tests(unittest.TestCase):
    def test_latest_published_year_per_school(self):
        def row(urn, period, value, pupils="150", breakdown="Total"):
            return {"school_urn": urn, "time_period": period, "breakdown_topic": "Total", "breakdown": breakdown,
                    "progress8_average": value, "progress8_pupil_count": pupils}
        results = etl_schools.progress8_results([
            row("1", "202425", "z"), row("1", "202324", "0.42"), row("1", "202223", "0.1"),
            row("2", "202324", "c"), row("3", "202324", "-0.3", breakdown="Boys")])
        self.assertEqual(results, {"1": {"period": "202324", "value": 0.42, "cohort": 150, "year": "2023/24"}})

    def test_observation_replaces_any_earlier_one_and_explains_the_year(self):
        attributes = {"observations": [{"measure": "Attainment 8"}, {"measure": "Progress 8", "value": 0.1}],
                      "missingObservations": ["Progress 8 (not published for 2024/25)", "Other"]}
        updated = etl_schools.with_progress8(attributes, {"period": "202324", "value": 0.42, "cohort": 150, "year": "2023/24"})
        progress = [o for o in updated["observations"] if o["measure"] == "Progress 8"]
        self.assertEqual([(o["value"], o["academicYear"], o["cohortSize"]) for o in progress], [(0.42, "2023/24", 150)])
        self.assertEqual(updated["missingObservations"], ["Other", "Progress 8 for 2024/25 (not published; 2023/24 shown)"])
        self.assertEqual(etl_schools.with_progress8(attributes, None)["missingObservations"][-1],
                         "Progress 8 (not published for 2024/25)")


class MigrationTests(unittest.TestCase):
    def test_epc_share_needs_thirty_rated_homes_and_counts_a_to_c(self):
        self.assertIn("count(*) >= 30", MIGRATION)
        self.assertIn("IN ('A', 'B', 'C')", MIGRATION)
        self.assertIn("ADD COLUMN IF NOT EXISTS step_free boolean", MIGRATION)


if __name__ == "__main__":
    unittest.main()
