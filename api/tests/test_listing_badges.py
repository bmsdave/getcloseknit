import time
import unittest
from datetime import date
from types import SimpleNamespace

from area_api import listing_badges
from area_api.evidence import EvidenceReader
from area_api.listing_badges import (ListingBadgesRequest, area_badge, area_ratings, area_score, days_chip, line_chips,
                                     standout_ratings, listing_badges as badges, match_badge, money_per_month, place_chips,
                                     price_bucket, rating, short_place)
from area_api.listing_card import offer_items, short_station, summary_pills

from test_production_evidence import seed_production_fixture

try:
    from fastapi.testclient import TestClient
    from area_api import app as app_module
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover
    TestClient = None

ITEM = {"listingId": "89918394", "url": "https://www.rightmove.co.uk/properties/89918394", "lat": 51.535,
        "lng": -0.145, "market": "buy", "askingPrice": 600000, "bedrooms": 2, "propertyType": "flat"}
FLATS = {"F": {"sales": 40, "p25": 450000, "medianPrice": 550000, "p75": 700000}}
FACTS = {"ratings": {"safety": 8, "station": 9, "schools": 6, "quiet": 2, "green": 7}, "byType": FLATS}


def request(items=None, **changes):
    return ListingBadgesRequest(**{"portal": "rightmove", "items": items or [ITEM], **changes})


def item(**changes):
    return request([{**ITEM, **changes}]).items[0]


class RatingTests(unittest.TestCase):
    def test_ratings_follow_the_sites_rule(self):
        self.assertEqual(rating(95, True), 10)
        self.assertEqual(rating(0, True), 1)
        self.assertEqual(rating(12, False), 9)  # lower crime is better
        self.assertIsNone(rating(None, True))
        self.assertIsNone(rating(140, True))

    def test_standout_ratings_use_the_area_page_tiles(self):
        tiles = [{"id": "safety", "standing": 84}, {"id": "station-walk", "standing": 13}, {"id": "noise", "standing": 81},
                 {"id": "nature", "standing": 95}, {"id": "schools", "standing": None}, {"id": "gp", "standing": 93}]
        self.assertEqual(standout_ratings(tiles), {"safety": 9, "station": 2, "quiet": 9, "green": 10})

    def test_area_ratings_read_crime_and_london_ranks(self):
        ranks = {"gettingAround": {"percentile": 20}, "bestPrimary": {"percentile": 71}, "quiet": None,
                 "greenSpace": {"percentile": 50}}

        self.assertEqual(area_ratings({"regionPercentile": 80}, ranks),
                         {"safety": 2, "station": 8, "schools": 8, "green": 5})
        self.assertEqual(area_ratings(None, None), {})

    def test_the_area_score_needs_three_ratings(self):
        self.assertEqual(area_score({"safety": 8, "station": 9, "schools": 6}), 8)
        self.assertIsNone(area_score({"safety": 8, "station": 9}))

    def test_the_area_badge_names_its_weakest_rating(self):
        self.assertEqual(area_badge(FACTS), {"score": 6, "band": 3, "excluded": False, "flag": "Noisy"})
        self.assertNotIn("flag", area_badge({"ratings": {"safety": 8, "station": 9, "schools": 6}}))
        self.assertEqual(area_badge({"ratings": {"safety": 8}}), {"score": None, "band": None, "excluded": False})


class PriceBucketTests(unittest.TestCase):
    def test_the_asking_price_is_placed_among_same_type_sales(self):
        self.assertEqual([price_bucket(item(askingPrice=price), FLATS) for price in (400000, 500000, 600000, 800000)],
                         [0, 1, 2, 3])

    def test_no_bucket_without_enough_sales_a_known_type_or_a_sale(self):
        self.assertIsNone(price_bucket(item(), {"F": {**FLATS["F"], "sales": 4}}))
        self.assertIsNone(price_bucket(item(propertyType="unknown"), FLATS))
        self.assertIsNone(price_bucket(item(market="rent", askingPrice=2000), FLATS))
        self.assertIsNone(price_bucket(item(askingPrice=None), FLATS))


PROFILE = {"places": [{"id": "g1", "label": "Gym", "weight": 1, "must": False},
                      {"id": "w1", "label": "King's Cross", "weight": 3, "must": True}]}
MATCH = {"score": 81, "excluded": False, "unmetLimits": [], "components": [
    {"factorId": "place:g1", "unit": "minutes", "rawValue": 9.6},
    {"factorId": "place:w1", "unit": "minutes", "rawValue": 27.2, "targetMinutes": 30}]}
PILLS = [{"label": "Safety", "value": "2/10", "band": 1}, {"label": "Quiet", "value": "6/10", "band": 3}]
TODAY = date(2026, 10, 18)


def chip(text, band, kind):
    return {"text": text, "band": band, "kind": kind}


def kinds(chips):
    return [c["kind"] for c in chips]


class LineChipTests(unittest.TestCase):
    def test_without_a_profile_only_close_knit_facts(self):
        chips = line_chips(item(listedOn="2026-10-06"), {**FACTS, "growth1y": 9.64, "pills": PILLS}, None, None, TODAY)

        self.assertEqual(chips, [chip("upper middle", None, "price"), chip("£2.7k/mo", None, "cost"),
                                 chip("12d on market", None, "days"), chip("+9.6% 1y", None, "trend")])

    def test_with_a_profile_minutes_to_every_place_lead_the_most_important_first(self):
        chips = line_chips(item(), FACTS, MATCH, PROFILE, TODAY)

        self.assertEqual(chips[:2], [chip("KX 27′", 4, "commute"), chip("Gym 10′", None, "commute")])
        self.assertEqual(kinds(chips), ["commute", "commute", "price", "cost"])

    def test_at_most_three_places(self):
        profile = {"places": [{"id": f"p{n}", "label": f"Place {n}", "weight": n} for n in range(5)]}
        match = {"components": [{"factorId": f"place:p{n}", "unit": "minutes", "rawValue": 10} for n in range(5)]}

        self.assertEqual([c["text"] for c in place_chips(match, profile)], ["Place 4 10′", "Place 3 10′", "Place 2 10′"])

    def test_missed_limits_lead_the_line(self):
        match = {**MATCH, "score": None, "excluded": True, "unmetLimits": ["zone:outside", "place:w1:over-limit"]}
        chips = line_chips(item(), FACTS, match, PROFILE, TODAY)

        self.assertEqual(chips[:2], [chip("Outside your zones", 1, "miss"), chip("Long commute", 1, "miss")])
        self.assertEqual(chips[2], chip("KX 27′", 4, "commute"))

    def test_a_weak_factor_a_pill_already_shows_is_not_flagged_again(self):
        components = [{"factorId": "crime", "weight": 3, "utility": 10},
                      {"factorId": "affordability", "weight": 1, "utility": 30}]
        match = {**MATCH, "components": MATCH["components"] + components}

        flags = [c for c in line_chips(item(), {**FACTS, "pills": PILLS}, match, PROFILE, TODAY) if c["kind"] == "flag"]
        self.assertEqual(flags, [chip("Over your budget", 2, "flag")])
        # Without a Safety pill, crime is the costliest weak factor.
        flags = [c for c in line_chips(item(), FACTS, match, PROFILE, TODAY) if c["kind"] == "flag"]
        self.assertEqual(flags, [chip("Higher crime", 1, "flag")])

    def test_a_longer_commute_is_not_flagged_beside_the_places_minutes(self):
        match = {**MATCH, "components": MATCH["components"] + [{"factorId": "commute", "weight": 2, "utility": 5}]}

        self.assertNotIn("flag", kinds(line_chips(item(), FACTS, match, PROFILE, TODAY)))

    def test_a_rental_has_no_price_position_or_mortgage(self):
        chips = line_chips(item(market="rent", askingPrice=2000, listedOn="2026-10-18"), {**FACTS, "growth1y": -1.25},
                           MATCH, PROFILE, TODAY)

        self.assertEqual(kinds(chips), ["commute", "commute", "days", "trend"])
        self.assertEqual(chips[2:], [chip("Listed today", None, "days"), chip("-1.2% 1y", None, "trend")])

    def test_missing_data_leaves_chips_out(self):
        self.assertEqual(line_chips(item(askingPrice=None, propertyType="unknown"), {"ratings": {}, "byType": {}},
                                    None, None, TODAY), [])
        self.assertEqual(place_chips(None, PROFILE), [])
        self.assertEqual(place_chips(MATCH, {"places": []}), [])
        self.assertIsNone(days_chip(item(listedOn="2026-10-20"), TODAY))  # a date ahead of today is ignored

    def test_the_minutes_tone_follows_the_limit(self):
        def band(minutes, target=30):
            component = {"factorId": "place:w1", "unit": "minutes", "rawValue": minutes, "targetMinutes": target}
            return place_chips({"components": [component]}, PROFILE)[0]["band"]

        self.assertEqual([band(20), band(30), band(36), band(45), band(45, None)], [5, 4, 2, 1, None])

    def test_short_place_names_and_money(self):
        self.assertEqual([short_place(label) for label in ("King's Cross", "Waterloo station", "Elephant & Castle",
                                                           "Work", "Grandma's flat in Hackney", "Supercalifragilistic")],
                         ["KX", "WAT", "E&C", "Work", "Grandma's", "Supercali…"])
        self.assertEqual([money_per_month(950.4), money_per_month(2000), money_per_month(5712)],
                         ["£950/mo", "£2k/mo", "£5.7k/mo"])


class AreaRowsTests(unittest.TestCase):
    """Rows 2 and 3: the card's summary pills worded short, and "Before you offer" in a few words."""

    PACK = {"crime": {"regionPercentile": 25}, "noise": {"available": True, "any55Share": 0.45},
            "schools": {"nearest": [{"latestInspection": "Outstanding"}] + [{"latestInspection": "Good"}] * 9}}
    AROUND = {"stations": [{"name": "West Hampstead Thameslink", "walkMinutes": 9}], "connectivityScore": 7.4,
              "nearestPark": {"name": "Fortune Green", "walkMinutes": 1}}
    EXTRAS = {"profile": {"metrics": [{"metricId": "deprivation", "regionPercentile": 62},
                                      {"metricId": "income", "regionPercentile": 81},
                                      {"metricId": "social-renting", "value": 21.4}]},
              "home": {"broadband": {"share": 0.874}, "extend": {"listed": {"total": 3}, "article4Share": 0}},
              "flood": {"available": True, "surfaceWater": {"highestBand": "medium", "shares": {"medium": 0.04}},
                        "riversSea": {"highestBand": "very-low", "shares": {}}},
              "location": {"conservation": {"presence": "partly", "share": 0.4, "areas": [{"name": "West End Green"}]},
                           "planning": {"applications": 85, "regionMedian": 60}}}

    def test_the_pills_are_the_cards_set_and_bands_worded_short(self):
        compact = summary_pills(self.PACK, self.AROUND, self.EXTRAS, compact=True)
        card = summary_pills(self.PACK, self.AROUND, self.EXTRAS)

        self.assertEqual([(p["label"], p["value"], p["band"]) for p in compact], [
            ("Safety", "8/10", 4), ("Schools", "1 Out · 9 Good", 5), ("Station", "9′ West Hampstead TL", 4),
            ("Quiet", "6/10", 3), ("Park", "1′", 5), ("Connectivity", "7/10", 4), ("Deprivation", "7/10", 4),
            ("Income", "9/10", 5), ("Social housing", "21%", None), ("Gigabit", "87%", None)])
        self.assertEqual([(p["label"], p["band"]) for p in compact], [(p["label"], p["band"]) for p in card])
        self.assertEqual(card[2]["value"], "9 min")

    def test_station_names_lose_their_suffix(self):
        self.assertEqual([short_station(name) for name in ("Bank Underground Station", "Hackney Downs Rail Station",
                                                           "Stratford")], ["Bank", "Hackney Downs", "Stratford"])

    def test_before_you_offer_says_only_what_is_there(self):
        self.assertEqual(offer_items(self.EXTRAS), [
            {"label": "Flood", "value": "surface medium", "band": 2},
            {"label": "Conservation", "value": "40% · West End Green", "band": None},
            {"label": "Listed", "value": "3", "band": None},
            {"label": "Planning", "value": "85 · London 60", "band": None}])
        quiet = {"home": {"extend": {"listed": {"total": 0}, "article4Data": "not-published"}}}
        self.assertEqual(offer_items(quiet), [{"label": "Article 4", "value": "ask", "band": None}])
        self.assertEqual(offer_items({}), [])


class MatchBadgeTests(unittest.TestCase):
    def test_a_match_scores_out_of_100_with_its_weakest_factor(self):
        match = {"score": 81.6, "excluded": False, "components": [
            {"factorId": "noise", "weight": 2, "utility": 20}, {"factorId": "crime", "weight": 3, "utility": 90}]}

        self.assertEqual(match_badge(match, {}), {"score": 82, "band": 5, "excluded": False, "flag": "Noisier"})

    def test_an_excluded_area_has_no_score(self):
        badge = match_badge({"score": None, "excluded": True, "components": []}, {})

        self.assertEqual((badge["score"], badge["band"], badge["excluded"]), (None, None, True))

    def test_an_area_outside_the_pack_has_no_score(self):
        self.assertEqual(match_badge(None, {}), {"score": None, "band": None, "excluded": False})


class ListingBadgesTests(unittest.TestCase):
    def context(self, areas):
        reader = SimpleNamespace(area_at=lambda lon, lat, cancel=None: areas.get((lat, lon)))
        return SimpleNamespace(reader=reader, cancel=None)

    def test_results_in_one_area_share_one_lookup(self):
        context = self.context({(51.535, -0.145): "uk:lsoa:A", (51.54, -0.1): "uk:lsoa:B"})
        looked_up = []

        def facts_for(_, area_id):
            looked_up.append(area_id)
            return FACTS

        result = badges(context, request([ITEM, {**ITEM, "listingId": "2"}, {**ITEM, "listingId": "3", "lat": 51.54,
                                                                            "lng": -0.1}]), facts_for=facts_for)

        self.assertEqual(looked_up, ["uk:lsoa:A", "uk:lsoa:B"])
        self.assertEqual(result["scale"], "area")
        self.assertEqual(result["items"][0], {"listingId": "89918394", "score": 6, "band": 3, "excluded": False,
                                              "flag": "Noisy", "bucket": 2, "chips": line_chips(item(), FACTS, None, None),
                                              "pills": [], "offer": []})

    def test_each_result_carries_its_areas_pills_and_offer_rows(self):
        context = self.context({(51.535, -0.145): "uk:lsoa:A"})
        offer = [{"label": "Flood", "value": "surface high", "band": 1}]
        result = badges(context, request(), facts_for=lambda *_: {**FACTS, "pills": PILLS, "offer": offer})

        self.assertEqual((result["items"][0]["pills"], result["items"][0]["offer"]), (PILLS, offer))

    def test_a_results_listing_date_is_accepted(self):
        context = self.context({(51.535, -0.145): "uk:lsoa:A"})
        result = badges(context, request([{**ITEM, "listedOn": "2026-10-01"}]), facts_for=lambda *_: FACTS,
                        today=TODAY)

        self.assertIn(chip("17d on market", None, "days"), result["items"][0]["chips"])
        with self.assertRaises(ValueError):
            request([{**ITEM, "listedOn": "1 Oct 2026"}])

    def test_a_result_outside_london_or_without_a_point_has_no_score(self):
        context = self.context({})
        result = badges(context, request([{**ITEM, "lat": 53.48, "lng": -2.24}, {**ITEM, "lat": None, "lng": None}]),
                        facts_for=lambda *_: FACTS)

        self.assertEqual([i["score"] for i in result["items"]], [None, None])

    def test_a_profile_scores_by_its_match(self):
        context = self.context({(51.535, -0.145): "uk:lsoa:A"})
        result = badges(context, request(profile={"v": 1}), facts_for=lambda *_: FACTS,
                        match_for=lambda area_id: {"score": 40, "excluded": False, "components": []})

        self.assertEqual(result["scale"], "match")
        self.assertEqual((result["items"][0]["score"], result["items"][0]["band"]), (40, 2))

    def test_a_profiles_line_leads_with_minutes_to_its_place(self):
        context = self.context({(51.535, -0.145): "uk:lsoa:A", (51.54, -0.1): "uk:lsoa:B"})
        result = badges(context, request([ITEM, {**ITEM, "listingId": "2", "lat": 53.48, "lng": -2.24}],
                                         profile={"v": 1, **PROFILE}),
                        facts_for=lambda *_: FACTS, match_for=lambda area_id: MATCH)

        self.assertEqual(result["items"][0]["chips"][0], chip("KX 27′", 4, "commute"))
        self.assertEqual(result["items"][1]["chips"], [])

    def test_at_most_30_results(self):
        with self.assertRaises(ValueError):
            request([{**ITEM, "listingId": str(n)} for n in range(31)])


@unittest.skipIf(TestClient is None, "dependencies are not installed")
class ListingBadgesRouteTests(unittest.TestCase):
    def setUp(self):
        self.previous = app_module._reader, app_module._connect, listing_badges.area_facts
        connection = seed_production_fixture()
        app_module._reader = EvidenceReader(connect=lambda: connection)
        app_module._connect = lambda: connection
        without_rate_limits(self)
        self.client = TestClient(app_module.app)
        # The fake connection has no London ranks or market tables; the ratings are covered above.
        listing_badges.area_facts = lambda context, area_id: FACTS

    def tearDown(self):
        app_module._reader, app_module._connect, listing_badges.area_facts = self.previous

    def post(self, body):
        return self.client.post("/api/v1/listing-badges", json={"v": 1, "portal": "rightmove", **body})

    def test_a_page_of_results_gets_its_badges(self):
        response = self.post({"items": [ITEM, {**ITEM, "listingId": "2", "lat": 51.4, "lng": 0.1}]})

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual([(i["listingId"], i["score"]) for i in response.json()["items"]], [("89918394", 6), ("2", None)])

    def test_unknown_fields_and_other_sites_are_refused(self):
        self.assertEqual(self.post({"items": [{**ITEM, "address": "1 Example Road"}]}).status_code, 422)
        self.assertEqual(self.post({"items": [{**ITEM, "url": "https://evil.example/1"}]}).status_code, 422)
        self.assertEqual(self.post({"items": [{**ITEM, "listingId": str(n)} for n in range(31)]}).status_code, 422)


class CacheTests(unittest.TestCase):
    def setUp(self):
        listing_badges.clear_cache()
        self.connection = seed_production_fixture()
        self.context = SimpleNamespace(reader=EvidenceReader(connect=lambda: self.connection), cancel=None)
        self.addCleanup(listing_badges.clear_cache)

    def test_an_areas_facts_are_read_once_and_reused_within_the_hour(self):
        first = listing_badges.area_facts(self.context, "uk:lsoa:E01000004")
        count = len(self.connection.statements)
        second = listing_badges.area_facts(self.context, "uk:lsoa:E01000004")

        self.assertIs(first, second)
        self.assertEqual(len(self.connection.statements), count)
        self.assertEqual(set(first), {"ratings", "byType", "growth1y", "pills", "offer"})
        # The card's readers: the pack (its crime gives Safety) and the People profile among them.
        self.assertIn("safety", first["ratings"])
        self.assertEqual(first["pills"][0]["label"], "Safety")
        markers = [sql.split("\n")[0] for sql, _ in self.connection.statements]
        self.assertTrue({"-- evidence:area-values", "-- evidence:area-profile", "-- places:area-origin"} <= set(markers))

    def test_a_page_of_25_results_reads_each_area_once(self):
        items = [{**ITEM, "listingId": str(n), "lat": 51.535 if n % 2 else 53.48} for n in range(25)]
        context = SimpleNamespace(reader=self.context.reader, cancel=None)
        started = time.perf_counter()
        result = badges(context, request(items))
        elapsed = time.perf_counter() - started
        statements = len(self.connection.statements)
        badges(context, request(items))

        self.assertEqual(len(result["items"]), 25)
        self.assertTrue(result["items"][1]["pills"])
        # A second page in the same areas only resolves points: no area is read again.
        area_at = sum(1 for sql, _ in self.connection.statements[statements:] if "evidence:area-at" in sql)
        self.assertEqual(len(self.connection.statements) - statements, area_at)
        self.assertLess(elapsed, 2)


if __name__ == "__main__":
    unittest.main()


class TwinPostcodeTests(unittest.TestCase):
    """#200: a listing giving only a postcode never gets another district's badges."""

    def test_twin_district_postcode_gets_no_badges(self):
        from tests.test_street_search import add_home, seeded
        connection = seeded()
        add_home(connection, "uk:addr:b37e1f4cdeab", "Enfield Delivery Office Savoy Parade, Enfield, EN1 1AA",
                 "EN1 1AA")
        context = SimpleNamespace(reader=EvidenceReader(connect=lambda: connection), cancel=None)
        result = badges(context, request([{**ITEM, "lat": None, "lng": None, "postcode": "N1 1AA"}]))
        [badge] = result["items"]
        self.assertIsNone(badge["score"])
        self.assertEqual(badge["chips"], [])


class OnspdPostcodeBadgesTests(unittest.TestCase):
    """#205: a listing on an ONSPD-only postcode gets badges, not an empty card."""

    def test_onspd_only_postcode_gets_a_score(self):
        from tests.test_street_search import seeded
        connection = seeded()
        connection.postcodes["E20 3AS"] = {"postcode": "E20 3AS", "geography_id": "uk:lsoa:E01000004",
                                           "name": "Hackney 001A", "borough_name": "Hackney",
                                           "center_lon": -0.06, "center_lat": 51.55}
        context = SimpleNamespace(reader=EvidenceReader(connect=lambda: connection), cancel=None)
        result = badges(context, request([{**ITEM, "lat": None, "lng": None, "postcode": "E20 3AS"}]),
                        facts_for=lambda ctx, area_id: FACTS)
        [badge] = result["items"]
        self.assertIsNotNone(badge["score"])
