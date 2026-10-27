"""Migration 103 (England geography, ranks within the region) and the England geography load."""
import gzip
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import area_coverage  # noqa: E402
import etl_england_geography  # noqa: E402

DEPLOY = Path(__file__).parents[1]
MIGRATION = (DEPLOY / "migrations" / "103-england-geography.sql").read_text()


class MigrationTests(unittest.TestCase):
    def test_borough_is_any_english_lad(self):
        self.assertIn("IF NEW.official_code !~ '^E0[6-9][0-9]{6}$' THEN", MIGRATION)
        self.assertIn("Borough is not an English local authority district", MIGRATION)
        self.assertNotIn("london_codes", MIGRATION)

    def test_every_lad_has_a_region(self):
        rows = re.findall(r"\('(E0[6-9]\d{6})', '(?:[^']|'')+', '(E1200000\d)', '[^']+'\)", MIGRATION)
        self.assertEqual(len(rows), 296)
        self.assertEqual(dict(rows), {code: region for code, (_, region) in area_coverage.LADS.items()})
        for fragment in ("CREATE TABLE IF NOT EXISTS area_region", "CREATE TRIGGER area_region_fill",
                         "SELECT refresh_area_region();"):
            self.assertIn(fragment, MIGRATION)

    def test_every_percentile_ranks_within_the_region(self):
        ranks = [line for line in MIGRATION.splitlines() if "percent_rank()" in line]
        self.assertGreaterEqual(len(ranks), 25)
        for line in ranks:
            if "no2_pct IS NOT NULL THEN round((percent_rank() OVER (" in line:
                continue  # partitioned on the next line
            self.assertTrue("area_rank_region(" in line or "PARTITION BY region" in line, line)
        self.assertIn("PARTITION BY kind, area_rank_region(geography_id), no2_pct IS NULL", MIGRATION)
        self.assertNotIn("count(*) OVER ()", MIGRATION)

    def test_good_value_peers_share_the_region(self):
        self.assertIn("b.region IS NOT DISTINCT FROM a.region", MIGRATION)


class GeographyLoadTests(unittest.TestCase):
    def test_load_has_parents_first_and_fills_regions(self):
        city = area_coverage.Coverage("city", frozenset({"E09000001"}), frozenset({"E12000007"}),
                                      area_coverage.LONDON_BBOX_WGS84, area_coverage.LONDON_BBOX_BNG)
        lsoas = {code: msoa for code, (msoa, lad) in area_coverage.lsoa_lookup().items() if lad == "E09000001"}
        square = {"type": "Polygon", "coordinates": [[[-0.1, 51.5], [-0.09, 51.5], [-0.09, 51.51], [-0.1, 51.5]]]}

        def collection(field, name_field, codes):
            return {"type": "FeatureCollection", "features": [
                {"type": "Feature", "properties": {field: code, name_field: f"Area {code}"}, "geometry": square}
                for code in codes]}

        with tempfile.TemporaryDirectory() as folder:
            for name, data in (("geom-lad.json", collection("LAD26CD", "LAD26NM", ["E09000001", "E09000002"])),
                               ("geom-msoa.json", collection("MSOA21CD", "MSOA21NM", set(lsoas.values()))),
                               ("geom-lsoa.json", collection("LSOA21CD", "LSOA21NM", lsoas))):
                Path(folder, name).write_text(json.dumps(data))
            out = Path(folder, "load.sql.gz")
            count = etl_england_geography.write(out, folder, city)
            text = gzip.open(out, "rt").read()
        self.assertEqual(count, 1 + len(set(lsoas.values())) + len(lsoas))
        self.assertTrue(text.startswith("BEGIN;\n") and text.endswith("COMMIT;\n"))
        data = text.split("WITH (FORMAT csv);\n", 1)[1].split("\\.\n", 1)[0].splitlines()
        self.assertTrue(data[0].startswith("uk:lad:E09000001,lad,E09000001,"))
        self.assertTrue(data[1].startswith("uk:msoa:"))
        self.assertTrue(data[-1].startswith("uk:lsoa:"))
        self.assertNotIn("refresh_area_region", text)  # the insert's own trigger fills the regions (migration 123)
        self.assertIn("RAISE EXCEPTION 'England geography: % areas without a region', missing;", text)
        self.assertIn("WHERE NOT EXISTS (SELECT 1 FROM area_geography g WHERE g.id = s.id)", text)


if __name__ == "__main__":
    unittest.main()
