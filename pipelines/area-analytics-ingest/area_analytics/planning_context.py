"""AE-26: coverage-aware planning context pilot.

First release reads the national Planning Data planning-application
dataset for two pilot boroughs. Duplicate national references collapse
to the latest entry; withdrawn applications leave nearby results but
stay labelled; boroughs outside the pilot report no-coverage (unknown,
never absent); an empty search names the covered dataset, never the
absence of development. Planned, approved, and completed stages stay
distinct, overlapping constraints stay separately named, and every
record links its authoritative council register. No borough adapter
runs without a permitted stable interface filling a demonstrated gap,
so uncovered boroughs stay uncovered instead of scraped. Planning-risk
prediction is unsupported by design.
"""

import json
from dataclasses import dataclass
from datetime import date

NATIONAL_SOURCE_ID = "planning-data-uk-applications"
STAGES = ("planned", "approved", "completed")
STALE_AFTER_DAYS = 180
PILOT_BOROUGHS = ("E09000033", "E09000007")

COUNCIL_REGISTER_BASES = {
    "E09000033": "https://www.westminster.gov.uk/planning-search",
    "E09000007": "https://www.camden.gov.uk/planning-search",
}


@dataclass(frozen=True)
class PlanningConstraint:
    name: str
    label: str


@dataclass(frozen=True)
class PlanningApplication:
    reference: str
    borough: str
    title: str
    stage: str
    decision: str
    status: str
    updated: date | None
    register_path: str
    constraints: tuple
    explanation: str


@dataclass(frozen=True)
class PlanningCoverage:
    boroughs: tuple


@dataclass(frozen=True)
class PilotSample:
    source_id: str
    dataset: str
    dataset_updated: date | None
    applications: tuple
    constraints: tuple
    coverage: PlanningCoverage


@dataclass(frozen=True)
class NearbySearch:
    status: str
    records: tuple
    withdrawn_excluded: int
    message: str


@dataclass(frozen=True)
class CurrencyState:
    status: str
    explanation: str


def load_pilot_sample(path) -> PilotSample:
    raw = json.loads(path.read_text())
    applications = tuple(_load_row(item) for item in raw["applications"])
    constraints = tuple(
        PlanningConstraint(item["name"], item["label"])
        for item in raw["constraints"]
    )
    coverage = PlanningCoverage(tuple(raw["coverage_boroughs"]))
    return PilotSample(
        raw["source_id"], raw["dataset"],
        _parse_date(raw.get("dataset_updated")),
        applications, constraints, coverage,
    )


def deduplicate_applications(rows) -> tuple:
    latest = {}
    for row in rows:
        key = (row.borough, row.reference)
        known = latest.get(key)
        if known is None or _sort_key(row) > _sort_key(known):
            latest[key] = row
    return tuple(sorted(latest.values(), key=_record_key))


def search_nearby(records, borough, stage=None) -> NearbySearch:
    _require_known_stage(stage)
    if borough not in PILOT_BOROUGHS:
        return NearbySearch(
            "no-coverage", (), 0, no_coverage_message(borough))
    unique = deduplicate_applications(records)
    active = tuple(
        record for record in unique
        if record.borough == borough and record.status != "withdrawn"
        and (stage is None or record.stage == stage)
    )
    excluded = sum(
        1 for record in unique
        if record.borough == borough and record.status == "withdrawn"
        and (stage is None or record.stage == stage)
    )
    if not active:
        return NearbySearch(
            "no-records", (), excluded, empty_search_message(borough))
    return NearbySearch("records", active, excluded, _hit_text(borough))


def withdrawn_applications(records, borough) -> tuple:
    unique = deduplicate_applications(records)
    return tuple(
        record for record in unique
        if record.borough == borough and record.status == "withdrawn"
    )


def constraints_for(reference, records) -> tuple:
    for record in deduplicate_applications(records):
        if record.reference == reference:
            return tuple(record.constraints)
    raise ValueError(f"unknown planning reference: {reference}")


def check_currency(record, dataset_updated, as_of) -> CurrencyState:
    if record.updated is None or dataset_updated is None:
        return CurrencyState("unverified", _unverified_text(record))
    record_age = (as_of - record.updated).days
    dataset_age = (as_of - dataset_updated).days
    if record_age > STALE_AFTER_DAYS or dataset_age > STALE_AFTER_DAYS:
        return CurrencyState("stale", _stale_text(record, as_of))
    return CurrencyState("current", _current_text(record, dataset_updated))


def borough_source(borough, coverage) -> str:
    if borough in coverage.boroughs:
        return NATIONAL_SOURCE_ID
    raise ValueError(
        f"borough {borough} is outside the pilot coverage: no permitted "
        "stable borough interface fills that gap, so no borough adapter "
        "runs and nothing is scraped"
    )


def council_register_url(record) -> str:
    base = COUNCIL_REGISTER_BASES.get(record.borough)
    if base is None:
        raise ValueError(
            f"no council register link for borough {record.borough}"
        )
    return f"{base}/{record.register_path}"


def stage_counts(records) -> dict:
    unique = deduplicate_applications(records)
    active = [record for record in unique if record.status != "withdrawn"]
    return {
        stage: sum(1 for record in active if record.stage == stage)
        for stage in STAGES
    }


def empty_search_message(borough) -> str:
    return (
        f"No records were returned in the covered dataset for {borough}; "
        "this says nothing about development or constraints beyond these "
        "records. Check the council register for the authoritative position."
    )


def no_coverage_message(borough) -> str:
    return (
        f"{borough} is outside the pilot planning coverage: planning "
        "records are unknown here, not absent. Check the council register "
        "for the area instead of assuming anything from this pilot."
    )


def estimate_planning_risk(*args, **kwargs) -> float:
    raise ValueError(
        "planning-risk prediction is unsupported: show the reviewed "
        "proposal, its decision state, and the council register link, "
        "never a score"
    )


def _hit_text(borough) -> str:
    return (
        f"National planning records for {borough}. Stages stay distinct: "
        "planned is not approval, approval is not completion."
    )


def _require_known_stage(stage) -> None:
    if stage is not None and stage not in STAGES:
        raise ValueError(
            f"unknown planning stage {stage!r}: use one of "
            f"{', '.join(STAGES)}"
        )


def _load_row(item) -> PlanningApplication:
    status = item.get("status", "active")
    decision = item["decision"]
    return PlanningApplication(
        item["reference"], item["borough"], item["title"],
        item["stage"], decision, status,
        _parse_date(item.get("updated")), item["register_path"],
        tuple(item.get("constraints", ())), _row_text(status, decision),
    )


def _row_text(status, decision) -> str:
    if status == "withdrawn":
        return (f"Withdrawn: {decision}. Withdrawn applications are not "
                "active proposals and leave nearby results.")
    return decision


def _unverified_text(record) -> str:
    return (
        f"No update date in the national entry for {record.reference}: "
        "currency is unverified; check the council register before relying "
        "on this record."
    )


def _stale_text(record, as_of) -> str:
    age = (as_of - record.updated).days
    return (
        f"The national entry for {record.reference} was last updated "
        f"{record.updated} ({age} days before {as_of}): treat it as stale "
        "and check the council register for the current position."
    )


def _current_text(record, dataset_updated) -> str:
    return (
        f"The national entry for {record.reference} was updated "
        f"{record.updated}, inside the {STALE_AFTER_DAYS}-day review "
        f"window of the {dataset_updated} dataset refresh: current."
    )


def _parse_date(value):
    if value is None:
        return None
    return date.fromisoformat(value)


def _sort_key(row):
    return (row.updated is not None, row.updated)


def _record_key(record):
    return (record.borough, record.reference)
