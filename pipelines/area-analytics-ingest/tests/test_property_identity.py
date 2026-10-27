"""AE-11 property identity + EPC linkage: failing-first acceptance tests.

Deterministic government-shaped fixtures only; no live publishers.
Each test pins one clause of the task: typed identity records, flats
kept separate, ambiguous matches left unresolved, postcode changes,
superseded certificates, absent UPRNs, missing floor area, no
room-to-bedroom mapping, reviewed-sample precision/coverage (never the
research 79%), identity basis on joined fields, and stable deep links
through identity migration.
"""

import unittest

from area_analytics.property_identity import (
    address_aliases,
    bedrooms_from_epc,
    build_epc_snapshot,
    build_identities,
    epc_label,
    identity_deep_link,
    link_identity_epc,
    measure_match_quality,
    normalize_address,
    parse_epc_row,
    resolve_identity_link,
)


FLAT_A = {
    "transactionId": "TXN-FLAT-A",
    "saon": "Flat 1",
    "paon": "10",
    "street": "Downing Street",
    "locality": "Westminster",
    "town": "LONDON",
    "postcode": "SW1A 1AA",
    "propertyType": "F",
    "uprnLink": "100012345678",
    "uprnVerified": True,
}

FLAT_B = {
    "transactionId": "TXN-FLAT-B",
    "saon": "Flat 2",
    "paon": "10",
    "street": "Downing Street",
    "locality": "Westminster",
    "town": "LONDON",
    "postcode": "SW1A 1AA",
    "propertyType": "F",
    "uprnLink": "100012345679",
    "uprnVerified": True,
}

EPC_FLAT_A = {
    "certificateId": "EPC-AAAA-0001",
    "uprn": "100012345678",
    "saon": "Flat 1",
    "paon": "10",
    "street": "Downing Street",
    "town": "LONDON",
    "postcode": "SW1A 1AA",
    "lodgementDate": "2023-05-01",
    "inspectionDate": "2023-04-20",
    "transactionType": "domestic",
    "energyRating": "C",
    "energyPoints": 72,
    "floorAreaSqm": 58.5,
    "habitableRooms": 3,
}


def epc_row(**overrides):
    row = dict(EPC_FLAT_A)
    row.update(overrides)
    return row


class IdentityRecordTests(unittest.TestCase):
    def test_identity_preserves_publisher_ids_and_verified_uprn(self):
        identities = build_identities([FLAT_A])

        self.assertEqual(len(identities), 1)
        identity = identities[0]
        self.assertIn("TXN-FLAT-A", identity.publisher_ids)
        self.assertEqual(identity.verified_uprn, "100012345678")
        self.assertEqual(identity.match_method, "verified-uprn")
        self.assertEqual(identity.conflicts, ())

    def test_two_flats_sharing_building_address_stay_separate(self):
        identities = build_identities([FLAT_A, FLAT_B])
        by_uprn = {item.verified_uprn for item in identities}

        self.assertEqual(len(identities), 2)
        self.assertEqual(by_uprn, {"100012345678", "100012345679"})

    def test_ambiguous_address_match_stays_unresolved(self):
        first = dict(FLAT_A, transactionId="TXN-X1",
                     uprnLink="", uprnVerified=False)
        second = dict(FLAT_A, transactionId="TXN-X2",
                      uprnLink="", uprnVerified=False)
        first.pop("saon")
        second.pop("saon")

        identities = build_identities([first, second])

        self.assertEqual(len(identities), 2)
        for identity in identities:
            self.assertEqual(identity.match_method, "unresolved")
            self.assertLess(identity.confidence, 0.5)
            self.assertTrue(identity.conflicts)

    def test_changed_postcode_keeps_one_identity_with_aliases(self):
        moved = dict(FLAT_A, transactionId="TXN-FLAT-A2",
                     postcode="SW1A 1AB")

        identities = build_identities([FLAT_A, moved])

        self.assertEqual(len(identities), 1)
        aliases = identities[0].address_aliases
        self.assertTrue(any("SW1A 1AA" in alias for alias in aliases))
        self.assertTrue(any("SW1A 1AB" in alias for alias in aliases))

    def test_absent_uprn_never_claims_verified_method(self):
        record = dict(FLAT_A, transactionId="TXN-NO-UPRN",
                      uprnLink="", uprnVerified=False)

        (identity,) = build_identities([record])

        self.assertIsNone(identity.verified_uprn)
        self.assertNotEqual(identity.match_method, "verified-uprn")
        self.assertLessEqual(identity.confidence, 0.7)

    def test_normalize_address_folds_punctuation_variants(self):
        self.assertEqual(
            normalize_address("10, Downing St."),
            normalize_address("10 Downing Street"),
        )
        self.assertEqual(
            address_aliases(FLAT_A),
            address_aliases(dict(FLAT_A, street="Downing St.",
                                 postcode="sw1a 1aa")),
        )


class EpcIngestTests(unittest.TestCase):
    def test_epc_row_preserves_task_fields(self):
        record = parse_epc_row(EPC_FLAT_A)

        self.assertEqual(record.certificate_id, "EPC-AAAA-0001")
        self.assertEqual(record.lodgement_date, "2023-05-01")
        self.assertEqual(record.floor_area_sqm, 58.5)
        self.assertEqual(record.energy_points, 72)
        self.assertEqual(record.energy_rating, "C")

    def test_superseded_certificate_is_replaced_with_history(self):
        newer = epc_row(certificateId="EPC-AAAA-0002",
                        lodgementDate="2024-06-01", energyPoints=78,
                        energyRating="B")
        snapshot = build_epc_snapshot([EPC_FLAT_A, newer])
        current = snapshot["current"]["100012345678"]

        self.assertEqual(current["certificateId"], "EPC-AAAA-0002")
        self.assertEqual(current["replacementStatus"], "current")
        history = snapshot["history"]["100012345678"]
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["certificateId"], "EPC-AAAA-0001")
        self.assertEqual(history[0]["replacementStatus"], "superseded")

    def test_missing_floor_area_is_not_invented(self):
        record = parse_epc_row(epc_row(floorAreaSqm=""))

        self.assertIsNone(record.floor_area_sqm)
        snapshot = build_epc_snapshot([epc_row(floorAreaSqm="")])

        self.assertIsNone(
            snapshot["current"]["100012345678"]["floorAreaSqm"])

    def test_habitable_rooms_are_never_mapped_to_bedrooms(self):
        record = parse_epc_row(EPC_FLAT_A)

        self.assertEqual(record.habitable_rooms, 3)
        with self.assertRaises(ValueError):
            bedrooms_from_epc(record)

    def test_non_domestic_rows_are_quarantined(self):
        snapshot = build_epc_snapshot(
            [epc_row(transactionType="non-domestic")])

        self.assertEqual(snapshot["current"], {})
        self.assertEqual(len(snapshot["quarantine"]), 1)

    def test_epc_label_names_domestic_source(self):
        self.assertIn("domestic", epc_label().lower())


class LinkageTests(unittest.TestCase):
    def test_joined_fields_expose_identity_basis(self):
        identities = build_identities([FLAT_A, FLAT_B])
        snapshot = build_epc_snapshot([EPC_FLAT_A])

        joined = link_identity_epc(identities, snapshot)

        matched = [item for item in joined
                   if item["identityId"] == identities[0].identity_id]
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]["epc"]["certificateId"],
                         "EPC-AAAA-0001")
        self.assertEqual(matched[0]["epc"]["identityBasis"],
                         "verified-uprn")
        unmatched = [item for item in joined
                     if item["identityId"] == identities[1].identity_id]
        self.assertIsNone(unmatched[0]["epc"])

    def test_ambiguous_identities_do_not_receive_epc(self):
        first = dict(FLAT_A, transactionId="TXN-X1",
                     uprnLink="", uprnVerified=False)
        second = dict(FLAT_A, transactionId="TXN-X2",
                      uprnLink="", uprnVerified=False)
        first.pop("saon")
        second.pop("saon")
        identities = build_identities([first, second])
        snapshot = build_epc_snapshot([EPC_FLAT_A])

        joined = link_identity_epc(identities, snapshot)

        self.assertTrue(all(item["epc"] is None for item in joined))


class MatchQualityTests(unittest.TestCase):
    def test_precision_and_coverage_come_from_reviewed_sample(self):
        sample = [
            {"identityId": "id-1", "predicted": "m1",
             "expected": "m1", "propertyType": "F",
             "geography": "E09000033"},
            {"identityId": "id-2", "predicted": "m2",
             "expected": "m2", "propertyType": "F",
             "geography": "E09000033"},
            {"identityId": "id-3", "predicted": "m3",
             "expected": "other", "propertyType": "T",
             "geography": "E09000028"},
            {"identityId": "id-4", "predicted": None,
             "expected": "m4", "propertyType": "T",
             "geography": "E09000028"},
        ]

        quality = measure_match_quality(sample, reviewed_count=4)

        self.assertAlmostEqual(quality["precision"], 2 / 3)
        self.assertAlmostEqual(quality["coverage"], 2 / 4)
        self.assertEqual(quality["reviewedSample"], 4)
        self.assertIn("F", quality["coverageByPropertyType"])
        self.assertIn("E09000033", quality["coverageByGeography"])
        self.assertNotIn("linkageRate", quality)


class DeepLinkTests(unittest.TestCase):
    def test_deep_link_survives_identity_migration(self):
        identities = build_identities([FLAT_A])
        old_id = identities[0].identity_id
        link = identity_deep_link(old_id)
        migrated = build_identities(
            [FLAT_A], previous_ids={old_id: "prop-uprn-100012345678"})

        self.assertEqual(
            resolve_identity_link(link, {old_id: migrated[0].identity_id}),
            identity_deep_link(migrated[0].identity_id),
        )

    def test_unknown_link_resolves_to_unavailable(self):
        self.assertIsNone(resolve_identity_link("/properties/unknown", {}))


if __name__ == "__main__":
    unittest.main()
