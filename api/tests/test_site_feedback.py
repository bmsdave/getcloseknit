"""Website feedback: only known surfaces, targets and reasons are kept, text is scrubbed, a changed vote
updates its own row and nothing else, and the endpoint answers the form honestly."""
import unittest
import uuid
from datetime import datetime, timezone

from area_api import site_feedback
from area_api.site_feedback import InvalidFeedback

NOW = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)
CLIENT = "6f0c2a9e-1d4b-4e8a-9c3f-2b7d5e1a0c94"


def vote(**changes):
    return {"client_id": CLIENT, "kind": "vote", "surface": "area_card", "target": "schools",
            "area": "uk:msoa:E02000001", "vote": -1, "tags": ["looks_wrong"], "path": "/area/msoa/E02000001",
            "device": "mobile", **changes}


def review(**changes):
    return {"client_id": CLIENT, "kind": "review", "surface": "site", "rating": 4, "tags": [], **changes}


def as_dict(row):
    names = ("client_id", "kind", "surface", "target", "area", "vote", "rating", "tags", "message", "path", "device",
             "traffic")
    return dict(zip(names, row, strict=True))


class FakeFeedbackConnection:
    """Records the module's marker comments in order and keeps upserted rows by client_id."""

    def __init__(self, fail=False):
        self.calls = []
        self.sql = {}
        self.rows = {}
        self.fail = fail

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        if self.fail:
            raise RuntimeError("database is down")
        marker = sql.split("\n", 1)[0]
        self.calls.append(marker)
        self.sql[marker] = sql
        if marker == "-- site_feedback:upsert":
            self.rows[params[0]] = as_dict(params)
            return []
        if marker == "-- site_feedback:purge":
            return [{"purged": 0}]
        return []


class CleanTests(unittest.TestCase):
    def test_a_vote_on_an_area_card_is_clean(self):
        row = as_dict(site_feedback.clean(vote(tags=["looks_wrong", "nonsense"], message="  ")))
        self.assertEqual(row["client_id"], CLIENT)
        self.assertEqual((row["kind"], row["surface"], row["target"], row["vote"]), ("vote", "area_card", "schools", -1))
        self.assertEqual(row["tags"], ["looks_wrong"])
        self.assertIsNone(row["message"])
        self.assertIsNone(row["rating"])
        self.assertEqual((row["path"], row["device"]), ("/area/msoa/E02000001", "mobile"))
        self.assertEqual(row["traffic"], "live")

    def test_a_team_browser_or_the_team_header_marks_the_feedback_as_ours(self):
        self.assertEqual(as_dict(site_feedback.clean({**vote(), "team": True}))["traffic"], "team")
        self.assertEqual(as_dict(site_feedback.clean(vote(), "1"))["traffic"], "team")
        self.assertEqual(as_dict(site_feedback.clean({**vote(), "team": "yes"}))["traffic"], "live")

    def test_unknown_surface_target_or_bad_uuid_is_invalid(self):
        for payload in (vote(surface="x"), vote(target="crime"), vote(client_id="abc"),
                        vote(surface="shortlist", target="schools"), None, [], "text"):
            with self.subTest(payload=payload), self.assertRaises(InvalidFeedback):
                site_feedback.clean(payload)

    def test_kind_rules(self):
        for payload in (vote(vote=None), vote(rating=3), review(rating=None), review(vote=1), vote(vote=0),
                        review(rating=6), review(rating=0), review(rating=True), vote(kind="other"),
                        review(surface="area_card", target="schools"), vote(surface="site", target=None)):
            with self.subTest(payload=payload), self.assertRaises(InvalidFeedback):
                site_feedback.clean(payload)

    def test_a_shortlist_vote_names_its_market(self):
        row = as_dict(site_feedback.clean(vote(surface="shortlist", target="rent", area=None, vote=1, tags=[])))
        self.assertEqual((row["surface"], row["target"], row["vote"]), ("shortlist", "rent", 1))

    def test_review_tags_follow_the_rating(self):
        mixed = ["easy_to_use", "slow", "fast", "broken"]
        self.assertEqual(as_dict(site_feedback.clean(review(rating=5, tags=mixed)))["tags"], ["easy_to_use", "fast"])
        self.assertEqual(as_dict(site_feedback.clean(review(rating=2, tags=mixed)))["tags"], ["slow", "broken"])
        self.assertIsNone(as_dict(site_feedback.clean(review()))["target"])

    def test_tags_are_unique_and_only_strings(self):
        row = as_dict(site_feedback.clean(vote(tags=["looks_wrong", "looks_wrong", 3, None, "out_of_date"])))
        self.assertEqual(row["tags"], ["looks_wrong", "out_of_date"])
        self.assertEqual(as_dict(site_feedback.clean(vote(tags="looks_wrong")))["tags"], [])

    def test_message_is_scrubbed_and_capped(self):
        row = as_dict(site_feedback.clean(review(message=" mail me a@b.co or +44 20 7946 0958 ")))
        self.assertIn("[email removed]", row["message"])
        self.assertIn("[phone removed]", row["message"])
        self.assertNotIn("a@b.co", row["message"])
        self.assertEqual(len(as_dict(site_feedback.clean(review(message="x" * 2000)))["message"]), 2000)
        with self.assertRaises(InvalidFeedback):
            site_feedback.clean(review(message="x" * 2001))
        with self.assertRaises(InvalidFeedback):
            site_feedback.clean(review(message=42))

    def test_path_device_and_area_are_bounded(self):
        row = as_dict(site_feedback.clean(vote(path="/" + "a" * 200, device="fridge")))
        self.assertEqual(len(row["path"]), 120)
        self.assertIsNone(row["device"])
        self.assertIsNone(as_dict(site_feedback.clean(vote(path=7)))["path"])
        with self.assertRaises(InvalidFeedback):
            site_feedback.clean(vote(area="a" * 41))

    def test_the_client_id_is_normalised(self):
        row = as_dict(site_feedback.clean(vote(client_id=CLIENT.upper())))
        self.assertEqual(row["client_id"], CLIENT)


class StoreTests(unittest.TestCase):
    def test_store_purges_then_upserts(self):
        connection = FakeFeedbackConnection()
        site_feedback.store(lambda: connection, site_feedback.clean(vote()))
        self.assertEqual(connection.calls, ["-- site_feedback:purge", "-- site_feedback:upsert"])
        upsert = connection.sql["-- site_feedback:upsert"]
        self.assertIn("ON CONFLICT (client_id)", upsert)
        update = upsert.split("DO UPDATE", 1)[1]
        for column in ("kind", "surface", "target", "area"):
            self.assertNotRegex(update, rf"\b{column}\s*=")
        for column in ("vote", "rating", "tags", "message", "updated_at"):
            self.assertRegex(update, rf"\b{column}\s*=")

    def test_a_changed_vote_reuses_its_client_id(self):
        connection = FakeFeedbackConnection()
        site_feedback.store(lambda: connection, site_feedback.clean(vote(vote=1, tags=[])))
        site_feedback.store(lambda: connection, site_feedback.clean(vote(vote=-1, tags=["out_of_date"])))
        self.assertEqual(list(connection.rows), [CLIENT])
        self.assertEqual(connection.rows[CLIENT]["vote"], -1)


try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api.repository import evidence_connection
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover
    TestClient = None

BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15"


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class FeedbackHttpTests(unittest.TestCase):
    def setUp(self):
        self.connection = FakeFeedbackConnection()
        app_module._connect = lambda: self.connection
        self.addCleanup(setattr, app_module, "_connect", evidence_connection)
        without_rate_limits(self)
        self.client = TestClient(app_module.app)

    def post(self, body, agent=BROWSER):
        return self.client.post("/api/v1/feedback", headers={"user-agent": agent}, json=body)

    def test_feedback_is_stored_and_answered_204(self):
        response = self.post(review(rating=5, tags=["fast"], message="Lovely"))
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.connection.rows[CLIENT]["message"], "Lovely")

    def test_invalid_feedback_is_422(self):
        self.assertEqual(self.post(vote(surface="nowhere")).status_code, 422)
        bad_json = self.client.post("/api/v1/feedback", headers={"user-agent": BROWSER, "content-type": "application/json"},
                                    content=b"{not json")
        self.assertEqual(bad_json.status_code, 422)
        self.assertEqual(self.connection.rows, {})

    def test_a_database_error_is_503(self):
        self.connection.fail = True
        self.assertEqual(self.post(review()).status_code, 503)

    def test_bots_are_not_stored(self):
        response = self.post(vote(client_id=str(uuid.uuid4())), agent="Googlebot/2.1")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.connection.rows, {})


if __name__ == "__main__":
    unittest.main()
