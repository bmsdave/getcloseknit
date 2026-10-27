"""ONS API extracts (country of birth 190, main language 26): the coverage's areas in batches, written as a
Nomis-shaped zip that census_people reads like a bulk table."""

import tempfile
import unittest
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from area_analytics import census_api, census_people as people, coverage

from test_census_people import nomis_zip


def answer(codes: list[str], dimension: str) -> dict:
    """An API answer: every area with two categories and the "Does not apply" row."""
    names = {"E02000001": "City of London 001", "E02000002": "Barking and Dagenham 001",
             "E02002483": "Hartlepool 001",
             "E01000001": "City of London 001A", "E01000002": "City of London 001B"}
    observations = []
    for number, code in enumerate(codes):
        area = {"option_id": code, "option": names[code]}
        for option_id, option, count in (("-8", "Does not apply", 0), ("1", "Europe: United Kingdom: England", 10 + number),
                                         ("2", "Middle East and Asia: Eastern Asia: Japan", 2)):
            observations.append({"dimensions": [area, {"option_id": option_id, "option": option}], "observation": count})
    return {"observations": observations}


class CensusApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        census = Path(self.tmp.name) / "census"
        census.mkdir()
        for table, geography in (("ts012", "ltla"), ("ts022", "msoa"), ("ts021", "lsoa")):
            (census / f"census2021-{table}.zip").write_bytes(nomis_zip(table, geography=geography).getvalue())

    def test_covered_areas_follow_the_coverage(self):
        # Hartlepool 001 is in the TS022 fixture: in England (North East), not in London.
        london = {"E02000001": "City of London 001", "E02000002": "Barking and Dagenham 001"}
        self.assertEqual(census_api.covered_areas("msoa", self.tmp.name, coverage.LONDON), london)
        self.assertEqual(census_api.covered_areas("msoa", self.tmp.name, coverage.ENGLAND),
                         {**london, "E02002483": "Hartlepool 001"})

    def test_fetch_writes_a_zip_census_people_reads(self):
        asked = []

        def get(url):
            query = parse_qs(urlparse(url).query)
            geography, *codes = query["area-type"][0].split(",")
            asked.append((geography, codes, query["dimensions"][0]))
            return answer(codes, query["dimensions"][0])

        census_api.fetch(self.tmp.name, get, coverage.ENGLAND)
        self.assertEqual(asked[0], ("msoa", ["E02000001", "E02000002", "E02002483"], "country_of_birth_190a"))
        self.assertEqual(asked[1][2], "main_language_detailed_26a")
        topic = next(topic for topic in people.TOPICS if topic.id == "country-of-birth-extended")
        path = Path(self.tmp.name) / "census" / "census2021-cob190.zip"
        rows = people.read_topic(topic, str(path))
        self.assertEqual(rows["E02000001"], {"england": 10, "japan": 2})
        self.assertEqual(rows["E02000002"], {"england": 11, "japan": 2})
        with zipfile.ZipFile(path) as archive:
            header = archive.read("census2021-cob190-msoa.csv").decode().splitlines()[0]
        self.assertNotIn("Does not apply", header)

    def test_a_missing_area_stops_the_fetch(self):
        with self.assertRaisesRegex(ValueError, "london areas missing"):
            census_api.fetch(self.tmp.name, lambda url: answer(["E02000001"], "x"), cov=coverage.LONDON)


if __name__ == "__main__":
    unittest.main()
