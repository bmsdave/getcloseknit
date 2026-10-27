"""Private rents by borough (stream G2): workbook reading and the latest-month rule."""

import os
import tempfile
import unittest
import zipfile
from decimal import Decimal

from area_analytics import coverage, rents

HEADER = ["Time period", "Area code", "Area name", "Region or country name", "Index", "Monthly change",
          "Annual change", "Rental price", "Index one bed", "Monthly change one bed", "Annual change one bed",
          "Rental price one bed", "Index two bed", "Monthly change two bed", "Annual change two bed",
          "Rental price two bed"]


def row(period, code, name, rent, one, two, change="3.521148"):
    return [period, code, name, "London", "100", "0.1", change, rent, "100", "0.1", "2.5", one,
            "100", "0.1", "[x]", two]


class RentRowsTests(unittest.TestCase):
    WORKBOOK = [
        ["Price Index of Private Rents"], HEADER,
        row("46204", "E09000007", "Camden", "2900", "2300", "3100"),       # 2026-07
        row("46235", "E09000007", "Camden", "2950", "2350", "3150"),       # 2026-08
        row("46235", "E12000007", "London", "2332", "1760", "2232"),
        row("46235", "E06000001", "Hartlepool", "650", "500", "600"),
        row("46235", "E12000001", "North East", "700", "550", "650"),
        row("46235", "W06000015", "Cardiff", "1100", "900", "1000"),        # Wales: never
    ]

    def test_england_keeps_every_english_lad_and_region(self):
        rows = rents.rent_rows(self.WORKBOOK, coverage.ENGLAND)
        self.assertEqual({r["area_code"] for r in rows}, {"E09000007", "E12000007", "E06000001", "E12000001"})

    def test_keeps_the_latest_month_for_london_boroughs_and_london(self):
        rows = rents.rent_rows(self.WORKBOOK, coverage.LONDON)
        self.assertEqual({r["period"] for r in rows}, {"2026-08-01"})
        self.assertEqual({r["area_code"] for r in rows}, {"E09000007", "E12000007"})
        camden = {r["bedrooms"]: r for r in rows if r["area_code"] == "E09000007"}
        self.assertEqual(camden["all"]["monthly_rent"], 2950)
        self.assertEqual(camden["all"]["annual_change_pct"], Decimal("3.52"))
        self.assertEqual(camden["1 bedroom"]["monthly_rent"], 2350)
        self.assertEqual(camden["2 bedrooms"]["monthly_rent"], 3150)
        self.assertIsNone(camden["2 bedrooms"]["annual_change_pct"])  # "[x]" stays unknown

    def test_suppressed_or_absurd_rents_are_skipped_not_zeroed(self):
        rows = rents.rent_rows([HEADER, row("46235", "E09000002", "Barking", "[x]", "0", "250000"),
                                row("46235", "E09000003", "Barnet", "1949", "1500", "1858")])
        self.assertEqual({r["area_code"] for r in rows}, {"E09000003"})
        self.assertEqual(len(rows), 3)

    def test_a_workbook_without_london_is_an_error(self):
        with self.assertRaises(ValueError):
            rents.rent_rows([HEADER, row("46235", "E06000001", "Hartlepool", "650", "500", "600")],
                            coverage.LONDON)

    def test_month_reads_excel_serials_and_iso_dates(self):
        self.assertEqual(rents.month("46235"), "2026-08-01")
        self.assertEqual(rents.month("2026-08-01T00:00:00"), "2026-08-01")
        self.assertIsNone(rents.month("August"))

    def test_source_release_names_licence_period_and_caveats(self):
        source = rents.source_release({"sha256": "a" * 64, "period": "2026-08-01"})
        self.assertEqual(source[0], rents.source_id())
        self.assertEqual(rents.source_id(coverage.LONDON), rents.PIPR_SOURCE)  # London keeps its id
        self.assertEqual(rents.source_id(coverage.ENGLAND), rents.PIPR_SOURCE + "-england")
        self.assertEqual(source[4], "OGL-3.0")
        self.assertIn("2026-08", source[6][0])


def _xlsx(path, rows):
    strings = sorted({cell for cells in rows for cell in cells if not cell.replace(".", "").isdigit()})
    index = {text: i for i, text in enumerate(strings)}

    def cell(ref, text):
        if text in index:
            return f'<c r="{ref}" t="s"><v>{index[text]}</v></c>'
        return f'<c r="{ref}"><v>{text}</v></c>'

    body = "".join(
        f'<row r="{r + 1}">' + "".join(cell(f"{chr(65 + c)}{r + 1}", text) for c, text in enumerate(cells) if text)
        + "</row>" for r, cells in enumerate(rows))
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("xl/workbook.xml", (
            f'<workbook {ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Cover" sheetId="1" r:id="rId1"/><sheet name="Table 1" sheetId="2" r:id="rId2"/>'
            "</sheets></workbook>"))
        archive.writestr("xl/_rels/workbook.xml.rels", (
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>'))
        archive.writestr("xl/sharedStrings.xml", f"<sst {ns}>" + "".join(
            f"<si><t>{text}</t></si>" for text in strings) + "</sst>")
        archive.writestr("xl/worksheets/sheet1.xml", f"<worksheet {ns}><sheetData/></worksheet>")
        archive.writestr("xl/worksheets/sheet2.xml", f"<worksheet {ns}><sheetData>{body}</sheetData></worksheet>")


class XlsxTests(unittest.TestCase):
    def test_reads_the_named_sheet_with_shared_strings_and_gaps(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "pipr.xlsx")
            _xlsx(path, [["Title"], ["Time period", "", "Area code"], ["46235", "", "E09000007"]])
            rows = list(rents.xlsx_rows(path, "Table 1"))
        self.assertEqual(rows, [["Title"], ["Time period", "", "Area code"], ["46235", "", "E09000007"]])

    def test_unknown_sheet_is_an_error(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "pipr.xlsx")
            _xlsx(path, [["Title"]])
            with self.assertRaises(ValueError):
                list(rents.xlsx_rows(path, "Table 9"))


if __name__ == "__main__":
    unittest.main()
