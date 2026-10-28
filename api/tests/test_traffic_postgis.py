"""Live, team and tech on the real SQL (deploy/tests/postgis-fixture.sh): our own and technical use never
counts in the default numbers, and migration 136 marks the private preview's rows without deleting any.
Every test runs in one transaction that is rolled back, so the fixture the other tests read is left as it was.
"""
import os
import sys
import unittest
from pathlib import Path

from area_api import usage

TEST_DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")
DEPLOY = Path(__file__).resolve().parents[2] / "deploy"
sys.path.insert(0, str(DEPLOY / "tools"))

import grafana_dashboards  # noqa: E402

MIGRATION = (DEPLOY / "migrations" / "136-analytics-traffic.sql").read_text()
FIX_CLAUDE_CODE = (DEPLOY / "migrations" / "137-claude-code-live.sql").read_text()
LIVE, TEAM, TECH, TESTER, LATE_TESTER = (f"{n}f1c7a4e-8b3d-4c6e-9a1f-0d2e3c4b5a69" for n in "12345")
PREVIEW = "2026-10-27T10:00:00Z"  # during the private preview, before the public launch


def grafana_sql(dashboard: dict, title: str, traffic: str = "'live'") -> str:
    """A panel's query as Grafana runs it with the Traffic box at its default (Live)."""
    panel = next(item for item in dashboard["panels"] if item["title"] == title)
    return panel["targets"][0]["rawSql"].replace("$traffic", traffic)


class Borrowed:
    """The test's open connection for code that opens one with `with connect() as connection`."""

    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self.connection

    def __exit__(self, *args):
        return False


@unittest.skipUnless(TEST_DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to the seeded PostGIS fixture")
class TrafficPostgisTests(unittest.TestCase):
    def setUp(self):
        import psycopg
        from psycopg.rows import dict_row

        self.connection = psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row)
        self.addCleanup(self.connection.close)
        self.addCleanup(self.connection.rollback)
        self.sql = self.connection.execute

    def value(self, query, params=None):
        return next(iter(self.sql(query, params).fetchone().values()))

    def web(self, visitor, props="{}", occurred_at="now()"):
        self.sql(f"INSERT INTO product_event (occurred_at, channel, name, visitor_id, session_id, device, props) "
                 f"VALUES ({occurred_at}, 'web', 'page_view', %s, 'session-0001', 'desktop', %s::jsonb)", (visitor, props))

    def dau(self, traffic=("live",)):
        rows = dict(usage.report(lambda: Borrowed(self.connection), traffic))
        return rows["Active people (web, by anonymous id)"][0]["dau"]

    def test_a_team_or_tech_event_never_counts_in_the_default_dau(self):
        people_today = grafana_sql(grafana_dashboards.product(), "People today")
        before, before_report = self.value(people_today), self.dau()

        self.web(LIVE)
        self.web(TEAM, '{"traffic": "team"}')
        self.web(TECH, '{"traffic": "tech"}')
        # A browser marked with ?team=1 later: its earlier live events become team too.
        self.web(LATE_TESTER)
        usage.mark_team(lambda: Borrowed(self.connection), LATE_TESTER)

        self.assertEqual(self.value(people_today) - before, 1, "Grafana's DAU with the Traffic box at Live")
        self.assertEqual(self.dau() - before_report, 1, "usage report's DAU by default")
        everyone = grafana_sql(grafana_dashboards.product(), "People today", "'live', 'team', 'tech'")
        self.assertEqual(self.value(everyone) - before, 4, "every kind when the filter asks for it")
        self.assertEqual(self.dau(usage.TRAFFIC) - before_report, 4)

    def test_the_migration_marks_the_preview_and_keeps_every_row(self):
        self.web(TESTER, occurred_at=f"'{PREVIEW}'")
        self.web(TESTER)  # the same browser after the launch: an invited tester or the team
        self.web(LIVE)
        self.web(TECH, '{"traffic": "tech"}')
        preview = f"'{PREVIEW}'"
        for when, client in ((preview, "claude-code"), (preview, "openai-mcp"), (preview, None),
                             ("now()", "release-check"), ("now()", "BrickBlueBot"), ("now()", "claude-ai")):
            self.sql(f"INSERT INTO product_event (occurred_at, channel, name, props) VALUES ({when}, 'mcp', 'tool_call', "
                     "jsonb_strip_nulls(jsonb_build_object('client', %s::text, 'tool', 'find_areas')))", (client,))
        self.sql(f"INSERT INTO mcp_call_note (call_id, created_at, client, tool, ok) VALUES "
                 f"('00000000000000a1', '{PREVIEW}', 'mcp-browser', 'find_areas', true), "
                 "('00000000000000a2', now(), 'claude-ai', 'find_areas', true)")
        self.sql(f"INSERT INTO site_feedback (client_id, created_at, kind, surface, rating) VALUES "
                 f"('6f1c7a4e-8b3d-4c6e-9a1f-0d2e3c4b5a69', '{PREVIEW}', 'review', 'site', 5)")
        rows = self.value("SELECT count(*) FROM product_event")

        self.sql(MIGRATION)
        self.sql(MIGRATION)  # a second run changes nothing

        self.assertEqual(self.value("SELECT count(*) FROM product_event"), rows, "rows are marked, never deleted")
        web = {row["visitor_id"]: row["kinds"] for row in self.sql(
            "SELECT visitor_id::text, array_agg(DISTINCT coalesce(props->>'traffic', 'live')) AS kinds "
            "FROM product_event WHERE visitor_id IN (%s, %s, %s) GROUP BY 1", (TESTER, LIVE, TECH))}
        self.assertEqual(web, {TESTER: ["team"], LIVE: ["live"], TECH: ["tech"]})
        mcp = {(row["client"], row["before"]): row["traffic"] for row in self.sql(
            "SELECT props->>'client' AS client, occurred_at < '2026-10-27T16:07:28Z' AS before, "
            "coalesce(props->>'traffic', 'live') AS traffic FROM product_event WHERE channel = 'mcp' "
            "AND props->>'tool' = 'find_areas' AND name = 'tool_call' "
            "AND (props->>'client' IN ('claude-code', 'openai-mcp', 'release-check', 'BrickBlueBot', 'claude-ai') "
            "     OR NOT props ? 'client')")}
        self.assertEqual(mcp, {("claude-code", True): "team", ("openai-mcp", True): "tech", (None, True): "tech",
                               ("release-check", False): "team", ("BrickBlueBot", False): "tech",
                               ("claude-ai", False): "live"})
        self.assertEqual({row["call_id"]: row["traffic"] for row in self.sql(
            "SELECT call_id, traffic FROM mcp_call_note WHERE call_id LIKE '00000000000000a_'")},
            {"00000000000000a1": "tech", "00000000000000a2": "live"})
        self.assertEqual(self.value("SELECT traffic FROM site_feedback WHERE client_id = '6f1c7a4e-8b3d-4c6e-9a1f-0d2e3c4b5a69'"),
                         "team")

    def test_claude_code_after_the_launch_is_live_again(self):
        # As 136 left them: the preview's session, a plugin user after the launch, one with the team header later.
        for when, traffic in (("2026-10-27T10:00:00Z", "team"), ("2026-10-27T20:00:00Z", "team"),
                              ("2026-10-28T12:00:00Z", "team")):
            self.sql("INSERT INTO product_event (occurred_at, channel, name, props) VALUES (%s, 'mcp', 'tool_call', "
                     "jsonb_build_object('client', 'claude-code', 'tool', 'list_metrics', 'traffic', %s::text))",
                     (when, traffic))
        self.sql("INSERT INTO mcp_call_note (call_id, created_at, client, tool, ok, traffic) VALUES "
                 "('00000000000000b1', '2026-10-27T20:00:00Z', 'claude-code', 'find_areas', true, 'team')")
        rows = self.value("SELECT count(*) FROM product_event")

        self.sql(FIX_CLAUDE_CODE)
        self.sql(FIX_CLAUDE_CODE)

        self.assertEqual(self.value("SELECT count(*) FROM product_event"), rows)
        kinds = [row["traffic"] for row in self.sql(
            "SELECT coalesce(props->>'traffic', 'live') AS traffic FROM product_event "
            "WHERE props->>'client' = 'claude-code' AND props->>'tool' = 'list_metrics' ORDER BY occurred_at")]
        self.assertEqual(kinds, ["team", "live", "team"])
        self.assertEqual(self.value("SELECT traffic FROM mcp_call_note WHERE call_id = '00000000000000b1'"), "live")


if __name__ == "__main__":
    unittest.main()
