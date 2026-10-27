import json
import unittest

from area_analytics.value_pack import build_value_pack


class ValuePackTests(unittest.TestCase):
    def test_source_manifest_requires_attribution_transform_and_caveats(self):
        with self.assertRaisesRegex(ValueError, "source provenance missing"):
            build_value_pack(
                metric_id="crime",
                period="2026-06",
                source={
                    "id": "police-uk",
                    "release": "2026-06",
                    "url": "https://data.police.uk/",
                    "sha256": "abc123",
                    "licence": "OGL-3.0",
                },
                values=[],
            )

    def test_pack_is_sorted_versioned_and_carries_provenance(self):
        pack = build_value_pack(
            metric_id="crime",
            period="2026-06",
            source={
                "id": "police-uk",
                "release": "2026-06",
                "url": "https://data.police.uk/",
                "sha256": "a" * 64,
                "licence": "OGL-3.0",
                "attribution": "Contains public sector information licensed under OGL v3.0",
                "transformationVersion": "crime-v1",
                "retrievedAt": "2026-09-03T10:00:00Z",
                "geographyVintage": "2021",
                "validationStatus": "passed",
                "caveats": ["Locations are anonymised."],
            },
            values=[
                {"geographyId": "uk:lsoa:E01000002", "value": 20},
                {"geographyId": "uk:lsoa:E01000001", "value": 10},
            ],
        )

        encoded = json.dumps(pack, separators=(",", ":"), sort_keys=True)

        self.assertEqual(pack["schemaVersion"], "area-value-pack.v1")
        self.assertEqual(pack["values"][0]["geographyId"], "uk:lsoa:E01000001")
        self.assertIn('"sha256":"' + "a" * 64 + '"', encoded)

    def test_manifest_rejects_an_unvalidated_release(self):
        source = {
            "id": "police-uk", "release": "2026-06", "url": "https://data.police.uk/",
            "sha256": "a" * 64, "licence": "OGL-3.0", "attribution": "Police.uk",
            "transformationVersion": "crime-v1", "retrievedAt": "2026-09-03T10:00:00Z",
            "geographyVintage": "2021", "validationStatus": "failed", "caveats": [],
        }

        with self.assertRaisesRegex(ValueError, "validation status"):
            build_value_pack("crime", "2026-06", source, [])


if __name__ == "__main__":
    unittest.main()
