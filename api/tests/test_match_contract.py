"""AE-08 shared contract: Python and TypeScript score these fixtures identically.

The same file is exercised by web/tests/match-contract.test.ts; expected
values are hand-computed, never copied from an implementation.
"""
import json
import os
import unittest

from area_api.matching import build_match_pack

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "match_contract_fixtures.json")


def fixture_rows(area):
    rows = []
    for factor_id, item in area.get("evidence", {}).items():
        rows.append({
            "geography_id": area["geographyId"], "name": area["name"],
            "factor_id": factor_id, "raw_value": item["rawValue"], "utility": item["utility"],
            "unit": item["unit"], "carrier_geography_id": item["carrierGeographyId"],
            "quality": item["quality"], "source_release_id": item["sourceVersion"],
        })
    rows.append({
        "geography_id": area["geographyId"], "name": area["name"],
        "factor_id": "affordability", "raw_value": area["price"],
        "utility": None, "unit": "budget fit",
        "carrier_geography_id": area["geographyId"], "quality": "observed",
        "source_release_id": "price-2026-06",
    })
    for destination_id, minutes in area.get("journeys", {}).items():
        rows.append({
            "geography_id": area["geographyId"], "name": area["name"],
            "factor_id": "commute", "destination_id": destination_id,
            "raw_value": minutes, "utility": None,
            "unit": "minutes", "carrier_geography_id": area["geographyId"],
            "quality": "observed", "source_release_id": "journeys-2026-09",
        })
    return rows


def summarise(pack):
    return [{
        "geographyId": result["geographyId"],
        "score": result["score"],
        "rank": result["rank"],
        "excluded": result["excluded"],
        "unmetLimits": result["unmetLimits"],
        "evidenceCompleteness": result["evidenceCompleteness"],
        "utilities": {item["factorId"]: item["utility"] for item in result["components"]},
        "percentile": result["percentile"],
        "reasons": result["reasons"],
        "weakest": result["weakest"],
    } for result in pack["values"]]


class SharedContractTests(unittest.TestCase):
    def test_shared_fixtures_score_as_documented(self):
        with open(FIXTURE_PATH, encoding="utf-8") as handle:
            fixture = json.load(handle)
        self.assertTrue(fixture["cases"])
        for case in fixture["cases"]:
            rows = [row for area in case["areas"] for row in fixture_rows(area)]
            for name, profile in case["profiles"].items():
                with self.subTest(case=case["id"], profile=name):
                    self.assertEqual(summarise(build_match_pack(profile, rows)), case["expected"][name])


if __name__ == "__main__":
    unittest.main()
