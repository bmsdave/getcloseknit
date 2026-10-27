"""v4 My match model (Tasks 21, 21d, 21e, 8): ordered criteria, rank-order centroid weights, Musts as filters,
rank and percentile among scored areas, reasons and weakest criteria, bottom 10, Best value, profile v2."""
import unittest
from unittest import mock

from area_api import match_model, repository
from area_api.matching import InvalidMatchRequest, build_match_pack, validate_match_request

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None


def _v2(*criteria, **extra):
    return {"schemaVersion": "preference-profile.v2", "market": "buy", "targetBudget": 500_000,
            "maximumBudget": 650_000, "bedrooms": 2, "criteria": list(criteria), **extra}


def _range(layer="crime", **bounds):
    return {"kind": "range", "layer": layer, "scale": "percentile", "min": None, "max": 50, "softMin": None,
            "softMax": 75, "must": False, **bounds}


def _rows(values, factor_id="range:crime"):
    """One row per area: {area id: (raw value, London percentile)}."""
    return [{"geography_id": area_id, "name": area_id[-4:], "factor_id": factor_id, "raw_value": raw, "utility": None,
             "percentile": percentile, "unit": "per 1,000", "carrier_geography_id": area_id, "quality": "observed",
             "source_release_id": "police-2026-06"} for area_id, (raw, percentile) in values.items()]


def _lsoa(index):
    return f"uk:lsoa:E{1000000 + index:08d}"


class WeightTests(unittest.TestCase):
    def test_rank_order_centroid(self):
        self.assertEqual(match_model.roc_weights(1), [1.0])
        self.assertEqual(match_model.roc_weights(2), [0.75, 0.25])
        thirteen = [round(w * 100) for w in match_model.roc_weights(13)]
        self.assertEqual(thirteen[:4], [24, 17, 13, 10])  # the spec's 25%, 17%, 13%, 10% (24.5% rounds down)
        self.assertEqual(thirteen[-1], 1)
        fifteen = match_model.roc_weights(15)
        self.assertAlmostEqual(sum(fifteen), 1.0)
        self.assertEqual(round(fifteen[0] * 100), 22)
        self.assertEqual(round(fifteen[-1] * 1000), 4)  # 0.4%

    def test_musts_take_no_weight_and_keep_their_place(self):
        specs = match_model.specs(_v2(_range(must=True), {"kind": "budget"}, _range("noise")))
        self.assertEqual([(s["id"], s["must"], s["priority"], s["weight"]) for s in specs],
                         [("range:crime", True, 1, 0.0), ("affordability", False, 2, 0.75), ("range:noise", False, 3, 0.25)])
        self.assertEqual((specs[0]["softMax"], specs[2]["softMax"]), (None, 75))


class ProfileV2Tests(unittest.TestCase):
    def test_valid_profiles_pass(self):
        validate_match_request(_v2())
        validate_match_request(_v2({"kind": "budget", "must": True}, _range("air-no2", scale="value", max=30, softMax=40),
                                   {"kind": "where", "zones": [{"kind": "borough", "id": "uk:lad:E09000007"}]},
                                   {"kind": "place", "id": "gym", "label": "Gym", "target": {"kind": "category", "category": "gym"},
                                    "mode": "walk", "targetMinutes": 10, "softMinutes": 15, "must": False}))
        # A Must ignores its soft edges.
        validate_match_request(_v2(_range(must=True, softMax=10)))

    def test_bad_profiles_are_refused(self):
        bad = [
            [{"kind": "colour"}],
            [{"kind": "budget"}, {"kind": "budget"}],
            [_range(), _range()],
            [_range("census-religion-muslim")],
            [_range(scale="percentile", max=120, softMax=130)],
            [_range(max=50, softMax=40)],
            [{**_range(), "importance": 3}],
            [{"kind": "where", "zones": []}],
            [{"kind": "where", "zones": [{"kind": "borough", "id": "uk:lad:E09000007"}], "softMetres": 10}],
            [{"kind": "place", "id": "gym", "label": "Gym", "target": {"kind": "category", "category": "gym"},
              "mode": "walk", "targetMinutes": 10, "softMinutes": 5}],
            [{"kind": "custom", "criterion": {"id": "x"}, "direction": "up"}],
            [_range(must="yes")],
        ]
        for criteria in bad:
            with self.subTest(criteria=str(criteria)[:70]), self.assertRaises(InvalidMatchRequest):
                validate_match_request(_v2(*criteria))
        with self.assertRaises(InvalidMatchRequest):
            validate_match_request({**_v2(), "criteria": [_range()] * 21})

    def test_v1_migrates_to_the_order_with_musts_kept(self):
        v1 = {"schemaVersion": "preference-profile.v1", "market": "buy", "targetBudget": 500_000, "maximumBudget": 650_000,
              "factors": [{"factorId": "affordability", "weight": 3, "direction": "target-range", "minimumUtility": None,
                           "maximumUtility": None},
                          {"factorId": "crime", "weight": 5, "direction": "lower", "minimumUtility": 50, "maximumUtility": None},
                          {"factorId": "noise", "weight": 4, "direction": "lower", "minimumUtility": None, "maximumUtility": None},
                          {"factorId": "schools", "weight": 0, "direction": "higher", "minimumUtility": None, "maximumUtility": None}],
              "commuteDestinations": [],
              "places": [{"id": "gym", "label": "Gym", "target": {"kind": "category", "category": "gym"}, "mode": "walk",
                          "targetMinutes": 10, "weight": 4, "must": True}],
              "ranges": [{"layer": "air-no2", "min": None, "max": 30, "softMin": None, "softMax": 40, "importance": 2}],
              "zones": [{"kind": "borough", "id": "uk:lad:E09000007"}]}
        v2 = match_model.migrate_v1(v1)
        self.assertEqual([(c["kind"], match_model.criterion_id(c), c["must"]) for c in v2["criteria"]], [
            ("where", "zone", False), ("range", "crime", True), ("range", "noise", False), ("place", "place:gym", True),
            ("budget", "affordability", False), ("range", "range:air-no2", False)])
        crime = v2["criteria"][1]
        self.assertEqual((crime["layer"], crime["scale"], crime["max"], crime["softMax"]), ("crime", "percentile", 50, None))
        clean = match_model.contract_profile(v1)
        self.assertTrue(all(not key.startswith("_") for item in clean["criteria"] for key in item))
        validate_match_request(clean)

    def test_v1_ranges_the_panel_writes_keep_their_scale_and_must(self):
        """v4.5: the panel's ranges carry scale and must (assertRanges); /brief posted them and got a 400."""
        v1 = {"schemaVersion": "preference-profile.v1", "market": "buy", "targetBudget": 500_000, "maximumBudget": 650_000,
              "factors": [{"factorId": "affordability", "weight": 0, "direction": "target-range", "minimumUtility": None,
                           "maximumUtility": None}],
              "commuteDestinations": [],
              "ranges": [{"layer": "crime", "min": None, "max": 50, "softMin": None, "softMax": 75, "importance": 4,
                          "scale": "percentile", "must": False},
                         {"layer": "air-no2", "min": None, "max": 30, "softMin": None, "softMax": 40, "importance": 2,
                          "scale": "value", "must": True}]}
        validate_match_request(v1)
        crime, air = match_model.migrate_v1(v1)["criteria"]
        self.assertEqual((crime["scale"], crime["softMax"], crime["must"]), ("percentile", 75, False))
        self.assertEqual((air["scale"], air["must"]), ("value", True))
        for bad in ({"scale": "rank"}, {"scale": "percentile", "max": 150, "softMax": None}, {"must": "yes"}):
            with self.assertRaises(InvalidMatchRequest):
                validate_match_request({**v1, "ranges": [{**v1["ranges"][0], **bad}]})


class RankTests(unittest.TestCase):
    def test_rank_percentile_reasons_and_the_bottom_ten(self):
        # 12 areas, crime percentile 0, 5, ..., 55: the lower half fits, 55 is on the edge (fit 0.8).
        values = {_lsoa(i): (i * 2.0, i * 5.0) for i in range(12)}
        values[_lsoa(99)] = (400.0, 99.0)  # far beyond the soft edge: fit 0, scored 0
        pack = build_match_pack(_v2(_range()), _rows(values))
        by_id = {value["geographyId"]: value for value in pack["values"]}
        self.assertEqual(pack["scored"], 13)
        self.assertEqual(pack["values"][0]["geographyId"], _lsoa(0))  # all fit 1: the lowest crime wins the tie
        self.assertEqual((pack["values"][0]["rank"], pack["values"][0]["percentile"]), (1, 100))
        self.assertEqual(by_id[_lsoa(11)]["score"], 80)
        self.assertEqual((by_id[_lsoa(99)]["score"], by_id[_lsoa(99)]["rank"], by_id[_lsoa(99)]["percentile"]), (0, 13, 0))
        self.assertEqual(by_id[_lsoa(99)]["weakest"], ["range:crime"])
        self.assertEqual(by_id[_lsoa(0)]["reasons"], ["range:crime"])
        self.assertEqual(len(pack["bottom"]), 10)
        self.assertEqual([item["geographyId"] for item in pack["bottom"][:2]], [_lsoa(99), _lsoa(11)])
        self.assertEqual(pack["criteria"][0]["valueBounds"]["max"], 20.0)  # the 50th percentile's value

    def test_components_say_in_edge_or_out(self):
        pack = build_match_pack(_v2(_range()), _rows({_lsoa(1): (5, 10), _lsoa(2): (60, 60), _lsoa(3): (90, 90)}))
        kinds = {value["geographyId"]: value["components"][0]["fitKind"] for value in pack["values"]}
        self.assertEqual(kinds, {_lsoa(1): "in", _lsoa(2): "edge", _lsoa(3): "out"})
        self.assertEqual(pack["values"][0]["components"][0]["percentile"], 10)


class BestValueTests(unittest.TestCase):
    def _value(self, ratio, sales=30):
        return {"typical_price": 400_000, "peer_price": round(400_000 / ratio), "value_ratio": ratio, "sales": sales}

    def test_cheapest_for_their_peers_first_in_the_better_half_with_outliers_trimmed(self):
        values = {_lsoa(i): (i, i * 10.0) for i in range(6)}  # percentiles 0..50: all inside, ranked by crime
        rows = _rows(values)
        value_rows = {_lsoa(0): self._value(1.10), _lsoa(1): self._value(0.80), _lsoa(2): self._value(0.40),
                      _lsoa(3): self._value(0.95), _lsoa(5): self._value(0.70)}
        pack = build_match_pack(_v2(_range()), rows, sort="best-value", value_rows=value_rows)
        self.assertEqual(pack["sort"], "best-value")
        order = [value["geographyId"] for value in pack["values"]]
        # Better half by percentile: ranks 1-3 (areas 0, 1, 2); area 2's 0.40 is an outlier (trimmed).
        self.assertEqual(order[:2], [_lsoa(1), _lsoa(0)])
        self.assertEqual([value["valueRank"] for value in pack["values"][:2]], [1, 2])
        by_id = {value["geographyId"]: value for value in pack["values"]}
        self.assertTrue(by_id[_lsoa(2)]["value"]["outlier"])
        self.assertIsNone(by_id[_lsoa(2)]["valueRank"])
        self.assertIsNone(by_id[_lsoa(5)]["valueRank"])  # cheap for its peers but in the lower half of the search
        self.assertEqual(by_id[_lsoa(1)]["value"]["valuePercent"], -20)
        self.assertEqual(order[2:], [_lsoa(2), _lsoa(3), _lsoa(4), _lsoa(5)])  # the rest in score order

    def test_a_score_pack_counts_the_areas_best_value_would_list(self):
        # v4.2: the UI hides Best value when no area in the better half has a figure (20+ sales of the type).
        rows = _rows({_lsoa(i): (i, i * 10.0) for i in range(6)})
        value_rows = {_lsoa(1): self._value(0.80), _lsoa(2): self._value(0.40), _lsoa(5): self._value(0.70)}
        pack = build_match_pack(_v2(_range()), rows, value_rows=value_rows)
        self.assertEqual((pack["sort"], pack["valueAreas"]), ("score", 1))  # 2 is an outlier, 5 in the lower half
        self.assertEqual(build_match_pack(_v2(_range()), rows, value_rows={})["valueAreas"], 0)
        self.assertNotIn("valueAreas", build_match_pack(_v2(_range()), rows))
        best = build_match_pack(_v2(_range()), rows, sort="best-value", value_rows=value_rows)
        self.assertEqual(best["valueAreas"], 1)

    def test_home_type_follows_the_profile(self):
        self.assertEqual(match_model.value_home_type({"propertyType": "flat"}), "flat")
        self.assertEqual(match_model.value_home_type({"houseTypes": ["semi"]}), "semi")
        self.assertEqual(match_model.value_home_type({"houseTypes": ["semi", "terraced"]}), "all")


class SourceTests(unittest.TestCase):
    def test_v2_ranges_read_layers_and_v1_factors_read_their_rows(self):
        sources = repository.match_sources(_v2({"kind": "budget"}, _range("noise"), _range("disorder", must=True)))
        self.assertEqual(sources["ranges"], [{"layer": "noise"}, {"layer": "disorder"}])
        self.assertTrue(sources["budget"])
        v1 = {"schemaVersion": "preference-profile.v1", "targetBudget": 1, "maximumBudget": 2,
              "factors": [{"factorId": "noise", "weight": 2, "direction": "lower", "minimumUtility": None, "maximumUtility": None}]}
        self.assertEqual(repository.match_sources(v1)["factors"], ["noise"])

    def test_a_layer_without_a_metric_reads_its_factor(self):
        class Connection:
            def __init__(self):
                self.statements = []

            def execute(self, sql, params=()):
                marker = sql.strip().split("\n", 1)[0]
                self.statements.append(marker)
                if marker == "-- evidence:range-metric":
                    return []
                return [{"geography_id": "uk:lsoa:E01000001", "name": "A", "factor_id": "disorder", "raw_value": 12.0,
                         "utility": 40.0, "unit": "per 1,000", "carrier_geography_id": "uk:lsoa:E01000001",
                         "quality": "observed", "source_release_id": "police"}]

        rows = repository.range_rows(Connection(), [{"layer": "disorder"}, {"layer": "not-a-layer"}])
        self.assertEqual([(row["factor_id"], row["percentile"], row["utility"]) for row in rows],
                         [("range:disorder", 40.0, None)])


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class EndpointTests(unittest.TestCase):
    def setUp(self):
        from area_api.ratelimit import TokenBuckets

        # Own rate-limit buckets: these requests never spend the budget other test modules share.
        self._buckets = app_module.rate_limiter.buckets
        app_module.rate_limiter.buckets = TokenBuckets()
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module.rate_limiter.buckets = self._buckets

    def test_matches_takes_a_v2_profile_and_sorts_by_value(self):
        # Three areas: percentiles 100, 50, 0; the second is in the better half and cheap for its peers.
        rows = _rows({_lsoa(1): (5, 10), _lsoa(2): (8, 20), _lsoa(3): (9, 30)})
        with mock.patch.object(app_module, "load_match_evidence", lambda profile, regions=None: rows), \
                mock.patch.object(app_module, "_good_value_rows", lambda home_type: {
                    _lsoa(2): {"typical_price": 300_000, "peer_price": 400_000, "value_ratio": 0.75, "sales": 25}}), \
                mock.patch.object(app_module.repository, "area_titles", lambda: {}):
            response = self.client.post("/api/v1/matches?sort=best-value", json=_v2(_range()))
        self.assertEqual(response.status_code, 200, response.text)
        pack = response.json()
        self.assertEqual((pack["schemaVersion"], pack["profileVersion"], pack["sort"]),
                         ("match-pack.v2", "preference-profile.v2", "best-value"))
        self.assertEqual(pack["values"][0]["geographyId"], _lsoa(2))
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_a_score_pack_says_how_many_areas_best_value_lists_and_survives_a_value_outage(self):
        rows = _rows({_lsoa(1): (5, 10), _lsoa(2): (8, 20), _lsoa(3): (9, 30)})
        value = {_lsoa(2): {"typical_price": 300_000, "peer_price": 400_000, "value_ratio": 0.75, "sales": 25}}
        with mock.patch.object(app_module, "load_match_evidence", lambda profile, regions=None: rows), \
                mock.patch.object(app_module, "_good_value_rows", lambda home_type: value), \
                mock.patch.object(app_module.repository, "area_titles", lambda: {}):
            pack = self.client.post("/api/v1/matches", json=_v2(_range())).json()
        self.assertEqual((pack["sort"], pack["valueAreas"]), ("score", 1))

        def broken(home_type):
            raise OSError("database is down")

        with mock.patch.object(app_module, "load_match_evidence", lambda profile, regions=None: rows), \
                mock.patch.object(app_module, "_good_value_rows", broken), \
                mock.patch.object(app_module.repository, "area_titles", lambda: {}):
            response = self.client.post("/api/v1/matches", json=_v2(_range()))
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("valueAreas", response.json())

    def test_criterion_values(self):
        payload = {"schemaVersion": "match-criterion-values.v1", "layer": "noise", "unit": "%", "sourceReleaseIds": ["n"],
                   "values": [{"geographyId": _lsoa(1), "value": 12.5, "regionPercentile": 40.0}]}
        with mock.patch.object(app_module.repository, "criterion_values", lambda layer: payload):
            response = self.client.get("/api/v1/match-criteria/noise")
        # The deprecated name rides along with the same value (contract_aliases), with the RFC headers.
        self.assertEqual(response.json(), {**payload, "values": [{**payload["values"][0], "londonPercentile": 40.0}]})
        self.assertEqual(response.headers["deprecation"], "@1792972800")
        self.assertNotIn("sunset", response.headers)  # no date until the extension with the new names ships
        self.assertEqual(self.client.get("/api/v1/match-criteria/census-religion-muslim").status_code, 400)
        with mock.patch.object(app_module.repository, "criterion_values", lambda layer: {**payload, "values": []}):
            self.assertEqual(self.client.get("/api/v1/match-criteria/nothing").status_code, 404)


if __name__ == "__main__":
    unittest.main()
