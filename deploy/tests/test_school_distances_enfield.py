"""Enfield (308) adapter on excerpts of the 2025 reception and 2019-22 secondary breakdowns."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "school_distances"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


from area_analytics.school_admissions.adapters import enfield  # noqa: E402


def section(name: str, year: int, phase: str):
    return enfield._section([(1, line) for line in fixture(name).splitlines()], year, phase)


class EnfieldTests(unittest.TestCase):
    def test_primary_table_wrapped_names_and_demand_met_list(self):
        got = {o.school: o for o in enfield.parse_primary(section("enfield-primary-2025.txt", 2025, "primary"))}
        hadley = got["Hadley Wood"]
        self.assertEqual((hadley.raw_value, hadley.applicants, hadley.refused), ("1.757", 94, 8))
        self.assertEqual(got["Enfield Heights Academy"].raw_value, "0.399")
        self.assertTrue(got["Alma"].all_offered)
        self.assertTrue(got["Worcesters"].all_offered)
        self.assertIn("Woodpecker Hall Academy", got)

    def test_secondary_rows_names_around_rows_and_all_offered(self):
        got = {o.school: o for o in enfield.parse_secondary(section("enfield-secondary-2019.txt", 2019, "secondary"))}
        keats = got["Ark John Keats Academy"]
        self.assertEqual((keats.raw_value, keats.refused), ("0.360", 484))
        self.assertEqual(got["Heron Hall Academy"].raw_value, "1.408")  # name printed above its row
        self.assertTrue(got["Bishop Stopford's School"].all_offered)
        self.assertNotIn("Enfield County School for Girls", got)  # quota prose is not read

    def test_a_missing_year_is_refused(self):
        with self.assertRaises(ValueError):
            section("enfield-primary-2025.txt", 2024, "primary")


if __name__ == "__main__":
    unittest.main()
