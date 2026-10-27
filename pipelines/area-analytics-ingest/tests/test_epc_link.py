"""B3 (#153): the shared tolerant EPC linker.

Committed fixtures only (fake Sample Street / Duval House style addresses).
Each test names one acceptance clause of the unified matcher.
"""

import unittest

from area_analytics.epc_link import (
    EpcRecord,
    address_tokens,
    build_epc_index,
    canonical_tokens,
    compact_postcode,
    find_epc_match,
    link_sales_floor,
    map_epc_row,
    postcode_sector,
)


def _epc_row(**overrides):
    row = {
        "certificate_number": "cert-1",
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


def _sale_key(key, postcode, saon, paon, street):
    return {
        "key": key,
        "postcode": compact_postcode(postcode),
        "sale_tokens": address_tokens(saon, paon, street),
        "saon_tokens": address_tokens(saon),
        "paon_street_tokens": address_tokens(paon, street),
    }


class DuvalHouseStyleTests(unittest.TestCase):
    def test_apartment_comma_building_address_links(self):
        """EPC address1="Apartment 10, Duval House" covers sale "apartment 10"."""
        index = build_epc_index([map_epc_row(_epc_row(
            address1="Apartment 10, Duval House",
            address2="10 Grant Road",
            postcode="SW11 2FR",
            total_floor_area="71",
        ))])

        match = find_epc_match("SW112FR", address_tokens("Apartment 10"), index)

        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.floor_area_sqm, 71.0)

    def test_flat_meets_apartment_synonym(self):
        index = build_epc_index([map_epc_row(_epc_row(
            address1="Apartment 10",
            address2="Duval House",
            postcode="SW11 2FR",
        ))])

        match = find_epc_match("SW112FR", address_tokens("Flat 10"), index)

        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.floor_area_sqm, 86.0)

    def test_apt_and_unit_are_the_same_dwelling_word(self):
        self.assertEqual(canonical_tokens(["APT", "10"]), frozenset({"APARTMENT", "10"}))
        self.assertEqual(canonical_tokens(["UNIT", "3"]), frozenset({"APARTMENT", "3"}))
        index = build_epc_index([map_epc_row(_epc_row(address1="Apt 4"))])

        match = find_epc_match("SE181BY", address_tokens("Unit 4"), index)

        self.assertIsNotNone(match)


class SiblingPostcodeTests(unittest.TestCase):
    def _pinnacle_index(self):
        return build_epc_index([map_epc_row(_epc_row(
            certificate_number="cert-9gu",
            address1="Apartment 4105",
            address2="10 Marsh Wall",
            postcode="E14 9GU",
            total_floor_area="84",
            lodgement_date="2021-03-11",
        ))])

    def test_sibling_postcode_links_with_same_paon_and_street(self):
        """E14 9PG sale finds the E14 9GU certificate for the same flat."""
        match = find_epc_match(
            "E149PG",
            address_tokens("Apartment 4105", "10", "Marsh Wall"),
            self._pinnacle_index(),
            paon_street_tokens=address_tokens("10", "Marsh Wall"))

        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.certificate_number, "cert-9gu")
        self.assertEqual(match.floor_area_sqm, 84.0)

    def test_sibling_postcode_does_not_match_a_different_flat(self):
        """The sibling fallback covers the flat, not the whole building."""
        match = find_epc_match(
            "E149PG",
            address_tokens("Apartment 4106", "10", "Marsh Wall"),
            self._pinnacle_index(),
            paon_street_tokens=address_tokens("10", "Marsh Wall"))

        self.assertIsNone(match)

    def test_sibling_postcode_does_not_match_a_different_street(self):
        index = build_epc_index([map_epc_row(_epc_row(
            address1="Apartment 1",
            address2="20 Other Street",
            postcode="E14 9GU",
        ))])
        match = find_epc_match(
            "E149PG",
            address_tokens("Apartment 1", "10", "Marsh Wall"),
            index,
            paon_street_tokens=address_tokens("10", "Marsh Wall"))

        self.assertIsNone(match)

    def test_no_sibling_fallback_without_paon_street(self):
        match = find_epc_match(
            "E149PG",
            address_tokens("Apartment 4105", "10", "Marsh Wall"),
            self._pinnacle_index())

        self.assertIsNone(match)

    def test_sector_groups_unit_postcodes(self):
        self.assertEqual(postcode_sector("E149PG"), "E149")
        self.assertEqual(postcode_sector("SW112FR"), "SW112")


class NeverShareTests(unittest.TestCase):
    def test_one_certificate_is_never_assigned_to_two_flats(self):
        """The E14 9JQ 335 m² guard: two SAONs, one vague certificate."""
        cert = map_epc_row(_epc_row(
            certificate_number="cert-shared",
            address1="Apartment 6901 Apartment 6902 10 Marsh Wall",
            address2="Landmark Pinnacle",
            postcode="E14 9JQ",
            total_floor_area="335",
        ))
        index = build_epc_index([cert])
        sales = [
            _sale_key("s1", "E14 9JQ", "Apartment 6901", "10", "Marsh Wall"),
            _sale_key("s2", "E14 9JQ", "Apartment 6902", "10", "Marsh Wall"),
        ]

        matches, rejected = link_sales_floor(sales, index)

        self.assertIsNone(matches["s1"])
        self.assertIsNone(matches["s2"])
        self.assertEqual(rejected, ["cert-shared"])

    def test_resales_of_the_same_flat_share_its_certificate(self):
        cert = map_epc_row(_epc_row(
            certificate_number="cert-flat",
            address1="Flat 2",
            address2="10 Sample Street",
            postcode="SE18 1BY",
        ))
        index = build_epc_index([cert])
        sales = [
            _sale_key("s1", "SE18 1BY", "Flat 2", "10", "Sample Street"),
            _sale_key("s2", "SE18 1BY", "Flat 2", "10", "Sample Street"),
        ]

        matches, rejected = link_sales_floor(sales, index)

        self.assertIsNotNone(matches["s1"])
        self.assertIsNotNone(matches["s2"])
        self.assertEqual(rejected, [])

    def test_same_flat_under_two_saon_spellings_is_one_home(self):
        cert = map_epc_row(_epc_row(
            certificate_number="cert-flat",
            address1="Apartment 10",
            address2="10 Grant Road",
            postcode="SW11 2FR",
        ))
        index = build_epc_index([cert])
        sales = [
            _sale_key("s1", "SW11 2FR", "Apartment 10", "10", "Grant Road"),
            _sale_key("s2", "SW11 2FR", "Flat 10", "10", "Grant Road"),
        ]

        matches, rejected = link_sales_floor(sales, index)

        self.assertIsNotNone(matches["s1"])
        self.assertIsNotNone(matches["s2"])
        self.assertEqual(rejected, [])


class TieBreakTests(unittest.TestCase):
    def test_fewest_extra_tokens_wins(self):
        building = EpcRecord("cert-building", "SE16SL",
                             frozenset({"11", "EXAMPLE", "ROAD"}),
                             200.0, "2024-01-01", "")
        flat = EpcRecord("cert-flat", "SE16SL",
                         frozenset({"FLAT", "1", "11", "EXAMPLE", "ROAD"}),
                         66.0, "2025-03-07", "")
        index = build_epc_index([building, flat])

        match = find_epc_match("SE16SL", address_tokens("11", "Flat 1", "Example Road"), index)

        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.certificate_number, "cert-flat")

    def test_latest_lodgement_wins_a_duplicate(self):
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


if __name__ == "__main__":
    unittest.main()
