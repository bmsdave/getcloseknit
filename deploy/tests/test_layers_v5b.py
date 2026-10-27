"""Layers v5 batch 2 (migration 101, deploy/tools/etl_layers_v5.py): Supermarket and GP walks, Gigabit
broadband, built from tables already loaded; legends strictly ascending."""
import json
import os
import re
import sys
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / "tools"))
import etl_layers_v5  # noqa: E402

MIGRATION = (DEPLOY / "migrations" / "101-layers-v5-batch2.sql").read_text()
CONTRACTS = (DEPLOY.parent / "web" / "src" / "lib" / "contracts.ts").read_text()
PERSONAL_PLACES = (DEPLOY.parent / "api" / "area_api" / "personal_places.py").read_text()
METRIC_IDS = [metric for layer in etl_layers_v5.BATCH_2 for metric in etl_layers_v5.LAYERS[layer][1]]


def strictly_ascending(stops: list[dict]) -> bool:
    values = [stop["value"] for stop in stops]
    return len(values) >= 2 and all(a < b for a, b in zip(values, values[1:]))


class MigrationTests(unittest.TestCase):
    def test_new_functions_only(self):
        for function in ("rebuild_supermarket_walk", "rebuild_gp_walk", "rebuild_broadband_gigabit",
                         "layer_walk_minutes", "layer_walk_legend"):
            self.assertIn(f"FUNCTION public.{function}(", MIGRATION)
        self.assertNotRegex(MIGRATION, r"(?i)\b(CREATE|ALTER|DROP)\s+TABLE\b")
        self.assertEqual(set(etl_layers_v5.BATCH_1) | set(etl_layers_v5.BATCH_2), set(etl_layers_v5.LAYERS))

    def test_every_metric_is_written_and_known_to_the_web(self):
        self.assertEqual(METRIC_IDS, ["supermarket-walk", "gp-walk", "broadband-gigabit"])
        for metric in METRIC_IDS:
            self.assertIn(f"'{metric}'", MIGRATION)
            self.assertIn(f'"{metric}"', CONTRACTS)

    def test_fixed_legends_are_strictly_ascending(self):
        legends = re.findall(r"'(\[\{\"value\".*?\])'::jsonb", MIGRATION, re.S)
        self.assertEqual(len(legends), 2)  # walking minutes, broadband
        for legend in legends:
            stops = json.loads(legend)
            self.assertTrue(strictly_ascending(stops), legend)
            self.assertTrue(stops[-1]["label"].endswith("+"), legend)

    def test_walk_minutes_match_the_api_estimate(self):
        # personal_places.estimate_minutes(km, "walk") = km * DETOUR / SPEED_KMH["walk"] * 60.
        self.assertIn("DETOUR = 1.3", PERSONAL_PLACES)
        self.assertIn('"walk": 4.8', PERSONAL_PLACES)
        self.assertIn("p_metres / 1000 * 1.3 / 4.8 * 60", MIGRATION)

    def test_supermarkets_as_the_nearest_criteria_count_them(self):
        supermarket = MIGRATION.split("FUNCTION public.rebuild_supermarket_walk", 1)[1].split("$$;", 1)[0]
        self.assertIn("""tags @> '{"shop": "supermarket"}'""", supermarket)
        self.assertIn("p_min_confidence real DEFAULT 0.6", MIGRATION)  # custom_criteria.MIN_CONFIDENCE
        self.assertIn("p_max_metres double precision DEFAULT 5000", MIGRATION)  # NEAREST_MAX_METRES


DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")
# Seeded areas lie off the coast, far from any real London place, so only the seeded ones are nearest.
SQUARE = "ST_Multi(ST_MakeEnvelope(%s, 49.9, %s, 49.91, 4326))"


@unittest.skipUnless(DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a PostGIS database with migrations 001-101")
class RebuildPostgisTests(unittest.TestCase):
    """Seeds made-up LSOAs (E0x9xxxxx codes), runs every batch 2 rebuild, then rolls back: nothing persists."""

    def test_layers(self):
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(DATABASE_URL, autocommit=False, row_factory=dict_row) as conn, conn.cursor() as cur:
            cur.execute(MIGRATION)
            cur.execute("INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,"
                        " attribution, transformation_version, geography_vintage, validation_status, caveats) VALUES"
                        " ('test-v5b', 'https://x', now(), '2099-03-01', repeat('0', 64), 'OGL-3.0', 'x', 'test', '2021',"
                        " 'passed', '{}')")
            areas = [("uk:lad:E09000001", "borough", None, -4.2, -4.1),
                     ("uk:msoa:E02900001", "msoa", "uk:lad:E09000001", -4.2, -4.1),
                     # LSOA 1 and 2 side by side (2 km apart), LSOA 3 about 70 km west of them.
                     ("uk:lsoa:E01900001", "lsoa", "uk:msoa:E02900001", -4.0, -3.97),
                     ("uk:lsoa:E01900002", "lsoa", "uk:msoa:E02900001", -3.97, -3.94),
                     ("uk:lsoa:E01900003", "lsoa", "uk:msoa:E02900001", -5.0, -4.97)]
            for gid, kind, parent, west, east in areas:
                cur.execute(f"INSERT INTO area_geography VALUES (%s, %s, %s, %s, %s, {SQUARE}) ON CONFLICT DO NOTHING",
                            (gid, kind, gid.rsplit(":", 1)[1], gid, parent, west, east))
            # A supermarket about 110 m north of LSOA 1's centre; an unconfirmed one (confidence 0.3) in LSOA 2.
            for pid, lon, lat, confidence in (("test:s1", -3.985, 49.906, 0.9), ("test:s2", -3.955, 49.905, 0.3)):
                cur.execute("INSERT INTO place (id, name, category, tags, confidence, sources, location, source_release_id)"
                            """ VALUES (%s, 'x', 'supermarket', '{"shop": "supermarket"}', %s, '{osm}',"""
                            " ST_SetSRID(ST_MakePoint(%s, %s), 4326), 'test-v5b')", (pid, confidence, lon, lat))
            for lsoa, metres in (("1", 400), ("2", 1200)):
                cur.execute("INSERT INTO area_health (geography_id, gp_nearest_m, gp_month, gp_release_id)"
                            " VALUES (%s, %s, '2099-01-01', 'test-v5b') ON CONFLICT (geography_id) DO UPDATE"
                            " SET gp_nearest_m = EXCLUDED.gp_nearest_m, gp_month = EXCLUDED.gp_month",
                            (f"uk:lsoa:E0190000{lsoa}", metres))
            for lsoa, premises, gigabit in (("1", 200, 190), ("2", 5, 5)):
                cur.execute("INSERT INTO area_broadband (geography_id, premises, gigabit_premises, source_release_id)"
                            " VALUES (%s, %s, %s, 'test-v5b') ON CONFLICT (geography_id) DO UPDATE"
                            " SET premises = EXCLUDED.premises, gigabit_premises = EXCLUDED.gigabit_premises",
                            (f"uk:lsoa:E0190000{lsoa}", premises, gigabit))

            built = {layer: etl_layers_v5.build(cur, layer) for layer in etl_layers_v5.BATCH_2}
            values = {(row["metric_id"], row["geography_id"]): row for row in cur.execute(
                "SELECT metric_id, geography_id, value, region_percentile, sample_count, quality::text, period::text"
                " FROM metric_value WHERE metric_id = ANY(%s) AND geography_id LIKE 'uk:lsoa:E01900%%'", (METRIC_IDS,))}
            definitions = {row["id"]: row for row in cur.execute(
                "SELECT id, carrier::text, unit, direction, definition, source_release_id FROM metric_definition"
                " WHERE id = ANY(%s)", (METRIC_IDS,))}
            conn.rollback()

        self.assertEqual(set(definitions), set(METRIC_IDS))
        for metric, row in definitions.items():
            self.assertTrue(strictly_ascending(row["definition"]["legend"]), (metric, row["definition"]["legend"]))
            self.assertTrue(row["source_release_id"].startswith("src-layer-"))
            self.assertEqual(built[metric][0], row["source_release_id"])
            self.assertIn("Licence", " ".join(row["definition"]["caveats"]))
            self.assertEqual(row["carrier"], "lsoa")

        near, far, none = (values[("supermarket-walk", f"uk:lsoa:E0190000{i}")] for i in "123")
        self.assertAlmostEqual(near["value"], 1.8, delta=0.2)  # ~111 m * 1.3 at 4.8 km/h
        self.assertTrue(30 < far["value"] < 40, far)  # the unconfirmed shop next door is skipped
        self.assertEqual((near["region_percentile"], near["quality"]), (0, "observed"))
        self.assertEqual((none["value"], none["quality"]), (None, "suppressed"))  # none within 5 km

        gp = values[("gp-walk", "uk:lsoa:E01900001")]
        self.assertEqual((gp["value"], gp["period"], gp["quality"]), (6.5, "2099-01-01", "observed"))
        self.assertEqual(values[("gp-walk", "uk:lsoa:E01900002")]["value"], 19.5)
        self.assertEqual(values[("gp-walk", "uk:lsoa:E01900003")]["quality"], "suppressed")
        self.assertIn("January 2099", definitions["gp-walk"]["definition"]["description"])

        broadband = values[("broadband-gigabit", "uk:lsoa:E01900001")]
        self.assertEqual((broadband["value"], broadband["sample_count"], broadband["quality"]), (95.0, 200, "observed"))
        small = values[("broadband-gigabit", "uk:lsoa:E01900002")]
        self.assertEqual((small["value"], small["sample_count"], small["quality"]), (None, 5, "suppressed"))
        self.assertEqual(values[("broadband-gigabit", "uk:lsoa:E01900003")]["sample_count"], 0)
        self.assertEqual(definitions["broadband-gigabit"]["direction"], "higher-is-better")


if __name__ == "__main__":
    unittest.main()
