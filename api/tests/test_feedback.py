"""send_feedback: stored with the user's agreement, scrubbed of contact details, kept 12 months."""
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from area_api import feedback, tools
from area_api.tools import InvalidToolArguments, ToolContext, call_tool

NOW = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)


class FakeFeedbackConnection:
    """Dispatches the module's marker comments over an in-memory table."""

    def __init__(self):
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        return {"-- feedback:insert": self._insert, "-- feedback:purge": self._purge,
                "-- feedback:list": self._list}[marker](params)

    def _insert(self, params):
        kind, message, rating, tool_names, client = params
        row = {"id": len(self.rows) + 1, "kind": kind, "message": message, "rating": rating,
               "tools": tool_names, "client": client, "created_at": NOW}
        self.rows.append(row)
        return [{"id": row["id"]}]

    def _purge(self, params):
        (cutoff,) = params
        before = len(self.rows)
        self.rows = [row for row in self.rows if row["created_at"] >= cutoff]
        return [{"purged": before - len(self.rows)}]

    def _list(self, params):
        (since,) = params
        return [row for row in self.rows if row["created_at"] >= since]


class Reader:
    def __init__(self, connection):
        self._connect = lambda: connection


class SendFeedbackTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeFeedbackConnection()
        self.context = ToolContext(reader=Reader(self.db))

    def call(self, **arguments):
        with mock.patch.object(feedback, "_now", return_value=NOW), \
                mock.patch.object(feedback.notify, "deliver", return_value=[]) as deliver:
            out = call_tool("send_feedback", self.context, arguments)
        self.delivered = deliver.call_args.args[0] if deliver.called else None
        return out

    def test_stores_the_feedback_and_forwards_it(self):
        out = self.call(kind="wrong-data", message="Swimming clubs are missing for most areas in find_areas.",
                        rating=3, tools=["find_areas"], client="claude.ai")

        self.assertEqual(out["value"], {"received": True, "id": 1})
        row = self.db.rows[0]
        self.assertEqual((row["kind"], row["rating"], row["tools"], row["client"]),
                         ("wrong-data", 3, ["find_areas"], "claude.ai"))
        self.assertEqual(self.delivered["kind"], "mcp-feedback")
        self.assertEqual(self.delivered["id"], 1)

    def test_contact_details_are_removed_before_storing(self):
        self.call(kind="bug", message="Write to jane.doe@example.com or call 07700 900123 about the map bug.")

        stored = self.db.rows[0]["message"]
        self.assertNotIn("jane.doe@example.com", stored)
        self.assertNotIn("07700 900123", stored)
        self.assertIn("[email removed]", stored)
        self.assertIn("[phone removed]", stored)

    def test_items_older_than_a_year_are_purged_on_each_new_one(self):
        self.db.rows.append({"id": 99, "kind": "idea", "message": "old idea text", "rating": None, "tools": [],
                             "client": None, "created_at": NOW - timedelta(days=feedback.RETENTION_DAYS + 1)})

        self.call(kind="praise", message="The area at a glance panel is really useful.")

        self.assertEqual([row["kind"] for row in self.db.rows], ["praise"])

    def test_rejects_an_empty_message_and_unknown_kind(self):
        with self.assertRaises(InvalidToolArguments):
            self.call(kind="bug", message="short")
        with self.assertRaises(InvalidToolArguments):
            self.call(kind="complaint", message="This kind is not one of the allowed kinds.")

    def test_the_tool_is_registered_with_the_privacy_rules(self):
        spec = tools.TOOLS["send_feedback"]
        self.assertIn("only after the user agrees", spec.description)
        self.assertIn("never", spec.description)


class FeedbackListTests(unittest.TestCase):
    def test_list_returns_recent_items_oldest_first(self):
        db = FakeFeedbackConnection()
        db.rows = [{"id": 1, "kind": "idea", "message": "an idea about maps", "rating": 4, "tools": ["find_areas"],
                    "client": "claude.ai", "created_at": NOW - timedelta(days=2)}]
        with mock.patch.object(feedback, "_now", return_value=NOW):
            items = feedback.recent(lambda: db, days=7)

        self.assertEqual([item["id"] for item in items], [1])


if __name__ == "__main__":
    unittest.main()
