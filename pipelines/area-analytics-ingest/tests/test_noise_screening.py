"""AE-24 noise-screening tests: failing first per the common acceptance gate.

Covers incompatible noise units, a gap between mapped road corridors, an
out-of-coverage location, and the guardrails that keep this pilot honest:
absence of mapped noise is never a quietness guarantee, modelled strategic
exposure is distinct from a live measurement, and no speculative nuisance
score exists. Spatial joins are validated against the small reviewed
reference fixture, not inline copies of its geometry.
"""

import unittest
from pathlib import Path

FIXTURE = (
    Path(__file__).parent / "fixtures" / "noise" / "defra-road-sample.geojson"
)


def load_reference():
    from area_analytics.noise_screening import (
        NoiseCorridor,
        NoiseCoverage,
        load_reference_sample,
    )

    return load_reference_sample(FIXTURE)


class NoiseScreeningJoinTests(unittest.TestCase):
    def test_incompatible_units_are_rejected(self):
        from area_analytics.noise_screening import assess_location

        sample = load_reference()
        for unit in ("ug/m3", "dB Lden", "dB"):
            with self.subTest(unit=unit), self.assertRaisesRegex(
                ValueError, "incompatible.*unit"
            ):
                assess_location(
                    -0.14, 51.50, sample.corridors, sample.coverage, unit=unit
                )

    def test_reviewed_units_assess_the_same_point(self):
        from area_analytics.noise_screening import assess_location

        sample = load_reference()
        for unit in ("dB LAeq,16h", "dB Lnight"):
            with self.subTest(unit=unit):
                result = assess_location(
                    -0.14, 51.50, sample.corridors, sample.coverage, unit=unit
                )
                self.assertEqual(result.status, "mapped-exposure")
                self.assertEqual(result.unit, unit)
                self.assertEqual(result.corridor, "road-corridor-a")

    def test_boundary_location_counts_as_mapped(self):
        from area_analytics.noise_screening import assess_location

        sample = load_reference()
        result = assess_location(-0.17, 51.505, sample.corridors,
                                 sample.coverage)

        self.assertEqual(result.status, "mapped-exposure")
        self.assertEqual(result.method, "modelled")

    def test_gap_between_corridors_is_not_a_quietness_guarantee(self):
        from area_analytics.noise_screening import assess_location

        sample = load_reference()
        result = assess_location(-0.105, 51.505, sample.corridors,
                                 sample.coverage)

        self.assertEqual(result.status, "no-mapped-exposure")
        self.assertIsNone(result.corridor)
        self.assertIn("not a quietness guarantee",
                      result.explanation.lower())
        self.assertIn("modelled", result.explanation.lower())

    def test_out_of_coverage_is_distinct_from_a_corridor_gap(self):
        from area_analytics.noise_screening import assess_location

        sample = load_reference()
        outside = assess_location(-0.30, 51.51, sample.corridors,
                                  sample.coverage)
        gap = assess_location(-0.105, 51.505, sample.corridors,
                              sample.coverage)

        self.assertEqual(outside.status, "no-coverage")
        self.assertEqual(gap.status, "no-mapped-exposure")
        self.assertNotEqual(outside.status, gap.status)
        self.assertIn("coverage", outside.explanation.lower())


class NoiseScreeningGuardrailTests(unittest.TestCase):
    def test_registry_records_model_type_units_dates_and_resolution(self):
        from area_analytics.sources import source_definition

        source = source_definition("defra-strategic-road-noise")

        for field in ("purpose", "scenario", "resolution",
                      "publication_date", "coverage"):
            self.assertTrue(getattr(source, field), field)
        combined = " ".join((
            source.purpose, source.scenario, source.resolution,
            source.publication_date, source.coverage,
        )).lower()
        self.assertIn("modelled", combined)
        self.assertIn("db laeq,16h", combined)
        self.assertIn("aircraft", combined)

    def test_modelled_exposure_is_distinct_from_a_live_measurement(self):
        from area_analytics.noise_screening import describe_reading_kind

        modelled = describe_reading_kind("modelled")
        measured = describe_reading_kind("measured")

        self.assertIn("strategic", modelled.lower())
        self.assertNotIn("live", modelled.lower())
        self.assertIn("live", measured.lower())
        self.assertNotEqual(modelled, measured)
        with self.assertRaisesRegex(ValueError, "unknown reading kind"):
            describe_reading_kind("satellite")

    def test_speculative_nuisance_scores_are_unsupported(self):
        from area_analytics.noise_screening import estimate_nuisance_score

        sample = load_reference()
        with self.assertRaisesRegex(ValueError, "unsupported"):
            estimate_nuisance_score(
                (-0.14, 51.50), sample.corridors, sample.coverage
            )

    def test_no_single_generic_nuisance_score_exists(self):
        import area_analytics.noise_screening as screening

        self.assertFalse(hasattr(screening, "nuisance_score"))
        self.assertFalse(hasattr(screening, "nuisanceScore"))

    def test_visit_prompts_follow_concerns_not_unrelated_topics(self):
        from area_analytics.noise_screening import visit_prompts

        prompts = visit_prompts(["evening-noise", "lease-length"])
        slots = [prompt.slot for prompt in prompts]

        self.assertIn("evening", slots)
        self.assertNotIn("weekend", slots)
        self.assertNotIn("event-day", slots)
        full = visit_prompts(["evening-noise", "weekend-noise",
                              "event-day"])
        self.assertEqual(
            sorted(prompt.slot for prompt in full),
            ["evening", "event-day", "weekend"],
        )
        self.assertEqual(visit_prompts(["lease-length"]), ())
        self.assertEqual(visit_prompts([]), ())


if __name__ == "__main__":
    unittest.main()
