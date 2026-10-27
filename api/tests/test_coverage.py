import unittest

from area_api import coverage


class CoverageTest(unittest.TestCase):
    """England's regions (the served scope is scope.py's: tests/test_england_scope.py)."""

    def test_rank_scope(self):
        self.assertEqual(coverage.rank_scope("E12000002"), {"code": "E12000002", "name": "North West"})
        self.assertEqual(coverage.rank_scope("E12000007"), {"code": "E12000007", "name": "London"})
        self.assertIsNone(coverage.rank_scope(None))
        self.assertIsNone(coverage.rank_scope("W92000004"))


if __name__ == "__main__":
    unittest.main()
