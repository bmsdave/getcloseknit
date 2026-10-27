"""Agent tool registry.

One registry feeds both the MCP server and the `POST /api/v2/tools/{name}`
REST mirror, and every handler calls the same `EvidenceReader` / matching
code as the v1 routes, so the two surfaces cannot disagree. Descriptions are
written for a foreign agent: when to call, units, id formats, caveats.
"""
from collections import Counter
from typing import Any, Literal, Mapping

from pydantic import BaseModel, Field, ValidationError

from . import (contract_aliases, coverage, envelope, evidence, feature_flags, feedback, home_search, market_depth, match_model,
               property_profile, regions, search_text, share_links, valuation)
from .matching import build_match_pack, validate_match_request
from . import kinds, repository
from .toolspec import (InvalidToolArguments, NoArguments, StrictInput, ToolContext,  # noqa: F401
                       ToolNotFound, ToolSpec)

AREA_ID_PATTERN = r"^uk:(lsoa|msoa|lad|borough):[A-Z]\d{8}$"  # an old uk:borough: id too (R2)
PERIOD_PATTERN = r"^\d{4}-\d{2}$"
ADDRESS_ID_PATTERN = r"^uk:addr:[0-9a-f]{12}$"
TIMELINE_EVIDENCE_LIMIT = 12
# list_metrics answers in full for this many metrics at most: one full definition is ~5k characters and
# assistants cap a tool result near 150k characters (Claude Code at 25k tokens).
DETAIL_LIMIT = 10
FACTOR_THEME = "my-match-factors"


class SearchAreasInput(StrictInput):
    q: str = Field(min_length=2, description="Free text: area name, ONS code (E01…), postcode, or street.")
    limit: int = Field(default=10, ge=1, le=25, description="Maximum results (1-25).")


class AreaMetricInput(StrictInput):
    area_id: str = Field(pattern=AREA_ID_PATTERN, description="Geography id, e.g. uk:lsoa:E01000004.")
    metric_id: str = Field(description="Metric id from list_metrics, e.g. crime or price-per-square-metre.")
    period: str | None = Field(default=None, pattern=PERIOD_PATTERN, description=(
        "Month, YYYY-MM. Defaults to the metric's latest period (defaultPeriod in list_metrics "
        "detail=[metric_id])."))


class ListMetricsInput(StrictInput):
    compact: bool = Field(default=False, description=(
        "Only id, unit, direction and defaultPeriod per metric: a small reply when you just need "
        "valid metric_id/period values."))
    detail: list[str] | None = Field(default=None, min_length=1, max_length=50, description=(
        "Metric ids (e.g. crime) or theme names (e.g. nature) to return in full: periods, defaultPeriod, "
        f"legend, provenance, coverage, caveats. At most {DETAIL_LIMIT} metrics come back in full; name ids "
        "for the rest. Without it the reply lists every metric's id, label and unit by theme."))


class RankAreasInput(StrictInput):
    metric_id: str = Field(description="Metric id from list_metrics.")
    period: str = Field(pattern=PERIOD_PATTERN, description=(
        "Month, YYYY-MM: defaultPeriod or one of periods in list_metrics detail=[metric_id]."))
    top_n: int = Field(default=10, ge=1, le=50, description="How many areas to return (1-50).")
    order: Literal["asc", "desc"] = Field(default="desc", description="desc = highest value first.")
    region: str | None = Field(default=None, max_length=40, description=(
        "Only areas of one English region: its code (E12000001-E12000009) or name, e.g. 'North West', 'London'. "
        "Omitted: every area Close Knit covers."))


def region_code(text: str | None) -> str | None:
    """'North West', 'north west' or 'E12000002' -> 'E12000002'; None for no region; InvalidToolArguments otherwise."""
    if not text:
        return None
    wanted = " ".join(text.split()).lower()
    for code, name in coverage.REGIONS.items():
        if wanted in (code.lower(), name.lower()):
            return code
    raise InvalidToolArguments(f"unknown region: {text} (one of {', '.join(coverage.REGIONS.values())})")


class AddressHistoryInput(StrictInput):
    address_id: str = Field(pattern=ADDRESS_ID_PATTERN,
                            description="Address id returned by search_areas (uk:addr:…).")


class MarketDepthInput(StrictInput):
    area_id: str = Field(pattern=AREA_ID_PATTERN,
                         description="LSOA or MSOA geography id, e.g. uk:lsoa:E01000004 (boroughs are unavailable).")


class AreaPackInput(StrictInput):
    area_id: str = Field(pattern=AREA_ID_PATTERN, description="Geography id, e.g. uk:lsoa:E01000004.")
    address_id: str | None = Field(default=None, pattern=ADDRESS_ID_PATTERN, description=(
        "Optional address id (uk:addr:…) inside the area: adds its building and street sale aggregates."))


class HomePricesInput(StrictInput):
    property_ref: str = Field(min_length=3, description=(
        "UPRN (digits), an address id (uk:addr:…) as returned by search_places, or an address "
        "fragment, e.g. '100a Baker Street EN1'."))


class MatchAreasInput(StrictInput):
    profile: dict = Field(description=(
        "preference-profile.v2 (preferred): {schemaVersion: 'preference-profile.v2', market buy|rent, targetBudget, "
        "maximumBudget, bedrooms, criteria: [...]} where criteria is ORDERED, most important first, each one of "
        "{kind: budget, must} (fit 1 at or under targetBudget, 0 at maximumBudget; must = within maximumBudget) | "
        "{kind: range, layer (a map layer id from list_metrics, e.g. crime, noise, air-no2, station-access, "
        "price-per-square-metre, or disorder, schools, epc-share, leasehold-share), scale value|percentile "
        "(percentile = percentile 0-100 of the value within the area's region, London's areas among London's, lowest "
        "first), min, max, softMin, softMax, must} | "
        "{kind: place, id, label, target, mode, targetMinutes, softMinutes, must} | "
        "{kind: where, zones (1-3: {kind: station, stationId, maxWalkMinutes 5-30} | {kind: borough, id} | "
        "{kind: lsoas, ids <= 50} | {kind: polygon, points}), softMetres (default 1000), must} | "
        "{kind: custom, criterion, direction, must}. A must criterion is a filter with no weight; the others weigh "
        "by their place in the list. preference-profile.v1 (factors with weights 0-5) is still accepted and "
        "migrated (weight order, Must kept)."))
    top_n: int = Field(default=20, ge=1, le=100, description=(
        "How many of the best-scored areas to list (1-100). values is that top-N list, not the whole map; "
        "scored, unscored, excluded and excludedBy count every area Close Knit covers. For the whole map use mapUrl."))


# #247: My match factors that find_areas / match_areas score but no published map metric carries. They
# read through the same match evidence loader (repository.range_rows), so an agent can verify one
# area's value (get_area_metric) or rank areas by it (rank_areas_by_metric). Values are the latest in
# the active release: a factor has no monthly history, so `period` is accepted and ignored.
FACTOR_METRICS = {
    "disorder": {"label": "Visible disorder", "unit": "per 1,000", "direction": "lower",
                 "description": "Anti-social behaviour, criminal damage and arson and public order incidents per "
                                "1,000 residents over 12 months (police.uk).",
                 "caveat": home_search.QUICK_CAVEATS["disorder"]},
    "epc-share": {"label": "Energy rating", "unit": "% of homes rated A-C", "direction": "higher",
                  "description": "Share of homes with an EPC rated A-C (Energy Performance Certificates).",
                  "caveat": home_search.QUICK_CAVEATS["epc-share"]},
    "leasehold-share": {"label": "Leasehold share of sales", "unit": "% of sales leasehold", "direction": "lower",
                        "description": "Share of the last 12 months' recorded sales that were leasehold (HM Land "
                                       "Registry Price Paid); an LSOA with under 10 sales of known tenure carries "
                                       "its MSOA's share (quality fallback, carrierGeographyId).",
                        "caveat": home_search.QUICK_CAVEATS["leasehold-share"]},
    "schools": {"label": "Schools", "unit": None, "direction": "higher",
                "description": "The My match schools factor: nearby state schools weighed by published results.",
                "caveat": "Nearby schools say nothing about admission: grammar schools admit by exam, faith "
                          "schools by their own criteria, others by a distance that changes every year."},
}
FACTOR_CAVEAT = ("A My match factor, not a published map metric: the value is the latest in the active release "
                 "(period is ignored) for neighbourhoods (uk:lsoa:…) only; regionPercentile is the factor's own "
                 "rank of the value within the area's region (London for a London area), lowest = 0.")

_CATALOGUE: dict[str, dict] = {}


def clear_catalogue_cache() -> None:
    _CATALOGUE.clear()


def _catalogue(context: ToolContext, release_id: str) -> dict:
    if release_id not in _CATALOGUE:
        payload = context.reader.list_metrics(cancel=context.cancel)
        _CATALOGUE[payload["productReleaseId"]] = payload
        return payload
    return _CATALOGUE[release_id]


def _list_metrics(context: ToolContext, args: ListMetricsInput) -> dict:
    payload = context.reader.list_metrics(cancel=context.cancel)
    metrics = [*payload["metrics"], *_factor_entries()]
    caveats = [f"kind 'factor' entries ({', '.join(FACTOR_METRICS)}) are My match factors readable with "
               "get_area_metric and rank_areas_by_metric; they have no periods and no provenance row here: "
               "each answer cites its source release."]
    if args.detail:
        metrics, more = _detailed(metrics, args.detail)
        if more:
            caveats.append(f"{more} more metrics match detail; only the first {DETAIL_LIMIT} are shown in full: "
                           "name their ids to read the rest.")
        sources = envelope.sources_for([metric["id"] for metric in metrics], payload)
    else:
        # One row per source release, not per metric: the census alone is ~600 metrics of one release.
        releases = dict.fromkeys(metric["provenance"]["release"] for metric in payload["metrics"])
        sources = [envelope.source_for_release(release, payload) for release in releases]
    if args.compact:
        value = [{"id": metric["id"], "unit": metric["unit"], "direction": metric["direction"],
                  "defaultPeriod": metric["defaultPeriod"]} for metric in metrics]
    elif args.detail:
        value = metrics
    else:
        value = _by_theme(metrics)
        caveats.append("A short list: byUnit maps each unit to its metrics' ids and labels. Pass "
                       "detail=[metric ids or themes] for periods (defaultPeriod), legend, provenance and caveats.")
    return envelope.wrap(
        value, schema_version="tool-list-metrics.v1",
        release_id=payload["productReleaseId"], confidence="high", sources=sources, caveats=caveats)


def _theme(metric: Mapping[str, Any]) -> str:
    """A metric's theme: its methodology guide page (/guide/nature is nature); factors have their own."""
    if metric.get("kind") == "factor":
        return FACTOR_THEME
    return (metric.get("methodologyPath") or "/other").rstrip("/").rsplit("/", 1)[-1]


def _by_theme(metrics: list[dict]) -> list[dict]:
    themes: dict[str, dict[str, dict[str, str]]] = {}
    for metric in metrics:
        units = themes.setdefault(_theme(metric), {})
        units.setdefault(metric["unit"] or "none", {})[metric["id"]] = metric["label"]
    return [{"theme": theme, "count": sum(map(len, units.values())), "byUnit": units}
            for theme, units in themes.items()]


def _detailed(metrics: list[dict], wanted: list[str]) -> tuple[list[dict], int]:
    """The metrics `wanted` names, in catalogue order and at most DETAIL_LIMIT, and how many more matched.
    A name is a metric id, else a theme: "crime" is the crime metric, "nature" every nature metric."""
    ids = set(wanted) & {metric["id"] for metric in metrics}
    themes = set(wanted) - ids
    if unknown := sorted(themes - {_theme(metric) for metric in metrics}):
        raise evidence.MalformedQuery(f"unknown metric or theme: {', '.join(unknown)}; see list_metrics")
    matched = [metric for metric in metrics if metric["id"] in ids or _theme(metric) in themes]
    return matched[:DETAIL_LIMIT], max(0, len(matched) - DETAIL_LIMIT)


def _factor_entries() -> list[dict]:
    return [{"id": factor_id, "kind": "factor", "label": meta["label"], "shortLabel": meta["label"],
             "description": meta["description"], "carrier": "lsoa", "unit": meta["unit"],
             "direction": meta["direction"], "periods": [], "defaultPeriod": "",
             "caveats": [FACTOR_CAVEAT, meta["caveat"]]}
            for factor_id, meta in FACTOR_METRICS.items()]


def _factor_rows(context: ToolContext, factor_id: str) -> list[dict]:
    """One row per neighbourhood for a factor, through the match evidence loader; MetricNotFound when the
    active release holds none."""
    profile = {"schemaVersion": "preference-profile.v2", "market": "buy", "analyticsConsent": False,
               "criteria": [{"kind": "range", "layer": factor_id}]}
    wanted = (factor_id, f"range:{factor_id}")
    seen: dict[str, dict] = {}
    for row in context.load_match_rows(profile):
        if row.get("factor_id") in wanted and row.get("raw_value") is not None:
            seen.setdefault(row["geography_id"], row)
    if not seen:
        raise evidence.MetricNotFound(f"no {factor_id} rows in the active release")
    return list(seen.values())


def _factor_summary(row: Mapping[str, Any], factor_id: str) -> dict:
    """A factor row in the get_area_metric summary shape (no period, no England percentile)."""
    percentile = row.get("percentile") if row.get("percentile") is not None else row.get("utility")
    summary = {"geographyId": row["geography_id"], "name": row.get("name"), "metricId": factor_id, "period": None,
               "value": row["raw_value"],
               "regionPercentile": None if percentile is None else round(float(percentile), 1),
               "countryPercentile": None, "sampleCount": None, "quality": row.get("quality"),
               "sourceVersion": row.get("source_release_id"), "carrier": "lsoa"}
    carrier = row.get("carrier_geography_id")
    if carrier and carrier != row["geography_id"]:
        summary["carrierGeographyId"] = carrier
    if row.get("detail"):
        summary["detail"] = dict(row["detail"])
    return summary


def _factor_caveats(factor_id: str) -> list[str]:
    return [FACTOR_CAVEAT, FACTOR_METRICS[factor_id]["caveat"]]


def _get_factor_metric(context: ToolContext, args: AreaMetricInput) -> dict:
    rows = _factor_rows(context, args.metric_id)
    row = next((row for row in rows if row["geography_id"] == args.area_id), None)
    if row is None:
        raise evidence.AreaNotFound(f"no {args.metric_id} value for {args.area_id}: factors are read per "
                                    "neighbourhood (uk:lsoa:…)")
    summary = _factor_summary(row, args.metric_id)
    catalogue = _catalogue(context, context.reader.list_metrics(cancel=context.cancel)["productReleaseId"])
    return envelope.wrap(
        summary, schema_version="tool-area-metric.v1", release_id=catalogue["productReleaseId"],
        confidence=envelope.confidence_from_quality(summary["quality"]),
        evidence=[envelope.evidence_from_summary(summary)],
        sources=[envelope.source_for_release(summary["sourceVersion"], catalogue)] if summary["sourceVersion"] else [],
        caveats=_factor_caveats(args.metric_id))


def _search_areas(context: ToolContext, args: SearchAreasInput) -> dict:
    payload = context.reader.search_areas(args.q, limit=args.limit, cancel=context.cancel)
    reason = None if payload["results"] else search_text.empty_reason(args.q)  # #230
    return envelope.wrap(
        payload["results"], schema_version="tool-search-areas.v1",
        release_id=payload["productReleaseId"], confidence="none" if reason else "high",
        caveats=["Lookup only: pass a geographyId or addressId to the evidence tools."]
        + ([search_text.reason_text(reason)] if reason else []))


def _get_area_metric(context: ToolContext, args: AreaMetricInput) -> dict:
    if args.metric_id in FACTOR_METRICS:
        return _get_factor_metric(context, args)
    catalogue = context.reader.list_metrics(cancel=context.cancel)
    metric = next((m for m in catalogue["metrics"] if m["id"] == args.metric_id), None)
    if metric is None:
        raise evidence.MetricNotFound(f"unknown metric: {args.metric_id}")
    period = args.period or metric["defaultPeriod"]
    payload = context.reader.get_area(args.area_id, args.metric_id, period, cancel=context.cancel)
    summary = payload["summary"]
    # #235: metricTimeline is the full ascending history; evidence = the months before the period.
    timeline = [row for row in payload["metricTimeline"] if row["period"] < period]
    rows = [summary] + timeline[-TIMELINE_EVIDENCE_LIMIT:]
    catalogue = _catalogue(context, payload["productReleaseId"])
    caveats = _metric_caveats(args.metric_id, catalogue)
    if args.metric_id == home_search.PRICE_METRIC and summary.get("areaCount") is not None:
        # The £/m² row is the on-the-fly median of LSOA values, not of the area's own sales (#208).
        caveats = [evidence.PRICE_WITHIN_CAVEAT, *caveats]
    unit = _metric_unit(args.metric_id, catalogue)
    value = {**summary, "unit": unit} if unit else summary
    return envelope.wrap(
        value, schema_version="tool-area-metric.v1",
        release_id=payload["productReleaseId"],
        confidence=envelope.confidence_from_quality(summary["quality"]),
        evidence=[envelope.evidence_from_summary(row) for row in rows],
        sources=envelope.sources_for([args.metric_id], catalogue),
        caveats=caveats)


def _rank_areas(context: ToolContext, args: RankAreasInput) -> dict:
    if evidence.is_never_ranked(args.metric_id):
        raise InvalidToolArguments("Census layers (census-*, student-share) describe who lives in an area and are "
                                   "never ranked; "
                                   "use get_area_metric for one area's figure")
    if args.metric_id in FACTOR_METRICS:
        rows = _factor_rows(context, args.metric_id)
        values = [_factor_summary(row, args.metric_id) for row in rows]
        release_id = context.reader.list_metrics(cancel=context.cancel)["productReleaseId"]
        unit = rows[0].get("unit") or FACTOR_METRICS[args.metric_id]["unit"]
        caveats = _factor_caveats(args.metric_id)
        sources = [{"release": release} for release in sorted({row["sourceVersion"] for row in values
                                                               if row["sourceVersion"]})]
    else:
        payload = context.reader.get_value_pack(args.metric_id, args.period, cancel=context.cancel)
        catalogue = _catalogue(context, payload["productReleaseId"])
        values, release_id = payload["values"], payload["productReleaseId"]
        unit = _metric_unit(args.metric_id, catalogue)
        caveats = _metric_caveats(args.metric_id, catalogue)
        sources = envelope.sources_for([args.metric_id], catalogue)
    region = region_code(args.region)
    if region is not None:
        region_map = regions.area_regions(context.reader._connect)
        values = [row for row in values if region_map.get(row["geographyId"]) == region]
    scored = [row for row in values if row["value"] is not None]
    scored.sort(key=lambda row: row["value"], reverse=args.order == "desc")
    counts = Counter(row["value"] for row in scored)
    top = scored[:args.top_n]
    ranked, rank, previous = [], 0, None
    for index, row in enumerate(top):
        if row["value"] != previous:  # competition ranks: tied values share a rank (#220)
            rank, previous = index + 1, row["value"]
        ranked.append({"rank": rank, "tiedCount": counts[row["value"]],
                       "geographyId": row["geographyId"], "name": row["name"],
                       "value": row["value"], "unit": unit, "quality": row["quality"]})
    if top:
        boundary = top[-1]["value"]
        shown = sum(1 for row in top if row["value"] == boundary)
        if counts[boundary] > shown:
            # The top N cuts inside a tie: the order within it is arbitrary.
            unit_text = f" {unit}" if unit else ""
            caveats = caveats + [
                f"{counts[boundary]} areas share the value {boundary}{unit_text}: tied areas "
                f"share a rank and their order is arbitrary."]
    return envelope.wrap(
        ranked, schema_version="tool-rank-areas.v1", release_id=release_id,
        confidence=envelope.combined_confidence(
            envelope.confidence_from_quality(row["quality"]) for row in top),
        evidence=[envelope.evidence_from_summary(row) for row in top],
        sources=sources,
        caveats=caveats)


def _get_address_history(context: ToolContext, args: AddressHistoryInput) -> dict:
    payload = context.reader.get_address_history(args.address_id, cancel=context.cancel)
    history = payload["history"]
    catalogue = _catalogue(context, payload["productReleaseId"])
    sales = [{"kind": "recorded-sale", "addressId": history["addressId"], **txn}
             for txn in history["transactions"]]
    # Hidden homes never reach here (the reader does not find them), so they get no links.
    value = {**history, "listingLinks": home_search.home_listing_links(history["postcode"])}
    return envelope.wrap(
        value, schema_version="tool-address-history.v1",
        release_id=payload["productReleaseId"],
        confidence="high" if sales else "none", evidence=sales,
        sources=home_search.release_sources(context, [history["sourceVersion"]], catalogue),
        caveats=[history["estimateDisclaimer"]])


def _get_market_depth(context: ToolContext, args: MarketDepthInput) -> dict:
    payload = context.reader.get_market_depth(args.area_id, cancel=context.cancel)
    return market_depth.wrap_market(payload, _catalogue(context, payload["productReleaseId"]),
                              schema_version="tool-market-depth.v1")


def _get_nearby_sales_summary(context: ToolContext, args: AddressHistoryInput) -> dict:
    payload = context.reader.get_nearby_sales_summary(args.address_id, cancel=context.cancel)
    summary = {key: payload[key] for key in ("addressId", "windowYears", "building", "street", "disclaimer")}
    return market_depth.wrap_nearby_summary(payload["productReleaseId"], summary, payload["sources"],
                                      _catalogue(context, payload["productReleaseId"]))


def _get_area_evidence_pack(context: ToolContext, args: AreaPackInput) -> dict:
    payload = context.reader.get_area_pack(args.area_id, args.address_id, cancel=context.cancel)
    return market_depth.wrap_pack(payload, _catalogue(context, payload["productReleaseId"]),
                            schema_version="tool-area-evidence-pack.v1")


def _match_areas(context: ToolContext, args: MatchAreasInput) -> dict:
    validate_match_request(args.profile)
    rows = context.load_match_rows(args.profile)
    if not rows:
        raise evidence.ReleaseUnavailable("No validated factor release is loaded")
    pack = build_match_pack(args.profile, rows, **repository.match_zones(
        args.profile, context.load_zone_lsoas, context.load_zone_distances))
    # Bounded for agents: the best top_n scored areas, whole-London counts, and evidence only for
    # the listed areas. build_match_pack stays whole: the website's /api/v1/matches colours every
    # LSOA from the same pack, and finds nothing removed here.
    listed = [result for result in pack["values"] if match_model.is_scored(result)][:args.top_n]
    excluded = [result for result in pack["values"] if result["excluded"]]
    try:
        map_url = share_links.map_url(args.profile)
    except (KeyError, ValueError, TypeError):
        # A minimal profile (no map-panel extras like "school") has no share link; the match still stands.
        map_url = None
    value = {
        **pack, "values": listed, "listed": len(listed),
        "unscored": sum(1 for result in pack["values"] if not result["excluded"] and result["score"] is None),
        "excluded": len(excluded),
        "excludedBy": dict(Counter(code for result in excluded for code in result["unmetLimits"])),
        "mapUrl": map_url,
    }
    components = [{"kind": "match-component", "geographyId": result["geographyId"], **component}
                  for result in listed for component in result["components"]]
    return envelope.wrap(
        value, schema_version="tool-match-areas.v2", release_id=pack["sourceReleaseSet"],
        # Confidence comes from the components of the listed areas, not from every factor
        # row loaded for all of London (an unseen suppressed row must not drag the whole
        # match down).
        confidence=envelope.combined_confidence(
            envelope.confidence_from_quality(component["quality"]) for component in components)
        if components else "none",
        evidence=components,
        sources=[{"release": release} for release in pack["sourceReleaseSet"].split("+")],
        caveats=["Scores are relative to the submitted profile: the weighted geometric mean of each ranked "
                 "criterion's fit (weights from the order, rank-order centroid); a criterion with no data for an "
                 "area counts as half a fit and lowers evidenceCompleteness.",
                 "excluded areas fail a must criterion and are counted in excludedBy, not listed (unmetLimits); "
                 "percentile is the listed area's place among the scored areas (100 = best match); bottom lists "
                 "the 10 least like the search with the criteria that sink them. Say 'least like your search', "
                 "never 'worst' or 'avoid'.",
                 "Outside the Where zones the fit falls with distance (softMetres); only a must Where filters."])


LEVEL_CONFIDENCE = {"lsoa": "high", "msoa": "medium", "borough": "low"}


def _get_home_prices(context: ToolContext, args: HomePricesInput) -> dict:
    """One home's recorded sales and its area's prices (never a figure for the home itself)."""
    ref = args.property_ref.strip()
    try:
        if ref.isdigit():
            found = context.reader.get_property(ref, cancel=context.cancel)
        elif ref.startswith("uk:addr:"):
            found = context.reader.find_home_by_address(ref, cancel=context.cancel)
        else:
            found = context.reader.find_property(ref, cancel=context.cancel)
    except evidence.PropertyAmbiguous as ambiguous:
        return _ambiguous_home_prices(ambiguous)
    home = found["property"]
    if home["uprn"] is None:
        payload = property_profile.address_profile(context.reader._connect, home["addressId"],
                                                   cancel=context.cancel)
    else:
        payload = property_profile.property_profile(context.reader._connect, home["uprn"],
                                                    cancel=context.cancel)
    profile = payload["profile"]
    prices = profile["areaPrices"]
    value = {key: profile[key] for key in ("uprn", "addressId", "displayAddress", "postcode", "areas", "sales")}
    value["areaPrices"] = prices
    value["valuation"] = profile["valuation"]  # null unless CLOSE_KNIT_PER_HOME_VALUATION is on
    # The key is kept while the point is withheld (AGENTS.md): the home's OS Open UPRN
    # point is served by the property page already, but MCP stays at LSOA precision
    # until the owner decides (B7, #156). "uprn" when it is the dwelling's point.
    value["location"] = None
    value["locationPrecision"] = None
    # B11: the profile's facts and withheld ride along unfiltered; _facts() already
    # goes through per_home(), so the flags keep full control (keys kept, nulls off).
    value["facts"] = profile["facts"]
    value["withheld"] = profile["withheld"]
    catalogue = _catalogue(context, payload["productReleaseId"])
    level = prices["range"]["level"] if prices["range"] else None
    return envelope.wrap(
        value, schema_version="tool-home-prices.v1", release_id=payload["productReleaseId"],
        confidence=LEVEL_CONFIDENCE.get(level or "", "none"),
        evidence=[{"kind": "recorded-sale", "uprn": profile["uprn"], "date": sale["date"],
                   "nominalPrice": sale["price"], "sourceUrl": sale["sourceUrl"],
                   "sourceVersion": sale.get("sourceVersion")} for sale in profile["sales"]],
        sources=[*home_search.release_sources(context, [profile["sourceVersion"]], catalogue),
                 *envelope.sources_for(["price-per-square-metre"], catalogue)],
        caveats=[prices["disclaimer"], *profile["caveats"],
                 *([valuation.WORDING] if profile["valuation"] else [])])


def _ambiguous_home_prices(ambiguous: evidence.PropertyAmbiguous) -> dict:
    """Several homes matched a fragment: no forced single match (B2). The value is
    null and the candidates (up to 10) go back so the agent can ask which home."""
    out = envelope.wrap(
        None, schema_version="tool-home-prices.v1", release_id=ambiguous.product_release_id,
        confidence="none",
        caveats=["Several homes match; ask which one, or pass its addressId."])
    out["candidates"] = ambiguous.candidates
    return out


def _metric_unit(metric_id: str, catalogue: Mapping[str, Any]) -> str | None:
    for metric in catalogue["metrics"]:
        if metric["id"] == metric_id:
            return metric["unit"]
    return None


def _metric_caveats(metric_id: str, catalogue: Mapping[str, Any]) -> list[str]:
    for metric in catalogue["metrics"]:
        if metric["id"] == metric_id:
            return list(metric.get("caveats", []))
    return []


def home_prices_description() -> str:
    """get_home_prices guidance, built with the valuation flag (servers read flags at start)."""
    guidance_text = (
        "`valuation`, when present, is an indicative model estimate, not a valuation; quote it only with "
        "its range and that wording. `vsLocalTypeMedian` and `vsLocalMedianPerSqm` are percentage "
        "differences. Otherwise describe the area."
        if feature_flags.per_home_valuation() else
        "Area statistics only: never say what the home is worth; describe the area.")
    return ("One London home's recorded sales (date, price, HM Land Registry link) and prices in its area "
            "today: the middle half (25th-75th percentile) of same-type standard sales since three years back, "
            "each adjusted to the latest month by the local price index, with sample size and the area used "
            "(LSOA, else MSOA, else borough), and the coarse band its last sale fell in that year (top 10%, "
            "top quarter, upper middle, lower middle, bottom quarter, bottom 10%) with today's prices of that "
            f"band in the area. Accepts a UPRN, an address id (uk:addr:…) from search_places, or an address "
            f"fragment. {guidance_text} When a fragment matches several homes the tool returns their "
            "candidates instead of picking one: ask which home, or pass its addressId. Homes without a "
            "linked UPRN are reached by address id or fragment and carry uprn null. `facts` holds the "
            "home's type and tenure (Land Registry) and, where shown, energy-certificate facts (rating, "
            "potential rating, certificate date, built form, age band, rooms, floor level); null fields are "
            "not shown for this home; `withheld` lists features held back. Below 5 sales of the "
            "type nothing is shown. Hidden homes are not found.")


def _spec(name: str, description: str, model: type[BaseModel], handler, version: str) -> ToolSpec:
    return ToolSpec(name, description, model, handler, version, ("area",))


AREA_TOOLS = [
    _spec("list_metrics",
          "List every area metric the active release serves by theme (id, label, unit), plus the My match "
          "factors (theme my-match-factors: disorder, epc-share, leasehold-share, schools) that "
          "get_area_metric and rank_areas_by_metric also read. Call first to learn valid metric_id values; "
          "detail=[metric ids or themes] returns those in full (periods, defaultPeriod, legend, provenance, "
          "caveats); compact=true returns id, unit, direction and defaultPeriod for every metric. Sources "
          "carry licence and attribution.",
          ListMetricsInput, _list_metrics, "tool-list-metrics.v1"),
    _spec("search_areas",
          "Resolve free text (area name, ONS code, postcode, street) to geography ids "
          "(uk:lsoa|msoa|borough:…) and, where recorded sales exist, address ids (uk:addr:…). "
          "Use the returned ids with get_area_metric, rank_areas_by_metric, get_address_history. "
          "It only looks names up: to shortlist where to live use find_areas, to resolve a household's places "
          "(work, a station, a school) for find_areas or get_commute use search_places.",
          SearchAreasInput, _search_areas, "tool-search-areas.v1"),
    _spec("get_area_metric",
          "Evidence-backed value of one metric for one area in one month: value, regional "
          "(regionPercentile: within the area's region, London for a London area; rankScope names it) and "
          "England percentiles, quality, sample size, category breakdown where available, plus "
          "up to 12 prior months as evidence rows. Units follow the metric (per 1,000 residents, "
          "GBP/m2). Confidence is high only for observed (not modelled) values. Some metrics are "
          "published for a wider area (income per MSOA; rent change and mobile coverage per "
          "borough): on a smaller area they return the enclosing area's value with quality "
          "'fallback' and carrierGeographyId naming where it came from. Period defaults to the "
          "metric's latest. The find_areas factors "
          "disorder, epc-share, leasehold-share and schools are read the same way for one neighbourhood "
          "(latest value, period ignored), to verify or explain a find_areas result.",
          AreaMetricInput, _get_area_metric, "tool-area-metric.v1"),
    _spec("rank_areas_by_metric",
          "Rank every served area (or one region's, region='North West') by one metric for one month and return "
          "the top N with rank, value, unit and quality. Tied values share a rank (competition ranking); each row "
          "carries tiedCount, the number of areas sharing its value. Use it to answer 'which areas have the lowest crime / "
          "highest GBP/m2' or 'the least deprived' (deprivation is the official IMD decile, 10 = least "
          "deprived: order desc), 'the highest household income' (income, GBP a year) or 'the most social "
          "renting' (social-renting, % of households; neutral, never call it better or worse). Areas with "
          "suppressed values are excluded. Census layers (census-*, student-share) describe residents and are refused: "
          "never rank areas by who lives there. The find_areas factors disorder, epc-share, leasehold-share "
          "and schools rank too (latest value, period ignored). One metric only: to weigh several criteria, "
          "budget or commute for a household use find_areas.",
          RankAreasInput, _rank_areas, "tool-rank-areas.v1"),
    _spec("get_address_history",
          "Recorded achieved sale prices for one address id (HM Land Registry Price Paid, GBP, with the "
          "EPC floor area where matched; no per-sale GBP/m2). These are historic transactions, never "
          "valuations or asking prices. listingLinks open the "
          "postcode on Rightmove (past listings and their photos), Zoopla and OnTheMarket: links only, "
          "Close Knit does not fetch or host listings.",
          AddressHistoryInput, _get_address_history, "tool-address-history.v1"),
    _spec("get_home_prices", home_prices_description(), HomePricesInput, _get_home_prices, "tool-home-prices.v1"),
    _spec("match_areas",
          "Score every area against a household's ordered criteria (preference-profile.v2: budget, "
          "ranges on any map layer, places, where zones, own criteria; must = filter). Returns a match-pack.v2 "
          "with the best top_n (default 20, max 100) areas as a list with score, rank and percentile per area, "
          "its top 2 reasons and 2 weakest criteria, the bottom 10, and per-criterion components (value, fit, "
          "in/edge/out) as evidence for the listed areas only. Whole-coverage counts (scored, unscored, excluded, "
          "and excludedBy per unmet must) cover every area; mapUrl opens the full map for the search. Set "
          "analyticsConsent true only if the user agreed to store an anonymised profile summary; the tool works "
          "identically with false. Takes a ready profile (built by you or exported from the site); for a "
          "conversational home search use find_areas, which builds the profile from plain answers and adds "
          "ballpark prices.",
          MatchAreasInput, _match_areas, "tool-match-areas.v2"),
    _spec("get_market_depth",
          "Local market depth of one LSOA or MSOA from HM Land Registry Price Paid (standard category A "
          "sales only): sales in the last 12 months, turnover (% of EPC-linked homes that sold), the "
          "leasehold share OF SALES (not of homes), new-build and resale median GBP/m2 over 36 months with "
          "the new-build premium (each median needs 10 sales, the premium both), and the LSOA's GBP/m2 "
          "growth. Aggregates only: never a valuation, a listing or addresses.",
          MarketDepthInput, _get_market_depth, "tool-market-depth.v1"),
    _spec("get_nearby_sales_summary",
          "Counts and median GBP/m2 of other homes' recorded sales in the same building (postcode, house "
          "number or name, street) and on the same street (other buildings) as one address id, last 10 "
          "years. The median is withheld under 5 standard sales with an EPC floor area. Summary only: no "
          "sale rows and no addresses; homes with a privacy objection are left out.",
          AddressHistoryInput, _get_nearby_sales_summary, "tool-nearby-sales-summary.v1"),
    _spec("get_area_evidence_pack",
          "One cited evidence pack for an area: market depth (as get_market_depth), the latest recorded "
          "crime rate, road and rail noise shares, state schools within 1.5 km with their standing "
          "Ofsted grade, and, given an address_id inside the area, its building and street sale aggregates. "
          "Every block names its source release; not advice and not a valuation.",
          AreaPackInput, _get_area_evidence_pack, "tool-area-evidence-pack.v1"),
]

TOOLS: dict[str, ToolSpec] = {spec.name: spec for spec in AREA_TOOLS + home_search.TOOLS + feedback.TOOLS}


def call_tool(name: str, context: ToolContext, arguments: Mapping[str, Any]) -> dict:
    spec = TOOLS.get(name)
    if spec is None:
        raise ToolNotFound(name)
    try:
        # Old area ids (uk:borough:..., step R2) read as the current ones.
        args = spec.input_model.model_validate(kinds.canonical_value(dict(arguments)))
    except ValidationError as error:
        raise InvalidToolArguments(_format_validation(error)) from error
    # MCP and /tools answers carry the deprecated old field names too (contract_aliases, step R1).
    return contract_aliases.with_aliases(spec.handler(context, args))


def _format_validation(error: ValidationError) -> str:
    parts = [f"{'.'.join(str(p) for p in item['loc']) or '<root>'}: {item['msg']}"
             for item in error.errors()]
    return "; ".join(parts)
