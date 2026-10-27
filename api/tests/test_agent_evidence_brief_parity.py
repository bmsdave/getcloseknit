"""Review #2 / C7 parity: the MCP brief states only the weights the household set, lists the
defaults under "Assumed (you didn't set these)" and names must-haves as the web brief does
(web/src/lib/decision-brief.ts)."""
import unittest

from area_api import agent_evidence


def _factor(factor_id, weight, minimum=None):
    return {"factorId": factor_id, "weight": weight, "direction": "lower",
            "minimumUtility": minimum, "maximumUtility": None}


def _profile(*factors):
    return {"market": "buy", "maximumBudget": 600000, "bedrooms": 2,
            "factors": list(factors), "commuteDestinations": []}


def _section(brief, section_id):
    return next(section for section in brief["sections"] if section["id"] == section_id)


def _texts(section):
    return [line["text"] for line in section["lines"]]


COMPARISON = {"status": "ok", "productReleaseId": "r1", "conclusions": [], "uncertainty": [],
              "columns": [], "sources": []}


class BriefParityTests(unittest.TestCase):
    def test_only_weights_the_household_set_are_stated(self):
        brief = agent_evidence.prepare_brief(COMPARISON, profile=_profile(
            _factor("affordability", 3), _factor("crime", 4), _factor("schools", 0)))
        needs = " ".join(_texts(_section(brief, "needs")))
        self.assertIn("Priorities you picked: Crime (4 of 5).", needs)
        self.assertNotIn("Price", needs)
        assumed = _section(brief, "assumed")
        self.assertEqual(assumed["heading"], "Assumed (you didn't set these)")
        self.assertEqual(_texts(assumed), ["Price counts at its standard weight (3 of 5).",
                                           "Left out of your score: schools."])

    def test_untouched_defaults_are_never_called_your_weights(self):
        brief = agent_evidence.prepare_brief(COMPARISON, profile=_profile(
            _factor("affordability", 3), _factor("crime", 0)))
        self.assertIn("You haven't picked any priorities yet.", _texts(_section(brief, "needs")))
        self.assertNotIn("weights you set", str(brief).lower())

    def test_a_changed_budget_weight_is_the_households_own(self):
        brief = agent_evidence.prepare_brief(COMPARISON, profile=_profile(_factor("affordability", 5)))
        self.assertIn("Priorities you picked: Price (5 of 5).", " ".join(_texts(_section(brief, "needs"))))
        self.assertEqual(_texts(_section(brief, "assumed")), ["Nothing assumed: every figure above is one you set."])

    def test_must_haves_replace_hard_constraints(self):
        none = agent_evidence.prepare_brief(COMPARISON, profile=_profile(_factor("crime", 3)))
        self.assertEqual(_section(none, "constraints")["heading"], "Your must-haves")
        self.assertEqual(_texts(_section(none, "constraints")),
                         ["You haven't set any must-haves, so no area is ruled out."])
        bounded = agent_evidence.prepare_brief(COMPARISON, profile=_profile(_factor("crime", 3, minimum=50)))
        self.assertEqual(_texts(_section(bounded, "constraints")), ["Crime scores at least 50 out of 100."])
        self.assertNotIn("hard constraint", agent_evidence.render_brief_markdown(bounded).lower())

    def test_places_score_the_journey_and_commute_is_never_left_out(self):
        profile = _profile(_factor("affordability", 3), _factor("commute", 0), _factor("crime", 0))
        profile["places"] = [{"id": "work", "label": "Waterloo preview station", "mode": "transit",
                              "targetMinutes": 25, "weight": 3, "must": False}]
        brief = agent_evidence.prepare_brief(COMPARISON, profile=profile)
        needs = _texts(_section(brief, "needs"))
        self.assertIn("Journey to Your place 1: weight 3 of 5, limit 25 min.", needs)
        self.assertNotIn("No commute destinations recorded.", needs)
        self.assertEqual(_texts(_section(brief, "assumed")), ["Price counts at its standard weight (3 of 5).",
                                                              "Left out of your score: crime."])
        self.assertNotIn("Waterloo", str(brief))
        self.assertNotIn("weights you set", str(brief).lower())
        named = agent_evidence.prepare_brief(COMPARISON, profile=profile, include_private=True)
        self.assertIn("Journey to \u201cWaterloo preview station\u201d: weight 3 of 5, limit 25 min.",
                      _texts(_section(named, "needs")))

    def test_no_profile_means_no_assumed_section(self):
        brief = agent_evidence.prepare_brief(COMPARISON)
        self.assertNotIn("assumed", [section["id"] for section in brief["sections"]])


if __name__ == "__main__":
    unittest.main()
