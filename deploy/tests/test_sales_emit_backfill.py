"""B3 (#153): etl_sales.stage_emit backfills null spine floors from the EPC
extract through the shared tolerant matcher.

The spine's exact-key floor join misses whole new-build blocks (Duval House
SW11 2FR: 97 sales, 0 floor areas; Pinnacle E14 9PG: certificates lodged
under the sibling postcode E14 9GU). Emit fills those gaps; floors the
spine did link are left untouched.
"""

import csv
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import etl_sales  # noqa: E402


def _write(path, rows, header):
    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


class EmitBackfillTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp(prefix="emit-backfill-")
        self._old = {name: getattr(etl_sales, name) for name in
                     ("PPD_DB", "ADDRESS_DB", "POSTCODE_GRID", "EPC_CSV", "WORK", "SALES_CSV")}

        ppd_path = os.path.join(self.folder, "ppd-london.sqlite")
        db = sqlite3.connect(ppd_path)
        db.execute("""CREATE TABLE ppd (txn TEXT PRIMARY KEY, price INT, date TEXT, postcode TEXT,
                      ptype TEXT, newbuild INT, tenure TEXT, paon TEXT, saon TEXT, street TEXT,
                      category TEXT, status TEXT)""")
        db.executemany(
            "INSERT INTO ppd VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                ("abc", 552900, "2020-11-13", "SW11 2FR", "F", 1, "L", "10",
                 "APARTMENT 10", "GRANT ROAD", "A", "A"),
                ("def", 685000, "2021-06-01", "E14 9PG", "F", 1, "L", "10",
                 "APARTMENT 4105", "MARSH WALL", "A", "A"),
                ("ghi", 400000, "2021-01-01", "SE18 1BY", "F", 0, "F", "10",
                 "", "SAMPLE STREET", "A", "A"),
            ])
        db.commit()
        db.close()

        spine_path = os.path.join(self.folder, "address-history.sqlite")
        db = sqlite3.connect(spine_path)
        db.execute("CREATE TABLE txn (txn_id TEXT PRIMARY KEY, address_id TEXT, floor REAL)")
        db.executemany("INSERT INTO txn VALUES (?,?,?)", [
            ("{abc}", "uk:addr:7c8b2b59fbf1", None),
            ("{def}", "uk:addr:b3173c3a6697", None),
            ("{ghi}", "uk:addr:se181by10", 55.0),
        ])
        db.commit()
        db.close()

        grid_path = os.path.join(self.folder, "onspd-london-grid.csv")
        _write(grid_path,
               [["SW11 2FR", "527000", "177000"], ["E14 9PG", "537000", "180000"],
                ["SE18 1BY", "540000", "179000"]],
               ["postcode", "easting", "northing"])

        epc_path = os.path.join(self.folder, "epc-london.csv")
        with open(epc_path, "w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=(
                "certificate_number", "address1", "address2", "address3", "postcode",
                "local_authority", "total_floor_area", "lodgement_date", "uprn"))
            writer.writeheader()
            writer.writerow({"certificate_number": "c-duval",
                             "address1": "Apartment 10, Duval House",
                             "address2": "10 Grant Road", "address3": "",
                             "postcode": "SW11 2FR", "local_authority": "E09000032",
                             "total_floor_area": "71", "lodgement_date": "2021-05-04",
                             "uprn": "999000111222"})
            writer.writerow({"certificate_number": "c-pinn",
                             "address1": "Apartment 4105", "address2": "10 Marsh Wall",
                             "address3": "", "postcode": "E14 9GU",
                             "local_authority": "E09000033", "total_floor_area": "84",
                             "lodgement_date": "2021-03-11", "uprn": "888000111333"})

        etl_sales.PPD_DB = ppd_path
        etl_sales.ADDRESS_DB = spine_path
        etl_sales.POSTCODE_GRID = grid_path
        etl_sales.EPC_CSV = epc_path
        etl_sales.WORK = self.folder
        etl_sales.SALES_CSV = os.path.join(self.folder, "sales.csv")

    def tearDown(self):
        for name, value in self._old.items():
            setattr(etl_sales, name, value)

    def _floors(self):
        etl_sales.stage_emit()
        with open(etl_sales.SALES_CSV, newline="") as handle:
            return {row["transaction_id"]: row["floor_area_square_metres"]
                    for row in csv.DictReader(handle)}

    def test_null_spine_floors_backfill_from_the_epc_extract(self):
        floors = self._floors()

        # Duval House: same-postcode tolerant match ("Apartment 10, Duval House")
        self.assertEqual(floors["abc"], "71.0")
        # Pinnacle E14 9PG: sibling-postcode certificate (E14 9GU), same flat
        self.assertEqual(floors["def"], "84.0")

    def test_spine_floors_are_never_overwritten(self):
        floors = self._floors()

        self.assertEqual(floors["ghi"], "55.0")

    def test_missing_extract_means_spine_floors_only(self):
        etl_sales.EPC_CSV = os.path.join(self.folder, "no-such-file.csv")

        floors = self._floors()

        self.assertEqual(floors["abc"], "")
        self.assertEqual(floors["def"], "")
        self.assertEqual(floors["ghi"], "55.0")


if __name__ == "__main__":
    unittest.main()
