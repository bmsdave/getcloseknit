"""England's map in chunks (map_chunks, CLOSE_KNIT_ENGLAND): shapes and values per region or LAD, rolled up
to MSOAs or LADs when zoomed out, and the coverage the map reads first."""
import os
import unittest
from unittest import mock

from area_api import evidence, map_chunks, release_build, release_store
from tests.test_production_evidence import OLD_CRIME, make_reader, seed_production_fixture

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api.evidence import EvidenceReader
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

CAMDEN = "E09000007"
LONDON = "E12000007"


def fixture_with_second_value():
    """Two LSOAs with crime in June 2026, each with the rank in the country rebuild_metric_ranks stores (124)."""
    connection = seed_production_fixture()
    for row in connection.values:
        if (row["geography_id"], row["metric_id"], row["period"]) == ("uk:lsoa:E01000004", "crime", "2026-06"):
            row["country_percentile"] = 0
    connection.values.append({
        "geography_id": "uk:lsoa:E01000005", "metric_id": "crime", "period": "2026-06", "value": 61.0,
        "region_percentile": 61, "country_percentile": 100, "sample_count": None, "quality": "fallback",
        "source_release_id": OLD_CRIME, "carrier": "lsoa", "name": "Camden 002A test area",
    })
    return connection


class EnglandFlag(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "1"})
        patcher.start()
        self.addCleanup(patcher.stop)


class ChunkedBoxTests(EnglandFlag):
    """The box index per chunk (map_tiles.BOXES_SQL): the shapes themselves are area tiles."""

    def test_a_chunk_is_its_areas_and_london_whole_is_every_london_area(self):
        reader = make_reader(seed_production_fixture())

        everything = reader.area_boxes("lsoa")
        london = reader.area_boxes("lsoa", chunk=LONDON)
        camden = reader.area_boxes("lsoa", chunk=CAMDEN)

        self.assertEqual(london["areas"], everything["areas"])
        self.assertEqual(camden["areas"], everything["areas"])
        self.assertEqual(london["chunk"], LONDON)
        self.assertNotIn("chunk", everything)

    def test_other_regions_areas_stay_out_of_a_region_chunk(self):
        connection = seed_production_fixture()
        connection.area_regions["uk:lsoa:E01000005"] = "E12000008"
        reader = make_reader(connection)

        london = reader.area_boxes("lsoa", chunk=LONDON)
        south_east = reader.area_boxes("lsoa", chunk="E12000008")

        self.assertEqual([area[0] for area in london["areas"]], ["uk:lsoa:E01000004"])
        self.assertEqual([area[0] for area in south_east["areas"]], ["uk:lsoa:E01000005"])

    def test_unknown_or_malformed_chunks_are_rejected(self):
        reader = make_reader(seed_production_fixture())

        for chunk in ("E09000999", "W06000001", "london"):
            with self.assertRaises(evidence.MalformedQuery):
                reader.area_boxes("lsoa", chunk=chunk)


class ChunkedPackTests(EnglandFlag):
    def setUp(self):
        super().setUp()
        self.addCleanup(release_store.use_memory())  # packs are kept per release (release_artifact)

    def test_chunk_pack_keeps_the_chunks_areas(self):
        connection = fixture_with_second_value()
        connection.area_regions["uk:lsoa:E01000005"] = "E12000008"
        reader = make_reader(connection)

        london = reader.get_value_pack("crime", "2026-06", chunk=LONDON)
        everything = reader.get_value_pack("crime", "2026-06")

        self.assertEqual([entry["geographyId"] for entry in london["values"]], ["uk:lsoa:E01000004"])
        self.assertEqual(len(everything["values"]), 2)
        self.assertEqual(london["chunk"], LONDON)
        self.assertNotIn("chunk", everything)
        self.assertIn("breakdown", london["values"][0])

    def test_coarser_level_is_the_median_of_the_areas(self):
        reader = make_reader(fixture_with_second_value())

        borough = reader.get_value_pack("crime", "2026-06", level="borough")
        district = reader.get_value_pack("crime", "2026-06", chunk=LONDON, level="msoa")

        self.assertEqual(borough["level"], "lad")
        [entry] = borough["values"]
        self.assertEqual(entry["geographyId"], "uk:lad:E09000007")
        self.assertEqual(entry["name"], "Camden test borough")
        self.assertEqual(entry["carrier"], "lad")
        self.assertEqual(entry["value"], 58.5)  # median of 56 (June 2026) and 61
        self.assertEqual(entry["regionPercentile"], 50)  # median of 40 and 61, rounded half to even
        self.assertEqual(entry["areaCount"], 2)
        self.assertEqual(entry["quality"], "fallback")
        self.assertNotIn("breakdown", entry)
        self.assertEqual([entry["geographyId"] for entry in district["values"]], ["uk:msoa:E02000004"])

    def test_the_metrics_own_level_is_not_rolled_up(self):
        pack = make_reader(fixture_with_second_value()).get_value_pack("crime", "2026-06", level="lsoa")

        self.assertNotIn("level", pack)
        self.assertEqual(len(pack["values"]), 2)

    def test_bad_level_or_chunk_is_malformed(self):
        reader = make_reader(seed_production_fixture())

        with self.assertRaises(evidence.MalformedQuery):
            reader.get_value_pack("crime", "2026-06", level="street")
        with self.assertRaises(evidence.MalformedQuery):
            reader.get_value_pack("crime", "2026-06", chunk="E09000999")

    def test_several_chunks_in_one_request_join_each_chunks_cached_pack(self):
        connection = fixture_with_second_value()
        connection.area_regions["uk:lsoa:E01000005"] = "E12000008"
        reader = make_reader(connection)

        both = reader.get_value_pack("crime", "2026-06", chunk=f"E12000008,{LONDON}")
        built = len(connection.statements)
        london = reader.get_value_pack("crime", "2026-06", chunk=LONDON)

        self.assertEqual([entry["geographyId"] for entry in both["values"]], ["uk:lsoa:E01000005", "uk:lsoa:E01000004"])
        self.assertEqual(both["chunk"], f"E12000008,{LONDON}")
        self.assertEqual(london["values"][0], both["values"][1])
        packs = [sql for sql, _ in connection.statements[built:] if sql.startswith("-- evidence:pack")]
        self.assertEqual(packs, [], "each chunk's pack is kept on its own")
        with self.assertRaises(evidence.MalformedQuery):
            reader.get_value_pack("crime", "2026-06", chunk=",".join(f"E0700{index:04d}" for index in range(65)))
        with self.assertRaises(evidence.MalformedQuery):
            reader.get_value_pack("crime", "2026-06", chunk=f"{LONDON},,{CAMDEN}")

    def test_packs_carry_the_stored_country_ranks_beside_the_regional_ones(self):
        connection = fixture_with_second_value()
        connection.area_regions["uk:lsoa:E01000005"] = "E12000008"
        reader = make_reader(connection)

        london = reader.get_value_pack("crime", "2026-06", chunk=LONDON)["values"][0]
        south_east = reader.get_value_pack("crime", "2026-06", chunk="E12000008")["values"][0]

        self.assertEqual((london["regionPercentile"], london["countryPercentile"]), (40, 0))
        self.assertEqual((south_east["regionPercentile"], south_east["countryPercentile"]), (61, 100))
        ranks = [sql for sql, _ in connection.statements if sql.startswith("-- evidence:rolled-country-rank")]
        self.assertEqual(ranks, [], "an area's rank in the country is stored, not computed on request")

    def test_a_roll_up_is_ranked_among_englands_areas_of_its_level(self):
        connection = fixture_with_second_value()
        reader = make_reader(connection)

        [borough] = reader.get_value_pack("crime", "2026-06", level="borough")["values"]
        reader.get_value_pack("crime", "2026-06", level="borough", chunk=LONDON)

        self.assertEqual(borough["countryPercentile"], 0, "the only borough is the lowest (ties at 0)")
        ranks = [sql for sql, _ in connection.statements if sql.startswith("-- evidence:rolled-country-rank")]
        self.assertEqual(len(ranks), 1, "a level's ranks are read once per metric and month, for every chunk")

    def test_compact_pack_is_rows_of_what_the_map_paints(self):
        reader = make_reader(fixture_with_second_value())
        pack = reader.get_value_pack("crime", "2026-06", chunk=LONDON)

        compact = map_chunks.compact_pack(pack)

        self.assertEqual(compact["schemaVersion"], "area-value-pack-compact.v1")
        self.assertEqual((compact["metricId"], compact["period"], compact["chunk"], compact["carrier"]),
                         ("crime", "2026-06", LONDON, "lsoa"))
        entry = pack["values"][0]
        self.assertEqual(compact["values"][0], [entry["geographyId"], entry["value"], entry["regionPercentile"],
                                                entry["countryPercentile"], entry["quality"], None, entry["breakdown"]])
        self.assertEqual(compact["fields"], list(map_chunks.COMPACT_FIELDS))

    def test_the_release_builds_map_packs_read_no_shapes(self):
        connection = fixture_with_second_value()
        reader = make_reader(connection)

        for _, label, build in release_build.plan(reader, lambda: {}, {1}):
            if label.startswith("pack "):
                build()

        markers = {sql.split("\n", 1)[0] for sql, _ in connection.statements}
        self.assertIn("-- evidence:area-chunks", markers)  # the England views' regions
        self.assertFalse([marker for marker in markers if "geometry" in marker or "area-boxes" in marker],
                         "the shapes are area tiles, built once per boundary set")

    def test_another_worker_reads_the_chunk_index_back(self):
        make_reader(fixture_with_second_value()).get_value_pack("crime", "2026-06", chunk=LONDON)
        connection = fixture_with_second_value()
        make_reader(connection).get_value_pack("crime", "2026-06", chunk=LONDON)  # another process checks the chunk
        self.assertFalse([sql for sql, _ in connection.statements if sql.startswith("-- evidence:area-chunks")])

    def test_a_chunk_pack_is_built_once_per_release(self):
        connection = fixture_with_second_value()
        reader = make_reader(connection)

        first = reader.get_value_pack("crime", "2026-06", chunk=LONDON)
        built = len(connection.statements)

        self.assertEqual(reader.get_value_pack("crime", "2026-06", chunk=LONDON), first)
        self.assertFalse([sql for sql, _ in connection.statements[built:] if sql.startswith("-- evidence:pack")])
        self.assertNotEqual(reader.get_value_pack("crime", "2026-06"), first)


class FlagOffIsLondonTests(unittest.TestCase):
    def test_unchunked_reads_are_london_only_with_the_flag_off_and_everything_with_it_on(self):
        connection = fixture_with_second_value()
        connection.area_regions["uk:lsoa:E01000005"] = "E12000008"
        reader = make_reader(connection)

        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "0"}):
            boxes = reader.area_boxes("lsoa")
            pack = reader.get_value_pack("crime", "2026-06")
            numbers = reader.metric_values("crime", ["2026-06"])
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "1"}):
            all_boxes = reader.area_boxes("lsoa")
            all_pack = reader.get_value_pack("crime", "2026-06")
            all_numbers = reader.metric_values("crime", ["2026-06"])

        self.assertEqual([area[0] for area in boxes["areas"]], ["uk:lsoa:E01000004"])
        self.assertEqual([entry["geographyId"] for entry in pack["values"]], ["uk:lsoa:E01000004"])
        self.assertEqual(numbers["values"]["2026-06"], [56.0])
        self.assertEqual(len(all_boxes["areas"]), 2)
        self.assertEqual(len(all_pack["values"]), 2)
        self.assertEqual(sorted(all_numbers["values"]["2026-06"]), [56.0, 61.0])
        # England's ranks are the England map's: the London map's packs say what the release stores.
        self.assertIsNone(pack["values"][0]["countryPercentile"])
        self.assertEqual(sorted(entry["countryPercentile"] for entry in all_pack["values"]), [0, 100])

    def test_chunks_outside_london_are_empty_with_the_flag_off(self):
        connection = fixture_with_second_value()
        connection.area_regions["uk:lsoa:E01000005"] = "E12000008"
        reader = make_reader(connection)

        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "0"}):
            south_east = reader.get_value_pack("crime", "2026-06", chunk="E12000008")
            camden = reader.area_boxes("lsoa", chunk=CAMDEN)

        self.assertEqual(south_east["values"], [])
        self.assertEqual(len(camden["areas"]), 2)  # a London LAD is London's


class CoverageTests(EnglandFlag):
    def test_england_lists_regions_and_chunks_with_london_whole(self):
        payload = make_reader(seed_production_fixture()).map_coverage()

        self.assertEqual(payload["schemaVersion"], "map-coverage.v1")
        self.assertEqual(payload["coverage"], "england")
        self.assertEqual(payload["regions"], [{"id": LONDON, "name": "London", "bbox": [-0.19, 51.48, -0.09, 51.58]}])
        self.assertEqual([chunk["id"] for chunk in payload["chunks"]], [LONDON])
        self.assertEqual(payload["chunks"][0]["areas"], 2)
        self.assertEqual(payload["chunks"][0]["region"], LONDON)
        self.assertEqual(payload["bounds"], [[-6.45, 49.86], [1.77, 55.82]])

    def test_lads_outside_london_are_chunks_of_their_own(self):
        connection = seed_production_fixture()
        for area in ("uk:lsoa:E01000004", "uk:lsoa:E01000005", "uk:msoa:E02000004", "uk:lad:E09000007"):
            connection.area_regions[area] = "E12000002"

        payload = make_reader(connection).map_coverage()

        self.assertEqual([chunk["id"] for chunk in payload["chunks"]], [CAMDEN])
        # Each chunk names its region: the legend says "Rank in North West" over a view of one region (web).
        self.assertEqual(payload["chunks"][0]["region"], "E12000002")
        self.assertEqual([region["name"] for region in payload["regions"]], ["North West"])

    def test_flag_off_is_london_without_chunks(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "0"}):
            payload = make_reader(seed_production_fixture()).map_coverage()

        self.assertEqual(payload, map_chunks.london_payload())
        self.assertEqual(payload["chunks"], [])
        self.assertEqual(payload["bounds"], [[-0.6, 51.2], [0.4, 51.8]])


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class ChunkHttpTests(EnglandFlag):
    def setUp(self):
        super().setUp()
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=fixture_with_second_value)
        self.addCleanup(setattr, app_module, "_reader", self._previous)
        without_rate_limits(self)
        self.client = TestClient(app_module.app)

    def test_chunk_urls_naming_the_active_release_are_immutable(self):
        coverage = self.client.get("/api/v1/map/coverage").json()
        release = coverage["productReleaseId"]

        pack = self.client.get("/api/v1/value-packs/crime/2026-06", params={"chunk": LONDON, "v": release})
        stale = self.client.get("/api/v1/value-packs/crime/2026-06", params={"chunk": LONDON, "v": "old"})
        boxes = self.client.get("/api/v1/areas/boxes", params={"carrier": "msoa", "chunk": LONDON, "v": release})

        self.assertEqual(pack.status_code, 200)
        self.assertEqual(pack.headers["cache-control"], "public, max-age=31536000, immutable")
        self.assertEqual(stale.headers["cache-control"], "public, max-age=300, stale-while-revalidate=86400")
        self.assertEqual(boxes.status_code, 200)
        self.assertEqual(boxes.headers["cache-control"], "public, max-age=31536000, immutable")

    def test_rolled_up_pack_and_bad_chunk_over_http(self):
        rolled = self.client.get("/api/v1/value-packs/crime/2026-06", params={"level": "borough"})
        bad = self.client.get("/api/v1/value-packs/crime/2026-06", params={"chunk": "E09000999"})
        bad_level = self.client.get("/api/v1/value-packs/crime/2026-06", params={"level": "street"})

        self.assertEqual(rolled.json()["level"], "lad")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad_level.status_code, 422)

    def test_compact_packs_over_http(self):
        compact = self.client.get("/api/v1/value-packs/crime/2026-06",
                                  params={"chunk": LONDON, "level": "msoa", "format": "compact"})
        bad = self.client.get("/api/v1/value-packs/crime/2026-06", params={"format": "csv"})

        self.assertEqual(compact.status_code, 200)
        body = compact.json()
        self.assertEqual((body["schemaVersion"], body["level"], body["carrier"]), ("area-value-pack-compact.v1", "msoa", "msoa"))
        self.assertEqual(body["values"][0][0], "uk:msoa:E02000004")
        self.assertEqual(bad.status_code, 422)


if __name__ == "__main__":
    unittest.main()
