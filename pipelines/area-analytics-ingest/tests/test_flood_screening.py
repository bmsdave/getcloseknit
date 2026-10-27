"""AE-23 flood-screening tests: failing first per the common acceptance gate.

Covers a boundary location, overlapping mechanisms, an out-of-coverage
location, and a coarse area with a small exposed section. Spatial joins
are validated against the small reviewed reference fixture, not inline
copies of its geometry.
"""

import json
import unittest
from pathlib import Path

FIXTURE = (
    Path(__file__).parent / "fixtures" / "flood" / "ea-rofrs-sample.geojson"
)


def load_reference():
    from area_analytics.flood_screening import (
        ScreeningCoverage,
        ScreeningZone,
        load_reference_sample,
    )

    return load_reference_sample(FIXTURE)


class FloodScreeningJoinTests(unittest.TestCase):
    def test_boundary_location_counts_as_exposed(self):
        from area_analytics.flood_screening import assess_location

        sample = load_reference()
        result = assess_location(-0.17, 51.505, sample.zones, sample.coverage)

        self.assertEqual(result.status, "exposed")
        self.assertTrue(
            any(
                zone == "rivers-sea" and intersected
                for zone, intersected in result.intersections
            )
        )

    def test_overlapping_mechanisms_stay_separately_named(self):
        from area_analytics.flood_screening import assess_location

        sample = load_reference()
        result = assess_location(-0.13, 51.51, sample.zones, sample.coverage)

        self.assertEqual(result.status, "exposed")
        names = [zone for zone, hit in result.intersections if hit]
        self.assertEqual(sorted(names), ["rivers-sea", "surface-water"])
        self.assertIn("surface-water", result.explanation)
        self.assertNotIn("flood score", result.explanation.lower())

    def test_out_of_coverage_is_distinct_from_no_mapped_exposure(self):
        from area_analytics.flood_screening import assess_location

        sample = load_reference()
        outside = assess_location(-0.30, 51.51, sample.zones, sample.coverage)
        inside_clear = assess_location(
            -0.07, 51.55, sample.zones, sample.coverage
        )

        self.assertEqual(outside.status, "no-coverage")
        self.assertEqual(inside_clear.status, "no-mapped-exposure")
        self.assertNotEqual(outside.status, inside_clear.status)
        self.assertIn("coverage", outside.explanation.lower())

    def test_coarse_area_with_small_exposed_section(self):
        from area_analytics.flood_screening import assess_area

        sample = load_reference()
        coarse = [
            (-0.25, 51.45), (0.05, 51.45), (0.05, 51.60),
            (-0.25, 51.60), (-0.25, 51.45),
        ]
        result = assess_area(coarse, sample.zones, sample.coverage)

        self.assertEqual(result.semantics, "area-exposure")
        rivers = result.exposures["rivers-sea"]
        self.assertGreater(rivers, 0)
        self.assertLess(rivers, 0.1)
        self.assertAlmostEqual(rivers, 0.04, places=3)
        self.assertIn("coarse", result.explanation.lower())
        self.assertIn("building", result.explanation.lower())

    def test_spatial_joins_match_the_reviewed_reference_fixture(self):
        raw = json.loads(FIXTURE.read_text())
        sample = load_reference()

        self.assertEqual(sample.source_id, raw["source_id"])
        self.assertEqual(len(sample.zones), len(raw["mechanisms"]))
        for zone, mechanism in zip(sample.zones, raw["mechanisms"]):
            self.assertEqual(zone.name, mechanism["name"])
            self.assertEqual(
                zone.ring, tuple(tuple(point) for point in
                                 mechanism["geometry"]["coordinates"][0])
            )


class FloodScreeningGuardrailTests(unittest.TestCase):
    def test_registry_records_dataset_purpose_and_limits(self):
        from area_analytics.sources import source_definition

        source = source_definition("ea-flood-risk-rivers-sea")

        for field in ("purpose", "scenario", "resolution",
                      "publication_date", "coverage"):
            self.assertTrue(getattr(source, field), field)
        combined = " ".join((
            source.purpose, source.scenario, source.resolution,
            source.publication_date, source.coverage,
        )).lower()
        self.assertIn("rivers and sea", combined)
        self.assertIn("insurance", combined)

    def test_insurance_cost_prediction_is_unsupported(self):
        from area_analytics.flood_screening import estimate_insurance_cost

        sample = load_reference()
        with self.assertRaisesRegex(ValueError, "unsupported"):
            estimate_insurance_cost(
                (-0.13, 51.51), sample.zones, sample.coverage
            )

    def test_no_single_generic_flood_score_exists(self):
        import area_analytics.flood_screening as screening

        self.assertFalse(hasattr(screening, "flood_score"))
        self.assertFalse(hasattr(screening, "floodScore"))


if __name__ == "__main__":
    unittest.main()
