"""Derived data kept per release in release_artifact (area_api/release_store.py, migration 128) and the release
build's plan (area_api/release_build.py)."""
import decimal
import threading
import types
import unittest
from unittest import mock

from area_api import custom_criteria, release_build, release_store
from area_api.evidence import EvidenceReader

from test_production_evidence import make_reader, seed_production_fixture


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(release_store.use_memory())

    def test_a_value_round_trips_exactly_as_built(self):
        value = {"values": [{"value": decimal.Decimal("1.5")}], "ids": ("a", "b"), "seen": frozenset({"x"})}
        release_store.put(None, "rel-1", ("pack", "crime", "2026-08"), value, payload=True)
        self.assertEqual(release_store.get(None, "rel-1", ("pack", "crime", "2026-08"), payload=True), value)
        self.assertIs(release_store.get(None, "rel-2", ("pack", "crime", "2026-08"), payload=True), release_store.MISSING)
        self.assertIs(release_store.get(None, "rel-1", ("pack", "crime", "2026-08")), release_store.MISSING)  # objects

    def test_objects_are_keyed_by_the_code_and_payloads_by_their_format(self):
        release_store.cached(None, "rel-1", ("school-pool", "E12000007"), lambda: 1)
        release_store.cached(None, "rel-1", ("pack", "crime"), lambda: 2, payload=True)
        builds = sorted(build for _, build, _, _ in release_store.store.rows)
        self.assertEqual(builds, sorted([release_store.code_build(), f"payload-v{release_store.FORMAT}"]))
        self.assertRegex(release_store.code_build(), r"^py-[0-9a-f]{16}$")

    def test_built_once_then_read(self):
        calls = []
        load = lambda: calls.append(1) or {"built": True}  # noqa: E731
        self.assertEqual(release_store.cached(None, "rel-1", ("x",), load), {"built": True})
        self.assertEqual(release_store.cached(None, "rel-1", ("x",), load), {"built": True})
        self.assertEqual(len(calls), 1)

    def test_a_failed_load_keeps_nothing(self):
        with self.assertRaises(RuntimeError):
            release_store.cached(None, "rel-1", ("x",), mock.Mock(side_effect=RuntimeError("boom")))
        self.assertEqual(release_store.cached(None, "rel-1", ("x",), lambda: 2), 2)

    def test_concurrent_cold_callers_wait_for_one_load(self):
        started, release = threading.Event(), threading.Event()
        calls, results = [], []

        def load():
            calls.append(1)
            started.set()
            release.wait(5)
            return "built"

        first = threading.Thread(target=lambda: results.append(release_store.cached(None, "r", ("k",), load)))
        first.start()
        started.wait(5)
        others = [threading.Thread(target=lambda: results.append(release_store.cached(None, "r", ("k",), load)))
                  for _ in range(3)]
        for thread in others:
            thread.start()
        release.set()
        for thread in [first, *others]:
            thread.join(5)
        self.assertEqual((len(calls), results), (1, ["built"] * 4))


class DatabaseStoreTests(unittest.TestCase):
    def test_a_connection_without_savepoints_has_no_store(self):
        connection = mock.Mock(spec=["execute"])
        calls = []
        for _ in range(2):
            release_store.cached(connection, "rel-1", ("x",), lambda: calls.append(1) or 1)
        self.assertEqual(len(calls), 2)
        connection.execute.assert_not_called()

    def test_reads_and_writes_by_primary_key_in_a_savepoint(self):
        rows = {}

        class Connection:
            def transaction(self):
                return mock.MagicMock()

            def execute(self, sql, params):
                if sql.startswith("-- release-artifact:get"):
                    return [{"body": rows[params]}] if params in rows else []
                rows[params[:4]] = params[4]
                return []

        connection = Connection()
        self.assertEqual(release_store.cached(connection, "rel-1", ("lens", "gyms", None), lambda: {"a": 1}), {"a": 1})
        self.assertEqual(list(rows), [("rel-1", release_store.code_build(), "lens", "('gyms', None)")])
        self.assertEqual(release_store.cached(connection, "rel-1", ("lens", "gyms", None), lambda: {"a": 2}), {"a": 1})

    def test_the_release_build_commits_each_row_on_its_own_connection(self):
        writer, request = mock.MagicMock(), mock.MagicMock()
        request.execute.return_value = []
        store = release_store.DatabaseStore()
        store.writer = lambda: writer
        with mock.patch.object(release_store, "store", store):
            release_store.cached(request, "rel-1", ("x",), lambda: 1)
        self.assertTrue(writer.execute.call_args.args[0].startswith("-- release-artifact:put"))
        self.assertFalse([call for call in request.execute.call_args_list if "put" in call.args[0]])

    def test_a_store_error_is_logged_for_a_request_and_raised_for_the_build(self):
        connection = mock.MagicMock()
        connection.transaction.side_effect = RuntimeError("no table")
        with self.assertLogs("area_api.release_store", "WARNING") as logs:
            self.assertEqual(release_store.cached(connection, "rel-1", ("x",), lambda: 1), 1)
        self.assertIn("code=read-failed kind=x", logs.output[0])
        with mock.patch.object(release_store, "raise_errors", True), self.assertRaises(RuntimeError):
            release_store.cached(connection, "rel-1", ("x",), lambda: 1)


class ReaderStoreTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(release_store.use_memory())

    def test_another_worker_serves_a_built_pack_without_querying_it_again(self):
        first = make_reader(seed_production_fixture())
        built = first.get_value_pack("crime", "2026-06")
        connection = seed_production_fixture()
        other = make_reader(connection)  # another process, or a restarted one
        self.assertEqual(other.get_value_pack("crime", "2026-06"), built)
        packs = [sql for sql, _ in connection.statements if sql.startswith("-- evidence:pack\n")]
        self.assertEqual(packs, [])

    def test_a_crime_pack_reads_the_breakdown_of_its_own_areas_only(self):
        connection = seed_production_fixture()
        make_reader(connection).get_value_pack("crime", "2026-06")
        params = [params for sql, params in connection.statements if sql.startswith("-- evidence:pack-breakdown")]
        self.assertTrue(params)
        self.assertEqual(len(params[0]), 4)  # metric, month, then the areas (None: every area) twice


class PresetPackTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(release_store.use_memory())

    def test_a_ready_made_criterion_is_found_by_its_layer_id(self):
        self.assertEqual(custom_criteria.preset_criterion("kebab-cafe")["formula"], "share")
        self.assertIsNone(custom_criteria.preset_criterion("my-own"))

    def test_an_unknown_preset_has_no_pack(self):
        reader = EvidenceReader(connect=mock.Mock(side_effect=AssertionError("no database read")))
        self.assertIsNone(reader.preset_pack("my-own", lambda: {}))

    def test_zoomed_out_the_pack_is_its_lsoas_rolled_up_to_msoas(self):
        reader = make_reader(seed_production_fixture())
        lsoas = {"schemaVersion": custom_criteria.PACK_SCHEMA, "bivariate": None, "values": [
            {"geographyId": "uk:lsoa:A1", "value": 1.0, "percentile": 10, "counts": {"a": 1}},
            {"geographyId": "uk:lsoa:A2", "value": 3.0, "percentile": 30, "counts": {"a": 3}}]}
        index = types.SimpleNamespace(parent=lambda area, level: {"uk:lsoa:A1": "uk:msoa:A", "uk:lsoa:A2": "uk:msoa:A"}.get(area))
        with mock.patch.object(custom_criteria, "evaluate", return_value=lsoas) as evaluate, \
                mock.patch.object(reader, "_chunk_index", return_value=index):
            self.assertEqual(reader.preset_pack("gyms", lambda: {}), lsoas)
            rolled = reader.preset_pack("gyms", lambda: {}, level="msoa")
        evaluate.assert_called_once()  # the MSOAs are made from the LSOA pack, not evaluated again
        self.assertEqual(rolled["level"], "msoa")
        self.assertEqual(rolled["values"], [{"geographyId": "uk:msoa:A", "value": 2.0, "percentile": 20,
                                             "counts": {"a": 4}, "areaCount": 2}])
        with self.assertRaises(Exception):
            reader.preset_pack("gyms", lambda: {}, level="borough")


class BuildPlanTests(unittest.TestCase):
    def reader(self):
        reader = mock.Mock()
        reader.map_coverage.return_value = {
            "coverage": "england",
            "regions": [{"id": "E12000007"}, {"id": "E12000002"}],
            "chunks": [{"id": "E12000007"}] + [{"id": f"E08{index:06d}"} for index in range(70)],
        }
        reader.list_metrics.return_value = {"metrics": [
            {"id": "crime", "carrier": "lsoa", "defaultPeriod": "2026-08"},
            {"id": "census-birth-uk", "carrier": "msoa", "defaultPeriod": "2021-03"},
            {"id": "council-tax-band-mean", "carrier": "lad", "defaultPeriod": "2026-04"},
            {"id": "empty", "carrier": "lsoa", "defaultPeriod": ""},
        ]}
        return reader

    def test_the_start_views_come_first_and_lads_go_in_batches(self):
        reader = self.reader()
        with mock.patch.object(release_build.feature_flags, "england", return_value=True):
            tasks = release_build.plan(reader, lambda: {}, {1, 2, 3})
        self.assertEqual([task[0] for task in tasks], sorted(task[0] for task in tasks))
        labels = {tier: [label for t, label, _ in tasks if t == tier] for tier in (1, 2, 3)}
        self.assertIn("pack crime regions zoomed out", labels[1])
        self.assertIn("pack crime London", labels[1])
        self.assertIn("pack council-tax-band-mean whole", labels[1])
        self.assertFalse([label for label in labels[1] if "empty" in label])
        self.assertEqual(len([label for label in labels[2] if label.startswith("pack crime LADs")]), 2)  # 70 LADs, 64 a batch
        next(build for _, label, build in tasks if label == "pack crime regions zoomed out")()
        reader.get_value_pack.assert_called_with("crime", "2026-08", chunk="E12000007,E12000002", level="msoa")
        next(build for _, label, build in tasks if label == "pack census-birth-uk regions zoomed out")()
        reader.get_value_pack.assert_called_with("census-birth-uk", "2021-03", chunk="E12000007,E12000002", level=None)

    def test_a_failed_task_is_counted_and_the_rest_still_run(self):
        ran = []
        tasks = [(1, "bad", mock.Mock(side_effect=RuntimeError("boom"))), (1, "good", lambda: ran.append(1))]
        counts = release_build.run(mock.Mock(), tasks, jobs=2, budget_seconds=60)
        self.assertEqual((counts["done"], counts["failed"]), (1, 1))
        self.assertEqual(ran, [1])

    def test_tier_0_builds_what_the_warm_threads_did(self):
        labels = [label for tier, label, _ in release_build.plan(self.reader(), lambda: {}, {0})]
        self.assertEqual(labels[:7], ["periods", "map chunks", "area tree", "school pools",
                                      "borough and MSOA standouts", "ready-made criteria", "sections"])
        self.assertEqual(labels[7:], [f"lens {preset}" for preset in custom_criteria.LENS_PRESETS])

    def test_sections_read_one_neighbourhood_per_region(self):
        from area_api import safety, standouts
        reader = self.reader()
        reader._connect = mock.MagicMock()
        region_map = {"uk:lsoa:E01000002": "E12000007", "uk:lsoa:E01000001": "E12000007",
                      "uk:lsoa:E01005000": "E12000002", "uk:msoa:E02000001": "E12000007"}
        with mock.patch("area_api.regions.area_regions_on", return_value=region_map), \
                mock.patch.object(standouts, "area_standouts") as read_standouts, \
                mock.patch.object(safety, "area_safety") as read_safety:
            build = next(build for _, label, build in release_build.plan(reader, lambda: {}, {0}) if label == "sections")
            self.assertEqual(build(), ["E12000002", "E12000007"])
        self.assertEqual(sorted(call.args[1] for call in read_standouts.call_args_list), ["uk:lsoa:E01000001", "uk:lsoa:E01005000"])
        self.assertEqual(read_safety.call_count, 2)


if __name__ == "__main__":
    unittest.main()
