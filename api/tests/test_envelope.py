"""Evidence envelope: the one response shape every agent tool returns."""
import types
import unittest

from area_api import envelope, market_depth, tools

REL = "src-hmlr-pp-sales-2026-07"


def _catalogue_metric(metric_id, path, caveats):
    return {"id": metric_id, "methodologyPath": path, "caveats": list(caveats),
            "provenance": {"release": REL, "sourceId": "hmlr-epc-os-uprn",
                           "licence": "OGL-3.0", "transformationVersion": "area-explorer-sales-1"}}


def _shared_release_catalogue(order):
    metrics = {
        "stock-value-per-square-metre": _catalogue_metric(
            "stock-value-per-square-metre", "/guide/stock-value",
            ["Each dwelling counts once at its last recorded sale."]),
        "typical-price": _catalogue_metric(
            "typical-price", "/guide/typical-price", ["typical-price caveat"]),
    }
    return {"metrics": [metrics[metric_id] for metric_id in order]}

SUMMARY = {
    "geographyId": "uk:lsoa:E01000004", "name": "Camden 001A", "metricId": "crime",
    "period": "2026-06", "value": 56.0, "regionPercentile": 40, "countryPercentile": None,
    "sampleCount": None, "quality": "observed", "sourceVersion": "police-uk-2026-06",
    "carrier": "lsoa", "breakdown": {"Shoplifting": 4},
}

METRICS = {
    "productReleaseId": "product-2026-06",
    "metrics": [
        {"id": "crime", "unit": "per 1,000", "methodologyPath": "docs/crime.md", "caveats": ["c1"],
         "provenance": {"sourceId": "police-uk", "sourceName": "Police UK", "sourceUrl": "https://x",
                        "release": "police-uk-2026-06", "checksum": "abc", "licence": "OGL",
                        "attribution": "Police", "transformationVersion": "t1"}},
        {"id": "price-per-square-metre", "unit": "GBP/m2", "methodologyPath": "docs/price.md",
         "caveats": [],
         "provenance": {"sourceId": "hmlr-epc", "sourceName": "HMLR", "sourceUrl": "https://y",
                        "release": "hmlr-epc-2026-06", "checksum": "def", "licence": "OGL",
                        "attribution": "HMLR", "transformationVersion": "t2"}},
    ],
}


class WrapTests(unittest.TestCase):
    def test_wrap_has_every_envelope_key_with_release_defaults(self):
        out = envelope.wrap({"x": 1}, schema_version="tool.v1", release_id="product-2026-06")

        self.assertEqual(out, {
            "schemaVersion": "tool.v1", "productReleaseId": "product-2026-06",
            "dataMode": "release", "value": {"x": 1}, "confidence": "none",
            "evidence": [], "sources": [], "caveats": [],
        })

    def test_wrap_rejects_unknown_data_mode_and_confidence(self):
        with self.assertRaises(ValueError):
            envelope.wrap(1, schema_version="t", release_id="r", data_mode="live")
        with self.assertRaises(ValueError):
            envelope.wrap(1, schema_version="t", release_id="r", confidence="certain")
        with self.assertRaises(ValueError):
            envelope.wrap(1, schema_version="t", release_id="r", proof=[])


class ConfidenceTests(unittest.TestCase):
    def test_quality_maps_to_confidence_band(self):
        self.assertEqual(envelope.confidence_from_quality("observed"), "high")
        self.assertEqual(envelope.confidence_from_quality("fallback"), "medium")
        self.assertEqual(envelope.confidence_from_quality("suppressed"), "none")
        self.assertEqual(envelope.confidence_from_quality("weird"), "none")

    def test_lowest_confidence_wins_across_rows(self):
        self.assertEqual(envelope.combined_confidence(["high", "medium", "high"]), "medium")
        self.assertEqual(envelope.combined_confidence([]), "none")


class EvidenceRowTests(unittest.TestCase):
    def test_summary_becomes_metric_observation(self):
        row = envelope.evidence_from_summary(SUMMARY)

        self.assertEqual(row["kind"], "metric-observation")
        self.assertEqual(row["geographyId"], "uk:lsoa:E01000004")
        self.assertEqual(row["metricId"], "crime")
        self.assertEqual(row["period"], "2026-06")
        self.assertEqual(row["value"], 56.0)
        self.assertEqual(row["quality"], "observed")
        self.assertEqual(row["sourceVersion"], "police-uk-2026-06")
        self.assertEqual(row["breakdown"], {"Shoplifting": 4})
        self.assertNotIn("carrier", row)


class SourcesTests(unittest.TestCase):
    def test_sources_come_from_metric_provenance(self):
        sources = envelope.sources_for(["crime"], METRICS)

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0]["metricId"], "crime")
        self.assertEqual(sources[0]["release"], "police-uk-2026-06")
        self.assertEqual(sources[0]["licence"], "OGL")
        self.assertEqual(sources[0]["methodologyPath"], "docs/crime.md")
        self.assertEqual(sources[0]["caveats"], ["c1"])
        self.assertNotIn("checksum", sources[0])

    def test_sources_dedupe_and_ignore_unknown_metrics(self):
        sources = envelope.sources_for(["crime", "crime", "nope"], METRICS)
        self.assertEqual([s["metricId"] for s in sources], ["crime"])

    def test_source_for_release_falls_back_to_bare_release(self):
        known = envelope.source_for_release("hmlr-epc-2026-06", METRICS)
        unknown = envelope.source_for_release("mystery-2026", METRICS)

        self.assertEqual(known["sourceId"], "hmlr-epc")
        self.assertEqual(unknown, {"release": "mystery-2026"})


class CombinedConfidenceGeneratorTests(unittest.TestCase):
    """Issue #198: combined_confidence must not consume a generator before it is done."""

    def test_mixed_generator_returns_weakest_band(self):
        self.assertEqual(envelope.combined_confidence(b for b in ["high", "medium"]), "medium")

    def test_all_medium_generator_is_medium(self):
        self.assertEqual(envelope.combined_confidence(b for b in ["medium", "medium"]), "medium")

    def test_low_generator_is_low(self):
        self.assertEqual(envelope.combined_confidence(b for b in ["high", "low"]), "low")

    def test_generator_and_list_agree(self):
        for bands in (["high"], ["medium"], ["high", "medium"], ["high", "none"], []):
            with self.subTest(bands=bands):
                self.assertEqual(envelope.combined_confidence(iter(bands)),
                                 envelope.combined_confidence(list(bands)))


class _Reader:
    def __init__(self, values):
        self.values = values

    def get_value_pack(self, metric_id, period, cancel=None):
        return {"productReleaseId": "rel-n2", "values": self.values}

    def list_metrics(self, cancel=None):
        return {"productReleaseId": "rel-n2", "metrics": [
            {"id": "price-per-square-metre", "unit": "GBP/m2", "caveats": [],
             "provenance": {"release": "hmlr-epc-2026-06"}}]}


def _row(i, quality):
    return {"geographyId": f"uk:lsoa:E0100000{i}", "name": f"Area {i}", "metricId": "price-per-square-metre",
            "period": "2026-06", "value": 4000.0 + i, "quality": quality}


class RankAreasConfidenceTests(unittest.TestCase):
    """Issue #198: _rank_areas passes a generator; fallback rows must read medium, not high/none."""

    def rank(self, qualities):
        context = types.SimpleNamespace(reader=_Reader([_row(i, q) for i, q in enumerate(qualities)]), cancel=None)
        args = tools.RankAreasInput(metric_id="price-per-square-metre", period="2026-06",
                                    top_n=len(qualities), order="asc")
        return tools._rank_areas(context, args)["confidence"]

    def test_observed_plus_fallback_rows_read_medium(self):
        self.assertEqual(self.rank(["observed"] + ["fallback"] * 9), "medium")

    def test_all_fallback_rows_read_medium(self):
        self.assertEqual(self.rank(["fallback"] * 8), "medium")


class ReleaseOnlySourceTests(unittest.TestCase):
    """Issue #161: a non-metric block must never inherit another metric's identity."""

    def test_source_for_release_is_release_level_without_metric_id(self):
        for order in (("stock-value-per-square-metre", "typical-price"),
                      ("typical-price", "stock-value-per-square-metre")):
            source = envelope.source_for_release(REL, _shared_release_catalogue(order))

            self.assertEqual(source["release"], REL)
            self.assertEqual(source["licence"], "OGL-3.0")  # release-level provenance: wanted
            self.assertEqual(source["sourceId"], "hmlr-epc-os-uprn")
            self.assertEqual(source["transformationVersion"], "area-explorer-sales-1")
            self.assertNotIn("metricId", source)
            self.assertNotIn("methodologyPath", source)
            self.assertNotIn("caveats", source)

    def test_source_for_release_with_metric_id_picks_that_metric(self):
        source = envelope.source_for_release(
            REL, _shared_release_catalogue(("stock-value-per-square-metre", "typical-price")),
            metric_id="typical-price")

        self.assertEqual(source["metricId"], "typical-price")
        self.assertEqual(source["methodologyPath"], "/guide/typical-price")
        self.assertEqual(source["caveats"], ["typical-price caveat"])

    def test_source_for_release_with_unknown_metric_id_falls_back_to_bare_release(self):
        source = envelope.source_for_release(
            REL, _shared_release_catalogue(("stock-value-per-square-metre",)),
            metric_id="no-such-metric")
        self.assertEqual(source, {"release": REL})

    def test_enrich_sources_carries_release_provenance_only(self):
        catalogue = _shared_release_catalogue(
            ("stock-value-per-square-metre", "typical-price"))
        [source] = market_depth.enrich_sources([{"release": REL}], catalogue)

        self.assertEqual(source["licence"], "OGL-3.0")
        self.assertNotIn("metricId", source)
        self.assertNotIn("methodologyPath", source)
        self.assertNotIn("caveats", source)


if __name__ == "__main__":
    unittest.main()
