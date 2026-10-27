"""The internal analytics UI: dashboards built from the generator, read-only access to the usage
tables only, and Grafana reachable on the host's loopback alone."""
import importlib.util
import json
import re
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("grafana_dashboards", DEPLOY / "tools" / "grafana_dashboards.py")
grafana_dashboards = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(grafana_dashboards)
USAGE_TABLES = {"product_event", "profile_analytics_event", "mcp_feedback", "mcp_call_note", "site_feedback"}
# Public place names, granted by migration 052 so areas show by name.
READABLE_TABLES = USAGE_TABLES | {"area_label"}


class DashboardTests(unittest.TestCase):
    def test_the_json_files_match_the_generator(self):
        self.assertEqual(grafana_dashboards.main(["--check"]), 0)

    def test_every_panel_reads_only_the_usage_tables_through_the_provisioned_source(self):
        source = (DEPLOY / "grafana" / "provisioning" / "datasources" / "close-knit.yaml").read_text()
        uid = re.search(r"uid: (\S+)", source).group(1)
        for name, text in grafana_dashboards.rendered().items():
            for panel in json.loads(text)["panels"]:
                if panel["type"] == "row":
                    continue
                with self.subTest(dashboard=name, panel=panel["title"]):
                    self.assertEqual(panel["datasource"]["uid"], uid)
                    sql = panel["targets"][0]["rawSql"].replace("extract(epoch FROM", "extract(epoch of")
                    tables = set(re.findall(r"\b(?:FROM|JOIN)\s+([a-z_]+)", sql))
                    ctes = set(re.findall(r"\b([a-z_]+) AS \(", sql))
                    self.assertTrue(tables - ctes, sql)
                    self.assertLessEqual(tables - ctes, READABLE_TABLES)


    def test_the_feedback_dashboard_reads_site_feedback_in_the_chosen_period(self):
        board = json.loads(grafana_dashboards.rendered()["feedback.json"])
        self.assertEqual(board["uid"], "close-knit-feedback")
        panels = [panel for panel in board["panels"] if panel["type"] != "row"]
        titles = {panel["title"] for panel in panels}
        for title in ("Average rating", "Area cards: share of thumbs up", "Shortlist: share of thumbs up by week",
                      "Top reasons", "Areas with the most thumbs down", "Latest comments"):
            self.assertIn(title, titles)
        for panel in panels:
            with self.subTest(panel=panel["title"]):
                sql = panel["targets"][0]["rawSql"]
                self.assertIn("site_feedback", sql)
                self.assertIn("$__timeFilter(created_at)", sql)


class AccessTests(unittest.TestCase):
    def test_the_role_is_read_only_and_granted_the_usage_tables_only(self):
        sql = (DEPLOY / "migrations" / "050-analytics-reader.sql").read_text()
        # Later production-only tables grant the role in their own migration (053 site_feedback, 130 mcp_call_note).
        later = "".join((DEPLOY / "migrations" / name).read_text()
                        for name in ("053-site-feedback.sql", "130-mcp-call-note.sql"))
        grants = re.findall(r"GRANT SELECT ON ([^;]+) TO close_knit_analytics", sql + later)
        self.assertEqual({table.strip() for grant in grants for table in grant.split(",")}, USAGE_TABLES)
        self.assertIn("default_transaction_read_only = on", sql)
        self.assertNotRegex(sql + later, r"GRANT (ALL|INSERT|UPDATE|DELETE)")

    def test_grafana_is_opt_in_on_loopback_with_its_own_login(self):
        prod = (DEPLOY / "docker-compose.prod.yml").read_text()
        block = prod.split("  grafana:\n", 1)[1].split("\nvolumes:", 1)[0]
        self.assertIn('ports: ["127.0.0.1:3300:3000"]', block)
        self.assertIn('profiles: ["analytics"]', block)
        for setting in ("GF_AUTH_ANONYMOUS_ENABLED: \"false\"", "GF_USERS_ALLOW_SIGN_UP: \"false\"",
                        "GF_SNAPSHOTS_EXTERNAL_ENABLED: \"false\"", "GF_PUBLIC_DASHBOARDS_ENABLED: \"false\"",
                        "GF_ANALYTICS_REPORTING_ENABLED: \"false\""):
            self.assertIn(setting, block)
        # Grafana's default admin password must never be the one in use.
        self.assertIn("-ge 16", block)
        self.assertNotIn("/grafana", (DEPLOY / "Caddyfile").read_text())


if __name__ == "__main__":
    unittest.main()
