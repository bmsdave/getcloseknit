"""Kids layers ETL: Ofsted ratings, STATS19 pedestrian/cyclist casualties and TfL cycle lanes."""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import area_coverage as coverage  # noqa: E402
import etl_kids as kids  # noqa: E402


def london():
    """The London-only build (CLOSE_KNIT_ETL_COVERAGE=london)."""
    return mock.patch.multiple(kids, COVERAGE=coverage.LONDON, REGION_NAMES=frozenset({"london"}))

CARD = kids.CARD
HEADER = ("Web link,Provider URN,Provider type,Provider status,Provider Early Years Register flag,Provider name,"
          "Provider postcode,Region,Places,EYR OEIF/CIF: Most recent: Overall effectiveness,"
          "EYR OEIF: Most recent: Full inspection date")


def provider(**fields):
    return {**{f"{CARD}{area}": "" for area in kids.CARD_AREAS}, **fields}


class OfstedTests(unittest.TestCase):
    def test_old_framework_good_or_outstanding_is_well_rated(self):
        row = provider(**{"EYR OEIF/CIF: Most recent: Overall effectiveness": "2",
                          "EYR OEIF: Most recent: Full inspection date": "21/11/2016"})
        self.assertEqual(kids.well_rated(row), ("overall-effectiveness", "Good", True, "2016-11-21"))
        row["EYR OEIF/CIF: Most recent: Overall effectiveness"] = "3"
        self.assertEqual(kids.well_rated(row)[1:3], ("Requires improvement", False))

    def test_report_card_wins_and_its_weakest_area_decides(self):
        row = provider(**{f"{CARD}Inclusion": "Strong standard", f"{CARD}Achievement": "Expected standard",
                          f"{CARD}Safeguarding standards met?": "Met", f"{CARD}Inspection date": "02/03/2026",
                          "EYR OEIF/CIF: Most recent: Overall effectiveness": "4"})
        self.assertEqual(kids.well_rated(row), ("report-card", "Expected standard", True, "2026-03-02"))
        row[f"{CARD}Leadership and governance"] = "Needs attention"
        self.assertEqual(kids.well_rated(row)[1:3], ("Needs attention", False))

    def test_safeguarding_not_met_is_never_well_rated(self):
        row = provider(**{f"{CARD}Inclusion": "Exceptional", f"{CARD}Safeguarding standards met?": "Not met"})
        self.assertEqual(kids.well_rated(row)[1:3], ("Safeguarding not met", False))

    def test_not_yet_inspected_has_no_rating(self):
        self.assertEqual(kids.well_rated(provider()), (None, None, None, None))

    def test_only_active_london_nurseries_on_the_early_years_register(self):
        lines = ["Title line,,,", "Note line,,,", HEADER,
                 "Web link,EY1,Childcare on non-domestic premises,Active,Y,Little Acorns,sw1a1aa,London,40,1,01/02/2020",
                 "Web link,EY2,Childminder,Active,Y,REDACTED,REDACTED,London,6,2,",
                 "Web link,EY3,Childcare on non-domestic premises,Active,Y,Elsewhere,BS1 1AA,South West,30,2,",
                 "Web link,EY4,Childcare on non-domestic premises,Active,N,Holiday club,E1 6AN,London,30,2,",
                 "Web link,EY5,Childcare on non-domestic premises,Active,Y,New nursery,E1 6AN,London,,,"]
        with london():
            rows = list(kids.nurseries(lines))
        self.assertEqual([row[0] for row in rows], ["EY1", "EY5"])
        # England (the default coverage): every region's nurseries.
        self.assertEqual([row[0] for row in kids.nurseries(lines)], ["EY1", "EY3", "EY5"])
        self.assertEqual(rows[0], ["EY1", "Little Acorns", "SW1A 1AA", 40, "overall-effectiveness", "Outstanding",
                                   "2020-02-01", True])
        self.assertEqual(rows[1][3:], [None, None, None, None, None])

    def test_postcode_is_normalised_or_rejected(self):
        self.assertEqual(kids.postcode(" n1  9gu "), "N1 9GU")
        self.assertIsNone(kids.postcode("REDACTED"))

    def test_as_at_date_comes_from_the_file_name(self):
        self.assertEqual(kids.ofsted_date("x_data_as_at_30_June_2026.csv"), "2026-06-30")


class CasualtyTests(unittest.TestCase):
    def test_london_pedestrians_and_cyclists_with_children_flagged(self):
        collisions = [
            {"collision_index": "A", "collision_year": "2024", "local_authority_ons_district": "E09000007",
             "longitude": "-0.14", "latitude": "51.53"},
            {"collision_index": "B", "collision_year": "2024", "local_authority_ons_district": "E06000001",
             "longitude": "-1.2", "latitude": "54.7"},
        ]
        people = [
            {"collision_index": "A", "casualty_reference": "1", "casualty_class": "3", "casualty_type": "0",
             "age_of_casualty": "9", "casualty_severity": "2"},
            {"collision_index": "A", "casualty_reference": "2", "casualty_class": "1", "casualty_type": "1",
             "age_of_casualty": "-1", "casualty_severity": "3"},
            {"collision_index": "A", "casualty_reference": "3", "casualty_class": "1", "casualty_type": "9",
             "age_of_casualty": "40", "casualty_severity": "3"},
            {"collision_index": "B", "casualty_reference": "1", "casualty_class": "3", "casualty_type": "0",
             "age_of_casualty": "30", "casualty_severity": "3"},
        ]
        with london():
            self.assertEqual(list(kids.casualties(collisions, people)), [
                ["A", 1, 2024, 2, "pedestrian", True, -0.14, 51.53],
                ["A", 2, 2024, 3, "cyclist", False, -0.14, 51.53],
            ])
        self.assertEqual(list(kids.casualties(collisions, people))[-1], ["B", 1, 2024, 3, "pedestrian", False, -1.2, 54.7])

    def test_england_keeps_retired_english_district_codes_and_drops_wales(self):
        self.assertTrue(kids.collision_in_coverage("E07000163"))  # Craven, part of North Yorkshire since 2023
        self.assertFalse(kids.collision_in_coverage("W06000015"))
        with london():
            self.assertFalse(kids.collision_in_coverage("E07000163"))
            self.assertTrue(kids.collision_in_coverage("E09000033"))



class AllCasualtyTests(unittest.TestCase):
    def test_every_road_user_with_year_light_and_age_band_but_no_date_or_sex(self):
        collisions = [
            {"collision_index": "A", "collision_year": "2024", "local_authority_ons_district": "E09000007",
             "longitude": "-0.14", "latitude": "51.53", "light_conditions": "4", "date": "01/02/2024", "time": "18:05"},
            {"collision_index": "B", "collision_year": "2023", "local_authority_ons_district": "E09000033",
             "longitude": "-0.13", "latitude": "51.50", "light_conditions": "1"},
            {"collision_index": "C", "collision_year": "2023", "local_authority_ons_district": "E07000001",
             "longitude": "1.0", "latitude": "52.0", "light_conditions": "1"},  # outside London
        ]
        people = [
            {"collision_index": "A", "casualty_reference": "1", "casualty_class": "3", "casualty_type": "0",
             "age_of_casualty": "9", "age_band_of_casualty": "2", "casualty_severity": "1", "sex_of_casualty": "1"},
            {"collision_index": "A", "casualty_reference": "2", "casualty_class": "1", "casualty_type": "90",
             "escooter_flag": "1", "age_of_casualty": "17", "age_band_of_casualty": "4", "casualty_severity": "2"},
            {"collision_index": "B", "casualty_reference": "1", "casualty_class": "2", "casualty_type": "9",
             "age_of_casualty": "-1", "age_band_of_casualty": "-1", "casualty_severity": "3"},
            {"collision_index": "B", "casualty_reference": "2", "casualty_class": "1", "casualty_type": "18",
             "age_of_casualty": "50", "age_band_of_casualty": "8", "casualty_severity": "3"},
            {"collision_index": "C", "casualty_reference": "1", "casualty_class": "3", "casualty_type": "0",
             "age_of_casualty": "30", "age_band_of_casualty": "6", "casualty_severity": "3"},
        ]
        expected = [
            ["A", 1, 2024, 1, "pedestrian", True, "6-10", True, -0.14, 51.53],
            ["A", 2, 2024, 2, "escooter", False, "16-20", True, -0.14, 51.53],
            ["B", 1, 2023, 3, "car", False, None, False, -0.13, 51.50],
            ["B", 2, 2023, 3, "other", False, "46-55", False, -0.13, 51.50],  # tram
        ]
        with london():
            self.assertEqual(list(kids.all_casualties(collisions, people)), expected)
        self.assertEqual(list(kids.all_casualties(collisions, people)),
                         expected + [["C", 1, 2023, 3, "pedestrian", False, "26-35", False, 1.0, 52.0]])

    def test_unknown_light_is_null(self):
        collisions = [{"collision_index": "A", "collision_year": "2022", "local_authority_ons_district": "E09000001",
                       "longitude": "-0.1", "latitude": "51.5", "light_conditions": "-1"}]
        people = [{"collision_index": "A", "casualty_reference": "1", "casualty_class": "1", "casualty_type": "1",
                   "age_of_casualty": "30", "age_band_of_casualty": "6", "casualty_severity": "3"}]
        self.assertIsNone(list(kids.all_casualties(collisions, people))[0][7])


class CollisionRateTests(unittest.TestCase):
    RESIDENTS = {"L1": 2000, "L2": 1000, "L3": 1500, "L4": 0}

    def test_rate_is_hurt_per_1000_residents_per_year_and_zero_is_observed(self):
        # 10 hurt over 5 years among 2,000 residents = 1.0; 1 among 1,000 = 0.2; none among 1,500 = 0.0.
        rates = kids.collision_rates({"L1": 10, "L2": 1}, self.RESIDENTS, 5)
        self.assertEqual(rates["L1"], (1.0, 100, 10))
        self.assertEqual(rates["L2"], (0.2, 50, 1))
        self.assertEqual(rates["L3"], (0.0, 0, 0))

    def test_no_residents_is_unknown_never_zero(self):
        rates = kids.collision_rates({"L4": 3}, self.RESIDENTS, 5)
        self.assertIsNone(rates["L4"])
        self.assertNotIn("L9", rates)

    def test_percentile_ranks_every_lsoa_with_residents(self):
        rates = kids.collision_rates({"L1": 5, "L2": 5, "L3": 5}, self.RESIDENTS, 5)
        # 0.5, 1.0 and 0.67 per 1,000 residents a year.
        self.assertEqual([rates[gid][1] for gid in ("L1", "L2", "L3")], [0, 100, 50])
        self.assertEqual(rates["L3"][0], 0.67)


    def test_tied_rates_share_one_percentile_the_lowest_rank_of_the_tie(self):
        residents = {f"Z{i}": 1000 for i in range(4)} | {"A1": 1000, "A2": 1000, "B1": 1000, "B2": 1000, "C1": 1000}
        # Four LSOAs at 0.0, two at 0.2, two at 0.4, one at 1.0: nine in all.
        hurt = {"A1": 1, "A2": 1, "B1": 2, "B2": 2, "C1": 5}
        rates = kids.collision_rates(hurt, residents, 5)
        self.assertEqual({rates[f"Z{i}"][1] for i in range(4)}, {0})
        self.assertEqual({rates["A1"][1], rates["A2"][1]}, {50})   # first of the tie is rank 4 of 0..8
        self.assertEqual({rates["B1"][1], rates["B2"][1]}, {75})   # rank 6
        self.assertEqual(rates["C1"][1], 100)


class CollisionLegendTests(unittest.TestCase):
    def test_quintile_stops_keep_one_decimal_and_the_last_is_open_ended(self):
        stops = kids.collision_legend([i / 10 for i in range(50)])
        self.assertEqual([stop["label"] for stop in stops], ["1.0", "2.0", "3.0", "4.0", "4.9+"])
        self.assertEqual(kids.collision_legend([]), [])

    def test_definition_names_the_rate_per_1000_residents(self):
        definition = kids.collision_definition("2020-2024", [])
        self.assertEqual(definition["label"], "Road collisions (rate)")
        self.assertIn("1,000 residents", definition["description"])


class LaneTests(unittest.TestCase):
    def test_segregated_or_stepped_is_protected_and_only_open_cycleways(self):
        line = {"type": "LineString", "coordinates": [[-0.1, 51.5], [-0.11, 51.5]]}
        cid = {"features": [
            {"properties": {"FEATURE_ID": "L1", "CLT_SEGREG": "TRUE", "CLT_STEPP": "FALSE"}, "geometry": line},
            {"properties": {"FEATURE_ID": "L2", "CLT_SEGREG": "FALSE", "CLT_STEPP": "TRUE"}, "geometry": line},
            {"properties": {"FEATURE_ID": "L3", "CLT_SEGREG": "FALSE", "CLT_STEPP": "FALSE"}, "geometry": line},
            {"properties": {"FEATURE_ID": "L4"}, "geometry": None},
        ]}
        routes = {"features": [
            {"properties": {"OBJECTID": "200", "Label": "C48", "Route_Name": "Cycleway 48", "Status": "Open"},
             "geometry": line},
            {"properties": {"OBJECTID": "201", "Label": "C99", "Status": "Planned"}, "geometry": line},
        ]}
        rows = list(kids.lanes(cid, routes))
        self.assertEqual([(row[0], row[1], row[2]) for row in rows], [
            ("L1", "protected", None), ("L2", "protected", None), ("L3", "lane", None),
            ("cycleway-200", "cycleway", "Cycleway 48")])


if __name__ == "__main__":
    unittest.main()
