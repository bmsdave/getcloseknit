"""Development pipeline (migration 085, deploy/tools/etl_pipeline.py): LDD permissions read from the
Planning London Datahub with no applicant or description, Opportunity Areas and Housing Zones read as
the GLA publishes them, and every level a sum of its LSOAs."""
import datetime
import json
import os
import sys
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / "tools"))
import etl_pipeline  # noqa: E402

FIXTURES = DEPLOY / "tests" / "fixtures" / "pipeline"
MIGRATION = (DEPLOY / "migrations" / "085-development-pipeline.sql").read_text()
TODAY = datetime.date(2026, 10, 18)


class SchemaTests(unittest.TestCase):
    def test_tables_function_and_metric(self):
        for table in ("development_pipeline", "opportunity_area", "area_pipeline", "area_opportunity"):
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table} (", MIGRATION)
        self.assertIn("FUNCTION public.rebuild_area_pipeline(p_period date, p_release_id text)", MIGRATION)
        self.assertIn("'pipeline-homes-per-1000'", MIGRATION)
        self.assertIn("INSERT INTO metric_definition", MIGRATION)
        self.assertIn("INSERT INTO metric_value", MIGRATION)

    def test_no_applicant_or_description_is_stored(self):
        table = MIGRATION.split("CREATE TABLE IF NOT EXISTS development_pipeline (", 1)[1].split(");", 1)[0]
        for word in ("applicant", "description", "address", "agent"):
            self.assertNotIn(word, table.lower())


class DatahubTests(unittest.TestCase):
    def setUp(self):
        self.hits = json.loads((FIXTURES / "datahub-hits.json").read_text())

    def test_kept_permissions_and_their_status(self):
        rows = [row for hit in self.hits if (row := etl_pipeline.pipeline_record(hit, TODAY))]
        self.assertEqual([(r["id"], r["status"], r["netHomes"]) for r in rows], [
            ("Southwark-25/AP/0001", "not-started", 120),
            ("Southwark-22/AP/0002", "under-construction", 40),
            ("Southwark-19/AP/0003", "completed", 30),
            ("Southwark-24/AP/0009", "not-started", 9),
        ])
        self.assertEqual(rows[0]["permittedOn"], "2025-03-12")
        self.assertIsNone(rows[0]["completedOn"])
        self.assertEqual(rows[2]["completedOn"], "2023-09-30")
        self.assertEqual(set(rows[0]), {"id", "status", "netHomes", "permittedOn", "completedOn", "lat", "lon"})

    def test_query_keeps_only_the_fields_we_store(self):
        query = etl_pipeline.pipeline_query("Southwark", "Commenced")
        self.assertNotIn("description", json.dumps(query["_source"]))
        self.assertIn("centroid", query["_source"])
        self.assertEqual(query["size"], etl_pipeline.PAGE_LIMIT)

    def test_old_completions_are_out_of_the_window(self):
        self.assertEqual(etl_pipeline.completed_since(TODAY), datetime.date(2021, 10, 18))


class OpportunityTests(unittest.TestCase):
    def test_opportunity_areas_from_the_shapefile(self):
        rows = list(etl_pipeline.opportunity_rows(str(FIXTURES / "Opportunity_Areas.zip")))
        self.assertEqual([(r[0], r[1], r[2]) for r in rows], [
            ("oa:canada-water", "Canada Water", "opportunity-area"), ("oa:woolwich", "Woolwich", "opportunity-area")])
        self.assertTrue(rows[0][3].startswith("https://www.london.gov.uk/"))
        self.assertEqual(rows[1][3], etl_pipeline.OA_PAGE)
        self.assertTrue(rows[0][4].startswith("MULTIPOLYGON(((535000.0 179000.0"))

    def test_housing_zones_skip_removed_ones(self):
        rows = list(etl_pipeline.housing_zone_rows(str(FIXTURES / "Housing_Zones.gpkg")))
        self.assertEqual([(r[0], r[1], r[2], r[3]) for r in rows],
                         [("hz:1", "Canada Water", "housing-zone", etl_pipeline.HZ_PAGE)])
        self.assertIsInstance(rows[0][4], bytes)


DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")


@unittest.skipUnless(DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a PostGIS database with area_geography")
class RollUpPostgisTests(unittest.TestCase):
    """Runs 085 and a rebuild inside one transaction, then rolls back: nothing persists."""

    def test_msoas_and_boroughs_are_sums_of_their_lsoas(self):
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(DATABASE_URL, autocommit=False, row_factory=dict_row) as connection:
            connection.execute(MIGRATION)
            connection.execute(
                """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
                     transformation_version, geography_vintage, validation_status, caveats)
                   VALUES ('src-test-pipeline', 'https://example.org', now(), '2026-10-18', repeat('0', 64), 'OGL-3.0',
                     'test', 'test', '2021', 'passed', '{}')""")
            # Three sites inside one London LSOA's interior point and one elsewhere.
            lsoa = connection.execute(
                """SELECT id, ST_Y(ST_PointOnSurface(geometry)) AS lat, ST_X(ST_PointOnSurface(geometry)) AS lon
                   FROM area_geography WHERE kind = 'lsoa' ORDER BY id LIMIT 1""").fetchone()
            other = connection.execute(
                """SELECT ST_Y(ST_PointOnSurface(geometry)) AS lat, ST_X(ST_PointOnSurface(geometry)) AS lon
                   FROM area_geography WHERE kind = 'lsoa' ORDER BY id DESC LIMIT 1""").fetchone()
            sites = [("a", "not-started", 100, lsoa), ("b", "under-construction", 40, lsoa),
                     ("c", "completed", 30, lsoa), ("d", "not-started", 7, other)]
            for ident, status, homes, point in sites:
                connection.execute(
                    """INSERT INTO development_pipeline (id, status, net_homes, permitted_on, completed_on, lat, lon,
                         source_release_id) VALUES (%s, %s, %s, '2025-01-01', %s, %s, %s, 'src-test-pipeline')""",
                    (ident, status, homes, "2024-01-01" if status == "completed" else None, point["lat"], point["lon"]))
            connection.execute("SELECT rebuild_area_pipeline('2026-10-01', 'src-test-pipeline')")
            totals = {row["kind"]: row for row in connection.execute(
                """SELECT g.kind::text AS kind, sum(p.homes_not_started) AS ns, sum(p.homes_under_construction) AS uc,
                          sum(p.homes_completed_5y) AS done
                   FROM area_pipeline p JOIN area_geography g ON g.id = p.geography_id GROUP BY g.kind""")}
            mismatched = connection.execute(
                """SELECT count(*) AS n FROM area_pipeline parent
                   JOIN (SELECT g.parent_id, sum(c.homes_not_started) AS ns, sum(c.homes_under_construction) AS uc
                         FROM area_pipeline c JOIN area_geography g ON g.id = c.geography_id
                         WHERE g.parent_id IS NOT NULL GROUP BY g.parent_id) kids ON kids.parent_id = parent.geography_id
                   WHERE kids.ns <> parent.homes_not_started OR kids.uc <> parent.homes_under_construction""").fetchone()
            mine = connection.execute("SELECT * FROM area_pipeline WHERE geography_id = %s", (lsoa["id"],)).fetchone()
            metric = connection.execute(
                "SELECT count(*) AS n, max(region_percentile) AS top FROM metric_value WHERE metric_id = 'pipeline-homes-per-1000'"
            ).fetchone()
            connection.rollback()
        for kind in ("lsoa", "msoa", "borough"):
            self.assertEqual((totals[kind]["ns"], totals[kind]["uc"], totals[kind]["done"]), (107, 40, 30), kind)
        self.assertEqual(mismatched["n"], 0)
        self.assertEqual((mine["homes_not_started"], mine["homes_under_construction"], mine["homes_completed_5y"]),
                         (100, 40, 30))
        self.assertGreaterEqual(mine["within_1km_not_started"], 100)
        self.assertGreater(metric["n"], 0)
        self.assertLessEqual(metric["top"], 100)


if __name__ == "__main__":
    unittest.main()
