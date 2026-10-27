"""Short lets (migration 084, deploy/tools/etl_short_lets.py): Inside Airbnb listing points counted per
LSOA and never stored, MSOAs and boroughs as sums of their LSOAs, and the latest London snapshot found
as published."""
import sys
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
FIXTURES = DEPLOY / "tests" / "fixtures" / "short_lets"
sys.path.insert(0, str(DEPLOY / "tools"))
import etl_short_lets as etl  # noqa: E402

MIGRATION = (DEPLOY / "migrations" / "084-short-lets.sql").read_text()


class SchemaTests(unittest.TestCase):
    def test_table_holds_counts_never_points_or_hosts(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS area_short_let (", MIGRATION)
        for column in ("listings integer", "entire_home integer", "active_12m integer", "homes integer",
                       "per_1000_homes real"):
            self.assertIn(column, MIGRATION)
        table = MIGRATION.split("CREATE TABLE IF NOT EXISTS area_short_let (", 1)[1].split(");", 1)[0]
        columns = "\n".join(line.split("--")[0] for line in table.splitlines())
        for leak in ("geometry", "host", "latitude", "price", "room"):
            self.assertNotIn(leak, columns)


class SnapshotTests(unittest.TestCase):
    def test_latest_london_snapshot_from_the_data_page(self):
        html = (FIXTURES / "get-the-data.html").read_text()
        url = etl.latest_snapshot(html)
        self.assertEqual(url, "https://data.insideairbnb.com/united-kingdom/england/london/2026-09-17/data/listings.csv.gz")
        self.assertEqual(etl.snapshot_date(url).isoformat(), "2026-09-17")

    def test_no_london_link_is_an_error(self):
        with self.assertRaises(SystemExit):
            etl.latest_snapshot("<a href='https://data.insideairbnb.com/united-kingdom/england/bristol/2026-10-01/data/listings.csv.gz'>")


class ParseTests(unittest.TestCase):
    def test_only_point_kind_and_activity_are_kept(self):
        with open(FIXTURES / "listings.csv", newline="", encoding="utf-8") as handle:
            points = list(etl.listing_points(handle))
        # Out of London and no point: dropped. Unreadable review counts read as not active.
        self.assertEqual(points, [
            (-0.1426, 51.539, True, True),
            (-0.1427, 51.5391, False, False),
            (-0.13, 51.51, False, False),
            (-0.055, 51.545, False, True),
            (-0.115, 51.46, True, False),
        ])
        self.assertTrue(all(len(point) == 4 for point in points))


LSOAS = {
    # lsoa: (msoa, borough, homes, listings, entire_home, active_12m)
    "uk:lsoa:E01000001": ("uk:msoa:E02000001", "uk:lad:E09000001", 600, 30, 24, 20),
    "uk:lsoa:E01000002": ("uk:msoa:E02000001", "uk:lad:E09000001", 400, 10, 4, 5),
    "uk:lsoa:E01000003": ("uk:msoa:E02000002", "uk:lad:E09000001", 500, 0, 0, 0),
    "uk:lsoa:E01000004": ("uk:msoa:E02000003", "uk:lad:E09000002", 20, 2, 2, 1),
}


class RollUpTests(unittest.TestCase):
    def test_levels_are_sums_of_their_lsoas(self):
        rows = {row[0]: row[1:] for row in etl.area_rows(LSOAS)}
        self.assertEqual(rows["uk:msoa:E02000001"], (40, 28, 25, 1000, 40.0))
        self.assertEqual(rows["uk:lad:E09000001"], (40, 28, 25, 1500, 26.7))
        self.assertEqual(rows["uk:lad:E09000002"], (2, 2, 1, 20, 100.0))
        for level in ("msoa", "lad"):
            parents = {gid: row for gid, row in rows.items() if f":{level}:" in gid}
            self.assertEqual(sum(row[0] for row in parents.values()), sum(lsoa[3] for lsoa in LSOAS.values()))
            self.assertEqual(sum(row[3] for row in parents.values()), sum(lsoa[2] for lsoa in LSOAS.values()))
        self.assertEqual(len(rows), 4 + 3 + 2)

    def test_no_homes_is_no_rate_never_zero(self):
        rows = {row[0]: row[1:] for row in etl.area_rows({"uk:lsoa:E01000009": ("uk:msoa:E02000009", None, 0, 3, 1, 1)})}
        self.assertIsNone(rows["uk:lsoa:E01000009"][4])
        self.assertNotIn(None, rows)

    def test_map_values_rank_lsoas_and_suppress_small_ones(self):
        values = etl.metric_values(LSOAS, "2026-09-01")
        by_id = {row[0]: row for row in values}
        self.assertEqual(by_id["uk:lsoa:E01000001"], ["uk:lsoa:E01000001", "short-lets-per-1000", "2026-09-01", 50.0, 100, 600, "observed"])
        self.assertEqual(by_id["uk:lsoa:E01000003"][3:5], [0.0, 0])
        self.assertEqual(by_id["uk:lsoa:E01000004"][3:], ["", "", 20, "suppressed"])
        self.assertEqual(len(values), len(LSOAS))

    def test_definition_names_source_and_caveats(self):
        definition = etl.definition("2026-09-17")
        self.assertEqual(definition["sourceId"], "inside-airbnb")
        self.assertEqual(definition["freshness"], "2026-09")
        self.assertIn("Inside Airbnb, insideairbnb.com, CC BY 4.0.", definition["caveats"])
        self.assertTrue(any("150 m" in caveat for caveat in definition["caveats"]))
        self.assertEqual([stop["value"] for stop in definition["legend"]], sorted(stop["value"] for stop in definition["legend"]))


if __name__ == "__main__":
    unittest.main()
