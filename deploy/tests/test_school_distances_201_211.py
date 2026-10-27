"""Adapters for City of London, Camden, Greenwich, Hackney, Hammersmith & Fulham, Islington, Kensington
and Chelsea, Lambeth, Lewisham, Southwark and Tower Hamlets (201-211), on excerpts of their documents."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "school_distances"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


def parts(name: str) -> list[str]:
    return fixture(name).split("=====\n")


def temp(text: str, suffix: str) -> str:
    handle = tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False)
    handle.write(text)
    handle.close()
    return handle.name


from area_analytics.school_admissions.adapters import (  # noqa: E402
    camden,
    city_of_london,
    greenwich,
    hackney,
    hammersmith_fulham,
    islington,
    kensington_chelsea,
    lambeth,
    lewisham,
    southwark,
    tower_hamlets,
)
from area_analytics.school_admissions.parsers import parse_distance  # noqa: E402


def by_school(offers, rule=False):
    return {(o.school, o.rule) if rule else o.school: o for o in offers}


class CityOfLondonTests(unittest.TestCase):
    TEXT = ("Criterion Number of children allocated 1 0 2 11 Fraudulent information The furthest distance a pupil "
            "was allocated a school place: 3210.41 metres. There were no appeals lodged for reception places in "
            "2024. The Aldgate School")

    def test_one_sentence_per_booklet_and_the_appeals_year_checks_it(self):
        offer = city_of_london.parse_text(self.TEXT, 2024)
        self.assertEqual((offer.school, offer.raw_value), ("The Aldgate School", "3210.41 metres"))
        with self.assertRaises(ValueError):
            city_of_london.parse_text(self.TEXT, 2023)
        stated = "furthest distance at which a Reception place was allocated for 2026 entry was 3315.69 metres"
        self.assertEqual(city_of_london.parse_text(stated + " The Aldgate School", 2026).raw_value, "3315.69 metres")


class CamdenTests(unittest.TestCase):
    def test_primary_column_of_the_year_with_vacancies_and_check_with_school(self):
        new, old, _ = parts("camden-guides.txt")
        got = by_school(camden.primary(new, 2024))
        self.assertEqual((got["Abacus"].raw_value, got["Abacus"].applicants), ("0.668", 112))
        self.assertEqual((got["Brookfield"].raw_value, got["Brookfield"].all_offered), ("n/a", True))
        self.assertEqual(got["Netley"].raw_value, "3.654")
        self.assertEqual(by_school(camden.primary(new, 2023))["Brookfield"].raw_value, "0.991")
        got = by_school(camden.primary(old, 2020))  # year columns reversed: 2021 then 2020
        self.assertEqual(got["Abacus"].raw_value, "")  # '*': check with the school
        self.assertEqual(got["West Hampstead"].raw_value, "0.374")  # name above its figures

    def test_secondary_bands_and_vacancies(self):
        _, _, sec = parts("camden-guides.txt")
        got = by_school(camden.secondary(sec, 2023), rule=True)
        self.assertEqual(got[("Camden School for Girls", "Band A")].raw_value, "0.90")
        self.assertEqual(got[("Camden School for Girls", "Band B")].raw_value, "1.06")
        self.assertEqual(got[("UCL Academy", None)].raw_value, "2.01")
        self.assertEqual(by_school(camden.secondary(sec + "n/a - These schools had vacant places\n", 2024),
                                   rule=True)[("UCL Academy", None)].all_offered, True)


class GreenwichTests(unittest.TestCase):
    def test_offers_map_bands_sites_and_year(self):
        data = {"coords_radii": {"year": "2026", "data": {
            "Invicta Primary School (Deptford site)": [1, 2, 1918.43, "Updated"],
            "St Mary Mag (Peninsula) CE (Open band)": [1, 2, 5362.53, "Updated"],
            "Leigh Halley Academy - Band 2": [1, 2, 4518.35, "Updated"],
            "Gallions Mount Primary School": [1, 2, None, "Updated"]}}}
        path = temp(json.dumps(data), ".html")
        try:
            got = {(o.school, o.rule, o.site): o.raw_value for o in greenwich.offers_map(path, 2026)}
            with self.assertRaises(ValueError):
                greenwich.offers_map(path, 2025)
        finally:
            os.unlink(path)
        self.assertEqual(got[("Invicta Primary School", None, "deptford")], "1918.43")
        self.assertEqual(got[("St Mary Mag (Peninsula) CE", "Open band", "main")], "5362.53")
        self.assertEqual(got[("Leigh Halley Academy", "Band 2", "main")], "4518.35")
        self.assertEqual(got[("Gallions Mount Primary School", None, "main")], "")

    def test_band_sheet_and_booklet(self):
        rows = [["Harris Academy Greenwich", "", "", "", "", ""],
                ["Total Number of Applications", "Oversubscribed", "Offers by Band", "Criteria", "Last distance", ""],
                ["Band 1", "44", "Yes", "7", "Distance ", "486.88"],
                ["Band 2", "50", "No", "15", "Distance ", "5022.81"],
                ["Untested", "215", "", "57", "", "7282.39"]]
        got = by_school(greenwich.bands(rows), rule=True)
        self.assertEqual(got[("Harris Academy Greenwich", "Band 1")].raw_value, "486.88")
        self.assertTrue(got[("Harris Academy Greenwich", "Band 2")].all_offered)  # not oversubscribed
        self.assertEqual(got[("Harris Academy Greenwich", "Untested")].raw_value, "7282.39")
        got = by_school(greenwich.booklet(fixture("greenwich-secondary-2025-raw.txt"), 2025), rule=True)
        self.assertEqual(got[("Harris Academy Greenwich", "Band 3")].raw_value, "7.11 km")
        self.assertEqual(parse_distance("7.11 km", "km")[0], 7110)


class HackneyTests(unittest.TestCase):
    def setUp(self):
        self.text = hackney.norm(fixture("hackney-primary-compendium.txt"))

    def test_2023_on_vacancies_mean_all_offered_with_the_furthest_child(self):
        got = by_school(hackney.primary(self.text, 2026))
        self.assertEqual((got["Berger Primary School"].raw_value, got["Berger Primary School"].all_offered), ("9.719", True))
        self.assertEqual((got["Betty Layward Primary School"].raw_value, got["Betty Layward Primary School"].all_offered),
                         ("0.245", None))

    def test_bracketed_cut_off_in_older_tables(self):
        got = by_school(hackney.primary(self.text, 2022))
        self.assertEqual(got["Betty Layward Primary School"].raw_value, "0.38")
        self.assertEqual((got["Baden Powell School"].raw_value, got["Baden Powell School"].all_offered), ("", True))
        got = by_school(hackney.primary(self.text, 2020))
        self.assertEqual(got["Be y Layward Primary School"].raw_value, "0.352")  # ligature lost in the PDF

    def test_secondary_box_values_go_to_the_nearest_band(self):
        def word(text, x0, top):
            return {"text": text, "x0": x0, "x1": x0 + 6 * len(text), "top": top}
        rows = hackney._lines([
            word("Offers", 10, 0), word("at", 50, 0), word("Haggerston", 70, 0), word("School", 140, 0),
            word("Offers", 400, 0), word("at", 440, 0), word("Skinners'", 460, 0), word("Academy", 520, 0),
            word("Band", 200, 10), word("A", 228, 10), word("Band", 250, 10), word("B", 278, 10),
            word("Band", 600, 10), word("A", 628, 10),
            word("Maximum", 10, 20), word("Distance", 60, 20), word("(miles)", 110, 20),
            word("0.5", 255, 20), word("Total", 400, 20), word("36", 600, 20),
        ])
        offers = hackney._boxes(rows, 800, 2026, "", 2026)
        self.assertEqual([(o.school, o.rule, o.raw_value) for o in offers], [("Haggerston School", "Band B", "0.5")])


class HammersmithFulhamTests(unittest.TestCase):
    def test_free_text_boxes(self):
        one = hammersmith_fulham.box_offers("Kenmont", "How places were offered in 2021 Siblings: 12 Distance: 19 "
                                            "(up to a distance of 0.342 of a mile)")
        self.assertEqual([(o.raw_value, o.rule) for o in one], [("0.342 miles", None)])
        two = hammersmith_fulham.box_offers("St Peter's", "Foundation: 23 (last offer under criterion 4 at a distance "
                                            "of 1.039 of a mile) Open: 7 (last offer under open criterion 2 at a "
                                            "distance of 0.092 of a mile)")
        self.assertEqual([(o.raw_value, o.rule) for o in two], [("1.039 miles", "Foundation"), ("0.092 miles", "Open")])
        sites = hammersmith_fulham.box_offers("Earl's Court", "Distance: 8 places offered to the Hammersmith site "
                                              "(last distance offered 0.806); 8 places offered to the Earls Court "
                                              "site (last distance offered 0.394)")
        self.assertEqual([(o.site, o.raw_value) for o in sites], [("hammersmith", "0.806 miles"), ("earls-court", "0.394 miles")])
        everyone = hammersmith_fulham.box_offers("Addison", "How places were offered in 2024 All on-time applications were offered.")
        self.assertTrue(everyone[0].all_offered)
        self.assertEqual(parse_distance(everyone[0].raw_value, "miles"), (None, True))

    def test_standalone_band_labels_below_their_rows(self):
        got = by_school(hammersmith_fulham.standalone(fixture("hammersmith_fulham-secondary-2025.txt")), rule=True)
        self.assertEqual(got[("Lady Margaret School", "Foundation Band 1")].raw_value, "2.558 miles")
        self.assertEqual(got[("Lady Margaret School", "Open Band 2")].raw_value, "0.487 miles")
        self.assertTrue(got[("Fulham Cross Academy", None)].all_offered)


class IslingtonTests(unittest.TestCase):
    def test_rolling_table_column_of_the_year(self):
        tables = [[["Name of school", "Type of school", "Distance (miles) in 2026-27", "Distance (miles) in 2025-26"],
                   ["Ambler Primary School", "Mixed Community", "0.338", "0.271"],
                   ["Ashmount Primary School", "Mixed Community", "Not applicable", "1.284"]],
                  [["Name of school", "Type of school", "Distance (miles) in 2026-27", "Distance (miles) in 2025-26"],
                   ["Central Foundation Boys' School Band 1", "Boys Voluntary-aided", "1.337", "1.449"],
                   ["St Mary Magdalene Academy (Open)", "Mixed Academy", "0.5", "0.6"]]]
        got = by_school(islington.rolling(tables, "primary", 2026))
        self.assertEqual((got["Ambler Primary School"].raw_value, got["Ashmount Primary School"].raw_value), ("0.338", ""))
        got = by_school(islington.rolling(tables, "secondary", 2025), rule=True)
        self.assertEqual(got[("Central Foundation Boys' School", "Band 1")].raw_value, "1.449")
        self.assertEqual(got[("St Mary Magdalene Academy", "Open places")].raw_value, "0.6")
        with self.assertRaises(ValueError):
            islington.rolling(tables, "primary", 2024)

    def test_brochure_page_title_wins_over_a_copied_heading(self):
        offers = islington.brochure(fixture("islington-primary-2021.txt"))
        self.assertEqual([(o.school, o.raw_value) for o in offers], [("Duncombe Primary School", "")])


class KensingtonChelseaTests(unittest.TestCase):
    def test_bi_borough_file_reads_only_rbkc_schools(self):
        text = fixture("kensington_chelsea-secondary-2023.txt")
        part = text.split("Kensington and Chelsea Secondary Schools", 1)[-1].split("Westminster Secondary Schools", 1)[0]
        got = by_school(kensington_chelsea.standalone(part), rule=True)
        self.assertEqual({school for school, _ in got}, {"Holland Park School"})
        self.assertEqual(got[("Holland Park School", "Band A")].raw_value, "1.091 miles")


class LambethTests(unittest.TestCase):
    def setUp(self):
        self.community, self.blocks, self.secondary = parts("lambeth-2024-2026.txt")

    def test_community_table_sites_and_all_offered(self):
        got = {(o.school, o.site): o for o in lambeth.community_text(self.community)}
        self.assertTrue(got[("Allen Edwards Primary School", "main")].all_offered)
        self.assertEqual(got[("Henry Cavendish Primary School", "balham")].raw_value, "405.63")
        self.assertEqual(got[("Jessop Primary School", "main")].raw_value, "392.87")

    def test_church_and_open_bands_in_a_vah_block(self):
        got = by_school(lambeth.blocks(self.blocks), rule=True)
        self.assertEqual(got[("Archbishop Sumner Church of England Primary School", "Church band")].raw_value, "280.04 metres")
        self.assertEqual(got[("Archbishop Sumner Church of England Primary School", "Open band")].raw_value, "716 metres")

    def test_secondary_banded_table(self):
        got = by_school(lambeth.secondary(self.secondary, 2026, "The Norwood School"), rule=True)
        self.assertEqual(got[("The Norwood School", "Band 1")].raw_value, "1778.07")
        self.assertNotIn(("The Norwood School", "Band Z"), got)
        self.assertEqual(lambeth.school_by_url("https://x/2026-05/the-elmgreen-school-national-offer-day.pdf"),
                         "The Elmgreen School")
        self.assertEqual(lambeth.school_by_url("https://x/The%20Elms%20Academy-National-Offer-Day.pdf"), "The Elms Academy")


class LewishamTests(unittest.TestCase):
    def test_grid_joins_wrapped_names_and_outcomes(self):
        got = by_school(lewisham.grid(fixture("lewisham-secondary-2020.txt")))
        self.assertEqual(got["Deptford Green School"].raw_value, "3681.20")
        self.assertTrue(got["Conisborough College"].all_offered)
        self.assertEqual(got["Sydenham School"].applicants, 742)

    def test_school_tables_page(self):
        page = ("<h3><strong>Deptford Green School</strong></h3><table><tr><td>Total number of applicants</td>"
                "<td>550</td></tr><tr><td>Home-to-school distance of last place offered*</td><td>3129.53metres</td>"
                "</tr></table><h3>Sydenham School</h3><table><tr><td>Total number of applicants</td><td>681</td></tr>"
                "<tr><td>Home-to-school distance of last place offered*</td><td>Contact school</td></tr></table>")
        got = by_school(lewisham.school_tables(page))
        self.assertEqual((got["Deptford Green School"].raw_value, got["Deptford Green School"].applicants), ("3129.53metres", 550))
        self.assertEqual(got["Sydenham School"].raw_value, "")
        self.assertEqual(parse_distance("3129.53metres", "metres")[0], 3130)


class SouthwarkTests(unittest.TestCase):
    def test_table_stops_at_the_stale_rows(self):
        offers = southwark.table(fixture("southwark-primary-2024.txt"), 2024)
        names = [o.school for o in offers]
        self.assertEqual(len(names), len(set(names)))
        self.assertNotIn("Townsend", names)
        got = by_school(offers)
        self.assertEqual(got["Crampton"].raw_value, "630")
        self.assertTrue(got["Albion"].all_offered)
        self.assertEqual(southwark.table(fixture("southwark-primary-2024.txt"), 2023), [])


class TowerHamletsTests(unittest.TestCase):
    def test_heading_blocks_and_bonner_sites(self):
        page = ("<p>How Reception places were offered for Tower Hamlets Schools in 2026</p><h3>Key metrics explained</h3>"
                "<ul><li><strong>Tie-break cut off distance</strong><br />This is the distance</li></ul>"
                "<h3><a id='x'></a>Bonner Mile End</h3><ul><li>Number of applications: 57</li>"
                "<li>Tie-break cut off distance (metres): 551</li><li>Total offered: 30</li></ul>")
        path = temp(page, ".html")
        try:
            offers = tower_hamlets.parse({"year": 2026}, [path], {})
            with self.assertRaises(ValueError):
                tower_hamlets.parse({"year": 2025}, [path], {})
        finally:
            os.unlink(path)
        self.assertEqual([(o.school, o.site, o.raw_value, o.applicants, o.offers) for o in offers],
                         [("Bonner Primary School", "mile-end", "551", 57, 30)])


if __name__ == "__main__":
    unittest.main()
