"""HMO and landlord licensing (migration 087, deploy/tools/etl_hmo.py): registers read as published in
every format, only property postcodes kept and counted, one config per London authority, schemes mapped
to ward codes, and the levels rolled up from LSOAs."""
import io
import os
import sys
import tempfile
import unittest
import zipfile
from collections import Counter
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / "tools"))
import etl_hmo  # noqa: E402

FIXTURES = DEPLOY / "tests" / "fixtures" / "hmo"
MIGRATION = (DEPLOY / "migrations" / "087-hmo-licensing.sql").read_text()
DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")


def xlsx(rows: list[list[str]], sheet: str = "Register") -> bytes:
    """A minimal workbook: shared strings for text, one named sheet."""
    strings: list[str] = []
    cells = []
    for r, row in enumerate(rows, start=1):
        out = []
        for c, value in enumerate(row):
            ref = f"{'ABCDEFGH'[c]}{r}"
            if value == "":
                continue
            strings.append(value)
            out.append(f'<c r="{ref}" t="s"><v>{len(strings) - 1}</v></c>')
        cells.append(f'<row r="{r}">{"".join(out)}</row>')
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as book:
        book.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                      f'<sheet name="Cover" sheetId="1" r:id="rId1"/><sheet name="{sheet}" sheetId="2" r:id="rId2"/>'
                      '</sheets></workbook>')
        book.writestr("xl/_rels/workbook.xml.rels",
                      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                      '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
                      '<Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>')
        book.writestr("xl/sharedStrings.xml", '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                      + "".join(f"<si><t>{s}</t></si>" for s in strings) + "</sst>")
        book.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/'
                      '2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>About</t></is></c></row>'
                      '</sheetData></worksheet>')
        book.writestr("xl/worksheets/sheet2.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/'
                      f'2006/main"><sheetData>{"".join(cells)}</sheetData></worksheet>')
    return buffer.getvalue()


class PostcodeTests(unittest.TestCase):
    def test_normalise_and_find(self):
        self.assertEqual(etl_hmo.normalise_postcode("sw1a1aa"), "SW1A 1AA")
        self.assertEqual(etl_hmo.normalise_postcode(" n1  2ab "), "N1 2AB")
        self.assertIsNone(etl_hmo.normalise_postcode("N1"))
        self.assertEqual(etl_hmo.find_postcode("Flat 2, 3 Sample Street, LONDON n12ab"), "N1 2AB")
        # The last postcode in a cell is the address's own; a licence number is never one.
        self.assertEqual(etl_hmo.find_postcode("HMO/0001 12 Fake Road, London SE15 4AA"), "SE15 4AA")
        self.assertIsNone(etl_hmo.find_postcode("Address withheld"))
        # Glued to the town: the borough's own postcode wins.
        self.assertEqual(etl_hmo.find_postcode("1 High StreetKingstonKT1 3DA"), "KT1 3DA")
        self.assertEqual(etl_hmo.count([etl_hmo.find_postcode("2 Road LondonN1 2AB")], {"N1 2AB"})[0], Counter({"N1 2AB": 1}))


class FormatTests(unittest.TestCase):
    config = {"register": {"postcode_column": "Property Address"}}

    def test_csv_skips_preamble_and_reads_only_the_property_column(self):
        found = list(etl_hmo.register_postcodes(str(FIXTURES / "register.csv"), "csv", self.config["register"]))
        self.assertEqual(found, ["N1 2AB", "N1 2AB", "N7 9ZZ", None])

    def test_xlsx_named_sheet(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "r.xlsx")
            with open(path, "wb") as handle:
                handle.write(xlsx([["Register of HMOs"], ["Licence", "HMO Postcode", "Holder"],
                                   ["1", "E1 6AN", "x"], ["2", "e16an", ""], ["3", "", ""]]))
            found = list(etl_hmo.register_postcodes(path, "xlsx", {"postcode_column": "hmo postcode",
                                                                   "sheet": "Register"}))
            both = list(etl_hmo.register_postcodes(path, "xlsx", {"postcode_column": "hmo postcode",
                                                                  "sheet": ["Register", "register"]}))
        self.assertEqual(both, found * 2)
        self.assertEqual(found, ["E1 6AN", "E1 6AN", None])

    def test_html_table(self):
        found = list(etl_hmo.register_postcodes(str(FIXTURES / "register.html"), "html", {"postcode_column": "Postcode"}))
        self.assertEqual(found, ["E8 1AA", "E8 1AA", None])
        only = list(etl_hmo.register_postcodes(str(FIXTURES / "register.html"), "html",
                                               {"postcode_column": "Postcode", "include": "^A2 "}))
        self.assertEqual(only, ["E8 1AA"])

    def test_pdf_text_one_licence_per_record(self):
        text = (FIXTURES / "register-pdf.txt").read_text()
        found = list(etl_hmo.text_postcodes(text, {"record_start": r"^HMO/\d+"}))
        self.assertEqual(found, ["SE15 4AA", "SE15 4AB", "SE15 4AA"])
        # Only HMO licences when the register also lists selective ones.
        self.assertEqual(list(etl_hmo.text_postcodes(text, {"record_start": r"^HMO/\d+", "include": "Storeys|6$"})),
                         ["SE15 4AB"])
        # The holder's address first: the property is the last postcode of the record's first line.
        rows = "00001  1 Holder Road, LS1 1AA   9 Home Street UB3 5EA  Hayes\n       wrapped holder N14 6BN\n"
        self.assertEqual(list(etl_hmo.text_postcodes(rows, {"record_start": r"^\d{5}", "pick": "last",
                                                            "record_lines": 1})), ["UB3 5EA"])
        # Without a record pattern every postcode in the text is one licence.
        self.assertEqual(list(etl_hmo.text_postcodes(text, {})), ["SE15 4AA", "SE15 4AB", "SE15 4AA"])

    def test_counts_keep_the_borough_and_never_more(self):
        counts, unmatched = etl_hmo.count(["N1 2AB", "N1 2AB", "N7 9ZZ", None, "LS1 1AA"], {"N1 2AB", "N7 9ZZ"})
        self.assertEqual(counts, Counter({"N1 2AB": 2, "N7 9ZZ": 1}))
        self.assertEqual(unmatched, 2)


class ConfigTests(unittest.TestCase):
    def test_every_london_authority_has_one_config(self):
        configs = etl_hmo.configs()
        self.assertEqual(len(configs), 33)
        self.assertEqual(sorted(c["code"] for c in configs), [f"E09{n:06d}" for n in range(1, 34)])
        for config in configs:
            register = config["register"]
            self.assertIn(register["status"], etl_hmo.STATUSES, config["slug"])
            self.assertTrue(register.get("url") or register.get("page") or register["status"] == "not-found",
                            config["slug"])
            if register["status"] == "published":
                self.assertIn(register["format"], etl_hmo.FORMATS, config["slug"])
            for scheme in config.get("schemes") or []:
                self.assertIn(scheme["kind"], ("additional", "selective"), config["slug"])
                self.assertTrue(scheme.get("wards") == "all" or isinstance(scheme.get("wards") or scheme.get("streets"), list),
                                config["slug"])
                self.assertTrue(scheme["url"].startswith("http"), config["slug"])

    def test_configs_hold_no_personal_data_fields(self):
        for config in etl_hmo.configs():
            keys = set(config) | set(config["register"])
            self.assertFalse(keys & {"names", "holders", "addresses"}, config["slug"])


class SchemeTests(unittest.TestCase):
    wards = {"E05000001": "Highbury", "E05000002": "St Mary's & St James'", "E05000003": "Finsbury Park"}

    def test_ward_names_map_to_codes(self):
        config = {"code": "E09000019", "slug": "islington", "schemes": [
            {"kind": "selective", "wards": ["Highbury", "St Marys and St James", "Nowhere"], "start": "2023-03-01",
             "end": "2028-02-28", "url": "https://example.org/s"},
            {"kind": "additional", "wards": "all", "start": "2021-02-01", "end": None, "url": "https://example.org/a"}]}
        rows, unmatched = etl_hmo.scheme_rows(config, self.wards)
        self.assertEqual(rows[0][:4], ["E09000019:selective:1", "E09000019", "selective", ["E05000001", "E05000002"]])
        self.assertEqual(rows[0][4], ["Highbury", "St Marys and St James", "Nowhere"])
        self.assertEqual(rows[1][3], None)  # whole borough
        self.assertEqual(unmatched, ["islington: Nowhere"])
        streets, missing = etl_hmo.scheme_rows({**config, "schemes": [
            {"kind": "selective", "streets": ["Askew Road"], "start": "2022-06-05", "end": "2099-01-01",
             "url": "https://example.org/st"}]}, self.wards)
        self.assertEqual(streets[0][3:6], [[], None, ["Askew Road"]])
        self.assertEqual(missing, [])
        renamed, missing = etl_hmo.scheme_rows({**config, "ward_aliases": {"Old Ward": ["Highbury", "Finsbury Park"]},
                                                "schemes": [{"kind": "selective", "wards": ["Old Ward", "St Marys St James"],
                                                             "start": None, "end": None, "url": "https://x"}]}, self.wards)
        self.assertEqual(renamed[0][3], ["E05000001", "E05000003", "E05000002"])
        self.assertEqual(missing, [])

    def test_expired_schemes_are_dropped(self):
        config = {"code": "E09000019", "slug": "islington", "schemes": [
            {"kind": "selective", "wards": "all", "start": "2015-01-01", "end": "2020-01-01", "url": "https://x"}]}
        self.assertEqual(etl_hmo.scheme_rows(config, self.wards, today="2026-10-18")[0], [])


class MetricTests(unittest.TestCase):
    def test_legend_and_definition(self):
        stops = etl_hmo.legend([0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 10.0, 20.0, 40.0, 80.0])
        self.assertEqual(len(stops), 5)
        self.assertEqual([s["colour"] for s in stops], list(etl_hmo.COLOURS))
        definition = etl_hmo.definition([1.0, 2.0], "2026-10")
        self.assertEqual(definition["shortLabel"], "HMOs")
        self.assertIn("not published", " ".join(definition["caveats"]))


class SchemaTests(unittest.TestCase):
    def test_tables_and_functions(self):
        for table in ("hmo_register", "hmo_postcode", "area_hmo", "licensing_scheme"):
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table} (", MIGRATION)
        self.assertIn("FUNCTION public.rebuild_area_hmo(p_source text)", MIGRATION)
        self.assertIn("FUNCTION public.load_hmo_metric(p_source text, p_period date, p_definition jsonb)", MIGRATION)
        for word in ("holder", "licensee", "address text", "name text"):
            self.assertNotIn(word, MIGRATION.split("-- Counts by postcode")[1].lower().replace("licence holders", ""))


@unittest.skipUnless(DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a loaded PostGIS database")
class RollUpPostgisTests(unittest.TestCase):
    """Runs the migration and both functions in one transaction that is rolled back: nothing persists."""

    def test_levels_agree_and_unpublished_boroughs_are_grey(self):
        import psycopg

        with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
            connection.execute(MIGRATION)
            connection.execute(
                "INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,"
                " transformation_version, geography_vintage, validation_status, caveats) VALUES ('src-hmo-test',"
                " 'https://example.org', now(), '2026-10-18', repeat('0', 64), 'OGL', 'x', 'x', '2021', 'passed', '{}')")
            camden = "E09000007"
            connection.execute("INSERT INTO hmo_register (borough_code, status, source_release_id) "
                               "VALUES (%s, 'published', 'src-hmo-test')", (camden,))
            postcodes = [row[0] for row in connection.execute(
                "SELECT postcode FROM postcode_civic WHERE borough_code = %s AND terminated IS NULL "
                "ORDER BY postcode LIMIT 40", (camden,))]
            for postcode in postcodes:
                connection.execute("INSERT INTO hmo_postcode VALUES (%s, %s, 2, 'src-hmo-test')", (camden, postcode))
            connection.execute("SELECT rebuild_area_hmo('src-hmo-test')")
            sums = connection.execute(
                "SELECT g.kind::text, sum(a.licensed_hmos), sum(a.homes) FROM area_hmo a "
                "JOIN area_geography g ON g.id = a.geography_id GROUP BY 1 ORDER BY 1").fetchall()
            self.assertEqual(len({(total, homes) for _, total, homes in sums}), 1, sums)
            self.assertEqual(sums[0][1], 80)
            self.assertEqual([kind for kind, *_ in sums], ["lad", "lsoa", "msoa"])
            connection.execute("SELECT load_hmo_metric('src-hmo-test', '2026-10-01', '{}'::jsonb)")
            quality = dict(connection.execute(
                "SELECT quality::text, count(*) FROM metric_value WHERE metric_id = 'hmo-per-1000' GROUP BY 1"))
            self.assertGreater(quality["suppressed"], quality["observed"])
            self.assertEqual(connection.execute(
                "SELECT count(*) FROM metric_value WHERE metric_id = 'hmo-per-1000' AND quality = 'suppressed' "
                "AND value IS NOT NULL").fetchone()[0], 0)
            connection.rollback()


if __name__ == "__main__":
    unittest.main()
