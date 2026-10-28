"""The October Price Paid refresh on the seeded PostGIS (deploy/tests/postgis-fixture.sh): what must never happen again.

The London refresh (etl_price_release.py, then etl_sales.py load) deleted whole tables, so every English price
outside London went null; its release went live at once, before release_build and with no coverage check.
Migrations 133 (London-scoped rebuilds) and 134 (release guards) are checked here on the real SQL. Every test runs
in one transaction that is rolled back, so the fixture the other tests read is left as it was.
"""
import os
import sys
import unittest
from pathlib import Path

TEST_DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")
TOOLS = Path(__file__).resolve().parents[2] / "deploy" / "tools"
sys.path.insert(0, str(TOOLS))

import etl_price_release  # noqa: E402

from area_api import repository  # noqa: E402

LONDON_SALES = "src-hmlr-pp-sales-2026-06"
ENGLAND_SALES = "src-hmlr-pp-sales-2026-06-england"
EPPING_LSOA, EPPING_MSOA, EPPING_LAD = "uk:lsoa:E01021700", "uk:msoa:E02004541", "uk:lad:E07000072"
TYPICAL = ("typical-price", "typical-price-flat", "typical-price-terraced", "typical-price-semi",
           "typical-price-detached")
SHAPE = "ST_Multi(ST_MakeEnvelope(0.10, 51.68, 0.12, 51.70, 4326))"

# England's rows of every table the London chain rebuilds, as the England prices bundle leaves them.
ENGLAND_ROWS = f"""
INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
  transformation_version, geography_vintage, validation_status, caveats)
VALUES ('{LONDON_SALES}', 'https://example.test/pp', now(), '2026-06-30', repeat('1', 64), 'OGL-3.0', 'HMLR',
        'test', '2021', 'passed', ARRAY[]::text[]),
       ('{ENGLAND_SALES}', 'https://example.test/pp', now(), '2026-06-30', repeat('2', 64), 'OGL-3.0', 'HMLR',
        'test', '2021', 'passed', ARRAY[]::text[]);
INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
SELECT m, 'lsoa', '£', 'higher-is-more', '{{}}'::jsonb, '{ENGLAND_SALES}' FROM unnest(ARRAY{list(TYPICAL)}) m
ON CONFLICT (id) DO NOTHING;
INSERT INTO metric_value (geography_id, metric_id, period, value, sample_count, quality, source_release_id)
SELECT '{EPPING_LSOA}', m, '2026-06-01', 350000, 25, 'observed', '{ENGLAND_SALES}' FROM unnest(ARRAY{list(TYPICAL)}) m;
INSERT INTO area_price_band (geography_id, property_type, window_start, period, sales, p10, p25, p50, p75, p90,
  source_release_id)
VALUES ('{EPPING_LSOA}', '*', '2023-01-01', '2026-06-01', 25, 200000, 280000, 350000, 420000, 500000, '{ENGLAND_SALES}');
INSERT INTO area_price_year (geography_id, property_type, year, sales, p50, source_release_id)
VALUES ('{EPPING_LSOA}', 'F', 2025, 10, 240000, '{ENGLAND_SALES}');
INSERT INTO area_price_growth (geography_id, period, growth_1y) VALUES ('{EPPING_LSOA}', '2026-06-01', 2.5)
ON CONFLICT (geography_id) DO UPDATE SET growth_1y = 2.5;
INSERT INTO area_market_depth (geography_id, period_end, sales_12m, dwellings, dwellings_sold_12m, tenure_known_12m,
  new_build_sample_36m, resale_sample_36m, source_release_id)
VALUES ('{EPPING_MSOA}', '2026-06-30', 30, 500, 30, 30, 1, 29, '{ENGLAND_SALES}');
INSERT INTO postcode_sector (code, slug, district, name, borough_id, postcode_count, geometry, label_point)
VALUES ('CM16 5', 'CM16-5', 'CM16', 'Epping Forest 001', '{EPPING_LAD}', 100, {SHAPE},
        ST_SetSRID(ST_MakePoint(0.11, 51.69), 4326));
INSERT INTO postcode_district (code, slug, name, borough_id, postcode_count, geometry, label_point)
VALUES ('CM16', 'CM16', 'Epping', '{EPPING_LAD}', 100, {SHAPE}, ST_SetSRID(ST_MakePoint(0.11, 51.69), 4326));
INSERT INTO zone_ppm_distribution (zone_kind, zone_code, period_end, sales, p09, p25, p50, p75, p91, bucket_edges,
  bucket_counts, source_release_id)
VALUES ('sector', 'CM16 5', '2026-06-30', 25, 3000, 3500, 4000, 4500, 5000,
        ARRAY(SELECT 2500 + 150 * i FROM generate_series(0, 20) i), array_fill(1, ARRAY[20]), '{ENGLAND_SALES}');
INSERT INTO zone_price_index (zone_kind, zone_code, "group", year, sales, median_ppm, source_release_id)
VALUES ('sector', 'CM16 5', 'all', 2025, 25, 4000, '{ENGLAND_SALES}');
INSERT INTO zone_street (sector, street_name, sales_60m, source_release_id)
VALUES ('CM16 5', 'High Street', 6, '{ENGLAND_SALES}');
INSERT INTO address (id, display_address, postcode, geography_id, source_release_id)
VALUES ('uk:addr:eeeeeeeeee01', '1 High Street, Epping, CM16 5AA', 'CM16 5AA', '{EPPING_LSOA}', '{ENGLAND_SALES}');
INSERT INTO property (uprn, address, address_id, geography_id, location, source_release_id)
VALUES ('990000000001', '1 High Street, Epping', 'uk:addr:eeeeeeeeee01', '{EPPING_LSOA}',
        ST_SetSRID(ST_MakePoint(0.11, 51.69), 4326), '{ENGLAND_SALES}');
INSERT INTO property_stock_value (uprn, period, sale_period, completion_date, nominal_price, floor_area_square_metres,
  sale_price_per_square_metre, index_carrier, index_geography_id, index_at_sale, index_latest,
  restated_price_per_square_metre, restated_value, confidence, source_release_id)
VALUES ('990000000001', '2026-06-01', '2020-01-01', '2020-01-15', 300000, 80, 3750, 'lsoa', '{EPPING_LSOA}', 3500,
        4000, 4285.71, 342857, 'medium', '{ENGLAND_SALES}');
INSERT INTO property_sale_band (uprn, band, source_release_id) VALUES ('990000000001', 3, '{ENGLAND_SALES}');
INSERT INTO sale_pin (address_id, uprn, geography_id, geom, location_precision, sale_count, last_date, last_price,
  property_type, new_build, tenure, ppd_category, source_release_id)
VALUES ('uk:addr:eeeeeeeeee01', '990000000001', '{EPPING_LSOA}', ST_Transform(ST_SetSRID(ST_MakePoint(0.11, 51.69),
        4326), 3857), 'uprn', 1, '2020-01-15', 300000, 'T', false, 'F', 'A', '{ENGLAND_SALES}');
"""

# Each table's rows outside London (the England bundle's own), as text so any change shows.
OUTSIDE = "NOT EXISTS (SELECT 1 FROM area_region r WHERE r.area_id = {col} AND r.region_code = 'E12000007')"
SNAPSHOTS = {
    "metric_value": f"SELECT t::text FROM metric_value t WHERE metric_id = ANY(%(metrics)s) "
                    f"AND {OUTSIDE.format(col='t.geography_id')}",
    "area_price_band": f"SELECT t::text FROM area_price_band t WHERE {OUTSIDE.format(col='t.geography_id')}",
    "area_price_year": f"SELECT t::text FROM area_price_year t WHERE {OUTSIDE.format(col='t.geography_id')}",
    "area_price_growth": f"SELECT t::text FROM area_price_growth t WHERE {OUTSIDE.format(col='t.geography_id')}",
    "area_market_depth": f"SELECT t::text FROM area_market_depth t WHERE {OUTSIDE.format(col='t.geography_id')}",
    "postcode_sector": "SELECT code FROM postcode_sector WHERE borough_id = %(lad)s",
    "postcode_district": "SELECT code FROM postcode_district WHERE borough_id = %(lad)s",
    "zone_ppm_distribution": "SELECT t::text FROM zone_ppm_distribution t WHERE source_release_id = %(england)s",
    "zone_price_index": "SELECT t::text FROM zone_price_index t WHERE source_release_id = %(england)s",
    "zone_street": "SELECT t::text FROM zone_street t WHERE source_release_id = %(england)s",
    "property_stock_value": "SELECT t::text FROM property_stock_value t WHERE uprn = '990000000001'",
    "property_sale_band": "SELECT t::text FROM property_sale_band t WHERE uprn = '990000000001'",
    "sale_pin": "SELECT address_id FROM sale_pin WHERE address_id = 'uk:addr:eeeeeeeeee01'",
}


@unittest.skipUnless(TEST_DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to the seeded PostGIS fixture")
class RefreshGuardTestCase(unittest.TestCase):
    def setUp(self):
        import psycopg
        from psycopg.rows import dict_row

        self.connection = psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row)
        self.addCleanup(self.connection.close)
        self.addCleanup(self.connection.rollback)
        if not self.connection.execute(
                "SELECT 1 FROM active_product_release WHERE release_id = 'fixture-2026-06'").fetchone():
            raise unittest.SkipTest("not the seeded fixture (deploy/tests/postgis-fixture.sh)")
        self.sql = self.connection.execute

    def value(self, query, params=()):
        return next(iter(self.sql(query, params).fetchone().values()))

    def stage(self, release_id, members_sql="SELECT source_release_id FROM product_release_member "
                                            "WHERE release_id = 'fixture-2026-06'"):
        self.sql("""INSERT INTO product_release (id, geography_vintage, transformation_versions, assets,
                      validation_status, validation_record)
                    SELECT %s, geography_vintage, transformation_versions, assets, 'passed',
                           jsonb_build_object('supersedes', id)
                    FROM product_release WHERE id = 'fixture-2026-06'""", (release_id,))
        self.sql(f"INSERT INTO product_release_member SELECT %s, s FROM ({members_sql}) m(s)", (release_id,))


class LondonScopedRebuildTests(RefreshGuardTestCase):
    def snapshot(self):
        params = {"metrics": [*TYPICAL, "price-per-square-metre", "stock-value-per-square-metre"],
                  "lad": EPPING_LAD, "england": ENGLAND_SALES}
        return {table: sorted(row["t"] if "t" in row else next(iter(row.values()))
                              for row in self.sql(query, params))
                for table, query in SNAPSHOTS.items()}

    def test_a_london_refresh_leaves_every_england_row_alone(self):
        # address.longitude/latitude come with the property load (property-load.sql), not the migrations.
        self.sql("ALTER TABLE address ADD COLUMN IF NOT EXISTS longitude double precision, "
                 "ADD COLUMN IF NOT EXISTS latitude double precision")
        self.sql(ENGLAND_ROWS)
        before = self.snapshot()
        self.assertTrue(all(before.values()), {table: rows for table, rows in before.items() if not rows})

        # etl_price_release.py's own writes, then every rebuild of the etl_sales.py load order.
        self.sql(etl_price_release.DELETE_SQL, (etl_price_release.METRIC,))
        for step in etl_price_release.INDEX_REBUILDS:
            self.sql(f"SELECT {step}", (LONDON_SALES,) if "%s" in step else ())

        self.assertEqual(self.snapshot(), before)
        # No suppressed (null) typical price is written for an English LSOA either.
        self.assertEqual(self.value("SELECT count(*) FROM metric_value WHERE metric_id = 'typical-price' "
                                    "AND geography_id LIKE 'uk:lsoa:E0102170%%' AND value IS NULL"), 0)
        # London's own rows are still replaced: Camden's £/m² went with the index delete.
        self.assertEqual(self.value("SELECT count(*) FROM metric_value WHERE metric_id = 'price-per-square-metre' "
                                    "AND geography_id LIKE 'uk:lsoa:E010009%%'"), 0)
        self.assertGreater(self.value("SELECT count(*) FROM metric_value WHERE metric_id = 'price-per-square-metre' "
                                      "AND geography_id LIKE 'uk:lsoa:E0102170%%'"), 0)

    def test_the_index_is_built_for_london_areas_only(self):
        areas = [row["id"] for row in self.sql(etl_price_release.GEOGRAPHY_SQL)]
        self.assertIn("uk:lsoa:E01000900", areas)
        self.assertIn("uk:lad:E09000007", areas)
        self.assertFalse([area for area in areas if "E0102170" in area or "E07000072" in area or "E0200454" in area])


class CoverageGuardTests(RefreshGuardTestCase):
    def test_a_region_losing_its_values_is_refused(self):
        import psycopg

        self.stage("rel-test-drop")
        # The incident's shape: every value of a key layer gone outside London.
        self.sql("DELETE FROM metric_value WHERE metric_id = 'crime' AND geography_id LIKE 'uk:lsoa:E0102170%%'")
        self.sql("SAVEPOINT guard")
        with self.assertRaises(psycopg.errors.RaiseException) as refused:
            self.sql("SELECT activate_product_release('rel-test-drop')")
        message = str(refused.exception)
        self.assertIn("CLOSE_KNIT_COVERAGE_DROP_THRESHOLD_PERCENT", message)
        self.assertIn("crime in E12000006 (6 -> 0", message)
        self.sql("ROLLBACK TO SAVEPOINT guard")
        self.assertEqual(self.value("SELECT release_id FROM active_product_release"), "fixture-2026-06")

        # The override, as release_guard.set_threshold passes it: the drop is accepted and recorded.
        self.sql("SELECT set_config('close_knit.coverage_drop_threshold_percent', '100', true)")
        self.sql("SELECT activate_product_release('rel-test-drop')")
        self.assertEqual(self.value("SELECT release_id FROM active_product_release"), "rel-test-drop")
        guard = self.value("SELECT validation_record -> 'coverage_guard' FROM product_release "
                           "WHERE id = 'rel-test-drop'")
        self.assertEqual(guard["baseline_release"], "fixture-2026-06")
        self.assertEqual(guard["threshold_percent"], 100)
        self.assertEqual(guard["coverage"]["crime"], {"E12000007": 30})

    def test_a_small_drop_passes_and_its_numbers_are_recorded(self):
        self.stage("rel-test-same")
        self.sql("SELECT activate_product_release('rel-test-same')")
        guard = self.value("SELECT validation_record -> 'coverage_guard' FROM product_release "
                           "WHERE id = 'rel-test-same'")
        self.assertTrue(guard["ok"])
        self.assertEqual(guard["coverage"]["crime"], {"E12000006": 6, "E12000007": 30})
        self.assertEqual(guard["coverage"]["school"], {"E12000006": 1, "E12000007": 2})

    def test_only_the_guard_record_of_a_release_may_change(self):
        import psycopg

        self.sql("SAVEPOINT s")
        with self.assertRaises(psycopg.errors.RaiseException):
            self.sql("UPDATE product_release SET validation_status = 'failed' WHERE id = 'fixture-2026-06'")
        self.sql("ROLLBACK TO SAVEPOINT s")
        with self.assertRaises(psycopg.errors.RaiseException):
            self.sql("""UPDATE product_release SET validation_record = validation_record || '{"rows": 1}'
                        WHERE id = 'fixture-2026-06'""")


class StageOnlyTests(RefreshGuardTestCase):
    def test_activation_is_refused_while_a_run_stages(self):
        import psycopg

        self.stage("rel-test-staged")
        self.sql("SELECT set_config('close_knit.stage_only', 'on', true)")
        with self.assertRaises(psycopg.errors.RaiseException) as refused:
            self.sql("SELECT activate_product_release('rel-test-staged')")
        self.assertIn("deferred", str(refused.exception))

    def test_a_bundle_stages_without_activating(self):
        import release_bundle

        self.sql("""INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                      attribution, transformation_version, geography_vintage, validation_status, caveats)
                    SELECT 'fixture-noise-2027', source_url, now(), '2027-06-30', sha256, licence, attribution,
                           transformation_version, geography_vintage, 'passed', caveats
                    FROM source_release WHERE id = 'fixture-noise-2026'""")
        self.sql("SELECT set_config('close_knit.stage_only', 'on', true)")
        self.sql(release_bundle.stage_sql("test", ["fixture-noise-2027"], ["fixture-noise-"]))
        self.assertEqual(self.value("SELECT release_id FROM active_product_release"), "fixture-2026-06")
        staged = self.value("SELECT id FROM product_release WHERE id LIKE 'rel-%%-test'")
        members = {row["source_release_id"] for row in self.sql(
            "SELECT source_release_id FROM product_release_member WHERE release_id = %s", (staged,))}
        self.assertIn("fixture-noise-2027", members)
        self.assertNotIn("fixture-noise-2026", members)

    def test_release_build_reads_the_staged_release_as_active(self):
        from psycopg import sql

        self.stage("rel-test-build")
        self.sql(sql.SQL(repository.AS_ACTIVE_SQL).format(release=sql.Literal("rel-test-build")))
        row = self.sql("SELECT release_id, previous_release_id FROM active_product_release").fetchone()
        self.assertEqual(row, {"release_id": "rel-test-build", "previous_release_id": "fixture-2026-06"})
        self.assertEqual(self.value("SELECT release_id FROM public.active_product_release"), "fixture-2026-06")


class DataHealthTests(RefreshGuardTestCase):
    def checks(self, live=True):
        return {row["check_name"]: row for row in self.sql("SELECT * FROM release_data_health(%s)", (live,))}

    def test_typical_price_coverage_per_english_region(self):
        self.assertFalse(self.checks()["typical-price-coverage"]["ok"])
        self.sql("""INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
                    VALUES ('typical-price', 'lsoa', '£', 'higher-is-more', '{}', 'fixture-hmlr-2026-06')
                    ON CONFLICT (id) DO NOTHING""")
        self.sql("""INSERT INTO metric_value (geography_id, metric_id, period, value, quality, source_release_id)
                    SELECT id, 'typical-price', '2026-06-01', 400000, 'observed', 'fixture-hmlr-2026-06'
                    FROM area_geography WHERE kind = 'lsoa'""")
        self.assertTrue(self.checks()["typical-price-coverage"]["ok"], self.checks())
        # One Epping Forest LSOA of six gone: 83% < 95%.
        self.sql("DELETE FROM metric_value WHERE metric_id = 'typical-price' AND geography_id = %s", (EPPING_LSOA,))
        check = self.checks()["typical-price-coverage"]
        self.assertFalse(check["ok"])
        self.assertIn("East of England 5/6", check["detail"])

    def test_health_reads_the_coverage_recorded_at_activation(self):
        """The default (the /health path) reads coverage_guard, never metric_value: a live count timed out on prod."""
        self.sql("""UPDATE product_release SET validation_record = validation_record || jsonb_build_object(
                        'coverage_guard', jsonb_build_object('coverage', jsonb_build_object('typical-price',
                            (SELECT jsonb_object_agg(r.official_code, n) FROM (
                                SELECT r.official_code, count(*) AS n FROM area_geography g
                                JOIN area_geography r ON r.id = g.region_id
                                WHERE g.kind = 'lsoa' AND r.kind = 'region' GROUP BY r.official_code) r))))
                    WHERE id = 'fixture-2026-06'""")
        self.assertTrue(self.checks(live=False)["typical-price-coverage"]["ok"], self.checks(live=False))
        self.assertFalse(self.checks(live=True)["typical-price-coverage"]["ok"])

    def test_the_active_release_needs_its_tier_0_1_build(self):
        self.sql("DELETE FROM release_build_run")
        check = self.checks()["release-artifacts"]
        self.assertFalse(check["ok"])
        self.assertIn("no tier-0/1 build", check["detail"])
        self.sql("""INSERT INTO release_artifact (release_id, build, kind, key, body)
                    SELECT 'fixture-2026-06', 'payload-v1', 'refresh-guard-test', 'k' || i, '\\x00'
                    FROM generate_series(1, 3) i""")
        built = self.value(repository_record_run(), {"release": "fixture-2026-06", "tiers": [0, 1], "tasks": 3,
                                                     "done": 3, "failed": 0, "skipped": 0})
        self.assertTrue(self.checks()["release-artifacts"]["ok"], self.checks())
        # Rows gone after the build (the October release had 157 of ~376k): fewer than the build left.
        self.sql("DELETE FROM release_artifact WHERE kind = 'refresh-guard-test' AND key = 'k1'")
        check = self.checks()["release-artifacts"]
        self.assertFalse(check["ok"])
        self.assertIn(f"has {built - 1} artifacts, fewer than the {built}", check["detail"])


def repository_record_run():
    from area_api import release_build

    return release_build.RECORD_RUN_SQL


if __name__ == "__main__":
    unittest.main()
