from dataclasses import dataclass
from datetime import date
from statistics import median
from typing import Iterable, Mapping, Sequence

from .property_history import adjust_by_index, price_per_square_metre


MINIMUM_SAMPLE_SIZE = 20

SQM_PER_SQFT = 10.7639
PRICE_TRANSFORMATION_VERSION = "price-v1"
THIN_SAMPLE = "thin-sample"


@dataclass(frozen=True)
class Sale:
    period: str
    price: int
    floor_area_square_metres: float | None


@dataclass(frozen=True)
class PriceObservation:
    period: str
    median_price_per_square_metre: float | None
    sample_count: int


@dataclass(frozen=True)
class PercentileComparison:
    london: int  # within the area's region (London for London areas; the field keeps its name)
    england: int


@dataclass(frozen=True)
class CrimeRecord:
    period: str
    category: str


@dataclass(frozen=True)
class CrimeObservation:
    period: str
    rate_per_thousand: float
    categories: dict[str, int]


def build_crime_observation(
    period: str, records: Iterable[CrimeRecord], population: int
) -> CrimeObservation:
    if population <= 0:
        raise ValueError("crime denominator must be positive")
    start = _shift_months(_parse_period(period), -11)
    end = _parse_period(period)
    categories: dict[str, int] = {}
    for record in records:
        if _within_period(record.period, start, end):
            categories[record.category] = categories.get(record.category, 0) + 1
    rate = sum(categories.values()) / population * 1_000
    return CrimeObservation(period, rate, categories)


def build_price_observation(period: str, sales: Iterable[Sale]) -> PriceObservation:
    start = _shift_months(_parse_period(period), -11)
    end = _parse_period(period)
    values = [
        value
        for sale in sales
        if _within_period(sale.period, start, end)
        for value in [price_per_square_metre(
            sale.price, sale.floor_area_square_metres)]
        if value is not None
    ]
    result = median(values) if values else None
    return PriceObservation(period, result, len(values))


def choose_reliable_geography(
    candidates: Sequence[tuple[str, int]], minimum_sample: int = MINIMUM_SAMPLE_SIZE
) -> str | None:
    return next((name for name, count in candidates if count >= minimum_sample), None)


def calculate_percentiles(
    value: float, region_values: Sequence[float], england_values: Sequence[float]
) -> PercentileComparison:
    """`region_values`: the area's region (coverage.region_of_code), London for London areas."""
    return PercentileComparison(
        london=_percentile_rank(value, region_values),
        england=_percentile_rank(value, england_values),
    )


def _percentile_rank(value: float, values: Sequence[float]) -> int:
    if not values:
        raise ValueError("percentile population cannot be empty")
    rank = sum(candidate <= value for candidate in values) / len(values)
    return round(rank * 100)


def _parse_period(period: str) -> date:
    year, month = (int(part) for part in period.split("-"))
    return date(year, month, 1)


def _shift_months(value: date, offset: int) -> date:
    month_index = value.year * 12 + value.month - 1 + offset
    return date(month_index // 12, month_index % 12 + 1, 1)


def _within_period(period: str, start: date, end: date) -> bool:
    value = _parse_period(period)
    return start <= value <= end


# Validated recorded-crime release (AE-05). Recorded crime is published as
# observed area statistics over a common twelve-month window, never as a
# neighbourhood score or prediction. Anti-social behaviour stays separate
# from the headline rate, British Transport Police records are excluded by
# policy, and England comparisons are suppressed while coverage is partial.

METROPOLITAN_POLICE = "metropolitan-police"
CITY_OF_LONDON_POLICE = "city-of-london-police"
# London's forces: the default when no area-to-force map names the forces an area release needs.
# build_crime_release requires every force its `lsoa_force` map names (any English force).
REQUIRED_CRIME_FORCES = (METROPOLITAN_POLICE, CITY_OF_LONDON_POLICE)
EXCLUDED_CRIME_FORCES = ("british-transport-police",)
ASB_CATEGORY = "anti-social-behaviour"
CRIME_TRANSFORMATION_VERSION = "crime-v1"
CRIME_GEOGRAPHY_VINTAGE = "2021"
CRIME_WINDOW_MONTHS = 12

MISSING_FORCE_MONTH = "missing-force-month"
MISSING_DENOMINATOR = "missing-denominator"
UNKNOWN_FORCE = "unknown-force"
CONFLICTING_DUPLICATE = "conflicting-duplicate"
INCOMPATIBLE_GEOGRAPHY = "incompatible-geography"
BTP_EXCLUDED = "btp-excluded"
OUTSIDE_WINDOW = "outside-window"


@dataclass(frozen=True)
class PoliceCrimeRecord:
    crime_id: str
    month: str
    category: str
    lsoa_code: str
    force: str


@dataclass(frozen=True)
class LsoaPopulation:
    lsoa_code: str
    population: int
    year: str


@dataclass(frozen=True)
class LsoaCrimeEvidence:
    lsoa_code: str
    window_end: str
    status: str
    reason: str | None
    headline_count: int
    asb_count: int
    rate_per_thousand: float | None
    categories: dict[str, int]
    monthly: dict[str, dict[str, int]]
    asb_monthly: dict[str, int]
    denominator_year: str
    population: int | None


@dataclass(frozen=True)
class BoroughCrimeEvidence:
    borough_code: str
    window_end: str
    status: str
    reason: str | None
    headline_count: int
    asb_count: int
    rate_per_thousand: float | None
    population: int | None
    lsoa_included: int
    lsoa_excluded: int


@dataclass(frozen=True)
class QuarantinedCrimeRecord:
    crime_id: str
    month: str
    category: str
    lsoa_code: str
    force: str
    reason: str


@dataclass(frozen=True)
class CrimeRelease:
    window: tuple[str, ...]
    denominator_year: str
    transformation_version: str
    geography_vintage: str
    coverage: dict
    evidence: tuple
    quarantine: tuple
    boroughs: tuple = ()


@dataclass(frozen=True)
class _AreaCase:
    lsoa_code: str
    population: int | None
    force: str | None
    observed: dict


def select_crime_window(force_months: Mapping[str, Iterable[str]],
                        required: Sequence[str] = REQUIRED_CRIME_FORCES) -> list[str]:
    for force in required:
        if not list(force_months.get(force, ())):
            raise ValueError(f"crime window needs {force} coverage")
    claimed: set[str] = set()
    for force in required:
        claimed.update(force_months[force])
    for end in sorted(claimed, reverse=True):
        window = _twelve_months_ending(end)
        if all(month in claimed for month in window):
            return window
    raise ValueError("crime window needs twelve consecutive months")


def require_full_force_coverage(
    window: Sequence[str], force_months: Mapping[str, Iterable[str]],
    required: Sequence[str] = REQUIRED_CRIME_FORCES,
) -> dict[str, list[str]]:
    missing: dict[str, list[str]] = {}
    for force in required:
        available = set(force_months.get(force, ()))
        missing[force] = [month for month in window if month not in available]
    return missing


def parse_police_record(row: Mapping[str, str], force: str) -> PoliceCrimeRecord:
    return PoliceCrimeRecord(
        crime_id=(row.get("Persistent ID") or "").strip(),
        month=(row.get("Date") or "").strip(),
        category=_normalise_category(row.get("Category") or ""),
        lsoa_code=(row.get("LSOA code") or "").strip(),
        force=force,
    )


def dedupe_police_records(
    records: Iterable[PoliceCrimeRecord],
) -> tuple[list[PoliceCrimeRecord], list[QuarantinedCrimeRecord]]:
    kept: list[PoliceCrimeRecord] = []
    quarantined: list[QuarantinedCrimeRecord] = []
    seen: dict[str, tuple] = {}
    for record in records:
        if not record.crime_id.strip():
            kept.append(record)
        else:
            _dedupe_identified(record, seen, kept, quarantined)
    return kept, quarantined


def _dedupe_identified(record, seen, kept, quarantined) -> None:
    signature = (record.month, record.category, record.lsoa_code, record.force)
    previous = seen.get(record.crime_id)
    if previous is None:
        seen[record.crime_id] = signature
        kept.append(record)
    elif previous != signature:
        quarantined.append(_quarantined(record, CONFLICTING_DUPLICATE))


def build_crime_release(records, populations, lsoa_force, force_months,
                        denominator_year) -> CrimeRelease:
    required = sorted({force for force in lsoa_force.values() if force}) or list(REQUIRED_CRIME_FORCES)
    window = select_crime_window(force_months, required)
    denominators = _index_populations(populations, denominator_year)
    kept, quarantined = dedupe_police_records(records)
    assigned, quarantined = _assign_records(
        kept, window, denominators, lsoa_force, quarantined)
    missing = require_full_force_coverage(window, force_months, required)
    cases = _area_cases(denominators, lsoa_force, assigned)
    evidence = [_area_evidence(case, window, missing, denominator_year)
                for case in cases]
    ordered = sorted(quarantined, key=_quarantine_key)
    return CrimeRelease(tuple(window), denominator_year,
                        CRIME_TRANSFORMATION_VERSION, CRIME_GEOGRAPHY_VINTAGE,
                        _coverage_for(window, denominator_year, missing, required),
                        tuple(evidence), tuple(ordered), ())


def aggregate_borough_crime(evidence, borough_of, populations):
    grouped: dict[str, list] = {}
    for item in evidence:
        borough = borough_of.get(item.lsoa_code)
        if borough is not None:
            grouped.setdefault(borough, []).append(item)
    return [_borough_evidence(borough, grouped[borough], populations)
            for borough in sorted(grouped)]


def with_borough_crime(release, borough_of, populations) -> CrimeRelease:
    boroughs = aggregate_borough_crime(release.evidence, borough_of, populations)
    return CrimeRelease(release.window, release.denominator_year,
                        release.transformation_version,
                        release.geography_vintage, release.coverage,
                        release.evidence, release.quarantine, tuple(boroughs))


def _index_populations(populations, denominator_year) -> dict[str, int]:
    indexed: dict[str, int] = {}
    for entry in populations:
        if entry.year != denominator_year:
            raise ValueError(
                f"crime denominator year must be {denominator_year}")
        previous = indexed.get(entry.lsoa_code)
        if previous is not None and previous != entry.population:
            raise ValueError(
                f"conflicting population denominator for {entry.lsoa_code}")
        indexed[entry.lsoa_code] = entry.population
    return indexed


def _assign_records(kept, window, denominators, lsoa_force, quarantined):
    months = set(window)
    known = set(denominators) | set(lsoa_force)
    assigned: dict = {}
    extra = list(quarantined)
    for record in kept:
        reason = _record_exclusion(record, months, known)
        if reason is None:
            _accumulate(assigned, record)
        else:
            extra.append(_quarantined(record, reason))
    return assigned, extra


def _record_exclusion(record, months, known) -> str | None:
    if record.force in EXCLUDED_CRIME_FORCES:
        return BTP_EXCLUDED
    if record.month not in months:
        return OUTSIDE_WINDOW
    if record.lsoa_code not in known:
        return INCOMPATIBLE_GEOGRAPHY
    return None


def _accumulate(assigned, record) -> None:
    months = assigned.setdefault(record.lsoa_code, {})
    categories = months.setdefault(record.month, {})
    categories[record.category] = categories.get(record.category, 0) + 1


def _area_cases(denominators, lsoa_force, assigned) -> list[_AreaCase]:
    cases = []
    for lsoa in sorted(set(denominators) | set(lsoa_force)):
        cases.append(_AreaCase(lsoa, denominators.get(lsoa),
                               lsoa_force.get(lsoa), assigned.get(lsoa, {})))
    return cases


def _area_evidence(case, window, missing, denominator_year) -> LsoaCrimeEvidence:
    reason = _area_blocker(case.population, case.force, missing)
    if reason is not None:
        return _unavailable_evidence(
            case.lsoa_code, window, reason, case.population, denominator_year)
    return _available_evidence(
        case.lsoa_code, window, case.population, case.observed,
        denominator_year)


def _area_blocker(population, force, missing) -> str | None:
    if population is None or population <= 0:
        return MISSING_DENOMINATOR
    if force is None:
        return UNKNOWN_FORCE
    if missing.get(force):
        return MISSING_FORCE_MONTH
    return None


def _available_evidence(lsoa, window, population, observed,
                        denominator_year) -> LsoaCrimeEvidence:
    monthly = _headline_monthly(window, observed)
    categories: dict[str, int] = {}
    for counts in monthly.values():
        for category, count in counts.items():
            categories[category] = categories.get(category, 0) + count
    asb_monthly = _asb_monthly(window, observed)
    headline = sum(categories.values())
    return LsoaCrimeEvidence(lsoa, window[-1], "available", None, headline,
                             sum(asb_monthly.values()),
                             headline / population * 1_000, categories,
                             monthly, asb_monthly, denominator_year,
                             population)


def _headline_monthly(window, observed) -> dict[str, dict[str, int]]:
    monthly: dict[str, dict[str, int]] = {}
    for month in window:
        counts = {category: count
                  for category, count in observed.get(month, {}).items()
                  if category != ASB_CATEGORY}
        if counts:
            monthly[month] = counts
    return monthly


def _asb_monthly(window, observed) -> dict[str, int]:
    return {month: observed[month][ASB_CATEGORY] for month in window
            if ASB_CATEGORY in observed.get(month, {})}


def _unavailable_evidence(lsoa, window, reason, population,
                          denominator_year) -> LsoaCrimeEvidence:
    return LsoaCrimeEvidence(lsoa, window[-1], "unavailable", reason, 0, 0,
                             None, {}, {}, {}, denominator_year, population)


def _borough_evidence(borough, members, populations) -> BoroughCrimeEvidence:
    window_end = members[0].window_end
    available = [item for item in members if item.status == "available"]
    excluded = len(members) - len(available)
    headline = sum(item.headline_count for item in available)
    asb = sum(item.asb_count for item in available)
    population = sum(populations.get(item.lsoa_code, 0) for item in available)
    if not available or population <= 0:
        reason = "missing-members" if not available else MISSING_DENOMINATOR
        return BoroughCrimeEvidence(borough, window_end, "unavailable", reason,
                                    0, 0, None, None, 0, excluded)
    return BoroughCrimeEvidence(borough, window_end, "available", None,
                                headline, asb, headline / population * 1_000,
                                population, len(available), excluded)


def _coverage_for(window, denominator_year, missing, required=REQUIRED_CRIME_FORCES) -> dict:
    return {
        "forces": sorted(required),
        "requiredForces": sorted(required),
        "excludedForces": sorted(EXCLUDED_CRIME_FORCES),
        "exclusionNote": ("British Transport Police records are excluded "
                          "from area rates; transport-policing coverage is "
                          "not published here."),
        "antiSocialBehaviour": "separate",
        "geographyVintage": CRIME_GEOGRAPHY_VINTAGE,
        "denominatorYear": denominator_year,
        "window": list(window),
        "windowMonths": len(window),
        "missingForceMonths": {force: list(missing.get(force, []))
                               for force in sorted(missing)},
        "englandComparison": "suppressed",
        "englandSuppressionReason": ("Nationwide force coverage is "
                                     "incomplete; no England comparison is "
                                     "published."),
        "transformationVersion": CRIME_TRANSFORMATION_VERSION,
    }


def _quarantined(record, reason) -> QuarantinedCrimeRecord:
    return QuarantinedCrimeRecord(record.crime_id, record.month,
                                  record.category, record.lsoa_code,
                                  record.force, reason)


def _quarantine_key(entry) -> tuple:
    return (entry.reason, entry.force, entry.month, entry.lsoa_code,
            entry.crime_id)


def _normalise_category(category: str) -> str:
    return "-".join(category.strip().lower().split())


def _twelve_months_ending(end: str) -> list[str]:
    final = _parse_period(end)
    return [_format_month(_shift_months(final, offset))
            for offset in range(-CRIME_WINDOW_MONTHS + 1, 1)]


def _format_month(value: date) -> str:
    return f"{value.year}-{value.month:02d}"


# Reliable area prices (AE-12). Releases pool eligible sale/EPC joins at
# the finest geography with enough matched floor areas (LSOA, then MSOA,
# then borough). Borough medians pool the underlying observations; they
# are never averages of smaller-area medians. Nominal, CPIH-adjusted,
# and local-market-adjusted histories stay separate series so a missing
# index suppresses one point, never the whole history.

@dataclass(frozen=True)
class LinkedSale:
    transaction_id: str
    period: str
    price: int
    floor_area_sqm: float | None
    lsoa: str
    msoa: str
    borough: str
    property_type: str
    new_build: bool


@dataclass(frozen=True)
class AreaPriceEvidence:
    geography_id: str
    carrier: str
    period: str
    median_sqm: float | None
    median_sqft: float | None
    all_sales: int
    matched_sales: int
    excluded_sales: int
    carrier_sales: int
    quality: str
    reason: str | None
    composition: dict


def price_per_square_foot(pounds_per_sqm: float) -> float:
    return pounds_per_sqm / SQM_PER_SQFT


def partition_eligible_sales(
    records: Iterable[LinkedSale],
) -> tuple[list, list]:
    matched = [r for r in records if (r.floor_area_sqm or 0) > 0]
    excluded = [r for r in records if (r.floor_area_sqm or 0) <= 0]
    return matched, excluded


def compose_price_mix(records: Iterable[LinkedSale]) -> dict:
    rows = list(records)
    by_type: dict[str, int] = {}
    for record in rows:
        by_type[record.property_type] = by_type.get(record.property_type, 0) + 1
    new_build = sum(1 for record in rows if record.new_build)
    return {
        "byPropertyType": by_type,
        "newBuildCount": new_build,
        "newBuildShare": (new_build / len(rows)) if rows else None,
    }


def subgroup_medians(records: Iterable[LinkedSale]) -> dict:
    rows = list(records)
    medians: dict = {}
    for property_type in sorted({r.property_type for r in rows}):
        medians[property_type] = _median_of(_unit_values(
            [r for r in rows if r.property_type == property_type]))
    return medians


def build_area_price_observation(
    period: str,
    records: Iterable[LinkedSale],
    minimum_sample: int = MINIMUM_SAMPLE_SIZE,
) -> AreaPriceEvidence:
    rows = _windowed(period, list(records))
    matched, excluded = partition_eligible_sales(rows)
    values = _unit_values(matched)
    observed = len(values) >= minimum_sample
    return _price_evidence("uk:lsoa:local", "lsoa", period, rows,
                           matched, excluded, values, observed)


def build_price_release(
    records: Iterable[LinkedSale],
    period: str,
    minimum_sample: int = MINIMUM_SAMPLE_SIZE,
) -> dict:
    rows = _windowed(period, list(records))
    release = {}
    for lsoa in sorted({r.lsoa for r in rows}):
        release[lsoa] = _release_entry(rows, lsoa, period, minimum_sample)
    return release


def adjust_series(nominal_by_period, index_by_period,
                  latest_index) -> dict:
    adjusted = {}
    for period in sorted(nominal_by_period):
        reference = index_by_period.get(period)
        adjusted[period] = _adjusted_point(
            nominal_by_period[period], reference, latest_index)
    return adjusted


def _windowed(period: str, rows: list) -> list:
    start = _shift_months(_parse_period(period), -11)
    end = _parse_period(period)
    return [r for r in rows if _within_period(r.period, start, end)]


def _unit_values(records: Iterable[LinkedSale]) -> list:
    values = []
    for record in records:
        value = price_per_square_metre(record.price, record.floor_area_sqm)
        if value is not None:
            values.append(value)
    return values


def _median_of(values: list):
    return median(values) if values else None


def _with_sqft(median_sqm):
    return price_per_square_foot(median_sqm) if median_sqm is not None else None


def _adjusted_point(nominal, reference, latest):
    if reference is None or latest is None:
        return None
    if reference <= 0 or latest <= 0:
        return None
    return adjust_by_index(nominal, reference, latest)


def _price_evidence(geography_id, carrier, period, rows, matched,
                    excluded, values, observed) -> AreaPriceEvidence:
    median_sqm = _median_of(values) if observed else None
    return AreaPriceEvidence(
        geography_id, carrier, period, median_sqm, _with_sqft(median_sqm),
        len(rows), len(matched), len(excluded),
        len(matched) if observed else len(values),
        "observed" if observed else "suppressed",
        None if observed else THIN_SAMPLE,
        compose_price_mix(matched))


def _release_entry(rows: list, lsoa: str, period: str,
                   minimum_sample: int) -> AreaPriceEvidence:
    own = [r for r in rows if r.lsoa == lsoa]
    msoa = own[0].msoa if own else ""
    borough = own[0].borough if own else ""
    pooled = {
        "lsoa": own,
        "msoa": [r for r in rows if r.msoa == msoa],
        "borough": [r for r in rows if r.borough == borough],
    }
    counts = [(name, len(_unit_values(pooled[name])))
              for name in ("lsoa", "msoa", "borough")]
    carrier = choose_reliable_geography(
        [(name, count) for name, count in counts], minimum_sample)
    matched, excluded = partition_eligible_sales(own)
    if carrier is None:
        return _price_evidence(f"uk:lsoa:{lsoa}", "lsoa", period, own,
                               matched, excluded, [], False)
    values = _unit_values(pooled[carrier])
    median_sqm = _median_of(values)
    return AreaPriceEvidence(
        f"uk:{'lad' if carrier == 'borough' else carrier}:{_carrier_code(carrier, own)}", carrier, period,
        median_sqm, _with_sqft(median_sqm), len(own), len(matched),
        len(excluded), len(values),
        "observed" if carrier == "lsoa" else "fallback", None,
        compose_price_mix(partition_eligible_sales(pooled[carrier])[0]))


def _carrier_code(carrier: str, own: list) -> str:
    if carrier == "msoa":
        return own[0].msoa
    if carrier == "borough":
        return own[0].borough
    return own[0].lsoa
