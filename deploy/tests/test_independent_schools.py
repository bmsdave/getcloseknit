"""London's independent schools from GIAS into independent_school (migration 067)."""
import csv
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import etl_independent_schools as independent  # noqa: E402

MIGRATION = (ROOT / "migrations" / "067-independent-school.sql").read_text()

ROW = {"URN": "100001", "EstablishmentName": "City of London School for Girls", "EstablishmentStatus (name)": "Open",
       "TypeOfEstablishment (name)": "Other independent school", "LA (code)": "201", "StatutoryLowAge": "10",
       "StatutoryHighAge": "18", "Gender (name)": "Girls", "ReligiousCharacter (name)": "None",
       "OfficialSixthForm (name)": "Has a sixth form", "Postcode": "EC2Y 8BB", "Easting": "532301", "Northing": "181746"}


class KeepTests(unittest.TestCase):
    def test_open_mainstream_independent_schools_in_london_only(self):
        self.assertTrue(independent.keep(ROW))
        self.assertTrue(independent.keep({**ROW, "EstablishmentStatus (name)": "Open, but proposed to close"}))
        for change in ({"TypeOfEstablishment (name)": "Other independent special school"},
                       {"TypeOfEstablishment (name)": "Academy converter"},
                       {"EstablishmentStatus (name)": "Closed"},
                       {"LA (code)": "886"}, {"LA (code)": ""}):
            self.assertFalse(independent.keep({**ROW, **change}), change)

    def test_england_keeps_any_english_district_and_names_the_la_from_gias(self):
        leeds = {**ROW, "LA (code)": "383", "LA (name)": "Leeds", "DistrictAdministrative (code)": "E08000035"}
        self.assertTrue(independent.keep(leeds))
        self.assertFalse(independent.keep({**leeds, "DistrictAdministrative (code)": "W06000015"}))
        self.assertEqual(independent.local_authority(leeds), "Leeds")
        self.assertEqual(independent.local_authority({**ROW, "LA (name)": "City of London"}), "City of London")

    def test_slim_keeps_only_the_columns_and_the_kept_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            full = os.path.join(folder, "edubasealldata20261017.csv")
            extra = {"HeadFirstName": "A", "HeadLastName": "B", "TelephoneNum": "0"}
            with open(full, "w", newline="", encoding="cp1252") as handle:
                writer = csv.DictWriter(handle, fieldnames=[*ROW, *extra])
                writer.writeheader()
                writer.writerow({**ROW, **extra})
                writer.writerow({**ROW, **extra, "URN": "100002", "EstablishmentStatus (name)": "Closed"})
            out = os.path.join(folder, "independent-20261017.csv")
            self.assertEqual(independent.slim(full, out), 1)
            with open(out, newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(list(rows[0]), list(independent.COLUMNS))
            self.assertEqual(rows[0]["URN"], "100001")


class RecordTests(unittest.TestCase):
    def test_gias_row_maps_to_columns(self):
        self.assertEqual(independent.record(ROW), {
            "urn": "100001", "name": "City of London School for Girls", "local_authority": "City of London",
            "age_from": 10, "age_to": 18, "gender": "Girls", "religious_character": None, "sixth_form": True,
            "postcode": "EC2Y 8BB", "easting": 532301, "northing": 181746})

    def test_faith_and_sixth_form_words(self):
        record = independent.record({**ROW, "ReligiousCharacter (name)": "Roman Catholic",
                                     "OfficialSixthForm (name)": "Not applicable", "Gender (name)": ""})
        self.assertEqual((record["religious_character"], record["sixth_form"], record["gender"]),
                         ("Roman Catholic", None, None))
        self.assertIsNone(independent.record({**ROW, "ReligiousCharacter (name)": "Does not apply"})["religious_character"])
        self.assertFalse(independent.record({**ROW, "OfficialSixthForm (name)": "Does not have a sixth form"})["sixth_form"])

    def test_no_point_no_row(self):
        self.assertIsNone(independent.record({**ROW, "Easting": "", "Northing": ""}))

    def test_no_personal_columns_are_kept(self):
        self.assertFalse({"HeadFirstName", "HeadLastName", "HeadTitle (name)", "TelephoneNum", "SchoolWebsite"}
                         & set(independent.COLUMNS))


class SqlBundleTests(unittest.TestCase):
    def test_sql_quotes_names_and_builds_points_from_the_national_grid(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "independent-20261017.csv")
            with open(path, "w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(independent.COLUMNS))
                writer.writeheader()
                writer.writerow({**ROW, "EstablishmentName": "St Mary's School"})
            with open(os.path.join(folder, "sources-20261017.txt"), "w") as handle:
                handle.write("abc123  edubasealldata20261017.csv  https://example.test/edubasealldata20261017.csv\n")
            text = Path(independent.sql(path)).read_text()
        self.assertIn("'src-gias-independent-20261017'", text)
        self.assertIn("'St Mary''s School'", text)
        self.assertIn("ST_MakePoint(532301, 181746), 27700), 4326)", text)
        self.assertIn("ON CONFLICT (id) DO NOTHING;", text)
        self.assertIn("DELETE FROM independent_school;", text)


class MigrationTests(unittest.TestCase):
    def test_every_statement_is_safe_to_run_again(self):
        statements = [s.strip() for s in re.sub(r"--[^\n]*", "", MIGRATION).split(";") if s.strip()]
        self.assertTrue(statements)
        for statement in statements:
            self.assertRegex(statement, r"IF NOT EXISTS")

    def test_loader_columns_match_the_table(self):
        body = MIGRATION.split("CREATE TABLE IF NOT EXISTS independent_school (", 1)[1].split(");", 1)[0]
        for column in ("urn", "name", "local_authority", "age_from", "age_to", "gender", "religious_character",
                       "sixth_form", "postcode", "location", "source_release_id"):
            self.assertRegex(body, rf"\n    {column} ")
            self.assertIn(column, independent.INSERT_SQL)

    def test_state_school_table_untouched(self):
        self.assertNotRegex(MIGRATION, r"(?i)\b(ALTER|INSERT INTO|UPDATE)\s+school\b")


if __name__ == "__main__":
    unittest.main()
