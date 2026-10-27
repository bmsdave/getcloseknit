"""Borough standouts (v4 Task 17): the area page's 12 tiles among London's boroughs, tags from the
best and worst 10% of boroughs, and each neighbourhood's strips for the Areas list."""
import unittest
from unittest import mock

from area_api import borough_standouts as b
from area_api import standouts
from area_api.evidence import MalformedQuery

BOROUGHS = [f"uk:lad:E090000{n:02d}" for n in range(1, 21)]  # 20 boroughs, two neighbourhoods each


def _data():
    parent, lsoa = {}, {key: {} for key in ("price", "priceYearAgo", "pricePercentile", "crime", "crimePercentile", "station",
                                           "food", "deprivation", "noise", "lanes", "green", "no2", "gp", "primary",
                                           "nightlife", "families")}
    for index, borough in enumerate(BOROUGHS):
        for half in (0, 1):
            area = f"uk:lsoa:E0100{index:02d}{half:02d}"
            parent[area] = borough
            lsoa["price"][area] = 5000 + index * 500 + half * 200
            lsoa["priceYearAgo"][area] = 5000 + index * 500
            lsoa["pricePercentile"][area] = index * 5
            lsoa["crime"][area] = 40 + index
            lsoa["crimePercentile"][area] = index * 5
            lsoa["station"][area] = 5 + index  # the first borough is closest to stations
            lsoa["food"][area] = 70 + index
            lsoa["deprivation"][area] = 100 - index * 5  # the first is the least deprived
            lsoa["noise"][area] = 0.1 + index / 100
            lsoa["lanes"][area] = float(index)
            lsoa["green"][area] = 0.2 + index / 100
            lsoa["gp"][area] = 300 + index * 50
            lsoa["primary"][area] = index * 5
            lsoa["nightlife"][area] = index
            lsoa["families"][area] = index
    return {
        "parent": parent, "boroughs": BOROUGHS, "pricePeriod": "2026-06", "lsoa": lsoa,
        "crime": {borough: {"value": 50.0 + index * 10, "period": "2026-06"} for index, borough in enumerate(BOROUGHS)},
        "schools": {borough: {"schools": 60 + index, "outstanding": index} for index, borough in enumerate(BOROUGHS)},
    }


class BoroughTileTests(unittest.TestCase):
    def test_twelve_tiles_in_the_area_pages_order(self):
        tiles = b.build_tiles(_data(), BOROUGHS[0])
        self.assertEqual([t["id"] for t in tiles], [entry[0] for entry in standouts.TILES])

    def test_values_are_the_middle_of_its_neighbourhoods_and_standing_is_among_boroughs(self):
        first = {t["id"]: t for t in b.build_tiles(_data(), BOROUGHS[0])}
        last = {t["id"]: t for t in b.build_tiles(_data(), BOROUGHS[-1])}
        self.assertEqual(first["price"]["value"], 5100)
        self.assertEqual(first["price"]["display"], "£5,100/m²")
        self.assertEqual(first["price"]["trend"], {"percent": 2.0, "years": 1})
        # Price is neutral: a position among boroughs, never a standing or a tag.
        self.assertIsNone(first["price"]["standing"])
        self.assertEqual(first["price"]["regionPercentile"], 2)
        # Its own crime figure, the lowest of the boroughs: the safest.
        self.assertEqual(first["safety"]["value"], 50.0)
        self.assertEqual(first["safety"]["standing"], 98)
        self.assertEqual(first["safety"]["display"], "Safer than 98%")
        self.assertEqual(first["safety"]["extreme"], "pro")
        self.assertEqual(last["safety"]["display"], "More crime than 98%")
        self.assertEqual(last["safety"]["extreme"], "con")
        self.assertEqual(first["schools"]["display"], "60 state schools")
        self.assertIsNone(first["schools"]["detail"])
        self.assertEqual(last["schools"]["detail"], "19 Outstanding")
        self.assertEqual(first["station-walk"]["display"], "5 min median")
        self.assertEqual(first["noise"]["display"], "10% over 55 dB")
        self.assertEqual(first["gp"]["display"], "300 m median")
        self.assertIsNone(first["nightlife"]["standing"])

    def test_cycling_is_the_boroughs_own_lanes_when_loaded(self):
        # r3 #40: the borough's own km of lanes inside it, never one typical neighbourhood's "within 1 km".
        data = _data()
        data["boroughLanes"] = {borough: 10.0 + index for index, borough in enumerate(BOROUGHS[:-1])}
        first = {t["id"]: t for t in b.build_tiles(data, BOROUGHS[0])}["cycling"]
        last = {t["id"]: t for t in b.build_tiles(data, BOROUGHS[-1])}["cycling"]
        self.assertEqual((first["display"], first["detail"], first["value"]), ("10 km lanes", "in the borough", 10.0))
        # A borough with no lanes in the table has none (0 km), ranked last.
        self.assertEqual(last["display"], "0 km lanes")
        self.assertEqual(last["extreme"], "con")
        # Without the table (or for an MSOA) the typical neighbourhood's lanes stay.
        typical = {t["id"]: t for t in b.build_tiles(_data(), BOROUGHS[0])}["cycling"]
        self.assertEqual(typical["detail"], "typical, within 1 km")
        msoa = {**data, "carrier": "msoa"}
        self.assertEqual({t["id"]: t for t in b.build_tiles(msoa, BOROUGHS[0])}["cycling"]["detail"], "typical, within 1 km")

    def test_nightlife_counts_every_place_and_families_is_the_typical_walk(self):
        # Nightlife counts the places inside each neighbourhood's own boundary: the borough's tile is their sum,
        # never one typical neighbourhood's. Families (Layers v5) is the walk to the nearest playground or
        # nursery: the middle of its neighbourhoods' minutes, the shortest walk the better end.
        first = {t["id"]: t for t in b.build_tiles(_data(), BOROUGHS[0])}
        last = {t["id"]: t for t in b.build_tiles(_data(), BOROUGHS[-1])}
        self.assertEqual(last["nightlife"]["display"], "38 bars & pubs")
        self.assertEqual(last["nightlife"]["detail"], "in the borough")
        self.assertEqual((last["families"]["value"], last["families"]["display"]), (19, "19 min median"))
        self.assertEqual(last["families"]["detail"], "typical nearest playground or nursery")
        self.assertEqual((first["families"]["extreme"], last["families"]["extreme"]), ("pro", "con"))
        self.assertGreater(first["families"]["standing"], last["families"]["standing"])
        data = _data()
        for area in data["lsoa"]["nightlife"]:
            data["lsoa"]["nightlife"][area] = 700.0
        big = {t["id"]: t for t in b.build_tiles(data, BOROUGHS[0])}
        self.assertEqual(big["nightlife"]["display"], "1,400 bars & pubs")

    def test_a_share_is_never_100_or_0_percent(self):
        self.assertEqual([standouts.london_share(p) for p in (100, 99.6, 0, 0.2, 50)], [99, 99, 1, 1, 50])
        tile = {"id": "safety", "standing": 0, "value": 3916.8}
        self.assertEqual(b._tag_text(tile, "con", None), "More crime than 99% of boroughs")
        self.assertEqual(standouts._tag_text(tile, "con", {}), "More crime than 99% of London")
        self.assertEqual(standouts._tag_text({**tile, "standing": 100}, "pro", {}), "Safer than 99% of London")

    def test_air_waits_for_its_flag_and_a_missing_layer_is_no_data(self):
        data = _data()
        data["lsoa"]["green"] = {}
        tiles = {t["id"]: t for t in b.build_tiles(data, BOROUGHS[0])}
        self.assertFalse(tiles["nature"]["available"])
        self.assertIsNone(tiles["nature"]["value"])
        self.assertFalse(tiles["air"]["available"])

    def test_a_borough_with_no_neighbourhood_values_has_tiles_without_values(self):
        tiles = b.build_tiles({"parent": {}, "boroughs": [], "lsoa": {key: {} for key in _data()["lsoa"]},
                               "crime": {}, "schools": {}}, BOROUGHS[0])
        self.assertEqual(len(tiles), 12)
        self.assertTrue(all(not t["available"] for t in tiles))


class BoroughTagTests(unittest.TestCase):
    def test_tags_name_the_boroughs_and_deprivation_is_a_tag_only(self):
        data = _data()
        tags = b.pick_tags(b.build_tiles(data, BOROUGHS[0]), data, BOROUGHS[0])
        pros = [tag for tag in tags if tag["kind"] == "pro"]
        self.assertEqual(len(pros), 3)
        self.assertEqual(pros[0], {"id": "safety", "kind": "pro", "text": "Safer than 98% of boroughs", "section": "safety"})
        self.assertTrue(all("of boroughs" in tag["text"] for tag in tags))
        # With nothing else extreme, deprivation is the tag (it comes last in topic order).
        only = {**data, "lsoa": {key: (values if key == "deprivation" else {}) for key, values in data["lsoa"].items()},
                "crime": {}, "schools": {}}
        last = b.pick_tags(b.build_tiles(only, BOROUGHS[-1]), only, BOROUGHS[-1])
        self.assertEqual(last, [{"id": "deprivation", "kind": "con", "text": "Among London's most deprived boroughs", "section": "people"}])

    def test_verdict_reads_for_a_borough(self):
        data = _data()
        tags = b.pick_tags(b.build_tiles(data, BOROUGHS[-1]), data, BOROUGHS[-1])
        line = standouts.verdict(tags, b.VERDICT)
        self.assertIn("more crime than most boroughs", line)

    def test_no_income_or_social_housing_tag(self):
        data = _data()
        for borough in BOROUGHS:
            tags = b.pick_tags(b.build_tiles(data, borough), data, borough)
            self.assertFalse({tag["id"] for tag in tags} & {"income", "social-renting", "people"})


class NeighbourhoodStripTests(unittest.TestCase):
    def test_each_neighbourhood_has_price_crime_and_school_strips(self):
        rows = b.neighbourhoods(_data(), BOROUGHS[1])
        self.assertEqual([row["geographyId"] for row in rows], ["uk:lsoa:E01000100", "uk:lsoa:E01000101"])
        self.assertEqual(rows[0], {"geographyId": "uk:lsoa:E01000100", "price": 5500, "priceLondonPercentile": 5,
                                   "crime": 41.0, "safetyStanding": 95, "schoolStanding": 5})

    def test_unknown_is_null_never_zero(self):
        data = _data()
        data["lsoa"]["primary"] = {}
        self.assertIsNone(b.neighbourhoods(data, BOROUGHS[0])[0]["schoolStanding"])


def _msoa_view():
    """The same London grouped by MSOA: each borough's two neighbourhoods are one MSOA each (20 x 2 = 40 MSOAs)."""
    data = _data()
    msoa_parent = {area: area.replace("uk:lsoa:E0100", "uk:msoa:E0200") for area in data["parent"]}
    msoas = sorted(set(msoa_parent.values()))
    return {**data, "msoaParent": msoa_parent, "msoas": msoas, "msoaCrime": {},
            "msoaSchools": {msoa: {"schools": 3, "outstanding": 1} for msoa in msoas}}


class MsoaStandoutTests(unittest.TestCase):
    """v4.4: an MSOA (ranking 'On map', Search 'Areas') has the one area view's tiles, tags and verdict."""

    def test_the_msoa_view_groups_neighbourhoods_by_msoa(self):
        view = b.for_carrier(_msoa_view(), "msoa")
        self.assertEqual(len(view["boroughs"]), 40)
        self.assertEqual(view["parent"]["uk:lsoa:E01000001"], "uk:msoa:E02000001")
        self.assertEqual(b.for_carrier(_data(), "lad")["boroughs"], BOROUGHS)

    def test_tiles_are_its_neighbourhoods_and_crime_falls_back_to_their_middle(self):
        view = b.for_carrier(_msoa_view(), "msoa")
        tiles = {t["id"]: t for t in b.build_tiles(view, "uk:msoa:E02000001")}
        self.assertEqual([t for t in tiles], [entry[0] for entry in standouts.TILES])
        self.assertEqual(tiles["price"]["display"], "£5,200/m²")
        # No MSOA crime loaded: its one neighbourhood's figure, ranked among MSOAs.
        self.assertEqual(tiles["safety"]["value"], 40.0)
        self.assertEqual(tiles["safety"]["extreme"], "pro")
        self.assertEqual(tiles["schools"]["display"], "3 state schools")

    def test_schools_tile_counts_as_its_section_within_1_5_km(self):
        # v4.5: an MSOA with no school inside its boundary still lists the schools within 1.5 km; the tile says so.
        view = {**b.for_carrier(_msoa_view(), "msoa"), "msoaSchools": {}, "schools": {}}
        tiles = {t["id"]: t for t in b.build_tiles(view, "uk:msoa:E02000001")}
        self.assertFalse(tiles["schools"]["available"])
        view["nearSchools"] = {"schools": 8, "outstanding": 3}
        tiles = {t["id"]: t for t in b.build_tiles(view, "uk:msoa:E02000001")}
        self.assertEqual(tiles["schools"]["display"], "8 within 1.5 km")
        self.assertEqual(tiles["schools"]["detail"], "3 Outstanding")
        self.assertEqual(tiles["nightlife"]["detail"], "in the area")

    def test_near_schools_reads_one_row_and_none_without_schools(self):
        connection = mock.MagicMock(spec=["execute"])
        connection.execute.return_value = [{"schools": 8, "outstanding": 3}]
        self.assertEqual(b.near_schools(connection, "uk:msoa:E02000001"), {"schools": 8, "outstanding": 3})
        self.assertIn("-- borough-standouts:near-schools", connection.execute.call_args[0][0])
        connection.execute.return_value = []
        self.assertIsNone(b.near_schools(connection, "uk:msoa:E02000001"))
        connection.execute.side_effect = RuntimeError("no school table")
        self.assertIsNone(b.near_schools(connection, "uk:msoa:E02000001"))

    def test_tags_read_of_london_not_of_boroughs(self):
        view = b.for_carrier(_msoa_view(), "msoa")
        area = "uk:msoa:E02000001"
        tags = b.pick_tags(b.build_tiles(view, area), view, area, "msoa")
        self.assertTrue(tags)
        self.assertTrue(all("boroughs" not in tag["text"] for tag in tags))
        self.assertEqual(tags[0]["text"], "Safer than 98% of London")
        self.assertNotIn("most boroughs", standouts.verdict(tags, b.MSOA_VERDICT))

    def test_served_with_its_carrier(self):
        reader = mock.MagicMock()
        with mock.patch.object(b.release_store, "cached", return_value=_msoa_view()), \
                mock.patch.object(b.evidence, "_active_release", return_value="r1"):
            payload = b.borough_standouts(reader, "uk:msoa:E02000001")
        self.assertEqual(payload["carrier"], "msoa")
        self.assertEqual(len(payload["tiles"]), 12)
        self.assertEqual(len(payload["neighbourhoods"]), 1)
        self.assertIn("MSOAs", payload["caveats"][1])


class BoroughRouteTests(unittest.TestCase):
    def test_a_borough_and_an_msoa_are_served(self):
        reader = mock.MagicMock()
        with mock.patch.object(b, "borough_standouts", return_value={"carrier": "borough"}) as borough:
            self.assertEqual(standouts.area_standouts(reader, "uk:lad:E09000009"), {"carrier": "borough"})
            standouts.area_standouts(reader, "uk:msoa:E02000001")
        self.assertEqual(borough.call_count, 2)
        with self.assertRaises(MalformedQuery):
            standouts.area_standouts(reader, "uk:ward:E05000001")


class SharedLoadTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(b.release_store.use_memory())

    def test_a_page_that_gives_up_never_cancels_the_shared_load(self):
        reader = mock.MagicMock()
        with mock.patch.object(b, "load_london", return_value=_msoa_view()) as load, \
                mock.patch.object(b.evidence, "_active_release", return_value="r1"), \
                mock.patch.object(b.regions, "area_regions_on", return_value={}), \
                mock.patch.object(b, "near_schools", return_value=None):
            b.borough_standouts(reader, "uk:msoa:E02000001", cancel=lambda: False)
        self.assertEqual(load.call_args.args[1:], ("r1",))
        self.assertNotIn("cancel", load.call_args.kwargs)

    def test_build_loads_every_region_once_into_the_release_store(self):
        reader = mock.MagicMock()
        regions_map = {"uk:lad:E09000001": "E12000007", "uk:lad:E08000003": "E12000002"}
        with mock.patch.object(b, "load_london", return_value=_data()) as load, \
                mock.patch.object(b.evidence, "_active_release", return_value="r1"), \
                mock.patch.object(b.regions, "area_regions_on", return_value=regions_map), \
                mock.patch.object(b, "_region_view", side_effect=lambda everywhere, keep: everywhere) as view:
            self.assertEqual(b.build(reader), ["E12000002", "E12000007"])
            b.build(reader)  # built: read back from the store
        self.assertEqual(load.call_count, 1)
        self.assertEqual(view.call_count, 2)
        self.assertEqual(b.release_store.store.kinds(), [("r1", "borough-standouts", "('E12000002',)"),
                                                         ("r1", "borough-standouts", "('E12000007',)"),
                                                         ("r1", "borough-standouts", "()")])


if __name__ == "__main__":
    unittest.main()
