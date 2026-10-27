"""Track K: postcode home list and property profile (pure maths, SQL contract, HTTP)."""
import json
import os
import re
import unittest
from unittest import mock

from area_api import price_bands
from area_api import property_profile as pp
from area_api.evidence import NOT_SUPPRESSED_PROPERTY, Cancelled, EvidenceReader, MalformedQuery, PropertyNotFound

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api import tools
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover
    TestClient = None

UPRN = "100023336956"
ADDRESS = "uk:addr:a1b2c3d4e5f6"
ADDRESS2 = "uk:addr:b2c3d4e5f6a7"  # a home with recorded sales but no property row (B2)
NEIGHBOUR = "uk:addr:0000000000a2"
BOROUGH = "uk:lad:E09000007"
MSOA = "uk:msoa:E02000166"
LSOA = "uk:lsoa:E01000004"


def band_row(geo, sales, p10, p25, p50, p75, p90):
    return {"geography_id": geo, "window_start": "2023-01", "period": "2026-06", "sales": sales,
            "p10": p10, "p25": p25, "p50": p50, "p75": p75, "p90": p90}


# Today's flat prices (adjusted) and 2016's (nominal): the LSOA is thin, the MSOA has enough.
FLAT_BANDS = [band_row(LSOA, 4, 500_000, 560_000, 600_000, 640_000, 700_000),
              band_row(MSOA, 41, 512_300, 581_000, 640_000, 721_400, 806_000),
              band_row(BOROUGH, 900, 400_000, 480_000, 600_000, 760_000, 950_000)]
FLAT_2016 = [band_row(LSOA, 3, 300_000, 350_000, 400_000, 450_000, 480_000),
             band_row(MSOA, 12, 330_000, 370_000, 410_000, 455_000, 495_000),
             band_row(BOROUGH, 700, 300_000, 360_000, 430_000, 520_000, 640_000)]


def market_row(kind, end, median):
    return {"geography_id": BOROUGH, "property_type": kind, "window_end": end, "sales": 300,
            "median_price": median, "p5": None, "p25": None, "p75": None, "p95": None, "min_price": None,
            "max_price": None, "ppm_sales": 0, "median_ppm": None, "source_release_id": "src-hmlr",
            "attribution": "HM Land Registry"}


# The borough's market by type (R5: its flat medians are the borough same-type index).
BOROUGH_MARKET = [market_row(kind, end, median) for kind in ("all", "F")
                  for end, median in (("2016-06", 400_000), ("2026-06", 500_000))]


def home_row(address_id, display, **extra):
    row = {"address_id": address_id, "display_address": display, "postcode": "SW1A 1AA",
           "geography_id": "uk:lsoa:E01000004", "uprn": None, "property_type": "F", "tenure": "L",
           "last_date": "2019-05-01", "last_price": 400000, "sale_count": 1, "floor": 48.4,
           "current_rating": "C"}
    row.update(extra)
    return row


class FakeConnection:
    """Answers each track-K statement by its first-line marker, like test_production_evidence."""

    def __init__(self, *, active=True, property_found=True, epc=True, bands=None, years=None, suppressed=(),
                 sales=None, market_error=None, epc_homes=(), flood=None, epc_table=True, epc_missing=False):
        self.active, self.property_found, self.epc = active, property_found, epc
        self.epc_homes = list(epc_homes)  # property_epc_home rows (migration 089)
        self.epc_table = epc_table  # migration 089 applied on this database
        # epc_missing: the table is absent, so any statement against property_epc_home raises,
        # as a real missing table would (issue #182). The guard must stop those statements.
        self.epc_missing = epc_missing
        self.sales, self.market_error = sales, market_error
        self.bands = FLAT_BANDS if bands is None else bands
        self.years = FLAT_2016 if years is None else years
        self.suppressed = set(suppressed)  # uprns with a confirmed "hide this home"
        # dwelling_flood rows by UPRN: (rivers_sea_band, surface_water_band), 1 = very low.
        self.flood = {UPRN: (1, 1)} if flood is None else flood
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        self.statements.append((sql, params))
        marker = sql.split("\n", 1)[0]
        return {
            "-- evidence:active-release": lambda: [{"release_id": "rel-test"}] if self.active else [],
            "-- property-profile:property": lambda: self._property(sql, params),
            "-- evidence:property": lambda: self._property(sql, params),
            "-- evidence:property-search": lambda: self._search(sql, params),
            "-- evidence:property-by-address": lambda: self._property_by_address(sql, params),
            "-- evidence:address-home": lambda: [self._address_home_row()] if params[0] == ADDRESS2 else [],
            "-- property-profile:address-row": lambda: [self._address_home_row()] if params[0] == ADDRESS2 else [],
            "-- property-profile:address": lambda: [{"postcode": "SW1A 1AA"}],
            "-- property-profile:epc": self._epc,
            "-- property-profile:sales": self._sales,
            "-- property-profile:areas": lambda: [{
                "lsoa_id": "uk:lsoa:E01000004", "lsoa_name": "Westminster 018A", "msoa_id": MSOA,
                "msoa_name": "Westminster 018", "borough_id": BOROUGH, "borough_name": "Westminster",
                "lsoa_friendly": "St James's", "lsoa_district": "SW1A", "msoa_friendly": "St James's", "msoa_district": "SW1A"}],
            "-- property-profile:price-bands": lambda: [r for r in self.bands if r["geography_id"] in params[0]],
            "-- property-profile:price-year": lambda: [r for r in self.years if r["geography_id"] in params[0]],
            "-- property-profile:postcode-homes": self._homes,
            "-- property-profile:epc-table": lambda: self._epc_table_check(),
            "-- property-profile:epc-homes": lambda: self._epc_homes_list(params),
            "-- property-profile:epc-home": lambda: self._epc_home_one(params),
            "-- property-profile:home-index-epc": lambda: self._epc_home_index(params),
            "-- property-profile:home-index-postcodes": lambda: [{"postcode": "SW1A 1AA"}, {"postcode": "SW1A 1AB"}],
            "-- property-profile:home-index-uprns": lambda: [] if UPRN in self.suppressed else [{"uprn": UPRN}],
            "-- evidence:home-sources": lambda: [
                {"id": "src-hmlr-price-paid-complete-2026-07", "source_url": "https://www.gov.uk/ppd",
                 "licence": "OGL-3.0", "attribution": "Contains HM Land Registry data © Crown copyright",
                 "transformation_version": "t1"},
                {"id": "src-os-open-uprn-2026-08", "source_url": "https://api.os.uk/uprn",
                 "licence": "OGL-3.0", "attribution": "Contains OS data © Crown copyright",
                 "transformation_version": "t1"}],
            "-- evidence:dwelling-flood": lambda: [
                {"rivers_sea_band": self.flood[params[0]][0], "surface_water_band": self.flood[params[0]][1]}
                for _ in [0] if params[0] in self.flood and params[0] not in self.suppressed],
            "-- property-profile:type-ppm": lambda: [{"sales": 30, "p25": 9_000, "p50": 10_000, "p75": 12_000}],
            "-- market:chain": lambda: [{"id": BOROUGH, "carrier": "lad", "name": "Westminster", "depth": 0}],
            "-- market:rows": self._market,
            "-- evidence:active-source-releases": lambda: [],
            "-- property-profile:postcode-sales": lambda: [
                {"address_id": NEIGHBOUR, "date": "2001-02-03", "price": 150000, "floor": None, "ppm": None},
                {"address_id": NEIGHBOUR, "date": "2019-05-06", "price": 420000, "floor": 42.0, "ppm": 10000.0},
            ],
        }[marker]()

    def _search(self, sql, params):
        """Mirrors -- evidence:property-search: one linked home, or two unlinked
        homes for an ambiguous fragment (B2)."""
        needle = params[0].strip("%").lower()
        if "grant" in needle:
            return [self._unlinked_search_row("uk:addr:7c8b2b59fbf1",
                                             "Apartment 10, Duval House, 10 Grant Road, London, SW11 2FR"),
                    self._unlinked_search_row("uk:addr:6da61b86a5d0",
                                             "Apartment 11, Duval House, 10 Grant Road, London, SW11 2FR")]
        return self._property(sql, (UPRN,))

    def _unlinked_search_row(self, address_id, display_address):
        return {"uprn": None, "address_id": address_id, "display_address": display_address,
                "geography_id": "uk:lsoa:E01000004", "parcel_id": None, "lon": None, "lat": None,
                "source_release_id": "src-uprn", "period": None, "sale_period": None,
                "completion_date": None, "nominal_price": None, "floor": None,
                "postcode": "SW11 2FR", "sale_count": 1}

    def _property_by_address(self, sql, params):
        """Mirrors -- evidence:property-by-address."""
        if params[0] == ADDRESS:
            return self._property(sql, (UPRN,))
        return []

    def _address_home_row(self):
        return {"address_id": ADDRESS2, "display_address": "Flat 9, 10 Sample Street, London, SW1A 1AA",
                "postcode": "SW1A 1AA", "geography_id": "uk:lsoa:E01000004",
                "source_release_id": "src-uprn", "sale_count": 1}

    def _property(self, sql, params):
        if not self.property_found:
            return []
        # The real statement filters hidden homes in SQL; honour that only when the SQL asks.
        if params and params[0] in self.suppressed and "suppressed_dwelling" in sql:
            return []
        return [{
            "uprn": UPRN, "address_id": ADDRESS, "display_address": "Flat 1, 10 Sample Street, London, SW1A 1AA",
            "geography_id": "uk:lsoa:E01000004", "parcel_id": None, "lon": -0.1416, "lat": 51.501,
            "source_release_id": "src-uprn", "period": "2026-06", "sale_period": "2016-06",
            "completion_date": "2016-06-10", "nominal_price": 500000, "floor": 50.0, "sale_ppm": 10000.0,
        }]

    def _epc(self):
        if not self.epc:
            return []
        return [{"lodgement_date": "2021-03-04", "current_rating": "C", "potential_rating": "B",
                 "property_type": "Flat", "built_form": "Mid-Terrace", "construction_age_band": "1900-1929",
                 "total_floor_area": 50.4, "habitable_rooms": 3, "floor_level": "Top floor"}]

    def _market(self):
        if self.market_error:
            raise self.market_error
        return BOROUGH_MARKET

    def _sales(self):
        if self.sales is not None:
            return self.sales
        return [
            {"date": "2006-03-01", "period": "2006-03", "price": 250000, "property_type": "F", "new_build": True,
             "tenure": "L", "ppd_category": "A", "floor": None, "ppm": None},
            {"date": "2016-06-10", "period": "2016-06", "price": 500000, "property_type": "F", "new_build": False,
             "tenure": "L", "ppd_category": "A", "floor": 50.0, "ppm": 10000.0,
             "transaction_id": "3C2A1B5E-0000-4000-8000-000000000001"},
        ]

    def _epc_table_check(self):
        # to_regclass never raises for a missing table: it reports NULL, like here.
        return [{"t": self.epc_table}]

    def _epc_homes_list(self, params):
        if self.epc_missing:
            raise Exception('relation "property_epc_home" does not exist')
        return [
            {key: home[key] for key in ("uprn", "display_address", "postcode", "geography_id", "epc_type",
                                        "built_form", "floor", "current_rating")}
            | {"rivers_sea_band": self.flood.get(home["uprn"], (None, None))[0],
               "surface_water_band": self.flood.get(home["uprn"], (None, None))[1]}
            for home in self.epc_homes if home["postcode"] == params[0]][:params[1]]

    def _epc_home_one(self, params):
        if self.epc_missing:
            raise Exception('relation "property_epc_home" does not exist')
        return [home for home in self.epc_homes
                if home["uprn"] == params[0] and home["uprn"] not in self.suppressed]

    def _epc_home_index(self, params):
        if self.epc_missing:
            raise Exception('relation "property_epc_home" does not exist')
        return [{"postcode": home["postcode"], "uprn": home["uprn"]} for home in self.epc_homes]

    def _homes(self):
        return [
            home_row(NEIGHBOUR, "Flat 10, 10 Sample Street, London, SW1A 1AA", sale_count=2,
                     uprn="100023336957", rivers_sea_band=2, surface_water_band=3),
            home_row(ADDRESS, "Flat 1, 10 Sample Street, London, SW1A 1AA", uprn=UPRN,
                     rivers_sea_band=1, surface_water_band=2),
            home_row("uk:addr:0000000000a3", "Flat 2, 10 Sample Street, London, SW1A 1AA",
                     property_type=None, tenure=None, last_date=None, last_price=None, sale_count=0,
                     floor=None, current_rating=None),
        ]


EPC_UPRN = "100023336999"


def epc_home_row(uprn=EPC_UPRN, display="Flat 3, 10 Sample Street, London, SW1A 1AA", **extra):
    """A property_epc_home row as EPC_HOME_SQL returns it (EPC_HOMES_SQL takes a subset)."""
    row = {"uprn": uprn, "address_id": None, "display_address": display, "postcode": "SW1A 1AA",
           "geography_id": LSOA, "lon": -0.1415, "lat": 51.5011, "source_release_id": "src-epc",
           "lodgement_date": "2023-05-01", "current_rating": "D", "potential_rating": "C",
           "property_type": "Flat", "epc_type": "Flat", "built_form": "Mid-Terrace",
           "construction_age_band": "1930-1949", "total_floor_area": 41.6, "floor": 41.6, "habitable_rooms": 2,
           "floor_level": "Ground floor"}
    row.update(extra)
    return row


class PureTests(unittest.TestCase):
    def test_postcode_normalisation(self):
        self.assertEqual(pp.normalise_postcode("sw1a-1aa"), "SW1A 1AA")
        self.assertEqual(pp.normalise_postcode(" E14 9GU "), "E14 9GU")
        with self.assertRaises(MalformedQuery):
            pp.normalise_postcode("not a postcode")

    def test_natural_order(self):
        names = ["Flat 10, 1 Road", "Flat 2, 1 Road", "Flat 1, 1 Road"]
        self.assertEqual(sorted(names, key=pp.natural_key), ["Flat 1, 1 Road", "Flat 2, 1 Road", "Flat 10, 1 Road"])


def serve_per_home_epc(case: unittest.TestCase) -> None:
    """These tests read the EPC fields themselves; by default they are served as null (epc_policy)."""
    patcher = mock.patch.dict(os.environ, {"CLOSE_KNIT_EPC_PER_HOME": "1"})
    patcher.start()
    case.addCleanup(patcher.stop)


class PostcodeHomesTests(unittest.TestCase):
    def setUp(self):
        serve_per_home_epc(self)

    def test_lists_every_home_in_natural_order_with_unknowns_as_none(self):
        connection = FakeConnection()
        payload = pp.postcode_homes(lambda: connection, "sw1a1aa")
        self.assertEqual(payload["schemaVersion"], "postcode-homes.v1")
        self.assertEqual(payload["postcode"], "SW1A 1AA")
        self.assertEqual([h["displayAddress"][:7] for h in payload["homes"]], ["Flat 1,", "Flat 2,", "Flat 10"])
        first, empty, last = payload["homes"]
        self.assertEqual((first["propertyType"], first["tenure"], first["floorAreaSquareMetres"]),
                         ("Flat or maisonette", "Leasehold", 48))
        self.assertNotIn("estimate", last)
        self.assertEqual(last["lastSale"], {"date": "2019-05-01", "price": 400000})
        self.assertIsNone(empty["lastSale"])
        self.assertIsNone(empty["floorAreaSquareMetres"])
        self.assertIsNone(empty["tenure"])
        # Each home's own Environment Agency bands (dwelling_flood); a home with no UPRN has none.
        self.assertEqual(first["flood"], {"riversSea": "very-low", "surfaceWater": "low"})
        self.assertEqual(last["flood"], {"riversSea": "low", "surfaceWater": "medium"})
        self.assertIsNone(empty["flood"])
        homes_sql = next(sql for sql, _ in connection.statements if "postcode-homes" in sql)
        self.assertIn("dwelling_flood", homes_sql)
        self.assertIn("suppressed_dwelling", homes_sql)
        self.assertIn("active_product_release", homes_sql)
        self.assertNotIn("sales", first)
        self.assertFalse(any("postcode-sales" in sql for sql, _ in connection.statements))

    def test_include_sales_lists_each_homes_sales_in_one_statement(self):
        connection = FakeConnection()
        payload = pp.postcode_homes(lambda: connection, "SW1A 1AA", include_sales=True)
        by_address = {home["addressId"]: home["sales"] for home in payload["homes"]}
        self.assertEqual(by_address[NEIGHBOUR], [
            {"date": "2001-02-03", "nominalPrice": 150000, "floorAreaSquareMetres": None},
            {"date": "2019-05-06", "nominalPrice": 420000, "floorAreaSquareMetres": 42.0},
        ])
        self.assertEqual(by_address["uk:addr:0000000000a3"], [])
        self.assertIn("not valuations", payload["salesDisclaimer"])
        statements = [(sql, params) for sql, params in connection.statements if "postcode-sales" in sql]
        self.assertEqual(len(statements), 1)
        sql, (ids,) = statements[0]
        self.assertNotIn("uk:addr:0000000000a3", ids)  # no sales, not asked for
        self.assertIn("suppressed_dwelling", sql)
        self.assertIn("active_product_release", sql)


class PropertyProfileTests(unittest.TestCase):
    def setUp(self):
        serve_per_home_epc(self)
        self.payload = pp.property_profile(lambda: FakeConnection(), UPRN)
        self.profile = self.payload["profile"]

    def test_no_figure_for_the_home_itself(self):
        for key in ("estimate", "boroughTypeChange", "local"):
            self.assertNotIn(key, self.profile)
        self.assertEqual(self.payload["schemaVersion"], "property-profile.v2")
        self.assertIn("not a valuation of this home", self.profile["disclaimer"])
        self.assertNotIn("restated", json.dumps(self.payload).lower())

    def test_area_range_uses_the_first_level_with_enough_sales(self):
        prices = self.profile["areaPrices"]
        self.assertEqual(prices["propertyType"], "Flat or maisonette")
        self.assertEqual(prices["range"], {
            "level": "msoa", "areaId": MSOA, "areaName": "St James's · SW1A", "sales": 41,
            "since": "2023-01", "adjustedTo": "2026-06",
            "p10": 510_000, "p25": 580_000, "p50": 640_000, "p75": 720_000, "p90": 805_000})
        self.assertIsNone(prices["note"])
        self.assertEqual(prices["disclaimer"],
                         "About this area's sales, not a valuation of this home. It can't see condition or improvements.")

    def test_last_sale_position_is_a_coarse_band_with_an_area_bridge(self):
        position = self.profile["areaPrices"]["position"]
        # £500k in 2016 against the MSOA's flats that year: above p90 (£495k).
        self.assertEqual(position, {"saleDate": "2016-06-10", "year": 2016, "band": "top-10",
                                    "bandWords": "top 10%", "yearSales": 12,
                                    "today": {"from": 805_000, "to": None}})
        self.assertNotIn("percentile", json.dumps(position).lower())

    def test_price_queries_use_the_type_and_the_sale_year_only(self):
        connection = FakeConnection()
        pp.property_profile(lambda: connection, UPRN)
        bands = next(params for sql, params in connection.statements if "price-bands" in sql)
        years = next(params for sql, params in connection.statements if "price-year" in sql)
        self.assertEqual(bands, ([LSOA, MSOA, BOROUGH], "F"))
        self.assertEqual(years, ([LSOA, MSOA, BOROUGH], "F", 2016))
        sql = " ".join(statement for statement, _ in connection.statements).lower()
        for word in ("property_stock_value", "restated", "floor_area_square_metres AS floor, v."):
            self.assertNotIn(word.lower(), sql)

    def test_too_few_sales_shows_neither_range_nor_position(self):
        thin = [band_row(LSOA, 1, *[500_000] * 5), band_row(MSOA, 3, *[500_000] * 5),
                band_row(BOROUGH, 4, *[500_000] * 5)]
        prices = pp.property_profile(lambda: FakeConnection(bands=thin), UPRN)["profile"]["areaPrices"]
        self.assertIsNone(prices["range"])
        self.assertIsNone(prices["position"])
        self.assertEqual(prices["note"], "Not enough sales of this type nearby to show a range.")

    def test_thin_sale_year_keeps_the_range_and_drops_the_position(self):
        thin_year = [band_row(geo, 4, *[400_000] * 5) for geo in (LSOA, MSOA, BOROUGH)]
        prices = pp.property_profile(lambda: FakeConnection(years=thin_year), UPRN)["profile"]["areaPrices"]
        self.assertEqual(prices["range"]["level"], "msoa")
        self.assertIsNone(prices["position"])

    def test_sales_link_to_their_price_paid_record(self):
        sales = self.profile["sales"]
        self.assertIsNone(sales[0]["sourceUrl"])
        self.assertEqual(sales[1]["sourceUrl"], "https://landregistry.data.gov.uk/data/ppi/transaction/"
                                                "3C2A1B5E-0000-4000-8000-000000000001/current")

    def test_no_sale_carries_a_price_per_square_metre(self):
        # Flag off (EPC per home on, per-home £/m² off): the key is present and null.
        self.assertTrue(self.profile["sales"])
        for sale in self.profile["sales"]:
            self.assertIn("pricePerSquareMetre", sale)
            self.assertIsNone(sale["pricePerSquareMetre"])

    def test_sale_carries_a_price_per_square_metre_with_both_flags_on(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_EPC_PER_HOME": "1", "CLOSE_KNIT_PER_HOME_PRICE_PER_SQM": "1"}):
            sales = pp.property_profile(lambda: FakeConnection(), UPRN)["profile"]["sales"]
        self.assertTrue(any(sale["floorAreaSquareMetres"] for sale in sales))
        for sale in sales:
            floor = sale["floorAreaSquareMetres"]
            self.assertEqual(sale["pricePerSquareMetre"], round(sale["price"] / floor) if floor else None)
        self.assertTrue(any(sale["pricePerSquareMetre"] for sale in sales))

    def test_hidden_home_shows_nothing_not_even_its_position(self):
        self.assertIn("suppressed_dwelling", pp.PROPERTY_SQL)
        self.assertIn(NOT_SUPPRESSED_PROPERTY, pp.PROPERTY_SQL)
        connection = FakeConnection(suppressed={UPRN})
        with self.assertRaises(PropertyNotFound):
            pp.property_profile(lambda: connection, UPRN)
        self.assertFalse(any("price-year" in sql or "price-bands" in sql for sql, _ in connection.statements))

    def test_facts_sales_and_neighbours(self):
        facts = self.profile["facts"]
        self.assertEqual(facts["energyRating"], "C")
        self.assertEqual(facts["floorAreaSquareMetres"], 50)
        self.assertEqual(facts["floorLevel"], "Top floor")
        self.assertEqual(facts["tenure"], "Leasehold")
        self.assertEqual(facts["newBuildSale"], "2006-03-01")
        self.assertEqual(len(self.profile["sales"]), 2)
        self.assertNotIn(ADDRESS, [home["addressId"] for home in self.profile["otherHomes"]])
        self.assertEqual(len(self.profile["otherHomes"]), 2)
        self.assertEqual(self.profile["areas"]["borough"], {"id": BOROUGH, "name": "Westminster", "displayName": "Westminster"})

    def test_flood_is_the_homes_own_bands_and_its_neighbours(self):
        # The home's own EA bands, never its area's land (W5 1LR: a park's floodplain in the LSOA).
        self.assertEqual(self.profile["flood"], {"riversSea": "very-low", "surfaceWater": "very-low"})
        neighbour = next(home for home in self.profile["otherHomes"] if home["addressId"] == NEIGHBOUR)
        self.assertEqual(neighbour["flood"], {"riversSea": "low", "surfaceWater": "medium"})
        # No dwelling_flood row: null, so the page falls back to the postcode's homes, then the area.
        unbanded = pp.property_profile(lambda: FakeConnection(flood={}), UPRN)["profile"]
        self.assertIsNone(unbanded["flood"])

    def test_areas_carry_their_friendly_names_never_a_code_to_show(self):
        # v4 Task 24: the page names "St James's · SW1A", never "Westminster 018A".
        areas = self.profile["areas"]
        self.assertEqual(areas["lsoa"]["displayName"], "St James's · SW1A")
        self.assertEqual(areas["msoa"], {"id": MSOA, "name": "Westminster 018", "displayName": "St James's · SW1A"})
        unnamed = pp._areas({"lsoa_id": "uk:lsoa:E01000004", "lsoa_name": "Westminster 018A"}, "uk:lsoa:E01000004")
        self.assertEqual(unnamed["lsoa"]["displayName"], "Westminster 018A")
        self.assertIsNone(unnamed["msoa"])

    def test_missing_epc_is_unknown_not_zero(self):
        facts = pp.property_profile(lambda: FakeConnection(epc=False), UPRN)["profile"]["facts"]
        self.assertIsNone(facts["energyRating"])
        self.assertIsNone(facts["habitableRooms"])
        self.assertEqual(facts["floorAreaSquareMetres"], 50, "falls back to the sale's floor area")

    def test_payload_carries_no_occupant_fields(self):
        text = repr(self.payload).lower()
        for word in ("owner", "occupier", "occupant", "email", "phone", "heating_cost"):
            self.assertNotIn(word, text)

    def test_errors(self):
        with self.assertRaises(MalformedQuery):
            pp.property_profile(lambda: FakeConnection(), "12a")
        with self.assertRaises(PropertyNotFound):
            pp.property_profile(lambda: FakeConnection(property_found=False), UPRN)


ALL_FLAG_ENV = {"CLOSE_KNIT_EPC_PER_HOME": "1", "CLOSE_KNIT_PER_HOME_PRICE_PER_SQM": "1",
                "CLOSE_KNIT_PER_HOME_VALUATION": "1", "CLOSE_KNIT_EPC_ADDRESSES": "1",
                "CLOSE_KNIT_COUNCIL_TAX_BAND": "1", "CLOSE_KNIT_AIR_QUALITY": "1"}


class WithheldTests(unittest.TestCase):
    """Payloads name the features they withhold, so the web decides its fallbacks from the list."""

    def with_env(self, **env):
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in ALL_FLAG_ENV:
            if name not in env:
                os.environ.pop(name, None)

    def profile(self):
        return pp.property_profile(lambda: FakeConnection(), UPRN)["profile"]

    def test_profile_lists_withheld_when_flags_off(self):
        self.with_env()
        withheld = self.profile()["withheld"]
        self.assertIn("epc", withheld)
        self.assertIn("valuation", withheld)

    def test_profile_withheld_empty_with_all_flags_on(self):
        self.with_env(**ALL_FLAG_ENV)
        self.assertEqual(self.profile()["withheld"], [])

    def test_postcode_homes_list_withheld(self):
        self.with_env()
        payload = pp.postcode_homes(lambda: FakeConnection(), "SW1A 1AA")
        self.assertIn("epc", payload["withheld"])
        self.with_env(**ALL_FLAG_ENV)
        self.assertEqual(pp.postcode_homes(lambda: FakeConnection(), "SW1A 1AA")["withheld"], [])

    def test_council_tax_band_is_null_and_withheld_with_the_flag_off(self):
        self.with_env()
        profile = self.profile()
        self.assertIn("councilTaxBand", profile["facts"])
        self.assertIsNone(profile["facts"]["councilTaxBand"])
        self.assertIn("councilTaxBand", profile["withheld"])

    def test_council_tax_band_is_still_null_with_the_flag_on_and_no_data(self):
        self.with_env(**ALL_FLAG_ENV)
        profile = self.profile()
        self.assertIsNone(profile["facts"]["councilTaxBand"])
        self.assertNotIn("councilTaxBand", profile["withheld"])

    def test_valuation_is_null_and_withheld_with_the_flag_off(self):
        self.with_env(**{k: v for k, v in ALL_FLAG_ENV.items() if k != "CLOSE_KNIT_PER_HOME_VALUATION"})
        profile = self.profile()
        self.assertIn("valuation", profile)
        self.assertIsNone(profile["valuation"])
        self.assertEqual(profile["withheld"], ["valuation"])

    def test_valuation_by_floor_area_with_per_home_epc(self):
        self.with_env(**ALL_FLAG_ENV)
        pp._TYPE_PPM.clear()
        self.addCleanup(pp._TYPE_PPM.clear)
        statements = []

        def connect():
            connection = FakeConnection()
            statements.append(connection.statements)
            return connection
        profile = pp.property_profile(connect, UPRN)["profile"]
        # 50 m² x the MSOA's (the price range's area) flat £/m²: 9,000 / 10,000 / 12,000.
        self.assertEqual(profile["valuation"], {
            "value": 500_000, "low": 450_000, "high": 600_000, "method": "floor-area",
            "vsLocalMedianPerSqm": 25.0, "vsLocalTypeMedian": -21.9})
        # Another home of the area reads the quartiles from memory (they change only with a release).
        self.assertEqual(pp.property_profile(connect, UPRN)["profile"]["valuation"], profile["valuation"])
        ppm = [params for run in statements for sql, params in run if sql.startswith("-- property-profile:type-ppm")]
        self.assertEqual(ppm, [(MSOA, "F", "2023-01-01")])

    def test_valuation_by_indexed_sale_without_per_home_epc(self):
        self.with_env(CLOSE_KNIT_PER_HOME_VALUATION="1")
        profile = self.profile()
        self.assertEqual((profile["valuation"]["method"], profile["valuation"]["value"]), ("indexed-sale", 625_000))
        self.assertIsNone(profile["valuation"]["vsLocalMedianPerSqm"])

    def test_change_since_last_sale_is_not_flagged(self):
        self.with_env()
        # The borough trend covers ten years (2016-2026), so a 2006 sale has no borough point.
        self.assertEqual(self.profile()["salesSummary"],
                         {"changeSinceLastSale": {"home": 7.0, "borough": None, "since": 2006, "until": 2016}})

    def test_only_standard_sales_are_indexed_or_compared(self):
        self.with_env(CLOSE_KNIT_PER_HOME_VALUATION="1")
        sales = FakeConnection()._sales()
        sales[-1] = {**sales[-1], "ppd_category": "B"}  # the 2016 sale is not a standard market sale
        profile = pp.property_profile(lambda: FakeConnection(sales=sales), UPRN)["profile"]
        # Left with the 2006 sale alone: before the borough's ten-year trend, so nothing to index or compare.
        self.assertIsNone(profile["valuation"])
        self.assertIsNone(profile["salesSummary"]["changeSinceLastSale"])

    def test_a_market_failure_leaves_the_change_unknown_not_the_page_down(self):
        self.with_env(CLOSE_KNIT_PER_HOME_VALUATION="1")
        with self.assertLogs("area_api.property_profile", "ERROR"):
            profile = pp.property_profile(lambda: FakeConnection(market_error=RuntimeError("boom")), UPRN)["profile"]
        self.assertEqual(profile["salesSummary"]["changeSinceLastSale"]["borough"], None)
        self.assertIsNone(profile["valuation"])
        cancelled = FakeConnection(market_error=Cancelled("stop"))
        with self.assertRaises(Cancelled):
            pp.property_profile(lambda: cancelled, UPRN)

    def test_per_sale_price_per_sqm_withheld_without_epc(self):
        self.with_env(CLOSE_KNIT_PER_HOME_PRICE_PER_SQM="1")
        profile = self.profile()
        self.assertIn("pricePerSqm", profile["withheld"])
        self.assertTrue(profile["sales"])
        for sale in profile["sales"]:
            self.assertIn("pricePerSquareMetre", sale)
            self.assertIsNone(sale["pricePerSquareMetre"])


class OtherTypeLastRecordTests(unittest.TestCase):
    """B4 (#151): a trailing 'O' (other) ancillary transfer never types the home."""

    FLAT_THEN_OTHER = [
        {"date": "1999-07-05", "period": "1999-07", "price": 65000, "property_type": "F", "new_build": False,
         "tenure": "L", "ppd_category": "A", "floor": 50.0},
        {"date": "2016-06-10", "period": "2016-06", "price": 500000, "property_type": "F", "new_build": False,
         "tenure": "L", "ppd_category": "A", "floor": 50.0},
        # A share-of-freehold transfer: Price Paid category B, type 'O', and the newest record.
        {"date": "2020-11-13", "period": "2020-11", "price": 10000, "property_type": "O", "new_build": False,
         "tenure": "F", "ppd_category": "B", "floor": 50.0},
    ]

    def with_env(self, **env):
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in ALL_FLAG_ENV:
            if name not in env:
                os.environ.pop(name, None)

    def test_a_trailing_other_record_keeps_the_homes_flat_type(self):
        self.with_env(**ALL_FLAG_ENV)
        connection = FakeConnection(sales=self.FLAT_THEN_OTHER)
        profile = pp.property_profile(lambda: connection, UPRN)["profile"]
        self.assertEqual(profile["areaPrices"]["propertyType"], "Flat or maisonette")
        self.assertEqual(profile["areaPrices"]["range"]["level"], "msoa")
        self.assertIsNotNone(profile["valuation"])
        self.assertEqual(profile["facts"]["propertyType"], "Flat or maisonette")
        bands = [params for sql, params in connection.statements if "price-bands" in sql]
        self.assertEqual(bands[0][1], "F")
        # The 'O' record itself stays in the sales list, untouched.
        self.assertEqual(profile["sales"][-1]["propertyType"], "Other")
        # Tenure stays the last record's; the position stays null (non-standard last sale).
        self.assertEqual(profile["facts"]["tenure"], "Freehold")
        self.assertIsNone(profile["areaPrices"]["position"])

    def test_all_other_sales_fall_back_to_the_epc_type_under_the_flag(self):
        sales = [{**sale, "property_type": "O"} for sale in self.FLAT_THEN_OTHER]
        self.with_env(**ALL_FLAG_ENV)  # EPC per home on; the certificate says Flat
        profile = pp.property_profile(lambda: FakeConnection(sales=sales), UPRN)["profile"]
        self.assertEqual(profile["areaPrices"]["propertyType"], "Flat or maisonette")
        self.assertIsNotNone(profile["areaPrices"]["range"])
        self.assertEqual(profile["facts"]["propertyType"], "Flat or maisonette")

    def test_all_other_sales_with_the_epc_flag_off_have_no_type(self):
        sales = [{**sale, "property_type": "O"} for sale in self.FLAT_THEN_OTHER]
        self.with_env(**{k: v for k, v in ALL_FLAG_ENV.items() if k != "CLOSE_KNIT_EPC_PER_HOME"})
        profile = pp.property_profile(lambda: FakeConnection(sales=sales), UPRN)["profile"]
        self.assertIsNone(profile["areaPrices"]["propertyType"])
        self.assertIsNone(profile["areaPrices"]["range"])
        self.assertIn("epc", profile["withheld"])

    def test_postcode_homes_types_from_the_standard_sale_not_the_trailing_other(self):
        # The fake answers the contract, not the SQL; the SQL contract is pinned here.
        self.assertIn("s.ppd_category = 'A' AND s.property_type <> 'O'", pp.POSTCODE_HOMES_SQL)
        self.assertIn(") typed ON true", pp.POSTCODE_HOMES_SQL)
        self.assertIn("typed.property_type", pp.POSTCODE_HOMES_SQL)


class HomePricesFactsTests(unittest.TestCase):
    """B11 (#155): get_home_prices carries the profile's facts and withheld."""

    def call(self, env):
        from area_api import tools  # noqa: the tool layer needs pydantic
        from area_api.evidence import EvidenceReader
        from area_api.toolspec import ToolContext
        tools._CATALOGUE["rel-test"] = {"productReleaseId": "rel-test", "metrics": []}
        with mock.patch.dict(os.environ, env):
            for name in ALL_FLAG_ENV:
                if name not in env:
                    os.environ.pop(name, None)
            context = ToolContext(reader=EvidenceReader(connect=lambda: FakeConnection()))
            return tools._get_home_prices(context, tools.HomePricesInput(property_ref=UPRN))

    def test_facts_served_with_the_epc_flag_on(self):
        value = self.call(ALL_FLAG_ENV)["value"]
        self.assertIn("facts", value)
        self.assertEqual(value["facts"]["energyRating"], "C")
        self.assertEqual(value["withheld"], [])

    def test_facts_keys_kept_and_null_with_the_epc_flag_off(self):
        value = self.call({"CLOSE_KNIT_ACCESS": ""})["value"]
        self.assertIn("facts", value)
        self.assertIn("energyRating", value["facts"])
        self.assertIsNone(value["facts"]["energyRating"])
        self.assertIn("epc", value["withheld"])


class HomeIndexTests(unittest.TestCase):
    def test_one_sectors_postcodes_and_homes(self):
        connection = FakeConnection()
        index = pp.home_index(lambda: connection, "sw1a-1")
        self.assertEqual(index, {"schemaVersion": "home-index.v1", "productReleaseId": "rel-test", "sector": "SW1A 1",
                                 "postcodes": ["SW1A 1AA", "SW1A 1AB"], "uprns": [UPRN]})
        _, params = connection.statements[-1]
        self.assertEqual(params, {"low": "SW1A 1", "high": "SW1A 1ZZ", "prefix": "SW1A 1%"})

    def test_lists_what_the_pages_show_never_a_hidden_home(self):
        self.assertIn(pp.NOT_SUPPRESSED_ADDRESS, pp.HOME_INDEX_POSTCODES_SQL)
        self.assertIn(NOT_SUPPRESSED_PROPERTY, pp.HOME_INDEX_UPRNS_SQL)
        self.assertEqual(pp.home_index(lambda: FakeConnection(suppressed={UPRN}), "SW1A 1")["uprns"], [])

    def test_rejects_anything_but_a_sector(self):
        for bad in ("", "SW1A", "SW1A 1AA", "1 SW1A", "SW1A-1'; --"):
            with self.assertRaises(MalformedQuery, msg=bad):
                pp.home_index(lambda: FakeConnection(), bad)


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class HttpTests(unittest.TestCase):
    def setUp(self):
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=lambda: FakeConnection())
        without_rate_limits(self)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_routes(self):
        profile = self.client.get(f"/api/v1/properties/{UPRN}/profile")
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.json()["schemaVersion"], "property-profile.v2")
        self.assertEqual(profile.json()["profile"]["areaPrices"]["position"]["bandWords"], "top 10%")
        homes = self.client.get("/api/v1/postcodes/SW1A-1AA/homes")
        self.assertEqual(homes.status_code, 200)
        self.assertEqual(len(homes.json()["homes"]), 3)
        with_sales = self.client.get("/api/v1/postcodes/SW1A-1AA/homes?sales=true").json()
        self.assertTrue(all("sales" in home for home in with_sales["homes"]))
        self.assertEqual(self.client.get("/api/v1/postcodes/nope/homes").status_code, 400)
        self.assertEqual(self.client.get("/api/v1/properties/abc/profile").status_code, 400)
        index = self.client.get("/api/v1/homes/index?sector=SW1A-1")
        self.assertEqual(index.status_code, 200)
        self.assertEqual(index.json()["uprns"], [UPRN])
        self.assertEqual(self.client.get("/api/v1/homes/index?sector=nope").status_code, 400)

    def test_per_home_routes_name_publisher_licence_and_attribution(self):
        for path in (f"/api/v1/properties/{UPRN}/profile", "/api/v1/postcodes/SW1A-1AA/homes"):
            sources = self.client.get(path).json()["sources"]
            self.assertEqual([(s["publisher"], s["licence"]) for s in sources],
                             [("HM Land Registry", "OGL-3.0"), ("Ordnance Survey", "OGL-3.0")], path)
            self.assertTrue(all(s["attribution"] and s["sourceUrl"] for s in sources), path)


    def test_home_prices_tool_gives_area_prices_and_recorded_sales(self):
        tools._CATALOGUE["rel-test"] = {"productReleaseId": "rel-test", "metrics": []}
        for ref in (UPRN, "Sample Street"):
            out = self.client.post("/api/v2/tools/get_home_prices", json={"property_ref": ref}).json()
            self.assertEqual(out["schemaVersion"], "tool-home-prices.v1")
            self.assertEqual(out["confidence"], "medium", "the range comes from the MSOA")
            self.assertEqual(out["value"]["uprn"], UPRN)
            self.assertEqual(out["value"]["areaPrices"]["range"]["p25"], 580_000)
            self.assertEqual([row["kind"] for row in out["evidence"]], ["recorded-sale", "recorded-sale"])
            self.assertIn("not a valuation of this home", out["caveats"][0])
            self.assertIn("facts", out["value"])
            self.assertIn("withheld", out["value"])
        self.assertEqual(self.client.post("/api/v2/tools/get_stock_value",
                                          json={"property_ref": UPRN}).status_code, 404)

    def test_home_prices_tool_reaches_an_address_without_a_property_row(self):
        tools._CATALOGUE["rel-test"] = {"productReleaseId": "rel-test", "metrics": []}
        out = self.client.post("/api/v2/tools/get_home_prices", json={"property_ref": ADDRESS2}).json()
        self.assertEqual(out["schemaVersion"], "tool-home-prices.v1")
        self.assertIsNone(out["value"]["uprn"])
        self.assertEqual(out["value"]["addressId"], ADDRESS2)
        self.assertTrue(out["value"]["sales"])
        self.assertIn("areaPrices", out["value"])
        self.assertTrue(any("No UPRN" in caveat for caveat in out["caveats"]))

    def test_home_prices_tool_lists_candidates_for_an_ambiguous_fragment(self):
        tools._CATALOGUE["rel-test"] = {"productReleaseId": "rel-test", "metrics": []}
        out = self.client.post("/api/v2/tools/get_home_prices", json={"property_ref": "Grant Road"}).json()
        self.assertEqual(out["schemaVersion"], "tool-home-prices.v1")
        self.assertIsNone(out["value"])  # no forced single match, so no value.uprn
        self.assertEqual(len(out["candidates"]), 2)
        self.assertTrue(all(candidate["uprn"] is None for candidate in out["candidates"]))
        self.assertEqual(out["confidence"], "none")
        self.assertIn("addressId", out["caveats"][-1])

    def test_home_prices_tool_valuation_only_with_the_flag(self):
        tools._CATALOGUE["rel-test"] = {"productReleaseId": "rel-test", "metrics": []}
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_PER_HOME_VALUATION": ""}):
            out = self.client.post("/api/v2/tools/get_home_prices", json={"property_ref": UPRN}).json()
        self.assertIn("valuation", out["value"])
        self.assertIsNone(out["value"]["valuation"])
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_PER_HOME_VALUATION": "1", "CLOSE_KNIT_EPC_PER_HOME": ""}):
            out = self.client.post("/api/v2/tools/get_home_prices", json={"property_ref": UPRN}).json()
        self.assertEqual(out["value"]["valuation"]["method"], "indexed-sale")
        self.assertIn("An indicative model estimate, not a valuation.", out["caveats"])

    def test_hidden_home_tool_and_route_show_nothing(self):
        app_module._reader = EvidenceReader(connect=lambda: FakeConnection(suppressed={UPRN}))
        self.assertEqual(self.client.get(f"/api/v1/properties/{UPRN}/profile").status_code, 404)
        out = self.client.post("/api/v2/tools/get_home_prices", json={"property_ref": UPRN})
        self.assertNotIn("position", out.text)
        self.assertNotIn("top 10%", out.text)


# Words that state or imply what one home is worth. A negation ("not a valuation",
# "not a valuation of this home") is allowed and stripped before the check.
FORBIDDEN = re.compile(r"estimated price|\bworth\b|valuation of this home|would be around", re.I)
NEGATION = re.compile(r"not a valuation( of (this|any) home)?", re.I)


def assert_no_home_figure(case, text, where):
    cleaned = NEGATION.sub("", text)
    case.assertIsNone(FORBIDDEN.search(cleaned), f"{where}: {FORBIDDEN.search(cleaned)}")


class GuardTests(unittest.TestCase):
    """Fails if user-facing property or MCP output says what a home is worth."""

    def test_guard_catches_the_old_wording(self):
        with self.assertRaises(AssertionError):
            assert_no_home_figure(self, "Estimated price ~£668k", "sample")
        with self.assertRaises(AssertionError):
            assert_no_home_figure(self, "This home is worth £700k", "sample")
        with self.assertRaises(AssertionError):
            assert_no_home_figure(self, "It would be around £700k", "sample")
        assert_no_home_figure(self, "About this area's sales, not a valuation of this home.", "negation")

    def test_property_and_postcode_payloads(self):
        variants = [FakeConnection(), FakeConnection(years=[]), FakeConnection(bands=[])]
        for connection in variants:
            assert_no_home_figure(self, json.dumps(pp.property_profile(lambda c=connection: c, UPRN)), "profile")
        assert_no_home_figure(self, json.dumps(pp.postcode_homes(lambda: FakeConnection(), "SW1A 1AA",
                                                                  include_sales=True)), "postcode homes")

    def test_mcp_tool_descriptions_and_output(self):
        from area_api import tools as tool_module
        for spec in tool_module.TOOLS.values():
            text = spec.description.replace("never say what the home is worth", "")
            assert_no_home_figure(self, text, spec.name)
        reader = EvidenceReader(connect=lambda: FakeConnection())
        tool_module._CATALOGUE["rel-test"] = {"productReleaseId": "rel-test", "metrics": []}
        from area_api.toolspec import ToolContext
        spec = next(spec for spec in tool_module.AREA_TOOLS if spec.name == "get_home_prices")
        out = spec.handler(ToolContext(reader=reader), spec.input_model(property_ref=UPRN))
        assert_no_home_figure(self, json.dumps(out), "get_home_prices")

    @unittest.skipIf(TestClient is None, "the tool layer needs pydantic")
    def test_home_prices_guidance_follows_the_valuation_flag(self):
        from area_api import tools as tool_module
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_PER_HOME_VALUATION": ""}):
            off = tool_module.home_prices_description()
        self.assertIn("never say what the home is worth", off)
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_PER_HOME_VALUATION": "1"}):
            on = tool_module.home_prices_description()
        self.assertIn("`valuation`, when present, is an indicative model estimate, not a valuation; quote it only "
                      "with its range and that wording.", on)
        self.assertNotIn("never say what the home is worth", on)
        assert_no_home_figure(self, on, "get_home_prices (valuation on)")


class EpcAddressTests(unittest.TestCase):
    """CLOSE_KNIT_EPC_ADDRESSES: homes known only from an energy certificate (migration 089)."""

    def with_env(self, **env):
        WithheldTests.with_env(self, **env)

    def connection(self, **extra):
        return FakeConnection(epc_homes=[epc_home_row()], **extra)

    def test_flag_off_reads_nothing_and_is_identical_apart_from_withheld(self):
        self.with_env(CLOSE_KNIT_EPC_PER_HOME="1")
        with_homes, without = self.connection(), FakeConnection()
        listed = pp.postcode_homes(lambda: with_homes, "SW1A 1AA", include_sales=True)
        self.assertEqual(listed, pp.postcode_homes(lambda: without, "SW1A 1AA", include_sales=True))
        profile = pp.property_profile(lambda: with_homes, UPRN)
        self.assertEqual(profile, pp.property_profile(lambda: without, UPRN))
        self.assertIn("epcAddresses", listed["withheld"])
        statements = [sql.split("\n", 1)[0] for sql, _ in with_homes.statements]
        self.assertFalse([marker for marker in statements if "epc-home" in marker])
        with self.assertRaises(PropertyNotFound):
            pp.property_profile(lambda: self.connection(property_found=False), EPC_UPRN)
        self.assertNotIn(EPC_UPRN, pp.home_index(lambda: self.connection(), "SW1A 1")["uprns"])

    def test_flag_on_changes_only_withheld_when_there_is_no_epc_only_home(self):
        self.with_env(CLOSE_KNIT_EPC_PER_HOME="1")
        off = pp.postcode_homes(lambda: FakeConnection(), "SW1A 1AA")
        self.with_env(CLOSE_KNIT_EPC_PER_HOME="1", CLOSE_KNIT_EPC_ADDRESSES="1")
        on = pp.postcode_homes(lambda: FakeConnection(), "SW1A 1AA")
        self.assertEqual({**off, "withheld": None}, {**on, "withheld": None})
        self.assertNotIn("epcAddresses", on["withheld"])

    def test_flag_on_lists_the_home_without_a_sale(self):
        self.with_env(CLOSE_KNIT_EPC_PER_HOME="1", CLOSE_KNIT_EPC_ADDRESSES="1")
        payload = pp.postcode_homes(lambda: self.connection(), "SW1A 1AA", include_sales=True)
        self.assertEqual([home["displayAddress"].split(",")[0] for home in payload["homes"]],
                         ["Flat 1", "Flat 2", "Flat 3", "Flat 10"])
        home = next(home for home in payload["homes"] if home["uprn"] == EPC_UPRN)
        self.assertEqual(home, {"addressId": None, "uprn": EPC_UPRN,
                                "displayAddress": "Flat 3, 10 Sample Street, London, SW1A 1AA",
                                "propertyType": "Flat or maisonette", "tenure": None, "floorAreaSquareMetres": 42,
                                "energyRating": "D", "saleCount": 0, "lastSale": None, "flood": None, "addressSource": "epc",
                                "sales": []})

    def test_flag_on_without_per_home_epc_keeps_its_certificate_facts_null(self):
        self.with_env(CLOSE_KNIT_EPC_ADDRESSES="1")
        home = next(home for home in pp.postcode_homes(lambda: self.connection(), "SW1A 1AA")["homes"]
                    if home["uprn"] == EPC_UPRN)
        self.assertEqual((home["propertyType"], home["floorAreaSquareMetres"], home["energyRating"]), (None, None, None))
        profile = pp.property_profile(lambda: self.connection(property_found=False), EPC_UPRN)["profile"]
        self.assertIsNone(profile["facts"]["propertyType"])
        self.assertIsNone(profile["facts"]["energyRating"])
        self.assertIsNone(profile["areaPrices"]["range"])

    def test_a_postcode_of_only_epc_homes_is_found(self):
        self.with_env(CLOSE_KNIT_EPC_ADDRESSES="1")
        connection = self.connection()
        connection._homes = lambda: []
        payload = pp.postcode_homes(lambda: connection, "SW1A 1AA")
        self.assertEqual([home["uprn"] for home in payload["homes"]], [EPC_UPRN])
        self.assertEqual(payload["geographyId"], LSOA)

    def test_flag_on_profile_of_an_epc_only_home(self):
        self.with_env(CLOSE_KNIT_EPC_PER_HOME="1", CLOSE_KNIT_EPC_ADDRESSES="1")
        profile = pp.property_profile(lambda: self.connection(property_found=False), EPC_UPRN)["profile"]
        self.assertEqual(profile["uprn"], EPC_UPRN)
        self.assertIsNone(profile["addressId"])
        self.assertEqual(profile["addressSource"], "epc")
        self.assertEqual(profile["postcode"], "SW1A 1AA")
        self.assertEqual(profile["location"], [-0.1415, 51.5011])
        self.assertEqual(profile["sales"], [])
        self.assertEqual(profile["facts"]["propertyType"], "Flat or maisonette")
        self.assertEqual(profile["facts"]["energyRating"], "D")
        self.assertEqual(profile["facts"]["floorAreaSquareMetres"], 42)
        self.assertEqual(profile["facts"]["energyCertificateDate"], "2023-05-01")
        self.assertIsNone(profile["areaPrices"]["position"])
        self.assertEqual(profile["areaPrices"]["range"]["level"], "msoa")  # flats: the LSOA is thin
        self.assertEqual(len(profile["otherHomes"]), 3)
        self.assertNotIn(EPC_UPRN, [home["uprn"] for home in profile["otherHomes"]])
        # No band of its own here: the postcode's homes carry theirs for the page to fall back on.
        self.assertIsNone(profile["flood"])
        self.assertIn({"riversSea": "very-low", "surfaceWater": "low"}, [home["flood"] for home in profile["otherHomes"]])

    def test_a_recorded_homes_neighbours_include_epc_only_homes_when_on(self):
        self.with_env(CLOSE_KNIT_EPC_ADDRESSES="1")
        profile = pp.property_profile(lambda: self.connection(flood={EPC_UPRN: (3, 4)}), UPRN)["profile"]
        self.assertIn(EPC_UPRN, [home["uprn"] for home in profile["otherHomes"]])
        epc_home = next(home for home in profile["otherHomes"] if home["uprn"] == EPC_UPRN)
        self.assertEqual(epc_home["flood"], {"riversSea": "medium", "surfaceWater": "high"})
        self.assertNotIn("addressSource", profile)

    def test_unknown_or_hidden_epc_home_is_not_found(self):
        self.with_env(CLOSE_KNIT_EPC_ADDRESSES="1")
        with self.assertRaises(PropertyNotFound):
            pp.property_profile(lambda: FakeConnection(property_found=False), EPC_UPRN)
        with self.assertRaises(PropertyNotFound):
            pp.property_profile(lambda: self.connection(property_found=False, suppressed={EPC_UPRN}), EPC_UPRN)

    def test_sql_never_lists_a_spine_or_hidden_home(self):
        for sql in (pp.EPC_HOMES_SQL, pp.EPC_HOME_SQL, pp.HOME_INDEX_EPC_SQL):
            self.assertIn("FROM property_epc_home h", sql)
            self.assertIn("NOT EXISTS (SELECT 1 FROM property p WHERE p.uprn = h.uprn", sql)
            self.assertIn("suppressed_dwelling d WHERE d.uprn = h.uprn", sql)
            self.assertIn("h.source_release_id IN", sql)

    def test_home_index_adds_epc_only_homes_when_on(self):
        self.with_env(CLOSE_KNIT_EPC_ADDRESSES="1")
        index = pp.home_index(lambda: self.connection(), "SW1A 1")
        self.assertEqual(index["uprns"], sorted([UPRN, EPC_UPRN]))
        self.assertEqual(index["postcodes"], ["SW1A 1AA", "SW1A 1AB"])

    def test_epc_type_codes(self):
        cases = {("Flat", None): "F", ("Maisonette", "Detached"): "F", ("House", "Semi-Detached"): "S",
                 ("House", "Enclosed End-Terrace"): "T", ("Bungalow", "Detached"): "D", ("House", None): None,
                 ("Park home", None): None, (None, None): None}
        for (kind, form), code in cases.items():
            self.assertEqual(pp._epc_type_code(kind, form), code, (kind, form))


class EpcTableMissingTests(unittest.TestCase):
    """Issue #182: CLOSE_KNIT_EPC_ADDRESSES on but migration 089 never applied (the table is
    missing) must not break the recorded homes. The fake raises on any statement against
    property_epc_home, as a missing table would; the guard must stop those statements."""

    def with_env(self, **env):
        WithheldTests.with_env(self, **env)

    def missing(self, **extra):
        extra.setdefault("epc_table", False)
        extra.setdefault("epc_missing", True)
        return FakeConnection(**extra)

    def epc_statements(self, connection):
        return [sql.split("\n", 1)[0] for sql, _ in connection.statements
                if "epc-home" in sql.split("\n", 1)[0]]

    def test_profile_postcode_list_and_index_serve_recorded_homes(self):
        self.with_env(CLOSE_KNIT_EPC_ADDRESSES="1")
        profile_connection, list_connection, index_connection = self.missing(), self.missing(), self.missing()
        profile = pp.property_profile(lambda: profile_connection, UPRN)["profile"]
        self.assertEqual(profile["uprn"], UPRN)
        self.assertNotIn("addressSource", profile)
        self.assertNotIn(EPC_UPRN, [home["uprn"] for home in profile["otherHomes"]])
        listed = pp.postcode_homes(lambda: list_connection, "SW1A 1AA")
        self.assertEqual([home["displayAddress"].split(",")[0] for home in listed["homes"]],
                         ["Flat 1", "Flat 2", "Flat 10"])
        # The flag is on, so epcAddresses is not withheld; it just serves no EPC-only rows
        # until migration 089 is applied.
        self.assertNotIn("epcAddresses", listed["withheld"])
        self.assertFalse([home for home in listed["homes"] if home.get("addressSource") == "epc"])
        index = pp.home_index(lambda: index_connection, "SW1A 1")
        self.assertEqual(index["uprns"], [UPRN])
        self.assertEqual(index["postcodes"], ["SW1A 1AA", "SW1A 1AB"])
        # No statement ever touched property_epc_home (the guard's own to_regclass check aside).
        for connection in (profile_connection, list_connection, index_connection):
            self.assertEqual(self.epc_statements(connection), [])
        with self.assertRaises(PropertyNotFound):
            pp.property_profile(lambda: self.missing(property_found=False), EPC_UPRN)

    def test_table_present_but_empty_matches_flag_off_apart_from_withheld(self):
        self.with_env(CLOSE_KNIT_EPC_ADDRESSES="1")
        on = pp.postcode_homes(lambda: FakeConnection(epc_table=True), "SW1A 1AA")
        self.with_env()
        off = pp.postcode_homes(lambda: FakeConnection(epc_table=True), "SW1A 1AA")
        self.assertEqual({**off, "withheld": None}, {**on, "withheld": None})
        self.assertNotIn("epcAddresses", on["withheld"])
        self.assertIn("epcAddresses", off["withheld"])

    def test_guard_runs_before_any_epc_read(self):
        self.with_env(CLOSE_KNIT_EPC_ADDRESSES="1")
        connection = self.missing()
        pp.postcode_homes(lambda: connection, "SW1A 1AA")
        markers = [sql.split("\n", 1)[0] for sql, _ in connection.statements]
        self.assertIn("-- property-profile:epc-table", markers)
        self.assertEqual(self.epc_statements(connection), [])


if __name__ == "__main__":
    unittest.main()
