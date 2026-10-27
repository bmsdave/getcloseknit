"""People and homes: shares against the area's own total, London as a marker, gaps stay unknown."""
import contextlib
import re
import unittest
from pathlib import Path

from area_api import evidence, people

POPULATION = {"population": 1520, "population_year": 2024, "area_km2": 0.38, "source_release_id": "src-pop",
              "london_density": 5775.4}


def census_rows(count=lambda index: 100 * (index + 1)):
    rows = []
    for topic in people.TOPIC_IDS:
        for index, category in enumerate(("a", "b")):
            value = count(index)
            rows.append({"topic": topic, "category": f"{topic}-{category}", "label": category.upper(),
                         "london_count": 3_000 * (2 - index), "count": value,
                         "source_release_id": None if value is None else "src-census"})
    return rows


class FakeConnection:
    def __init__(self, area=True, population=POPULATION, census=None):
        self.area, self.population = area, population
        self.census = census_rows() if census is None else census
        self.calls = []

    def execute(self, sql, params=()):
        marker = sql.splitlines()[0]
        self.calls.append((marker, params))
        if marker == "-- evidence:active-release":
            return [{"release_id": "rel-test"}]
        if marker == "-- people:area":
            return [{"id": params[0], "name": "Camden 001A", "kind": "lsoa"}] if self.area else []
        if marker == "-- people:population":
            return [self.population] if self.population else []
        if marker == "-- people:census":
            return self.census
        if marker == "-- people:sources":
            return [{"id": source, "attribution": f"{source} OGL", "caveats": ["c"]} for source in params[0]]
        raise AssertionError(f"unexpected query {marker}")


def read(connection, area_id="uk:lsoa:E01000001"):
    return people.area_people(lambda: contextlib.nullcontext(connection), area_id)


class PeoplePayloadTests(unittest.TestCase):
    def test_population_gives_density_and_the_london_marker(self):
        payload = read(FakeConnection())
        self.assertEqual(payload["schemaVersion"], "area-people.v1")
        self.assertEqual(payload["population"], {"residents": 1520, "year": 2024, "areaKm2": 0.38,
                                                 "densityPerKm2": 4000, "regionDensityPerKm2": 5775,
                                                 "sourceVersion": "src-pop"})

    def test_shares_use_the_topic_total_and_london_its_own(self):
        payload = read(FakeConnection())
        self.assertEqual([topic["id"] for topic in payload["topics"]], list(people.TOPIC_IDS))
        tenure = payload["topics"][people.TOPIC_IDS.index("tenure")]
        self.assertEqual(tenure["total"], 300)
        self.assertEqual([(c["count"], c["share"], c["regionShare"]) for c in tenure["categories"]],
                         [(100, 0.3333, 0.6667), (200, 0.6667, 0.3333)])

    def test_country_of_birth_regions_come_last_and_the_borough_countries_never(self):
        # TS004's world regions are per LSOA; TS012's countries exist for boroughs only and stay off the page.
        self.assertEqual(people.TOPIC_IDS[-1], "country-of-birth")
        self.assertNotIn("country-of-birth-detailed", people.TOPIC_IDS)
        rows = [{"topic": "country-of-birth", "category": "uk", "label": "United Kingdom", "london_count": 60,
                 "count": 30, "source_release_id": "src-census"},
                {"topic": "country-of-birth", "category": "eu8", "label": "EU8", "london_count": 40,
                 "count": 10, "source_release_id": "src-census"},
                {"topic": "country-of-birth-detailed", "category": "poland", "label": "Poland", "london_count": 17,
                 "count": 5, "source_release_id": "src-census"}]
        topics = people.topics_payload(rows)
        self.assertNotIn("country-of-birth-detailed", [topic["id"] for topic in topics])
        birth = topics[people.TOPIC_IDS.index("country-of-birth")]
        self.assertEqual((birth["total"], [c["share"] for c in birth["categories"]]), (40, [0.75, 0.25]))

    def test_age_and_household_type_follow_the_homes_topics(self):
        self.assertEqual(people.TOPIC_IDS[-3:-1], ("age", "household-type"))
        payload = read(FakeConnection())
        age = payload["topics"][people.TOPIC_IDS.index("age")]
        self.assertEqual(age["total"], 300)
        self.assertEqual([c["regionShare"] for c in age["categories"]], [0.6667, 0.3333])

    def test_web_topic_ids_mirror_the_api(self):
        source = (Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "people-profile.ts").read_text()
        block = source.split("PEOPLE_TOPIC_IDS = [", 1)[1].split("]", 1)[0]
        self.assertEqual(tuple(re.findall(r'"([a-z-]+)"', block)), people.TOPIC_IDS)

    def test_missing_counts_are_unknown_not_zero(self):
        payload = read(FakeConnection(population=None, census=census_rows(count=lambda index: None)))
        self.assertIsNone(payload["population"])
        for topic in payload["topics"]:
            self.assertIsNone(topic["total"])
            self.assertTrue(all(c["count"] is None and c["share"] is None for c in topic["categories"]))
            self.assertIsNotNone(topic["categories"][0]["regionShare"])
        self.assertEqual(payload["sources"], [])

    def test_sources_cover_both_releases(self):
        payload = read(FakeConnection())
        self.assertEqual([source["id"] for source in payload["sources"]], ["src-census", "src-pop"])

    def test_unknown_and_malformed_areas(self):
        with self.assertRaises(evidence.AreaNotFound):
            read(FakeConnection(area=False))
        with self.assertRaises(evidence.MalformedQuery):
            read(FakeConnection(), "E01000001")


try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class PeopleHttpTests(unittest.TestCase):
    def setUp(self):
        self.connection = FakeConnection()
        self._previous = app_module._reader
        app_module._reader = evidence.EvidenceReader(connect=lambda: contextlib.nullcontext(self.connection))
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_round_trip_and_errors(self):
        ok = self.client.get("/api/v1/areas/uk:msoa:E02000001/people")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["geographyId"], "uk:msoa:E02000001")
        self.assertEqual(self.client.get("/api/v1/areas/nope/people").status_code, 400)
        self.connection.area = False
        missing = self.client.get("/api/v1/areas/uk:lsoa:E01009999/people")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()["detail"]["error"], "area-not-found")

    def test_path_is_in_the_contract(self):
        path = app_module.app.openapi()["paths"]["/api/v1/areas/{area_id}/people"]
        self.assertNotIn("x-status", path)
        self.assertEqual(path["get"]["operationId"], "getAreaPeople")


if __name__ == "__main__":
    unittest.main()
