import unittest
from pathlib import Path

from area_analytics.sources import (
    PRIVATE_RENT_BEDROOMS,
    SOURCE_CATALOGUE,
    bedroom_cell_for,
    parse_private_rent_cell,
    resolve_rent_carrier,
    source_definition,
)


FIXTURES = Path(__file__).parent / "fixtures"


class SourceCatalogueTests(unittest.TestCase):
    def test_catalogue_covers_initial_and_extensible_evidence(self):
        required = {
            "hmlr-price-paid", "epc-floor-area", "ons-cpih", "ons-private-rent",
            "police-uk", "ons-population", "imd-2025", "ons-small-area-income",
            "census-tenure-2021", "osm-network", "tfl-timetables", "dfe-gias",
            "dfe-school-performance", "ofsted", "defra-noise", "osm-amenities",
        }

        self.assertTrue(required.issubset(SOURCE_CATALOGUE))
        self.assertTrue(all(item.licence and item.carrier_policy for item in SOURCE_CATALOGUE.values()))

    def test_unknown_source_cannot_enter_a_release(self):
        with self.assertRaisesRegex(ValueError, "unknown source"):
            source_definition("competitor-score")

    def test_every_source_has_a_reviewed_distribution_record(self):
        for source_id, source in SOURCE_CATALOGUE.items():
            with self.subTest(source=source_id):
                self.assertTrue(source.url, "reviewed distribution URL")
                self.assertTrue(source.publisher, "publisher")
                self.assertTrue(source.access_method, "access method")
                self.assertTrue(source.permitted_use, "permitted product use")
                self.assertTrue(source.attribution, "attribution")
                self.assertIn(source.licence_decision, ("approved", "unresolved"))
                self.assertIn(source.status, ("active", "blocked"))
                self.assertIsInstance(source.exclusions, tuple)

    def test_active_sources_have_approved_terms_and_a_committed_fixture(self):
        active = [sid for sid, item in SOURCE_CATALOGUE.items() if item.status == "active"]
        self.assertTrue(active, "at least one reviewed source is enabled")
        for source_id in active:
            source = SOURCE_CATALOGUE[source_id]
            with self.subTest(source=source_id):
                self.assertEqual(source.licence_decision, "approved")
                self.assertTrue(source.fixture, "government-shaped fixture")
                self.assertTrue((FIXTURES / source.fixture).is_file())
                self.assertTrue(source.landing_url, "landing page distinct from bytes")

    def test_unresolved_licence_decisions_stay_blocked(self):
        for source_id, source in SOURCE_CATALOGUE.items():
            with self.subTest(source=source_id):
                if source.licence_decision != "approved":
                    self.assertEqual(source.status, "blocked")

    def test_unresolved_publisher_terms_are_blocked(self):
        for source_id in ("la-admissions-ealing", "la-admissions-kensington_chelsea"):
            with self.subTest(source=source_id):
                source = source_definition(source_id)
                self.assertEqual(source.licence_decision, "unresolved")
                self.assertEqual(source.status, "blocked")

    def test_school_history_sources_are_open_government_licence(self):
        for source_id in ("dfe-gias", "dfe-school-performance", "ofsted-history",
                          "ofsted-reports", "dfe-applications-offers"):
            with self.subTest(source=source_id):
                source = source_definition(source_id)
                self.assertEqual(source.licence, "OGL-3.0")
                self.assertIn("Open Government Licence v3.0", source.attribution)
        gias = source_definition("dfe-gias")
        self.assertIn("personal data", " ".join(gias.exclusions).lower())

    def test_council_admissions_match_the_borough_configs(self):
        from area_analytics.school_admissions import config

        councils = {key for key in SOURCE_CATALOGUE if key.startswith("la-admissions-")}
        self.assertEqual(councils, {f"la-admissions-{slug}" for slug in config.slugs()})
        for slug in config.slugs():
            with self.subTest(council=slug):
                borough = config.load_config(slug)
                source = source_definition(f"la-admissions-{slug}")
                self.assertEqual(source.licence_decision, borough["licence_decision"])
                self.assertEqual(source.landing_url, (borough.get("licence") or {}).get("url") or "")
                self.assertEqual(source.status,
                                 "active" if borough["licence_decision"] == "approved" else "blocked")

    def test_hmlr_record_captures_address_restrictions(self):
        source = source_definition("hmlr-price-paid")
        self.assertIn("address", source.permitted_use.lower())
        self.assertEqual(source.status, "active")

    def test_epc_record_points_at_current_service_entry(self):
        source = source_definition("epc-floor-area")
        self.assertIn("get-energy-performance-data", source.url)

    def test_lookup_record_carries_lookup_specific_terms(self):
        source = source_definition("ons-lookup-lsoa-msoa-lad")
        combined = " ".join((source.permitted_use, *source.exclusions)).lower()
        self.assertIn("lookup", combined)


class PrivateRentReleaseTests(unittest.TestCase):
    def test_registry_records_verified_publication_dimensions(self):
        source = source_definition("ons-private-rent")
        self.assertIn("privaterentalmarketsummarystatisticsinengland", source.url)
        self.assertEqual(source.carrier_policy, "borough")
        self.assertEqual(source.cadence, "half-yearly")
        combined = " ".join(
            (source.permitted_use, source.cadence, source.geography_vintage,
             *source.exclusions, *source.caveats)).lower()
        for token in ("median", "month", "bedroom", "local authority"):
            self.assertIn(token, combined)
        self.assertIn("lsoa", combined)

    def test_bedroom_cells_cover_published_breakdown(self):
        self.assertEqual(
            set(PRIVATE_RENT_BEDROOMS),
            {"room", "studio", "1 bedroom", "2 bedrooms", "3 bedrooms",
             "4 or more bedrooms"},
        )

    def test_record_preserves_period_statistic_and_precision(self):
        record = parse_private_rent_cell({
            "geography_id": "uk:lad:E09000001",
            "bedroom": "2 bedrooms",
            "median_monthly_rent": 1850,
            "period": "2023-10 to 2024-09",
            "source_bedroom_label": "Two Bedrooms",
        })
        self.assertEqual(record["carrier_geography_id"], "uk:lad:E09000001")
        self.assertEqual(record["bedroom"], "2 bedrooms")
        self.assertEqual(record["median_monthly_rent"], 1850)
        self.assertEqual(record["unit"], "GBP/month")
        self.assertEqual(record["statistic"], "median")
        self.assertEqual(record["period"], "2023-10 to 2024-09")
        self.assertEqual(record["precision_pounds"], 1)
        self.assertEqual(record["quality"], "fallback")

    def test_record_rejects_lsoa_detail(self):
        with self.assertRaisesRegex(ValueError, "borough"):
            parse_private_rent_cell({
                "geography_id": "uk:lsoa:E01000001",
                "bedroom": "2 bedrooms",
                "median_monthly_rent": 1850,
                "period": "2023-10 to 2024-09",
            })

    def test_record_rejects_unknown_bedroom_cell(self):
        with self.assertRaisesRegex(ValueError, "bedroom"):
            parse_private_rent_cell({
                "geography_id": "uk:lad:E09000001",
                "bedroom": "5 bedrooms",
                "median_monthly_rent": 1850,
                "period": "2023-10 to 2024-09",
            })

    def test_record_rejects_annual_scale_median(self):
        with self.assertRaisesRegex(ValueError, "month"):
            parse_private_rent_cell({
                "geography_id": "uk:lad:E09000001",
                "bedroom": "2 bedrooms",
                "median_monthly_rent": 22200,
                "period": "2023-10 to 2024-09",
            })

    def test_record_rejects_non_positive_rent(self):
        with self.assertRaisesRegex(ValueError, "rent"):
            parse_private_rent_cell({
                "geography_id": "uk:lad:E09000001",
                "bedroom": "2 bedrooms",
                "median_monthly_rent": 0,
                "period": "2023-10 to 2024-09",
            })

    def test_bedroom_cell_mapping(self):
        self.assertEqual(bedroom_cell_for(0), "studio")
        self.assertEqual(bedroom_cell_for(1), "1 bedroom")
        self.assertEqual(bedroom_cell_for(2), "2 bedrooms")
        self.assertEqual(bedroom_cell_for(3), "3 bedrooms")
        self.assertEqual(bedroom_cell_for(4), "4 or more bedrooms")
        self.assertEqual(bedroom_cell_for(8), "4 or more bedrooms")
        for bad in (-1, 9, "2", None):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    bedroom_cell_for(bad)

    def test_carrier_resolution_uses_lookup_not_substitution(self):
        lookup = {"uk:lsoa:E01000001": "uk:lad:E09000002"}
        self.assertEqual(
            resolve_rent_carrier("uk:lsoa:E01000001", lookup),
            "uk:lad:E09000002",
        )

    def test_carrier_resolution_rejects_unknown_lsoa(self):
        with self.assertRaisesRegex(ValueError, "lookup"):
            resolve_rent_carrier("uk:lsoa:E01000999", {})

    def test_carrier_resolution_rejects_invalid_parent(self):
        with self.assertRaisesRegex(ValueError, "borough"):
            resolve_rent_carrier(
                "uk:lsoa:E01000001", {"uk:lsoa:E01000001": "uk:lsoa:E01000001"})
        with self.assertRaisesRegex(ValueError, "borough"):
            resolve_rent_carrier(
                "uk:lsoa:E01000001", {"uk:lsoa:E01000001": "uk:lad:XYZ"})


if __name__ == "__main__":
    unittest.main()
