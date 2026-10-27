"""Data minimisation guard: per-dwelling payloads expose only the whitelisted
fields. Anything new (an EPC attribute, a name, a finer coordinate) must be
added here deliberately, with the privacy notice updated alongside."""
import re
import unittest
from pathlib import Path

from area_api.evidence import EvidenceReader
from tests.test_production_evidence import seed_production_fixture

TILE_FUNCTION = Path(__file__).resolve().parents[2] / "deploy" / "migrations" / "007-property-objection.sql"

PROPERTY_FIELDS = {
    "productReleaseId", "schemaVersion", "property.uprn", "property.addressId", "property.displayAddress",
    "property.geographyId", "property.parcelId", "property.location.[]", "property.sourceVersion",
    "property.caveats.[]",
    "property.lastSale.date", "property.lastSale.period",
    "property.lastSale.nominalPrice", "property.lastSale.floorAreaSquareMetres",
}
SEARCH_ADDRESS_FIELDS = {"[].addressId", "[].uprn", "[].label", "[].secondaryLabel", "[].geographyId",
                         "[].postcode", "[].saleCount", "[].center.[]", "[].centerPrecision", "[].kind"}
HISTORY_FIELDS = {
    "productReleaseId", "schemaVersion", "history.addressId", "history.displayAddress", "history.postcode",
    "history.geographyId", "history.coordinatesPrecision", "history.estimateDisclaimer", "history.saleCount",
    "history.sourceVersion", "history.transactions.[].date", "history.transactions.[].nominalPrice",
    "history.transactions.[].floorAreaSquareMetres", "history.transactions.[].partShareLikely",
    "history.transactions.[].standardSale", "history.withheld.[]",
}
# While the EPC licence is pending no single home's or sale's £/m² is published (only area medians).
# Other homes' sales near an address (wave 1 / feature 3). Deliberately NO
# per-sale floor area or £/m² (open EPC-licence question); the median £/m² is
# an aggregate of at least 5 sales. Tenure here is the Price Paid duration.
NEARBY_SALE_FIELDS = {
    "productReleaseId", "schemaVersion", "addressId", "windowYears", "disclaimer",
    *(f"{scope}.{field}" for scope in ("building", "street") for field in (
        "saleCount", "excludedPartShare", "medianPricePerSquareMetre", "medianSampleSize",
        "sales.[].date", "sales.[].nominalPrice", "sales.[].propertyType", "sales.[].tenure",
        "sales.[].newBuild", "sales.[].partShareLikely")),
}
# Local market depth and the area evidence pack (wave 1 / feature 6). Area
# aggregates only: counts, shares, gated medians, growth. No valuation, no sale
# rows, no address beyond the requested address id, nothing about ownership.
SOURCE_FIELDS = {f"sources.[].{field}" for field in (
    "release", "sourceUrl", "licence", "attribution", "transformationVersion")}
MARKET_SECTION_FIELDS = {
    "available", "periodEnd", "salesWindowMonths", "salesCount", "dwellings", "dwellingsSold",
    "turnoverPercent", "leaseholdShareOfSales", "tenureKnownSales", "priceWindowMonths", "minimumSample",
    "newBuild.medianPricePerSquareMetre", "newBuild.sampleSize", "resale.medianPricePerSquareMetre",
    "resale.sampleSize", "newBuildPremiumPercent", "growth.period", "growth.growth1y", "growth.growth3y",
    "growth.growth5y", "growth.growth10y",
    # Growth quality and sample counts (#163): which windows are comparable.
    "growth.growth1yQuality", "growth.growth1ySampleCount", "growth.growth3yQuality",
    "growth.growth3ySampleCount", "growth.growth5yQuality", "growth.growth5ySampleCount",
    "growth.growth10yQuality", "growth.growth10ySampleCount", "sourceVersion",
}
MARKET_FIELDS = {"schemaVersion", "productReleaseId", "geographyId", "name", "carrier", "caveats.[]",
                 *MARKET_SECTION_FIELDS, *SOURCE_FIELDS}
NEARBY_SUMMARY_FIELDS = {
    "addressId", "windowYears", "disclaimer",
    *(f"{scope}.{field}" for scope in ("building", "street")
      for field in ("saleCount", "excludedPartShare", "medianPricePerSquareMetre", "medianSampleSize")),
}
PACK_FIELDS = {
    "schemaVersion", "productReleaseId", "geographyId", "name", "carrier", "caveats.[]", *SOURCE_FIELDS,
    *(f"market.{field}" for field in MARKET_SECTION_FIELDS),
    *(f"crime.{field}" for field in ("period", "value", "unit", "regionPercentile", "quality", "sourceVersion",
                                     # Anti-social behaviour incidents (#163): a count, not a rate.
                                     "asbOffences", "asbNote")),
    # #238: the offence mix of the month (counts by police.uk category, never a location) and the
    # busy-centre reading when shoplifting dominates.
    "crime.offences", "crime.busyCentre", "crime.rateExcludingShoplifting", "crime.note",
    *(f"crime.topTypes.[].{field}" for field in ("category", "offences", "sharePercent")),
    *(f"noise.{field}" for field in ("available", "dwellings", "road55Share", "rail55Share", "air55Share",
                                     "any55Share", "any65Share", "roadLdenMedian", "roadLdenMappedShare",
                                     "sourceVersion")),
    "schools.radiusMetres", "schools.count", "schools.primary", "schools.secondary",
    # #250: independent schools, null here (the fixture has no migration 067 table); the
    # {count, note, nearest[]} shape is covered by AreaToolTests in test_tools.py.
    "schools.independent",
    *(f"schools.nearest.[].{field}" for field in ("urn", "name", "phase", "distanceMetres",
                                                  "latestInspection", "sourceVersion")),
    # Fix 158: the standing Ofsted judgement; an ungraded visit never replaces it. ungradedVisit is
    # null here (the fixture schools have no ungraded outcome); its {year, outcome} shape is covered
    # by StandingGradeTests in test_market_depth.py.
    *(f"schools.nearest.[].standingInspection.{field}" for field in ("grade", "framework", "year")),
    "schools.nearest.[].standingInspection.ungradedVisit",
    # #226: the newest report card whole; null here (the fixture schools carry legacy grades), its
    # {year, areas, safeguarding} shape is covered by StandingGradeTests in test_market_depth.py.
    "schools.nearest.[].reportCard",
    *(f"nearbySales.{field}" for field in NEARBY_SUMMARY_FIELDS),
}
# Postcode sector pages (migration 057): zone aggregates only. No per-home value or £/m², no
# address, no sale row; streets carry only a name and gated (5+ sales) medians.
SECTOR_FIELDS = {
    "schemaVersion", "productReleaseId", "dataMode", "confidence", "caveats.[]",
    *(f"evidence.[].{field}" for field in ("kind", "zone", "periodEnd", "windowMonths", "value")),
    *(f"sources.[].{field}" for field in ("sourceName", "release", "sourceUrl", "licence", "attribution",
                                           "transformationVersion")),
    *(f"value.sector.{field}" for field in ("code", "slug", "name", "district", "borough.id", "borough.name",
                                            "postcodeCount", "geometry.type", "geometry.coordinates.[].[].[]")),
    "value.distribution.periodEnd",
    *(f"value.distribution.{zone}.{field}" for zone in ("sector", "district")
      for field in ("sales", "p09", "p25", "p50", "p75", "p91", "buckets.[].from", "buckets.[].to",
                    "buckets.[].count")),
    "value.index.base", "value.index.series.[].zone",
    *(f"value.index.series.[].points.[].{field}" for field in ("year", "nominal", "real", "sales")),
    *(f"value.returns.[].{field}" for field in ("years", "zone", "nominalPa", "realPa", "nominalTotal", "realTotal")),
    *(f"value.nearby.[].{field}" for field in ("code", "slug", "name", "p25", "p50", "p75", "sales", "isSelf")),
    *(f"value.streets.[].{field}" for field in ("name", "sales", "medianFloorArea", "medianPpm")),
}
# Columns the dwelling layer of the vector tile may carry (feature_id + geometry are structural).
TILE_DWELLING_COLUMNS = {"feature_id", "uprn", "address_id", "address", "ppm", "value", "confidence",
                         "latest_sale", "geometry"}
FORBIDDEN_WORDS = re.compile(r"(?i)\b(name|owner|occupier|tenure|epc_rating|energy|dob|phone|email)\b")


def leaf_paths(payload, prefix=""):
    if isinstance(payload, dict):
        return {p for k, v in payload.items() for p in leaf_paths(v, f"{prefix}{k}.")}
    if isinstance(payload, list):
        return {p for v in payload for p in leaf_paths(v, f"{prefix}[].")}
    return {prefix.rstrip(".")}


class MinimisationTests(unittest.TestCase):
    def setUp(self):
        connection = seed_production_fixture()
        self.reader = EvidenceReader(connect=lambda: connection)

    def test_property_payload_is_whitelisted(self):
        self.assertEqual(leaf_paths(self.reader.get_property("100023336956")), PROPERTY_FIELDS)

    def test_address_search_rows_are_whitelisted(self):
        rows = [r for r in self.reader.search_areas("Sample Street")["results"] if "addressId" in r]
        self.assertTrue(rows)
        self.assertEqual(leaf_paths(rows), SEARCH_ADDRESS_FIELDS)

    def test_address_history_is_whitelisted(self):
        self.assertEqual(leaf_paths(self.reader.get_address_history("uk:addr:a1b2c3d4e5f6")), HISTORY_FIELDS)

    def test_nearby_sales_are_whitelisted(self):
        self.assertEqual(leaf_paths(self.reader.get_nearby_sales("uk:addr:a1b2c3d4e5f6")), NEARBY_SALE_FIELDS)

    def test_market_depth_is_whitelisted(self):
        self.assertEqual(leaf_paths(self.reader.get_market_depth("uk:lsoa:E01000004")), MARKET_FIELDS)

    def test_area_pack_is_whitelisted(self):
        pack = self.reader.get_area_pack("uk:lsoa:E01000004", "uk:addr:a1b2c3d4e5f6")
        self.assertEqual(leaf_paths(pack), PACK_FIELDS)

    def test_nearby_sales_summary_is_whitelisted(self):
        summary = self.reader.get_nearby_sales_summary("uk:addr:a1b2c3d4e5f6")
        self.assertEqual(leaf_paths(summary), {"schemaVersion", "productReleaseId", *NEARBY_SUMMARY_FIELDS,
                                               *SOURCE_FIELDS})

    def test_sector_page_is_whitelisted(self):
        from tests.test_zones_sector import sector_envelope

        self.assertEqual(leaf_paths(sector_envelope()), SECTOR_FIELDS)

    def test_home_prices_tool_keys_are_whitelisted(self):
        """The tool's key set is deliberate: `location`/`locationPrecision` are kept
        keys with null values while the home's point is withheld (B7, #156);
        `facts`/`withheld` ride along unfiltered, the flags keep full control (B11, #155)."""
        from area_api import tools  # noqa: the tool layer needs pydantic
        from area_api.toolspec import ToolContext
        from tests.test_property_profile import FakeConnection, UPRN
        tools._CATALOGUE["rel-test"] = {"productReleaseId": "rel-test", "metrics": []}
        spec = next(spec for spec in tools.AREA_TOOLS if spec.name == "get_home_prices")
        out = spec.handler(ToolContext(reader=EvidenceReader(connect=lambda: FakeConnection())),
                           spec.input_model(property_ref=UPRN))
        leaves = leaf_paths(out)
        self.assertIn("value.location", leaves)
        self.assertIn("value.locationPrecision", leaves)
        envelope_keys = {leaf.split(".", 1)[0] for leaf in leaves}
        self.assertEqual(envelope_keys, HOME_PRICES_ENVELOPE_FIELDS)
        value_keys = {leaf.split(".", 2)[1] for leaf in leaves if leaf.startswith("value.")}
        self.assertEqual(value_keys, HOME_PRICES_VALUE_FIELDS)

    def test_tile_dwelling_layer_columns_are_whitelisted(self):
        sql = TILE_FUNCTION.read_text()
        block = sql[sql.index("point_features AS ("):sql.index("FROM valued, bounds")]
        aliases = set(re.findall(r"AS (\w+)", block))
        columns = aliases | {word for word in ("uprn", "address_id", "value", "confidence") if f"valued.{word}" in block}
        self.assertLessEqual(columns, TILE_DWELLING_COLUMNS)
        self.assertIn("uprn", columns)
        self.assertIsNone(FORBIDDEN_WORDS.search(block), "dwelling tiles must not carry personal attributes")


# get_home_prices (MCP): the tool's top-level keys, deliberately. The home's point
# is withheld until the owner decides (B7, #156): `location`/`locationPrecision`
# are null keys, never a finer coordinate smuggled in. `facts` and `withheld`
# ride along unfiltered; the flags keep full control (B11, #155).
HOME_PRICES_ENVELOPE_FIELDS = {"schemaVersion", "productReleaseId", "dataMode", "value", "confidence",
                               "evidence", "sources", "caveats"}
HOME_PRICES_VALUE_FIELDS = {"uprn", "addressId", "displayAddress", "postcode", "areas", "sales",
                            "areaPrices", "valuation", "location", "locationPrecision", "facts", "withheld"}


if __name__ == "__main__":
    unittest.main()
