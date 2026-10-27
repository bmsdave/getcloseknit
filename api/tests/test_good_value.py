"""Good value inputs (good-value.v1, migration 069): home types, area filters and the row shape."""
import unittest

from area_api import evidence, good_value

ROW = {"geography_id": "uk:lsoa:E01001266", "typical_price": 567720, "sales": 26, "peers": 50,
       "peer_price": 754628, "value_ratio": 0.752, "source_release_id": "src-hmlr-pp-sales-2026-07",
       "safety": 20, "schools": 91, "station": 70, "quiet": None, "parks": 88, "air": 64}


class Connection:
    def __init__(self, ready=True, rows=(ROW,)):
        self.ready, self.rows, self.calls = ready, list(rows), []

    def execute(self, sql, params=()):
        self.calls.append((sql.split("\n", 1)[0], params))
        if "good-value-table" in sql:
            return [{"ready": self.ready}]
        if "active_product_release" in sql:
            return [{"release_id": "rel-test"}]
        return self.rows


class Reader:
    def __init__(self, connection):
        self.connection = connection

    def _connect(self):
        connection = self.connection

        class Context:
            def __enter__(self):
                return connection

            def __exit__(self, *exc):
                return False

        return Context()


class GoodValueTests(unittest.TestCase):
    def test_area_value_carries_price_vector_and_ratio(self):
        self.assertEqual(good_value.area_value(ROW), {
            "geographyId": "uk:lsoa:E01001266", "typicalPrice": 567720, "sales": 26,
            "scores": {"safety": 20, "schools": 91, "station": 70, "quiet": None, "parks": 88, "air": 64},
            "peers": 50, "peerPrice": 754628, "valueRatio": 0.752, "valuePercent": -25, "outlier": False,
        })

    def test_vector_never_holds_price_income_or_people(self):
        for key in good_value.SCORE_KEYS:
            self.assertNotRegex(key, "price|income|depriv|ethnic|religion|social")

    def test_home_types(self):
        self.assertEqual(good_value.home_type_code("flat"), "F")
        self.assertEqual(good_value.home_type_code(" Detached "), "D")
        self.assertEqual(good_value.home_type_code(""), "*")
        with self.assertRaises(evidence.MalformedQuery):
            good_value.home_type_code("bungalow")

    def test_area_filter_takes_lsoas_only(self):
        self.assertIsNone(good_value.area_ids(None))
        self.assertEqual(good_value.area_ids("uk:lsoa:E01000001, uk:lsoa:E01000002"),
                         ["uk:lsoa:E01000001", "uk:lsoa:E01000002"])
        with self.assertRaises(evidence.MalformedQuery):
            good_value.area_ids("uk:msoa:E02000001")
        with self.assertRaises(evidence.MalformedQuery):
            good_value.area_ids(",".join(f"uk:lsoa:E01{n:06d}" for n in range(good_value.MAX_AREAS + 1)))

    def test_payload_lists_areas_with_sources(self):
        connection = Connection()
        value = good_value.good_value(Reader(connection), "semi", "uk:lsoa:E01001266")
        self.assertEqual(value["schemaVersion"], "good-value.v1")
        self.assertEqual(value["homeType"], "semi")
        self.assertTrue(value["available"])
        self.assertEqual(value["minimumSales"], 20)
        self.assertEqual(value["areas"][0]["valuePercent"], -25)
        self.assertEqual(value["sources"], [{"release": "src-hmlr-pp-sales-2026-07"}])
        self.assertEqual(connection.calls[-1][1], ("S", ["uk:lsoa:E01001266"], ["uk:lsoa:E01001266"]))

    def test_before_the_migration_nothing_is_available(self):
        value = good_value.good_value(Reader(Connection(ready=False)))
        self.assertFalse(value["available"])
        self.assertEqual(value["areas"], [])
        self.assertEqual(value["homeType"], "all")


if __name__ == "__main__":
    unittest.main()
