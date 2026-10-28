"""Local market: widening, unknown-not-zero, trend shape, paging and errors."""
import contextlib
import unittest
from unittest import mock

from area_api import evidence, market

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

LSOA, MSOA, BOROUGH = "uk:lsoa:E01000001", "uk:msoa:E02000001", "uk:lad:E09000001"
CHAIN = [
    {"id": LSOA, "carrier": "lsoa", "name": "Sample 001A", "depth": 0},
    {"id": MSOA, "carrier": "msoa", "name": "Sample 001", "depth": 1},
    {"id": BOROUGH, "carrier": "lad", "name": "Sample", "depth": 2},
]


def market_row(geography, kind, end, sales, median=None, ppm=None, **extra):
    row = {"geography_id": geography, "property_type": kind, "window_end": end, "sales": sales,
           "median_price": median, "p5": None, "p25": None, "p75": None, "p95": None,
           "min_price": None, "max_price": None, "ppm_sales": 0, "median_ppm": ppm,
           "source_release_id": "src-hmlr-pp-sales-2026-07", "attribution": "HM Land Registry"}
    row.update(extra)
    return row


ROWS = [
    market_row(LSOA, "all", "2026-07", 4, 500_000),
    market_row(LSOA, "F", "2026-07", 4, 500_000),
    market_row(MSOA, "all", "2026-07", 30, 450_000, 7000.456, p5=200_000, p25=300_000, p75=600_000,
               p95=900_000, min_price=150_000, max_price=1_000_000, ppm_sales=20),
    market_row(MSOA, "F", "2026-07", 20, 400_000, 7500.0),
    market_row(MSOA, "T", "2026-07", 10, 700_000),
    market_row(MSOA, "all", "2016-07", 25, 300_000, 5000.0),
    market_row(MSOA, "F", "2020-07", 8, 350_000),
    market_row(BOROUGH, "all", "2026-07", 900, 520_000),
]

SALE = {"transaction_id": "T1", "date": "2026-06-01", "display_address": "1 Sample Road, London",
        "postcode": "E1 1AA", "property_type": "F", "tenure": "L", "new_build": False, "price": 410_000,
        "distance_metres": 120, "source_release_id": "src-hmlr-pp-sales-2026-07"}


# The area view's Price tile row (standouts:metrics): the neighbourhood's own £/m², not the widened market median.
TILE_ROWS = [{"geography_id": LSOA, "metric_id": "price-per-square-metre", "period": "2026-06", "value": 12_040.4,
              "region_percentile": 88, "sample_count": 9}]


class FakeConnection:
    def __init__(self, chain=CHAIN, rows=ROWS, total=41, tile_rows=TILE_ROWS):
        self.chain, self.rows, self.total, self.tile_rows = chain, rows, total, tile_rows
        self.calls = []

    def execute(self, sql, params=()):
        marker = sql.splitlines()[0]
        self.calls.append((marker, sql, params))
        if "active_product_release" in sql:
            return [{"release_id": "rel-test"}]
        if marker == "-- market:chain":
            return self.chain
        if marker == "-- market:rows":
            return [row for row in self.rows if row["geography_id"] in params[0]]
        if marker == "-- market:recent-count":
            return [{"total": self.total, "since": "2025-02-01", "until": "2026-07-31"}]
        if marker == "-- market:recent-sales":
            return [SALE]
        if marker == "-- market:since":
            return [{"new_sales": 3, "newest": "2026-07-31"}]
        if marker == "-- standouts:metrics":
            return [row for row in self.tile_rows if row["geography_id"] == params["area"]]
        raise AssertionError(f"unexpected query {marker}")


def reader(connection):
    return evidence.EvidenceReader(connect=lambda: contextlib.nullcontext(connection))


class AreaMarketTests(unittest.TestCase):
    def test_thin_lsoa_widens_to_msoa_and_says_so(self):
        payload = market.area_market(reader(FakeConnection()), LSOA)
        self.assertEqual(payload["schemaVersion"], "area-market-by-type.v1")
        self.assertEqual(payload["basis"], {"geographyId": MSOA, "name": "Sample 001", "carrier": "msoa",
                                            "widened": True, "minimumSales": market.MIN_AREA_SALES})
        self.assertEqual(payload["window"], {"start": "2025-08", "end": "2026-07"})
        summary = payload["summary"]
        self.assertEqual((summary["sales"], summary["medianPrice"], summary["p25"], summary["p75"]),
                         (30, 450_000, 300_000, 600_000))
        self.assertEqual(summary["medianPricePerSquareMetre"], 7000.46)

    def test_by_type_lists_every_type_with_unknown_not_zero(self):
        by_type = market.area_market(reader(FakeConnection()), LSOA)["byType"]
        self.assertEqual([row["propertyType"] for row in by_type], ["D", "S", "T", "F", "O"])
        detached = by_type[0]
        self.assertEqual(detached["sales"], 0)
        self.assertIsNone(detached["medianPrice"])
        self.assertIsNone(detached["medianPricePerSquareMetre"])
        self.assertIsNone(by_type[2]["medianPricePerSquareMetre"])  # terraced: no floor areas

    def test_trend_has_eleven_yearly_points_per_type(self):
        trend = market.area_market(reader(FakeConnection()), LSOA)["trend"]
        self.assertEqual([series["propertyType"] for series in trend], ["all", "D", "S", "T", "F", "O"])
        points = trend[0]["points"]
        self.assertEqual(len(points), 11)
        self.assertEqual((points[0]["windowEnd"], points[0]["medianPrice"]), ("2016-07", 300_000))
        self.assertEqual(points[-1]["medianPrice"], 450_000)
        self.assertIsNone(points[1]["medianPrice"])
        flats = dict((p["windowEnd"], p["medianPrice"]) for p in trend[4]["points"])
        self.assertEqual(flats["2020-07"], 350_000)

    def test_busy_lsoa_is_not_widened(self):
        rows = [market_row(LSOA, "all", "2026-07", 12, 600_000)] + ROWS[2:]
        payload = market.area_market(reader(FakeConnection(rows=rows)), LSOA)
        self.assertEqual(payload["basis"]["geographyId"], LSOA)
        self.assertFalse(payload["basis"]["widened"])

    def test_no_sales_anywhere_is_unavailable(self):
        payload = market.area_market(reader(FakeConnection(rows=[])), LSOA)
        self.assertFalse(payload["available"])
        self.assertIsNone(payload["summary"])
        self.assertEqual(payload["byType"], [])

    def test_errors(self):
        with self.assertRaises(evidence.MalformedQuery):
            market.area_market(reader(FakeConnection()), "E01000001")
        with self.assertRaises(evidence.AreaNotFound):
            market.area_market(reader(FakeConnection(chain=[])), LSOA)


class RecentSalesTests(unittest.TestCase):
    def test_lists_the_same_area_the_summary_uses(self):
        connection = FakeConnection()
        payload = market.recent_sales(reader(connection), LSOA, page=2, page_size=10)
        self.assertEqual(payload["basis"]["geographyId"], MSOA)
        self.assertEqual((payload["total"], payload["page"], payload["since"]), (41, 2, "2025-02-01"))
        self.assertEqual(payload["sales"][0], {
            "transactionId": "T1", "date": "2026-06-01", "address": "1 Sample Road, London",
            "postcode": "E1 1AA", "propertyType": "F", "tenure": "L", "newBuild": False,
            "price": 410_000, "distanceMetres": 120})
        marker, sql, params = connection.calls[-1]
        self.assertIn("r.msoa_id = %(area)s", sql)
        self.assertIn("suppressed_dwelling", sql)
        self.assertIn("ORDER BY distance_metres", sql)
        self.assertEqual(params, {"area": MSOA, "limit": 10, "offset": 10})

    def test_outside_london_says_why_there_are_no_sales(self):
        with mock.patch.object(market.regions, "area_regions_on", return_value={LSOA: "E12000002"}):
            self.assertEqual(market.recent_sales(reader(FakeConnection()), LSOA)["coverage"], "london-only")
        with mock.patch.object(market.regions, "area_regions_on", return_value={LSOA: "E12000007"}):
            self.assertIsNone(market.recent_sales(reader(FakeConnection()), LSOA)["coverage"])

    def test_newest_first_and_bad_paging(self):
        connection = FakeConnection()
        market.recent_sales(reader(connection), LSOA, sort="newest")
        self.assertIn("ORDER BY date DESC", connection.calls[-1][1])
        for kwargs in ({"page": 0}, {"page": 21}, {"page_size": 51}, {"sort": "price"}):
            with self.assertRaises(evidence.MalformedQuery):
                market.recent_sales(reader(FakeConnection()), LSOA, **kwargs)


class AreaSinceTests(unittest.TestCase):
    """v4 Task 52: a saved area's "since your last visit" line."""

    def test_counts_sales_after_the_date_in_the_summary_area(self):
        connection = FakeConnection()
        payload = market.area_since(reader(connection), LSOA, "2026-05-31")
        self.assertEqual(payload["schemaVersion"], "area-since.v1")
        self.assertEqual(payload["basis"]["geographyId"], MSOA)
        self.assertEqual((payload["date"], payload["newSales"], payload["newestSale"]), ("2026-05-31", 3, "2026-07-31"))
        self.assertEqual(payload["attribution"], "HM Land Registry")
        marker, sql, params = next(call for call in connection.calls if call[0] == "-- market:since")
        self.assertIn("r.msoa_id = %(area)s", sql)
        self.assertIn("suppressed_dwelling", sql)
        self.assertEqual(params, {"area": MSOA, "date": "2026-05-31"})

    def test_price_is_the_price_tile_not_the_widened_market_median(self):
        # v4.6: Saved shows the Price tile (£12,000/m²) on the row; the move beside it uses the same figure and month,
        # never the MSOA market median (7,000) the sales count widens to.
        connection = FakeConnection()
        payload = market.area_since(reader(connection), LSOA, "2026-05-31")
        self.assertEqual(payload["pricePerSquareMetre"], {"median": 12_040, "windowEnd": "2026-06", "sales": 9})
        _, _, params = next(call for call in connection.calls if call[0] == "-- standouts:metrics")
        self.assertEqual(params, {"area": LSOA, "metrics": ["price-per-square-metre"]})

    def test_unknown_price_stays_null(self):
        payload = market.area_since(reader(FakeConnection(tile_rows=[])), LSOA, "2026-05-31")
        self.assertEqual(payload["pricePerSquareMetre"], {"median": None, "windowEnd": None, "sales": None})

    def test_borough_takes_its_price_tile(self):
        tile = {"id": "price", "available": True, "value": 9_100, "period": "2026-06"}
        with mock.patch("area_api.standouts.area_standouts", return_value={"tiles": [tile]}) as standouts:
            payload = market.area_since(reader(FakeConnection()), BOROUGH, "2026-05-31")
        standouts.assert_called_once()
        self.assertEqual(payload["pricePerSquareMetre"], {"median": 9_100, "windowEnd": "2026-06", "sales": None})

    def test_bad_date_and_area(self):
        for value in ("", "2026-13-01", "last week", "2026-05-31T00:00"):
            with self.assertRaises(evidence.MalformedQuery):
                market.area_since(reader(FakeConnection()), LSOA, value)
        with self.assertRaises(evidence.MalformedQuery):
            market.area_since(reader(FakeConnection()), "nowhere", "2026-05-31")


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class MarketHttpTests(unittest.TestCase):
    def setUp(self):
        self._previous = app_module._reader
        app_module._reader = reader(FakeConnection())
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_routes_and_errors(self):
        ok = self.client.get(f"/api/v1/areas/{LSOA}/market-by-type")
        sales = self.client.get(f"/api/v1/areas/{LSOA}/recent-sales", params={"page": 1, "pageSize": 5})
        bad = self.client.get(f"/api/v1/areas/{LSOA}/recent-sales", params={"pageSize": 500})
        deep = self.client.get(f"/api/v1/areas/{LSOA}/recent-sales", params={"page": 21})
        malformed = self.client.get("/api/v1/areas/nowhere/market-by-type")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["basis"]["carrier"], "msoa")
        self.assertEqual(sales.status_code, 200)
        self.assertEqual(sales.json()["pageSize"], 5)
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(deep.status_code, 400)
        self.assertEqual(malformed.status_code, 400)
        since = self.client.get(f"/api/v1/areas/{LSOA}/since", params={"date": "2026-05-31"})
        self.assertEqual(since.status_code, 200)
        self.assertEqual(since.json()["newSales"], 3)
        self.assertEqual(self.client.get(f"/api/v1/areas/{LSOA}/since", params={"date": "soon"}).status_code, 400)
        self.assertEqual(self.client.get(f"/api/v1/areas/{LSOA}/since").status_code, 422)


if __name__ == "__main__":
    unittest.main()
