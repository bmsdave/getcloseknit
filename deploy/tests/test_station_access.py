"""Station access: walking graph, multi-source Dijkstra, snapping and area aggregates."""
import io
import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import etl_station_access as sa  # noqa: E402

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "012-station-access.sql").read_text()


def six_node_graph():
    """0 -80- 1 -80- 2 -80- 3 -80- 4 along y=0, and a 800 m spur 2 -> 5 north.

    Station A sits at vertex 0, station B at vertex 4.
    """
    graph = sa.Graph()
    for osm_id, x, y in ((10, 0, 0), (11, 80, 0), (12, 160, 0), (13, 240, 0), (14, 320, 0), (15, 160, 800)):
        graph.vertex(osm_id, x, y)
    for a, b in ((0, 1), (1, 2), (2, 3), (3, 4), (2, 5)):
        graph.connect(a, b)
    return graph


def two_stations():
    return [sa.Station("osm:nA", "Alpha", ["rail"], [(0.0, 0.0)]),
            sa.Station("osm:nB", "Beta", ["underground"], [(320.0, 0.0)])]


class GraphTests(unittest.TestCase):
    def test_multi_source_dijkstra_labels_the_nearest_station(self):
        dist, label = sa.dijkstra(six_node_graph(), [(0, 0.0, 0), (4, 0.0, 1)])
        self.assertEqual(list(dist), [0, 80, 160, 80, 0, 960])
        self.assertEqual(label[1], 0)
        self.assertEqual(label[3], 1)
        self.assertIn(label[5], (0, 1))  # equidistant through vertex 2

    def test_start_offsets_and_limits(self):
        dist, label = sa.dijkstra(six_node_graph(), [(0, 50.0, 0), (4, 0.0, 1)], limit=200)
        self.assertEqual(dist[1], 130)
        self.assertEqual(label[2], 1)  # 160 from B beats 210 from A
        self.assertTrue(math.isinf(dist[5]))

    def test_bounded_reach_stops_at_the_limit(self):
        reach = sa.bounded_reach(six_node_graph(), [(0, 0.0)], 170)
        self.assertEqual(reach, {0: 0, 1: 80, 2: 160})

    def test_grid_index_finds_the_true_nearest_vertex(self):
        graph = six_node_graph()
        index = sa.GridIndex(graph, range(6), cell=50)
        self.assertEqual(index.nearest(78, 30), (1, math.hypot(2, 30)))
        self.assertEqual(index.nearest(160, 700)[0], 5)
        self.assertIsNone(index.nearest(1000, 400))  # further than SNAP_METRES from any vertex

    def test_components_size_every_vertex(self):
        graph = six_node_graph()
        graph.vertex(99, 5000, 5000)
        self.assertEqual(list(sa.components(graph)), [6, 6, 6, 6, 6, 6, 1])


class AccessTests(unittest.TestCase):
    def test_minutes_and_near_stations_per_lsoa(self):
        graph = six_node_graph()
        homes = [("uk:lsoa:E01000001", 80, 10),   # 80 m + 10 m snap from A
                 ("uk:lsoa:E01000001", 240, 0),   # 80 m from B
                 ("uk:lsoa:E01000002", 160, 810)]  # 960 m + 10 m
        original = sa.MIN_COMPONENT
        sa.MIN_COMPONENT = 1
        try:
            minutes, near = sa.access(graph, two_stations(), homes)
        finally:
            sa.MIN_COMPONENT = original
        self.assertEqual([round(m, 3) for m in minutes], [1.125, 1.0, 12.125])
        # LSOA 1: Alpha 1.125 and 3.0 min, Beta 3.125 and 1.0 -> both medians 2.0625.
        self.assertEqual(near[("uk:lsoa:E01000001", 0)], 2.1)
        self.assertEqual(near[("uk:lsoa:E01000001", 1)], 2.1)
        self.assertEqual(near[("uk:lsoa:E01000002", 0)], 12.1)
        self.assertEqual(len(near), 4)

    def test_padded_median_counts_unreached_homes_as_further(self):
        self.assertEqual(sa.padded_median([3.0, 5.0], 3), 5.0)
        self.assertTrue(math.isinf(sa.padded_median([3.0], 2)))

    def test_aggregate_rows_for_every_level(self):
        parents = {"uk:lsoa:E01000001": "uk:msoa:E02000001", "uk:msoa:E02000001": "uk:lad:E09000001"}
        homes = [("uk:lsoa:E01000001", 0, 0)] * 12
        minutes = [4.0] * 6 + [12.0] * 6
        values, breakdown, utility = sa.aggregate(homes, minutes, parents)
        self.assertEqual([row[0] for row in values],
                         ["uk:lsoa:E01000001", "uk:msoa:E02000001", "uk:lad:E09000001"])
        self.assertEqual(values[0][3:], [8.0, 0, 12, "observed"])
        self.assertEqual(breakdown[0][3:], ["within-10-min", 6])
        self.assertEqual(utility[0][3:], [0, 8.0, "minutes", "uk:lsoa:E01000001", "observed"])

    def test_small_areas_are_suppressed(self):
        values, breakdown, utility = sa.aggregate([("uk:lsoa:E01000001", 0, 0)] * 3, [2.0] * 3, {})
        self.assertEqual(values, [["uk:lsoa:E01000001", "station-access", sa.PERIOD, "", "", 3, "suppressed"]])
        self.assertEqual((breakdown, utility), ([], []))


class OsmTagTests(unittest.TestCase):
    def test_walkable_ways(self):
        self.assertTrue(sa.is_walkable({"highway": "footway"}))
        self.assertTrue(sa.is_walkable({"highway": "trunk", "sidewalk": "both"}))
        self.assertFalse(sa.is_walkable({"highway": "trunk"}))
        self.assertFalse(sa.is_walkable({"highway": "motorway"}))
        self.assertFalse(sa.is_walkable({"highway": "service", "access": "private"}))
        self.assertTrue(sa.is_walkable({"highway": "service", "access": "private", "foot": "yes"}))
        self.assertFalse(sa.is_walkable({"highway": "path", "foot": "no"}))
        self.assertFalse(sa.is_walkable({"highway": "proposed"}))

    def test_station_modes(self):
        self.assertEqual(sa.station_modes({"railway": "station", "station": "subway"}), ["underground"])
        self.assertEqual(sa.station_modes({"railway": "station"}), ["rail"])
        self.assertEqual(sa.station_modes({"railway": "tram_stop"}), ["tram"])
        self.assertEqual(sa.station_modes({"public_transport": "station", "light_rail": "yes"}), ["light_rail"])
        self.assertIsNone(sa.station_modes({"public_transport": "station", "bus": "yes"}))
        self.assertIsNone(sa.station_modes({"railway": "station", "station": "miniature"}))
        self.assertIsNone(sa.station_modes({"railway": "station", "construction": "yes"}))

    def test_opl_parsing_merges_stations_and_attaches_entrances(self):
        opl = "\n".join([
            "n1 x-0.1000 y51.5000",
            "n2 x-0.0990 y51.5000",
            "n3 Tentrance=main x-0.0980 y51.5000",
            "n4 Tname=King%27%s%20%Cross,railway=station,station=subway x-0.0985 y51.5001",
            "n5 Tname=King's%20%Cross,railway=station,train=yes x-0.0984 y51.5002",
            "n6 Trailway=subway_entrance x-0.0981 y51.5001",
            "w1 Thighway=footway Nn1,n2,n3",
            "w2 Tbuilding=train_station,name=King's%20%Cross,public_transport=station,train=yes Nn2,n3,n6",
            "",
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "walk.opl"
            path.write_text(opl, encoding="utf-8")
            graph, features, entrances = sa.read_opl(str(path))
        self.assertEqual(len(graph.xs), 3)
        self.assertEqual(len(features), 3)
        stations = sa.merge_stations(features, entrances)
        self.assertEqual(len(stations), 1)
        self.assertEqual(stations[0].name, "King's Cross")
        self.assertEqual(stations[0].modes, {"rail", "underground"})
        self.assertEqual(len(stations[0].entrances), 2)  # entrance=main on the way, subway entrance


class EnglandTests(unittest.TestCase):
    def test_postcodes_are_normalised_to_postcode_civic_form(self):
        self.assertEqual(sa.norm_postcode(" rg218xg "), "RG21 8XG")
        self.assertEqual(sa.norm_postcode("SW1A  1AA"), "SW1A 1AA")
        self.assertIsNone(sa.norm_postcode("RG2"))
        self.assertIsNone(sa.norm_postcode(None))

    def test_epc_uprns_keep_known_postcodes_and_the_latest_certificate(self):
        found = {}
        rows = [["LMK", "POSTCODE", "UPRN"], ["a", "LS1 1AA", "10"], ["b", "ZZ1 1ZZ", "11"],
                ["c", "LS1 1AB", ""], ["d", "ls11ab", "10"], ["short"]]
        kept = sa.epc_uprns(iter(rows), {"LS1 1AA": "E01000001", "LS1 1AB": "E01000002"}, found)
        self.assertEqual(kept, 2)
        self.assertEqual(found, {10: "E01000002"})

    def test_uprn_points_pick_the_wanted_uprns(self):
        lines = ["10,1.0,2.0,53.79,-1.54\r\n", "11,1.0,2.0,50.1,-5.5\n", "bad line\n"]
        self.assertEqual(list(sa.uprn_points(lines, {10: "E01000002"})), [("E01000002", "-1.54", "53.79")])

    def test_naptan_keeps_active_rail_and_metro_access_areas(self):
        csv_text = ("ATCOCode,CommonName,StopType,Status,Longitude,Latitude\n"
                    "9100LEEDS,Leeds Rail Station,RLY,active,-1.5476,53.7955\n"
                    "9400ZZMAPIC,Piccadilly Gardens,MET,active,-2.237,53.481\n"
                    "450010001,Bus stop,BCT,active,-1.5,53.8\n"
                    "9100OLD,Closed Station,RLY,inactive,-1.0,53.0\n")
        rows = list(sa.naptan_stations(io.StringIO(csv_text)))
        self.assertEqual([(r[0], r[2]) for r in rows], [("9100LEEDS", "rail"), ("9400ZZMAPIC", "metro/tram")])

    def test_read_opl_takes_a_stream(self):
        graph, features, _ = sa.read_opl(io.StringIO("n1 x-1.5 y53.8\nn2 x-1.499 y53.8\nw1 Thighway=footway Nn1,n2\n"))
        self.assertEqual(len(graph.xs), 2)
        self.assertEqual(features, [])

    def test_projection_follows_the_region_latitude(self):
        try:
            sa.set_latitude(54.9)
            x, _ = sa.project(1.0, 54.9)
            self.assertAlmostEqual(x, 111_320 * math.cos(math.radians(54.9)), places=3)
        finally:
            sa.set_latitude(51.5)
        self.assertAlmostEqual(sa.X_SCALE, 111_320 * math.cos(math.radians(51.5)))


class MigrationTests(unittest.TestCase):
    def test_tables_keep_only_stations_and_near_station_aggregates(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS station", MIGRATION)
        self.assertIn("CREATE TABLE IF NOT EXISTS lsoa_station_walk", MIGRATION)
        self.assertIn("median_minutes <= 20", MIGRATION)


if __name__ == "__main__":
    unittest.main()
