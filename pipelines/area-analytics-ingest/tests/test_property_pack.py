import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from area_analytics.property_pack import build_property_pack


def _payload(**overrides):
    payload = {
        "sourceVersion": "preview-hmlr-epc-cpih-2026-06",
        "valuationDate": "2026-09-01",
        "gridPrecisionDegrees": 0.01,
        "confidenceBands": [[5, 8.7], [40, 15.9]],
        "cpihLatest": 138.4,
        "deprivation": {
            "earlierRelease": "IMD 2019",
            "laterRelease": "IMD 2025",
            "published": "2025-10-01",
            "earlier": {"E01000001": 3},
            "later": {"E01000001": 6},
        },
        "notModelled": [
            {
                "label": "School catchment",
                "publishedEffect": "+10–13% for outstanding over good primary",
                "sourceUrl": "https://www.pauzible.com/knowledge-hub/school-catchment-area-house-price-premium-uk",
            }
        ],
        "peerCandidates": [
            {
                "propertyId": f"uk:property:SW1A1AA:PEER-{index}",
                "propertyType": "flat",
                "floorAreaSquareMetres": 50 + index % 8,
                "price": 500_000 + index * 1_000,
                "pricePerSquareMetre": 9_000 + index * 40,
                "priceDecile": 8,
                "msoa": "E02000001",
                "borough": "E09000033",
                "crimeDecile": 7,
                "deprivationDecile": 8,
                "incomeDecile": 9,
            }
            for index in range(40)
        ],
        "peerSales": [
            {
                "propertyId": f"uk:property:SW1A1AA:PEER-{index}",
                "year": "2025",
                "pricePerSquareMetre": 9_000 + index * 40,
            }
            for index in range(40)
        ],
        "properties": [
            {
                "postcode": "SW1A 1AA",
                "primaryAddress": "1, Parliament Preview",
                "displayAddress": "1 Parliament Preview, London, SW1A 1AA",
                "latitude": 51.501,
                "longitude": -0.1416,
                "lsoa": "E01000001",
                "msoa": "E02000001",
                "borough": "E09000033",
                "propertyType": "flat",
                "localPricePerSquareMetreLatest": 9_600,
                "deciles": {"price": 8, "crime": 7, "deprivation": 8, "income": 9},
                "sales": [
                    {
                        "date": "2006-06-15",
                        "price": 280_000,
                        "newBuild": False,
                        "tenure": "leasehold",
                        "cpih": 82.9,
                        "localPricePerSquareMetre": 4_400,
                    },
                    {
                        "date": "2022-11-03",
                        "price": 570_000,
                        "newBuild": False,
                        "tenure": "freehold",
                        "cpih": 126.2,
                        "localPricePerSquareMetre": 8_190,
                    },
                ],
                "certificates": [
                    {"lodged": "2008-02-01", "floorAreaSquareMetres": 54, "energyRating": "E", "rooms": 3},
                    {
                        "lodged": "2021-05-09",
                        "floorAreaSquareMetres": 62,
                        "energyRating": "C",
                        "rooms": 4,
                        "extensionCount": 1,
                    },
                ],
                "reference": {
                    "baseline": {
                        "label": "London median",
                        "medianPricePerSquareMetre": 6_449,
                        "sampleCount": 120_000,
                    },
                    "steps": [
                        {"label": "Westminster", "medianPricePerSquareMetre": 8_549, "sampleCount": 4_100},
                        {"label": "This MSOA", "medianPricePerSquareMetre": 9_029, "sampleCount": 310},
                        {"label": "Age band", "medianPricePerSquareMetre": 9_509, "sampleCount": 12},
                    ],
                },
            }
        ],
    }
    payload.update(overrides)
    return payload


class PropertyPackTests(unittest.TestCase):
    def setUp(self):
        self.pack = build_property_pack(_payload())
        self.dossier = self.pack["properties"][0]

    def test_the_pack_is_written_as_grid_cells_a_viewport_can_read(self):
        self.assertEqual(
            self.pack["cells"], {"cell:0.01:-15:5150": ["uk:property:SW1A1AA:1-PARLIAMENT-PREVIEW"]}
        )

    def test_the_waterfall_sums_to_the_estimate_and_names_what_it_skipped(self):
        decomposition = self.dossier["decomposition"]
        total = decomposition["baselinePrice"] + sum(
            contribution["amount"] for contribution in decomposition["contributions"]
        )

        self.assertEqual(total, decomposition["estimate"])
        self.assertEqual(self.dossier["valuation"]["estimate"], decomposition["estimate"])
        self.assertEqual([step["label"] for step in decomposition["skipped"]], ["Age band"])

    def test_the_residual_measures_the_gap_to_the_restated_last_sale(self):
        decomposition = self.dossier["decomposition"]
        last_sale = self.dossier["valuation"]["lastSale"]

        self.assertEqual(
            decomposition["residual"],
            last_sale["localMarketAdjustedPrice"] - decomposition["estimate"],
        )

    def test_a_sale_before_the_first_certificate_reports_no_floor_area(self):
        earlier, later = self.dossier["history"]["transactions"]

        self.assertIsNone(earlier["floorAreaSquareMetres"])
        self.assertIsNone(earlier["pricePerSquareMetre"])
        self.assertEqual(later["floorAreaSquareMetres"], 62)

    def test_the_confidence_band_widens_with_the_gap_since_the_last_sale(self):
        valuation = self.dossier["valuation"]

        self.assertEqual(valuation["yearsSinceSale"], 3.83)
        self.assertEqual(valuation["confidenceBandPercent"], 8.7)

    def test_events_carry_the_property_and_the_area_together_in_date_order(self):
        self.assertEqual(
            [(event["kind"], event["date"]) for event in self.dossier["events"]],
            [
                ("extended", "2021-05-09"),
                ("refurbished", "2021-05-09"),
                ("converted-to-freehold", "2022-11-03"),
                ("area-deprivation-moved", "2025-10-01"),
            ],
        )

    def test_peer_groups_publish_a_distribution_but_never_the_neighbours(self):
        groups = {group["id"]: group for group in self.dossier["peerGroups"]}

        self.assertEqual(groups["similar-homes-nearby"]["status"], "observed")
        self.assertGreaterEqual(groups["similar-homes-nearby"]["count"], 30)
        self.assertEqual(groups["same-building-different-neighbourhood"]["status"], "too-thin")
        self.assertIsNone(groups["same-building-different-neighbourhood"]["distribution"])
        for group in self.dossier["peerGroups"]:
            self.assertNotIn("memberIds", group)

    def test_a_property_without_a_certificate_is_refused_rather_than_estimated(self):
        payload = _payload()
        payload["properties"][0]["certificates"] = []

        with self.assertRaises(ValueError):
            build_property_pack(payload)

    def test_a_missing_reviewed_field_stops_the_build(self):
        payload = _payload()
        del payload["cpihLatest"]

        with self.assertRaises(ValueError):
            build_property_pack(payload)


class PropertyCliTests(unittest.TestCase):
    def test_the_cli_writes_a_deterministic_pack(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.json"
            first = Path(directory) / "first.json"
            second = Path(directory) / "second.json"
            source.write_text(json.dumps(_payload()))
            for output in (first, second):
                subprocess.run(
                    [sys.executable, "-m", "area_analytics.properties_cli",
                     "--input", str(source), "--output", str(output)],
                    check=True,
                )

            self.assertEqual(first.read_text(), second.read_text())
            self.assertEqual(json.loads(first.read_text())["schemaVersion"], "property-pack.v1")


if __name__ == "__main__":
    unittest.main()
