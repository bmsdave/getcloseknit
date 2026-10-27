"""Nature: London percentiles per block, one home's surroundings, wildlife as presence with its effort."""
import contextlib
import unittest

from area_api import evidence, nature

NATURE = {"green_share": 0.4183, "green_percentile": 71, "street_trees": 212, "trees_per_hectare": 9.04,
          "trees_percentile": 64, "top_trees": [{"name": "London Plane", "count": 40}, {"name": "Lime", "count": 22}],
          "site_name": "Brockwell Park", "site_kind": "lnr", "site_metres": 640, "site_percentile": 80,
          "nature_percentile": 77, "ranked": 4994, "source_release_ids": ["src-gla-trees-2025-11", "src-sentinel2-ndvi-2025"]}
WILDLIFE = {"radius_metres": 1000, "first_year": 2021, "last_year": 2025, "records": 489, "bird_species": 47,
            "mammal_species": 3, "amphibian_species": 0, "notable": ["Hedgehog", "Swift"],
            "source_release_id": "src-gbif-wildlife-2026-10"}


class FakeConnection:
    def __init__(self, area=True, tables=True, nature_row=NATURE, wildlife=WILDLIFE, home=None):
        self.area, self.tables, self.nature_row, self.wildlife, self.home = area, tables, nature_row, wildlife, home
        self.calls = []

    def execute(self, sql, params=()):
        marker = sql.splitlines()[0]
        self.calls.append((marker, params))
        if marker == "-- evidence:active-release":
            return [{"release_id": "rel-test"}]
        if marker == "-- nature:area":
            return [{"id": params[0]}] if self.area else []
        if marker == "-- nature:tables":
            return [{"nature": self.tables, "wildlife": self.tables}]
        if marker == "-- nature:area-nature":
            return [self.nature_row] if self.nature_row else []
        if marker == "-- nature:dwelling":
            return [self.home] if self.home else []
        if marker == "-- nature:wildlife":
            return [self.wildlife] if self.wildlife else []
        if marker == "-- nature:sources":
            return [{"id": s, "licence": "OGL-3.0", "attribution": f"{s} attr", "caveats": ["c"]} for s in params[0]]
        raise AssertionError(f"unexpected query {marker}")


def read(connection, area_id="uk:lsoa:E01000001", uprn=None):
    return nature.area_nature(lambda: contextlib.nullcontext(connection), area_id, uprn)


class NaturePayloadTests(unittest.TestCase):
    def test_blocks_carry_region_percentiles(self):
        payload = read(FakeConnection())
        self.assertEqual(payload["schemaVersion"], "area-nature.v1")
        self.assertTrue(payload["available"])
        self.assertEqual(payload["green"], {"share": 0.418, "percentile": 71})
        self.assertEqual(payload["trees"]["perHectare"], 9.0)
        self.assertEqual(payload["trees"]["top"][0], {"name": "London Plane", "count": 40})
        self.assertEqual(payload["site"], {"name": "Brockwell Park", "kind": "lnr", "metres": 640, "percentile": 80})
        self.assertEqual(payload["score"], {"percentile": 77})
        self.assertEqual([s["id"] for s in payload["sources"]],
                         ["src-gbif-wildlife-2026-10", "src-gla-trees-2025-11", "src-sentinel2-ndvi-2025"])

    def test_wildlife_is_presence_with_its_effort(self):
        wildlife = read(FakeConnection())["wildlife"]
        self.assertEqual((wildlife["birds"], wildlife["mammals"], wildlife["notable"]), (47, 3, ["Hedgehog", "Swift"]))
        self.assertTrue(wildlife["enough"])
        thin = read(FakeConnection(wildlife={**WILDLIFE, "records": 12}))["wildlife"]
        self.assertFalse(thin["enough"])  # "few records nearby", never "no wildlife"

    def test_home_surroundings_only_when_asked_and_valid(self):
        connection = FakeConnection(home={"green_share": 0.25, "street_trees": 6})
        self.assertEqual(read(connection, uprn="100023336956")["home"],
                         {"uprn": "100023336956", "greenShare": 0.25, "streetTrees": 6})
        self.assertIsNone(read(FakeConnection())["home"])
        with self.assertRaises(evidence.MalformedQuery):
            read(FakeConnection(), uprn="12; DROP")

    def test_missing_data_is_unknown_not_zero(self):
        payload = read(FakeConnection(nature_row=None, wildlife=None))
        self.assertFalse(payload["available"])
        self.assertEqual((payload["green"], payload["trees"], payload["site"], payload["score"], payload["wildlife"]),
                         (None, None, None, None, None))
        no_green = read(FakeConnection(nature_row={**NATURE, "green_share": None, "nature_percentile": None}))
        self.assertIsNone(no_green["green"])
        self.assertIsNone(no_green["score"])

    def test_outside_london_only_the_nearest_site_is_known(self):
        """Street trees and green cover are London-only sources: elsewhere an LSOA has just its nearest site."""
        row = {**NATURE, "green_share": None, "green_percentile": None, "street_trees": None, "trees_per_hectare": None,
               "trees_percentile": None, "top_trees": [], "site_name": "Roundhay Park LNR", "nature_percentile": None,
               "source_release_ids": ["src-ne-nature-sites-2026-10-0f9b2d1a"]}
        payload = read(FakeConnection(nature_row=row, wildlife=None))
        self.assertTrue(payload["available"])
        self.assertEqual((payload["green"], payload["trees"], payload["score"]), (None, None, None))
        self.assertEqual(payload["site"]["name"], "Roundhay Park LNR")

    def test_before_the_migration_the_area_is_unavailable(self):
        connection = FakeConnection(tables=False)
        payload = read(connection)
        self.assertFalse(payload["available"])
        self.assertNotIn("-- nature:area-nature", [marker for marker, _ in connection.calls])

    def test_unknown_area(self):
        with self.assertRaises(evidence.AreaNotFound):
            read(FakeConnection(area=False))


if __name__ == "__main__":
    unittest.main()
