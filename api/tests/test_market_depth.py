"""Local market depth and the area evidence pack (wave 1 / feature 6): standard
sales only, medians and the new-build premium withheld under 10 sales, the
leasehold share is a share of sales, aggregates only (no sale rows, no
addresses), and every block cites its source release."""
import unittest

from area_api import market_depth as market
from area_api.evidence import AddressNotFound, AreaNotFound, MalformedQuery
from tests.test_production_evidence import (NOISE_RELEASE, OFSTED_RELEASE, OLD_CRIME, OLD_RELEASE,
                                            PRICE_RELEASE, make_reader, market_row, seed_production_fixture)

try:
    from area_api import tools
except ImportError:  # pragma: no cover - dependency-free environments
    tools = None

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover
    TestClient = None

LSOA = "uk:lsoa:E01000004"
MSOA = "uk:msoa:E02000004"
SUBJECT = "uk:addr:a1b2c3d4e5f6"


class MarketDepthTests(unittest.TestCase):
    def setUp(self):
        self.connection = seed_production_fixture()
        self.reader = make_reader(self.connection)

    def test_lsoa_market_depth(self):
        payload = self.reader.get_market_depth(LSOA)

        self.assertEqual(payload["schemaVersion"], "area-market.v1")
        self.assertEqual(payload["productReleaseId"], OLD_RELEASE)
        self.assertTrue(payload["available"])
        self.assertEqual((payload["salesCount"], payload["dwellings"], payload["turnoverPercent"]), (24, 400, 4.0))
        self.assertEqual(payload["leaseholdShareOfSales"], 0.625)
        self.assertEqual(payload["newBuild"], {"medianPricePerSquareMetre": 12600, "sampleSize": 12})
        self.assertEqual(payload["newBuildPremiumPercent"], 20.0)
        self.assertEqual(payload["growth"]["growth10y"], 31.4)
        self.assertEqual([source["release"] for source in payload["sources"]], [PRICE_RELEASE])

    def test_premium_needs_ten_sales_on_both_sides(self):
        payload = self.reader.get_market_depth(MSOA)

        self.assertIsNone(payload["newBuild"]["medianPricePerSquareMetre"])
        self.assertEqual(payload["newBuild"]["sampleSize"], 6)
        self.assertEqual(payload["resale"]["medianPricePerSquareMetre"], 10500)
        self.assertIsNone(payload["newBuildPremiumPercent"])
        self.assertIsNone(payload["growth"])

    def test_payload_gate_holds_even_if_a_row_leaks_a_median(self):
        self.connection.market_depth[LSOA] = market_row(LSOA, resale_sample_36m=9)

        payload = self.reader.get_market_depth(LSOA)

        self.assertIsNone(payload["resale"]["medianPricePerSquareMetre"])
        self.assertIsNone(payload["newBuildPremiumPercent"])

    def test_leasehold_share_is_labelled_as_a_share_of_sales(self):
        payload = self.reader.get_market_depth(LSOA)

        self.assertIn("leaseholdShareOfSales", payload)
        self.assertTrue(any("share of the last 12 months' sales" in caveat for caveat in payload["caveats"]))

    def test_borough_and_unreleased_rows_are_unavailable(self):
        borough = self.reader.get_market_depth("uk:lad:E09000007")
        self.connection.market_depth[LSOA]["source_release_id"] = "unreleased"
        unreleased = self.reader.get_market_depth(LSOA)

        for payload in (borough, unreleased):
            self.assertFalse(payload["available"])
            self.assertIsNone(payload["salesCount"])
            self.assertEqual(payload["sources"], [])

    def test_unknown_and_malformed_areas(self):
        with self.assertRaises(AreaNotFound):
            self.reader.get_market_depth("uk:lsoa:E01009999")
        with self.assertRaises(MalformedQuery):
            self.reader.get_market_depth("E01000004")

    def test_market_sql_is_pinned_to_the_release(self):
        self.reader.get_market_depth(LSOA)
        sql = next(sql for sql, _ in self.connection.statements if sql.startswith("-- evidence:market-depth"))
        self.assertIn("product_release_member", sql)


class AreaPackTests(unittest.TestCase):
    def setUp(self):
        self.connection = seed_production_fixture()
        self.reader = make_reader(self.connection)

    def test_pack_cites_every_block(self):
        pack = self.reader.get_area_pack(LSOA)

        self.assertEqual(pack["schemaVersion"], "area-evidence-pack.v1")
        self.assertEqual(pack["crime"]["period"], "2026-06")
        self.assertEqual(pack["noise"]["any55Share"], 0.43)
        self.assertEqual((pack["schools"]["count"], pack["schools"]["primary"]), (2, 1))
        self.assertEqual(pack["schools"]["nearest"][1]["latestInspection"], "Outstanding")
        self.assertIsNone(pack["nearbySales"])
        self.assertEqual({source["release"] for source in pack["sources"]},
                         {PRICE_RELEASE, OLD_CRIME, NOISE_RELEASE, OFSTED_RELEASE})

    def test_address_adds_building_and_street_aggregates_without_rows(self):
        nearby = self.reader.get_area_pack(MSOA, SUBJECT)["nearbySales"]

        self.assertEqual(nearby["building"], {"saleCount": 3, "excludedPartShare": 0,
                                              "medianPricePerSquareMetre": None, "medianSampleSize": 2})
        self.assertEqual(nearby["street"]["medianPricePerSquareMetre"], 10500)
        self.assertNotIn("sales", nearby["street"])

    def test_address_outside_the_area_is_refused(self):
        with self.assertRaises(MalformedQuery):
            self.reader.get_area_pack("uk:lsoa:E01000005", SUBJECT)
        with self.assertRaises(MalformedQuery):
            self.reader.get_area_pack(LSOA, "not-an-address")

    def test_suppressed_address_is_not_found(self):
        self.connection.suppressed.add(SUBJECT)
        with self.assertRaises(AddressNotFound):
            self.reader.get_area_pack(LSOA, SUBJECT)

    def test_msoa_pack_has_no_crime_rate(self):
        self.assertIsNone(self.reader.get_area_pack(MSOA)["crime"])


class StandingGradeTests(unittest.TestCase):
    """Fix 158: nearest[] shows the standing Ofsted judgement, never an ungraded visit's outcome."""

    UNGRADED_ONLY = [{"kind": "inspection-legacy", "academicYear": "2023/24",
                      "measure": "Ungraded inspection", "value": "Standards maintained"}]

    def _school(self, urn, observations, standing=None):
        school = {"urn": urn, "name": urn, "phase": "secondary", "distanceMetres": 688,
                  "sourceVersion": OFSTED_RELEASE, "observations": observations}
        if standing is not None:
            school["standingInspection"] = standing
        return school

    def _nearest(self, school):
        return market.schools_section([school], 1500)["nearest"][0]

    def test_ungraded_only_visit_shows_the_standing_grade(self):
        standing = {"grade": "Good", "framework": "legacy-overall", "year": "2018"}
        nearest = self._nearest(self._school("100857", self.UNGRADED_ONLY, standing))

        self.assertNotEqual(nearest["latestInspection"], "Standards maintained")
        self.assertEqual(nearest["latestInspection"], "Good (2018)")
        self.assertEqual(nearest["standingInspection"]["grade"], "Good")
        self.assertEqual(nearest["standingInspection"]["framework"], "legacy-overall")
        # The ungraded visit is kept, as detail only.
        self.assertEqual(nearest["standingInspection"]["ungradedVisit"],
                         {"year": "2023/24", "outcome": "Standards maintained"})

    def test_oeif_grade_with_a_later_ungraded_visit_keeps_the_oeif_grade(self):
        observations = [
            {"kind": "inspection-legacy", "academicYear": "2023/24",
             "measure": "Ungraded inspection", "value": "Standards maintained"},
            {"kind": "inspection-legacy", "academicYear": "2021/22",
             "measure": "Overall effectiveness", "value": "Outstanding"},
        ]
        nearest = self._nearest(self._school("100818", observations))

        self.assertEqual(nearest["standingInspection"]["grade"], "Outstanding")
        self.assertEqual(nearest["standingInspection"]["framework"], "legacy-overall")
        self.assertEqual(nearest["latestInspection"], "Outstanding (2021/22)")
        self.assertEqual(nearest["standingInspection"]["ungradedVisit"]["outcome"], "Standards maintained")

    def test_report_card_and_legacy_grades_are_never_blended(self):
        observations = [
            {"kind": "inspection-current", "academicYear": "2024/25",
             "measure": "Leadership", "value": "Strong standard"},
            {"kind": "inspection-legacy", "academicYear": "2021/22",
             "measure": "Overall effectiveness", "value": "Good"},
        ]
        standing = self._nearest(self._school("100818", observations))["standingInspection"]

        self.assertEqual(standing["framework"], "report-card")
        self.assertEqual(standing["grade"], "report card")

    def test_ungraded_only_without_a_standing_row_says_so(self):
        nearest = self._nearest(self._school("100857", self.UNGRADED_ONLY))

        self.assertIsNone(nearest["standingInspection"])
        self.assertEqual(nearest["latestInspection"], "Standing grade not loaded")

    def test_a_graded_school_is_unchanged(self):
        observations = [{"kind": "inspection-legacy", "academicYear": "2023/24",
                         "measure": "Overall effectiveness", "value": "Outstanding"}]
        nearest = self._nearest(self._school("100001", observations))

        self.assertEqual(nearest["latestInspection"], "Outstanding")
        self.assertEqual(nearest["standingInspection"]["grade"], "Outstanding")
        self.assertIsNone(nearest["reportCard"])

    REPORT_CARD = [
        {"kind": "inspection-current", "academicYear": "2025/26", "measure": "Inclusion", "value": "Expected standard"},
        {"kind": "inspection-current", "academicYear": "2025/26", "measure": "Curriculum and teaching",
         "value": "Strong standard"},
        {"kind": "inspection-current", "academicYear": "2025/26", "measure": "Leadership and governance",
         "value": "Needs attention"},
        {"kind": "inspection-current", "academicYear": "2025/26", "measure": "Safeguarding", "value": "Met"},
        {"kind": "inspection-legacy", "academicYear": "2021/22", "measure": "Ungraded inspection",
         "value": "School remains Good"},
    ]

    def test_a_report_card_is_shown_whole_never_as_one_areas_grade(self):
        """#226: Willowfield (103100) read "Expected standard", the Inclusion grade, as its outcome."""
        nearest = self._nearest(self._school("103100", self.REPORT_CARD))

        self.assertEqual(nearest["latestInspection"], "Report card 2025/26")
        self.assertEqual(nearest["standingInspection"]["framework"], "report-card")
        self.assertEqual(nearest["reportCard"], {
            "year": "2025/26",
            "areas": [{"label": "Inclusion", "grade": "Expected standard"},
                      {"label": "Curriculum and teaching", "grade": "Strong standard"},
                      {"label": "Leadership and governance", "grade": "Needs attention"}],
            "safeguarding": "Met"})

    def test_a_2024_graded_inspection_without_an_overall_grade_says_so(self):
        observations = [{"kind": "inspection-legacy", "academicYear": "2024/25",
                         "measure": "Quality of education", "value": "Good"},
                        {"kind": "inspection-legacy", "academicYear": "2024/25",
                         "measure": "Behaviour and attitudes", "value": "Requires improvement"}]
        nearest = self._nearest(self._school("100002", observations))

        self.assertEqual(nearest["latestInspection"], "Graded areas 2024/25, no overall grade")


class EnvelopeTests(unittest.TestCase):
    def test_confidence_bands(self):
        self.assertEqual(market.market_confidence({"available": False}), "none")
        self.assertEqual(market.market_confidence({"available": True, "salesCount": 4}), "low")
        self.assertEqual(market.market_confidence(
            {"available": True, "salesCount": 40, "newBuildPremiumPercent": None}), "medium")
        self.assertEqual(market.market_confidence(
            {"available": True, "salesCount": 40, "newBuildPremiumPercent": 12.0}), "high")


@unittest.skipIf(tools is None, "pydantic is not installed")
class MarketToolTests(unittest.TestCase):
    def setUp(self):
        tools.clear_catalogue_cache()
        connection = seed_production_fixture()
        self.context = tools.ToolContext(reader=make_reader(connection))

    def test_tools_are_registered_for_agents(self):
        for name in ("get_market_depth", "get_nearby_sales_summary", "get_area_evidence_pack"):
            self.assertIn(name, tools.TOOLS)
            self.assertIn(tools.TOOLS[name], tools.AREA_TOOLS)

    def test_market_depth_envelope(self):
        out = tools.call_tool("get_market_depth", self.context, {"area_id": LSOA})

        self.assertEqual(out["schemaVersion"], "tool-market-depth.v1")
        self.assertEqual(out["confidence"], "high")
        self.assertEqual([row["kind"] for row in out["evidence"]],
                         ["sales-count", "median-price-per-square-metre", "median-price-per-square-metre"])
        # Release-level provenance (#161): no other metric's methodologyPath is borrowed.
        self.assertEqual(out["sources"][0]["sourceId"], "hmlr-epc")
        self.assertEqual(out["sources"][0]["licence"], "OGL-3.0")
        self.assertNotIn("methodologyPath", out["sources"][0])

    def test_nearby_summary_has_no_sale_rows(self):
        out = tools.call_tool("get_nearby_sales_summary", self.context, {"address_id": SUBJECT})

        self.assertEqual(out["confidence"], "high")
        self.assertNotIn("sales", out["value"]["building"])
        self.assertEqual({row["scope"] for row in out["evidence"]}, {"building", "street"})
        self.assertEqual(out["sources"][0]["release"], PRICE_RELEASE)

    def test_pack_envelope_and_arguments(self):
        out = tools.call_tool("get_area_evidence_pack", self.context, {"area_id": LSOA, "address_id": SUBJECT})

        self.assertEqual(out["schemaVersion"], "tool-area-evidence-pack.v1")
        self.assertEqual(out["value"]["nearbySales"]["addressId"], SUBJECT)
        self.assertIn("metric-observation", [row["kind"] for row in out["evidence"]])
        with self.assertRaises(tools.InvalidToolArguments):
            tools.call_tool("get_area_evidence_pack", self.context, {"area_id": LSOA, "address_id": "x"})


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class MarketHttpTests(unittest.TestCase):
    def setUp(self):
        connection = seed_production_fixture()
        self._previous = app_module._reader
        app_module._reader = make_reader(connection)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_market_and_pack_return_envelopes(self):
        market_out = self.client.get(f"/api/v1/areas/{LSOA}/market")
        pack = self.client.get(f"/api/v1/areas/{LSOA}/pack", params={"address": SUBJECT})

        self.assertEqual(market_out.status_code, 200)
        self.assertEqual(market_out.json()["schemaVersion"], "area-market.v1")
        self.assertEqual(market_out.json()["value"]["salesCount"], 24)
        self.assertEqual(pack.status_code, 200)
        self.assertEqual(pack.json()["value"]["nearbySales"]["street"]["saleCount"], 7)

    def test_errors_map_to_status_codes(self):
        self.assertEqual(self.client.get("/api/v1/areas/uk:lsoa:E01009999/market").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/areas/nope/pack").status_code, 400)
        outside = self.client.get("/api/v1/areas/uk:lsoa:E01000005/pack", params={"address": SUBJECT})
        self.assertEqual(outside.status_code, 400)
        self.assertEqual(self.client.post("/api/v2/tools/get_market_depth",
                                          json={"area_id": LSOA}).json()["dataMode"], "release")


if __name__ == "__main__":
    unittest.main()
