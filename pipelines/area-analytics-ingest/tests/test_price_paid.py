"""AE-10 price-paid ingestion: failing-first acceptance tests.

Deterministic HMLR-shaped fixtures only; no live publishers.
Each test pins one clause of the task: field preservation, repeat
downloads, corrections, deletions, malformed money/date quarantine,
multiple sales of one address, late registrations, replay checksum
determinism, achieved-vs-asking distinction with a surfaced
publication period, and documented registration lag plus exclusions.
"""

import unittest

from area_analytics.price_paid import (
    EXCLUSIONS,
    PRICE_KIND,
    REGISTRATION_LAG_NOTE,
    build_price_snapshot,
    make_raw_release,
    parse_price_paid_row,
    price_label,
    snapshot_checksum,
)

HEADER = (
    "Transaction unique identifier,Price,Date of Transfer,Postcode,"
    "Property Type,Old/New,Duration,PAON,SAON,Street,Locality,"
    "Town/City,District,County,PPD Category Type,"
    "Record Status - monthly file only"
)

ROW_A = (
    "{txn},250000,2024-01-15 00:00,SW1A 1AA,D,N,F,"
    "10,,Downing Street,Westminster,LONDON,WESTMINSTER,"
    "GREATER LONDON,A,{status}"
)

ROW_B = (
    "{txn},310000,2024-02-20 00:00,SW1A 1AA,T,Y,L,"
    "11,,Downing Street,Westminster,LONDON,WESTMINSTER,"
    "GREATER LONDON,A,{status}"
)


def csv_text(*rows):
    return "\n".join([HEADER, *rows]) + "\n"


def release(release_id, retrieved_at, *rows):
    return make_raw_release(release_id, retrieved_at, csv_text(*rows))


class FieldPreservationTests(unittest.TestCase):
    def test_all_task_fields_preserved(self):
        record = parse_price_paid_row(_row_dict(ROW_A.format(txn="{T1}", status="A")))

        self.assertEqual(record.transaction_id, "{T1}")
        self.assertEqual(record.record_category, "A")
        self.assertEqual(record.record_status, "A")
        self.assertEqual(record.sale_date, "2024-01-15")
        self.assertEqual(record.price, 250000)
        self.assertEqual(record.postcode, "SW1A 1AA")
        self.assertEqual(record.property_type, "D")
        self.assertEqual(record.new_build, "N")
        self.assertEqual(record.tenure, "F")
        self.assertEqual(record.paon, "10")
        self.assertEqual(record.street, "Downing Street")
        self.assertEqual(record.locality, "Westminster")
        self.assertEqual(record.town, "LONDON")
        self.assertEqual(record.district, "WESTMINSTER")
        self.assertEqual(record.county, "GREATER LONDON")

    def test_category_b_preserved(self):
        row = _row_dict(ROW_A.format(txn="{T2}", status="A").replace(",A,A", ",B,A"))

        self.assertEqual(parse_price_paid_row(row).record_category, "B")


def _row_dict(line):
    import csv

    return next(csv.DictReader([HEADER, line]))


class RepeatDownloadTests(unittest.TestCase):
    def test_repeat_download_does_not_duplicate(self):
        first = release("ppd-2024-01", "2024-02-01T00:00:00Z",
                        ROW_A.format(txn="{T1}", status="A"))

        snapshot = build_price_snapshot([first, first])

        self.assertEqual(len(snapshot["transactions"]), 1)
        self.assertEqual(snapshot_checksum(snapshot),
                         snapshot_checksum(build_price_snapshot([first])))


class CorrectionTests(unittest.TestCase):
    def test_correction_replaces_without_duplicating(self):
        addition = release("ppd-2024-01", "2024-02-01T00:00:00Z",
                           ROW_A.format(txn="{T1}", status="A"))
        corrected_row = ROW_A.format(txn="{T1}", status="C").replace(
            "250000,2024-01-15", "260000,2024-01-15")
        correction = release("ppd-2024-02", "2024-03-01T00:00:00Z", corrected_row)

        snapshot = build_price_snapshot([addition, correction])

        self.assertEqual(len(snapshot["transactions"]), 1)
        self.assertEqual(snapshot["transactions"][0]["price"], 260000)
        self.assertEqual(len(snapshot["history"]["{T1}"]), 1)
        self.assertEqual(snapshot["history"]["{T1}"][0]["price"], 250000)
        provenance = snapshot["provenance"]["{T1}"]
        self.assertEqual(provenance["firstSeenRelease"], "ppd-2024-01")
        self.assertEqual(provenance["lastAppliedRelease"], "ppd-2024-02")


class DeletionTests(unittest.TestCase):
    def test_deletion_tombstones_with_provenance(self):
        addition = release("ppd-2024-01", "2024-02-01T00:00:00Z",
                           ROW_A.format(txn="{T1}", status="A"))
        deletion = release("ppd-2024-02", "2024-03-01T00:00:00Z",
                           ROW_A.format(txn="{T1}", status="D"))

        snapshot = build_price_snapshot([addition, deletion])

        self.assertEqual(snapshot["transactions"], [])
        self.assertEqual(len(snapshot["tombstones"]), 1)
        self.assertEqual(snapshot["tombstones"][0]["transactionId"], "{T1}")
        self.assertEqual(snapshot["tombstones"][0]["deletedInRelease"], "ppd-2024-02")
        self.assertIn("{T1}", snapshot["provenance"])


class MalformedValueTests(unittest.TestCase):
    def test_malformed_money_and_date_are_quarantined(self):
        bad_price = ROW_A.format(txn="{BAD1}", status="A").replace("250000", "POA")
        bad_date = ROW_A.format(txn="{BAD2}", status="A").replace(
            "2024-01-15 00:00", "15/01/2024")
        raw = release("ppd-2024-01", "2024-02-01T00:00:00Z", bad_price, bad_date)

        snapshot = build_price_snapshot([raw])

        self.assertEqual(snapshot["transactions"], [])
        reasons = {item["reason"] for item in snapshot["quarantine"]}
        self.assertIn("invalid-price", reasons)
        self.assertIn("invalid-date", reasons)
        self.assertEqual(len(snapshot["quarantine"]), 2)


class MultiSaleAddressTests(unittest.TestCase):
    def test_multiple_sales_of_one_address_preserved(self):
        raw = release("ppd-2024-02", "2024-03-01T00:00:00Z",
                      ROW_A.format(txn="{T1}", status="A"),
                      ROW_B.format(txn="{T2}", status="A"))

        snapshot = build_price_snapshot([raw])

        self.assertEqual(len(snapshot["transactions"]), 2)
        ids = {item["transactionId"] for item in snapshot["transactions"]}
        self.assertEqual(ids, {"{T1}", "{T2}"})


class LateRegistrationTests(unittest.TestCase):
    def test_late_registration_of_older_sale_is_included(self):
        january = release("ppd-2024-01", "2024-02-01T00:00:00Z",
                          ROW_B.format(txn="{T2}", status="A"))
        late = release("ppd-2024-03", "2024-04-01T00:00:00Z",
                       ROW_A.format(txn="{T1}", status="A"))

        snapshot = build_price_snapshot([january, late])
        ids = {item["transactionId"] for item in snapshot["transactions"]}

        self.assertIn("{T1}", ids)
        self.assertEqual(snapshot["publicationPeriod"]["startMonth"], "2024-01")


class ReplayDeterminismTests(unittest.TestCase):
    def test_replay_generates_same_snapshot_checksum(self):
        first = release("ppd-2024-01", "2024-02-01T00:00:00Z",
                        ROW_A.format(txn="{T1}", status="A"))
        second = release("ppd-2024-02", "2024-03-01T00:00:00Z",
                         ROW_B.format(txn="{T2}", status="A"))

        forward = snapshot_checksum(build_price_snapshot([first, second]))
        replayed = snapshot_checksum(build_price_snapshot([second, first, second]))

        self.assertEqual(forward, replayed)


class PresentationTests(unittest.TestCase):
    def test_achieved_price_distinguished_from_asking(self):
        self.assertEqual(PRICE_KIND, "achieved")

        label = price_label().lower()

        self.assertIn("achieved", label)
        self.assertIn("asking", label)

    def test_publication_period_surfaces_partial_latest_month(self):
        raw = release("ppd-2024-02", "2024-03-01T00:00:00Z",
                      ROW_A.format(txn="{T1}", status="A"),
                      ROW_B.format(txn="{T2}", status="A"))

        period = build_price_snapshot([raw])["publicationPeriod"]

        self.assertEqual(period["endMonth"], "2024-02")
        self.assertEqual(period["partialMonth"], "2024-02")
        self.assertNotIn("2024-02", period["completeMonths"])
        self.assertIn("2024-01", period["completeMonths"])

    def test_registration_lag_and_exclusions_documented(self):
        self.assertTrue(REGISTRATION_LAG_NOTE)
        self.assertTrue(EXCLUSIONS)
        self.assertTrue(all(isinstance(item, str) for item in EXCLUSIONS))

        snapshot = build_price_snapshot([])

        self.assertEqual(snapshot["registrationLagNote"], REGISTRATION_LAG_NOTE)
        self.assertEqual(list(snapshot["exclusions"]), list(EXCLUSIONS))


if __name__ == "__main__":
    unittest.main()
