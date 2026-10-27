"""Company and overseas ownership (migration 083, deploy/tools/etl_ownership.py): the published CCOD/OCOD
layout read without proprietors, postcodes placed in LSOAs, unplaced titles counted on their borough,
and every level summed from the LSOAs."""
import io
import os
import sys
import unittest
import unittest.mock
import zipfile
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / "tools"))
import etl_ownership  # noqa: E402

FIXTURES = DEPLOY / "tests" / "fixtures" / "ownership"
MIGRATION = (DEPLOY / "migrations" / "083-area-ownership.sql").read_text()
LOOKUP = {"NW11AA": "E01000001", "NW11AB": "E01000002", "W11AA": "E01000003"}
BOROUGHS = {"uk:lad:E09000007": "Camden", "uk:lad:E09000033": "Westminster",
            "uk:lad:E09000001": "City of London"}


def titles(name: str, cov=etl_ownership.coverage.LONDON) -> list[tuple]:
    with open(FIXTURES / name, newline="", encoding="utf-8") as handle:
        return list(etl_ownership.titles(handle, cov))


class ParseTests(unittest.TestCase):
    def test_reads_title_postcode_and_district_only(self):
        rows = titles("CCOD_FULL_2026_10.csv")
        self.assertEqual(rows[0], ("NGL100001", "NW1 1AA", "CAMDEN"))
        self.assertEqual(rows[1], ("NGL100002", "NW1 1AB", "CAMDEN"), "postcodes are normalised")
        self.assertEqual(rows[2], ("NGL100003", None, "CAMDEN"), "no postcode is kept, unplaced")
        self.assertNotIn("K100005", [row[0] for row in rows], "outside Greater London is dropped")
        england = titles("CCOD_FULL_2026_10.csv", etl_ownership.coverage.ENGLAND)
        self.assertIn("K100005", [row[0] for row in england], "England keeps every English title")
        self.assertEqual(len({row[0] for row in rows}), len(rows), "one row per title")

    def test_never_returns_proprietor_text(self):
        for name in ("CCOD_FULL_2026_10.csv", "OCOD_FULL_2026_10.csv"):
            text = repr(titles(name))
            for word in ("SYNTHETIC PROPRIETOR", "FAKE STREET", "JERSEY", "Limited Company", "450000"):
                self.assertNotIn(word, text, name)

    def test_overseas_layout_and_bad_postcodes(self):
        rows = titles("OCOD_FULL_2026_10.csv")
        self.assertEqual([row[0] for row in rows], ["NGL200001", "NGL100002", "LN200003"])
        self.assertIsNone(rows[2][1], "NOT A POSTCODE is not a postcode")

    def test_a_changed_layout_is_refused(self):
        with self.assertRaises(SystemExit):
            list(etl_ownership.titles(io.StringIO('"Title","Postcode"\n"A","NW1 1AA"\n')))

    def test_postcodes(self):
        self.assertEqual(etl_ownership.normal_postcode(" sw1a1aa "), "SW1A 1AA")
        self.assertEqual(etl_ownership.normal_postcode("EC1A 1BB"), "EC1A 1BB")
        for text in ("", "NOT A POSTCODE", "SW1A", "12345"):
            self.assertIsNone(etl_ownership.normal_postcode(text), text)

    def test_zip_members(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("CCOD_FULL_2026_10.csv", (FIXTURES / "CCOD_FULL_2026_10.csv").read_text())
        buffer.seek(0)
        with unittest.mock.patch.dict(os.environ, {"CLOSE_KNIT_ETL_COVERAGE": "london"}):
            self.assertEqual(len(list(etl_ownership.zip_titles(buffer))), 5)
        self.assertEqual(etl_ownership.file_period("CCOD_FULL_2026_10.zip"), "2026-10-01")


class TallyTests(unittest.TestCase):
    def test_lsoas_boroughs_and_unplaced(self):
        tally = etl_ownership.tally(titles("CCOD_FULL_2026_10.csv"), titles("OCOD_FULL_2026_10.csv"), LOOKUP,
                                    etl_ownership.borough_names(BOROUGHS))
        # NGL100002 is in both files: an overseas company's title, counted once.
        self.assertEqual(tally.lsoas, {"E01000001": [1, 1], "E01000002": [0, 1], "E01000003": [1, 0]})
        self.assertEqual(tally.unmatched, {"uk:lad:E09000007": 2, "uk:lad:E09000033": 1})
        self.assertEqual(tally.unplaced, 0)

    def test_district_names(self):
        names = etl_ownership.borough_names(BOROUGHS)
        self.assertEqual(names["CITY OF WESTMINSTER"], "uk:lad:E09000033")
        self.assertEqual(names["CITY OF LONDON"], "uk:lad:E09000001")
        self.assertEqual(names["CAMDEN"], "uk:lad:E09000007")


class SchemaTests(unittest.TestCase):
    def test_table_functions_and_metrics(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS area_ownership (", MIGRATION)
        for column in ("titles_company integer", "titles_overseas integer", "homes integer", "unmatched integer"):
            self.assertIn(column, MIGRATION)
        self.assertNotRegex(MIGRATION.lower(), r"proprietor\w*\s+text")
        self.assertIn("FUNCTION public.roll_up_area_ownership()", MIGRATION)
        self.assertIn("FUNCTION public.load_ownership_metrics(p_source_release_id text, p_period date)", MIGRATION)
        for metric in ("ownership-company-share", "ownership-overseas-share"):
            self.assertIn(f"'{metric}'", MIGRATION)


DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")


@unittest.skipUnless(DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a PostGIS database")
class RollUpPostgisTests(unittest.TestCase):
    """schema.sql (when missing) and 083 in one transaction that is rolled back: nothing persists."""

    def test_levels_agree_and_metrics_carry_region_percentiles(self):
        import psycopg

        square = "ST_Multi(ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326))"
        with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
            if connection.execute("SELECT to_regclass('public.area_geography') IS NULL").fetchone()[0]:
                connection.execute((DEPLOY / "schema.sql").read_text())
            connection.execute(MIGRATION)
            connection.execute(
                "INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution, "
                "transformation_version, geography_vintage, validation_status, caveats) VALUES ('src-test-own', 'x', "
                "now(), '2026-10-01', repeat('a', 64), 'x', 'x', 'x', '2021', 'passed', '{}')")
            areas = [("uk:lad:E09000007", "borough", None), ("uk:msoa:E02000001", "msoa", "uk:lad:E09000007"),
                     ("uk:lsoa:E01000001", "lsoa", "uk:msoa:E02000001"), ("uk:lsoa:E01000002", "lsoa", "uk:msoa:E02000001"),
                     ("uk:msoa:E02000002", "msoa", "uk:lad:E09000007"), ("uk:lsoa:E01000003", "lsoa", "uk:msoa:E02000002")]
            for gid, kind, parent in areas:
                connection.execute(f"INSERT INTO area_geography (id, kind, official_code, name, parent_id, geometry) "
                                   f"VALUES (%s, %s, %s, %s, %s, {square})", (gid, kind, gid[-9:], gid, parent))
            for gid, company, overseas, homes in (("uk:lsoa:E01000001", 30, 5, 600), ("uk:lsoa:E01000002", 3, 0, 500),
                                                  ("uk:lsoa:E01000003", 0, 2, 8)):
                connection.execute("INSERT INTO area_ownership (geography_id, titles_company, titles_overseas, homes, "
                                   "unmatched, source_release_id) VALUES (%s, %s, %s, %s, 0, 'src-test-own')",
                                   (gid, company, overseas, homes))
            connection.execute("INSERT INTO area_ownership VALUES ('uk:lad:E09000007', 0, 0, 0, 2, 'src-test-own')")
            connection.execute("SELECT roll_up_area_ownership()")
            unmatched = connection.execute(
                "SELECT unmatched FROM area_ownership WHERE geography_id = 'uk:lad:E09000007'").fetchone()[0]
            levels = dict(connection.execute(
                "SELECT geography_id, ARRAY[titles_company, titles_overseas, homes] FROM area_ownership "
                "WHERE geography_id NOT LIKE 'uk:lsoa:%'").fetchall())
            written = connection.execute("SELECT load_ownership_metrics('src-test-own', '2026-10-01')").fetchone()[0]
            values = {(row[0], row[1]): row[2:] for row in connection.execute(
                "SELECT geography_id, metric_id, value, region_percentile, quality::text FROM metric_value "
                "WHERE metric_id LIKE 'ownership-%'")}
            definitions = dict(connection.execute(
                "SELECT id, definition->>'label' FROM metric_definition WHERE id LIKE 'ownership-%'").fetchall())
            connection.rollback()
        self.assertEqual(levels["uk:msoa:E02000001"], [33, 5, 1100])
        self.assertEqual(levels["uk:msoa:E02000002"], [0, 2, 8])
        self.assertEqual(levels["uk:lad:E09000007"], [33, 7, 1108], "borough = sum of its LSOAs")
        self.assertEqual(unmatched, 2, "the borough keeps its unplaced titles")
        self.assertEqual(written, 6)
        self.assertEqual(values[("uk:lsoa:E01000001", "ownership-company-share")], (5.0, 100, "observed"))
        self.assertEqual(values[("uk:lsoa:E01000002", "ownership-company-share")], (0.6, 0, "observed"))
        self.assertEqual(values[("uk:lsoa:E01000003", "ownership-overseas-share")], (None, None, "suppressed"),
                         "under 10 homes: no share")
        self.assertEqual(set(definitions), {"ownership-company-share", "ownership-overseas-share"})


if __name__ == "__main__":
    unittest.main()
