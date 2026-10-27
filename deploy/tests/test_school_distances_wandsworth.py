"""Wandsworth (212) adapter on an excerpt of the 2026 'How places were offered' PDFs."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "school_distances"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


def rows(offers):
    return [(o.school, o.rule, o.raw_value, o.all_offered) for o in offers]


from area_analytics.school_admissions.adapters import wandsworth  # noqa: E402


class WandsworthTests(unittest.TestCase):
    def test_primary_headings_tables_and_class_rows(self):
        got = rows(wandsworth.parse_primary(fixture("wandsworth-primary-2026.txt").split("\f")))
        self.assertIn(("ALBEMARLE PRIMARY SCHOOL", None, "All applicants offered", None), got)
        self.assertIn(("ALLFARTHING PRIMARY SCHOOL", None, "429m", None), got)
        self.assertIn(("BELLEVILLE WIX ACADEMY", "Bilingual", "140m", None), got)
        self.assertIn(("BELLEVILLE WIX ACADEMY", "English", "478m", None), got)

    def test_secondary_bands_feeders_and_open_places(self):
        got = rows(wandsworth.parse_secondary(fixture("wandsworth-secondary-2026.txt").split("\f")))
        self.assertIn(("ASHCROFT TECHNOLOGY ACADEMY", "Band A", "2659m", None), got)
        self.assertIn(("BOLINGBROKE ACADEMY", "Feeder Belleville", "805m", None), got)
        self.assertIn(("BOLINGBROKE ACADEMY", "Feeder Falconbrook", "all offered", None), got)
        self.assertIn(("BURNTWOOD SCHOOL", None, "All applicants offered", None), got)
        # the distance tie-break inside Burntwood's selective test score is not a last-offer distance
        self.assertFalse([r for r in got if r[0] == "BURNTWOOD SCHOOL" and "3204" in r[2]])


if __name__ == "__main__":
    unittest.main()
