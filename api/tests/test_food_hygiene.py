"""Food hygiene layer end to end on a loaded database: metric catalogue, area summary, value pack
and the Claude tools (list_metrics, get_area_metric). Needs a database where
deploy/tools/etl_food_hygiene.py has run; skipped otherwise."""
import os
import unittest

from area_api.evidence import EvidenceReader
from area_api.tools import call_tool
from area_api.toolspec import ToolContext

TEST_DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")
METRIC = "food-hygiene"


@unittest.skipUnless(TEST_DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a loaded database")
class FoodHygieneLayerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg
        from psycopg.rows import dict_row

        cls.reader = EvidenceReader(lambda: psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row))
        metrics = {m["id"]: m for m in cls.reader.list_metrics()["metrics"]}
        if METRIC not in metrics:
            raise unittest.SkipTest("food-hygiene is not in the active release")
        cls.metric = metrics[METRIC]
        cls.pack = cls.reader.get_value_pack(METRIC, cls.metric["defaultPeriod"])

    def test_catalogue_entry_is_a_higher_is_better_share_from_the_fsa(self):
        metric = self.metric
        self.assertEqual((metric["carrier"], metric["unit"], metric["direction"]), ("lsoa", "%", "higher-is-better"))
        self.assertEqual(metric["provenance"]["licence"], "OGL-3.0")
        self.assertIn("Food Standards Agency", metric["provenance"]["attribution"])
        self.assertEqual(metric["methodologyPath"], "/guide/getting-around")
        text = " ".join([metric["description"], *metric["caveats"]]).lower()
        self.assertIn("food places", text)
        self.assertNotIn("resident", text)
        stops = [stop["value"] for stop in metric["legend"]]
        self.assertEqual(stops, sorted(stops))

    def test_pack_suppresses_areas_with_few_rated_places(self):
        values = self.pack["values"]
        self.assertGreater(len(values), 4000)
        for row in values:
            if row["quality"] == "suppressed":
                self.assertIsNone(row["value"])
                self.assertLess(row["sampleCount"], 5)
            else:
                self.assertGreaterEqual(row["sampleCount"], 5)
                self.assertTrue(0 <= row["value"] <= 100)
                self.assertLessEqual(row["breakdown"]["rated-4-or-5"], row["sampleCount"])

    def test_area_summary_and_claude_tools_agree(self):
        row = next(r for r in self.pack["values"] if r["quality"] == "observed")
        period = self.metric["defaultPeriod"]
        summary = self.reader.get_area(row["geographyId"], METRIC, period)["summary"]
        self.assertEqual((summary["value"], summary["sampleCount"]), (row["value"], row["sampleCount"]))
        context = ToolContext(reader=self.reader)
        listed = call_tool("list_metrics", context, {})
        self.assertIn(METRIC, [m["id"] for m in listed["value"]])
        tool = call_tool("get_area_metric", context,
                         {"area_id": row["geographyId"], "metric_id": METRIC, "period": period})
        self.assertEqual(tool["value"]["value"], row["value"])
        self.assertEqual(tool["confidence"], "high")
        self.assertEqual([s["licence"] for s in tool["sources"]], ["OGL-3.0"])


if __name__ == "__main__":
    unittest.main()
