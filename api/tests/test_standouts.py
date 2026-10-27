"""Area page standouts (v3 Fix 27G) and safety rows (Fix 33b): tiles, tags, verdict, offence types, trend."""
import os
import unittest
from unittest import mock

from area_api import safety, standouts
from area_api.evidence import MalformedQuery


def _raw(**extra):
    """Crofton-like inputs: very safe, a top school close by, quiet, no GP within 1 km, no cycle lanes."""
    london = sorted([0.0] * 20 + [float(i) for i in range(1, 81)])  # a fifth of London has no lanes
    return {
        "metrics": {
            "price-per-square-metre": {"value": 6524.4, "region_percentile": 45, "period": "2026-06"},
            "crime": {"value": 19.83, "region_percentile": 2, "period": "2026-08"},
            "station-access": {"value": 13.2, "region_percentile": 92, "period": "2026-09"},
        },
        "priceYearAgo": 6544.0,
        "noise": {"any_55_share": 0.082, "road_lden_median": 49.9},
        "noiseLondon": sorted([0.05] + [0.1 + i / 100 for i in range(99)]),
        "health": {"no2": None, "air_pct": None, "gp_practices": 0, "gp_nearest_m": 1269.0},
        "gpLondon": sorted([float(100 + i * 10) for i in range(95)] + [1300.0] * 5),
        "kids": {"lanes_km": 0},
        "lanesLondon": london,
        "nature": {"green_share": 0.72, "site_name": "Darrick & Newstead Woods", "site_kind": "lnr",
                   "site_metres": 60, "nature_percentile": 86},
        "station": {"name": "Orpington", "zone": "6"},
        "schools": [{"name": "Newstead Wood School", "phase": "secondary", "distanceMetres": 164, "outstanding": True, "top": True},
                    {"name": "Tubbenden Primary School", "phase": "primary", "distanceMetres": 389, "outstanding": False, "top": False}],
        "schoolCount": 8, "schoolsCapped": False, "bestSchool": 99,
        "presets": {"nightlife": {"value": 3, "percentile": 30, "radiusMetres": 800},
                    "families": {"value": 1, "percentile": 43, "radiusMetres": 800}},
        **extra,
    }


class TileTests(unittest.TestCase):
    def test_twelve_fixed_tiles_in_one_order(self):
        tiles = standouts.build_tiles(_raw())
        self.assertEqual([t["id"] for t in tiles], ["price", "safety", "schools", "station-walk", "cycling", "noise",
                                                     "nature", "air", "gp", "food-hygiene", "nightlife", "families"])
        # An empty layer is a tile without a value (the page says "No data here"), never zero.
        empty = standouts.build_tiles({})
        self.assertEqual(len(empty), 12)
        self.assertTrue(all(not t["available"] and t["display"] is None and t["value"] is None for t in empty))

    def test_values_in_words_and_standings(self):
        tiles = {t["id"]: t for t in standouts.build_tiles(_raw())}
        self.assertEqual(tiles["price"]["display"], "£6,500/m²")  # to the nearest £100, as the page's headline
        self.assertEqual(tiles["price"]["trend"], {"percent": -0.3, "years": 1})
        # Price and nightlife are neutral: a London position, never a standing or an extreme.
        self.assertIsNone(tiles["price"]["standing"])
        self.assertEqual(tiles["price"]["regionPercentile"], 45)
        self.assertIsNone(tiles["nightlife"]["extreme"])
        self.assertEqual(tiles["safety"]["display"], "Safer than 98%")
        self.assertEqual(tiles["safety"]["standing"], 98)
        self.assertEqual(tiles["schools"]["display"], "8 within 1.5 km")
        self.assertEqual(tiles["schools"]["detail"], "1 Outstanding")
        self.assertEqual(tiles["station-walk"]["display"], "13 min")
        self.assertEqual(tiles["station-walk"]["detail"], "Orpington, zone 6")
        self.assertEqual(tiles["nature"]["display"], "Reserve 1 min")
        self.assertFalse(tiles["air"]["available"])
        self.assertEqual(tiles["gp"]["display"], "1.3 km")
        self.assertEqual(tiles["families"]["display"], "1 min walk")

    def test_nightlife_counts_inside_the_area_and_families_is_the_walk(self):
        # Nightlife counts the places inside the boundary ("41 places", a real zero too); Families (Layers v5) is
        # the walk to the nearest playground or nursery, closer = the better end, so a short walk is a pro.
        tiles = {t["id"]: t for t in standouts.build_tiles(_raw(presets={
            "nightlife": {"value": 0, "percentile": 3, "radiusMetres": 800},
            "families": {"value": 2.4, "percentile": 97, "radiusMetres": 800}}))}
        self.assertEqual((tiles["nightlife"]["value"], tiles["nightlife"]["display"]), (0, "0 places"))
        self.assertEqual(tiles["nightlife"]["detail"], "in this area")
        self.assertTrue(tiles["families"]["available"])
        self.assertEqual((tiles["families"]["value"], tiles["families"]["display"]), (2, "2 min walk"))
        self.assertEqual(tiles["families"]["detail"], "nearest playground or nursery")
        self.assertEqual((tiles["families"]["standing"], tiles["families"]["extreme"]), (97, "pro"))
        far = {t["id"]: t for t in standouts.build_tiles(_raw(presets={
            "families": {"value": 21, "percentile": 2, "radiusMetres": 800}}))}
        self.assertEqual(far["families"]["extreme"], "con")
        # No places table, or no value for the area: no data ("—" on the page), never zero.
        missing = {t["id"]: t for t in standouts.build_tiles(_raw(presets={}))}
        self.assertFalse(missing["families"]["available"])
        self.assertIsNone(missing["families"]["value"])

    def test_site_designations_in_capitals(self):
        self.assertEqual(standouts.site_name("Crofton Woods Sssi"), "Crofton Woods SSSI")
        self.assertEqual(standouts.site_name("Darrick & Newstead Woods Lnr"), "Darrick & Newstead Woods LNR")
        self.assertEqual(standouts.site_name("Sssington Park"), "Sssington Park")

    def test_ties_are_never_extreme(self):
        # A fifth of London has no cycle lanes: 0 km is not London's worst 10%.
        cycling = next(t for t in standouts.build_tiles(_raw()) if t["id"] == "cycling")
        self.assertEqual(cycling["display"], "0 km lanes")
        self.assertIsNone(cycling["extreme"])
        self.assertEqual(standouts.london_rank([0.0, 0.0, 1.0, 2.0], 0.0), (25, 0, 50))
        self.assertEqual(standouts.london_rank([1.0, 2.0, 3.0, 4.0], 1.0, higher_is_better=False), (88, 75, 0))


class AirTileTests(unittest.TestCase):
    """The air tile reads the LAEI grid, so it waits for CLOSE_KNIT_AIR_QUALITY."""

    def tile(self):
        health = {"no2": 31.2, "air_pct": 72.0, "gp_practices": 0, "gp_nearest_m": 1269.0}
        return next(t for t in standouts.build_tiles(_raw(health=health)) if t["id"] == "air")

    def test_unavailable_while_the_flag_is_off(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("CLOSE_KNIT_AIR_QUALITY", None)
            self.assertFalse(self.tile()["available"])

    def test_available_with_the_flag_on(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_AIR_QUALITY": "1"}):
            tile = self.tile()
        self.assertTrue(tile["available"])
        self.assertEqual(tile["display"], "NO₂ 31 µg/m³")


class TagTests(unittest.TestCase):
    def test_crofton_tags_and_verdict(self):
        raw = _raw()
        tags = standouts.pick_tags(standouts.build_tiles(raw), raw)
        self.assertEqual([(t["kind"], t["text"]) for t in tags], [
            ("pro", "Safer than 98% of London"),
            ("pro", "Outstanding school 164 m"),
            ("pro", "Quieter than 99% of London"),
            ("con", "13 min walk to a station, zone 6"),
            ("con", "No GP within 1 km"),
        ])
        self.assertEqual([t["section"] for t in tags], ["safety", "schools", "environment", "getting-around", "health"])
        self.assertEqual(standouts.verdict(tags),
                         "Very safe, a top school close by and quiet; a long walk to a station and no GP close by.")

    def test_at_most_three_pros_two_cons_one_per_topic_in_topic_order(self):
        tiles = [standouts._tile(tile_id, 1, "x", 99 if index % 2 else 1) for index, (tile_id, *_) in enumerate(standouts.TILES)]
        tags = standouts.pick_tags(tiles, _raw())
        pros, cons = [t for t in tags if t["kind"] == "pro"], [t for t in tags if t["kind"] == "con"]
        self.assertLessEqual(len(pros), 3)
        self.assertLessEqual(len(cons), 2)
        topics = [next(entry[3] for entry in standouts.TILES if entry[0] == t["id"]) for t in tags]
        self.assertEqual(len(set((t["kind"], topic) for t, topic in zip(tags, topics))), len(tags))
        for group in (pros, cons):
            ranks = [standouts.TOPIC_ORDER.index(next(e[3] for e in standouts.TILES if e[0] == t["id"])) for t in group]
            self.assertEqual(ranks, sorted(ranks))

    def test_neutral_and_people_never_tag(self):
        tiles = [standouts._tile("price", 1, "£1/m²", 99), standouts._tile("nightlife", 1, "1 place", 1)]
        self.assertEqual(standouts.pick_tags(tiles, {}), [])
        ids = {entry[0] for entry in standouts.TILES}
        self.assertFalse(ids & {"income", "deprivation", "social-renting", "people", "ethnicity", "religion"})
        self.assertEqual(standouts.verdict([]), "Close to London's middle on most measures.")

    def test_deprivation_tags_at_londons_ten_percent_ends(self):
        # Owner decision 2026-10-17: deprivation is no tile but tags like an ordinary metric (higher percentile = less deprived).
        # The tag is tie-aware: the decile has only 10 distinct values, so it ranks against London's deciles
        # with london_rank bounds (issue #189) instead of the stored ties-upper region_percentile.
        london = sorted([d for d in range(1, 9) for _ in range(10)] + [9] * 10 + [10] * 10)

        def tags(decile, percentile):
            raw = {"metrics": {"deprivation": {"value": decile, "region_percentile": percentile,
                                                "period": "2025-01"}},
                   "deprivationLondon": london}
            return standouts.pick_tags(standouts.build_tiles(raw), raw)

        self.assertEqual(tags(10, 100), [{"id": "deprivation", "kind": "pro", "text": "Among London's least deprived 10%", "section": "people"}])
        self.assertEqual(tags(1, 0), [{"id": "deprivation", "kind": "con", "text": "Among London's most deprived 10%", "section": "people"}])
        self.assertEqual(tags(5, 50), [])
        self.assertEqual(standouts.deprivation_tag({"metrics": {}}), None)
        self.assertEqual(standouts.verdict(tags(10, 100)), "Among London's least deprived.")
        tiles = standouts.build_tiles({"metrics": {"deprivation": {"value": 1, "region_percentile": 1, "period": "2025-01"}}})
        self.assertEqual([tile["id"] for tile in tiles], [entry[0] for entry in standouts.TILES])

    def test_deprivation_tag_is_tie_blind_proof(self):
        # Issue #189: under the ingest's ties-upper rule decile 9 reads percentile ~90 and decile 10 reads
        # 100, so both used to tag "least deprived 10%" (~20% of areas). Only decile 10 is strictly
        # better than >= 90% of LSOAs.
        london = sorted([d for d in range(1, 9) for _ in range(10)] + [9] * 10 + [10] * 10)

        def tags(decile, percentile):
            raw = {"metrics": {"deprivation": {"value": decile, "region_percentile": percentile,
                                                "period": "2025-01"}},
                   "deprivationLondon": london}
            return standouts.pick_tags(standouts.build_tiles(raw), raw)

        self.assertEqual([t["kind"] for t in tags(9, 90)], [])
        self.assertEqual([t["kind"] for t in tags(10, 100)], ["pro"])

    def test_deprivation_tag_is_last_in_topic_order(self):
        raw = _raw()
        raw["metrics"]["deprivation"] = {"value": 10, "region_percentile": 100, "period": "2025-01"}
        raw["deprivationLondon"] = sorted([d for d in range(1, 9) for _ in range(10)] + [9] * 10 + [10] * 10)
        pros = [tag["id"] for tag in standouts.pick_tags(standouts.build_tiles(raw), raw) if tag["kind"] == "pro"]
        self.assertLessEqual(len(pros), 3)
        self.assertNotIn("deprivation", pros[:-1])

    def test_payload_names_withheld_laei_air(self):
        class Connection:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql, params=()):
                return [{"?column?": 1}]

        class Reader:
            def _connect(self):
                return Connection()

        def payload():
            with mock.patch.object(standouts.evidence, "_active_release", return_value="rel-test"), \
                    mock.patch.object(standouts, "load_inputs", return_value=_raw()):
                return standouts.area_standouts(Reader(), "uk:lsoa:E01000001")

        with mock.patch.dict(os.environ, {"CLOSE_KNIT_AIR_QUALITY": ""}):
            self.assertEqual(payload()["withheld"], ["laeiAir"])
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_AIR_QUALITY": "1"}):
            self.assertEqual(payload()["withheld"], [])

    def test_lsoa_only(self):
        with self.assertRaises(MalformedQuery):
            standouts.area_standouts(None, "uk:ward:E05000001")
        with self.assertRaises(MalformedQuery):
            safety.area_safety(None, "uk:lad:E09000001")


class SafetyTests(unittest.TestCase):
    def test_top_types_per_thousand_with_london(self):
        london = {"rate": 98.1, "types": {"Violence and sexual offences": 31.04, "Burglary": 5.3}}
        types = safety.top_types({"Burglary": 4, "Violence and sexual offences": 11, "Drugs": 0}, 1563, london)
        self.assertEqual(types, [
            {"category": "Violence and sexual offences", "offences": 11, "rate": 7.0, "regionRate": 31.0},
            {"category": "Burglary", "offences": 4, "rate": 2.6, "regionRate": 5.3},
        ])
        self.assertEqual(safety.top_types({"Burglary": 4}, None, {"types": {}})[0]["rate"], None)

    def test_trend_is_stable_under_fifteen_percent(self):
        series = [{"period": f"20{23 + (m // 12)}-{m % 12 + 1:02d}", "value": 20 + m * 0.05} for m in range(40)]
        stable = safety.trend(series)
        self.assertEqual(stable["months"], 36)
        self.assertTrue(stable["stable"])
        self.assertEqual(len(stable["points"]), 37)
        rising = safety.trend([{"period": "2023-08", "value": 20}, {"period": "2026-08", "value": 24}])
        self.assertEqual((rising["changePercent"], rising["stable"]), (20.0, False))
        self.assertIsNone(safety.trend(series[:1]))

    def test_comparison_rate_is_the_areas_region(self):
        calls = []

        class Connection:
            def execute(self, sql, params):
                calls.append((sql.split("\n", 1)[0], params))
                if "london-population" in sql:
                    return [{"residents": 2000.0}]
                return [{"category": "Burglary", "offences": 30.0}]

        figures = safety._london(Connection(), "2026-08", "E12000003")
        self.assertEqual(figures, {"rate": 15.0, "types": {"Burglary": 15.0}})
        self.assertEqual([params for _, params in calls], [("E12000003", "2026-08")] * 2)
        self.assertIn("area_region", safety.LONDON_TYPES_SQL)


if __name__ == "__main__":
    unittest.main()
