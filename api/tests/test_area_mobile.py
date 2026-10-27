"""Mobile coverage (area-mobile.v1): Ofcom's borough figures for every level, in the evidence envelope."""
import contextlib
import unittest

from area_api import evidence, mobile

CAMDEN = {"geography_id": "uk:lad:E09000007", "name": "Camden", "premises": 122219,
          "outdoor_4g_all_mno": 1.0, "indoor_4g_all_mno": 0.9988, "outdoor_5g_any": 1.0, "outdoor_5g_all": 1.0,
          "indoor_percentile": 91, "outdoor_5g_percentile": 50, "london_indoor": 0.9921, "london_5g": 0.9999,
          "source_release_id": "src-ofcom-mobile"}
SOURCE = {"id": "src-ofcom-mobile", "source_url": "https://www.ofcom.org.uk/x.zip", "licence": "OGL-3.0",
          "attribution": "Ofcom Connected Nations"}


class Connection:
    """Answers each query by its first line; every LSOA, MSOA and borough in Camden resolves to Camden."""

    def __init__(self, row=CAMDEN):
        self.row = row
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((sql.split("\n", 1)[0], params))
        if "evidence:active-release" in sql:
            return [{"release_id": "rel-1"}]
        if "area-exists" in sql or "SELECT 1 FROM area_geography" in sql:
            return [{"exists": 1}]
        if "evidence:area-mobile-sources" in sql:
            return [SOURCE]
        if "evidence:area-mobile" in sql:
            return [self.row] if self.row else []
        return [{"exists": 1}]


class Reader:
    def __init__(self, connection):
        self.connection = connection

    @contextlib.contextmanager
    def _connect(self):
        yield self.connection


class MobileValueTests(unittest.TestCase):
    def test_value_with_london_context(self):
        value = mobile.mobile_value(Connection(), "uk:lsoa:E01000842")
        self.assertEqual(value["borough"], {"id": "uk:lad:E09000007", "name": "Camden"})
        self.assertEqual(value["indoor4gAll"], {"share": 0.9988, "regionPercentile": 91, "regionShare": 0.9921})
        self.assertEqual(value["outdoor5gAny"], {"share": 1.0, "regionPercentile": 50, "regionShare": 0.9999})
        self.assertEqual((value["outdoor4gAll"], value["outdoor5gAll"], value["premises"]), (1.0, 1.0, 122219))
        self.assertEqual(value["notes"], ["4G indoors from all four networks at 100% of premises (London 99%)",
                                          "5G outdoors at 100% of premises (London 100%)"])

    def test_outside_london_compares_with_the_region(self):
        leeds = {**CAMDEN, "geography_id": "uk:lad:E08000035", "name": "Leeds", "region_code": "E12000003"}
        value = mobile.mobile_value(Connection(row=leeds), "uk:lsoa:E01011229")
        self.assertEqual(value["rankScope"], {"code": "E12000003", "name": "Yorkshire and The Humber"})
        self.assertEqual(value["notes"][0], "4G indoors from all four networks at 100% of premises "
                                            "(Yorkshire and The Humber 99%)")
        self.assertIn("JOIN area_region r ON r.area_id = m.geography_id", mobile.MOBILE_SQL)

    def test_every_level_reads_its_borough(self):
        for area in ("uk:lsoa:E01000842", "uk:msoa:E02000166", "uk:lad:E09000007"):
            connection = Connection()
            self.assertEqual(mobile.mobile_value(connection, area)["indoor4gAll"]["share"], 0.9988)
            self.assertEqual(connection.calls[0][1], (area,))

    def test_not_loaded_is_none(self):
        self.assertIsNone(mobile.mobile_value(Connection(row=None), "uk:lsoa:E01000842"))

        class Missing:
            def execute(self, sql, params=()):
                raise RuntimeError('relation "area_mobile" does not exist')

        self.assertIsNone(mobile.mobile_value(Missing(), "uk:lsoa:E01000842"))


class EnvelopeTests(unittest.TestCase):
    def test_evidence_envelope(self):
        body = mobile.area_mobile(Reader(Connection()), "uk:lsoa:E01000842")
        self.assertEqual(body["schemaVersion"], "area-mobile.v1")
        self.assertTrue(body["available"])
        self.assertEqual(body["grain"], "borough")
        self.assertEqual(body["confidence"], "medium")
        self.assertEqual(body["value"]["indoor4gAll"]["share"], 0.9988)
        self.assertEqual([item["metricId"] for item in body["evidence"]], ["mobile-4g-indoor", "mobile-5g-outdoor"])
        self.assertEqual(body["evidence"][0], {"metricId": "mobile-4g-indoor", "geographyId": "uk:lad:E09000007",
                                               "value": 99.88, "regionPercentile": 91})
        self.assertEqual(body["sources"], [{"release": "src-ofcom-mobile", "sourceUrl": "https://www.ofcom.org.uk/x.zip",
                                            "licence": "OGL-3.0", "attribution": "Ofcom Connected Nations"}])
        self.assertTrue(any("not measured speed" in caveat for caveat in body["caveats"]))
        self.assertTrue(any("council area" in caveat for caveat in body["caveats"]))

    def test_unloaded_is_unavailable_with_empty_parts(self):
        body = mobile.area_mobile(Reader(Connection(row=None)), "uk:lsoa:E01000842")
        self.assertEqual((body["available"], body["value"], body["confidence"], body["evidence"], body["sources"]),
                         (False, None, None, [], []))

    def test_bad_ids_are_refused(self):
        with self.assertRaises(evidence.MalformedQuery):
            mobile.area_mobile(Reader(Connection()), "not-an-area")


if __name__ == "__main__":
    unittest.main()
