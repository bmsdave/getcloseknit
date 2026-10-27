"""Car as a chosen place mode (routed on the car matrix near a hub, otherwise a straight-line estimate at a
typical morning-traffic speed) and the optional time band ("when") on a place: validated, carried by share
links, ignored by scoring."""
import json
import unittest

from area_api import matching, personal_places, share_links
from tests.test_personal_places import FakePlaceConnection, _profile

try:
    from area_api import commute, home_search
    from tests.test_commute import OFFICE, _connection
    from tests.test_production_evidence import OLD_RELEASE
except ImportError:  # pragma: no cover - dependency-free environments
    home_search = None

CAR_OFFICE = {"id": "work", "label": "Office", "target": {"kind": "point", "latitude": 51.53, "longitude": -0.12},
              "mode": "car", "targetMinutes": 40, "weight": 4, "must": False}


def _link_profile() -> dict:
    profile = _profile()
    profile.update({"bedrooms": 2, "forecastHorizon": "1y", "school": {
        "phases": [], "characteristics": [], "facetWeights": {}, "shortlistUrns": [], "desiredSchoolCount": 3}})
    return profile


class CarPlaceTests(unittest.TestCase):
    def setUp(self):
        personal_places.clear_cache()

    def test_car_estimates_at_a_morning_traffic_speed(self):
        self.assertAlmostEqual(personal_places.estimate_minutes(5.0, "car"), 5.0 * 1.3 / 20.0 * 60)
        self.assertLess(personal_places.estimate_minutes(5.0, "car"), personal_places.estimate_minutes(5.0, "cycle"))

    def test_car_and_time_bands_validate(self):
        kind = {**CAR_OFFICE, "id": "shop", "target": {"kind": "category", "category": "supermarket"}}
        matching.validate_places([CAR_OFFICE, kind])
        for when in matching.PLACE_WHENS:
            matching.validate_places([{**CAR_OFFICE, "when": when}])
        for bad in ({**CAR_OFFICE, "mode": "taxi"}, {**CAR_OFFICE, "when": "sunday-night"}, {**CAR_OFFICE, "when": 1}):
            with self.subTest(bad=bad), self.assertRaises(matching.InvalidMatchRequest):
                matching.validate_places([bad])
        self.assertEqual(matching.PLACE_MODES[:3], ("walk", "cycle", "transit"))  # old links keep their indexes

    def test_unrouted_car_places_are_straight_line_estimates(self):
        connection = FakePlaceConnection()
        park = {"id": "park", "label": "Any park", "target": {"kind": "category", "category": "park"},
                "mode": "car", "targetMinutes": 10, "weight": 2, "must": False}
        rows = personal_places.place_rows(connection, "rel", [CAR_OFFICE, park])
        work = {row["geography_id"]: row for row in rows if row["factor_id"] == "place:work"}
        km = personal_places.haversine_km(51.45, -0.30, 51.53, -0.12)
        self.assertEqual(work["b"]["raw_value"], round(personal_places.estimate_minutes(km, "car"), 1))
        self.assertEqual(work["b"]["quality"], "fallback")
        nearest = next(row for row in rows if row["factor_id"] == "place:park" and row["geography_id"] == "a")
        self.assertEqual(nearest["raw_value"], round(personal_places.estimate_minutes(0.2, "car"), 1))

    def test_time_band_does_not_change_the_score(self):
        rows = [{"geography_id": "a", "name": "A", "carrier_geography_id": "a", "quality": "fallback",
                 "factor_id": "place:work", "raw_value": 25, "utility": None, "unit": "minutes",
                 "source_release_id": personal_places.ESTIMATE_RELEASE}]
        morning = matching.build_match_pack(_profile(places=[CAR_OFFICE]), rows)
        evening = matching.build_match_pack(_profile(places=[{**CAR_OFFICE, "when": "weekday-pm"}]), rows)
        self.assertEqual(morning["values"][0]["score"], evening["values"][0]["score"])

    def test_links_carry_car_and_the_time_band(self):
        profile = {**_link_profile(), "places": [{**CAR_OFFICE, "when": "saturday"}, {**CAR_OFFICE, "id": "plain"}]}
        link = "https://x/#" + share_links.encode_profile(profile).lstrip("#")
        places = share_links.profile_from_link(link)["places"]
        self.assertEqual([place.get("when") for place in places], ["saturday", None])
        self.assertEqual(places[0]["mode"], "car")
        packed = share_links._pack_place({**CAR_OFFICE, "when": "weekday-pm"})
        self.assertEqual((packed[5], packed[9], len(share_links._pack_place(CAR_OFFICE))), (3, 1, 9))

    def test_a_damaged_time_band_damages_the_link(self):
        compact = share_links.decode_profile(share_links.encode_profile({**_link_profile(), "places": [CAR_OFFICE]}))
        # None is "no time band" (it pads the tail when a school ranking follows), so it is not damage.
        for index in (3, -1, True):
            compact[-1]["p"][0][9:] = [index]
            fragment = share_links.PROFILE_PREFIX + share_links._base64url(json.dumps(compact, separators=(",", ":")))
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, "damaged"):
                share_links.profile_from_link("https://x/" + fragment)


@unittest.skipIf(home_search is None, "dependencies are not installed")
class RoutedCarTests(unittest.TestCase):
    def setUp(self):
        commute.clear_cache()
        personal_places.clear_cache()

    def test_car_places_near_a_hub_use_the_car_matrix(self):
        connection = _connection()
        connection.execute("-- evidence:active-release\nSELECT 1")
        rows = personal_places.place_rows(connection, OLD_RELEASE, [{**OFFICE, "mode": "car"}])
        routed = {row["geography_id"]: row for row in rows}
        ride = commute.last_leg_minutes(commute.nearest_hub([connection.commute_hubs[0]], 51.5353, -0.1246)[1], "car")
        self.assertEqual(routed["uk:lsoa:E01000004"]["raw_value"], round(30 + ride, 1))
        self.assertEqual(routed["uk:lsoa:E01000004"]["quality"], "observed")
        self.assertNotIn("uk:lsoa:E01000005", routed)  # no car minutes there: not a transit time in disguise

    def test_kinds_of_place_show_car_minutes_too(self):
        entry = commute._local_entry(CAR_OFFICE, 1600.0, "Tesco")
        self.assertEqual(entry["modes"]["car"]["minutes"], round(personal_places.estimate_minutes(1.6, "car")))

    def test_claude_can_choose_car(self):
        pin = home_search.PlaceInput(label="Office", latitude=51.53, longitude=-0.12, mode="car")
        kind = home_search.PlaceInput(label="Big shop", category="supermarket", mode="car")
        self.assertEqual([home_search._place(item, set())["mode"] for item in (pin, kind)], ["car", "car"])


if __name__ == "__main__":
    unittest.main()
