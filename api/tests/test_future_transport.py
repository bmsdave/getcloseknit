"""Future transport (migration 088): the nearest new station in the evidence envelope, its card note,
and "proposed" never reading as coming."""
import unittest

from area_api import envelope, future_transport
from area_api.evidence import AreaNotFound, EvidenceReader, MalformedQuery

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

AREA = "uk:lsoa:E01000001"
ROW = {"geography_id": AREA, "station": "Old Oak Common", "scheme": "HS2 and Elizabeth line at Old Oak Common",
       "mode": "rail", "distance_m": 1240, "status": "under construction", "expected_year": None,
       "source_url": "https://www.gov.uk/hs2", "source_release_id": "src-future-transport-2026-10"}
SOURCE = {"id": "src-future-transport-2026-10", "source_url": "https://tfl.gov.uk/travel-information/improvements-and-projects/",
          "licence": "OGL-3.0", "attribution": "Close Knit's list of new stations"}


class Connection:
    def __init__(self, rows=(ROW,), loaded=True):
        self.rows, self.loaded = list(rows), loaded

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- evidence:active-release":
            return [{"release_id": "rel-test"}]
        if marker == "-- evidence:area-exists":
            return [{"?column?": 1}] if params[0].startswith("uk:") and params[0].endswith("1") else []
        if marker == "-- evidence:area-future-transport":
            if not self.loaded:
                raise RuntimeError("relation area_future_transport does not exist")
            return [row for row in self.rows if row["geography_id"] == params[0]]
        if marker == "-- evidence:area-future-transport-sources":
            return [SOURCE] if SOURCE["id"] in params[0] else []
        raise AssertionError(marker)


def read(area=AREA, **kwargs):
    connection = Connection(**kwargs)
    return future_transport.area_future_transport(EvidenceReader(connect=lambda: connection), area)


class NoteTests(unittest.TestCase):
    def test_counted_station_with_a_year(self):
        note = future_transport.card_note({**future_transport.nearest_value(ROW), "expectedYear": 2032})
        self.assertEqual(note, "New station Old Oak Common ≈ 1.2 km away, under construction, expected 2032")

    def test_proposed_never_reads_as_coming(self):
        note = future_transport.card_note(future_transport.nearest_value(
            {**ROW, "station": "Old Kent Road 1", "status": "proposed", "expected_year": 2040, "distance_m": 400}))
        self.assertEqual(note, "New station Old Kent Road 1 ≈ 0.4 km away, proposed, not funded")
        self.assertNotIn("expected", note)

    def test_beyond_two_km_no_line(self):
        self.assertIsNone(future_transport.card_note(future_transport.nearest_value({**ROW, "distance_m": 2001})))


class EnvelopeTests(unittest.TestCase):
    def test_contract(self):
        payload = read()
        self.assertEqual(payload["schemaVersion"], "area-future-transport.v1")
        self.assertEqual(set(payload), {"schemaVersion", "productReleaseId", "dataMode", "value", "confidence",
                                        "evidence", "sources", "caveats"})
        self.assertIn(payload["confidence"], envelope.CONFIDENCE_BANDS)
        value = payload["value"]
        self.assertTrue(value["available"])
        self.assertEqual(value["nearest"]["distanceM"], 1240)
        self.assertTrue(value["nearest"]["withinReach"])
        self.assertEqual(value["note"], "New station Old Oak Common ≈ 1.2 km away, under construction")
        self.assertEqual(payload["evidence"][0]["kind"], "future-station")
        self.assertEqual([s["sourceUrl"] for s in payload["sources"]],
                         ["https://www.gov.uk/hs2", SOURCE["source_url"]])
        self.assertTrue(any("proposed" in caveat for caveat in payload["caveats"]))

    def test_no_station_or_not_loaded_is_unavailable_not_an_error(self):
        for payload in (read(rows=()), read(loaded=False)):
            self.assertFalse(payload["value"]["available"])
            self.assertIsNone(payload["value"]["nearest"])
            self.assertEqual(payload["confidence"], "none")
            self.assertEqual(payload["evidence"], [])

    def test_bad_and_unknown_areas(self):
        with self.assertRaises(MalformedQuery):
            read("not-an-area")
        with self.assertRaises(AreaNotFound):
            read("uk:lsoa:E01000002")


@unittest.skipIf(TestClient is None, "fastapi is not installed")
class HttpTests(unittest.TestCase):
    def setUp(self):
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=lambda: Connection())
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_round_trip(self):
        response = self.client.get(f"/api/v1/areas/{AREA}/future-transport")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["value"]["nearest"]["station"], "Old Oak Common")
        self.assertEqual(self.client.get("/api/v1/areas/uk:lsoa:E01000002/future-transport").status_code, 404)


if __name__ == "__main__":
    unittest.main()
