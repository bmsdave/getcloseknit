import unittest

from area_api.routing import (
    NETWORK_VERSION,
    WEEKDAY_TIMETABLE_DATE,
    screen_amenities,
)


RIVERSIDE_PARK = {
    "id": "park-riverside",
    "name": "Riverside Park",
    "category": "parks",
    "latitude": 51.5015,
    "longitude": -0.1420,
    "access": "public",
    "networkMinutes": 8,
    "sourceCategory": "leisure.park",
    "sourceUpdated": "2026-09-05",
    "hours": "confirmed",
    "areaHectares": 4.2,
}
CUT_OFF_PARK = {
    # 100m away across the river, but the walk network has no link.
    "id": "park-cutoff",
    "name": "Cutoff Gardens",
    "category": "parks",
    "latitude": 51.5016,
    "longitude": -0.1418,
    "access": "public",
    "networkMinutes": None,
    "sourceCategory": "leisure.park",
    "sourceUpdated": "2026-09-05",
    "hours": "confirmed",
    "areaHectares": 1.1,
}
PRIVATE_SQUARE = {
    "id": "square-private",
    "name": "Private Square",
    "category": "parks",
    "latitude": 51.5010,
    "longitude": -0.1410,
    "access": "private",
    "networkMinutes": 4,
    "sourceCategory": "leisure.garden",
    "sourceUpdated": "2026-09-05",
    "hours": "confirmed",
    "areaHectares": 0.6,
}
GROCER = {
    "id": "groc-corner",
    "name": "Corner Grocer",
    "category": "groceries",
    "latitude": 51.5020,
    "longitude": -0.1430,
    "access": "public",
    "networkMinutes": 6,
    "sourceCategory": "shop.convenience",
    "sourceUpdated": "2026-09-04",
    "hours": "unconfirmed",
}
PHARMACY = {
    "id": "pharm-high-st",
    "name": "High Street Pharmacy",
    "category": "pharmacies",
    "latitude": 51.5030,
    "longitude": -0.1440,
    "access": "public",
    "networkMinutes": 12,
    "sourceCategory": "shop.pharmacy",
    "sourceUpdated": "2026-09-04",
    "hours": "confirmed",
}
PHARMACY_DUPLICATE = {
    **PHARMACY,
    "id": "pharm-high-st-dup",
    "latitude": 51.50301,
    "longitude": -0.14401,
}

VENUES = [RIVERSIDE_PARK, CUT_OFF_PARK, PRIVATE_SQUARE, GROCER, PHARMACY, PHARMACY_DUPLICATE]
ORIGIN = "uk:lsoa:E01000001"


def _screen(venues=None, categories=None, max_walk=10, **kwargs):
    return screen_amenities(
        ORIGIN,
        venues if venues is not None else list(VENUES),
        categories if categories is not None else ["parks", "groceries", "pharmacies"],
        max_walk,
        network_version=kwargs.pop("network_version", NETWORK_VERSION),
        service_date=kwargs.pop("service_date", WEEKDAY_TIMETABLE_DATE),
        **kwargs,
    )


class WalkableAmenityTests(unittest.TestCase):
    def test_park_cut_off_by_river_is_not_reachable(self):
        result = _screen()
        cutoff = _venue(result, "park-cutoff")

        self.assertEqual(cutoff["status"], "no-network-link")
        self.assertIsNone(cutoff["walkMinutes"])
        self.assertNotIn("park-cutoff", _reachable_ids(result))

    def test_private_entrance_is_excluded_and_counted(self):
        result = _screen()

        self.assertNotIn("square-private", _reachable_ids(result))
        self.assertIn("square-private", result["excludedPrivateEntrances"])
        self.assertTrue(any("private" in note for note in result["assumptions"]))

    def test_duplicate_venues_are_listed_once(self):
        result = _screen()
        pharmacy_rows = [row for row in result["venues"] if row["name"] == "High Street Pharmacy"]

        self.assertEqual(len(pharmacy_rows), 1)

    def test_missing_network_link_keeps_source_category_and_date(self):
        result = _screen()
        cutoff = _venue(result, "park-cutoff")

        self.assertEqual(cutoff["sourceCategory"], "leisure.park")
        self.assertEqual(cutoff["sourceUpdated"], "2026-09-05")

    def test_park_area_is_distinct_from_reachable_entrance(self):
        result = _screen()
        park = _venue(result, "park-riverside")

        self.assertEqual(park["status"], "reachable")
        self.assertEqual(park["walkMinutes"], 8)
        self.assertEqual(park["parkAreaHectares"], 4.2)

    def test_reachable_amenity_keeps_unconfirmed_hours_visible(self):
        result = _screen()
        grocer = _venue(result, "groc-corner")

        self.assertEqual(grocer["status"], "reachable")
        self.assertEqual(grocer["hoursStatus"], "unconfirmed")

    def test_chosen_categories_change_results_without_universal_score(self):
        result = _screen(categories=["parks"])

        self.assertEqual(set(result["reachableByCategory"]), {"parks"})
        self.assertNotIn("groc-corner", _reachable_ids(result))
        for key in ("score", "utility", "lifestyleScore"):
            self.assertNotIn(key, result)

    def test_walking_limit_change_alters_reachable_set(self):
        narrow = _screen(max_walk=10)
        wide = _screen(max_walk=15)

        self.assertNotIn("pharm-high-st", _reachable_ids(narrow))
        self.assertIn("pharm-high-st", _reachable_ids(wide))


def _venue(result, venue_id):
    return next(row for row in result["venues"] if row["venueId"] == venue_id)


def _reachable_ids(result):
    return {row["venueId"] for row in result["venues"] if row["status"] == "reachable"}


if __name__ == "__main__":
    unittest.main()
