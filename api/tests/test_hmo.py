"""HMO and landlord licensing (area-hmo.v1, migration 087): licensed HMOs per 1,000 homes against London,
"not published" never read as zero, and the licensing schemes in force where the area is."""
import unittest

from area_api import envelope, hmo

AREA = {"geography_id": "uk:lsoa:E01000842", "kind": "lsoa", "licensed_hmos": 12, "homes": 700,
        "per_1000_homes": 17.14, "region_percentile": 91, "london_per_1000": 6.2, "source_release_id": "src-hmo-1"}
BOROUGH = {"id": "uk:lad:E09000007", "code": "E09000007", "name": "Camden", "status": "published",
           "url": "https://camden.example/hmo.csv", "page": "https://camden.example/hmo", "updated": "2026-09-30",
           "retrieved": "2026-10-18", "source_release_id": "src-hmo-1"}
SCHEMES = [
    {"kind": "additional", "start_date": "2025-12-01", "end_date": "2030-11-30", "url": "https://camden.example/al",
     "whole_borough": True, "share": 1.0, "streets": None},
    {"kind": "selective", "start_date": "2024-01-01", "end_date": "2029-01-01", "url": "https://camden.example/sl",
     "whole_borough": False, "share": 0.4, "streets": None},
    {"kind": "selective", "start_date": "2024-01-01", "end_date": None, "url": "https://camden.example/other",
     "whole_borough": False, "share": 0.0, "streets": None},
    {"kind": "selective", "start_date": "2022-06-05", "end_date": "2027-06-04", "url": "https://camden.example/st",
     "whole_borough": False, "share": None, "streets": 24},
]
SOURCE = {"id": "src-hmo-1", "source_url": "https://www.legislation.gov.uk/ukpga/2004/34/section/232",
          "licence": "Public registers", "attribution": "Contains public sector information from London boroughs."}


class Fake:
    def __init__(self, **rows):
        self.rows = {"area": [AREA], "borough": [BOROUGH], "schemes": SCHEMES, "sources": [SOURCE], **rows}

    def execute(self, sql, params=()):
        return list(self.rows[sql.split("\n", 1)[0].removeprefix("-- evidence:area-hmo-")])


class ValueTests(unittest.TestCase):
    def test_published_with_london_and_schemes(self):
        value = hmo.hmo_value(Fake(), "uk:lsoa:E01000842")
        self.assertEqual(value["register"]["status"], "published")
        self.assertEqual(value["licensedHmos"], 12)
        self.assertEqual(value["per1000Homes"], 17.1)
        self.assertEqual(value["regionPer1000"], 6.2)
        self.assertEqual(value["regionPercentile"], 91)
        self.assertEqual([s["kind"] for s in value["schemes"]], ["additional", "selective", "selective"])
        self.assertEqual(value["schemes"][1]["coverage"], "part")
        self.assertEqual(value["notes"], [
            "12 licensed HMOs: 17.1 per 1,000 homes (London 6.2)",
            "Additional HMO licensing in force (until 30 Nov 2030)",
            "Selective licensing in force in part of the area (until 1 Jan 2029)",
            "Selective licensing in force on 24 named streets (until 4 Jun 2027)",
        ])

    def test_unpublished_register_is_never_zero(self):
        value = hmo.hmo_value(Fake(area=[], borough=[{**BOROUGH, "status": "search-only"}], schemes=[]),
                              "uk:lsoa:E01000842")
        self.assertIsNone(value["licensedHmos"])
        self.assertIsNone(value["per1000Homes"])
        self.assertEqual(value["register"]["status"], "search-only")
        self.assertEqual(value["notes"], ["Camden: HMO register not published"])

    def test_nothing_loaded_is_none(self):
        self.assertIsNone(hmo.hmo_value(Fake(borough=[]), "uk:lsoa:E01000842"))

        class Missing:
            def execute(self, sql, params=()):
                raise RuntimeError("relation hmo_register does not exist")

        self.assertIsNone(hmo.hmo_value(Missing(), "uk:lsoa:E01000842"))


class EnvelopeTests(unittest.TestCase):
    def test_wrapped_as_an_evidence_envelope(self):
        value = hmo.hmo_value(Fake(), "uk:lsoa:E01000842")
        wrapped = hmo.wrap(value, "rel-1", "uk:lsoa:E01000842", [SOURCE])
        self.assertEqual(set(wrapped) >= {"value", "confidence", "evidence", "sources", "caveats"}, True)
        self.assertEqual(wrapped["schemaVersion"], "area-hmo.v1")
        self.assertEqual(wrapped["confidence"], "high")
        self.assertEqual(wrapped["evidence"][0]["metricId"], "hmo-per-1000")
        self.assertEqual(wrapped["sources"][0]["release"], "src-hmo-1")
        self.assertTrue(any("Licensed HMOs only" in caveat for caveat in wrapped["caveats"]))
        unpublished = hmo.wrap(hmo.hmo_value(Fake(area=[], borough=[{**BOROUGH, "status": "not-found"}]),
                                             "uk:lsoa:E01000842"), "rel-1", "uk:lsoa:E01000842", [])
        self.assertEqual(unpublished["confidence"], "none")
        self.assertEqual(unpublished["evidence"], [])
        empty = hmo.wrap(None, "rel-1", "uk:lsoa:E01000842", [])
        self.assertFalse(empty["value"]["available"])
        self.assertIn(empty["confidence"], envelope.CONFIDENCE_BANDS)


if __name__ == "__main__":
    unittest.main()
