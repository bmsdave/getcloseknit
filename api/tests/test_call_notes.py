"""Call notes on /mcp: the agent's intent and its rating of an answer, behind CLOSE_KNIT_MCP_REQUEST_NOTES."""
import os
import unittest
from unittest import mock

from area_api import call_notes, guidance

from tests.test_mcp_http import TestClient, McpHttpTests


class FakeNotesConnection:
    """Dispatches the module's marker comments over an in-memory table."""

    def __init__(self):
        self.rows = {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- call_notes:insert":
            call_id, session, client, tool, ok, code, intent = params
            self.rows[call_id] = {"session": session, "client": client, "tool": tool, "ok": ok, "code": code,
                                  "intent": intent, "rating": None}
            return []
        if marker == "-- call_notes:rate":
            rating, good, bad, fix, call_id = params
            if call_id not in self.rows:
                return []
            self.rows[call_id].update(rating=rating, good=good, bad=bad, fix=fix)
            return [{"call_id": call_id}]
        if marker == "-- call_notes:purge":
            return [{"purged": 0}]
        raise AssertionError(marker)


class CallNotesTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeNotesConnection()
        self.connect = lambda: self.db

    def test_clean_removes_contact_details_and_full_postcodes(self):
        text = call_notes.clean("2-bed near N1 9GU, mail a@b.co or call +44 20 7946 0958\nquiet street")
        self.assertEqual(text, "2-bed near N1, mail [email removed] or call [phone removed] quiet street")
        self.assertEqual(len(call_notes.clean("x" * 900)), call_notes.MAX_TEXT)
        self.assertIsNone(call_notes.clean("   "))
        self.assertIsNone(call_notes.clean(42))

    def test_a_rating_lands_on_its_call(self):
        call_id = call_notes.new_call_id()
        call_notes.record_call(self.connect, call_id, tool="find_areas", ok=True, session="s1", client="claude-ai",
                               intent="Family home to buy near Hackney, good schools")
        stored = call_notes.rate(self.connect, {"call_id": call_id, "rating": 4, "bad": "No rents for E8"})

        self.assertTrue(stored)
        row = self.db.rows[call_id]
        self.assertEqual((row["tool"], row["intent"], row["rating"], row["bad"]),
                         ("find_areas", "Family home to buy near Hackney, good schools", 4, "No rents for E8"))

    def test_malformed_or_unknown_ratings_are_not_stored(self):
        for value in (None, "great", {"call_id": "nope", "rating": 3}, {"call_id": "0" * 16, "rating": 6},
                      {"call_id": "0" * 16, "rating": True}, {"call_id": "0" * 16, "rating": 3}):
            self.assertFalse(call_notes.rate(self.connect, value), value)

    def test_storage_failures_never_raise(self):
        def broken():
            raise RuntimeError("no database")

        call_notes.record_call(broken, call_notes.new_call_id(), tool="find_areas", ok=True)
        self.assertFalse(call_notes.rate(broken, {"call_id": "0" * 16, "rating": 3}))

    def test_instructions_ask_for_intent_and_ratings_only_when_on(self):
        self.assertNotIn("rate_previous", guidance.instructions(True))
        self.assertIn("rate_previous", guidance.instructions(True, notes=True))


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class McpCallNotesTests(McpHttpTests):
    """The /mcp side with the flag on; McpHttpTests' own tests are not rerun here."""

    def setUp(self):
        env = mock.patch.dict(os.environ, {"CLOSE_KNIT_MCP_REQUEST_NOTES": "1"})
        env.start()
        self.addCleanup(env.stop)
        self.db = FakeNotesConnection()
        record, rate = call_notes.record_call, call_notes.rate
        for name, real in (("record_call", record), ("rate", rate)):
            patcher = mock.patch.object(call_notes, name, side_effect=lambda connect, *a, _real=real, **k:
                                        _real(lambda: self.db, *a, **k))
            patcher.start()
            self.addCleanup(patcher.stop)
        super().setUp()

    def _call(self, name, arguments):
        response = self._rpc("tools/call", {"name": name, "arguments": arguments}).json()
        self.assertFalse(response["result"].get("isError"), response)
        return response["result"]["structuredContent"]

    def test_noted_tools_take_intent_and_rate_previous(self):
        listed = {tool["name"]: tool for tool in self._rpc("tools/list").json()["result"]["tools"]}

        self.assertIn("rate_answer", listed)
        self.assertLessEqual({"intent", "rate_previous"}, set(listed["search_areas"]["inputSchema"]["properties"]))
        self.assertNotIn("intent", listed["send_feedback"]["inputSchema"]["properties"])
        self.assertFalse(listed["rate_answer"]["annotations"]["readOnlyHint"])

    def test_answers_carry_a_call_id_that_the_next_call_rates(self):
        first = self._call("search_areas", {"q": "Hackney", "intent": "Flat to rent in Hackney, near E8 3PN"})
        call_id = first["callId"]
        self.assertEqual(self.db.rows[call_id]["intent"], "Flat to rent in Hackney, near E8")
        self.assertEqual(self.db.rows[call_id]["tool"], "search_areas")

        second = self._call("search_areas", {"q": "Dalston", "rate_previous": {
            "call_id": call_id, "rating": 2, "bad": "Only boroughs came back", "fix": "Return wards too"}})
        self.assertNotEqual(second["callId"], call_id)
        self.assertEqual((self.db.rows[call_id]["rating"], self.db.rows[call_id]["fix"]), (2, "Return wards too"))

        rated = self._call("rate_answer", {"call_id": second["callId"], "rating": 5, "good": "Right area"})
        self.assertTrue(rated["value"]["received"])
        self.assertEqual(self.db.rows[second["callId"]]["rating"], 5)

    def test_a_bad_rating_never_fails_the_call(self):
        answer = self._call("search_areas", {"q": "Hackney", "rate_previous": {"call_id": "unknown", "rating": 9}})
        self.assertIn("callId", answer)


# McpHttpTests' tests run in test_mcp_http; this module adds only its own.
for _name in [name for name in vars(McpHttpTests) if name.startswith("test_")]:
    setattr(McpCallNotesTests, _name, None)

if __name__ == "__main__":
    unittest.main()
