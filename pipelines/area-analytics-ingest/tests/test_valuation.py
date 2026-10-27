import json
import unittest

from area_analytics import valuation
from area_analytics.valuation import (
    MIN_CALIBRATION_N,
    MIN_HELD_OUT_N,
    MIN_REFERENCE_GROUP_N,
    apply_interval,
    build_valuation_estimate,
    calibrate_interval,
    describe_reference_steps,
    evaluate_backtest,
    reference_group_median,
    sensitivity_band,
)


def _sale(tx, price, month, tenure="F", ptype="T", identity="prop-1"):
    return {
        "transactionId": tx,
        "price": price,
        "saleMonth": month,
        "saleDate": f"{month}-15",
        "tenure": tenure,
        "propertyType": ptype,
        "identityId": identity,
    }


def _group(name, prices, prefix, month="2023-06"):
    return {
        "name": name,
        "transactions": [
            _sale(f"{prefix}-{index}", price, month, identity=f"{prefix}-{index}")
            for index, price in enumerate(prices)
        ],
    }


def _wording_scan(payload):
    return json.dumps(payload, sort_keys=True).lower()


class ReferenceStepsTests(unittest.TestCase):
    def test_sparse_peer_group_keeps_arithmetic_but_flags_validity(self):
        group = _group("Flats nearby", [500000, 520000], "sparse")
        median = reference_group_median(group["transactions"])
        self.assertEqual(median["median"], 510000)
        self.assertEqual(median["n"], 2)
        report = describe_reference_steps(500000, [group])
        step = report["steps"][0]
        self.assertEqual(step["median"], 510000)
        self.assertTrue(step["insufficient"])
        self.assertIn("reference group", step["validityNote"].lower())

    def test_adequate_group_passes_validity(self):
        group = _group("Terraces nearby", [500000] * 6, "ok")
        report = describe_reference_steps(500000, [group])
        self.assertFalse(report["steps"][0]["insufficient"])
        self.assertEqual(report["steps"][0]["n"], 6)

    def test_overlapping_groups_disclose_shared_transactions(self):
        first = _group("Street sales", [500000, 510000, 520000,
                                        530000, 540000], "ov-a")
        shared = list(first["transactions"][:2])
        second = {
            "name": "Wider area sales",
            "transactions": shared + [
                _sale(f"ov-b-{index}", 600000 + index, "2023-06",
                      identity=f"ov-b-{index}")
                for index in range(4)
            ],
        }
        report = describe_reference_steps(500000, [first, second])
        overlap = report["steps"][1]["sampleOverlap"]
        self.assertEqual(overlap["sharedCount"], 2)
        self.assertEqual(sorted(overlap["sharedWithPrevious"]),
                         sorted(item["transactionId"] for item in shared))

    def test_reordered_steps_change_path_and_disclose_ordering(self):
        low = _group("Lower band", [480000] * 5, "lo")
        high = _group("Higher band", [520000] * 5, "hi")
        forward = describe_reference_steps(500000, [low, high])
        backward = describe_reference_steps(500000, [high, low])
        self.assertNotEqual(
            [step["cumulative"] for step in forward["steps"]],
            [step["cumulative"] for step in backward["steps"]])
        for report in (forward, backward):
            self.assertEqual(report["finalReference"],
                             report["steps"][-1]["cumulative"])
            self.assertIn("presentational", report["orderingNote"].lower())
            for step in report["steps"]:
                self.assertEqual(step["kindOf"], "descriptive-comparison")
                self.assertIn("omitted", step["omittedDriversNote"].lower())

    def test_steps_carry_no_weights_and_no_causal_labels(self):
        group = _group("Terraces nearby", [500000] * 5, "wt")
        report = describe_reference_steps(500000, [group])
        for step in report["steps"]:
            self.assertNotIn("weight", step)
            self.assertNotIn("weight", step.get("label", "").lower())
        self.assertNotIn("premium", _wording_scan(report))


class IntervalTests(unittest.TestCase):
    def test_heuristic_band_is_not_a_prediction_interval(self):
        band = sensitivity_band(500000, 0.1)
        self.assertEqual(band["lower"], 450000)
        self.assertEqual(band["upper"], 550000)
        self.assertEqual(band["kind"], "heuristic-sensitivity-band")
        self.assertIn("not a calibrated prediction interval",
                      band["interpretation"].lower())

    def test_small_error_sample_stays_uncalibrated(self):
        result = calibrate_interval([0.01, -0.02, 0.03], level=0.8)
        self.assertEqual(result["status"], "uncalibrated")
        self.assertLess(result["n"], MIN_CALIBRATION_N)
        band = apply_interval(500000, result)
        self.assertEqual(band["status"], "uncalibrated")

    def test_calibrated_interval_states_level_and_basis(self):
        errors = [(index - 10) / 1000.0 for index in range(20)]
        result = calibrate_interval(errors, level=0.8)
        self.assertEqual(result["status"], "calibrated")
        self.assertEqual(result["level"], 0.8)
        self.assertEqual(result["n"], 20)
        band = apply_interval(500000, result)
        self.assertLess(band["lower"], 500000)
        self.assertGreater(band["upper"], 500000)
        self.assertIn("held-out", band["validationBasis"].lower())


class BacktestTests(unittest.TestCase):
    def _history(self):
        records = []
        for index in range(60):
            month = f"2023-{index % 12 + 1:02d}"
            price = 500000 + ((index * 137) % 11 - 5) * 4000
            records.append(_sale(
                f"train-{index}", price, month,
                tenure="F" if index % 2 else "L",
                ptype="T" if index % 3 else "F",
                identity=f"train-home-{index}"))
        for index in range(12):
            price = 505000 + ((index * 37) % 7 - 3) * 5000
            records.append(_sale(
                f"test-{index}", price, "2024-03",
                tenure="F" if index % 2 else "L",
                ptype="T" if index % 3 else "F",
                identity=f"test-home-{index}"))
        return records

    def test_backtest_reports_coverage_size_and_error_spread(self):
        report = evaluate_backtest(self._history(), "2024-01", level=0.8)
        self.assertEqual(report["status"], "complete")
        self.assertGreaterEqual(report["testN"], MIN_HELD_OUT_N)
        self.assertGreaterEqual(report["calibrationN"], MIN_CALIBRATION_N)
        self.assertGreaterEqual(report["coverage"], 0.0)
        self.assertLessEqual(report["coverage"], 1.0)
        spread = report["errorSpread"]
        for key in ("n", "medianSigned", "p10", "p90", "medianAbsolute"):
            self.assertIn(key, spread)
        self.assertEqual(spread["n"], report["testN"])

    def test_backtest_controls_spatial_leakage(self):
        records = [
            _sale("outlier", 900000, "2023-05", identity="leaked-home"),
            _sale("train-a", 500000, "2023-06", identity="home-a"),
            _sale("train-b", 510000, "2023-07", identity="home-b"),
            _sale("later", 505000, "2024-03", identity="leaked-home"),
        ]
        report = evaluate_backtest(records, "2024-01", level=0.8)
        self.assertEqual(report["leakageExcluded"], 1)
        self.assertNotIn("outlier", report["trainTransactionIds"])

    def test_backtest_splits_cover_tenure_type_band_density(self):
        report = evaluate_backtest(self._history(), "2024-01", level=0.8)
        splits = report["byGroup"]
        for field in ("tenure", "propertyType", "priceBand",
                      "evidenceDensity"):
            self.assertIn(field, splits)
            self.assertTrue(splits[field])
            for cell in splits[field].values():
                self.assertIn("n", cell)
                self.assertIn("coverage", cell)


class EstimateTests(unittest.TestCase):
    def _available_inputs(self):
        records = BacktestTests._history(self)
        backtest = evaluate_backtest(records, "2024-01", level=0.8)
        group = _group("Terraces nearby", [500000] * 6, "est")
        steps = describe_reference_steps(500000, [group])
        achieved = [_sale("own-1", 495000, "2022-04", identity="own-home")]
        return achieved, steps, backtest

    def test_achieved_transactions_lead_the_estimate(self):
        achieved, steps, backtest = self._available_inputs()
        estimate = build_valuation_estimate("own-home", achieved, 500000,
                                            steps, backtest)
        self.assertEqual(estimate["status"], "available")
        self.assertEqual(estimate["achievedSales"][0]["price"], 495000)
        self.assertIn("achieved", estimate["interpretation"].lower())

    def test_insufficient_validation_suppresses_estimate(self):
        achieved = [_sale("own-1", 495000, "2022-04", identity="own-home")]
        group = _group("Thin group", [500000, 510000], "thin")
        steps = describe_reference_steps(500000, [group])
        backtest = {"status": "insufficient",
                    "reason": "held-out sample too small",
                    "testN": 2, "calibrationN": 0}
        estimate = build_valuation_estimate("own-home", achieved, 500000,
                                            steps, backtest)
        self.assertEqual(estimate["status"], "unavailable")
        self.assertIn("validation", estimate["reason"].lower())

    def test_estimate_wording_avoids_premiums_and_confidence(self):
        achieved, steps, backtest = self._available_inputs()
        estimate = build_valuation_estimate("own-home", achieved, 500000,
                                            steps, backtest)
        scan = _wording_scan(estimate)
        for banned in ("premium", "confidence", "confident", "literature"):
            self.assertNotIn(banned, scan)
        negated = scan.replace("not causal", "").replace("non-causal", "")
        self.assertNotIn("causal", negated)


if __name__ == "__main__":
    unittest.main()
