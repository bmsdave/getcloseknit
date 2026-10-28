"""B3 (#153): the sales release names EPC-linkage health and refuses to
activate above the zero-floor-block threshold.

stage_release talks to Postgres only through psycopg, imported inside the
function, so a fake module is injected before the call.
"""

import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import etl_sales  # noqa: E402  (imports psycopg only inside stage_release)


class FakeCursor:
    def __init__(self, script):
        self.script = script
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, query, params=None):
        self.calls.append((query, params))
        return self

    def fetchone(self):
        query = self.calls[-1][0]
        return self.script["one"](query)

    def fetchall(self):
        query = self.calls[-1][0]
        return self.script["all"](query)


class FakeConnection:
    def __init__(self, script):
        self.cursor_obj = FakeCursor(script)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return self.cursor_obj


def _install_fake_psycopg(script):
    created = []
    fake = types.ModuleType("psycopg")
    rows = types.ModuleType("psycopg.rows")
    rows.dict_row = object()
    fake.rows = rows

    def connect(*args, **kwargs):
        conn = FakeConnection(script)
        created.append(conn)
        return conn

    fake.connect = connect
    sys.modules["psycopg"] = fake
    sys.modules["psycopg.rows"] = rows
    return created


def _script(zero_floor=(), single_area=(), sales=100, with_floor=60):
    def one(query):
        if "DISTINCT source_release_id" in query:
            return {"source_release_id": "src-hmlr-pp-sales-2026-07"}
        if "(SELECT count(*) FROM sale) AS sales" in query:
            return {"sales": sales, "category_b": 5, "pins": 90,
                    "pins_at_uprn": 40, "stock_values": 80,
                    "growth_areas": 10, "street_blocks": 20}
        if "FILTER (WHERE floor_area_square_metres IS NOT NULL)" in query:
            return {"sales": sales, "with_floor": with_floor}
        if "FROM active_product_release" in query:
            return {"release_id": "rel-prev"}
        if "FROM product_release WHERE" in query:
            return {"geography_vintage": "2021", "transformation_versions": {},
                    "assets": ["tiles/sale_tile"]}
        raise AssertionError(f"unexpected fetchone query: {query[:80]}")

    def all(query):
        if "count(DISTINCT s.floor_area_square_metres) = 1" in query:
            return list(single_area)
        if "count(s.floor_area_square_metres) = 0" in query:
            return list(zero_floor)
        raise AssertionError(f"unexpected fetchall query: {query[:80]}")

    return {"one": one, "all": all}


def _run(script):
    created = _install_fake_psycopg(script)
    etl_sales.stage_release("postgresql://fake/db")
    return etl_sales, created[0].cursor_obj


def _release_insert(cursor):
    for query, params in cursor.calls:
        if query.startswith("INSERT INTO product_release "):
            return params
    raise AssertionError("no product_release insert recorded")


def _called(cursor, fragment):
    return any(fragment in query for query, _ in cursor.calls)


class ReleaseValidationTests(unittest.TestCase):
    def test_validation_record_names_zero_floor_buildings(self):
        zero_floor = [
            {"building_key": "bk1", "example": "Apartment 10, Duval House",
             "postcode": "SW11 2FR", "sales": 97},
            {"building_key": "bk2", "example": "Apartment 4105, 10 Marsh Wall",
             "postcode": "E14 9PG", "sales": 50},
        ]
        etl_sales, cursor = _run(_script(zero_floor=zero_floor))

        params = _release_insert(cursor)
        record = json.loads(params[5])
        linkage = record["epc_linkage"]
        self.assertEqual(linkage["buildings_ge20_sales_zero_floor"], 2)
        self.assertEqual(linkage["buildings_ge20_sales_zero_floor_examples"][0]["sales"], 97)
        self.assertEqual(linkage["buildings_ge20_sales_zero_floor_examples"][0]["postcode"],
                         "SW11 2FR")
        self.assertAlmostEqual(linkage["floor_area_link_rate"], 0.6)
        # below the threshold: the release still activates
        self.assertEqual(params[4], "passed")
        self.assertTrue(_called(cursor, "activate_product_release"))

    def test_refuses_activation_above_the_threshold(self):
        zero_floor = [
            {"building_key": f"bk{i}", "example": f"Block {i}",
             "postcode": "E14 9PG", "sales": 20 + i}
            for i in range(etl_sales.ZERO_FLOOR_BUILDING_FAIL_THRESHOLD + 1)
        ]
        _, cursor = _run(_script(zero_floor=zero_floor))

        params = _release_insert(cursor)
        self.assertEqual(params[4], "failed")
        record = json.loads(params[5])
        self.assertEqual(record["epc_linkage"]["buildings_ge20_sales_zero_floor"],
                         etl_sales.ZERO_FLOOR_BUILDING_FAIL_THRESHOLD + 1)
        self.assertFalse(_called(cursor, "INSERT INTO product_release_member"))
        self.assertFalse(_called(cursor, "activate_product_release"))

    def test_env_override_raises_the_threshold_for_an_accepted_count(self):
        count = etl_sales.ZERO_FLOOR_BUILDING_FAIL_THRESHOLD + 2
        zero_floor = [{"building_key": f"bk{i}", "example": f"Block {i}", "postcode": "E14 9PG", "sales": 20 + i}
                      for i in range(count)]
        with mock.patch.dict(os.environ, {etl_sales.ZERO_FLOOR_THRESHOLD_ENV: str(count)}):
            _, cursor = _run(_script(zero_floor=zero_floor))

        params = _release_insert(cursor)
        self.assertEqual(params[4], "passed")
        self.assertEqual(json.loads(params[5])["epc_linkage"]["zero_floor_fail_threshold"], count)
        self.assertTrue(_called(cursor, "activate_product_release"))

    def test_single_shared_floor_area_is_named_not_failed(self):
        single_area = [
            {"building_key": "bk9", "example": "Apartment 6901, 10 Marsh Wall",
             "sales": 12, "area": 335.0},
        ]
        _, cursor = _run(_script(single_area=single_area))

        params = _release_insert(cursor)
        record = json.loads(params[5])
        linkage = record["epc_linkage"]
        self.assertEqual(linkage["buildings_single_floor_area"], 1)
        self.assertEqual(
            linkage["buildings_single_floor_area_examples"][0]["floor_area_square_metres"],
            335.0)
        # a shared area warns; it does not fail the release on its own
        self.assertEqual(params[4], "passed")
        self.assertTrue(_called(cursor, "activate_product_release"))

    def test_inside_an_etl_run_the_release_is_staged_not_activated(self):
        # The October refresh: `release` activated at once, before the England bundle and release_build ran.
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_STAGE_ONLY": "1"}):
            _, cursor = _run(_script())

        self.assertEqual(_release_insert(cursor)[4], "passed")
        self.assertTrue(_called(cursor, "INSERT INTO product_release_member"))
        self.assertFalse(_called(cursor, "activate_product_release"))

    def test_the_coverage_threshold_reaches_the_guard(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_COVERAGE_DROP_THRESHOLD_PERCENT": "12"}):
            _, cursor = _run(_script())

        calls = [(query, params) for query, params in cursor.calls if "set_config" in query]
        self.assertEqual(calls[0][1], ("close_knit.coverage_drop_threshold_percent", "12"))
        self.assertTrue(_called(cursor, "activate_product_release"))

    def test_clean_release_still_activates(self):
        _, cursor = _run(_script())

        params = _release_insert(cursor)
        record = json.loads(params[5])
        self.assertEqual(record["epc_linkage"]["buildings_ge20_sales_zero_floor"], 0)
        self.assertEqual(record["epc_linkage"]["buildings_single_floor_area"], 0)
        self.assertEqual(params[4], "passed")
        self.assertTrue(_called(cursor, "activate_product_release"))


if __name__ == "__main__":
    unittest.main()
