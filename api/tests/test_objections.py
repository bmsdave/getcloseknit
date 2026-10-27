"""Privacy objections: request -> e-mail confirmation -> suppression, with
abuse limits and no plain e-mail/token ever stored."""
import unittest
from datetime import datetime, timedelta, timezone

from area_api import objections
from area_api.objections import ObjectionStore, ObjectionLimit, ObjectionNotFound, ObjectionConflict

NOW = datetime(2026, 9, 12, 10, 0, tzinfo=timezone.utc)


class FakeObjectionConnection:
    """Dispatches the store's marker comments over an in-memory table."""

    def __init__(self):
        self.rows = []
        self.corrections = []
        self.properties = {"100023336956": "uk:addr:a1b2c3d4e5f6"}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        return {
            "-- objection:insert": self._insert,
            "-- objection:count-since": self._count_since,
            "-- objection:active-for": self._active_for,
            "-- objection:confirm": self._confirm,
            "-- objection:set-status": self._set_status,
            "-- objection:list": self._list,
            "-- objection:property-address": self._property_address,
            "-- objection:purge-unconfirmed": self._purge_unconfirmed,
            "-- correction:insert": self._correction_insert,
        }[marker](params)

    def _correction_insert(self, params):
        observation_id, product_release_id, source_release_id, kind, description = params
        self.corrections.append({"id": len(self.corrections) + 1, "observation_id": observation_id,
                                 "product_release_id": product_release_id, "source_release_id": source_release_id,
                                 "kind": kind, "description": description})
        return [{"id": self.corrections[-1]["id"]}]

    def _insert(self, params):
        uprn, address_id, email_hash, token_hash, ip_hash, reason, requested_at = params
        row = {"id": len(self.rows) + 1, "uprn": uprn, "address_id": address_id,
               "contact_email_hash": email_hash, "token_hash": token_hash, "request_ip_hash": ip_hash,
               "reason": reason, "status": "pending", "requested_at": requested_at,
               "confirmed_at": None, "revoked_at": None}
        self.rows.append(row)
        return [{"id": row["id"]}]

    def _count_since(self, params):
        column, value, since = params
        return [{"n": sum(1 for r in self.rows if r[column] == value and r["requested_at"] >= since)}]

    def _active_for(self, params):
        uprn, _, address_id, _ = params
        return [r for r in self.rows if r["status"] == "active"
                and ((uprn and r["uprn"] == uprn) or (address_id and r["address_id"] == address_id))]

    def _confirm(self, params):
        confirmed_at, token_hash = params
        for r in self.rows:
            if r["token_hash"] == token_hash and r["status"] == "pending":
                r["status"], r["confirmed_at"] = "active", confirmed_at
                return [dict(r)]
        return []

    def _set_status(self, params):
        status, _, stamp, _, _, row_id = params
        for r in self.rows:
            if r["id"] == row_id:
                r["status"] = status
                r["revoked_at" if status == "revoked" else "confirmed_at"] = stamp
                return [dict(r)]
        return []

    def _list(self, params):
        return [dict(r) for r in self.rows]

    def _purge_unconfirmed(self, params):
        (before,) = params
        kept = [r for r in self.rows
                if not (r["status"] == "pending" and r["confirmed_at"] is None and r["requested_at"] < before)]
        result = type("Result", (), {"rowcount": len(self.rows) - len(kept)})()
        self.rows[:] = kept
        return result

    def _property_address(self, params):
        address = self.properties.get(params[0])
        return [{"address_id": address}] if address else []


class ObjectionStoreTests(unittest.TestCase):
    def setUp(self):
        self.connection = FakeObjectionConnection()
        self.store = ObjectionStore(connect=lambda: self.connection, salt="test-salt", now=lambda: NOW)

    def test_request_stores_hashes_and_returns_a_one_time_token(self):
        result = self.store.request(uprn="100023336956", address_id=None, email="Owner@Example.com",
                                    reason="I live here", client_ip="203.0.113.7")

        row = self.connection.rows[0]
        self.assertEqual(result["id"], 1)
        self.assertEqual(result["status"], "pending")
        self.assertEqual(row["address_id"], "uk:addr:a1b2c3d4e5f6")
        self.assertEqual(row["contact_email_hash"], objections.digest("owner@example.com", "test-salt"))
        self.assertEqual(row["token_hash"], objections.digest(result["token"], "test-salt"))
        self.assertEqual(row["request_ip_hash"], objections.digest("203.0.113.7", "test-salt"))
        self.assertNotIn("owner@example.com", str(row))
        self.assertNotIn(result["token"], str(row))
        self.assertGreaterEqual(len(result["token"]), 32)

    def test_confirm_activates_once_and_rejects_unknown_or_used_tokens(self):
        token = self.store.request(uprn="100023336956", address_id=None, email="a@b.c",
                                   reason=None, client_ip="1.1.1.1")["token"]
        confirmed = self.store.confirm(token)
        self.assertEqual(confirmed["status"], "active")
        self.assertEqual(confirmed["confirmed_at"], NOW)
        with self.assertRaises(ObjectionNotFound):
            self.store.confirm(token)
        with self.assertRaises(ObjectionNotFound):
            self.store.confirm("nope")

    def test_one_active_objection_per_dwelling(self):
        token = self.store.request(uprn="100023336956", address_id=None, email="a@b.c", reason=None, client_ip="1.1.1.1")["token"]
        self.store.confirm(token)
        with self.assertRaises(ObjectionConflict):
            self.store.request(uprn=None, address_id="uk:addr:a1b2c3d4e5f6", email="x@y.z", reason=None, client_ip="2.2.2.2")

    def test_daily_limits_per_ip_and_per_email(self):
        for i in range(5):
            self.store.request(uprn=None, address_id=f"uk:addr:{i:012x}", email=f"u{i}@x.y", reason=None, client_ip="9.9.9.9")
        with self.assertRaises(ObjectionLimit):
            self.store.request(uprn=None, address_id="uk:addr:aaaaaaaaaaaa", email="new@x.y", reason=None, client_ip="9.9.9.9")
        for i in range(3):
            self.store.request(uprn=None, address_id=f"uk:addr:{i + 10:012x}", email="same@x.y", reason=None, client_ip=f"10.0.0.{i}")
        with self.assertRaises(ObjectionLimit):
            self.store.request(uprn=None, address_id="uk:addr:bbbbbbbbbbbb", email="same@x.y", reason=None, client_ip="10.0.0.9")

    def test_yesterdays_requests_do_not_count(self):
        for i in range(5):
            self.store.request(uprn=None, address_id=f"uk:addr:{i:012x}", email=f"u{i}@x.y", reason=None, client_ip="9.9.9.9")
        for row in self.connection.rows:
            row["requested_at"] = NOW - timedelta(days=2)
        self.store.request(uprn=None, address_id="uk:addr:cccccccccccc", email="late@x.y", reason=None, client_ip="9.9.9.9")

    def test_revoke_and_activate_by_id(self):
        row_id = self.store.request(uprn="100023336956", address_id=None, email="a@b.c", reason=None, client_ip="1.1.1.1")["id"]
        self.assertEqual(self.store.set_status(row_id, "active")["status"], "active")
        self.assertEqual(self.store.set_status(row_id, "revoked")["status"], "revoked")
        with self.assertRaises(ObjectionNotFound):
            self.store.set_status(99, "revoked")
        self.assertEqual([r["status"] for r in self.store.list()], ["revoked"])

    def test_unconfirmed_requests_are_purged_after_30_days_confirmed_never(self):
        for email in ("stale@x.y", "kept@x.y", "recent@x.y"):
            self.store.request(uprn=None, address_id="uk:addr:cccccccccccc", email=email, reason=None,
                               client_ip=email)
        stale, confirmed, recent = self.connection.rows
        stale["requested_at"] = confirmed["requested_at"] = NOW - timedelta(days=31)
        recent["requested_at"] = NOW - timedelta(days=29)
        self.store.set_status(confirmed["id"], "active")
        self.store.set_status(confirmed["id"], "revoked")  # confirmed once: kept even when revoked
        self.assertEqual(self.store.purge_unconfirmed(), 1)
        self.assertEqual([r["contact_email_hash"] for r in self.connection.rows],
                         [objections.digest(e, "test-salt") for e in ("kept@x.y", "recent@x.y")])

    def test_a_new_request_purges_stale_unconfirmed_ones(self):
        self.store.request(uprn=None, address_id="uk:addr:cccccccccccc", email="old@x.y", reason=None, client_ip="1")
        self.connection.rows[0]["requested_at"] = NOW - timedelta(days=40)
        self.store.request(uprn=None, address_id="uk:addr:dddddddddddd", email="new@x.y", reason=None, client_ip="2")
        self.assertEqual([r["address_id"] for r in self.connection.rows], ["uk:addr:dddddddddddd"])

    def test_request_needs_a_dwelling_and_a_plausible_email(self):
        with self.assertRaises(ValueError):
            self.store.request(uprn=None, address_id=None, email="a@b.c", reason=None, client_ip="1.1.1.1")
        with self.assertRaises(ValueError):
            self.store.request(uprn="1", address_id=None, email="not-an-email", reason=None, client_ip="1.1.1.1")
        with self.assertRaises(ValueError):
            self.store.request(uprn="abc", address_id=None, email="a@b.c", reason=None, client_ip="1.1.1.1")


class ObjectionCliTests(unittest.TestCase):
    """`python -m area_api.objections` closes the pool, or exit waits 5 s per pool thread."""

    def setUp(self):
        from contextlib import redirect_stderr, redirect_stdout
        from io import StringIO
        from unittest import mock

        from area_api import repository

        self.connection = FakeObjectionConnection()
        self.closed = 0

        def close():
            self.closed += 1

        patches = [mock.patch.object(repository, "evidence_connection", lambda: self.connection),
                   mock.patch.object(repository, "close_pool", close),
                   redirect_stdout(StringIO()), redirect_stderr(StringIO())]
        for patch in patches:
            patch.__enter__()
            self.addCleanup(patch.__exit__, None, None, None)

    def test_every_command_closes_the_pool(self):
        store = ObjectionStore(connect=lambda: self.connection, salt="test-salt", now=lambda: NOW)
        row_id = store.request(uprn="100023336956", address_id=None, email="a@b.c", reason=None,
                               client_ip="1.1.1.1")["id"]
        for argv, code in ((["revoke", str(row_id)], 0), (["list"], 0), (["purge"], 0), (["revoke", "99"], 1)):
            with self.subTest(argv=argv):
                before = self.closed
                self.assertEqual(objections.main(argv), code)
                self.assertEqual(self.closed, before + 1)


if __name__ == "__main__":
    unittest.main()
