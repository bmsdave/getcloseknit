"""The site's one Search (/api/v1/search?scope=all): areas and homes, then schools, stations and parks,
each row with its kind; plain /api/v1/search keeps its rows and gains only `kind`."""
import unittest

from fastapi.testclient import TestClient

from area_api import app as app_module
from area_api import kinds
from area_api.evidence import EvidenceReader
from tests.test_production_evidence import OLD_RELEASE, seed_production_fixture

STATION_RELEASE = "src-osm-station-access-2026-09"
LSOA = "uk:lsoa:E01000004"
# Points the fake places in LSOA; anything east of -0.10 is outside London's LSOAs.
INSIDE = (-0.14, 51.54)


class SiteConnection:
    """The production fixture plus school, park and point-in-LSOA reads."""

    def __init__(self, base):
        self.base = base
        self.schools = []
        self.parks = []

    def __getattr__(self, name):
        return getattr(self.base, name)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- evidence:school-search":
            needle = params[0].strip("%").lower()
            return [row for row in self.schools if needle in row["name"].lower()][:params[1]]
        if marker == "-- evidence:park-search":
            needle = params[0].strip("%").lower()
            return [row for row in self.parks if needle in row["name"].lower()][:params[2]]
        if marker == "-- evidence:point-lsoas":
            return [{"i": index + 1, "geography_id": LSOA, "borough": "Camden"}
                    for index, lon in enumerate(params[0]) if lon < -0.10]
        return self.base.execute(sql, params)


class SiteSearchTests(unittest.TestCase):
    def setUp(self):
        base = seed_production_fixture()
        base.members[OLD_RELEASE].append(STATION_RELEASE)
        base.stations["osm:n1"] = {"id": "osm:n1", "name": "Camden Town", "modes": ["underground"],
                                   "center_lon": INSIDE[0], "center_lat": INSIDE[1],
                                   "source_release_id": STATION_RELEASE}
        base.stations["osm:n2"] = {"id": "osm:n2", "name": "Camden Far", "modes": ["rail"],
                                   "center_lon": 0.2, "center_lat": 51.5, "source_release_id": STATION_RELEASE}
        # The TfL/NaPTAN station rows the hits read (#241); the walk-table rows above give their ids.
        base.place_stations["n1"] = {"id": "n1", "osm_ids": ["n1"], "name": "Camden Town", "modes": ["tube"],
                                     "zone": "2", "lines": [], "center_lon": INSIDE[0], "center_lat": INSIDE[1]}
        base.place_stations["n2"] = {"id": "n2", "osm_ids": ["n2"], "name": "Camden Far", "modes": ["national-rail"],
                                     "zone": None, "lines": [], "center_lon": 0.2, "center_lat": 51.5}
        self.connection = SiteConnection(base)
        self.connection.schools = [{"urn": "100100", "name": "Camden School for Girls", "phase": "secondary",
                                    "longitude": INSIDE[0], "latitude": INSIDE[1]}]
        self.connection.parks = [{"id": "w1", "name": "Camden Square", "kind": "garden",
                                  "center_lon": INSIDE[0], "center_lat": INSIDE[1]}]
        self.reader = EvidenceReader(connect=lambda: self.connection)

    def test_area_rows_name_their_kind(self):
        rows = self.reader.search_areas("camden")["results"]
        self.assertTrue(rows)
        # The area's level: lad for an id that still says uk:lad: (kinds, step R1).
        self.assertEqual({kinds.kind_of(row["geographyId"]) for row in rows}, {row["kind"] for row in rows})
        self.assertIn("lad", {row["kind"] for row in rows})
        self.assertFalse([row for row in rows if row["kind"] in ("school", "station", "place")])

    def test_site_search_adds_schools_stations_and_parks_inside_london(self):
        rows = self.reader.search_site("camden")["results"]
        extra = [row for row in rows if row["kind"] in ("school", "station", "place")]
        self.assertEqual([(row["kind"], row["label"], row["secondaryLabel"], row["geographyId"]) for row in extra], [
            ("school", "Camden School for Girls", "Secondary · Camden", LSOA),
            ("station", "Camden Town", "Tube · Camden", LSOA),
            ("place", "Camden Square", "Garden · Camden", LSOA),
        ])
        self.assertEqual(extra[0]["urn"], "100100")
        self.assertEqual(extra[1]["stationId"], "osm:n1")
        self.assertEqual(extra[2]["placeId"], "w1")
        # Areas and homes come first, as plain search gives them.
        self.assertEqual(rows[:len(rows) - 3], self.reader.search_areas("camden")["results"])

    def test_station_rows_name_their_tfl_lines(self):
        # Lines tell twin stations apart (#241); a station TfL lists no line for falls back to its modes.
        self.connection.base.place_stations["n3"] = {
            "id": "n3", "osm_ids": ["n3"], "name": "Camden Road", "modes": ["overground"], "zone": "2",
            "lines": [{"id": "mildmay", "name": "Mildmay", "mode": "overground"}],
            "center_lon": INSIDE[0], "center_lat": INSIDE[1]}
        rows = self.reader.search_site("camden")["results"]
        self.assertEqual([(row["label"], row["secondaryLabel"], row["stationId"])
                          for row in rows if row["kind"] == "station"],
                         [("Camden Road", "Mildmay · Camden", "osm:n3"), ("Camden Town", "Tube · Camden", "osm:n1")])

    def test_short_queries_skip_schools_and_parks(self):
        rows = self.reader.search_site("ca")["results"]
        self.assertFalse([row for row in rows if row["kind"] in ("school", "place")])

    def test_http_scope_all_uses_site_search(self):
        app_module._reader = self.reader
        try:
            client = TestClient(app_module.app)
            plain = client.get("/api/v1/search", params={"q": "camden"}).json()["results"]
            every = client.get("/api/v1/search", params={"q": "camden", "scope": "all"}).json()["results"]
            bad = client.get("/api/v1/search", params={"q": "camden", "scope": "nope"})
        finally:
            app_module._reader = None
        self.assertNotIn("station", {row["kind"] for row in plain})
        self.assertIn("station", {row["kind"] for row in every})
        self.assertEqual(bad.status_code, 422)


if __name__ == "__main__":
    unittest.main()
