"""Location layers (migration 030): every level from the LSOAs, land never counted twice."""
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
MIGRATION = (DEPLOY / "migrations" / "030-location-layers.sql").read_text()


class LocationSchemaTests(unittest.TestCase):
    def test_tables_and_rebuild_function(self):
        for table in ("conservation_area", "charge_zone", "planning_application", "area_location", "area_conservation"):
            self.assertIn(f"CREATE TABLE {table} (", MIGRATION)
        self.assertIn("FUNCTION public.rebuild_area_location(p_window_start date, p_window_end date)", MIGRATION)

    def test_overlapping_conservation_areas_are_unioned_before_measuring(self):
        self.assertIn("ST_Area(ST_Intersection(l.geom, ST_Union(p.geom)))", MIGRATION)

    def test_msoas_and_boroughs_are_sums_of_their_lsoas(self):
        self.assertIn("GROUP BY g.parent_id;", MIGRATION)
        self.assertIn("WHERE kind = 'lsoa'", MIGRATION)

    def test_planning_counts_stay_inside_the_window(self):
        self.assertIn("a.valid_date >= p_window_start AND a.valid_date <= p_window_end", MIGRATION)


if __name__ == "__main__":
    unittest.main()
