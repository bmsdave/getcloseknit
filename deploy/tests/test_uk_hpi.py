"""UK House Price Index (migration 080, deploy/tools/etl_uk_hpi.py): the full file read as published,
London boroughs and London only, and the map layers agreeing at every level."""
import os
import sys
import unittest
from datetime import date
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / "tools"))
import etl_uk_hpi  # noqa: E402

FIXTURE = DEPLOY / "tests" / "fixtures" / "uk-hpi-sample.csv"
MIGRATION = (DEPLOY / "migrations" / "080-uk-hpi.sql").read_text()
DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")


class ParserTests(unittest.TestCase):
    def setUp(self):
        self.rows = etl_uk_hpi.parse_csv(str(FIXTURE))

    def test_london_boroughs_and_london_only(self):
        rows = etl_uk_hpi.parse_csv(str(FIXTURE), etl_uk_hpi.coverage.LONDON)
        self.assertEqual({row[0] for row in rows}, {"E09000007", "E09000019", "E12000007"})

    def test_england_keeps_every_english_lad(self):
        rows = etl_uk_hpi.parse_csv(str(FIXTURE), etl_uk_hpi.coverage.ENGLAND)
        self.assertEqual({row[0] for row in rows}, {"E09000007", "E09000019", "E12000007", "E07000223"})

    def test_one_row_per_type_with_price_and_index(self):
        camden = {row[2]: row for row in self.rows if row[0] == "E09000007" and row[1] == date(2026, 7, 1)}
        self.assertEqual(sorted(camden), ["all", "detached", "flat", "semi", "terraced"])
        self.assertEqual(camden["all"][3:], (815159, 94.7))
        self.assertEqual(camden["flat"][1], date(2026, 7, 1))

    def test_dates_are_day_first(self):
        self.assertEqual(min(row[1] for row in self.rows), date(1995, 1, 1))
        self.assertIn(date(2026, 6, 1), {row[1] for row in self.rows})

    def test_empty_type_cells_are_skipped(self):
        self.assertTrue(all(row[3] is not None and row[4] is not None for row in self.rows))

    def test_latest_month(self):
        self.assertEqual(etl_uk_hpi.latest_month(self.rows), date(2026, 7, 1))


class ChangeTests(unittest.TestCase):
    def test_change_over_years_from_the_index(self):
        series = {date(2016, 7, 1): 86.7, date(2021, 7, 1): 99.9, date(2025, 7, 1): 105.3, date(2026, 7, 1): 94.7}
        self.assertEqual(etl_uk_hpi.change_pct(series, date(2026, 7, 1), 1), -10.1)
        self.assertEqual(etl_uk_hpi.change_pct(series, date(2026, 7, 1), 5), -5.2)
        self.assertEqual(etl_uk_hpi.change_pct(series, date(2026, 7, 1), 10), 9.2)
        self.assertIsNone(etl_uk_hpi.change_pct(series, date(2026, 7, 1), 20))

    def test_download_url_names_the_month(self):
        self.assertEqual(etl_uk_hpi.file_url(date(2026, 7, 1)),
                         "https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data/"
                         "UK-HPI-full-file-2026-07.csv")


class SchemaTests(unittest.TestCase):
    def test_table_and_layer_function(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS borough_hpi (", MIGRATION)
        self.assertIn("FUNCTION public.rebuild_hpi_layers(p_source_release_id text)", MIGRATION)
        for layer in ("hpi-change-5y", "hpi-change-10y"):
            self.assertIn(f"'{layer}'", MIGRATION)


SEED = """
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TYPE geography_kind AS ENUM ('lsoa', 'msoa', 'borough');
CREATE TYPE metric_quality AS ENUM ('observed', 'fallback', 'suppressed');
CREATE TABLE source_release (id text PRIMARY KEY);
CREATE TABLE area_geography (id text PRIMARY KEY, kind geography_kind NOT NULL, parent_id text);
CREATE TABLE metric_definition (id text PRIMARY KEY, carrier geography_kind NOT NULL, unit text NOT NULL,
    direction text NOT NULL, definition jsonb NOT NULL, source_release_id text NOT NULL);
CREATE TABLE metric_value (geography_id text NOT NULL, metric_id text NOT NULL, period date NOT NULL,
    value double precision, region_percentile smallint, country_percentile smallint, sample_count integer,
    quality metric_quality NOT NULL, source_release_id text NOT NULL, PRIMARY KEY (geography_id, metric_id, period));
INSERT INTO source_release VALUES ('src-test');
INSERT INTO area_geography VALUES
  ('uk:lad:E09000007', 'borough', NULL), ('uk:lad:E09000019', 'borough', NULL),
  ('uk:msoa:E02000001', 'msoa', 'uk:lad:E09000007'), ('uk:msoa:E02000002', 'msoa', 'uk:lad:E09000019'),
  ('uk:lsoa:E01000001', 'lsoa', 'uk:msoa:E02000001'), ('uk:lsoa:E01000002', 'lsoa', 'uk:msoa:E02000001'),
  ('uk:lsoa:E01000003', 'lsoa', 'uk:msoa:E02000002');
"""


@unittest.skipUnless(DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a PostGIS database")
class RollUpTests(unittest.TestCase):
    def test_every_level_reads_its_borough_and_region_percentiles_rank_boroughs(self):
        import psycopg

        with psycopg.connect(DATABASE_URL, autocommit=False) as conn, conn.cursor() as cur:
            cur.execute("CREATE SCHEMA hpi_test; SET search_path = hpi_test, public;")
            cur.execute(SEED)
            cur.execute(MIGRATION.replace("public.", "hpi_test."))
            rows = [row + ("src-test",) for row in etl_uk_hpi.parse_csv(str(FIXTURE))]
            with cur.copy("COPY borough_hpi (borough, month, property_type, average_price, index, "
                          "source_release_id) FROM STDIN") as copy:
                for row in rows:
                    copy.write_row(row)
            self.assertEqual(cur.execute("SELECT rebuild_hpi_layers('src-test')").fetchone()[0], 14)
            values = {(g, m): (v, p, q) for g, m, v, p, q in cur.execute(
                "SELECT geography_id, metric_id, value, region_percentile, quality::text FROM metric_value")}
            # Camden 94.7 / 99.9 (Jul 2021), Islington 100 / 97.7: Camden fell, Islington rose.
            self.assertEqual(values[("uk:lad:E09000007", "hpi-change-5y")], (-5.2, 0, "observed"))
            self.assertEqual(values[("uk:lad:E09000019", "hpi-change-5y")], (2.4, 100, "observed"))
            for lsoa in ("uk:lsoa:E01000001", "uk:lsoa:E01000002"):
                self.assertEqual(values[(lsoa, "hpi-change-5y")], (-5.2, 0, "fallback"))
            self.assertEqual(values[("uk:msoa:E02000002", "hpi-change-10y")][:2],
                             values[("uk:lad:E09000019", "hpi-change-10y")][:2])
            carrier, unit, label = cur.execute(
                "SELECT carrier::text, unit, definition->>'label' FROM metric_definition WHERE id = 'hpi-change-10y'"
            ).fetchone()
            self.assertEqual((carrier, unit, label), ("lsoa", "%", "Price change over 10 years"))
            conn.rollback()


if __name__ == "__main__":
    unittest.main()
