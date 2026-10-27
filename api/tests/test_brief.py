"""Search brief (area-brief.v1): ring of touching neighbours, prices of similar homes against
the budget (aggregates only, gated), graded schools for the map, nearest station."""
import unittest

from tests.test_production_evidence import OLD_RELEASE, seed_production_fixture

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api import brief, evidence
    from area_api.evidence import EvidenceReader
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

STATION_RELEASE = "osm-station-access-2026-09"


def _sale(area, price, ptype="T", floor=95.0):
    return {"geography_id": area, "price": price, "property_type": ptype, "floor": floor}


def _legacy(measure, value):
    return {"kind": "inspection-legacy", "measure": measure, "value": value, "academicYear": "2023/24"}


def _current(measure, value):
    return {"kind": "inspection-current", "measure": measure, "value": value, "academicYear": "2025/26"}


@unittest.skipIf(TestClient is None, "dependencies are not installed")
class PriceContextTests(unittest.TestCase):
    def test_histogram_of_homes_like_the_one_wanted(self):
        rows = [_sale("a", price) for price in range(500_000, 1_100_000, 20_000)]
        rows += [_sale("a", 2_000_000, ptype="F", floor=95.0), _sale("b", 300_000)]

        context = brief.price_context(rows, {"a"}, 3, "house", (800_000, 900_000))

        self.assertTrue(context["available"])
        self.assertEqual((context["sales"], context["matched"]), (30, "size-and-type"))
        self.assertEqual(context["median"], 790_000)
        self.assertEqual((context["budgetMinPercentile"], context["budgetMaxPercentile"]), (53, 70))
        self.assertEqual(sum(b["count"] for b in context["bins"]) + context["above"], 30)
        # Geometric bars at round prices, contiguous, from the 5th percentile.
        bins = context["bins"]
        self.assertEqual(bins[0]["from"], 530_000)
        self.assertTrue(all(a["to"] == b["from"] for a, b in zip(bins, bins[1:])))
        self.assertTrue(all(1.05 <= b["to"] / b["from"] <= 1.7 for b in bins))
        self.assertEqual(context["above"], 0)

    def test_type_then_size_are_dropped_when_sales_are_scarce(self):
        def matched(rows):
            return brief.price_context(rows, {"a"}, 3, "house", (None, None))["matched"]

        self.assertEqual(matched([_sale("a", 600_000 + i, ptype="F", floor=95.0) for i in range(12)]), "size")
        self.assertEqual(matched([_sale("a", 600_000 + i, floor=50.0) for i in range(12)]), "type")
        self.assertEqual(matched([_sale("a", 600_000 + i, ptype="F", floor=50.0) for i in range(12)]), "all")

    def test_a_few_very_expensive_sales_do_not_flatten_the_scale(self):
        rows = [_sale("a", 400_000 + 10_000 * i) for i in range(40)] + [_sale("a", 9_000_000)] * 2

        context = brief.price_context(rows, {"a"}, 3, "house", (800_000, 900_000))

        self.assertTrue(all(b["to"] / b["from"] <= 1.7 for b in context["bins"]))
        self.assertEqual(context["above"], 2)
        self.assertGreaterEqual(context["bins"][-1]["to"], 900_000)
        self.assertEqual(sum(b["count"] for b in context["bins"]), 40)

    def test_too_few_sales_withholds_everything(self):
        context = brief.price_context([_sale("a", 700_000)] * 9, {"a"}, 3, "house", (800_000, 900_000))

        self.assertEqual(context, {"available": False, "sales": 9, "minimumSample": 10,
                                   "windowMonths": 36, "floorBand": [80, 110]})


@unittest.skipIf(TestClient is None, "dependencies are not installed")
class SchoolGradeTests(unittest.TestCase):
    def test_legacy_overall_judgement_wins(self):
        grade = brief.school_grade([_legacy("Quality of education", "Good"),
                                    _legacy("Overall effectiveness", "Outstanding")])
        self.assertEqual((grade["tier"], grade["label"]), ("outstanding", "Ofsted: Outstanding"))

    def test_ungraded_outcome_keeps_the_grade(self):
        grade = brief.school_grade([_legacy("Ungraded inspection", "School remains Good (Concerns) - S5 Next")])
        self.assertEqual(grade["tier"], "good")

    def test_standing_grade_wins_over_an_ungraded_outcome(self):
        # Fix 158: "Standards maintained" carries no grade word; the pack's standing row names the grade.
        observations = [_legacy("Ungraded inspection", "Standards maintained")]
        grade = brief.school_grade(observations, {"grade": "Good", "framework": "legacy-overall", "year": "2018"})
        self.assertEqual((grade["tier"], grade["label"], grade["year"]), ("good", "Ofsted: Good", "2018"))
        # Without the standing row, the ungraded outcome alone is still unknown.
        self.assertEqual(brief.school_grade(observations)["tier"], "unknown")

    def test_school_marker_carries_the_standing_grade(self):
        summary = {"urn": "100857", "name": "St Thomas", "phase": "secondary", "latitude": 51.5,
                   "longitude": -0.1, "distanceMetres": 688, "selectivity": "Unknown", "sourceVersion": "src",
                   "observations": [_legacy("Ungraded inspection", "Standards maintained")],
                   "standingInspection": {"grade": "Outstanding", "framework": "legacy-overall", "year": "2019"}}
        marker = brief.school_marker(summary, "uk:lsoa:E01003984")
        self.assertEqual(marker["grade"]["tier"], "outstanding")

    def test_a_report_card_outranks_an_older_legacy_grade(self):
        """#226: the ETL writes the report card first; an older "School remains Good" used to win."""
        observations = [_current("Inclusion", "Expected standard"), _current("Curriculum and teaching", "Strong standard"),
                        _current("Leadership and governance", "Needs attention"), _current("Safeguarding", "Met"),
                        {"kind": "inspection-legacy", "measure": "Ungraded inspection", "value": "School remains Good",
                         "academicYear": "2021/22"}]
        grade = brief.school_grade(observations)
        self.assertEqual((grade["tier"], grade["year"]), ("requires-improvement", "2025/26"))
        self.assertEqual(grade["label"], "Ofsted report card: 1 strong, 1 expected, 1 needs attention")
        # The pack's standing row says report card: the same, never the legacy grade.
        standing = {"grade": "report card", "framework": "report-card", "year": "2026"}
        self.assertEqual(brief.school_grade(observations, standing)["tier"], "requires-improvement")

    def test_report_cards_are_summarised(self):
        strong = [_current("Achievement", "Exceptional"), _current("Inclusion", "Strong standard"),
                  _current("Leadership", "Expected standard")]
        self.assertEqual(brief.school_grade(strong)["tier"], "outstanding")
        self.assertIn("1 exceptional", brief.school_grade(strong)["label"])
        weak = strong + [_current("Attendance", "Needs attention")]
        self.assertEqual(brief.school_grade(weak)["tier"], "requires-improvement")
        self.assertEqual(brief.school_grade([])["tier"], "unknown")

    def test_schools_near_several_areas_are_merged(self):
        def marker(urn, tier, distance, area):
            return {"urn": urn, "grade": {"tier": tier}, "distanceMetres": distance, "nearAreas": [area]}

        merged = brief.merge_schools([marker("1", "good", 900, "a"), marker("2", "outstanding", 1200, "a"),
                                      marker("1", "good", 300, "b")])

        self.assertEqual([m["urn"] for m in merged], ["2", "1"])
        self.assertEqual((merged[1]["distanceMetres"], merged[1]["nearAreas"]), (300, ["a", "b"]))


@unittest.skipIf(TestClient is None, "dependencies are not installed")
class GetBriefTests(unittest.TestCase):
    def setUp(self):
        self.connection = seed_production_fixture()
        self.connection.touching = {("uk:lsoa:E01000004", "uk:lsoa:E01000005")}
        self.connection.members[OLD_RELEASE].append(STATION_RELEASE)
        self.connection.stations = {"osm:n1": {"id": "osm:n1", "name": "Camden Town", "modes": ["underground"],
                                               "center_lon": -0.14, "center_lat": 51.54,
                                               "source_release_id": STATION_RELEASE}}
        self.connection.station_walks = [
            {"geography_id": "uk:lsoa:E01000004", "station_id": "osm:n1", "median_minutes": 6.4,
             "source_release_id": STATION_RELEASE}]
        self.reader = EvidenceReader(connect=lambda: self.connection)

    def test_brief_lays_out_ring_prices_schools_and_station(self):
        out = self.reader.get_brief(["uk:lsoa:E01000004"], (800_000, 900_000), 3, "buy", "house")

        self.assertEqual(out["schemaVersion"], "area-brief.v1")
        self.assertEqual(out["productReleaseId"], OLD_RELEASE)
        area = out["areas"][0]
        self.assertEqual((area["rank"], area["borough"], area["ring"]), (1, "Camden test borough", ["uk:lsoa:E01000005"]))
        self.assertEqual(area["station"], {"stationId": "osm:n1", "name": "Camden Town",
                                           "modes": ["underground"], "walkMinutes": 6.4, "center": [-0.14, 51.54]})
        # Sample Street has 5 standard sales in the 36-month window: too few, so nothing is shown.
        self.assertEqual((area["priceContext"]["available"], area["priceContext"]["sales"]), (False, 5))
        self.assertEqual([r["geographyId"] for r in out["ring"]], ["uk:lsoa:E01000005"])
        self.assertEqual(area["geometry"]["type"], "Polygon")
        self.assertEqual(out["ring"][0]["ringOf"], ["uk:lsoa:E01000004"])
        self.assertEqual([(s["name"], s["grade"]["tier"]) for s in out["schools"]],
                         [("Sample Academy", "outstanding"), ("Sample Primary School", "good")])
        self.assertTrue(out["caveats"])

    def test_rent_reads_the_borough_average_rent(self):
        self.connection.rents = [
            {"geography_id": "uk:lsoa:E01000004", "raw_value": 2350, "bedrooms": "1 bedroom",
             "carrier_geography_id": "uk:lad:E09000007", "period": "2026-08-01",
             "source_release_id": "src-ons-pipr-2026-09"}]
        out = self.reader.get_brief(["uk:lsoa:E01000004"], (None, 2500), 1, "rent", "flat")
        area = out["areas"][0]
        self.assertEqual((area["estimatedPrice"], area["budgetFit"]), (2350, "within"))
        self.assertEqual(area["estimatedRent"]["period"], "2026-08")
        self.assertEqual(out["ring"][0]["budgetFit"], "unknown")  # no rent row for the neighbour
        self.connection.sources["src-ons-pipr-2026-09"] = {
            "source_url": "https://www.ons.gov.uk/", "licence": "OGL-3.0", "attribution": "ONS",
            "transformation_version": "close-knit-rents-1"}
        cited = self.reader.get_brief(["uk:lsoa:E01000004"], (None, 2500), 1, "rent", "flat")
        self.assertIn("src-ons-pipr-2026-09", [source["release"] for source in cited["sources"]])
        self.assertTrue(any("Private Rents" in caveat for caveat in cited["caveats"]))
        studio = self.reader.get_brief(["uk:lsoa:E01000004"], (None, 2500), 0, "rent", "flat")
        self.assertEqual(studio["areas"][0]["budgetFit"], "unknown")

    def test_rent_has_no_price_context(self):
        out = self.reader.get_brief(["uk:lsoa:E01000004"], (None, 2500), 1, "rent", "flat")
        self.assertEqual(out["areas"][0]["priceContext"], {"available": False, "reason": "no rental evidence"})
        self.assertEqual(out["areas"][0]["budgetFit"], "unknown")

    def test_invalid_requests_are_rejected(self):
        for ids, market in ((["uk:lad:E09000007"], "buy"), ([], "buy"),
                            (["uk:lsoa:E01000004", "uk:lsoa:E01000004"], "buy"),
                            (["uk:lsoa:E01000004"], "sell")):
            with self.subTest(ids=ids, market=market):
                with self.assertRaises(evidence.MalformedQuery):
                    self.reader.get_brief(ids, (None, None), 2, market, "any")
        with self.assertRaises(evidence.AreaNotFound):
            self.reader.get_brief(["uk:lsoa:E01999999"], (None, None), 2, "buy", "any")


@unittest.skipIf(TestClient is None, "dependencies are not installed")
class BriefHttpTests(unittest.TestCase):
    def setUp(self):
        connection = seed_production_fixture()
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=lambda: connection)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_brief_is_private_and_validated(self):
        ok = self.client.get("/api/v1/brief?areas=uk:lsoa:E01000004&budgetMin=800000&budgetMax=900000&bedrooms=3")
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertIn("no-store", ok.headers["cache-control"])
        self.assertEqual(ok.json()["request"]["budget"], [800000, 900000])
        self.assertEqual(self.client.get("/api/v1/brief?areas=nope").status_code, 400)


if __name__ == "__main__":
    unittest.main()
