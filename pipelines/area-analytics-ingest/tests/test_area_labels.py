"""Friendly area names and map label points: pure rules."""

import json
import os
import tempfile
import unittest

from area_analytics import area_labels as al, coverage


def pc(postcode, lsoa, msoa, lon, lat, doterm="", usrtypind="0"):
    return {"pcds": postcode, "doterm": doterm, "usrtypind": usrtypind, "lsoa21cd": lsoa,
            "msoa21cd": msoa, "lat": str(lat), "long": str(lon)}


ROWS = [
    pc("BR6 0AA", "L1", "M1", 0.10, 51.36),
    pc("BR6 0AB", "L1", "M1", 0.11, 51.37),
    pc("BR6 0AD", "L2", "M2", 0.12, 51.38),
    pc("BR5 1AA", "L2", "M2", 0.13, 51.39),
    pc("BR5 1AB", "L2", "M2", 0.14, 51.40),
    pc("BR6 9ZZ", "L1", "M1", 0.50, 51.90, doterm="201901"),       # terminated
    pc("BR6 1XX", "L1", "M1", 0.50, 51.90, usrtypind="1"),          # large user
    pc("BR6 2XX", "L1", "M1", "", ""),                                # no location
    pc("BR6 3XX", "L1", "M1", 0.0, 99.999999),                       # no grid reference
]


class LivePostcodeTests(unittest.TestCase):
    def test_keeps_live_small_user_postcodes_with_a_location(self):
        live = list(al.live_postcodes(ROWS))
        self.assertEqual([row["postcode"] for row in live], ["BR6 0AA", "BR6 0AB", "BR6 0AD", "BR5 1AA", "BR5 1AB"])
        self.assertEqual(live[0]["district"], "BR6")

    def test_outward_code(self):
        self.assertEqual(al.outward("ec1a 1bb"), "EC1A")
        self.assertEqual(al.outward("W5 2AA"), "W5")


class MajorityTests(unittest.TestCase):
    def test_majority_district_per_area(self):
        live = list(al.live_postcodes(ROWS))
        self.assertEqual(al.majority_district(live, "lsoa"), {"L1": "BR6", "L2": "BR5"})
        self.assertEqual(al.majority_district(live, "msoa"), {"M1": "BR6", "M2": "BR5"})

    def test_ties_go_to_the_alphabetically_first_district(self):
        self.assertEqual(al.majority({"SE1": 3, "SE11": 3, "SE17": 1}), "SE1")
        self.assertIsNone(al.majority({}))


class DistrictCentreTests(unittest.TestCase):
    def test_centre_is_the_live_postcode_nearest_the_mean(self):
        centres = al.district_centres(list(al.live_postcodes(ROWS)))
        # BR6: mean (0.11, 51.37) is exactly BR6 0AB; the terminated and large-user
        # postcodes far to the north-east never pull it.
        self.assertEqual(centres["BR6"], {"lon": 0.11, "lat": 51.37, "postcodes": 3, "msoa": "M1"})
        self.assertEqual(centres["BR5"]["msoa"], "M2")

    def test_centre_of_a_crescent_stays_on_one_of_its_postcodes(self):
        ring = [pc(f"N1 {i}AA", "L", "M", lon, lat)
                for i, (lon, lat) in enumerate([(0, 0), (1, 1), (2, 0), (1, -1)])]
        centre = al.district_centres(list(al.live_postcodes(ring)))["N1"]
        self.assertIn((centre["lon"], centre["lat"]), {(0, 0), (1, 1), (2, 0), (1, -1)})


class NameChoiceTests(unittest.TestCase):
    def test_short_name_keeps_the_first_part_without_a_compass_word(self):
        self.assertEqual(al.short_name("Orpington Central"), "Orpington")
        self.assertEqual(al.short_name("Chelsfield & Green Street Green"), "Chelsfield")
        self.assertEqual(al.short_name("Strand, St James"), "Strand")
        self.assertEqual(al.short_name("Alperton East"), "Alperton")
        self.assertEqual(al.short_name("Upper Edmonton"), "Upper Edmonton")
        self.assertEqual(al.short_name("St George in the East", limit=30), "St George in the East")

    def test_long_or_missing_names_are_dropped(self):
        self.assertIsNone(al.short_name("Carpenters Estate and Stratford New Town"))
        self.assertIsNone(al.short_name(""))
        self.assertIsNone(al.short_name(None))

    def test_district_label_and_panel_title(self):
        self.assertEqual(al.district_label("BR6", "Orpington Central"), "BR6 · Orpington")
        self.assertEqual(al.district_label("E20", "Queen Elizabeth Olympic Park Village"), "E20")
        self.assertEqual(al.friendly_title("Alperton East", "NW10"), "Alperton East · NW10")
        self.assertEqual(al.friendly_title("Brent", None), "Brent")
        self.assertIsNone(al.friendly_title(None, "NW10"))

    def test_read_msoa_names_skips_blank_names(self):
        names = al.read_msoa_names(["msoa21cd,msoa21nm,msoa21hclnm\n", "E02000118,Brent 026,Alperton East\n",
                                    "E02000119,Brent 027, \n"])
        self.assertEqual(names, {"E02000118": "Alperton East"})


class AssemblyTests(unittest.TestCase):
    def test_area_labels_cover_lsoas_msoas_and_boroughs(self):
        live = list(al.live_postcodes(ROWS))
        rows = al.area_labels(live, {"M1": "Orpington Central"}, {"L1": "M1", "L2": "M2"}, {"E09000006": "Bromley"})
        by_id = {row["geography_id"]: row for row in rows}
        self.assertEqual(by_id["uk:lsoa:L1"], {"geography_id": "uk:lsoa:L1", "friendly_name": "Orpington Central",
                                               "postcode_district": "BR6"})
        self.assertIsNone(by_id["uk:lsoa:L2"]["friendly_name"])  # unnamed MSOA: no friendly name, never a guess
        self.assertEqual(by_id["uk:msoa:M2"]["postcode_district"], "BR5")
        self.assertEqual(by_id["uk:lad:E09000006"]["friendly_name"], "Bromley")

    def test_small_districts_get_no_map_label(self):
        square = {"type": "Polygon", "coordinates": [[[0, 51], [1, 51], [1, 52], [0, 52], [0, 51]]]}
        feature = {"properties": {"LAD21CD": "E09000006", "LAD21NM": "Bromley"}, "geometry": square}
        labels = al.map_labels(list(al.live_postcodes(ROWS)), {}, [feature])
        self.assertEqual([(row["kind"], row["code"]) for row in labels], [("borough", "E09000006")])


class CoverageTests(unittest.TestCase):
    def test_onspd_rows_keep_the_coverage_regions(self):
        header = "pcds,doterm,usrtypind,lat,long,lsoa21cd,msoa21cd,rgn26cd\n"
        lines = [header, "BR6 0AA,,0,51.36,0.10,E01000001,E02000001,E12000007\n",
                 "M1 1AD,,0,53.48,-2.24,E01033664,E02006917,E12000002\n",
                 "CF10 1AA,,0,51.48,-3.18,W01001939,W02000398,W99999999\n"]
        self.assertEqual([r["pcds"] for r in al.onspd_rows(lines, coverage.ENGLAND)], ["BR6 0AA", "M1 1AD"])
        self.assertEqual([r["pcds"] for r in al.onspd_rows(lines, coverage.LONDON)], ["BR6 0AA"])

    def test_borough_features_take_london_from_the_first_file_and_the_rest_from_the_next(self):
        square = {"type": "Polygon", "coordinates": [[[0, 51], [1, 51], [1, 52], [0, 52], [0, 51]]]}
        other = {"type": "Polygon", "coordinates": [[[0, 50], [1, 50], [1, 51], [0, 51], [0, 50]]]}
        with tempfile.TemporaryDirectory() as tmp:
            london, england = os.path.join(tmp, "london.json"), os.path.join(tmp, "england.json")
            json.dump({"features": [{"properties": {"LAD21CD": "E09000006", "LAD21NM": "Bromley"},
                                     "geometry": square}]}, open(london, "w"))
            json.dump({"features": [{"properties": {"LAD26CD": "E09000006", "LAD26NM": "Bromley"}, "geometry": other},
                                    {"properties": {"LAD26CD": "E08000003", "LAD26NM": "Manchester"},
                                     "geometry": other},
                                    {"properties": {"LAD26CD": "W06000015", "LAD26NM": "Cardiff"},
                                     "geometry": other}]}, open(england, "w"))
            features = al.borough_features([london, england], coverage.ENGLAND)
        self.assertEqual([(f["properties"]["code"], f["geometry"] is square or f["geometry"] == square)
                          for f in features], [("E08000003", False), ("E09000006", True)])
        labels = al.map_labels([], {}, features)
        self.assertEqual([(row["code"], row["label"]) for row in labels],
                         [("E08000003", "Manchester"), ("E09000006", "Bromley")])


class InteriorPointTests(unittest.TestCase):
    def test_square_centre(self):
        x, y = al.polylabel([[(0, 0), (4, 0), (4, 4), (0, 4), (0, 0)]], precision=1e-6)
        self.assertAlmostEqual(x, 2, places=3)
        self.assertAlmostEqual(y, 2, places=3)

    def test_l_shape_point_is_inside_and_away_from_the_notch(self):
        ring = [(0, 0), (10, 0), (10, 2), (2, 2), (2, 10), (0, 10), (0, 0)]
        x, y = al.polylabel([ring], precision=1e-6)
        self.assertGreater(al._signed_distance(x, y, [ring]), 0.9)  # inside, about 1 from every edge

    def test_multipolygon_uses_the_largest_part(self):
        geometry = {"type": "MultiPolygon", "coordinates": [
            [[[0, 51], [0.01, 51], [0.01, 51.01], [0, 51.01], [0, 51]]],
            [[[1, 51], [2, 51], [2, 52], [1, 52], [1, 51]]],
        ]}
        lon, lat = al.interior_point(geometry)
        self.assertTrue(1 < lon < 2 and 51 < lat < 52)


if __name__ == "__main__":
    unittest.main()
