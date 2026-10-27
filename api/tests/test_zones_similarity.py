"""Zones and similar areas: zones expand to LSOAs and are the Where criterion of My match (v4 Task 8): fit 1
inside, falling with distance outside, a filter only when it is a Must; similar areas compare crime, deprivation,
income, price level and station access percentiles only."""
import json
import unittest
import unittest.mock

from area_api import similarity, zones
from area_api.evidence import AreaNotFound, MalformedQuery
from area_api.matching import (InvalidMatchRequest, apply_relaxation, build_match_pack,
                               describe_unmet_limits, validate_match_request)
from area_api.repository import zone_lsoas
from tests.test_production_evidence import OLD_RELEASE, _geography, make_reader, seed_production_fixture

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

try:
    from area_api import tools
except ImportError:  # pragma: no cover
    tools = None

STATION_RELEASE = "src-osm-station-access-2026-09"
NEAR, MID, FAR = "uk:lsoa:E01000004", "uk:lsoa:E01000005", "uk:lsoa:E01000006"
STATION = {"kind": "station", "stationId": "osm:n5614077964", "maxWalkMinutes": 10, "label": "Oxford Circus"}


def _profile(zones=None, **extra):
    profile = {
        "schemaVersion": "preference-profile.v1", "market": "buy",
        "targetBudget": 300_000, "maximumBudget": 500_000,
        "factors": [{"factorId": "crime", "weight": 4, "direction": "lower",
                     "minimumUtility": None, "maximumUtility": None}],
        "commuteDestinations": [], **extra,
    }
    if zones is not None:
        profile["zones"] = zones
    return profile


def _row(geography_id, name, factor_id, utility, raw_value=None, unit="per 1,000"):
    return {
        "geography_id": geography_id, "name": name, "factor_id": factor_id,
        "raw_value": utility if raw_value is None else raw_value, "utility": utility,
        "unit": unit, "carrier_geography_id": geography_id, "quality": "observed",
        "source_release_id": "police-2026-06",
    }


def _crime_rows():
    # NEAR and FAR tie on crime; MID is the clear leader.
    return [_row(NEAR, "Near", "crime", 40), _row(MID, "Mid", "crime", 10), _row(FAR, "Far", "crime", 40)]


class ZoneValidationTests(unittest.TestCase):
    def test_valid_zones_pass_and_absent_zones_are_optional(self):
        validate_match_request(_profile())
        validate_match_request(_profile([]))
        validate_match_request(_profile([
            STATION, {"kind": "borough", "id": "uk:lad:E09000007"},
            {"kind": "lsoas", "ids": [NEAR, MID]},
        ]))

    def test_malformed_zones_are_rejected(self):
        bad = [
            "not a list",
            [STATION] * 4,
            [{"kind": "postcode", "id": "SW1A"}],
            [{**STATION, "maxWalkMinutes": 4}],
            [{**STATION, "maxWalkMinutes": 31}],
            [{**STATION, "maxWalkMinutes": True}],
            [{**STATION, "stationId": "940GZZLUOXC"}],
            [{**STATION, "extra": 1}],
            [{**STATION, "label": "x" * 81}],
            [{"kind": "borough", "id": "uk:lsoa:E01000004"}],
            [{"kind": "lsoas", "ids": []}],
            [{"kind": "lsoas", "ids": [f"uk:lsoa:E01{index:06d}" for index in range(51)]}],
            [{"kind": "lsoas", "ids": [NEAR, NEAR]}],
            [{"kind": "lsoas", "ids": ["uk:msoa:E02000004"]}],
        ]
        for zones in bad:
            with self.subTest(zones=str(zones)[:60]):
                with self.assertRaises(InvalidMatchRequest):
                    validate_match_request(_profile(zones))


class ZoneMatchingTests(unittest.TestCase):
    def test_no_zones_leave_the_pack_unchanged(self):
        pack = build_match_pack(_profile(), _crime_rows())
        self.assertTrue(all("inZone" not in value for value in pack["values"]))
        self.assertFalse(any(value["excluded"] for value in pack["values"]))

    def test_v1_zones_become_the_first_ranked_criterion(self):
        pack = build_match_pack(_profile([STATION]), _crime_rows(), zone_lsoas={NEAR})
        by_id = {value["geographyId"]: value for value in pack["values"]}

        self.assertEqual([item["id"] for item in pack["criteria"]], ["zone", "crime"])
        self.assertEqual(by_id[NEAR]["score"], 100)
        self.assertTrue(by_id[NEAR]["inZone"])
        # Outside, with no distances known: beyond the soft edge, fit 0: scored low (red), never out.
        for outside in (MID, FAR):
            self.assertFalse(by_id[outside]["excluded"])
            self.assertEqual(by_id[outside]["score"], 0)
            self.assertFalse(by_id[outside]["inZone"])
        self.assertEqual(pack["values"][0]["geographyId"], NEAR)

    def test_the_fit_falls_with_distance_outside(self):
        pack = build_match_pack(_profile([STATION]), _crime_rows(), zone_lsoas={NEAR},
                                zone_distance={NEAR: 0, MID: 500, FAR: 2500})
        by_id = {value["geographyId"]: value for value in pack["values"]}
        where = next(c for c in by_id[MID]["components"] if c["factorId"] == "zone")
        self.assertEqual((where["rawValue"], where["fit"], where["fitKind"]), (500, 0.5, "edge"))
        # Where first (0.75), crime second (0.25, fit 1): 0.5^0.75 = 0.5946.
        self.assertEqual([by_id[area]["score"] for area in (NEAR, MID, FAR)], [100, 59, 0])
        self.assertEqual([value["geographyId"] for value in pack["values"]], [NEAR, MID, FAR])
        self.assertEqual(pack["bottom"][0]["geographyId"], FAR)
        self.assertEqual(pack["bottom"][0]["weakest"], ["zone"])

    def test_a_must_where_is_a_filter_and_relaxes(self):
        profile = {"schemaVersion": "preference-profile.v2", "market": "buy", "targetBudget": 300_000,
                   "maximumBudget": 500_000, "criteria": [
                       {"kind": "where", "zones": [STATION], "must": True},
                       {"kind": "range", "layer": "crime", "scale": "percentile", "max": 50, "softMax": 75}]}
        validate_match_request(profile)
        rows = [{**row, "factor_id": "range:crime"} for row in _crime_rows()]
        pack = build_match_pack(profile, rows, zone_lsoas={NEAR})
        by_id = {value["geographyId"]: value for value in pack["values"]}
        self.assertFalse(by_id[NEAR]["excluded"])
        for outside in (MID, FAR):
            self.assertEqual(by_id[outside]["unmetLimits"], ["zone:outside"])
            self.assertIsNone(by_id[outside]["score"])
        self.assertEqual(describe_unmet_limits(by_id[MID], profile), ["Outside the zones you chose"])
        relaxed = {v["geographyId"]: v for v in apply_relaxation(pack, ["zone"], profile)["values"]}
        self.assertFalse(any(value["excluded"] for value in relaxed.values()))
        self.assertEqual(relaxed[MID]["score"], 100)  # a Must carries no weight

    def test_an_empty_must_zone_excludes_everything(self):
        profile = {"schemaVersion": "preference-profile.v2", "market": "buy", "targetBudget": 300_000,
                   "maximumBudget": 500_000, "criteria": [{"kind": "where", "zones": [STATION], "must": True}]}
        pack = build_match_pack(profile, _crime_rows(), zone_lsoas=set())
        self.assertTrue(all(value["excluded"] for value in pack["values"]))

    def test_zone_distances_reach_the_nearest_area_inside(self):
        from area_api.match_model import zone_distances

        points = {"in": (51.5, -0.1), "near": (51.509, -0.1), "far": (51.6, -0.1)}
        distances = zone_distances({"in"}, points, 1000)
        self.assertEqual(distances["in"], 0)
        self.assertEqual(distances["near"], 995)  # 0.009 degrees of latitude
        self.assertEqual(distances["far"], 3000)  # capped at three soft edges


class ZoneExpansionTests(unittest.TestCase):
    def setUp(self):
        self.connection = seed_production_fixture()
        self.connection.members[OLD_RELEASE].append(STATION_RELEASE)
        self.connection.station_walks = [
            {"geography_id": NEAR, "station_id": STATION["stationId"], "median_minutes": 6.0,
             "source_release_id": STATION_RELEASE},
            {"geography_id": MID, "station_id": STATION["stationId"], "median_minutes": 14.0,
             "source_release_id": STATION_RELEASE},
        ]

    def test_zones_expand_to_lsoas(self):
        self.assertIsNone(zone_lsoas(self.connection, []))
        self.assertEqual(zone_lsoas(self.connection, [STATION]), {NEAR})
        self.assertEqual(zone_lsoas(self.connection, [{**STATION, "maxWalkMinutes": 15}]), {NEAR, MID})
        self.assertEqual(zone_lsoas(self.connection, [{"kind": "borough", "id": "uk:lad:E09000007"}]),
                         {NEAR, MID})
        self.assertEqual(zone_lsoas(self.connection, [{"kind": "lsoas", "ids": [FAR]}, STATION]), {NEAR, FAR})

    def test_station_walks_outside_the_active_release_do_not_count(self):
        self.connection.members[OLD_RELEASE].remove(STATION_RELEASE)
        self.assertEqual(zone_lsoas(self.connection, [STATION]), set())


def _seed_similarity(connection):
    connection.geographies[FAR] = _geography(FAR, "lsoa", "E01000006", "Elsewhere 001A", None, -0.1, 51.5)
    connection.geographies["uk:lsoa:E01000007"] = _geography(
        "uk:lsoa:E01000007", "lsoa", "E01000007", "Elsewhere 002A", None, -0.1, 51.5)
    vectors = {
        NEAR: ("Camden 001A test area", {"crime": 30, "deprivation": 70, "income": 80,
                                         "market-level": (80, 9000), "station-access": 20}),
        MID: ("Camden 002A test area", {"crime": 35, "deprivation": 65, "income": 80,
                                        "market-level": (85, 9500), "station-access": 25}),
        FAR: ("Elsewhere 001A", {"crime": 32, "deprivation": 70, "income": 78,
                                 "market-level": (60, 7000), "station-access": 30, "social-renting": 90}),
        "uk:lsoa:E01000007": ("Elsewhere 002A", {"crime": 90, "deprivation": 10, "income": 20,
                                                 "market-level": (10, 4000), "station-access": 90}),
    }
    connection.match_rows = []
    for geography_id, (name, factors) in vectors.items():
        for factor_id, value in factors.items():
            utility, raw = value if isinstance(value, tuple) else (value, None)
            connection.match_rows.append(_row(geography_id, name, factor_id, utility, raw))


class SimilarAreaTests(unittest.TestCase):
    def setUp(self):
        self.connection = seed_production_fixture()
        _seed_similarity(self.connection)
        self.reader = make_reader(self.connection)

    def test_nearest_areas_by_percentile_distance(self):
        payload = self.reader.get_similar_areas(NEAR)

        self.assertEqual(payload["schemaVersion"], "similar-areas.v1")
        self.assertEqual(payload["factors"], list(similarity.SIMILARITY_FACTORS))
        ids = [value["geographyId"] for value in payload["values"]]
        self.assertEqual(ids, [MID, FAR, "uk:lsoa:E01000007"])
        self.assertNotIn(NEAR, ids)
        self.assertGreater(payload["values"][0]["similarity"], payload["values"][-1]["similarity"])
        self.assertNotIn("social-renting", {c["factorId"] for v in payload["values"] for c in v["components"]})

    def test_cheaper_keeps_a_lower_market_level(self):
        payload = self.reader.get_similar_areas(NEAR, cheaper=True)
        self.assertEqual([value["geographyId"] for value in payload["values"]], [FAR, "uk:lsoa:E01000007"])
        self.assertTrue(any("Cheaper means" in caveat for caveat in payload["caveats"]))

    def test_outside_zones_drops_areas_inside_them(self):
        zones = json.dumps([{"kind": "borough", "id": "uk:lad:E09000007"}])
        payload = self.reader.get_similar_areas(FAR, outside_zones=zones)
        self.assertTrue(payload["outsideZones"])
        self.assertEqual([value["geographyId"] for value in payload["values"]], ["uk:lsoa:E01000007"])

    def test_social_renting_only_on_request(self):
        payload = self.reader.get_similar_areas(FAR, social_renting=True)
        self.assertIn("social-renting", payload["factors"])

    def test_results_are_capped(self):
        areas = {f"uk:lsoa:E01{index:06d}": {"name": str(index), "factors": {
            factor: {"rawValue": index, "utility": float(index), "unit": "u"}
            for factor in similarity.SIMILARITY_FACTORS}} for index in range(30)}
        self.assertEqual(len(similarity.similar_areas("uk:lsoa:E01000000", areas, similarity.SIMILARITY_FACTORS)),
                         similarity.MAX_RESULTS)

    def test_payload_counts_candidates_before_the_cheaper_filter(self):
        # #242: find_similar_areas needs to say how many similar areas the cheaper filter dropped.
        payload = self.reader.get_similar_areas(NEAR)
        self.assertEqual(payload["candidates"]["similar"], len(payload["values"]))
        cheaper = self.reader.get_similar_areas(NEAR, cheaper=True)
        self.assertEqual(cheaper["candidates"], payload["candidates"])
        self.assertEqual(cheaper["candidates"]["cheaper"], len(cheaper["values"]))
        self.assertLess(len(cheaper["values"]), len(payload["values"]))

    def test_bad_requests(self):
        with self.assertRaises(MalformedQuery):
            self.reader.get_similar_areas("uk:msoa:E02000004")
        with self.assertRaises(MalformedQuery):
            self.reader.get_similar_areas(NEAR, outside_zones="[{\"kind\": \"postcode\"}]")
        with self.assertRaises(MalformedQuery):
            self.reader.get_similar_areas(NEAR, outside_zones="not json")
        with self.assertRaises(AreaNotFound):
            self.reader.get_similar_areas("uk:lsoa:E01999999")

    def test_wording_never_ranks_neighbourhoods(self):
        text = json.dumps(self.reader.get_similar_areas(NEAR)).lower()
        self.assertNotIn("best", text)
        self.assertNotIn("ethnic", text)


class StationSearchTests(unittest.TestCase):
    def setUp(self):
        self.connection = seed_production_fixture()
        self.connection.members[OLD_RELEASE].append(STATION_RELEASE)
        # Walk-table rows (migration 012): the ids find_areas.near_stations takes. Old Street's is
        # outside the active release.
        self.connection.stations = {
            "osm:n5614077964": {"id": "osm:n5614077964", "name": "Oxford Circus", "modes": ["underground"],
                                "center_lon": -0.1415, "center_lat": 51.5152, "source_release_id": STATION_RELEASE},
            "osm:n1": {"id": "osm:n1", "name": "Old Street", "modes": ["underground", "rail"],
                       "center_lon": -0.0876, "center_lat": 51.5257, "source_release_id": "unreleased"},
        }
        # TfL/NaPTAN rows (migration 017): what the hits are made of (#241).
        self.connection.place_stations = {
            "n5614077964": self.place("n5614077964", "Oxford Circus", ["tube"], "1", [
                ("bakerloo", "Bakerloo", "tube"), ("central", "Central", "tube"), ("victoria", "Victoria", "tube")],
                -0.1415, 51.5152),
            "n1": self.place("n1", "Old Street", ["tube", "national-rail"], "1", [
                ("northern", "Northern", "tube"), ("great-northern", "Great Northern", "national-rail")],
                -0.0876, 51.5257),
        }
        self.reader = make_reader(self.connection)

    @staticmethod
    def place(osm_id, name, modes, zone, lines, lon, lat, osm_ids=None):
        return {"id": osm_id, "osm_ids": osm_ids or [osm_id], "name": name, "modes": modes, "zone": zone,
                "lines": [{"id": line_id, "name": line_name, "mode": mode} for line_id, line_name, mode in lines],
                "center_lon": lon, "center_lat": lat}

    def names(self, query):
        return [row["name"] for row in self.reader.search_stations(query)["results"]]

    def test_search_returns_tfl_modes_lines_and_zone_with_the_walk_table_id(self):
        payload = self.reader.search_stations("oxford")
        self.assertEqual(payload["schemaVersion"], "station-search.v1")
        self.assertEqual(payload["results"], [{
            "stationId": "osm:n5614077964", "name": "Oxford Circus", "modes": ["tube"], "zone": "1",
            "lines": [{"id": "bakerloo", "name": "Bakerloo", "mode": "tube"},
                      {"id": "central", "name": "Central", "mode": "tube"},
                      {"id": "victoria", "name": "Victoria", "mode": "tube"}],
            "center": [-0.1415, 51.5152]}])
        with self.assertRaises(MalformedQuery):
            self.reader.search_stations("o")

    def test_a_station_without_a_released_walk_row_keeps_its_own_osm_id(self):
        [old_street] = self.reader.search_stations("old street")["results"]
        self.assertEqual((old_street["stationId"], old_street["modes"]), ("osm:n1", ["tube", "national-rail"]))

    def test_twin_stations_stay_two_hits_with_their_own_lines(self):
        # Hammersmith: two stations 60 m apart (#241). The walk table has one merged row named after
        # its first feature, so both twins carry that id; the lines tell them apart.
        self.connection.stations["osm:n5474926328"] = {
            "id": "osm:n5474926328", "name": "Hammersmith (Circle and Hammersmith & City lines)",
            "modes": ["underground"], "center_lon": -0.2251, "center_lat": 51.4936, "source_release_id": STATION_RELEASE}
        self.connection.place_stations.update({
            "n5474926328": self.place("n5474926328", "Hammersmith (Circle and Hammersmith & City lines)", ["tube"], "2",
                                      [("circle", "Circle", "tube"), ("hammersmith-city", "Hammersmith & City", "tube")],
                                      -0.2251, 51.4936),
            "n9": self.place("n9", "Hammersmith (District and Piccadilly lines)", ["tube"], "2",
                             [("district", "District", "tube"), ("piccadilly", "Piccadilly", "tube")], -0.2244, 51.4925),
        })
        for query in ("Hammersmith", "hammersmith piccadilly", "Hammersmith District", "ham and city"):
            with self.subTest(query):
                rows = self.reader.search_stations(query)["results"]
                self.assertEqual([row["name"] for row in rows], [
                    "Hammersmith (District and Piccadilly lines)", "Hammersmith (Circle and Hammersmith & City lines)"])
                self.assertEqual([[line["name"] for line in row["lines"]] for row in rows],
                                 [["District", "Piccadilly"], ["Circle", "Hammersmith & City"]])
                self.assertEqual({row["stationId"] for row in rows}, {"osm:n5474926328"})

    def test_a_station_listed_twice_with_the_same_lines_is_one_hit(self):
        self.connection.place_stations["n7"] = self.place("n7", "Oxford Circus", ["tube"], None, [
            ("bakerloo", "Bakerloo", "tube"), ("central", "Central", "tube"), ("victoria", "Victoria", "tube")],
            -0.1416, 51.5153)
        self.assertEqual(self.names("oxford circus"), ["Oxford Circus"])

    def test_national_rail_only_station_and_overground_modes_come_from_tfl(self):
        # Highbury & Islington: OSM tags said Tube only; TfL lists Overground and National Rail too.
        self.connection.stations["osm:n6414163635"] = {
            "id": "osm:n6414163635", "name": "Highbury & Islington", "modes": ["underground"],
            "center_lon": -0.103654, "center_lat": 51.546368, "source_release_id": STATION_RELEASE}
        self.connection.place_stations.update({
            "n6414163635": self.place("n6414163635", "Highbury & Islington", ["tube", "overground", "national-rail"],
                                      "2", [("victoria", "Victoria", "tube"), ("mildmay", "Mildmay", "overground"),
                                            ("great-northern", "Great Northern", "national-rail")],
                                      -0.103654, 51.546368),
            "n8": self.place("n8", "Blackheath", ["national-rail"], "3",
                             [("southeastern", "Southeastern", "national-rail")], 0.0097, 51.4657),
        })
        [hbi] = self.reader.search_stations("highbury")["results"]
        self.assertEqual((hbi["stationId"], hbi["modes"], hbi["zone"]),
                         ("osm:n6414163635", ["tube", "overground", "national-rail"], "2"))
        [blackheath] = self.reader.search_stations("Blackheath station")["results"]
        self.assertEqual((blackheath["stationId"], blackheath["modes"], [line["name"] for line in blackheath["lines"]]),
                         ("osm:n8", ["national-rail"], ["Southeastern"]))

    def test_exact_name_outranks_a_prefix_and_a_substring(self):
        self.connection.place_stations.update({
            "n10": self.place("n10", "Richmond", ["tube", "overground", "national-rail"], "4", [], -0.3017, 51.4633),
            "n11": self.place("n11", "Richmond Park Halt", ["national-rail"], None, [], -0.29, 51.45),
            "n12": self.place("n12", "West Richmond", ["national-rail"], None, [], -0.31, 51.46),
        })
        self.assertEqual(self.names("richmond"), ["Richmond", "Richmond Park Halt", "West Richmond"])

    def test_search_ignores_spelling_and_understands_nicknames(self):
        self.connection.stations["osm:n2"] = {
            "id": "osm:n2", "name": "King's Cross St Pancras", "modes": ["underground"],
            "center_lon": -0.1239, "center_lat": 51.5306, "source_release_id": STATION_RELEASE}
        self.connection.place_stations["n2"] = self.place(
            "n2", "King's Cross St Pancras", ["tube", "national-rail"], "1", [], -0.1239, 51.5306)
        for query in ("Kings Cross", "KINGS CROSS station", "kx", "Kings X", "saint pancras"):
            with self.subTest(query):
                names = [row["name"] for row in self.reader.search_stations(query)["results"]]
                self.assertEqual(names, ["King's Cross St Pancras"])
        self.assertEqual([row["name"] for row in self.reader.search_stations("oc")["results"]], ["Oxford Circus"])


class StationNameKeyTests(unittest.TestCase):
    def test_spelling_variants_share_one_key(self):
        same = [("King's Cross", "Kings Cross"), ("St. James's Park", "St James Park"),
                ("Elephant & Castle", "elephant and castle"), ("St John's Wood", "Saint Johns Wood"),
                ("Shepherd\u2019s Bush", "shepherds bush")]
        for stored, typed in same:
            with self.subTest(stored):
                self.assertEqual(zones.station_name_key(stored), zones.station_query_key(typed))

    def test_aliases_and_fillers(self):
        key = zones.station_name_key
        self.assertEqual(zones.station_query_key("TCR"), key("Tottenham Court Road"))
        self.assertEqual(zones.station_query_key("e&c"), key("Elephant & Castle"))
        self.assertEqual(zones.station_query_key("Euston tube"), key("Euston"))
        self.assertEqual(zones.station_query_key("station"), key("station"))  # nothing but filler: keep it


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class ZoneHttpTests(unittest.TestCase):
    def setUp(self):
        self.connection = seed_production_fixture()
        _seed_similarity(self.connection)
        self.connection.members[OLD_RELEASE].append(STATION_RELEASE)
        self.connection.station_walks = [{"geography_id": NEAR, "station_id": STATION["stationId"],
                                          "median_minutes": 6.0, "source_release_id": STATION_RELEASE}]
        self._previous = (app_module._reader, app_module._connect, app_module.load_match_evidence)
        app_module._reader = make_reader(self.connection)
        app_module._connect = lambda: self.connection
        app_module.load_match_evidence = lambda profile, regions=None: _crime_rows()
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader, app_module._connect, app_module.load_match_evidence = self._previous

    def test_match_endpoint_expands_a_station_zone(self):
        response = self.client.post("/api/v1/matches", json=_profile([STATION]))
        self.assertEqual(response.status_code, 200)
        by_id = {value["geographyId"]: value for value in response.json()["values"]}
        self.assertFalse(by_id[NEAR]["excluded"])
        self.assertTrue(by_id[NEAR]["inZone"])
        self.assertFalse(by_id[MID]["inZone"])
        self.assertGreater(by_id[NEAR]["score"], by_id[MID]["score"])

    def test_match_endpoint_rejects_bad_zones(self):
        response = self.client.post("/api/v1/matches", json=_profile([{"kind": "postcode"}]))
        self.assertEqual(response.status_code, 400)

    def test_similar_endpoint(self):
        response = self.client.get(f"/api/v1/areas/{NEAR}/similar", params={"cheaper": "true"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["values"][0]["geographyId"], FAR)
        zoned = self.client.get(f"/api/v1/areas/{FAR}/similar",
                                params={"outsideZones": json.dumps([{"kind": "lsoas", "ids": [NEAR, MID]}])})
        self.assertEqual(zoned.headers["cache-control"], "no-store")
        self.assertEqual([value["geographyId"] for value in zoned.json()["values"]], ["uk:lsoa:E01000007"])
        bad = self.client.get(f"/api/v1/areas/{NEAR}/similar", params={"outsideZones": "nope"})
        self.assertEqual(bad.status_code, 400)

    def test_similar_endpoint_carries_friendly_titles(self):
        with unittest.mock.patch.object(app_module.repository, "area_titles", lambda: {FAR: "Pitshanger · W5"}):
            values = self.client.get(f"/api/v1/areas/{NEAR}/similar").json()["values"]
        titles = {value["geographyId"]: value["title"] for value in values}
        self.assertEqual(titles[FAR], "Pitshanger · W5")
        self.assertTrue(all(value["name"] for value in values))
        self.assertIsNone(next(title for area_id, title in titles.items() if area_id != FAR))


@unittest.skipIf(tools is None, "pydantic is not installed")
class ZoneToolTests(unittest.TestCase):
    def test_match_tool_applies_zones(self):
        context = tools.ToolContext(reader=make_reader(seed_production_fixture()),
                                    load_match_rows=lambda profile: _crime_rows(),
                                    load_zone_lsoas=lambda zones: {NEAR} if zones else None)
        out = tools.call_tool("match_areas", context, {"profile": _profile([STATION])})
        by_id = {value["geographyId"]: value for value in out["value"]["values"]}
        self.assertEqual(by_id[FAR]["score"], 0)
        self.assertTrue(any("Where zones" in caveat for caveat in out["caveats"]))


if __name__ == "__main__":
    unittest.main()
