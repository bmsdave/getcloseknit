"""Track H: OSM classification and TfL zones/lines for stations, parks and amenities."""
import unittest

from area_analytics.places import (
    atco_to_naptan,
    build_stations,
    classify,
    normalise_name,
    normalise_zone,
    poi,
    representative_point,
    tfl_stations,
)


def feature(props, geometry=None, osm_type="node", osm_id=1):
    return {"type": "Feature", "geometry": geometry or {"type": "Point", "coordinates": [-0.1, 51.5]},
            "properties": {"@type": osm_type, "@id": osm_id, **props}}


SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]]}


def tfl_point(naptan, name, lon, lat, zone, groups, lines):
    return {"naptanId": naptan, "commonName": name, "stopType": "NaptanMetroStation", "lon": lon, "lat": lat,
            "lines": [{"id": i, "name": n} for i, n in lines],
            "lineModeGroups": [{"modeName": m, "lineIdentifier": ids} for m, ids in groups],
            "additionalProperties": [{"category": "Geo", "key": "Zone", "value": zone}]}


class ClassifyTests(unittest.TestCase):
    def test_stations(self):
        tube = classify(feature({"railway": "station", "name": "Bank", "station": "subway",
                                 "naptan:AtcoCode": "9400ZZLUBNK"}))
        self.assertEqual((tube.category, tube.modes, tube.atco), ("station", ("tube",), ("9400ZZLUBNK",)))
        self.assertEqual(classify(feature({"railway": "tram_stop", "name": "Arena"})).modes, ("tram",))
        self.assertEqual(classify(feature({"public_transport": "station", "train": "yes", "name": "X"})).modes,
                         ("national-rail",))

    def test_dropped_stations(self):
        for props in ({"railway": "station"},  # no name
                      {"public_transport": "station", "bus": "yes", "name": "Bus station"},
                      {"railway": "station", "name": "Gates A", "station": "monorail", "airside": "yes"},
                      {"railway": "station", "name": "Station A", "network": "Heathrow Airport"},
                      {"railway": "station", "name": "Ruislip Lido", "usage": "tourism"}):
            self.assertIsNone(classify(feature(props)), props)

    def test_parks_need_a_name_an_outline_and_public_access(self):
        park = classify(feature({"leisure": "park", "name": "Hyde Park"}, SQUARE, "way"))
        self.assertEqual((park.category, park.kind, park.osm_id, park.lon, park.lat), ("park", "park", "w1", 1, 1))
        self.assertIsNone(classify(feature({"leisure": "park", "name": "Point park"})))
        self.assertIsNone(classify(feature({"leisure": "park"}, SQUARE)))
        self.assertIsNone(classify(feature({"leisure": "park", "name": "P", "access": "private"}, SQUARE)))
        # gardens are often private squares: they need explicit public access
        self.assertIsNone(classify(feature({"leisure": "garden", "name": "Square"}, SQUARE)))
        self.assertIsNone(classify(feature({"leisure": "garden", "name": "S", "access": "yes",
                                            "garden:type": "residential"}, SQUARE)))
        self.assertEqual(classify(feature({"leisure": "garden", "name": "Kew", "access": "yes"}, SQUARE)).kind,
                         "garden")
        self.assertEqual(classify(feature({"landuse": "recreation_ground", "name": "R"}, SQUARE)).kind,
                         "recreation-ground")

    def test_brands_and_leisure_places(self):
        shop = classify(feature({"shop": "supermarket", "name": "M&S Simply Food", "brand": "M&S Simply Food"}))
        self.assertEqual((shop.kind, shop.brand), ("supermarket", "M&S Simply Food"))
        gym = classify(feature({"leisure": "fitness_centre", "name": "PureGym Angel", "brand": "PureGym"}))
        self.assertEqual((gym.group, gym.kind, gym.brand), ("leisure", "gym", "PureGym"))
        centre = classify(feature({"leisure": "sports_centre", "name": "York Hall", "sport": "swimming;boxing"}))
        self.assertEqual((centre.kind, centre.sport), ("pool", "swimming;boxing"))
        self.assertEqual(classify(feature({"club": "sport", "sport": "tennis", "name": "Highbury LTC"})).kind, "sports-club")
        self.assertIsNone(classify(feature({"leisure": "swimming_pool"})))  # unnamed: a private pool
        self.assertIsNone(classify(feature({"leisure": "swimming_pool", "name": "Residents' pool", "access": "private"})))
        self.assertEqual(classify(feature({"leisure": "swimming_pool", "access": "yes"})).kind, "pool")

    def test_amenity_groups(self):
        cases = {("shop", "supermarket"): "groceries", ("shop", "convenience"): "groceries",
                 ("amenity", "pub"): "pubs", ("amenity", "bar"): "pubs", ("amenity", "cafe"): "food",
                 ("amenity", "restaurant"): "food", ("amenity", "pharmacy"): "pharmacies",
                 ("healthcare", "pharmacy"): "pharmacies", ("amenity", "doctors"): "gps",
                 ("healthcare", "doctor"): "gps"}
        for (key, value), group in cases.items():
            self.assertEqual(classify(feature({key: value})).group, group, (key, value))
        self.assertIsNone(classify(feature({"amenity": "pub", "disused": "yes"})))
        self.assertIsNone(classify(feature({"amenity": "bank", "name": "Bank"})))
        self.assertIsNone(classify(feature({"amenity": "pub"}, {"type": "Point", "coordinates": []})))


class HelperTests(unittest.TestCase):
    def test_helpers(self):
        self.assertEqual(atco_to_naptan("9400ZZLUSBM"), "940GZZLUSBM")
        self.assertEqual(atco_to_naptan("9100WDRYTON"), "910GWDRYTON")
        self.assertEqual(normalise_name("Shepherd's Bush Market Underground Station"),
                         normalise_name("Shepherd's Bush Market"))
        self.assertEqual(normalise_name("Highbury & Islington Rail Station"), "highbury and islington")
        self.assertEqual((normalise_zone("2+3"), normalise_zone("2/3"), normalise_zone("NA"), normalise_zone(None)),
                         ("2/3", "2/3", None, None))
        self.assertEqual(representative_point({"type": "MultiPolygon", "coordinates": [SQUARE["coordinates"]]}),
                         (1, 1))


class StationTests(unittest.TestCase):
    def setUp(self):
        self.tfl = tfl_stations([
            {"stopPoints": [
                tfl_point("940GZZLUCWR", "Canada Water Underground Station", -0.1, 51.5, "2",
                          [("tube", ["jubilee"]), ("bus", ["188"])], [("jubilee", "Jubilee"), ("188", "188")]),
                tfl_point("940GZZCRARA", "Arena Tram Stop", -0.06, 51.39, None, [("tram", ["tram"])],
                          [("tram", "Tram")]),
                {"naptanId": "940GZZLUCWR1", "stopType": "NaptanMetroPlatform"},
            ]},
            [tfl_point("910GCNDAW", "Canada Water Rail Station", -0.1001, 51.5001, "2+3",
                       [("overground", ["windrush"])], [("windrush", "Windrush")])],
        ])

    def test_tfl_stations_keep_rail_lines_only(self):
        self.assertEqual(set(self.tfl), {"940GZZLUCWR", "940GZZCRARA", "910GCNDAW"})
        self.assertEqual(self.tfl["940GZZLUCWR"].lines, {"jubilee": ("Jubilee", "tube")})
        self.assertEqual(self.tfl["910GCNDAW"].zone, "2/3")

    def test_one_osm_node_gets_every_same_named_tfl_station(self):
        osm = classify(feature({"railway": "station", "name": "Canada Water", "naptan:AtcoCode": "9100CNDAW",
                                "train": "yes"}))
        [station] = build_stations([osm], self.tfl)
        self.assertEqual(station.modes, ["tube", "overground"])
        self.assertEqual([line["name"] for line in station.lines], ["Jubilee", "Windrush"])
        self.assertEqual(station.zone, "2/3")  # the code match comes first

    def test_osm_parts_of_one_station_merge_and_unmatched_keep_osm_modes(self):
        node = classify(feature({"railway": "tram_stop", "name": "Arena"},
                                {"type": "Point", "coordinates": [-0.06, 51.39]}, osm_id=5))
        outline = classify(feature({"railway": "tram_stop", "name": "Arena"},
                                   {"type": "Point", "coordinates": [-0.0605, 51.3901]}, "way", 6))
        lonely = classify(feature({"railway": "halt", "name": "Nowhere Halt"},
                                  {"type": "Point", "coordinates": [0.2, 51.6]}, osm_id=7))
        stations = build_stations([node, outline, lonely], self.tfl)
        self.assertEqual([s.osm_ids for s in stations], [["n5", "w6"], ["n7"]])
        self.assertEqual((stations[0].modes, stations[0].zone, stations[0].tfl_ids), (["tram"], None, ["940GZZCRARA"]))
        self.assertEqual((stations[1].modes, stations[1].lines, stations[1].zone), (["national-rail"], [], None))


class PoiTests(unittest.TestCase):
    def test_raw_tags_are_kept_without_osmium_attributes(self):
        osm_id, tags, lon, lat = poi(feature({"amenity": "fast_food", "cuisine": "kebab;pizza", "name": "Best"}))
        self.assertEqual((osm_id, lon, lat), ("n1", -0.1, 51.5))
        self.assertEqual(tags, {"amenity": "fast_food", "cuisine": "kebab;pizza", "name": "Best"})

    def test_polygons_become_a_point_and_closed_or_untagged_places_are_dropped(self):
        osm_id, _, lon, lat = poi(feature({"shop": "bakery"}, SQUARE, "way", 9))
        self.assertEqual((osm_id, lon, lat), ("w9", 1.0, 1.0))
        self.assertIsNone(poi(feature({"amenity": "cafe", "disused": "yes"})))
        self.assertIsNone(poi(feature({"highway": "bus_stop"})))
        self.assertIsNone(poi(feature({"amenity": "cafe"}, {"type": "LineString", "coordinates": [[0, 0], [1, 1]]})))

    def test_load_rows_keep_the_first_copy_and_escape_tsv(self):
        from area_analytics.places_load import OSM_RELEASE, poi_rows
        rows = poi_rows([feature({"amenity": "cafe", "name": "Tab\there"}), feature({"amenity": "bar"}),
                         feature({"shop": "bakery"}, osm_id=2)]).getvalue().splitlines()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].split("\t"),
                         ["n1", r'{"amenity": "cafe", "name": "Tab\\there"}', "SRID=4326;POINT(-0.1 51.5)", OSM_RELEASE])

    def test_poi_load_gives_each_place_its_lsoa(self):
        from unittest import mock
        from area_analytics import places_load
        statements = []

        class Cursor:
            def execute(self, sql, params=None):
                statements.append(sql)
                return self

            def fetchone(self):
                return (1,)

        with mock.patch.object(places_load, "read_features", return_value=[feature({"amenity": "cafe"})]), \
                mock.patch.object(places_load, "_copy"):
            self.assertEqual(places_load._load_poi(Cursor()), 1)
        self.assertEqual(statements[1], places_load.LSOA_SQL.format(table="place_poi"))


if __name__ == "__main__":
    unittest.main()
