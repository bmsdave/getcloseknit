import unittest

from area_api.repository import EVIDENCE_SQL, RANGE_CARRIER_JOINS, range_rows


class MatchEvidenceFactorsTests(unittest.TestCase):
    def test_evidence_sql_reads_metric_values_for_published_factors(self):
        sql = EVIDENCE_SQL.lower()
        for token in (
            "metric_value",
            "deprivation",
            "social-renting",
            "price-per-square-metre",
            "market-level",
        ):
            with self.subTest(token=token):
                self.assertIn(token, sql)

    def test_evidence_sql_expands_msoa_income_to_lsoa(self):
        sql = EVIDENCE_SQL.lower()
        self.assertIn("income", sql)
        self.assertIn("parent_id", sql)


class _FakeConnection:
    """Answers the range queries: the metric's carrier and latest period, then one LSOA row."""

    def __init__(self, carrier):
        self.carrier = carrier
        self.queries = []

    def execute(self, sql, params=()):
        self.queries.append((sql, params))
        if "evidence:range-metric" in sql:
            return [] if params[0] == "unknown" else [{"carrier": self.carrier, "unit": "per 1,000", "period": "2026-08"}]
        return [{"geography_id": "uk:lsoa:E01000001", "name": "City of London 001A", "raw_value": 12.5,
                 "carrier_geography_id": "uk:msoa:E02000001" if self.carrier == "msoa" else "uk:lsoa:E01000001",
                 "quality": "observed", "source_release_id": "src-test"}]


class RangeRowsTests(unittest.TestCase):
    """Fix 30b: a range reads its layer's latest values for every LSOA, from the layer's own carrier."""

    def test_rows_carry_the_range_factor_id_and_the_metric_unit(self):
        connection = _FakeConnection("lsoa")
        rows = range_rows(connection, [{"layer": "crime"}])
        self.assertEqual(rows[0]["factor_id"], "range:crime")
        self.assertEqual(rows[0]["unit"], "per 1,000")
        self.assertIsNone(rows[0]["utility"])
        values_sql, params = connection.queries[1]
        self.assertEqual(params, ("crime", "2026-08"))
        self.assertIn("lsoa.id = v.geography_id", values_sql)

    def test_a_coarser_carrier_applies_to_each_lsoa_inside_it(self):
        connection = _FakeConnection("msoa")
        range_rows(connection, [{"layer": "crime"}])
        self.assertIn("lsoa.parent_id = v.geography_id", connection.queries[1][0])
        borough = _FakeConnection("lad")
        range_rows(borough, [{"layer": "crime"}])
        self.assertIn("msoa.parent_id = v.geography_id", borough.queries[1][0])

    def test_an_unknown_layer_adds_no_rows(self):
        self.assertEqual(range_rows(_FakeConnection("lsoa"), [{"layer": "unknown"}]), [])
        self.assertEqual(RANGE_CARRIER_JOINS.keys(), {"lsoa", "msoa", "lad"})


if __name__ == "__main__":
    unittest.main()
