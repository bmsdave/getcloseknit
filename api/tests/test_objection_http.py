"""HTTP surface of the objection channel: POST privacy-objection → pending row +
confirmation mail + operator notification; GET confirm → active; error codes."""
import unittest
from unittest import mock

from tests.test_objections import FakeObjectionConnection

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api import notify
    from area_api.objections import ObjectionStore
    from area_api.repository import evidence_connection
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover
    TestClient = None

HOME = {"kind": "privacy-objection", "uprn": "100023336956", "email": "Owner@Example.com",
        "description": "I live here"}


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class ObjectionHttpTests(unittest.TestCase):
    def setUp(self):
        self.connection = FakeObjectionConnection()
        app_module._connect = lambda: self.connection
        app_module._objections = ObjectionStore(lambda: self.connection, salt="test-salt")
        self.addCleanup(setattr, app_module, "_connect", evidence_connection)
        self.addCleanup(setattr, app_module, "_objections", None)
        without_rate_limits(self)
        self.client = TestClient(app_module.app)
        self.mail = mock.patch.object(notify, "send_confirmation", return_value="smtp").start()
        self.deliver = mock.patch.object(notify, "deliver", return_value=["webhook"]).start()
        self.addCleanup(mock.patch.stopall)

    def _confirm_url(self):
        return self.mail.call_args.args[1]

    def test_request_confirm_and_reject_duplicates(self):
        with mock.patch.dict("os.environ", {"CLOSE_KNIT_PUBLIC_URL": "https://areas.example/"}):
            response = self.client.post("/api/v1/corrections", json=HOME)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body["status"], body["kind"], body["route"], body["confirmationSent"],
                          body["confirmationChannel"], body["notified"]),
                         ("pending", "privacy-objection", "privacy", True, "smtp", ["webhook"]))
        self.assertNotIn("token", body)
        self.assertEqual(self.mail.call_args.args[0], "owner@example.com")
        self.assertTrue(self._confirm_url().startswith("https://areas.example/api/v1/objections/confirm?token="))
        self.assertEqual(self.deliver.call_args.args[0]["kind"], "privacy-objection")
        self.assertEqual(self.connection.rows[0]["status"], "pending")

        token = self._confirm_url().split("token=")[1]
        confirmed = self.client.get("/api/v1/objections/confirm", params={"token": token})
        self.assertEqual(confirmed.status_code, 200)
        self.assertEqual(confirmed.json()["objection"]["status"], "active")
        self.assertNotIn("contact_email_hash", confirmed.text)
        self.assertEqual(self.connection.rows[0]["status"], "active")

        again = self.client.get("/api/v1/objections/confirm", params={"token": token})
        self.assertEqual(again.status_code, 404)
        self.assertEqual(again.json()["detail"]["error"], "objection-not-found")

        duplicate = self.client.post("/api/v1/corrections", json=HOME)
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.json()["detail"]["error"], "objection-exists")

    def test_validation_and_daily_limit(self):
        missing = self.client.post("/api/v1/corrections", json={"kind": "privacy-objection", "email": "a@b.c"})
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json()["detail"]["error"], "invalid-objection")
        bad_mail = self.client.post("/api/v1/corrections", json={**HOME, "email": "nope"})
        self.assertEqual(bad_mail.status_code, 400)

        for n in range(3):
            response = self.client.post("/api/v1/corrections", json={**HOME, "uprn": f"10002333695{n}"})
            self.assertEqual(response.status_code, 200, response.text)
        limited = self.client.post("/api/v1/corrections", json={**HOME, "uprn": "100023336999"})
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.json()["detail"]["error"], "too-many-requests")

    def test_unsent_mail_is_reported_not_hidden(self):
        self.mail.return_value = None
        response = self.client.post("/api/v1/corrections", json=HOME)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["confirmationSent"])
        self.assertIsNone(response.json()["confirmationChannel"])


if __name__ == "__main__":
    unittest.main()
