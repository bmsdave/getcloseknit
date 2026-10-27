"""Layers v5 batch 1 (migration 100, deploy/tools/etl_layers_v5.py): Typical rent, Flood risk, Good schools
nearby and Student areas, built from tables already loaded; legends strictly ascending."""
import json
import os
import re
import sys
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / "tools"))
import etl_layers_v5  # noqa: E402

MIGRATION = (DEPLOY / "migrations" / "100-layers-v5-batch1.sql").read_text()
CONTRACTS = (DEPLOY.parent / "web" / "src" / "lib" / "contracts.ts").read_text()
# Batch 1 only; batch 2 (migration 101) is tests/test_layers_v5b.py.
METRIC_IDS = [metric for layer in etl_layers_v5.BATCH_1 for metric in etl_layers_v5.LAYERS[layer][1]]


def strictly_ascending(stops: list[dict]) -> bool:
    values = [stop["value"] for stop in stops]
    return len(values) >= 2 and all(a < b for a, b in zip(values, values[1:]))


class MigrationTests(unittest.TestCase):
    def test_new_functions_only(self):
        for function in ("rebuild_typical_rent", "rebuild_flood_risk", "rebuild_good_schools_nearby",
                         "rebuild_student_share", "layer_quantile_legend"):
            self.assertIn(f"FUNCTION public.{function}(", MIGRATION)
        self.assertNotRegex(MIGRATION, r"(?i)\b(CREATE|ALTER|DROP)\s+TABLE\b")

    def test_every_metric_is_written_and_known_to_the_web(self):
        for metric in METRIC_IDS:
            self.assertIn(f"'{metric}'", MIGRATION)
            self.assertIn(f'"{metric}"', CONTRACTS)

    def test_fixed_legends_are_strictly_ascending(self):
        legends = re.findall(r"'legend', '(\[.*?\])'::jsonb", MIGRATION, re.S)
        self.assertEqual(len(legends), 2)  # flood-risk, good schools
        for legend in legends:
            self.assertTrue(strictly_ascending(json.loads(legend)), legend)

    def test_student_share_is_descriptive(self):
        student = MIGRATION.split("FUNCTION public.rebuild_student_share", 1)[1]
        self.assertIn("never ranked or used to match areas", student)
        self.assertIn("NULL, c.residents", student)  # no London percentile


class DerivedReleaseTests(unittest.TestCase):
    INPUTS = [{"id": "src-a", "source_url": "https://a", "release_date": "2025-01-01", "sha256": "1" * 64,
               "licence": "OGL-3.0", "attribution": "A."},
              {"id": "src-b", "source_url": "https://b", "release_date": "2025-06-01", "sha256": "2" * 64,
               "licence": "OGL-3.0", "attribution": "B."}]

    def test_named_by_its_inputs(self):
        one = etl_layers_v5.derived_release("flood-risk", self.INPUTS)
        self.assertEqual(one, etl_layers_v5.derived_release("flood-risk", self.INPUTS))
        self.assertRegex(one["id"], r"^src-layer-flood-risk-[0-9a-f]{12}$")
        self.assertRegex(one["sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual((one["release_date"], one["licence"], one["attribution"]), ("2025-06-01", "OGL-3.0", "A. B."))
        other = etl_layers_v5.derived_release("flood-risk", [self.INPUTS[0]])
        self.assertNotEqual(one["id"], other["id"])

    def test_no_inputs_stops(self):
        with self.assertRaises(SystemExit):
            etl_layers_v5.derived_release("student-share", [])


DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")
SQUARE = "ST_Multi(ST_MakeEnvelope(%s, 51.5, %s, 51.51, 4326))"


@unittest.skipUnless(DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a PostGIS database with migrations 001-100")
class RebuildPostgisTests(unittest.TestCase):
    """Seeds made-up MSOA and LSOAs (E0x9xxxxx codes) under two real boroughs, runs every rebuild, then rolls back: nothing persists."""

    def test_layers(self):
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(DATABASE_URL, autocommit=False, row_factory=dict_row) as conn, conn.cursor() as cur:
            cur.execute(MIGRATION)
            cur.execute("DELETE FROM active_product_release")  # every rank counts (rolled back)
            cur.execute("INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,"
                        " attribution, transformation_version, geography_vintage, validation_status, caveats) VALUES"
                        " ('test-v5', 'https://x', now(), '2025-03-01', repeat('0', 64), 'OGL-3.0', 'x', 'test', '2021',"
                        " 'passed', '{}')")
            areas = [("uk:lad:E09000001", "borough", None, -0.2, -0.1), ("uk:lad:E09000002", "borough", None, -0.1, 0),
                     ("uk:msoa:E02900001", "msoa", "uk:lad:E09000001", -0.2, -0.1)]
            areas += [(f"uk:lsoa:E0190000{i}", "lsoa", "uk:msoa:E02900001", -0.2 + 0.03 * i, -0.17 + 0.03 * i)
                      for i in range(1, 4)]
            for gid, kind, parent, west, east in areas:
                cur.execute(f"INSERT INTO area_geography VALUES (%s, %s, %s, %s, %s, {SQUARE}) ON CONFLICT DO NOTHING",
                            (gid, kind, gid.rsplit(":", 1)[1], gid, parent, west, east))
            for code, rents in (("E09000001", (1500, 2000, 2600)), ("E09000002", (1800, 2400, 3100))):
                for bedrooms, rent in zip(("1 bedroom", "2 bedrooms", "3 bedrooms"), rents):
                    cur.execute("INSERT INTO borough_rent VALUES (%s, '2099-01-01', %s, %s, NULL, 'test-v5')",
                                (code, bedrooms, rent))
            # 12 homes in LSOA 1 (3 at medium or high risk), 4 in LSOA 2 (too few), none in LSOA 3.
            for n, (lsoa, river, surface) in enumerate([("1", 1, 1)] * 9 + [("1", 3, 1), ("1", 1, 4), ("1", 4, 2)]
                                                       + [("2", 4, 4)] * 4):
                uprn = f"99900{n:04d}"
                cur.execute("INSERT INTO property (uprn, address, geography_id, location) VALUES"
                            " (%s, 'x', %s, ST_SetSRID(ST_MakePoint(-0.15, 51.505), 4326))", (uprn, f"uk:lsoa:E0190000{lsoa}"))
                cur.execute("INSERT INTO dwelling_flood VALUES (%s, %s, %s, 'test-v5')", (uprn, river, surface))
            # Two top-25% primaries inside LSOA 1, one primary outside the top 25%, one top secondary far away.
            for urn, phase, lon, top in (("990001", "primary", -0.155, 10), ("990002", "primary", -0.152, 25),
                                         ("990003", "primary", -0.151, 60), ("990004", "secondary", 0.5, 5)):
                cur.execute("INSERT INTO school (urn, school_id, name, phase, attributes, location, source_release_id)"
                            " VALUES (%s, 'uk:school:' || %s, 'x', %s, '{}', ST_SetSRID(ST_MakePoint(%s, 51.505), 4326),"
                            " 'test-v5')", (urn, urn, phase, lon))
                cur.execute("INSERT INTO school_national_rank VALUES (%s, %s, '2098/99', %s, 'm', 1, NULL, %s, 100, %s,"
                            " 'test-v5')", (urn, phase, urn, top, top))
            cur.execute("INSERT INTO census_category (topic, category, label, position) VALUES"
                        " ('economic-activity', 'student', 'Full-time student', 4),"
                        " ('economic-activity', 'employee', 'Employee', 1) ON CONFLICT DO NOTHING")
            for lsoa, students, employees in (("1", 30, 70), ("2", 5, 95)):
                for category, count in (("student", students), ("employee", employees)):
                    cur.execute("INSERT INTO area_census_count VALUES (%s, 'economic-activity', %s, %s, 'test-v5')"
                                " ON CONFLICT (geography_id, topic, category) DO UPDATE SET count = EXCLUDED.count",
                                (f"uk:lsoa:E0190000{lsoa}", category, count))

            built = {layer: etl_layers_v5.build(cur, layer) for layer in etl_layers_v5.BATCH_1}
            values = {(row["metric_id"], row["geography_id"]): row for row in cur.execute(
                "SELECT metric_id, geography_id, value, region_percentile, sample_count, quality::text, period::text"
                " FROM metric_value WHERE metric_id = ANY(%s) AND (geography_id LIKE '%%E0_9000%%' OR geography_id IN ('uk:lad:E09000001', 'uk:lad:E09000002'))", (METRIC_IDS,))}
            definitions = {row["id"]: row for row in cur.execute(
                "SELECT id, carrier::text, unit, direction, definition, source_release_id FROM metric_definition"
                " WHERE id = ANY(%s)", (METRIC_IDS,))}
            conn.rollback()

        self.assertEqual(set(definitions), set(METRIC_IDS))
        for metric, row in definitions.items():
            self.assertTrue(strictly_ascending(row["definition"]["legend"]), (metric, row["definition"]["legend"]))
            self.assertTrue(row["source_release_id"].startswith("src-layer-"))
            self.assertIn("Licence", " ".join(row["definition"]["caveats"]))
        self.assertEqual(built["flood-risk"][0], definitions["flood-risk"]["source_release_id"])

        rent = values[("typical-rent", "uk:lad:E09000002")]
        self.assertEqual((rent["value"], rent["region_percentile"], rent["period"]), (2400, 100, "2099-01-01"))
        self.assertEqual(values[("typical-rent-3-bed", "uk:lad:E09000001")]["region_percentile"], 0)
        self.assertEqual(definitions["typical-rent"]["carrier"], "borough")
        self.assertEqual(definitions["typical-rent"]["definition"]["legend"][-1]["label"], "£2,400+")

        flood = values[("flood-risk", "uk:lsoa:E01900001")]
        self.assertEqual((flood["value"], flood["sample_count"], flood["quality"]), (25.0, 12, "observed"))
        self.assertEqual(values[("flood-risk", "uk:lsoa:E01900002")]["quality"], "suppressed")
        self.assertEqual(values[("flood-risk", "uk:lsoa:E01900003")]["sample_count"], 0)

        self.assertEqual(values[("good-schools-nearby", "uk:lsoa:E01900001")]["value"], 2)
        self.assertEqual(values[("good-schools-nearby-secondary", "uk:lsoa:E01900001")]["value"], 0)
        self.assertEqual(values[("good-schools-nearby", "uk:lsoa:E01900001")]["period"], "2099-07-01")
        self.assertIn("2098/99", definitions["good-schools-nearby"]["definition"]["description"])

        students = values[("student-share", "uk:lsoa:E01900001")]
        self.assertEqual((students["value"], students["region_percentile"], students["sample_count"]), (30.0, None, 100))
        self.assertEqual(values[("student-share", "uk:lsoa:E01900003")]["quality"], "suppressed")


if __name__ == "__main__":
    unittest.main()
