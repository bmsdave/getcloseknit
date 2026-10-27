"""Static guards for production evidence SQL.

The FakeConnection suites execute reader logic without parsing SQL, so a
query that is invalid Postgres (or references a dropped column) stays green
until it meets a live database. These checks catch that bug class without
needing a server: every statement the reader can issue must avoid known
invalid constructions.
"""
import re
import unittest

from area_api import evidence


STATEMENTS = {
    name: getattr(evidence, name)
    for name in dir(evidence)
    if name.endswith("_SQL") and isinstance(getattr(evidence, name), str)
}


class EvidenceSqlTests(unittest.TestCase):
    def test_known_statements_exist(self):
        self.assertTrue(STATEMENTS, "no evidence SQL statements found")
        for expected in ("METRICS_SQL", "METRIC_SQL", "PACK_SQL", "AREA_VALUES_SQL",
                         "SEARCH_SQL", "BREAKDOWN_SQL"):
            self.assertIn(expected, STATEMENTS)

    def test_no_positional_order_by_inside_distinct_aggregate(self):
        for name, sql in STATEMENTS.items():
            for match in re.finditer(r"DISTINCT.*?ORDER BY\s+(\d+)", sql,
                                     re.IGNORECASE | re.DOTALL):
                self.fail(f"{name} uses positional ORDER BY in DISTINCT aggregate: "
                          f"{match.group(0)[:80]}")

    def test_every_statement_has_a_marker_comment(self):
        for name, sql in STATEMENTS.items():
            self.assertTrue(sql.startswith("-- evidence:"),
                            f"{name} is missing its -- evidence: marker")

    def test_street_homes_sql_is_deterministic_and_carries_the_lsoa(self):
        # Issue #152: a long street's homes must read the same every run, and placing a
        # numbered hit needs each home's LSOA.
        self.assertIn("ORDER BY", evidence.STREET_HOMES_SQL)
        self.assertIn("a.geography_id", evidence.STREET_HOMES_SQL)


if __name__ == "__main__":
    unittest.main()
