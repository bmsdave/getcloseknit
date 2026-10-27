"""One EPC reader for every ETL: the zip and the unzipped folder read the same, the per-home extract keeps
the per-home scope (London) only, and London's £/m² input comes from the same linked sales as England's."""
import csv
import os
import sqlite3
import sys
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import england_price_tables as t  # noqa: E402
import epc_bulk  # noqa: E402
import etl_england_prices as e  # noqa: E402
import etl_price_release  # noqa: E402

HEADER = ["certificate_number", "address1", "address2", "address3", "postcode", "local_authority",
          "total_floor_area", "lodgement_date", "uprn", "transaction_type"]


def certificate(number, authority, floor="72", uprn="100"):
    return [number, "Flat 2", "10 Sample Street", "", "SW1A 1AA", authority, floor, "2024-02-19", uprn, "rental"]


def write_year(folder, year, rows):
    path = os.path.join(folder, f"certificates-{year}.csv")
    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(HEADER)
        writer.writerows(rows)
    return path


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.unzipped = os.path.join(self.folder, "domestic-csv")
        os.makedirs(self.unzipped)
        write_year(self.unzipped, 2013, [certificate("a", "E09000001")])
        write_year(self.unzipped, 2012, [certificate("b", "E08000003")])
        Path(self.unzipped, "recommendations-2012.csv").write_text("x\n")
        self.archive = os.path.join(self.folder, "domestic-csv.zip")
        with zipfile.ZipFile(self.archive, "w") as out:
            for name in os.listdir(self.unzipped):
                out.write(os.path.join(self.unzipped, name), f"domestic-csv/{name}")

    def test_zip_and_folder_list_the_same_years_oldest_first(self):
        self.assertEqual(epc_bulk.members(self.unzipped), ["certificates-2012.csv", "certificates-2013.csv"])
        self.assertEqual(epc_bulk.members(self.archive),
                         ["domestic-csv/certificates-2012.csv", "domestic-csv/certificates-2013.csv"])

    def test_zip_and_folder_read_the_same_text(self):
        with epc_bulk.open_text(self.unzipped, "certificates-2013.csv") as handle:
            plain = handle.read()
        with epc_bulk.open_text(self.archive, "domestic-csv/certificates-2013.csv") as handle:
            zipped = handle.read()
        self.assertEqual(plain, zipped)
        self.assertEqual(epc_bulk.size(self.unzipped, "certificates-2013.csv"),
                         epc_bulk.size(self.archive, "domestic-csv/certificates-2013.csv"))

    def test_source_prefers_the_environment_then_the_zip_then_the_folder(self):
        with mock.patch.dict(os.environ, {"AE_EPC": "", "AE_EPC_ZIP": "", "AE_EPC_DIR": self.unzipped}):
            self.assertEqual(epc_bulk.source(), self.unzipped)
        with mock.patch.dict(os.environ, {"AE_EPC": self.archive, "AE_EPC_DIR": self.unzipped}):
            self.assertEqual(epc_bulk.source(), self.archive)
        with mock.patch.dict(os.environ, {"AE_EPC": "", "AE_EPC_ZIP": "", "AE_EPC_DIR": ""}), \
                mock.patch.object(epc_bulk, "DEFAULT_ZIP", os.path.join(self.folder, "missing.zip")), \
                mock.patch.object(epc_bulk, "DEFAULT_DIR", self.unzipped):
            self.assertEqual(epc_bulk.source(), self.unzipped)

    def test_no_certificates_is_an_error(self):
        empty = tempfile.mkdtemp()
        with self.assertRaises(SystemExit):
            epc_bulk.members(empty)

    def test_per_home_extract_keeps_london_only_and_resumes(self):
        write_year(self.unzipped, 2014, [certificate("c", "E09000033", uprn="200"),
                                         certificate("d", "E09000033", floor="0"),
                                         certificate("e", "E06000001")])
        out = os.path.join(self.folder, "epc-london.csv")
        self.assertEqual(epc_bulk.london_csv(out, src=self.unzipped), 2)
        self.assertEqual(epc_bulk.london_csv(out, src=self.unzipped), 0)  # every year done: nothing appended
        rows = list(csv.reader(open(out)))
        self.assertEqual(rows[0], list(epc_bulk.EPC_KEEP))
        self.assertEqual([(row[0], row[5], row[8]) for row in rows[1:]],
                         [("a", "E09000001", "100"), ("c", "E09000033", "200")])


def sale(lsoa, floor=80.0, category="A", day=date(2026, 3, 14)):
    return t.Sale(lsoa, day, t.month_index(day), 400_000, "F", False, "L", category, floor, "SW1A 1AA", "", "")


class LondonLinkedTests(unittest.TestCase):
    LOOKUP = {"E01000001": ("E02000001", "E09000001"), "E01011949": ("E02002483", "E06000001")}

    def test_rows_keep_london_sales_with_a_floor_area(self):
        rows = list(e.linked_rows([sale("E01000001"), sale("E01011949"), sale("E01000001", floor=None),
                                   sale("E01000001", category="B")], self.LOOKUP, frozenset({"E09000001"})))
        self.assertEqual(rows, [("e0", "2026-03", 400_000, 80.0, "E01000001", "E02000001", "E09000001", "F", 0, "A"),
                                ("e3", "2026-03", 400_000, 80.0, "E01000001", "E02000001", "E09000001", "F", 0, "B")])

    def test_price_release_reads_the_category_from_the_linked_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "price-linked.sqlite")
            db = sqlite3.connect(path)
            db.executescript(e.LINKED_SCHEMA)
            db.executemany("INSERT INTO sale VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                           e.linked_rows([sale("E01000001"), sale("E01000001", category="B")], self.LOOKUP,
                                         frozenset({"E09000001"})))
            db.commit()
            db.close()
            with mock.patch.object(etl_price_release, "LINKED_DB", path), \
                    mock.patch.object(etl_price_release, "PPD_DB", os.path.join(folder, "absent.sqlite")):
                series, counts = etl_price_release.load_sales()
        self.assertEqual(counts, {"linked_sales": 2, "qualifying_sales": 1})  # category B is left out
        self.assertEqual(set(series["lsoa"]), {"E01000001"})

    def test_a_database_without_the_definition_gets_one(self):
        definition = etl_price_release.base_definition([float(v) for v in range(1000, 11000, 1000)])
        self.assertEqual([stop["value"] for stop in definition["legend"]], [3000.0, 5000.0, 7000.0, 9000.0, 10000.0])
        self.assertEqual(definition["legend"][-1]["label"], "£10,000+")
        self.assertEqual(definition["methodologyPath"], "/guide/price-per-m2")


if __name__ == "__main__":
    unittest.main()
