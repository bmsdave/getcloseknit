"""Notifications for corrections/objections: optional webhook and SMTP,
configured by environment, never failing the request."""
import contextlib
import io
import json
import os
import unittest
from unittest import mock

from area_api import notify


class NotifyTests(unittest.TestCase):
    def test_no_configuration_means_no_delivery_and_no_error(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(notify.deliver({"kind": "privacy-objection", "id": 1}), [])

    def test_webhook_posts_json_and_smtp_sends_mail_when_configured(self):
        env = {"CLOSE_KNIT_CORRECTIONS_WEBHOOK": "https://hooks.example/abc",
               "CLOSE_KNIT_SMTP_HOST": "smtp.example", "CLOSE_KNIT_SMTP_PORT": "2525",
               "CLOSE_KNIT_SMTP_FROM": "noreply@example.test", "CLOSE_KNIT_SMTP_TO": "privacy@example.test"}
        sent = {}

        def fake_post(url, body, timeout):
            sent["webhook"] = (url, json.loads(body))

        def fake_mail(host, port, user, password, message):
            sent["mail"] = (host, port, message["To"], message["Subject"], message.get_content())

        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(notify, "_post_json", fake_post), mock.patch.object(notify, "_send_mail", fake_mail):
            delivered = notify.deliver({"kind": "privacy-objection", "id": 7, "status": "pending"})

        self.assertEqual(delivered, ["webhook", "smtp"])
        self.assertEqual(sent["webhook"][0], "https://hooks.example/abc")
        self.assertEqual(sent["webhook"][1]["kind"], "privacy-objection")
        self.assertEqual(sent["mail"][:3], ("smtp.example", 2525, "privacy@example.test"))
        self.assertIn("privacy-objection", sent["mail"][3])
        self.assertIn('"id": 7', sent["mail"][4])

    def test_delivery_failures_are_logged_not_raised(self):
        env = {"CLOSE_KNIT_CORRECTIONS_WEBHOOK": "https://hooks.example/abc"}

        def boom(url, body, timeout):
            raise OSError("down")

        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(notify, "_post_json", boom), \
                self.assertLogs("area_api.notify", level="WARNING") as logs:
            self.assertEqual(notify.deliver({"kind": "publisher-error"}), [])
        self.assertTrue(any("webhook" in line for line in logs.output))

    def test_confirmation_mail_goes_to_the_requester_with_the_link(self):
        env = {"CLOSE_KNIT_SMTP_HOST": "smtp.example", "CLOSE_KNIT_SMTP_FROM": "noreply@example.test",
               "CLOSE_KNIT_SMTP_TO": "privacy@example.test"}
        sent = {}

        def fake_mail(host, port, user, password, message):
            sent["to"], sent["body"] = message["To"], message.get_content()

        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(notify, "_send_mail", fake_mail):
            ok = notify.send_confirmation("owner@example.com", "https://ae.example/api/v1/objections/confirm?token=abc")
        self.assertEqual(ok, "smtp")
        self.assertEqual(sent["to"], "owner@example.com")
        self.assertIn("confirm?token=abc", sent["body"])

    def test_confirmation_without_smtp_reports_not_sent(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(notify.send_confirmation("owner@example.com", "https://x/confirm?token=abc"))

    def test_confirmation_falls_back_to_the_webhook_when_smtp_is_unset(self):
        posted = {}

        def fake_post(url, body, timeout):
            posted["url"], posted["body"] = url, json.loads(body)

        env = {"CLOSE_KNIT_CORRECTIONS_WEBHOOK": "https://hooks.example/ae"}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(notify, "_post_json", fake_post):
            channel = notify.send_confirmation("owner@example.com", "https://x/confirm?token=abc")
        self.assertEqual(channel, "webhook")
        self.assertEqual(posted["body"], {"kind": "objection-confirmation", "email": "owner@example.com",
                                          "confirmUrl": "https://x/confirm?token=abc"})

        def failing_post(url, body, timeout):
            raise OSError("down")

        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(notify, "_post_json", failing_post):
            with self.assertLogs("area_api.notify", level="WARNING"):
                self.assertIsNone(notify.send_confirmation("owner@example.com", "https://x/confirm?token=abc"))

    def test_self_test_command_reports_each_channel(self):
        env = {"CLOSE_KNIT_CORRECTIONS_WEBHOOK": "https://hooks.example/ae", "CLOSE_KNIT_SMTP_HOST": "smtp.example"}
        out = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(notify, "_post_json", lambda *a: None), \
                mock.patch.object(notify, "_send_mail", lambda *a: None), \
                contextlib.redirect_stdout(out):
            self.assertEqual(notify.self_test("ops@example.com"), {"webhook": True, "smtp": True})
            self.assertEqual(notify.main(["test", "ops@example.com"]), 0)
        self.assertEqual(out.getvalue(), "webhook: OK\nsmtp: OK\n")
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(notify, "_post_json", lambda *a: None), \
                mock.patch.object(notify, "_send_mail", mock.Mock(side_effect=OSError("refused"))), \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertLogs("area_api.notify", level="WARNING"):
                self.assertEqual(notify.main(["test", "ops@example.com"]), 1)
        with mock.patch.dict(os.environ, {}, clear=True), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(notify.main(["test", "ops@example.com"]), 1)


if __name__ == "__main__":
    unittest.main()
