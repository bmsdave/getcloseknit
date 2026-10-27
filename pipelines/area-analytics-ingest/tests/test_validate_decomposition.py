import unittest

from area_analytics.validate_decomposition_cli import score


def _pair(later_price, index_only, steps):
    return {
        "propertyId": "uk:property:SW1A1AA:1-PARLIAMENT-PREVIEW",
        "laterPrice": later_price,
        "indexOnlyPrediction": index_only,
        "floorAreaSquareMetres": 50.0,
        "baseline": {"label": "London median", "medianPricePerSquareMetre": 6_000, "sampleCount": 120_000},
        "steps": steps,
    }


def _step(median, sample_count=500):
    return {"label": "This MSOA", "medianPricePerSquareMetre": median, "sampleCount": sample_count}


class ValidationTests(unittest.TestCase):
    def test_a_decomposition_closer_than_the_index_passes(self):
        report = score([
            _pair(500_000, 460_000, [_step(9_900)]),
            _pair(500_000, 540_000, [_step(10_100)]),
        ])

        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["medianAbsolutePercentageError"]["decomposition"], 1.0)
        self.assertEqual(report["medianAbsolutePercentageError"]["indexOnly"], 8.0)
        self.assertEqual(report["pairs"], 2)

    def test_a_decomposition_no_better_than_the_index_fails_rather_than_ships(self):
        report = score([
            _pair(500_000, 505_000, [_step(8_000)]),
            _pair(500_000, 495_000, [_step(12_000)]),
        ])

        self.assertEqual(report["status"], "failed")

    def test_a_thin_step_never_silently_improves_the_score(self):
        report = score([_pair(500_000, 505_000, [_step(9_900, sample_count=3)])])

        self.assertEqual(report["medianAbsolutePercentageError"]["decomposition"], 40.0)

    def test_scoring_nothing_is_refused_rather_than_reported_as_a_pass(self):
        with self.assertRaises(ValueError):
            score([])


if __name__ == "__main__":
    unittest.main()
