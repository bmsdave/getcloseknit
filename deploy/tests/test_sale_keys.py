"""Building and street keys (migrations 013, 092): emitted parts normalise, keys stay
hashes, and load_sales fills them from the staged PAON and street. Migration 092
changed the building key to the postcode sector, so a tower whose flats are spread
over several unit postcodes is one building, not several (B5, #154)."""
import hashlib
import re
import sys
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / "tools"))

import etl_sales  # noqa: E402

MIGRATION = (DEPLOY / "migrations" / "092-building-key-sector.sql").read_text()
LOAD = re.sub(r"\s+", " ", MIGRATION.split("FUNCTION public.load_sales", 1)[1].split("$$;", 1)[0])
MIGRATION_013 = (DEPLOY / "migrations" / "013-sale-keys.sql").read_text()
# 097 (#163) redefines load_sales() with the SAON-aware building key; 013 and 092 stay as applied.
MIGRATION_097 = (DEPLOY / "migrations" / "097-load-sales-building-key.sql").read_text()
LOAD_097 = re.sub(r"\s+", " ", MIGRATION_097.split("FUNCTION public.load_sales", 1)[1].split("$$;", 1)[0])


class AddressPartTests(unittest.TestCase):
    def test_parts_are_upper_case_with_single_spaces(self):
        self.assertEqual(etl_sales.address_part("  12a,  "), "12A")
        self.assertEqual(etl_sales.address_part("St. John's  Wood   Road"), "ST JOHN'S WOOD ROAD")

    def test_missing_parts_are_empty(self):
        self.assertEqual(etl_sales.address_part(None), "")
        self.assertEqual(etl_sales.address_part("   "), "")

    def test_emitted_columns_end_with_the_key_parts(self):
        self.assertEqual(etl_sales.SALES_COLUMNS[-3:], ("paon", "saon", "street"))


class SaleKeyMigrationTests(unittest.TestCase):
    def test_columns_and_indexes_are_added(self):
        for column in ("building_key", "street_key"):
            self.assertIn(f"ADD COLUMN IF NOT EXISTS {column} text", MIGRATION_013)
            self.assertIn(f"ON sale ({column}, completion_date)", MIGRATION_013)

    def test_keys_are_hashes_of_the_documented_parts(self):
        self.assertIn("md5(left(s.postcode, length(s.postcode) - 2) "
                      "|| '|' || s.paon || '|' || coalesce(s.street, ''))", LOAD)
        self.assertIn("md5(s.street || '|' || msoa.parent_id)", LOAD)

    def test_street_key_needs_a_borough(self):
        self.assertIn("nullif(s.street, '') IS NOT NULL AND msoa.parent_id IS NOT NULL", LOAD)

    def test_address_text_is_not_stored(self):
        insert = LOAD.split("INSERT INTO sale (", 1)[1].split(")", 1)[0]
        self.assertNotIn("paon", insert)
        self.assertNotIn("street,", insert)


class TowerBuildingKeyTests(unittest.TestCase):
    TOWER_POSTCODES = ("E14 9PG", "E14 9GU", "E14 9XZ", "E14 9PR", "E14 9JQ")

    def test_full_unit_postcode_is_not_part_of_the_building_key(self):
        # One tower (PAON 10, MARSH WALL) with unit postcodes E14 9PG/9GU/9XZ/9PR/9JQ must be one building.
        self.assertNotIn("md5(s.postcode || '|' || s.paon", LOAD)

    def test_sector_key_unites_the_tower(self):
        """The sector formula from the migration: five unit postcodes, one key."""
        keys = {hashlib.md5(f"{postcode[:-2]}|10|MARSH WALL".encode()).hexdigest()
                for postcode in self.TOWER_POSTCODES}
        self.assertEqual(len(keys), 1)
        old = {hashlib.md5(f"{postcode}|10|MARSH WALL".encode()).hexdigest()
               for postcode in self.TOWER_POSTCODES}
        self.assertEqual(len(old), 5)


class BuildingKeyMigrationTests(unittest.TestCase):
    """Migration 097 (#163): a flat's SAON is dropped from the building key, a house's is kept."""

    def test_092_is_left_as_applied(self):
        self.assertNotIn("saon", LOAD)

    def test_building_key_keeps_the_sector_and_reads_the_saon_unless_it_names_a_flat(self):
        self.assertIn("md5(left(s.postcode, length(s.postcode) - 2) || '|' || s.paon || '|' "
                      "|| CASE WHEN s.saon ~* 'flat|apartment|maisonette|studio|penthouse|duplex|annexe?' "
                      "THEN '' ELSE coalesce(s.saon, '') END || '|' || coalesce(s.street, ''))", LOAD_097)
        self.assertNotIn("md5(s.postcode || '|' || s.paon", LOAD_097)
        self.assertIn("md5(s.street || '|' || msoa.parent_id)", LOAD_097)

    def test_flats_share_a_key_and_houses_split(self):
        """The 097 formula: a block's flats under one key, "1" and "1A" apart."""
        def key(saon):
            saon = "" if re.search(r"flat|apartment|maisonette|studio|penthouse|duplex|annexe?", saon, re.I) else saon
            return hashlib.md5(f"E14 9|10|{saon}|MARSH WALL".encode()).hexdigest()
        self.assertEqual(key("FLAT 1"), key("APARTMENT 2"))
        self.assertNotEqual(key(""), key("1A"))

    def test_address_text_is_not_stored(self):
        insert = LOAD_097.split("INSERT INTO sale (", 1)[1].split(")", 1)[0]
        for part in ("paon", "saon", "street,"):
            self.assertNotIn(part, insert)

    def test_staging_table_carries_the_saon(self):
        source = (DEPLOY / "tools" / "etl_sales.py").read_text()
        self.assertIn("paon text, saon text, street text)", source)


if __name__ == "__main__":
    unittest.main()
