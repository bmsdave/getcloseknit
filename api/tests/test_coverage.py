import unittest

from area_api import coverage


class CoverageTest(unittest.TestCase):
    """England's regions (the served scope is scope.py's: tests/test_england_scope.py)."""

    def test_rank_scope(self):
        self.assertEqual(coverage.rank_scope("E12000002"), {"code": "E12000002", "name": "North West"})
        self.assertEqual(coverage.rank_scope("E12000007"), {"code": "E12000007", "name": "London"})
        self.assertIsNone(coverage.rank_scope(None))
        self.assertIsNone(coverage.rank_scope("W92000004"))

    def test_reason_is_london_only_outside_a_london_only_source(self):
        london = {"E12000007"}
        self.assertEqual(coverage.reason("E12000002", london), coverage.LONDON_ONLY)
        self.assertIsNone(coverage.reason("E12000007", london))
        self.assertIsNone(coverage.reason(None, london))
        # Reaching another region too, or nowhere: a plain gap ("No data"), not "London only".
        self.assertIsNone(coverage.reason("E12000002", {"E12000007", "E12000003"}))
        self.assertIsNone(coverage.reason("E12000002", set()))


if __name__ == "__main__":
    unittest.main()
