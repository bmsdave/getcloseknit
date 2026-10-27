import base64
import json
import unittest
from types import SimpleNamespace

from area_api import listing_card
from area_api.evidence import EvidenceReader
from area_api.listing_card import ListingCardRequest, build_card, match_result, resolve_area

from test_production_evidence import seed_production_fixture

try:
    from fastapi.testclient import TestClient
    from area_api import app as app_module
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover
    TestClient = None

LISTING = {"portal": "rightmove", "listingId": "93384096", "url": "https://www.rightmove.co.uk/properties/93384096",
           "address": "Middleton Road, London, E8", "market": "buy", "askingPrice": 600000, "bedrooms": 2}
PACK = {"name": "Hackney 031C", "productReleaseId": "rel-1",
        "crime": {"regionPercentile": 80}, "schools": {"count": 28},
        "noise": {"available": True, "any55Share": 0.1}}
PLACE = {"title": "De Beauvoir · E8", "borough": "Hackney"}
AROUND = {"stations": [{"name": "Haggerston", "walkMinutes": 4, "zone": "2"}],
          "nearestPark": {"name": "Stonebridge Common", "walkMinutes": 12}}
PRICE = {"verdict": "in-line", "localResaleMedianPerSqm": 8573.2}


def request(**changes):
    return ListingCardRequest(**{**LISTING, **changes})


def block(card, kind):
    return next(item for item in card["blocks"] if item["type"] == kind)


class BuildCardTests(unittest.TestCase):
    def test_without_a_profile_the_card_invites_personalising(self):
        card = build_card(request(), "uk:lsoa:E01035650", PACK, PLACE, AROUND, PRICE, None)

        self.assertEqual(card["status"], "ok")
        self.assertEqual([b["type"] for b in card["blocks"]],
                         ["header", "cta", "facts", "price", "costs", "sections", "summary", "actions", "footnote"])
        self.assertEqual(block(card, "header")["title"], "De Beauvoir · E8")
        self.assertIn("utm_source=extension", block(card, "cta")["href"])

    def test_an_approximate_location_is_said_plainly(self):
        card = build_card(request(locationApproximate=True), "uk:lsoa:E1", PACK, PLACE, AROUND, None, None)

        self.assertEqual([b["type"] for b in card["blocks"]][:2], ["header", "footnote"])
        self.assertEqual(card["blocks"][1]["text"], "Approximate location: facts for the area around it.")

    def test_facts_read_as_plain_words_against_london(self):
        rows = {row["label"]: row for row in block(build_card(request(), "uk:lsoa:E1", PACK, PLACE, AROUND, PRICE, None),
                                                   "facts")["rows"]}

        self.assertEqual((rows["Crime"]["value"], rows["Crime"]["tone"]), ("Higher than most of London", "bad"))
        self.assertEqual(rows["Station"]["value"], "Haggerston, 4 min walk · zone 2")
        self.assertEqual(rows["Park"]["tone"], "neutral")
        self.assertEqual(rows["Noise"]["tone"], "good")

    def test_price_is_a_coarse_comparison_never_a_figure_for_the_home(self):
        price = block(build_card(request(), "uk:lsoa:E1", PACK, PLACE, AROUND, PRICE, None), "price")

        self.assertEqual(price["text"], "The asking price is in line with recent sales here for this size.")
        self.assertEqual(price["detail"], "Area median £8,573/m² over 36 months of recorded sales.")
        self.assertNotIn("worth", json.dumps(price))

    def test_rent_compares_with_the_borough_average(self):
        rent = {"verdict": "above-local", "boroughAverageRent": 2100, "incomeUsuallyNeeded": 72000}
        price = block(build_card(request(market="rent", askingPrice=2400), "uk:lsoa:E1", PACK, PLACE, None, rent, None), "price")

        self.assertIn("above the borough average for this size (£2,100 a month)", price["text"])
        self.assertIn("£72,000", price["detail"])

    def test_a_profile_match_shows_score_strengths_and_rank(self):
        match = {"score": 82, "rank": 50, "ranked": 1000, "excluded": False, "components": [
            {"factorId": "crime", "utility": 20.0, "weight": 4},
            {"factorId": "station-access", "utility": 90.0, "weight": 3},
            {"factorId": "market-level", "utility": 90.0, "weight": 0}]}
        card = build_card(request(profile={"factors": []}), "uk:lsoa:E1", PACK, PLACE, AROUND, PRICE, match)

        self.assertEqual(block(card, "match"), {"type": "match", "score": 82, "pros": ["Station nearby"],
                                                "cons": ["Higher crime"], "excluded": False,
                                                "rankText": "Top 5% of London for your search"})

    def test_a_low_rank_is_said_plainly(self):
        match = {"score": 42, "rank": 2316, "ranked": 3000, "excluded": False, "components": []}
        card = build_card(request(profile={"factors": []}), "uk:lsoa:E1", PACK, PLACE, AROUND, PRICE, match)

        self.assertEqual(block(card, "match")["rankText"], "Ranks 2,316 of 3,000 London areas for your search")

    def test_save_link_carries_the_listing_facts_in_the_fragment(self):
        href = block(build_card(request(), "uk:lsoa:E1", PACK, PLACE, AROUND, PRICE, None), "actions")["items"][0]["href"]
        body = href.split("#listing=v1.", 1)[1]
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))

        self.assertIn("/save-listing?utm_source=extension#listing=v1.", href)
        self.assertEqual((payload["url"], payload["askingPrice"], payload["geographyId"]),
                         (LISTING["url"], 600000, "uk:lsoa:E1"))


MARKET = {"available": True, "basis": {"name": "Hackney 031", "widened": False}, "byType": [
    {"propertyType": "F", "sales": 12, "p25": 450000, "medianPrice": 520000, "p75": 610000},
    {"propertyType": "T", "sales": 4, "p25": 800000, "medianPrice": 900000, "p75": 1000000}]}
PACK_MARKET = {**PACK, "market": {"turnoverPercent": 3.2, "leaseholdShareOfSales": 0.61,
                                  "resale": {"medianPricePerSquareMetre": 8000}}}
CIVIC = {"councilTax": {"bands": [{"band": "C", "amount": 1800.0}, {"band": "D", "amount": 2025.0}]}}
FLOOD = {"available": True, "riversSea": {"highestBand": "very-low", "shares": {"very-low": 1.0}},
         "surfaceWater": {"highestBand": "high", "shares": {"high": 0.04, "medium": 0.06}}}
LOCATION = {"conservation": {"share": 0.4, "presence": "partly", "areas": [{"name": "De Beauvoir"}]},
            "ulez": {"share": 1.0, "presence": "inside"}, "congestionCharge": {"share": 0.0, "presence": "outside"}}
HOME = {"broadband": {"share": 0.87, "regionShare": 0.8}}
EXTRAS = {"market": MARKET, "civic": CIVIC, "flood": FLOOD, "location": LOCATION, "home": HOME}
TODAY = listing_card.date(2026, 10, 18)
FORBIDDEN = ("worth", "fair price", "overpaying", "income", "social")


def card_v2(**changes):
    extras = changes.pop("extras", EXTRAS)
    price = PRICE if changes.get("market", "buy") == "buy" else None
    return build_card(request(**{"propertyType": "flat", **changes}), "uk:lsoa:E1", PACK_MARKET, PLACE, AROUND,
                      price, None, extras=extras, today=TODAY)


def blocks_of(card):
    return {item["type"]: item for item in card["blocks"]}


class PricePositionTests(unittest.TestCase):
    def test_the_asking_price_falls_in_a_bucket_of_same_type_sales(self):
        cases = {400000: 0, 450000: 1, 519999: 1, 520000: 2, 610000: 2, 610001: 3}
        for asking, bucket in cases.items():
            self.assertEqual(blocks_of(card_v2(askingPrice=asking))["pricePosition"]["bucket"], bucket, asking)

    def test_the_block_says_where_and_how_many_sales(self):
        position = blocks_of(card_v2(askingPrice=600000))["pricePosition"]

        self.assertEqual(position["label"], "Upper middle of flat sales here")
        self.assertEqual((position["sales"], position["q1"], position["median"], position["q3"]),
                         (12, 450000, 520000, 610000))
        self.assertEqual(position["homeType"], "flat")

    def test_a_widened_area_is_named(self):
        market = {**MARKET, "basis": {"name": "Hackney", "widened": True}}
        position = blocks_of(card_v2(askingPrice=300000, extras={**EXTRAS, "market": market}))["pricePosition"]

        self.assertEqual(position["label"], "Below most flat sales in the wider Hackney area")

    def test_fewer_than_five_same_type_sales_omit_the_block(self):
        self.assertNotIn("pricePosition", blocks_of(card_v2(propertyType="terraced")))

    def test_an_unknown_type_or_renting_omits_the_block(self):
        self.assertNotIn("pricePosition", blocks_of(card_v2(propertyType="unknown")))
        self.assertNotIn("pricePosition", blocks_of(card_v2(propertyType="bungalow")))
        self.assertNotIn("pricePosition", blocks_of(card_v2(market="rent", askingPrice=2000)))

    def test_per_square_metre_is_a_band_against_area_resale(self):
        position = blocks_of(card_v2(askingPrice=600000, floorAreaSqm=60))["pricePosition"]

        self.assertEqual(position["perSqm"], {"asking": 10000, "area": 8000, "band": "10-25-above"})
        self.assertNotIn("perSqm", blocks_of(card_v2(askingPrice=600000))["pricePosition"])

    def test_per_square_metre_bands(self):
        band = listing_card.per_sqm_band
        self.assertEqual([band(0.1), band(-0.1), band(0.25), band(-0.2), band(0.26), band(-0.4)],
                         ["in-line", "in-line", "10-25-above", "10-25-below", "over-25-above", "over-25-below"])


class PriceStoryTests(unittest.TestCase):
    def test_listing_age_changes_and_first_seen_make_one_short_text(self):
        story = blocks_of(card_v2(askingPrice=575000, listedOn="2026-09-18",
                                  priceChanges=[{"date": "2026-10-01", "price": 590000},
                                                {"date": "2026-10-10", "price": 575000}],
                                  firstSeen={"date": "2026-09-20", "price": 600000}))["priceStory"]

        self.assertEqual(story["daysOnMarket"], 30)
        self.assertEqual(story["areaTurnoverPct"], 3.2)
        self.assertEqual(len(story["changes"]), 2)
        self.assertEqual(story["text"], "On the market 30 days. Price changed 2 times, last on 10 Oct 2026. "
                                        "Down £25,000 since you first saw it on 20 Sep 2026. "
                                        "About 3.2% of recorded homes here sell each year.")

    def test_without_listing_dates_there_is_no_story(self):
        self.assertNotIn("priceStory", blocks_of(card_v2()))


class CostsTests(unittest.TestCase):
    def test_default_assumptions_give_mortgage_council_tax_and_charges(self):
        costs = blocks_of(card_v2(councilTaxBand="C", serviceChargeYearly=2400, groundRentYearly=250))["costs"]
        parts = {part["label"]: part["amount"] for part in costs["parts"]}

        self.assertEqual(parts, {"Mortgage": 2736, "Council tax": 150, "Service charge": 200, "Ground rent": 21})
        self.assertEqual(costs["monthly"], 3107)
        self.assertEqual(costs["upfront"], [{"label": "Deposit", "amount": 60000},
                                            {"label": "Stamp duty", "amount": 20000}])
        self.assertEqual(costs["assumptions"]["depositPct"], 10)
        self.assertEqual(costs["chips"], ["Inside ULEZ", "Gigabit for 87% of homes"])

    def test_the_boroughs_bands_come_a_month_without_the_listings_band(self):
        costs = blocks_of(card_v2())["costs"]

        self.assertEqual(costs["councilTaxByBand"], {"C": 150, "D": 169})
        self.assertNotIn("Council tax", [part["label"] for part in costs["parts"]])

    def test_the_buyers_own_assumptions_and_relief_apply(self):
        buyer = {"depositPct": 25, "ratePct": 0, "years": 25, "firstTime": True, "additionalHome": False}
        costs = blocks_of(card_v2(askingPrice=400000, buyer=buyer))["costs"]

        self.assertEqual(costs["parts"], [{"label": "Mortgage", "amount": 1000}])
        self.assertEqual(costs["upfront"][1], {"label": "Stamp duty", "amount": 5000})

    def test_renting_or_no_price_has_no_costs(self):
        self.assertNotIn("costs", blocks_of(card_v2(market="rent", askingPrice=2000)))
        self.assertNotIn("costs", blocks_of(card_v2(askingPrice=None)))


class FlagsTests(unittest.TestCase):
    def test_flags_say_what_the_listing_does_not_bad_first(self):
        flags = blocks_of(card_v2(leaseYearsRemaining=72))["flags"]["items"]

        self.assertEqual([item["tone"] for item in flags], ["bad", "bad", "neutral", "neutral"])
        self.assertTrue(flags[0]["text"].startswith("Lease has 72 years left"))
        self.assertEqual(flags[1]["text"], "4% of the land here is at high risk of flooding from surface water")
        self.assertEqual(flags[2]["text"], "40% of the area is in a conservation area (De Beauvoir)")
        self.assertTrue(flags[3]["text"].startswith("Inside the ULEZ"))

    def test_no_layers_and_a_long_lease_mean_no_flags(self):
        self.assertNotIn("flags", blocks_of(card_v2(leaseYearsRemaining=120, extras={})))


class SectionsTests(unittest.TestCase):
    def test_five_columns_from_what_the_card_already_loads(self):
        card = card_v2(askingPrice=600000, floorAreaSqm=60, tenure="leasehold", listedOn="2026-10-01")
        columns = {column["title"]: column["rows"] for column in blocks_of(card)["sections"]["columns"]}

        self.assertEqual(list(columns), ["This home", "Costs", "Getting around", "The area", "Before you offer"])
        self.assertIn({"label": "Floor area", "value": "60 m² · £10,000/m² asking"}, columns["This home"])
        self.assertIn({"label": "Haggerston", "value": "4 min walk · zone 2", "tone": "good"}, columns["Getting around"])
        self.assertIn({"label": "Gigabit", "value": "87% of homes"}, columns["The area"])
        self.assertIn({"label": "Ask", "value": "Years left on the lease"}, columns["Before you offer"])
        self.assertIn({"label": "On the market", "value": "17 days"}, columns["Before you offer"])

    def test_copy_never_values_the_home_or_scores_people(self):
        card = card_v2(askingPrice=700000, floorAreaSqm=50, leaseYearsRemaining=70, listedOn="2026-10-01",
                       firstSeen={"date": "2026-10-02", "price": 750000})
        text = json.dumps(card).lower()

        for word in FORBIDDEN:
            self.assertNotIn(word, text)


class LoadExtrasTests(unittest.TestCase):
    def test_a_failing_layer_is_left_out(self):
        def connect():
            raise RuntimeError("no database")
        context = SimpleNamespace(reader=SimpleNamespace(_connect=connect), cancel=None)

        self.assertEqual(listing_card.load_extras(context, "uk:lsoa:E01000001", request()), {})

    def test_without_a_database_there_are_no_extras(self):
        context = SimpleNamespace(reader=SimpleNamespace(), cancel=None)

        self.assertEqual(listing_card.load_extras(context, "uk:lsoa:E01000001", request()), {})


class ResolveAreaTests(unittest.TestCase):
    def context(self):
        calls = []
        reader = SimpleNamespace(area_at=lambda lon, lat, cancel=None: calls.append((lon, lat)) or "uk:lsoa:X")
        return SimpleNamespace(reader=reader, cancel=None), calls

    def test_a_point_outside_london_is_not_looked_up(self):
        context, calls = self.context()

        self.assertIsNone(resolve_area(context, request(lat=53.48, lng=-2.24)))
        self.assertEqual(calls, [])

    def test_a_london_point_is_looked_up_as_longitude_latitude(self):
        context, calls = self.context()

        self.assertEqual(resolve_area(context, request(lat=51.54, lng=-0.07)), "uk:lsoa:X")
        self.assertEqual(calls, [(-0.07, 51.54)])

    def test_without_point_or_postcode_there_is_no_area(self):
        self.assertIsNone(resolve_area(self.context()[0], request()))

    def test_match_result_counts_ranked_areas(self):
        pack = {"values": [{"geographyId": "a", "rank": 1}, {"geographyId": "b", "rank": None},
                           {"geographyId": "c", "rank": 2}]}

        self.assertEqual(match_result(pack, "c")["ranked"], 2)
        self.assertIsNone(match_result(pack, "z"))


@unittest.skipIf(TestClient is None, "dependencies are not installed")
class ListingCardRouteTests(unittest.TestCase):
    def setUp(self):
        self.previous = app_module._reader, app_module._connect
        connection = seed_production_fixture()
        app_module._reader = EvidenceReader(connect=lambda: connection)
        app_module._connect = lambda: connection
        without_rate_limits(self)
        self.client = TestClient(app_module.app)
        # The fake connection has no places tables; stations and parks are covered by BuildCardTests.
        self.getting_around = listing_card._getting_around
        listing_card._getting_around = lambda context, area_id: None

    def tearDown(self):
        app_module._reader, app_module._connect = self.previous
        listing_card._getting_around = self.getting_around

    def test_a_point_in_a_loaded_area_gets_its_card(self):
        response = self.client.post("/api/v1/listing-card", json={**LISTING, "lat": 51.535, "lng": -0.145})

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["geographyId"], "uk:lsoa:E01000004")
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_the_extension_usage_opt_out_records_no_event(self):
        from unittest import mock
        with mock.patch.object(app_module.usage, "record") as record:
            self.client.post("/api/v1/listing-card", json={**LISTING, "lat": 51.535, "lng": -0.145},
                             headers={"x-close-knit-analytics": "off"})
            record.assert_not_called()
            self.client.post("/api/v1/listing-card", json={**LISTING, "lat": 51.535, "lng": -0.145})
            record.assert_called_once()

    def test_a_london_point_outside_loaded_areas_is_outside_coverage(self):
        response = self.client.post("/api/v1/listing-card", json={**LISTING, "lat": 51.4, "lng": 0.1})

        self.assertEqual(response.json()["status"], "outside-coverage")

    def test_an_approximate_room_gets_its_area_card_without_a_price_check(self):
        room = {"portal": "spareroom", "listingId": "19000001", "market": "rent", "askingPrice": 900,
                "url": "https://www.spareroom.co.uk/flatshare/london/hackney/19000001",
                "lat": 51.535, "lng": -0.145, "locationApproximate": True}
        response = self.client.post("/api/v1/listing-card", json=room)

        self.assertEqual(response.status_code, 200, response.text)
        card = response.json()
        self.assertEqual(card["geographyId"], "uk:lsoa:E01000004")
        self.assertNotIn("price", [b["type"] for b in card["blocks"]])

    def test_openrent_listings_are_accepted(self):
        response = self.client.post("/api/v1/listing-card", json={
            "portal": "openrent", "listingId": "3900001", "market": "rent", "lat": 51.535, "lng": -0.145,
            "url": "https://www.openrent.co.uk/property-to-rent/london/1-bed-flat-example-road-nw1/3900001"})

        self.assertEqual(response.status_code, 200, response.text)

    def test_only_portal_listing_urls_are_accepted(self):
        response = self.client.post("/api/v1/listing-card",
                                    json={**LISTING, "url": "https://evil.example/properties/1"})

        self.assertEqual(response.status_code, 422)

    def test_unknown_fields_are_refused(self):
        response = self.client.post("/api/v1/listing-card", json={**LISTING, "description": "copied text"})

        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()


class Area360ParityRowTests(unittest.TestCase):
    def test_station_lines_connectivity_park_size_and_ofsted(self):
        from area_api.listing_card import fact_rows
        pack = {"schools": {"count": 7, "nearest": [{"latestInspection": "Outstanding"},
                                                    {"latestInspection": "School remains Good"},
                                                    {"latestInspection": "Good"}]}}
        around = {"stations": [{"name": "Perivale", "walkMinutes": 14, "zone": "4",
                                "lines": [{"name": "Central"}]}],
                  "connectivityScore": "2", "nearestPark": {"name": "Pitshanger Park", "sizeClass": "local", "walkMinutes": 1}}
        values = {row["label"]: row["value"] for row in fact_rows(pack, around)}
        self.assertEqual(values["Station"], "Perivale, 14 min walk · zone 4 · Central")
        self.assertEqual(values["Connectivity"], "2/10 for public transport")
        self.assertEqual(values["Park"], "Pitshanger Park (local park), 1 min walk")
        self.assertEqual(values["Schools"], "7 state schools within 1.5 km · 1 Outstanding, 2 Good")

    def test_people_rows_rate_deprivation_and_income_and_show_social_housing(self):
        from area_api.listing_card import people_rows
        profile = {"metrics": [{"metricId": "deprivation", "regionPercentile": 86, "value": 8.0},
                               {"metricId": "income", "regionPercentile": 88, "value": 92853.0},
                               {"metricId": "social-renting", "regionPercentile": 5, "value": 1.4}]}
        values = {row["label"]: row["value"] for row in people_rows(profile)}
        self.assertEqual(values["Deprivation"], "9/10 · less deprived than 86% of London")
        self.assertEqual(values["Income"], "9/10 · £93k a household a year (wider area)")
        self.assertEqual(values["Social housing"], "1.4% of homes · more than 5% of London")
        self.assertEqual(people_rows(None), [])


class PlaceRowTests(unittest.TestCase):
    def test_minutes_to_each_place_in_the_search(self):
        from area_api.listing_card import place_rows
        match = {"components": [{"factorId": "place:work", "unit": "minutes", "rawValue": 25.4, "targetMinutes": 30},
                                {"factorId": "place:gym", "unit": "minutes", "rawValue": 16, "targetMinutes": 5},
                                {"factorId": "crime", "unit": "per-1000", "rawValue": 60}]}
        profile = {"places": [{"id": "work", "label": "King's Cross"}, {"id": "gym", "label": "Gym"}]}
        self.assertEqual(place_rows(match, profile), [
            {"label": "King's Cross", "value": "25 min (you said 30)", "tone": "good"},
            {"label": "Gym", "value": "16 min (you said 5)", "tone": "bad"}])
        self.assertEqual(place_rows(None, None), [])


class SummaryTests(unittest.TestCase):
    MATCH = {"score": 40, "excluded": True, "unmetLimits": ["min:crime", "must:place:work"], "components": [
        {"factorId": "place:work", "unit": "minutes", "rawValue": 27.2, "targetMinutes": 80},
        {"factorId": "place:gym", "unit": "minutes", "rawValue": 16, "targetMinutes": 5}]}
    PROFILE = {"places": [{"id": "work", "label": "King's Cross", "weight": 3, "must": True},
                          {"id": "gym", "label": "Gym", "weight": 1, "must": False}]}

    def summary(self, match=None, extras=EXTRAS, pack=PACK_MARKET, **changes):
        fields = {"propertyType": "flat", "askingPrice": 600000, "floorAreaSqm": 60, "listedOn": "2026-10-01",
                  "priceChanges": [{"date": "2026-10-01", "price": 625000}], **changes}
        if match:
            fields["profile"] = self.PROFILE
        price = PRICE if fields.get("market", "buy") == "buy" else None
        card = build_card(request(**fields), "uk:lsoa:E1", pack, PLACE, AROUND, price, match, extras=extras, today=TODAY)
        return blocks_of(card).get("summary")

    def test_four_groups_in_order_led_by_what_only_close_knit_has(self):
        summary = self.summary(match=self.MATCH)
        self.assertEqual([(g["title"], g["only"]) for g in summary["groups"]],
                         [("For your search", True), ("The price", True), ("The money", False), ("Before you offer", True)])

    def test_search_group_says_the_verdict_then_minutes_to_each_place(self):
        rows = self.summary(match=self.MATCH)["groups"][0]["rows"]
        self.assertEqual(rows[0], {"label": "Fit", "value": "Misses 2 of your limits", "tone": "bad"})
        self.assertEqual(rows[1], {"label": "King's Cross", "value": "27 min · you said 80 ✓", "tone": "good"})
        self.assertEqual(rows[2]["value"], "16 min · you said 5 ✕")
        ranked = self.summary(match={"score": 80, "rank": 40, "ranked": 1000, "components": []})
        self.assertEqual(ranked["groups"][0]["rows"][0]["value"], "Top 4% of London for your search")

    def test_without_a_profile_there_is_no_search_group(self):
        self.assertNotIn("For your search", [g["title"] for g in self.summary()["groups"]])

    def test_price_group_compares_with_sales_area_and_time_on_market(self):
        pack = {**PACK_MARKET, "market": {**PACK_MARKET["market"], "growth": {"growth1y": 2.4}}}
        rows = {r["label"]: r for r in self.summary(pack=pack)["groups"][0]["rows"]}
        self.assertEqual(rows["Vs sales"]["value"], "Upper middle of 12 flat sales")
        self.assertEqual(rows["£/m²"]["value"], "£10,000 asking · area £8,000")
        self.assertEqual(rows["On the market"]["value"], "17 days · down £25,000")
        self.assertEqual(rows["Area prices"]["value"], "+2.4% in a year")

    def test_money_group_is_a_month_all_in_upfront_council_tax_and_assumptions(self):
        groups = {g["title"]: g["rows"] for g in self.summary(councilTaxBand="C")["groups"]}
        rows = {r["label"]: r["value"] for r in groups["The money"]}
        self.assertTrue(rows["A month"].endswith(" all in"))
        self.assertIn("deposit · £", rows["Upfront"])
        self.assertEqual(rows["Council tax"], "£150 a month (band C)")
        self.assertEqual(rows["Assumes"], "10% deposit · 4.5% over 30 years")
        unlisted = {g["title"]: g["rows"] for g in self.summary()["groups"]}["The money"]
        self.assertIn({"label": "Council tax", "value": "Band not listed: ask", "tone": "neutral"}, unlisted)
        self.assertNotIn("The money", [g["title"] for g in self.summary(market="rent", askingPrice=2000)["groups"]])

    def test_before_you_offer_lists_only_what_needs_a_look(self):
        extras = {**EXTRAS, "home": {**HOME, "extend": {"listed": {"total": 3}, "article4Share": 0.2}},
                  "location": {**LOCATION, "planning": {"applications": 40, "regionMedian": 25}}}
        rows = {g["title"]: g["rows"] for g in self.summary(extras=extras)["groups"]}["Before you offer"]
        self.assertEqual(rows, [
            {"label": "Flood: surface", "value": "4% of land at high risk", "tone": "bad"},
            {"label": "Conservation", "value": "40% of the area · De Beauvoir", "tone": "neutral"},
            {"label": "Listed · Art. 4", "value": "3 listed · Article 4 on 20%", "tone": "neutral"},
            {"label": "Planning", "value": "40 in 2 years · London 25", "tone": "neutral"}])

    def test_pills_rate_shared_basics_with_bands(self):
        pack = {**PACK_MARKET, "schools": {"count": 9, "nearest": [{"latestInspection": "Outstanding"},
                                                                   {"latestInspection": "Good"}]}}
        around = {**AROUND, "connectivityScore": "6"}
        extras = {**EXTRAS, "profile": {"metrics": [{"metricId": "deprivation", "regionPercentile": 86},
                                                    {"metricId": "income", "regionPercentile": 41},
                                                    {"metricId": "social-renting", "value": 22.4}]}}
        card = build_card(request(), "uk:lsoa:E1", pack, PLACE, around, None, None, extras=extras, today=TODAY)
        pills = {p["label"]: (p["value"], p["band"]) for p in blocks_of(card)["summary"]["pills"]}
        self.assertEqual(pills, {
            "Safety": ("2/10", 1), "Schools": ("1 Outstanding · 1 Good", 5), "Station": ("4 min", 5),
            "Quiet": ("9/10", 5), "Park": ("12 min", 3), "Connectivity": ("6/10", 3), "Deprivation": ("9/10", 5),
            "Income": ("5/10", 3), "Social housing": ("22%", None), "Gigabit": ("87%", None)})

    def test_summary_never_values_the_home(self):
        text = json.dumps(self.summary(match=self.MATCH)).lower()
        for word in ("worth", "overpaying", "fair price"):
            self.assertNotIn(word, text)


class OfstedGradeCountTests(unittest.TestCase):
    """Fix 158: the listing card's Ofsted counts read the standing grade first, so a school whose
    newest outcome is an ungraded visit ("Standards maintained") is still counted."""

    def test_standing_grade_counts_a_school_with_only_an_ungraded_outcome(self):
        nearest = [{"urn": "100857", "latestInspection": "Good (2018)",
                    "standingInspection": {"grade": "Good", "framework": "legacy-overall", "year": "2018"}},
                   {"urn": "100001", "latestInspection": "Outstanding", "standingInspection": None}]

        self.assertEqual(listing_card._ofsted_grades(nearest),
                         {"Outstanding": 1, "Good": 1, "Requires improvement": 0, "Inadequate": 0, "Report card": 0})

    def test_a_report_card_school_is_counted_apart_from_the_legacy_grades(self):
        """#226: a report card has no single grade; it used to drop out of the counts."""
        nearest = [{"urn": "103100", "latestInspection": "Report card 2025/26",
                    "standingInspection": {"grade": "report card", "framework": "report-card", "year": "2026"}},
                   {"urn": "100857", "latestInspection": "Report card 2025/26"},
                   {"urn": "100001", "latestInspection": "Good", "standingInspection": None}]

        self.assertEqual(listing_card._ofsted_grades(nearest)["Report card"], 2)
        self.assertEqual(listing_card._ofsted_counts(nearest), "1 Good, 2 Report card")

    def test_the_schools_pill_band_reads_legacy_grades_only(self):
        pack = {"schools": {"count": 2, "nearest": [
            {"urn": "103100", "latestInspection": "Report card 2025/26",
             "standingInspection": {"grade": "report card", "framework": "report-card", "year": "2026"}},
            {"urn": "100001", "latestInspection": "Good", "standingInspection": None}]}}
        pill = next(p for p in listing_card.summary_pills(pack, None, {}, compact=True) if p["label"] == "Schools")
        self.assertEqual((pill["band"], pill["value"]), (5, "1 Good · 1 RC"))
        pack["schools"]["nearest"].pop()
        pill = next(p for p in listing_card.summary_pills(pack, None, {}, compact=False) if p["label"] == "Schools")
        self.assertEqual((pill["band"], pill["value"]), (None, "1 Report card"))

    def test_latest_inspection_is_the_fallback_without_a_standing_row(self):
        nearest = [{"urn": "100001", "latestInspection": "Outstanding"}]

        self.assertEqual(listing_card._ofsted_grades(nearest)["Outstanding"], 1)

    def test_an_ungraded_outcome_alone_still_counts_nothing(self):
        nearest = [{"urn": "100857", "latestInspection": "Standards maintained"}]

        self.assertEqual(sum(listing_card._ofsted_grades(nearest).values()), 0)
