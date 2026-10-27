"""School history (migration 048): schema, URN resolution, release registration, measures, distance loader."""
import re
import sys
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import etl_school_distances as distances  # noqa: E402
import school_history_common as common  # noqa: E402
import school_measures  # noqa: E402
from area_analytics.school_admissions.match import SchoolMatcher  # noqa: E402
from area_analytics.school_admissions.parsers import Offer  # noqa: E402

MIGRATION = (ROOT / "migrations" / "048-school-history.sql").read_text()


class MigrationTests(unittest.TestCase):
    def test_new_tables_hang_off_the_current_school_and_a_source_release(self):
        for table in ("school_inspection", "school_admission_demand"):
            body = MIGRATION.split(f"CREATE TABLE IF NOT EXISTS {table} (", 1)[1].split(");", 1)[0]
            self.assertIn("urn text NOT NULL REFERENCES school(urn)", body)
            self.assertIn("source_release_id text NOT NULL REFERENCES source_release(id)", body)
        self.assertIn("PRIMARY KEY (urn, inspection_number)", MIGRATION)
        self.assertIn("PRIMARY KEY (urn, entry_year, entry_point)", MIGRATION)
        self.assertIn("overall smallint CHECK (overall BETWEEN 1 AND 4)", MIGRATION)

    def test_admission_observation_gains_printed_value_counts_and_a_publish_gate(self):
        alter = MIGRATION.split("ALTER TABLE school_admission_observation", 1)[1].split(";", 1)[0]
        for column in ("entry_point", "all_offered boolean", "last_offer_criterion text", "applicants integer",
                       "offers integer", "refused integer", "raw_value text",
                       "publishable boolean NOT NULL DEFAULT false"):
            self.assertIn(f"ADD COLUMN IF NOT EXISTS {column}", alter)

    def test_safe_to_rerun(self):
        self.assertTrue(all("IF NOT EXISTS" in line for line in re.findall(r"^CREATE .*$", MIGRATION, re.M)))
        self.assertNotIn("DROP ", MIGRATION)


def resolver():
    establishments = [
        {"URN": "100001", "LA (code)": "307", "EstablishmentNumber": "2001", "EstablishmentName": "Oak Infant School"},
        {"URN": "100002", "LA (code)": "307", "EstablishmentNumber": "2002", "EstablishmentName": "Oak Junior School"},
        {"URN": "140000", "LA (code)": "307", "EstablishmentNumber": "2003", "EstablishmentName": "Oak Primary School"},
        {"URN": "150000", "LA (code)": "307", "EstablishmentNumber": "4001", "EstablishmentName": "Oak Academy"},
        {"URN": "100009", "LA (code)": "307", "EstablishmentNumber": "2009", "EstablishmentName": "Closed School"},
        {"URN": "120000", "LA (code)": "307", "EstablishmentNumber": "6000", "EstablishmentName": "All-through"},
        {"URN": "130000", "LA (code)": "307", "EstablishmentNumber": "2010", "EstablishmentName": "Split Primary"},
    ]
    links = [  # LinkType says what LinkURN is to URN
        {"URN": "140000", "LinkURN": "100001", "LinkType": "Predecessor - amalgamated"},
        {"URN": "100002", "LinkURN": "140000", "LinkType": "Successor - amalgamated"},
        {"URN": "140000", "LinkURN": "150000", "LinkType": "Successor"},
        {"URN": "130000", "LinkURN": "120000", "LinkType": "Predecessor - Split School"},
    ]
    return common.UrnResolver({"150000", "120000", "130000"}, establishments, links)


class ResolverTests(unittest.TestCase):
    def test_current_school_maps_to_itself(self):
        self.assertEqual(resolver().resolve("150000"), "150000")

    def test_predecessors_follow_links_to_the_current_school(self):
        r = resolver()
        self.assertEqual(r.resolve("100001"), "150000")  # infant -> primary -> academy
        self.assertEqual(r.resolve("100002"), "150000")
        self.assertEqual(r.resolve("3072001"), "150000")  # by LAESTAB
        self.assertEqual(r.resolve(3072003), "150000")

    def test_unknown_closed_or_split_off_history_is_none(self):
        r = resolver()
        self.assertIsNone(r.resolve("100009"))
        self.assertIsNone(r.resolve("999999"))
        self.assertIsNone(r.resolve("3079999"))
        self.assertIsNone(r.resolve("abc"))
        self.assertEqual(r.resolve("130000"), "130000")
        self.assertNotIn("130000", r.successors.get("120000", set()))  # split links ignored

    def test_two_current_successors_is_ambiguous(self):
        r = common.UrnResolver({"200001", "200002"}, [], [
            {"URN": "100000", "LinkURN": "200001", "LinkType": "Successor"},
            {"URN": "100000", "LinkURN": "200002", "LinkType": "Successor"}])
        self.assertIsNone(r.resolve("100000"))

    def test_names_of_predecessors_for_matching(self):
        names = dict(resolver().names(307))
        self.assertEqual(names["Oak Infant School"], "150000")
        self.assertNotIn("Closed School", names)

    def test_link_pairs_only_between_schools_in_the_table_and_never_both_ways(self):
        r = common.UrnResolver({"1", "2", "3", "4"}, [], [
            {"URN": "2", "LinkURN": "1", "LinkType": "Predecessor - merged"},
            {"URN": "3", "LinkURN": "4", "LinkType": "Predecessor"},
            {"URN": "4", "LinkURN": "3", "LinkType": "Predecessor"},
            {"URN": "2", "LinkURN": "9", "LinkType": "Predecessor"}])
        self.assertEqual(common.link_pairs(r), [("1", "2")])


class FakeCursor:
    def __init__(self, stored):
        self.stored = stored

    def execute(self, sql, params=None):
        self.last = sql
        return self

    def fetchone(self):
        return (self.stored,)


class CommonTests(unittest.TestCase):
    def test_thirty_three_london_authorities_named_as_the_school_table(self):
        self.assertEqual(len(common.LONDON_LAS), 33)
        self.assertEqual(common.LONDON_LAS[307], "Ealing")
        self.assertEqual(common.LONDON_LAS[205], "Hammersmith and Fulham")
        self.assertEqual(common.laestab("307", "2034"), "3072034")

    def test_coverage_las_are_read_from_gias_districts(self):
        rows = [{"LA (code)": "307", "DistrictAdministrative (code)": "E09000009"},
                {"LA (code)": "383", "DistrictAdministrative (code)": "E08000035"},
                {"LA (code)": "936", "DistrictAdministrative (code)": "E07000207"},
                {"LA (code)": "936", "DistrictAdministrative (code)": "E09000029"},  # a Surrey school in Sutton
                {"LA (code)": "936", "DistrictAdministrative (code)": "E07000209"},
                {"LA (code)": "673", "DistrictAdministrative (code)": "W06000015"}]
        self.assertEqual(common.las_in_coverage(rows, common.coverage.ENGLAND), {307, 383, 936})
        self.assertEqual(common.las_in_coverage(rows, common.coverage.LONDON), {307})
        with mock.patch.object(common, "COVERAGE", common.coverage.LONDON):
            common.coverage_las.cache_clear()
            self.assertEqual(common.coverage_las(), frozenset(common.LONDON_LAS))
        common.coverage_las.cache_clear()

    def test_wayback_links_are_fetched_raw(self):
        self.assertEqual(common.wayback_raw("https://web.archive.org/web/20240710224301/https://x.gov.uk/a.pdf"),
                         "https://web.archive.org/web/20240710224301id_/https://x.gov.uk/a.pdf")
        self.assertEqual(common.wayback_raw("https://web.archive.org/web/20240710224301if_/https://x/a"),
                         "https://web.archive.org/web/20240710224301id_/https://x/a")
        self.assertEqual(common.wayback_raw("https://x.gov.uk/a.pdf"), "https://x.gov.uk/a.pdf")

    def test_release_registered_once_and_a_changed_file_is_refused(self):
        common.register_release(FakeCursor("a" * 64), "src-x", "u", "a" * 64, "OGL-3.0", "a", [], "2026-10-11")
        with self.assertRaises(SystemExit):
            common.register_release(FakeCursor("b" * 64), "src-x", "u", "a" * 64, "OGL-3.0", "a", [], "2026-10-11")

    def test_gias_keeps_no_personal_fields(self):
        self.assertFalse([c for c in common.GIAS_COLUMNS if c.startswith("Head")])

    def test_stage_includes_every_councils_distances_not_only_publishable(self):
        self.assertIn("school_admission_observation", common.HISTORY_RELEASES_SQL)
        self.assertNotIn("publishable", common.HISTORY_RELEASES_SQL)

        updates = []

        class StageCursor:
            def execute(self, sql, params=None):
                rows = []
                if sql is common.RECAVEAT_SQL:
                    updates.append(params)
                if sql is common.HISTORY_RELEASES_SQL:
                    rows = [{"source_release_id": "src-la-admissions-barnet-primary-2025"},
                            {"source_release_id": "src-la-admissions-lambeth-primary-2025"}]
                elif "product_release_member" in sql:
                    rows = [{"source_release_id": "src-la-admissions-lambeth-primary-2025"}]
                return type("Result", (), {"__iter__": lambda _: iter(rows), "fetchone": lambda _: None})()

        staged = {}
        fake = type(sys)("stage_release")
        fake.stage = lambda cur, name, new, replace=(): staged.update(name=name, new=new) or "rel-x"
        with mock.patch.dict(sys.modules, {"stage_release": fake}):
            self.assertEqual(common.stage(StageCursor()), "rel-x")
        self.assertEqual(staged, {"name": "school-history", "new": ["src-la-admissions-barnet-primary-2025"]})
        self.assertEqual(updates, [(common.REUSE_CAVEAT_OLD, common.REUSE_CAVEAT, common.REUSE_CAVEAT_OLD)])
        self.assertNotIn("for review", common.REUSE_CAVEAT)


class MeasureTests(unittest.TestCase):
    def test_ids_unique_and_years_are_published_years(self):
        ids = [m.id for m in school_measures.MEASURES]
        self.assertEqual(len(ids), len(set(ids)))
        for measure in school_measures.MEASURES:
            self.assertIn(measure.source, ("KS2", "KS4", "KS5", "CENSUS", "PUPILABSENCE"))
            for year in measure.columns:
                self.assertRegex(year, r"^\d{4}/\d{2}$")
        self.assertNotIn("2021/22", school_measures.BY_ID["ks2-rwm-expected"].columns)  # not published
        self.assertEqual(school_measures.BY_ID["ks2-rwm-expected"].column("2024/25"), "PTRWM_EXP")
        self.assertEqual(school_measures.download_year("2024/25"), "2024-2025")


class DistanceRowTests(unittest.TestCase):
    DOC = {"url": "https://example/doc.pdf", "units": "miles", "method": "straight-line"}
    CONFIG = {"la": 307, "slug": "ealing"}

    def matcher(self):
        return SchoolMatcher([("101912", "Montpelier Primary School", "primary")])

    def test_row_carries_metres_printed_value_and_counts(self):
        r = distances.to_row(Offer("Montpelier Primary School", "0.634 of a mile", applicants=161, offers=90,
                                   refused=71), self.DOC, self.CONFIG, "primary", 2024, self.matcher())
        self.assertEqual((r["urn"], r["academic_year"], r["entry_point"], r["rule_id"], r["distance_metres"],
                          r["raw_value"], r["applicants"], r["measurement_method"], r["problem"]),
                         ("101912", "2024/25", "reception", "reception", 1020, "0.634 of a mile", 161,
                          "straight-line", None))

    def test_criterion_rows_get_their_own_rule_and_drop_counts_blanks_counts(self):
        doc = {**self.DOC, "drop_counts": "copied from last year", "method": None}
        r = distances.to_row(Offer("Montpelier Primary School", "N/A - all offered", criterion="Criteria 5 (distance)",
                                   rule="Criteria 5 (distance)", applicants=84), doc, self.CONFIG, "primary", 2026,
                             self.matcher())
        self.assertEqual((r["rule_id"], r["all_offered"], r["applicants"], r["measurement_method"]),
                         ("reception:criteria-5-distance", True, None, "unknown"))

    def test_unreadable_cell_is_a_problem_not_a_value(self):
        r = distances.to_row(Offer("Nowhere School", "see note"), self.DOC, self.CONFIG,
                             "secondary", 2025, self.matcher())
        self.assertEqual((r["urn"], r["distance_metres"], r["entry_point"]), (None, None, "year7"))
        self.assertIn("not understood", r["problem"])


if __name__ == "__main__":
    unittest.main()
