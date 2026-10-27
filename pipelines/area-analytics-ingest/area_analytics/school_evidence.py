"""AE-21: reviewed school directory with dated URN-keyed observations.

The GIAS download page could not be retrieved during research, so licences
and schemas are validated against registry entries and fixtures only, never
live publishers. Sources whose licence decision is unresolved (notably most
councils' admission tables, la-admissions-*) stay blocked: rows citing them
cannot enter a release.

There is deliberately no universal school quality score here. Scoring runs
only on caller-supplied parent priorities via school_scoring, and distances
never enter this module: admission eligibility lives in school_admissions.
"""

from dataclasses import dataclass, replace
from typing import Mapping, Sequence

from area_analytics.school_scoring import SchoolFacetScore, weighted_school_facets
from area_analytics.sources import SourceDefinition, source_definition

URN_LENGTH = 6
VALID_PHASES = ("primary", "secondary")
VALID_STATUSES = ("open", "closed")
CURRENT_FRAMEWORK = "report-card"
LEGACY_FRAMEWORK = "legacy-overall"


@dataclass(frozen=True)
class DirectoryEntry:
    urn: str
    name: str
    previous_names: tuple[str, ...]
    phase: str
    status: str
    closed_date: str | None
    predecessor_urn: str | None
    successor_urn: str | None
    source_release_id: str


@dataclass(frozen=True)
class PerformanceObservation:
    urn: str
    academic_year: str
    measure: str
    value: float | None
    cohort_size: int | None
    source_release_id: str
    suppressed: bool = False


@dataclass(frozen=True)
class InspectionObservation:
    urn: str
    academic_year: str
    framework: str
    facets: Mapping[str, int] | None
    overall_judgement: str | None
    source_release_id: str


def require_reviewed_school_source(source_id: str) -> SourceDefinition:
    source = source_definition(source_id)
    if source.licence_decision != "approved":
        raise ValueError(f"blocked source {source_id}: licence {source.licence_decision}")
    return source


def build_directory(rows: Sequence[Mapping], source_release_id: str) -> dict[str, DirectoryEntry]:
    if not source_release_id:
        raise ValueError("directory rows must link a publisher record")
    directory = {}
    for row in rows:
        entry = _directory_entry(row, source_release_id)
        directory[entry.urn] = entry
    return directory


def resolve_current_urn(directory: Mapping[str, DirectoryEntry], urn: str) -> str:
    current = _require_entry(directory, urn)
    seen = {current.urn}
    while current.successor_urn is not None:
        current = _require_entry(directory, current.successor_urn)
        if current.urn in seen:
            raise ValueError(f"URN successor cycle at {current.urn}")
        seen.add(current.urn)
    return current.urn


def directory_history(directory: Mapping[str, DirectoryEntry], urn: str) -> list[DirectoryEntry]:
    current = _require_entry(directory, resolve_current_urn(directory, urn))
    history = [current]
    while history[-1].predecessor_urn is not None:
        history.append(_require_entry(directory, history[-1].predecessor_urn))
    return list(reversed(history))


def observations_for_urn(
    directory: Mapping[str, DirectoryEntry],
    performances: Sequence[PerformanceObservation],
    inspections: Sequence[InspectionObservation],
    urn: str,
) -> tuple[str, tuple[list[PerformanceObservation], list[InspectionObservation]]]:
    resolved = resolve_current_urn(directory, urn)
    urns = {entry.urn for entry in directory_history(directory, resolved)}
    kept_performances = [item for item in performances if item.urn in urns]
    kept_inspections = [item for item in inspections if item.urn in urns]
    for item in (*kept_performances, *kept_inspections):
        if not item.source_release_id:
            raise ValueError(f"observation without a publisher record: {item}")
    return resolved, (kept_performances, kept_inspections)


def missing_observation_kinds(
    performances: Sequence[PerformanceObservation],
    inspections: Sequence[InspectionObservation],
) -> list[str]:
    missing = [
        f"{item.measure}:{item.academic_year}:cohort-size"
        for item in performances
        if item.cohort_size is None
    ]
    missing.extend(
        f"inspection:{item.academic_year}:shape"
        for item in inspections
        if inspection_shape(item) not in (CURRENT_FRAMEWORK, LEGACY_FRAMEWORK)
    )
    return missing


def apply_cohort_suppression(
    observations: Sequence[PerformanceObservation],
    minimum_cohort: int,
) -> list[PerformanceObservation]:
    return [
        replace(item, suppressed=item.cohort_size is not None and item.cohort_size < minimum_cohort)
        for item in observations
    ]


def inspection_shape(observation: InspectionObservation) -> str:
    if observation.framework == LEGACY_FRAMEWORK:
        return _legacy_shape(observation)
    if observation.framework == CURRENT_FRAMEWORK:
        return _current_shape(observation)
    raise ValueError(f"unknown inspection framework: {observation.framework}")


def score_parent_priorities(
    observations: Mapping[str, float | None],
    weights: Mapping[str, int],
) -> SchoolFacetScore:
    if not any(weight > 0 for weight in weights.values()):
        raise ValueError("parent priorities required: no universal school score exists")
    return weighted_school_facets(observations, weights)


def _legacy_shape(observation: InspectionObservation) -> str:
    if observation.facets or observation.overall_judgement is None:
        raise ValueError("legacy judgements carry an overall grade, never current facets")
    return LEGACY_FRAMEWORK


def _current_shape(observation: InspectionObservation) -> str:
    if not observation.facets or observation.overall_judgement is not None:
        raise ValueError("current report cards carry facets, never a legacy overall grade")
    return CURRENT_FRAMEWORK


def _require_entry(directory: Mapping[str, DirectoryEntry], urn: str) -> DirectoryEntry:
    try:
        return directory[urn]
    except KeyError:
        raise ValueError(f"unknown URN: {urn}") from None


def _directory_entry(row: Mapping, source_release_id: str) -> DirectoryEntry:
    urn = str(row["urn"])
    if len(urn) != URN_LENGTH or not urn.isdigit():
        raise ValueError(f"invalid URN: {urn}")
    if row["phase"] not in VALID_PHASES:
        raise ValueError(f"invalid phase for {urn}: {row['phase']}")
    if row["status"] not in VALID_STATUSES:
        raise ValueError(f"invalid status for {urn}: {row['status']}")
    if (row["closed_date"] is None) == (row["status"] == "closed"):
        raise ValueError(f"closure date inconsistent with status for {urn}")
    if row["successor_urn"] == urn or row["predecessor_urn"] == urn:
        raise ValueError(f"URN cannot reference itself: {urn}")
    return DirectoryEntry(
        urn=urn,
        name=str(row["name"]),
        previous_names=tuple(row.get("previous_names", ())),
        phase=str(row["phase"]),
        status=str(row["status"]),
        closed_date=row["closed_date"],
        predecessor_urn=row["predecessor_urn"],
        successor_urn=row["successor_urn"],
        source_release_id=source_release_id,
    )
