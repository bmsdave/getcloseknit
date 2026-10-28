"""The evidence SQL on a real PostGIS: the seeded two-LAD fixture (deploy/tests/postgis-fixture.sh, postgis-seed.sql).

gate.sh boots it and sets CLOSE_KNIT_TEST_DATABASE_URL; without it, or against a database that is not the
fixture, these skip. The numbers asserted here are the seed's (its header says how they are made): Camden
(London) and Epping Forest (East of England), crime and £/m² per LSOA, percentiles within each region.
Until now these paths were checked only through the fake SQL router of test_production_evidence.py.
"""
import os
import unittest
from unittest import mock

from area_api import area_pages, coverage, homes_near, regions, repository, safety, scope
from area_api.evidence import AreaNotFound, EvidenceReader, MalformedQuery, PeriodNotFound
from area_api.percentiles import competition_percentiles
from area_api.tools import call_tool
from area_api.toolspec import ToolContext

TEST_DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")
CAMDEN_001A = "uk:lsoa:E01000900"
EPPING_001A = "uk:lsoa:E01021700"
EPPING_002C = "uk:lsoa:E01021705"  # Epping Forest's highest crime and £/m², still below every Camden LSOA
PRICE = "price-per-square-metre"


def by_id(values):
    return {row["geographyId"]: row for row in values}


@unittest.skipUnless(TEST_DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to the seeded PostGIS fixture")
class PostgisTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg
        from psycopg.rows import dict_row

        cls.connect = staticmethod(lambda: psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row))
        with cls.connect() as connection:
            seeded = connection.execute(
                "SELECT 1 FROM active_product_release WHERE release_id = 'fixture-2026-06'").fetchone()
        if not seeded:
            raise unittest.SkipTest("not the seeded fixture (deploy/tests/postgis-fixture.sh)")

    def setUp(self):
        regions.clear_cache()  # test_000_isolation empties the area -> region map: read the database's
        self.addCleanup(regions.clear_cache)
        self.england(True)
        self.reader = EvidenceReader(self.connect)

    def england(self, on):
        patch = mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "1" if on else "0"})
        patch.start()
        self.addCleanup(patch.stop)


class AreaSummaryTests(PostgisTestCase):
    def test_summary_reads_the_value_breakdown_timelines_and_box(self):
        area = self.reader.get_area(CAMDEN_001A, "crime", "2026-06")
        summary = area["summary"]

        self.assertEqual((summary["value"], summary["regionPercentile"], summary["quality"]), (60.0, 0, "observed"))
        self.assertEqual(summary["breakdown"],
                         {"Violence and sexual offences": 9, "Shoplifting": 4, "anti-social-behaviour": 5})
        self.assertIn("London", summary["percentileMeaning"])
        self.assertEqual(area["parentId"], "uk:msoa:E02000166")
        self.assertEqual(area["bbox"], [-0.17, 51.52, -0.16, 51.528])
        self.assertEqual([(p["period"], p["value"]) for p in area["metricTimeline"]], [("2026-05", 59.0), ("2026-06", 60.0)])
        self.assertEqual([p["value"] for p in area["priceTimeline"]], [8500.0, 9000.0])

    def test_an_area_outside_london_ranks_within_its_own_region(self):
        top = self.reader.get_area(EPPING_002C, PRICE, "2026-06")["summary"]

        # 5,500 £/m² is below every Camden LSOA, yet the top of the East of England's.
        self.assertEqual((top["value"], top["regionPercentile"]), (5500.0, 100))
        self.assertIn("East of England", top["percentileMeaning"])

    def test_a_districts_price_is_the_median_of_its_lsoas_without_the_suppressed_one(self):
        summary = self.reader.get_area("uk:msoa:E02000167", PRICE, "2026-06")["summary"]

        self.assertEqual((summary["value"], summary["areaCount"], summary["carrier"]), (10550.0, 14, "msoa"))

    def test_unknown_area_and_month(self):
        with self.assertRaises(AreaNotFound):
            self.reader.get_area("uk:lsoa:E01999999", "crime", "2026-06")
        with self.assertRaises(PeriodNotFound):
            self.reader.get_area(CAMDEN_001A, "crime", "2020-01")


class SafetyTests(PostgisTestCase):
    def test_neighbourhood_and_msoa_read_their_neighbourhoods_types(self):
        """G-E02: the member query sums a neighbourhood's own rows; an MSOA without a crime series says so (no 400)."""
        lsoa = safety.area_safety(self.reader, CAMDEN_001A)
        self.assertTrue(lsoa["available"])
        self.assertEqual([(row["category"], row["offences"]) for row in lsoa["types"]],
                         [("Violence and sexual offences", 9), ("anti-social-behaviour", 5), ("Shoplifting", 4)])
        self.assertFalse(safety.area_safety(self.reader, "uk:msoa:E02000166")["available"])


class ValuePackTests(PostgisTestCase):
    def test_with_england_off_the_pack_is_londons_alone(self):
        self.england(False)
        values = self.reader.get_value_pack("crime", "2026-06")["values"]

        self.assertEqual(len(values), 30)
        self.assertTrue(all(row["geographyId"].startswith("uk:lsoa:E010009") for row in values))
        self.assertTrue(all(row["countryPercentile"] is None for row in values))
        self.assertEqual(self.reader.get_value_pack("crime", "2026-06", chunk="E07000072")["values"], [])

    def test_with_england_on_each_area_has_its_region_and_its_country_percentile(self):
        values = by_id(self.reader.get_value_pack("crime", "2026-06")["values"])

        self.assertEqual(len(values), 36)
        # Camden 001A: the lowest in London, above Epping Forest's six of the 35 others in England.
        self.assertEqual((values[CAMDEN_001A]["regionPercentile"], values[CAMDEN_001A]["countryPercentile"]), (0, 17))
        self.assertEqual((values[EPPING_002C]["regionPercentile"], values[EPPING_002C]["countryPercentile"]), (100, 14))
        self.assertEqual(values[CAMDEN_001A]["breakdown"]["Shoplifting"], 4)

    def test_a_chunk_reads_its_lads_areas_in_the_order_asked(self):
        epping = self.reader.get_value_pack("crime", "2026-06", chunk="E07000072")
        both = self.reader.get_value_pack("crime", "2026-06", chunk="E07000072,E09000007")

        self.assertEqual(epping["chunk"], "E07000072")
        self.assertEqual([row["geographyId"] for row in epping["values"]], [f"uk:lsoa:E0{1021700 + n}" for n in range(6)])
        self.assertEqual(both["chunk"], "E07000072,E09000007")
        self.assertEqual(len(both["values"]), 36)
        self.assertEqual(both["values"][0]["geographyId"], EPPING_001A)
        with self.assertRaises(MalformedQuery):
            self.reader.get_value_pack("crime", "2026-06", chunk="E07999999")

    def test_a_suppressed_area_keeps_its_row_without_a_value(self):
        row = by_id(self.reader.get_value_pack(PRICE, "2026-06")["values"])["uk:lsoa:E01000929"]

        self.assertEqual((row["value"], row["quality"], row["sampleCount"]), (None, "suppressed", 2))

    def test_zoomed_out_levels_are_medians_of_each_wider_areas_lsoas(self):
        msoas = by_id(self.reader.get_value_pack(PRICE, "2026-06", level="msoa")["values"])
        boroughs = by_id(self.reader.get_value_pack(PRICE, "2026-06", level="borough")["values"])

        self.assertEqual({key: (row["value"], row["areaCount"]) for key, row in msoas.items()}, {
            "uk:msoa:E02000166": (10300.0, 15), "uk:msoa:E02000167": (10550.0, 14),
            "uk:msoa:E02004541": (5100.0, 3), "uk:msoa:E02004542": (5400.0, 3)})
        self.assertEqual({key: row["countryPercentile"] for key, row in msoas.items()}, {
            "uk:msoa:E02000166": 67, "uk:msoa:E02000167": 100, "uk:msoa:E02004541": 0, "uk:msoa:E02004542": 33})
        self.assertEqual((boroughs["uk:lad:E09000007"]["value"], boroughs["uk:lad:E07000072"]["value"]),
                         (10400.0, 5250.0))
        self.assertEqual((boroughs["uk:lad:E09000007"]["countryPercentile"],
                          boroughs["uk:lad:E07000072"]["countryPercentile"]), (100, 0))

    def test_map_coverage_lists_each_regions_chunks_with_their_boxes(self):
        coverage = self.reader.map_coverage()

        self.assertEqual([(c["id"], c["region"], c["bbox"], c["areas"]) for c in coverage["chunks"]], [
            ("E12000007", "E12000007", [-0.17, 51.52, -0.11, 51.56], 30),  # London loads as one chunk
            ("E07000072", "E12000006", [0.04, 51.64, 0.16, 51.7], 6)])
        with self.connect() as connection:
            release = connection.execute("SELECT area_tile_release() AS r").fetchone()["r"]
        self.assertEqual(coverage["areaTiles"]["release"], release)

    def test_metric_values_reads_several_months_numbers_only(self):
        self.england(False)
        values = self.reader.metric_values(PRICE, ["2025-06", "2026-06"])["values"]

        self.assertEqual((len(values["2025-06"]), len(values["2026-06"])), (30, 29))  # the suppressed one has none
        self.assertEqual(min(values["2026-06"]), 9000.0)


class RegionRankTests(PostgisTestCase):
    def test_the_rank_rebuild_ranks_each_area_within_its_region(self):
        """Migration 103's rebuild_area_rank, rolled back: every region runs 0 to the top on its own
        (Camden's quietest is 0 though Epping Forest is quieter; three Camden LSOAs tie at the top)."""
        with self.connect() as connection:
            connection.execute("SELECT rebuild_area_rank()")
            rows = connection.execute(
                "SELECT area_rank_region(geography_id) AS region, min(region_percentile) AS low,"
                " max(region_percentile) AS high, count(*) AS n FROM area_rank WHERE rank_id = 'quiet'"
                " GROUP BY 1 ORDER BY 1").fetchall()
            connection.rollback()

        self.assertEqual([(r["region"], r["low"], r["high"], r["n"]) for r in rows],
                         [("E12000006", 0, 100, 6), ("E12000007", 0, 93, 30)])

    def test_the_release_stores_each_areas_rank_in_the_country_by_the_one_rule(self):
        """Migration 124: activating the seed's release ran rebuild_metric_ranks. Each area's country percentile
        is the API's rule (percentiles.competition_percentiles) over England's areas of its kind; the region's
        percentiles stay as loaded, and an area without a value has neither."""
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT v.geography_id, v.metric_id, v.period, v.value, v.region_percentile, v.country_percentile"
                " FROM metric_value v JOIN area_geography g ON g.id = v.geography_id"
                " WHERE g.kind = 'lsoa' ORDER BY 1, 2, 3").fetchall()
        groups = {}
        for row in rows:
            if row["region_percentile"] is not None:
                groups.setdefault((row["metric_id"], row["period"]), {})[row["geography_id"]] = row["value"]

        for (metric, period), values in groups.items():
            stored = {r["geography_id"]: r["country_percentile"] for r in rows
                      if (r["metric_id"], r["period"]) == (metric, period) and r["country_percentile"] is not None}
            self.assertEqual(stored, competition_percentiles(values), (metric, period))
        suppressed = next(r for r in rows if r["value"] is None)
        self.assertEqual((suppressed["region_percentile"], suppressed["country_percentile"]), (None, None))

    def test_activating_a_release_rebuilds_the_ranks_of_what_it_serves(self):
        with self.connect() as connection:
            self.assertEqual(connection.execute("SELECT rebuild_metric_ranks('fixture-2026-06') AS n").fetchone()["n"],
                             0, "a rebuild writes only ranks that change")
            # Camden 001A's crime becomes England's highest, and Epping Forest 001A's is no longer ranked.
            connection.execute("UPDATE metric_value SET value = 999 WHERE geography_id = %s AND metric_id = 'crime'"
                               " AND period = '2026-06-01'", (CAMDEN_001A,))
            connection.execute("UPDATE metric_value SET region_percentile = NULL WHERE geography_id = %s"
                               " AND metric_id = 'crime' AND period = '2026-06-01'", (EPPING_001A,))
            connection.execute("INSERT INTO product_release (id, geography_vintage, transformation_versions, assets,"
                               " validation_status, validation_record) SELECT 'fixture-rerank', geography_vintage,"
                               " transformation_versions, assets, 'passed', '{}' FROM product_release"
                               " WHERE id = 'fixture-2026-06'")
            connection.execute("INSERT INTO product_release_member SELECT 'fixture-rerank', source_release_id"
                               " FROM product_release_member WHERE release_id = 'fixture-2026-06'")
            connection.execute("SELECT activate_product_release('fixture-rerank')")
            ranks = {r["geography_id"]: r["country_percentile"] for r in connection.execute(
                "SELECT geography_id, country_percentile FROM metric_value WHERE metric_id = 'crime'"
                " AND period = '2026-06-01' AND geography_id = ANY(%s)", ([CAMDEN_001A, EPPING_001A],))}
            connection.rollback()

        self.assertEqual(ranks, {CAMDEN_001A: 100, EPPING_001A: None})

    def test_region_map_and_rank_scope_come_from_area_region(self):
        region_map = regions.area_regions(self.connect)

        self.assertEqual((region_map[CAMDEN_001A], region_map[EPPING_001A]), ("E12000007", "E12000006"))
        self.assertEqual(regions.rank_scope(self.connect, EPPING_001A)["code"], "E12000006")


CAMDEN = "uk:lad:E09000007"
LONDON, EAST = "uk:region:E12000007", "uk:region:E12000006"
ENGLAND, GB = "uk:nation:E92000001", "uk:country:GB"


class GeographyTreeTests(PostgisTestCase):
    """Migration 123: the regions, England and the country as area_geography rows above the LADs."""

    def rows(self, sql, *params):
        with self.connect() as connection:
            return connection.execute(sql, params).fetchall()

    def test_the_parent_chain_runs_from_an_lsoa_to_the_country(self):
        chain = self.rows("""WITH RECURSIVE up AS (
            SELECT id, kind::text, parent_id, region_id, country_id, 0 AS depth FROM area_geography WHERE id = %s
            UNION ALL SELECT g.id, g.kind::text, g.parent_id, g.region_id, g.country_id, up.depth + 1
            FROM area_geography g JOIN up ON g.id = up.parent_id) SELECT * FROM up ORDER BY depth""", CAMDEN_001A)

        self.assertEqual([(r["id"], r["kind"]) for r in chain], [
            (CAMDEN_001A, "lsoa"), ("uk:msoa:E02000166", "msoa"), (CAMDEN, "lad"), (LONDON, "region"),
            (ENGLAND, "nation"), (GB, "country")])
        self.assertEqual({(r["region_id"], r["country_id"]) for r in chain[:4]}, {(LONDON, GB)})
        self.assertEqual([(r["region_id"], r["country_id"]) for r in chain[4:]], [(None, GB), (None, GB)])
        names = {r["id"]: r["name"] for r in self.rows(
            "SELECT id, name FROM area_geography WHERE kind::text IN ('region', 'nation', 'country')")}
        self.assertEqual(names, {LONDON: "London", EAST: "East of England", ENGLAND: "England", GB: "United Kingdom"})

    def test_region_id_is_the_region_area_region_gives_and_every_lad_has_one(self):
        counts = self.rows("""SELECT count(*) AS areas, count(r.area_id) AS in_view,
            count(*) FILTER (WHERE r.region_code IS DISTINCT FROM split_part(g.region_id, ':', 3)) AS other
            FROM area_geography g LEFT JOIN area_region r ON r.area_id = g.id
            WHERE g.kind::text IN ('lsoa', 'msoa', 'lad')""")[0]
        self.assertEqual((counts["areas"], counts["in_view"], counts["other"]), (42, 42, 0))
        self.assertEqual(self.rows("SELECT count(*) AS n FROM area_region")[0]["n"], 42)  # the levels above stay out
        self.assertEqual({r["id"]: r["parent_id"] for r in self.rows(
            "SELECT id, parent_id FROM area_geography WHERE kind = 'lad'")},
            {CAMDEN: LONDON, "uk:lad:E07000072": EAST})

    def test_each_level_above_the_lads_is_the_union_of_its_lsoas(self):
        gaps = self.rows("""SELECT p.id, ST_Area(ST_SymDifference(p.geometry, ST_Union(l.geometry))) AS gap
            FROM area_geography p JOIN area_geography l ON l.kind = 'lsoa' AND p.id IN (l.region_id, l.country_id,
              (SELECT n.parent_id FROM area_geography n WHERE n.id = l.region_id))
            GROUP BY p.id, p.geometry ORDER BY p.id""")

        self.assertEqual([r["id"] for r in gaps], [GB, ENGLAND, EAST, LONDON])
        self.assertTrue(all(r["gap"] < 1e-12 for r in gaps), gaps)

    def test_the_apis_region_names_are_the_region_rows(self):
        """coverage.REGIONS names a code without a database read; it must say what the data says."""
        rows = self.rows("SELECT official_code, name FROM area_geography WHERE kind = 'region'")

        self.assertEqual({r["official_code"]: r["name"] for r in rows},
                         {r["official_code"]: coverage.REGIONS[r["official_code"]] for r in rows})

    def test_configuration_rows_for_uk(self):
        levels = self.rows("SELECT kind, depth, parent_kind, rank_region FROM geo_level WHERE ns = 'uk' ORDER BY depth")
        self.assertEqual([(r["kind"], r["parent_kind"]) for r in levels], [
            ("country", None), ("nation", "country"), ("region", "nation"), ("lad", "region"), ("msoa", "lad"),
            ("lsoa", "msoa")])
        self.assertEqual([r["kind"] for r in levels if r["rank_region"]], ["region"])
        self.assertEqual({(r["flag"], r["area_id"]) for r in self.rows("SELECT flag, area_id FROM scope_grant")},
                         {(None, LONDON), ("CLOSE_KNIT_ENGLAND", ENGLAND)})
        self.assertEqual({r["kind"] for r in self.rows("SELECT kind FROM boundary_set WHERE ns = 'uk'")},
                         {"lsoa", "msoa", "lad"})
        self.assertEqual([r["n"] for r in self.rows(
            "SELECT count(*) AS n FROM area_alias UNION ALL SELECT count(*) FROM area_xref")], [0, 0])

    def test_a_geography_load_extends_the_tree(self):
        """A LAD, MSOA and LSOA in a region not loaded yet, inserted as the loaders do (rolled back)."""
        square = "ST_Multi(ST_MakeEnvelope(-1.2, 54.68, -1.19, 54.69, 4326))"
        with self.connect() as connection:
            connection.execute("INSERT INTO area_geography (id, kind, official_code, name, geometry) VALUES "
                               f"('uk:lad:E06000001', 'lad', 'E06000001', 'Hartlepool', {square})")
            connection.execute("INSERT INTO area_geography (id, kind, official_code, name, parent_id, geometry) VALUES "
                               f"('uk:msoa:E02002483', 'msoa', 'E02002483', 'Hartlepool 001', 'uk:lad:E06000001', {square})")
            connection.execute("INSERT INTO area_geography (id, kind, official_code, name, parent_id, geometry) VALUES "
                               f"('uk:lsoa:E01011954', 'lsoa', 'E01011954', 'Hartlepool 001A', 'uk:msoa:E02002483', {square})")
            region = connection.execute("SELECT g.id, g.name, g.parent_id FROM area_geography g "
                                        "JOIN area_geography l ON l.region_id = g.id WHERE l.id = 'uk:lsoa:E01011954'").fetchone()
            lad = connection.execute("SELECT parent_id FROM area_geography WHERE id = 'uk:lad:E06000001'").fetchone()
            england = connection.execute("SELECT ST_Covers(n.geometry, l.geometry) AS covers FROM area_geography n, "
                                         "area_geography l WHERE n.id = %s AND l.id = 'uk:lsoa:E01011954'", (ENGLAND,)).fetchone()
            view = connection.execute("SELECT region_code FROM area_region WHERE area_id = 'uk:msoa:E02002483'").fetchone()
            connection.rollback()

        self.assertEqual(dict(region), {"id": "uk:region:E12000001", "name": "North East", "parent_id": ENGLAND})
        self.assertEqual(lad["parent_id"], "uk:region:E12000001")
        self.assertTrue(england["covers"])
        self.assertEqual(view["region_code"], "E12000001")

    def test_rows_stay_insert_only_but_for_what_the_tree_derives(self):
        import psycopg

        for statement in ("UPDATE area_geography SET name = 'Somewhere' WHERE id = %s",
                          "UPDATE area_geography SET parent_id = 'uk:region:E12000006' WHERE id = %s",
                          "DELETE FROM area_geography WHERE id = %s"):
            with self.subTest(statement), self.connect() as connection:
                with self.assertRaises(psycopg.errors.RaiseException):
                    connection.execute(statement, (CAMDEN,))
        with self.connect() as connection:
            changed = connection.execute("SELECT refresh_geography_tree() AS n").fetchone()["n"]
            connection.rollback()
        self.assertEqual(changed, 0)  # the tree is already whole

    def test_the_tile_release_hashes_the_tile_kinds_only(self):
        row = self.rows("""SELECT area_tile_release() AS release, 'a2-' || left(md5(string_agg(id, ',' ORDER BY id)), 12)
            AS tiles FROM area_geography WHERE kind::text IN ('lsoa', 'msoa', 'lad')""")[0]
        self.assertEqual(row["release"], row["tiles"])

    def test_the_api_serves_the_tree_up_to_the_lad(self):
        self.assertEqual(self.reader.get_area(CAMDEN, "crime", "2026-06")["parentId"], None)
        for query in ("London", "England", "United Kingdom", "East of England", "E12000007", "GB"):
            found = [result.get("geographyId") or "" for result in self.reader.search_areas(query)["results"]]
            self.assertFalse([gid for gid in found if gid.split(":")[1:2] in (["region"], ["nation"], ["country"])],
                             query)
        areas = area_pages.hierarchy(self.reader)["areas"]
        self.assertEqual({a["carrier"] for a in areas}, {"lsoa", "msoa", "lad"})
        self.assertEqual({a["geographyId"]: a["parentId"] for a in areas if a["carrier"] == "lad"},
                         {CAMDEN: None, "uk:lad:E07000072": None})
        self.assertEqual([a["geographyId"] for a in area_pages.trail(self.reader, CAMDEN_001A)["areas"]],
                         [CAMDEN, "uk:msoa:E02000166", CAMDEN_001A])
        self.assertEqual(self.reader.area_lookup([CAMDEN])["places"][CAMDEN]["parentId"], None)
        with self.connect() as connection:  # a region is no area to exclude from a search
            self.assertEqual(repository.expand_area_ids(connection, [LONDON]), (set(), {LONDON}))


class AreaOverviewTests(PostgisTestCase):
    def test_area_pack_reads_market_crime_noise_and_nearby_schools(self):
        pack = self.reader.get_area_pack(CAMDEN_001A)

        self.assertEqual(pack["market"]["resale"], {"medianPricePerSquareMetre": 9500, "sampleSize": 60})
        self.assertEqual((pack["crime"]["value"], pack["crime"]["offences"], pack["crime"]["asbOffences"]), (60.0, 18, 5))
        self.assertTrue(pack["noise"]["available"])
        nearest = pack["schools"]["nearest"]
        self.assertEqual([school["urn"] for school in nearest], ["900001", "900002"])
        self.assertIsNotNone(nearest[0]["standingInspection"])
        self.assertEqual({source["release"] for source in pack["sources"]},
                         {"fixture-hmlr-2026-06", "fixture-police-2026-06", "fixture-noise-2026", "fixture-schools-2026"})

    def test_schools_outside_london_follow_the_england_flag(self):
        self.assertEqual([s["urn"] for s in self.schools(EPPING_001A)], ["900003"])
        self.england(False)
        self.assertEqual(self.schools(EPPING_001A), [])

    def schools(self, area_id):
        return self.reader.get_area_pack(area_id)["schools"]["nearest"]

    def test_overview_tool_joins_the_pack_places_and_price_trend(self):
        envelope = call_tool("get_area_overview", ToolContext(reader=self.reader), {"area_id": CAMDEN_001A})
        value = envelope["value"]

        self.assertEqual((value["borough"], value["center"]), ("Camden", [-0.165, 51.524]))
        self.assertEqual(value["outcodes"], ["NW1", "NW3"])
        self.assertEqual([(p["period"], p["value"]) for p in value["priceTrend"]][-1], ("2026-06", 9000.0))
        self.assertEqual(envelope["confidence"], "high")
        self.assertEqual(value["crime"]["asbOffences"], 5)

    def test_profile_counts_schools_within_a_kilometre_and_reads_noise(self):
        profile = self.reader.get_profile(CAMDEN_001A, "2026-06")

        self.assertEqual(profile["schools"], {"primary": 1, "secondary": 1, "radiusMetres": 1000})
        self.assertEqual(profile["noise"], {"available": True, "any55Share": 30.0})
        self.assertEqual({m["metricId"]: m["value"] for m in profile["metrics"]}, {PRICE: 9000.0, "crime": 60.0})


class HomesNearTests(PostgisTestCase):
    def test_postcodes_within_800_metres_nearest_first_without_hidden_homes(self):
        near = homes_near.homes_near(self.connect, 51.524, -0.165)

        self.assertEqual(near["productReleaseId"], "fixture-2026-06")
        # NW1 0AB has two addresses, one hidden by an objection; NW3 9ZZ is about 4 km away.
        self.assertEqual([(p["postcode"], p["homes"]) for p in near["postcodes"]], [("NW1 0AA", 3), ("NW1 0AB", 1)])
        self.assertLess(near["postcodes"][0]["metres"], near["postcodes"][1]["metres"])
        self.assertLess(near["postcodes"][1]["metres"], 800)

    def test_limit_and_a_point_outside_the_homes_box(self):
        self.assertEqual(len(homes_near.homes_near(self.connect, 51.524, -0.165, limit=1)["postcodes"]), 1)
        self.assertEqual(homes_near.homes_near(self.connect, 53.48, -2.24)["postcodes"], [])  # Manchester


LONDON, EAST = "uk:region:E12000007", "uk:region:E12000006"
ENGLAND, GB = "uk:nation:E92000001", "uk:country:GB"


class CoverageTests(PostgisTestCase):
    """Metric coverage from the data (§11 step 6, migration 126), served in the metric catalog."""

    def catalog(self):
        return {metric["id"]: {c["scopeId"]: c["share"] for c in metric.get("coverage", [])}
                for metric in self.reader.list_metrics()["metrics"]}

    def test_the_catalogs_coverage_is_the_data_for_every_metric(self):
        """Counted here from metric_value and area_geography alone: for each metric at its carrier, every region,
        nation and country with a value in some month, and the share of its areas with one in its latest such month."""
        with self.connect() as connection:
            values = connection.execute(
                "SELECT mv.metric_id, mv.period, mv.geography_id, g.region_id, r.parent_id AS nation_id, g.country_id"
                " FROM metric_value mv JOIN metric_definition m ON m.id = mv.metric_id"
                " JOIN area_geography g ON g.id = mv.geography_id AND g.kind::text = m.carrier::text"
                " JOIN area_geography r ON r.id = g.region_id WHERE mv.value IS NOT NULL").fetchall()
            areas = connection.execute(
                "SELECT g.kind::text AS kind, g.region_id, r.parent_id AS nation_id, g.country_id FROM area_geography g"
                " JOIN area_geography r ON r.id = g.region_id").fetchall()
            carriers = {row["id"]: row["carrier"] for row in connection.execute(
                "SELECT id, carrier::text AS carrier FROM metric_definition")}
        totals, months = {}, {}
        for area in areas:
            for scope_id in (area["region_id"], area["nation_id"], area["country_id"]):
                totals[area["kind"], scope_id] = totals.get((area["kind"], scope_id), 0) + 1
        for row in values:
            for scope_id in (row["region_id"], row["nation_id"], row["country_id"]):
                months.setdefault((row["metric_id"], scope_id), {}).setdefault(row["period"], set()).add(row["geography_id"])
        expected = {metric: {} for metric in carriers}
        for (metric, scope_id), by_month in months.items():
            expected[metric][scope_id] = round(len(by_month[max(by_month)]) / totals[carriers[metric], scope_id], 3)

        self.assertEqual(self.catalog(), expected)
        # The seed's numbers: short lets in 29 of Camden's 30 LSOAs and nowhere else; £/m² suppressed in one.
        self.assertEqual(expected["short-lets-per-1000"], {LONDON: 0.967, ENGLAND: 0.806, GB: 0.806})
        self.assertEqual(expected[PRICE], {LONDON: 0.967, EAST: 1.0, ENGLAND: 0.972, GB: 0.972})
        self.assertEqual(expected["crime"], {LONDON: 1.0, EAST: 1.0, ENGLAND: 1.0, GB: 1.0})

    def test_with_england_off_the_catalog_speaks_of_london_alone(self):
        self.england(False)
        coverage = self.catalog()
        self.assertEqual(coverage["crime"], {LONDON: 1.0})
        self.assertEqual(coverage["short-lets-per-1000"], {LONDON: 0.967})

    def test_activating_a_release_rebuilds_the_coverage_of_what_it_serves(self):
        with self.connect() as connection:
            stored = connection.execute("SELECT rebuild_metric_coverage('fixture-2026-06') AS n").fetchone()["n"]
            self.assertEqual(stored, connection.execute("SELECT count(*) AS n FROM metric_coverage").fetchone()["n"])
            # Epping Forest loses its crime: the release that goes live covers London alone.
            connection.execute("UPDATE metric_value SET value = NULL WHERE metric_id = 'crime'"
                               " AND geography_id LIKE 'uk:lsoa:E01021%%'")
            connection.execute("INSERT INTO product_release (id, geography_vintage, transformation_versions, assets,"
                               " validation_status, validation_record) SELECT 'fixture-recover', geography_vintage,"
                               " transformation_versions, assets, 'passed', '{}' FROM product_release"
                               " WHERE id = 'fixture-2026-06'")
            connection.execute("INSERT INTO product_release_member SELECT 'fixture-recover', source_release_id"
                               " FROM product_release_member WHERE release_id = 'fixture-2026-06'")
            # The coverage guard (migration 134) refuses this drop unless it is accepted for the run.
            connection.execute("SELECT set_config('close_knit.coverage_drop_threshold_percent', '100', true)")
            connection.execute("SELECT activate_product_release('fixture-recover')")
            crime = connection.execute(
                "SELECT release_id, scope_id, with_value, total FROM metric_coverage WHERE metric_id = 'crime'"
                " AND period = '2026-06-01' ORDER BY 1, 2").fetchall()
            connection.rollback()

        self.assertEqual([tuple(row.values()) for row in crime if row["release_id"] == "fixture-recover"],
                         [("fixture-recover", GB, 30, 36), ("fixture-recover", ENGLAND, 30, 36),
                          ("fixture-recover", LONDON, 30, 30)])
        # The release it replaced keeps its rows (it was live while the new one was built); any older would go.
        self.assertEqual({row["release_id"] for row in crime}, {"fixture-2026-06", "fixture-recover"})


class ScopeTests(PostgisTestCase):
    """One Scope per request (§11 step 4): the served regions as a SQL filter on region_id."""

    def lsoas(self, served, sql="-- t\nSELECT id AS geography_id FROM area_geography WHERE kind = 'lsoa' ORDER BY id"):
        with self.connect() as connection:
            return [row["geography_id"] for row in connection.execute(served.rows(sql, order="geography_id"))]

    def test_the_grants_are_the_scope_grant_rows(self):
        with self.connect() as connection:
            rows = connection.execute("SELECT flag, area_id FROM scope_grant").fetchall()
        self.assertEqual({row["flag"]: row["area_id"] for row in rows}, scope.GRANTS)

    def test_the_filter_keeps_the_served_regions_areas_in_order(self):
        london, everything = self.lsoas(scope.LONDON), self.lsoas(scope.ENGLAND)
        self.assertEqual(london, [f"uk:lsoa:E01000{900 + n}" for n in range(30)])
        self.assertEqual(len(everything), 36)
        self.assertEqual(self.lsoas(scope.ENGLAND.within(("E12000006",))),
                         [f"uk:lsoa:E0102170{n}" for n in range(6)])

    def test_reads_with_england_off_hold_londons_areas_alone(self):
        self.england(False)
        with self.connect() as connection:
            ranges = repository.range_rows(connection, [{"layer": "crime"}])
        self.assertEqual({row["geography_id"][:13] for row in ranges}, {"uk:lsoa:E0100"})
        self.assertEqual(len(ranges), 30)
        hierarchy = area_pages.hierarchy(self.reader)["areas"]
        self.assertEqual({area["regionCode"] for area in hierarchy}, {"E12000007"})
        self.assertEqual(len(self.reader.area_boxes("lsoa")["areas"]), 30)
        self.assertIsNone(self.reader.area_at(0.11, 51.66))  # Epping Forest: not served
        self.england(True)
        self.assertEqual(self.reader.area_at(0.11, 51.66), "uk:lsoa:E01021701")
        self.assertEqual(len(self.reader.area_boxes("lsoa")["areas"]), 36)

    def test_an_area_outside_london_is_worded_for_its_region(self):
        from area_api import standouts

        payload = standouts.area_standouts(self.reader, EPPING_002C)
        words = " ".join([payload["verdict"], *payload["caveats"], *(tag["text"] for tag in payload["tags"])])
        self.assertIn("East of England", words)
        self.assertNotIn("London", words)
        camden = standouts.area_standouts(self.reader, CAMDEN_001A)
        self.assertIn("London's best or worst 10%", camden["caveats"][0])


if __name__ == "__main__":
    unittest.main()
