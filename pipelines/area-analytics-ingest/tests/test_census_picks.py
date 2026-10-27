"""Detailed Census categories published as layers: every leaf with FLOOR London residents, one list for
the ETL (json) and the web (ts)."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from area_analytics import census_people as people, census_picks

from test_census_people import nomis_zip


class CensusPicksTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        census = Path(self.tmp.name) / "census"
        census.mkdir()
        tables = {(topic.table, topic.geography) for topic in people.TOPICS if topic.leaves} | {("ts012", "ltla")}
        for table, geography in tables:
            (census / f"census2021-{table}.zip").write_bytes(nomis_zip(table, geography=geography).getvalue())

    def build(self, floor):
        with mock.patch.object(census_picks, "FLOOR", floor):
            return {entry["topic"]: entry for entry in census_picks.build(self.tmp.name)}

    def test_every_leaf_over_the_floor_is_a_pick_with_its_words(self):
        built = self.build(1)
        ethnic = {pick["category"]: pick for pick in built["ethnicity-detailed"]["picks"]}
        self.assertEqual((ethnic["asian-japanese"]["label"], ethnic["asian-japanese"]["words"]), ("Japanese (Asian)", "Asian: Japanese"))
        self.assertEqual(built["ethnicity-detailed"]["prefix"], "census-ethnic-")
        self.assertEqual(built["ethnicity-detailed"]["geography"], "msoa")
        countries = {pick["category"]: pick for pick in built["country-of-birth-extended"]["picks"]}
        self.assertEqual(countries["japan"]["words"], "born in Japan")
        arrival = [pick["label"] for pick in built["year-of-arrival"]["picks"]]
        self.assertEqual(arrival[:3], ["Born in the UK", "Before 1951", "1951–1960"])
        self.assertEqual(built["main-language"]["universe"], "residents aged 3+")
        # Detailed religion keeps only what TS030 lacks.
        beliefs = [pick["category"] for pick in built["religion-detailed"]["picks"]]
        self.assertNotIn("christian", beliefs)
        self.assertNotIn("no-religion", beliefs)
        self.assertTrue(set(beliefs) <= {key for key, _label, path in people.leaf_paths(
            next(t for t in people.TOPICS if t.id == "religion-detailed"), nomis_zip("ts031", geography="msoa")) if ": " in path})

    def test_the_floor_counts_london_only(self):
        # The fixtures hold two London areas: City of London 001 has 58 Asian Japanese residents.
        built = self.build(1000)
        self.assertNotIn("asian-japanese", [pick["category"] for pick in built["ethnicity-detailed"]["picks"]])
        self.assertIn("white-english-welsh-scottish-northern-irish-or-british",
                      [pick["category"] for pick in built["ethnicity-detailed"]["picks"]])

    def test_typescript_lists_the_ids_and_the_picks(self):
        text = census_picks.typescript(list(self.build(1).values()))
        self.assertIn('  "census-ethnic-asian-japanese",', text)
        self.assertIn('["asian-japanese", "Japanese (Asian)", "Asian: Japanese", ', text)
        self.assertIn("] as const;", text)


if __name__ == "__main__":
    unittest.main()
