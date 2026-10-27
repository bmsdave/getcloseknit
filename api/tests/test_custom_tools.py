"""Claude's custom-criteria tools: presets, evaluating a criterion (best/worst areas, a map link that
carries the criterion only in the fragment) and find_areas weighing custom criteria."""
import unittest
from urllib.parse import urlsplit

from tests.test_custom_criteria import KEBAB_CAFE, FakeConnection

try:
    from area_api import custom_criteria, evidence, personal_places, share_links, tools
    from area_api.app import PRIVATE_TOOLS
except ImportError:  # pragma: no cover - dependency-free environments
    tools = None


class Reader:
    _connect = FakeConnection

    def list_metrics(self, cancel=None):
        return {"productReleaseId": "rel-1", "metrics": []}

    def area_lookup(self, area_ids, cancel=None):
        return {"places": {area_id: {"geographyId": area_id, "name": f"Area {area_id[-3:]}",
                                     "parentId": area_id.replace("lsoa", "msoa"),
                                     "borough": "Camden", "center": [-0.1, 51.5], "outcodes": ["N1"]}
                           for area_id in area_ids}}


class EmptyReader(Reader):
    """A release where no place matches any criterion."""
    _connect = staticmethod(lambda: FakeConnection(places=[]))


@unittest.skipIf(tools is None, "pydantic is not installed")
class CustomToolTests(unittest.TestCase):
    def setUp(self):
        custom_criteria.clear_cache()
        personal_places.clear_cache()
        self.profiles = []

        def match_rows(profile):
            self.profiles.append(profile)
            from area_api import repository
            return custom_criteria.rows(FakeConnection(), "rel-1", repository.match_sources(profile)["custom"])
        self.context = tools.ToolContext(reader=Reader(), load_match_rows=match_rows, load_zone_lsoas=lambda zones: None)

    def test_presets(self):
        out = tools.call_tool("list_custom_presets", self.context, {})
        ids = [preset["id"] for preset in out["value"]]
        self.assertIn("kebab-cafe", ids)
        self.assertGreaterEqual(len(ids), 17)
        self.assertIn(custom_criteria.PLACES_NOT_PEOPLE, out["caveats"])

    def test_evaluate_a_preset_in_the_direction_asked(self):
        out = tools.call_tool("evaluate_custom_criterion", self.context,
                              {"preset_id": "kebab-cafe", "direction": "lower", "area_ids": ["uk:lsoa:E01000001"]})
        value = out["value"]
        self.assertEqual(out["schemaVersion"], "tool-evaluate-custom-criterion.v1")
        self.assertEqual(value["best"][0]["geographyId"], "uk:lsoa:E01000002")  # most cafés per kebab shop
        self.assertEqual(value["areas"][0]["counts"], {"a": 2, "b": 1})
        url = urlsplit(value["mapUrl"])
        self.assertEqual(url.query, "layer=custom:kebab-cafe")
        self.assertNotIn("kebab", url.query.replace("custom:kebab-cafe", ""))
        profile = share_links.profile_from_link(value["mapUrl"])
        self.assertEqual(profile["custom"][0]["criterion"]["sets"]["a"]["any"], [{"cuisine": "kebab"}, {"cuisine": "turkish"}])
        self.assertEqual(profile["custom"][0]["direction"], "lower")
        self.assertIn(custom_criteria.PLACES_NOT_PEOPLE, out["caveats"])
        self.assertIn("evaluate_custom_criterion", PRIVATE_TOOLS)

    def test_own_criterion_and_refusals(self):
        out = tools.call_tool("evaluate_custom_criterion", self.context, {"criterion": KEBAB_CAFE})
        self.assertEqual(out["value"]["criterion"]["id"], "kebab-cafe")
        with self.assertRaises(evidence.MalformedQuery):
            tools.call_tool("evaluate_custom_criterion", self.context, {"preset_id": "kebab-cafe", "criterion": KEBAB_CAFE})
        with self.assertRaises(evidence.MalformedQuery):
            tools.call_tool("evaluate_custom_criterion", self.context, {"preset_id": "nope"})
        people = {**KEBAB_CAFE, "formula": "count", "sets": {"a": {"label": "X", "any": [{"religion": "*"}]}}}
        with self.assertRaisesRegex(custom_criteria.InvalidCriterion, "never who lives"):
            tools.call_tool("evaluate_custom_criterion", self.context, {"criterion": people})

    def test_no_matching_place_gives_no_best_or_worst(self):
        # #222: a criterion matching nothing (a typo'd tag value) came back confident, with one area
        # at value 0 as both best and worst.
        context = tools.ToolContext(reader=EmptyReader(), load_match_rows=lambda profile: [],
                                    load_zone_lsoas=lambda zones: None)
        out = tools.call_tool("evaluate_custom_criterion", context, {"preset_id": "kebab-cafe", "top_n": 1})
        value = out["value"]
        self.assertEqual(out["confidence"], "none")
        self.assertEqual(value["best"], [])
        self.assertEqual(value["worst"], [])
        self.assertEqual(value["areasEvaluated"], 0)
        self.assertIsNone(value["regionMedian"])
        self.assertIn("layer=custom:kebab-cafe", value["mapUrl"])
        self.assertTrue(any(c.startswith("No place on the map matches this criterion") for c in out["caveats"]))

    def test_requested_areas_are_named_and_unknown_ids_reported(self):
        # #243: requested areas came back with name null; unknown ids vanished without a word.
        out = tools.call_tool("evaluate_custom_criterion", self.context, {
            "preset_id": "kebab-cafe", "area_ids": ["uk:lsoa:E01000001", "uk:lsoa:E01999999"]})
        value = out["value"]
        self.assertEqual([a["geographyId"] for a in value["areas"]], ["uk:lsoa:E01000001"])
        self.assertEqual(value["areas"][0]["name"], "Area 001")
        self.assertEqual(value["unknownAreaIds"], ["uk:lsoa:E01999999"])
        self.assertTrue(any("uk:lsoa:E01999999" in c for c in out["caveats"]))
        plain = tools.call_tool("evaluate_custom_criterion", self.context, {"preset_id": "kebab-cafe"})
        self.assertEqual(plain["value"]["unknownAreaIds"], [])

    def test_malformed_area_ids_are_rejected(self):
        for bad in ("garbage", "uk:msoa:E02000829"):
            with self.assertRaises(tools.InvalidToolArguments):
                tools.call_tool("evaluate_custom_criterion", self.context, {"preset_id": "kebab-cafe", "area_ids": [bad]})

    def test_find_areas_weighs_custom_criteria(self):
        out = tools.call_tool("find_areas", self.context, {
            "max_budget": 600_000, "priorities": [{"factor": "crime", "importance": 1}],
            "custom": [{"preset_id": "kebab-cafe", "importance": 5}], "include_over_budget": True})
        profile = out["value"]["profile"]
        self.assertIn(profile, self.profiles)
        custom = [item for item in profile["criteria"] if item["kind"] == "custom"]
        self.assertEqual(custom[0]["direction"], "lower")  # the preset's default
        # Importance 5 puts it first with the budget (also 5, given first): budget, kebab-cafe, crime.
        self.assertEqual([item["kind"] for item in profile["criteria"]], ["budget", "custom", "range"])
        self.assertNotIn("schemaVersion", custom[0]["criterion"])
        self.assertEqual(out["value"]["areas"][0]["geographyId"], "uk:lsoa:E01000002")
        self.assertIn("custom:kebab-cafe", [f["factorId"] for f in out["value"]["areas"][0]["factors"]])
        self.assertTrue(any(custom_criteria.PLACES_NOT_PEOPLE in caveat for caveat in out["caveats"]))
        self.assertEqual(share_links.profile_from_link(out["value"]["mapUrl"]), profile)


if __name__ == "__main__":
    unittest.main()
