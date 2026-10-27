from pathlib import Path
import unittest


DEPLOY = Path(__file__).parents[1]
SCHEMA = (DEPLOY / "schema.sql").read_text()
MIGRATION = (DEPLOY / "migrations" / "001-ons-statistical-boundaries.sql").read_text()
SEED = (DEPLOY / "tests" / "seed-area.sql").read_text()


class GeographyDeployTests(unittest.TestCase):
    def test_stable_statistical_ids_are_preserved(self):
        self.assertIn(r"^uk:(lsoa|msoa|borough):E[0-9]{8}$", SCHEMA)
        self.assertIn("uk:lsoa:E01000001", SEED)

    def test_boundary_rows_are_immutable(self):
        self.assertIn("area_geography_immutable", MIGRATION)
        self.assertIn("Area geography releases are immutable", MIGRATION)

    def test_hierarchy_is_reconciled_lsoa_to_borough(self):
        for fragment in (
            "LSOA rows must reference an MSOA parent",
            "MSOA rows must reference a borough parent",
            "Borough is not a London borough",
            "E09000033",
        ):
            self.assertIn(fragment, MIGRATION)

    def test_geometries_are_validated_multipolygons(self):
        for fragment in (
            "MULTIPOLYGON",
            "SRID 4326",
            "ST_IsValid",
        ):
            self.assertIn(fragment, MIGRATION)


if __name__ == "__main__":
    unittest.main()
