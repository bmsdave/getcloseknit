"""Home theme (migration 063, deploy/tools/etl_home.py): every level from the LSOAs, land never
counted twice, householder Article 4 only, and the source files read as published."""
import io
import sys
import unittest
import zipfile
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / "tools"))
import area_coverage as coverage  # noqa: E402
import etl_home  # noqa: E402

MIGRATION = (DEPLOY / "migrations" / "063-area-home.sql").read_text()


class SchemaTests(unittest.TestCase):
    def test_tables_and_functions(self):
        for table in ("article4_area", "article4_coverage", "listed_building", "area_restriction", "area_broadband",
                      "area_settled"):
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table} (", MIGRATION)
        self.assertIn("FUNCTION public.rebuild_area_restriction()", MIGRATION)
        self.assertIn("FUNCTION public.roll_up_area_home(p_table text, p_sum text[], p_min text[])", MIGRATION)

    def test_overlaps_are_unioned_and_only_householder_directions_count(self):
        self.assertIn("ST_Area(ST_Intersection(l.geom, ST_Union(p.geom)))", MIGRATION)
        self.assertIn("FROM article4_area WHERE householder", MIGRATION)


class Article4Tests(unittest.TestCase):
    def test_householder_rights(self):
        for rights, text in (("1A;1B;1C;1D;1E;1F;1G;1H", ""), ("1AA;20AA", ""), ("Part 1 Class C, Part 2 Class C", ""),
                             ("Permitted development rights removed", "Enfield Lock Conservation Area"),
                             ("", "Article 4(2) Direction")):
            self.assertTrue(etl_home.householder(rights, text), (rights, text))
        for rights, text in (("3MA", ""), ("2C;11B", ""), ("Class e", ""), ("", "Article 4 Direction"),
                             ("Permitted development rights removed", "Direction relating to HMO'S"),
                             ("None given", "Site allocation NSP80")):
            self.assertFalse(etl_home.householder(rights, text), (rights, text))

    def test_london_rows_coverage_and_ended_directions(self):
        orgs = [{"entity": "90", "statistical-geography": "E09000007", "dataset": "local-authority", "end-date": ""},
                {"entity": "91", "statistical-geography": "E09000019", "dataset": "local-authority", "end-date": ""},
                {"entity": "5", "statistical-geography": "E07000008", "dataset": "local-authority", "end-date": ""}]
        boroughs = etl_home.councils(orgs, coverage.LONDON)
        self.assertEqual(boroughs, {"90": "E09000007", "91": "E09000019"})
        live = {"entity": "1", "organisation-entity": "90", "end-date": "", "geometry": "MULTIPOLYGON(((0 0,1 0,1 1,0 0)))",
                "name": "Primrose Hill", "reference": "A4/1", "permitted-development-rights": "1A;1B", "description": ""}
        rows = list(etl_home.article4_rows([live, {**live, "entity": "2", "end-date": "2020-01-01"},
                                            {**live, "entity": "3", "organisation-entity": "5"}], boroughs))
        self.assertEqual([row[0] for row in rows], ["pd:1"])
        self.assertTrue(rows[0][4])
        published = etl_home.article4_coverage(rows, coverage.LONDON)
        self.assertEqual(len(published), 33)
        self.assertEqual((published["E09000007"], published["E09000019"]), (1, 0))

    def test_england_keeps_every_council_and_counts_every_lad(self):
        orgs = [{"entity": "90", "statistical-geography": "E09000007", "dataset": "local-authority", "end-date": ""},
                {"entity": "5", "statistical-geography": "E07000008", "dataset": "local-authority", "end-date": ""},
                {"entity": "6", "statistical-geography": "E07000999", "dataset": "local-authority", "end-date": ""},
                {"entity": "7", "statistical-geography": "E26000001", "dataset": "national-park-authority",
                 "end-date": ""},
                {"entity": "8", "statistical-geography": "E07000005", "dataset": "local-authority",
                 "end-date": "2023-03-31"},
                {"entity": "9", "statistical-geography": "E08000016", "dataset": "local-authority", "end-date": "",
                 "name": "Barnsley Metropolitan Borough Council", "region": "E12000003"}]
        boroughs = etl_home.councils(orgs, coverage.ENGLAND)
        self.assertEqual(boroughs, {"90": "E09000007", "5": "E07000008", "9": "E08000038"})
        live = {"entity": "1", "organisation-entity": "5", "end-date": "", "geometry": "MULTIPOLYGON(((0 0,1 0,1 1,0 0)))",
                "name": "Mill Road", "reference": "A4/2", "permitted-development-rights": "", "description": "porches"}
        rows = list(etl_home.article4_rows([live], boroughs))
        self.assertEqual([(row[3], row[4]) for row in rows], [("E07000008", True)])
        published = etl_home.article4_coverage(rows, coverage.ENGLAND)
        self.assertEqual(len(published), 296)
        self.assertEqual((published["E07000008"], published["E08000035"]), (1, 0))
        self.assertEqual(etl_home.scope_suffix(coverage.ENGLAND), "-england")
        self.assertEqual(etl_home.scope_suffix(coverage.LONDON), "")

    def test_listed_buildings_inside_the_coverage_box(self):
        rows = [{"point": "POINT (-0.1 51.5)", "listed-building-grade": "II*", "reference": "1", "name": "A", "end-date": ""},
                {"point": "POINT (-2.2 51.2)", "listed-building-grade": "II", "reference": "2", "name": "B", "end-date": ""},
                {"point": "POINT (-0.1 51.5)", "listed-building-grade": "", "reference": "3", "name": "C", "end-date": ""}]
        self.assertEqual(list(etl_home.listed_rows(rows, coverage.LONDON)), [("nhle:1", "A", "II*", -0.1, 51.5)])
        self.assertEqual([row[0] for row in etl_home.listed_rows(rows, coverage.ENGLAND)], ["nhle:1", "nhle:2"])


def _zip(files: dict[str, str]) -> io.BytesIO:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, text in files.items():
            archive.writestr(name, text)
    buffer.seek(0)
    return buffer


class BroadbandAndSettledTests(unittest.TestCase):
    def test_output_areas_sum_to_lsoas_and_boroughs_carry_full_fibre(self):
        oa = ("output_area,All Premises,Number of premises with Gigabit availability\n"
              "E00000001,100,90\nE00000002,50,50\nE00000003,0,0\nS00000001,10,10\n")
        laua = ("laua,laua_name,All Premises,Number of premises with Full Fibre availability\n"
                "E09000007,Camden,1000,800\nE07000008,Cambridge,10,1\n")
        archive = _zip({"x/202601_fixed_oa_coverage_r1/202601_fixed_oa_res_coverage_r1.csv": oa,
                        "x/202601_fixed_laua_coverage_r1/202601_fixed_laua_res_coverage_r1.csv": laua})
        areas = etl_home.ofcom_output_areas(archive)
        lookup = etl_home.oa_to_lsoa([{"oa21cd": "E00000001", "lsoa21cd": "E01000001", "rgn26cd": "E12000007"},
                                      {"oa21cd": "E00000002", "lsoa21cd": "E01000001", "rgn26cd": "E12000007"},
                                      {"oa21cd": "E00000003", "lsoa21cd": "E01000002", "rgn26cd": "E12000007"},
                                      {"oa21cd": "W00000001", "lsoa21cd": "W01000001", "rgn26cd": "W92000004"}],
                                     coverage.ENGLAND)
        self.assertEqual(etl_home.broadband_lsoas(areas, lookup), {"E01000001": (150, 140)})
        archive.seek(0)
        self.assertEqual(etl_home.ofcom_full_fibre(archive, coverage.LONDON), {"E09000007": 0.8})
        archive.seek(0)
        self.assertEqual(etl_home.ofcom_full_fibre(archive, coverage.ENGLAND), {"E09000007": 0.8, "E07000008": 0.1})

    def test_ts019_same_address(self):
        header = ",".join(['"date"', '"geography"', '"geography code"', f'"{etl_home.TS019_TOTAL}"',
                           f'"{etl_home.TS019_SAME}"'])
        archive = _zip({"census2021-ts019-lsoa.csv": f"{header}\n2021,Camden 001A,E01000842,1409,1154\n2021,X,E01000001,0,0\n"})
        self.assertEqual(etl_home.ts019_lsoas(archive), {"E01000842": (1409, 1154)})


if __name__ == "__main__":
    unittest.main()
