"""The core public answers, byte for byte, on the seeded PostGIS fixture (deploy/tests/postgis-fixture.sh).

The response models (area_api/contract_models.py) only document the answers: the API still sends the dict each
endpoint builds, through AliasedJSONResponse. These recordings were made before the models were added and prove
it: status, content type, Deprecation header and body bytes are unchanged. Re-record after a deliberate payload
change with CLOSE_KNIT_RECORD=1 (and say why in the commit).
"""
import json
import os
import unittest
from pathlib import Path
from unittest import mock

from area_api import regions

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api.evidence import EvidenceReader
except ImportError:  # pragma: no cover
    app_module = None

TEST_DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")
RECORDED = Path(__file__).resolve().parent / "fixtures" / "recorded"
CAMDEN = "uk:lsoa:E01000900"

# name -> GET path on the fixture
CORE = {
    "scope": "/api/v1/scope",
    "scope-regions": "/api/v1/scope?regions=E12000007",
    "metrics": "/api/v1/metrics",
    "map-coverage": "/api/v1/map/coverage",
    "search": "/api/v1/search?q=Camden",
    "search-all": "/api/v1/search?q=Fixture&scope=all",
    "area-crime": f"/api/v1/areas/{CAMDEN}?metric=crime&period=2026-06",
    "area-price": f"/api/v1/areas/{CAMDEN}?metric=price-per-square-metre&period=2026-06",
    "area-msoa": "/api/v1/areas/uk:msoa:E02000167?metric=price-per-square-metre&period=2026-06",
    "area-unknown": "/api/v1/areas/uk:lsoa:E01099999?metric=crime&period=2026-06",
    "area-profile": f"/api/v1/areas/{CAMDEN}/profile?period=2026-06",
    "area-pack": f"/api/v1/areas/{CAMDEN}/pack",
    "area-schools": f"/api/v1/areas/{CAMDEN}/schools",
    "area-trail": f"/api/v1/areas/{CAMDEN}/trail",
    "area-names": f"/api/v1/areas/names?ids={CAMDEN},uk:msoa:E02000166",
    "area-boxes": "/api/v1/areas/boxes?carrier=msoa",
    "metric-values": "/api/v1/metric-values/crime?periods=2026-05,2026-06",
    "value-pack-crime": "/api/v1/value-packs/crime/2026-06",
    "value-pack-price": "/api/v1/value-packs/price-per-square-metre/2026-06?level=msoa",
    "area-values": "/api/v1/area-values/crime/2026-06?carrier=msoa",
    "area-values-no-carrier": "/api/v1/area-values/crime/2026-06",
    "property": "/api/v1/properties/100000000001",
    "postcode-homes": "/api/v1/postcodes/NW1%200AA/homes",
    "stations": "/api/v1/stations?q=Cam",
    "schools-search": "/api/v1/schools?q=Fixture",
    "school": "/api/v1/schools/900001",
    "school-card": "/api/v1/schools/900001/card",
    "hierarchy": "/api/v1/hierarchy",
}
# What a release derives, built at its activation into release_artifact (migration 128, area_api/release_store.py):
# recorded before the warm threads and module caches were replaced. Their answers have no response models yet, so
# they live apart from the core ones test_openapi_contract validates.
RECORDED_DERIVED = Path(__file__).resolve().parent / "fixtures" / "recorded-derived"
DERIVED = {
    "area-standouts": f"/api/v1/areas/{CAMDEN}/standouts",
    "msoa-standouts": "/api/v1/areas/uk:msoa:E02000167/standouts",
    "borough-standouts": "/api/v1/areas/uk:lad:E09000007/standouts",
    "area-safety": f"/api/v1/areas/{CAMDEN}/safety",
    "area-home": f"/api/v1/areas/{CAMDEN}/home",
    "area-people": f"/api/v1/areas/{CAMDEN}/people",
    "area-layers": f"/api/v1/areas/{CAMDEN}/layers",
    "lens-msoa": "/api/v1/area-values/lens/gyms?carrier=msoa",
    "lens-borough": "/api/v1/area-values/lens/gyms?carrier=borough",
    "preset-pack": "/api/v1/custom-criteria/presets/gyms/pack",
    "preset-pack-msoa": "/api/v1/custom-criteria/presets/gyms/pack?level=msoa",
    "value-pack-chunk": "/api/v1/value-packs/crime/2026-06?chunk=E12000007",
    "value-pack-chunk-msoa": "/api/v1/value-packs/crime/2026-06?chunk=E12000007&level=msoa",
}


def _record(response) -> dict:
    return {"status": response.status_code, "contentType": response.headers.get("content-type"),
            "deprecation": response.headers.get("deprecation"), "body": response.content.decode()}


@unittest.skipIf(app_module is None, "fastapi is not installed")
@unittest.skipUnless(TEST_DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to the seeded PostGIS fixture")
class RecordedResponseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg
        from psycopg.rows import dict_row

        connect = lambda: psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row)  # noqa: E731
        with connect() as connection:
            if not connection.execute(
                    "SELECT 1 FROM active_product_release WHERE release_id = 'fixture-2026-06'").fetchone():
                raise unittest.SkipTest("not the seeded fixture (deploy/tests/postgis-fixture.sh)")
            # The first pass builds what a release keeps, the second reads it from the table (migration 128).
            connection.execute("DELETE FROM release_artifact")
        cls.connect = staticmethod(connect)

    def setUp(self):
        regions.clear_cache()
        self.addCleanup(regions.clear_cache)
        env = mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "1", "CLOSE_KNIT_ACCESS": "private"})
        env.start()
        self.addCleanup(env.stop)
        previous = app_module._reader
        app_module._reader = EvidenceReader(connect=self.connect)
        self.addCleanup(setattr, app_module, "_reader", previous)
        connect = mock.patch.object(app_module, "_connect", self.connect)  # routes that read without the reader
        connect.start()
        self.addCleanup(connect.stop)
        self.client = TestClient(app_module.app)

    def responses(self):
        for folder, answers in ((RECORDED, CORE), (RECORDED_DERIVED, DERIVED)):
            for name, path in answers.items():
                yield folder / f"{name}.json", path, _record(self.client.get(path))

    def test_core_answers_are_byte_identical_to_the_recordings(self):
        if os.environ.get("CLOSE_KNIT_RECORD") == "1":
            for file, path, record in self.responses():
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(json.dumps({"path": path, **record}, indent=1) + "\n")
            self.skipTest("recorded")
        # Twice: the first answers build what a release keeps, the second read it back.
        for file, path, record in [*self.responses(), *self.responses()]:
            with self.subTest(file.stem):
                expected = json.loads(file.read_text())
                self.assertEqual(expected["path"], path)
                self.assertEqual({key: expected[key] for key in record}, record)
        with self.connect() as connection:
            kinds = {row["kind"] for row in connection.execute("SELECT DISTINCT kind FROM release_artifact")}
        self.assertLessEqual({"pack", "periods", "school-pool", "school-compare-pool", "borough-standouts", "standouts",
                              "safety", "preset-values", "lens", "preset-pack", "geometry-boxes", "area-pages"}, kinds)


if __name__ == "__main__":
    unittest.main()
