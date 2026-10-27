"""Outbound notifications for corrections and privacy objections.

Both channels are optional and configured by environment; delivery failures
are logged and never fail the request that triggered them.

  CLOSE_KNIT_CORRECTIONS_WEBHOOK   URL receiving a JSON POST per report
  CLOSE_KNIT_SMTP_HOST / _PORT / _USER / _PASSWORD / _FROM / _TO
"""
import json
import logging
import os
import smtplib
import urllib.request
from email.message import EmailMessage
from typing import Any, Mapping

logger = logging.getLogger(__name__)
TIMEOUT_SECONDS = 5


def deliver(report: Mapping[str, Any]) -> list[str]:
    """Send a correction/objection report to every configured channel."""
    delivered: list[str] = []
    webhook = os.environ.get("CLOSE_KNIT_CORRECTIONS_WEBHOOK")
    if webhook:
        try:
            _post_json(webhook, json.dumps(report).encode(), TIMEOUT_SECONDS)
            delivered.append("webhook")
        except Exception as error:  # noqa: BLE001 - notification must not fail the request
            logger.warning("corrections webhook failed: %s", error)
    smtp = _smtp_settings()
    if smtp and smtp["to"]:
        message = EmailMessage()
        message["From"], message["To"] = smtp["from"], smtp["to"]
        message["Subject"] = f"[Close Knit] {report.get('kind', 'report')} #{report.get('id', '?')}"
        message.set_content(json.dumps(report, indent=2))
        if _try_mail(smtp, message):
            delivered.append("smtp")
    return delivered


def send_confirmation(email: str, confirm_url: str) -> str | None:
    """Double opt-in link to the requester. Returns the channel used: "smtp",
    "webhook" (SMTP unset — the operator's pipeline must forward the mail) or
    None when nothing is configured."""
    smtp = _smtp_settings()
    if smtp:
        message = EmailMessage()
        message["From"], message["To"] = smtp["from"], email
        message["Subject"] = "Close Knit: confirm your request to hide this home"
        message.set_content(
            "Someone asked Close Knit to hide a home's sale history using this e-mail address.\n\n"
            f"To confirm, open this link:\n{confirm_url}\n\n"
            "If you did not ask for this, ignore this message and nothing will change.\n"
            "The request expires if it is not confirmed.\n")
        return "smtp" if _try_mail(smtp, message) else None
    webhook = os.environ.get("CLOSE_KNIT_CORRECTIONS_WEBHOOK")
    if webhook:
        body = json.dumps({"kind": "objection-confirmation", "email": email, "confirmUrl": confirm_url}).encode()
        try:
            _post_json(webhook, body, TIMEOUT_SECONDS)
            return "webhook"
        except Exception as error:  # noqa: BLE001
            logger.warning("objection confirmation webhook failed: %s", error)
            return None
    logger.warning("objection confirmation not sent: neither SMTP nor webhook is configured")
    return None


def self_test(email: str) -> dict[str, bool]:
    """Exercise every configured channel once; used by deploy/preflight.sh."""
    results: dict[str, bool] = {}
    webhook = os.environ.get("CLOSE_KNIT_CORRECTIONS_WEBHOOK")
    if webhook:
        try:
            _post_json(webhook, json.dumps({"kind": "test", "email": email}).encode(), TIMEOUT_SECONDS)
            results["webhook"] = True
        except Exception as error:  # noqa: BLE001
            logger.warning("corrections webhook failed: %s", error)
            results["webhook"] = False
    smtp = _smtp_settings()
    if smtp:
        message = EmailMessage()
        message["From"], message["To"] = smtp["from"], email
        message["Subject"] = "[Close Knit] notification test"
        message.set_content("This is the SMTP self-test from deploy/preflight.sh; nothing to do.\n")
        results["smtp"] = _try_mail(smtp, message)
    return results


def main(argv: list[str] | None = None) -> int:
    """python -m area_api.notify test <email>"""
    import argparse
    import sys

    parser = argparse.ArgumentParser(prog="area_api.notify", description=main.__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("test", help="send a test mail / webhook through the configured channels").add_argument("email")
    args = parser.parse_args(argv)
    results = self_test(args.email)
    if not results:
        print("no notification channel configured: set CLOSE_KNIT_SMTP_HOST and/or "
              "CLOSE_KNIT_CORRECTIONS_WEBHOOK", file=sys.stderr)
        return 1
    for channel, ok in results.items():
        print(f"{channel}: {'OK' if ok else 'FAIL'}")
    return 0 if all(results.values()) else 1


def _smtp_settings() -> dict | None:
    host = os.environ.get("CLOSE_KNIT_SMTP_HOST")
    if not host:
        return None
    return {
        "host": host, "port": int(os.environ.get("CLOSE_KNIT_SMTP_PORT", "587")),
        "user": os.environ.get("CLOSE_KNIT_SMTP_USER") or None,
        "password": os.environ.get("CLOSE_KNIT_SMTP_PASSWORD") or None,
        "from": os.environ.get("CLOSE_KNIT_SMTP_FROM") or "noreply@localhost",
        "to": os.environ.get("CLOSE_KNIT_SMTP_TO") or None,
    }


def _try_mail(smtp: Mapping[str, Any], message: EmailMessage) -> bool:
    try:
        _send_mail(smtp["host"], smtp["port"], smtp["user"], smtp["password"], message)
        return True
    except Exception as error:  # noqa: BLE001
        logger.warning("smtp delivery failed: %s", error)
        return False


def _post_json(url: str, body: bytes, timeout: int) -> None:
    request = urllib.request.Request(url, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout):
        pass


def _send_mail(host: str, port: int, user: str | None, password: str | None, message: EmailMessage) -> None:
    with smtplib.SMTP(host, port, timeout=TIMEOUT_SECONDS) as client:
        client.starttls()
        if user:
            client.login(user, password or "")
        client.send_message(message)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
