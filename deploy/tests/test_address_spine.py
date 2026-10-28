"""etl_address_spine.py: the London address spine built from Price Paid rows.

The ids must stay the ones already published (search results, saved homes, /property links),
so the fixture pins the key scheme, the display address, the London filter and the EPC floor join.
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
import etl_address_spine as spine  # noqa: E402


def ppd(txn, price, date, postcode, paon, saon, street, locality="", town="LONDON"):
    return [txn, str(price), f"{date} 00:00", postcode, "F", "N", "L", paon, saon, street, locality, town,
            "WANDSWORTH", "GREATER LONDON", "A", "A"]


ROWS = [
    ppd("{T1}", 552900, "2020-11-13", "SW11 2FR", "DUVAL HOUSE, 10", "APARTMENT 10", "GRANT ROAD"),
    ppd("{T2}", 600000, "2024-02-01", "SW11 2FR", "DUVAL HOUSE 10", "APARTMENT 10", "GRANT RD", "BATTERSEA"),
    ppd("{T3}", 400000, "2021-01-04", "SE18 1BY ", "42A", "", "SAMPLE STREET", "", "LONDON"),
    ppd("{T4}", 350000, "2022-05-06", "SE18 1BY", "7", "FLAT (REAR)", "ST. THOMAS'S ROAD"),
    ppd("{T5}", 300000, "2019-03-01", "WD3 1PZ", "5", "", "MOUNT VERNON COTTAGES"),  # border postcode
    ppd("{T6}", 250000, "2019-03-01", "M1 1AA", "1", "", "PICCADILLY"),  # not in the London lookup
]


class AddressSpineTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp(prefix="address-spine-")
        self.csv = os.path.join(self.folder, "pp.csv")
        with open(self.csv, "w", newline="") as handle:
            csv.writer(handle, quoting=csv.QUOTE_ALL).writerows(ROWS)
        lookup = os.path.join(self.folder, "lookup.csv")
        with open(lookup, "w", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["postcode", "lsoa21", "msoa21", "lad25", "terminated"])
            writer.writerow(["SW11 2FR", "E01004536", "E02000930", "E09000032", "None"])
            writer.writerow(["SE18 1BY", "E01001612", "E02000353", "E09000011", "None"])
            writer.writerow(["WD3 1PZ", "E01002475", "E02000494", "E09000017", "None"])
        floors = os.path.join(self.folder, "epc.sqlite")
        db = sqlite3.connect(floors)
        db.execute("CREATE TABLE epc (postcode TEXT, akey TEXT, floor REAL, lodged TEXT)")
        db.executemany("INSERT INTO epc VALUES (?,?,?,?)", [
            ("SW11 2FR", "apartment 10", 55.0, "2020-10-01"),
            ("SE18 1BY", "7 street thomas s road", 80.0, "2015-01-01"),  # the house a flat was carved from
        ])
        db.commit()
        db.close()
        self._old = {name: getattr(spine, name) for name in ("POSTCODE_LOOKUP", "EPC_FLOOR_DB")}
        spine.POSTCODE_LOOKUP, spine.EPC_FLOOR_DB = lookup, floors
        self.out = os.path.join(self.folder, "spine.sqlite")

    def tearDown(self):
        for name, value in self._old.items():
            setattr(spine, name, value)

    def test_ids_keep_the_published_scheme(self):
        self.assertEqual(spine.address_id("SW11 2FR", spine.address_key("10", "APARTMENT 10", "GRANT ROAD")),
                         "uk:addr:7c8b2b59fbf1")
        self.assertEqual(spine.address_key("42A", "", "SAMPLE ST"), "42a sample street")

    def test_display_address_casing(self):
        self.assertEqual(spine.display_address("7", "FLAT (REAR)", "ST. THOMAS'S ROAD", "", "LONDON", "SE18 1BY"),
                         "Flat (Rear), 7 St. Thomas's Road, London, SE18 1BY")
        self.assertEqual(spine.capitalise("FLAT A-B, 20   22 P C L HOUSE"), "Flat A-B, 20   22 P C L House")

    def test_build_reads_london_rows_into_addresses_and_sales(self):
        meta = spine.build(self.csv, self.out)
        self.assertEqual((meta["addresses"], meta["txns"], meta["last_date"]), (3, 4, "2024-02-01"))
        db = sqlite3.connect(self.out)
        addresses = {row[0]: row[1:] for row in db.execute("SELECT * FROM addr")}
        duval = addresses["uk:addr:7c8b2b59fbf1"]
        # Both sales of the flat share one address; its display comes from the first row in the file.
        self.assertEqual(duval, ("Apartment 10, Duval House, 10 Grant Road, London, SW11 2FR", "SW11 2FR",
                                 "uk:lsoa:E01004536", 2))
        self.assertIn(spine.address_id("SE18 1BY", "42a sample street"), addresses)  # padded postcode trimmed
        txns = {row[0]: row[1:] for row in db.execute("SELECT * FROM txn")}
        self.assertEqual(txns["{T1}"], ("uk:addr:7c8b2b59fbf1", "2020-11", "2020-11-13", 552900, 55.0, 10052.73))
        self.assertEqual(txns["{T3}"][4:], (None, None))
        self.assertEqual(txns["{T4}"][4:], (80.0, 4375.0))  # flat falls back to the house's certificate
        self.assertNotIn("{T5}", txns)
        self.assertNotIn("{T6}", txns)

    def test_compare_reports_full_match_against_itself(self):
        spine.build(self.csv, self.out)
        report = spine.compare(self.out, self.out)
        self.assertEqual((report["address_id_match_rate"], report["txn_id_match_rate"]), (1.0, 1.0))
        self.assertEqual(set(report["field_differences"].values()), {0})


if __name__ == "__main__":
    unittest.main()
