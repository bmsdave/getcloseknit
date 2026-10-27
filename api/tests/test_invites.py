"""Counted invite links: GET never spends a use, POST spends one and sets the
access cookie, a used-up or unknown code says to ask for a new link."""
import unittest
from unittest import mock

from area_api import invites

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api.repository import evidence_connection
except ImportError:  # pragma: no cover
    TestClient = None

SECRET = "s" * 32


class FakeInviteConnection:
    def __init__(self, codes):
        self.codes = codes  # code -> [max_uses, used]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params):
        entry = self.codes.get(params[0])
        if sql == invites.REMAINING_SQL:
            return [] if entry is None else [{"remaining": entry[0] - entry[1]}]
        if sql == invites.REDEEM_SQL:
            if entry is None or entry[1] >= entry[0]:
                return []
            entry[1] += 1
            return [{"remaining": entry[0] - entry[1]}]
        raise AssertionError(sql)


class InviteStoreTests(unittest.TestCase):
    def test_redeem_spends_until_used_up(self):
        connection = FakeInviteConnection({"friends-01": [2, 0]})
        connect = lambda: connection
        self.assertTrue(invites.redeem(connect, "friends-01"))
        self.assertTrue(invites.redeem(connect, "friends-01"))
        self.assertFalse(invites.redeem(connect, "friends-01"))
        self.assertEqual(invites.remaining(connect, "friends-01"), 0)

    def test_malformed_codes_never_reach_the_database(self):
        connect = mock.Mock(side_effect=AssertionError("no query"))
        self.assertFalse(invites.redeem(connect, "x'; drop"))
        self.assertIsNone(invites.remaining(connect, ""))

    def test_secret_must_be_long(self):
        with mock.patch.dict("os.environ", {"CLOSE_KNIT_INVITE_TOKEN": "short"}):
            self.assertIsNone(invites.access_secret())
        with mock.patch.dict("os.environ", {"CLOSE_KNIT_INVITE_TOKEN": SECRET}):
            self.assertEqual(invites.access_secret(), SECRET)


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class InviteHttpTests(unittest.TestCase):
    def setUp(self):
        self.codes = {"friends-01": [1, 0]}
        connection = FakeInviteConnection(self.codes)
        app_module._connect = lambda: connection
        self.addCleanup(setattr, app_module, "_connect", evidence_connection)
        patcher = mock.patch.dict("os.environ", {"CLOSE_KNIT_INVITE_TOKEN": SECRET})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(app_module.app)

    def test_page_then_redeem_then_used_up(self):
        page = self.client.get("/access/invite", params={"code": "friends-01"})
        self.assertEqual(page.status_code, 200)
        self.assertIn('action="/access/redeem"', page.text)
        self.assertEqual(self.codes["friends-01"][1], 0, "viewing the page spends nothing")

        redeemed = self.client.post("/access/redeem", data={"code": "friends-01"},
                                    follow_redirects=False)
        self.assertEqual(redeemed.status_code, 303)
        self.assertEqual(redeemed.headers["location"], "/")
        self.assertIn(f"ae_invite={SECRET};", redeemed.headers["set-cookie"])
        self.assertIn("HttpOnly", redeemed.headers["set-cookie"])

        again = self.client.post("/access/redeem", data={"code": "friends-01"},
                                 follow_redirects=False)
        self.assertEqual(again.status_code, 410)
        self.assertIn("Ask the person who sent it to you for a new one", again.text)
        self.assertNotIn("set-cookie", again.headers)
        self.assertEqual(self.client.get("/access/invite", params={"code": "friends-01"}).status_code, 410)

    def test_unknown_code_and_invites_off(self):
        self.assertEqual(self.client.get("/access/invite", params={"code": "nope-nope"}).status_code, 404)
        with mock.patch.dict("os.environ", {"CLOSE_KNIT_INVITE_TOKEN": ""}):
            off = self.client.post("/access/redeem", data={"code": "friends-01"}, follow_redirects=False)
        self.assertEqual(off.status_code, 404)
        self.assertEqual(self.codes["friends-01"][1], 0)


if __name__ == "__main__":
    unittest.main()
