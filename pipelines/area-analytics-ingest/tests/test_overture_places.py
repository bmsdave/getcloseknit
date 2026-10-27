"""Overture places: row shaping, text[] literals, the COPY line and the source release."""

import unittest

from area_analytics import overture_places

RECORD = {"id": "abc-1", "name": " Kebab\tKing ", "category": "kebab_restaurant",
          "alternate_categories": ["fast_food_restaurant", 'turkish "grill"', None, ""],
          "basic_category": "restaurant", "brand": None, "brand_wikidata": None, "confidence": 0.912345,
          "operating_status": "open", "datasets": ["meta", "Foursquare", "meta"], "licences": ["CDLA-Permissive-2.0"],
          "lon": -0.07, "lat": 51.51, "phones": ["+44 20 0000 0000"]}


class PlaceRowTests(unittest.TestCase):
    def test_keeps_only_the_table_columns(self):
        row = overture_places.place_row(RECORD)
        self.assertEqual(tuple(row), overture_places.COLUMNS)
        self.assertEqual(row["name"], "Kebab\tKing")
        self.assertEqual(row["confidence"], 0.9123)
        self.assertEqual(row["location"], "SRID=4326;POINT(-0.07 51.51)")
        self.assertIn("website", row)
        self.assertEqual(overture_places.COLUMNS[-2:], ("website", "location"))

    def test_keeps_website_only_for_estate_agents(self):
        agent = overture_places.place_row({**RECORD, "category": "real_estate_agent", "website": "https://kfh.co.uk"})
        self.assertEqual(agent["website"], "https://kfh.co.uk")
        service = overture_places.place_row({**RECORD, "category": None, "basic_category": "real_estate_service",
                                             "website": "https://svc.example"})
        self.assertEqual(service["website"], "https://svc.example")
        self.assertIsNone(overture_places.place_row({**RECORD, "website": "https://kebab.example"})["website"])

    def test_select_never_reads_other_websites(self):
        self.assertIn("CASE WHEN", overture_places.SELECT)
        self.assertIn("real_estate_agent", overture_places.SELECT)

    def test_arrays_are_quoted_postgres_literals(self):
        row = overture_places.place_row(RECORD)
        self.assertEqual(row["alternate_categories"], '{"fast_food_restaurant","turkish \\"grill\\""}')
        self.assertEqual(row["datasets"], '{"Foursquare","meta","meta"}')
        self.assertIsNone(overture_places.place_row({**RECORD, "alternate_categories": []})["alternate_categories"])

    def test_rejects_rows_without_id_or_point(self):
        self.assertIsNone(overture_places.place_row({**RECORD, "id": " "}))
        self.assertIsNone(overture_places.place_row({**RECORD, "lat": None}))
        self.assertIsNone(overture_places.place_row({**RECORD, "lon": 200.0}))

    def test_tsv_line_escapes_tabs_and_backslashes(self):
        line = overture_places.tsv_line(overture_places.place_row({**RECORD, "brand": None}))
        fields = line.split("\t")
        self.assertEqual(len(fields), len(overture_places.COLUMNS))
        self.assertEqual(fields[1], "Kebab\\tKing")
        self.assertEqual(fields[overture_places.COLUMNS.index("alternate_categories")],
                         '{"fast_food_restaurant","turkish \\\\"grill\\\\""}')
        self.assertEqual(fields[overture_places.COLUMNS.index("brand")], "")

    def test_source_release_names_licences(self):
        release = overture_places.source_release(
            {"sha256": "f" * 64, "retrieved": "2026-10-07", "licences": {"Apache-2.0": 2, "CDLA-Permissive-2.0": 5}})
        self.assertEqual(release[0], "src-overture-places-2026-09-23.1")
        self.assertEqual(release[2], "2026-09-23")
        self.assertEqual(release[4], "CDLA-Permissive-2.0")
        self.assertIn("Apache-2.0, CDLA-Permissive-2.0", release[6][0])


if __name__ == "__main__":
    unittest.main()
