"""Unified places: taxonomy coverage of the custom-criteria presets, per-source mapping, the worship
guardrail, name hints and brands, confidence and merging."""

import json
import os
import unittest

from area_analytics import places_specialty as specialty
from area_analytics import places_unified as pu

PRESETS = os.path.join(os.path.dirname(__file__), "..", "..", "..", "api", "area_api", "fixtures",
                       "custom-presets.json")
TAX = pu.Taxonomy.load()
# Preset tags no other source than OSM describes (street furniture).
OSM_ONLY = {("amenity", "bicycle_parking"), ("amenity", "coworking_space")}


def fhrs(name, business_type="Restaurant/Cafe/Canteen"):
    return pu.fhrs_candidate(TAX, {"fhrs_id": 7, "name": name, "business_type": business_type, "rating": "5",
                                   "lon": -0.1, "lat": 51.5})


def overture(category, name="Somewhere", **extra):
    return pu.overture_candidate(TAX, {"id": "ovt1", "name": name, "category": category, "confidence": 0.9,
                                       "lon": -0.1, "lat": 51.5, **extra})


def fsq(label, name="Somewhere", **extra):
    record = {"fsq_place_id": "f1", "name": name, "category_labels": [label], "date_refreshed": "2024-06-01",
              "date_closed": None, "lon": -0.1, "lat": 51.5, **extra}
    return pu.fsq_candidate(TAX, record, "2023-02-04")


def preset_tests():
    with open(PRESETS) as handle:
        data = json.load(handle)
    for preset in data if isinstance(data, list) else data.get("presets", data):
        criterion = preset.get("criterion", preset)
        for place_set in criterion["sets"].values():
            for matcher in place_set["any"]:
                for key, value in matcher.items():
                    for v in value if isinstance(value, list) else [value]:
                        yield criterion["id"], key, v


class TaxonomyTests(unittest.TestCase):
    def test_every_category_round_trips_through_its_tags(self):
        for category in TAX.tags:
            self.assertEqual(TAX.resolve(TAX.canonical(category)), category)

    def test_every_preset_tag_is_reachable(self):
        mapped_values = set()
        for source_map in (TAX.data["overture"], TAX.fsq_map, TAX.data["overture_basic"]):
            for value in source_map.values():
                if value is not None:
                    category, extra = TAX.target(value)
                    mapped_values.update({**TAX.canonical(category), **extra}.items())
        categories = {pair for c in TAX.tags for pair in TAX.canonical(c).items()}
        for preset, key, value in preset_tests():
            if value is None or value == "*":
                continue
            if key == "brand":
                self.assertIn(value, TAX.brand_names, preset)
                continue
            if (key, value) == ("cuisine", specialty.TAG):
                continue  # derived after conflation by places_specialty, not mapped from a source
            self.assertIn((key, value), categories, f"{preset}: {key}={value} has no category")
            if (key, value) not in OSM_ONLY:
                self.assertIn((key, value), mapped_values, f"{preset}: {key}={value} only from OSM")

    def test_osm_generic_fallback_and_whitelist(self):
        candidate = pu.osm_candidate(TAX, "n1", {"shop": "tyres_and_more", "name": "Tyre Co", "religion": "x",
                                                 "denomination": "y", "addr:street": "z"}, -0.1, 51.5)
        self.assertEqual(candidate.category, "shop")
        self.assertEqual(candidate.tags, {"shop": "tyres_and_more", "name": "Tyre Co"})
        self.assertIsNone(pu.osm_candidate(TAX, "n2", {"amenity": "bench"}, -0.1, 51.5))


class GuardrailTests(unittest.TestCase):
    def test_places_of_worship_are_dropped_from_every_source(self):
        self.assertIsNone(pu.osm_candidate(TAX, "n1", {"amenity": "place_of_worship", "name": "St Mary"}, 0, 51))
        self.assertIsNone(pu.osm_candidate(TAX, "n2", {"shop": "religion", "name": "Books"}, 0, 51))
        self.assertIsNone(overture("christian_place_of_worship"))
        self.assertIsNone(overture("cafe", alternate_categories=["religious_organization"]))
        self.assertIsNone(fsq("Community and Government > Spiritual Center > Mosque"))
        self.assertIsNone(fsq("Community and Government > Community Center", name="St Mary's Church"))
        self.assertIsNone(fhrs("St Mary's Church Hall"))

    def test_halal_and_kosher_are_never_cuisines(self):
        self.assertNotIn("cuisine", overture("halal_restaurant").tags)
        self.assertNotIn("cuisine", overture("kosher_restaurant").tags)
        self.assertNotIn("cuisine", fsq("Dining and Drinking > Restaurant > Halal Restaurant").tags)
        self.assertEqual(TAX._cuisine_target("Kosher"), ("restaurant", {}))


class MappingTests(unittest.TestCase):
    def test_kebab_from_every_source(self):
        self.assertEqual(fhrs("ALI'S KEBAB HOUSE", "Takeaway/sandwich shop").category, "kebab")
        self.assertEqual(overture("doner_kebab_restaurant").category, "kebab")
        self.assertEqual(fsq("Dining and Drinking > Restaurant > Turkish Restaurant > Doner Restaurant").category, "kebab")
        osm = pu.osm_candidate(TAX, "n1", {"amenity": "fast_food", "name": "Best Döner"}, 0, 51)
        self.assertEqual((osm.category, osm.tags["cuisine"]), ("kebab", "kebab"))
        restaurant = pu.osm_candidate(TAX, "n2", {"amenity": "restaurant", "cuisine": "turkish;kebab"}, 0, 51)
        self.assertEqual(restaurant.category, "kebab")

    def test_coffee_and_cafe_hints(self):
        self.assertEqual(fhrs("Monmouth Coffee Company").category, "coffee_shop")
        self.assertEqual(fhrs("Rosie's Cafe").category, "cafe")
        self.assertEqual(fhrs("The Ivy").category, "restaurant")
        self.assertEqual(fsq("Dining and Drinking > Cafe, Coffee, and Tea House > Coffee Shop").category, "coffee_shop")
        osm = pu.osm_candidate(TAX, "n1", {"amenity": "cafe", "name": "Origin Coffee Roasters"}, 0, 51)
        self.assertEqual(osm.category, "coffee_shop")
        # OSM keeps its own amenity: a hint never turns an OSM restaurant into a café.
        self.assertEqual(pu.osm_candidate(TAX, "n2", {"amenity": "restaurant", "name": "Café Rouge"}, 0, 51).category,
                         "restaurant")

    def test_register_retailers_and_care_premises(self):
        self.assertEqual(fhrs("J SMITH BUTCHERS", "Retailers - other").category, "butcher")
        self.assertEqual(fhrs("Happy Days Food & Wine", "Retailers - other").category, "convenience")
        self.assertEqual(fhrs("Little Acorns Nursery", "Hospitals/Childcare/Caring Premises").category, "childcare")
        self.assertFalse(fhrs("Oak House", "Hospitals/Childcare/Caring Premises").standalone)
        self.assertIsNone(fhrs("Acme Packers", "Manufacturers/packers"))

    def test_brands(self):
        costa = fhrs("COSTA COFFEE", "Takeaway/sandwich shop")
        self.assertEqual((costa.category, costa.brand), ("coffee_shop", "Costa"))
        self.assertIsNone(overture("coffee_shop", name="Costa Express", brand="Costa Express"))
        self.assertEqual(fsq("Business and Professional Services > Health and Beauty Service > Barbershop",
                             name="Leon's Barbers").brand, None)
        greggs = fhrs("GREGGS", "Retailers - other")
        self.assertEqual((greggs.category, greggs.brand), ("fast_food", "Greggs"))
        tesco = fhrs("Tesco Express", "Retailers - other")
        self.assertEqual((tesco.category, tesco.brand), ("convenience", "Tesco"))
        pret = pu.osm_candidate(TAX, "n1", {"amenity": "fast_food", "name": "Pret A Manger"}, 0, 51)
        self.assertEqual(pret.tags["brand"], "Pret A Manger")

    def test_source_paths_and_rules(self):
        self.assertEqual(TAX.fsq(["Dining and Drinking > Restaurant > Asian Restaurant > Thai Restaurant"]),
                         ("restaurant", {"cuisine": "thai"}))
        self.assertEqual(TAX.fsq(["Retail > Fashion Retail > Women's Store"]), ("clothes", {}))
        self.assertIs(TAX.fsq(["Community and Government > Education > College and University > College Classroom"]),
                      pu.EXCLUDED)
        self.assertEqual(TAX.overture("indian_restaurant"), ("restaurant", {"cuisine": "indian"}))
        self.assertEqual(TAX.overture("unknown_thing", basic="casual_eatery"), ("fast_food", {}))
        self.assertIsNone(TAX.overture("unknown_thing"))

    def test_campus_records_only_confirm(self):
        self.assertFalse(overture("college_university", name="UCL Department of Physics").standalone)
        self.assertFalse(fsq("Community and Government > Education > College and University").standalone)
        self.assertTrue(pu.osm_candidate(TAX, "w1", {"amenity": "university", "name": "UCL"}, 0, 51).standalone)

    def test_fsq_freshness_and_closure(self):
        self.assertEqual(fsq("Dining and Drinking > Bar > Pub").p, pu.FSQ_FRESH)
        self.assertEqual(fsq("Dining and Drinking > Bar > Pub", date_refreshed="2021-01-01").p, pu.FSQ_STALE)
        closed = fsq("Dining and Drinking > Bar > Pub", date_closed="2024-01-01")
        self.assertEqual((closed.p, closed.closed, closed.standalone), (0.0, True, False))


class NameTests(unittest.TestCase):
    def test_normalise_and_match_name(self):
        self.assertEqual(pu.normalise_name("Café Nero & Co."), "cafe nero and co")
        self.assertEqual(pu.normalise_name("Ali's  Kebab"), "alis kebab")
        self.assertEqual(pu.match_name(pu.normalise_name("The Crown Ltd")), "crown")
        self.assertEqual(pu.normalise_name(None), "")


class MergeTests(unittest.TestCase):
    def test_confidence_from_agreement(self):
        osm = pu.osm_candidate(TAX, "n1", {"amenity": "pub", "name": "The Crown"}, -0.1, 51.5)
        register = fhrs("THE CROWN", "Pub/bar/nightclub")
        self.assertEqual(pu.confidence([osm]), 0.7)
        self.assertEqual(pu.confidence([osm, register]), 0.94)
        stale = fsq("Dining and Drinking > Bar > Pub", date_refreshed="2020-01-01")
        self.assertEqual(pu.confidence([stale]), 0.25)
        closed = fsq("Dining and Drinking > Bar > Pub", date_closed="2024-01-01")
        self.assertEqual(pu.confidence([osm, closed]), 0.42)
        self.assertEqual(pu.confidence([osm, closed, register]), 0.94)

    def test_overture_from_foursquare_halves_foursquare(self):
        ovt = overture("pub", datasets=["Foursquare", "Overture"])
        four = fsq("Dining and Drinking > Bar > Pub")
        self.assertEqual(pu.confidence([ovt, four]), round(1 - (1 - 0.65) * (1 - 0.25), 3))

    def test_merge_takes_osm_first_and_refines(self):
        osm = pu.osm_candidate(TAX, "n42", {"amenity": "restaurant", "name": "Mangal 2"}, -0.07, 51.55)
        four = fsq("Dining and Drinking > Restaurant > Kebab Restaurant", name="Mangal II")
        register = fhrs("MANGAL 2 LTD")
        row = pu.merge(TAX, [register, four, osm])
        self.assertEqual(row["id"], "osm:n42")
        self.assertEqual(row["sources"], ["osm", "fsq", "fhrs"])
        self.assertEqual(row["category"], "kebab")
        self.assertEqual(row["tags"], {"amenity": "restaurant", "name": "Mangal 2", "cuisine": "kebab"})
        self.assertEqual((row["fhrs_id"], row["fsq_id"], row["hygiene_rating"]), (7, "f1", "5"))
        self.assertEqual(row["location"], "SRID=4326;POINT(-0.07 51.55)")

    def test_register_only_place(self):
        row = pu.merge(TAX, [fhrs("ALI'S KEBAB HOUSE", "Takeaway/sandwich shop")])
        self.assertEqual((row["id"], row["category"], row["confidence"]), ("fhrs:7", "kebab", 0.8))

    def test_release_is_fingerprinted(self):
        sha = pu.inputs_sha256(["src-a", "src-b"])
        self.assertEqual(len(sha), 64)
        self.assertEqual(sha, pu.inputs_sha256(["src-b", "src-a"]))
        source_id, _, released, licence, _, caveats = pu.source_release({"osm_kept": 1}, "2026-10-07", ["src-a"], sha)
        self.assertEqual((source_id, released, licence),
                         (f"src-places-unified-2026-10-07-{sha[:8]}", "2026-10-07", "ODbL-1.0"))
        self.assertTrue(any("ODbL" in c and "share-alike" in c for c in caveats))

    def test_rebuild_gives_each_place_its_lsoa_before_the_swap(self):
        # custom criteria count places by place.lsoa_id (migration 038): the staged rows get theirs first.
        import inspect
        from area_analytics import places_load
        statements = []

        class Cursor:
            def execute(self, sql, params=None):
                statements.append(sql)

        places_load.assign_lsoa(Cursor(), "place_stage")
        self.assertEqual(statements, [places_load.LSOA_SQL.format(table="place_stage")])
        self.assertIn("UPDATE place_stage p SET lsoa_id = g.id", statements[0])
        self.assertIn("g.kind = 'lsoa' AND ST_Intersects(g.geometry, p.location)", statements[0])
        source = inspect.getsource(pu.load)
        self.assertLess(source.index('assign_lsoa(conn, "place_stage")'), source.index('DELETE FROM place"'))

    def test_maps_url(self):
        self.assertEqual(pu.maps_url("Ali's Kebab", 51.5, -0.1),
                         "https://www.google.com/maps/search/Ali%27s%20Kebab/@51.500000,-0.100000,19z")


if __name__ == "__main__":
    unittest.main()
