"""Track I: EA NaFRA2 flood risk tiles for London (area_analytics.flood_risk)."""

import json
import unittest

from area_analytics import flood_risk


def feature(band, geometry_type="MultiPolygon"):
    ring = [[530000, 180000], [530010, 180000], [530010, 180010], [530000, 180000]]
    coordinates = [[ring]] if geometry_type == "MultiPolygon" else [ring]
    return {"type": "Feature", "properties": {"risk_band": band},
            "geometry": {"type": geometry_type, "coordinates": coordinates}}


class BandTests(unittest.TestCase):
    def test_ea_labels_map_to_ordered_codes(self):
        self.assertEqual([flood_risk.band_code(label) for label in ("Very low", "Low", "Medium", "High")],
                         [1, 2, 3, 4])
        self.assertEqual(flood_risk.band_code(" very LOW "), 1)
        self.assertEqual([flood_risk.band_name(code) for code in (1, 4)], ["very-low", "high"])
        self.assertIsNone(flood_risk.band_name(None))

    def test_unknown_label_stops_the_load(self):
        for label in ("Significant", "", None):
            with self.assertRaises(ValueError):
                flood_risk.band_code(label)

    def test_every_band_has_a_plain_chance(self):
        self.assertEqual(set(flood_risk.BAND_CHANCE), set(flood_risk.BANDS))


class TileTests(unittest.TestCase):
    def test_features_keep_polygons_only(self):
        payload = {"type": "FeatureCollection", "features": [
            feature("High"), feature("Low", "Polygon"),
            {"type": "Feature", "properties": {"risk_band": "Low"}, "geometry": None},
            {"type": "Feature", "properties": {"risk_band": "Low"},
             "geometry": {"type": "Point", "coordinates": [530000, 180000]}},
        ]}

        rows = list(flood_risk.tile_features(payload, "rivers-sea"))

        self.assertEqual([code for code, _ in rows], [4, 2])
        self.assertEqual([geometry["type"] for _, geometry in rows], ["MultiPolygon", "Polygon"])

    def test_error_payload_is_rejected(self):
        with self.assertRaises(ValueError):
            list(flood_risk.tile_features({"error": "rate limited"}, "surface-water"))

    def test_tiles_cover_greater_london(self):
        # Greater London in British National Grid (Hillingdon to Havering, Croydon to Enfield).
        london = (503_500, 155_800, 561_900, 200_900)
        cells = list(flood_risk.tiles())
        east = [e for e, _ in cells]
        north = [n for _, n in cells]

        self.assertLessEqual(min(east), london[0])
        self.assertGreaterEqual(max(east) + flood_risk.TILE, london[2])
        self.assertLessEqual(min(north), london[1])
        self.assertGreaterEqual(max(north) + flood_risk.TILE, london[3])
        self.assertEqual(len(cells), len(set(cells)))

    def test_tile_url_reads_one_metre_per_pixel_in_bng(self):
        url = flood_risk.tile_url(flood_risk.SOURCES["rivers-sea"], 528_000, 180_000)

        self.assertIn("96ab4342-82c1-4095-87f1-0082e8d84ef1/wms", url)
        self.assertIn("LAYERS=rofrs_4band", url)
        self.assertIn("CRS=EPSG:27700", url)
        self.assertIn("BBOX=528000,180000,532000,184000", url)
        self.assertEqual(flood_risk.TILE / flood_risk.PIXELS, 1)


class WaterTests(unittest.TestCase):
    def test_water_keeps_polygons_and_skips_blank_lines_and_separators(self):
        polygon = {"type": "Polygon", "coordinates": [[[-0.1, 51.5], [-0.09, 51.5], [-0.09, 51.51], [-0.1, 51.5]]]}
        lines = [
            '\x1e{"type": "Feature", "geometry": %s, "properties": {"natural": "water"}}\n' % json.dumps(polygon),
            "\n",
            '{"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}}\n',
            '{"type": "Feature", "geometry": null}\n',
        ]

        self.assertEqual([json.loads(g) for g in flood_risk.water_geometries(lines)], [polygon])


if __name__ == "__main__":
    unittest.main()
