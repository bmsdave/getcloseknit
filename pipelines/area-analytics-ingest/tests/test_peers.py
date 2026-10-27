import unittest

from area_analytics.peers import (
    MINIMUM_PEER_GROUP_SIZE,
    PeerCandidate,
    PeerSale,
    build_peer_groups,
    peer_median_by_year,
    same_building_different_neighbourhood,
    similar_homes_nearby,
)


SUBJECT = PeerCandidate(
    property_id="uk:property:SW1A1AA:1-PARLIAMENT-PREVIEW",
    property_type="flat",
    floor_area_square_metres=54.0,
    price=560_000,
    price_per_square_metre=10_370.0,
    price_decile=8,
    msoa="E02000001",
    borough="E09000033",
    crime_decile=7,
    deprivation_decile=8,
    income_decile=9,
)


def _candidates(count, prefix="NEARBY", **overrides):
    candidates = []
    for index in range(count):
        fields = {
            "property_id": f"uk:property:SW1A1AA:{prefix}-{index}",
            "property_type": "flat",
            "floor_area_square_metres": 50.0 + index % 8,
            "price": 500_000 + index * 1_000,
            "price_per_square_metre": 9_000.0 + index * 40,
            "price_decile": 8,
            "msoa": "E02000001",
            "borough": "E09000033",
            "crime_decile": 7,
            "deprivation_decile": 8,
            "income_decile": 9,
        }
        fields.update(overrides)
        candidates.append(PeerCandidate(**fields))
    return candidates


class PeerGroupTests(unittest.TestCase):
    def test_every_published_group_reaches_the_minimum_size(self):
        groups = build_peer_groups(
            SUBJECT,
            [*_candidates(40), *_candidates(40, prefix="ELSEWHERE", msoa="E02000002")],
        )

        for group in groups:
            if group.status == "observed":
                self.assertGreaterEqual(group.count, MINIMUM_PEER_GROUP_SIZE)

    def test_a_house_always_falls_inside_its_own_group_range(self):
        for group in build_peer_groups(SUBJECT, _candidates(40)):
            if group.distribution is None:
                continue
            self.assertIn(SUBJECT.property_id, group.member_ids)
            self.assertLessEqual(group.distribution.p10, SUBJECT.price_per_square_metre)
            self.assertGreaterEqual(group.distribution.p90, SUBJECT.price_per_square_metre)
            self.assertTrue(0 <= group.percentile <= 100)

    def test_a_thin_group_reports_itself_rather_than_publishing_a_distribution(self):
        group = similar_homes_nearby(SUBJECT, _candidates(4))

        self.assertEqual(group.status, "too-thin")
        self.assertIsNone(group.distribution)
        self.assertIsNone(group.percentile)
        self.assertIn("Fewer than 30 members", group.definition)

    def test_a_thin_msoa_widens_to_the_borough_and_says_so(self):
        nearby = _candidates(40, prefix="BOROUGH", msoa="E02000002")
        group = similar_homes_nearby(SUBJECT, nearby)

        self.assertEqual(group.status, "observed")
        self.assertIn("widened to borough", group.definition)

    def test_the_isolating_group_excludes_this_neighbourhood_and_unlike_areas(self):
        elsewhere = _candidates(40, prefix="ELSEWHERE", msoa="E02000002", borough="E09000007")
        unlike = _candidates(40, prefix="UNLIKE", msoa="E02000003", borough="E09000012", crime_decile=1)
        group = same_building_different_neighbourhood(SUBJECT, [*elsewhere, *unlike])

        self.assertEqual(group.count, len(elsewhere) + 1)


class PeerTimelineTests(unittest.TestCase):
    def test_a_year_below_the_reliability_gate_is_suppressed_not_plotted(self):
        sales = [PeerSale("uk:property:A", "2024", 9_000.0) for _ in range(20)]
        sales.extend(PeerSale("uk:property:A", "2025", 9_500.0) for _ in range(3))

        timeline = peer_median_by_year(["uk:property:A"], sales)

        self.assertEqual(timeline[0].median_price_per_square_metre, 9_000.0)
        self.assertIsNone(timeline[1].median_price_per_square_metre)
        self.assertEqual(timeline[1].sample_count, 3)

    def test_sales_outside_the_group_do_not_move_its_median(self):
        sales = [PeerSale("uk:property:A", "2024", 9_000.0) for _ in range(20)]
        sales.extend(PeerSale("uk:property:B", "2024", 30_000.0) for _ in range(20))

        timeline = peer_median_by_year(["uk:property:A"], sales)

        self.assertEqual(timeline[0].median_price_per_square_metre, 9_000.0)


if __name__ == "__main__":
    unittest.main()
