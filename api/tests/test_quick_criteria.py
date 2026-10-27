"""Quick My match criteria (migration 028): noise, visible disorder, EPC A-C share, leasehold share,
top schools by Progress 8 and the nearest step-free station."""
import unittest

from area_api import brief, home_search, matching, personal_places, quick_criteria, scope, share_links


def _profile(factors, **extra):
    return {"schemaVersion": "preference-profile.v1", "market": "buy", "targetBudget": 500_000,
            "maximumBudget": 700_000, "bedrooms": 2, "forecastHorizon": "1y", "commuteDestinations": [],
            "analyticsConsent": False,
            "school": {"phases": [], "characteristics": [], "facetWeights": {}, "shortlistUrns": [], "desiredSchoolCount": 3},
            "factors": [{"factorId": f, "weight": w, "direction": d, "minimumUtility": None, "maximumUtility": None}
                        for f, w, d in factors], **extra}


class FakeQuickConnection:
    def __init__(self):
        self.statements = []

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        self.statements.append(marker)
        if marker == "-- evidence:quick-noise":
            return [{"geography_id": g, "name": g, "raw_value": v, "road_55_share": road, "rail_55_share": 0.05,
                     "air_55_share": 0.0, "dwellings": 300, "carrier_geography_id": g, "source_release_id": "noise"}
                    for g, v, road in (("a", 20.0, 0.2), ("b", 60.0, 0.58), ("c", 40.0, 0.4))]
        if marker == "-- evidence:quick-epc":
            return [{"geography_id": "a", "name": "a", "raw_value": 62.5, "homes_rated": 400, "rated_a_to_c": 250,
                     "carrier_geography_id": "a", "source_release_id": "epc"}]
        if marker == "-- evidence:quick-leasehold":
            self.leasehold_params = params
            return [{"geography_id": "a", "name": "a", "share": 0.8, "sales": 12, "carrier_geography_id": "a",
                     "source_release_id": "sales"},
                    {"geography_id": "b", "name": "b", "share": 0.2, "sales": 40, "carrier_geography_id": "msoa-b",
                     "source_release_id": "sales"},
                    {"geography_id": "c", "name": "c", "share": None, "sales": None, "carrier_geography_id": None,
                     "source_release_id": None}]
        raise AssertionError(marker)


class QuickRowsTests(unittest.TestCase):
    def setUp(self):
        quick_criteria.clear_cache()

    def test_percentiles_ascend_and_ties_share_the_lower_rank(self):
        self.assertEqual(quick_criteria.percentiles({"a": 1, "b": 3, "c": 3, "d": 5}),
                         {"a": 0, "b": 33, "c": 33, "d": 100})
        self.assertEqual(quick_criteria.percentiles({"a": 1}), {"a": 0})

    def test_noise_rows_carry_the_three_shares_and_a_region_percentile(self):
        connection = FakeQuickConnection()
        rows = quick_criteria.match_rows(connection, "rel", ["crime", "noise"], scope.ENGLAND)
        by_area = {row["geography_id"]: row for row in rows}
        self.assertEqual([by_area[g]["utility"] for g in "abc"], [0.0, 100.0, 50.0])
        self.assertEqual(by_area["b"]["detail"], {"road": 58.0, "rail": 5.0, "air": 0.0, "homes": 300})
        self.assertEqual((by_area["b"]["factor_id"], by_area["b"]["quality"]), ("noise", "observed"))
        quick_criteria.match_rows(connection, "rel", ["noise"], scope.ENGLAND)
        self.assertEqual(connection.statements, ["-- evidence:quick-noise"])  # cached per release

    def test_leasehold_falls_back_to_the_msoa_and_skips_areas_without_sales(self):
        connection = FakeQuickConnection()
        rows = quick_criteria.match_rows(connection, "rel", ["leasehold-share"], scope.ENGLAND)
        self.assertEqual(connection.leasehold_params, {"min": quick_criteria.LEASEHOLD_MIN_SALES})
        self.assertEqual([(r["geography_id"], r["raw_value"], r["quality"]) for r in rows],
                         [("a", 80.0, "observed"), ("b", 20.0, "fallback")])
        self.assertEqual(rows[0]["detail"], {"sales": 12})

    def test_epc_rows_and_unknown_factors(self):
        connection = FakeQuickConnection()
        rows = quick_criteria.match_rows(connection, "rel", ["epc-share", "disorder", "income"], scope.ENGLAND)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["raw_value"], rows[0]["detail"]["homesRated"]), (62.5, 400))


class QuickMatchingTests(unittest.TestCase):
    def test_quick_factors_validate_and_score_with_their_figures(self):
        profile = _profile([("noise", 4, "lower"), ("disorder", 3, "lower"), ("epc-share", 2, "higher"),
                            ("leasehold-share", 1, "lower")])
        matching.validate_match_request(profile)
        quick_criteria.clear_cache()
        rows = quick_criteria.match_rows(FakeQuickConnection(), "rel", ["noise"], scope.ENGLAND)
        rows += [{"geography_id": g, "name": g, "factor_id": "disorder", "raw_value": v, "utility": u,
                  "unit": "per 1,000", "carrier_geography_id": g, "quality": "observed", "source_release_id": "crime"}
                 for g, v, u in (("a", 12.0, 10), ("b", 90.0, 95), ("c", 30.0, 50))]
        pack = matching.build_match_pack(profile, rows)
        best = pack["values"][0]
        self.assertEqual(best["geographyId"], "a")
        noise = next(c for c in best["components"] if c["factorId"] == "noise")
        self.assertEqual((noise["utility"], noise["detail"]["road"]), (100.0, 20.0))
        disorder = next(c for c in best["components"] if c["factorId"] == "disorder")
        self.assertNotIn("detail", disorder)

    def test_quick_factor_links_append_new_indexes(self):
        profile = _profile([("crime", 3, "lower"), ("leasehold-share", 2, "lower")])
        packed = share_links.decode_profile(share_links.encode_profile(profile))
        self.assertEqual(packed[5], [[3, 3, 1, None, None], [13, 2, 1, None, None]])
        self.assertEqual(share_links._unpack_profile(packed)["factors"][1]["factorId"], "leasehold-share")


class QuickPlacesTests(unittest.TestCase):
    BASE = {"id": "p", "label": "P", "mode": "walk", "targetMinutes": 10, "weight": 3, "must": False}

    def test_school_rankings_and_step_free_stations_validate(self):
        matching.validate_places([{**self.BASE, "target": {"kind": "school", "phase": "secondary", "top": 20,
                                                            "rankBy": "progress8"}}])
        matching.validate_places([{**self.BASE, "target": {"kind": "category", "category": "step_free_station"}}])
        for target in ({"kind": "school", "phase": "primary", "top": 20, "rankBy": "progress8"},
                       {"kind": "school", "phase": "secondary", "top": 20, "rankBy": "ofsted"}):
            with self.subTest(target=target), self.assertRaises(matching.InvalidMatchRequest):
                matching.validate_places([{**self.BASE, "target": target}])

    def test_progress8_rule_round_trips_through_a_link_and_results_stay_compact(self):
        progress8 = {**self.BASE, "target": {"kind": "school", "phase": "secondary", "top": 20, "rankBy": "progress8"}}
        results = {**self.BASE, "id": "q", "target": {"kind": "school", "phase": "secondary", "top": 20}}
        profile = _profile([("crime", 3, "lower")], places=[progress8, results])
        packed = share_links.decode_profile(share_links.encode_profile(profile))
        # The ranking is element 10 after an empty time band (element 9): [..., None, "progress8"].
        self.assertEqual([place[9:] for place in packed[10]["p"]], [[None, "progress8"], []])
        self.assertEqual(share_links._unpack_profile(packed)["places"], [progress8, results])

    def test_a_null_ranking_reads_as_results_like_typescript(self):
        target = {"kind": "school", "phase": "secondary", "top": 20, "rankBy": None}
        matching.validate_places([{**self.BASE, "target": target}])
        packed = share_links._pack_place({**self.BASE, "target": target})
        self.assertEqual(len(packed), 9)
        self.assertEqual(share_links._unpack_target(packed + [None]), {"kind": "school", "phase": "secondary", "top": 20})

    def test_area_card_names_the_nearest_step_free_station(self):
        from area_api import commute

        class Connection:
            def execute(self, sql, params=()):
                assert sql.startswith("-- evidence:commute-area-step-free"), sql
                return [{"name": "Farringdon", "metres": 605.6}]
        place = {**self.BASE, "target": {"kind": "category", "category": "step_free_station"}}
        [entry] = commute.local_places(Connection(), "rel", "a", [place])
        self.assertEqual((entry["placeId"], entry["nearest"], entry["alternatives"]),
                         ("p", {"name": "Farringdon", "metres": 606}, []))

    def test_top_schools_rank_by_progress8_with_a_cohort_floor(self):
        def obs(measure, value, cohort):
            return {"measure": measure, "value": value, "cohortSize": cohort, "suppressed": False, "academicYear": "2023/24"}

        class Connection:
            def execute(self, sql, params=()):
                return [{"urn": "1", "observations": [obs("Progress 8", 0.2, 150), obs("Grade 5+ in English and maths (%)", 80, 150)]},
                        {"urn": "2", "observations": [obs("Progress 8", 0.9, 120), obs("Grade 5+ in English and maths (%)", 40, 120)]},
                        {"urn": "3", "observations": [obs("Progress 8", 2.0, 8)]}]
        personal_places.clear_cache()
        self.assertEqual([u for u, _ in personal_places.top_schools(Connection(), "rel", "secondary", "progress8")], ["2", "1"])
        self.assertEqual([u for u, _ in personal_places.top_schools(Connection(), "rel", "secondary")], ["1", "2"])

    def test_nearest_step_free_station_reads_flagged_stations(self):
        class Connection:
            statements = []

            def execute(self, sql, params=()):
                self.statements.append(sql.split("\n", 1)[0])
                return [{"geography_id": "a", "metres": 480.0}]
        personal_places.clear_cache()
        connection = Connection()
        metres = personal_places._nearest(connection, "rel", {"kind": "category", "category": "step_free_station"})
        self.assertEqual(metres, {"a": 480.0})
        self.assertEqual(connection.statements, ["-- evidence:place-nearest-step-free"])
        self.assertIn("s.step_free", personal_places.NEAREST_STEP_FREE_SQL)


class QuickClaudeTests(unittest.TestCase):
    def test_find_areas_accepts_quick_priorities_and_progress8_schools(self):
        args = home_search.FindAreasInput(
            max_budget=600_000, priorities=[{"factor": "noise", "importance": 4}, {"factor": "epc-share", "importance": 2}],
            places=[{"label": "Good secondary", "top_school": 20, "school_rank_by": "progress8"},
                    {"label": "Step-free station", "category": "step_free_station", "max_minutes": 10}])
        profile = home_search.build_profile(args)
        matching.validate_match_request(profile)
        ranges = [item for item in profile["criteria"] if item["kind"] == "range"]
        self.assertEqual([(item["layer"], item["max"], item["min"]) for item in ranges],
                         [("noise", 50, None), ("epc-share", None, 50)])
        places = [item for item in profile["criteria"] if item["kind"] == "place"]
        self.assertEqual(places[0]["target"]["rankBy"], "progress8")
        self.assertEqual(places[1]["mode"], "walk")
        self.assertEqual(len(home_search._quick_caveats(profile)), 2)

    def test_progress8_is_for_secondaries_only(self):
        args = home_search.FindAreasInput(max_budget=600_000, priorities=[{"factor": "crime", "importance": 3}],
                                          places=[{"label": "Primary", "top_school": 5, "school_phase": "primary",
                                                   "school_rank_by": "progress8"}])
        with self.assertRaises(Exception):
            home_search.build_profile(args)

    def test_brief_schools_carry_the_latest_progress8(self):
        observations = [{"measure": "Progress 8", "value": 0.31, "academicYear": "2022/23", "suppressed": False},
                        {"measure": "Progress 8", "value": 0.42, "academicYear": "2023/24", "suppressed": False}]
        self.assertEqual(brief.progress8(observations), {"value": 0.42, "year": "2023/24"})
        self.assertIsNone(brief.progress8([]))


if __name__ == "__main__":
    unittest.main()
