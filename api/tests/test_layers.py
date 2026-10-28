"""Area layers scorecard (area-layers.v1): every map metric for an area as a tile, plus flood, air and broadband chips."""
import os
import threading
import unittest
from contextlib import contextmanager
from unittest import mock

from area_api import layers, scope
from area_api.evidence import EvidenceReader

AREA = "uk:lsoa:E01001209"


def _metric(metric_id, value, percentile, direction="higher-is-more", unit="%", period="2026-06", year_ago=None,
            label=None):
    return {"id": metric_id, "label": label or metric_id.title(), "unit": unit, "direction": direction,
            "carrier": "lsoa", "geography_id": AREA, "period": period, "value": value,
            "region_percentile": percentile, "year_ago": year_ago}


ROWS = [
    _metric("crime", 80.2, 90, unit="per 1,000", period="2026-08", year_ago=70.0, label="Crime"),
    _metric("food-hygiene", 91.0, 70, direction="higher-is-better", label="Food hygiene"),
    _metric("price-per-square-metre", 6524.4, 45, unit="£/m²", year_ago=6544.0, label="Price per m²"),
    _metric("census-religion-christian", 38.5, 60, label="Christian"),
    _metric("noise", None, None, label="Noise"),
]
FLOOD = [{"source": "rivers-sea", "area_m2": 1000.0, "low_m2": 0.0, "medium_m2": 0.0, "high_m2": 0.0,
          "source_release_id": "ea", "caveats": [], "attribution": "EA"},
         {"source": "surface-water", "area_m2": 1000.0, "low_m2": 50.0, "medium_m2": 0.0, "high_m2": 0.0,
          "source_release_id": "ea", "caveats": [], "attribution": "EA"}]
HEALTH = {"geography_id": AREA, "no2": 31.2, "pm25": 9.1, "air_pct": 72, "air_year": 2022}
BROADBAND = {"geography_id": AREA, "premises": 795, "gigabit_premises": 794, "share": 0.9987,
             "region_percentile": 88, "london_share": 0.91, "source_release_id": "src-ofcom"}


class Fake:
    """Answers each statement by its marker line."""

    def __init__(self, rows=ROWS, flood=True):
        self.rows, self.flood = rows, flood

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if "active-release" in marker:
            return [{"release_id": "rel-1"}]
        if "area-exists" in marker:
            return [{"?column?": 1}]
        if "layers:values" in marker:
            wanted = params.get("metrics")
            return [row for row in self.rows if wanted is None or row["id"] in wanted]
        if "layers:flood-table" in marker:
            return [{"t": self.flood}]
        if marker.endswith("evidence:area-flood"):
            return FLOOD
        if marker.endswith("evidence:area-health"):
            return [HEALTH]
        if marker.endswith("area-home-broadband"):
            return [BROADBAND]
        return []


def _reader(rows=ROWS, flood=True):
    @contextmanager
    def connect():
        yield Fake(rows, flood)
    return EvidenceReader(connect)


# standouts._preset's answers for this area: (value, percentile of "more of it") per ready-made criterion.
PRESET_VALUES = {"nightlife": (41, 99), "family": (5, 38), "gyms": (9, 91), "kebab-cafe": (-0.6, 4),
                 "markets": (6.4, 80), "indie-cafes": (0.62, 70)}


def _preset(connection, release_id, preset_id, area_id):
    found = PRESET_VALUES.get(preset_id)
    return None if found is None else {"value": found[0], "percentile": found[1], "radiusMetres": 800}


class LayersTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in ("CLOSE_KNIT_CENSUS_RANKED", "CLOSE_KNIT_AIR_QUALITY"):
            os.environ.pop(name, None)
        preset = mock.patch.object(layers.standouts, "_preset", side_effect=_preset)
        preset.start()
        self.addCleanup(preset.stop)

    def layers(self, rows=ROWS, scope=None):
        payload = layers.area_layers(_reader(rows), AREA, scope=scope)
        return payload, {layer["id"]: layer for layer in payload["layers"]}

    def test_one_layer_per_metric_with_value(self):
        payload, by_id = self.layers()
        self.assertEqual(payload["areaId"], AREA)
        self.assertEqual([layer["id"] for layer in payload["layers"]], [row["id"] for row in ROWS])
        crime = by_id["crime"]
        # The same shape as a standouts tile, so AreaTiles renders it; the web fills section and topic.
        self.assertEqual(set(crime), {"id", "label", "section", "topic", "available", "value", "display", "standing",
                                      "regionPercentile", "extreme", "detail", "trend", "period", "coverage"})
        self.assertEqual(crime["label"], "Crime")
        self.assertIsNone(crime["section"])
        self.assertIsNone(crime["topic"])
        self.assertEqual(crime["value"], 80.2)
        self.assertEqual(crime["display"], "80.2 per 1,000")
        self.assertEqual(crime["period"], "2026-08")
        self.assertEqual(by_id["price-per-square-metre"]["display"], "£6,500/m²")

    def test_road_collisions_unit_reads_in_words_and_a_zero_is_a_value(self):
        self.assertEqual(layers.display(0.45, "per-1000-residents-per-year"), "0.45 per 1,000 a year")
        self.assertEqual(layers.display(0.0, "per-1000-residents-per-year"), "0 per 1,000 a year")

    def test_lower_is_better_flips_standing(self):
        _, by_id = self.layers()
        self.assertEqual(by_id["crime"]["standing"], 10)
        self.assertIsNone(by_id["crime"]["regionPercentile"])
        self.assertEqual(by_id["crime"]["extreme"], "con")
        self.assertEqual(by_id["food-hygiene"]["standing"], 70)
        # Price is neutral (dearer is not worse): its London position, never a standing.
        self.assertIsNone(by_id["price-per-square-metre"]["standing"])
        self.assertEqual(by_id["price-per-square-metre"]["regionPercentile"], 45)
        self.assertIsNone(by_id["price-per-square-metre"]["extreme"])

    def test_missing_value_is_unavailable_not_zero(self):
        _, by_id = self.layers()
        noise = by_id["noise"]
        self.assertFalse(noise["available"])
        self.assertIsNone(noise["display"])
        self.assertIsNone(noise["value"])
        self.assertIsNone(noise["standing"])

    def test_air_layer_waits_for_the_laei_flag(self):
        rows = [*ROWS, _metric("air-no2", 31.2, 72, unit="µg/m³", label="Clean air")]
        payload, by_id = self.layers(rows)
        self.assertNotIn("air-no2", by_id)
        self.assertIn("laeiAir", payload["withheld"])
        os.environ["CLOSE_KNIT_AIR_QUALITY"] = "1"
        _, by_id = self.layers(rows)
        self.assertEqual(by_id["air-no2"]["value"], 31.2)

    def test_census_never_rated_with_flag_off(self):
        payload, by_id = self.layers()
        census = by_id["census-religion-christian"]
        self.assertTrue(census["available"])
        self.assertEqual(census["display"], "38.5%")
        self.assertIsNone(census["standing"])
        self.assertIsNone(census["regionPercentile"])
        self.assertIsNone(census["extreme"])
        self.assertIn("censusRanked", payload["withheld"])
        os.environ["CLOSE_KNIT_CENSUS_RANKED"] = "1"
        payload, by_id = self.layers()
        self.assertNotIn("censusRanked", payload["withheld"])
        self.assertEqual(by_id["census-religion-christian"]["regionPercentile"], 60)

    def test_trend_needs_two_periods(self):
        _, by_id = self.layers()
        self.assertEqual(by_id["crime"]["trend"], {"direction": "up", "percent": 14.6, "years": 1})
        # Under half a per cent is flat: AreaTiles draws no arrow for it either.
        self.assertEqual(by_id["price-per-square-metre"]["trend"], {"direction": "flat", "percent": -0.3, "years": 1})
        self.assertIsNone(by_id["food-hygiene"]["trend"])
        down = self.layers([_metric("crime", 60.0, 50, year_ago=70.0)])[1]["crime"]
        self.assertEqual(down["trend"], {"direction": "down", "percent": -14.3, "years": 1})

    def test_chips_present(self):
        payload, _ = self.layers()
        chips = {chip["id"]: chip for chip in payload["chips"]}
        self.assertEqual([chip["id"] for chip in payload["chips"]], ["flood", "air", "broadband"])
        self.assertEqual(chips["flood"], {"id": "flood", "label": "Flood", "band": "Low"})
        self.assertEqual(chips["broadband"], {"id": "broadband", "label": "Broadband", "band": "100% gigabit"})
        # Air is the LAEI grid: withheld (band null) until its flag is on.
        self.assertIsNone(chips["air"]["band"])
        self.assertIn("laeiAir", payload["withheld"])
        os.environ["CLOSE_KNIT_AIR_QUALITY"] = "1"
        payload, _ = self.layers()
        chips = {chip["id"]: chip for chip in payload["chips"]}
        self.assertEqual(chips["air"]["band"], "More polluted than most")
        self.assertNotIn("laeiAir", payload["withheld"])

    def test_chips_without_data_have_no_band(self):
        class Empty(Fake):
            def execute(self, sql, params=()):
                marker = sql.split("\n", 1)[0]
                return super().execute(sql, params) if "release" in marker or "exists" in marker else []

        @contextmanager
        def connect():
            yield Empty()
        payload = layers.area_layers(EvidenceReader(connect), AREA)
        self.assertEqual(payload["layers"], [])
        self.assertEqual([chip["band"] for chip in payload["chips"]], [None, None, None])


    def test_overview_scope_has_only_the_overview_layers_in_order(self):
        payload, by_id = self.layers(scope="overview")
        self.assertEqual(payload["scope"], "overview")
        self.assertEqual([layer["id"] for layer in payload["layers"]], [id_ for id_, _ in layers.OVERVIEW_LAYERS])
        self.assertNotIn("census-religion-christian", by_id)
        # Short names; a layer the area has no row for keeps its place without data, never zero.
        self.assertEqual(by_id["price-per-square-metre"]["label"], "Price")
        self.assertEqual(by_id["crime"]["standing"], 10)
        self.assertFalse(by_id["road-collisions"]["available"])
        self.assertIsNone(by_id["road-collisions"]["value"])
        self.assertEqual([chip["id"] for chip in payload["chips"]], ["flood", "air", "broadband"])
        everything, _ = self.layers()
        self.assertEqual(everything["scope"], "all")
        self.assertNotIn("road-collisions", [layer["id"] for layer in everything["layers"]])

    def test_unknown_scope_is_malformed(self):
        with self.assertRaises(layers.evidence.MalformedQuery):
            layers.area_layers(_reader(), AREA, scope="everything")

    def test_presets_where_the_area_rates_highest(self):
        payload, _ = self.layers(scope="overview")
        presets = payload["presets"]
        # "X vs Y" criteria (balance, share) are never Overview tiles: kebab-cafe would rate 96 here.
        self.assertEqual([tile["id"] for tile in presets], ["custom:nightlife", "custom:gyms", "custom:markets"])
        nightlife, gyms, markets = presets
        self.assertEqual(nightlife["label"], "Bars, pubs and clubs")  # the neutral name as given
        self.assertEqual(nightlife["display"], "41 per 1,000 residents")  # Layers v5: per resident on the map
        self.assertEqual(nightlife["standing"], 99)
        self.assertEqual(nightlife["detail"], "in this area")  # counted inside the boundary, never a walk
        self.assertIsNone(markets["detail"])
        self.assertEqual(gyms["display"], "9 min walk")  # Layers v5: the nearest gym
        self.assertEqual(markets["display"], "6 min walk")

    def test_preset_display_by_formula(self):
        def tile(preset_id, value):
            preset = next(p for p in layers.custom_criteria.presets()["presets"] if p["criterion"]["id"] == preset_id)
            return layers.preset_tile(preset, {"value": value, "percentile": 50, "radiusMetres": 800})["display"]
        self.assertEqual(tile("family", 1), "1 min walk")
        self.assertEqual(tile("nightlife", 2.5), "2.5 per 1,000 residents")
        self.assertEqual(tile("universities", 1), "1 place")
        self.assertEqual(tile("markets", 6.4), "6 min walk")
        self.assertEqual(tile("food-variety", 12), "12 kinds")

    def test_lower_is_better_follows_the_search_defaults(self):
        self.assertEqual(layers.LOWER_IS_BETTER >= {"crime", "station-access", "noise", "road-collisions"}, True)
        self.assertNotIn("deprivation", layers.LOWER_IS_BETTER)

    def test_flood_chip_waits_for_its_table(self):
        payload = layers.area_layers(_reader(flood=False), AREA)
        self.assertIsNone(payload["chips"][0]["band"])

    def test_trend_from_zero_keeps_its_direction(self):
        self.assertEqual(layers.trend(2.0, 0.0), {"direction": "up", "percent": None, "years": 1})
        self.assertEqual(layers.trend(0.0, 0.0), {"direction": "flat", "percent": None, "years": 1})


    def test_presets_honour_cancel(self):
        calls = []

        def cancel():
            calls.append(1)
            return len(calls) > 4  # past the area checks, partway through the presets

        with self.assertRaises(layers.evidence.Cancelled):
            layers.area_layers(_reader(), AREA, cancel=cancel)


class Aborting(Fake):
    """A pooled connection outside autocommit: a failed statement aborts the transaction, and every later
    statement fails until a savepoint rolls it back."""

    def __init__(self):
        super().__init__()
        self.aborted = False

    @contextmanager
    def transaction(self):
        before = self.aborted
        try:
            yield
        except Exception:
            self.aborted = before  # rolled back to the savepoint
            raise

    def execute(self, sql, params=()):
        if self.aborted:
            raise RuntimeError("InFailedSqlTransaction: current transaction is aborted")
        if sql.startswith("-- preset:fails"):
            self.aborted = True
            raise RuntimeError("UndefinedTable: place_poi")
        return super().execute(sql, params)


class PresetIsolationTest(unittest.TestCase):
    def test_a_failed_preset_leaves_the_chips_readable(self):
        connection = Aborting()

        def evaluate(conn, release_id, criterion):
            if criterion["id"] == "nightlife":
                conn.execute("-- preset:fails\nSELECT 1")
            return ({AREA: {"value": 12.0}, "uk:lsoa:E01000002": {"value": 3.0}}, "", [])

        @contextmanager
        def connect():
            yield connection
        layers.custom_criteria.clear_cache()
        self.addCleanup(layers.custom_criteria.clear_cache)
        with mock.patch.object(layers.custom_criteria, "_compute_values", side_effect=evaluate), \
                mock.patch.object(layers.evidence, "_active_release", return_value="rel-savepoint"):
            payload = layers.area_layers(EvidenceReader(connect), AREA, scope="overview")
        self.assertNotIn("custom:nightlife", [tile["id"] for tile in payload["presets"]])
        self.assertEqual(len(payload["presets"]), 3)
        self.assertEqual(payload["chips"][0], {"id": "flood", "label": "Flood", "band": "Low"})
        self.assertEqual(payload["chips"][2]["band"], "100% gigabit")



def _definition(preset_id):
    return layers.custom_criteria.normalise(next(
        p["criterion"] for p in layers.custom_criteria.presets()["presets"] if p["criterion"]["id"] == preset_id))


class PresetCacheTests(unittest.TestCase):
    """The ready-made criteria are kept per release (release_artifact): one build per key, never evicted by user
    criteria."""

    def setUp(self):
        layers.custom_criteria.clear_cache()
        self.addCleanup(layers.custom_criteria.clear_cache)
        self.addCleanup(layers.custom_criteria.release_store.use_memory())

    def test_concurrent_cold_requests_evaluate_once(self):
        calls, started, release = [], threading.Event(), threading.Event()

        def compute(connection, release_id, definition, served=None):
            calls.append(definition["id"])
            started.set()
            release.wait(5)
            return ({AREA: {"value": 1.0}}, "", [])

        results = []
        with mock.patch.object(layers.custom_criteria, "_compute_values", side_effect=compute):
            threads = [threading.Thread(target=lambda: results.append(
                layers.custom_criteria.preset_values(object(), "rel-flight", _definition("gyms")))) for _ in range(2)]
            for thread in threads:
                thread.start()
            self.assertTrue(started.wait(5))
            release.set()
            for thread in threads:
                thread.join(5)
        self.assertEqual(calls, ["gyms"])
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0], results[1])

    def test_user_criteria_never_evict_a_preset(self):
        calls = []

        def compute(connection, release_id, definition, served=None):
            calls.append(definition["id"])
            return ({}, "", [])

        with mock.patch.object(layers.custom_criteria, "_compute_values", side_effect=compute):
            layers.custom_criteria.preset_values(object(), "rel-evict", _definition("gyms"))
            for n in range(layers.custom_criteria._CACHE_SIZE + 10):
                user = layers.custom_criteria.normalise({
                    "id": f"user-{n}", "label": f"User {n}", "formula": "count", "radiusMetres": 500,
                    "sets": {"a": {"label": "Shops", "any": [{"brand": f"Brand {n}"}]}}})
                layers.custom_criteria._evaluate_values(object(), "rel-evict", user, scope.LONDON)
            self.assertEqual(len(layers.custom_criteria._CACHE), layers.custom_criteria._CACHE_SIZE)
            layers.custom_criteria.preset_values(object(), "rel-evict", _definition("gyms"))
        self.assertEqual(calls.count("gyms"), 1)

    def test_each_release_builds_its_own_once(self):
        with mock.patch.object(layers.custom_criteria, "_compute_values", return_value=({}, "", [])) as compute:
            layers.custom_criteria.preset_values(object(), "rel-a", _definition("gyms"))
            layers.custom_criteria.preset_values(object(), "rel-b", _definition("gyms"))
            layers.custom_criteria.preset_values(object(), "rel-b", _definition("gyms"))
        self.assertEqual(compute.call_count, 2)
        stored = layers.custom_criteria.release_store.store.kinds()
        self.assertEqual([(release, kind) for release, kind, _ in stored], [("rel-a", "preset-values"), ("rel-b", "preset-values")])

    def test_the_release_build_reads_every_overview_and_standouts_preset(self):
        seen, built = [], []
        with mock.patch.object(layers.standouts, "_preset", side_effect=lambda c, r, preset_id, a, *formula: seen.append(preset_id)), \
                mock.patch.object(layers.custom_criteria, "preset_values", side_effect=lambda c, r, d: built.append(d["id"])):
            layers.build_presets(object(), "rel-build")
        expected = [p["criterion"]["id"] for p in layers.custom_criteria.presets()["presets"]
                    if p["criterion"]["formula"] not in layers.PAIRED_FORMULAS]
        self.assertEqual(seen[:len(expected)], expected)
        self.assertEqual(built, seen)
        self.assertTrue({preset_id for preset_id, _ in layers.standouts.PRESETS.values()} <= set(seen))

    def test_a_failed_criterion_fails_the_release_build(self):
        with mock.patch.object(layers.custom_criteria, "_compute_values", side_effect=RuntimeError("no places table")), \
                self.assertRaises(RuntimeError):
            layers.build_presets(object(), "rel-build")

    def test_the_api_starts_no_warm_thread(self):
        try:
            import area_api.app as app_module
            from fastapi.testclient import TestClient
        except ImportError:  # pragma: no cover - fastapi is not installed
            self.skipTest("fastapi is not installed")
        with TestClient(app_module.app):
            names = [thread.name for thread in threading.enumerate()]
        self.assertFalse([name for name in names if name.startswith("warm")])


if __name__ == "__main__":
    unittest.main()
