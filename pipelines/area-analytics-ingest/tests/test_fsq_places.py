"""Foursquare OS Places: bbox pruning, row minimisation, array literals, the TSV and the release."""

import unittest

from area_analytics import fsq_places

RECORD = {"fsq_place_id": "4ac518cdf964a520e6a520e3", "name": 'Ali\'s "Best"\tKebab',
          "latitude": 51.5155, "longitude": -0.0712, "date_created": "2012-03-01",
          "date_refreshed": "2024-11-30", "date_closed": None,
          "fsq_category_ids": ["4bf58dd8d48988d1df931735"],
          "fsq_category_labels": ["Dining and Drinking > Restaurant > Kebab Restaurant"],
          "address": "1 High Road", "tel": "020 0000 0000"}


class BboxTests(unittest.TestCase):
    def test_overlaps_london_and_skips_elsewhere(self):
        self.assertTrue(fsq_places.overlaps(51.4, 51.6, -0.2, 0.0, bbox=fsq_places.LONDON_BBOX))
        self.assertTrue(fsq_places.overlaps(50.0, 52.0, -1.0, 1.0, bbox=fsq_places.LONDON_BBOX))  # a row group spanning the bbox
        self.assertFalse(fsq_places.overlaps(52.0, 53.0, -0.2, 0.0, bbox=fsq_places.LONDON_BBOX))  # north of London
        self.assertFalse(fsq_places.overlaps(51.4, 51.6, 0.5, 1.0, bbox=fsq_places.LONDON_BBOX))  # east of London


class RowTests(unittest.TestCase):
    def test_fields_and_minimisation(self):
        row = fsq_places.place_row(RECORD)
        self.assertEqual(set(row), set(fsq_places.COLUMNS))  # no address or phone
        self.assertEqual(row["location"], "SRID=4326;POINT(-0.0712 51.5155)")
        self.assertEqual(row["date_refreshed"], "2024-11-30")
        self.assertIsNone(row["date_closed"])
        self.assertEqual(row["category_ids"], '{"4bf58dd8d48988d1df931735"}')

    def test_skips_rows_without_id_or_point(self):
        self.assertIsNone(fsq_places.place_row({**RECORD, "fsq_place_id": None}))
        self.assertIsNone(fsq_places.place_row({**RECORD, "latitude": None}))
        self.assertIsNone(fsq_places.place_row({**RECORD, "latitude": 95.0}))

    def test_dates_are_validated(self):
        row = fsq_places.place_row({**RECORD, "date_closed": "2023-05-04", "date_created": "unknown"})
        self.assertEqual(row["date_closed"], "2023-05-04")
        self.assertIsNone(row["date_created"])

    def test_pg_array_quotes_and_nulls(self):
        self.assertIsNone(fsq_places.pg_array(None))
        self.assertEqual(fsq_places.pg_array([]), "{}")
        self.assertEqual(fsq_places.pg_array(['a "b"', "c\\d", None]), '{"a \\"b\\"","c\\\\d",NULL}')

    def test_tsv_escapes_and_writes_nulls_empty(self):
        line = fsq_places.tsv_line(fsq_places.place_row(RECORD))
        fields = line.split("\t")
        self.assertEqual(len(fields), len(fsq_places.COLUMNS))
        self.assertEqual(fields[1], 'Ali\'s "Best"\\tKebab')
        self.assertEqual(fields[6], "")  # date_closed NULL


class HuggingFaceTests(unittest.TestCase):
    def test_hf_release_lists_its_parquet_with_the_saved_token(self):
        import io
        import json
        import os
        from unittest import mock

        seen = {}

        def fake_urlopen(request):
            seen["url"], seen["auth"] = request.full_url, request.headers.get("Authorization")
            return io.BytesIO(json.dumps([
                {"path": "release/dt=2026-09-15/places/parquet/places_000001.parquet"},
                {"path": "release/dt=2026-09-15/places/parquet/places_000000.parquet"},
                {"path": "release/dt=2026-09-15/places/parquet/_SUCCESS"}]).encode())

        with mock.patch.dict(os.environ, {"HF_TOKEN": "test-token"}), \
                mock.patch.object(fsq_places.urllib.request, "urlopen", fake_urlopen):
            files = fsq_places.list_files("hf://datasets/foursquare/fsq-os-places", "2026-09-15")
        self.assertEqual(seen["url"], "https://huggingface.co/api/datasets/foursquare/fsq-os-places/tree/main/"
                                      "release/dt=2026-09-15/places/parquet")
        self.assertEqual(seen["auth"], "Bearer test-token")
        self.assertEqual(files, [
            "hf://datasets/foursquare/fsq-os-places/release/dt=2026-09-15/places/parquet/places_000000.parquet",
            "hf://datasets/foursquare/fsq-os-places/release/dt=2026-09-15/places/parquet/places_000001.parquet"])


class SourceReleaseTests(unittest.TestCase):
    def test_release_is_dated_and_parameterised(self):
        sources = {"release": "2025-02-06", "base": "https://data.source.coop/fused/fsq-os-places",
                   "sha256": "f" * 64, "rows": 100, "closed": 12}
        source_id, url, released, sha, licence, attribution, caveats = fsq_places.source_release(sources)
        self.assertEqual(source_id, "src-fsq-os-places-2025-02-06")
        self.assertEqual(url, "https://data.source.coop/fused/fsq-os-places/2025-02-06/places/")
        self.assertEqual((released, licence), ("2025-02-06", "Apache-2.0"))
        self.assertIn("snapshot of 2025-02-06", caveats[0])
        self.assertIn("12 of 100", caveats[1])
        fresher = fsq_places.source_release({**sources, "release": "2026-09-01"})
        self.assertEqual(fresher[0], "src-fsq-os-places-2026-09-01")


if __name__ == "__main__":
    unittest.main()
