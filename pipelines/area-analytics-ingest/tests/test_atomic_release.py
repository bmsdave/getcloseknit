import unittest

from area_analytics.value_pack import (
    assert_pack_in_release,
    build_value_pack,
    validate_release_manifest,
)


def make_member(source="police-uk", release="2026-06", cadence="monthly"):
    return {
        "source": source,
        "release": release,
        "url": "https://data.police.uk/",
        "sha256": "a" * 64,
        "licence": "OGL-3.0",
        "attribution": "Data.police.uk data, Home Office, OGL 3.0",
        "transformationVersion": "crime-v1",
        "retrievedAt": "2026-09-03T10:00:00Z",
        "geographyVintage": "2021",
        "validationStatus": "passed",
        "caveats": ["Locations are anonymised."],
        "cadence": cadence,
    }


def make_manifest(members=None, status="passed", **overrides):
    manifest = {
        "id": "release-2026-06",
        "geographyVintage": "2021",
        "transformationVersions": {"crime": "crime-v1"},
        "members": members if members is not None else [make_member()],
        "assets": ["tiles/crime-2026-06.pmtiles"],
        "validationStatus": status,
        "validationRecord": {"checks": ["schema", "geography"], "passed": True},
    }
    manifest.update(overrides)
    return manifest


def make_source():
    member = make_member()
    member.pop("cadence")
    member.pop("source")
    member["id"] = "police-uk"
    return member


class AtomicReleaseManifestTests(unittest.TestCase):
    def test_valid_manifest_validates(self):
        manifest = validate_release_manifest(make_manifest())

        self.assertEqual(manifest["id"], "release-2026-06")
        self.assertEqual(len(manifest["members"]), 1)

    def test_empty_members_rejected(self):
        with self.assertRaisesRegex(ValueError, "members"):
            validate_release_manifest(make_manifest(members=[]))

    def test_failed_member_blocks_release(self):
        member = make_member()
        member["validationStatus"] = "failed"

        with self.assertRaisesRegex(ValueError, "validation"):
            validate_release_manifest(make_manifest(members=[member]))

    def test_failed_manifest_status_blocks_release(self):
        with self.assertRaisesRegex(ValueError, "validation"):
            validate_release_manifest(make_manifest(status="failed"))

    def test_undocumented_mixed_cadences_rejected(self):
        members = [make_member(), make_member(source="ons-population", cadence="annual")]

        with self.assertRaisesRegex(ValueError, "[Cc]adence"):
            validate_release_manifest(make_manifest(members=members))

    def test_documented_mixed_cadences_allowed(self):
        members = [make_member(), make_member(source="ons-population", cadence="annual")]
        manifest = make_manifest(
            members=members,
            documentsMixedCadence=True,
            cadenceNote="Annual denominators pair with monthly crime.",
        )

        self.assertEqual(len(validate_release_manifest(manifest)["members"]), 2)

    def test_value_pack_pins_release_identifier(self):
        pack = build_value_pack("crime", "2026-06", make_source(), [], release_id="release-2026-06")

        self.assertEqual(pack["releaseId"], "release-2026-06")

    def test_value_pack_without_release_has_no_pin(self):
        pack = build_value_pack("crime", "2026-06", make_source(), [])

        self.assertNotIn("releaseId", pack)

    def test_pack_matching_manifest_membership_passes(self):
        manifest = make_manifest()
        pack = build_value_pack("crime", "2026-06", make_source(), [], release_id="release-2026-06")

        self.assertTrue(assert_pack_in_release(pack, manifest))

    def test_pack_from_another_release_rejected(self):
        manifest = make_manifest()
        pack = build_value_pack("crime", "2026-06", make_source(), [], release_id="release-2026-07")

        with self.assertRaisesRegex(ValueError, "[Rr]elease"):
            assert_pack_in_release(pack, manifest)


if __name__ == "__main__":
    unittest.main()
