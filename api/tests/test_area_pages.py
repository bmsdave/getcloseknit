"""Area guide and ranking reads: the borough → MSOA → LSOA tree and one metric at a chosen carrier."""
import os
import unittest
from unittest import mock

from area_api import area_pages, evidence
from tests.test_production_evidence import OLD_CRIME, FakeConnection, seed_production_fixture

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None


class AreaPagesConnection(FakeConnection):
    """The production fake plus the two area-pages reads; schools counted per area."""

    def __init__(self, source, schools=None):
        self.__dict__.update(source.__dict__)
        self.schools = schools if schools is not None else {"uk:lad:E09000007": (3, 1)}

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- area-pages:schools-loaded":
            return [{"loaded": bool(self.schools)}]
        if marker == "-- area-pages:regions":
            return [{"area_id": g["id"], "region_code": "E12000007"} for g in self.geographies.values()]
        if marker == "-- area-pages:hierarchy":
            return [{"id": g["id"], "name": g["name"], "carrier": g["kind"], "parent_id": g["parent_id"],
                     "primary_count": self.schools.get(g["id"], (0, 0))[0],
                     "secondary_count": self.schools.get(g["id"], (0, 0))[1]}
                    for g in sorted(self.geographies.values(), key=lambda g: g["id"])]
        if marker == "-- area-pages:carrier-values":
            self.statements.append((sql, params))
            metric_id, period, carrier = params
            return [self._joined_row(row) for row in self.values
                    if row["metric_id"] == metric_id and row["period"] == period
                    and row["source_release_id"] in self.member_sources()
                    and self.geographies[row["geography_id"]]["kind"] == carrier]
        return super().execute(sql, params)


def _connection(**kwargs):
    connection = AreaPagesConnection(seed_production_fixture(), **kwargs)
    connection.values.append({
        "geography_id": "uk:lad:E09000007", "metric_id": "crime", "period": "2026-06",
        "value": 172.8, "region_percentile": 94, "country_percentile": None, "sample_count": 37489,
        "quality": "observed", "source_release_id": OLD_CRIME, "carrier": "lad", "name": "Camden",
    })
    return connection


def _reader(connection):
    return evidence.EvidenceReader(connect=lambda: connection)


class AreaPagesReaderTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(area_pages.release_store.use_memory())

    def test_hierarchy_carries_regions_and_cuts_to_one(self):
        reader = _reader(_connection())
        everything = area_pages.hierarchy(reader)
        london = area_pages.hierarchy(reader, region="E12000007")
        by_area = area_pages.hierarchy(reader, region="uk:lad:E09000007", carrier="borough")
        north_west = area_pages.hierarchy(reader, region="E12000002")

        self.assertTrue(all(area["regionCode"] == "E12000007" for area in everything["areas"]))
        self.assertNotIn("region", everything)
        self.assertEqual(len(london["areas"]), len(everything["areas"]))
        self.assertEqual(london["region"], {"code": "E12000007", "name": "London"})
        self.assertEqual([area["geographyId"] for area in by_area["areas"]], ["uk:lad:E09000007"])
        self.assertEqual(north_west["areas"], [])
        with self.assertRaises(evidence.MalformedQuery):
            area_pages.hierarchy(reader, region="nowhere")
        with self.assertRaises(evidence.AreaNotFound):
            area_pages.hierarchy(reader, region="uk:msoa:E02999999")
        with self.assertRaises(evidence.MalformedQuery):
            area_pages.hierarchy(reader, carrier="street")

    def test_value_pack_cut_to_a_region(self):
        reader = _reader(_connection())
        pack = area_pages.carrier_values(reader, "crime", "2026-06", "borough")

        self.assertIs(area_pages.in_region(reader, pack, ""), pack)
        self.assertEqual(len(area_pages.in_region(reader, pack, "E12000007")["values"]), len(pack["values"]))
        self.assertEqual(area_pages.in_region(reader, pack, "E12000009")["values"], [])
        self.assertEqual(area_pages.in_region(reader, pack, "E12000009")["region"]["name"], "South West")

    def test_hierarchy_links_parents_and_counts_schools_only_above_lsoa(self):
        payload = area_pages.hierarchy(_reader(_connection()))
        areas = {area["geographyId"]: area for area in payload["areas"]}

        self.assertEqual(payload["schemaVersion"], "area-hierarchy.v1")
        self.assertEqual(areas["uk:lsoa:E01000004"]["parentId"], "uk:msoa:E02000004")
        self.assertEqual(areas["uk:msoa:E02000004"]["parentId"], "uk:lad:E09000007")
        self.assertEqual(areas["uk:lad:E09000007"]["schools"], {"primary": 3, "secondary": 1})
        self.assertEqual(areas["uk:msoa:E02000004"]["schools"], {"primary": 0, "secondary": 0})
        self.assertIsNone(areas["uk:lsoa:E01000004"]["schools"])

    def test_trail_is_the_area_and_its_parents_root_first(self):
        connection = _connection()
        reads = []
        execute = connection.execute
        connection.execute = lambda sql, params=(): (reads.append(sql.split("\n", 1)[0]), execute(sql, params))[1]
        reader = _reader(connection)
        payload = area_pages.trail(reader, "uk:lsoa:E01000004")

        self.assertEqual(payload["schemaVersion"], "area-hierarchy.v1")
        self.assertEqual([area["geographyId"] for area in payload["areas"]],
                         ["uk:lad:E09000007", "uk:msoa:E02000004", "uk:lsoa:E01000004"])
        self.assertEqual(payload["areas"][0]["schools"], {"primary": 3, "secondary": 1})
        self.assertEqual(payload["region"], {"code": "E12000007", "name": "London"})
        self.assertEqual([area["geographyId"] for area in area_pages.trail(reader, "uk:lad:E09000007")["areas"]],
                         ["uk:lad:E09000007"])
        # The tree is read once per release (release_artifact), shared with England's /api/v1/hierarchy (built by
        # release_build).
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "1"}):
            area_pages.hierarchy(reader)
        self.assertEqual(reads.count("-- area-pages:hierarchy"), 1)
        with self.assertRaises(evidence.AreaNotFound):
            area_pages.trail(reader, "uk:lsoa:E01999999")

    def test_schools_are_unknown_when_none_are_loaded(self):
        payload = area_pages.hierarchy(_reader(_connection(schools={})))
        self.assertTrue(all(area["schools"] is None for area in payload["areas"]))

    def test_carrier_values_serve_a_non_native_carrier(self):
        pack = area_pages.carrier_values(_reader(_connection()), "crime", "2026-06", "borough")

        self.assertEqual(pack["carrier"], "lad")
        self.assertEqual([(v["geographyId"], v["value"], v["carrier"]) for v in pack["values"]],
                         [("uk:lad:E09000007", 172.8, "lad")])
        self.assertEqual(pack["values"][0]["sampleCount"], 37489)

    def test_carrier_values_reject_bad_input(self):
        reader = _reader(_connection())
        with self.assertRaises(evidence.MalformedQuery):
            area_pages.carrier_values(reader, "crime", "2026-06", "street")
        with self.assertRaises(evidence.MalformedQuery):
            area_pages.carrier_values(reader, "crime", "june", "borough")
        with self.assertRaises(evidence.PeriodNotFound):
            area_pages.carrier_values(reader, "crime", "1999-01", "borough")
        with self.assertRaises(evidence.MetricNotFound):
            area_pages.carrier_values(reader, "nope", "2026-06", "borough")


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class AreaPagesHttpTests(unittest.TestCase):
    def setUp(self):
        self._previous = app_module._reader
        app_module._reader = _reader(_connection())
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_round_trip_and_errors(self):
        tree = self.client.get("/api/v1/hierarchy")
        values = self.client.get("/api/v1/area-values/crime/2026-06", params={"carrier": "borough"})
        bad_carrier = self.client.get("/api/v1/area-values/crime/2026-06", params={"carrier": "street"})
        missing_period = self.client.get("/api/v1/area-values/crime/1999-01", params={"carrier": "borough"})
        trail = self.client.get("/api/v1/areas/uk%3Alsoa%3AE01000004/trail")
        unknown_trail = self.client.get("/api/v1/areas/uk:lsoa:E01999999/trail")

        self.assertEqual(tree.status_code, 200)
        self.assertEqual(len(tree.json()["areas"]), 4)
        self.assertEqual(values.status_code, 200)
        self.assertEqual(values.json()["values"][0]["name"], "Camden test borough")
        self.assertEqual(bad_carrier.status_code, 400)
        self.assertEqual(missing_period.status_code, 404)
        self.assertEqual(trail.status_code, 200)
        self.assertEqual(len(trail.json()["areas"]), 3)
        self.assertEqual(unknown_trail.status_code, 404)


if __name__ == "__main__":
    unittest.main()
