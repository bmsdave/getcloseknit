"""GIAS gender, trust, capacity, website, phone and LAESTAB into school_profile (migrations 055, 099)."""
import sys
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import etl_school_profile as profile  # noqa: E402


class RecordTests(unittest.TestCase):
    def test_gias_row_maps_to_profile_columns(self):
        row = {"URN": "101916", "Gender (name)": "Girls", "Trusts (code)": "1234", "Trusts (name)": "A TRUST",
               "SchoolCapacity": "420", "NumberOfPupils": "411", "CensusDate": "16-01-2025"}
        self.assertEqual(profile.record(row), {
            "urn": "101916", "gender": "Girls", "trust_code": "1234", "trust_name": "A TRUST",
            "capacity": 420, "pupils": 411, "census_date": date(2025, 1, 16),
            "website": None, "telephone": None, "laestab": None})

    def test_website_phone_and_laestab(self):
        row = {"URN": "100000", "SchoolWebsite": " www.thealdgateschool.org ", "TelephoneNum": "02072831147",
               "LA (code)": "201", "EstablishmentNumber": "3614", "CensusDate": ""}
        record = profile.record(row)
        self.assertEqual([record[k] for k in ("website", "telephone", "laestab")],
                         ["www.thealdgateschool.org", "02072831147", "201/3614"])
        self.assertIsNone(profile.record({**row, "EstablishmentNumber": ""})["laestab"])

    def test_blanks_not_applicable_and_zero_capacity_stay_null(self):
        row = {"URN": "101916", "Gender (name)": "Not applicable", "Trusts (code)": "", "Trusts (name)": "",
               "SchoolCapacity": "0", "NumberOfPupils": "", "CensusDate": ""}
        record = profile.record(row)
        self.assertEqual([record[k] for k in ("gender", "trust_name", "capacity", "pupils", "census_date")],
                         [None] * 5)

    def test_no_personal_columns_are_kept(self):
        # The school's own published phone and website are kept (099); head teachers' names never are.
        self.assertFalse({"HeadFirstName", "HeadLastName", "HeadTitle (name)", "HeadPreferredJobTitle"}
                         & set(profile.PROFILE_COLUMNS))

    def test_a_cut_without_the_099_columns_is_fetched_again(self):
        import tempfile, os
        with tempfile.TemporaryDirectory() as folder:
            with open(os.path.join(folder, "profile-20261015.csv"), "w") as handle:
                handle.write("URN,Gender (name),Trusts (code),Trusts (name),SchoolCapacity,NumberOfPupils,CensusDate\n")
            self.assertIsNone(profile.latest(folder))
            with open(os.path.join(folder, "profile-20261016.csv"), "w") as handle:
                handle.write(",".join(profile.PROFILE_COLUMNS) + "\n")
            self.assertTrue(profile.latest(folder).endswith("profile-20261016.csv"))

    def test_migration_099_adds_the_link_columns(self):
        migration = (ROOT / "migrations" / "099-school-profile-links.sql").read_text()
        for column in ("website text", "telephone text", "laestab text"):
            self.assertIn(f"ADD COLUMN IF NOT EXISTS {column}", migration)

    def test_profile_table_in_migration_055(self):
        migration = (ROOT / "migrations" / "055-school-card-full.sql").read_text()
        body = migration.split("CREATE TABLE IF NOT EXISTS school_profile (", 1)[1].split(");", 1)[0]
        for column in ("gender", "trust_code", "trust_name", "capacity", "pupils", "census_date",
                       "source_release_id"):
            self.assertIn(column, body)


if __name__ == "__main__":
    unittest.main()
