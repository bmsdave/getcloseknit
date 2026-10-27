"""A request's scope with CLOSE_KNIT_ENGLAND (area_api.scope): London alone with the flag off, so England rows on
the server never reach a London answer; regional percentiles; and the hot paths that scale to England's ~34,000
LSOAs (SQL-side scope for matches and nearest places, grouped place counts for custom criteria).

The fake connections here answer a scoped query as the database would (`served`: the rows of the regions its
filter names); tests/test_postgis.py runs the same filters on a real PostGIS."""
import os
import re
import unittest
from unittest import mock

from area_api import custom_criteria as cc
from area_api import borough_standouts, evidence, health, hmo, labels, personal_places, regions, repository, scope
from area_api import standouts, tools
from area_api.percentiles import regional_percentiles
from area_api.toolspec import InvalidToolArguments

LONDON, NORTH_WEST = "E12000007", "E12000002"
REGION_MAP = {"uk:lsoa:L1": LONDON, "uk:lsoa:L2": LONDON, "uk:lsoa:L3": LONDON,
              "uk:lsoa:N1": NORTH_WEST, "uk:lsoa:N2": NORTH_WEST}


def served(sql, rows, key="geography_id"):
    """The rows a scoped query returns: those of the regions its filter names (all of them without one)."""
    codes = re.findall(r"'uk:region:(E\d{8})'", sql)
    return [row for row in rows if not codes or REGION_MAP[row[key]] in codes]


class FlagCase(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in ("CLOSE_KNIT_ENGLAND", "CLOSE_KNIT_ACCESS"):
            os.environ.pop(name, None)
        regions.set_for_tests(REGION_MAP)

    def england(self):
        os.environ["CLOSE_KNIT_ENGLAND"] = "1"


class ScopeTests(FlagCase):
    def test_flag_off_is_london_whatever_was_asked(self):
        self.assertIs(scope.current(), scope.LONDON)
        self.assertIs(scope.current([NORTH_WEST]), scope.LONDON)
        self.assertEqual((scope.LONDON.id, scope.LONDON.level, scope.LONDON.name, scope.LONDON.outside_reason),
                         ("uk:region:E12000007", "region", "London", "outside-london"))

    def test_flag_on_is_england_or_the_regions_asked_for(self):
        self.england()
        self.assertIs(scope.current(), scope.ENGLAND)
        self.assertIsNone(scope.ENGLAND.regions)
        self.assertEqual(scope.current([LONDON, NORTH_WEST, "junk"]).regions, (NORTH_WEST, LONDON))
        self.assertEqual(scope.ENGLAND.outside_reason, "outside-coverage")

    def test_covers_names_the_place_in_words(self):
        self.assertEqual(scope.LONDON.covers, "London")
        self.assertEqual(scope.ENGLAND.covers, "England")
        self.assertEqual(scope.ENGLAND.within((NORTH_WEST, LONDON)).covers, "North West, London")

    def test_the_mcp_and_the_extension_read_the_flag_as_off_in_the_preview(self):
        from area_api import feature_flags

        os.environ["CLOSE_KNIT_ACCESS"] = "private"  # unset flags are on in the private preview
        self.assertIs(scope.current(), scope.ENGLAND)
        with feature_flags.public_call():
            self.assertIs(scope.current(), scope.LONDON)

    def test_parse_refuses_unknown_codes(self):
        self.assertEqual(scope.parse(" e12000007, E12000002 "), [LONDON, NORTH_WEST])
        self.assertEqual(scope.parse(None), [])
        with self.assertRaisesRegex(ValueError, "W92000004"):
            scope.parse("W92000004")

    def test_sql_filter_inlines_only_known_codes(self):
        self.assertEqual(scope.ENGLAND.sql_filter("g.id"), "")
        self.assertEqual(scope.LONDON.sql_filter("g.id"),
                         " AND g.id IN (SELECT id FROM area_geography WHERE region_id IN ('uk:region:E12000007'))")
        self.assertEqual(scope.ENGLAND.within(("x'); DROP TABLE y; --",)).sql_filter("g.id"),
                         " AND g.id IN (SELECT id FROM area_geography WHERE region_id IN (NULL))")

    def test_rows_keep_the_query_name_first_and_its_order(self):
        sql = "-- evidence:x\nSELECT g.id AS geography_id FROM area_geography g ORDER BY g.id"
        self.assertIs(scope.ENGLAND.rows(sql), sql)
        scoped = scope.LONDON.rows(sql, order="geography_id")
        self.assertTrue(scoped.startswith("-- evidence:x\nSELECT * FROM (-- evidence:x\n"))
        self.assertTrue(scoped.endswith("region_id IN ('uk:region:E12000007')) ORDER BY scoped.geography_id"))

    def test_one_area_and_one_point(self):
        self.assertTrue(scope.LONDON.admits(REGION_MAP, "uk:lsoa:L1"))
        self.assertFalse(scope.LONDON.admits(REGION_MAP, "uk:lsoa:N1"))
        self.assertTrue(scope.LONDON.admits({}, "uk:lsoa:N1"))  # no map yet: nothing filtered
        self.assertTrue(scope.ENGLAND.admits(REGION_MAP, "uk:lsoa:N1"))
        self.assertTrue(scope.LONDON.contains(51.5, -0.12))
        self.assertFalse(scope.LONDON.contains(53.48, -2.24))  # Manchester
        self.assertTrue(scope.ENGLAND.contains(53.48, -2.24))
        self.assertTrue(scope.ENGLAND.contains(49.91, -6.31))  # Isles of Scilly
        self.assertFalse(scope.ENGLAND.contains(55.95, -3.19))  # Edinburgh

    def test_payload_names_the_served_regions(self):
        london = scope.LONDON.payload()
        self.assertEqual(london["served"], [{"id": "uk:region:E12000007", "code": LONDON, "name": "London"}])
        self.assertEqual((london["id"], london["level"], london["outsideReason"]), ("uk:region:E12000007", "region",
                                                                                   "outside-london"))
        self.assertEqual(london["bbox"], [-0.6, 51.2, 0.4, 51.8])
        self.assertEqual(len(scope.ENGLAND.payload()["served"]), 9)

    def test_the_route_serves_the_channels_scope(self):
        try:
            from fastapi.testclient import TestClient

            import area_api.app as app_module
        except ImportError:  # pragma: no cover
            self.skipTest("dependencies are not installed")
        client = TestClient(app_module.app)
        self.assertEqual(client.get("/api/v1/scope").json()["name"], "London")
        self.england()
        self.assertEqual(client.get("/api/v1/scope").json()["name"], "England")
        narrowed = client.get(f"/api/v1/scope?regions={NORTH_WEST}").json()
        self.assertEqual([region["code"] for region in narrowed["served"]], [NORTH_WEST])
        self.assertEqual(client.get("/api/v1/scope?regions=W92000004").status_code, 400)


class RegionalPercentileTests(unittest.TestCase):
    def test_each_region_is_ranked_on_its_own(self):
        values = {"uk:lsoa:L1": 1, "uk:lsoa:L2": 2, "uk:lsoa:L3": 3, "uk:lsoa:N1": 100, "uk:lsoa:N2": 50}
        self.assertEqual(regional_percentiles(values, REGION_MAP),
                         {"uk:lsoa:L1": 0, "uk:lsoa:L2": 50, "uk:lsoa:L3": 100, "uk:lsoa:N1": 100, "uk:lsoa:N2": 0})
        # London's own ranking is what it was without England's areas.
        london = {key: value for key, value in values.items() if REGION_MAP[key] == LONDON}
        self.assertEqual(regional_percentiles(values, REGION_MAP)["uk:lsoa:L2"], regional_percentiles(london)["uk:lsoa:L2"])
        self.assertEqual(regional_percentiles(values, None)["uk:lsoa:N1"], 100)


class CustomCriterionCountTests(FlagCase):
    """Every formula but nearest reads places grouped per LSOA with a count n: the same values as one row each."""

    CRITERION = cc.normalise({"id": "cafes", "label": "Cafés", "formula": "count", "radiusMetres": 800,
                              "sets": {"a": {"label": "Cafés", "any": [{"amenity": "cafe"}]}}})

    def test_grouped_query_for_counts_and_points_for_nearest(self):
        sql, _ = cc.places_query(self.CRITERION)
        self.assertIn("count(*) AS n", sql)
        self.assertIn("GROUP BY lsoa_id, in_a, cuisine, sport, source_release_id", sql)
        self.assertIn(f"LIMIT {cc.MAX_PLACES + 1}", sql)
        nearest, _ = cc.places_query({**self.CRITERION, "formula": "nearest"})
        self.assertNotIn("GROUP BY", nearest)
        self.england()
        self.assertIn(f"LIMIT {cc.MAX_PLACES_ENGLAND + 1}", cc.places_query(self.CRITERION)[0])

    def test_grouped_rows_count_like_single_rows(self):
        areas = [{"geography_id": "uk:lsoa:L1", "lon": -0.1, "lat": 51.5}]
        one_each = [{"lsoa_id": "uk:lsoa:L1", "in_a": True, "cuisine": None, "sport": None}] * 3
        grouped = [{"lsoa_id": "uk:lsoa:L1", "in_a": True, "cuisine": None, "sport": None, "n": 3}]
        self.assertEqual(cc.area_values(self.CRITERION, areas, one_each), cc.area_values(self.CRITERION, areas, grouped))
        self.assertEqual(cc.area_values(self.CRITERION, areas, grouped)["uk:lsoa:L1"]["value"], 3.0)
        self.assertEqual(cc.place_total(grouped + one_each), 6)

    def test_nearest_in_the_north_finds_the_nearer_place(self):
        # At 55.5°N a cell sized 500 m at London's latitude is ~455 m wide: stopping by London's width returned the
        # place 2,902 m away and missed the one at 2,885 m (a layout found by random search).
        lat, (m_lat, m_lon) = 55.5, cc.metres_per_degree(55.5)
        offsets = [(2878.5295638643893, 192.7703845889795), (-1993.2147847530682, -2109.8700351954803)]
        places = [{"lon": -1.6 + east / m_lon, "lat": lat + north / m_lat, "in_a": True} for east, north in offsets]
        self.assertAlmostEqual(cc._nearest_metres(cc._Grid(places, 500.0), -1.6, lat), 2884.98, delta=0.01)

    def test_evaluate_keeps_the_scope_and_ranks_within_regions(self):
        values = {area: {"value": float(index), "counts": {"a": index}} for index, area in enumerate(REGION_MAP)}
        areas = [{"geography_id": area, "name": area} for area in REGION_MAP]

        def evaluated(connection, release_id, definition, served_scope):  # the scope's areas, as SQL reads them
            kept = {area: item for area, item in values.items() if served_scope.admits(REGION_MAP, area)}
            return kept, "src", areas
        with mock.patch.object(cc, "_evaluate_values", side_effect=evaluated), \
                mock.patch.object(cc, "_active_release", return_value="rel"):
            london = cc.evaluate(object(), self.CRITERION)
            self.england()
            england = cc.evaluate(object(), self.CRITERION)
        self.assertEqual([entry["geographyId"] for entry in london["values"]], ["uk:lsoa:L1", "uk:lsoa:L2", "uk:lsoa:L3"])
        self.assertEqual(len(england["values"]), 5)
        by_id = {entry["geographyId"]: entry["percentile"] for entry in england["values"]}
        self.assertEqual(by_id["uk:lsoa:N2"], 100)  # the top of the North West, not of England
        self.assertEqual({entry["geographyId"]: entry["percentile"] for entry in london["values"]},
                         {key: by_id[key] for key in ("uk:lsoa:L1", "uk:lsoa:L2", "uk:lsoa:L3")})


class NearestPlaceScopeTests(FlagCase):
    class Connection:
        def __init__(self):
            self.statements = []

        def execute(self, sql, params=()):
            marker = sql.split("\n", 1)[0]
            self.statements.append((marker, sql, params))
            if marker == "-- evidence:place-area-points":
                return served(sql, [{"geography_id": area, "name": area, "lon": -0.1, "lat": 51.5,
                                     "station_walk": None} for area in REGION_MAP])
            if marker == "-- evidence:place-nearest-park":
                return served(sql, [{"geography_id": area, "metres": 400.0} for area in REGION_MAP])
            if marker == "-- evidence:place-school-observations":
                return [{"urn": urn, "region_code": region, "observations": [
                    {"measure": personal_places.SCHOOL_MEASURES["primary"], "value": value, "cohortSize": 40,
                     "academicYear": "2025"}]} for urn, region, value in
                        (("L-best", LONDON, 90), ("N-best", NORTH_WEST, 70), ("L-next", LONDON, 80))]
            if marker == "-- evidence:place-nearest-school":
                return [{"geography_id": "uk:lsoa:L1", "metres": 300.0}]
            raise AssertionError(marker)

    def setUp(self):
        super().setUp()
        personal_places.clear_cache()
        self.addCleanup(personal_places.clear_cache)

    def test_nearest_park_runs_for_the_scope_only(self):
        connection = self.Connection()
        park = {"id": "park", "label": "Park", "mode": "walk", "target": {"kind": "category", "category": "park"}}
        rows = personal_places.place_rows(connection, "rel", [park])
        self.assertEqual({row["geography_id"] for row in rows}, {"uk:lsoa:L1", "uk:lsoa:L2", "uk:lsoa:L3"})
        [(_, sql, _)] = [s for s in connection.statements if s[0] == "-- evidence:place-nearest-park"]
        self.assertIn("region_id IN ('uk:region:E12000007')", sql)
        self.england()
        rows = personal_places.place_rows(connection, "rel", [park])
        self.assertEqual(len(rows), 5)
        self.assertNotIn("region_id IN", connection.statements[-1][1])

    def test_top_schools_are_the_regions_own(self):
        connection = self.Connection()
        self.assertEqual([urn for urn, _ in personal_places.top_schools(connection, "rel", "primary", region=LONDON)],
                         ["L-best", "L-next"])
        self.assertEqual([urn for urn, _ in personal_places.top_schools(connection, "rel", "primary")],
                         ["L-best", "L-next", "N-best"])
        self.england()
        personal_places._nearest_school(connection, "rel", "primary", 1)
        calls = [(sql, params) for marker, sql, params in connection.statements if marker == "-- evidence:place-nearest-school"]
        self.assertEqual([params["urns"] for _, params in calls], [["N-best"], ["L-best"]])
        self.assertIn("region_id IN ('uk:region:E12000002')", calls[0][0])


class MatchEvidenceScopeTests(FlagCase):
    def test_evidence_sql_is_scoped_in_the_database(self):
        self.assertEqual(repository.evidence_sql(scope.ENGLAND), repository.EVIDENCE_SQL)
        self.assertIn("AND geography.id IN (SELECT id FROM area_geography WHERE region_id IN ('uk:region:E12000007'))",
                      repository.evidence_sql(scope.LONDON))

    def test_load_match_evidence_keeps_the_scope(self):
        class Connection:
            def __init__(self):
                self.sql = []

            def execute(self, sql, params=()):
                self.sql.append(sql)
                return served(sql, [{"geography_id": area, "factor_id": "deprivation", "raw_value": 5, "utility": 50}
                                    for area in REGION_MAP])

        class Pool:
            def __init__(self, connection):
                self._connection = connection

            def connection(self):
                connection = self._connection

                class Context:
                    def __enter__(self):
                        return connection

                    def __exit__(self, *exc):
                        return False
                return Context()

        profile = {"schemaVersion": "preference-profile.v2", "market": "buy", "analyticsConsent": False,
                   "criteria": [{"kind": "range", "layer": "deprivation"}]}
        connection = Connection()
        with mock.patch.object(repository, "_pool", return_value=Pool(connection)), \
                mock.patch.object(repository, "match_sources", return_value={
                    "factors": ["deprivation"], "places": [], "custom": [], "ranges": [], "budget": False}):
            london = repository.load_match_evidence(profile)
            self.england()
            north_west = repository.load_match_evidence(profile, scope.current([NORTH_WEST]))
            everything = repository.load_match_evidence(profile)
        self.assertEqual({row["geography_id"] for row in london}, {"uk:lsoa:L1", "uk:lsoa:L2", "uk:lsoa:L3"})
        self.assertEqual({row["geography_id"] for row in north_west}, {"uk:lsoa:N1", "uk:lsoa:N2"})
        self.assertEqual(len(everything), 5)
        self.assertIn("region_id IN ('uk:region:E12000002')", connection.sql[1])

    def test_matches_route_refuses_an_unknown_region(self):
        try:
            from fastapi.testclient import TestClient

            import area_api.app as app_module
        except ImportError:  # pragma: no cover
            self.skipTest("dependencies are not installed")
        profile = {"schemaVersion": "preference-profile.v2", "market": "buy", "targetBudget": 500000,
                   "maximumBudget": 600000, "bedrooms": 2, "criteria": [{"kind": "budget"}]}
        response = TestClient(app_module.app).post("/api/v1/matches?regions=W92000004", json=profile)
        self.assertEqual(response.status_code, 400)
        self.assertIn("unknown region code", response.text)


class ReaderScopeTests(FlagCase):
    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def execute(self, sql, params=()):
            marker = sql.split("\n", 1)[0]
            if marker == "-- evidence:active-release":
                return [{"release_id": "rel"}]
            raise AssertionError(marker)

    def test_labels_hold_london_alone_with_the_flag_off(self):
        features = [{"type": "Feature", "properties": {"kind": kind, "code": code, "label": code, "name": code, "rank": 0},
                     "geometry": {"type": "Point", "coordinates": coordinates}}
                    for kind, code, coordinates in (("region", LONDON, [-0.1, 51.5]), ("region", NORTH_WEST, [-2.7, 54.0]),
                                                    ("borough", "E09000001", [-0.09, 51.51]),
                                                    ("borough", "E08000003", [-2.24, 53.48]),
                                                    ("district", "M1", [-2.23, 53.48]), ("district", "N1", [-0.1, 51.54]))]
        reader = mock.MagicMock()
        reader._cached.return_value = features
        regions.set_for_tests({**REGION_MAP, "uk:lad:E09000001": LONDON, "uk:lad:E08000003": NORTH_WEST})
        with mock.patch.object(labels, "_active_release", return_value="rel"):
            london = labels.map_labels(reader)
            self.england()
            england = labels.map_labels(reader)
        self.assertEqual([f["properties"]["code"] for f in london["features"]], [LONDON, "E09000001", "N1"])
        self.assertEqual(len(england["features"]), 6)


class RegionalWordsTests(unittest.TestCase):
    """Comparisons are worded for the area's region where they are made (no rewrite of the finished payload)."""

    def test_standouts_words_name_the_region(self):
        tile = {"id": "safety", "standing": 62, "value": 1, "extreme": "pro", "available": True, "topic": "safety",
                "section": "safety"}
        self.assertEqual(standouts._tag_text(tile, "pro", {"place": "North West"}), "Safer than 62% of North West")
        self.assertEqual(standouts._tag_text(tile, "pro", {}), "Safer than 62% of London")
        con = [{"id": "safety", "kind": "con"}]
        self.assertEqual(standouts.verdict(con, place="North West"), "More crime than most of North West.")
        self.assertEqual(standouts.verdict([], place="North West"), "Close to North West's middle on most measures.")
        self.assertIn("North West's best or worst 10%", standouts.place_words(standouts.CAVEATS, "North West")[0])
        self.assertEqual(borough_standouts._tag_words(borough_standouts.MSOA_TAGS)(tile, "pro", {"place": "North West"}),
                         "Safer than 62% of North West")

    def test_card_words_name_the_region(self):
        heat = {"air": None, "gp": None, "heat": {"regionPercentile": 90}}
        self.assertIn("One of North West's warmer areas on summer nights", health.card_notes(heat, "North West"))
        self.assertIn("One of London's warmer areas on summer nights", health.card_notes(heat))
        caveats = hmo.wrap(None, "rel", "uk:lsoa:N1", [], "North West")["caveats"]
        self.assertIn("North West's figure and percentiles cover only the boroughs that publish their register in bulk.",
                      caveats)

    def test_region_view_cuts_every_area_keyed_part(self):
        data = {"boroughs": ["uk:lad:L", "uk:lad:N"], "pricePeriod": "2025-01",
                "lsoa": {"price": {"uk:lsoa:L1": 1.0, "uk:lsoa:N1": 2.0}},
                "crime": {"uk:lad:L": {"value": 1}, "uk:lad:N": {"value": 2}}}
        view = borough_standouts._region_view(data, lambda key: key.endswith(("L", "L1")))
        self.assertEqual(view, {"boroughs": ["uk:lad:L"], "pricePeriod": "2025-01",
                                "lsoa": {"price": {"uk:lsoa:L1": 1.0}}, "crime": {"uk:lad:L": {"value": 1}}})


class RankRegionTests(unittest.TestCase):
    def test_region_names_and_codes(self):
        self.assertEqual(tools.region_code("north west"), NORTH_WEST)
        self.assertEqual(tools.region_code(" Yorkshire and The  Humber "), "E12000003")
        self.assertEqual(tools.region_code("e12000007"), LONDON)
        self.assertIsNone(tools.region_code(None))
        with self.assertRaisesRegex(InvalidToolArguments, "unknown region: Wales"):
            tools.region_code("Wales")


if __name__ == "__main__":
    unittest.main()
