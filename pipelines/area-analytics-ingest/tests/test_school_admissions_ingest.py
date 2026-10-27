"""Council admissions documents: cell parsers, name matching, review checks, configs, Ealing adapter."""
import os
import tempfile
import unittest

from area_analytics.school_admissions import config as cfg
from area_analytics.school_admissions import parsers, review
from area_analytics.school_admissions.adapters import ealing
from area_analytics.school_admissions.match import SchoolMatcher, normalise

RAW = os.path.expanduser("~/data/admissions/2026-10/ealing")

# Synthetic text in the layout pdftotext -layout gives for Ealing's 2024+ documents.
EALING_PAGE = """    Applications and offers for each primary school on National Offer Day (16 April 2026)

Community Schools
                                  Number of    Number    Number    Straight line distance of last
School
                                  applicants   offered   Refused   place offered (tie-breaker)
Alpha Primary School                 N/A         N/A       N/A     N/A - all applicants offered
Beta Primary School                  161          90        71     0.634 of a mile
Gamma Primary School                  91          90         1     2.171 miles

Academies, Foundation and VA Schools

Delta Academy: All applicants offered

Epsilon Catholic Primary School
                                         Number of       Number     Number     Straight line distance of last
Criteria
                                         applicants      offered    refused    place offered (tie-breaker)
Criteria 1 - 4                                18           18           0      N/A - all offered
Criteria 5 (distance)                         84           42          42      0.536 of a mile
No supplementary information form             14            0          14      N/A – all refused
"""

# The pre-2023 layout: centred headings, 'All applicants offered' across the count columns.
EALING_OLD = """       Applications and offers for each primary school on National Offer Day (19 April 2022).
                                    COMMUNITY SCHOOLS
                School                    applicants    offered refused      place offered (tie-breaker)
Alpha Primary School                           All applicants offered             N/A - all offered
                                    Zeta Primary Academy
             Criteria                      applicants    offered refused    place offered (tie-breaker)
                                         All applicants offered
                                    Eta Primary Academy
             Criteria                      applicants    offered refused    place offered (tie-breaker)
       Criteria 6 (distance)                  107          35       72           0.387 of a mile
"""


class ParseDistanceTests(unittest.TestCase):
    def test_miles_in_every_printed_form(self):
        self.assertEqual(parsers.parse_distance("0.634 of a mile", "miles"), (1020, None))
        self.assertEqual(parsers.parse_distance("2.171 miles", "miles"), (3494, None))
        self.assertEqual(parsers.parse_distance("0.5", "miles"), (805, None))

    def test_printed_unit_wins_over_the_documents(self):
        self.assertEqual(parsers.parse_distance("1,020m", "miles"), (1020, None))
        self.assertEqual(parsers.parse_distance("1.2 km", "miles"), (1200, None))
        self.assertEqual(parsers.parse_distance("850", "metres"), (850, None))

    def test_outcomes_without_a_distance(self):
        self.assertEqual(parsers.parse_distance("N/A - all applicants offered", "miles"), (None, True))
        self.assertEqual(parsers.parse_distance("All offered", None), (None, True))
        self.assertEqual(parsers.parse_distance("N/A – all refused", "miles"), (None, False))
        self.assertEqual(parsers.parse_distance("N/A", "miles"), (None, None))
        self.assertEqual(parsers.parse_distance("", "miles"), (None, None))
        self.assertEqual(parsers.parse_distance("N/A - aptitude score", "miles"), (None, None))

    def test_anything_else_is_refused_not_guessed(self):
        for cell in ("0.5 (2019: 0.4)", "see note"):
            with self.assertRaises(ValueError):
                parsers.parse_distance(cell, "miles")
        with self.assertRaises(ValueError):
            parsers.parse_distance("0.5", None)  # no units anywhere

    def test_counts(self):
        self.assertEqual(parsers.parse_count("1,204"), 1204)
        self.assertIsNone(parsers.parse_count("N/A"))
        self.assertIsNone(parsers.parse_count(None))

    def test_html_tables(self):
        with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as handle:
            handle.write("<p>x</p><table><tr><th>School</th><th>Distance</th></tr>"
                         "<tr><td>Alpha <br>Primary</td><td> 0.5 miles </td></tr></table>")
        try:
            self.assertEqual(parsers.html_tables(handle.name),
                             [[["School", "Distance"], ["Alpha Primary", "0.5 miles"]]])
        finally:
            os.remove(handle.name)

    def test_scanned_documents_are_refused_until_ocr_is_wired(self):
        with self.assertRaises(NotImplementedError):
            parsers.ocr_text("scan.pdf")


class MatchTests(unittest.TestCase):
    SCHOOLS = [("100001", "St Mary's Church of England Primary School", "primary"),
               ("100002", "St Mary's Catholic Primary School", "primary"),
               ("100003", "Beaconsfield Primary and Nursery School", "primary"),
               ("100004", "Featherstone High School", "secondary"),
               ("100005", "Featherstone Primary and Nursery School", "primary"),
               ("100006", "Oak Infant School", "primary"),
               ("100007", "Oak Junior School", "primary")]

    def test_normalise_ignores_spelling_but_keeps_what_tells_schools_apart(self):
        self.assertEqual(normalise("St. Mary's C of E Primary School"), normalise("Saint Mary's CE Primary"))
        self.assertEqual(normalise("St Gregory RC Primary"), normalise("St Gregory's Catholic Primary School"))
        self.assertNotEqual(normalise("Oak Infant School"), normalise("Oak Junior School"))
        self.assertNotEqual(normalise("St Mary's CE"), normalise("St Mary's RC"))

    def test_exact_then_phase_then_alias(self):
        matcher = SchoolMatcher(self.SCHOOLS, {"Mary's Old Name": "100002"})
        self.assertEqual(matcher.match("Beaconsfield Primary School"), "100003")
        self.assertEqual(matcher.match("Featherstone High School"), "100004")
        self.assertEqual(matcher.match("Featherstone Primary School", "primary"), "100005")
        self.assertEqual(matcher.match("Mary's Old Name"), "100002")
        self.assertIsNone(matcher.match("Oak School"))  # neither, never a guess

    def test_ambiguous_names_stay_unmatched(self):
        matcher = SchoolMatcher([("100001", "Oak Primary School", "primary"),
                                 ("100002", "Oak Academy", "primary")])
        self.assertIsNone(matcher.match("Oak Primary", "primary"))

    def test_predecessor_names_point_at_the_current_school(self):
        matcher = SchoolMatcher(self.SCHOOLS, extra_names=[("Oak Old Infants", "100006"), ("Gone", "999999")])
        self.assertEqual(matcher.match("Oak Old Infants"), "100006")
        self.assertIsNone(matcher.match("Gone"))

    def test_an_alias_to_another_las_school_is_an_error(self):
        with self.assertRaises(ValueError):
            SchoolMatcher(self.SCHOOLS, {"Elsewhere": "123456"})


def row(urn, counts=(None, None, None), metres=None, all_offered=None, rule="reception", year=2026, **extra):
    return {"school": f"School {urn}", "urn": urn, "rule_id": rule, "site": "main", "year": year,
            "applicants": counts[0], "offers": counts[1], "refused": counts[2],
            "distance_metres": metres, "all_offered": all_offered, **extra}


class ReviewTests(unittest.TestCase):
    def test_clean_rows_have_no_problems(self):
        self.assertEqual(review.problems([row("1", (161, 90, 71), 1020), row("2", all_offered=True)]), [])

    def test_unmatched_unparsed_and_inconsistent_rows_stop_the_load(self):
        found = review.problems([row(None), row("2", problem="distance not understood: 'x'"),
                                 row("3", (10, 12, 0)), row("4", (10, 8, 3)), row("5", (91, 90, 1), all_offered=True),
                                 row("6", metres=20000), row("7"), row("7")])
        self.assertEqual(len(found), 8, found)  # school 3 breaks two rules
        self.assertTrue(any("no URN" in p for p in found))
        self.assertTrue(any("all offered but 1 refused" in p for p in found))
        self.assertTrue(any("listed 2 times" in p for p in found))

    def test_a_year_that_repeats_the_previous_years_counts_is_flagged(self):
        before = [row(str(i), (100 + i, 90, 10 + i), 500 + i, year=2025) for i in range(5)]
        now = [row(str(i), (100 + i, 90, 10 + i), 900 + i) for i in range(5)]
        self.assertEqual(review.problems(now, before), ["counts identical to 2025 for 5 of 5 schools"])
        now_new = [row(str(i), (200 + i, 90, 110 + i), 900 + i) for i in range(5)]
        self.assertEqual(review.problems(now_new, before), [])

    def test_accepted_problems_are_named_exactly(self):
        self.assertEqual(review.problems([row(None)], accept=["'School None': no URN"]), [])

    def test_review_file_round_trip(self):
        rows = [row("101912", (161, 90, 71), 1020, False, school="Montpelier Primary School")]
        with tempfile.TemporaryDirectory() as tmp:
            back = review.read_review(review.write_review(rows, os.path.join(tmp, "x.csv")))
        self.assertEqual((back[0]["urn"], back[0]["distance_metres"], back[0]["all_offered"], back[0]["refused"]),
                         ("101912", 1020, False, 71))
        self.assertIsNone(back[0]["criterion"])


class ConfigTests(unittest.TestCase):
    def test_every_london_council_has_a_config_with_a_licence_decision(self):
        configs = [cfg.load_config(slug) for slug in cfg.slugs()]
        self.assertEqual(len(configs), 33)
        self.assertEqual(sum(len(c["docs"]) for c in configs), 391)
        approved = sorted(c["slug"] for c in configs if c["licence_decision"] == "approved")
        self.assertEqual(approved, ["harrow", "lambeth"])  # the two whose terms state OGL
        self.assertTrue(all(c["licence_decision"] in ("approved", "unresolved") for c in configs))
        self.assertEqual(cfg.load_config("307")["slug"], "ealing")

    def test_documents_of_one_phase_and_year_share_a_review_and_number_their_files(self):
        docs = [{"url": "https://x/a.pdf", "other_urls": ["https://x/b.xlsx?v=2"]}, {"url": "https://x/page", "format": "html"}]
        files = cfg.files("/d", "primary", 2019, docs)
        self.assertEqual([path for _, pairs in files for _, path in pairs],
                         ["/d/primary-2019.pdf", "/d/primary-2019-2.xlsx", "/d/primary-2019-3.html"])
        self.assertEqual(cfg.academic_year(2026), "2026/27")
        self.assertEqual(cfg.academic_year(1999), "1999/00")

    def test_adapters_are_found_by_slug(self):
        self.assertIs(cfg.adapter("ealing"), ealing)
        self.assertIsNone(cfg.adapter("no_such_council"))


class EalingAdapterTests(unittest.TestCase):
    def test_community_rows_named_all_offered_and_criterion_rows(self):
        offers = ealing.parse_text([EALING_PAGE])
        got = [(o.school, o.rule, o.raw_value, o.applicants, o.offers, o.refused) for o in offers]
        self.assertEqual(got, [
            ("Alpha Primary School", None, "N/A - all applicants offered", None, None, None),
            ("Beta Primary School", None, "0.634 of a mile", 161, 90, 71),
            ("Gamma Primary School", None, "2.171 miles", 91, 90, 1),
            ("Delta Academy", None, "All applicants offered", None, None, None),
            ("Epsilon Catholic Primary School", "Criteria 1 - 4", "N/A - all offered", 18, 18, 0),
            ("Epsilon Catholic Primary School", "Criteria 5 (distance)", "0.536 of a mile", 84, 42, 42),
            ("Epsilon Catholic Primary School", "No supplementary information form", "N/A - all refused", 14, 0, 14),
        ])

    def test_old_layout(self):
        got = [(o.school, o.rule, o.raw_value) for o in ealing.parse_text([EALING_OLD])]
        self.assertEqual(got, [("Alpha Primary School", None, "N/A - all offered"),
                               ("Zeta Primary Academy", None, "All applicants offered"),
                               ("Eta Primary Academy", "Criteria 6 (distance)", "0.387 of a mile")])

    @unittest.skipUnless(os.path.exists(os.path.join(RAW, "primary-2024.pdf")), "Ealing PDFs not downloaded")
    def test_real_documents_montpelier_and_north_ealing(self):
        def cell(year, school):
            offers = ealing.parse({"year": year}, [os.path.join(RAW, f"primary-{year}.pdf")], {})
            return [o.raw_value for o in offers if o.school == school and not o.rule]

        self.assertEqual([cell(y, "Montpelier Primary School") for y in (2024, 2025, 2026)],
                         [["0.634 of a mile"], ["0.645 of a mile"], ["0.825 of a mile"]])
        self.assertEqual(cell(2024, "North Ealing Primary School"), ["N/A - all applicants offered"])
        self.assertEqual(cell(2025, "North Ealing Primary School"), ["2.171 miles"])

    @unittest.skipUnless(os.path.exists(os.path.join(RAW, "primary-2023.pdf")), "Ealing PDFs not downloaded")
    def test_a_document_from_another_year_is_refused(self):
        with self.assertRaises(ValueError):  # the archive's '2023' address holds the 2024 file
            ealing.parse({"year": 2023}, [os.path.join(RAW, "primary-2023.pdf")], {})


if __name__ == "__main__":
    unittest.main()
