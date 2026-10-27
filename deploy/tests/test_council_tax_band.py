"""Council tax bands (migration 082, deploy/tools/etl_council_tax.py): VOA CTSOP1.1 read as published,
London LSOAs only, every level a sum of LSOAs, and the mean band as a map metric."""
import io
import os
import sys
import unittest
import zipfile
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / "tools"))
import etl_council_tax  # noqa: E402

MIGRATION = (DEPLOY / "migrations" / "082-council-tax-band.sql").read_text()
SAMPLE = (DEPLOY / "tests" / "fixtures" / "ctsop1_1_sample.csv").read_text(encoding="utf-8")


class ParseTests(unittest.TestCase):
    def test_lsoa_rows_only_with_suppressed_counts_as_zero(self):
        rows = etl_council_tax.parse(io.StringIO(SAMPLE))
        self.assertEqual(sorted(rows), ["E01000842", "E01000907", "E01008246"])
        # "-" is fewer than five homes: VOA rounds it away, so it counts as none.
        self.assertEqual(rows["E01000842"], (0, 10, 60, 80, 220, 170, 220, 40))
        self.assertEqual(rows["E01000907"], (0, 110, 260, 120, 80, 10, 40, 10))

    def test_reads_the_csv_inside_the_zip(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("CTSOP1.1/CTSOP1_1_CSV_table_notes.xlsx", b"not a csv")
            archive.writestr("CTSOP1.1/CTSOP1_1_2025_03_31.csv", ("﻿" + SAMPLE).encode("utf-8"))
        buffer.seek(0)
        rows, period = etl_council_tax.read_zip(buffer)
        self.assertEqual(period, "2025-03-01")
        self.assertIn("E01000842", rows)

    def test_covered_rows_keep_known_lsoas_with_a_total(self):
        rows = etl_council_tax.parse(io.StringIO(SAMPLE))
        known = {"uk:lsoa:E01000842", "uk:lsoa:E01000907"}
        out = etl_council_tax.covered_rows(rows, known, "2025-03-01", etl_council_tax.coverage.LONDON)
        self.assertEqual(out[0], ["uk:lsoa:E01000842", 0, 10, 60, 80, 220, 170, 220, 40, 800, "2025-03-01"])
        self.assertEqual([row[0] for row in out], sorted(known))

    def test_london_coverage_drops_lsoas_outside_london(self):
        rows = {"E01000842": (1,) * 8, "E01011949": (2,) * 8}  # Camden, Hartlepool
        known = {"uk:lsoa:E01000842", "uk:lsoa:E01011949"}
        london = etl_council_tax.covered_rows(rows, known, "2025-03-01", etl_council_tax.coverage.LONDON)
        england = etl_council_tax.covered_rows(rows, known, "2025-03-01", etl_council_tax.coverage.ENGLAND)
        self.assertEqual([row[0] for row in london], ["uk:lsoa:E01000842"])
        self.assertEqual([row[0] for row in england], sorted(known))


class MigrationTests(unittest.TestCase):
    def test_table_and_rebuild(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS area_council_tax_band (", MIGRATION)
        for band in "abcdefgh":
            self.assertIn(f"band_{band} integer NOT NULL", MIGRATION)
        self.assertIn("FUNCTION public.rebuild_council_tax_band(p_source_release_id text)", MIGRATION)
        self.assertIn("roll_up_area_home('area_council_tax_band'", MIGRATION)

    def test_metric_definition_and_values(self):
        self.assertIn("INSERT INTO metric_definition", MIGRATION)
        self.assertIn("'council-tax-band-mean'", MIGRATION)
        self.assertIn("percent_rank()", MIGRATION)
        self.assertIn("t.total >= 50", MIGRATION)  # fewer homes: suppressed


DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")


@unittest.skipUnless(DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a database with area_geography (063 applied)")
class RollUpPostgisTests(unittest.TestCase):
    """Runs the migration and its rebuild on one borough's real LSOAs, then rolls back: nothing persists."""

    def test_levels_agree_and_the_metric_is_written(self):
        import psycopg

        with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
            connection.execute(MIGRATION)
            connection.execute(
                "INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,"
                " transformation_version, geography_vintage, validation_status, caveats) VALUES ('test-ctsop', 'x',"
                " now(), '2025-09-25', repeat('0', 64), 'OGL-3.0', 'x', 'test', '2021', 'passed', '{}')")
            lsoas = [row[0] for row in connection.execute(
                "SELECT l.id FROM area_geography l JOIN area_geography m ON m.id = l.parent_id"
                " WHERE l.kind = 'lsoa' AND m.parent_id = 'uk:lad:E09000007' ORDER BY l.id")]
            self.assertGreater(len(lsoas), 100)
            connection.execute("DELETE FROM area_council_tax_band")
            for i, lsoa in enumerate(lsoas):
                bands = [10 * ((i + k) % 7) for k in range(8)]
                bands[7] += 500 if i == len(lsoas) - 1 else 0  # one area clearly highest
                connection.execute(
                    "INSERT INTO area_council_tax_band VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, '2025-03-01',"
                    " 'test-ctsop')", [lsoa, *bands, sum(bands)])
            connection.execute("SELECT rebuild_council_tax_band('test-ctsop')")
            levels = dict(connection.execute(
                "SELECT g.kind::text, sum(t.total) FROM area_council_tax_band t"
                " JOIN area_geography g ON g.id = t.geography_id GROUP BY g.kind"))
            borough = connection.execute(
                "SELECT band_d, total FROM area_council_tax_band WHERE geography_id = 'uk:lad:E09000007'").fetchone()
            values = connection.execute(
                "SELECT count(*), count(*) FILTER (WHERE quality = 'observed'), min(region_percentile),"
                " max(region_percentile), min(value), max(value)"
                " FROM metric_value WHERE metric_id = 'council-tax-band-mean'").fetchone()
            definition = connection.execute(
                "SELECT carrier::text, unit, definition->>'shortLabel' FROM metric_definition"
                " WHERE id = 'council-tax-band-mean'").fetchone()
            connection.rollback()
        self.assertEqual(levels["lsoa"], levels["msoa"])
        self.assertEqual(levels["lsoa"], levels["lad"])
        self.assertEqual(borough[1], levels["lsoa"])
        self.assertEqual(values[0], len(lsoas))
        self.assertEqual(values[2], 0)
        self.assertEqual(values[3], 100)
        self.assertTrue(1 <= values[4] <= values[5] <= 8)
        self.assertEqual(definition, ("lsoa", "band", "Council tax band"))


if __name__ == "__main__":
    unittest.main()
