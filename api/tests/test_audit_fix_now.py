"""Audit 2026-10 fix-now batch: issues #227 #231 #235 #237 #244 #245 (one regression test each)."""
import json
import unittest
from urllib.parse import urlsplit

from area_api import evidence, market_depth, share_links
from tests.test_home_search import StubReader, _match_rows
from tests.test_production_evidence import _school_row, make_reader, seed_production_fixture

try:
    from area_api import home_search, tools
except ImportError:  # pragma: no cover
    tools = None

LSOA = "uk:lsoa:E01000004"


@unittest.skipIf(tools is None, "pydantic is not installed")
class FixNowTests(unittest.TestCase):
    def setUp(self):
        tools.clear_catalogue_cache()
        self.connection = seed_production_fixture()
        self.reader = make_reader(self.connection)
        self.context = tools.ToolContext(reader=StubReader(), load_match_rows=_match_rows,
                                         load_zone_lsoas=lambda zones: None)

    def test_227_school_count_is_not_capped_by_the_nearest_list_limit(self):
        self.connection.area_schools[LSOA] = [
            _school_row(str(100000 + i), f"School {i}", "Primary" if i % 3 else "Secondary", 100 + i, "Good")
            for i in range(45)]
        self.connection.school_counts[LSOA] = (40, 16)

        schools = self.reader.get_area_pack(LSOA)["schools"]

        self.assertEqual((schools["count"], schools["primary"], schools["secondary"]), (56, 40, 16))
        self.assertEqual(len(schools["nearest"]), market_depth.PACK_SCHOOL_LIMIT)

    def test_231_old_links_with_retired_factors_open_like_the_site(self):
        # crime, income (retired), schools; one office; one note: the v1 link from the issue.
        link = ("https://getcloseknit.com/#profile=v1.WzAsNTAwMDAwLDY1MDAwMCwyLDEsW1szLDQsMSxudWxsLG51bGxdLFs1LDMsMCxudWxsLG51bGxdLFs4"
                "LDUsMCxudWxsLG51bGxdXSxbWyJvIiwiT2ZmaWNlIiw1MS41MTU1LC0wLjE0MTUsMCwiMDk6MDAiLDM1LDRdXSxbWyJwcmltYXJ5Il0sW10sW10sW10s"
                "M10sMCxbXSx7Im4iOltbInVrOmxzb2E6RTAxMDA0MjMwIiwibmljZSBwYXJrIl1dfV0")
        profile = share_links.profile_from_link(link)
        self.assertEqual([f["factorId"] for f in profile["factors"]], ["crime", "schools"])
        self.assertEqual(profile["droppedFactors"], ["income"])

        out = tools.call_tool("open_shared_search", self.context, {"link": link, "top_n": 1})
        self.assertNotIn("droppedFactors", out["value"]["profile"])
        self.assertTrue(any("income" in caveat for caveat in out["caveats"]))

    def test_231_v3_market_and_enum_indexes_decode_as_the_site_does(self):
        # {"m":0,...,"c":[["b",0],["p","w","Work",[0,51.5155,-0.1415],-1,30,null,0,null]]}: mode index -1.
        negative = ("https://getcloseknit.com/#profile=v3.eyJtIjowLCJ0Ijo0MDAwMDAsIngiOjQ1MDAwMCwiYiI6MiwiYyI6W1siYiIsMF0sWyJwIiwidyIs"
                    "IldvcmsiLFswLDUxLjUxNTUsLTAuMTQxNV0sLTEsMzAsbnVsbCwwLG51bGxdXX0")
        with self.assertRaises(ValueError):
            share_links.profile_from_link(negative)
        rent = share_links.encode_profile({"schemaVersion": "preference-profile.v2", "market": "rent", "targetBudget": 2000,
                                           "maximumBudget": 2500, "criteria": [{"kind": "budget", "priority": 0}]})
        value = share_links.decode_profile(rent)
        value["m"] = 7  # anything but 1 is "buy" on the site (profile-v2.ts: m === 1 ? rent : buy)
        link = "https://x/" + share_links.V2_PROFILE_PREFIX + share_links._base64url(json.dumps(value, separators=(",", ":")))
        self.assertEqual(share_links.profile_from_link(link)["market"], "buy")

    def test_235_metric_evidence_rows_are_the_months_before_the_period(self):
        context = tools.ToolContext(reader=evidence.EvidenceReader(connect=lambda: self.connection))
        out = tools.call_tool("get_area_metric", context, {"area_id": LSOA, "metric_id": "crime", "period": "2025-08"})

        periods = [row["period"] for row in out["evidence"]]
        self.assertEqual(periods[0], "2025-08")
        self.assertTrue(all(period <= "2025-08" for period in periods), periods)
        self.assertIn("2025-07", periods)

    def test_237_questions_follow_what_the_listing_already_says(self):
        given = home_search.listing_questions(home_search.AssessListingInput(
            postcode="W5 5PT", asking_price=1_370_000, bedrooms=4, floor_area_sqm=188.3, tenure="freehold"),
            {"conservation": {"share": 0.39, "presence": "partly", "areas": [{"name": "Ealing Green", "share": 0.36}]}})
        self.assertFalse(any("floor area" in q for q in given))
        self.assertTrue(any("Ealing Green" in q and "Article 4" in q for q in given))

        bare = home_search.listing_questions(home_search.AssessListingInput(postcode="W5 5PT", asking_price=500_000))
        self.assertTrue(any("floor area" in q for q in bare))
        self.assertTrue(any("bedrooms" in q for q in bare))
        self.assertFalse(any("Article 4" in q for q in bare))

        rent = home_search.listing_questions(home_search.AssessListingInput(
            postcode="N1 0NT", asking_price=2350, bedrooms=1, market="rent"))
        self.assertFalse(any("minimum term" in q for q in rent))
        self.assertTrue(any("one month" in q for q in rent))

    def test_244_presets_carry_the_map_link_the_description_promises(self):
        out = tools.call_tool("list_custom_presets", self.context, {})
        for preset in out["value"]:
            self.assertEqual(urlsplit(preset["mapUrl"]).query, f"layer=custom:{preset['id']}")
        description = tools.TOOLS["list_custom_presets"].description
        self.assertNotIn("slug", description)
        self.assertIn("mapUrl", description)

    def test_245_borough_overview_says_its_point_blocks_are_around_the_centre(self):
        borough = tools.call_tool("get_area_overview", self.context, {"area_id": "uk:lad:E09000028"})
        lsoa = tools.call_tool("get_area_overview", self.context, {"area_id": "uk:lsoa:E01000001"})

        self.assertTrue(any("centre point" in c and "pick an LSOA" in c for c in borough["caveats"]), borough["caveats"])
        self.assertFalse(any("pick an LSOA" in c for c in lsoa["caveats"]))
        health = next(c for c in borough["caveats"] if c.startswith("health:"))
        self.assertIn("inside the area", health)


if __name__ == "__main__":
    unittest.main()
