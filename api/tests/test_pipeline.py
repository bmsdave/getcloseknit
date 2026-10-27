"""Development pipeline (migration 085): the area-pipeline.v1 envelope, its card lines and the
unloaded state."""
import datetime
import unittest

from area_api import pipeline

ROW = {"geography_id": "uk:lsoa:E01000001", "kind": "lsoa", "area_m2": 1_000_000.0, "homes": 800,
       "homes_not_started": 120, "homes_under_construction": 40, "homes_completed_5y": 30, "homes_within_1km": 1450,
       "within_1km_not_started": 1000, "within_1km_under_construction": 450, "per_1000": 200.0,
       "region_percentile": 91, "period": datetime.date(2026, 10, 1), "source_release_id": "src-gla-ldd-pipeline-abc"}
AREAS = [
    {"geography_id": "uk:lsoa:E01000001", "id": "oa:canada-water", "name": "Canada Water", "kind": "opportunity-area",
     "url": "https://www.london.gov.uk/oa/canada-water", "overlap_m2": 700_000.0, "source_release_id": "src-gla-oa-1"},
    {"geography_id": "uk:lsoa:E01000001", "id": "hz:3", "name": "Canada Water", "kind": "housing-zone",
     "url": "https://data.london.gov.uk/dataset/housing-zones", "overlap_m2": 100_000.0, "source_release_id": "src-gla-oa-1"},
    {"geography_id": "uk:lsoa:E01000001", "id": "oa:sliver", "name": "Sliver", "kind": "opportunity-area",
     "url": "https://example.org", "overlap_m2": 10_000.0, "source_release_id": "src-gla-oa-1"},
]


class ValueTests(unittest.TestCase):
    def test_counts_rate_and_growth_areas(self):
        value = pipeline.pipeline_value(ROW, AREAS)
        self.assertEqual((value["notStarted"], value["underConstruction"], value["completed5y"]), (120, 40, 30))
        self.assertEqual(value["per1000"], 200.0)
        self.assertEqual(value["regionPercentile"], 91)
        self.assertEqual(value["within1km"], {"radiusMetres": 1000, "total": 1450, "notStarted": 1000,
                                              "underConstruction": 450})
        self.assertEqual([(a["name"], a["kind"], a["presence"]) for a in value["growthAreas"]],
                         [("Canada Water", "opportunity-area", "inside"), ("Canada Water", "housing-zone", "partly")])
        self.assertEqual(value["growthAreas"][0]["share"], 0.7)

    def test_card_notes(self):
        notes = pipeline.pipeline_value(ROW, AREAS)["notes"]
        self.assertEqual(notes[0], "≈ 1,450 new homes permitted or being built within 1 km")
        self.assertIn("Inside the Canada Water Opportunity Area", notes)
        self.assertIn("Partly in the Canada Water Housing Zone (10% of the land)", notes)

    def test_nothing_nearby_and_no_rate(self):
        row = {**ROW, "homes_within_1km": 0, "within_1km_not_started": 0, "within_1km_under_construction": 0,
               "per_1000": None, "region_percentile": None}
        value = pipeline.pipeline_value(row, [])
        self.assertEqual(value["notes"], ["No new homes permitted or being built within 1 km"])
        self.assertIsNone(value["per1000"])
        self.assertEqual(value["growthAreas"], [])


class FakeConnection:
    def __init__(self, loaded=True):
        self.loaded = loaded

    def execute(self, sql, params=()):
        if "evidence:area-pipeline-sources" in sql:
            return [{"id": "src-gla-ldd-pipeline-abc", "source_url": "https://www.london.gov.uk/ldd", "licence": "OGL-3.0",
                     "attribution": "London Development Database"}]
        if not self.loaded:
            raise RuntimeError('relation "area_pipeline" does not exist')
        if "evidence:area-pipeline-growth" in sql:
            return AREAS
        if "evidence:area-pipeline" in sql:
            return [ROW]
        raise AssertionError(sql)


class EnvelopeTests(unittest.TestCase):
    def test_envelope_contract(self):
        body = pipeline.pipeline_envelope(FakeConnection(), "uk:lsoa:E01000001", "rel-1")
        self.assertEqual(set(body), {"schemaVersion", "productReleaseId", "dataMode", "value", "confidence", "evidence",
                                     "sources", "caveats"})
        self.assertEqual(body["schemaVersion"], "area-pipeline.v1")
        self.assertEqual(body["confidence"], "high")
        self.assertEqual(body["evidence"][0]["metricId"], "pipeline-homes-per-1000")
        self.assertEqual(body["evidence"][0]["period"], "2026-10")
        self.assertEqual(body["sources"][0]["release"], "src-gla-ldd-pipeline-abc")
        self.assertTrue(any("not completions" in caveat for caveat in body["caveats"]))

    def test_unloaded_tables_give_an_empty_envelope(self):
        body = pipeline.pipeline_envelope(FakeConnection(loaded=False), "uk:lsoa:E01000001", "rel-1")
        self.assertIsNone(body["value"])
        self.assertEqual(body["confidence"], "none")
        self.assertEqual(body["sources"], [])


if __name__ == "__main__":
    unittest.main()
