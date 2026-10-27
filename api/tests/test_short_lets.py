"""Short lets (area-short-lets.v1): listings per 1,000 homes, entire homes and activity against London."""
import unittest

from area_api import short_lets

CAMDEN = {"geography_id": "uk:lsoa:E01000842", "kind": "lsoa", "listings": 42, "entire_home": 33, "active_12m": 21,
          "homes": 700, "per_1000_homes": 60.0, "region_percentile": 93, "london_listings": 91_954,
          "london_entire_home": 61_074, "london_active_12m": 47_121, "london_homes": 3_423_000,
          "source_release_id": "src-inside-airbnb-london-20260917-abc", "snapshot": "2026-09-17"}
SOURCE = {"id": "src-inside-airbnb-london-20260917-abc", "source_url": "https://data.insideairbnb.com/x",
          "licence": "CC-BY-4.0", "attribution": "Inside Airbnb, insideairbnb.com, CC BY 4.0."}


class Loaded:
    def __init__(self, row=CAMDEN):
        self.row = row

    def execute(self, sql, params=()):
        if "evidence:area-short-lets-sources" in sql:
            return [SOURCE]
        if "evidence:area-exists" in sql:
            return [{"exists": 1}]
        return [self.row] if self.row else []


class ShortLetsValueTests(unittest.TestCase):
    def test_rate_shares_and_london(self):
        value = short_lets.short_lets_value(Loaded(), "uk:lsoa:E01000842")
        self.assertEqual(value["per1000Homes"], 60.0)
        self.assertEqual(value["regionPer1000Homes"], 26.9)
        self.assertEqual(value["regionPercentile"], 93)
        self.assertEqual(value["entireHomeShare"], 0.7857)
        self.assertEqual(value["regionEntireHomeShare"], 0.6642)
        self.assertEqual(value["activeShare"], 0.5)
        self.assertEqual(value["snapshot"], "2026-09-17")
        self.assertEqual(value["notes"], [
            "60 Airbnb listings per 1,000 homes (London 27)",
            "79% entire homes (London 66%)",
            "50% reviewed in the last 12 months (London 51%)",
        ])

    def test_no_listings_says_so_and_no_homes_is_no_rate(self):
        none = short_lets.short_lets_value(Loaded({**CAMDEN, "listings": 0, "entire_home": 0, "active_12m": 0,
                                                   "per_1000_homes": 0.0, "region_percentile": 0}), "uk:lsoa:E01000842")
        self.assertIsNone(none["entireHomeShare"])
        self.assertEqual(none["notes"], ["No Airbnb listings in this snapshot (London 27 per 1,000 homes)"])
        empty = short_lets.short_lets_value(Loaded({**CAMDEN, "homes": 0, "per_1000_homes": None,
                                                    "region_percentile": None}), "uk:lsoa:E01000842")
        self.assertIsNone(empty["per1000Homes"])
        self.assertEqual(empty["notes"][0], "42 Airbnb listings; no Census homes to compare with")

    def test_unloaded_is_none(self):
        self.assertIsNone(short_lets.short_lets_value(Loaded(None), "uk:lsoa:E01000842"))

        class Missing:
            def execute(self, sql, params=()):
                raise RuntimeError("relation area_short_let does not exist")

        self.assertIsNone(short_lets.short_lets_value(Missing(), "uk:lsoa:E01000842"))


class Reader:
    def __init__(self, connection):
        self.connection = connection

    def _connect(self):
        connection = self.connection

        class Context:
            def __enter__(self):
                return connection

            def __exit__(self, *exc):
                return False

        return Context()


class EnvelopeTests(unittest.TestCase):
    def test_envelope_carries_evidence_sources_and_caveats(self):
        from unittest import mock

        with mock.patch.object(short_lets.evidence, "_active_release", return_value="rel-1"):
            payload = short_lets.area_short_lets(Reader(Loaded()), "uk:lsoa:E01000842")
        self.assertEqual(payload["schemaVersion"], "area-short-lets.v1")
        self.assertEqual(payload["productReleaseId"], "rel-1")
        self.assertTrue(payload["value"]["available"])
        self.assertEqual(payload["confidence"], "high")
        self.assertEqual(payload["evidence"][0]["kind"], "short-let-count")
        self.assertEqual(payload["evidence"][0]["sampleCount"], 700)
        self.assertEqual(payload["sources"][0]["licence"], "CC-BY-4.0")
        self.assertIn("Inside Airbnb, insideairbnb.com, CC BY 4.0.", payload["caveats"])
        self.assertTrue(any("150 m" in caveat for caveat in payload["caveats"]))

    def test_not_loaded_is_unavailable_never_an_error(self):
        from unittest import mock

        with mock.patch.object(short_lets.evidence, "_active_release", return_value="rel-1"):
            payload = short_lets.area_short_lets(Reader(Loaded(None)), "uk:lsoa:E01000842")
        self.assertEqual(payload["value"], {"available": False, "notes": []})
        self.assertEqual(payload["confidence"], "none")
        self.assertEqual(payload["sources"], [])

    def test_bad_ids_are_refused(self):
        with self.assertRaises(short_lets.evidence.MalformedQuery):
            short_lets.area_short_lets(Reader(Loaded()), "E01000842")


if __name__ == "__main__":
    unittest.main()
