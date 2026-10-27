"""Specialty coffee: source agreement, roasters, names, chains and the specialty list, Foursquare
closures, the threshold and the cuisine tag."""

import unittest

from area_analytics import places_specialty as ps

COFFEE_FSQ = "Dining and Drinking > Cafe, Coffee, and Tea House > Coffee Shop"
CAFE_FSQ = "Dining and Drinking > Cafe, Coffee, and Tea House > Café"


def points(**signals):
    return ps.score(ps.Signals(**signals))[0]


def specialty(**signals):
    value = points(**signals)
    return value is not None and value >= ps.THRESHOLD


class ScoreTests(unittest.TestCase):
    def test_every_source_calling_it_a_coffee_shop_counts(self):
        self.assertEqual(points(name="Hej", osm_tags={"amenity": "cafe", "cuisine": "coffee_shop"}), 1)
        self.assertEqual(points(name="Hej", osm_tags={"amenity": "cafe", "cuisine": "coffee_shop"},
                                overture_category="coffee_shop", fsq_labels=(COFFEE_FSQ,)), 3)
        self.assertTrue(specialty(name="Hej", osm_tags={"cuisine": "coffee_shop"}, overture_category="coffee_shop",
                                  fsq_labels=(COFFEE_FSQ,)))
        self.assertFalse(specialty(name="Hej", overture_category="coffee_shop", fsq_labels=(COFFEE_FSQ,)))

    def test_an_overture_record_built_from_foursquare_is_half_a_vote(self):
        self.assertEqual(points(name="Hej", overture_category="coffee_shop", fsq_labels=(COFFEE_FSQ,),
                                overture_from_fsq=True), 1.5)

    def test_two_sources_and_a_coffee_name_make_it(self):
        self.assertTrue(specialty(name="Sendero Coffee", overture_category="coffee_shop", fsq_labels=(COFFEE_FSQ,)))
        self.assertFalse(specialty(name="Sendero Coffee", fsq_labels=(COFFEE_FSQ,)))

    def test_a_plain_cafe_is_not_specialty(self):
        value = points(name="Sunrise Cafe", osm_tags={"amenity": "cafe"}, overture_category="cafe",
                       fsq_labels=(CAFE_FSQ,))
        self.assertEqual(value, -0.5)

    def test_food_led_labels_and_names_lower_it(self):
        self.assertEqual(points(name="Mario's", overture_category="breakfast_and_brunch_restaurant",
                                fsq_labels=("Dining and Drinking > Breakfast Spot",)), -2)
        self.assertEqual(points(name="Coffee & Grill", fsq_labels=(COFFEE_FSQ,)), -1)
        self.assertEqual(points(name="Star Café & Restaurant", fsq_labels=(COFFEE_FSQ,)), -1)
        self.assertEqual(points(name="Hank", osm_tags={"cuisine": "coffee_shop;sandwich"}), 0)

    def test_generic_and_mixed_coffee_names_get_no_bonus(self):
        self.assertEqual(points(name="The Coffee Shop"), 0)
        self.assertEqual(points(name="Coffee House"), 0)
        self.assertEqual(points(name="Ana's Cake & Coffee"), 0)
        self.assertEqual(points(name="Bare Brew"), 1)
        self.assertEqual(points(name="Ember Roasters"), 2)  # a roaster name is a strong signal
        self.assertEqual(points(name="Specialty Cafetiere"), 1)

    def test_roasters_and_bean_shops(self):
        self.assertEqual(points(name="Beans", osm_tags={"shop": "coffee"}), 2)
        self.assertEqual(points(name="Beans", osm_tags={"craft": "coffee_roaster"}), 2)
        self.assertEqual(points(name="Beans", fsq_labels=("Retail > Food and Beverage Retail > Coffee Roaster",)), 2)
        self.assertEqual(points(name="Beans", overture_category="coffee_roastery"), 2)
        # An Overture alternate category alone also tags vending and catering firms.
        self.assertEqual(points(name="Beans", overture_category="cafe", overture_alternates=("coffee_roastery",)), 1)

    def test_big_chains_are_never_specialty(self):
        rich = {"osm_tags": {"cuisine": "coffee_shop"}, "overture_category": "coffee_shop",
                "fsq_labels": (COFFEE_FSQ,)}
        for name in ("Costa Coffee", "Starbucks", "Caffè Nero", "Pret A Manger", "Greggs", "Coffee#1",
                     "Esquires Coffee", "Black Sheep Coffee", "Blank Street Coffee", "Enfield Town Costa Coffee"):
            self.assertIsNone(points(name=name, **rich), name)
        self.assertIsNone(points(name="Soho Branch", brand="Starbucks", **rich))
        self.assertIsNone(points(name="Kiosk", overture_brand="Costa Coffee", **rich))
        self.assertEqual(points(name="Pretty Coffee", fsq_labels=(COFFEE_FSQ,)), 2)  # not Pret
        for name in ("Nero Roasting Company", "Mikel Coffee Company", "Mikel", "Colicci", "Jamaica Blue",
                     "WFM Coffee Bar", "Kahve Dünyası"):
            self.assertIsNone(points(name=name, **rich), name)
        self.assertEqual(points(name="Neros Cafe"), -0.5)  # not Caffè Nero

    def test_listed_specialty_groups_count_in(self):
        self.assertEqual(ps.group("Monmouth Coffee Company"), "specialty")
        self.assertEqual(ps.group("Some kiosk", "WatchHouse"), "specialty")
        self.assertEqual(ps.group("Department of Coffee and Social Affairs"), "specialty")
        self.assertIsNone(ps.group("Sunrise Cafe"))
        self.assertEqual(ps.group("Hagen Espresso Bar (Hagen Paddington)"), "specialty")
        self.assertEqual(ps.group("Catalyst"), "specialty")
        self.assertIsNone(ps.group("ALLPRESSED UP Coffee & Matcha"))  # not Allpress
        self.assertIsNone(ps.group("Good & Proper Tea"))  # a tea shop
        self.assertTrue(specialty(name="Prufrock", osm_tags={"amenity": "cafe"}))
        self.assertTrue(specialty(name="Kaffeine", fsq_labels=(CAFE_FSQ,)))

    def test_closed_and_stale_foursquare_lower_it(self):
        base = {"name": "Grace", "overture_category": "coffee_shop", "fsq_labels": (COFFEE_FSQ,)}
        self.assertEqual(points(**base, fsq_closed=True), -1)
        self.assertEqual(points(name="Grace Coffee", fsq_labels=(COFFEE_FSQ,), fsq_stale=True, sources=("fsq",)), 1)
        # Stale only matters when Foursquare is the sole witness.
        self.assertEqual(points(**base, fsq_stale=True, sources=("overture", "fsq")), 2)


class TagTests(unittest.TestCase):
    def test_with_tag_is_idempotent_and_reversible(self):
        self.assertEqual(ps.with_tag("coffee_shop", True), "coffee_shop;specialty_coffee")
        self.assertEqual(ps.with_tag("coffee_shop;specialty_coffee", True), "coffee_shop;specialty_coffee")
        self.assertEqual(ps.with_tag("coffee_shop;specialty_coffee", False), "coffee_shop")
        self.assertEqual(ps.with_tag(None, True), "specialty_coffee")
        self.assertIsNone(ps.with_tag("specialty_coffee", False))
        self.assertEqual(ps.with_tag("coffee_shop; cake", False), "coffee_shop; cake")  # untouched

    def test_checklist_asks_yes_or_no_and_escapes_names(self):
        line = {"group": "above", "id": "osm:n1", "name": "Tom & Jerry's <Coffee>", "sources": "osm+fsq",
                "score": 3.0, "reasons": "coffee shop on osm+fsq +2", "hygiene_rating": "5",
                "google_maps": ps.maps_link("Tom & Jerry's", 51.5, -0.1)}
        page = ps.checklist_html([line], {"specialty_confident": 680})
        self.assertIn("Tom &amp; Jerry&#x27;s &lt;Coffee&gt;", page)
        self.assertIn('data-v="yes">Coffee-led', page)
        self.assertIn('data-v="no">Just a café', page)
        self.assertIn("listed by OpenStreetMap, Foursquare", page)
        self.assertIn("Copy results", page)

    def test_maps_link_is_a_search_url(self):
        self.assertEqual(ps.maps_link("Kaffeine", 51.5181, -0.1395),
                         "https://www.google.com/maps/search/?api=1&query=Kaffeine+51.518100%2C-0.139500")


if __name__ == "__main__":
    unittest.main()
