"""Street names (migration 042): Open Names filtering by the coverage and zip reading."""

import csv
import io
import os
import tempfile
import unittest
import zipfile

from area_analytics import coverage, streets


def entry(id_, name, local_type="Named Road", region="London", x="533012.4", y="160410.0",
          district="CR8", place="Kenley"):
    row = [""] * len(streets.HEADER)
    at = {column: index for index, column in enumerate(streets.HEADER)}
    row[at["ID"]], row[at["NAME1"]], row[at["LOCAL_TYPE"]], row[at["REGION"]] = id_, name, local_type, region
    row[at["GEOMETRY_X"]], row[at["GEOMETRY_Y"]] = x, y
    row[at["POSTCODE_DISTRICT"]], row[at["POPULATED_PLACE"]] = district, place
    return row


class StreetRowsTests(unittest.TestCase):
    def test_keeps_named_roads_inside_the_coverage_box_only(self):
        entries = [
            entry("osgb2", "Valley Road"),
            entry("osgb1", "Hayes Lane", district="BR2", place="Bromley"),
            entry("osgb3", "Deansgate", region="North West", x="383500", y="398000"),  # Manchester
            entry("osgb7", "Princes Street", region="Scotland", x="325500", y="673800"),  # Edinburgh
            entry("osgb4", "Kenley", local_type="Suburban Area"),
            entry("osgb5", "  ", ),
            entry("osgb6", "Nowhere Road", x=""),
            ["too", "short"],
        ]
        self.assertEqual([r["id"] for r in streets.street_rows(entries, cov=coverage.ENGLAND)],
                         ["osgb1", "osgb2", "osgb3"])
        rows = streets.street_rows(entries, cov=coverage.LONDON)
        self.assertEqual([r["id"] for r in rows], ["osgb1", "osgb2"])
        self.assertEqual(rows[1], {"id": "osgb2", "name": "Valley Road", "locality": "Kenley",
                                   "postcode_district": "CR8", "easting": 533012, "northing": 160410})

    def test_blank_district_and_place_are_none(self):
        [row] = streets.street_rows([entry("osgb1", "Mill Lane", district="", place="")], cov=coverage.LONDON)
        self.assertIsNone(row["postcode_district"])
        self.assertIsNone(row["locality"])

    def test_reads_every_data_csv_with_the_shipped_header(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "opname_csv_gb.zip")
            with zipfile.ZipFile(path, "w") as archive:
                header = io.StringIO()
                csv.writer(header).writerow(streets.HEADER)
                archive.writestr("Doc/OS_Open_Names_Header.csv", header.getvalue())
                for name, rows in (("Data/TQ36.csv", [entry("osgb2", "Valley Road")]),
                                   ("Data/TQ37.csv", [entry("osgb1", "Hayes Lane")])):
                    body = io.StringIO()
                    csv.writer(body).writerows(rows)
                    archive.writestr(name, body.getvalue())
            header, rows = streets.zip_rows(path)
            self.assertEqual(header, streets.HEADER)
            self.assertEqual([r["name"] for r in streets.street_rows(rows, header)], ["Hayes Lane", "Valley Road"])


if __name__ == "__main__":
    unittest.main()
