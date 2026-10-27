"""AE-13 honest property dossiers: failing-first regressions.

A dossier stays useful without floor area or valuation, keeps source
observations separate from derived hypotheses and user-confirmed facts,
describes certificate changes with dates and uncertainty, and never
presents an inferred renovation, extension, or tenure conversion as an
observed event. Deterministic fixtures only.
"""

import unittest

from area_analytics.property_dossier import build_property_dossier


def sale(txn="TXN-1", price=350000, date="2019-06-14", tenure="L"):
    return {
        "transactionId": txn,
        "price": price,
        "saleDate": date,
        "saleMonth": date[:7],
        "postcode": "E8 3PN",
        "propertyType": "F",
        "newBuild": "N",
        "tenure": tenure,
        "paon": "10",
        "saon": "Flat 1",
        "street": "Downing Street",
        "locality": "",
        "town": "LONDON",
        "district": "Hackney",
        "county": "Greater London",
        "recordCategory": "A",
        "recordStatus": "A",
    }


def cert(cid="EPC-1", lodged="2020-01-10", area=58.5, rating="C", points=72):
    return {
        "certificateId": cid,
        "uprn": "100012345678",
        "lodgementDate": lodged,
        "inspectionDate": "2019-12-01",
        "energyRating": rating,
        "energyPoints": points,
        "floorAreaSqm": area,
        "habitableRooms": 3,
        "replacementStatus": "current",
    }


BANNED = ("renovation", "refurbish", "extension",
          "conversion", "retrofit")


def event_text(dossier):
    texts = []
    for section in ("observations", "hypotheses", "confirmedFacts", "events"):
        for entry in dossier.get(section, []):
            texts.append(str(entry.get("kind", "")))
            texts.append(str(entry.get("label", "")))
            texts.append(str(entry.get("summary", "")))
    return " ".join(texts).lower()


class HonestDossierTests(unittest.TestCase):
    def test_sale_only_property_builds_without_area_or_valuation(self):
        dossier = build_property_dossier("prop-1", [sale()])

        self.assertEqual(len(dossier["saleHistory"]), 1)
        self.assertEqual(dossier["saleHistory"][0]["price"], 350000)
        self.assertEqual(dossier["floorArea"]["status"], "unknown")
        self.assertEqual(dossier["valuation"]["status"], "unavailable")
        self.assertEqual(dossier["peers"]["status"], "unavailable")
        self.assertTrue(dossier["dataGaps"])

    def test_certificate_only_property_builds_without_sales(self):
        dossier = build_property_dossier(
            "prop-2", [], epc_current=cert())

        self.assertEqual(dossier["saleHistory"], [])
        self.assertEqual(dossier["floorArea"]["status"], "known")
        self.assertEqual(dossier["floorArea"]["floorAreaSqm"], 58.5)
        kinds = [entry["kind"] for entry in dossier["observations"]]
        self.assertIn("certificate", kinds)

    def test_conflicting_epc_areas_are_exposed_not_picked(self):
        old = cert("EPC-OLD", "2015-03-01", area=52.0)
        new = cert("EPC-NEW", "2024-06-01", area=68.0)
        dossier = build_property_dossier(
            "prop-3", [], epc_current=new, epc_history=[old])

        self.assertEqual(dossier["floorArea"]["status"], "conflicting")
        self.assertIsNone(dossier["floorArea"].get("floorAreaSqm"))
        self.assertTrue(dossier["contradictions"])
        text = " ".join(str(item) for item in
                        dossier["contradictions"]).lower()
        self.assertIn("floor", text)

    def test_apparent_tenure_change_is_hypothesis_not_conversion(self):
        dossier = build_property_dossier(
            "prop-4", [sale("TXN-A", 300000, "2016-04-01", "L"),
                       sale("TXN-B", 420000, "2022-09-01", "F")])

        for event in dossier["events"]:
            self.assertNotEqual(event["kindOf"], "observed-conversion")
        text = event_text(dossier)
        for word in ("conversion", "converted"):
            self.assertNotIn(word, text)
        kinds = [entry["kind"] for entry in dossier["hypotheses"]]
        self.assertIn("possible-tenure-difference", kinds)
        detail = " ".join(str(entry.get("detail", "")) for entry in
                          dossier["hypotheses"]).lower()
        self.assertIn("title", detail)

    def test_sale_history_survives_missing_valuation(self):
        dossier = build_property_dossier(
            "prop-5", [sale("TXN-A", 300000, "2016-04-01"),
                       sale("TXN-B", 420000, "2022-09-01")])

        self.assertEqual(len(dossier["saleHistory"]), 2)
        self.assertEqual(dossier["valuation"]["status"], "unavailable")
        self.assertIn("valuation", dossier["valuation"]["reason"].lower())

    def test_changed_certificate_never_becomes_confirmed_renovation(self):
        old = cert("EPC-OLD", "2015-03-01", area=58.5,
                   rating="E", points=44)
        new = cert("EPC-NEW", "2024-06-01", area=58.5,
                   rating="B", points=81)
        dossier = build_property_dossier(
            "prop-6", [sale()], epc_current=new, epc_history=[old])

        self.assertEqual(dossier["confirmedFacts"], [])
        text = event_text(dossier)
        for word in BANNED:
            self.assertNotIn(word, text)
        kinds = [entry["kind"] for entry in dossier["hypotheses"]]
        self.assertIn("certificate-change", kinds)
        hypothesis = next(entry for entry in dossier["hypotheses"]
                          if entry["kind"] == "certificate-change")
        self.assertIn("2015-03-01", str(hypothesis))
        self.assertIn("2024-06-01", str(hypothesis))
        observed_kinds = [entry["kind"] for entry in dossier["events"]
                          if entry["kindOf"] == "observed"]
        self.assertNotIn("certificate-change", observed_kinds)

    def test_every_event_states_observed_or_inferred(self):
        old = cert("EPC-OLD", "2015-03-01", area=52.0,
                   rating="E", points=44)
        new = cert("EPC-NEW", "2024-06-01", area=68.0,
                   rating="B", points=81)
        dossier = build_property_dossier(
            "prop-7", [sale("TXN-A", 300000, "2016-04-01", "L"),
                       sale("TXN-B", 420000, "2022-09-01", "F")],
            epc_current=new, epc_history=[old])

        self.assertTrue(dossier["events"])
        for event in dossier["events"]:
            self.assertIn(event["kindOf"], ("observed", "inferred"))


if __name__ == "__main__":
    unittest.main()
