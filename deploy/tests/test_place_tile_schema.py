"""Places map tiles (migration 035): confident named places from zoom 14, never religion, groups that
match the places taxonomy."""
import json
import os
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (ROOT / "deploy" / "migrations" / "035-place-tile.sql").read_text()
TILE = MIGRATION.split("CREATE OR REPLACE FUNCTION public.place_tile", 1)[1]
# The newest migration that (re)defines place_group() is the one the database runs.
GROUP_MIGRATION = [text for text in (path.read_text() for path in sorted((ROOT / "deploy" / "migrations").glob("*.sql")))
                   if "CREATE OR REPLACE FUNCTION public.place_group" in text][-1]
GROUP = GROUP_MIGRATION.split("CREATE OR REPLACE FUNCTION public.place_group", 1)[1].split("$$;", 1)[0]
TAXONOMY = json.loads((ROOT / "pipelines" / "area-analytics-ingest" / "area_analytics" / "places_taxonomy.json").read_text())
CATEGORIES = TAXONOMY["categories"]


def group_categories(group: str) -> set[str]:
    """Category keys listed in the CASE branch that returns `group`."""
    branch = re.search(r"WHEN category (?:IN \(([^)]*)\)|= '(\w+)') THEN '" + group + "'", GROUP, re.S)
    assert branch, group
    return set(re.findall(r"'(\w+)'", branch.group(1) or f"'{branch.group(2)}'"))


class PlaceTileTests(unittest.TestCase):
    def test_only_confident_named_places_from_zoom_14(self):
        self.assertIn("IF z < 14 THEN\n        RETURN NULL;", TILE)
        self.assertIn("p.confidence >= 0.6", TILE)
        self.assertIn("p.name IS NOT NULL", TILE)

    def test_never_religion(self):
        self.assertIn("NOT (p.tags ? 'religion')", TILE)
        self.assertIn("NOT IN ('place_of_worship', 'monastery')", TILE)
        self.assertIn("p.tags->>'shop', '') <> 'religion'", TILE)
        self.assertIn("p.tags->>'office', '') <> 'religion'", TILE)

    def test_layer_and_properties(self):
        self.assertIn("ST_AsMVT(f, 'places', 4096, 'geom')", TILE)
        for prop in ("q.id", "q.name", "q.category", 'q."group"', "q.brand", "q.sources", "q.hygiene_rating"):
            self.assertIn(prop, TILE)

    def test_groups_follow_the_taxonomy(self):
        self.assertEqual(group_categories("shop"), set(CATEGORIES["food_shop"]) | set(CATEGORIES["shop"]))
        self.assertEqual(group_categories("pub"), set(CATEGORIES["drink"]))
        self.assertEqual(group_categories("gym"), set(CATEGORIES["fitness"]))
        self.assertEqual(group_categories("culture"), set(CATEGORIES["culture"]))
        food = group_categories("coffee") | group_categories("fast_food") | group_categories("restaurant")
        self.assertEqual(food, set(CATEGORIES["food"]))


DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")


@unittest.skipUnless(DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a PostGIS database")
class PlaceTilePostgisTests(unittest.TestCase):
    """Runs the migration's functions on TEMP rows: nothing persists."""

    def test_tile_keeps_confident_places_and_drops_religion(self):
        import psycopg

        with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
            connection.execute("CREATE TEMP TABLE place (id text, name text, category text, tags jsonb, "
                               "confidence real, sources text[], hygiene_rating text, location geometry(Point, 4326))")
            connection.execute(MIGRATION.replace("CREATE INDEX IF NOT EXISTS place_location_gix ON place",
                                                 "CREATE INDEX ON pg_temp.place")
                               .replace("public.place_tile", "pg_temp.place_tile")
                               .replace("public.place_group", "pg_temp.place_group")
                               .replace("place_group(p.category)", "pg_temp.place_group(p.category)"))
            rows = [
                ("osm:n1", "Kebab King", "kebab", '{"amenity": "fast_food"}', 0.9, "{osm,fhrs}", "5"),
                ("osm:n2", "Low Cafe", "cafe", '{"amenity": "cafe"}', 0.4, "{fsq}", None),
                ("osm:n3", "St Mary", "community_centre", '{"amenity": "place_of_worship"}', 0.9, "{osm}", None),
                ("osm:n4", "Bookshop", "books", '{"shop": "books", "religion": "x"}', 0.9, "{osm}", None),
                ("osm:n5", None, "pub", '{"amenity": "pub"}', 0.9, "{osm}", None),
            ]
            for row in rows:
                connection.execute("INSERT INTO pg_temp.place VALUES (%s, %s, %s, %s, %s, %s, %s, "
                                   "ST_SetSRID(ST_MakePoint(-0.1, 51.5), 4326))", row)
            z16 = connection.execute("SELECT pg_temp.place_tile(16, 32749, 21794)").fetchone()[0]
            z13 = connection.execute("SELECT pg_temp.place_tile(13, 4093, 2724)").fetchone()[0]
            group = connection.execute("SELECT pg_temp.place_group('kebab'), pg_temp.place_group('museum'), "
                                       "pg_temp.place_group('estate_agent')").fetchone()
            connection.rollback()
        self.assertIsNone(z13)
        tile = bytes(z16)
        self.assertIn(b"Kebab King", tile)
        self.assertIn(b"osm,fhrs", tile)
        for absent in (b"Low Cafe", b"St Mary", b"Bookshop", b"osm:n5"):
            self.assertNotIn(absent, tile)
        self.assertEqual(group, ("fast_food", "culture", "other"))


if __name__ == "__main__":
    unittest.main()
