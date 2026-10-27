"""Places map labels (migration 036): place_tile() carries an importance score, thins by zoom so zoom
14-15 keep only the most important places, and keeps 035's rules (confident, named, never religion)."""
import os
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (ROOT / "deploy" / "migrations" / "036-place-labels.sql").read_text()
BASE = (ROOT / "deploy" / "migrations" / "035-place-tile.sql").read_text()
TILE = MIGRATION.split("CREATE OR REPLACE FUNCTION public.place_tile", 1)[1]


class PlaceLabelTileTests(unittest.TestCase):
    def test_keeps_035_rules(self):
        self.assertIn("IF z < 14 THEN\n        RETURN NULL;", TILE)
        for rule in ("p.confidence >= 0.6", "p.name IS NOT NULL", "NOT (p.tags ? 'religion')",
                     "NOT IN ('place_of_worship', 'monastery')", "p.tags->>'shop', '') <> 'religion'",
                     "p.tags->>'office', '') <> 'religion'", "ST_AsMVT(f, 'places', 4096, 'geom')"):
            self.assertIn(rule, TILE)
        for prop in ("q.id", "q.name", "q.category", 'q."group"', "q.brand", "q.sources", "q.hygiene_rating", "q.score"):
            self.assertIn(prop, TILE)

    def test_fewer_places_zoomed_out(self):
        floors = re.search(r"floor_score integer := CASE WHEN z >= 16 THEN (\d+) WHEN z = 15 THEN (\d+) ELSE (\d+) END", TILE)
        self.assertTrue(floors)
        z16, z15, z14 = map(int, floors.groups())
        self.assertLess(z16, z15)
        self.assertLess(z15, z14)
        self.assertIn("ORDER BY q.\"group\", q.cx, q.cy, q.score DESC", TILE)

    def test_landmarks_outrank_offices(self):
        weight = MIGRATION.split("FUNCTION public.place_category_weight", 1)[1].split("$$;", 1)[0]
        first = re.search(r"WHEN category IN \(([^)]*)\) THEN 45", weight, re.S).group(1)
        for landmark in ("supermarket", "marketplace", "cinema", "theatre", "sports_centre"):
            self.assertIn(f"'{landmark}'", first)
        self.assertIn("ELSE 2", weight)


DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")


@unittest.skipUnless(DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a PostGIS database")
class PlaceLabelTilePostgisTests(unittest.TestCase):
    """Runs 035 then 036 on TEMP rows: nothing persists."""

    def test_zoom_14_keeps_landmarks_and_drops_generic_places(self):
        import psycopg

        def temp(sql: str) -> str:
            for name in ("place_tile", "place_group", "place_category_weight", "place_importance"):
                sql = sql.replace(f"public.{name}", f"pg_temp.{name}")
                sql = re.sub(rf"(?<![.\w]){name}\(", f"pg_temp.{name}(", sql)
            return sql.replace("CREATE INDEX IF NOT EXISTS place_location_gix ON place", "CREATE INDEX ON pg_temp.place")

        with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
            connection.execute("CREATE TEMP TABLE place (id text, name text, category text, tags jsonb, "
                               "confidence real, sources text[], hygiene_rating text, location geometry(Point, 4326))")
            connection.execute(temp(BASE))
            connection.execute(temp(MIGRATION))
            rows = [
                ("osm:n1", "Big Market", "marketplace", "{}", 1.0, "{osm,overture,fsq,fhrs}", None, -0.1, 51.5),
                ("osm:n2", "Desk Ltd", "company", "{}", 0.6, "{fsq}", None, -0.1001, 51.5001),
                ("osm:n3", "St Mary", "community_centre", '{"amenity": "place_of_worship"}', 1.0, "{osm,overture}", None, -0.1, 51.5),
            ]
            for row in rows:
                connection.execute("INSERT INTO pg_temp.place VALUES (%s, %s, %s, %s, %s, %s, %s, "
                                   "ST_SetSRID(ST_MakePoint(%s, %s), 4326))", row)
            z14 = bytes(connection.execute("SELECT pg_temp.place_tile(14, 8187, 5448)").fetchone()[0] or b"")
            z16 = bytes(connection.execute("SELECT pg_temp.place_tile(16, 32749, 21794)").fetchone()[0] or b"")
            scores = connection.execute(
                "SELECT pg_temp.place_importance('supermarket', 1.0, '{osm,overture,fsq,fhrs}', 'Tesco', NULL), "
                "pg_temp.place_importance('company', 0.6, '{fsq}', 'Acme', NULL)").fetchone()
            connection.rollback()
        self.assertIn(b"Big Market", z14)
        self.assertNotIn(b"Desk Ltd", z14)
        self.assertNotIn(b"Desk Ltd", z16, "a one-source office is dropped at every zoom")
        self.assertNotIn(b"St Mary", z16)
        self.assertIn(b"score", z16)
        self.assertGreaterEqual(scores[0], 95)
        self.assertLess(scores[1], 16)


if __name__ == "__main__":
    unittest.main()
