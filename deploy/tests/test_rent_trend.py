"""Rent trend (ONS PIPR series, migration 081): workbook rows, 1- and 5-year change layers, legend."""
import csv
import sys
import unittest
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT.parent / "api"))

import etl_rent_trend as rt  # noqa: E402
from area_analytics import coverage  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "pipr-table1-sample.csv"
MIGRATION = (ROOT / "migrations" / "081-rent-trend.sql").read_text()


def sample_rows():
    with FIXTURE.open(newline="") as handle:
        return list(csv.reader(handle))


def point(borough, month, index, category="all", rent=1000):
    return {"borough": borough, "month": month, "category": category, "rent": rent, "index": Decimal(index)}


class SeriesRowsTests(unittest.TestCase):
    def test_reads_every_month_and_category_for_london_boroughs_and_london(self):
        rows = rt.series_rows(sample_rows(), coverage.LONDON)
        self.assertEqual({r["borough"] for r in rows}, {"E09000007", "E09000012", "E12000007"})  # no Hartlepool
        england = rt.series_rows(sample_rows(), coverage.ENGLAND)
        self.assertIn("E06000001", {r["borough"] for r in england})  # Hartlepool with England coverage
        self.assertEqual({r["month"] for r in rows},
                         {"2020-08-01", "2021-08-01", "2025-08-01", "2026-07-01", "2026-08-01"})
        self.assertEqual({r["category"] for r in rows}, set(rt.CATEGORIES.values()))
        camden = {(r["month"], r["category"]): r for r in rows if r["borough"] == "E09000007"}
        latest = camden[("2026-08-01", "all")]
        self.assertIsInstance(latest["rent"], int)
        self.assertGreater(latest["rent"], 1000)
        self.assertEqual(latest["index"], latest["index"].quantize(Decimal("0.0001")))
        self.assertIn(("2026-08-01", "semi-detached"), camden)

    def test_unpublished_cells_are_skipped_not_zeroed(self):
        header = sample_rows()[1]
        cells = ["46235", "E09000007", "Camden", "London"] + ["[x]"] * (len(header) - 4)
        cells[header.index("Index two bed")] = "120.5"
        rows = rt.series_rows([header, cells])
        self.assertEqual([(r["category"], r["rent"], r["index"]) for r in rows],
                         [("2 bedrooms", None, Decimal("120.5000"))])

    def test_a_workbook_without_london_fails_loudly(self):
        with self.assertRaises(ValueError):
            rt.series_rows([sample_rows()[1], ["46235", "E06000001", "Hartlepool", "North East", "100"]],
                           coverage.LONDON)


class ChangeRowsTests(unittest.TestCase):
    def test_change_is_the_index_change_over_the_span_with_a_london_rank(self):
        series = [point("E09000007", "2025-08-01", "100"), point("E09000007", "2026-08-01", "105"),
                  point("E09000012", "2025-08-01", "120"), point("E09000012", "2026-08-01", "123"),
                  point("E09000020", "2026-08-01", "110"),                     # no base: no row
                  point("E12000007", "2025-08-01", "100"), point("E12000007", "2026-08-01", "104"),
                  point("E09000007", "2025-08-01", "50", category="1 bedroom")]
        self.assertEqual(rt.change_rows(series, 12, "rent-change-1y"), [
            ["uk:lad:E09000007", "rent-change-1y", "2026-08-01", 5.0, 100, "", "observed"],
            ["uk:lad:E09000012", "rent-change-1y", "2026-08-01", 2.5, 0, "", "observed"],
        ])

    def test_ranks_are_within_the_region(self):
        series = [point("E09000007", "2025-08-01", "100"), point("E09000007", "2026-08-01", "105"),
                  point("E09000012", "2025-08-01", "120"), point("E09000012", "2026-08-01", "123"),
                  point("E06000001", "2025-08-01", "100"), point("E06000001", "2026-08-01", "101"),
                  point("E06000005", "2025-08-01", "100"), point("E06000005", "2026-08-01", "110")]
        ranks = {row[0]: row[4] for row in rt.change_rows(series, 12, "rent-change-1y")}
        # London is ranked among London boroughs only, the North East among its own LADs.
        self.assertEqual(ranks, {"uk:lad:E09000007": 100, "uk:lad:E09000012": 0,
                                 "uk:lad:E06000001": 0, "uk:lad:E06000005": 100})

    def test_five_years_reaches_back_sixty_months(self):
        series = [point("E09000007", "2021-08-01", "80"), point("E09000007", "2026-08-01", "100")]
        self.assertEqual(rt.change_rows(series, 60, "rent-change-5y"),
                         [["uk:lad:E09000007", "rent-change-5y", "2026-08-01", 25.0, 50, "", "observed"]])

    def test_fixture_changes_match_the_workbook_annual_change(self):
        rows = sample_rows()
        header = rows[1]
        published = {(r[1], rt.month(r[0])): float(r[header.index("Annual change")])
                     for r in rows[2:] if r[1] == "E09000007"}
        ours = {r[2]: r[3] for r in rt.change_rows(rt.series_rows(rows), 12, "rent-change-1y")
                if r[0] == "uk:lad:E09000007"}
        self.assertAlmostEqual(ours["2026-08-01"], published[("E09000007", "2026-08-01")], delta=0.06)
        self.assertAlmostEqual(ours["2021-08-01"], published[("E09000007", "2021-08-01")], delta=0.06)


class DefinitionTests(unittest.TestCase):
    def test_definitions_are_borough_change_layers_with_a_rising_legend(self):
        for metric_id, years in (("rent-change-1y", "1 year"), ("rent-change-5y", "5 years")):
            definition = rt.definition(metric_id, [-2.0, 1.0, 3.5, 6.0, 9.0, 12.0])
            self.assertIn(years, definition["label"])
            self.assertEqual(definition["shortLabel"], "Rent change")
            self.assertEqual(definition["sourceId"], "ons-pipr")
            values = [stop["value"] for stop in definition["legend"]]
            self.assertEqual(values, sorted(values))
            self.assertTrue(definition["legend"][-1]["label"].endswith("+"))
            self.assertTrue(any("borough" in caveat.lower() for caveat in definition["caveats"]))
            self.assertTrue(any("City of London" in caveat for caveat in definition["caveats"]))

    def test_borough_carrier_paints_every_lsoa_in_range_matching(self):
        # Borough-only: matching reads each LSOA's borough value (repository.RANGE_CARRIER_JOINS).
        from area_api import repository
        self.assertEqual(rt.CARRIER, "lad")
        self.assertIn(rt.CARRIER, repository.RANGE_CARRIER_JOINS)

    def test_metric_ids_match_the_contracts(self):
        contracts = (ROOT.parent / "web" / "src" / "lib" / "contracts.ts").read_text()
        openapi = (ROOT.parent / "contracts" / "openapi.yaml").read_text()
        for metric_id in rt.METRIC_IDS:
            self.assertIn(f'"{metric_id}"', contracts)
            self.assertIn(metric_id, openapi)


class MigrationTests(unittest.TestCase):
    def test_series_table_keeps_borough_rent(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS borough_rent_series", MIGRATION)
        for column in ("borough", "month", "category", "rent", "index", "source_release_id"):
            self.assertRegex(MIGRATION, rf"\n    {column} ")
        self.assertNotIn("DROP", MIGRATION.upper().replace("DROP TABLE IF EXISTS", ""))
        statements = "\n".join(line for line in MIGRATION.splitlines() if not line.startswith("--"))
        self.assertNotRegex(statements, r"borough_rent\b(?!_series)")

    def test_categories_match_the_check(self):
        for category in rt.CATEGORIES.values():
            self.assertIn(f"'{category}'", MIGRATION)


if __name__ == "__main__":
    unittest.main()
