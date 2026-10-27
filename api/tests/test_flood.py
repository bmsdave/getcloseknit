"""Track I: area and home flood risk bands (migration 018, area-flood.v1)."""
import unittest

from area_api import flood
from area_api.evidence import AreaNotFound, Cancelled, EvidenceReader, MalformedQuery, ReleaseUnavailable
from tests.test_production_evidence import OLD_RELEASE, seed_production_fixture

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

AREA = "uk:lsoa:E01000004"
RELEASE = "src-ea-nafra2-flood-2026-07"


class FloodConnection:
    """The production fixture connection plus area_flood and dwelling_flood rows."""

    def __init__(self, base):
        self.base = base
        self.area_flood = {}  # area id -> list of area_flood rows
        self.dwelling_flood = {}  # uprn -> row

    def __getattr__(self, name):
        return getattr(self.base, name)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- evidence:area-exists":
            return [{"?column?": 1}] if params[0] in self.base.geographies else []
        if marker == "-- evidence:area-flood":
            return [dict(row) for row in self.area_flood.get(params[0], [])]
        if marker == "-- evidence:dwelling-flood":
            row = self.dwelling_flood.get(params[0])
            return [dict(row)] if row and params[0] not in self.base.suppressed else []
        return self.base.execute(sql, params)


def area_row(source, area, low=0.0, medium=0.0, high=0.0):
    return {"source": source, "area_m2": area, "low_m2": low, "medium_m2": medium, "high_m2": high,
            "source_release_id": RELEASE, "caveats": ["Area figures describe the land, not each building."],
            "attribution": "Environment Agency (OGL v3.0)"}


def seeded():
    connection = FloodConnection(seed_production_fixture())
    connection.area_flood[AREA] = [
        area_row("rivers-sea", 200_000, low=20_000, medium=10_000, high=4_000),
        area_row("surface-water", 200_000, low=6_000, medium=1_000, high=1_000),
    ]
    connection.dwelling_flood["100023336956"] = {"rivers_sea_band": 3, "surface_water_band": 1}
    return connection


class AreaBandsTests(unittest.TestCase):
    def test_shares_add_up_and_very_low_is_the_rest(self):
        bands = flood.area_bands(area_row("rivers-sea", 200_000, low=20_000, medium=10_000, high=4_000))

        self.assertEqual(bands["shares"], {"very-low": 0.83, "low": 0.1, "medium": 0.05, "high": 0.02})
        self.assertAlmostEqual(sum(bands["shares"].values()), 1.0)
        self.assertEqual(bands["highestBand"], "high")

    def test_a_sliver_under_one_percent_does_not_set_the_highest_band(self):
        bands = flood.area_bands(area_row("surface-water", 200_000, low=6_000, high=1_000))

        self.assertEqual(bands["shares"]["high"], 0.005)
        self.assertEqual(bands["highestBand"], "low")

    def test_nothing_mapped_is_very_low_everywhere(self):
        bands = flood.area_bands(area_row("rivers-sea", 50_000))

        self.assertEqual(bands, {"shares": {"very-low": 1.0, "low": 0.0, "medium": 0.0, "high": 0.0},
                                 "highestBand": "very-low"})

    def test_empty_area_has_no_bands(self):
        self.assertIsNone(flood.area_bands(area_row("rivers-sea", 0)))

    def test_band_codes(self):
        self.assertEqual([flood.band_name(code) for code in (1, 2, 3, 4)], list(flood.BANDS))
        self.assertIsNone(flood.band_name(None))
        self.assertIsNone(flood.band_name(7))


class AreaFloodReaderTests(unittest.TestCase):
    def read(self, connection, area=AREA, uprn=None, **kwargs):
        return flood.area_flood(EvidenceReader(connect=lambda: connection), area, uprn, **kwargs)

    def test_area_and_home(self):
        payload = self.read(seeded(), uprn="100023336956")

        self.assertEqual(payload["schemaVersion"], "area-flood.v1")
        self.assertEqual(payload["productReleaseId"], OLD_RELEASE)
        self.assertTrue(payload["available"])
        self.assertEqual(payload["riversSea"]["highestBand"], "high")
        self.assertEqual(payload["surfaceWater"]["highestBand"], "low")
        self.assertEqual(payload["dwelling"], {"uprn": "100023336956", "riversSea": "medium",
                                               "surfaceWater": "very-low"})
        self.assertEqual(payload["sourceVersion"], RELEASE)
        self.assertTrue(payload["caveats"])

    def test_missing_area_data_is_unknown_not_very_low(self):
        connection = seeded()
        connection.area_flood.clear()

        payload = self.read(connection)

        self.assertFalse(payload["available"])
        self.assertIsNone(payload["riversSea"])
        self.assertIsNone(payload["surfaceWater"])
        self.assertIsNone(payload["dwelling"])
        self.assertEqual(payload["caveats"], [])

    def test_one_source_missing_stays_unknown(self):
        connection = seeded()
        connection.area_flood[AREA] = connection.area_flood[AREA][:1]

        payload = self.read(connection)

        self.assertIsNotNone(payload["riversSea"])
        self.assertIsNone(payload["surfaceWater"])

    def test_unknown_or_hidden_home_has_no_band(self):
        connection = seeded()
        connection.suppressed.add("100023336956")

        self.assertIsNone(self.read(connection, uprn="100023336956")["dwelling"])
        self.assertIsNone(self.read(connection, uprn="999")["dwelling"])

    def test_errors(self):
        connection = seeded()
        with self.assertRaises(MalformedQuery):
            self.read(connection, area="E01000004")
        with self.assertRaises(MalformedQuery):
            self.read(connection, uprn="12ab")
        with self.assertRaises(AreaNotFound):
            self.read(connection, area="uk:lsoa:E01009999")
        with self.assertRaises(Cancelled):
            self.read(connection, cancel=lambda: True)
        connection.base.active_id = None
        with self.assertRaises(ReleaseUnavailable):
            self.read(connection)


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class AreaFloodHttpTests(unittest.TestCase):
    def setUp(self):
        connection = seeded()
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=lambda: connection)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_round_trip_and_errors(self):
        ok = self.client.get(f"/api/v1/areas/{AREA}/flood", params={"uprn": "100023336956"})
        unknown = self.client.get("/api/v1/areas/uk:lsoa:E01009999/flood")
        malformed = self.client.get(f"/api/v1/areas/{AREA}/flood", params={"uprn": "x"})

        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["dwelling"]["riversSea"], "medium")
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(malformed.status_code, 400)


if __name__ == "__main__":
    unittest.main()
