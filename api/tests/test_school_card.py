"""School card (school-card.v1): London percentiles, the Top school badge, Ofsted extracts, admissions."""
import contextlib
import unittest

from area_api import evidence, school_card, schools

URN = "101234"


def ranked(phase, kind, year, values):
    """Pool rows as POOL_SQL returns them: percent_rank() * 100 within (phase, kind, year)."""
    ordered = sorted(values.values())
    n = len(ordered)
    return [{"urn": urn, "phase": phase, "observation_kind": kind, "academic_year": year, "value": value,
             "percentile": 100.0 * ordered.index(value) / (n - 1) if n > 1 else 0.0}
            for urn, value in values.items()]


def london(top_value=95.0, higher_value=48.0, phase="primary", year="2024/25"):
    """A pool of 11 other schools (0..100 by 10) plus URN; URN's values set its percentile."""
    headline, second, _ = school_card.PHASE_RULES[phase]
    others = {f"2000{i:02d}": float(i * 10) for i in range(11)}
    rows = (ranked(phase, headline, year, {**{u: v - 0.5 for u, v in others.items()}, URN: top_value})
            + ranked(phase, second, year, {**{u: v / 2 for u, v in others.items()}, URN: higher_value})
            + ranked(phase, headline, "2021/22", {**others, URN: 50.0}))
    return school_card.Pool(rows)


def point(year, value, cohort=60, suppressed=False):
    return {"academicYear": year, "value": value, "cohortSize": cohort, "suppressed": suppressed}


def legacy(overall, start="2023-11-14", framework="eif-2019", judgements=None):
    return {"framework": framework, "overall": overall, "judgements": judgements or {}, "startDate": start}


def report_card(grades, safeguarding="Met", start="2026-02-01"):
    return {"framework": "report-card-2025", "overall": None, "startDate": start,
            "judgements": {**grades, "Safeguarding standards": safeguarding}}


SERIES = {"ks2-rwm-expected": [point("2024/25", 95.0)], "ks2-rwm-higher": [point("2024/25", 48.0)]}


class PoolTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(school_card.release_store.use_memory())  # pools are kept per release (release_artifact)

    def test_percentiles_medians_sizes_and_years(self):
        pool = london()
        self.assertEqual(pool.latest_year("primary", "ks2-rwm-expected"), "2024/25")
        self.assertEqual(pool.percentile("primary", "ks2-rwm-expected", "2024/25", URN), 90.9)
        self.assertEqual(pool.sizes[("primary", "ks2-rwm-expected", "2024/25")], 12)
        self.assertEqual(pool.medians[("primary", "ks2-rwm-expected", "2021/22")], 50.0)
        self.assertIsNone(pool.percentile("primary", "ks2-rwm-expected", "2024/25", "999999"))

    def test_pool_sql_keeps_the_cohort_floor_suppression_and_the_active_release(self):
        sql = school_card.POOL_SQL
        self.assertIn("cohort_size >= %s", sql)
        self.assertIn("suppressed", sql)
        self.assertIn("active_product_release", sql)
        self.assertIn("PARTITION BY s.phase, o.observation_kind, o.academic_year", sql)

    def test_pool_is_cached_per_release(self):
        calls = []

        class Connection:
            def execute(self, sql, params=()):
                calls.append(sql)
                return ranked("primary", "ks2-rwm-expected", "2024/25", {URN: 1.0, "200001": 2.0})

        first = school_card.london_pool(Connection(), "rel-a")
        self.assertEqual(vars(school_card.london_pool(Connection(), "rel-a")), vars(first))
        school_card.london_pool(Connection(), "rel-b")
        self.assertEqual(len(calls), 2)

    def test_compare_pool_is_one_regions_cached_per_release_and_region(self):
        calls = []

        class Connection:
            def execute(self, sql, params=None):
                calls.append(params)
                return [compare_pool_row("pupils", "2026-01-15", [1.0, 2.0, 3.0], 20)]

        first = school_card.compare_pool(Connection(), "rel-a", "E12000002")
        self.assertEqual(school_card.compare_pool(Connection(), "rel-a", "E12000002").groups, first.groups)
        school_card.compare_pool(Connection(), "rel-a", "E12000007")
        school_card.compare_pool(Connection(), "rel-b", "E12000002")
        self.assertEqual(calls, [{"region": "E12000002"}, {"region": "E12000007"}, {"region": "E12000002"}])
        self.assertEqual([key for key in school_card.release_store.store.kinds() if key[1] == "school-compare-pool"],
                         [("rel-a", "school-compare-pool", "('E12000002',)"), ("rel-a", "school-compare-pool", "('E12000007',)"),
                          ("rel-b", "school-compare-pool", "('E12000002',)")])
        self.assertIn("WHERE region_code = %(region)s GROUP BY", school_card.COMPARE_POOL_SQL)
        # Every source table is cut to the region's URNs before the join (~1-2 s a region, not ~9 s for England).
        self.assertEqual(school_card.COMPARE_POOL_SQL.count("SELECT r.urn FROM school r WHERE r.region_code"), 5)
        self.assertNotIn("%(region)s", school_card.COMPARE_SCHOOL_SQL)

    def test_concurrent_cold_requests_run_the_pool_query_once(self):
        import threading
        import time

        calls = []

        class Slow:
            def execute(self, sql, params=None):
                calls.append(sql)
                time.sleep(0.2)
                return [compare_pool_row("pupils", "2026-01-15", [1.0, 2.0, 3.0], 20)]

        pools = []
        threads = [threading.Thread(target=lambda: pools.append(school_card.compare_pool(Slow(), "rel-a")))
                   for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(pools), 8)
        self.assertTrue(all(pool.groups == pools[0].groups for pool in pools))

    def test_build_pools_builds_every_regions_pools(self):
        calls = []

        class Connection:
            def execute(self, sql, params=None):
                marker = sql.splitlines()[0].removeprefix("-- evidence:")
                calls.append((marker, params if marker == "school-compare-pool" else
                              params[2] if marker == "school-card-pool" else None))
                if marker == "school-pool-regions":
                    return [{"region_code": "E12000002"}, {"region_code": "E12000007"}]
                return []

        self.assertEqual(school_card.build_pools(Connection(), "rel-a"), ["E12000002", "E12000007"])
        self.assertEqual(calls, [("school-pool-regions", None),
                                 ("school-card-pool", "E12000002"), ("school-compare-pool", {"region": "E12000002"}),
                                 ("school-card-pool", "E12000007"), ("school-compare-pool", {"region": "E12000007"})])
        calls.clear()
        school_card.build_pools(Connection(), "rel-a")  # built: only the region list is read again
        self.assertEqual(calls, [("school-pool-regions", None)])


class BadgeTests(unittest.TestCase):
    def test_top_school_needs_both_measures_and_a_good_inspection(self):
        badge = school_card.top_badge(URN, "primary", SERIES, [legacy(2)], london())
        self.assertTrue(badge["isTop"])
        self.assertEqual(badge["year"], "2024/25")
        self.assertEqual(badge["line"], "Top school: top 10% London KS2 RWM 2024/25 · Ofsted Good")
        self.assertIn("top-results", [c["id"] for c in badge["chips"]])
        self.assertIsNone(badge["missingReason"])

    def test_top_school_criteria_says_it_is_not_the_map_plaque(self):
        badge = school_card.top_badge(URN, "primary", SERIES, [legacy(2)], london())
        self.assertIn("Separate from the map plaque", badge["criteria"])
        self.assertIn("London", badge["criteria"])

    def test_requires_improvement_or_a_weak_second_measure_is_not_top(self):
        self.assertFalse(school_card.top_badge(URN, "primary", SERIES, [legacy(3)], london())["isTop"])
        weak = school_card.top_badge(URN, "primary", SERIES, [legacy(1)], london(higher_value=20.0))
        self.assertFalse(weak["isTop"])
        self.assertIsNone(weak["line"])
        self.assertIn("top-results", [c["id"] for c in weak["chips"]])  # P90 headline still earns its chip

    def test_ungraded_visit_keeps_the_standing_grade(self):
        ungraded = legacy(None, start="2025-03-01")
        self.assertTrue(school_card.top_badge(URN, "primary", SERIES, [ungraded, legacy(1)], london())["isTop"])

    def test_eif_2024_ungraded_visit_keeps_the_standing_grade(self):
        # As on ae-pgold for URN 138461: a 2024 section 8 visit over an Outstanding 2018 inspection.
        section8 = legacy(None, start="2024-10-15", framework="eif-2024-no-overall", judgements={
            "Safeguarding is effective?": "Yes",
            "Outcomes for ungraded and monitoring inspections": "Standards maintained",
            "Did the latest ungraded inspection convert to a graded inspection?": "No"})
        legacy_s8 = legacy(None, start="2020-01-29", judgements={
            "Safeguarding is effective": "Yes", "Outcomes for section 8 inspections": "School remains Good"})
        gate = school_card.inspection_gate([section8, legacy_s8, legacy(1, start="2018-09-25", framework="cif-2015")])
        self.assertEqual((gate["passed"], gate["label"]), (True, "Ofsted Outstanding (2018)"))
        badge = school_card.top_badge(URN, "primary", SERIES, [section8, legacy(2)], london())
        self.assertTrue(badge["isTop"])
        self.assertNotIn("below Good", " ".join(badge["reasons"]))
        self.assertIsNone(school_card.inspection_gate([section8])["passed"])  # nothing graded behind it

        unsafe = {**section8, "judgements": {**section8["judgements"], "Safeguarding is effective?": "No"}}
        self.assertFalse(school_card.inspection_gate([unsafe, legacy(1)])["passed"])

    def test_eif_2024_graded_areas_and_a_short_badge_line(self):
        areas = {"Quality of education": 1, "Behaviour and attitudes": 2, "Personal development": 1,
                 "Effectiveness of leadership and management": 1, "Safeguarding is effective?": "Yes"}
        graded = legacy(None, start="2025-02-04", framework="eif-2024-no-overall", judgements=areas)
        badge = school_card.top_badge(URN, "primary", SERIES, [graded, legacy(4)], london())
        self.assertTrue(badge["isTop"])
        self.assertEqual(badge["line"], "Top school: top 10% London KS2 RWM 2024/25 · Ofsted: all Good+ 2025")
        weak = {**graded, "judgements": {**areas, "Behaviour and attitudes": 3}}
        self.assertEqual(school_card.inspection_gate([weak, legacy(1)])["label"], "Ofsted 2025: an area below Good")

    def test_suppressed_or_small_cohort_is_not_enough_data(self):
        pool = london()
        suppressed = {"ks2-rwm-expected": [point("2024/25", None, cohort=8, suppressed=True)]}
        badge = school_card.top_badge("300001", "primary", suppressed, [legacy(1)], pool)
        self.assertFalse(badge["isTop"])
        chip = badge["chips"][-1]
        self.assertEqual((chip["id"], chip["label"]), ("not-enough-data", "Not enough data"))
        self.assertIn("Suppressed in 2024/25", chip["reason"])

        small = {"ks2-rwm-expected": [point("2024/25", 99.0, cohort=24)]}
        badge = school_card.top_badge("300002", "primary", small, [legacy(1)], pool)
        self.assertEqual(badge["missingReason"], "Small cohort: 24 pupils in 2024/25 (under 30)")

        new_school = school_card.top_badge("300003", "primary", {}, [legacy(1)], pool)
        self.assertEqual(new_school["missingReason"], "No results published for 2024/25")

    def test_not_inspected_gets_no_badge(self):
        badge = school_card.top_badge(URN, "primary", SERIES, [], london())
        self.assertFalse(badge["isTop"])
        self.assertEqual(badge["missingReason"], "Not inspected")

    def test_report_card_gate(self):
        good = {"Inclusion": "Expected standard", "Achievement": "Exceptional",
                "Curriculum and teaching": "Strong standard"}
        badge = school_card.top_badge(URN, "primary", SERIES, [report_card(good), legacy(4)], london())
        self.assertTrue(badge["isTop"])
        self.assertIn("Exceptional in Achievement", [c["label"] for c in badge["chips"]])
        self.assertTrue(badge["line"].endswith("· Ofsted report card"))

        weak = {**good, "Inclusion": "Needs attention"}
        self.assertFalse(school_card.top_badge(URN, "primary", SERIES, [report_card(weak)], london())["isTop"])
        unsafe = school_card.top_badge(URN, "primary", SERIES, [report_card(good, "Not met")], london())
        self.assertFalse(unsafe["isTop"])
        self.assertIn("safeguarding not met", unsafe["reasons"][-1])

    def test_rising_compares_three_data_years_back(self):
        pool = school_card.Pool(
            ranked("primary", "ks2-rwm-expected", "2018/19", {URN: 1.0, "200001": 2.0, "200002": 3.0})
            + ranked("primary", "ks2-rwm-expected", "2022/23", {URN: 1.0, "200001": 2.0, "200002": 3.0})
            + ranked("primary", "ks2-rwm-expected", "2023/24", {URN: 1.0, "200001": 2.0, "200002": 3.0})
            + ranked("primary", "ks2-rwm-expected", "2024/25", {URN: 9.0, "200001": 2.0, "200002": 3.0}))
        trend = school_card.percentile_trend(pool, "primary", "ks2-rwm-expected", "2024/25", URN)
        self.assertEqual(trend, {"direction": "up", "deltaPoints": 100.0, "fromYear": "2018/19"})

    def test_secondary_rules(self):
        series = {"ks4-attainment8": [point("2024/25", 95.0)], "ks4-em-grade5": [point("2024/25", 48.0)]}
        badge = school_card.top_badge(URN, "secondary", series, [legacy(2)], london(phase="secondary"))
        self.assertTrue(badge["isTop"])
        self.assertIn("Attainment 8 2024/25", badge["line"])


class TldrTests(unittest.TestCase):
    LONG = "Pupils " + "really " * 30 + "enjoy school."

    def test_at_most_three_whole_short_sentences(self):
        text = (f"Pupils are polite. {self.LONG} They feel safe! Leaders are ambitious.\n"
                "• Staff know pupils well. The curriculum is broad and well sequenced and")
        picked = school_card.pick_sentences(text)
        self.assertEqual(picked, ["Pupils are polite.", "They feel safe!", "Leaders are ambitious."])
        self.assertTrue(all(len(s) <= 160 for s in picked))

    def test_fragments_and_headings_are_never_sentences(self):
        self.assertEqual(school_card.pick_sentences("What does the school do well\nThe curriculum is"), [])
        self.assertEqual(school_card.pick_sentences(None), [])

    def test_latest_inspection_with_text_dated_and_linked(self):
        inspections = [
            {"inspectedUrn": URN, "startDate": "2025-05-01", "publicationDate": None, "reportUrl": None,
             "keyFindings": None, "improveText": None},
            {"inspectedUrn": URN, "startDate": "2023-11-14", "publicationDate": "2024-01-18",
             "reportUrl": "https://files.ofsted.gov.uk/v1/file/1",
             "keyFindings": "Pupils enjoy school. They behave well.", "improveText": "Sequence the curriculum."}]
        summary = school_card.tldr(URN, inspections)
        self.assertEqual(summary["strengths"], ["Pupils enjoy school.", "They behave well."])
        self.assertEqual(summary["improve"], ["Sequence the curriculum."])
        self.assertEqual(summary["label"], "From Ofsted report, 2024-01-18")
        self.assertEqual(summary["reportUrl"], "https://files.ofsted.gov.uk/v1/file/1")
        self.assertFalse(summary["inspectedAsPredecessor"])
        self.assertIn("Open Government Licence", summary["attribution"])

    def test_predecessor_label(self):
        summary = school_card.tldr(URN, [{"inspectedUrn": "100999", "startDate": "2019-03-01",
                                          "publicationDate": "2019-04-02", "reportUrl": None,
                                          "keyFindings": "Pupils are happy.", "improveText": None}])
        self.assertEqual(summary["label"], "From Ofsted report, 2019-04-02 (inspected as predecessor)")
        self.assertTrue(summary["inspectedAsPredecessor"])

    def test_no_text_no_tldr(self):
        self.assertIsNone(school_card.tldr(URN, [{"inspectedUrn": URN, "keyFindings": "", "improveText": None}]))


def distance(year, rule, metres, release, publishable, url="https://council.example/table.pdf", criterion=None):
    return {"academicYear": year, "entryPoint": "reception", "rule": rule, "site": "main",
            "measurementMethod": "straight-line", "distanceMetres": metres, "rawValue": str(metres),
            "allOffered": None, "criterion": criterion, "applicants": None, "offers": None, "refused": None,
            "sourceUrl": url, "sourceRelease": release, "publishable": publishable}


HISTORY = {
    "measures": [{"id": "ks2-rwm-expected", "series": [point("2021/22", 50.0), point("2024/25", 95.0)]},
                 {"id": "ks2-rwm-higher", "series": [point("2024/25", 40.0)]}],
    "inspections": [{"inspectedUrn": URN, "framework": "eif-2019", "overall": 2, "judgements": {},
                     "startDate": "2023-11-14", "publicationDate": "2024-01-18", "reportUrl": None,
                     "keyFindings": "Pupils enjoy school.", "improveText": None}],
    "demand": [{"entryYear": 2025, "entryPoint": "reception", "firstPreferences": 90, "anyPreferences": 300,
                "offers": 60, "firstPreferenceOffers": 55, "pan": 60},
               {"entryYear": 2026, "entryPoint": "reception", "firstPreferences": 109, "anyPreferences": 400,
                "offers": 60, "firstPreferenceOffers": 55, "pan": None}],
    "distances": [
        distance("2025/26", "reception", 812, "src-la-admissions-barnet-primary-2025", False),
        distance("2024/25", "reception:sibling", 2400, "src-la-admissions-lambeth-primary-2024", True,
                 criterion="Sibling"),
        distance("2024/25", "reception:distance", 640, "src-la-admissions-lambeth-primary-2024", True,
                 criterion="Distance"),
    ],
    "sources": [
        {"id": "src-la-admissions-barnet-primary-2025", "licence": "Barnet Council copyright; re-use not confirmed",
         "attribution": "Barnet Council, school admissions: on-time offers for 2025/26 (primary).", "caveats": []},
        {"id": "src-la-admissions-lambeth-primary-2024", "licence": "OGL-3.0",
         "attribution": "Lambeth Council, school admissions: on-time offers for 2024/25 (primary).", "caveats": []},
    ],
}


class AdmissionsTests(unittest.TestCase):
    def test_every_council_is_shown_with_its_licence_and_source(self):
        last = school_card.admissions(HISTORY)["lastOffered"]
        self.assertEqual([(g["academicYear"], g["council"], g["reuseConfirmed"]) for g in last],
                         [("2025/26", "Barnet Council", False), ("2024/25", "Lambeth Council", True)])
        barnet = last[0]
        self.assertEqual(barnet["distanceMetres"], 812)
        self.assertEqual(barnet["licence"], "Barnet Council copyright")
        self.assertEqual(barnet["sourceUrl"], "https://council.example/table.pdf")
        self.assertEqual(barnet["attribution"], "Source: Barnet Council, 2025/26")
        self.assertEqual(last[1]["licence"], "OGL-3.0")
        self.assertTrue(last[1]["attribution"].startswith("Source: Lambeth Council, 2024/25. Contains public"))

    def test_the_old_review_caveat_is_not_shown(self):
        old = "The council's terms do not confirm re-use: loaded for review, publishable = false."
        shown = school_card.card_sources([{"id": "src-la-admissions-barnet-primary-2025", "caveats": [old, "x"]}])
        self.assertNotIn("loaded for review", " ".join(shown[0]["caveats"]))
        self.assertEqual(shown[0]["caveats"][1], "x")

    def test_no_headline_is_picked_between_criteria(self):
        lambeth = school_card.admissions(HISTORY)["lastOffered"][1]
        self.assertIsNone(lambeth["distanceMetres"])
        self.assertEqual([r["distanceMetres"] for r in lambeth["rules"]], [2400, 640])

    def test_latest_demand_per_place_and_a_missing_pan_is_said(self):
        demand = school_card.admissions(HISTORY)["demand"]
        self.assertEqual(len(demand), 1)
        self.assertEqual(demand[0]["entryYear"], 2026)
        self.assertIsNone(demand[0]["applicationsPerPlace"])
        self.assertEqual(demand[0]["missingReason"], "No published admission number")

    def test_history_reads_every_council_with_the_flag(self):
        self.assertNotIn("AND publishable", schools.SCHOOL_DISTANCES_SQL)
        self.assertIn("publishable", schools.SCHOOL_DISTANCES_SQL)
        self.assertIn("active_product_release", schools.SCHOOL_DISTANCES_SQL)


SCHOOL_ROW = {
    "urn": URN, "name": "Sample Primary", "phase": "primary",
    "attributes": {"type": "Academy converter", "ageFrom": 4, "ageTo": 11, "localAuthority": "Lambeth",
                   "postcode": "SW2 1AA", "observations": []},
    "latitude": 51.45, "longitude": -0.12, "source_release_id": "src-ofsted", "distance_metres": None,
    "predecessor_urn": "100999", "successor_urn": None, "area_id": "uk:lsoa:E01000001",
}


class CardTests(unittest.TestCase):
    def test_card_shape(self):
        payload = school_card.card(SCHOOL_ROW, HISTORY, london(), "rel-test")
        self.assertEqual(payload["schemaVersion"], "school-card.v1")
        self.assertEqual(payload["areaId"], "uk:lsoa:E01000001")
        self.assertTrue(payload["topBadge"]["isTop"])
        self.assertEqual(payload["school"]["topBadge"], payload["topBadge"])
        self.assertEqual(payload["details"]["predecessorUrn"], "100999")
        self.assertIsNone(payload["parentView"])
        self.assertEqual(payload["percentiles"]["ks2-rwm-expected"],
                         [{"academicYear": "2021/22", "percentile": 45.5}, {"academicYear": "2024/25", "percentile": 90.9}])
        self.assertEqual(payload["regionMedian"]["ks2-rwm-expected"][0]["academicYear"], "2021/22")
        tiles = {t["measure"]: t for t in payload["kpis"]}
        self.assertEqual(list(tiles), list(school_card.KPI_MEASURES["primary"]))
        self.assertEqual((tiles["ks2-rwm-expected"]["valueText"], tiles["ks2-rwm-expected"]["score10"]), ("95%", 9.1))
        self.assertEqual(tiles["ks2-rwm-expected"]["basis"], "vs 12 London primaries, cohort 30+")
        self.assertIsNone(tiles["ks2-reading-score"]["percentile"])
        self.assertEqual(tiles["ks2-reading-score"]["valueText"], "Not enough data")
        self.assertTrue(tiles["ks2-reading-score"]["missingReason"])
        self.assertIn("ks2-reading-progress", [m["measure"] for m in payload["missing"]])

    def test_card_carries_rank_profile_counts_and_their_sources(self):
        extra = [{"id": "src-gias-profile-20261015", "licence": "OGL-3.0", "attribution": "GIAS", "caveats": []},
                 {"id": "src-la-admissions-lambeth-primary-2024", "licence": "x", "attribution": "y", "caveats": []}]
        payload = school_card.card(SCHOOL_ROW, HISTORY, london(), "rel-test", [rank("2024/25", 12, 15057, 1)],
                                   PROFILE_ROW, extra)
        self.assertEqual(payload["nationalRank"]["rank"], 12)
        self.assertEqual(payload["profile"]["gias"]["gender"], "Mixed")
        self.assertIsNone(payload["inspectionCounts"])  # the only inspection graded nothing in `judgements`
        ids = [s["id"] for s in payload["sources"]]
        self.assertEqual(ids.count("src-la-admissions-lambeth-primary-2024"), 1)
        self.assertIn("src-gias-profile-20261015", ids)
        self.assertIn("workforce", [m["measure"] for m in payload["missing"]])
        self.assertNotIn("national-rank", [m["measure"] for m in payload["missing"]])
        payload = school_card.card(SCHOOL_ROW, HISTORY, london(), "rel-test", [], {
            **PROFILE_ROW, "website": "www.example.sch.uk", "telephone": "020 7926 1000", "laestab": "208/2000"})
        self.assertEqual(payload["links"]["website"]["host"], "example.sch.uk")
        self.assertEqual(payload["links"]["phone"]["number"], "020 7926 1000")
        self.assertEqual(payload["links"]["ofstedReport"]["href"], f"/go/school-ofsted?urn={URN}&from=web")
        self.assertEqual(payload["profile"]["gias"]["laestab"], "208/2000")

    def test_card_without_rank_or_profile_says_so(self):
        payload = school_card.card(SCHOOL_ROW, HISTORY, london(), "rel-test")
        self.assertIsNone(payload["nationalRank"])
        self.assertIsNone(payload["profile"]["gias"])
        missing = [m["measure"] for m in payload["missing"]]
        self.assertIn("national-rank", missing)
        self.assertIn("gias-profile", missing)

    def test_progress8_tile_says_why_it_stops_in_2023_24(self):
        series = {"ks4-progress8": [point("2023/24", 0.42, cohort=200)]}
        tile = next(t for t in school_card.kpis(URN, "secondary", series, london(phase="secondary"))
                    if t["measure"] == "ks4-progress8")
        self.assertEqual((tile["year"], tile["valueText"]), ("2023/24", "+0.42"))
        self.assertIn("2024/25", tile["note"])


def rank(year, position, total, top, value=90.0, latest="2024/25", release="src-dfe-cscp-ks2-2024-25"):
    return {"latest_year": latest, "academic_year": year, "ranked_urn": URN, "measure": "ks2-rwm-expected",
            "value": value, "tiebreak_value": 40.0, "rank": position, "pool_size": total, "top_percent": top,
            "source_release_id": release}


PROFILE_ROW = {"gender": "Mixed", "trust_code": "4321", "trust_name": "Sample Trust", "capacity": 420,
               "pupils": 399, "census_date": "2026-01-15", "source_release_id": "src-gias-profile-20261015"}


class NationalRankTests(unittest.TestCase):
    def test_latest_year_headline_line_and_history(self):
        rank_rows = [rank("2023/24", 2101, 15074, 14), rank("2024/25", 1234, 15057, 9)]
        out = school_card.national_rank("primary", rank_rows)
        self.assertEqual((out["rank"], out["total"], out["topPercent"], out["year"]), (1234, 15057, 9, "2024/25"))
        self.assertEqual(out["line"], "Ranked 1,234 of 15,057 primaries in England, 2024/25 (top 9%)")
        self.assertEqual([p["academicYear"] for p in out["history"]], ["2023/24", "2024/25"])
        self.assertIn("reading, writing and maths", out["measure"])
        self.assertIsNone(out["missingReason"])

    def test_not_ranked_in_the_latest_year_says_why_and_keeps_history(self):
        out = school_card.national_rank("primary", [rank("2023/24", 2101, 15074, 14)])
        self.assertIsNone(out["rank"])
        self.assertIsNone(out["line"])
        self.assertEqual(out["missingReason"], "Not ranked for 2024/25: no published figure for this school")
        self.assertEqual(len(out["history"]), 1)
        no_rows = [{**{k: None for k in rank("x", 1, 1, 1)}, "latest_year": "2024/25"}]
        self.assertEqual(school_card.national_rank("primary", no_rows)["history"], [])

    def test_nothing_loaded_is_none(self):
        self.assertIsNone(school_card.national_rank("primary", []))
        self.assertIsNone(school_card.national_rank("primary", [{**rank("x", 1, 1, 1), "latest_year": None}]))

    def test_sql_reads_the_active_release_and_the_phase(self):
        sql = school_card.NATIONAL_RANK_SQL
        self.assertIn("active_product_release", sql)
        self.assertIn("o.phase = %(phase)s", sql)
        self.assertTrue(sql.startswith("-- evidence:school-national-rank"))


class SixthFormRankTests(unittest.TestCase):
    ROW = {"england_rank": 45, "england_pool": 2600, "academic_year": "2024/25", "value": 47.89,
           "tiebreak_value": 45.0, "cohort_size": 72, "london_rank": 12, "london_pool": 480,
           "source_release_id": "src-dfe-cscp-ks5-2024-25"}

    def test_line_selection_note_and_both_pools(self):
        out = school_card.sixth_form_rank([self.ROW])
        self.assertEqual(out["line"], "#12 of 480 London sixth forms, state and independent, 2024/25")
        self.assertEqual((out["regionRank"], out["regionPool"], out["englandRank"], out["englandPool"]),
                         (12, 480, 45, 2600))
        self.assertEqual(out["measureId"], "ks5-alevel-aps")
        self.assertEqual(out["cohortSize"], 72)
        self.assertIn("choose their pupils", out["selectionNote"])
        self.assertEqual(out["sourceRelease"], "src-dfe-cscp-ks5-2024-25")

    def test_no_row_is_none(self):
        self.assertIsNone(school_card.sixth_form_rank([]))
        self.assertIsNone(school_card.sixth_form_rank([{**self.ROW, "london_rank": None}]))

    def test_sql_reads_the_active_release_and_latest_year(self):
        sql = school_card.SIXTH_FORM_RANK_SQL
        self.assertIn("active_product_release", sql)
        self.assertIn("school_sixth_form_rank", sql)
        self.assertIn("max(academic_year)", sql)
        self.assertTrue(sql.startswith("-- evidence:school-sixth-form-rank"))


class ProfileTests(unittest.TestCase):
    def test_gias_facts_and_latest_shares_with_year_and_source(self):
        series = {"census-girls-percent": [point("2023/24", 49.0), point("2024/25", 48.2)],
                  "absence-persistent-percent": [point("2024/25", None, suppressed=True)]}
        out = school_card.profile(PROFILE_ROW, series)
        self.assertEqual(out["gias"]["trust"], {"name": "Sample Trust", "code": "4321"})
        self.assertEqual(out["gias"]["percentFull"], 95.0)
        self.assertEqual((out["girlsPercent"]["value"], out["girlsPercent"]["academicYear"]), (48.2, "2024/25"))
        self.assertEqual(out["persistentAbsencePercent"]["value"], None)
        self.assertTrue(out["persistentAbsencePercent"]["suppressed"])
        self.assertIsNone(out["ealPercent"])
        self.assertIsNone(out["pupilsPerTeacher"])

    def test_girls_school_with_boys_in_the_sixth_form(self):
        # /school/136551 Newstead Wood: GIAS Girls, has a sixth form, boys 9.11% of pupils in the 2024/25 census.
        series = {"census-girls-percent": [point("2024/25", 90.89)],
                  "census-boys-percent": [point("2023/24", 7.8), point("2024/25", 9.11)]}
        girls = {**PROFILE_ROW, "gender": "Girls"}
        self.assertEqual(school_card.profile(girls, series, None, "Has a sixth form")["intake"],
                         {"label": "Girls · mixed sixth form", "mixedSixthForm": True})
        self.assertEqual(school_card.profile(girls, series, None, "Does not have a sixth form")["intake"],
                         {"label": "Girls", "mixedSixthForm": False})
        self.assertEqual(school_card.profile(girls, {}, None, "Has a sixth form")["intake"]["label"], "Girls")
        self.assertEqual(school_card.profile(PROFILE_ROW, series, None, "Has a sixth form")["intake"]["label"], "Mixed")
        self.assertIsNone(school_card.profile(None, series, None, "Has a sixth form")["intake"])

    def test_no_gias_row_or_capacity_is_null_not_zero(self):
        self.assertIsNone(school_card.profile(None, {})["gias"])
        out = school_card.profile({**PROFILE_ROW, "capacity": None, "trust_name": None}, {})
        self.assertIsNone(out["gias"]["percentFull"])
        self.assertIsNone(out["gias"]["trust"])


class InspectionCountTests(unittest.TestCase):
    def test_report_card_areas_above_and_below_expected(self):
        inspection = {**report_card({"Inclusion": "Strong standard", "Achievement": "Expected standard",
                                     "Attendance and behaviour": "Needs attention",
                                     "Leadership and governance": "Exceptional"}),
                      "inspectedUrn": URN, "improveText": "Leaders should A.\nLeaders should B.\n"}
        out = school_card.inspection_counts(URN, [inspection])
        self.assertEqual((out["framework"], out["graded"], out["strengths"], out["weaknesses"]),
                         ("report-card", 4, 2, 1))
        self.assertEqual(out["weaknessAreas"], ["Attendance and behaviour"])
        self.assertEqual((out["safeguarding"], out["improvePoints"]), ("Met", 2))

    def test_legacy_judgements_skip_aggregates_and_ungraded_visits(self):
        graded = {**legacy(2, judgements={"Quality of education": 2, "Behaviour and attitudes": 3,
                                          "Pupils' achievement (aggregated)": 3, "Safeguarding is effective": "Yes"}),
                  "improveText": "• Do A. • Do B. • Do C."}
        ungraded = legacy(None, start="2025-03-01", framework="eif-2024-no-overall")
        out = school_card.inspection_counts(URN, [ungraded, graded])
        self.assertEqual((out["framework"], out["graded"], out["strengths"], out["weaknesses"]), ("legacy", 2, 1, 1))
        self.assertEqual((out["safeguarding"], out["improvePoints"]), ("Yes", 3))

    def test_no_improve_text_is_unknown_not_zero(self):
        out = school_card.inspection_counts(URN, [legacy(1, judgements={"Quality of education": 1})])
        self.assertIsNone(out["improvePoints"])
        self.assertIsNone(school_card.inspection_counts(URN, [legacy(None)]))


class OversubscriptionTests(unittest.TestCase):
    def test_every_entry_year_with_first_choices_not_offered(self):
        out = school_card.admissions(HISTORY)
        self.assertEqual([(r["entryYear"], r["firstChoiceNotOfferedPercent"]) for r in out["byYear"]],
                         [(2026, 49.5), (2025, 38.9)])
        self.assertEqual(out["demand"][0]["firstChoiceNotOfferedPercent"], 49.5)
        self.assertIn("1 − first-preference offers ÷ first preferences", out["oversubscriptionDefinition"])

    def test_missing_or_inconsistent_counts_give_no_figure(self):
        history = {"demand": [
            {"entryYear": 2026, "entryPoint": "year7", "firstPreferences": 0, "firstPreferenceOffers": 0,
             "anyPreferences": 0, "offers": 0, "pan": None},
            {"entryYear": 2025, "entryPoint": "year7", "firstPreferences": 10, "firstPreferenceOffers": None,
             "anyPreferences": 30, "offers": 20, "pan": None},
            {"entryYear": 2024, "entryPoint": "year7", "firstPreferences": 10, "firstPreferenceOffers": 12,
             "anyPreferences": 30, "offers": 20, "pan": None}]}
        self.assertEqual([r["firstChoiceNotOfferedPercent"] for r in school_card.admissions(history)["byYear"]],
                         [None, None, None])


PARENT_VIEW_ROW = {
    "survey": "2025-11", "period_start": "2025-11-10", "as_at": "2026-04-06", "submissions": 122,
    "response_rate": 28.77, "source_release_id": "src-ofsted-parent-view-2026-04-06",
    "answers": {
        "Q10": {"question": "Would you recommend this school to another parent?", "options": {"Yes": 95.08, "No": 4.92}},
        "Q1": {"question": "My child is happy at this school",
               "options": {"Strongly agree": 75.41, "Agree": 20.49, "Disagree": 0.82, "Don't know": 0.0}},
        "Q4a": {"question": "Has your child been bullied at this school?", "options": {"Yes": 14.75, "No": 85.25}},
        "Q11": {"question": "Your overall view of the school", "options": {"Positive": 91.7, "Negative": 3.3}},
    },
}
WORKFORCE_ROW = {
    "urn": URN, "academic_year": "2025/26", "teachers_fte": 21.6, "teaching_assistants_fte": 8.8,
    "leadership_teachers_fte": 4.0, "support_staff_fte": 13.61, "workforce_fte": 35.21, "workforce_headcount": 41,
    "teachers_headcount": 23, "pupils_fte": 424.5, "pupils_per_teacher": 19.7, "pupils_per_adult": 13.6,
    "source_release_id": "src-dfe-school-workforce-2025",
}


def finance_row(accounts="CFR", **changes):
    row = {"urn": URN, "accounts": accounts, "period": "2025-26" if accounts == "CFR" else "2024-25",
           "period_months": 12, "pupils_fte": 424.5, "revenue_reserve": 360337, "in_year_balance": 22001,
           "grant_funding": 3044993, "self_generated_income": 188577, "total_income": 3233570,
           "staff_costs": 2196104, "premises_costs": 431576, "total_expenditure": 3211569,
           "not_supplied_reason": None, "federation_lead_urn": None, "trust_kind": None,
           "trust_company_number": None, "trust_name": None, "trust_revenue_reserve": None, "trust_academies": None,
           "source_release_id": f"src-dfe-{accounts.lower()}"}
    return {**row, **changes}


def destination_row(stage, **changes):
    row = {"stage": stage, "cohort_year": "2023/24", "cohort": 104, "version": "Provisional", "reported_urn": URN,
           "sustained_percent": 99.0, "education_percent": 99.0,
           "higher_education_percent": 92.3 if stage == "16-18" else None, "apprenticeship_percent": 0.0,
           "employment_percent": 0.0, "not_sustained_percent": 1.0, "unknown_percent": 0.0,
           "source_release_id": f"src-dfe-{stage}-destinations"}
    return {**row, **changes}


class ParentViewTests(unittest.TestCase):
    def test_happy_and_recommend_from_q1_and_q10_with_count_and_date(self):
        out = school_card.parent_view(PARENT_VIEW_ROW)
        self.assertEqual((out["happyPercent"], out["recommendPercent"], out["responses"]), (95.9, 95.1, 122))
        self.assertEqual(out["agreePercent"], out["happyPercent"])  # the field the card component reads
        self.assertEqual(out["line"], "95.9% say their child is happy · 122 responses, as at 6 Apr 2026")
        self.assertEqual(out["period"], "10 Nov 2025 to 6 Apr 2026")
        self.assertEqual([q["id"] for q in out["questions"]], ["Q1", "Q4a", "Q10", "Q11"])
        self.assertEqual({q["id"]: q["headline"] for q in out["questions"]},
                         {"Q1": "agree", "Q4a": "yes", "Q10": "yes", "Q11": "positive"})
        self.assertEqual(out["questions"][0]["answers"]["Disagree"], 0.82)  # as published, not rounded

    def test_earlier_survey_is_labelled_and_recommend_is_found_by_its_question(self):
        row = {**PARENT_VIEW_ROW, "survey": "pre-2025-11", "period_start": "2023-09-04", "as_at": "2024-09-02",
               "source_release_id": "src-ofsted-parent-view-2024-09-02", "answers": {
                   "Q1": PARENT_VIEW_ROW["answers"]["Q1"],
                   "Q10": {"question": "The school lets me know how my child is doing",
                           "options": {"Strongly agree": 40.0, "Agree": 30.0}},
                   "Q14": {"question": "I would recommend this school to another parent",
                           "options": {"Yes": 98.67, "No": 1.33}}}}
        out = school_card.parent_view(row)
        self.assertEqual((out["surveyEra"], out["surveyLabel"], out["asAt"], out["responses"]),
                         ("earlier", "Earlier survey (before Nov 2025)", "2024-09-02", 122))
        self.assertEqual(out["recommendPercent"], 98.7)  # Q14 Yes, not Q10
        self.assertEqual(school_card.parent_view(PARENT_VIEW_ROW)["surveyEra"], "current")

    def test_not_applicable_is_left_out_of_the_agree_share_and_kept_on_its_own(self):
        # 101912's earlier survey, Q4 as published: 26.55% agree of everyone, 62.83% Not applicable.
        q4 = {"question": "My child has been bullied and the school dealt with the bullying quickly and effectively",
              "options": {"Strongly agree": 17.26, "Agree": 9.29, "Disagree": 2.21, "Strongly disagree": 1.77,
                          "Don't know": 6.64, "Not applicable": 62.83}}
        q7 = {"question": "When I have raised concerns, they were dealt with well",
              "options": {"Strongly agree": 30.0, "Agree": 20.0, "Disagree": 10.0, "I have not raised any concerns": 40.0}}
        out = school_card.parent_view({**PARENT_VIEW_ROW, "answers": {"Q4": q4, "Q7": q7, "Q1": PARENT_VIEW_ROW["answers"]["Q1"]}})
        by_id = {q["id"]: q for q in out["questions"]}
        self.assertEqual(by_id["Q4"]["headlinePercent"], 71.4)  # 26.55 / 37.17
        self.assertEqual(by_id["Q4"]["notApplicable"], {"option": "Not applicable", "percent": 62.83})
        self.assertEqual(by_id["Q7"]["headlinePercent"], 83.3)  # 50 / 60
        self.assertEqual(by_id["Q7"]["notApplicable"]["option"], "I have not raised any concerns")
        self.assertIsNone(by_id["Q1"]["notApplicable"])
        self.assertEqual(by_id["Q1"]["headlinePercent"], 95.9)  # Don't know stays in

    def test_the_newest_survey_is_read_and_never_both(self):
        sql = school_card.EXTRA_SQL["parentView"]
        self.assertIn("ORDER BY o.survey = '2025-11' DESC LIMIT 1", sql)

    def test_not_published_is_null_and_explained(self):
        self.assertIsNone(school_card.parent_view(None))
        loaded = {"parent_view": True}
        reasons = {m["measure"]: m["reason"]
                   for m in school_card.card(SCHOOL_ROW, HISTORY, london(), "r", extras={"loaded": loaded})["missing"]}
        self.assertIn("10 or more responses", reasons["parent-view"])

    def test_not_loaded_never_claims_the_publisher_left_the_school_out(self):
        # Before migration 056's loads run (or for a source the active release lacks), every empty row
        # says "not loaded"; only a loaded source may say the school is not in it.
        reasons = {m["measure"]: m["reason"] for m in school_card.card(SCHOOL_ROW, HISTORY, london(), "r")["missing"]}
        self.assertEqual(reasons["parent-view"], "Ofsted Parent View is not loaded")
        self.assertEqual(reasons["workforce"], "School workforce census is not loaded")
        self.assertEqual(reasons["finance"], "Maintained school accounts (CFR) are not loaded")
        academy = {**SCHOOL_ROW, "attributes": {**(SCHOOL_ROW["attributes"] or {}), "type": "Academy Converter"}}
        loaded = {"parent_view": True, "workforce": True, "finance_cfr": True, "finance_aar": False}
        reasons = {m["measure"]: m["reason"]
                   for m in school_card.card(academy, HISTORY, london(), "r", extras={"loaded": loaded})["missing"]}
        self.assertEqual(reasons["finance"], "Academy accounts (AAR) are not loaded")
        self.assertEqual(reasons["workforce"], "Not in the latest school workforce census")
        reasons = {m["measure"]: m["reason"] for m in school_card.card(
            SCHOOL_ROW, HISTORY, london(), "r", extras={"loaded": loaded})["missing"]}
        self.assertEqual(reasons["finance"], "No CFR return published for this school")
        secondary = school_card.destinations("secondary", [])
        built = {"parentView": None, "workforce": None, "finance": None, "destinations": secondary}
        self.assertIn({"measure": "destinations", "reason": "Destination measures are not loaded"},
                      school_card.extra_missing("secondary", built))
        self.assertIn({"measure": "destinations", "reason": "Destinations: not published for this school"},
                      school_card.extra_missing("secondary", built, {"destinations": True}))


class WorkforceTests(unittest.TestCase):
    def test_figures_as_published_with_year_and_source(self):
        out = school_card.workforce(WORKFORCE_ROW)
        self.assertEqual((out["teachersFte"], out["teachingAssistantsFte"], out["pupilsPerTeacher"],
                          out["pupilsPerAdult"], out["workforceHeadcount"]), (21.6, 8.8, 19.7, 13.6, 41))
        self.assertEqual(out["academicYear"], "2025/26")
        self.assertIsNone(school_card.workforce(None))

    def test_profile_takes_pupils_per_teacher_from_the_census(self):
        out = school_card.profile(None, {}, WORKFORCE_ROW)
        self.assertEqual(out["pupilsPerTeacher"], {"value": 19.7, "academicYear": "2025/26",
                                                   "sourceRelease": "src-dfe-school-workforce-2025"})


class FinanceTests(unittest.TestCase):
    def test_maintained_school_per_pupil_from_the_same_return(self):
        out = school_card.finance([finance_row()], "Community School")
        self.assertEqual((out["accounts"], out["periodLabel"]), ("CFR", "April 2025 to March 2026"))
        self.assertEqual(out["revenueReservePerPupil"], round(360337 / 424.5))
        self.assertEqual(out["incomePerPupil"], {"grants": 7173, "selfGenerated": 444, "total": 7617})
        self.assertEqual(out["spendPerPupil"], {"staff": 5173, "premises": 1017, "total": 7566})
        self.assertFalse(out["inDeficit"])

    def test_one_kind_of_accounts_only_never_both(self):
        rows = [finance_row("CFR"), finance_row("AAR", revenue_reserve=-5000)]
        self.assertEqual(school_card.finance(rows, "Academy Converter")["accounts"], "AAR")
        self.assertEqual(school_card.finance(rows, "Voluntary Aided School")["accounts"], "CFR")
        self.assertTrue(school_card.finance(rows, "Free School")["inDeficit"])
        self.assertEqual(school_card.finance([finance_row("CFR")], "Academy Converter")["accounts"], "CFR")
        self.assertIsNone(school_card.finance([], "Community School"))

    def test_part_year_return_has_no_per_pupil_income_or_spend(self):
        out = school_card.finance([finance_row("AAR", period_months=6)], "Academy Converter")
        self.assertTrue(out["partialYear"])
        self.assertEqual(out["spendPerPupil"], {"staff": None, "premises": None, "total": None})
        self.assertEqual(out["inYearBalance"], 22001.0)

    def test_trust_reserve_for_a_multi_academy_trust(self):
        row = finance_row("AAR", trust_kind="MAT", trust_name="A TRUST", trust_company_number="123",
                          trust_academies=8, trust_revenue_reserve=2627000)
        trust = school_card.finance([row], "Academy Sponsor Led")["trust"]
        self.assertEqual((trust["kind"], trust["academies"], trust["revenueReserve"]), ("MAT", 8, 2627000.0))
        self.assertIn("belong to the trust", trust["note"])

    def test_federated_school_without_its_own_return_says_why(self):
        row = finance_row(**{k: None for k in ("revenue_reserve", "in_year_balance", "grant_funding",
                                               "self_generated_income", "total_income", "staff_costs",
                                               "premises_costs", "total_expenditure")},
                          federation_lead_urn="100234", not_supplied_reason="Reported with its federation")
        out = school_card.finance([row], "Community School")
        self.assertEqual((out["revenueReserve"], out["inDeficit"], out["federation"]["isLead"]), (None, None, False))
        missing = school_card.extra_missing("primary", {"parentView": None, "workforce": None, "finance": out,
                                                        "destinations": None})
        self.assertIn({"measure": "finance", "reason": "Reported with its federation"}, missing)


class DestinationTests(unittest.TestCase):
    def test_secondary_destinations_with_cohort_and_years(self):
        out = school_card.destinations("secondary", [destination_row("ks4"), destination_row("16-18")])
        self.assertEqual((out["ks4"]["sustainedPercent"], out["ks4"]["cohortYear"], out["ks4"]["destinationYear"]),
                         (99.0, "2023/24", "2024/25"))
        self.assertEqual(out["post16"]["higherEducationPercent"], 92.3)

    def test_primary_has_no_destinations_section(self):
        self.assertIsNone(school_card.destinations("primary", [destination_row("ks4")]))
        payload = school_card.card(SCHOOL_ROW, HISTORY, london(), "r", extras={"workforce": WORKFORCE_ROW})
        self.assertIsNone(payload["destinations"])
        self.assertNotIn("destinations", [m["measure"] for m in payload["missing"]])
        self.assertEqual(payload["workforce"]["teachersFte"], 21.6)

    def test_missing_stage_is_explained(self):
        out = school_card.destinations("secondary", [destination_row("ks4")])
        missing = school_card.extra_missing("secondary", {"parentView": None, "workforce": None, "finance": None,
                                                          "destinations": out}, {"destinations": True})
        self.assertIn("destinations-post16", [m["measure"] for m in missing])
        self.assertNotIn("destinations-ks4", [m["measure"] for m in missing])


class CardConnection:
    def __init__(self, school_rows):
        self.school_rows = school_rows
        self.calls = []

    def execute(self, sql, params=()):
        marker = sql.splitlines()[0].removeprefix("-- evidence:")
        self.calls.append(marker)
        if sql is evidence.ACTIVE_RELEASE_SQL:
            return [{"release_id": "rel-test"}]
        if marker == "school-card":
            return self.school_rows
        if marker == "school-card-pool":
            return ranked("primary", "ks2-rwm-expected", "2024/25", {URN: 1.0, "200001": 2.0})
        if marker == "sixth-form-rank-table":
            return [{"t": False}]
        return []


class ReaderTests(unittest.TestCase):
    def reader(self, connection):
        return evidence.EvidenceReader(connect=lambda: contextlib.nullcontext(connection))

    def test_reader_builds_the_card(self):
        connection = CardConnection([SCHOOL_ROW])
        payload = self.reader(connection).school_card(URN)
        self.assertEqual((payload["schemaVersion"], payload["productReleaseId"]), ("school-card.v1", "rel-test"))
        self.assertIn("school-card-pool", connection.calls)
        self.assertIn("school-national-rank", connection.calls)
        self.assertIn("school-profile", connection.calls)
        for marker in ("school-parent-view", "school-workforce", "school-finance", "school-destinations",
                       "school-extra-loaded"):
            self.assertIn(marker, connection.calls)
        self.assertIsNone(payload["parentView"])
        self.assertIn("finance", [m["measure"] for m in payload["missing"]])
        self.assertIsNone(payload["nationalRank"])
        self.assertEqual(payload["topBadge"]["missingReason"], "No results published for 2024/25")

    def test_unknown_and_malformed_urn(self):
        with self.assertRaises(evidence.SchoolNotFound):
            self.reader(CardConnection([])).school_card(URN)
        with self.assertRaises(evidence.MalformedQuery):
            self.reader(CardConnection([])).school_card("12; drop")

    def test_top_badges_for_a_list(self):
        badges = school_card.top_badges(CardConnection([]), "rel-test", [{"urn": URN, "phase": "primary"}])
        self.assertFalse(badges[URN]["isTop"])
        self.assertEqual(badges[URN]["missingReason"], "No results published for 2024/25")
        self.assertEqual(school_card.top_badges(CardConnection([]), "rel-test", []), {})

    def test_school_index_for_the_sitemap(self):
        connection = CardConnection([])
        rows = [{"urn": URN, "name": "A", "phase": "primary", "borough": "Hackney", "successor_urn": None,
                 "has_evidence": True},
                {"urn": "200001", "name": "B", "phase": "secondary", "successor_urn": "200002", "has_evidence": False}]
        connection.execute = lambda sql, params=(): ([{"release_id": "rel-test"}] if sql is evidence.ACTIVE_RELEASE_SQL
                                                     else rows if sql == schools.scoped(school_card.SCHOOL_INDEX_SQL) else [])
        payload = self.reader(connection).school_index()
        self.assertEqual((payload["schemaVersion"], payload["productReleaseId"]), ("school-index.v1", "rel-test"))
        self.assertEqual(payload["schools"][0], {"urn": URN, "name": "A", "phase": "primary", "borough": "Hackney",
                                                 "successorUrn": None, "hasEvidence": True})
        self.assertIsNone(payload["schools"][1]["borough"])
        self.assertFalse(payload["schools"][1]["hasEvidence"])

    def test_school_points_for_the_map(self):
        from area_api import schools

        connection = CardConnection([])
        rows = [{"urn": URN, "name": "A", "phase": "primary", "latitude": 51.5012345678, "longitude": -0.1412345678}]
        connection.execute = lambda sql, params=(): ([{"release_id": "rel-test"}] if sql is evidence.ACTIVE_RELEASE_SQL
                                                     else rows if sql == schools.scoped(schools.SCHOOL_POINTS_SQL)
                                                     else [{"t": False}] if sql is schools.INDEPENDENT_TABLE_SQL else [])
        payload = self.reader(connection).school_points()
        self.assertEqual((payload["schemaVersion"], payload["productReleaseId"]), ("school-points.v1", "rel-test"))
        self.assertEqual(payload["schools"], [{"urn": URN, "name": "A", "phase": "primary", "kind": "state",
                                               "stage": "primary", "latitude": 51.501235, "longitude": -0.141235}])
        self.assertIn("successor_urn IS NULL", schools.SCHOOL_POINTS_SQL)

    def test_school_points_add_independent_schools_once_migration_067_is_in(self):
        from area_api import schools

        connection = CardConnection([])
        independent = [{"urn": "100001", "name": "City of London School for Girls", "age_from": 10, "age_to": 18,
                        "gender": "Girls", "religious_character": None, "sixth_form": True,
                        "latitude": 51.52, "longitude": -0.09}]
        connection.execute = lambda sql, params=(): ([{"release_id": "rel-test"}] if sql is evidence.ACTIVE_RELEASE_SQL
                                                     else [{"t": True}] if sql is schools.INDEPENDENT_TABLE_SQL
                                                     else [{"t": False}] if sql is schools.SIXTH_FORM_RANK_TABLE_SQL
                                                     else independent if sql == schools.scoped(schools.INDEPENDENT_POINTS_SQL_BASIC)
                                                     else [])
        payload = self.reader(connection).school_points()
        self.assertEqual(payload["schools"], [{
            "urn": "100001", "name": "City of London School for Girls", "phase": "secondary", "kind": "independent",
            "stage": "secondary", "latitude": 51.52, "longitude": -0.09, "sixthForm": True, "intake": "Girls"}])
        self.assertIn("source_release_id IN", schools.INDEPENDENT_POINTS_SQL)

    def test_school_points_independent_carries_the_combined_a_level_rank(self):
        from area_api import schools

        connection = CardConnection([])
        independent = [{"urn": "101954", "name": "Notting Hill & Ealing High School GDST", "age_from": 11,
                        "age_to": 18, "gender": "Girls", "religious_character": None, "sixth_form": True,
                        "latitude": 51.51, "longitude": -0.21,
                        "alevel_rank": 12, "alevel_pool": 480, "alevel_year": "2024/25"}]
        connection.execute = lambda sql, params=(): ([{"release_id": "rel-test"}] if sql is evidence.ACTIVE_RELEASE_SQL
                                                     else [{"t": True}] if sql is schools.INDEPENDENT_TABLE_SQL
                                                     else [{"t": True}] if sql is schools.SIXTH_FORM_RANK_TABLE_SQL
                                                     else independent if sql == schools.scoped(schools.INDEPENDENT_POINTS_SQL)
                                                     else [])
        payload = self.reader(connection).school_points()
        self.assertEqual(payload["schools"], [{
            "urn": "101954", "name": "Notting Hill & Ealing High School GDST", "phase": "secondary",
            "kind": "independent", "stage": "secondary", "latitude": 51.51, "longitude": -0.21,
            "sixthForm": True, "intake": "Girls",
            "aLevelRank": {"rank": 12, "pool": 480, "year": "2024/25",
                           "note": schools.SIXTH_FORM_SELECTION_NOTE}}])


class SchoolPointTests(unittest.TestCase):
    """What a school's map icon and popup carry (Fixes 23, 25, 31)."""

    ROW = {"urn": "136551", "name": "Newstead Wood School", "phase": "secondary", "latitude": 51.37, "longitude": 0.07,
           "age_from": "11", "age_to": "18", "selectivity": "Selective", "faith": None,
           "sixth_form": "Has a sixth form", "report_card": False, "legacy_grade": "Outstanding", "top_percent": 4,
           "rank_year": "2024/25", "london_rank": 12, "london_pool": 512, "gender": "Girls", "other_sex_percent": 9.11}

    def test_newstead_wood(self):
        from area_api import schools

        self.assertEqual(schools.state_point(self.ROW), {
            "urn": "136551", "name": "Newstead Wood School", "phase": "secondary", "kind": "state",
            "stage": "secondary", "latitude": 51.37, "longitude": 0.07, "ofsted": "outstanding", "topPercent": 4,
            "rankYear": "2024/25", "regionRank": 12, "regionPool": 512, "selective": True, "sixthForm": True, "intake": "Girls · mixed sixth form",
            # Schools filter v2: England top % at any value, for the measure filter and the marker colours.
            "measures": {"englandTopPercent": [4.0, "2024/25"]}})

    def test_independent_point_carries_the_combined_a_level_rank(self):
        from area_api import schools

        row = {"urn": "101954", "name": "Notting Hill & Ealing High School GDST", "age_from": 11, "age_to": 18,
               "gender": "Girls", "religious_character": None, "sixth_form": True,
               "latitude": 51.51, "longitude": -0.21,
               "alevel_rank": 12, "alevel_pool": 480, "alevel_year": "2024/25"}
        self.assertEqual(schools.independent_point(row), {
            "urn": "101954", "name": "Notting Hill & Ealing High School GDST", "phase": "secondary",
            "kind": "independent", "stage": "secondary", "latitude": 51.51, "longitude": -0.21,
            "sixthForm": True, "intake": "Girls",
            "aLevelRank": {"rank": 12, "pool": 480, "year": "2024/25",
                           "note": schools.SIXTH_FORM_SELECTION_NOTE}})
        self.assertNotIn("aLevelRank",
                         schools.independent_point({**row, "alevel_rank": None, "alevel_pool": None}))

    def test_report_card_wins_and_low_ranks_carry_no_ribbon(self):
        from area_api import schools

        point = schools.state_point({**self.ROW, "report_card": True, "top_percent": 26})
        self.assertEqual(point["ofsted"], "report-card")
        self.assertNotIn("topPercent", point)
        self.assertNotIn("rankYear", point)
        point = schools.state_point({**self.ROW, "legacy_grade": None, "top_percent": None, "london_rank": None})
        self.assertNotIn("ofsted", point)
        self.assertNotIn("regionRank", point)
        self.assertIn("rank() OVER (PARTITION BY r.phase, r.academic_year, sc.region_code ORDER BY r.rank) AS london_rank",
                      schools.SCHOOL_POINTS_SQL)
        self.assertEqual(schools.state_point({**self.ROW, "legacy_grade": "Requires improvement"})["ofsted"],
                         "requires-improvement")

    def test_ofsted_mark_is_the_cards_standing_inspection(self):
        from area_api import schools

        # An ungraded visit ("School remains Good") is skipped in SQL: the grade before it stands.
        standing = {**self.ROW, "legacy_grade": None, "report_card": False}
        self.assertEqual(schools.state_point({**standing, "standing_framework": "eif-2019", "standing_overall": 2})["ofsted"],
                         "good")
        self.assertEqual(schools.state_point({**standing, "standing_framework": "report-card-2025",
                                              "standing_overall": None})["ofsted"], "report-card")
        # 2024-25 graded areas or safeguarding not effective: no single grade, no badge.
        self.assertNotIn("ofsted", schools.state_point({**self.ROW, "standing_framework": "eif-2024-no-overall",
                                                        "standing_overall": None}))
        sql = schools.SCHOOL_POINTS_SQL
        self.assertIn("FROM school_inspection", sql)
        self.assertIn("ORDER BY urn, start_date DESC NULLS LAST, inspection_number DESC", sql)
        self.assertNotIn("%%", sql)

    def test_stage_faith_and_intake(self):
        from area_api import schools

        point = schools.state_point({**self.ROW, "phase": "secondary", "age_from": "3", "age_to": "18",
                                     "faith": "Roman Catholic", "selectivity": "Non-selective", "gender": "Mixed"})
        self.assertEqual((point["stage"], point["faith"]), ("all-through", "Roman Catholic"))
        self.assertNotIn("selective", point)
        self.assertNotIn("intake", point)
        self.assertNotIn("faith", schools.state_point({**self.ROW, "faith": "Unknown"}))
        self.assertEqual(schools.state_point({**self.ROW, "other_sex_percent": 0})["intake"], "Girls")
        self.assertEqual(schools.state_point({**self.ROW, "sixth_form": "Does not have a sixth form"})["intake"], "Girls")

    def test_school_stage(self):
        from area_api import schools

        self.assertEqual(schools.school_stage("primary", 3, 11), "primary")
        self.assertEqual(schools.school_stage("secondary", 4, 16), "all-through")
        self.assertEqual(schools.school_stage("secondary", 11, 18), "secondary")
        self.assertEqual(schools.school_stage(None, 4, 13), "primary")
        self.assertEqual(schools.school_stage(None, 2, 11), "primary")
        self.assertEqual(schools.school_stage(None, 3, 19), "all-through")
        self.assertEqual(schools.school_stage(None, 11, 16), "secondary")

    def test_intake_rule(self):
        from area_api import schools

        self.assertEqual(schools.intake("Girls", True, 9.11), {"label": "Girls · mixed sixth form", "mixedSixthForm": True})
        self.assertEqual(schools.intake("Boys", True, 3.0), {"label": "Boys · mixed sixth form", "mixedSixthForm": True})
        self.assertEqual(schools.intake("Boys", True, None), {"label": "Boys", "mixedSixthForm": False})
        self.assertEqual(schools.intake("Mixed", True, 50.0), {"label": "Mixed", "mixedSixthForm": False})
        self.assertIsNone(schools.intake(None, True, 9.0))



def compare_pool_row(measure, year, quantiles, n, borough=None, accounts=None, phase="primary"):
    return {"phase": phase, "measure": measure, "year": year, "accounts": accounts, "borough": borough,
            "london": borough is None, "quantiles": quantiles, "n": n}


COMPARE_POOL = school_card.ComparePool([
    compare_pool_row("pupils", "2026-01-15", [181.0, 366.0, 641.0], 1737),
    compare_pool_row("pupils", "2026-01-15", [300.0, 421.0, 500.0], 57, borough="Lambeth"),
    compare_pool_row("overallAbsencePercent", "2024/25", [3.8, 5.24, 7.1], 1752),
    compare_pool_row("overallAbsencePercent", "2024/25", [4.0, 5.0, 6.0], 9, borough="Lambeth"),
    compare_pool_row("incomePerPupil", "2025-26", [7306.4, 8965.0, 11547.0], 1118, accounts="CFR"),
    compare_pool_row("incomePerPupil", "2024-25", [7000.0, 8000.0, 9000.0], 900, accounts="AAR"),
])
COMPARE_ROWS = [
    {"measure": "pupils", "year": "2026-01-15", "accounts": None, "value": 646.0, "source_release_id": "gias"},
    {"measure": "overallAbsencePercent", "year": "2023/24", "accounts": None, "value": 4.6, "source_release_id": "a"},
    {"measure": "overallAbsencePercent", "year": "2024/25", "accounts": None, "value": 5.02,
     "source_release_id": "a"},
    {"measure": "incomePerPupil", "year": "2024-25", "accounts": "AAR", "value": 7500.4, "source_release_id": "aar"},
    {"measure": "incomePerPupil", "year": "2025-26", "accounts": "CFR", "value": 7246.3, "source_release_id": "cfr"},
]


class CompareTests(unittest.TestCase):
    def test_latest_year_against_london_and_a_borough_of_ten_or_more(self):
        out = school_card.compare("primary", "Lambeth", COMPARE_ROWS, COMPARE_POOL, "CFR")["measures"]
        self.assertEqual(out["pupils"], {
            "label": "Pupils on roll (GIAS, January census)", "unit": "count", "value": 646, "year": "2026-01-15",
            "london": {"p10": 181, "median": 366, "p90": 641, "n": 1737},
            "borough": {"name": "Lambeth", "median": 421, "n": 57}, "betterWhen": None, "sourceRelease": "gias",
            "scope": "London"})
        absence = out["overallAbsencePercent"]
        self.assertEqual((absence["value"], absence["year"], absence["london"]["median"], absence["betterWhen"]),
                         (5.02, "2024/25", 5.2, "lower"))
        self.assertIsNone(absence["borough"])  # 9 Lambeth schools: under 10, no borough median
        self.assertIsNone(out["pupilsPerTeacher"])  # no figure: nothing estimated

    def test_finance_only_within_the_accounts_the_card_shows(self):
        cfr = school_card.compare("primary", "Lambeth", COMPARE_ROWS, COMPARE_POOL, "CFR")["measures"]
        self.assertEqual((cfr["incomePerPupil"]["value"], cfr["incomePerPupil"]["accounts"],
                          cfr["incomePerPupil"]["london"]["p10"]), (7246, "CFR", 7306))
        aar = school_card.compare("primary", "Lambeth", COMPARE_ROWS, COMPARE_POOL, "AAR")["measures"]
        self.assertEqual((aar["incomePerPupil"]["value"], aar["incomePerPupil"]["year"],
                          aar["incomePerPupil"]["london"]["median"]), (7500, "2024-25", 8000))
        none = school_card.compare("primary", "Lambeth", COMPARE_ROWS, COMPARE_POOL, None)["measures"]
        self.assertIsNone(none["incomePerPupil"])

    def test_same_phase_only_and_on_the_card(self):
        out = school_card.compare("secondary", "Lambeth", COMPARE_ROWS, COMPARE_POOL, "CFR")["measures"]
        self.assertTrue(all(value is None for value in out.values()))
        card = school_card.card(SCHOOL_ROW, HISTORY, london(), "r",
                                extras={"comparePool": COMPARE_POOL, "compareRows": COMPARE_ROWS})
        self.assertEqual(card["compare"]["measures"]["pupils"]["value"], 646)
        self.assertEqual(card["compare"]["minBoroughSchools"], 10)
        self.assertIsNone(school_card.card(SCHOOL_ROW, HISTORY, london(), "r")["compare"])

    def test_compare_sql_reads_the_active_release_only(self):
        for sql in (school_card.COMPARE_POOL_SQL, school_card.COMPARE_SCHOOL_SQL):
            self.assertEqual(sql.count("active_product_release"), 5)
            self.assertNotIn("{active}", sql)


class EnglandScopeTests(unittest.TestCase):
    """Migration 110: schools rank within their region; with CLOSE_KNIT_ENGLAND off listings stay London's."""

    def test_flag_off_keeps_school_listings_to_london(self):
        import os
        from unittest import mock

        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "0"}):
            for sql in (schools.SCHOOL_SQL, schools.SCHOOL_POINTS_SQL, schools.AREA_SCHOOLS_SQL,
                        school_card.SCHOOL_INDEX_SQL, school_card.CARD_SCHOOL_SQL):
                self.assertIn("s.region_code IN ('E12000007')", schools.scoped(sql))
            self.assertIn("i.region_code IN ('E12000007')", schools.scoped(schools.INDEPENDENT_POINTS_SQL))
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "1"}):
            self.assertIs(schools.scoped(schools.SCHOOL_SQL), schools.SCHOOL_SQL)

    def test_a_regions_pool_names_its_copy_and_london_stays_london(self):
        rows = ranked("primary", "ks2-rwm-expected", "2024/25", {URN: 95.0, "200001": 50.0, "200002": 60.0})
        rows += ranked("primary", "ks2-rwm-higher", "2024/25", {URN: 48.0, "200001": 10.0, "200002": 20.0})
        north_west = school_card.Pool(rows, "E12000002")
        badge = school_card.top_badge(URN, "primary", SERIES, [legacy(2)], north_west)
        self.assertIn("of North West primaries", badge["reasons"][0])
        self.assertTrue(badge["line"].startswith("Top school: top 10% North West"))
        self.assertEqual(school_card.Pool(rows).scope, "London")
        self.assertIn("of London primaries",
                      school_card.top_badge(URN, "primary", SERIES, [legacy(2)], london())["reasons"][0])

    def test_pool_sql_is_one_regions_and_ranks_partition_by_region(self):
        self.assertIn("s.region_code = %s", school_card.POOL_SQL)
        self.assertIn("PARTITION BY region_code ORDER BY rank", schools.INDEPENDENT_POINTS_SQL)
        self.assertIn("(region_code, phase, measure, year, accounts, borough)", school_card.COMPARE_POOL_SQL)

    def test_non_london_points_carry_their_rank_scope(self):
        self.assertEqual(schools.point_scope({"region_code": "E12000003"}),
                         {"code": "E12000003", "name": "Yorkshire and The Humber"})
        self.assertIsNone(schools.point_scope({"region_code": "E12000007"}))
        self.assertIsNone(schools.point_scope({}))


if __name__ == "__main__":
    unittest.main()
