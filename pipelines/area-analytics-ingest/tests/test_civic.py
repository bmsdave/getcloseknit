"""Civic geography, council tax and representatives (track J): pure parsing rules."""

import os
import tempfile
import unittest
import zipfile
from decimal import Decimal

from area_analytics import civic, coverage

HEADER = ("pcds,dointr,doterm,ctry26cd,rgn26cd,lad26cd,wd26cd,parncp26cd,pcon24cd,pfa23cd,"
          "msoa21cd,lsoa21cd\n")


def onspd(*lines: str) -> list[dict]:
    return list(civic.onspd_rows([HEADER, *(line + "\n" for line in lines)]))


class OnspdTests(unittest.TestCase):
    def test_keeps_london_postcodes_with_month_dates(self):
        rows = onspd(
            "SW1A 1AA,198001,,E92000001,E12000007,E09000033,E05013806,E04013089,E14001172,E23000001,"
            "E02000977,E01004736",
            "AB1 0AA,198001,199606,S92000003,S99999999,S12000033,S13002843,,S14000002,S32000004,,")
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["postcode"], "SW1A 1AA")
        self.assertEqual(row["introduced"], "1980-01-01")
        self.assertIsNone(row["terminated"])
        self.assertEqual(row["ward_code"], "E05013806")
        self.assertEqual(row["constituency_code"], "E14001172")

    def test_the_coverage_picks_the_regions_kept(self):
        lines = [HEADER,
                 "SW1A 1AA,198001,,E92000001,E12000007,E09000033,E05013806,,E14001172,E23000001,E02000977,E01004736\n",
                 "M1 1AD,198001,,E92000001,E12000002,E08000003,E05011368,,E14001356,E23000005,E02006917,E01033664\n",
                 "CF10 1AA,198001,,W92000004,W99999999,W06000015,W05001300,,W07000080,W15000003,W02000398,W01001939\n"]
        england = [row["postcode"] for row in civic.onspd_rows(lines, coverage.ENGLAND)]
        london = [row["postcode"] for row in civic.onspd_rows(lines, coverage.LONDON)]
        self.assertEqual(england, ["SW1A 1AA", "M1 1AD"])
        self.assertEqual(london, ["SW1A 1AA"])

    def test_terminated_postcodes_keep_their_end_month_and_pseudo_codes_become_null(self):
        row = onspd("EC1A 9ZZ,200203,201911,E92000001,E12000007,E09000001,E99999999,,E14001290,"
                    "E23000034,E02000001,E01000001")[0]
        self.assertEqual(row["terminated"], "2019-11-01")
        self.assertIsNone(row["ward_code"])
        self.assertIsNone(row["parish_code"])

    def test_month_start_rejects_blank_and_malformed_values(self):
        self.assertIsNone(civic.month_start(""))
        self.assertIsNone(civic.month_start("2019"))
        self.assertEqual(civic.month_start("202608"), "2026-08-01")


class NameFileTests(unittest.TestCase):
    def test_name_files_map_to_kinds_and_skip_scottish_and_old_vintages(self):
        self.assertEqual(civic.name_kind("Documents/WD Ward names and codes UK as at 05_26.csv"), "ward")
        self.assertEqual(civic.name_kind("Documents/LSOA (2021) names and codes EW as at 12_21.csv"), "lsoa")
        self.assertIsNone(civic.name_kind("Documents/LSOA (2011) names and codes UK as at 12_12.csv"))
        self.assertIsNone(civic.name_kind("Documents/MSOA (2021) IZ names and codes SC as at 12_24.csv"))
        self.assertIsNone(civic.name_kind("Documents/WD Ward names and codes UK as at 05_26.xlsx"))

    def test_name_rows_keep_only_wanted_codes(self):
        lines = ["WD26CD,WD26NM,WD26NMW\n", "E05013806,St James's,\n", "E05000954,Bebington,\n"]
        self.assertEqual(list(civic.name_rows(lines, "ward", {"E05013806"})),
                         [("E05013806", "ward", "St James's")])


class CouncilTaxTests(unittest.TestCase):
    def test_bands_follow_the_statutory_ratios(self):
        bands = civic.bands(Decimal("1800.00"))
        self.assertEqual(bands["A"], Decimal("1200.00"))
        self.assertEqual(bands["D"], Decimal("1800.00"))
        self.assertEqual(bands["H"], Decimal("3600.00"))
        self.assertEqual(civic.bands(Decimal("2207.55"))["E"], Decimal("2698.12"))

    def table(self):
        major = "16. Average council tax of major precepting authorities in the billing authority's area"
        header = ["E-code", "ONS Code", "Authority", "Region", "Class",
                  "8. Average (Band D 2 Adult equivalent) council tax (including local precepts) (current year)",
                  "9. Average (Band D 2 Adult equivalent) council tax (excluding local precepts)   (previous year)",
                  "9. Average (Band D 2 Adult equivalent) council tax (excluding local precepts)   (current year)",
                  f"{major} (county or GLA)", f"{major} (police)", f"{major} (fire)", f"{major} (combined authority)",
                  "17. Average (Band D 2 adult equivalent) council tax for area of the billing authority"]
        return [["Council tax"], header,
                ["E5011", "E09000007", "Camden", "L", "ILB", "1697.04", "1616.31", "1697.04", "510.51", "0", "0", "0",
                 "2207.55"],
                ["E0533", "E07000008", "Cambridge", "E", "SD", "239.07", "230", "239.07", "1785.42", "314.37", "92.16",
                 "36", "2467.02"],
                ["E4703", "E08000035", "Leeds", "YH", "MD", "1915.96", "1800", "1903.74", "0", "278.28", "89.49", "0",
                 "2283.73"],
                ["E5012", "E09000099", "Broken", "L", "ILB", "", "", "", "", "", "", "", "[z]"],
                ["E6001", "W06000015", "Cardiff", "W", "UA", "", "", "", "", "", "", "", "2000"]]

    def test_london_keeps_the_gla_column_and_no_precepts(self):
        rows = civic.council_tax_rows(self.table(), coverage.LONDON)
        self.assertEqual([row["borough_code"] for row in rows], ["E09000007"])
        camden = rows[0]
        self.assertEqual(camden["band_d"], Decimal("2207.55"))
        self.assertEqual(camden["band_d_borough"], Decimal("1697.04"))
        self.assertEqual(camden["band_d_gla"], Decimal("510.51"))
        self.assertEqual(camden["band_a"], Decimal("1471.70"))
        self.assertEqual(camden["financial_year"], "2026-27")
        for column in ("band_d_county", "band_d_police", "band_d_fire", "band_d_combined_authority", "band_d_parish"):
            self.assertIsNone(camden[column], column)

    def test_england_splits_two_tier_and_metropolitan_bills(self):
        rows = {row["borough_code"]: row for row in civic.council_tax_rows(self.table(), coverage.ENGLAND)}
        self.assertEqual(sorted(rows), ["E07000008", "E08000035", "E09000007"])
        cambridge, leeds = rows["E07000008"], rows["E08000035"]
        self.assertIsNone(cambridge["band_d_gla"])
        self.assertEqual((cambridge["band_d_borough"], cambridge["band_d_county"], cambridge["band_d_police"],
                          cambridge["band_d_fire"], cambridge["band_d_combined_authority"], cambridge["band_d_parish"]),
                         (Decimal("239.07"), Decimal("1785.42"), Decimal("314.37"), Decimal("92.16"), Decimal("36.00"),
                          None))
        self.assertEqual(cambridge["band_d"], Decimal("2467.02"))
        self.assertIsNone(leeds["band_d_county"])
        self.assertEqual(leeds["band_d_parish"], Decimal("12.22"))
        parts = sum(leeds[c] or 0 for c in ("band_d_borough", "band_d_police", "band_d_fire", "band_d_parish"))
        self.assertEqual(parts, leeds["band_d"])

    def test_ods_sheet_reads_numeric_values_and_repeated_cells(self):
        content = (
            '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
            'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
            'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet>'
            '<table:table table:name="Data_Billing"><table:table-row>'
            '<table:table-cell><text:p>Camden</text:p></table:table-cell>'
            '<table:table-cell table:number-columns-repeated="2"/>'
            '<table:table-cell office:value-type="float" office:value="2207.5500000000002">'
            '<text:p>2,207.55</text:p></table:table-cell>'
            '</table:table-row></table:table></office:spreadsheet></office:body></office:document-content>')
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "t.ods")
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("content.xml", content)
            self.assertEqual(civic.ods_sheet(path, "Data_Billing"), [["Camden", "", "", "2207.5500000000002"]])
            with self.assertRaises(ValueError):
                civic.ods_sheet(path, "Missing")


def ballot(ward: str, date: str, *people, cancelled=False, by=False):
    """people: (name, party, elected) or (name, party, elected, votes)."""
    return {"ballot_paper_id": f"local.x.ward{'.by' if by else ''}.{date}", "post": {"id": f"gss:{ward}"},
            "cancelled": cancelled,
            "candidacies": [{"elected": person[2], "party_name": person[1], "person": {"id": index, "name": person[0]},
                             "result": {"num_ballots": person[3] if len(person) > 3 else None}}
                            for index, person in enumerate(people)]}


def names(ballots):
    return sorted(candidacy["person"]["name"] for _, candidacy in civic.current_councillors(ballots))


class RepresentativeTests(unittest.TestCase):
    def test_councillors_are_the_elected_candidates_of_london_wards(self):
        people = civic.councillors([
            ballot("E05013652", "2026-05-07", ("Ann Example", "Labour Party", True), ("Bob Loser", "Green", False)),
            ballot("E05099999", "2026-05-07", ("Elsewhere", "Labour Party", True)),
        ], {"E05013652"})
        self.assertEqual([(p["name"], p["party"], p["elected_on"]) for p in people],
                         [("Ann Example", "Labour Party", "2026-05-07")])
        self.assertTrue(people[0]["profile_url"].startswith("https://candidates.democracyclub.org.uk/person/"))

    def test_uncontested_ballots_count_even_though_the_poll_was_cancelled(self):
        people = civic.councillors([ballot("E05009289", "2025-03-20", ("Cat Example", "Independent", True),
                                           cancelled=True)], {"E05009289"})
        self.assertEqual(len(people), 1)

    def test_by_election_winners_are_added_with_their_own_date(self):
        people = civic.councillors([
            ballot("E05013652", "2026-05-07", ("Ann Example", "Labour Party", True)),
            ballot("E05013652", "2026-07-02", ("Dee Example", "Reform UK", True), by=True),
        ], {"E05013652"})
        self.assertEqual({p["elected_on"] for p in people}, {"2026-05-07", "2026-07-02"})

    def test_all_out_councils_keep_only_the_latest_election(self):
        ward = "E05000001"
        self.assertEqual(names([
            ballot(ward, "2022-05-05", ("Old A", "X", True), ("Old B", "X", True)),
            ballot(ward, "2026-05-07", ("New A", "Y", True), ("New B", "Y", True), ("Lost", "Z", False)),
        ]), ["New A", "New B"])

    def test_councils_by_thirds_keep_the_last_three_elections(self):
        ward = "E05000002"
        self.assertEqual(names([
            ballot(ward, "2022-05-05", ("Gone", "X", True)),
            ballot(ward, "2023-05-04", ("Third", "X", True)),
            ballot(ward, "2024-05-02", ("Second", "Y", True)),
            ballot(ward, "2026-05-07", ("First", "Z", True)),
        ]), ["First", "Second", "Third"])

    def test_an_all_out_election_then_thirds_drops_its_shortest_terms(self):
        ward = "E05000003"
        self.assertEqual(names([
            ballot(ward, "2021-05-06", ("Gone", "X", True)),
            ballot(ward, "2024-05-02", ("Top", "X", True, 900), ("Middle", "X", True, 800), ("Bottom", "Y", True, 700)),
            ballot(ward, "2026-05-07", ("Newest", "Z", True, 600)),
            ballot(ward, "2026-09-10", ("By", "Z", True, 500), by=True),
        ]), ["By", "Middle", "Newest", "Top"])

    def test_aldermen_never_replace_common_councilmen(self):
        ward = "E05009299"
        common = ballot(ward, "2025-03-20", ("Ann", "Independent", True), ("Bob", "Independent", True))
        alder = {**ballot(ward, "2026-02-05", ("Bob", "Independent", True)),
                 "ballot_paper_id": "local.city-of-london-alder.coleman-street.2026-02-05"}
        common["ballot_paper_id"] = "local.city-of-london.coleman-street.2025-03-20"
        people = civic.councillors([common, alder], {ward})
        self.assertEqual([(p["name"], p["elected_on"]) for p in people], [("Ann", "2025-03-20"), ("Bob", "2026-02-05")])

    def test_a_ward_with_only_a_by_election_lists_its_winner(self):
        self.assertEqual(names([ballot("E05000004", "2025-11-20", ("Only", "X", True), by=True)]), ["Only"])

    def test_slim_ballot_keeps_winners_and_votes(self):
        full = {"ballot_paper_id": "local.x.ward.2026-05-07", "post": {"id": "gss:E05000005", "label": "Ward"},
                "winner_count": 1, "cancelled": False, "sopn": {"big": True},
                "candidacies": [{"elected": True, "party_name": "Labour Party", "person": {"id": 7, "name": "Ann",
                                                                                          "url": "u"},
                                 "result": {"elected": True, "num_ballots": 458}},
                                {"elected": False, "party_name": "Green", "person": {"id": 8, "name": "Bob"}}]}
        self.assertEqual(civic.slim_ballot(full), {
            "ballot_paper_id": "local.x.ward.2026-05-07", "post": {"id": "gss:E05000005"}, "winner_count": 1,
            "cancelled": False, "candidacies": [{"elected": True, "party_name": "Labour Party",
                                                 "person": {"id": 7, "name": "Ann"}, "result": {"num_ballots": 458}}]})

    def test_mps_match_constituencies_by_name_ignoring_ampersands_and_case(self):
        member = {"id": 172, "nameDisplayAs": "Ms Example MP", "latestParty": {"name": "Labour"},
                  "latestHouseMembership": {"membershipFrom": "Hackney North & Stoke Newington",
                                            "membershipStartDate": "1987-06-11T00:00:00",
                                            "membershipEndDate": None}}
        ended = {**member, "id": 9, "latestHouseMembership": {**member["latestHouseMembership"],
                                                              "membershipEndDate": "2024-05-30T00:00:00"}}
        people = civic.mps([member, ended], {"E14001276": "Hackney North and Stoke Newington",
                                             "E14001290": "Holborn and St Pancras"})
        self.assertEqual(len(people), 1)
        self.assertEqual(people[0]["area_code"], "E14001276")
        self.assertEqual(people[0]["elected_on"], "1987-06-11")
        self.assertEqual(people[0]["profile_url"], "https://members.parliament.uk/member/172/contact")


class SourceReleaseTests(unittest.TestCase):
    def test_each_source_carries_its_licence_and_attribution(self):
        releases = civic.source_releases({
            "onspdSha256": "a", "councilTaxSha256": "b", "democracyClubSha256": "c", "parliamentSha256": "d",
            "democracyClubFetchedOn": "2026-10-05", "parliamentFetchedOn": "2026-10-05"})
        by_id = {release[0]: release for release in releases}
        self.assertEqual(by_id["src-onspd-2026-08"][4], "OGL-3.0")
        self.assertIn("Royal Mail", by_id["src-onspd-2026-08"][5])
        self.assertIn("OS data", by_id["src-onspd-2026-08"][5])
        self.assertEqual(by_id["src-democracy-club-2026-10-05"][4], "CC-BY-4.0")
        self.assertEqual(by_id["src-uk-parliament-members-2026-10-05"][4], "OPL-3.0")
        self.assertEqual(by_id["src-mhclg-council-tax-2026-27-england"][4], "OGL-3.0")


if __name__ == "__main__":
    unittest.main()
