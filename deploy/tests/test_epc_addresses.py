"""Migration 089 and the EPC extract's addresses: homes known only from an energy certificate."""
import csv
import os
import sys
import tempfile
import zipfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "migrations" / "089-epc-addresses.sql").read_text()
sys.path.insert(0, str(ROOT / "tools"))
import etl_epc  # noqa: E402


class MigrationTests(unittest.TestCase):
    def table(self):
        return MIGRATION.split("CREATE TABLE IF NOT EXISTS property_epc_home", 1)[1].split(");", 1)[0].lower()

    def test_table_stores_no_occupant_or_cost_fields(self):
        for word in ("tenure", "name", "cost"):
            self.assertNotIn(word, self.table())

    def test_table_keeps_the_same_facts_as_property_epc(self):
        for column in etl_epc.COLUMNS:
            self.assertIn(column, self.table())
        for column in ("postcode", "display_address", "geography_id", "location", "source_release_id"):
            self.assertIn(column, self.table())

    def test_load_keeps_only_homes_the_spine_does_not_know(self):
        load = MIGRATION.split("FUNCTION public.load_property_epc_home", 1)[1]
        self.assertIn("NOT EXISTS (SELECT 1 FROM property p WHERE p.uprn = s.uprn)", load)
        self.assertIn("JOIN spine ON spine.postcode = t.postcode", load)
        self.assertIn("DELETE FROM property_epc_home WHERE source_release_id = p_source_release_id", load)

    def test_no_existing_table_is_altered(self):
        self.assertNotIn("ALTER TABLE", MIGRATION)
        self.assertNotIn("DROP TABLE", MIGRATION)


def certificate(**extra):
    row = {"uprn": "000123", "local_authority": "E09000032", "lodgement_date": "2024-02-19",
           "current_energy_rating": "C", "potential_energy_rating": "B", "property_type": "Flat",
           "built_form": "Mid-Terrace", "construction_age_band": "England and Wales: 1900-1929",
           "total_floor_area": "52.0", "number_habitable_rooms": "3.0", "floor_level": "3",
           "tenure": "Rented (private)", "address1": "Flat 2", "address2": "10 Sample Street", "address3": "",
           "address": "Flat 2, 10 Sample Street", "posttown": "LONDON", "postcode": "sw1a1aa"}
    row.update(extra)
    return row


class AddressTests(unittest.TestCase):
    def test_parse_address_reads_like_the_spine(self):
        self.assertEqual(etl_epc.parse_address(certificate()),
                         ("123", "SW1A 1AA", "Flat 2, 10 Sample Street, London, SW1A 1AA"))

    def test_capitals_become_title_case_and_the_town_is_not_repeated(self):
        row = certificate(address1="FLAT 4", address2="22 HIGH STREET", address3="London", posttown="LONDON",
                          postcode="W5 1LR")
        self.assertEqual(etl_epc.parse_address(row)[2], "Flat 4, 22 High Street, London, W5 1LR")

    def test_falls_back_to_the_full_address(self):
        row = certificate(address1="", address2="", address="7 Meadvale Road, Ealing", posttown="")
        self.assertEqual(etl_epc.parse_address(row)[2], "7 Meadvale Road, Ealing, SW1A 1AA")

    def test_skips_a_certificate_without_a_postcode_or_address(self):
        self.assertIsNone(etl_epc.parse_address(certificate(postcode="SW1A")))
        self.assertIsNone(etl_epc.parse_address(certificate(address1="", address2="", address="")))
        self.assertIsNone(etl_epc.parse_address(certificate(uprn="")))

    def test_extract_keeps_the_latest_certificates_address(self):
        old = certificate(lodgement_date="2015-01-01", address1="Flat B")
        new = certificate(lodgement_date="2024-02-19", address1="Flat 2")
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "certificates-2024.csv")
            with open(path, "w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(new))
                writer.writeheader()
                writer.writerows([new, old])
            archive = os.path.join(folder, "domestic-csv.zip")
            with zipfile.ZipFile(archive, "w") as out:
                out.write(path, "certificates-2024.csv")
            # The same year file read from the unzipped folder and from the download's zip.
            results = [etl_epc.extract_file((folder, "certificates-2024.csv")),
                       etl_epc.extract_file((archive, "certificates-2024.csv"))]
        self.assertEqual(results[0], results[1])
        _, rows, latest = results[0]
        self.assertEqual(rows, 2)
        facts, address = latest["123"]
        self.assertEqual(facts[1], "2024-02-19")
        self.assertEqual(address, ("123", "SW1A 1AA", "Flat 2, 10 Sample Street, London, SW1A 1AA"))
        self.assertNotIn("Rented (private)", facts + address)

    def test_write_csv_leaves_nulls_empty(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "out.csv")
            etl_epc.write_csv(path, ("a", "b"), [("1", None)])
            self.assertEqual(Path(path).read_text().splitlines(), ["a,b", "1,"])


if __name__ == "__main__":
    unittest.main()
