"""Notes on open /mcp tool calls: what the agent says the user is looking for, and how it rated the answer.

Behind CLOSE_KNIT_MCP_REQUEST_NOTES (FLAGS.md). With it on, every /mcp tool except send_feedback takes
two optional parameters: `intent`, a short summary the agent writes of what the user wants from this
call, and `rate_previous`, its rating of an earlier answer by that answer's callId. rate_answer rates the
last answer of a conversation. Rows live in mcp_call_note (deploy/migrations/130-mcp-call-note.sql) for
RETENTION_DAYS; contact details and full postcodes are removed before storing. Nothing here may break a
tool call: storage failures are logged, never raised.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Mapping

from pydantic import BaseModel, Field

from . import feedback, usage

logger = logging.getLogger(__name__)

RETENTION_DAYS = 90
PURGE_EVERY_SECONDS = 3600
MAX_TEXT = 500
# A rating may arrive a while after its answer, but not for an answer older than this.
RATE_WINDOW = "1 day"
CALL_ID = re.compile(r"^[0-9a-f]{16}$")
FULL_POSTCODE = re.compile(r"\b([A-Z]{1,2}\d[A-Z\d]?) ?\d[A-Z]{2}\b", re.IGNORECASE)
CONTROL = re.compile(r"[\x00-\x1f\x7f]+")

INSERT_SQL = """-- call_notes:insert
INSERT INTO mcp_call_note (call_id, session_id, client, tool, ok, code, intent, traffic)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"""
RATE_SQL = f"""-- call_notes:rate
UPDATE mcp_call_note SET rating = %s, good = %s, bad = %s, fix = %s, rated_at = now()
WHERE call_id = %s AND created_at >= now() - interval '{RATE_WINDOW}' RETURNING call_id"""
PURGE_SQL = """-- call_notes:purge
WITH gone AS (DELETE FROM mcp_call_note WHERE created_at < %s RETURNING 1) SELECT count(*) AS purged FROM gone"""
LIST_SQL = """-- call_notes:list
SELECT call_id, created_at, client, tool, ok, code, intent, rating, good, bad, fix, traffic FROM mcp_call_note
WHERE created_at >= %s AND traffic = ANY(%s) ORDER BY created_at"""

INTENT_DESCRIPTION = (
    "Optional, one to three sentences you write: what the user is looking for with this call and the "
    "criteria that matter, e.g. '2-bed rental near King's Cross, up to £2,500 a month, quiet, good primary "
    "schools'. Close Knit reads these to improve its answers. Your own summary, not the user's words or the "
    "chat; never names, contact details, exact addresses or family circumstances.")
RATE_DESCRIPTION = (
    "Optional: your rating of an earlier Close Knit answer, by the callId it carried. Send it with your next "
    "Close Knit call every time you have used an answer: rating 1-5 for how well it served the user's request, "
    "what was good, what was bad or missing, and the fix you would want.")


class RatePrevious(BaseModel):
    call_id: str = Field(description="The callId of the answer you are rating.")
    rating: int = Field(description="1 = useless or wrong, 3 = usable with gaps, 5 = exactly what was needed.")
    good: str | None = Field(default=None, description="What was useful in the answer.")
    bad: str | None = Field(default=None, description="What was wrong, missing or confusing.")
    fix: str | None = Field(default=None, description="The change to the tool or its answer you would want.")


_last_purge = 0.0


def new_call_id() -> str:
    return secrets.token_hex(8)


def clean(text: Any, limit: int = MAX_TEXT) -> str | None:
    """Text an agent sent, safe to store: no contact details, outcodes for full postcodes, one line."""
    if not isinstance(text, str):
        return None
    text = FULL_POSTCODE.sub(lambda match: match.group(1).upper(), feedback.scrub(CONTROL.sub(" ", text)))
    text = " ".join(text.split())[:limit]
    return text or None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _purge_if_due(connection: Any) -> None:
    global _last_purge
    if time.monotonic() - _last_purge >= PURGE_EVERY_SECONDS:
        connection.execute(PURGE_SQL, (_now() - timedelta(days=RETENTION_DAYS),))
        _last_purge = time.monotonic()


def record_call(connect: Callable[[], Any] | None, call_id: str, *, tool: str, ok: bool, code: str | None = None,
                session: str | None = None, client: str | None = None, intent: Any = None,
                traffic: str = "live") -> None:
    """One row per call, so a later rating has something to land on."""
    if connect is None:
        return
    try:
        with connect() as connection:
            _purge_if_due(connection)
            connection.execute(INSERT_SQL, (call_id, session, clean(client, 60), tool, ok, code, clean(intent), traffic))
    except Exception:  # noqa: BLE001 - a missing table or database is logged, not raised
        logger.warning("call note for %s not stored", tool, exc_info=True)


def _rating_fields(value: Any) -> tuple[str, int, str | None, str | None, str | None] | None:
    if isinstance(value, BaseModel):
        value = value.model_dump()
    if not isinstance(value, Mapping):
        return None
    call_id, rating = value.get("call_id"), value.get("rating")
    if not isinstance(call_id, str) or not CALL_ID.match(call_id):
        return None
    if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
        return None
    return call_id, rating, clean(value.get("good")), clean(value.get("bad")), clean(value.get("fix"))


def rate(connect: Callable[[], Any] | None, value: Any) -> bool:
    """Store a rating for an earlier answer; False when it is malformed, unknown, too old or not stored."""
    fields = _rating_fields(value)
    if connect is None or fields is None:
        return False
    call_id, rating, good, bad, fix = fields
    try:
        with connect() as connection:
            return bool(list(connection.execute(RATE_SQL, (rating, good, bad, fix, call_id))))
    except Exception:  # noqa: BLE001
        logger.warning("rating for %s not stored", call_id, exc_info=True)
        return False


RATE_ANSWER_DESCRIPTION = (
    "Rate a Close Knit answer by its callId: rating 1-5, what was good, what was bad or missing, the fix you "
    "would want. Use it for the last answer in a conversation; earlier ones go in the next call's rate_previous. "
    "It describes the answer, never the user.")


def rate_answer_result(stored: bool) -> dict:
    caveat = ("Thanks: Close Knit reads every rating." if stored else
              "Not stored: the callId is unknown or older than a day, or the rating is not 1-5.")
    return {"schemaVersion": "tool-rate-answer.v1", "value": {"received": stored}, "confidence": "high",
            "evidence": [], "sources": [], "caveats": [caveat]}


def recent(connect: Callable[[], Any], days: int = 7, traffic: tuple[str, ...] = ("live",)) -> list[dict]:
    with connect() as connection:
        return [dict(row) for row in connection.execute(LIST_SQL, (_now() - timedelta(days=days), list(traffic)))]


def purge(connect: Callable[[], Any]) -> int:
    with connect() as connection:
        return list(connection.execute(PURGE_SQL, (_now() - timedelta(days=RETENTION_DAYS),)))[0]["purged"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m area_api.call_notes", description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="notes from the last N days as JSON lines, oldest first")
    listing.add_argument("--days", type=int, default=7)
    listing.add_argument("--traffic", type=usage.parse_traffic, default=("live",),
                         help="live (default), team, tech, a comma-separated mix, or all")
    commands.add_parser("purge", help=f"delete notes older than {RETENTION_DAYS} days")
    args = parser.parse_args(argv)

    from .repository import evidence_connection

    if args.command == "purge":
        print(f"purged {purge(evidence_connection)}")
        return 0
    for row in recent(evidence_connection, args.days, args.traffic):
        print(json.dumps(row, default=str, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
