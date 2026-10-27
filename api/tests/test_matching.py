import re
import unittest
from pathlib import Path

from area_api.matching import (
    RETIRED_FACTOR_IDS, InvalidMatchRequest, apply_relaxation, budget_tier, build_match_pack, describe_unmet_limits, over_budget,
    property_kind, range_fit, range_is_strict, validate_match_request,
)


def _affordability_profile(target_budget, maximum_budget, minimum_utility=None):
    return {
        "schemaVersion": "preference-profile.v1",
        "market": "buy",
        "targetBudget": target_budget,
        "maximumBudget": maximum_budget,
        "factors": [
            {"factorId": "affordability", "weight": 5, "direction": "target-range",
             "minimumUtility": minimum_utility, "maximumUtility": None},
        ],
        "commuteDestinations": [],
    }


def _affordability_rows(price=500_000, stored_utility=60):
    return [{
        "geography_id": "uk:lsoa:E01000001", "name": "Probe area",
        "factor_id": "affordability", "raw_value": price, "utility": stored_utility,
        "unit": "budget fit", "carrier_geography_id": "uk:lsoa:E01000001",
        "quality": "observed", "source_release_id": "price-2026-06",
    }]


class MatchingTests(unittest.TestCase):
    def test_match_pack_renormalises_missing_evidence_and_explains_carrier(self):
        profile = {
            "schemaVersion": "preference-profile.v1",
            "factors": [
                {"factorId": "crime", "weight": 4, "direction": "lower", "minimumUtility": None, "maximumUtility": None},
                {"factorId": "income", "weight": 2, "direction": "higher", "minimumUtility": None, "maximumUtility": None},
            ],
        }
        rows = [{
            "geography_id": "uk:lsoa:E01000001", "name": "Preview",
            "factor_id": "crime", "raw_value": 42, "utility": 70,
            "unit": "per 1,000", "carrier_geography_id": "uk:lsoa:E01000001",
            "quality": "observed", "source_release_id": "police-2026-06",
        }]

        pack = build_match_pack(profile, rows)

        # v4 Task 21: crime (first, weight 0.75) is a range on its London percentile, the better half inside and a
        # soft edge to the 75th: percentile 70 -> fit 0.2. Income (weight 0.25) has no row: half a fit.
        # 0.2^0.75 * 0.5^0.25 = 0.2515.
        self.assertEqual(pack["values"][0]["score"], 25)
        self.assertEqual(pack["values"][0]["evidenceCompleteness"], 75)
        self.assertEqual(pack["values"][0]["components"][0]["carrierGeographyId"], "uk:lsoa:E01000001")

    def test_budget_change_moves_affordability_utility_and_eligibility(self):
        rows = _affordability_rows(price=500_000, stored_utility=60)

        low = build_match_pack(_affordability_profile(300_000, 400_000, 50), rows)
        high = build_match_pack(_affordability_profile(600_000, 700_000, 50), rows)

        low_result, high_result = low["values"][0], high["values"][0]
        self.assertNotEqual(
            low_result["components"][0]["utility"],
            high_result["components"][0]["utility"],
        )
        self.assertTrue(low_result["excluded"])
        self.assertIsNone(low_result["score"])
        self.assertFalse(high_result["excluded"])
        self.assertIsNotNone(high_result["score"])

    def test_destination_change_moves_commute_utility(self):
        rows = [
            _journey_row("work-near", 12),
            _journey_row("work-far", 95),
        ]

        near = build_match_pack(_commute_profile("work-near"), rows)
        far = build_match_pack(_commute_profile("work-far"), rows)

        self.assertNotEqual(
            near["values"][0]["components"][0]["utility"],
            far["values"][0]["components"][0]["utility"],
        )
        self.assertGreater(
            near["values"][0]["components"][0]["utility"],
            far["values"][0]["components"][0]["utility"],
        )


def _commute_profile(destination_id):
    return {
        "schemaVersion": "preference-profile.v1",
        "market": "buy",
        "targetBudget": 500_000,
        "maximumBudget": 650_000,
        "factors": [
            {"factorId": "commute", "weight": 5, "direction": "lower",
             "minimumUtility": None, "maximumUtility": None},
        ],
        "commuteDestinations": [
            {"id": destination_id, "label": "Work", "latitude": 51.5,
             "longitude": -0.12, "mode": "transit", "arrivalTime": "09:00",
             "targetMinutes": 30, "weight": 5},
        ],
    }


class MatchRequestValidationTests(unittest.TestCase):
    def test_valid_profile_passes(self):
        validate_match_request(_affordability_profile(300_000, 400_000, 50))

    def test_house_subtypes_validate_and_count_as_house(self):
        base = _affordability_profile(300_000, 400_000)
        validate_match_request({**base, "houseTypes": ["terraced", "semi"]})
        for bad in (["bungalow"], "terraced", ["semi", "semi"]):
            with self.subTest(bad=bad):
                with self.assertRaises(InvalidMatchRequest):
                    validate_match_request({**base, "houseTypes": bad})
        self.assertEqual(property_kind({**base, "houseTypes": ["detached"]}), "house")
        self.assertEqual(property_kind({**base, "propertyType": "flat"}), "flat")
        self.assertEqual(property_kind(base), "any")

    def test_malformed_factors_and_unsupported_ids_rejected(self):
        base = _affordability_profile(300_000, 400_000)
        bad_profiles = [
            {**base, "factors": [{"weight": 3, "direction": "lower"}]},
            {**base, "factors": [
                {"factorId": "air-quality", "weight": 3, "direction": "lower",
                 "minimumUtility": None, "maximumUtility": None}]},
            {**base, "factors": [
                {"factorId": "crime", "weight": True, "direction": "lower",
                 "minimumUtility": None, "maximumUtility": None}]},
            {**base, "factors": [
                {"factorId": "crime", "weight": 3, "direction": "sideways",
                 "minimumUtility": None, "maximumUtility": None}]},
            {**base, "factors": [
                {"factorId": "crime", "weight": 3, "direction": "lower",
                 "minimumUtility": 80, "maximumUtility": 20}]},
            {**base, "targetBudget": 500_000, "maximumBudget": 400_000},
            {**base, "commuteDestinations": [{"id": "work", "targetMinutes": 0, "weight": 3}]},
        ]
        for bad in bad_profiles:
            with self.subTest(bad=bad):
                with self.assertRaises(InvalidMatchRequest):
                    validate_match_request(bad)


def _rent_profile(target_budget=1500, maximum_budget=2000, bedrooms=2,
                 minimum_utility=None):
    return {
        "schemaVersion": "preference-profile.v1",
        "market": "rent",
        "targetBudget": target_budget,
        "maximumBudget": maximum_budget,
        "bedrooms": bedrooms,
        "factors": [
            {"factorId": "affordability", "weight": 5, "direction": "target-range",
             "minimumUtility": minimum_utility, "maximumUtility": None},
        ],
        "commuteDestinations": [],
    }


def _rent_row(geography_id="uk:lsoa:E01000001", rent=1800, bedrooms="2 bedrooms",
              carrier="uk:lad:E09000001"):
    return {
        "geography_id": geography_id, "name": "Probe area",
        "factor_id": "affordability", "raw_value": rent,
        "utility": 60, "unit": "GBP/month", "bedrooms": bedrooms,
        "carrier_geography_id": carrier,
        "quality": "fallback", "source_release_id": "ons-prms-2024-09",
    }


class RentAffordabilityTests(unittest.TestCase):
    def test_monthly_rent_scores_against_monthly_budgets(self):
        rows = [_rent_row(rent=1800)]
        pack = build_match_pack(_rent_profile(1500, 2000), rows)
        component = pack["values"][0]["components"][0]
        self.assertEqual(component["rawValue"], 1800)
        self.assertEqual(component["unit"], "GBP/month")
        self.assertEqual(component["carrierGeographyId"], "uk:lad:E09000001")
        self.assertEqual(component["quality"], "fallback")
        self.assertEqual(component["utility"], 40)
        self.assertFalse(pack["values"][0]["excluded"])

    def test_missing_bedroom_cell_suppresses_affordability(self):
        rows = [_rent_row(bedrooms="1 bedroom")]
        pack = build_match_pack(_rent_profile(1500, 2000, bedrooms=3), rows)
        result = pack["values"][0]
        self.assertEqual(result["components"], [])
        self.assertIsNone(result["score"])  # no evidence for any ranked criterion: unknown, not the middle
        self.assertIsNone(result["rank"])
        self.assertEqual(result["evidenceCompleteness"], 0)
        self.assertFalse(result["excluded"])

    def test_lsoa_carried_rent_is_not_supported_detail(self):
        rows = [_rent_row(carrier="uk:lsoa:E01000001")]
        pack = build_match_pack(_rent_profile(), rows)
        self.assertEqual(pack["values"][0]["components"], [])
        self.assertEqual(pack["values"][0]["evidenceCompleteness"], 0)

    def test_invalid_parent_carrier_is_rejected(self):
        rows = [_rent_row(carrier="uk:lad:XYZ")]
        pack = build_match_pack(_rent_profile(), rows)
        self.assertEqual(pack["values"][0]["components"], [])
        rows = [_rent_row(carrier="uk:msoa:E02000001")]
        pack = build_match_pack(_rent_profile(), rows)
        self.assertEqual(pack["values"][0]["components"], [])

    def test_shared_borough_evidence_keeps_one_carrier(self):
        rows = [
            _rent_row(geography_id="uk:lsoa:E01000001"),
            _rent_row(geography_id="uk:lsoa:E01000002"),
        ]
        pack = build_match_pack(_rent_profile(), rows)
        carriers = [item["carrierGeographyId"]
                    for value in pack["values"]
                    for item in value["components"]]
        self.assertEqual(carriers, ["uk:lad:E09000001"] * 2)
        for value in pack["values"]:
            self.assertNotEqual(
                value["components"][0]["carrierGeographyId"],
                value["geographyId"])

    def test_annual_scale_rent_budget_is_rejected(self):
        with self.assertRaises(InvalidMatchRequest):
            validate_match_request(_rent_profile(500_000, 650_000))
        rows = [_rent_row()]
        pack = build_match_pack(_rent_profile(500_000, 650_000), rows)
        self.assertEqual(pack["values"][0]["components"], [])

    def test_missing_rent_never_inherits_purchase_price(self):
        buy_row = _affordability_rows(price=100, stored_utility=60)[0]
        pack = build_match_pack(_rent_profile(), [buy_row])
        result = pack["values"][0]
        self.assertEqual(result["components"], [])
        self.assertEqual(result["evidenceCompleteness"], 0)

    def test_rent_request_validation(self):
        validate_match_request(_rent_profile())
        for bad in ({"bedrooms": -1}, {"bedrooms": 9}, {"bedrooms": "2"},
                    {"market": "lease"}):
            with self.subTest(bad=bad):
                with self.assertRaises(InvalidMatchRequest):
                    validate_match_request({**_rent_profile(), **bad})


def _journey_row(destination_id, minutes):
    return {
        "geography_id": "uk:lsoa:E01000001", "name": "Probe area",
        "factor_id": "commute", "destination_id": destination_id,
        "raw_value": minutes, "utility": 60,
        "unit": "minutes", "carrier_geography_id": "uk:lsoa:E01000001",
        "quality": "observed", "source_release_id": "journeys-2026-09",
    }


def _crime_rows(north_utility=20, south_utility=90):
    rows = []
    for geography_id, name, price, utility in (
            ("uk:lsoa:E01000001", "Northend", 400_000, north_utility),
            ("uk:lsoa:E01000002", "Southend", 600_000, south_utility)):
        rows.append({
            "geography_id": geography_id, "name": name,
            "factor_id": "crime", "raw_value": 60, "utility": utility,
            "unit": "per 1,000", "carrier_geography_id": geography_id,
            "quality": "observed", "source_release_id": "police-2026-06",
        })
        rows.append({
            "geography_id": geography_id, "name": name,
            "factor_id": "affordability", "raw_value": price, "utility": 60,
            "unit": "budget fit", "carrier_geography_id": geography_id,
            "quality": "observed", "source_release_id": "price-2026-06",
        })
    return rows


def _tradeoff_profile(crime_weight=5, crime_min=80, afford_min=80):
    return {
        "schemaVersion": "preference-profile.v1",
        "market": "buy",
        "targetBudget": 300_000,
        "maximumBudget": 500_000,
        "factors": [
            {"factorId": "crime", "weight": crime_weight, "direction": "lower",
             "minimumUtility": crime_min, "maximumUtility": None},
            {"factorId": "affordability", "weight": 5, "direction": "target-range",
             "minimumUtility": afford_min, "maximumUtility": None},
        ],
        "commuteDestinations": [],
    }


class TradeoffTests(unittest.TestCase):
    def test_conflicting_minimum_above_maximum_is_rejected(self):
        profile = _tradeoff_profile()
        profile["factors"][0]["maximumUtility"] = 20
        with self.assertRaises(InvalidMatchRequest):
            validate_match_request(profile)

    def test_musts_are_filters_with_no_weight(self):
        # Crime Must (a minimum fit of 80 = London's safest 20%) and budget Must (within £500k).
        pack = build_match_pack(_tradeoff_profile(), _crime_rows())
        north, south = sorted(pack["values"], key=lambda value: value["geographyId"])
        self.assertFalse(north["excluded"])
        self.assertEqual(north["score"], 100)  # every criterion is a Must: nothing left to rank on
        self.assertEqual(south["unmetLimits"], ["crime:outside", "affordability:outside"])
        self.assertEqual([c["weight"] for c in north["components"]], [0, 0])

    def test_zero_weight_must_have_still_excludes(self):
        pack = build_match_pack(
            _tradeoff_profile(crime_weight=0, afford_min=None), _crime_rows())
        north, south = pack["values"]
        self.assertFalse(north["excluded"])
        self.assertTrue(south["excluded"])
        self.assertEqual(south["unmetLimits"], ["crime:outside"])
        self.assertIsNone(south["score"])

    def test_unknown_constrained_evidence_excludes_with_missing(self):
        profile = _tradeoff_profile()
        rows = [row for row in _crime_rows() if row["factor_id"] != "crime"]
        pack = build_match_pack(profile, rows)
        self.assertTrue(all(value["excluded"] for value in pack["values"]))
        self.assertEqual(pack["values"][0]["unmetLimits"], ["crime:missing"])

    def test_relaxing_exactly_one_limit_includes_only_matching_areas(self):
        rows = _crime_rows()
        relaxed = build_match_pack(_tradeoff_profile(), rows, relaxed=["affordability"])
        by_id = {value["name"]: value for value in relaxed["values"]}
        self.assertFalse(by_id["Northend"]["excluded"])
        self.assertTrue(by_id["Southend"]["excluded"])
        self.assertEqual(by_id["Southend"]["unmetLimits"], ["crime:outside"])

    def test_relaxation_reverses_without_changing_stored_evidence(self):
        rows = _crime_rows()
        profile = _tradeoff_profile()
        original = build_match_pack(profile, rows)
        south_original = next(value for value in original["values"] if value["name"] == "Southend")
        reopened = apply_relaxation(original, ["affordability", "crime"], profile)
        south_reopened = next(value for value in reopened["values"] if value["name"] == "Southend")
        self.assertEqual(describe_unmet_limits(south_original, profile),
                         ["Crime 60 per 1,000 is outside your lowest 20% of London", "Ballpark £600k is over your £500k"])
        self.assertFalse(south_reopened["excluded"])
        self.assertEqual(south_reopened["components"], south_original["components"])
        restored = apply_relaxation(original, [], profile)
        self.assertEqual(restored["values"], original["values"])

    def test_rent_must_have_excludes_over_budget_borough(self):
        rows = [_rent_row(rent=2100)]
        profile = _rent_profile(1500, 2000, minimum_utility=50)
        excluded = build_match_pack(profile, rows)["values"][0]
        self.assertTrue(excluded["excluded"])
        self.assertEqual(excluded["unmetLimits"], ["affordability:outside"])
        self.assertEqual(describe_unmet_limits(excluded, profile), ["Rent £2,100 a month is over your £2,000"])
        reopened = build_match_pack(profile, rows, relaxed=["affordability"])["values"][0]
        self.assertFalse(reopened["excluded"])
        self.assertIsNotNone(reopened["score"])


if __name__ == "__main__":
    unittest.main()


def _station_rows():
    # Utility is the ascending percentile of median walking minutes (more minutes, higher).
    return [{
        "geography_id": geography_id, "name": name,
        "factor_id": "station-access", "raw_value": minutes, "utility": utility,
        "unit": "minutes", "carrier_geography_id": geography_id,
        "quality": "observed", "source_release_id": "src-osm-station-access-2026-09",
    } for geography_id, name, minutes, utility in (
        ("uk:lsoa:E01000001", "Near station", 4.2, 10),
        ("uk:lsoa:E01000002", "Far station", 18.5, 90))]


class StationAccessFactorTests(unittest.TestCase):
    def _profile(self, direction="lower", minimum=None):
        return {
            "schemaVersion": "preference-profile.v1", "market": "buy",
            "targetBudget": 300_000, "maximumBudget": 500_000,
            "factors": [{"factorId": "station-access", "weight": 5, "direction": direction,
                         "minimumUtility": minimum, "maximumUtility": None}],
            "commuteDestinations": [],
        }

    def test_station_access_is_the_tenth_factor_and_validates(self):
        from area_api.matching import FACTOR_IDS

        self.assertEqual(FACTOR_IDS[9], "station-access")
        validate_match_request(self._profile())

    def test_fewer_minutes_rank_first_when_lower_is_preferred(self):
        pack = build_match_pack(self._profile(), _station_rows())
        ranked = sorted(pack["values"], key=lambda value: value["rank"])
        self.assertEqual([value["name"] for value in ranked], ["Near station", "Far station"])
        flipped = build_match_pack(self._profile("higher"), _station_rows())
        self.assertEqual(min(flipped["values"], key=lambda value: value["rank"])["name"], "Far station")

    def test_station_must_have_excludes_the_far_area(self):
        pack = build_match_pack(self._profile(minimum=50), _station_rows())
        excluded = {value["name"]: value["excluded"] for value in pack["values"]}
        self.assertEqual(excluded, {"Near station": False, "Far station": True})
        far = next(value for value in pack["values"] if value["name"] == "Far station")
        self.assertEqual(far["unmetLimits"], ["station-access:outside"])
        self.assertEqual(describe_unmet_limits(far, self._profile(minimum=50)),
                         ["Station access 18.5 minutes is outside your lowest 50% of London"])


def _row(geography_id, factor_id, raw_value, utility):
    return {"geography_id": geography_id, "name": geography_id[-4:], "factor_id": factor_id, "raw_value": raw_value,
            "utility": utility, "unit": "", "carrier_geography_id": geography_id, "quality": "observed",
            "source_release_id": "test-2026"}


class FindMyAreaRankingTests(unittest.TestCase):
    """Mirrors tests/find-my-area.test.ts: rank on the precise score; income and social renting are retired."""

    def test_people_criteria_are_no_longer_accepted(self):
        for factor_id in ("income", "social-renting"):
            profile = {**_affordability_profile(500_000, 650_000), "factors": [
                {"factorId": factor_id, "weight": 3, "direction": "higher", "minimumUtility": None, "maximumUtility": None}]}
            with self.assertRaises(InvalidMatchRequest):
                validate_match_request(profile)

    def test_census_layers_are_never_match_criteria(self):
        # The Census 2021 map layers (web lib/census-layers.ts) are descriptive only.
        for factor_id in ("census-ethnicity-white", "census-religion-christian", "census-age-0-14",
                          "census-household-couple-children", "census-tenure-owned", "census-accommodation-detached",
                          "census-ethnicity-indian", "census-ethnicity-caribbean", "census-ethnicity-roma",
                          "census-birth-africa", "census-birth-country-nigeria", "census-birth-country-united-states"):
            profile = {**_affordability_profile(500_000, 650_000), "factors": [
                {"factorId": factor_id, "weight": 3, "direction": "higher", "minimumUtility": None, "maximumUtility": None}]}
            with self.assertRaises(InvalidMatchRequest, msg=factor_id):
                validate_match_request(profile)

    def test_deprivation_is_a_match_criterion_again(self):
        # User decision 2026-10-11: the official deprivation decile (1 = most deprived) is matched on, higher is better.
        profile = {**_affordability_profile(500_000, 650_000), "factors": [
            {"factorId": "deprivation", "weight": 3, "direction": "higher", "minimumUtility": 40, "maximumUtility": 70}]}
        validate_match_request(profile)
        rows = [_row("uk:lsoa:E01000001", "deprivation", 8, 80), _row("uk:lsoa:E01000002", "deprivation", 5, 50)]
        pack = build_match_pack(profile, rows)
        self.assertEqual([value["geographyId"] for value in pack["values"] if value["rank"] is not None], ["uk:lsoa:E01000002"])

    def test_retired_factors_match_the_web(self):
        fixtures = (Path(__file__).resolve().parents[2] / "web/src/lib/fixtures.ts").read_text()
        web = re.search(r"RETIRED_FACTOR_IDS: readonly string\[\] = \[([^\]]*)\]", fixtures).group(1)
        self.assertEqual(tuple(re.findall(r'"([^"]+)"', web)), RETIRED_FACTOR_IDS)

    def test_areas_that_round_to_100_still_rank_apart(self):
        profile = _affordability_profile(500_000, 650_000)
        profile["factors"].append({"factorId": "crime", "weight": 5, "direction": "lower",
                                   "minimumUtility": None, "maximumUtility": None})
        dear, cheap = "uk:lsoa:E01000001", "uk:lsoa:E01000002"
        rows = [_row(dear, "affordability", 500_000, 0), _row(dear, "crime", 0.2, 0.2),
                _row(cheap, "affordability", 400_000, 0), _row(cheap, "crime", 0.4, 0.4)]

        pack = build_match_pack(profile, rows)

        self.assertEqual([value["score"] for value in pack["values"]], [100, 100])
        self.assertEqual([value["geographyId"] for value in pack["values"]], [cheap, dear])
        self.assertEqual([value["rank"] for value in pack["values"]], [1, 2])

    def test_missing_evidence_counts_as_the_middle(self):
        profile = {**_affordability_profile(500_000, 650_000), "factors": [
            {"factorId": "crime", "weight": 3, "direction": "lower", "minimumUtility": None, "maximumUtility": None},
            {"factorId": "noise", "weight": 3, "direction": "lower", "minimumUtility": None, "maximumUtility": None}]}
        rows = [_row("uk:lsoa:E01000001", "crime", 10, 10),
                _row("uk:lsoa:E01000002", "crime", 20, 20), _row("uk:lsoa:E01000002", "noise", 20, 20)]

        pack = build_match_pack(profile, rows)

        # Crime fit 90 with no noise data (score 90 on what is known) ranks below 80 + 80 with both known.
        self.assertEqual(pack["values"][0]["geographyId"], "uk:lsoa:E01000002")

    def test_a_soft_budget_ranks_over_budget_areas_low_not_out(self):
        within, unknown, over = "uk:lsoa:E01000001", "uk:lsoa:E01000002", "uk:lsoa:E01000003"
        profile = {**_affordability_profile(500_000, 600_000), "factors": [
            {"factorId": "affordability", "weight": 1, "direction": "target-range", "minimumUtility": None, "maximumUtility": None},
            {"factorId": "crime", "weight": 5, "direction": "lower", "minimumUtility": None, "maximumUtility": None}]}
        rows = [_row(within, "affordability", 590_000, 0), _row(within, "crime", 70, 70),
                _row(unknown, "crime", 50, 50),
                _row(over, "affordability", 686_000, 0), _row(over, "crime", 5, 5)]

        pack = build_match_pack(profile, rows)

        # Crime first (0.75), budget second (0.25). Unknown price: 1 * 0.5^0.25 = 0.841. Within: crime 70th
        # percentile fit 0.2, £590k fit 0.1: 0.2^0.75 * 0.1^0.25 = 0.168. Over the maximum: budget fit 0, score 0,
        # scored (red on the map), never out.
        self.assertEqual([value["geographyId"] for value in pack["values"]], [unknown, within, over])
        self.assertEqual([value["score"] for value in pack["values"]], [84, 17, 0])
        self.assertFalse(pack["values"][2]["excluded"])
        self.assertEqual([over_budget(value, profile) for value in pack["values"]], [None, False, True])

    def test_a_price_exactly_at_the_maximum_is_within_budget(self):
        result = {"components": [{"factorId": "affordability", "rawValue": 600_000}]}
        self.assertEqual(budget_tier(result, {"maximumBudget": 600_000}), 0)
        self.assertEqual(budget_tier(result, {"maximumBudget": 599_999}), 2)
        self.assertEqual(budget_tier({"components": []}, {"maximumBudget": 600_000}), 1)


def _range_profile(*ranges, factors=()):
    return {"schemaVersion": "preference-profile.v1", "market": "buy", "targetBudget": 500_000, "maximumBudget": 600_000,
            "bedrooms": 2, "forecastHorizon": "1y", "factors": list(factors) or [
                {"factorId": "affordability", "weight": 0, "direction": "target-range", "minimumUtility": None,
                 "maximumUtility": None}],
            "commuteDestinations": [], "school": {"phases": [], "characteristics": [], "facetWeights": {},
                                                  "shortlistUrns": [], "desiredSchoolCount": 3},
            "analyticsConsent": False, "ranges": list(ranges)}


def _range(layer, low=None, high=None, soft_low=None, soft_high=None, importance=3):
    return {"layer": layer, "min": low, "max": high, "softMin": soft_low, "softMax": soft_high, "importance": importance}


def _range_row(geography_id, layer, value, unit="per 1,000"):
    return {**_row(geography_id, f"range:{layer}", value, None), "unit": unit}


class RangeCriteriaTests(unittest.TestCase):
    """Fix 30b: one model. Fit 1 inside, linear to 0 across the soft edge, 0 beyond; score = weighted
    geometric mean of the fits; any fit 0 is out. Mirrors tests/match-ranges.test.ts."""

    def test_fit_is_one_inside_falls_across_the_soft_edge_and_is_zero_beyond(self):
        crime = _range("crime", high=25, soft_high=35)
        self.assertEqual(range_fit(10, crime), 1.0)
        self.assertEqual(range_fit(25, crime), 1.0)
        self.assertAlmostEqual(range_fit(30, crime), 0.5)
        self.assertEqual(range_fit(35, crime), 0.0)
        self.assertEqual(range_fit(80, crime), 0.0)
        hygiene = _range("food-hygiene", low=80, soft_low=60)
        self.assertAlmostEqual(range_fit(75, hygiene), 0.75)
        self.assertEqual(range_fit(59, hygiene), 0.0)

    def test_the_far_end_of_a_soft_edge_falls_all_the_way(self):
        # No floor: past the soft edge the fit is 0 and so is the score (scored low, not out).
        area = "uk:lsoa:E01000001"
        pack = build_match_pack(_range_profile(_range("crime", high=25, soft_high=35)), [_range_row(area, "crime", 34.8)])
        self.assertEqual(pack["values"][0]["score"], 2)
        pack = build_match_pack(_range_profile(_range("crime", high=25, soft_high=35)), [_range_row(area, "crime", 40)])
        self.assertEqual((pack["values"][0]["score"], pack["values"][0]["excluded"]), (0, False))

    def test_must_is_only_the_preset_with_edges_at_the_range(self):
        self.assertTrue(range_is_strict(_range("crime", high=25)))
        self.assertTrue(range_is_strict(_range("crime", high=25, soft_high=25)))
        self.assertFalse(range_is_strict(_range("crime", high=25, soft_high=26)))
        self.assertEqual(range_fit(25.5, _range("crime", high=25)), 0.0)

    def test_strict_range_puts_areas_out_and_soft_edges_shade_near_misses(self):
        inside, edge, out = "uk:lsoa:E01000001", "uk:lsoa:E01000002", "uk:lsoa:E01000003"
        profile = _range_profile(_range("crime", high=25), _range("price-per-square-metre", high=7000, soft_high=8000))
        rows = [_range_row(inside, "crime", 12), _range_row(inside, "price-per-square-metre", 6500, "£/m²"),
                _range_row(edge, "crime", 20), _range_row(edge, "price-per-square-metre", 7400, "£/m²"),
                _range_row(out, "crime", 46), _range_row(out, "price-per-square-metre", 5000, "£/m²")]

        pack = build_match_pack(profile, rows)
        by_id = {value["geographyId"]: value for value in pack["values"]}

        self.assertEqual(by_id[inside]["score"], 100)
        # Price £7.4k is 40% across the £7k-£8k edge: fit 0.6. Crime has no soft edge: a Must, a filter with no
        # weight, so the price is the only ranked criterion.
        self.assertEqual(by_id[edge]["score"], 60)
        self.assertEqual(by_id[out]["score"], None)
        self.assertEqual(by_id[out]["unmetLimits"], ["range:crime:outside"])
        self.assertEqual([value["geographyId"] for value in pack["values"]], [inside, edge, out])
        fits = {c["factorId"]: c["fit"] for c in by_id[edge]["components"]}
        self.assertAlmostEqual(fits["range:price-per-square-metre"], 0.6)
        self.assertEqual(describe_unmet_limits(by_id[out], profile), ["Crime 46 per 1,000 is outside your ≤ 25"])

    def test_importance_weights_the_geometric_mean(self):
        area = "uk:lsoa:E01000001"
        profile = _range_profile(_range("crime", high=25, soft_high=35, importance=1),
                                 _range("station-access", high=10, soft_high=20, importance=4))
        rows = [_range_row(area, "crime", 30), _range_row(area, "station-access", 12, "minutes")]
        # Importance orders: station first (0.75), crime second (0.25). 0.8^0.75 * 0.5^0.25 = 0.7113.
        self.assertEqual(build_match_pack(profile, rows)["values"][0]["score"], 71)

    def test_old_fields_map_onto_the_model(self):
        area = "uk:lsoa:E01000001"
        nice = {"factorId": "crime", "weight": 2, "direction": "lower", "minimumUtility": None, "maximumUtility": None}
        must = {**nice, "minimumUtility": 50}
        rows = [_row(area, "crime", 60, 60), _range_row(area, "station-access", 4, "minutes")]
        # A wizard factor is a range on its London percentile: the better half inside, soft to the 75th.
        # Crime at the 60th percentile: fit 0.6; the strict station range is a Must (no weight).
        nice_pack = build_match_pack(_range_profile(_range("station-access", high=10), factors=[nice]), rows)
        self.assertFalse(nice_pack["values"][0]["excluded"])
        self.assertEqual(nice_pack["values"][0]["score"], 60)
        # A must-have is the same range with edges at 0: the 60th percentile is out, relaxable.
        must_pack = build_match_pack(_range_profile(_range("station-access", high=10), factors=[must]), rows)
        self.assertEqual(must_pack["values"][0]["unmetLimits"], ["crime:outside"])
        self.assertEqual(apply_relaxation(must_pack, ["crime"])["values"][0]["score"], 100)

    def test_relaxing_a_range_lets_its_areas_back_in_with_a_poor_fit(self):
        area = "uk:lsoa:E01000001"
        pack = build_match_pack(_range_profile(_range("crime", high=25)), [_range_row(area, "crime", 40)])
        self.assertTrue(pack["values"][0]["excluded"])
        relaxed = apply_relaxation(pack, ["range:crime"])["values"][0]
        self.assertFalse(relaxed["excluded"])
        self.assertEqual(relaxed["score"], 100)  # a Must has no weight: nothing else to rank on

    def test_missing_values_rule_out_only_under_a_must(self):
        known, unknown = "uk:lsoa:E01000001", "uk:lsoa:E01000002"
        rows = [_range_row(known, "crime", 10), _row(unknown, "affordability", 550_000, None)]
        strict = build_match_pack(_range_profile(_range("crime", high=25)), rows)
        self.assertEqual({v["geographyId"]: v["unmetLimits"] for v in strict["values"]}[unknown], ["range:crime:missing"])
        soft = build_match_pack(_range_profile(_range("crime", high=25, soft_high=40)), rows)
        self.assertFalse({v["geographyId"]: v["excluded"] for v in soft["values"]}[unknown])

    def test_descriptive_layers_are_never_criteria(self):
        for layer in ("census-religion-muslim", "census-ethnicity-white", "census-tenure-owned"):
            with self.subTest(layer), self.assertRaises(InvalidMatchRequest):
                validate_match_request(_range_profile(_range(layer, high=10)))
        validate_match_request(_range_profile(_range("crime", high=25), _range("custom:gyms", low=2, soft_low=1)))

    def test_deprivation_is_a_range_criterion(self):
        # Owner decision 2026-10-17: the official deprivation decile (10 = least deprived) is an ordinary layer.
        validate_match_request(_range_profile(_range("deprivation", low=7)))
        rows = [_range_row("uk:lsoa:E01000001", "deprivation", 9), _range_row("uk:lsoa:E01000002", "deprivation", 3)]
        pack = build_match_pack(_range_profile(_range("deprivation", low=7)), rows)
        excluded = {value["geographyId"]: value["excluded"] for value in pack["values"]}
        self.assertEqual(excluded, {"uk:lsoa:E01000001": False, "uk:lsoa:E01000002": True})

    def test_income_and_social_renting_are_range_criteria(self):
        # Owner decision 2026-10-18: household income and social renting are ordinary layers.
        validate_match_request(_range_profile(_range("income", low=50_000), _range("social-renting", high=20)))
        rows = [_range_row("uk:lsoa:E01000001", "income", 60_000), _range_row("uk:lsoa:E01000002", "income", 30_000),
                _range_row("uk:lsoa:E01000001", "social-renting", 10), _range_row("uk:lsoa:E01000002", "social-renting", 10)]
        pack = build_match_pack(_range_profile(_range("income", low=50_000), _range("social-renting", high=20)), rows)
        excluded = {value["geographyId"]: value["excluded"] for value in pack["values"]}
        self.assertEqual(excluded, {"uk:lsoa:E01000001": False, "uk:lsoa:E01000002": True})

    def test_range_bounds_are_validated(self):
        bad = [_range("crime"), _range("crime", low=30, high=20), _range("crime", high=25, soft_high=20),
               _range("crime", low=5, soft_low=8), _range("crime", high=25, importance=0),
               {**_range("crime", high=25), "extra": 1}, _range("Crime!", high=25)]
        for item in bad:
            with self.subTest(item), self.assertRaises(InvalidMatchRequest):
                validate_match_request(_range_profile(item))
        with self.assertRaises(InvalidMatchRequest):
            validate_match_request(_range_profile(_range("crime", high=25), _range("crime", high=30)))

    def test_any_house_subtype_counts_as_a_house(self):
        profile = _range_profile(_range("crime", high=25))
        self.assertEqual(property_kind(profile), "any")
        self.assertEqual(property_kind({**profile, "houseTypes": ["terraced", "semi"]}), "house")
        self.assertEqual(property_kind({**profile, "propertyType": "flat", "houseTypes": []}), "flat")
        validate_match_request({**profile, "houseTypes": ["terraced", "detached"]})
        for bad in (["bungalow"], ["semi", "semi"], "semi"):
            with self.subTest(bad), self.assertRaises(InvalidMatchRequest):
                validate_match_request({**profile, "houseTypes": bad})
