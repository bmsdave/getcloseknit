"""Privacy objections: "hide my home".

A request is honoured after the confirmation link is opened (double opt-in);
suppression is a filter over every per-dwelling output, never a deletion.
The store keeps only salted hashes of the e-mail, the confirmation token and
the requesting IP, so a breach reveals nothing about who asked. Requests never
confirmed are deleted after UNCONFIRMED_RETENTION_DAYS (on each new request and
by `python -m area_api.objections purge`); confirmed ones are never purged.
"""
import hashlib
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Mapping

DAILY_LIMIT_PER_IP = 5
DAILY_LIMIT_PER_EMAIL = 3
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
UPRN_PATTERN = re.compile(r"^[0-9]{1,12}$")
ADDRESS_PATTERN = re.compile(r"^uk:addr:[0-9a-f]{12}$")
REASON_MAX = 2000
UNCONFIRMED_RETENTION_DAYS = 30
STATUSES = ("pending", "active", "revoked")

INSERT_SQL = """-- objection:insert
INSERT INTO property_objection (uprn, address_id, contact_email_hash, token_hash, request_ip_hash, reason, requested_at)
VALUES (%s, %s, %s, %s, %s, %s, %s)
RETURNING id"""

COUNT_SINCE_SQL = """-- objection:count-since
SELECT count(*) AS n FROM property_objection
WHERE (CASE %s::text WHEN 'request_ip_hash' THEN request_ip_hash ELSE contact_email_hash END) = %s
  AND requested_at >= %s"""

ACTIVE_FOR_SQL = """-- objection:active-for
SELECT id FROM property_objection
WHERE status = 'active' AND ((%s::text IS NOT NULL AND uprn = %s) OR (%s::text IS NOT NULL AND address_id = %s))"""

CONFIRM_SQL = """-- objection:confirm
UPDATE property_objection SET status = 'active', confirmed_at = %s
WHERE token_hash = %s AND status = 'pending'
RETURNING id, uprn, address_id, status, requested_at, confirmed_at"""

SET_STATUS_SQL = """-- objection:set-status
UPDATE property_objection
SET status = %s,
    confirmed_at = CASE WHEN %s::text = 'active' THEN %s::timestamptz ELSE confirmed_at END,
    revoked_at = CASE WHEN %s::text = 'revoked' THEN %s::timestamptz ELSE revoked_at END
WHERE id = %s
RETURNING id, uprn, address_id, status, requested_at, confirmed_at, revoked_at"""

LIST_SQL = """-- objection:list
SELECT id, uprn, address_id, status, requested_at, confirmed_at, revoked_at
FROM property_objection ORDER BY requested_at DESC LIMIT 500"""

# Never confirmed: still pending and no confirmed_at (an activated-then-revoked row keeps its confirmed_at).
PURGE_UNCONFIRMED_SQL = """-- objection:purge-unconfirmed
DELETE FROM property_objection
WHERE status = 'pending' AND confirmed_at IS NULL AND requested_at < %s"""

PROPERTY_ADDRESS_SQL = """-- objection:property-address
SELECT address_id FROM property WHERE uprn = %s"""


class ObjectionError(Exception):
    pass


class ObjectionLimit(ObjectionError):
    pass


class ObjectionConflict(ObjectionError):
    pass


class ObjectionNotFound(ObjectionError):
    pass


class InvalidObjection(ObjectionError, ValueError):
    pass


def digest(value: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}|{value}".encode()).hexdigest()


def server_salt() -> str:
    return os.environ.get("CLOSE_KNIT_OBJECTION_SALT", "close-knit-dev-salt")


class ObjectionStore:
    def __init__(self, connect: Callable[[], Any], *, salt: str | None = None,
                 now: Callable[[], datetime] | None = None) -> None:
        self._connect = connect
        self._salt = salt or server_salt()
        self._now = now or (lambda: datetime.now(timezone.utc))

    def request(self, *, uprn: str | None, address_id: str | None, email: str,
                reason: str | None, client_ip: str | None) -> dict:
        uprn, address_id, email, reason = _validate(uprn, address_id, email, reason)
        token = secrets.token_urlsafe(32)
        email_hash, ip_hash = digest(email, self._salt), digest(client_ip or "", self._salt)
        now = self._now()
        with self._connect() as connection:
            _purge_unconfirmed(connection, now)
            self._check_limits(connection, email_hash, ip_hash, now)
            address_id = address_id or _address_for(connection, uprn)
            if list(connection.execute(ACTIVE_FOR_SQL, (uprn, uprn, address_id, address_id))):
                raise ObjectionConflict("this home is already hidden")
            rows = list(connection.execute(
                INSERT_SQL, (uprn, address_id, email_hash, digest(token, self._salt), ip_hash, reason, now)))
        return {"id": rows[0]["id"], "status": "pending", "token": token, "email": email,
                "uprn": uprn, "address_id": address_id}

    def confirm(self, token: str) -> dict:
        with self._connect() as connection:
            rows = list(connection.execute(CONFIRM_SQL, (self._now(), digest(token or "", self._salt))))
        if not rows:
            raise ObjectionNotFound("confirmation link is unknown or already used")
        return dict(rows[0])

    def set_status(self, row_id: int, status: str) -> dict:
        if status not in STATUSES:
            raise ValueError(f"unknown status: {status}")
        stamp = self._now()
        with self._connect() as connection:
            rows = list(connection.execute(SET_STATUS_SQL, (status, status, stamp, status, stamp, row_id)))
        if not rows:
            raise ObjectionNotFound(f"no objection with id {row_id}")
        return dict(rows[0])

    def purge_unconfirmed(self) -> int:
        """Delete requests never confirmed within UNCONFIRMED_RETENTION_DAYS; returns how many."""
        with self._connect() as connection:
            return _purge_unconfirmed(connection, self._now())

    def list(self) -> list[dict]:
        with self._connect() as connection:
            return [dict(row) for row in connection.execute(LIST_SQL)]

    def _check_limits(self, connection: Any, email_hash: str, ip_hash: str, now: datetime) -> None:
        since = now - timedelta(days=1)
        by_ip = list(connection.execute(COUNT_SINCE_SQL, ("request_ip_hash", ip_hash, since)))[0]["n"]
        if by_ip >= DAILY_LIMIT_PER_IP:
            raise ObjectionLimit("too many requests from this connection today")
        by_email = list(connection.execute(COUNT_SINCE_SQL, ("contact_email_hash", email_hash, since)))[0]["n"]
        if by_email >= DAILY_LIMIT_PER_EMAIL:
            raise ObjectionLimit("too many requests for this e-mail today")


def _purge_unconfirmed(connection: Any, now: datetime) -> int:
    cursor = connection.execute(PURGE_UNCONFIRMED_SQL, (now - timedelta(days=UNCONFIRMED_RETENTION_DAYS),))
    return max(getattr(cursor, "rowcount", 0) or 0, 0)


def _validate(uprn: str | None, address_id: str | None, email: str, reason: str | None):
    uprn = (uprn or "").strip() or None
    address_id = (address_id or "").strip() or None
    if uprn is None and address_id is None:
        raise InvalidObjection("an objection needs the dwelling's uprn or address id")
    if uprn is not None and not UPRN_PATTERN.match(uprn):
        raise InvalidObjection("invalid uprn")
    if address_id is not None and not ADDRESS_PATTERN.match(address_id):
        raise InvalidObjection("invalid address id")
    email = (email or "").strip().lower()
    if not EMAIL_PATTERN.match(email) or len(email) > 254:
        raise InvalidObjection("a valid e-mail address is needed to confirm the request")
    reason = (reason or "").strip()[:REASON_MAX] or None
    return uprn, address_id, email, reason


def _address_for(connection: Any, uprn: str | None) -> str | None:
    if uprn is None:
        return None
    rows = list(connection.execute(PROPERTY_ADDRESS_SQL, (uprn,)))
    return rows[0]["address_id"] if rows else None


def objection_summary(row: Mapping[str, Any]) -> dict:
    """Public shape: ids and status only — never hashes."""
    return {"id": row["id"], "uprn": row.get("uprn"), "addressId": row.get("address_id"),
            "status": row["status"], "requestedAt": _iso(row.get("requested_at")),
            "confirmedAt": _iso(row.get("confirmed_at")), "revokedAt": _iso(row.get("revoked_at"))}


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else value


def main(argv: list[str] | None = None) -> int:
    """python -m area_api.objections list | revoke <id> | activate <id> | purge"""
    import argparse
    import json
    import sys

    from .repository import close_pool, evidence_connection

    parser = argparse.ArgumentParser(prog="area_api.objections", description=main.__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="show the latest objections (hashes are never printed)")
    for name, help_text in (("revoke", "stop hiding the home"), ("activate", "hide the home without e-mail confirmation")):
        sub.add_parser(name, help=help_text).add_argument("id", type=int)
    sub.add_parser("purge", help=f"delete requests never confirmed within {UNCONFIRMED_RETENTION_DAYS} days")
    args = parser.parse_args(argv)
    store = ObjectionStore(evidence_connection)
    try:
        if args.command == "purge":
            print(json.dumps({"purged": store.purge_unconfirmed()}))
            return 0
        if args.command == "list":
            rows = [objection_summary(row) for row in store.list()]
        else:
            rows = [objection_summary(store.set_status(args.id, "revoked" if args.command == "revoke" else "active"))]
    except ObjectionNotFound as error:
        print(error, file=sys.stderr)
        return 1
    finally:
        # A one-shot CLI: stop the pool's threads, or the process waits 5 s per worker on exit.
        close_pool()
    json.dump(rows, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
