"""Mobile coverage (migration 086, deploy/tools/etl_mobile.py): Ofcom's local-authority file read as
published, London boroughs only, shares of premises, and the two map layers written in SQL."""
import io
import sys
import unittest
import zipfile
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / "tools"))
import etl_mobile  # noqa: E402

MIGRATION = (DEPLOY / "migrations" / "086-area-mobile.sql").read_text()
FIXTURE = DEPLOY / "tests" / "fixtures" / "ofcom_mobile" / "202601_mobile_coverage_laua_r01.csv"


def _zip() -> io.BytesIO:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("202601_mobile_coverage/202601_mobile_coverage_laua_r01.csv", FIXTURE.read_text())
        archive.writestr("202601_mobile_coverage/202601_mobile_coverage_pcon_r01.csv", "pcon\n")
    buffer.seek(0)
    return buffer


class SchemaTests(unittest.TestCase):
    def test_table_and_function(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS area_mobile (", MIGRATION)
        for column in ("outdoor_4g_all_mno", "indoor_4g_all_mno", "outdoor_5g_any", "outdoor_5g_all"):
            self.assertIn(f"{column} real NOT NULL CHECK ({column} BETWEEN 0 AND 1)", MIGRATION)
        self.assertIn("FUNCTION public.rebuild_area_mobile_metrics(p_source_release_id text, p_period date)", MIGRATION)

    def test_layers_are_borough_metrics_with_guide_paths(self):
        for layer in ("mobile-4g-indoor", "mobile-5g-outdoor"):
            self.assertIn(f"'{layer}'", MIGRATION)
        self.assertIn("'borough', '%', 'higher-is-better'", MIGRATION)
        self.assertIn("'methodologyPath', '/guide/people-and-homes'", MIGRATION)
        self.assertIn("percent_rank() OVER", MIGRATION)


class ParserTests(unittest.TestCase):
    def test_london_boroughs_only_as_shares(self):
        boroughs = etl_mobile.ofcom_boroughs(_zip())
        self.assertEqual(sorted(boroughs), ["E09000007", "E09000016", "E09000027"])
        self.assertEqual(boroughs["E09000016"], (115646, 0.9995, 0.9769, 1.0, 0.9717))
        self.assertEqual(boroughs["E09000007"], (122219, 1.0, 0.9988, 1.0, 1.0))

    def test_a_missing_column_stops_the_load(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("x/202601_mobile_coverage_laua_r01.csv", "laua,laua_name,prem_count\nE09000007,Camden,1\n")
        buffer.seek(0)
        with self.assertRaises(SystemExit):
            etl_mobile.ofcom_boroughs(buffer)

    def test_download_names_one_file_and_its_release(self):
        self.assertEqual(list(etl_mobile.FILES), ["mobile-coverage.zip"])
        self.assertTrue(etl_mobile.FILES["mobile-coverage.zip"].endswith("202601_mobile_coverage_r1.zip"))
        self.assertEqual(etl_mobile.PERIOD.isoformat(), "2026-01-01")


if __name__ == "__main__":
    unittest.main()
