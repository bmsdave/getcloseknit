import unittest

from area_analytics.decompose import ReferenceGroup, decompose, waterfall_total


LONDON = ReferenceGroup("London median", 6_449.0, 120_000)
STEPS = [
    ReferenceGroup("Westminster", 8_549.0, 4_100),
    ReferenceGroup("This MSOA", 9_029.0, 310),
    ReferenceGroup("Flats", 8_719.0, 260),
    ReferenceGroup("Small flats", 9_359.0, 92),
]


class DecompositionTests(unittest.TestCase):
    def test_the_waterfall_sums_to_the_estimate_it_explains(self):
        decomposition = decompose(54.0, LONDON, STEPS)

        self.assertEqual(waterfall_total(decomposition), decomposition.estimate)
        self.assertEqual(decomposition.estimate, round(9_359.0 * 54))
        self.assertEqual(decomposition.baseline_price, round(6_449.0 * 54))

    def test_each_contribution_is_the_distance_from_the_previous_group(self):
        decomposition = decompose(54.0, LONDON, STEPS)

        self.assertEqual(
            [contribution.price_per_square_metre for contribution in decomposition.contributions],
            [2_100.0, 480.0, -310.0, 640.0],
        )

    def test_a_thin_step_is_reported_rather_than_folded_into_its_neighbours(self):
        thin = ReferenceGroup("Age band", 9_509.0, 12)
        decomposition = decompose(54.0, LONDON, [*STEPS, thin])

        self.assertEqual([step.label for step in decomposition.skipped], ["Age band"])
        self.assertIn("below the 20-sale reliability gate", decomposition.skipped[0].reason)
        self.assertEqual(waterfall_total(decomposition), decomposition.estimate)

    def test_the_unattributed_part_of_an_observed_price_stays_visible(self):
        decomposition = decompose(54.0, LONDON, STEPS, observed_price=560_000)

        self.assertEqual(decomposition.residual, 560_000 - decomposition.estimate)

    def test_no_observation_leaves_the_residual_unstated_rather_than_zero(self):
        self.assertIsNone(decompose(54.0, LONDON, STEPS).residual)

    def test_a_thin_baseline_cannot_anchor_a_decomposition(self):
        with self.assertRaises(ValueError):
            decompose(54.0, ReferenceGroup("London median", 6_449.0, 4), STEPS)

    def test_a_property_without_floor_area_cannot_be_decomposed(self):
        with self.assertRaises(ValueError):
            decompose(0.0, LONDON, STEPS)


if __name__ == "__main__":
    unittest.main()
