"""Agent tool registry: every area tool answers in the evidence envelope and
reuses the same reader code as the v1 REST routes."""
import json
import unittest
import unittest.mock

from tests.test_production_evidence import (NOISE_RELEASE, OLD_CRIME, OLD_RELEASE, PRICE_RELEASE,
                                            seed_production_fixture)

try:
    from area_api import evidence, tools
    from area_api.evidence import EvidenceReader
    from area_api.matching import InvalidMatchRequest
except ImportError:  # pragma: no cover - dependency-free environments
    tools = None

ENVELOPE_KEYS = {"schemaVersion", "productReleaseId", "dataMode", "value", "confidence",
                 "evidence", "sources", "caveats"}


def _profile(**overrides):
    profile = {
        "schemaVersion": "preference-profile.v1", "market": "buy",
        "targetBudget": 500_000, "maximumBudget": 700_000,
        "factors": [{"factorId": "crime", "weight": 4, "direction": "lower",
                     "minimumUtility": None, "maximumUtility": None}],
        "commuteDestinations": [], "analyticsConsent": False,
    }
    profile.update(overrides)
    return profile


def _match_rows(profile):
    return [{
        "geography_id": "uk:lsoa:E01000004", "name": "Camden 001A test area",
        "factor_id": "crime", "raw_value": 56, "utility": 70, "unit": "per 1,000",
        "carrier_geography_id": "uk:lsoa:E01000004", "quality": "observed",
        "source_release_id": OLD_CRIME,
    }]


@unittest.skipIf(tools is None, "pydantic is not installed")
class RegistryTests(unittest.TestCase):
    def test_every_tool_has_agent_facing_metadata(self):
        for name, spec in tools.TOOLS.items():
            self.assertEqual(spec.name, name)
            self.assertRegex(name, r"^[a-z][a-z0-9_]+$")
            self.assertGreater(len(spec.description), 60, name)
            self.assertIn("properties", spec.input_model.model_json_schema())

    def test_unknown_tool_is_reported(self):
        with self.assertRaises(tools.ToolNotFound):
            tools.call_tool("nope", self._context(), {})

    def test_invalid_arguments_are_reported_before_reader_runs(self):
        with self.assertRaises(tools.InvalidToolArguments):
            tools.call_tool("search_areas", self._context(), {"q": "x", "limit": 999})

    def _context(self):
        return tools.ToolContext(reader=EvidenceReader(connect=seed_production_fixture))


@unittest.skipIf(tools is None, "pydantic is not installed")
class AreaToolTests(unittest.TestCase):
    def setUp(self):
        tools.clear_catalogue_cache()
        connection = seed_production_fixture()
        self.context = tools.ToolContext(
            reader=EvidenceReader(connect=lambda: connection), load_match_rows=_match_rows)

    def call(self, name, release_id=OLD_RELEASE, **arguments):
        out = tools.call_tool(name, self.context, arguments)
        self.assertEqual(set(out), ENVELOPE_KEYS, name)
        self.assertEqual(out["dataMode"], "release")
        self.assertEqual(out["productReleaseId"], release_id)
        return out

    def test_list_metrics_lists_ids_labels_units_by_theme(self):
        out = self.call("list_metrics")

        self.assertEqual(out["schemaVersion"], "tool-list-metrics.v1")
        themes = {group["theme"]: group for group in out["value"]}
        self.assertEqual(set(themes), {"crime", "price-per-m2", "my-match-factors"})
        self.assertEqual(themes["crime"], {"theme": "crime", "count": 1,
                                           "byUnit": {"per 1,000": {"crime": "Recorded crime"}}})
        self.assertEqual(set(themes["my-match-factors"]["byUnit"]["none"]), {"schools"})
        self.assertEqual(themes["my-match-factors"]["count"], 4)
        # One source row per source release, not per metric (the census is ~600 metrics of one release).
        self.assertEqual({s["release"] for s in out["sources"]}, {OLD_CRIME, PRICE_RELEASE})
        self.assertTrue(all("metricId" not in s and s["licence"] for s in out["sources"]))
        self.assertTrue(any("detail=" in caveat for caveat in out["caveats"]))
        self.assertEqual(out["confidence"], "high")

    def test_list_metrics_detail_returns_named_metrics_in_full(self):
        out = self.call("list_metrics", detail=["crime", "price-per-m2"])

        self.assertEqual([m["id"] for m in out["value"]], ["crime", "price-per-square-metre"])
        self.assertTrue(all(m["periods"] and m["defaultPeriod"] and m["provenance"] for m in out["value"]))
        self.assertEqual({s["metricId"] for s in out["sources"]}, {"crime", "price-per-square-metre"})

    def test_list_metrics_detail_caps_full_definitions(self):
        with unittest.mock.patch.object(tools, "DETAIL_LIMIT", 1):
            out = self.call("list_metrics", detail=["my-match-factors"])

        self.assertEqual([m["id"] for m in out["value"]], ["disorder"])
        self.assertTrue(any("3 more metrics" in caveat for caveat in out["caveats"]))

    def test_list_metrics_detail_rejects_an_unknown_name(self):
        with self.assertRaisesRegex(evidence.MalformedQuery, "nope"):
            tools.call_tool("list_metrics", self.context, {"detail": ["crime", "nope"]})

    def test_list_metrics_compact_keeps_its_flat_rows(self):
        out = self.call("list_metrics", compact=True)

        crime = next(m for m in out["value"] if m["id"] == "crime")
        self.assertEqual(set(crime), {"id", "unit", "direction", "defaultPeriod"})
        self.assertTrue(all("metricId" not in s for s in out["sources"]))

    def test_list_metrics_names_the_find_areas_factors(self):
        # #247: the factors find_areas scores (disorder, epc-share, leasehold-share, schools) are listed as
        # kind "factor" so agents learn they are readable, without a provenance row (no periods).
        out = self.call("list_metrics", detail=["my-match-factors"])

        factors = {m["id"]: m for m in out["value"] if m.get("kind") == "factor"}
        self.assertEqual(set(factors), {"disorder", "epc-share", "leasehold-share", "schools"})
        self.assertEqual(factors["disorder"]["unit"], "per 1,000")
        self.assertEqual(factors["disorder"]["periods"], [])
        self.assertTrue(any("factor" in caveat for caveat in out["caveats"]))

    def _factor_context(self, rows):
        return tools.ToolContext(reader=self.context.reader, load_match_rows=lambda profile: rows)

    def _factor_rows(self):
        return [{"geography_id": "uk:lsoa:E01000004", "name": "Camden 001A test area", "factor_id": "range:disorder",
                 "raw_value": 16.57, "utility": None, "percentile": 26.0, "unit": "per 1,000",
                 "carrier_geography_id": "uk:lsoa:E01000004", "quality": "observed", "source_release_id": OLD_CRIME},
                {"geography_id": "uk:lsoa:E01000001", "name": "Other", "factor_id": "range:disorder",
                 "raw_value": 40.2, "utility": None, "percentile": 80.0, "unit": "per 1,000",
                 "carrier_geography_id": "uk:lsoa:E01000001", "quality": "observed", "source_release_id": OLD_CRIME},
                {"geography_id": "uk:lsoa:E01000001", "name": "Other", "factor_id": "range:leasehold-share",
                 "raw_value": 11.8, "utility": None, "percentile": 14.2, "unit": "% of sales leasehold",
                 "carrier_geography_id": "uk:msoa:E02000223", "quality": "fallback", "detail": {"sales": 17},
                 "source_release_id": PRICE_RELEASE}]

    def test_get_area_metric_reads_a_find_areas_factor(self):
        # #247: get_area_metric disorder was "metric-not-found" although find_areas scored it.
        context = self._factor_context(self._factor_rows())
        out = tools.call_tool("get_area_metric", context,
                              {"area_id": "uk:lsoa:E01000004", "metric_id": "disorder", "period": "2026-08"})

        self.assertEqual(out["productReleaseId"], OLD_RELEASE)
        self.assertEqual((out["value"]["value"], out["value"]["regionPercentile"]), (16.57, 26.0))
        # MCP and /tools answers keep the deprecated name too (contract_aliases, step R1).
        self.assertEqual(out["value"]["londonPercentile"], 26.0)
        self.assertEqual(out["value"]["metricId"], "disorder")
        self.assertIsNone(out["value"]["period"])
        self.assertEqual(out["confidence"], "high")
        self.assertEqual(out["sources"][0]["release"], OLD_CRIME)
        self.assertTrue(any("period is ignored" in caveat for caveat in out["caveats"]))
        with self.assertRaises(evidence.AreaNotFound):
            tools.call_tool("get_area_metric", context,
                            {"area_id": "uk:lsoa:E01000003", "metric_id": "disorder", "period": "2026-08"})
        with self.assertRaises(evidence.MetricNotFound):
            tools.call_tool("get_area_metric", self._factor_context([]),
                            {"area_id": "uk:lsoa:E01000004", "metric_id": "epc-share", "period": "2026-08"})

    def test_factor_metric_names_its_carrier_and_detail(self):
        out = tools.call_tool("get_area_metric", self._factor_context(self._factor_rows()),
                              {"area_id": "uk:lsoa:E01000001", "metric_id": "leasehold-share", "period": "2026-08"})

        self.assertEqual(out["value"]["carrierGeographyId"], "uk:msoa:E02000223")
        self.assertEqual(out["value"]["detail"], {"sales": 17})
        self.assertEqual(out["confidence"], "medium")

    def test_rank_areas_by_a_find_areas_factor(self):
        # #247: rank_areas_by_metric leasehold-share / disorder were "metric-not-found".
        out = tools.call_tool("rank_areas_by_metric", self._factor_context(self._factor_rows()),
                              {"metric_id": "disorder", "period": "2026-08", "top_n": 5, "order": "asc"})

        self.assertEqual(out["productReleaseId"], OLD_RELEASE)
        self.assertEqual([(row["rank"], row["geographyId"], row["value"], row["unit"]) for row in out["value"]],
                         [(1, "uk:lsoa:E01000004", 16.57, "per 1,000"), (2, "uk:lsoa:E01000001", 40.2, "per 1,000")])
        self.assertEqual(out["sources"], [{"release": OLD_CRIME}])
        self.assertEqual(len(out["evidence"]), 2)

    def test_evidence_pack_crime_carries_the_offence_mix(self):
        # #238: the crime block gave one rate; agents could not see that shoplifting made it.
        out = self.call("get_area_evidence_pack", area_id="uk:lsoa:E01000004")

        crime = out["value"]["crime"]
        self.assertEqual(crime["value"], 56.0)
        self.assertEqual(crime["offences"], 13)
        self.assertEqual(crime["topTypes"], [
            {"category": "Violence and sexual offences", "offences": 9, "sharePercent": 69.2},
            {"category": "Shoplifting", "offences": 4, "sharePercent": 30.8}])
        self.assertTrue(crime["busyCentre"])
        self.assertEqual(crime["rateExcludingShoplifting"], 38.8)
        self.assertIn("31% of offences", crime["note"])

    def test_evidence_pack_crime_without_a_dominant_shop_type(self):
        self.context.reader._connect().breakdowns[1]["offence_count"] = 1  # shoplifting 1 of 10
        out = self.call("get_area_evidence_pack", area_id="uk:lsoa:E01000004")

        crime = out["value"]["crime"]
        self.assertFalse(crime["busyCentre"])
        self.assertNotIn("note", crime)
        self.assertNotIn("rateExcludingShoplifting", crime)

    def test_evidence_pack_lists_independent_schools_apart(self):
        # #250: independent schools (migration 067) never reached the pack or the overview.
        connection = self.context.reader._connect()
        self.assertIsNone(self.call("get_area_evidence_pack", area_id="uk:lsoa:E01000004")["value"]["schools"]["independent"])
        connection.independent_schools = [
            {"urn": "100123", "name": "Devonshire House Prep", "age_from": 2, "age_to": 13, "gender": "Mixed",
             "religious_character": None, "sixth_form": False, "distance_metres": 420, "source_release_id": "src-gias-2026"},
            {"urn": "100124", "name": "Far School", "age_from": 11, "age_to": 18, "gender": "Girls",
             "religious_character": "Roman Catholic", "sixth_form": True, "distance_metres": 2400, "source_release_id": "src-gias-2026"}]
        connection.sources["src-gias-2026"] = {**connection.sources[OLD_CRIME], "source_id": "dfe-gias"}

        out = self.call("get_area_evidence_pack", area_id="uk:lsoa:E01000004")

        schools = out["value"]["schools"]
        independent = schools["independent"]
        self.assertEqual(independent["count"], 1)
        self.assertEqual(independent["nearest"][0]["name"], "Devonshire House Prep")
        self.assertEqual((independent["nearest"][0]["ages"], independent["nearest"][0]["distanceMetres"]), ("2-13", 420))
        self.assertIn("ISI", independent["note"])
        self.assertNotIn("100123", {s["urn"] for s in schools["nearest"]})  # outside the Ofsted list
        self.assertIn("src-gias-2026", {s["release"] for s in out["sources"]})
        self.assertTrue(any("independent" in caveat for caveat in out["caveats"]))

    def test_search_areas_returns_lookup_results(self):
        out = self.call("search_areas", q="E01000004", limit=5)

        self.assertEqual(out["value"][0]["geographyId"], "uk:lsoa:E01000004")
        self.assertEqual(out["evidence"], [])

    def test_search_rejects_short_query_via_reader_error(self):
        with self.assertRaises(evidence.MalformedQuery):
            tools.call_tool("search_areas", self.context, {"q": " a "})

    def test_get_area_metric_carries_observation_evidence_and_provenance(self):
        out = self.call("get_area_metric", area_id="uk:lsoa:E01000004", metric_id="crime",
                        period="2026-06")

        self.assertEqual(out["value"]["value"], 56.0)
        self.assertEqual(out["confidence"], "high")
        kinds = {row["kind"] for row in out["evidence"]}
        self.assertEqual(kinds, {"metric-observation"})
        self.assertTrue(any(row["period"] == "2026-06" and row.get("breakdown") for row in out["evidence"]))
        self.assertLessEqual(len(out["evidence"]), 13)
        self.assertEqual(out["sources"][0]["release"], OLD_CRIME)
        self.assertEqual(out["sources"][0]["licence"], "OGL-3.0")

    def test_get_area_metric_carries_the_catalogue_unit(self):
        # Issue #157: a value of 54.1 (% of homes) must not be misread as dB.
        connection = seed_production_fixture()
        connection.members[OLD_RELEASE].append(NOISE_RELEASE)
        connection.metrics["noise"] = {
            "id": "noise", "carrier": "lsoa", "unit": "%",
            "direction": "higher-is-more",
            "definition": {"label": "Noise", "shortLabel": "Noise",
                           "description": "Share of homes at 55 dB Lden or more.",
                           "legend": [], "sourceId": "defra-noise",
                           "sourceName": "Defra strategic noise mapping (Round 4)",
                           "methodologyPath": "/guide/noise", "caveats": []},
            "source_release_id": NOISE_RELEASE,
        }
        connection.values.append({
            "geography_id": "uk:lsoa:E01000004", "metric_id": "noise",
            "period": "2026-06", "value": 54.1,
            "region_percentile": 73, "country_percentile": None,
            "sample_count": 259, "quality": "observed",
            "source_release_id": NOISE_RELEASE, "carrier": "lsoa",
            "name": "Camden 001A test area",
        })
        context = tools.ToolContext(reader=EvidenceReader(connect=lambda: connection),
                                    load_match_rows=_match_rows)
        out = tools.call_tool("get_area_metric", context,
                              {"area_id": "uk:lsoa:E01000004", "metric_id": "noise", "period": "2026-06"})
        self.assertEqual(out["value"]["value"], 54.1)
        self.assertEqual(out["value"]["unit"], "%")

    def test_get_area_metric_unknown_area_propagates(self):
        with self.assertRaises(evidence.AreaNotFound):
            tools.call_tool("get_area_metric", self.context,
                            {"area_id": "uk:lsoa:E09999999", "metric_id": "crime", "period": "2026-06"})

    def test_rank_areas_by_metric_orders_and_caps(self):
        out = self.call("rank_areas_by_metric", metric_id="crime", period="2026-06", top_n=1,
                        order="desc")

        self.assertEqual(len(out["value"]), 1)
        self.assertEqual(out["value"][0]["rank"], 1)
        self.assertEqual(out["value"][0]["geographyId"], "uk:lsoa:E01000004")
        self.assertEqual(out["value"][0]["unit"], "per 1,000")
        self.assertEqual(len(out["evidence"]), 1)

    def test_rank_areas_by_metric_refuses_census_layers(self):
        # Census 2021 layers describe who lives in an area: map and area page only, never a ranking
        # (web tests/census-layers.test.ts keeps them off the ranking pages).
        for metric_id in ("census-ethnicity-asian", "census-religion-muslim", "census-age-65-plus",
                          "census-household-lone-parent", "census-tenure-owned", "census-accommodation-flat",
                          "census-ethnicity-indian", "census-ethnicity-white-british", "census-ethnicity-any-other",
                          "census-birth-uk", "census-birth-eu8", "census-birth-country-poland",
                          "census-birth-country-india"):
            with self.assertRaises(tools.InvalidToolArguments, msg=metric_id):
                tools.call_tool("rank_areas_by_metric", self.context,
                                {"metric_id": metric_id, "period": "2021-03", "top_n": 5, "order": "desc"})

    def test_rank_areas_by_metric_ranks_income_and_social_renting(self):
        # Owner decision 2026-10-18: household income and social renting rank like any metric.
        crime = self.context.reader.get_value_pack("crime", "2026-06")
        for metric_id in ("income", "social-renting"):
            self.assertFalse(evidence.is_never_ranked(metric_id), metric_id)
            figures = iter(range(1, len(crime["values"]) + 1))
            pack = {**crime, "values": [{**row, "metricId": metric_id, "value": next(figures)} for row in crime["values"]]}
            with unittest.mock.patch.object(self.context.reader, "get_value_pack", return_value=pack) as read:
                out = self.call("rank_areas_by_metric", metric_id=metric_id, period="2026-06", top_n=2, order="desc")
            self.assertEqual(read.call_args.args[0], metric_id)
            values = [row["value"] for row in out["value"]]
            self.assertEqual(values, sorted(values, reverse=True), metric_id)
            self.assertEqual(len(values), min(2, len(crime["values"])), metric_id)
        description = next(spec for spec in tools.AREA_TOOLS if spec.name == "rank_areas_by_metric").description
        self.assertIn("social-renting", description)
        self.assertNotIn("income and social-renting describe residents", description)

    def test_rank_areas_by_metric_ranks_deprivation(self):
        # Owner decision 2026-10-17: the official deprivation index ranks like any metric (10 = least deprived).
        self.assertFalse(evidence.is_never_ranked("deprivation"))
        crime = self.context.reader.get_value_pack("crime", "2026-06")
        deciles = iter(range(1, len(crime["values"]) + 1))
        pack = {**crime, "values": [{**row, "metricId": "deprivation", "value": next(deciles)} for row in crime["values"]]}
        with unittest.mock.patch.object(self.context.reader, "get_value_pack", return_value=pack) as read:
            out = self.call("rank_areas_by_metric", metric_id="deprivation", period="2025-01", top_n=2, order="desc")
        self.assertEqual(read.call_args.args[0], "deprivation")
        values = [row["value"] for row in out["value"]]
        self.assertEqual(values, sorted(values, reverse=True))
        self.assertEqual(len(values), min(2, len(crime["values"])))

    def _tie_pack(self, values):
        return {"schemaVersion": "area-value-pack.v1", "metricId": "deprivation",
                "productReleaseId": OLD_RELEASE,
                "values": [{"geographyId": f"uk:lsoa:E010000{i:02d}", "name": f"Area {i:02d}",
                            "metricId": "deprivation", "period": "2025-01", "value": value,
                            "regionPercentile": 100, "countryPercentile": None,
                            "sampleCount": None, "quality": "observed",
                            "sourceVersion": "src-deprivation-test", "carrier": "lsoa"}
                           for i, value in enumerate(values, start=1)]}

    def test_rank_areas_by_metric_shares_ranks_for_ties(self):
        # #220: tied values got distinct ranks in GSS-code order (deprivation: hundreds of
        # LSOAs tie for "least deprived"). Competition ranks: equal values share a rank.
        pack = self._tie_pack([10, 10, 10, 9, 9, 9, 9, 8])
        with unittest.mock.patch.object(self.context.reader, "get_value_pack", return_value=pack):
            out = self.call("rank_areas_by_metric", metric_id="deprivation", period="2025-01",
                            top_n=6, order="desc")
        rows = out["value"]
        self.assertEqual([row["rank"] for row in rows], [1, 1, 1, 4, 4, 4])
        self.assertEqual([row["tiedCount"] for row in rows], [3, 3, 3, 4, 4, 4])
        # The top 6 cuts inside the four-way tie for 9: the order within it is arbitrary.
        self.assertTrue(any("4 areas share the value 9" in caveat and "arbitrary" in caveat
                            for caveat in out["caveats"]), out["caveats"])

    def test_rank_areas_by_metric_all_tied_share_rank_one(self):
        # #220: mobile-5g-outdoor asc and desc returned the identical list, ranked 1, 2, 3.
        pack = self._tie_pack([100, 100, 100, 100])
        with unittest.mock.patch.object(self.context.reader, "get_value_pack", return_value=pack):
            desc = self.call("rank_areas_by_metric", metric_id="mobile-5g-outdoor", period="2026-01",
                             top_n=3, order="desc")
            asc = self.call("rank_areas_by_metric", metric_id="mobile-5g-outdoor", period="2026-01",
                            top_n=3, order="asc")
        for out in (desc, asc):
            self.assertEqual([row["rank"] for row in out["value"]], [1, 1, 1])
            self.assertEqual([row["tiedCount"] for row in out["value"]], [4, 4, 4])

    def test_get_address_history_lists_sales_as_evidence(self):
        out = self.call("get_address_history", address_id="uk:addr:a1b2c3d4e5f6")

        self.assertEqual(out["value"]["saleCount"], 2)
        self.assertEqual([row["kind"] for row in out["evidence"]], ["recorded-sale", "recorded-sale"])
        self.assertEqual(out["sources"][0]["release"], OLD_CRIME)
        self.assertIn(out["value"]["estimateDisclaimer"], out["caveats"])
        self.assertEqual(out["value"]["listingLinks"]["rightmove"],
                         "https://www.rightmove.co.uk/house-prices/sw1a-1aa.html")

    def test_match_areas_uses_shared_validator_and_scorer(self):
        out = self.call("match_areas", release_id=OLD_CRIME, profile=_profile())

        self.assertEqual(out["value"]["schemaVersion"], "match-pack.v2")
        self.assertEqual(out["value"]["values"][0]["geographyId"], "uk:lsoa:E01000004")
        self.assertEqual(out["evidence"][0]["kind"], "match-component")
        self.assertEqual(out["sources"][0]["release"], OLD_CRIME)
        self.assertEqual(out["confidence"], "high")

    def test_match_areas_rejects_bad_profile(self):
        with self.assertRaises(InvalidMatchRequest):
            tools.call_tool("match_areas", self.context, {"profile": _profile(maximumBudget=1)})

    def test_match_areas_without_rows_is_release_unavailable(self):
        context = tools.ToolContext(reader=self.context.reader, load_match_rows=lambda profile: [])
        with self.assertRaises(evidence.ReleaseUnavailable):
            tools.call_tool("match_areas", context, {"profile": _profile()})


LONDON_LSOAS = 4994  # live find_areas reports scoredAreas=4994 (2026-10-19)
_ZONE = ["uk:lsoa:E01000001", "uk:lsoa:E01000002"]
MAX_BYTES = 512_000  # well under any client message limit; the MCP layer sends it twice

try:
    from mcp.server.mcpserver.utilities.func_metadata import _convert_to_content
    _MCP_CONVERT = True
except ImportError:  # pragma: no cover - the MCP SDK is a server dependency
    _MCP_CONVERT = False


def _match_size_rows(profile):
    """What repository.load_match_evidence returns: one range row per LSOA (range_rows) and, when the
    profile has a budget criterion, one affordability ballpark row per LSOA (ballpark_price_row)."""
    rows = []
    budget = any(item["kind"] == "budget" for item in profile["criteria"])
    for i in range(LONDON_LSOAS):
        area = f"uk:lsoa:E0100{i:04d}"
        base = {"geography_id": area, "name": f"Area {i:04d}", "carrier_geography_id": area}
        for factor_id in ("range:crime", "range:noise", "range:air-no2", "range:disorder"):
            rows.append({**base, "factor_id": factor_id, "raw_value": 15 + i % 60, "utility": None,
                         "unit": "per 1,000", "quality": "observed",
                         "source_release_id": "src-police-uk-crime-test"})
        if budget:
            rows.append({**base, "factor_id": "affordability", "raw_value": 380_000 + 40 * i, "utility": None,
                         "unit": "£ ballpark", "quality": "fallback", "source_release_id": "src-hmlr-pp-test"})
    return rows


def _match_size_profile(zone=True, budget=False):
    criteria = [{"kind": "range", "layer": "crime", "scale": "value", "max": 35}]
    if budget:
        criteria.insert(0, {"kind": "budget", "must": False})
    if zone:
        criteria.insert(0, {"kind": "where", "zones": [{"kind": "lsoas", "ids": _ZONE}], "must": True})
    return {"schemaVersion": "preference-profile.v2", "market": "buy", "targetBudget": 480000,
            "maximumBudget": 520000, "bedrooms": 3, "criteria": criteria}


@unittest.skipIf(tools is None, "pydantic is not installed")
class MatchAreasPayloadSizeTests(unittest.TestCase):
    """#199: match_areas returns a bounded pack even for a London-sized input, so the MCP
    message (structuredContent + an indented JSON text block) never drops the client."""

    def call(self, profile, **extra):
        context = tools.ToolContext(reader=EvidenceReader(connect=lambda: None),
                                    load_match_rows=_match_size_rows,
                                    load_zone_lsoas=lambda zones: set(_ZONE) if zones else None,
                                    load_zone_distances=lambda inside, soft: {area: 0.0 for area in inside or ()})
        return tools.call_tool("match_areas", context, {"profile": profile, **extra})

    def test_two_lsoa_must_zone_response_is_bounded(self):
        out = self.call(_match_size_profile(zone=True))
        self.assertLessEqual(len(out["value"]["values"]), 100)
        self.assertLess(len(json.dumps(out)), MAX_BYTES)

    def test_evidence_only_for_returned_areas(self):
        out = self.call(_match_size_profile(zone=True))
        returned = {row["geographyId"] for row in out["value"]["values"]}
        returned |= {row["geographyId"] for row in out["value"]["bottom"]}
        self.assertLessEqual({row["geographyId"] for row in out["evidence"]}, returned)
        self.assertLessEqual(len(out["evidence"]), 100 * 8)

    def test_unzoned_profile_response_is_bounded(self):
        out = self.call(_match_size_profile(zone=False, budget=True))
        self.assertLess(len(json.dumps(out)), MAX_BYTES)
        self.assertEqual(out["value"]["scored"], LONDON_LSOAS)    # counts stay whole-London

    def test_input_accepts_top_n(self):
        props = tools.TOOLS["match_areas"].input_model.model_json_schema()["properties"]
        self.assertIn("top_n", props)

    def test_excluded_areas_are_counted_not_listed(self):
        out = self.call(_match_size_profile(zone=True))
        value = out["value"]
        self.assertEqual(value["scored"], 2)                      # the two in-zone LSOAs
        self.assertEqual(value["excluded"], LONDON_LSOAS - 2)
        self.assertEqual(value["excludedBy"], {"zone:outside": LONDON_LSOAS - 2})
        self.assertFalse(any(row["excluded"] for row in value["values"]))
        listed_ids = {row["geographyId"] for row in value["values"]}
        self.assertLessEqual({row["geographyId"] for row in out["evidence"]}, listed_ids)

    def test_top_n_100_with_four_criteria_stays_bounded(self):
        profile = _match_size_profile(zone=False)
        profile["criteria"] = [{"kind": "range", "layer": layer, "scale": "value", "max": 35}
                               for layer in ("crime", "noise", "air-no2", "disorder")]
        out = self.call(profile, top_n=100)
        self.assertEqual(len(out["value"]["values"]), 100)
        self.assertLess(len(json.dumps(out)), MAX_BYTES)

    @unittest.skipUnless(_MCP_CONVERT, "the MCP SDK is not installed")
    def test_mcp_wire_message_stays_under_one_mb(self):
        out = self.call(_match_size_profile(zone=True))
        text = "".join(part.text for part in _convert_to_content(out) if part.type == "text")
        combined = len(text.encode("utf-8")) + len(json.dumps(out).encode("utf-8"))
        self.assertLess(combined, 1_000_000)


if __name__ == "__main__":
    unittest.main()
