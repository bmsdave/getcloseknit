"""Location layers: planning applications kept and categorised, the 24-month window, and the
GeoPackage and shapefile readers behind the conservation-area and charging-zone loads."""
import datetime
import struct
import unittest

from area_analytics import location_layers as layers


def _shp(records):
    """A minimal .shp: 100-byte header, then one PolygonZ (15) record per list of rings."""
    body = b""
    for number, rings in enumerate(records, start=1):
        points = [point for ring in rings for point in ring]
        starts, offset = [], 0
        for ring in rings:
            starts.append(offset)
            offset += len(ring)
        content = struct.pack("<i4d2i", 15, 0, 0, 0, 0, len(rings), len(points))
        content += struct.pack(f"<{len(rings)}i", *starts)
        content += b"".join(struct.pack("<2d", x, y) for x, y in points)
        content += struct.pack("<2d", 0, 0) + b"\0" * 8 * len(points)  # Z range and values: skipped
        body += struct.pack(">2i", number, len(content) // 2) + content
    return b"\0" * 100 + body


class PlanningTests(unittest.TestCase):
    def test_categories(self):
        self.assertEqual(layers.planning_category("Householder planning permission"), "householder")
        self.assertEqual(layers.planning_category("Householder planning & listed building consent"), "householder")
        self.assertEqual(layers.planning_category("Full planning permission"), "full")
        self.assertEqual(layers.planning_category("Outline planning permission: All matters reserved"), "full")
        self.assertEqual(layers.planning_category("Prior Approval: Larger Home Extension"), "prior-approval")
        self.assertEqual(layers.planning_category("Lawful development: Proposed use"), "other")

    def test_window_is_24_months_and_clamps_to_month_end(self):
        self.assertEqual(layers.window(datetime.date(2026, 10, 7)), (datetime.date(2024, 10, 7), datetime.date(2026, 10, 7)))
        self.assertEqual(layers.window(datetime.date(2026, 3, 31), 1), (datetime.date(2026, 2, 28), datetime.date(2026, 3, 31)))

    def test_weeks_cover_the_window_without_gaps(self):
        slices = list(layers.weeks(datetime.date(2026, 1, 1), datetime.date(2026, 1, 20)))
        self.assertEqual(slices[0], (datetime.date(2026, 1, 1), datetime.date(2026, 1, 8)))
        self.assertEqual(slices[-1], (datetime.date(2026, 1, 15), datetime.date(2026, 1, 21)))
        self.assertTrue(all(a[1] == b[0] for a, b in zip(slices, slices[1:])))

    def test_query_leaves_out_paperwork_and_asks_for_three_fields(self):
        query = layers.planning_query(datetime.date(2026, 1, 1), datetime.date(2026, 1, 8))
        self.assertEqual(query["_source"], ["valid_date", "application_type_full", "centroid"])
        excluded = query["query"]["bool"]["must_not"][0]["terms"]["application_type_full.raw"]
        self.assertIn("Approval of details reserved by a condition (discharge)", excluded)
        self.assertIn("Tree works: Trees in conservation areas/subject to TPOs", excluded)
        self.assertEqual(query["query"]["bool"]["filter"][0]["range"]["valid_date"]["gte"], "01/01/2026")

    def test_records_need_a_date_a_type_and_a_london_centroid(self):
        hit = {"_id": "Islington-P1", "_source": {"valid_date": "28/01/2025", "application_type_full": "Full planning permission",
                                                  "centroid": {"lat": 51.55, "lon": -0.09}}}
        self.assertEqual(layers.planning_record(hit), {"id": "Islington-P1", "validDate": "2025-01-28",
                                                       "type": "Full planning permission", "category": "full",
                                                       "lat": 51.55, "lon": -0.09})
        origin = {**hit, "_source": {**hit["_source"], "centroid": {"lat": 49.766807, "lon": -7.55716}}}
        self.assertIsNone(layers.planning_record(origin))
        self.assertIsNone(layers.planning_record({**hit, "_source": {**hit["_source"], "valid_date": None}}))
        self.assertIsNone(layers.planning_record({**hit, "_source": {**hit["_source"], "centroid": None}}))


class ReaderTests(unittest.TestCase):
    def test_gpkg_header_is_stripped_by_envelope_size(self):
        wkb = b"\x01\x06\x00\x00\x00"
        self.assertEqual(layers.gpkg_wkb(b"GP\x00\x01" + b"\0" * 4 + wkb), wkb)  # no envelope
        self.assertEqual(layers.gpkg_wkb(b"GP\x00\x03" + b"\0" * 4 + b"\1" * 32 + wkb), wkb)  # xy envelope
        with self.assertRaises(ValueError):
            layers.gpkg_wkb(b"XX\x00\x01" + wkb)

    def test_shapefile_rings_skip_z(self):
        square = [(0, 0), (0, 10), (10, 10), (10, 0), (0, 0)]
        hole = [(2, 2), (4, 2), (4, 4), (2, 4), (2, 2)]
        records = layers.shapefile_rings(_shp([[square, hole], [square]]))
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0], [square, hole])

    def test_clockwise_rings_start_polygons_and_holes_follow(self):
        outer = [(0, 0), (0, 10), (10, 10), (10, 0), (0, 0)]  # clockwise: shapefile outer ring
        hole = [(2, 2), (4, 2), (4, 4), (2, 4), (2, 2)]
        self.assertLess(layers.signed_area(outer), 0)
        self.assertGreater(layers.signed_area(hole), 0)
        wkt = layers.polygon_wkt([outer, hole, outer])
        self.assertTrue(wkt.startswith("MULTIPOLYGON(((0 0,0 10"))
        self.assertEqual(wkt.count("(("), 2)  # two polygons, the first with its hole


class NationalConservationTests(unittest.TestCase):
    def test_councils_outside_london_and_other_publishers(self):
        from area_analytics import coverage

        organisations = [
            {"entity": "1", "statistical-geography": "E09000007", "name": "London Borough of Camden"},
            {"entity": "2", "statistical-geography": "E07000008", "name": "Cambridge City Council"},
            {"entity": "3", "statistical-geography": "", "name": "Historic England"},
            {"entity": "4", "statistical-geography": "W06000015", "name": "Cardiff Council"},
        ]
        area = {"end-date": "", "geometry": "MULTIPOLYGON (((0 0,1 0,1 1,0 0)))", "name": "Mill Road "}
        rows = [{**area, "entity": "10", "organisation-entity": "1"},
                {**area, "entity": "11", "organisation-entity": "2"},
                {**area, "entity": "12", "organisation-entity": "3", "name": ""},
                {**area, "entity": "13", "organisation-entity": "4"},
                {**area, "entity": "14", "organisation-entity": "2", "end-date": "2020-01-01"},
                {**area, "entity": "15", "organisation-entity": "2", "geometry": ""}]
        kept = list(layers.national_conservation_rows(rows, organisations, coverage.ENGLAND))
        self.assertEqual([row[:3] for row in kept], [("pd:11", "Mill Road", "Cambridge"),
                                                     ("pdo:12", "Conservation area", "Historic England")])


if __name__ == "__main__":
    unittest.main()
