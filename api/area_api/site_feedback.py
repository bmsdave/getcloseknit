"""Feedback people chose to send from the website: votes and reviews.

A vote is a 👍/👎 on an area-page card or a Find my area shortlist, with reasons after a 👎; a review is
a 1-5 star rating with reasons and text (docs/superpowers/specs/2026-10-14-user-feedback-design.md).
It is anonymous: no analytics id, session, IP address or user agent, and contact details in text are
removed. The browser makes client_id, so a changed vote or added reasons update their own row. Items
live in site_feedback (deploy/migrations/053-site-feedback.sql) for RETENTION_DAYS and are read on the
server with deploy/tools/feedback.sh web (`python -m area_api.site_feedback list|purge`).
"""
from __future__ import annotations

import argparse
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from .feedback import scrub
from .usage import parse_traffic

RETENTION_DAYS = 365
MAX_MESSAGE = 2000
MAX_PATH = 120
MAX_AREA = 40
DEVICES = ("mobile", "tablet", "desktop")

AREA_CARD_REASONS = ("hard_to_understand", "looks_wrong", "missing_info", "out_of_date")
SHORTLIST_REASONS = ("too_expensive", "too_far", "wrong_areas", "too_few", "unclear_why")
REVIEW_LOW = ("hard_to_use", "missing_data", "wrong_data", "not_covered", "slow", "broken")
REVIEW_HIGH = ("easy_to_use", "useful_data", "found_areas", "looks_good", "fast")

# What each surface accepts: its kind, its targets (None: no target) and its reasons.
SURFACES: dict[str, dict] = {
    "area_card": {"kind": "vote", "reasons": AREA_CARD_REASONS, "targets": frozenset(
        {"price", "sales", "living", "schools", "around", "environment", "planning", "council", "home"})},
    "shortlist": {"kind": "vote", "reasons": SHORTLIST_REASONS, "targets": frozenset({"buy", "rent"})},
    "site": {"kind": "review", "reasons": None, "targets": None},
}

UPSERT_SQL = """-- site_feedback:upsert
INSERT INTO site_feedback (client_id, kind, surface, target, area, vote, rating, tags, message, path, device, traffic)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (client_id) DO UPDATE SET vote = EXCLUDED.vote, rating = EXCLUDED.rating, tags = EXCLUDED.tags,
    message = EXCLUDED.message, updated_at = now()"""
PURGE_SQL = """-- site_feedback:purge
WITH gone AS (DELETE FROM site_feedback WHERE created_at < %s RETURNING 1) SELECT count(*) AS purged FROM gone"""
LIST_SQL = """-- site_feedback:list
SELECT id, kind, surface, target, area, vote, rating, tags, message, path, device, traffic, created_at, updated_at
FROM site_feedback WHERE created_at >= %s AND traffic = ANY(%s) ORDER BY created_at"""


class InvalidFeedback(ValueError):
    """The payload is not feedback this site asks for."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _whole(value: Any) -> int | None:
    """An int that is not a bool, else None."""
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _reasons(tags: Any, allowed: tuple[str, ...]) -> list[str]:
    if not isinstance(tags, list):
        return []
    return list(dict.fromkeys(tag for tag in tags if isinstance(tag, str) and tag in allowed))


def _message(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise InvalidFeedback("message must be text")
    text = scrub(value)
    if len(text) > MAX_MESSAGE:
        raise InvalidFeedback(f"message is longer than {MAX_MESSAGE} characters")
    return text or None


def clean(payload: Any, team_header: str | None = None) -> tuple:
    """One row (client_id, kind, surface, target, area, vote, rating, tags, message, path, device, traffic),
    or InvalidFeedback. Unknown reasons are dropped; anything else unknown is refused. traffic is team for
    a team browser (?team=1 sends team: true) or the team header, else live (area_api.usage.traffic)."""
    if not isinstance(payload, dict):
        raise InvalidFeedback("feedback must be an object")
    try:
        client_id = str(uuid.UUID(str(payload.get("client_id"))))
    except ValueError:
        raise InvalidFeedback("client_id must be a UUID") from None
    surface = SURFACES.get(payload.get("surface"))
    kind = payload.get("kind")
    if surface is None or kind != surface["kind"]:
        raise InvalidFeedback("unknown surface or kind")
    target = payload.get("target")
    if surface["targets"] is None:
        target = None
    elif target not in surface["targets"]:
        raise InvalidFeedback("unknown target")
    area = payload.get("area")
    if area is not None and (not isinstance(area, str) or len(area) > MAX_AREA):
        raise InvalidFeedback("area must be a short id")

    vote = rating = None
    if kind == "vote":
        vote = _whole(payload.get("vote"))
        if vote not in (-1, 1) or payload.get("rating") is not None:
            raise InvalidFeedback("a vote is 1 or -1 and has no rating")
        tags = _reasons(payload.get("tags"), surface["reasons"])
    else:
        rating = _whole(payload.get("rating"))
        if rating is None or not 1 <= rating <= 5 or payload.get("vote") is not None:
            raise InvalidFeedback("a review has a rating of 1-5 and no vote")
        tags = _reasons(payload.get("tags"), REVIEW_HIGH if rating >= 4 else REVIEW_LOW)

    path = payload.get("path")
    path = path[:MAX_PATH] if isinstance(path, str) else None
    device = payload.get("device") if payload.get("device") in DEVICES else None
    traffic = "team" if payload.get("team") is True or (team_header or "").strip() == "1" else "live"
    return (client_id, kind, payload["surface"], target, area, vote, rating, tags,
            _message(payload.get("message")), path, device, traffic)


def store(connect: Callable[[], Any], row: tuple) -> None:
    """Purge items past RETENTION_DAYS, then insert the row or update its vote, rating, reasons and text."""
    with connect() as connection:
        connection.execute(PURGE_SQL, (_now() - timedelta(days=RETENTION_DAYS),))
        connection.execute(UPSERT_SQL, row)


def recent(connect: Callable[[], Any], days: int = 30, traffic: tuple[str, ...] = ("live",)) -> list[dict]:
    with connect() as connection:
        return [dict(row) for row in connection.execute(LIST_SQL, (_now() - timedelta(days=days), list(traffic)))]


def purge(connect: Callable[[], Any]) -> int:
    with connect() as connection:
        return list(connection.execute(PURGE_SQL, (_now() - timedelta(days=RETENTION_DAYS),)))[0]["purged"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m area_api.site_feedback", description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="feedback from the last N days, oldest first")
    listing.add_argument("--days", type=int, default=30)
    listing.add_argument("--json", action="store_true")
    listing.add_argument("--traffic", type=parse_traffic, default=("live",),
                         help="live (default), team, tech, a comma-separated mix, or all")
    commands.add_parser("purge", help=f"delete items older than {RETENTION_DAYS} days")
    args = parser.parse_args(argv)

    from .repository import evidence_connection

    if args.command == "purge":
        print(f"purged {purge(evidence_connection)}")
        return 0
    items = recent(evidence_connection, args.days, args.traffic)
    for item in items:
        if args.json:
            print(json.dumps({**item, "created_at": item["created_at"].isoformat(),
                              "updated_at": item["updated_at"].isoformat()}))
            continue
        score = f"{item['rating']}/5" if item["rating"] else ("👍" if item["vote"] == 1 else "👎")
        about = ":".join(part for part in (item["surface"], item["target"], item["area"]) if part)
        reasons = f" [{', '.join(item['tags'])}]" if item["tags"] else ""
        text = f"\n  {item['message']}" if item["message"] else ""
        print(f"#{item['id']} {item['created_at']:%Y-%m-%d %H:%M} {about} {score}{reasons} "
              f"({item['path'] or '?'}, {item['device'] or '?'}){text}")
    if not args.json:
        print(f"{len(items)} item(s) in the last {args.days} days")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
