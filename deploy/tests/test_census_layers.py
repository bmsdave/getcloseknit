"""Census 2021 map layers: shares per LSOA from the People counts, no London rank, neutral legend."""
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import etl_census_layers as cl  # noqa: E402

WEB = (ROOT.parent / "web" / "src" / "lib" / "census-layers.ts").read_text()
WEB_PICKS = (ROOT.parent / "web" / "src" / "lib" / "census-picks.ts").read_text()
LOADER = (ROOT.parent / "pipelines" / "area-analytics-ingest" / "area_analytics" / "census_people.py").read_text()

AGE = {"0-14": 300, "15-24": 100, "25-44": 400, "45-64": 150, "65-plus": 50}


class CensusLayerTests(unittest.TestCase):
    def test_the_metric_ids_match_the_web(self):
        base = re.findall(r'"(census-[a-z0-9-]+)"', WEB.split("] as const;", 1)[0])
        picks = re.findall(r'"(census-[a-z0-9-]+)"', WEB_PICKS.split("] as const;", 1)[0])
        self.assertEqual(sorted(cl.METRIC_IDS), sorted(base + picks))
        self.assertEqual(len(set(cl.METRIC_IDS)), len(cl.METRIC_IDS))
        # 49 and 11 world regions (TS004), then one per detailed category (census_picks.json).
        self.assertEqual(len(base), 49 + 11)
        self.assertEqual(len(picks), sum(len(entry["picks"]) for entry in cl.PICKS))

    def test_the_web_picks_are_the_etl_picks(self):
        # Both files come from area_analytics.census_picks: the same categories, labels and words, in order.
        for entry in cl.PICKS:
            block = WEB_PICKS[WEB_PICKS.index(f'topic: "{entry["topic"]}"'):]
            block = block[:block.index("    ],")]
            self.assertIn(f'geography: "{entry["geography"]}"', block)
            rows = re.findall(r'^\s+\[("[^"]*"), ("[^"]*"), ("[^"]*"), [0-9.]+\],$', block, re.M)
            self.assertEqual([tuple(json.loads(cell) for cell in row) for row in rows],
                             [(pick["category"], pick["label"], pick["words"]) for pick in entry["picks"]], entry["topic"])

    def test_every_category_is_one_the_loader_writes(self):
        for topic, _, views in cl.LAYERS:
            if topic in [entry["topic"] for entry in cl.PICKS]:
                continue  # every leaf of a detailed table, named from its csv header
            for metric, _, categories in views:
                for category in categories:
                    self.assertRegex(LOADER, rf'"{re.escape(category)}"', f"{metric}: {category}")
        # Within a topic, no category counts twice: once in the groups (and once more in the detailed layers).
        for topic, _, views in cl.LAYERS:
            members = [category for metric, _, categories in views if metric not in cl.ETHNIC_DETAIL_IDS
                       for category in categories]
            self.assertEqual(len(members), len(set(members)), topic)

    def test_ethnicity_has_the_five_groups_and_every_detailed_category(self):
        groups = [metric for metric, _, _ in cl.LAYERS[0][2] if metric not in cl.ETHNIC_DETAIL_IDS]
        self.assertEqual(groups, ["census-ethnicity-asian", "census-ethnicity-black", "census-ethnicity-mixed",
                                  "census-ethnicity-white", "census-ethnicity-other"])
        detail = [views for metric, _, views in cl.LAYERS[0][2] if metric in cl.ETHNIC_DETAIL_IDS]
        self.assertEqual(len(detail), 19)
        self.assertTrue(all(len(categories) == 1 for categories in detail))
        loader = re.search(r'Topic\("ethnicity".*?\)\),', LOADER, re.S).group(0)
        self.assertEqual(sorted(c for (c,) in detail), sorted(re.findall(r'_one\("([a-z-]+)"', loader)))
        self.assertIn("census-ethnicity-indian", cl.ETHNIC_DETAIL_IDS)
        shares = cl.topic_shares("ethnicity", {"indian": 30, "pakistani": 10, "white-british": 60})
        self.assertEqual(shares["census-ethnicity-indian"], 30.0)
        self.assertEqual(shares["census-ethnicity-asian"], 40.0)
        self.assertEqual(shares["census-ethnicity-roma"], 0.0)
        self.assertEqual(cl.legend_title("census-ethnicity-indian"), "% of residents, Indian (Census 2021)")
        definition = cl.definition("census-ethnicity-other-white", [1.0, 2.0])
        self.assertEqual(definition["label"], "Ethnic makeup: Other White")
        self.assertIn("Open Government Licence v3.0", " ".join(definition["caveats"]))
        self.assertIn("never ranked", definition["description"])

    def test_country_of_birth_has_eleven_regions_and_msoa_countries(self):
        regions = next(views for topic, _, views in cl.LAYERS if topic == "country-of-birth")
        self.assertEqual([metric for metric, _, _ in regions], [
            "census-birth-uk", "census-birth-eu14", "census-birth-eu8", "census-birth-eu2", "census-birth-other-eu",
            "census-birth-other-europe", "census-birth-africa", "census-birth-middle-east-asia",
            "census-birth-americas-caribbean", "census-birth-oceania-other", "census-birth-british-overseas"])
        loader = re.search(r'Topic\("country-of-birth",.*?(?=\n    Topic\(|\n\)\n)', LOADER, re.S).group(0)
        self.assertEqual([c for _, _, (c,) in regions], re.findall(r'^\s+(?:_one\(|\()"([a-z0-9-]+)", "', loader, re.M))
        countries = {metric: words for metric, words, _ in
                     next(views for topic, _, views in cl.LAYERS if topic == "country-of-birth-extended")}
        self.assertEqual(countries["census-birth-country-japan"], "born in Japan")
        self.assertIn("census-birth-country-korea-south", countries)
        self.assertIn("census-birth-country-poland", countries)
        self.assertIn("census-birth-country-japan", cl.MSOA_METRIC_IDS)
        self.assertNotIn("census-birth-eu8", cl.MSOA_METRIC_IDS)
        self.assertEqual(cl.legend_title("census-birth-eu8"), "% of residents, born in a country that joined the EU in 2004 (Poland, Lithuania, Latvia, Estonia, Czechia, Slovakia, Hungary, Slovenia) (Census 2021)")

    def test_detailed_tables_are_published_at_the_finest_geography_ons_offers(self):
        geography = {entry["topic"]: (entry["table"], entry["geography"]) for entry in cl.PICKS}
        self.assertEqual(geography, {
            "ethnicity-detailed": ("TS022", "msoa"), "country-of-birth-extended": ("COB190", "msoa"),
            "religion-detailed": ("TS031", "msoa"), "year-of-arrival": ("TS015", "lsoa"),
            "main-language": ("LANG26", "lsoa"), "passports": ("TS013", "msoa"),
            "national-identity": ("TS028", "msoa")})
        ethnic = {metric: words for metric, words, _ in next(v for t, _, v in cl.LAYERS if t == "ethnicity-detailed")}
        self.assertEqual(ethnic["census-ethnic-asian-japanese"], "Asian: Japanese")
        self.assertEqual(ethnic["census-ethnic-asian-korean"], "Asian: Korean")
        # A write-in recurring under another broad group is its own layer.
        self.assertEqual(ethnic["census-ethnic-other-japanese"], "Other: Japanese")
        beliefs = [metric for metric, _, _ in next(v for t, _, v in cl.LAYERS if t == "religion-detailed")]
        self.assertIn("census-belief-atheist", beliefs)
        self.assertNotIn("census-belief-christian", beliefs)  # TS030's layer per LSOA already

    def test_an_msoa_figure_paints_each_lsoa_with_its_msoas_share(self):
        # Two LSOAs of one MSOA carry its counts: the same share, marked as a wider-area figure.
        msoa = {"asian-japanese": 40, "asian-korean": 10, "white-polish": 950}
        counts = {"uk:lsoa:E01000001": {"ethnicity-detailed": msoa}, "uk:lsoa:E01000002": {"ethnicity-detailed": msoa}}
        rows = [row for row in cl.value_rows(counts) if row[1] == "census-ethnic-asian-japanese"]
        self.assertEqual(rows, [
            ["uk:lsoa:E01000001", "census-ethnic-asian-japanese", "2021-03-01", 4.0, "", 1000, "fallback"],
            ["uk:lsoa:E01000002", "census-ethnic-asian-japanese", "2021-03-01", 4.0, "", 1000, "fallback"],
        ])
        region = [row for row in cl.value_rows({"uk:lsoa:E01000001": {"country-of-birth": {"uk": 3, "eu8": 1}}})
                  if row[1] == "census-birth-eu8"]
        self.assertEqual(region, [["uk:lsoa:E01000001", "census-birth-eu8", "2021-03-01", 25.0, "", 4, "observed"]])
        language = [row for row in cl.value_rows({"uk:lsoa:E01000001": {"main-language": {"polish": 1, "french": 3}}})
                    if row[1] == "census-language-polish"]
        self.assertEqual(language, [["uk:lsoa:E01000001", "census-language-polish", "2021-03-01", 25.0, "", 4, "observed"]])
        self.assertIn("JOIN area_census_count c ON c.geography_id = l.parent_id", cl.MSOA_COUNTS_SQL)

    def test_an_msoa_figure_says_so_and_never_street_detail(self):
        self.assertEqual(cl.legend_title("census-birth-country-japan"),
                         "% of residents, born in Japan (Census 2021, MSOA figures)")
        definition = cl.definition("census-ethnic-asian-korean", [0.0, 1.0])
        self.assertEqual(definition["label"], "Ethnic makeup: Korean (Asian) (MSOA figures)")
        text = " ".join([definition["description"], *definition["caveats"]])
        for words in ("MSOA figures: each MSOA is one colour", "TS022", "Open Government Licence v3.0", "never ranked",
                      "broad group named in brackets"):
            self.assertIn(words, text)
        self.assertNotRegex(text.lower(), r"\b(best|worst|top|street)\b")
        self.assertEqual(cl.definition("census-passport-japan", [1.0])["label"], "Passports held: Japan (MSOA figures)")
        language = cl.definition("census-language-polish", [1.0])
        self.assertEqual(language["label"], "Main language: Polish")
        self.assertEqual(cl.legend_title("census-language-polish"),
                         "% of residents aged 3+, main language Polish (Census 2021)")
        self.assertNotIn("MSOA figures", " ".join([language["description"], *language["caveats"]]))
        region = cl.definition("census-birth-uk", [50.0])
        self.assertEqual(region["label"], "Country of birth: UK")
        self.assertIn("TS004", region["description"])

    def test_share_is_a_percentage_of_the_topic_total(self):
        shares = cl.topic_shares("age", AGE)
        self.assertEqual(shares["census-age-0-14"], 30.0)
        self.assertEqual(shares["census-age-65-plus"], 5.0)
        self.assertAlmostEqual(sum(shares.values()), 100.0)
        # Religion: "chose not to answer" stays in the total but has no layer.
        religion = cl.topic_shares("religion", {"christian": 50, "no-religion": 30, "not-answered": 20})
        self.assertEqual(religion["census-religion-christian"], 50.0)
        self.assertEqual(religion["census-religion-jewish"], 0.0)
        # No count, or a zero total: no share.
        self.assertEqual(cl.topic_shares("age", {}), {})

    def test_rows_carry_no_london_rank(self):
        counts = {"uk:lsoa:E01000002": {"age": AGE}, "uk:lsoa:E01000001": {}}
        rows = cl.value_rows(counts, "2021-03-01")
        first = [row for row in rows if row[1] == "census-age-0-14"]
        self.assertEqual(first, [
            ["uk:lsoa:E01000001", "census-age-0-14", "2021-03-01", "", "", "", "suppressed"],
            ["uk:lsoa:E01000002", "census-age-0-14", "2021-03-01", 30.0, "", 1000, "observed"],
        ])
        self.assertEqual(len(rows), 2 * len(cl.METRIC_IDS))

    def test_legend_steps_at_the_spread_of_lsoa_shares(self):
        stops = cl.legend([float(v) for v in range(0, 101)])
        self.assertEqual([stop["value"] for stop in stops], [10, 30, 50, 70, 90])
        self.assertEqual(stops[-1]["label"], "90%+")
        self.assertEqual(cl.legend([0.5, 1.0, 1.5, 2.0, 2.5])[0]["label"], "0.5%")
        # Rare categories: many areas at 0%, so steps that coincide are kept once (the map needs rising stops).
        rare = cl.legend([0.0] * 60 + [1.0] * 20 + [2.0] * 20)
        self.assertEqual([stop["value"] for stop in rare], [0, 1, 2])
        # A country almost nobody in London was born in: every area at 0%, still a two-step legend.
        empty = cl.legend([0.0] * 100)
        self.assertEqual([(stop["value"], stop["label"]) for stop in empty], [(0, "0%"), (0.1, "0.1%+")])
        self.assertEqual(cl.legend([]), [])

    def test_definition_is_factual_with_source_and_licence(self):
        definition = cl.definition("census-religion-none", [10.0, 20.0, 30.0])
        self.assertEqual(definition["label"], "Religion: No religion")
        self.assertEqual(cl.legend_title("census-religion-none"), "% of residents, no religion (Census 2021)")
        self.assertTrue(definition["description"].startswith(cl.legend_title("census-religion-none")))
        self.assertEqual(definition["methodologyPath"], "/guide/people-and-homes")
        self.assertEqual(definition["freshness"], "2021-03")
        text = " ".join([definition["description"], *definition["caveats"]])
        self.assertIn("Open Government Licence v3.0", text)
        self.assertIn("never ranked", text)
        self.assertNotRegex(text.lower(), r"\b(best|worst|top)\b")
        self.assertEqual(cl.legend_title("census-tenure-owned"), "% of households, owned (outright, mortgage or shared) (Census 2021)")


if __name__ == "__main__":
    unittest.main()
