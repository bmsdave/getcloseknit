"""Postcode sector pages (migration 057): contract, 404, suppression, search."""
import json
import os
import unittest
from unittest import mock

from area_api import evidence, zones_sector

try:
    from fastapi.testclient import TestClient

    from area_api import app as app_module
except ImportError:  # pragma: no cover - the API extras are not installed
    TestClient = None

SECTOR = {"code": "W5 1", "slug": "W5-1", "name": "Pitshanger", "district": "W5",
          "borough_id": "uk:lad:E09000009", "borough_name": "Ealing", "postcode_count": 173,
          "geometry": json.dumps({"type": "Polygon", "coordinates": [[[-0.31, 51.52], [-0.30, 51.52],
                                                                       [-0.30, 51.53], [-0.31, 51.52]]]})}


def distribution(kind, sales):
    return {"zone_kind": kind, "period_end": "2026-07-01", "sales": sales, "p09": 5400, "p25": 6750,
            "p50": 7650, "p75": 8970, "p91": 10690, "bucket_edges": list(range(3000, 3000 + 21 * 100, 100)),
            "bucket_counts": [sales // 20] * 20, "source_release_id": "src-hmlr-pp-sales-2026-07"}


def index_row(kind, group, year, nominal, real, sales=50):
    return {"zone_kind": kind, "group": group, "year": year, "sales": sales,
            "index_nominal": nominal, "index_real": real}


INDEX = [index_row(kind, group, year, nominal, real)
         for kind, group in (("sector", "all"), ("district", "all"), ("borough", "house"), ("borough", "flat"))
         for year, nominal, real in ((2004, 100.0, 100.0), (2005, 104.0, 102.0), (2025, 200.0, 120.0),
                                     (2026, 210.0, 123.0))]
NEARBY = [{"code": "W5 2", "slug": "W5-2", "name": "North Ealing", "p25": 7000, "p50": 8300, "p75": 9900, "sales": 150},
          {"code": "W5 1", "slug": "W5-1", "name": "Pitshanger", "p25": 6750, "p50": 7650, "p75": 8970, "sales": 172},
          {"code": "W13 9", "slug": "W13-9", "name": "Quiet", "p25": None, "p50": None, "p75": None, "sales": None},
          {"code": "W5 5", "slug": "W5-5", "name": "Ealing Broadway", "p25": 7600, "p50": 8900, "p75": 10400, "sales": 99}]
STREETS = [{"street_name": "Woodfield Road", "sales_60m": 22, "median_floor_area": 94, "median_ppm": 7561},
           {"street_name": "Meadvale Road", "sales_60m": 21, "median_floor_area": 130, "median_ppm": 8586}]
SOURCES = [{"prefix": "hmlr-pp-sales", "id": "src-hmlr-pp-sales-2026-07", "source_url": "https://gov.uk/ppd",
            "licence": "OGL-3.0", "attribution": "Contains HM Land Registry data", "transformation_version": "v1"},
           {"prefix": "ons-cpih", "id": "src-ons-cpih-2026-08", "source_url": "https://ons.gov.uk",
            "licence": "OGL-3.0", "attribution": "Source: Office for National Statistics", "transformation_version": "v1"}]
ALL = [{"code": "W5 1", "slug": "W5-1", "name": "Pitshanger"}, {"code": "W5 2", "slug": "W5-2", "name": "North Ealing"}]


class FakeConnection:
    def __init__(self, sector=True, sector_sales=172):
        self.sector, self.sector_sales, self.statements, self.sql = sector, sector_sales, [], []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        tag = sql.split("\n", 1)[0]
        self.statements.append((tag, params))
        self.sql.append(sql)
        if tag == "-- evidence:active-release":
            return [{"release_id": "rel-test"}]
        if tag == "-- sector:sector":
            return [SECTOR] if self.sector and params == ("W5 1",) else []
        if tag == "-- sector:distribution":
            # The migration writes no row under 20 sales.
            rows = [distribution("district", 893)]
            return rows + [distribution("sector", self.sector_sales)] if self.sector_sales >= 20 else rows
        if tag == "-- sector:index":
            return INDEX
        if tag == "-- sector:nearby":
            return NEARBY
        if tag == "-- sector:streets":
            return STREETS
        if tag == "-- sector:sources":
            return SOURCES
        if tag == "-- sector:all":
            return ALL
        if tag == "-- sector:with-homes":
            return ALL[:1]
        if tag == "-- sector:search":
            return [row for row in ALL if row["code"].startswith(params[0].rstrip("%"))]
        raise AssertionError(f"unexpected query {tag}")


def sector_envelope(**kwargs):
    connection = FakeConnection(**kwargs)
    return zones_sector.sector(lambda: connection, "w5-1")


class SectorContractTests(unittest.TestCase):
    def test_contract_shape(self):
        result = sector_envelope()
        self.assertEqual((result["schemaVersion"], result["productReleaseId"], result["confidence"]),
                         ("sector.v1", "rel-test", "high"))
        self.assertIn("£/m² uses EPC floor area; sector names are informal", result["caveats"])
        self.assertEqual([s["sourceName"] for s in result["sources"]], ["HM Land Registry Price Paid", "ONS CPIH"])
        value = result["value"]
        self.assertEqual(set(value), {"sector", "distribution", "index", "returns", "nearby", "streets"})
        self.assertEqual(value["sector"]["borough"], {"id": "uk:lad:E09000009", "name": "Ealing"})
        self.assertEqual((value["sector"]["slug"], value["sector"]["postcodeCount"]), ("W5-1", 173))
        self.assertEqual(value["sector"]["geometry"]["type"], "Polygon")
        dist = value["distribution"]
        self.assertEqual(dist["periodEnd"], "2026-07-01")
        self.assertEqual(set(dist["sector"]), {"sales", "p09", "p25", "p50", "p75", "p91", "buckets"})
        self.assertEqual(len(dist["sector"]["buckets"]), 20)
        self.assertEqual(dist["sector"]["buckets"][0], {"from": 3000, "to": 3100, "count": 8})
        self.assertEqual(dist["district"]["sales"], 893)
        self.assertEqual(value["index"]["base"], 2004)
        self.assertEqual([s["zone"] for s in value["index"]["series"]],
                         ["sector", "district", "borough-house", "borough-flat"])
        self.assertEqual(value["index"]["series"][0]["points"][0],
                         {"year": 2004, "nominal": 100.0, "real": 100.0, "sales": 50})
        self.assertEqual([item["code"] for item in value["nearby"]], ["W5 5", "W5 2", "W5 1", "W13 9"])
        self.assertEqual([item["isSelf"] for item in value["nearby"]], [False, False, True, False])
        self.assertEqual(value["streets"][0], {"name": "Woodfield Road", "sales": 22, "medianFloorArea": 94,
                                               "medianPpm": 7561})

    def test_returns_are_fractions_and_skip_missing_ends(self):
        returns = sector_envelope()["value"]["returns"]
        # 2026 against 2025 and 2005 (1 and 21 years back: no 5/10/20-year start in the fixture).
        self.assertEqual([(row["years"], row["zone"]) for row in returns], [(1, "sector"), (1, "district")])
        self.assertEqual(returns[0], {"years": 1, "zone": "sector", "nominalPa": 0.05, "realPa": 0.025,
                                      "nominalTotal": 0.05, "realTotal": 0.025})
        series = [{"zone": "sector", "points": [{"year": 2006, "nominal": 100.0, "real": 100.0, "sales": 20},
                                                {"year": 2016, "nominal": None, "real": None, "sales": 5},
                                                {"year": 2021, "nominal": 150.0, "real": 110.0, "sales": 20},
                                                {"year": 2026, "nominal": 200.0, "real": 121.0, "sales": 20}]}]
        rows = {row["years"]: row for row in zones_sector.returns_rows(series)}
        self.assertEqual(set(rows), {5, 20})  # the 10-year start has no index
        self.assertEqual((rows[20]["nominalPa"], rows[20]["nominalTotal"]), (0.0353, 1.0))
        self.assertEqual(rows[5]["realTotal"], 0.1)

    def test_distribution_under_20_sales_is_null(self):
        result = sector_envelope(sector_sales=19)
        self.assertIsNone(result["value"]["distribution"]["sector"])
        self.assertEqual(result["value"]["distribution"]["district"]["sales"], 893)
        self.assertEqual((result["confidence"], result["evidence"]), ("low", []))

    def test_unknown_or_malformed_slug_is_not_found(self):
        for slug in ("W9-9", "W5 1", "W5-1A", "uk:lsoa:E01000001", ""):
            with self.subTest(slug=slug), self.assertRaises(evidence.AreaNotFound):
                zones_sector.sector(lambda: FakeConnection(sector=slug != "W9-9"), slug)

    def test_search_prefix_and_all(self):
        connection = FakeConnection()
        self.assertEqual(zones_sector.search(lambda: connection, "w5-1"), ALL[:1])
        self.assertEqual(connection.statements[-1], ("-- sector:search", ("W5 1%", "W5 1")))
        self.assertEqual(zones_sector.search(lambda: connection, ""), ALL)
        self.assertEqual(zones_sector.search(lambda: connection, "W5%"), [])

    def test_sectors_with_homes_for_the_per_address_sitemap(self):
        # With CLOSE_KNIT_ENGLAND on England's sectors are listed (sector pages) but per-home data is London's: the per-address shards ask
        # only for sectors with recorded homes, through the postcode index.
        connection = FakeConnection()
        self.assertEqual(zones_sector.search(lambda: connection, "", homes=True), ALL[:1])
        self.assertEqual(connection.statements[-1][0], "-- sector:with-homes")
        self.assertIn("a.postcode BETWEEN s.code AND s.code || 'ZZ'", zones_sector.WITH_HOMES_SQL)


class SectorScopeTests(unittest.TestCase):
    """FLAGS.md CLOSE_KNIT_ENGLAND: off (a public site) serves London's sectors only, like every other page."""
    LONDON = "s.borough_id IN (SELECT id FROM area_geography WHERE region_id IN ('uk:region:E12000007'))"

    def queries(self, flag):
        connection = FakeConnection()
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": flag}):
            zones_sector.sector(lambda: connection, "W5-1")
            zones_sector.search(lambda: connection, "")
            zones_sector.search(lambda: connection, "W5")
        return {sql.split("\n", 1)[0]: sql for sql in connection.sql}

    def test_flag_off_keeps_sectors_to_london(self):
        sql = self.queries("0")
        for tag in ("-- sector:sector", "-- sector:all", "-- sector:search"):
            self.assertIn(self.LONDON, sql[tag], tag)
        # Neighbours outside London would link to pages that 404.
        self.assertIn(self.LONDON.replace("s.borough_id", "n.borough_id"), sql["-- sector:nearby"])

    def test_flag_on_serves_every_english_sector(self):
        for tag, text in self.queries("1").items():
            self.assertNotIn("region_id IN", text, tag)
            self.assertNotIn("/*scope", zones_sector.scoped(text), tag)


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class SectorHttpTests(unittest.TestCase):
    def setUp(self):
        self._previous = app_module._reader
        connection = FakeConnection()
        app_module._reader = evidence.EvidenceReader(connect=lambda: connection)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_routes(self):
        found = self.client.get("/api/v1/sectors/W5-1")
        self.assertEqual(found.status_code, 200)
        self.assertEqual(found.json()["value"]["sector"]["code"], "W5 1")
        missing = self.client.get("/api/v1/sectors/W9-9")
        self.assertEqual((missing.status_code, missing.json()["detail"]["error"]), (404, "area-not-found"))
        self.assertEqual(self.client.get("/api/v1/sectors/nonsense").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/sectors", params={"q": "W5"}).json(), ALL)
        self.assertEqual(self.client.get("/api/v1/sectors").json(), ALL)


if __name__ == "__main__":
    unittest.main()
