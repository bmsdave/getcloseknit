"""AE-15: bulk Price Paid + EPC linkage into internal linked sales.

Committed fixtures only (fake Sample Street addresses). Each test names
one acceptance clause of the bulk mapper.
"""

import unittest

from area_analytics.bulk_price import (
    EpcRecord,
    address_tokens,
    build_epc_index,
    find_epc_match,
    link_sale,
    map_epc_row,
    map_pp_row,
    normalize_address_part,
    normalize_epc_columns,
)


def _pp_record():
    return {
        "transaction_id": "{ABC123-0001}",
        "price": 250000,
        "sale_date": "2024-01-15",
        "sale_month": "2024-01",
        "postcode": "SE18 1BY",
        "property_type": "D",
        "new_build": "N",
        "tenure": "F",
        "paon": "10",
        "saon": "",
        "street": "Sample Street",
    }


def _epc_row(**overrides):
    row = {
        "certificate_number": "3710-2005-7002-0924-2406",
        "address1": "10 Sample Street",
        "address2": "",
        "address3": "",
        "postcode": "SE18 1BY",
        "local_authority": "E09000011",
        "total_floor_area": "86",
        "lodgement_date": "2025-04-23",
        "uprn": "100012345678",
    }
    row.update(overrides)
    return row


class BulkMapperTests(unittest.TestCase):
    def test_headerless_complete_row_maps_with_status(self):
        cells = ["{ABC123-0001}", "250000", "2024-01-15 00:00", "SE18 1BY",
                 "D", "N", "F", "10", "", "Sample Street", "Westminster",
                 "LONDON", "WESTMINSTER", "GREATER LONDON", "A", "A"]
        record = map_pp_row(cells)

        self.assertEqual(record["Transaction unique identifier"], "{ABC123-0001}")
        self.assertEqual(record["Price"], "250000")
        self.assertEqual(record["Date of Transfer"], "2024-01-15")
        self.assertEqual(record["sale_month"], "2024-01")
        self.assertEqual(record["Record Status - monthly file only"], "A")

    def test_mapped_row_parses_through_acquisition_parser(self):
        from area_analytics.price_paid import parse_price_paid_row
        cells = ["{ABC123-0001}", "250000", "2024-01-15 00:00", "SE18 1BY",
                 "D", "N", "F", "10", "", "Sample Street", "Westminster",
                 "LONDON", "WESTMINSTER", "GREATER LONDON", "A", "A"]

        parsed = parse_price_paid_row(map_pp_row(cells))

        self.assertEqual(parsed.transaction_id, "{ABC123-0001}")
        self.assertEqual(parsed.price, 250000)
        self.assertEqual(parsed.sale_month, "2024-01")

    def test_short_rows_quarantine_without_guessing(self):
        with self.assertRaises(ValueError):
            map_pp_row(["{ABC123-0001}", "250000"])

    def test_address_normalization_folds_case_and_punctuation(self):
        self.assertEqual(normalize_address_part("  10, Sample-Street. "), "10 SAMPLE STREET")
        self.assertEqual(normalize_address_part("Flat 5 Third Floor"), "FLAT 5 THIRD FLOOR")

    def test_flat_sale_matches_split_epc_address(self):
        sale = address_tokens("11", "Flat 1", "Example Road")
        cert = address_tokens("Flat 1", "11 Example Road", "")

        self.assertTrue(sale <= cert)

    def test_specific_flat_beats_generic_building_certificate(self):
        building = EpcRecord("cert-building", "SE16SL",
                             frozenset({"11", "EXAMPLE", "ROAD"}),
                             200.0, "2024-01-01", "")
        flat = EpcRecord("cert-flat", "SE16SL",
                         frozenset({"FLAT", "1", "11", "EXAMPLE", "ROAD"}),
                         66.0, "2025-03-07", "")
        index = build_epc_index([building, flat])
        sale = address_tokens("11", "Flat 1", "Example Road")

        match = find_epc_match("SE16SL", sale, index)

        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.certificate_number, "cert-flat")

    def test_latest_certificate_wins_a_duplicate(self):
        first = EpcRecord("cert-old", "SE181BY",
                          frozenset({"10", "SAMPLE", "STREET"}),
                          80.0, "2020-01-01", "")
        second = EpcRecord("cert-new", "SE181BY",
                           frozenset({"10", "SAMPLE", "STREET"}),
                           86.0, "2025-04-23", "")
        index = build_epc_index([first, second])

        match = find_epc_match("SE181BY", frozenset({"10", "SAMPLE", "STREET"}), index)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.certificate_number, "cert-new")

    def test_zero_floor_area_is_excluded_not_zeroed(self):
        with self.assertRaises(ValueError) as raised:
            map_epc_row(_epc_row(total_floor_area="0"))

        self.assertIn("invalid-floor-area", str(raised.exception))

    def test_hyphenated_legacy_columns_normalize(self):
        header = ["certificate-number", "address1", "address2", "postcode",
                  "local-authority", "total-floor-area", "lodgement-date", "uprn"]
        values = ["c1", "10 Sample Street", "", "SE18 1BY",
                  "E09000011", "86", "2025-04-23", ""]
        row = dict(zip(normalize_epc_columns(header), values))
        record = map_epc_row(row)

        self.assertEqual(record.floor_area_sqm, 86.0)

    def test_linked_sale_carries_lsoa_and_area(self):
        index = build_epc_index([map_epc_row(_epc_row())])

        linked, reason = link_sale(_pp_record(), "E01000001", "E02000001",
                                   "E09000001", index)

        self.assertIsNone(reason)
        self.assertIsNotNone(linked)
        assert linked is not None
        self.assertEqual(linked.lsoa, "E01000001")
        self.assertEqual(linked.floor_area_sqm, 86.0)
        self.assertEqual(linked.price, 250000)

    def test_unmatched_sale_reports_reason_without_inventing(self):
        linked, reason = link_sale(_pp_record(), "E01000001", "E02000001",
                                   "E09000001", {})

        self.assertIsNone(linked)
        self.assertEqual(reason, "no-epc-match")


if __name__ == "__main__":
    unittest.main()
