"""Civic context (track J): codes, council tax and representatives for an area or a postcode."""
import contextlib
import os
import unittest
from unittest import mock
from datetime import date
from decimal import Decimal

from area_api import civic

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None


def link(ward, seat, n, lsoa="E01004736", msoa="E02000977", parish="E43000236"):
    return {"country_code": "E92000001", "region_code": "E12000007", "borough_code": "E09000033",
            "ward_code": ward, "parish_code": parish, "constituency_code": seat, "police_code": "E23000001",
            "msoa_code": msoa, "lsoa_code": lsoa, "postcodes": n}


NAMES = {"E92000001": "England", "E12000007": "London", "E09000033": "Westminster",
         "E05013806": "St James's", "E05013807": "Vincent Square", "E14001172": "Cities of London and Westminster",
         "E23000001": "Metropolitan Police", "E02000977": "Westminster 018", "E01004736": "Westminster 018A"}
TAX = {"financial_year": "2026-27", "band_d_borough": Decimal("1049.55") - Decimal("510.51"),
       "band_d_gla": Decimal("510.51"), "band_a": Decimal("699.70"), "band_b": Decimal("816.32"),
       "band_c": Decimal("932.93"), "band_d": Decimal("1049.55"), "band_e": Decimal("1282.78"),
       "band_f": Decimal("1516.02"), "band_g": Decimal("1749.25"), "band_h": Decimal("2099.10"),
       "source_release_id": "src-mhclg-council-tax-2026-27"}
PEOPLE = [
    {"role": "councillor", "area_code": "E05013806", "name": "Ann Example", "party": "Labour Party",
     "elected_on": date(2026, 5, 7), "profile_url": "https://candidates.democracyclub.org.uk/person/1",
     "fetched_on": date(2026, 10, 5), "source_release_id": "src-democracy-club-2026-10-05"},
    {"role": "mp", "area_code": "E14001172", "name": "Mx Example MP", "party": "Labour",
     "elected_on": date(2024, 7, 4), "profile_url": "https://members.parliament.uk/member/1/contact",
     "fetched_on": date(2026, 10, 5), "source_release_id": "src-uk-parliament-members-2026-10-05"},
]


class FakeConnection:
    def __init__(self, links=(), postcode=None, area_exists=True, tax=True):
        self.links, self.postcode_row, self.area_exists, self.tax = list(links), postcode, area_exists, tax
        self.calls = []

    def execute(self, sql, params=()):
        marker = sql.splitlines()[0]
        self.calls.append((marker, params))
        if "active_product_release" in sql:
            return [{"release_id": "rel-test"}]
        if marker == "-- evidence:area-exists":
            return [{"?column?": 1}] if self.area_exists else []
        if marker == "-- civic:area-links":
            return self.links
        if marker == "-- civic:postcode":
            return [self.postcode_row] if self.postcode_row else []
        if marker == "-- civic:names":
            return [{"code": code, "name": NAMES[code]} for code in params[0] if code in NAMES]
        if marker == "-- civic:council-tax":
            return [TAX] if self.tax else []
        if marker == "-- civic:representatives":
            wards, seats = params
            return [p for p in PEOPLE if p["area_code"] in (wards if p["role"] == "councillor" else seats)]
        if marker == "-- civic:sources":
            return [{"id": source_id, "licence": "OGL-3.0", "attribution": f"{source_id} attribution",
                     "caveats": ["one caveat"], "release_date": date(2026, 8, 1)} for source_id in params[0]]
        raise AssertionError(f"unexpected query {marker}")


def reader(connection):
    return civic.CivicReader(connect=lambda: contextlib.nullcontext(connection))


class CivicReaderTests(unittest.TestCase):
    def test_postcodes_normalise_to_the_directory_form(self):
        self.assertEqual(civic.normalise_postcode("sw1a1aa"), "SW1A 1AA")
        self.assertEqual(civic.normalise_postcode("SW1A-1AA"), "SW1A 1AA")
        self.assertEqual(civic.normalise_postcode(" e1 6an "), "E1 6AN")
        self.assertIsNone(civic.normalise_postcode("SW1A"))
        self.assertIsNone(civic.normalise_postcode("'; drop table"))

    def test_links_share_postcodes_between_wards_largest_first(self):
        found = civic.links([link("E05013807", "E14001172", 1), link("E05013806", "E14001172", 3)])
        self.assertEqual(found["ward"], [("E05013806", 0.75), ("E05013807", 0.25)])
        self.assertEqual(found["constituency"], [("E14001172", 1.0)])
        self.assertEqual(civic.links([])["ward"], [])

    def test_lsoa_gives_place_council_tax_councillors_and_mp(self):
        connection = FakeConnection([link("E05013806", "E14001172", 9), link("E05013807", "E14001172", 1)])
        payload = reader(connection).area("uk:lsoa:E01004736")
        self.assertEqual(payload["schemaVersion"], "civic.v1")
        self.assertTrue(payload["available"])
        place = payload["place"]
        self.assertEqual(place["borough"], {"code": "E09000033", "name": "Westminster"})
        self.assertEqual(place["ward"]["name"], "St James's")
        self.assertEqual(place["policeForce"]["name"], "Metropolitan Police")
        self.assertIsNone(place["parish"], "E43 'unparished area' codes are not parishes")
        self.assertEqual(payload["livePostcodes"], 10)
        self.assertEqual([w["share"] for w in payload["wards"]], [0.9, 0.1])
        # only wards with at least a fifth of the postcodes are represented
        self.assertEqual([w["code"] for w in payload["representedWards"]], ["E05013806"])
        self.assertEqual(payload["councillors"][0]["electedOn"], "2026-05-07")
        self.assertEqual(payload["mps"][0]["areaName"], "Cities of London and Westminster")
        self.assertEqual(payload["fetchedOn"], {"councillors": "2026-10-05", "mps": "2026-10-05"})
        bands = {band["band"]: band["amount"] for band in payload["councilTax"]["bands"]}
        self.assertEqual(list(bands), list("ABCDEFGH"))
        self.assertEqual(bands["D"], 1049.55)
        self.assertEqual(payload["councilTax"]["precepts"], [{"kind": "gla", "amount": 510.51}])
        self.assertEqual({s["id"] for s in payload["sources"]}, {
            "src-onspd-2026-08", "src-mhclg-council-tax-2026-27", "src-democracy-club-2026-10-05",
            "src-uk-parliament-members-2026-10-05"})
        self.assertIn(("-- civic:area-links", ("E01004736",)), connection.calls)

    def test_two_tier_precepts_in_bill_order(self):
        from area_api import civic as civic_module

        tax = {**TAX, "band_d_gla": None, "band_d_county": Decimal("1785.42"), "band_d_police": Decimal("314.37"),
               "band_d_fire": Decimal("92.16"), "band_d_combined_authority": Decimal("36.00"), "band_d_parish": None}
        self.assertEqual(civic_module.precepts(tax), [
            {"kind": "county", "amount": 1785.42}, {"kind": "police", "amount": 314.37},
            {"kind": "fire", "amount": 92.16}, {"kind": "combined-authority", "amount": 36.0}])

    def test_council_tax_band_is_null_and_withheld_while_the_flag_is_off(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("CLOSE_KNIT_COUNCIL_TAX_BAND", None)
            payload = reader(FakeConnection([link("E05013806", "E14001172", 1)])).area("uk:lsoa:E01004736")
        self.assertIn("councilTaxBand", payload)
        self.assertIsNone(payload["councilTaxBand"])
        self.assertEqual(payload["withheld"], ["councilTaxBand"])

    def test_council_tax_band_is_still_null_with_the_flag_on_and_no_data(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_COUNCIL_TAX_BAND": "1"}):
            payload = reader(FakeConnection([link("E05013806", "E14001172", 1)])).area("uk:lsoa:E01004736")
        self.assertIsNone(payload["councilTaxBand"])
        self.assertEqual(payload["withheld"], [])

    def test_borough_lists_every_mp_but_no_councillors(self):
        connection = FakeConnection([link("E05013806", "E14001172", 9), link("E05013807", "E14001999", 1)])
        payload = reader(connection).area("uk:lad:E09000033")
        self.assertIsNone(payload["place"]["ward"])
        self.assertIsNone(payload["place"]["lsoa"])
        self.assertEqual(payload["councillors"], [])
        self.assertEqual([s["code"] for s in payload["representedConstituencies"]], ["E14001172", "E14001999"])

    def test_missing_data_stays_unknown_not_zero(self):
        payload = reader(FakeConnection([], tax=False)).area("uk:msoa:E02000977")
        self.assertFalse(payload["available"])
        self.assertIsNone(payload["councilTax"])
        self.assertIsNone(payload["place"]["borough"])
        self.assertEqual(payload["sources"], [])
        self.assertEqual(payload["fetchedOn"], {"councillors": None, "mps": None})

    def test_postcode_carries_its_dates_and_lsoa(self):
        row = {**link("E05013806", "E14001172", 1), "postcode": "SW1A 1AA",
               "introduced": date(1980, 1, 1), "terminated": None}
        payload = reader(FakeConnection(postcode=row)).postcode("sw1a1aa")
        self.assertEqual(payload["subject"], {"kind": "postcode", "geographyId": "uk:lsoa:E01004736",
                                              "postcode": "SW1A 1AA", "introduced": "1980-01", "terminated": None})
        self.assertEqual(payload["place"]["lsoa"]["name"], "Westminster 018A")
        self.assertIsNone(payload["livePostcodes"])

    def test_errors(self):
        with self.assertRaises(civic.MalformedQuery):
            reader(FakeConnection()).area("uk:ward:E05013806")
        with self.assertRaises(civic.AreaNotFound):
            reader(FakeConnection(area_exists=False)).area("uk:lsoa:E01999999")
        with self.assertRaises(civic.MalformedQuery):
            reader(FakeConnection()).postcode("not a postcode")
        with self.assertRaises(civic.PostcodeNotFound):
            reader(FakeConnection()).postcode("AB1 0AA")


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class CivicHttpTests(unittest.TestCase):
    def setUp(self):
        self._previous = app_module._civic
        row = {**link("E05013806", "E14001172", 1), "postcode": "SW1A 1AA",
               "introduced": date(1980, 1, 1), "terminated": None}
        app_module._civic = reader(FakeConnection([link("E05013806", "E14001172", 4)], postcode=row))
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._civic = self._previous

    def test_routes_answer_and_map_errors(self):
        area = self.client.get("/api/v1/areas/uk:lsoa:E01004736/civic")
        self.assertEqual(area.status_code, 200)
        self.assertEqual(area.json()["councilTax"]["financialYear"], "2026-27")
        self.assertEqual(self.client.get("/api/v1/postcodes/SW1A%201AA/civic").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/postcodes/nonsense/civic").status_code, 400)
        self.assertEqual(self.client.get("/api/v1/areas/uk:lsoa:bad/civic").status_code, 400)


if __name__ == "__main__":
    unittest.main()
