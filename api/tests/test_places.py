"""Track H: stations, parks, amenities and the 1-10 connectivity score."""
import contextlib
import os
import unittest
from pathlib import Path

from area_api import evidence, places

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api.evidence import EvidenceReader
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

AREA = "uk:lsoa:E01000001"
TEST_DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")
OSM = {"id": "src-osm-places-2026-09-09", "licence": "ODbL-1.0", "attribution": "© OpenStreetMap contributors",
       "caveats": ["Places come from OpenStreetMap.", "Distances are straight lines."]}
TFL = {"id": "src-tfl-stoppoints-2026-10-05", "licence": "TfL", "attribution": "Powered by TfL Open Data",
       "caveats": ["Distances are straight lines.", "Zones are TfL's."]}
TUBE = {"id": "jubilee", "name": "Jubilee", "mode": "tube"}
STATIONS = [
    {"name": "Westminster", "modes": ["tube"], "zone": "1", "distance_metres": 300,
     "lines": [TUBE, {"id": "district", "name": "District", "mode": "tube"}], "bearing_degrees": 90},
    {"name": "Charing Cross", "modes": ["national-rail"], "zone": "1", "distance_metres": 1000, "bearing_degrees": None,
     "lines": [{"id": "southeastern", "name": "Southeastern", "mode": "national-rail"}]},
    {"name": "Far Away", "modes": ["tube"], "zone": "2", "distance_metres": 2500, "lines": [TUBE]},
]
PARKS = [{"name": "St James's Park", "kind": "park", "area_hectares": 23.0, "distance_metres": 0, "bearing_degrees": None},
         {"name": "Victoria Tower Gardens", "kind": "park", "area_hectares": 1.95, "distance_metres": 640,
          "bearing_degrees": 135}]
AMENITIES = [
    {"amenity_group": "groceries", "name": "Corner Shop", "kind": "convenience", "distance_metres": 120, "walk_count": 2,
     "bearing_degrees": 270},
    {"amenity_group": "groceries", "name": None, "kind": "supermarket", "distance_metres": 700, "walk_count": 2},
    {"amenity_group": "pubs", "name": "The Red Lion", "kind": "pub", "distance_metres": 950, "walk_count": 0},
    {"amenity_group": "gyms", "name": "PureGym", "kind": "gym", "distance_metres": 400, "walk_count": 3},
    {"amenity_group": "bars", "name": None, "kind": "bar", "distance_metres": 820, "walk_count": 0},
]


class FakeConnection:
    def __init__(self, releases=(OSM, TFL), homes=None):
        self.releases = list(releases)
        self.homes = homes or {}
        self.queries = []

    def execute(self, sql, params=()):
        tag = sql.splitlines()[0]
        self.queries.append((tag, params))
        if tag == "-- evidence:active-release":
            return [{"release_id": "rel-1"}]
        if tag == "-- places:area-origin":
            return [{"lon": -0.13, "lat": 51.5}] if params[0] == AREA else []
        if tag == "-- places:home-origin":
            return [self.homes[params[0]]] if params[0] in self.homes else []
        if tag == "-- places:releases":
            return self.releases
        if tag == "-- places:stations":
            return STATIONS
        if tag == "-- places:parks":
            return PARKS
        if tag == "-- places:amenities":
            return AMENITIES
        raise AssertionError(f"unexpected query {tag}")


def connector(connection):
    @contextlib.contextmanager
    def connect():
        yield connection
    return connect


class ConnectivityScoreTests(unittest.TestCase):
    # Same vectors as web/tests/places.test.ts: both sides must agree.
    def test_shared_vectors(self):
        tube = [{"mode": "tube"}]
        cases = [
            ([], 1),
            ([{"distanceMetres": 300, "lines": tube, "modes": ["tube"]}], 5),
            ([{"distanceMetres": 200, "lines": tube * 4, "modes": ["tube"]}], 8),
            ([{"distanceMetres": 1000, "lines": [{"mode": "national-rail"}], "modes": ["national-rail"]}], 2),
            ([{"distanceMetres": 1300, "lines": tube, "modes": ["tube"]}], 1),
            ([{"distanceMetres": 400, "lines": [], "modes": ["tram"]}], 4),
            ([{"distanceMetres": 100, "lines": tube * 9, "modes": ["tube"]}] * 3, 10),
        ]
        for stations, score in cases:
            self.assertEqual(places.connectivity(stations)["score"], score, stations)

    def test_closer_and_busier_stations_count_more(self):
        near = places.station_points(400, [{"mode": "tube"}], ["tube"])
        far = places.station_points(800, [{"mode": "tube"}], ["tube"])
        self.assertEqual(near, 1.0)
        self.assertAlmostEqual(far, 0.5)
        self.assertEqual(places.station_points(1201, [{"mode": "tube"}], ["tube"]), 0.0)
        self.assertEqual(places.station_points(0, [{"mode": "tube"}] * 9, ["tube"]), places.STATION_CAP)
        self.assertLess(places.station_points(0, [{"mode": "national-rail"}], []),
                        places.station_points(0, [{"mode": "overground"}], []))

    def test_score_stays_between_one_and_ten(self):
        self.assertEqual(places.connectivity_score(0), 1)
        self.assertEqual(places.connectivity_score(-1), 1)
        self.assertEqual(places.connectivity_score(1000), 10)


class SizeClassTests(unittest.TestCase):
    def test_london_plan_hierarchy(self):
        self.assertEqual(places.size_class(0.2), "pocket")
        self.assertEqual(places.size_class(0.4), "small")
        self.assertEqual(places.size_class(5), "local")
        self.assertEqual(places.size_class(23), "district")
        self.assertEqual(places.size_class(250), "metropolitan")
        self.assertEqual(places.size_class(860), "regional")
        self.assertIsNone(places.size_class(None))


class AreaPlacesTests(unittest.TestCase):
    def test_area_payload(self):
        payload = places.area_places(connector(FakeConnection()), AREA)
        self.assertEqual(payload["schemaVersion"], "area-places.v1")
        self.assertEqual(payload["origin"], {"kind": "area-centre", "uprn": None})
        self.assertTrue(payload["available"])
        self.assertEqual([s["name"] for s in payload["stations"]], ["Westminster", "Charing Cross", "Far Away"])
        self.assertEqual(payload["stations"][0]["lines"][0]["name"], "Jubilee")
        self.assertEqual(payload["connectivity"]["stationsCounted"], 2)
        # 2 tube lines at 300 m (2.0) + Southeastern at 1,000 m (0.25 x 0.6)
        self.assertEqual(payload["connectivity"]["points"], 2.15)
        self.assertEqual(payload["connectivity"]["score"], 6)
        self.assertEqual(payload["parks"][0]["sizeClass"], "district")
        self.assertEqual([g["group"] for g in payload["amenities"]], list(places.AMENITY_GROUPS))
        groceries, pubs, food = payload["amenities"][:3]
        self.assertEqual(groceries["countWithinWalk"], 2)
        self.assertEqual(groceries["nearest"][1], {"name": None, "kind": "supermarket", "distanceMetres": 700})
        self.assertEqual(pubs["countWithinWalk"], 0)
        self.assertEqual(food, {"group": "food", "countWithinWalk": 0, "nearest": []})
        lifestyle = {g["group"]: g for g in payload["amenities"][5:]}
        self.assertEqual(list(lifestyle), ["gyms", "pools", "cafes", "bars"])
        self.assertEqual(lifestyle["gyms"]["countWithinWalk"], 3)
        self.assertEqual(lifestyle["pools"], {"group": "pools", "countWithinWalk": 0, "nearest": []})
        self.assertEqual(lifestyle["bars"]["nearest"][0]["distanceMetres"], 820)
        self.assertEqual(payload["caveats"], ["Places come from OpenStreetMap.", "Distances are straight lines.",
                                              "Zones are TfL's."])
        self.assertEqual([s["id"] for s in payload["sources"]], [OSM["id"], TFL["id"]])

    def test_home_origin(self):
        connection = FakeConnection(homes={"100023336956": {"lon": -0.12, "lat": 51.49}})
        payload = places.area_places(connector(connection), AREA, "100023336956")
        self.assertEqual(payload["origin"], {"kind": "home", "uprn": "100023336956"})
        station_params = next(p for tag, p in connection.queries if tag == "-- places:stations")
        self.assertEqual((station_params["lon"], station_params["lat"]), (-0.12, 51.49))

    def test_nothing_loaded_is_unknown_not_zero(self):
        payload = places.area_places(connector(FakeConnection(releases=())), AREA)
        self.assertFalse(payload["available"])
        self.assertIsNone(payload["connectivity"])
        self.assertEqual((payload["stations"], payload["parks"], payload["amenities"]), ([], [], []))

    def test_errors(self):
        connect = connector(FakeConnection())
        with self.assertRaises(evidence.MalformedQuery):
            places.area_places(connect, "E01000001")
        with self.assertRaises(evidence.MalformedQuery):
            places.area_places(connect, AREA, "12a")
        with self.assertRaises(evidence.AreaNotFound):
            places.area_places(connect, "uk:lsoa:E01009999")
        with self.assertRaises(evidence.PropertyNotFound):
            places.area_places(connect, AREA, "999")
        with self.assertRaises(evidence.Cancelled):
            places.area_places(connect, AREA, cancel=lambda: True)


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class BearingTests(unittest.TestCase):
    """bearingDegrees: clockwise from north, from the origin to the place; absent when unknown."""

    def test_payload_carries_bearing_only_when_known(self):
        payload = places.area_places(connector(FakeConnection()), AREA)
        westminster, charing_cross, far_away = payload["stations"]
        self.assertEqual(westminster["bearingDegrees"], 90)
        self.assertNotIn("bearingDegrees", charing_cross)  # null location bearing
        self.assertNotIn("bearingDegrees", far_away)  # no column at all
        inside, gardens = payload["parks"]
        self.assertNotIn("bearingDegrees", inside)  # origin inside the park: no direction
        self.assertEqual(gardens["bearingDegrees"], 135)
        shop, unnamed = payload["amenities"][0]["nearest"]
        self.assertEqual(shop["bearingDegrees"], 270)
        self.assertNotIn("bearingDegrees", unnamed)

    def test_sql_measures_azimuth_from_the_origin(self):
        for sql in (places.STATIONS_SQL, places.PARKS_SQL, places.AMENITIES_SQL):
            self.assertIn("ST_Azimuth", sql)
            self.assertIn("bearing_degrees", sql)

    @unittest.skipUnless(TEST_DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a PostGIS database")
    def test_compass_directions_on_postgres(self):
        import psycopg
        from psycopg.rows import dict_row

        origin = {"lon": -0.1, "lat": 51.5}
        # TEMP tables shadow any real ones and vanish on close: nothing persists.
        with psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row, autocommit=False) as connection:
            connection.execute("CREATE TEMP TABLE place_station (name text, modes text[], zone text, lines jsonb,"
                               " location geometry(Point, 4326))")
            connection.execute("CREATE TEMP TABLE place_park (name text, kind text, area_hectares numeric,"
                               " geometry geometry(MultiPolygon, 4326))")
            connection.execute("CREATE TEMP TABLE place_amenity (id integer, amenity_group text, name text,"
                               " kind text, sport text, location geometry(Point, 4326))")
            connection.execute("INSERT INTO place_station VALUES"
                               " ('East', '{tube}', '1', '[]', ST_SetSRID(ST_MakePoint(-0.09, 51.5), 4326)),"
                               " ('North', '{tube}', '1', '[]', ST_SetSRID(ST_MakePoint(-0.1, 51.506), 4326))")
            connection.execute("INSERT INTO place_park VALUES"
                               " ('Around', 'park', 4, ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(-0.1, 51.5), 4326), 0.001))),"
                               " ('South', 'park', 1, ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(-0.1, 51.49), 4326), 0.001)))")
            connection.execute("INSERT INTO place_amenity VALUES"
                               " (1, 'pubs', 'West', 'pub', NULL, ST_SetSRID(ST_MakePoint(-0.105, 51.5), 4326))")
            stations = list(connection.execute(places.STATIONS_SQL, {**origin, "radius": 3000}))
            parks = list(connection.execute(places.PARKS_SQL, {**origin, "radius": 3000, "limit": 6}))
            amenities = list(connection.execute(places.AMENITIES_SQL, {**origin, "radius": 3000, "walk": 800,
                                                                       "limit": 5}))
            connection.rollback()

        bearing = {row["name"]: row["bearing_degrees"] for row in stations + parks + amenities}
        self.assertAlmostEqual(bearing["East"], 90, delta=1)
        self.assertIn(bearing["North"], (0, 359, 1))
        self.assertAlmostEqual(bearing["South"], 180, delta=1)
        self.assertAlmostEqual(bearing["West"], 270, delta=1)
        self.assertIsNone(bearing["Around"])  # the origin is inside: no direction

    @unittest.skipUnless(TEST_DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to run the PostGIS check")
    def test_lifestyle_groups_on_postgres(self):
        import psycopg
        from psycopg.rows import dict_row

        here = "ST_SetSRID(ST_MakePoint(-0.1, 51.5), 4326)"  # all at the origin, inside the walk
        far = "ST_SetSRID(ST_MakePoint(-0.1, 51.51), 4326)"  # about 1.1 km north: nearest only
        rows = [("food", "cafe", None, here), ("food", "restaurant", None, here), ("pubs", "bar", None, here),
                ("pubs", "pub", None, here), ("leisure", "gym", "fitness", here),
                ("leisure", "sports-centre", "tennis; fitness", here), ("leisure", "sports-centre", "fitness_station", here),
                ("leisure", "pool", "swimming;fitness", here), ("leisure", "pool", "swimming", far),
                ("leisure", "sports-club", "football", here), ("gps", "gp", None, far)]
        with psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row, autocommit=False) as connection:
            connection.execute("CREATE TEMP TABLE place_amenity (id integer, amenity_group text, name text,"
                               " kind text, sport text, location geometry(Point, 4326))")
            for index, (group, kind, sport, location) in enumerate(rows):
                connection.execute(f"INSERT INTO place_amenity VALUES (%s, %s, NULL, %s, %s, {location})",
                                   (index, group, kind, sport))
            amenities = list(connection.execute(places.AMENITIES_SQL, {"lon": -0.1, "lat": 51.5, "radius": 1500,
                                                                       "walk": 800, "limit": 5}))
            connection.rollback()

        groups = {g["group"]: g for g in places.places_payload(AREA, "rel-1", None, [OSM], [], [], amenities)["amenities"]}
        counts = {name: group["countWithinWalk"] for name, group in groups.items()}
        self.assertEqual(counts, {"groceries": 0, "pubs": 2, "food": 2, "pharmacies": 0, "gps": 0,
                                  "gyms": 3, "pools": 1, "cafes": 1, "bars": 1})
        self.assertEqual(len(groups["pools"]["nearest"]), 2)  # the far pool is listed, not counted
        self.assertGreater(groups["gps"]["nearest"][0]["distanceMetres"], 1000)


MIGRATION_054 = (Path(__file__).resolve().parents[2] / "deploy" / "migrations" / "054-area-london-rank.sql").read_text()


def rank_row(rank_id, percentile, value=1.0, detail=None, source="src-a"):
    return {"rank_id": rank_id, "value": value, "region_percentile": percentile, "ranked": 4994, "detail": detail,
            "source_release_id": source, "licence": "OGL-3.0", "attribution": "Someone"}


class LondonRanksTests(unittest.TestCase):
    """Migration 054's London percentiles: 0-100 or null, never a guessed score."""

    def test_every_rank_is_0_to_100_or_null(self):
        payload = places.london_ranks_payload([
            rank_row("quiet", 0), rank_row("station-walk", 100), rank_row("park-distance", 101),
            rank_row("best-primary", 92, 88.0, {"urn": 100447, "name": "St Peter", "distanceMetres": 831,
                                                "academicYear": "2024/25"}, "src-b"),
            rank_row("shops", 50)])
        self.assertEqual(set(payload), {"scope", "gettingAround", "quiet", "greenSpace", "bestPrimary", "sources"})
        self.assertEqual(payload["scope"], "london-lsoa")
        self.assertEqual(payload["quiet"]["percentile"], 0)
        self.assertFalse(payload["quiet"]["higherIsBetter"])
        self.assertEqual(payload["gettingAround"]["percentile"], 100)
        self.assertEqual(payload["gettingAround"]["unit"], "minutes")
        self.assertIsNone(payload["greenSpace"])  # out of range: dropped, not clamped
        primary = payload["bestPrimary"]
        self.assertTrue(primary["higherIsBetter"])
        self.assertEqual(primary["school"], {"urn": "100447", "name": "St Peter", "distanceMetres": 831,
                                             "academicYear": "2024/25"})
        for key in ("gettingAround", "quiet", "greenSpace", "bestPrimary"):
            item = payload[key]
            self.assertTrue(item is None or (isinstance(item["percentile"], int) and 0 <= item["percentile"] <= 100))
        self.assertEqual([s["id"] for s in payload["sources"]], ["src-a", "src-b"])

    def test_no_rows_means_every_rank_is_null(self):
        payload = places.london_ranks_payload([])
        self.assertEqual([payload[k] for k in ("gettingAround", "quiet", "greenSpace", "bestPrimary")], [None] * 4)
        self.assertEqual(payload["sources"], [])

    def test_only_lsoas_and_only_after_the_migration(self):
        class Conn:
            def __init__(self, table):
                self.table, self.tags = table, []

            def execute(self, sql, params=()):
                self.tags.append(sql.splitlines()[0])
                if sql.startswith("-- places:london-rank-table"):
                    return [{"t": self.table}]
                return [rank_row("quiet", 40)]
        self.assertIsNone(places.london_ranks(Conn(True), "uk:msoa:E02000001"))
        self.assertIsNone(places.london_ranks(Conn(False), AREA))
        self.assertEqual(places.london_ranks(Conn(True), AREA)["quiet"]["percentile"], 40)

    def test_migration_ranks_as_the_rest_of_the_api(self):
        from area_api import personal_places, schools

        for rank_id in places.LONDON_RANKS:
            self.assertIn(f"'{rank_id}'", MIGRATION_054)
        self.assertIn(f"o->>'measure' = '{personal_places.SCHOOL_MEASURES['primary']}'", MIGRATION_054)
        self.assertIn(f">= {personal_places.MIN_SCHOOL_COHORT}", MIGRATION_054)
        self.assertIn(f"area.point, {schools.PROFILE_RADIUS_METRES})", MIGRATION_054)
        self.assertIn("CHECK (london_percentile BETWEEN 0 AND 100)", MIGRATION_054)
        self.assertEqual(MIGRATION_054.count("percent_rank() OVER"), 3)
        self.assertIn("mv.london_percentile IS NOT NULL", MIGRATION_054)  # station-walk reuses the ETL percentile

    def test_releases_rebuild_the_migration(self):
        deploy = Path(__file__).resolve().parents[2] / "deploy"
        guarded = "to_regproc('public.rebuild_area_rank') IS NOT NULL"
        loaders = (deploy / "tools" / "stage_release.py", deploy / "tools" / "etl_noise.py",
                   deploy.parent / "pipelines" / "area-analytics-ingest" / "area_analytics" / "places_load.py")
        for loader in loaders:  # each rebuilds the ranks in the same transaction as its write
            text = loader.read_text()
            self.assertIn(guarded, text, loader.name)
            self.assertIn("SELECT rebuild_area_rank()", text, loader.name)

    @unittest.skipUnless(TEST_DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a PostGIS database with the schema")
    def test_migration_on_postgres(self):
        import psycopg
        from psycopg.rows import dict_row

        # One transaction, rolled back: the rows never persist. The ranks as the database builds them now
        # (054's function, renamed rebuild_area_rank by migration 121).
        with psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row, autocommit=False) as connection:
            connection.execute("SELECT rebuild_area_rank()")
            bounds = list(connection.execute(
                "SELECT rank_id, min(region_percentile) AS low, max(region_percentile) AS high FROM area_rank"
                " GROUP BY rank_id"))
            sample = connection.execute("SELECT geography_id FROM area_rank LIMIT 1").fetchone()
            ranks = places.london_ranks(connection, sample["geography_id"]) if sample else None
            connection.rollback()
        for row in bounds:
            self.assertGreaterEqual(row["low"], 0)
            self.assertLessEqual(row["high"], 100)
        if ranks:
            self.assertTrue(any(ranks[key] for key in ("gettingAround", "quiet", "greenSpace", "bestPrimary")))


    @unittest.skipUnless(TEST_DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a PostGIS database with schools")
    def test_best_schools_on_postgres(self):
        """Islington 013D (Highbury) has ranked state primaries and secondaries within 1 km:
        both best rows must come back, named, with a 0-100 percentile."""
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row, autocommit=False) as connection:
            release = connection.execute("SELECT release_id FROM active_product_release").fetchone()
            area = connection.execute(
                "SELECT id FROM area_geography WHERE id = 'uk:lsoa:E01002795' AND name = 'Islington 013D'").fetchone()
            if not (release and area):
                connection.rollback()
                self.skipTest("no active release or Islington 013D not loaded")
            best = places.best_school_ranks(connection, area["id"], release["release_id"])
            connection.rollback()
        for key in ("bestPrimary", "bestSecondary"):
            item = best[key]
            self.assertIsNotNone(item, key)
            self.assertTrue(item["school"]["name"], key)
            self.assertTrue(isinstance(item["percentile"], int) and 0 <= item["percentile"] <= 100, key)
            self.assertLessEqual(item["school"]["distanceMetres"], 1000, key)


class PlacesHttpTests(unittest.TestCase):
    def setUp(self):
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=connector(FakeConnection()))
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_round_trip_and_errors(self):
        ok = self.client.get(f"/api/v1/areas/{AREA}/places")
        unknown = self.client.get("/api/v1/areas/uk:lsoa:E01009999/places")
        no_home = self.client.get(f"/api/v1/areas/{AREA}/places", params={"uprn": "999"})
        malformed = self.client.get(f"/api/v1/areas/{AREA}/places", params={"uprn": "x"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["connectivity"]["score"], 6)
        self.assertEqual(unknown.json()["detail"]["error"], "area-not-found")
        self.assertEqual((no_home.status_code, no_home.json()["detail"]["error"]), (404, "property-not-found"))
        self.assertEqual(malformed.status_code, 400)


if __name__ == "__main__":
    unittest.main()
