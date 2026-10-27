"""The MCP server's instructions keep the descriptive-only rule for Census layers (religion included)."""
import os
import unittest
from unittest import mock

from area_api import guidance, scope


class GuidanceTests(unittest.TestCase):
    def test_census_layers_are_descriptive_only(self):
        self.assertIn(
            "Census layers (census-* and student-share, religion included; ONS Census 2021) are descriptive facts for "
            "one area: "
            "quote the share with source and year; never a filter, weight, rank or custom criterion.",
            guidance.INSTRUCTIONS)

    def test_keeps_the_older_guards(self):
        self.assertIn("never build one about religion or who lives somewhere", guidance.INSTRUCTIONS)
        self.assertIn("never infer who lives in an area", guidance.INSTRUCTIONS)


class ScopeWordingTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in ("CLOSE_KNIT_ENGLAND", "CLOSE_KNIT_ACCESS", "CLOSE_KNIT_MCP_ACCESS"):
            os.environ.pop(name, None)

    def test_london_scope_keeps_the_london_wording(self):
        text = guidance.instructions(True)
        self.assertEqual(text, guidance.INSTRUCTIONS)
        self.assertTrue(text.startswith("Close Knit: evidence about London neighbourhoods and homes."))
        self.assertIn("outside-london or outside-coverage (outside London)", text)
        self.assertIn("live in London", guidance.find_a_home())

    def test_england_scope_names_england_and_keeps_both_reason_codes(self):
        os.environ["CLOSE_KNIT_ENGLAND"] = "1"
        text = guidance.instructions(True)
        self.assertTrue(text.startswith("Close Knit: evidence about neighbourhoods and homes in England, London in depth"))
        self.assertNotIn("about London neighbourhoods", text)
        self.assertIn("outside-london or outside-coverage (outside England)", text)
        self.assertIn('{layer: "broadband-gigabit", scale: "value", min: 90}', text)
        self.assertIn("live in England", guidance.find_a_home("two kids"))
        self.assertTrue(guidance.instructions(False).startswith(guidance.COMING_SOON))

    def test_mcp_reads_the_scope_with_public_defaults(self):
        os.environ["CLOSE_KNIT_ACCESS"] = "private"  # unset flags are on for the preview, off for /mcp
        self.assertEqual(guidance.served_scope(), scope.LONDON)
        os.environ["CLOSE_KNIT_ACCESS"] = "public"
        os.environ["CLOSE_KNIT_ENGLAND"] = "1"
        self.assertEqual(guidance.served_scope(), scope.ENGLAND)
        self.assertIn("England", guidance.instructions(True, scope.ENGLAND))


if __name__ == "__main__":
    unittest.main()
