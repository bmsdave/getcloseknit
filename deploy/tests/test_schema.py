from pathlib import Path
import unittest


SCHEMA = (Path(__file__).parents[1] / "schema.sql").read_text()


class SchemaTests(unittest.TestCase):
    def test_analytics_tables_cover_routes_schools_and_forecasts(self):
        for table in (
            "school", "school_observation", "school_admission_observation",
            "route_network_release", "travel_time_matrix", "forecast_run",
            "price_forecast", "factor_utility", "profile_analytics_event",
        ):
            self.assertIn(f"CREATE TABLE {table}", SCHEMA)

    def test_profile_analytics_cannot_hold_raw_profile_or_coordinates(self):
        block = SCHEMA.split("CREATE TABLE profile_analytics_event", 1)[1]
        block = block.split(");", 1)[0]

        self.assertNotIn("profile json", block.lower())
        self.assertNotIn("latitude", block.lower())
        self.assertNotIn("longitude", block.lower())
        self.assertIn("destination_count", block)

    def test_validated_source_releases_are_immutable(self):
        self.assertIn("CREATE TRIGGER source_release_immutable", SCHEMA)
        self.assertIn("Source releases are immutable", SCHEMA)

    def test_correction_reports_need_an_id_and_hold_no_profile(self):
        self.assertIn("CREATE TABLE correction_report", SCHEMA)
        block = SCHEMA.split("CREATE TABLE correction_report", 1)[1]
        block = block.split(");", 1)[0]

        self.assertIn("observation_id IS NOT NULL", block)
        self.assertIn("publisher-error", block)
        self.assertIn("transformation-error", block)
        for leaked in ("latitude", "longitude", "destination", "budget"):
            self.assertNotIn(leaked, block.lower())


if __name__ == "__main__":
    unittest.main()
