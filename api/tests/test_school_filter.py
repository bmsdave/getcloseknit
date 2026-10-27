"""Schools filter v2 (board Schools-filter-options): one compact filter for the map, the /schools hub and My match's
"near a school like this" place; the same text as web/src/lib/school-filter.ts."""
import unittest

from area_api import commute, home_search, matching, personal_places, school_filter, schools, share_links

POINTS = [
    {"urn": "100001", "kind": "state", "stage": "primary", "phase": "primary", "ofsted": "outstanding", "group": "academy",
     "measures": {"ks2RwmExpected": [84.0, "2024/25"], "fsm6Share": [9.0, "2024/25"]}},
    {"urn": "100002", "kind": "state", "stage": "primary", "phase": "primary", "ofsted": "good", "group": "community",
     "faith": "Roman Catholic", "measures": {"ks2RwmExpected": [66.0, "2024/25"], "fsm6Share": [41.0, "2024/25"]}},
    # No KS2 value (a small cohort): a threshold cannot vouch for it.
    {"urn": "100003", "kind": "state", "stage": "primary", "phase": "primary", "ofsted": "outstanding"},
    {"urn": "100004", "kind": "state", "stage": "secondary", "phase": "secondary", "ofsted": "good", "intake": "Girls",
     "measures": {"progress8": [0.42, "2023/24"], "englandTopPercent": [8.0, "2024/25"]}},
    {"urn": "100005", "kind": "independent", "stage": "secondary", "phase": "secondary", "intake": "Boys",
     "aLevelRank": {"rank": 3, "pool": 300, "year": "2024/25"}},
]


class CompactTextTests(unittest.TestCase):
    def test_round_trip_in_canonical_order(self):
        for text in ("on", "t.p", "t", "t.p.s_o.out.good", "o.rc_e.academy.free_g.girls_f.none_m.ks2.75",
                     "m.p8.-0.5", "m.top", "m.fsm.30_a", "t.x_a"):
            with self.subTest(text):
                self.assertEqual(school_filter.text(school_filter.parse(text)), text)

    def test_unknown_repeated_or_out_of_order_is_an_error(self):
        for text in ("", "x.1", "t.q", "o.great", "t.p_t.s", "o.out_t.p", "m.ks2.150", "m.p8.abc", "g.any", "a.1", "e"):
            with self.subTest(text), self.assertRaises(ValueError):
                school_filter.parse(text)

    def test_thresholds_print_like_javascript(self):
        value = {**school_filter.default(), "measure": {"id": "progress8", "threshold": 0.30000000000000004}}
        self.assertEqual(school_filter.text(value), "m.p8.0.3")
        self.assertEqual(school_filter.text({**value, "measure": {"id": "ks2RwmExpected", "threshold": 75.0}}), "m.ks2.75")


class MatchesTests(unittest.TestCase):
    def keep(self, text):
        return school_filter.school_set(POINTS, text)

    def test_default_keeps_every_school(self):
        self.assertEqual(len(self.keep("on")), len(POINTS))

    def test_a_threshold_drops_schools_without_the_measure(self):
        self.assertEqual(self.keep("t.p_m.ks2.75"), ["100001"])
        # Colour only (no threshold): nobody is dropped.
        self.assertEqual(self.keep("t.p_m.ks2"), ["100001", "100002", "100003"])

    def test_lower_is_better_measures_take_at_most(self):
        self.assertEqual(self.keep("m.top.10"), ["100004"])
        self.assertEqual(self.keep("m.fsm.30"), ["100001"])

    def test_ofsted_applies_to_state_schools_and_private_ones_pass_phase_and_intake(self):
        self.assertEqual(self.keep("o.good"), ["100002", "100004", "100005"])
        self.assertEqual(self.keep("t.x_g.boys"), ["100005"])
        self.assertEqual(self.keep("g.girls"), ["100004"])
        self.assertEqual(self.keep("f.faith"), ["100002"])
        self.assertEqual(self.keep("e.academy"), ["100001"])
        self.assertEqual(self.keep("a"), ["100005"])


class PointTests(unittest.TestCase):
    def test_points_carry_group_and_latest_measures(self):
        row = {"urn": "100001", "name": "A", "phase": "primary", "latitude": 51.5, "longitude": -0.1,
               "establishment_type": "Academy converter", "top_percent": 31.4, "rank_year": "2024/25",
               "measures": {"ks2-rwm-expected": [84.123, "2024/25"], "census-fsm6-percent": [9.0, "2024/25"]}}
        point = schools.state_point(row)
        self.assertEqual(point["group"], "academy")
        self.assertEqual(point["measures"], {"ks2RwmExpected": [84.12, "2024/25"], "fsm6Share": [9.0, "2024/25"],
                                             "englandTopPercent": [31.4, "2024/25"]})
        self.assertNotIn("topPercent", point)  # the plaque stops at Top 25%
        self.assertEqual(schools.establishment_group("Free schools 16 to 19"), "free")
        self.assertEqual(schools.establishment_group("Voluntary aided school"), "voluntary")
        self.assertIsNone(schools.establishment_group("Pupil referral unit"))
        self.assertIn("school_observation", schools.SCHOOL_POINTS_SQL)
        self.assertIn("'ks2-rwm-expected'", schools.SCHOOL_POINTS_SQL)


class FakeConnection:
    def __init__(self):
        self.statements = []

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        self.statements.append((marker, params))
        if marker == "-- evidence:school-points":
            return [{"urn": p["urn"], "name": p["urn"], "phase": p["phase"], "latitude": 51.5, "longitude": -0.1,
                     "age_from": 4 if p["phase"] == "primary" else 11, "age_to": 11 if p["phase"] == "primary" else 16,
                     "standing_framework": "legacy-overall",
                     "standing_overall": {"outstanding": 1, "good": 2}.get(p.get("ofsted")),
                     "measures": {"ks2-rwm-expected": [p["measures"]["ks2RwmExpected"][0], "2024/25"]}
                     if "ks2RwmExpected" in p.get("measures", {}) else None}
                    for p in POINTS if p["kind"] == "state"]
        if marker in ("-- evidence:independent-school-table", "-- evidence:sixth-form-rank-table"):
            return [{"t": False}]
        if marker == "-- evidence:place-nearest-school-set":
            return [{"geography_id": "near", "metres": 450.0}, {"geography_id": "far", "metres": 2600.0},
                    {"geography_id": "none", "metres": None}]
        if marker == "-- evidence:commute-area-schools":
            return [{"urn": "100001", "name": "Honeywell", "metres": 450.0}]
        raise AssertionError(marker)


class MyMatchTests(unittest.TestCase):
    def setUp(self):
        personal_places.clear_cache()

    def test_find_areas_takes_the_school_filter_object(self):
        args = home_search.FindAreasInput(
            max_budget=600_000, priorities=[{"factor": "crime", "importance": 3}],
            places=[{"label": "Good primary", "max_minutes": 15, "school": {
                "filter": {"phases": ["primary"], "ofsted": ["outstanding", "good"],
                           "measure": {"id": "ks2RwmExpected", "threshold": 75}},
                "within": 1000}}])
        profile = home_search.build_profile(args)
        matching.validate_match_request(profile)
        [place] = [item for item in profile["criteria"] if item["kind"] == "place"]
        self.assertEqual(place["target"], {"kind": "school-filter", "filter": "t.p_o.out.good_m.ks2.75", "within": 1000})
        self.assertEqual(place["mode"], "walk")
        self.assertIn("nearest school matching the filter", home_search._school_rule_caveats(profile)[0])

    def test_validation_wants_the_canonical_text(self):
        base = {"id": "s", "label": "School", "mode": "walk", "targetMinutes": 15, "weight": 3, "must": False}
        for target in ({"kind": "school-filter", "filter": "o.good_t.p"}, {"kind": "school-filter", "filter": "t.zz"},
                       {"kind": "school-filter", "filter": "on", "within": 20}):
            with self.subTest(target), self.assertRaises(matching.InvalidMatchRequest):
                matching.validate_places([{**base, "target": target}])
        matching.validate_places([{**base, "target": {"kind": "school-filter", "filter": "t.p_m.ks2.75", "within": 800}}])

    def test_nearest_matching_school_within_the_limit(self):
        connection = FakeConnection()
        metres = personal_places._nearest(connection, "rel", {"kind": "school-filter", "filter": "t.p_m.ks2.75", "within": 1000})
        self.assertEqual(metres, {"near": 450.0, "far": None, "none": None})
        [(_, params)] = [s for s in connection.statements if s[0] == "-- evidence:place-nearest-school-set"]
        self.assertEqual(params, (["100001"],))  # only the school with KS2 ≥ 75%
        # Without a limit the far area keeps its school; the set is read once per release.
        self.assertEqual(personal_places._nearest(connection, "rel", {"kind": "school-filter", "filter": "t.p_m.ks2.75"})["far"], 2600.0)
        self.assertEqual(sum(1 for s in connection.statements if s[0] == "-- evidence:school-points"), 1)

    def test_area_page_names_the_nearest_matching_school(self):
        place = {"id": "s", "label": "Good primary", "target": {"kind": "school-filter", "filter": "t.p_m.ks2.75"},
                 "mode": "walk", "targetMinutes": 15, "weight": 3, "must": False}
        [entry] = commute.local_places(FakeConnection(), "rel", "a", [place])
        self.assertEqual(entry["nearest"], {"name": "Honeywell", "metres": 450})

    def test_the_place_survives_share_links(self):
        place = {"id": "s", "label": "Good primary", "target": {"kind": "school-filter", "filter": "t.p_m.ks2.75", "within": 800},
                 "mode": "walk", "targetMinutes": 15, "weight": 3, "must": False}
        self.assertEqual(share_links._unpack_target(share_links._pack_place(place)), place["target"])
        self.assertEqual(share_links._unpack_v3_target(share_links._pack_target(place["target"])), place["target"])
        bare = {"kind": "school-filter", "filter": "on"}
        self.assertEqual(share_links._unpack_v3_target(share_links._pack_target(bare)), bare)


if __name__ == "__main__":
    unittest.main()
