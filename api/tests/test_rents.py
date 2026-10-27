"""Rent mode (stream G2, migration 029): borough rents reach matching as borough-carried rows."""
import contextlib
import unittest
from unittest import mock

from area_api import matching, repository

ROW = {"geography_id": "uk:lsoa:E01000907", "name": "Camden 001A", "factor_id": "affordability",
       "raw_value": 3112, "utility": None, "unit": "GBP/month", "bedrooms": "2 bedrooms",
       "carrier_geography_id": "uk:lad:E09000007", "quality": "fallback",
       "source_release_id": "src-ons-pipr-2026-09", "period": "2026-08-01", "product_release_id": "rel"}


class FakeConnection:
    def __init__(self, loaded=True):
        self.loaded, self.statements = loaded, []

    def execute(self, sql, params=()):
        self.statements.append((sql.split("\n", 1)[0], params))
        if "-- evidence:rent-table" in sql:
            return [{"t": self.loaded}]
        if "-- evidence:borough-rent" in sql:
            return [ROW] if params[0] == ROW["bedrooms"] else []
        return []


def _profile(market="rent", bedrooms=2):
    return {"schemaVersion": "preference-profile.v1", "market": market, "targetBudget": 2500,
            "maximumBudget": 3500, "bedrooms": bedrooms, "commuteDestinations": [],
            "factors": [{"factorId": "affordability", "weight": 5, "direction": "target-range",
                         "minimumUtility": None, "maximumUtility": None}]}


class RentRowsTests(unittest.TestCase):
    def test_bedroom_cells_match_matching_and_studios_have_none(self):
        self.assertIsNone(repository.rent_cell(0))
        for bedrooms in range(1, 9):
            self.assertEqual(repository.rent_cell(bedrooms), matching._rent_bedroom_cell(bedrooms))

    def test_rows_are_read_for_the_cell_and_skipped_before_the_migration(self):
        connection = FakeConnection()
        self.assertEqual(repository.rent_rows(connection, 2, ["uk:lsoa:E01000907"]), [ROW])
        self.assertEqual(connection.statements[-1], ("-- evidence:borough-rent",
                                                     ("2 bedrooms", ["uk:lsoa:E01000907"], ["uk:lsoa:E01000907"])))
        self.assertEqual(repository.rent_rows(FakeConnection(loaded=False), 2), [])
        studio = FakeConnection()
        self.assertEqual(repository.rent_rows(studio, 0), [])
        self.assertEqual(studio.statements, [])

    def test_load_match_evidence_adds_rent_rows_only_for_rent_searches(self):
        connection = FakeConnection()
        pool = mock.Mock()
        pool.connection = lambda: contextlib.nullcontext(connection)
        with mock.patch.object(repository, "_pool", return_value=pool), \
                mock.patch.object(repository, "analytics_event", return_value=None):
            rows = repository.load_match_evidence(_profile())
            bought = repository.load_match_evidence(_profile(market="buy"))
        self.assertEqual(rows, [ROW])
        self.assertNotIn(ROW, bought)
        component = matching.build_match_pack(_profile(), rows)["values"][0]["components"][0]
        self.assertEqual((component["rawValue"], component["unit"], component["carrierGeographyId"]),
                         (3112, "GBP/month", "uk:lad:E09000007"))
        self.assertEqual(round(component["utility"]), 39)


if __name__ == "__main__":
    unittest.main()
