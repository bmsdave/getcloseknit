"""Street-level home endpoint: a home with no recorded sale still gets a page (fixture connection)."""
import os
import re
import unittest
from unittest import mock

from area_api import street_home as sh
from area_api.evidence import EvidenceReader, MalformedQuery

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover
    TestClient = None

BOROUGH = "uk:lad:E09000009"
STREET = "Meadvale Road"
JOHNS = "St John's Road"
HYPHEN = "Stoke-on-Trent Road"
# street name -> {house number: postcode} of its recorded homes
RECORDED = {
    # W5 1LS is a second postcode on the same street
    STREET: {104: "W5 1LR", 114: "W5 1LR", 116: "W5 1LR", 124: "W5 1LR", 126: "W5 1LR", 130: "W5 1LS", 132: "W5 1LS"},
    JOHNS: {10: "W5 2AA", 14: "W5 2AA"},
    HYPHEN: {20: "W5 3BB", 24: "W5 3BB"},
}
UPRNS = {116: "100023336116", 124: "100023336124"}


class FakeConnection:
    """Answers each street-home statement by its first-line marker, like test_property_profile."""

    def __init__(self, *, street_table=True, hidden=(), filler=0, uprns=None, flats=(), no_uprn=(), epc=None):
        self.street_table, self.hidden = street_table, set(hidden)  # house numbers whose home is hidden
        self.filler = filler  # unrelated homes in the postcode that a bare LIMIT could page past
        self.uprns = UPRNS if uprns is None else uprns
        self.flats = flats  # (address prefix, uprn) of more homes at a Meadvale Road number
        self.no_uprn = set(no_uprn)  # house numbers whose recorded home has no UPRN
        self.epc = epc or {}  # house label ("120", "118a") -> uprn of a home known only from its EPC (W5 1LR)
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        self.statements.append((sql, params))
        return {
            "-- evidence:street-table": lambda: [{"t": self.street_table}],
            "-- street-home:street": lambda: self._street(params),
            "-- evidence:street-homes": lambda: self._street_homes(params),
            "-- street-home:postcode-homes": lambda: self._postcode_homes(params),
            "-- street-home:epc-homes": lambda: self._epc_homes(params),
            "-- property-profile:epc-table": lambda: [{"t": True}],  # migration 089 applied here
        }[sql.split("\n", 1)[0]]()

    def _street(self, params):
        postcode, key = params
        for name, homes in RECORDED.items():
            # the borough covers W5 1LT too, where the street has no recorded home
            if sh.street_key(name) == key and (postcode in homes.values() or postcode == "W5 1LT"):
                return [{"name": name, "borough_id": BOROUGH, "lsoa_code": "E01001209",
                         "center_lon": -0.3103, "center_lat": 51.5124}]
        return []

    def _street_homes(self, params):
        street, borough = params
        for name, homes in RECORDED.items():
            if street == " ".join(name.upper().split()) and borough == BOROUGH:
                return [{"display_address": f"{n} {name.upper()}, LONDON, {pc}", "postcode": pc}
                        for n, pc in homes.items() if n not in self.hidden]
        return []

    def _postcode_homes(self, params):
        postcode, pattern = params
        assert "ORDER BY hidden DESC" in self.statements[-1][0], "hidden homes must come first"
        rows = [{"display_address": f"{900 + i} OTHER ROAD, LONDON, W5 1LR", "uprn": None, "hidden": False}
                for i in range(self.filler)]
        for name, homes in RECORDED.items():
            rows += [{"display_address": f"{n} {name.upper()}, LONDON, {pc}",
                      "uprn": None if n in self.no_uprn else self.uprns.get(n),
                      "hidden": n in self.hidden} for n, pc in homes.items() if pc == postcode]
        rows += [{"display_address": f"{prefix} {STREET.upper()}, LONDON, W5 1LR", "uprn": uprn, "hidden": False}
                 for prefix, uprn in self.flats]
        # the real statement filters on the address regex in SQL
        return [row for row in rows if re.search(pattern, row["display_address"], re.I)]


    def _epc_homes(self, params):
        postcode, pattern = params
        rows = [{"display_address": f"{label}, {STREET}, London, W5 1LR", "uprn": uprn, "hidden": False}
                for label, uprn in self.epc.items() if postcode == "W5 1LR"]
        return [row for row in rows if re.search(pattern, row["display_address"], re.I)]


def connect_to(connection):
    return lambda: connection


class StreetHomeTests(unittest.TestCase):
    def test_parse_house_slug(self):
        self.assertEqual(sh.parse_house_slug("120-meadvale-road"), (120, "", "MEADVALE ROAD"))
        self.assertIsNone(sh.parse_house_slug("flat-b"))
        self.assertEqual(sh.parse_house_slug("12a-high-street"), (12, "a", "HIGH STREET"))
        self.assertEqual(sh.parse_house_slug("12A-high-street"), (12, "a", "HIGH STREET"))

    def test_unsold_home_resolves(self):
        home = sh.street_home(connect_to(FakeConnection()), "W5 1LR", "120-meadvale-road")
        self.assertEqual(home["label"], "120 Meadvale Road")
        self.assertEqual(home["postcode"], "W5 1LR")
        self.assertEqual(home["likelyPostcode"], "W5 1LR")
        self.assertEqual(home["neighbours"], [116, 124])
        self.assertEqual(home["areaId"], "uk:lsoa:E01001209")
        self.assertEqual(home["point"], {"lat": 51.5124, "lon": -0.3103})
        self.assertIn("epc", home["withheld"])

    def test_unknown_number_on_unrelated_street_is_none(self):
        self.assertIsNone(sh.street_home(connect_to(FakeConnection()), "W5 1LR", "7-nowhere-lane"))

    def test_street_in_another_postcode_is_none(self):
        self.assertIsNone(sh.street_home(connect_to(FakeConnection()), "SW1A 1AA", "120-meadvale-road"))

    def test_recorded_home_returns_uprn(self):
        self.assertEqual(sh.street_home(connect_to(FakeConnection()), "W5 1LR", "116-meadvale-road"),
                         {"uprn": UPRNS[116]})

    def test_hidden_home_is_answered_like_an_unrecorded_number(self):
        # Ruling A: a hidden home's number gets the same generic page as a never-recorded number, with
        # nothing from its record (no uprn, sales or facts) and no telling status or shape.
        hidden = sh.street_home(connect_to(FakeConnection(hidden={124})), "W5 1LR", "124-meadvale-road")
        unrecorded = sh.street_home(connect_to(FakeConnection()), "W5 1LR", "122-meadvale-road")
        self.assertEqual(set(hidden), set(unrecorded))
        self.assertEqual({key: type(value) for key, value in hidden.items()},
                         {key: type(value) for key, value in unrecorded.items()})
        self.assertNotIn("uprn", hidden)
        self.assertEqual(hidden["label"], "124 Meadvale Road")
        self.assertNotIn(UPRNS[124], repr(hidden))
        self.assertNotIn(124, hidden["neighbours"])

    def test_hidden_home_reached_through_another_postcode_of_its_street(self):
        # The hidden 124 is in W5 1LR; W5 1LS is the street's other postcode: still the generic page.
        home = sh.street_home(connect_to(FakeConnection(hidden={124})), "W5 1LS", "124-meadvale-road")
        self.assertEqual(home["label"], "124 Meadvale Road")
        self.assertEqual(home["postcode"], "W5 1LS")
        self.assertNotIn("uprn", home)
        self.assertNotIn(UPRNS[124], repr(home))

    def test_number_outside_the_streets_recorded_range_is_none(self):
        # Meadvale Road's recorded numbers run 104..132.
        for slug in ("2-meadvale-road", "103-meadvale-road", "133-meadvale-road", "999-meadvale-road"):
            self.assertIsNone(sh.street_home(connect_to(FakeConnection()), "W5 1LR", slug), slug)
        self.assertEqual(sh.street_home(connect_to(FakeConnection()), "W5 1LR", "105-meadvale-road")["label"],
                         "105 Meadvale Road")

    def test_hidden_home_at_the_end_of_the_range_is_like_a_number_past_it(self):
        # 132 is the street's top number; hidden, the street reads as if it ends at 130.
        connection = FakeConnection(hidden={132})
        self.assertIsNone(sh.street_home(connect_to(connection), "W5 1LS", "132-meadvale-road"))
        self.assertIsNone(sh.street_home(connect_to(FakeConnection()), "W5 1LS", "134-meadvale-road"))

    def test_recorded_home_without_a_uprn_sends_to_the_postcode_page(self):
        # Ruling B: matching rows, none with a UPRN, none hidden: never a "No recorded sale" page.
        connection = FakeConnection(no_uprn={114})
        self.assertEqual(sh.street_home(connect_to(connection), "W5 1LR", "114-meadvale-road"),
                         {"postcodePage": True})

    def test_letter_suffix_keeps_its_letter_and_matches_exactly(self):
        # Ruling I: 118a is never 118B's page; with no 118A recorded it is an unrecorded number in range.
        connection = FakeConnection(flats=[("118B", "100023336118")])
        home = sh.street_home(connect_to(connection), "W5 1LR", "118a-meadvale-road")
        self.assertEqual(home["label"], "118a Meadvale Road")
        self.assertNotIn("uprn", home)
        self.assertEqual(sh.street_home(connect_to(connection), "W5 1LR", "118b-meadvale-road"),
                         {"uprn": "100023336118"})
        self.assertEqual(sh.street_home(connect_to(connection), "W5 1LR", "118-meadvale-road")["label"],
                         "118 Meadvale Road")
        # A plain number is not its lettered neighbour either.
        self.assertNotIn("uprn", sh.street_home(connect_to(connection), "W5 1LR", "118-meadvale-road"))

    def test_epc_only_home_redirects_to_its_page_while_the_flag_is_on(self):
        connection = FakeConnection(epc={"120": "12086011"})
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_EPC_ADDRESSES": "1"}):
            self.assertEqual(sh.street_home(connect_to(connection), "W5 1LR", "120-meadvale-road"), {"uprn": "12086011"})
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_EPC_ADDRESSES": "0"}):
            home = sh.street_home(connect_to(FakeConnection(epc={"120": "12086011"})), "W5 1LR", "120-meadvale-road")
        self.assertNotIn("uprn", home)
        self.assertEqual(home["label"], "120 Meadvale Road")

    def test_epc_only_home_keeps_its_letter_suffix(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_EPC_ADDRESSES": "1"}):
            plain = sh.street_home(connect_to(FakeConnection(epc={"118a": "999"})), "W5 1LR", "118-meadvale-road")
            lettered = sh.street_home(connect_to(FakeConnection(epc={"118a": "999"})), "W5 1LR", "118a-meadvale-road")
        self.assertNotIn("uprn", plain)
        self.assertEqual(lettered, {"uprn": "999"})

    def test_lowercase_spaced_postcode_accepted(self):
        spaced = sh.street_home(connect_to(FakeConnection()), "w5 1lr", "120-meadvale-road")
        dashed = sh.street_home(connect_to(FakeConnection()), "W5-1LR", "120-meadvale-road")
        self.assertEqual(spaced, dashed)
        self.assertEqual(spaced["postcode"], "W5 1LR")

    def test_hidden_home_is_found_in_a_postcode_with_many_homes(self):
        # R2: the lookup is filtered to the street number in SQL, so a big postcode cannot push the
        # hidden row off an arbitrary first page; hidden rows also sort first.
        connection = FakeConnection(hidden={124}, filler=600)
        self.assertNotIn("uprn", sh.street_home(connect_to(connection), "W5 1LR", "124-meadvale-road"))
        pattern = [p for sql, p in connection.statements if sql.startswith("-- street-home:postcode-homes")][0][1]
        self.assertTrue(re.search(pattern, "124 MEADVALE ROAD, LONDON, W5 1LR", re.I))
        self.assertFalse(re.search(pattern, "900 OTHER ROAD, LONDON, W5 1LR", re.I))

    def test_apostrophe_street_resolves(self):
        home = sh.street_home(connect_to(FakeConnection()), "W5 2AA", "12-st-johns-road")
        self.assertEqual(home["label"], "12 St John's Road")
        self.assertEqual(home["neighbours"], [10, 14])

    def test_hyphenated_street_resolves(self):
        home = sh.street_home(connect_to(FakeConnection()), "W5 3BB", "22-stoke-on-trent-road")
        self.assertEqual(home["label"], "22 Stoke-on-Trent Road")
        self.assertEqual(home["neighbours"], [20, 24])

    def test_street_in_borough_but_postcode_not_among_its_postcodes_is_none(self):
        self.assertIsNone(sh.street_home(connect_to(FakeConnection()), "W5 1LT", "120-meadvale-road"))

    def test_lowest_uprn_is_returned_when_a_number_has_several_homes(self):
        connection = FakeConnection(uprns={116: "100023336999"}, flats=[("Flat B, 116", "100023336116")])
        self.assertEqual(sh.street_home(connect_to(connection), "W5 1LR", "116-meadvale-road"),
                         {"uprn": "100023336116"})

    def test_malformed_postcode_is_rejected(self):
        with self.assertRaises(MalformedQuery):
            sh.street_home(connect_to(FakeConnection()), "nope", "120-meadvale-road")

    def test_street_table_missing_is_none(self):
        self.assertIsNone(sh.street_home(connect_to(FakeConnection(street_table=False)), "W5 1LR",
                                         "120-meadvale-road"))


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class HttpTests(unittest.TestCase):
    def setUp(self):
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=lambda: FakeConnection(hidden={124}))
        without_rate_limits(self)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_route(self):
        ok = self.client.get("/api/v1/homes/at/W5-1LR/120-meadvale-road")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["label"], "120 Meadvale Road")
        self.assertEqual(self.client.get("/api/v1/homes/at/W5-1LR/116-meadvale-road").json(),
                         {"uprn": UPRNS[116]})
        hidden = self.client.get("/api/v1/homes/at/W5-1LR/124-meadvale-road")
        unrecorded = self.client.get("/api/v1/homes/at/W5-1LR/122-meadvale-road")
        self.assertEqual((hidden.status_code, set(hidden.json())), (unrecorded.status_code, set(unrecorded.json())))
        self.assertNotIn("uprn", hidden.json())
        self.assertEqual(self.client.get("/api/v1/homes/at/W5-1LR/999-meadvale-road").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/homes/at/W5-1LR/flat-b").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/homes/at/nope/120-meadvale-road").status_code, 400)


if __name__ == "__main__":
    unittest.main()
