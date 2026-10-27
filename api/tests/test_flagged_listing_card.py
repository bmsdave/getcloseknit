import os
import unittest
from unittest import mock

from area_api.evidence import EvidenceReader

from test_home_match import home
from test_production_evidence import seed_production_fixture

try:
    from fastapi.testclient import TestClient
    from area_api import app as app_module
    from area_api import listing_card
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover
    TestClient = None

FLAGS = ("CLOSE_KNIT_ADDRESS_MATCH", "CLOSE_KNIT_HOME_VALUE")


class StoreConnection:
    """Home-match candidates behind first-line SQL markers."""

    def __init__(self, candidates=()):
        self.candidates = list(candidates)
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        self.statements.append((sql, params))
        marker = sql.split("\n", 1)[0]
        if marker == "-- home-match:postcode":
            return self.candidates
        if marker in ("-- home-match:sales", "-- usage:insert"):
            return []
        raise KeyError(marker)


LISTING = {"portal": "rightmove", "listingId": "93384096", "url": "https://www.rightmove.co.uk/properties/93384096",
           "address": "Middleton Road, London, E8", "market": "buy", "askingPrice": 600000, "bedrooms": 2,
           "lat": 51.535, "lng": -0.145, "postcode": "E8 4BL", "floorAreaSqm": 70, "propertyType": "flat",
           "epcRating": "C"}


@unittest.skipIf(TestClient is None, "dependencies are not installed")
class FlaggedListingCardRouteTests(unittest.TestCase):
    def setUp(self):
        self.previous = app_module._reader, app_module._connect, listing_card._getting_around
        connection = seed_production_fixture()
        app_module._reader = EvidenceReader(connect=lambda: connection)
        self.store = StoreConnection([home("a1", 70), home("a2", 95)])
        app_module._connect = lambda: self.store
        listing_card._getting_around = lambda context, area_id: None
        without_rate_limits(self)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader, app_module._connect, listing_card._getting_around = self.previous

    def post(self, flags=(), body=None):
        env = {name: "" for name in FLAGS} | {name: "1" for name in flags}
        with mock.patch.dict(os.environ, env):
            response = self.client.post("/api/v1/listing-card", json=body or LISTING)
        self.assertEqual(response.status_code, 200, response.text)
        return response

    def test_with_flags_off_the_response_is_byte_identical_and_nothing_is_read(self):
        off = self.post().content
        with mock.patch.object(app_module, "_flagged_home_blocks", lambda card, request: card):
            today = self.post().content

        self.assertEqual(off, today)
        self.assertFalse(any(sql.startswith("-- home-match") for sql, _ in self.store.statements))

    def test_with_every_flag_on_the_home_comes_before_the_actions(self):
        card = self.post(FLAGS).json()

        types = [b["type"] for b in card["blocks"]]
        self.assertEqual(types[-3:], ["home", "actions", "footnote"])
        home_block = card["blocks"][types.index("home")]
        self.assertEqual((home_block["address"], home_block["confidence"]), ("1 Middleton Road, London E8 4BL", "high"))

    def test_a_hidden_home_is_not_shown(self):
        self.store.candidates = [home("a1", 70, hidden=True), home("a2", 95)]

        types = [b["type"] for b in self.post(["CLOSE_KNIT_ADDRESS_MATCH"]).json()["blocks"]]
        self.assertNotIn("home", types)

    def test_an_ambiguous_listing_gets_no_home(self):
        self.store.candidates = [home("a1", 70), home("a2", 70)]

        types = [b["type"] for b in self.post(["CLOSE_KNIT_ADDRESS_MATCH"]).json()["blocks"]]
        self.assertNotIn("home", types)

    def test_a_failing_store_leaves_the_card_as_it_was(self):
        off = self.post().json()
        app_module._connect = lambda: (_ for _ in ()).throw(RuntimeError("no database"))

        self.assertEqual(self.post(FLAGS).json(), off)


if __name__ == "__main__":
    unittest.main()
