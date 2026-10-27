"""School applications and offers (DfE, school level) into school_admission_demand."""
import csv
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import etl_school_demand as demand  # noqa: E402
import school_history_common as common  # noqa: E402
from unittest import mock  # noqa: E402


_PATCHER = None


def setUpModule():
    # England's LA codes come from a GIAS download; the fixtures are London's (no network in tests).
    global _PATCHER
    _PATCHER = mock.patch.object(common, "coverage_las", lambda: frozenset(common.LONDON_LAS))
    _PATCHER.start()


def tearDownModule():
    _PATCHER.stop()

MIGRATION = (ROOT / "migrations" / "048-school-history.sql").read_text()


def est(urn, la, estab, status="Open"):
    return {"URN": urn, "LA (code)": la, "EstablishmentNumber": estab, "EstablishmentName": urn,
            "EstablishmentStatus (name)": status}


def resolver():
    # 101912 current; 100001 converted to 140001; 100002 and 100003 merged into 150000; 100009 closed.
    return common.UrnResolver(
        {"101912", "140001", "150000"},
        [est("101912", "307", "2182"), est("140001", "307", "2100"), est("100001", "307", "2001", "Closed"),
         est("150000", "307", "2300"), est("100002", "307", "2002", "Closed"),
         est("100003", "307", "2003", "Closed"), est("100009", "307", "2009", "Closed")],
        [{"URN": "100001", "LinkURN": "140001", "LinkType": "Successor"},
         {"URN": "100002", "LinkURN": "150000", "LinkType": "Successor - merged"},
         {"URN": "100003", "LinkURN": "150000", "LinkType": "Successor - merged"}])


def row(urn, laestab, period="202627", phase="Primary", entry="R", la="307", first="109", any_="359",
        offers="90", first_offers="81"):
    return {"time_period": period, "old_la_code": la, "school_phase": phase, "entry_year": entry,
            "school_urn": urn, "school_laestab": laestab, "school_name": f"School {urn}", "la_name": "Ealing",
            "times_put_as_1st_preference": first, "times_put_as_any_preferred_school": any_,
            "total_number_places_offered": offers, "number_1st_preference_offers": first_offers,
            "times_put_as_2nd_preference": "60", "times_put_as_3rd_preference": "c",
            "number_preferred_offers": "88", "number_2nd_preference_offers": "5",
            "number_3rd_preference_offers": "2"}


class ParseTests(unittest.TestCase):
    def test_time_period_is_the_september_of_entry(self):
        self.assertEqual(demand.entry_year("202627"), 2026)
        self.assertEqual(demand.entry_year("201415"), 2014)
        self.assertEqual(demand.entry_year("199900"), 1999)
        for bad in ("2026", "202628", "2026/27"):
            with self.assertRaises(ValueError):
                demand.entry_year(bad)

    def test_counts_keep_missing_symbols_as_null_and_refuse_anything_else(self):
        self.assertEqual(demand.count(" 72 "), 72)
        self.assertEqual(demand.count("0"), 0)
        for symbol in ("", "c", "x", "z", "n/a"):
            self.assertIsNone(demand.count(symbol))
        with self.assertRaises(ValueError):
            demand.count("7.5")

    def test_dummy_laestab_marks_a_second_site(self):
        self.assertTrue(demand.site_row(row("n/a", "3019905")))
        self.assertFalse(demand.site_row(row("101912", "3072182")))


class BuildTests(unittest.TestCase):
    def build(self, rows):
        return demand.build(rows, resolver())

    def test_columns_map_to_demand_and_pan_is_not_in_the_file(self):
        records, skipped = self.build([row("101912", "3072182")])
        self.assertEqual(skipped, [])
        self.assertEqual(records, [{"urn": "101912", "entry_year": 2026, "entry_point": "reception",
                                    "first_preferences": 109, "any_preferences": 359, "offers": 90,
                                    "first_preference_offers": 81, "second_preferences": 60,
                                    "third_preferences": None, "preferred_offers": 88,
                                    "second_preference_offers": 5, "third_preference_offers": 2}])
        self.assertNotIn("pan", records[0])

    def test_only_london_reception_and_year7(self):
        records, skipped = self.build([
            row("101912", "3072182", la="330"),
            row("101912", "3072182", phase="Secondary", entry="7"),
            row("101912", "3072182", period="202526", phase="Secondary", entry="9")])
        self.assertEqual([(r["entry_year"], r["entry_point"]) for r in records], [(2026, "year7")])
        self.assertEqual([s["reason"] for s in skipped], ["entry point not loaded (year 9 or n/a)"])

    def test_england_coverage_keeps_every_english_la(self):
        with mock.patch.object(common, "coverage_las", lambda: frozenset(common.LONDON_LAS) | {330}):
            records, _ = self.build([row("101912", "3072182", la="330")])
        self.assertEqual([(r["entry_year"], r["entry_point"]) for r in records], [(2026, "reception")])

    def test_history_follows_the_school_to_its_current_urn(self):
        records, _ = self.build([row("100001", "3072001", period="201415"), row("140001", "3072100")])
        self.assertEqual([(r["urn"], r["entry_year"]) for r in records], [("140001", 2014), ("140001", 2026)])

    def test_laestab_is_used_only_when_the_urn_is_not_a_gias_school(self):
        records, skipped = self.build([row("n/a", "3072100"), row("100009", "3072100", period="202526")])
        self.assertEqual([r["urn"] for r in records], ["140001"])
        self.assertEqual(skipped[0]["reason"], "no current school for this URN/LAESTAB")

    def test_second_site_gives_way_to_the_schools_own_row(self):
        records, skipped = self.build([row("101912", "3072182"), row("101912", "3079905", first="5")])
        self.assertEqual([r["first_preferences"] for r in records], [109])
        self.assertEqual(skipped[0]["maps_to"], "101912")
        self.assertIn("second admission site", skipped[0]["reason"])

    def test_predecessor_row_gives_way_to_the_schools_own(self):
        records, skipped = self.build([row("100001", "3072001"), row("140001", "3072100", first="7")])
        self.assertEqual([(r["urn"], r["first_preferences"]) for r in records], [("140001", 7)])
        self.assertIn("predecessor", skipped[0]["reason"])

    def test_two_schools_that_merged_later_are_never_summed(self):
        records, skipped = self.build([row("100002", "3072002"), row("100003", "3072003")])
        self.assertEqual(records, [])
        self.assertEqual({s["reason"] for s in skipped}, {"several rows map to one school and year"})


class ReleaseTests(unittest.TestCase):
    def test_release_is_open_data_with_its_caveats(self):
        self.assertEqual(demand.LICENCE, "OGL-3.0")
        self.assertIn("Open Government Licence v3.0", demand.ATTRIBUTION)
        self.assertTrue(any("pan is null" in caveat for caveat in demand.CAVEATS))
        self.assertTrue(demand.RELEASE_ID.startswith("src-dfe-applications-offers-"))

    def test_demand_columns_exist_in_the_migration(self):
        body = MIGRATION.split("CREATE TABLE IF NOT EXISTS school_admission_demand (", 1)[1].split(");", 1)[0]
        for column in ("first_preferences", "any_preferences", "offers", "first_preference_offers", "pan"):
            self.assertIn(f"{column} integer", body)
        self.assertIn("entry_point IN ('reception', 'year7')", body)

    def test_preference_columns_exist_in_migration_055(self):
        body = (ROOT / "migrations" / "055-school-card-full.sql").read_text().split(
            "ALTER TABLE school_admission_demand", 1)[1]
        for column in demand.COUNTS.values():
            self.assertIn(column, MIGRATION + body)

    def test_no_product_release_is_staged(self):
        source = (ROOT / "tools" / "etl_school_demand.py").read_text()
        self.assertNotIn("stage_release", source)


@unittest.skipUnless(demand.existing(), "DfE applications file not downloaded")
class RealFileTests(unittest.TestCase):
    """Montpelier, North Ealing and Southfield (Ealing) as published, before URN mapping."""

    @classmethod
    def setUpClass(cls):
        cls.rows = {}
        with open(demand.existing(), newline="", encoding="utf-8-sig") as handle:
            for r in csv.DictReader(handle):
                if r["school_urn"] in ("101912", "101870", "101890"):
                    cls.rows[(r["school_urn"], demand.entry_year(r["time_period"]))] = r

    def value(self, urn, year, field):
        return demand.count(self.rows[(urn, year)][field])

    def test_montpelier_first_preferences(self):
        self.assertEqual([self.value("101912", y, "times_put_as_1st_preference") for y in range(2016, 2027)],
                         [176, 141, 149, 158, 141, 154, 147, 145, 131, 122, 109])

    def test_north_ealing_offers_and_southfield_first_preferences_2026(self):
        self.assertEqual(self.value("101870", 2026, "total_number_places_offered"), 72)
        self.assertEqual(self.value("101890", 2026, "times_put_as_1st_preference"), 116)

    def test_years_2014_to_2026(self):
        self.assertEqual({y for (urn, y) in self.rows if urn == "101912"}, set(range(2014, 2027)))


if __name__ == "__main__":
    unittest.main()
