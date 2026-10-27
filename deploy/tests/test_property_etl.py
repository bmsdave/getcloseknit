"""B3 (#153): the UPRN map links certificates the tolerant way.

No test covered etl_property.py before. The spine keys a flat by
postcode|norm(SAON) ("SW11 2FR|apartment 10"); a certificate that carries
the building in the same column ("Apartment 10, Duval House") or a
dwelling synonym ("Flat 10") must still meet it.
"""

import csv
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

TMP_AE_DATA = tempfile.mkdtemp(prefix="close-knit-ae-data-")
os.environ["AE_DATA"] = TMP_AE_DATA  # read by etl_property at import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import etl_property  # noqa: E402

DUVAL_ID = "uk:addr:7c8b2b59fbf1"  # sha1("SW11 2FR|apartment 10")[:12], per #153


def _known(*keys):
    return {etl_property.addr_id(pc, key) for pc, key in keys}


class SpineKeyTests(unittest.TestCase):
    def test_issue_ground_truth_spine_id(self):
        self.assertEqual(etl_property.addr_id("SW11 2FR", "apartment 10"), DUVAL_ID)

    def test_exact_columns_still_hit_first(self):
        known = _known(("SW1A 1AA", "flat 2"))
        row = {"address1": "Flat 2", "address2": "10 Sample Street", "address3": ""}

        hits = etl_property.uprn_hits_for_row("SW1A 1AA", row, known)

        self.assertEqual(hits, [(etl_property.addr_id("SW1A 1AA", "flat 2"), False)])

    def test_building_in_the_same_column_links(self):
        """EPC address1="Apartment 10, Duval House" -> SW11 2FR|apartment 10."""
        known = _known(("SW11 2FR", "apartment 10"))
        row = {"address1": "Apartment 10, Duval House", "address2": "",
               "address3": "", "postcode": "SW11 2FR"}

        hits = etl_property.uprn_hits_for_row("SW11 2FR", row, known)

        self.assertEqual([aid for aid, _ in hits], [DUVAL_ID])
        self.assertTrue(all(tolerant for _, tolerant in hits))

    def test_flat_meets_apartment_synonym(self):
        known = _known(("SW11 2FR", "apartment 10"))
        row = {"address1": "Flat 10", "address2": "Duval House", "address3": ""}

        hits = etl_property.uprn_hits_for_row("SW11 2FR", row, known)

        self.assertEqual([aid for aid, _ in hits], [DUVAL_ID])

    def test_no_hit_without_a_digit_or_dwelling_word(self):
        known = _known(("SW11 2FR", "apartment 10"))
        row = {"address1": "Duval House", "address2": "Grant Road", "address3": ""}

        self.assertEqual(etl_property.uprn_hits_for_row("SW11 2FR", row, known), [])

    def test_tolerant_covers_key_spellings(self):
        """One certificate can meet the same dwelling under two key spellings."""
        known = _known(("SW11 2FR", "apartment 10"), ("SW11 2FR", "10"))
        row = {"address1": "Apartment 10, Duval House", "address2": "", "address3": ""}

        hits = etl_property.uprn_hits_for_row("SW11 2FR", row, known)

        self.assertEqual(
            [aid for aid, _ in hits],
            [DUVAL_ID, etl_property.addr_id("SW11 2FR", "10")])
        self.assertTrue(all(tolerant for _, tolerant in hits))


class StageUprnMapTests(unittest.TestCase):
    def test_stage_maps_the_duval_house_certificate(self):
        with tempfile.TemporaryDirectory() as folder:
            spine_path = os.path.join(folder, "address-history.sqlite")
            spine = sqlite3.connect(spine_path)
            spine.execute("CREATE TABLE addr (id TEXT PRIMARY KEY)")
            spine.execute("INSERT INTO addr VALUES (?)", (DUVAL_ID,))
            spine.commit()
            spine.close()

            epc_path = os.path.join(folder, "epc-london.csv")
            with open(epc_path, "w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=(
                    "uprn", "postcode", "lodgement_date",
                    "address1", "address2", "address3"))
                writer.writeheader()
                writer.writerow({
                    "uprn": "999000111222", "postcode": "SW11 2FR",
                    "lodgement_date": "2021-05-04",
                    "address1": "Apartment 10, Duval House",
                    "address2": "10 Grant Road", "address3": "",
                })

            out = os.path.join(folder, "property")
            os.makedirs(out)
            old_db, old_out, old_csv = (etl_property.ADDRESS_DB, etl_property.OUT,
                                        etl_property.EPC_CSV)
            etl_property.ADDRESS_DB, etl_property.OUT, etl_property.EPC_CSV = (
                spine_path, out, epc_path)
            try:
                etl_property.stage_uprn_map()
            finally:
                etl_property.ADDRESS_DB, etl_property.OUT, etl_property.EPC_CSV = (
                    old_db, old_out, old_csv)

            db = sqlite3.connect(os.path.join(out, "addr-uprn.sqlite"))
            mapped = db.execute("SELECT address_id, uprn FROM map").fetchall()
            db.close()
            self.assertEqual(mapped, [(DUVAL_ID, "999000111222")])

            stats = json.load(open(os.path.join(out, "uprn-map-stats.json")))
            self.assertEqual(stats["exact_hits"], 0)
            self.assertEqual(stats["tolerant_hits"], 1)
            self.assertEqual(stats["key_hits"], 1)
            self.assertEqual(stats["addresses_mapped"], 1)


if __name__ == "__main__":
    unittest.main()
