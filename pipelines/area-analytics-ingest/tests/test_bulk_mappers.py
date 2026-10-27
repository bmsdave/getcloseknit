"""Bulk -> internal mappers for London-only load (TDD RED)."""

import unittest

from area_analytics import bulk_mappers as m


class EpcBulkTests(unittest.TestCase):
    def test_epc_bulk_maps_to_internal_names(self):
        row = {
            "certificate_number": "C1", "total_floor_area": "86",
            "current_energy_rating": "c", "current_energy_efficiency": "63",
            "number_habitable_rooms": "4", "lodgement_date": "2025-04-23",
            "inspection_date": "2025-04-22", "uprn": "100012345678",
            "address1": "10 Sample Street", "address2": "",
            "posttown": "LONDON", "postcode": "SE18 1BY",
        }
        internal = m.map_epc_bulk_to_internal(row)
        self.assertEqual(internal["certificateId"], "C1")
        self.assertEqual(internal["transactionType"], "domestic")
        self.assertEqual(internal["energyRating"], "C")
        self.assertEqual(internal["floorAreaSqm"], "86")
        # must feed existing parser
        from area_analytics.property_identity import parse_epc_row
        parsed = parse_epc_row(internal)
        self.assertEqual(parsed.certificate_id, "C1")

    def test_epc_london_filter(self):
        self.assertTrue(m.is_london_postcode("SE18 1BY"))
        self.assertFalse(m.is_london_postcode("PO15 5PR"))
        self.assertFalse(m.is_london_postcode("NG31 7NU"))
        self.assertTrue(m.is_london_postcode("N11 1AA"))
        self.assertTrue(m.is_london_postcode("W1A 0AX"))


class HmlrTests(unittest.TestCase):
    def test_headerless_cells_map(self):
        cells = ["{A}", "250000", "2024-01-15 00:00", "SE18 1BY",
                 "D", "N", "F", "10", "", "Sample Street", "",
                 "LONDON", "GREENWICH", "GREATER LONDON", "A", "A"]
        record = m.map_hmlr_cells(cells)
        self.assertEqual(record["Transaction unique identifier"], "{A}")
        from area_analytics.price_paid import parse_price_paid_row
        parsed = parse_price_paid_row(record)
        self.assertEqual(parsed.price, 250000)


class PoliceTests(unittest.TestCase):
    def test_street_row_maps_to_internal(self):
        row = {"Crime ID": "id-1", "Month": "2026-07",
               "Crime type": "Burglary", "LSOA code": "E01000001"}
        internal = m.map_police_street_to_internal(
            row, "metropolitan-police")
        self.assertEqual(internal["Persistent ID"], "id-1")
        self.assertEqual(internal["Date"], "2026-07")
        from area_analytics.analytics import parse_police_record
        parsed = parse_police_record(internal, "metropolitan-police")
        self.assertEqual(parsed.category, "burglary")

    def test_any_english_force_maps_but_btp_never_does(self):
        row = {"Crime ID": "id-2", "Month": "2026-07", "Crime type": "Burglary", "LSOA code": "E01011001"}
        self.assertEqual(m.map_police_street_to_internal(row, "west-yorkshire-police")["LSOA code"], "E01011001")
        for force in ("british-transport-police", "btp", ""):
            with self.assertRaises(ValueError):
                m.map_police_street_to_internal(row, force)


class BoundaryTests(unittest.TestCase):
    def test_boundary_spec_kinds(self):
        self.assertIn("lsoa", m.BOUNDARY_SPECS)


class ThinPassthroughTests(unittest.TestCase):
    def test_imd_row_passthrough(self):
        row = {"LSOA code (2021)": "E01000001",
               "Index of Multiple Deprivation (IMD) Rank (where 1 is most deprived)": "100",
               "Index of Multiple Deprivation (IMD) Decile (where 1 is most deprived 10% of LSOA": "1"}
        mapped = m.map_imd_row(row)
        self.assertEqual(mapped["lsoa_code"], "E01000001")

    def test_tenure_row_passthrough(self):
        row = {"geography code": "E01000001",
               "Tenure of household: Total: All households": "837",
               "Tenure of household: Owned": "481"}
        mapped = m.map_tenure_row(row)
        self.assertEqual(mapped["lsoa_code"], "E01000001")

    def test_ofsted_row_passthrough(self):
        row = {"URN": "100000", "School name": "The Aldgate School",
               "Region": "London",
               "Latest OEIF overall effectiveness": "1"}
        mapped = m.map_ofsted_row(row)
        self.assertEqual(mapped["urn"], "100000")

    def test_school_row_passthrough(self):
        row = {"school_urn": "100544", "school_name": "David Game College",
               "la_name": "Westminster", "time_period": "202425"}
        mapped = m.map_school_row(row)
        self.assertEqual(mapped["urn"], "100544")


if __name__ == "__main__":
    unittest.main()
