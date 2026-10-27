"""Custom criteria: validation (places, not people), SQL for the tag matchers, per-area counts inside
each area's boundary, formulas, London percentiles, legends, the pack, match rows and the HTTP endpoints."""
import copy
import json
import math
import re
import unittest
from pathlib import Path
from unittest import mock

from area_api import custom_criteria as cc
from area_api import matching, personal_places

KEBAB_CAFE = {"id": "kebab-cafe", "label": "Kebab shops vs cafés", "formula": "balance", "radiusMetres": 800,
              "sets": {"a": {"label": "Kebab shops", "any": [{"cuisine": "kebab"}]},
                       "b": {"label": "Cafés", "any": [{"amenity": "cafe"}]}}}
# Three areas on one parallel: "near" sits on top of the places, "mid" 700 m east, "far" 5 km east. Each
# place carries the LSOA whose polygon holds it (place.lsoa_id); one lies outside every area.
LAT = 51.5
M_LAT, M_LON = cc.metres_per_degree(LAT)
AREAS = [{"geography_id": "uk:lsoa:E01000001", "name": "Near", "lon": -0.1, "lat": LAT, "station_walk": None},
         {"geography_id": "uk:lsoa:E01000002", "name": "Mid", "lon": -0.1 + 700 / M_LON, "lat": LAT, "station_walk": None},
         {"geography_id": "uk:lsoa:E01000003", "name": "Far", "lon": -0.1 + 5000 / M_LON, "lat": LAT, "station_walk": None}]


NEAR, MID, FAR = (area["geography_id"] for area in AREAS)


def place(east_metres, a=False, b=False, cuisine=None, sport=None, lsoa=None):
    return {"lon": -0.1 + east_metres / M_LON, "lat": LAT, "lsoa_id": lsoa, "in_a": a, "in_b": b, "cuisine": cuisine,
            "sport": sport, "source_release_id": "src-osm"}


# The café at 390 m is nearer "mid"'s point (700 m) than "near"'s but inside near's boundary: it counts for near.
PLACES = [place(0, a=True, cuisine="kebab;pizza", lsoa=NEAR), place(100, a=True, cuisine="kebab", lsoa=NEAR),
          place(390, b=True, lsoa=NEAR), place(790, b=True, lsoa=MID), place(1490, b=True, lsoa=MID),
          place(1520, a=True, cuisine="turkish", lsoa=MID), place(9000, b=True)]
KM2 = {NEAR: 0.5, MID: 0.25, FAR: 2.0}
# FAR has no residents row (as the City of London's neighbourhoods, which AREA_RESIDENTS_SQL leaves out).
RESIDENTS = {NEAR: 1600, MID: 2000}


def criterion(**overrides):
    definition = copy.deepcopy(KEBAB_CAFE)
    definition.update(overrides)
    return definition


class FakeConnection:
    def __init__(self, places=PLACES, release="rel-1"):
        self.places, self.release, self.statements = places, release, []

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        self.statements.append((marker, params))
        if marker == "-- evidence:place-area-points":
            return AREAS
        if marker == "-- evidence:custom-criterion-places":
            return self.places
        if marker == "-- evidence:custom-criterion-area-km2":
            return [{"geography_id": key, "km2": value} for key, value in KM2.items()]
        if marker == "-- evidence:custom-criterion-area-residents":
            return [{"geography_id": key, "population": value} for key, value in RESIDENTS.items()]
        if sql == "SELECT release_id FROM active_product_release":
            return [{"release_id": self.release}] if self.release else []
        raise AssertionError(marker)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class ValidationTests(unittest.TestCase):
    def test_presets_and_the_example_are_valid(self):
        presets = cc.presets()["presets"]
        self.assertGreaterEqual(len(presets), 17)
        for preset in presets:
            cc.validate_definition(preset["criterion"])
            self.assertIn(preset["direction"], cc.DIRECTIONS)
        self.assertEqual(len({p["criterion"]["id"] for p in presets}), len(presets))
        self.assertEqual(len({p["slug"] for p in presets}), len(presets))

    def test_preset_names_are_neutral(self):
        # Descriptive names: no brands and no value words in what a user (or Claude) reads out.
        brands = re.compile(r"\b(pret|greggs|costa|starbucks|nero)", re.I)
        value_words = re.compile(r"\b(good|bad|cheap|nice|posh|rough|best|worst|friendly|stuff)\b", re.I)
        for preset in cc.presets()["presets"]:
            for words in (preset["criterion"]["label"], preset["slug"]):
                self.assertIsNone(brands.search(words), words)
                self.assertIsNone(value_words.search(words), words)
            self.assertRegex(preset["slug"], r"^[a-z0-9]+(-[a-z0-9]+)*$")

    def test_people_tags_and_unknown_keys_are_refused(self):
        for key in ("religion", "denomination"):
            with self.assertRaisesRegex(cc.InvalidCriterion, "never who lives"):
                cc.validate_definition(criterion(sets={"a": {"label": "X", "any": [{key: "christian"}]}}, formula="count"))
        with self.assertRaisesRegex(cc.InvalidCriterion, "not one of"):
            cc.validate_definition(criterion(sets={"a": {"label": "X", "any": [{"name": "Tesco"}]}}, formula="count"))

    def test_places_of_worship_are_refused_and_never_read(self):
        for test in ({"amenity": "place_of_worship"}, {"amenity": ["cafe", "Place_of_worship"]}, {"shop": "religion"},
                     {"brand": "Masjid"}, {"amenity": "*", "brand": "St Mary's Church"}):
            with self.assertRaisesRegex(cc.InvalidCriterion, "never who lives"):
                cc.validate_definition(criterion(sets={"a": {"label": "X", "any": [test]}}, formula="count"))
        sql, _ = cc.places_query(cc.normalise(criterion(formula="count", sets={"a": {"label": "A", "any": [{"amenity": "*"}]}})))
        self.assertIn("AND NOT (tags @> '{\"amenity\": \"place_of_worship\"}'", sql)

    def test_limits(self):
        bad = [
            criterion(radiusMetres=150), criterion(radiusMetres=2500), criterion(radiusMetres=800.5),
            criterion(formula="mean"), criterion(id="Kebab!"), criterion(label=""),
            criterion(sets={"a": KEBAB_CAFE["sets"]["a"]}),  # balance needs b
            criterion(sets={**KEBAB_CAFE["sets"], "c": KEBAB_CAFE["sets"]["a"]}),  # ... and only a and b
            criterion(formula="count", sets={"b": KEBAB_CAFE["sets"]["b"]}),  # a is required
            criterion(formula="count", sets={"a": KEBAB_CAFE["sets"]["a"], "d": KEBAB_CAFE["sets"]["b"]}),
            criterion(formula="count", sets={"a": {"label": "X", "any": [{"amenity": "cafe"}] * 7}}),
            criterion(formula="count", sets={"a": {"label": "X", "any": [{"amenity": ["cafe", "*"]}]}}),
            criterion(formula="count", sets={"a": {"label": "X", "any": [{"amenity": "caf;e"}]}}),
            criterion(formula="count", sets={"a": {"label": "X", "any": [{"brand": None}]}}),
            criterion(formula="count", sets={"a": {"label": "X", "any": []}}),
            criterion(extra=1),
        ]
        for definition in bad:
            with self.assertRaises(cc.InvalidCriterion, msg=json.dumps(definition)):
                cc.validate_definition(definition)
        cc.validate_definition(criterion(formula="count", sets={
            "a": {"label": "Indie", "any": [{"amenity": "cafe", "brand": None}]},
            "b": {"label": "Chains", "any": [{"amenity": "cafe", "brand": "*"}]},
            "c": {"label": "Pret", "any": [{"brand": ["Pret A Manger"]}]}}))

    def test_normalised_form_and_cache_key_ignore_order_and_labels(self):
        one = cc.normalise(criterion(sets={"b": {"label": "Cafés ", "any": [{"amenity": ["restaurant", "cafe"]}]},
                                           "a": KEBAB_CAFE["sets"]["a"]}))
        two = cc.normalise(criterion(label="Other name", sets={
            "a": {"label": "Kebabs", "any": [{"cuisine": "kebab"}]},
            "b": {"label": "Eating", "any": [{"amenity": ["cafe", "restaurant"]}]}}))
        self.assertEqual(list(one["sets"]), ["a", "b"])
        self.assertEqual(one["sets"]["b"], {"label": "Cafés", "any": [{"amenity": ["cafe", "restaurant"]}]})
        self.assertEqual(cc.cache_key(one), cc.cache_key(two))
        self.assertEqual(cc.cache_key(one), cc.cache_key({**one, "radiusMetres": 900}))  # no formula reads it
        self.assertNotEqual(cc.cache_key(one), cc.cache_key({**one, "formula": "share"}))

    def test_profile_entries(self):
        entry = {"criterion": KEBAB_CAFE, "weight": 3, "direction": "lower"}
        cc.validate_custom(None)
        cc.validate_custom([entry])
        for bad in ([entry, entry], [{**entry, "weight": 0}], [{**entry, "weight": True}],
                    [{**entry, "direction": "target-range"}], [{**entry, "extra": 1}], [entry] * 5, {}):
            with self.assertRaises(cc.InvalidCriterion):
                cc.validate_custom(bad)


class SqlTests(unittest.TestCase):
    def test_each_kind_of_tag_test(self):
        sql, params = cc.places_query(cc.normalise(criterion(formula="count", sets={
            "a": {"label": "A", "any": [{"cuisine": ["Kebab", "fish and chips"]}, {"amenity": ["cafe", "bar"], "brand": None}]},
            "b": {"label": "B", "any": [{"brand": "M&S"}, {"shop": "*"}]}})))
        self.assertTrue(sql.startswith("-- evidence:custom-criterion-places"))
        self.assertIn("AS in_a", sql)
        self.assertIn("AS in_b", sql)
        self.assertIn(f"LIMIT {cc.MAX_PLACES + 1}", sql)
        values = list(params.values())
        self.assertIn(["kebab", "fishandchips"], values)  # inside ;-lists, case and spaces ignored
        self.assertIn(json.dumps({"amenity": "bar"}), values)  # tags @> answered by the GIN index
        self.assertIn(json.dumps({"amenity": "cafe"}), values)
        self.assertIn("brand", values)  # NOT (tags ? 'brand')
        self.assertIn(["m&s%", "marks%spencer%"], values)  # brand prefixes, as for places
        self.assertIn("shop", values)
        self.assertIn("NOT (tags ? %(", sql)
        self.assertNotIn("Kebab", sql)  # values travel as parameters only


class AreaValueTests(unittest.TestCase):
    def values(self, **overrides):
        return cc.area_values(cc.normalise(criterion(**overrides)), AREAS, PLACES, KM2)

    def test_counts_are_the_places_inside_each_area(self):
        values = self.values()
        self.assertEqual(values[NEAR]["counts"], {"a": 2, "b": 1})  # its own café, though nearer mid's point
        self.assertEqual(values[MID]["counts"], {"a": 1, "b": 2})
        self.assertEqual(values[FAR]["counts"], {"a": 0, "b": 0})  # the café at 9 km is in no area
        self.assertEqual(values[NEAR]["value"], 0.125)  # (2 - 1) / (2 + 1 + 5)
        self.assertEqual(values[MID]["value"], -0.125)
        self.assertEqual(self.values(radiusMetres=2000), values)  # the radius no longer changes a count

    def test_formulas(self):
        share = self.values(formula="share")
        self.assertEqual(share[MID]["value"], 0.333)
        self.assertIsNone(share[FAR]["value"])  # no places of either kind: no value
        sets = {"a": KEBAB_CAFE["sets"]["a"]}
        count = self.values(formula="count", sets={**KEBAB_CAFE["sets"]})
        self.assertEqual(count[NEAR]["value"], 3.0)
        density = self.values(formula="density", sets=sets)
        self.assertEqual((density[NEAR]["value"], density[MID]["value"], density[FAR]["value"]), (4.0, 4.0, 0.0))
        no_size = cc.area_values(cc.normalise(criterion(formula="density", sets=sets)), AREAS, PLACES)
        self.assertIsNone(no_size[NEAR]["value"])  # without the area's size there is no density
        variety = self.values(formula="variety", sets=sets)
        self.assertEqual(variety[NEAR]["value"], 2.0)  # kebab, pizza
        self.assertEqual(variety[MID]["value"], 1.0)  # turkish
        per_resident = cc.area_values(cc.normalise(criterion(formula="per_resident", sets=sets)), AREAS, PLACES, KM2, RESIDENTS)
        self.assertEqual(per_resident[NEAR]["value"], 1.25)  # 2 kebab shops for 1,600 residents
        self.assertEqual(per_resident[MID]["value"], 0.5)
        self.assertIsNone(per_resident[FAR]["value"])  # no residents row (the City of London): no value, never 0
        nearest = self.values(formula="nearest", sets=sets)  # a distance, so it looks past the boundary
        self.assertEqual(nearest[NEAR]["value"], 0.0)
        self.assertAlmostEqual(nearest[MID]["value"], personal_places.estimate_minutes(0.6, "walk"), delta=0.06)
        self.assertAlmostEqual(nearest[FAR]["value"], personal_places.estimate_minutes(3.48, "walk"), delta=0.06)

    def test_percentiles_mean_more_of_the_criterion(self):
        values = {"x": 1.0, "y": 2.0, "z": 2.0, "w": None}
        # Competition rule (#221): y and z tie and share the percentile of the lowest position in their group.
        self.assertEqual(cc.percentiles(values, "count"), {"x": 0, "y": 50, "z": 50})
        self.assertEqual(cc.percentiles(values, "nearest"), {"x": 100, "y": 0, "z": 0})  # closest ranks highest

    def test_pair_legends_follow_londons_spread(self):
        values = [-0.9, -0.8, -0.8, -0.7, -0.6, -0.5, -0.3, -0.1, 0.0, 0.2]
        stops = cc.legend(cc.normalise(KEBAB_CAFE), values)
        self.assertEqual([stop["label"] for stop in stops], ["more cafés", "", "London middle", "", "more kebab shops"])
        self.assertTrue(all(left["value"] < right["value"] for left, right in zip(stops, stops[1:])))
        self.assertLess(stops[-1]["value"], 0.2 + 1e-9)  # the 95th percentile, not +1

    def test_pair_formulas_get_a_colour_square_from_both_counts(self):
        # Kebab shops are rarer than cafés: each axis starts its levels at its own London spread.
        items = [{"counts": {"a": k, "b": c}} for k, c in [(0, 0)] * 4 + [(0, 7), (1, 7), (1, 20), (2, 20), (4, 37), (8, 50)]]
        square = cc.bivariate(cc.normalise(KEBAB_CAFE), items)
        self.assertEqual(square["axes"]["a"], {"label": "Kebab shops", "thresholds": [1, 2, 4]})
        self.assertEqual(square["axes"]["b"], {"label": "Cafés", "thresholds": [7, 20, 37]})
        colours = square["colours"]
        self.assertEqual(len(colours), cc.BIVARIATE_STEPS)
        self.assertEqual((colours[0][0], colours[-1][0], colours[0][-1], colours[-1][-1]),
                         tuple(cc.BIVARIATE_CORNERS[key] for key in ("none", "a", "b", "both")))
        self.assertEqual(cc.bivariate_level(2, [1, 2, 4]), 2)  # 0 cafés, 2 kebab shops: well on the kebab side
        self.assertEqual(cc.bivariate_level(42, [1, 2, 4]), 3)  # 40 cafés, 42 kebab shops: the dark corner
        self.assertEqual(square["corners"]["both"], "many of both")
        self.assertEqual(cc.bivariate(cc.normalise(criterion(formula="count")), items), None)
        flat = cc.bivariate(cc.normalise(KEBAB_CAFE), [{"counts": {"a": 0, "b": 0}}] * 3)
        self.assertEqual(flat["axes"]["a"]["thresholds"], [1, 2, 3])  # still strictly increasing

    def test_a_pack_rolls_up_to_msoas_as_medians_with_summed_counts(self):
        items = [{"counts": {"a": c, "b": c // 2}} for c in (0, 0, 1, 1, 3, 4, 5, 6)]
        square = cc.bivariate(cc.normalise(KEBAB_CAFE), items)
        pack = {"schemaVersion": cc.PACK_SCHEMA, "bivariate": square, "legend": [], "values": [
            {"geographyId": "uk:lsoa:A1", "value": 0.2, "percentile": 40, "counts": {"a": 3, "b": 1}, "cell": 5},
            {"geographyId": "uk:lsoa:A2", "value": 0.6, "percentile": 80, "counts": {"a": 5, "b": 3}, "cell": 11},
            {"geographyId": "uk:lsoa:A3", "value": 0.4, "percentile": None, "counts": {"a": 4, "b": 2}, "cell": 6},
            {"geographyId": "uk:lsoa:B1", "value": None, "percentile": None, "counts": {"a": 0, "b": 0}, "cell": 0},
            {"geographyId": "uk:lsoa:X1", "value": 0.9, "percentile": 99, "counts": {"a": 9, "b": 0}, "cell": 12}]}
        parents = {"uk:lsoa:A1": "uk:msoa:A", "uk:lsoa:A2": "uk:msoa:A", "uk:lsoa:A3": "uk:msoa:A", "uk:lsoa:B1": "uk:msoa:B"}
        rolled = cc.roll_up_pack(pack, parents.get)
        self.assertEqual(rolled["level"], "msoa")
        self.assertIs(rolled["bivariate"], square)  # the LSOAs' square and legend: the colours read the same
        # B's only LSOA has no value and X1 has no MSOA: both left out.
        self.assertEqual(rolled["values"], [{"geographyId": "uk:msoa:A", "value": 0.4, "percentile": 60,
                                             "counts": {"a": 12, "b": 6}, "areaCount": 3,
                                             "cell": cc.bivariate_cell({"counts": {"a": 4, "b": 2}}, square)}])
        self.assertEqual(len(pack["values"]), 5)  # the LSOA pack is left as it was

    def test_the_square_places_each_area_by_its_levels_on_both_axes(self):
        items = [{"counts": {"a": c, "b": c // 2}} for c in (0, 0, 1, 1, 3, 4, 5, 6)]
        square = cc.bivariate(cc.normalise(KEBAB_CAFE), items)
        self.assertEqual(square["axes"]["a"]["thresholds"], [3, 4, 5])  # London's median, upper quartile, top tenth
        self.assertEqual(square["axes"]["b"]["thresholds"], [1, 2, 3])
        self.assertEqual(cc.bivariate_cell(items[-1], square), 3 * 4 + 3)  # top tenth of each: the dark corner
        self.assertEqual(cc.bivariate_cell(items[4], square), 1 * 4 + 1)  # at the median of each: one shade in
        # Plenty of A and none of B sits on A's edge, well coloured: never the pale "few of either" corner.
        self.assertEqual(cc.bivariate_cell({"counts": {"a": 6, "b": 0}}, square), 3 * 4 + 0)

    def test_low_counts_use_evenly_spaced_shades(self):
        # Bakeries vs betting shops: most areas have none, a few have 1, 2 or 3. One more place is one shade,
        # never a jump from grey to most of the way to the corner.
        items = [{"counts": {"a": a, "b": b}} for a, b in [(0, 0)] * 10 + [(1, 0), (0, 1), (1, 1), (2, 1), (1, 2), (3, 3), (5, 4)]]
        square = cc.bivariate(cc.normalise(KEBAB_CAFE), items)
        self.assertEqual(len(square["colours"]), 4)
        self.assertTrue(all(len(row) == 4 for row in square["colours"]))
        for i in range(4):
            for j in range(4):
                self.assertEqual(square["colours"][i][j], cc._mix(i / 3, j / 3))  # shades 0, 1/3, 2/3, 1
        levels = {divmod(cc.bivariate_cell(item, square), 4) for item in items}
        self.assertEqual({a for a, _ in levels}, {0, 1, 2, 3})
        self.assertEqual({b for _, b in levels}, {0, 1, 2, 3})

    def test_cells_match_the_web_square(self):
        fixture = json.loads((Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "bivariate-cells.json").read_text())
        self.assertEqual(fixture["size"], cc.BIVARIATE_STEPS)
        for case_set in fixture["squares"]:
            square = {"axes": {k: {"thresholds": v} for k, v in case_set["thresholds"].items()}}
            for case in case_set["cases"]:
                with self.subTest(case_set["name"], counts=case["counts"]):
                    self.assertEqual(cc.bivariate_cell({"counts": case["counts"]}, square), case["cell"])

    def test_the_unified_place_table_is_read_when_loaded(self):
        sql, _ = cc.places_query(cc.normalise(KEBAB_CAFE), unified=True)
        self.assertIn("FROM place p\n", sql)
        self.assertIn(f"AND confidence >= {cc.MIN_CONFIDENCE}", sql)
        sql, _ = cc.places_query(cc.normalise(KEBAB_CAFE))
        self.assertIn("FROM place_poi p\n", sql)
        self.assertNotIn("confidence", sql)

        class Loaded:
            def execute(self, sql, params=()):
                return [{"unified": True}]

        self.assertTrue(cc.unified_places(Loaded()))
        self.assertFalse(cc.unified_places(FakeConnection()))  # cannot answer: OpenStreetMap
        self.assertEqual(cc.place_table(FakeConnection()), (False, False))
        notes = cc.caveats(cc.normalise(KEBAB_CAFE), unified=True)
        self.assertIn("FSA food hygiene register", notes[1])

    def test_each_place_comes_with_its_lsoa(self):
        sql, _ = cc.places_query(cc.normalise(KEBAB_CAFE), unified=True)
        self.assertIn("p.lsoa_id AS lsoa_id", sql)  # migration 038's stored column
        sql, _ = cc.places_query(cc.normalise(KEBAB_CAFE), unified=False, stored_lsoa=False)
        self.assertIn("ST_Intersects(g.geometry, p.location) LIMIT 1) AS lsoa_id", sql)  # joined on the fly
        self.assertIn("g.kind = 'lsoa'", sql)

        class Stored:
            def execute(self, sql, params=()):
                return [{"unified": True, "stored_lsoa": True}]

        self.assertEqual(cc.place_table(Stored()), (True, True))
        self.assertIn("column_name = 'lsoa_id'", cc.TABLE_SQL)

    def test_caveats_explain_the_boundary(self):
        notes = cc.caveats(cc.normalise(KEBAB_CAFE))
        self.assertIn(cc.PLACES_NOT_PEOPLE, notes)
        self.assertTrue(any("inside each neighbourhood's boundary" in note and "neighbouring area" in note
                            for note in notes))
        self.assertFalse(any("800 m" in note for note in notes))
        nearest = cc.caveats(cc.normalise(criterion(formula="nearest", sets={"a": KEBAB_CAFE["sets"]["a"]})))
        self.assertTrue(any("nearest place" in note for note in nearest))

    def test_kebab_cuisine_also_matches_kebab_names(self):
        sql, params = cc.places_query(cc.normalise(KEBAB_CAFE))
        self.assertIn("tags->>'amenity' IN ('fast_food', 'restaurant')", sql)
        self.assertTrue(any(isinstance(v, str) and "doner" in v for v in params.values()))
        sql, params = cc.places_query(cc.normalise(criterion(formula="count", sets={
            "a": {"label": "Pizza", "any": [{"cuisine": "pizza"}]}})))
        self.assertNotIn("fast_food", sql)

    def test_good_coffee_reads_the_specialty_cuisine_inside_the_list(self):
        # places_specialty appends "specialty_coffee" to a place's cuisine list (coffee_shop;specialty_coffee).
        presets = {p["criterion"]["id"]: p["criterion"] for p in cc.presets()["presets"]}
        good = presets["good-coffee-kebab"]
        self.assertEqual(good["label"], "Specialty coffee vs kebab shops")
        self.assertEqual(good["sets"]["a"]["any"], [{"cuisine": "specialty_coffee"}])
        self.assertEqual(good["sets"]["b"]["any"], [{"cuisine": "kebab"}, {"cuisine": "turkish"}])
        self.assertEqual(presets["good-coffee"]["sets"]["a"]["any"], [{"cuisine": "specialty_coffee"}])
        sql, params = cc.places_query(cc.normalise(good), unified=True)
        self.assertIn("string_to_array(replace(lower(tags->>'cuisine'), ' ', ''), ';')", sql)
        self.assertIn(["specialty_coffee"], params.values())

    def test_legends(self):
        balance = cc.legend(cc.normalise(KEBAB_CAFE), [])
        self.assertEqual([(s["value"], s["label"]) for s in balance][::2],
                         [(-1, "more cafés"), (0, "even"), (1, "more kebab shops")])
        stops = cc.legend(cc.normalise(criterion(formula="count")), [0, 0, 0, 0, 1, 5])
        self.assertEqual([s["value"] for s in stops], sorted({s["value"] for s in stops}))  # strictly increasing
        self.assertEqual(stops[0]["label"], "0")
        self.assertEqual(stops[1]["label"], "")  # the median is 0 too: no second "0"
        # In-area counts have a long high-street tail: the darkest stop is London's top 1%, not its maximum.
        counts = [0] * 50 + [1] * 25 + [3] * 15 + [10] * 9 + [300]
        stops = cc.legend(cc.normalise(criterion(formula="count")), counts)
        self.assertEqual((stops[-1]["value"], stops[-1]["label"]), (10, "10+"))
        nearest = cc.legend(cc.normalise(criterion(formula="nearest", sets={"a": KEBAB_CAFE["sets"]["a"]})), [3, 9])
        self.assertEqual(nearest[0]["colour"], cc.SEQUENTIAL[-1])  # closest is darkest
        self.assertEqual(nearest[-1]["label"], "9 min")

    def test_ramps_are_snow_based_and_step_in_lightness(self):
        def lightness(hex_colour):  # CIELAB L* (D65)
            r, g, b = (int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5))
            lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in (r, g, b)]
            y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
            return 116 * y ** (1 / 3) - 16 if y > 0.008856 else 903.3 * y

        self.assertEqual(cc.SEQUENTIAL[0], "#f4f7fa")  # snow
        self.assertEqual(cc.DIVERGING[2], "#f4f7fa")  # a snow middle
        steps = [lightness(c) for c in cc.SEQUENTIAL]
        self.assertTrue(all(a - b >= 8 for a, b in zip(steps, steps[1:])), steps)
        sides = [lightness(c) for c in cc.DIVERGING]
        self.assertTrue(all(abs(a - b) >= 8 for a, b in zip(sides, sides[1:])), sides)


class EvaluateTests(unittest.TestCase):
    def setUp(self):
        cc.clear_cache()
        personal_places.clear_cache()

    def test_pack_with_summary_caveats_and_cache(self):
        connection = FakeConnection()
        pack = cc.evaluate(connection, KEBAB_CAFE, titles={"uk:lsoa:E01000001": "Upper Street · N1"})
        again = cc.evaluate(connection, criterion(label="Renamed"))
        self.assertEqual(pack["schemaVersion"], "custom-criterion-pack.v1")
        self.assertEqual((pack["productReleaseId"], pack["sourceReleaseId"]), ("rel-1", "src-osm"))
        self.assertEqual(pack["unit"], "balance (-1 to +1)")
        self.assertEqual([v["geographyId"] for v in pack["values"]], [a["geography_id"] for a in AREAS])
        self.assertEqual(set(pack["values"][0]), {"geographyId", "value", "percentile", "counts", "cell"})
        self.assertTrue(all(0 <= v["cell"] < cc.BIVARIATE_STEPS ** 2 for v in pack["values"]))
        top = pack["summary"]["top"][0]
        self.assertEqual((top["geographyId"], top["title"], top["name"]), ("uk:lsoa:E01000001", "Upper Street · N1", "Near"))
        self.assertEqual(pack["summary"]["bottom"][0]["geographyId"], "uk:lsoa:E01000002")
        density = cc.evaluate(connection, criterion(formula="density", sets={"a": KEBAB_CAFE["sets"]["a"]}))
        self.assertEqual(density["values"][0]["value"], 4.0)  # 2 kebab shops in 0.5 km²
        self.assertIn(cc.PLACES_NOT_PEOPLE, pack["caveats"])
        self.assertEqual(pack["sources"][0]["licence"], "ODbL-1.0")
        self.assertEqual(again["criterion"]["label"], "Renamed")
        markers = [marker for marker, _ in connection.statements]
        self.assertEqual(markers.count("-- evidence:custom-criterion-places"), 2)  # cached per release + definition (+ density)
        self.assertEqual(markers.count("-- evidence:place-area-points"), 1)
        self.assertEqual(markers.count("-- evidence:custom-criterion-area-km2"), 1)  # only density reads it
        summary = cc.evaluate(connection, KEBAB_CAFE, summary_only=True)
        self.assertNotIn("values", summary)

    def test_ends_are_honest_about_ties(self):
        # Kebab shops: near has 1, mid and far none. Two areas share the bottom; one tops the list.
        connection = FakeConnection(places=[place(0, a=True, cuisine="kebab", lsoa=NEAR)])
        pack = cc.evaluate(connection, criterion(formula="count", sets={"a": KEBAB_CAFE["sets"]["a"]}))
        self.assertEqual(pack["summary"]["tied"], {"top": 1, "bottom": 2})
        # Two LSOAs with one friendly title are one line, not two indistinguishable rows.
        pack = cc.evaluate(connection, criterion(formula="count", sets={"a": KEBAB_CAFE["sets"]["a"]}),
                           titles={MID: "Barking East · IG11", FAR: "Barking East · IG11"})
        self.assertEqual([entry["title"] for entry in pack["summary"]["bottom"]], ["Barking East · IG11", None])

    def test_too_broad_and_no_release(self):
        with self.assertRaisesRegex(cc.InvalidCriterion, "narrow it down"):
            cc.evaluate(FakeConnection(places=[place(0, a=True)] * (cc.MAX_PLACES + 1)), KEBAB_CAFE)
        from area_api.evidence import ReleaseUnavailable
        with self.assertRaises(ReleaseUnavailable):
            cc.evaluate(FakeConnection(release=None), KEBAB_CAFE)

    def test_match_rows_score_by_directed_percentile(self):
        profile = {"schemaVersion": "preference-profile.v1", "market": "buy", "targetBudget": 500_000,
                   "maximumBudget": 700_000, "commuteDestinations": [],
                   "factors": [{"factorId": "crime", "weight": 0, "direction": "lower", "minimumUtility": None,
                                "maximumUtility": None}],
                   "custom": [{"criterion": KEBAB_CAFE, "weight": 4, "direction": "lower"}]}
        matching.validate_match_request(profile)
        rows = cc.rows(FakeConnection(), "rel-1", profile["custom"])
        self.assertEqual({row["factor_id"] for row in rows}, {"custom:kebab-cafe"})
        self.assertEqual(len(rows), 3)
        pack = matching.build_match_pack(profile, rows)
        ranked = [value["geographyId"] for value in pack["values"]]
        self.assertEqual(ranked[0], "uk:lsoa:E01000002")  # most cafés per kebab shop ranks first for "lower"
        component = pack["values"][0]["components"][0]
        self.assertEqual((component["factorId"], component["rawValue"], component["unit"]),
                         ("custom:kebab-cafe", -0.125, "balance (-1 to +1)"))
        # v4 Task 21: a custom criterion is a range on its London percentile ("lower": the lower half inside, soft
        # to the 75th): the lowest of the three (percentile 0, competition rule #221) is inside.
        self.assertEqual((component["utility"], component["fitKind"], component["percentile"]), (100, "in", 0))

    def test_profile_validation_maps_to_invalid_profile(self):
        with self.assertRaisesRegex(matching.InvalidMatchRequest, "never who lives"):
            matching.validate_custom([{"criterion": criterion(sets={"a": {"label": "X", "any": [{"religion": "*"}]}},
                                                              formula="count"), "weight": 2, "direction": "higher"}])


try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class CustomCriteriaHttpTests(unittest.TestCase):
    def setUp(self):
        cc.clear_cache()
        personal_places.clear_cache()
        self._previous = app_module._connect
        app_module._connect = FakeConnection
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._connect = self._previous

    def test_evaluate_is_private_and_validates(self):
        # One request (the endpoint is rate limited as expensive): two LSOAs share a friendly title.
        shared = {MID: "Barking East · IG11", FAR: "Barking East · IG11"}
        with mock.patch.object(app_module.repository, "area_titles", lambda: shared):
            response = self.client.post("/api/v1/custom-criteria/evaluate", json={"criterion": criterion(
                formula="count", sets={"a": KEBAB_CAFE["sets"]["a"]})})
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response.headers["cache-control"])
        self.assertEqual(response.json()["schemaVersion"], "custom-criterion-pack.v1")
        # The ends name areas by their friendly titles, one line per title (titles before the dedupe).
        titled = response.json()["summary"]["bottom"]
        self.assertEqual([entry["title"] for entry in titled].count("Barking East · IG11"), 1)
        refused = self.client.post("/api/v1/custom-criteria/evaluate", json={"criterion": criterion(
            formula="count", sets={"a": {"label": "X", "any": [{"denomination": "*"}]}})})
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.json()["detail"]["error"], "invalid-criterion")

    def test_presets_are_public(self):
        response = self.client.get("/api/v1/custom-criteria/presets")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["presets"][0]["criterion"]["id"], "kebab-cafe")
        self.assertIn("public", response.headers["cache-control"])

    def test_a_preset_pack_rolls_up_to_msoas_only(self):
        self.assertEqual(self.client.get("/api/v1/custom-criteria/presets/kebab-cafe/pack?level=borough").status_code, 400)


class PresetFormulaTests(unittest.TestCase):
    """Layers v5: a count inside the boundary has a London median of 0 and crowns the City, so the ready-made
    criteria ask "is one close" (nearest) or "how much per resident"; no preset uses the balance any more."""

    def setUp(self):
        cc.clear_cache()
        personal_places.clear_cache()

    def test_presets_ask_nearest_or_per_resident_and_never_balance(self):
        formulas = {p["criterion"]["id"]: p["criterion"]["formula"] for p in cc.presets()["presets"]}
        self.assertNotIn("balance", formulas.values())
        for preset_id in ("gyms", "ev-charging", "family", "dog-friendly", "markets"):
            self.assertEqual(formulas[preset_id], "nearest", preset_id)
        for preset_id in ("nightlife", "late-night-food", "good-coffee", "culture", "quiet-nights"):
            self.assertEqual(formulas[preset_id], "per_resident", preset_id)
        self.assertEqual(formulas["food-variety"], "variety")  # kinds per resident would mean nothing

    def test_per_resident_pack_says_its_unit_and_leaves_the_city_out(self):
        nightlife = next(p["criterion"] for p in cc.presets()["presets"] if p["criterion"]["id"] == "nightlife")
        pack = cc.evaluate(FakeConnection(), nightlife)
        self.assertEqual(pack["unit"], "places per 1,000 residents")
        self.assertTrue(pack["legend"][-1]["label"].endswith(" per 1,000"))
        self.assertTrue(any("City of London is left out" in note for note in pack["caveats"]))
        self.assertIn("IS DISTINCT FROM 'uk:lad:E09000001'", cc.AREA_RESIDENTS_SQL)

    def test_families_is_the_walk_to_a_playground_or_nursery_closer_scores_higher(self):
        # My match and find_areas(custom=[{preset_id: "family"}]) score custom:family on its London percentile,
        # which for nearest is "closer = higher": the default direction "higher" now means the shorter walk.
        from area_api import home_search
        definition, direction = home_search._custom_criterion("family", None)
        self.assertEqual((definition["formula"], definition["label"], direction), ("nearest", "Nearest playground or nursery", "higher"))
        self.assertEqual(definition["sets"]["a"]["any"], [{"leisure": "playground"}, {"amenity": ["childcare", "kindergarten"]}])
        rows = {row["geography_id"]: row for row in cc.rows(FakeConnection(), "rel-1", [{"criterion": definition}])}
        self.assertEqual({row["factor_id"] for row in rows.values()}, {"custom:family"})
        self.assertEqual(rows[NEAR]["unit"], "minutes")
        self.assertLess(rows[NEAR]["raw_value"], rows[MID]["raw_value"])
        self.assertGreater(rows[NEAR]["utility"], rows[MID]["utility"])


# Ranking lenses: NEAR and MID make one MSOA in Camden; FAR is the City of London's one MSOA.
M1, M2, CAMDEN, CITY = "uk:msoa:E02000166", "uk:msoa:E02000001", "uk:lad:E09000007", cc.CITY_OF_LONDON
GEOGRAPHY = [{"geography_id": NEAR, "name": "Near", "carrier": "lsoa", "parent_id": M1},
             {"geography_id": MID, "name": "Mid", "carrier": "lsoa", "parent_id": M1},
             {"geography_id": FAR, "name": "Far", "carrier": "lsoa", "parent_id": M2},
             {"geography_id": M1, "name": "Camden 001", "carrier": "msoa", "parent_id": CAMDEN},
             {"geography_id": M2, "name": "City of London 001", "carrier": "msoa", "parent_id": CITY},
             {"geography_id": CAMDEN, "name": "Camden", "carrier": "lad", "parent_id": None},
             {"geography_id": CITY, "name": "City of London", "carrier": "lad", "parent_id": None}]
PARENTS = {NEAR: (M1, CAMDEN), MID: (M1, CAMDEN), FAR: (M2, CITY)}
# Six playgrounds in Camden 001 (five in near, one in mid), one in the City.
FAMILY_PLACES = [place(0, a=True, lsoa=NEAR)] * 5 + [place(800, a=True, lsoa=MID), place(5000, a=True, lsoa=FAR)]


class LensConnection(FakeConnection):
    def execute(self, sql, params=()):
        if sql.startswith("-- evidence:custom-criterion-lens-geography"):
            self.statements.append(("-- evidence:custom-criterion-lens-geography", params))
            return GEOGRAPHY
        return super().execute(sql, params)


class LensRollupTests(unittest.TestCase):
    """Rank-worthy presets rolled up from LSOAs to MSOAs and boroughs along the area_geography parents."""

    def rollup(self, **overrides):
        definition = cc.normalise(criterion(**overrides))
        return cc.rollup(definition, PARENTS, cc.area_values(definition, AREAS, PLACES, KM2), PLACES, KM2)

    def test_counts_become_places_per_km2_of_the_whole_area(self):
        sets = {"a": KEBAB_CAFE["sets"]["a"]}
        values = self.rollup(formula="count", sets=sets)
        self.assertEqual(values[M1], {"value": 4.0, "sample": 3})  # 3 kebab shops in 0.5 + 0.25 km²
        self.assertEqual(values[M2], {"value": 0.0, "sample": 0})
        self.assertEqual(values[CAMDEN]["value"], 4.0)
        self.assertEqual(self.rollup(formula="density", sets=sets), values)

    def test_variety_is_the_union_of_kinds_not_a_sum(self):
        values = self.rollup(formula="variety", sets={"a": KEBAB_CAFE["sets"]["a"]})
        self.assertEqual(values[M1]["value"], 3.0)  # kebab, pizza (near) + turkish (mid); kebab once
        self.assertEqual(values[M2]["value"], 0.0)

    def test_nearest_is_the_median_of_the_lsoa_minutes(self):
        definition = cc.normalise(criterion(formula="nearest", sets={"a": KEBAB_CAFE["sets"]["a"]}))
        lsoas = cc.area_values(definition, AREAS, PLACES, KM2)
        values = cc.rollup(definition, PARENTS, lsoas, PLACES, KM2)
        self.assertAlmostEqual(values[M1]["value"], (lsoas[NEAR]["value"] + lsoas[MID]["value"]) / 2)
        self.assertEqual(values[M1]["sample"], 2)  # LSOAs measured
        self.assertEqual(values[M2]["value"], lsoas[FAR]["value"])

    def test_pair_formulas_recompute_from_summed_counts(self):
        values = self.rollup()
        self.assertEqual(values[M1]["value"], 0.0)  # (3 - 3) / (3 + 3 + 5)
        self.assertEqual(self.rollup(formula="share")[M1]["value"], 0.5)
        self.assertIsNone(self.rollup(formula="share")[M2]["value"])


class LensPackTests(unittest.TestCase):
    def setUp(self):
        cc.clear_cache()
        personal_places.clear_cache()
        self.addCleanup(cc.release_store.use_memory())  # lenses are kept per release (release_artifact)

    def test_places_for_families_by_msoa_and_borough(self):
        connection = LensConnection(places=FAMILY_PLACES)
        pack = cc.lens_pack(connection, "family", "msoa")
        self.assertEqual((pack["schemaVersion"], pack["metricId"], pack["carrier"]),
                         ("area-value-pack.v1", "lens:family", "msoa"))
        self.assertEqual((pack["productReleaseId"], pack["sourceVersion"], pack["unit"]), ("rel-1", "src-osm", "places per km²"))
        # By land on /rankings (LENS_BY_LAND), under the set's name, while the map walks to the nearest one.
        self.assertEqual((pack["criterion"]["label"], pack["criterion"]["formula"]), ("Playgrounds and nurseries", "count"))
        self.assertIn("Playgrounds and nurseries", pack["method"])
        self.assertIn("per km²", pack["method"])
        self.assertEqual(pack["sources"][0]["licence"], "ODbL-1.0")
        self.assertIn(cc.PLACES_NOT_PEOPLE, pack["caveats"])
        values = {v["geographyId"]: v for v in pack["values"]}
        self.assertEqual(set(values), {M1, M2})
        camden = values[M1]
        self.assertEqual((camden["name"], camden["value"], camden["sampleCount"], camden["quality"]),
                         ("Camden 001", 8.0, 6, "observed"))  # 6 places in 0.75 km²
        # The only ranked MSOA: percentile 0 under the competition rule (#221), not mid-rank 50.
        self.assertEqual((camden["metricId"], camden["carrier"], camden["regionPercentile"]), ("lens:family", "msoa", 0))
        # One playground is too few to rank an MSOA by density.
        self.assertEqual((values[M2]["value"], values[M2]["quality"], values[M2]["sampleCount"]), (None, "suppressed", 1))

        boroughs = {v["geographyId"]: v for v in cc.lens_pack(connection, "family", "borough")["values"]}
        self.assertEqual(boroughs[CAMDEN]["value"], 8.0)
        # The City's tiny area would top every density list.
        self.assertEqual((boroughs[CITY]["value"], boroughs[CITY]["quality"]), (None, "suppressed"))

    def test_evaluated_once_per_release_outside_the_criterion_cache(self):
        connection = LensConnection(places=FAMILY_PLACES)
        cc.lens_pack(connection, "family", "msoa")
        cc.lens_pack(connection, "family", "borough")
        cc.lens_pack(connection, "family", "msoa")
        markers = [marker for marker, _ in connection.statements]
        self.assertEqual(markers.count("-- evidence:custom-criterion-places"), 1)
        self.assertEqual(len(cc._CACHE), 0)  # the 64-entry criterion LRU is left to households
        connection.release = "rel-2"
        self.assertEqual(cc.lens_pack(connection, "family", "msoa")["productReleaseId"], "rel-2")
        self.assertEqual([m for m, _ in connection.statements].count("-- evidence:custom-criterion-places"), 2)
        self.assertEqual([key for key in cc.release_store.store.kinds() if key[1] == "lens"],
                         [("rel-1", "lens", "('family', ('E12000007',))"), ("rel-2", "lens", "('family', ('E12000007',))")])

    def test_a_unified_lens_credits_each_source_its_places_came_from(self):
        origins = [["osm"], ["osm", "fhrs"]] + [["osm"]] * 5
        places = [{**p, "source_release_id": "src-places-unified-2026-09", "origins": o}
                  for p, o in zip(FAMILY_PLACES, origins)]
        pack = cc.lens_pack(LensConnection(places=places), "family", "msoa")
        self.assertEqual([(s["id"], s["licence"]) for s in pack["sources"]],
                         [("src-places-unified-2026-09", "ODbL-1.0"), ("src-places-unified-2026-09", "OGL-UK-3.0")])
        self.assertIn("OpenStreetMap", pack["sources"][0]["name"])
        self.assertIn("Open Government Licence", pack["sources"][1]["attribution"])
        sql, _ = cc.places_query(cc.normalise(KEBAB_CAFE), unified=True)
        self.assertIn("p.sources AS origins", sql)
        self.assertNotIn("origins", cc.places_query(cc.normalise(KEBAB_CAFE))[0])  # place_poi is OpenStreetMap
        # Every merged source, each under its own licence, when the places do not say.
        self.assertEqual([s["licence"] for s in cc.place_sources("src-places-unified-1", [{}], unified=True)],
                         ["ODbL-1.0", "OGL-UK-3.0", "CDLA-Permissive-2.0", "Apache-2.0"])
        self.assertEqual(cc.place_sources("", [], unified=True), [])

    def test_concurrent_first_requests_build_a_lens_once(self):
        import threading
        import time

        class Slow(LensConnection):
            def execute(self, sql, params=()):
                if sql.startswith("-- evidence:custom-criterion-places"):
                    time.sleep(0.05)
                return super().execute(sql, params)

        connection = Slow(places=FAMILY_PLACES)
        start = threading.Barrier(6)
        found = []

        def ask(carrier):
            start.wait()
            found.append(cc.lens_pack(connection, "family", carrier)["carrier"])

        threads = [threading.Thread(target=ask, args=(carrier,)) for carrier in ("msoa", "borough") * 3]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(found), ["lad"] * 3 + ["msoa"] * 3)
        markers = [marker for marker, _ in connection.statements]
        self.assertEqual(markers.count("-- evidence:custom-criterion-places"), 1)

    @unittest.skipUnless((Path(__file__).resolve().parents[2] / "deploy" / "ship.sh").exists(), "no deploy/")
    def test_the_release_build_builds_every_lens_pack(self):
        from area_api import release_build
        source = Path(release_build.__file__).read_text()
        self.assertIn("for preset_id in custom_criteria.LENS_PRESETS:", source)
        self.assertIn('custom_criteria.lens_pack(connection, preset_id, "msoa")', source)
        ship = (Path(__file__).resolve().parents[2] / "deploy" / "ship.sh").read_text()
        self.assertIn("python -m area_api.release_build --tiers 0,1", ship)

    def test_variety_and_nearest_keep_their_own_units(self):
        connection = LensConnection()
        self.assertEqual(cc.lens_pack(connection, "food-variety", "msoa")["unit"], "kinds")
        nearest = cc.lens_pack(connection, "markets", "borough")
        self.assertEqual(nearest["unit"], "minutes")
        city = next(v for v in nearest["values"] if v["geographyId"] == CITY)
        self.assertEqual(city["quality"], "observed")  # only densities leave the City out

    def test_unknown_presets_and_carriers(self):
        from area_api.evidence import MalformedQuery, MetricNotFound
        with self.assertRaises(MetricNotFound):
            cc.lens_pack(LensConnection(), "kebab-cafe", "msoa")  # a preset, but not ranked
        with self.assertRaises(MalformedQuery):
            cc.lens_pack(LensConnection(), "family", "lsoa")

    def test_every_ranked_preset_exists(self):
        ids = {entry["criterion"]["id"] for entry in cc.presets()["presets"]}
        self.assertEqual(set(cc.LENS_PRESETS) - ids, set())


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class LensHttpTests(unittest.TestCase):
    def setUp(self):
        cc.clear_cache()
        personal_places.clear_cache()
        self._previous = app_module._connect
        app_module._connect = lambda: LensConnection(places=FAMILY_PLACES)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._connect = self._previous

    def test_lens_pack_is_served_before_the_metric_route(self):
        response = self.client.get("/api/v1/area-values/lens/family?carrier=borough")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["metricId"], "lens:family")
        self.assertIn("public", response.headers["cache-control"])
        self.assertEqual(self.client.get("/api/v1/area-values/lens/nope?carrier=msoa").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/area-values/lens/family?carrier=lsoa").status_code, 400)


class ShareLinkOrderTests(unittest.TestCase):
    def test_sets_pack_in_a_b_c_order_as_profile_state_does(self):
        from area_api import share_links
        reordered = {**KEBAB_CAFE, "sets": {"b": KEBAB_CAFE["sets"]["b"], "a": KEBAB_CAFE["sets"]["a"]}}
        packed = share_links._pack_custom({"criterion": reordered, "weight": 2, "direction": "higher"})
        self.assertEqual([entry[0] for entry in packed[0][4]], ["a", "b"])


if __name__ == "__main__":
    unittest.main()
