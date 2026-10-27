import unittest

from area_analytics.properties import (
    Certificate,
    Sale,
    area_deprivation_movement,
    build_properties,
    build_property,
    confidence_band_percent,
    derive_events,
    grid_cell,
    normalise_address,
    event_rates,
    normalise_postcode,
    property_id,
    years_between,
)


def _property(**overrides):
    record = {
        "postcode": "sw1a 1aa",
        "primary_address": "1, Parliament Preview",
        "latitude": 51.501,
        "longitude": -0.1416,
        "lsoa": "E01000001",
        "msoa": "E02000001",
        "borough": "E09000033",
        "sales": [Sale("2006-06-15", 280_000, False, "leasehold")],
        "certificates": [Certificate("2008-02-01", 54.0, "E")],
    }
    record.update(overrides)
    return build_property(**record)


class NormalisationTests(unittest.TestCase):
    def test_postcode_and_address_normalise_to_one_key(self):
        self.assertEqual(normalise_postcode("sw1a1aa"), "SW1A 1AA")
        self.assertEqual(normalise_address("1, Parliament Preview", "Flat 3"), "FLAT 3 1 PARLIAMENT PREVIEW")
        self.assertEqual(
            property_id("SW1A 1AA", "1, Parliament Preview"),
            "uk:property:SW1A1AA:1-PARLIAMENT-PREVIEW",
        )

    def test_an_unparseable_postcode_is_rejected_rather_than_guessed(self):
        with self.assertRaises(ValueError):
            normalise_postcode("not-a-postcode")

    def test_grid_cells_are_stable_for_neighbouring_coordinates(self):
        self.assertEqual(grid_cell(51.501, -0.1416), grid_cell(51.5049, -0.1401))
        self.assertNotEqual(grid_cell(51.501, -0.1416), grid_cell(51.521, -0.1416))


class EventTests(unittest.TestCase):
    def test_floor_area_growth_above_ten_percent_is_an_extension(self):
        events = derive_events(
            (),
            (Certificate("2010-01-01", 54.0, "E"), Certificate("2021-05-09", 62.0, "E")),
        )

        self.assertEqual([event.kind for event in events], ["extended"])
        self.assertEqual(events[0].date, "2021-05-09")

    def test_floor_area_growth_within_ten_percent_is_not_an_extension(self):
        events = derive_events(
            (),
            (Certificate("2010-01-01", 54.0, "E"), Certificate("2021-05-09", 59.0, "E")),
        )

        self.assertEqual(events, ())

    def test_a_two_band_energy_rise_is_a_refurbishment(self):
        events = derive_events(
            (),
            (Certificate("2010-01-01", 54.0, "E"), Certificate("2021-05-09", 54.0, "C")),
        )

        self.assertEqual([event.kind for event in events], ["refurbished"])

    def test_one_band_energy_rise_is_not_a_refurbishment(self):
        events = derive_events(
            (),
            (Certificate("2010-01-01", 54.0, "E"), Certificate("2021-05-09", 54.0, "D")),
        )

        self.assertEqual(events, ())

    def test_tenure_and_new_build_events_come_from_the_transaction_record(self):
        events = derive_events(
            (
                Sale("2006-06-15", 280_000, True, "leasehold"),
                Sale("2022-11-03", 570_000, False, "freehold"),
            ),
            (),
        )

        self.assertEqual(
            [(event.kind, event.date) for event in events],
            [("first-sold-as-new", "2006-06-15"), ("converted-to-freehold", "2022-11-03")],
        )


class SpineTests(unittest.TestCase):
    def test_sales_and_certificates_are_ordered_and_keyed_on_the_address(self):
        built = _property(
            sales=[
                Sale("2022-11-03", 570_000, False, "freehold"),
                Sale("2006-06-15", 280_000, False, "leasehold"),
            ]
        )

        self.assertEqual([sale.date for sale in built.sales], ["2006-06-15", "2022-11-03"])
        self.assertEqual(built.property_id, "uk:property:SW1A1AA:1-PARLIAMENT-PREVIEW")

    def test_two_records_for_one_address_are_rejected_rather_than_merged(self):
        record = {
            "postcode": "SW1A 1AA",
            "primary_address": "1 Parliament Preview",
            "latitude": 51.501,
            "longitude": -0.1416,
            "lsoa": "E01000001",
            "msoa": "E02000001",
            "borough": "E09000033",
            "sales": [Sale("2006-06-15", 280_000, False, "leasehold")],
            "certificates": [],
        }

        with self.assertRaises(ValueError):
            build_properties([record, dict(record)])

    def test_an_invalid_certificate_is_rejected_rather_than_inferred(self):
        with self.assertRaises(ValueError):
            _property(certificates=[Certificate("2008-02-01", 0.0, "E")])


class EventRateTests(unittest.TestCase):
    def test_event_rates_report_the_share_of_the_corpus_that_carries_each_event(self):
        extended = _property(
            certificates=[Certificate("2010-01-01", 54.0, "E"), Certificate("2021-05-09", 62.0, "C")]
        )
        untouched = _property(postcode="SE1 7PB", primary_address="2 South Bank Preview")

        rates = event_rates([extended, untouched])

        self.assertEqual(rates, {"extended": 50.0, "refurbished": 50.0})

    def test_an_empty_corpus_reports_nothing_rather_than_a_zero_rate(self):
        with self.assertRaises(ValueError):
            event_rates([])


class ConfidenceBandTests(unittest.TestCase):
    LADDER = [(5.0, 8.7), (40.0, 15.9)]

    def test_the_band_widens_with_the_gap_since_the_last_sale(self):
        self.assertEqual(confidence_band_percent(3.8, self.LADDER), 8.7)
        self.assertEqual(confidence_band_percent(26.0, self.LADDER), 15.9)

    def test_a_gap_beyond_the_published_ladder_is_refused(self):
        with self.assertRaises(ValueError):
            confidence_band_percent(41.0, self.LADDER)

    def test_years_between_two_sales_is_measured_not_rounded_to_whole_years(self):
        self.assertEqual(years_between("2022-11-03", "2026-09-05"), 3.84)


class DeprivationMovementTests(unittest.TestCase):
    def test_a_moved_decile_becomes_an_event(self):
        event = area_deprivation_movement(
            "E01001234",
            {"E01001234": 1},
            {"E01001234": 5},
            earlier_release="IMD 2019",
            later_release="IMD 2025",
            published="2025-10-01",
        )

        self.assertEqual(event.kind, "area-deprivation-moved")
        self.assertIn("1 → 5", event.detail)
        self.assertIn("less deprived", event.detail)

    def test_a_split_boundary_is_excluded_rather_than_mapped_to_a_parent(self):
        self.assertIsNone(
            area_deprivation_movement(
                "E01099999",
                {},
                {"E01099999": 5},
                earlier_release="IMD 2019",
                later_release="IMD 2025",
                published="2025-10-01",
            )
        )


if __name__ == "__main__":
    unittest.main()
