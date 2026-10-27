"""England places: coverage-aware loaders (release ids, boxes, FHRS authorities, gzipped work files) and the
files build of the unified table (TSV parsing, per-source signals, specialty coffee in the merge pass)."""

import gzip
import json
import os
import tempfile
import unittest

from area_analytics import coverage, food_hygiene, fsq_places, overture_places, workfiles
from area_analytics import places_specialty as sp
from area_analytics import places_unified as pu

TAX = pu.Taxonomy.load()
LABEL = f"Dining and Drinking > {sp.FSQ_COFFEE}"


class CoverageTests(unittest.TestCase):
    def test_release_ids_keep_london_and_mark_england(self):
        self.assertEqual(overture_places.source_id("london"), "src-overture-places-2026-09-23.1")
        self.assertEqual(overture_places.source_id("england"), "src-overture-places-2026-09-23.1-england")
        base = {"release": "2026-09-15", "base": "hf://x", "sha256": "s", "closed": 1, "rows": 2}
        self.assertEqual(fsq_places.source_release(base)[0], "src-fsq-os-places-2026-09-15")
        england = fsq_places.source_release({**base, "coverage": "england"})
        self.assertEqual(england[0], "src-fsq-os-places-2026-09-15-england")
        self.assertIn("England extract", " ".join(england[6]))

    def test_fhrs_authorities_by_coverage(self):
        listing = {"authorities": [{"LocalAuthorityIdCode": "501", "RegionName": "London"},
                                   {"LocalAuthorityIdCode": "413", "RegionName": "Yorkshire and Humberside"},
                                   {"LocalAuthorityIdCode": "760", "RegionName": "Scotland"},
                                   {"LocalAuthorityIdCode": "567", "RegionName": "Wales"},
                                   {"LocalAuthorityIdCode": "800", "RegionName": "Northern Ireland"}]}
        self.assertEqual(food_hygiene.coverage_codes(listing, coverage.LONDON), {"501"})
        self.assertEqual(food_hygiene.coverage_codes(listing, coverage.ENGLAND), {"501", "413"})

    def test_fhrs_release_per_coverage(self):
        sources = {"extract_date": "2026-10-21", "sha256": "s", "files": 298, "skipped": {}}
        self.assertEqual(food_hygiene.source_release(sources)[0], "src-fsa-fhrs-2026-10")
        england = food_hygiene.source_release({**sources, "coverage": "england", "retrieved": "2026-10-22"})
        self.assertEqual(england[0], "src-fsa-fhrs-england-2026-10")
        self.assertIn("298 English authorities", england[6][0])

    def test_work_files_gzip_outside_london(self):
        self.assertEqual(workfiles.name("/w", "a.tsv", coverage.LONDON), "/w/a.tsv")
        self.assertEqual(workfiles.name("/w", "a.tsv", coverage.ENGLAND), "/w/a.tsv.gz")
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "a.tsv.gz")
            with workfiles.open_text(path, "w") as handle:
                handle.write("x\ty\n")
            with gzip.open(path, "rt") as handle:
                self.assertEqual(handle.read(), "x\ty\n")
            with workfiles.open_text(path) as handle:
                self.assertEqual(list(handle), ["x\ty\n"])


class FileParsingTests(unittest.TestCase):
    def test_copy_text_and_arrays_round_trip(self):
        row = overture_places.place_row({"id": "o1", "name": 'Tab\there "q"', "category": "cafe",
                                         "alternate_categories": ["coffee_shop", 'a "b"'], "confidence": 0.95,
                                         "datasets": ["meta", "Foursquare"], "lon": -1.5, "lat": 53.8})
        line = overture_places.tsv_line(row)
        values = dict(zip(overture_places.COLUMNS, (pu.copy_unescape(v) for v in line.split("\t"))))
        self.assertEqual(values["name"], 'Tab\there "q"')
        self.assertEqual(pu.pg_array(values["alternate_categories"]), ["coffee_shop", 'a "b"'])
        self.assertEqual(pu.pg_array(values["datasets"]), ["Foursquare", "meta"])
        self.assertIsNone(pu.copy_unescape(""))
        self.assertEqual(pu.pg_array('{"a",NULL,"c"}'), ["a", None, "c"])

    def test_tsv_records_split_the_point_and_read_older_overture_files(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "o.tsv")
            with open(path, "w") as handle:  # no website column (before migration 051)
                handle.write("o1\tCafe\tcafe\t\tcafe\t\t\t0.8\t\t{\"meta\"}\tSRID=4326;POINT(-1.5 53.8)\n")
            [record] = pu.tsv_records(path, overture_places.COLUMNS)
        self.assertEqual((record["id"], record["lon"], record["lat"], record["confidence"]), ("o1", -1.5, 53.8, "0.8"))
        self.assertNotIn("website", record)

    def test_fresh_since_two_years_before_the_latest_refresh(self):
        with tempfile.TemporaryDirectory() as folder:
            with open(os.path.join(folder, "sources.json"), "w") as handle:
                json.dump({"latest_refresh": "2028-02-29"}, handle)
            self.assertEqual(pu.fsq_fresh_since({"fsq": os.path.join(folder, "fsq_place.tsv")}), "2026-02-28")


class SignalsTests(unittest.TestCase):
    def test_signals_mirror_the_source_columns(self):
        _, osm = pu.file_candidate(TAX, "osm", {"id": "n1", "tags": {"amenity": "cafe", "cuisine": "coffee_shop",
                                                                       "name": "Brew Lab"}, "lon": -1.5, "lat": 53.8},
                                   "2024-09-15")
        self.assertEqual(osm, {"osm_tags": {"amenity": "cafe", "cuisine": "coffee_shop", "name": "Brew Lab"}})
        _, ovt = pu.file_candidate(TAX, "overture", {"id": "o1", "name": "Brew Lab", "category": "coffee_shop",
                                                     "alternate_categories": ["cafe"], "brand": None,
                                                     "confidence": 0.9, "datasets": ["Foursquare"],
                                                     "lon": -1.5, "lat": 53.8}, "2024-09-15")
        self.assertEqual(ovt, {"ov_cat": "coffee_shop", "ov_alt": ["cafe"], "ov_brand": None, "ov_from_fsq": True})
        _, fsq = pu.file_candidate(TAX, "fsq", {"fsq_place_id": "f1", "name": "Brew Lab",
                                                "category_labels": [LABEL], "date_refreshed": "2023-01-01",
                                                "date_closed": None, "lon": -1.5, "lat": 53.8}, "2024-09-15")
        self.assertEqual(fsq, {"fsq_labels": [LABEL], "fsq_closed": False, "fsq_stale": True})
        self.assertIsNone(pu.file_candidate(TAX, "osm", {"id": "n2", "tags": {"highway": "bus_stop"},
                                                         "lon": 0, "lat": 0}, "2024-09-15"))

    def test_specialty_in_the_merge_pass(self):
        place = {"name": "Brew Lab Coffee", "category": "coffee_shop", "tags": {"amenity": "cafe"},
                 "sources": ["osm", "overture", "fsq"]}
        signals = {"osm_tags": {"amenity": "cafe", "cuisine": "coffee_shop"}, "ov_cat": "coffee_shop",
                   "fsq_labels": [f"Dining and Drinking > {sp.FSQ_COFFEE}"]}
        scored = pu.specialty(place, signals, "2024-09-15")
        self.assertGreaterEqual(scored["specialty_score"], sp.THRESHOLD)
        self.assertIn(sp.TAG, scored["tags"]["cuisine"])
        chain = pu.specialty({"name": "Costa Coffee", "category": "coffee_shop",
                              "tags": {"amenity": "cafe", "cuisine": sp.TAG}, "sources": ["osm"]}, {}, "2024-09-15")
        self.assertIsNone(chain["specialty_score"])
        self.assertNotIn("cuisine", chain["tags"])
        pub = pu.specialty({"name": "The Crown", "category": "pub", "tags": {"amenity": "pub"}, "sources": ["osm"]},
                           {}, "2024-09-15")
        self.assertIsNone(pub["specialty_score"])
        self.assertEqual(pub["tags"], {"amenity": "pub"})

    def test_copy_line_escapes_like_copy_text(self):
        line = pu.copy_line(("osm", None, True, {"name": "a\tb"}, 0.5))  # JSON's \t, its backslash doubled
        self.assertEqual(line, 'osm\t\\N\tt\t{"name": "a\\\\tb"}\t0.5\n')


if __name__ == "__main__":
    unittest.main()
