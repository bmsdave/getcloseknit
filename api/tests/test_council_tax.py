"""Council tax bands (area-council-tax.v1): the band mix from VOA, the mean band against London, and a
typical bill from the borough's Band D, in the evidence envelope."""
import unittest
from contextlib import contextmanager

from area_api import council_tax, evidence

BANDS = {"geography_id": "uk:lsoa:E01000842", "kind": "lsoa", "band_a": 0, "band_b": 10, "band_c": 60, "band_d": 80,
         "band_e": 220, "band_f": 170, "band_g": 220, "band_h": 40, "total": 800, "period": "2025-03-01",
         "mean_band": 5.625, "region_percentile": 93, "source_release_id": "src-voa-ctsop-2025-e1979a4196e2"}
BOROUGH = {"id": "uk:lad:E09000007", "name": "Camden", "financial_year": "2026-27", "band_d": 2140.38,
           "source_release_id": "src-mhclg-ct-2026"}
SOURCES = [{"id": "src-mhclg-ct-2026", "source_url": "https://gov.uk/ct", "licence": "OGL-3.0", "attribution": "MHCLG"},
           {"id": "src-voa-ctsop-2025-e1979a4196e2", "source_url": "https://gov.uk/ctsop", "licence": "OGL-3.0",
            "attribution": "VOA"}]


class Loaded:
    def __init__(self, **rows):
        self.rows = {"bands": BANDS, "borough": BOROUGH, **rows}

    def execute(self, sql, params=()):
        part = sql.split("\n", 1)[0].removeprefix("-- evidence:council-tax-")
        if part == "sources":
            return [row for row in SOURCES if row["id"] in params[0]]
        row = self.rows[part]
        return [row] if row else []


class ValueTests(unittest.TestCase):
    def test_band_mix_most_common_and_typical_bill(self):
        value = council_tax.council_tax_value(Loaded(), "uk:lsoa:E01000842")
        self.assertEqual([band["band"] for band in value["bands"]], list("ABCDEFGH"))
        self.assertEqual(value["bands"][4], {"band": "E", "homes": 220, "share": 0.275})
        self.assertEqual(value["homes"], 800)
        # E and G tie on 220 homes: the lower band is named, never a coin toss.
        self.assertEqual(value["mostCommon"], "E")
        self.assertEqual(value["medianBand"], "F")
        self.assertEqual(value["meanBand"], 5.63)
        self.assertEqual(value["regionPercentile"], 93)
        self.assertEqual(value["period"], "2025-03")
        self.assertEqual(value["borough"], {"id": "uk:lad:E09000007", "name": "Camden"})
        # Band F is 13/9 of Band D.
        self.assertEqual(value["typicalBill"], {"band": "F", "amount": 3092, "bandD": 2140.38, "financialYear": "2026-27"})

    def test_bill_is_unknown_without_band_d(self):
        value = council_tax.council_tax_value(Loaded(borough={**BOROUGH, "band_d": None, "financial_year": None}),
                                              "uk:lsoa:E01000842")
        self.assertIsNone(value["typicalBill"])
        self.assertEqual(value["mostCommon"], "E")

    def test_bills_follow_the_statutory_ratios(self):
        self.assertEqual(council_tax.bill("A", 900), 600)
        self.assertEqual(council_tax.bill("D", 900), 900)
        self.assertEqual(council_tax.bill("H", 900), 1800)

    def test_nothing_loaded_is_none(self):
        self.assertIsNone(council_tax.council_tax_value(Loaded(bands=None), "uk:lsoa:E01000842"))

        class Missing:
            def execute(self, sql, params=()):
                raise RuntimeError("relation area_council_tax_band does not exist")

        self.assertIsNone(council_tax.council_tax_value(Missing(), "uk:lsoa:E01000842"))


class Reader:
    """An EvidenceReader stand-in over the fake connection."""

    def __init__(self, connection):
        self.connection = connection

    @contextmanager
    def _connect(self):
        yield self.connection


class EnvelopeTests(unittest.TestCase):
    def setUp(self):
        self._active = evidence._active_release
        evidence._active_release = lambda connection, cancel=None: "rel-test"

    def tearDown(self):
        evidence._active_release = self._active

    def _area(self, connection, area_id="uk:lsoa:E01000842"):
        class Area(Loaded):
            def execute(self, sql, params=()):
                if "area_geography WHERE id" in sql and not sql.startswith("-- evidence:council-tax-"):
                    return [{"exists": 1}]
                return connection.execute(sql, params)

        return council_tax.area_council_tax(Reader(Area()), area_id)

    def test_envelope_shape(self):
        body = self._area(Loaded())
        self.assertEqual(set(body), {"schemaVersion", "productReleaseId", "dataMode", "value", "confidence", "evidence",
                                     "sources", "caveats"})
        self.assertEqual(body["schemaVersion"], "area-council-tax.v1")
        self.assertEqual(body["productReleaseId"], "rel-test")
        self.assertEqual(body["confidence"], "high")
        self.assertEqual(body["evidence"][0]["metricId"], "council-tax-band-mean")
        self.assertEqual(body["evidence"][0]["sampleCount"], 800)
        self.assertEqual([source["release"] for source in body["sources"]],
                         ["src-mhclg-ct-2026", "src-voa-ctsop-2025-e1979a4196e2"])
        self.assertTrue(body["caveats"])

    def test_unloaded_area_is_an_empty_envelope(self):
        body = self._area(Loaded(bands=None))
        self.assertIsNone(body["value"])
        self.assertEqual(body["confidence"], "none")
        self.assertEqual(body["evidence"], [])

    def test_bad_ids_are_refused(self):
        with self.assertRaises(evidence.MalformedQuery):
            council_tax.area_council_tax(Reader(Loaded()), "E01000842")


if __name__ == "__main__":
    unittest.main()
