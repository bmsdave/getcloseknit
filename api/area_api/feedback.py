"""Feedback about Close Knit from an AI client (the send_feedback tool).

The client sends it only after the user agreed, and it describes the product, never the
person. Contact details that slip through are removed before storing. Items live in
mcp_feedback (deploy/migrations/041-mcp-feedback.sql) for RETENTION_DAYS, are forwarded to
the corrections channels when configured, and are read on the server with
deploy/tools/feedback.sh (`python -m area_api.feedback list|purge`).
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Literal

from pydantic import Field

from . import envelope, notify, usage
from .toolspec import StrictInput, ToolContext, ToolSpec

RETENTION_DAYS = 365
KINDS = ("bug", "missing-data", "wrong-data", "idea", "praise", "other")

INSERT_SQL = """-- feedback:insert
INSERT INTO mcp_feedback (kind, message, rating, tools, client, traffic) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id"""
PURGE_SQL = """-- feedback:purge
WITH gone AS (DELETE FROM mcp_feedback WHERE created_at < %s RETURNING 1) SELECT count(*) AS purged FROM gone"""
LIST_SQL = """-- feedback:list
SELECT id, kind, message, rating, tools, client, traffic, created_at FROM mcp_feedback
WHERE created_at >= %s AND traffic = ANY(%s) ORDER BY created_at"""

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
PHONE = re.compile(r"(?<!\w)(\+?\d[\d ()-]{8,}\d)(?!\w)")


class FeedbackInput(StrictInput):
    kind: Literal["bug", "missing-data", "wrong-data", "idea", "praise", "other"] = Field(
        description="bug = a tool failed or misbehaved; missing-data / wrong-data = an answer lacked or got a "
                    "fact wrong; idea = something to add; praise = what worked well.")
    message: str = Field(min_length=10, max_length=2000, description=(
        "What happened or what would help, in a few sentences: the product, never the person. No names, "
        "contact details, addresses, family or money circumstances."))
    rating: int | None = Field(default=None, ge=1, le=5, description="How useful Close Knit was, 1-5, if the user said.")
    tools: list[str] = Field(default_factory=list, max_length=10,
                             description="The Close Knit tools it is about, e.g. ['find_areas'].")
    client: str | None = Field(default=None, max_length=60, description="The AI client, e.g. 'claude.ai'.")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def scrub(text: str) -> str:
    """Remove e-mail addresses and phone numbers the client should not have sent."""
    return PHONE.sub("[phone removed]", EMAIL.sub("[email removed]", text)).strip()


def store(connect: Callable[[], Any], args: FeedbackInput, traffic: str = "live") -> int:
    """Insert one item and purge those past RETENTION_DAYS; returns the new id. traffic is the call's
    (usage.traffic); a live call still counts as team or tech when the client it names is."""
    tool_names = [name for name in args.tools if re.fullmatch(r"[a-z_]{2,40}", name)]
    kind = traffic if traffic in ("team", "tech") else usage.traffic(args.client)
    with connect() as connection:
        connection.execute(PURGE_SQL, (_now() - timedelta(days=RETENTION_DAYS),))
        rows = list(connection.execute(INSERT_SQL, (args.kind, scrub(args.message), args.rating, tool_names,
                                                    args.client, kind)))
    return rows[0]["id"]


def recent(connect: Callable[[], Any], days: int = 30, traffic: tuple[str, ...] = ("live",)) -> list[dict]:
    with connect() as connection:
        return [dict(row) for row in connection.execute(LIST_SQL, (_now() - timedelta(days=days), list(traffic)))]


def purge(connect: Callable[[], Any]) -> int:
    with connect() as connection:
        return list(connection.execute(PURGE_SQL, (_now() - timedelta(days=RETENTION_DAYS),)))[0]["purged"]


def _send_feedback(context: ToolContext, args: FeedbackInput) -> dict:
    item_id = store(context.reader._connect, args, context.traffic)
    notify.deliver({"kind": "mcp-feedback", "id": item_id, "feedbackKind": args.kind, "rating": args.rating,
                    "tools": args.tools, "client": args.client, "message": scrub(args.message)})
    return envelope.wrap(
        {"received": True, "id": item_id}, schema_version="tool-send-feedback.v1", release_id="feedback",
        caveats=["Thank the user. Close Knit reads every item; it is kept for 12 months and has no reply channel."])


TOOLS = [ToolSpec(
    "send_feedback",
    "Send feedback about Close Knit to the team: a bug, missing or wrong data, an idea, or what worked. "
    "Call it only after the user agrees: show them the message first. Describe the product and what happened, "
    "never the person: no names, contact details, addresses, family, budget or other personal circumstances.",
    FeedbackInput, _send_feedback, "tool-send-feedback.v1", ("feedback",))]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m area_api.feedback", description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="feedback from the last N days, oldest first")
    listing.add_argument("--days", type=int, default=30)
    listing.add_argument("--json", action="store_true")
    listing.add_argument("--traffic", type=usage.parse_traffic, default=("live",),
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
            print(json.dumps({**item, "created_at": item["created_at"].isoformat()}))
            continue
        rating = f" {item['rating']}/5" if item["rating"] else ""
        about = f" [{', '.join(item['tools'])}]" if item["tools"] else ""
        print(f"#{item['id']} {item['created_at']:%Y-%m-%d %H:%M} {item['kind']}{rating}{about} "
              f"({item['client'] or 'unknown client'})\n  {item['message']}")
    if not args.json:
        print(f"{len(items)} item(s) in the last {args.days} days")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
