"""Evidence envelope: the single response shape every agent tool returns.

Agents reason on top of these answers, so a value never travels alone: it
carries a confidence band, the evidence rows behind it, and the named
source releases (with licences and methodology links) that produced them.
"""
from typing import Any, Iterable, Mapping

DATA_MODES = ("release", "demo")
CONFIDENCE_BANDS = ("high", "medium", "low", "none")
_QUALITY_CONFIDENCE = {"observed": "high", "fallback": "medium", "suppressed": "none"}
_EVIDENCE_FIELDS = (
    "geographyId", "name", "metricId", "period", "value", "quality", "sampleCount",
    "regionPercentile", "countryPercentile", "sourceVersion", "breakdown", "areaCount",
)
_SOURCE_FIELDS = (
    "sourceId", "sourceName", "sourceUrl", "release", "licence", "attribution",
    "transformationVersion",
)


SUPPORT_KEYS = ("evidence", "sources", "caveats")


def wrap(
    value: Any, *, schema_version: str, release_id: str, confidence: str = "none",
    data_mode: str = "release", **support: Iterable[Any],
) -> dict:
    """Build an envelope. `support` accepts evidence=, sources= (row mappings) and caveats= (strings)."""
    if data_mode not in DATA_MODES:
        raise ValueError(f"unknown data mode: {data_mode}")
    if confidence not in CONFIDENCE_BANDS:
        raise ValueError(f"unknown confidence band: {confidence}")
    if unknown := set(support) - set(SUPPORT_KEYS):
        raise ValueError(f"unknown envelope fields: {sorted(unknown)}")
    return {
        "schemaVersion": schema_version,
        "productReleaseId": release_id,
        "dataMode": data_mode,
        "value": value,
        "confidence": confidence,
        "evidence": [dict(row) for row in support.get("evidence", ())],
        "sources": [dict(row) for row in support.get("sources", ())],
        "caveats": list(support.get("caveats", ())),
    }


def confidence_from_quality(quality: str | None) -> str:
    return _QUALITY_CONFIDENCE.get(quality or "", "none")


def combined_confidence(bands: Iterable[str]) -> str:
    """Weakest band present, for any iterable (consumed once); ``"none"`` when empty."""
    present = set(bands)
    ranked = [band for band in CONFIDENCE_BANDS if band in present]
    return ranked[-1] if ranked else "none"


def evidence_from_summary(summary: Mapping[str, Any]) -> dict:
    row = {"kind": "metric-observation"}
    row.update({key: summary[key] for key in _EVIDENCE_FIELDS if key in summary})
    return row


def sources_for(metric_ids: Iterable[str], metrics_payload: Mapping[str, Any]) -> list[dict]:
    by_id = {metric["id"]: metric for metric in metrics_payload.get("metrics", [])}
    sources: list[dict] = []
    for metric_id in dict.fromkeys(metric_ids):
        metric = by_id.get(metric_id)
        if metric is not None:
            sources.append(_source_from_metric(metric))
    return sources


def source_for_release(release: str, metrics_payload: Mapping[str, Any],
                       metric_id: str | None = None) -> dict:
    """Release-level provenance for a source row.

    Without ``metric_id`` this returns only release-level fields (never another
    metric's ``metricId``, ``methodologyPath`` or ``caveats``), no matter how
    many catalogue metrics cite the release or in what order. Pass ``metric_id``
    to get the full metric-specific source row for exactly that metric.
    """
    for metric in metrics_payload.get("metrics", []):
        if metric["provenance"]["release"] != release:
            continue
        if metric_id is not None:
            if metric["id"] == metric_id:
                return _source_from_metric(metric)
            continue
        return _release_source(metric)
    return {"release": release}


def _release_source(metric: Mapping[str, Any]) -> dict:
    provenance = metric["provenance"]
    return {key: value for key, value in
            ((key, provenance.get(key)) for key in _SOURCE_FIELDS)
            if value is not None}


def _source_from_metric(metric: Mapping[str, Any]) -> dict:
    provenance = metric["provenance"]
    source = {"metricId": metric["id"]}
    source.update({key: provenance.get(key) for key in _SOURCE_FIELDS})
    source["methodologyPath"] = metric.get("methodologyPath")
    source["caveats"] = list(metric.get("caveats", []))
    return source
