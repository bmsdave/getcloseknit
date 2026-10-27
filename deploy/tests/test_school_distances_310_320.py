"""Last-distance adapters for Harrow, Havering, Hillingdon, Hounslow, Kingston, Merton, Newham,
Redbridge, Richmond, Sutton and Waltham Forest (DfE 310-320), on small fixtures taken from the
councils' documents (values as printed)."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipelines/area-analytics-ingest"))

from area_analytics.school_admissions.adapters import (  # noqa: E402
    harrow, havering, hillingdon, hounslow, kingston, merton, newham, redbridge, richmond, sutton,
    waltham_forest)
from area_analytics.school_admissions.parsers import Offer, parse_distance  # noqa: E402


def at(*cells: tuple[int, str]) -> str:
    """A text-layout line with each cell starting at its column."""
    line = ""
    for column, text in cells:
        line = line.ljust(column) + text
    return line


def got(offers: list[Offer], *fields: str) -> list[tuple]:
    return [tuple(getattr(o, f) for f in fields) for o in offers]


class SharedCellTests(unittest.TestCase):
    def test_outcomes_these_councils_print(self):
        self.assertEqual(parse_distance("All prefs met", "km"), (None, True))           # Kingston, Richmond
        self.assertEqual(parse_distance("All preferences met", "km"), (None, True))
        self.assertEqual(parse_distance("All on time offered", "metres"), (None, True))  # Merton
        self.assertEqual(parse_distance("all on-time received an offer", "metres"), (None, True))
        self.assertEqual(parse_distance("All", "metres"), (None, True))                 # Sutton
        self.assertEqual(parse_distance("All Applicants", "miles"), (None, True))       # Redbridge
        self.assertEqual(parse_distance("N/A (F)", "metres"), (None, None))             # Hillingdon key
        self.assertEqual(parse_distance("6.515 kms", "km"), (6515, None))


class HarrowTests(unittest.TestCase):
    def test_primary_distance_is_third_from_the_end_and_faith_rows_are_blank(self):
        header = ["SCHOOL NAME", "PLACES", "APPLICATIONS", "EHCP", "LAC", "MED", "MEDP", "SIB", "STAFF",
                  "DISTANCE", "FURTHEST DISTANCE", "NEAREST", "TOTAL"]
        rows = [header,
                ["Cannon Lane Primary School", "90", "396", "0", "0", "0", "0", "32", "0", "58", "0.851", "N/A", "90"],
                ["Aylward Primary School", "90", "177", "1 (7*)", "0", "0", "0", "29", "1", "37", "N/A", "0", "75"],
                ["St Joseph’s Catholic Primary School", "60", "160", "1", "", "", "", "", "", "", "", "N/A", "60"]]
        self.assertEqual(got(harrow.parse_tables([(1, rows)], "primary"), "school", "raw_value", "applicants", "offers"),
                         [("Cannon Lane Primary School", "0.851", 396, 90), ("Aylward Primary School", "N/A", 177, 75),
                          ("St Joseph's Catholic Primary School", "", 160, 60)])

    def test_secondary_finds_the_rotated_furthest_column(self):
        rows = [["School Name", "deviecer snoitacilppa", "NAP", "*selim ni dereffo ecnatsid tsehtruF", "ycnacav"],
                ["Avanti House", "724", "180", "0.642", "N/A"]]
        self.assertEqual(got(harrow.parse_tables([(1, rows)], "secondary"), "school", "raw_value", "applicants"),
                         [("Avanti House", "0.642", 724)])


class HaveringTests(unittest.TestCase):
    def test_columns_by_reversed_headers_and_footnoted_distances(self):
        header = ["", "elbailavA secalP", "secnereferP fo )6 rebmuN - 1( desserpxE", "dereffO secalP fo rebmuN latoT",
                  "sgnilbiS", "laitinI ta nekaT )ecnatsid enil thgiartS( s'MK ni ecnatsiD tsehtruF"]
        rows = [header, ["Brady Primary", "60", "151", "60", "30", "5.803"],
                ["The Campion School", "180", "462", "154", "40", "1.966 *"], ["Totals", "", "", "", "", ""]]
        notes = havering.footnotes("* Campion - distance allocations are based on a random selection "
                                   "** Coopers - This is the furthest distance place allocated")
        self.assertEqual(got(havering.parse_tables([(1, rows)], notes), "school", "raw_value", "criterion", "offers"),
                         [("Brady Primary", "5.803", None, 60),
                          ("The Campion School", "1.966", "Campion - distance allocations are based on a random selection", 154)])


class HillingdonTests(unittest.TestCase):
    HEADER = ["", "Schools", "Published Admission Number (Sept 21)", "On-time offers made on national offer day",
              "Places available", "Furthest distance offered 2021 - metres (Excluding Sibling criteria)",
              "Furthest distance offered 2020 - metres (Excluding Sibling criteria)",
              "Criteria the last child was offered under", ""]

    def test_reception_reads_the_years_column_and_the_key(self):
        rows = [(1, self.HEADER), (1, ["", "Belmore Primary Academy", "90", "67", "23", "N/A (U)", "N/A (U)", "5", ""]),
                (2, ["", "Heathrow Primary School", "60", "60", "0", "3,023.79", "2,068.64", "9", ""]),
                (2, ["", "Botwell House Catholic Primary School", "90", "90", "0", "N/A (F)", "N/A (F)", "11B", ""])]
        this = hillingdon.parse_rows(rows, 2021)
        self.assertEqual(got(this, "school", "raw_value", "all_offered", "offers", "criterion"),
                         [("Belmore Primary Academy", "N/A (U)", True, 67, "5"),
                          ("Heathrow Primary School", "3,023.79", None, 60, "9"),
                          ("Botwell House Catholic Primary School", "N/A (F)", None, 90, "11B")])
        before = hillingdon.parse_rows(rows, 2020)  # the previous year: no offers or criterion of 2021
        self.assertEqual(got(before, "raw_value", "offers", "criterion")[1], ("2,068.64", None, None))

    def test_secondary_text_reads_the_figure_under_the_year(self):
        text = "\n".join([
            at((26, "Number (Sept"), (100, "Places"), (116, "offered 2020"), (137, "offered 2019")),
            at((0, "Barnhill"), (34, "240"), (58, "30"), (81, "270"), (101, "0"), (117, "5414.96"), (138, "N/A (U)*")),
            at((0, "Oak Wood"), (34, "270"), (58, "0"), (81, "270"), (100, "14"), (115, "N/A (U)*"), (139, "17198"))])
        self.assertEqual(got(hillingdon.parse_layout(text, 2020), "school", "raw_value", "all_offered"),
                         [("Barnhill", "5414.96", None), ("Oak Wood", "N/A (U)", True)])
        self.assertEqual(got(hillingdon.parse_layout(text, 2019), "raw_value"), [("N/A (U)",), ("17198",)])

    def test_scans_keep_only_what_two_readings_agree_on(self):
        readings = ["Barnhill 240 6 0 1047.65\nHarefield School 90 2 24 N/A (U)*\n[Northwood 180 8 ) 1131.36",
                    "Barnhill 240 6 oO 1047.65\nHarefield School 30 2 24 NIA (U)*\nNorthwood 180 8 0 1131.36",
                    "Barnhill 240 6 0 1047.66\nHaydon 300 5 72 N/A (U)*"]
        self.assertEqual(got(hillingdon.parse_scan(readings), "school", "raw_value", "all_offered"),
                         [("Harefield School", "N/A (U)", True), ("Northwood", "1131.36", None)])


class HounslowTests(unittest.TestCase):
    def test_grid_rows_wrapped_cells_and_blocks(self):
        page = "\n".join([
            "How primary places were offered in September 2026",
            at((0, "Bedfont Primary"), (54, "30"), (90, "30 - 0.779 miles last"), (120, "60")),
            at((96, "distance"), (136, "149")),
            at((0, "Wellington Primary"), (48, "31"), (92, "55 -distance")),
            at((98, "All offered"), (118, "90"), (123, "225")),
            at((0, "Marlborough Primary"), (51, "16"), (92, "27 - All offered"), (113, "1"), (117, "90"), (122, "167")),
            "Academy and Free Schools",
            at((0, "Nishkam School West London"), (38, "Places available = 108"), (70, "Applications received = 213")),
            "Criteria - Faith Based Applications                    Allocations",
            at((0, "Faith - Keshadhari"), (48, "18 - last distance offered - 2.672 miles")),
            "Criteria - Open Place Applications                     Allocations",
            at((0, "Distance"), (50, "43 - last distance offered - 1.414 miles"))])
        offers = hounslow.parse_pages([page])
        self.assertEqual(got(offers, "school", "raw_value", "rule", "applicants"),
                         [("Bedfont Primary", "0.779 miles last", None, None),
                          ("Wellington Primary", "All offered", None, None),
                          ("Marlborough Primary", "All offered", None, 167),
                          ("Nishkam School West London", "last distance offered - 2.672 miles", "Faith - Keshadhari", 213),
                          ("Nishkam School West London", "last distance offered - 1.414 miles", "Distance", 213)])

    def test_deaneries_and_a_cell_that_is_not_a_number(self):
        page = "\n".join([
            at((0, "Green School for Girls"), (60, "Places available = 155"), (100, "Applications received = 494")),
            at((0, "Christian Foundation Places (80)"), (60, "14 - all offered")),
            at((0, "Community (40)"), (60, "91 - last distance offered - 4.5122.126 miles")),
            at((0, "St Mark's Catholic School"), (60, "Places available = 180"), (100, "Applications received = 1025")),
            at((60, "182 - last distance offered per Deanery")),
            at((0, "Baptised Catholics with CCP"), (57, "Hounslow - 0.842 miles, Hillingdon - 3.961 miles,")),
            at((80, "Ealing - 6.561 miles"))])
        self.assertEqual(got(hounslow.parse_pages([page]), "school", "raw_value", "rule"),
                         [("Green School for Girls", "all offered", None),
                          ("St Mark's Catholic School", "0.842 miles", "Baptised Catholics with CCP: Hounslow"),
                          ("St Mark's Catholic School", "3.961 miles", "Baptised Catholics with CCP: Hillingdon"),
                          ("St Mark's Catholic School", "6.561 miles", "Baptised Catholics with CCP: Ealing")])

    def test_rolling_table_column(self):
        page = "\n".join(["Secondary Transfer 2022 - Last distance offered",
                          "School      2020 Distance (Miles)      2021 Distance (Miles)      2022 Distance (Miles)",
                          "Bolder Academy      2.577      3.398      2.139",
                          "Gumley House School FCJ      Contact school for information      020 8568 8692"])
        self.assertEqual(got(hounslow.parse_rolling([page], 1), "school", "raw_value"), [("Bolder Academy", "3.398")])


class KingstonTests(unittest.TestCase):
    def test_stacked_three_year_cells(self):
        rows = [["School Name", "Year (available places)", "Criterion (v) Distance", "Distance of the last child",
                 "Furthest distance offered from the waiting list"],
                ["Alexandra\nSchool", "2024 (60)\n2025 (60)\n2026 (60", "32\n37\n41", "0.363 km\n0.513 km\n0.501 km",
                 "0.363 km*\n0.935 km\n0.501 km *"],
                ["Ellingham Primary", "2024 (30)\n2025 (31)\n2026 (30)", "11\n17\n35", "All prefs met\n6.647 km\nAll prefs met",
                 "All prefs met\n6.647 km\nAll prefs met"]]
        self.assertEqual(got(kingston.parse_tables([(1, rows)], 2025), "school", "raw_value"),
                         [("Alexandra School", "0.513 km"), ("Ellingham Primary", "6.647 km")])

    def test_one_box_per_figure_layout(self):
        text = "\n".join([
            at((11, "School name"), (33, "Year"), (47, "SEN*"), (127, "Criterion (v)"), (145, "Distance of"),
               (164, "Furthest"), (178, "Appeals heard")),
            at((11, "Ellingham"), (33, "2019 (60)"), (51, "-"), (130, "34"), (148, "-"), (163, "1.759 km"), (183, "0")),
            at((11, "Lovelace Primary"), (33, "2019 ( 90)"), (51, "-"), (130, "54"), (145, "1.413 km"), (163, "1.464 km")),
            at((11, "Junior"), (33, "2020 (120)"), (51, "1"), (130, "1"), (145, "0.504 km"), (163, "0.915 km"))])
        self.assertEqual(got(kingston.parse_layout(text, 2019), "school", "raw_value"),
                         [("Ellingham", "-"), ("Lovelace Primary", "1.413 km")])

    def test_secondary_offer_day_column(self):
        rows = [["School Name", "PAN 2026", "Cut off distances at NOD 2026", "Distance at end of NC 2026",
                 "Cut off distances at NOD 2025", "Distance at end of NC 2025", "Cut off distances at NOD 2024",
                 "Distance at end of NC 2024"],
                ["Coombe Boys' School", "180", "3.202 km", "3.202 km", "2.624 km", "4.333 km", "2.408 km", "2.836 km"],
                ["Tiffin School", "180", "CONTACT THE SCHOOL FOR ALLOCATION INFORMATION", "", "", "", "", ""]]
        self.assertEqual(got(kingston.parse_secondary([(1, rows)], "", 4), "school", "raw_value"),
                         [("Coombe Boys' School", "2.624 km")])


class MertonTests(unittest.TestCase):
    def test_offer_day_column_wrapped_names_and_apa_cells(self):
        page = "\n".join([
            "Reception allocations", "How places were allocated for September 2026",
            at((0, "School"), (15, "No."), (85, "Furthest"), (98, "Furthest"), (109, "Furthest")),
            at((85, "distance"), (98, "distance"), (109, "distance")),
            at((0, "Abbotsbury"), (15, "60"), (24, "73"), (32, "0"), (85, "All on time offered")),
            at((0, "All Saints’"), (15, "60"), (24, "128"), (32, "Please contact school for further information")),
            at((0, "Dundonald"), (15, "60"), (24, "352"), (32, "0"), (74, "21 – all"), (85, "All APA"), (98, "All APA")),
            at((74, "sibs"), (85, "offered"), (98, "offered")),
            at((85, "381.08"), (98, "687.90")),
            at((85, "outside"), (98, "outside")),
            at((85, "APA"), (98, "APA")),
            at((0, "Joseph"), (15, "60"), (24, "139"), (32, "0"), (85, "1235.44"), (98, "1235.44")),
            at((0, "Hood"))])
        self.assertEqual(got(merton.parse_pdf([page], "primary", 2026), "school", "raw_value", "criterion", "applicants"),
                         [("Abbotsbury", "All on time offered", None, 73),
                          ("Dundonald", "381.08", "All APA offered 381.08 outside APA", 352),
                          ("Joseph Hood", "1235.44", None, 139)])


class NewhamTests(unittest.TestCase):
    def test_offer_rows_units_sites_and_repeated_tables(self):
        walking, km = "Shortest Walking Distance in Miles", "Straight Line Distance in Kilometres"
        rows = ["    2004     102711     Brampton Primary School     120     120     354     71     0     120"
                f"     All Other     0.964     {walking}",
                "    2000     102709     Altmore Infant School     150     150     242     129     1     145"
                f"     N/A     N/A     {walking}",
                "    4004     139834     East London Science School     125     392     0     105     0     125"
                f"     Band F     4.8772     {km}",
                "    2072     142267     Upton Cross Primary School - Kirton Road Site     30     30     40     0     30"
                f"     All Other     0.5     {walking}",
                "    4011     144739     Bobby Moore Academy     180     610     2     2     577     610     " + walking]
        offers = newham.parse_pages(["\n".join(rows + rows[:1])])
        self.assertEqual(got(offers, "school", "raw_value", "criterion", "offers", "site"),
                         [("Brampton Primary School", "0.964", "All Other", 120, "main"),
                          ("Altmore Infant School", "N/A", None, 145, "main"),
                          ("East London Science School", "4.8772 km", f"Band F; tie-break: {km}", 125, "main"),
                          ("Upton Cross Primary School", "0.5", "All Other", 30, "kirton-road")])


class RedbridgeTests(unittest.TestCase):
    def test_reception_bands_blank_lines_and_juniors(self):
        text = "\n".join([
            "ADMISSION TO RECEPTION CLASS/JUNIOR TRANSFER 2026", "All distances shown are for the last child",
            "Aldborough Primary School", "All On Time Applicants Offered", "",
            "Atam Academy",
            at((0, "Sikh Faith - 11 Points"), (96, "1.35 miles")),
            at((0, "Sibling: All on time sibling applications offered"), (96, "All Applicants")),
            at((0, "Late Applications:"), (96, "None Offered")), "",
            at((15, "l")), at((14, "All on-time applications offered*")), "",
            "TRANSFER TO JUNIOR SCHOOL", "Churchfields Junior School",
            at((0, "Junior Transfer Distance"), (96, "0.471 miles"))])
        self.assertEqual(got(redbridge.reception(text), "school", "rule", "raw_value", "entry_point"),
                         [("Aldborough Primary School", None, "All On Time Applicants Offered", None),
                          ("Atam Academy", "Sikh Faith - 11 Points", "1.35 miles", None),
                          ("Atam Academy", "Sibling", "All Applicants", None),
                          ("Churchfields Junior School", "Junior Transfer Distance", "0.471 miles", "year3")])

    def test_secondary_paragraphs(self):
        text = "\n".join([
            "Beal High School*: All on time sibling, catchment and on time out of catchment applicants have",
            "been offered up to 3.193 miles.",
            "Chadwell Heath Academy *: All on time siblings offered; the last on time 'Proximity' candidate was",
            "at a distance of 1878 metres (this school uses their own measurements).",
            "Ilford County High School: Last offered on time candidate scored 106.02.",
            "2025: 109.35",
            "Mayfield School*: All on time applications offered.",
            "The Forest Academy”: All on time applications offered; further places may become available."])
        self.assertEqual(got(redbridge.secondary(text), "school", "raw_value"),
                         [("Beal High School", "3.193 miles"), ("Chadwell Heath Academy", "1878 metres"),
                          ("Mayfield School", "All on time applications offered"),
                          ("The Forest Academy", "All on time applications offered")])

    def test_ocr_majority(self):
        a, b, c = (Offer("X School", "1.1 miles", rule="Distance"), Offer("X School", "1.7 miles", rule="Distance"),
                   Offer("Y School", "0.5 miles", rule="Distance"))
        self.assertEqual(got(redbridge.agreed([[a, c], [a], [b, c]]), "school", "raw_value"),
                         [("X School", "1.1 miles"), ("Y School", "0.5 miles")])


class RichmondTests(unittest.TestCase):
    def test_rows_grouped_by_rising_years_take_the_name_printed_among_them(self):
        rows = [("", 2021, "0.422 km", False, 1), ("Barnes Primary School", 2022, "0.394 km", False, 1),
                ("", 2023, "0.239 km", False, 1), ("", 2021, "All prefs met", False, 1),
                ("Meadlands Primary School", 2022, "All prefs met", False, 2), ("", 2023, "All prefs met", False, 2)]
        self.assertEqual([(n, y) for n, y, *_ in richmond.grouped(rows)][2:4],
                         [("Barnes Primary School", 2023), ("Meadlands Primary School", 2021)])

    def test_secondary_routes_and_criteria(self):
        rows = [["School Name", "Cut off - NOD 2023", "Distance end of NC", "Cut off - NOD 2022", "Distance end of NC"],
                ["Christ's Foundation", "Crit 10 - 4.547 kms", "Crit 10 - 12.056kms", "Crit 5 - 2.756kms", "Crit 8 - 9.673 kms"],
                ["Turing House 20%", "0.636 kms", "0.698 kms", "0.849 kms", "1.233 kms"],
                ["Twickenham School", "All preferences met", "All preferences met", "All preferences met", ""],
                ["St Richard Reynolds", "Band 8 - 4.420 kms", "Random alloc within Band", "Random alloc within Band", ""]]
        self.assertEqual(got(richmond.parse_secondary([(1, rows)], 3), "school", "rule", "raw_value", "criterion"),
                         [("Christ's", "Foundation", "2.756kms", "Crit 5"), ("Turing House", "20%", "0.849 kms", None),
                          ("Twickenham School", None, "All preferences met", None)])


class SuttonTests(unittest.TestCase):
    def test_labels_dropped_and_the_second_figure_is_its_own_rule(self):
        table = [["School", "DfE number", "Published Admissions Number (PAN)", "Furthest Distance (Metres)"],
                 ["Abbey Primary (Academy)", "319 2012", "60", "All"],
                 ["Cheam High School Worcester Park Places", "319 5403", "320", "1,492 678"],
                 ["Carshalton Boys Sports College", "319 4000", "240", "4,185"]]
        self.assertEqual(got(sutton.parse_tables([table]), "school", "raw_value", "rule"),
                         [("Abbey Primary", "All", None), ("Cheam High School", "1,492", None),
                          ("Cheam High School", "678", "Worcester Park Places"),
                          ("Carshalton Boys Sports College", "4,185", None)])


class WalthamForestTests(unittest.TestCase):
    def test_offer_day_table(self):
        text = "\n".join([
            "National Offer Day (Pre-school to Reception 2019)",
            "BASE NAME     PAN SEN/EHC LAC Medical Social Sibling Staff     Places      Cut off",
            "Barclay Primary School (Site 2)     60     0     0     3     0     24     0     33     0     0     .333",
            "Coppermill Primary School     30     0     0     0     0     21     0     0     0     0     .143*",
            "Chingford Hall Primary School     60     0     0     0     0     8     0     17     8     27     n/a",
            "* All children offered a place under distance in Coppermill Primary School live in the mini-catchment area."])
        self.assertEqual(got(waltham_forest.offer_day(text), "school", "site", "raw_value", "criterion"),
                         [("Barclay Primary School", "site-2", ".333", None),
                          ("Coppermill Primary School", "main", ".143",
                           "All children offered a place under distance in Coppermill Primary School live in the "
                           "mini-catchment area."),
                          ("Chingford Hall Primary School", "main", "n/a", None)])

    def test_brochure_columns_blanks_catchment_and_two_points(self):
        text = "\n".join([
            "     Cut off distances in miles for past three years", "      School",
            at((62, "2020/21"), (91, "2021/22"), (121, "2022/23")),
            at((6, "Buxton School")),
            at((6, "Chingford Foundation School"), (54, "1.282 (catchment - 1.172)"), (111, "2.610 (catchment - 1.169)")),
            at((6, "Eden Girls’ School, Waltham Forest"), (54, "School 0.649"), (86, "School 1.436"), (112, "School 1.704")),
            at((54, "Station 0.609"), (86, "Station 1.119"), (112, "Station 0.740")),
            at((6, "Norlington School and 6th Form"), (54, "1.749"), (86, "2.006")),
            "     Where no cut off distance is shown for a school this means that all applicants were offered"])
        self.assertEqual(got(waltham_forest.brochure(text, 2022), "school", "rule", "raw_value", "all_offered"),
                         [("Buxton School", None, "", True), ("Chingford Foundation School", "catchment", "1.169", None),
                          ("Chingford Foundation School", None, "2.610", None),
                          ("Eden Girls' School, Waltham Forest", "School", "1.704", None),
                          ("Eden Girls' School, Waltham Forest", "Station", "0.740", None),
                          ("Norlington School and 6th Form", None, "", True)])


if __name__ == "__main__":
    unittest.main()
