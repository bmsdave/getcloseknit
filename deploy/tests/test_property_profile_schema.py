"""Track K: migration 020 and the EPC extract keep only dwelling facts."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "migrations" / "020-property-profile.sql").read_text()
sys.path.insert(0, str(ROOT / "tools"))
import etl_epc  # noqa: E402


class MigrationTests(unittest.TestCase):
    def test_epc_table_stores_no_occupant_or_cost_fields(self):
        table = MIGRATION.split("CREATE TABLE IF NOT EXISTS property_epc", 1)[1].split(");", 1)[0]
        for word in ("tenure", "name", "cost", "address"):
            self.assertNotIn(word, table.lower())

    def test_type_prices_use_standard_sales_only(self):
        rebuild = MIGRATION.split("FUNCTION public.rebuild_area_type_prices", 1)[1]
        self.assertIn("s.ppd_category = 'A'", rebuild)

    def test_no_existing_table_is_altered(self):
        self.assertNotIn("ALTER TABLE", MIGRATION)
        self.assertNotIn("DROP TABLE", MIGRATION)


class ExtractTests(unittest.TestCase):
    def row(self, **extra):
        base = {"uprn": "000123", "local_authority": "E09000032", "lodgement_date": "2024-02-19",
                "current_energy_rating": "C", "potential_energy_rating": "B", "property_type": "Flat",
                "built_form": "NO DATA!", "construction_age_band": "England and Wales: 1900-1929",
                "total_floor_area": "52.0", "number_habitable_rooms": "3.0", "floor_level": "3",
                "tenure": "Rented (private)"}
        base.update(extra)
        return base

    def test_parse_row_cleans_fields_and_drops_tenure(self):
        parsed = etl_epc.parse_row(self.row())
        self.assertEqual(parsed, ("123", "2024-02-19", "C", "B", "Flat", None, "1900-1929", 52.0, 3, "Top floor"))
        self.assertEqual(len(parsed), len(etl_epc.COLUMNS))
        self.assertNotIn("Rented (private)", parsed)

    def test_parse_row_skips_outside_london_and_missing_uprn(self):
        self.assertIsNone(etl_epc.parse_row(self.row(local_authority="E07000001")))
        self.assertIsNone(etl_epc.parse_row(self.row(uprn="")))

    def test_floor_levels(self):
        cases = {"1": "Ground floor", "2": "Middle floor", "0": "Basement", "Ground": "Ground floor",
                 "mid floor": "Middle floor", "4th": "4th floor", "21st or above": "21st floor or above",
                 "NODATA!": None, "": None}
        for raw, expected in cases.items():
            self.assertEqual(etl_epc.floor_level(raw), expected, raw)


if __name__ == "__main__":
    unittest.main()
