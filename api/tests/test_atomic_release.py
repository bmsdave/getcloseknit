import json
import threading
import unittest

from area_api.repository import EVIDENCE_SQL, ReleaseActivationError, ReleaseStore


OLD_RELEASE = "release-2026-06"
NEW_RELEASE = "release-2026-07"
OLD_CRIME = "police-2026-06"
NEW_CRIME = "police-2026-07"


def make_manifest(release_id, crime_release, status="passed"):
    return {
        "id": release_id,
        "geographyVintage": "2021",
        "transformationVersions": {"crime": "crime-v1"},
        "members": [
            {
                "source": "police-uk",
                "release": crime_release,
                "validationStatus": "passed",
                "cadence": "monthly",
            },
        ],
        "assets": ["tiles/crime-2026-06.pmtiles"],
        "validationStatus": status,
        "validationRecord": {"checks": ["schema", "geography"], "passed": True},
    }


def make_rows(release_id, crime_release):
    return [
        {
            "geography_id": "uk:lsoa:E01000001",
            "factor_id": "crime",
            "source_release_id": crime_release,
            "product_release_id": release_id,
        },
        {
            "geography_id": "uk:lsoa:E01000002",
            "factor_id": "crime",
            "source_release_id": crime_release,
            "product_release_id": release_id,
        },
    ]


def stage_active(store, release_id=OLD_RELEASE, crime_release=OLD_CRIME):
    store.stage_release(make_manifest(release_id, crime_release))
    store.attach_evidence(release_id, make_rows(release_id, crime_release))
    store.activate_release(release_id)


class AtomicReleaseTests(unittest.TestCase):
    def test_interrupted_import_leaves_active_release_untouched(self):
        store = ReleaseStore()
        stage_active(store)
        chunks = [make_rows(NEW_RELEASE, NEW_CRIME)[:1], make_rows(NEW_RELEASE, NEW_CRIME)[1:]]

        with self.assertRaisesRegex(ReleaseActivationError, "interrupted"):
            store.import_release(make_manifest(NEW_RELEASE, NEW_CRIME), chunks, fail_at=1)

        self.assertEqual(store.active_release_id(), OLD_RELEASE)
        with self.assertRaises(ReleaseActivationError):
            store.read_release(NEW_RELEASE)

    def test_failed_validation_blocks_activation(self):
        store = ReleaseStore()
        stage_active(store)
        store.stage_release(make_manifest("release-bad", "police-2026-08", status="failed"))

        with self.assertRaisesRegex(ReleaseActivationError, "validation"):
            store.activate_release("release-bad")

        self.assertEqual(store.active_release_id(), OLD_RELEASE)

    def test_concurrent_activation_stays_single_release_per_read(self):
        store = ReleaseStore()
        stage_active(store)
        store.stage_release(make_manifest(NEW_RELEASE, NEW_CRIME))
        store.attach_evidence(NEW_RELEASE, make_rows(NEW_RELEASE, NEW_CRIME))
        store.stage_release(make_manifest("release-2026-08", "police-2026-08"))
        store.attach_evidence("release-2026-08", make_rows("release-2026-08", "police-2026-08"))
        barrier = threading.Barrier(3)
        failures = []

        def activate(release_id):
            barrier.wait()
            store.activate_release(release_id)

        def read_while_switching():
            barrier.wait()
            for _ in range(50):
                try:
                    snapshot = store.begin_read().fetch()
                    releases = {row["product_release_id"] for row in snapshot}
                    if len(releases) != 1:
                        failures.append(f"mixed read: {sorted(releases)}")
                except ReleaseActivationError as error:
                    failures.append(str(error))

        threads = [
            threading.Thread(target=activate, args=(NEW_RELEASE,)),
            threading.Thread(target=activate, args=("release-2026-08",)),
            threading.Thread(target=read_while_switching),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(failures, [])
        self.assertEqual(len(store.activation_log()), 3)
        self.assertIn(store.active_release_id(), (NEW_RELEASE, "release-2026-08"))

    def test_reader_spanning_update_sees_one_complete_release(self):
        store = ReleaseStore()
        stage_active(store)
        store.stage_release(make_manifest(NEW_RELEASE, NEW_CRIME))
        store.attach_evidence(NEW_RELEASE, make_rows(NEW_RELEASE, NEW_CRIME))

        snapshot = store.begin_read()
        store.activate_release(NEW_RELEASE)
        rows = snapshot.fetch()

        releases = {row["product_release_id"] for row in rows}
        self.assertEqual(len(releases), 1)
        self.assertIn(releases.pop(), (OLD_RELEASE, NEW_RELEASE))
        self.assertEqual(len(rows), 2)

    def test_rollback_restores_previous_release_intact(self):
        store = ReleaseStore()
        stage_active(store)
        store.stage_release(make_manifest(NEW_RELEASE, NEW_CRIME))
        store.attach_evidence(NEW_RELEASE, make_rows(NEW_RELEASE, NEW_CRIME))
        store.activate_release(NEW_RELEASE)

        record = store.rollback()

        self.assertEqual(record["release_id"], OLD_RELEASE)
        self.assertEqual(store.active_release_id(), OLD_RELEASE)
        self.assertEqual(len(store.read_release(NEW_RELEASE).fetch()), 2)

    def test_rollback_without_previous_release_fails(self):
        store = ReleaseStore()
        stage_active(store)

        with self.assertRaisesRegex(ReleaseActivationError, "previous"):
            store.rollback()

    def test_release_identifier_survives_shared_link_reload(self):
        store = ReleaseStore()
        stage_active(store)
        snapshot = store.begin_read()
        shared_link = json.loads(json.dumps(snapshot.to_shared_link()))

        reloaded = store.read_release(shared_link["productReleaseId"]).fetch()

        self.assertEqual(shared_link["productReleaseId"], OLD_RELEASE)
        self.assertEqual(reloaded, snapshot.fetch())

    def test_evidence_reads_pin_to_active_release_membership(self):
        self.assertIn("active_product_release", EVIDENCE_SQL)
        self.assertIn("product_release_member", EVIDENCE_SQL)
        self.assertIn("product_release_id", EVIDENCE_SQL)
        self.assertNotIn("DISTINCT ON", EVIDENCE_SQL)


if __name__ == "__main__":
    unittest.main()
