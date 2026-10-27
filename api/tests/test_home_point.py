"""B7 (#156): an address's `center` says what it is, and get_home_prices keeps a
`location` key even while the home's point is withheld (owner decision pending)."""
import unittest

from area_api import evidence
from area_api.evidence import EvidenceReader
from tests.test_production_evidence import seed_production_fixture
from tests.test_property_profile import UPRN, FakeConnection


class AddressPointTests(unittest.TestCase):
    def test_address_search_point_is_the_lsoa_centroid(self):
        # Documents today's SQL: the point is the LSOA centroid, never the dwelling.
        self.assertIn("ST_X(ST_Centroid(g.geometry)) AS center_lon", evidence.ADDRESS_SEARCH_SQL)
        self.assertNotIn("p.location", evidence.ADDRESS_SEARCH_SQL)

    def test_address_search_rows_say_what_their_point_is(self):
        rows = [r for r in EvidenceReader(connect=seed_production_fixture).search_areas("Sample Street")["results"]
                if "addressId" in r]
        self.assertTrue(rows)
        for row in rows:
            self.assertIn(row.get("centerPrecision"), ("uprn", "lsoa-centroid"))

    def test_home_prices_carries_the_home_point_key(self):
        from area_api import tools  # noqa: the tool layer needs pydantic
        from area_api.toolspec import ToolContext
        tools._CATALOGUE["rel-test"] = {"productReleaseId": "rel-test", "metrics": []}
        spec = next(spec for spec in tools.AREA_TOOLS if spec.name == "get_home_prices")
        out = spec.handler(ToolContext(reader=EvidenceReader(connect=lambda: FakeConnection())),
                           spec.input_model(property_ref=UPRN))
        self.assertIn("location", out["value"])
        self.assertIn("locationPrecision", out["value"])
        # The point is withheld until the owner decides (B7): keys kept, values null.
        self.assertIsNone(out["value"]["location"])
        self.assertIsNone(out["value"]["locationPrecision"])


if __name__ == "__main__":
    unittest.main()
