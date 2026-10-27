"""share_links.encode_profile must produce the site's #profile= fragment byte for byte."""
import json
import os
import unittest
from pathlib import Path
from unittest import mock

from area_api import share_links

FIXTURE = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "agent-share-links.json"


class ShareLinkTests(unittest.TestCase):
    def test_profile_fragments_match_the_web_encoder(self):
        for case in json.loads(FIXTURE.read_text())["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(share_links.encode_profile(case["profile"]), case["fragment"])

    def test_v2_profiles_travel_as_v3_links(self):
        # v4 Task 21: the ordered criteria (preference-profile.v2) in a #profile=v3. link, byte for byte as
        # encodeProfileLinkV3 in web/src/lib/profile-link.ts writes it.
        for case in json.loads(FIXTURE.read_text())["v2Cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(share_links.encode_profile(case["profile"]), case["fragment"])
                self.assertEqual(share_links.profile_from_link("https://example.org/?layer=personal-match" + case["fragment"]),
                                 case["profile"])
        with self.assertRaises(ValueError):
            share_links.profile_from_link("https://example.org/#profile=v3.eyJtIjowfQ")  # no budget, no criteria

    def test_integral_floats_encode_like_javascript(self):
        case = json.loads(FIXTURE.read_text())["cases"][1]
        profile = {**case["profile"], "targetBudget": 2200.0, "maximumBudget": 2500.0}
        self.assertEqual(share_links.encode_profile(profile), case["fragment"])

    def test_brief_fragments_match_the_web_encoder(self):
        for case in json.loads(FIXTURE.read_text())["briefs"]:
            with self.subTest(case["name"]):
                self.assertEqual(share_links.encode_brief(case["brief"]), case["fragment"])

    def test_brief_url_keeps_criteria_in_canonical_order(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_SITE_URL": "https://areas.example.org"}):
            url = share_links.brief_url(["uk:lsoa:E01000951"], (None, 2500), "rent", 1, "flat", ["station", "nope"])
        case = json.loads(FIXTURE.read_text())["briefs"][1]
        self.assertEqual(url, "https://areas.example.org/brief" + case["fragment"])

    def test_links_decode_to_the_same_profile_the_site_reads(self):
        for case in json.loads(FIXTURE.read_text())["cases"]:
            with self.subTest(case["name"]):
                link = "https://areas.example.org/?layer=personal-match" + case["fragment"]
                self.assertEqual(share_links.profile_from_link(link), case["profile"])
        for bad in ("https://areas.example.org/", "https://x/#profile=v1.@@@", "https://x/#brief=v1.abc"):
            with self.subTest(bad):
                with self.assertRaises(ValueError):
                    share_links.profile_from_link(bad)

    def test_compact_site_links_read_like_v1(self):
        # Written by encodeShareLink(exampleProfile(), ["uk:lsoa:E01000002"]) in web/src/lib/profile-state.ts.
        link = ("https://areas.example.org/?layer=personal-match#profile=v2.WzAsNDgwMDAwLDYwMDAwMCwyLDEsW1swLDMsMl0sWzMsMywxXV0s"
                "W10sMCwwLFtdLHsicCI6W1sia2luZ3MtY3Jvc3MiLCJLaW5nJ3MgQ3Jvc3MiLDAsNTEuNTMwNiwtMC4xMjM5LDIsMzAsNCwwXV19XQ&compare=E01000002")
        profile = share_links.profile_from_link(link)
        self.assertEqual(profile["maximumBudget"], 600000)
        self.assertEqual([(f["factorId"], f["weight"], f["minimumUtility"]) for f in profile["factors"]],
                         [("affordability", 3, None), ("crime", 3, None)])
        self.assertEqual(profile["school"], share_links.DEFAULT_SCHOOL)
        self.assertEqual(profile["places"][0]["label"], "King's Cross")

    def test_links_use_the_site_origin(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_SITE_URL": "https://areas.example.org/"}):
            links = share_links.area_links("uk:lsoa:E01000951")
            self.assertEqual(links["area"], "https://areas.example.org/area/lsoa/E01000951")
            self.assertEqual(links["evidencePack"], "https://areas.example.org/area/lsoa/E01000951/pack")
            self.assertEqual(links["map"], "https://areas.example.org/?layer=crime&selected=uk:lsoa:E01000951")
            self.assertNotIn("evidencePack", share_links.area_links("uk:lad:E09000007"))


if __name__ == "__main__":
    unittest.main()


class NewPlaceKindsTests(unittest.TestCase):
    def test_brand_sport_and_school_rules_survive_the_link(self):
        from area_api import share_links
        places = [
            {"id": "ms", "label": "M&S", "target": {"kind": "category", "category": "supermarket", "brand": "M&S"},
             "mode": "walk", "targetMinutes": 10, "weight": 3, "must": False},
            {"id": "tennis", "label": "Tennis club", "target": {"kind": "category", "category": "sports_club", "sport": "tennis"},
             "mode": "cycle", "targetMinutes": 15, "weight": 2, "must": False},
            {"id": "school", "label": "Top-10 secondary", "target": {"kind": "school", "phase": "secondary", "top": 10},
             "mode": "walk", "targetMinutes": 15, "weight": 5, "must": True},
            {"id": "park", "label": "Any park", "target": {"kind": "category", "category": "park"},
             "mode": "walk", "targetMinutes": 10, "weight": 2, "must": False},
        ]
        packed = [share_links._pack_place(place) for place in places]
        self.assertEqual([p[4] for p in packed], [["M&S", None], [None, "tennis"], 10, None])
        self.assertEqual([share_links._unpack_target(p) for p in packed], [place["target"] for place in places])
