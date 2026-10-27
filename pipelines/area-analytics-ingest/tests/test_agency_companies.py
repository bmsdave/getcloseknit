"""Companies House firms: row filtering, header cleaning, COPY line and source release."""

import inspect
import io
import os
import tempfile
import unittest
import zipfile
from unittest import mock

from area_analytics import agency_companies

ROW = {"CompanyName": "ELM ESTATES LTD", " CompanyNumber": "01234567", "CompanyStatus": "Active",
       "RegAddress.PostCode": "w13 9ab", "IncorporationDate": "05/03/2011",
       "SICCode.SicText_1": "68310 - Real estate agencies", "SICCode.SicText_2": "", "SICCode.SicText_3": "",
       "SICCode.SicText_4": "", "Officer": "never read"}
LONDON = {"W13 9AB"}


def strip(record):
    return agency_companies.normalise_header(record)


class CompanyRowTests(unittest.TestCase):
    def test_keeps_active_london_agencies(self):
        row = agency_companies.company_row(strip(ROW), LONDON)
        self.assertEqual(row, {"company_number": "01234567", "name": "ELM ESTATES LTD", "sic_codes": '{"68310"}',
                               "registered_postcode": "W13 9AB", "incorporated": "2011-03-05"})

    def test_drops_other_sic_dissolved_and_outside_london(self):
        other_sic = {**ROW, "SICCode.SicText_1": "70100 - Activities of head offices"}
        dissolved = {**ROW, "CompanyStatus": "Dissolved"}
        outside = {**ROW, "RegAddress.PostCode": "M1 1AA"}
        for record in (other_sic, dissolved, outside):
            self.assertIsNone(agency_companies.company_row(strip(record), LONDON))

    def test_letting_management_code_counts(self):
        record = {**ROW, "SICCode.SicText_1": "70100 - Head offices",
                  "SICCode.SicText_2": "68320 - Management of real estate on a fee or contract basis"}
        row = agency_companies.company_row(strip(record), LONDON)
        self.assertEqual(row["sic_codes"], '{"70100","68320"}')

    def test_both_codes_listed_once_each(self):
        record = {**ROW, "SICCode.SicText_2": "68320 - Management of real estate"}
        self.assertEqual(agency_companies.company_row(strip(record), LONDON)["sic_codes"], '{"68310","68320"}')

    def test_header_with_leading_space_is_read(self):
        self.assertEqual(strip(ROW)["CompanyNumber"], "01234567")
        self.assertNotIn(" CompanyNumber", strip(ROW))

    def test_postcode_without_space_is_normalised(self):
        row = agency_companies.company_row(strip({**ROW, "RegAddress.PostCode": " w139ab "}), LONDON)
        self.assertEqual(row["registered_postcode"], "W13 9AB")

    def test_bad_date_and_missing_number(self):
        row = agency_companies.company_row(strip({**ROW, "IncorporationDate": "n/a"}), LONDON)
        self.assertIsNone(row["incorporated"])
        self.assertIsNone(agency_companies.company_row(strip({**ROW, " CompanyNumber": " "}), LONDON))


class OutputTests(unittest.TestCase):
    def test_tsv_line_escapes_and_orders_columns(self):
        row = agency_companies.company_row(strip({**ROW, "CompanyName": "A\tB\\C"}), LONDON)
        fields = agency_companies.tsv_line(row).split("\t")
        self.assertEqual(len(fields), len(agency_companies.COLUMNS))
        self.assertEqual(fields[1], "A\\tB\\\\C")
        self.assertEqual(fields[0], "01234567")

    def test_tsv_line_empty_is_null(self):
        row = agency_companies.company_row(strip({**ROW, "IncorporationDate": ""}), LONDON)
        self.assertEqual(agency_companies.tsv_line(row).split("\t")[-1], "")

    def test_source_release_tuple(self):
        sources = {"month": "2026-10-01", "sha256": "ab" * 32, "retrieved": "2026-10-13"}
        source_id, url, released, sha, licence, attribution, caveats = agency_companies.source_release(sources)
        self.assertEqual(source_id, "src-companies-house-basic-2026-10-01")
        self.assertEqual(url, "https://download.companieshouse.gov.uk/BasicCompanyDataAsOneFile-2026-10-01.zip")
        self.assertEqual((released, sha, licence), ("2026-10-01", "ab" * 32, "OGL-UK-3.0"))
        self.assertEqual(attribution,
                         "Contains public sector information licensed under the Open Government Licence v3.0.")
        self.assertTrue(any("accountant" in c for c in caveats))
        self.assertTrue(any("self-declared" in c for c in caveats))


HEADER = "CompanyName, CompanyNumber,CompanyStatus,RegAddress.PostCode,IncorporationDate,SICCode.SicText_1"
CSV_LINE = '"ELM, ESTATES LTD",01234567,Active,W13 9AB,05/03/2011,68310 - Real estate agencies\n'


def zipped(text: str, bom: bool = False) -> io.BytesIO:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr("BasicCompanyDataAsOneFile-2026-10-01.csv", ("\ufeff" if bom else "") + text)
    return buffer


class ReaderTests(unittest.TestCase):
    def test_bom_on_first_header_still_yields_the_row(self):
        archive = zipped(HEADER + "\n" + CSV_LINE, bom=True)
        records = list(agency_companies.csv_records(archive))
        self.assertIn("CompanyName", records[0])
        out = io.StringIO()
        self.assertEqual(agency_companies.write_agencies(archive, LONDON, out), (1, 1))
        self.assertTrue(out.getvalue().startswith("01234567\tELM, ESTATES LTD\t"))

    def test_build_exits_when_nothing_is_kept(self):
        with tempfile.TemporaryDirectory() as raw, tempfile.TemporaryDirectory() as work:
            name = os.path.join(raw, "BasicCompanyDataAsOneFile-2026-10-01.zip")
            with open(name, "wb") as handle:
                handle.write(zipped(HEADER + "\n" + CSV_LINE).getvalue())
            with mock.patch.object(agency_companies, "RAW", raw), mock.patch.object(agency_companies, "WORK", work), \
                    mock.patch.object(agency_companies, "london_postcodes", return_value={"E1 1AA"}):
                with self.assertRaises(SystemExit) as caught:
                    agency_companies.build("postgresql://unused")
            self.assertIn("0 agencies", str(caught.exception))
            self.assertFalse(os.path.exists(os.path.join(work, "sources.json")))


class LoadSqlTests(unittest.TestCase):
    def test_company_rows_are_upserted_by_number(self):
        sql = " ".join(agency_companies.UPSERT_SQL.split())
        self.assertIn("ON CONFLICT (company_number) DO UPDATE SET", sql)
        for column in ("name", "sic_codes", "registered_postcode", "incorporated", "source_release_id"):
            self.assertIn(f"{column} = EXCLUDED.{column}", sql)

    def test_vanished_companies_lose_site_rows_before_company_rows(self):
        self.assertIn("agency_site_company", agency_companies.DELETE_SITES_SQL)
        self.assertIn("NOT IN (SELECT company_number FROM staging_agency_company)",
                      " ".join(agency_companies.DELETE_COMPANIES_SQL.split()))
        body = inspect.getsource(agency_companies.load)
        self.assertLess(body.index("DELETE_SITES_SQL"), body.index("DELETE_COMPANIES_SQL"))
        self.assertLess(body.index("UPSERT_SQL"), body.index("DELETE_SITES_SQL"))


class CoverageReportTests(unittest.TestCase):
    COUNTS = {"offices": 2900, "offices_with_website": 1189, "offices_by_source": {"osm": 1500, "overture": 1300, "website": 100},
              "companies": 8000, "companies_verified_site": 2400, "companies_with_office": 960,
              "verified_domains": 1800, "website_offices": 100, "google_ids": 2465, "twin_mismatches": 0}

    def test_coverage_report_lines(self):
        lines = agency_companies.coverage_report(self.COUNTS)
        for expected in ("offices 2900 (website 41%)", "companies 8000: verified site 30%, office 12%",
                         "google ids 85%", "domain twin mismatches 0",
                         "offices by first source: osm 1500, overture 1300, website 100",
                         "sites: verified domains 1800, website offices 100"):
            self.assertIn(expected, lines)

    def test_empty_database_does_not_divide_by_zero(self):
        counts = {"offices": 0, "offices_with_website": 0, "offices_by_source": {}, "companies": 0,
                  "companies_verified_site": 0, "companies_with_office": 0, "verified_domains": 0,
                  "website_offices": 0, "google_ids": 0, "twin_mismatches": 0}
        lines = agency_companies.coverage_report(counts)
        self.assertIn("offices 0 (website 0%)", lines)
        self.assertIn("google ids 0%", lines)

    def test_domain_twin_mismatches_compare_sql_domain_with_python(self):
        pairs = [("https://www.Elm.co.uk/contact", "elm.co.uk"), ("elm.co.uk", "elm.co.uk"),
                 ("http://oak.com:8080/", "oak.com"), ("mailto:a@b.co", None), ("https://oak.com/", "oak.org")]
        self.assertEqual(1, agency_companies.domain_twin_mismatches(pairs))

    def test_twin_mismatch_rows_name_website_sql_and_python_domains(self):
        pairs = [("https://oak.com/", "oak.org"), ("a.co.uk;b.co.uk", "a.co.uk"), ("a.co.uk;b.co.uk", "a.co.uk;b.co.uk")]
        self.assertEqual(agency_companies.twin_mismatches(pairs),
                         [("https://oak.com/", "oak.org", "oak.com"), ("a.co.uk;b.co.uk", "a.co.uk;b.co.uk", "a.co.uk")])

    def test_check_prints_at_most_twenty_mismatch_rows_then_exits_1(self):
        pairs = [(f"https://oak{i}.com/", "oak.org") for i in range(25)]

        class Conn:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql):
                result = mock.Mock()
                result.fetchone.return_value = (0,)
                result.fetchall.return_value = pairs if sql == agency_companies.TWIN_SQL else []
                return result

        fake_psycopg = mock.Mock(connect=lambda url: Conn())
        out = io.StringIO()
        with mock.patch.dict("sys.modules", {"psycopg": fake_psycopg}), mock.patch("sys.stdout", out):
            with self.assertRaises(SystemExit) as stop:
                agency_companies.check("postgresql://x")
        self.assertEqual(stop.exception.code, 1)
        printed = out.getvalue()
        self.assertIn("domain twin mismatches 25", printed)
        self.assertEqual(printed.count("mismatch: website"), 20)
        self.assertIn("mismatch: website 'https://oak0.com/' sql 'oak.org' python 'oak0.com'", printed)

    def test_verify_summary_lists_robots_refusals_and_ends_with_counts(self):
        counts = {"verified": 1, "none": 2, "blocked": 0, "robots": 2, "dead": 3, "opted_out": 0}
        lines = agency_companies.verify_summary(8, 8, counts, ["b.co.uk", "a.co.uk"])
        self.assertEqual(lines, ["verify: robots.txt refuses CloseKnitBot on: a.co.uk, b.co.uk",
                                 "verify: 8 domains: 1 verified / 2 no number / 0 blocked / 2 refused by robots.txt / "
                                 "3 dead / 0 opted out"])
        self.assertTrue(agency_companies.verify_summary(3, 8, counts, [])[-1].startswith(
            "verify: stopped after 3 of 8 domains: "))


if __name__ == "__main__":
    unittest.main()
