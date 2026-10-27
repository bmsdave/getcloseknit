"""Local market depth and the area evidence pack (wave 1 / feature 6).

For professionals: how many homes sell in an area, how fast the stock turns
over, the leasehold share of sales, the new-build premium and the area's
£/m² growth, then the same plus crime, noise and nearby schools as one cited
pack. Counts, medians and shares only — never a valuation, a listing or an
address list; nothing about ownership. Rows come from `area_market_depth`
(migration 014), rebuilt by rebuild_market_depth() after each sales load.
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping

from . import envelope

SALES_WINDOW_MONTHS = 12
PRICE_WINDOW_MONTHS = 36
# A median needs this many sales; the premium needs it on both sides. The
# migration applies the same gate, the payload applies it again.
MARKET_MEDIAN_MIN = 10
PACK_SCHOOL_LIMIT = 10
PACK_INDEPENDENT_LIMIT = 5
MARKET_CARRIERS = ("lsoa", "msoa")
# #238: the commonest offence types in the crime block, and the share of one non-residential type
# (shoplifting) above which the resident rate describes a busy centre more than its homes.
CRIME_TOP_TYPES = 4
SHOP_TYPE = "Shoplifting"
BUSY_CENTRE_SHARE = 0.3

MARKET_SQL = """-- evidence:market-depth
SELECT d.geography_id, to_char(d.period_end, 'YYYY-MM-DD') AS period_end, d.sales_12m, d.dwellings,
  d.dwellings_sold_12m, d.turnover_percent, d.tenure_known_12m, d.leasehold_share_of_sales,
  d.new_build_sample_36m, d.resale_sample_36m, d.new_build_median_ppm, d.resale_median_ppm,
  d.new_build_premium_percent, to_char(d.growth_period, 'YYYY-MM') AS growth_period,
  d.growth_1y, d.growth_3y, d.growth_5y, d.growth_10y, d.source_release_id
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN area_market_depth d ON d.source_release_id = member.source_release_id
WHERE d.geography_id = %s"""

SOURCE_RELEASES_SQL = """-- evidence:source-releases
SELECT s.id, s.source_url, s.licence, s.attribution, s.transformation_version
FROM source_release s
WHERE s.id = ANY(%s)
ORDER BY s.id"""

ACTIVE_SOURCE_RELEASES_SQL = """-- evidence:active-source-releases
SELECT s.id, s.source_url, s.licence, s.attribution, s.transformation_version
FROM active_product_release a
JOIN product_release_member m ON m.release_id = a.release_id
JOIN source_release s ON s.id = m.source_release_id
ORDER BY s.id"""

MARKET_CAVEATS = (
    "Category A (standard market) sales from HM Land Registry Price Paid: counts, medians and shares, "
    "never a valuation, an asking price or a listing.",
    "The window ends at the latest recorded sale, not today: Price Paid lags completions by months.",
    "Turnover is the share of recorded homes — homes sold since 1995 with an EPC-linked UPRN — "
    "that had a standard sale in the last 12 months; that population is not the full housing stock.",
    "Leasehold share is the share of the last 12 months' sales recorded as leasehold, not the share "
    "of homes that are leasehold.",
    f"New-build and resale medians use {PRICE_WINDOW_MONTHS} months of sales with an EPC floor area; "
    f"each needs {MARKET_MEDIAN_MIN} sales and the premium needs both. The mix of flats and houses can "
    "differ between the two.",
    "Growth is the change of the LSOA's rolling £/m² index; MSOAs have no index of their own here.",
    "Shared-ownership first-tranche sales are not separated from standard sales here (Price Paid "
    "does not label them): a block of part-share sales can drag a median down (issue #211).",
)
PACK_CAVEATS = (
    "Area evidence from public releases, each cited with its release id; not advice and not a "
    "valuation of any home.",
    "Crime is recorded street-level crime per 1,000 residents over 12 months; published locations "
    "are anonymised by the police.",
    "Schools are those within 1.5 km of the area's centre by straight-line distance; distance says "
    "nothing about admission.",
    "schools.independent counts independent schools (DfE Get Information about Schools) within the same "
    "radius: no Ofsted grade (most are ISI-inspected), outside the state counts and ranks.",
)
INDEPENDENT_NOTE = "No Ofsted grade: most independent schools are inspected by the ISI, not Ofsted."


def market_section(row: Mapping[str, Any] | None) -> dict:
    """The market-depth block (also the `market` member of the pack)."""
    if row is None:
        return {"available": False, "periodEnd": None, "salesWindowMonths": SALES_WINDOW_MONTHS,
                "salesCount": None, "dwellings": None, "dwellingsSold": None, "turnoverPercent": None,
                "leaseholdShareOfSales": None, "tenureKnownSales": None,
                "priceWindowMonths": PRICE_WINDOW_MONTHS, "minimumSample": MARKET_MEDIAN_MIN,
                "newBuild": None, "resale": None, "newBuildPremiumPercent": None, "growth": None,
                "sourceVersion": None}
    new_n, resale_n = int(row["new_build_sample_36m"]), int(row["resale_sample_36m"])
    both = new_n >= MARKET_MEDIAN_MIN and resale_n >= MARKET_MEDIAN_MIN
    premium = row["new_build_premium_percent"]
    return {
        "available": True,
        "periodEnd": row["period_end"],
        "salesWindowMonths": SALES_WINDOW_MONTHS,
        "salesCount": int(row["sales_12m"]),
        "dwellings": int(row["dwellings"]),
        "dwellingsSold": int(row["dwellings_sold_12m"]),
        "turnoverPercent": _round(row["turnover_percent"], 2),
        "leaseholdShareOfSales": _round(row["leasehold_share_of_sales"], 3),
        "tenureKnownSales": int(row["tenure_known_12m"]),
        "priceWindowMonths": PRICE_WINDOW_MONTHS,
        "minimumSample": MARKET_MEDIAN_MIN,
        "newBuild": _median(row["new_build_median_ppm"], new_n),
        "resale": _median(row["resale_median_ppm"], resale_n),
        "newBuildPremiumPercent": _round(premium, 1) if both else None,
        "growth": _growth(row),
        "sourceVersion": row["source_release_id"],
    }


def market_payload(release_id: str, geography: Mapping[str, Any], row: Mapping[str, Any] | None,
                   sources: list[dict]) -> dict:
    section = market_section(row)
    return {
        "schemaVersion": "area-market.v1",
        "productReleaseId": release_id,
        **_area(geography),
        **section,
        "sources": sources,
        "caveats": [*MARKET_CAVEATS, *growth_caveats(section.get("growth"))],
    }


def crime_section(rows: list[Mapping[str, Any]], breakdown: Mapping[str, int] | None = None) -> dict | None:
    """Latest released crime rate of the area (LSOA metric: MSOAs and boroughs have none), with the
    commonest offence types of that month and a busy-centre note when shoplifting dominates (#238)."""
    if not rows:
        return None
    row = rows[-1]
    section = {"period": row["period"], "value": row["value"], "unit": "per 1,000 residents",
               "regionPercentile": row["region_percentile"], "quality": row["quality"],
               "sourceVersion": row["source_release_id"]}
    total = sum(count for count in (breakdown or {}).values() if count)
    if not total:
        return section
    ranked = sorted(((count, category) for category, count in breakdown.items() if count > 0),
                    key=lambda item: (-item[0], item[1]))
    section["offences"] = total
    section["topTypes"] = [{"category": category, "offences": count, "sharePercent": round(100 * count / total, 1)}
                           for count, category in ranked[:CRIME_TOP_TYPES]]
    shop = breakdown.get(SHOP_TYPE) or 0
    section["busyCentre"] = shop / total >= BUSY_CENTRE_SHARE
    if section["busyCentre"] and row["value"] is not None:
        without = round(float(row["value"]) * (total - shop) / total, 1)
        section["rateExcludingShoplifting"] = without
        section["note"] = (f"{SHOP_TYPE} is {round(100 * shop / total)}% of offences here: a busy shopping or "
                           f"transport centre, where counts include shops and stations; without it the rate is "
                           f"{without} per 1,000 residents.")
    return section


def noise_section(noise: Mapping[str, Any]) -> dict:
    keys = ("available", "dwellings", "road55Share", "rail55Share", "air55Share", "any55Share",
            "any65Share", "roadLdenMedian", "roadLdenMappedShare", "sourceVersion")
    return {key: noise[key] for key in keys}


def independent_section(rows: list[Mapping[str, Any]]) -> dict:
    """Independent schools within the radius (migration 067): a count and the nearest few, no grade (#250)."""
    def ages(row):
        low, high = row.get("age_from"), row.get("age_to")
        return None if low is None or high is None else f"{low}-{high}"
    return {"count": len(rows), "note": INDEPENDENT_NOTE,
            "nearest": [{"urn": row["urn"], "name": row["name"], "ages": ages(row), "gender": row.get("gender"),
                         "faith": row.get("religious_character"), "sixthForm": row.get("sixth_form"),
                         "distanceMetres": row["distance_metres"], "sourceVersion": row.get("source_release_id")}
                        for row in rows[:PACK_INDEPENDENT_LIMIT]]}


def schools_section(schools: list[Mapping[str, Any]], radius_metres: int,
                    counts: Mapping[str, Any] | None = None,
                    independent: list[Mapping[str, Any]] | None = None) -> dict:
    """Counts by phase and the nearest few, without any admission claim. `counts` is the uncapped
    AREA_SCHOOL_COUNTS_SQL row; without it the (LIMIT-capped) list is counted (#227). `independent`
    is the list of independent schools in the radius, None before migration 067 is applied (#250)."""
    phases = [str(school.get("phase") or "").lower() for school in schools]
    primary = int(counts["primary_count"]) if counts else sum("primary" in phase for phase in phases)
    secondary = int(counts["secondary_count"]) if counts else sum("secondary" in phase for phase in phases)
    return {
        "radiusMetres": radius_metres,
        "count": primary + secondary if counts else len(schools),
        "primary": primary,
        "secondary": secondary,
        "nearest": [{"urn": school["urn"], "name": school["name"], "phase": school["phase"],
                     "distanceMetres": school["distanceMetres"], "latestInspection": _latest_inspection(school),
                     "standingInspection": _standing_inspection(school),
                     "reportCard": _report_card(school),
                     "sourceVersion": school["sourceVersion"]}
                    for school in schools[:PACK_SCHOOL_LIMIT]],
        "independent": None if independent is None else independent_section(independent),
    }


def nearby_summary(nearby: Mapping[str, Any]) -> dict:
    """Building and street aggregates of nearby-sales.v1, without the sale rows."""
    def group(value: Mapping[str, Any] | None) -> dict | None:
        if value is None:
            return None
        return {key: value[key] for key in ("saleCount", "excludedPartShare", "medianPricePerSquareMetre",
                                                   "medianSampleSize")}
    return {"addressId": nearby["addressId"], "windowYears": nearby["windowYears"],
            "building": group(nearby["building"]), "street": group(nearby["street"]),
            "disclaimer": nearby["disclaimer"]}


def pack_payload(release_id: str, geography: Mapping[str, Any], *, market: dict, crime: dict | None,
                 noise: dict, schools: dict, nearby: dict | None, sources: list[dict]) -> dict:
    return {
        "schemaVersion": "area-evidence-pack.v1",
        "productReleaseId": release_id,
        **_area(geography),
        "market": market,
        "crime": crime,
        "noise": noise,
        "schools": schools,
        "nearbySales": nearby,
        "sources": sources,
        "caveats": [*PACK_CAVEATS, *MARKET_CAVEATS, *growth_caveats(market.get("growth"))],
    }


def source_rows(rows: Iterable[Mapping[str, Any]]) -> list[dict]:
    return [{"release": row["id"], "sourceUrl": row["source_url"], "licence": row["licence"],
             "attribution": row["attribution"], "transformationVersion": row["transformation_version"]}
            for row in rows]


def active_source_releases(connection: Any) -> dict[str, dict]:
    """Every source release in the active product release, as full source rows keyed by id."""
    return {row["release"]: row for row in source_rows(connection.execute(ACTIVE_SOURCE_RELEASES_SQL))}


def release_provenance(release_ids: Iterable[str], catalogue: Mapping[str, Any],
                       table: Mapping[str, Mapping[str, Any]] | None = None) -> list[dict]:
    """Release-level provenance for each release id (deduped, order kept). Issue #215.

    Starts from the catalogue's release-level row (``envelope.source_for_release``, the
    #167 rule: never another metric's ``metricId``, ``methodologyPath`` or ``caveats``)
    and lets ``table`` (``EvidenceReader.source_releases()``) overwrite sourceUrl,
    licence, attribution and transformationVersion: the ``source_release`` table is
    the authority. A release known nowhere stays a bare ``{"release": ...}`` row.
    """
    table = table or {}
    return [{**envelope.source_for_release(release_id, catalogue), **table.get(release_id, {})}
            for release_id in dict.fromkeys(release_ids)]


# --- envelopes (REST v1 routes and agent tools share these) -----------------

def market_confidence(market: Mapping[str, Any]) -> str:
    """none without sales; low under 10 sales; medium while the premium is withheld; else high."""
    count = market.get("salesCount") or 0
    if not market.get("available") or count == 0:
        return "none"
    if count < MARKET_MEDIAN_MIN:
        return "low"
    return "high" if market.get("newBuildPremiumPercent") is not None else "medium"


def market_evidence(geography_id: str, market: Mapping[str, Any]) -> list[dict]:
    if not market.get("available"):
        return []
    rows = [{"kind": "sales-count", "geographyId": geography_id, "periodEnd": market["periodEnd"],
             "windowMonths": market["salesWindowMonths"], "value": market["salesCount"],
             "sourceVersion": market["sourceVersion"]}]
    for segment in ("newBuild", "resale"):
        median = market[segment]
        rows.append({"kind": "median-price-per-square-metre", "geographyId": geography_id,
                     "segment": segment, "periodEnd": market["periodEnd"],
                     "windowMonths": market["priceWindowMonths"], "value": median["medianPricePerSquareMetre"],
                     "sampleCount": median["sampleSize"], "sourceVersion": market["sourceVersion"]})
    return rows


def wrap_market(payload: Mapping[str, Any], catalogue: Mapping[str, Any],
                schema_version: str = "area-market.v1") -> dict:
    return envelope.wrap(
        payload, schema_version=schema_version, release_id=payload["productReleaseId"],
        confidence=market_confidence(payload),
        evidence=market_evidence(payload["geographyId"], payload),
        sources=enrich_sources(payload["sources"], catalogue), caveats=payload["caveats"])


def wrap_pack(payload: Mapping[str, Any], catalogue: Mapping[str, Any],
              schema_version: str = "area-evidence-pack.v1") -> dict:
    crime = payload["crime"]
    bands = [market_confidence(payload["market"])]
    if crime is not None:
        bands.append(envelope.confidence_from_quality(crime["quality"]))
    evidence = market_evidence(payload["geographyId"], payload["market"])
    if crime is not None:
        evidence.append({"kind": "metric-observation", "geographyId": payload["geographyId"],
                         "metricId": "crime", "period": crime["period"], "value": crime["value"],
                         "quality": crime["quality"], "sourceVersion": crime["sourceVersion"]})
    return envelope.wrap(
        payload, schema_version=schema_version, release_id=payload["productReleaseId"],
        confidence=envelope.combined_confidence(bands), evidence=evidence,
        sources=enrich_sources(payload["sources"], catalogue), caveats=payload["caveats"])


def wrap_nearby_summary(release_id: str, summary: Mapping[str, Any], sources: list[dict],
                        catalogue: Mapping[str, Any]) -> dict:
    groups = {scope: summary[scope] for scope in ("building", "street") if summary[scope] is not None}
    if any(group["medianPricePerSquareMetre"] is not None for group in groups.values()):
        confidence = "high"
    elif any(group["saleCount"] for group in groups.values()):
        confidence = "low"
    else:
        confidence = "none"
    return envelope.wrap(
        summary, schema_version="tool-nearby-sales-summary.v1", release_id=release_id,
        confidence=confidence,
        evidence=[{"kind": "nearby-sales-aggregate", "scope": scope, "addressId": summary["addressId"],
                   "windowYears": summary["windowYears"], **group} for scope, group in groups.items()],
        sources=enrich_sources(sources, catalogue), caveats=[summary["disclaimer"]])


def enrich_sources(sources: Iterable[Mapping[str, Any]], catalogue: Mapping[str, Any]) -> list[dict]:
    """Source-release rows with release-level provenance from the catalogue.

    Never carries another metric's ``metricId``, ``methodologyPath`` or
    ``caveats``: those belong to a specific metric, and a block (market depth,
    evidence pack, nearby sales) is not a metric. Use
    ``envelope.source_for_release(release, catalogue, metric_id=...)`` when the
    caller actually represents one catalogue metric.
    """
    enriched = []
    for source in sources:
        from_metric = envelope.source_for_release(source["release"], catalogue)
        enriched.append({**source, **{key: value for key, value in from_metric.items()
                                      if value is not None and key != "release"}})
    return enriched


def _area(geography: Mapping[str, Any]) -> dict:
    return {"geographyId": geography["id"], "name": geography["name"], "carrier": geography["kind"]}


def _median(value: Any, sample: int) -> dict:
    gated = value is not None and sample >= MARKET_MEDIAN_MIN
    return {"medianPricePerSquareMetre": int(value) if gated else None, "sampleSize": sample}


def _growth(row: Mapping[str, Any]) -> dict | None:
    if row["growth_period"] is None:
        return None
    growth = {"period": row["growth_period"]}
    for years in ("1y", "3y", "5y", "10y"):
        growth[f"growth{years}"] = _round(row[f"growth_{years}"], 1)
        # Which windows are comparable and how thin the sample is (#163).
        growth[f"growth{years}Quality"] = row.get(f"growth_{years}_quality")
        growth[f"growth{years}SampleCount"] = row.get(f"growth_{years}_n")
    return growth


def growth_caveats(growth: dict | None) -> list[str]:
    """Warn when a growth figure rests on a thin or mixed sample (#163)."""
    if not growth:
        return []
    caveats = []
    for years in ("1y", "3y", "5y", "10y"):
        quality = growth.get(f"growth{years}Quality")
        sample = growth.get(f"growth{years}SampleCount")
        if growth.get(f"growth{years}") is None:
            if quality == "mixed":
                caveats.append(
                    f"The {years} growth is not shown: the index at the two ends of the window "
                    "is not comparable (one end is a fallback from a different area).")
        elif quality == "fallback":
            caveats.append(
                f"The {years} growth is from the wider area's index, not this neighbourhood's.")
        if sample is not None and sample < 30:
            caveats.append(
                f"The {years} growth rests on {sample} sales: treat it as indicative.")
    return caveats


def _round(value: Any, digits: int) -> float | None:
    return None if value is None else round(float(value), digits)


def _standing_inspection(school: Mapping[str, Any]) -> dict | None:
    """The school's standing Ofsted judgement: {grade, framework, year, ungradedVisit}. The pack's
    school_inspection row (evidence.py, the map's rule) when loaded, else the school's own
    observations; an ungraded visit never replaces the standing grade and report-card and legacy
    grades are never blended."""
    from . import schools
    attached = school.get("standingInspection")
    if attached:
        return {"grade": attached.get("grade"), "framework": attached.get("framework"),
                "year": attached.get("year"),
                "ungradedVisit": schools.newest_ungraded(school.get("observations", []))}
    standing = schools.standing_from_observations(school.get("observations", []))
    if standing is None:
        return None
    return {**standing, "ungradedVisit": schools.newest_ungraded(school.get("observations", []))}


def _report_card(school: Mapping[str, Any]) -> dict | None:
    from . import schools
    return schools.report_card(school.get("observations", []))


def _latest_inspection(school: Mapping[str, Any]) -> str | None:
    """The newest inspection outcome as published; when it is an ungraded visit ("Standards
    maintained") the standing grade stands in its place, so the field never reads as a grade.
    A report card, and a graded inspection from September 2024 to November 2025, carry no
    single grade: the field names the framework and year, never one area's grade (#226)."""
    observations = [observation for observation in school.get("observations", [])
                    if str(observation.get("kind", "")).startswith("inspection")]
    if not observations:
        return None
    newest = observations[0]
    from . import schools
    if newest.get("kind") == "inspection-current":
        return f"Report card {newest.get('academicYear') or ''}".strip()
    year = newest.get("academicYear")
    if newest.get("measure") != "Overall effectiveness" and not schools.is_ungraded_visit(
            newest.get("measure"), newest.get("value")) and not any(
            o.get("measure") == "Overall effectiveness" and o.get("academicYear") == year for o in observations):
        return f"Graded areas {year or ''}, no overall grade".replace("  ", " ")
    if schools.is_ungraded_visit(newest.get("measure"), newest.get("value")):
        standing = _standing_inspection(school)
        if standing and standing.get("grade"):
            year = standing.get("year")
            return f"{standing['grade']}{f' ({year})' if year else ''}"
        return "Standing grade not loaded"
    return newest.get("value")
