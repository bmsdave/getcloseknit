"""Company and overseas ownership (area-ownership.v1): titles per 100 homes against London, behind its flag."""
import os
import unittest
from unittest import mock

from area_api import envelope, evidence, feature_flags, ownership

ROW = {"geography_id": "uk:lsoa:E01004736", "titles_company": 120, "titles_overseas": 30, "homes": 800,
       "unmatched": 0, "kind": "lsoa", "company_share": 0.15, "overseas_share": 0.0375,
       "company_percentile": 92, "overseas_percentile": 97, "london_company_share": 0.041,
       "london_overseas_share": 0.006, "source_release_id": "src-hmlr-ownership-2026-10-abc"}
SOURCE = {"id": "src-hmlr-ownership-2026-10-abc", "source_url": "https://use-land-property-data.service.gov.uk/datasets",
          "licence": "HMLR", "attribution": "Contains HM Land Registry data © Crown copyright and database right 2026."}


class Loaded:
    def __init__(self, row=ROW):
        self.row = row

    def execute(self, sql, params=()):
        part = sql.split("\n", 1)[0].removeprefix("-- evidence:area-ownership-")
        if part == "row":
            return [self.row] if self.row else []
        if part == "sources":
            return [SOURCE]
        raise AssertionError(part)


class OwnershipValueTests(unittest.TestCase):
    def test_shares_percentiles_and_words(self):
        value = ownership.ownership_value(Loaded(), "uk:lsoa:E01004736")
        self.assertEqual(value["company"], {"titles": 120, "share": 0.15, "regionPercentile": 92, "regionShare": 0.041})
        self.assertEqual(value["overseas"]["share"], 0.0375)
        self.assertEqual(value["homes"], 800)
        self.assertEqual(value["words"], "High company ownership")
        self.assertEqual(value["notes"], ["15 company titles per 100 homes (London 4)",
                                          "4 overseas-company titles per 100 homes (London 0.6)"])
        self.assertEqual(value["sourceVersions"], ["src-hmlr-ownership-2026-10-abc"])

    def test_low_shares_read_as_owner_or_tenant_homes(self):
        row = {**ROW, "company_percentile": 30, "overseas_percentile": 40}
        self.assertEqual(ownership.ownership_value(Loaded(row), "x")["words"], "Mostly owner/tenant homes")

    def test_few_homes_have_no_share_and_boroughs_say_unmatched(self):
        row = {**ROW, "homes": 6, "company_share": None, "overseas_share": None, "company_percentile": None,
               "overseas_percentile": None}
        value = ownership.ownership_value(Loaded(row), "x")
        self.assertIsNone(value["company"]["share"])
        self.assertIsNone(value["words"])
        borough = ownership.ownership_value(Loaded({**ROW, "kind": "lad", "unmatched": 412}), "uk:lad:E09000033")
        self.assertIn("412 titles with no usable postcode are counted for the borough only", borough["notes"])

    def test_not_loaded_is_none(self):
        self.assertIsNone(ownership.ownership_value(Loaded(None), "x"))

        class Missing:
            def execute(self, sql, params=()):
                raise RuntimeError("relation area_ownership does not exist")

        self.assertIsNone(ownership.ownership_value(Missing(), "x"))


class Reader:
    def __init__(self, connection):
        self.connection = connection

    def _connect(self):
        reader = self

        class Context:
            def __enter__(self):
                return reader.connection

            def __exit__(self, *exc):
                return False

        return Context()


class ConnectionWithArea(Loaded):
    def execute(self, sql, params=()):
        if "evidence:area-ownership" in sql:
            return super().execute(sql, params)
        return [{"release_id": "rel-1", "id": "uk:lsoa:E01004736"}]


class EnvelopeTests(unittest.TestCase):
    def test_flag_off_hides_the_block(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_OWNERSHIP": ""}):
            self.assertFalse(feature_flags.ownership())
            body = ownership.area_ownership(Reader(ConnectionWithArea()), "uk:lsoa:E01004736")
        self.assertEqual(body["schemaVersion"], "area-ownership.v1")
        self.assertEqual(body["value"], {"available": False, "reason": "flag-off"})
        self.assertEqual(body["confidence"], "none")
        self.assertEqual(set(body), {"schemaVersion", "productReleaseId", "dataMode", "value", "confidence",
                                     "evidence", "sources", "caveats"})

    def test_flag_on_returns_the_envelope(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_OWNERSHIP": "1"}), \
                mock.patch.object(evidence, "_active_release", return_value="rel-1"):
            body = ownership.area_ownership(Reader(ConnectionWithArea()), "uk:lsoa:E01004736")
        self.assertTrue(body["value"]["available"])
        self.assertEqual(body["confidence"], "high")
        self.assertEqual([row["metricId"] for row in body["evidence"]],
                         ["ownership-company-share", "ownership-overseas-share"])
        self.assertEqual(body["evidence"][0]["value"], 15.0)
        self.assertEqual(body["sources"][0]["release"], SOURCE["id"])
        self.assertTrue(any("titles, not homes" in caveat for caveat in body["caveats"]))
        self.assertIn(body["confidence"], envelope.CONFIDENCE_BANDS)

    def test_bad_area_ids_are_refused(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_OWNERSHIP": "1"}), self.assertRaises(evidence.MalformedQuery):
            ownership.area_ownership(Reader(ConnectionWithArea()), "nope")


if __name__ == "__main__":
    unittest.main()
