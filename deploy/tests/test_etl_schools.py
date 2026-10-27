"""etl_schools.py: which schools are kept and how they are placed (#225), report-card observations (#226)."""
import csv
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import etl_schools  # noqa: E402

COLUMNS = ["URN", "School name", "Ofsted phase", "Region", "Local authority", "Postcode",
           "Web Link (opens in new window)", "Safeguarding standards", "Safeguarding standards - date of grade",
           "Inclusion", "Inclusion - date of grade", "Leadership and governance",
           "Leadership and governance - date of grade", "Latest OEIF overall effectiveness",
           "Publication date of latest OEIF graded inspection"]

# Nonsuch High (LB Sutton) is filed under South East; Tatsfield Primary is in Surrey, 1.2 km from Bromley.
NONSUCH = {"URN": "136795", "School name": "Nonsuch High School for Girls", "Ofsted phase": "Secondary",
           "Region": "South East", "Local authority": "Surrey", "Postcode": "SM3 8AB",
           "Safeguarding standards": "Met", "Safeguarding standards - date of grade": "10/02/2026",
           "Inclusion": "Strong standard", "Inclusion - date of grade": "10/02/2026",
           "Leadership and governance": "Strong standard", "Leadership and governance - date of grade": "10/02/2026"}
TATSFIELD = {"URN": "144231", "School name": "Tatsfield Primary School", "Ofsted phase": "Primary",
             "Region": "South East", "Local authority": "Surrey", "Postcode": "TN16 2AH"}
LONDON = {"URN": "103100", "School name": "Willowfield School", "Ofsted phase": "Secondary", "Region": "London",
          "Local authority": "Waltham Forest", "Postcode": "E17 6ND",
          "Latest OEIF overall effectiveness": "2", "Publication date of latest OEIF graded inspection": "03/05/2022"}
NURSERY = {"URN": "100000", "School name": "A nursery", "Ofsted phase": "Nursery", "Region": "London",
           "Postcode": "E1 6AN"}


def write_rows(folder: str, rows: list[dict]) -> str:
    path = os.path.join(folder, "ofsted_latest_inspections_31Aug2026.csv")
    with open(path, "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "NULL") for column in COLUMNS})
    return path


class SchoolRowsTests(unittest.TestCase):
    def test_schools_outside_the_ofsted_london_region_are_read(self):
        """#225: Ofsted's region is not the selection; location is (main, INSERT_SQL)."""
        with tempfile.TemporaryDirectory() as folder:
            rows = etl_schools.school_rows(write_rows(folder, [NONSUCH, TATSFIELD, LONDON, NURSERY]))
        self.assertEqual([row["URN"] for row in rows], ["136795", "144231", "103100"])


class PlacementTests(unittest.TestCase):
    GRID = {"E17 6ND": (537500.0, 189700.0)}
    POINTS = {"136795": (523900.0, 164400.0), "144231": (541700.0, 157200.0), "999999": (384000.0, 398000.0)}

    def test_a_london_postcode_takes_the_grid_point(self):
        self.assertEqual(etl_schools.locate(LONDON, self.GRID, self.POINTS), ((537500.0, 189700.0), True))

    def test_a_postcode_beyond_the_grid_takes_gias_point_and_is_not_in_london(self):
        self.assertEqual(etl_schools.locate(NONSUCH, self.GRID, self.POINTS), ((523900.0, 164400.0), False))
        self.assertEqual(etl_schools.locate(TATSFIELD, self.GRID, self.POINTS), ((541700.0, 157200.0), False))

    def test_a_school_nowhere_has_no_point(self):
        self.assertEqual(etl_schools.locate({"URN": "1", "Postcode": "ZZ1 1ZZ"}, self.GRID, self.POINTS), (None, False))

    def test_coverage_box_keeps_boundary_schools_and_drops_the_rest(self):
        with mock.patch.object(etl_schools.common, "COVERAGE", etl_schools.common.coverage.LONDON):
            self.assertTrue(etl_schools.near_coverage(self.POINTS["144231"]))
            self.assertFalse(etl_schools.near_coverage(self.POINTS["999999"]))
        self.assertTrue(etl_schools.near_coverage(self.POINTS["999999"]))  # England (Sheffield)
        self.assertFalse(etl_schools.near_coverage((300_000.0, 700_000.0)))  # Scotland

    def test_coverage_boroughs_are_the_lads_as_ids(self):
        ids = etl_schools.borough_ids(etl_schools.common.coverage.LONDON)
        self.assertEqual(len(ids), 33)
        self.assertIn("uk:lad:E09000001", ids)
        self.assertEqual(len(etl_schools.borough_ids(etl_schools.common.coverage.ENGLAND)), 296)

    def test_insert_keeps_london_postcodes_or_points_within_the_margin(self):
        sql = etl_schools.INSERT_SQL
        self.assertIn("st.in_london OR EXISTS", sql)
        self.assertIn("a.kind = 'lad' AND a.id = ANY(%(lads)s)", sql)
        self.assertIn("ST_DWithin(a.geometry::geography, st.point::geography, %(margin)s)", sql)
        self.assertIn("a.id = ANY(%(london)s)", sql)  # outsideLondon: beyond every London borough
        self.assertIn("jsonb_build_object('outsideLondon', NOT EXISTS", sql)
        # add-missing: only schools absent from the table.
        self.assertIn("NOT EXISTS (SELECT 1 FROM school s WHERE s.urn = st.urn)", sql)
        self.assertEqual(etl_schools.MARGIN_METRES, 2000)


class ReportCardObservationTests(unittest.TestCase):
    def test_safeguarding_follows_the_graded_areas(self):
        """#226: the report card is its graded areas plus the safeguarding outcome, each named."""
        observations = etl_schools.observations(NONSUCH, "src-ofsted-latest-inspections-2026-08")
        self.assertEqual([(o["measure"], o["value"]) for o in observations],
                         [("Inclusion", "Strong standard"), ("Leadership and governance", "Strong standard"),
                          ("Safeguarding", "Met")])
        self.assertTrue(all(o["kind"] == "inspection-current" and o["academicYear"] == "2025/26"
                            for o in observations))

    def test_a_legacy_only_school_has_no_safeguarding_observation(self):
        observations = etl_schools.observations(LONDON, "src-ofsted-latest-inspections-2026-08")
        self.assertEqual([(o["kind"], o["measure"], o["value"]) for o in observations],
                         [("inspection-legacy", "Overall effectiveness", "Good")])


if __name__ == "__main__":
    unittest.main()
