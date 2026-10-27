"""AE-22: bounded admissions-evidence pilot for London authorities.

Historical cutoffs are observations with gaps, never eligibility. A home
distance within a past cutoff never becomes a guaranteed-place claim, and
admission probabilities are unsupported: estimators stay unavailable.
"""

from dataclasses import dataclass
from typing import Sequence

DISTANCE_PRIORITY_GROUP = "distance"

DISTANCE_INSUFFICIENT = (
    "A home distance alone is insufficient: past cutoffs vary by year and "
    "priority group, so being within a historical distance never guarantees "
    "a place. Check the current authority guidance before relying on it."
)


@dataclass(frozen=True)
class AdmissionAuthority:
    code: str
    name: str


PILOT_ADMISSION_AUTHORITIES: tuple[AdmissionAuthority, ...] = (
    AdmissionAuthority("E09000033", "Westminster"),
    AdmissionAuthority("E09000007", "Camden"),
    AdmissionAuthority("E09000019", "Islington"),
)


@dataclass(frozen=True)
class PriorityCutoff:
    academic_year: str
    priority_group: str
    last_distance_metres: float | None
    measurement_method: str
    source_url: str
    source_release_id: str


@dataclass(frozen=True)
class AuthorityGuide:
    authority_code: str
    authority_name: str
    academic_year: str
    priority_rules: tuple[str, ...]
    measurement_method: str
    priority_area: str
    guidance_url: str
    source_release_id: str


@dataclass(frozen=True)
class AdmissionQuestion:
    id: str
    text: str
    url: str | None
    answered: bool


@dataclass(frozen=True)
class AdmissionAssessment:
    claim: str
    explanation: str
    years_observed: int
    years_within: int
    missing_years: tuple[str, ...]
    conflicting: bool
    is_probability: bool = False


@dataclass(frozen=True)
class PilotCoverage:
    authority_code: str
    covered: bool
    pilot_codes: tuple[str, ...]


@dataclass(frozen=True)
class AdmissionObservation:
    year: int
    last_distance_metres: float
    measurement_method: str
    admission_rule: str
    school_site: str
    source_release_id: str


@dataclass(frozen=True)
class VerifiedPriorityBoundary:
    academic_year: str
    source_release_id: str
    reusable: bool


@dataclass(frozen=True)
class AdmissionEvidence:
    kind: str
    years_within: int
    years_observed: int
    observations: tuple[AdmissionObservation, ...]
    boundary: VerifiedPriorityBoundary | None = None
    is_probability: bool = False


def build_admission_evidence(
    observations: Sequence[AdmissionObservation],
    home_distance_metres: float,
    verified_boundary: VerifiedPriorityBoundary | None = None,
) -> AdmissionEvidence:
    if verified_boundary and verified_boundary.reusable:
        return AdmissionEvidence("verified-boundary", 0, 0, (), verified_boundary)
    ordered = tuple(sorted(observations, key=lambda observation: observation.year))
    if len(ordered) < 3 or not _comparable(ordered):
        return AdmissionEvidence("unavailable", 0, 0, ())
    within = sum(home_distance_metres <= observation.last_distance_metres for observation in ordered)
    return AdmissionEvidence("historical-reach", within, len(ordered), ordered)


def assess_pilot_admissions(
    cutoffs: Sequence[PriorityCutoff],
    home_distance_metres: float,
    guide: AuthorityGuide | None = None,
    expected_years: Sequence[str] = (),
) -> AdmissionAssessment:
    distance = [cut for cut in cutoffs if cut.priority_group == DISTANCE_PRIORITY_GROUP]
    others = sorted({cut.priority_group for cut in cutoffs} - {DISTANCE_PRIORITY_GROUP})
    missing = tuple(year for year in expected_years if year not in {cut.academic_year for cut in distance})
    methods = {cut.measurement_method for cut in distance}
    if guide is not None:
        methods.add(guide.measurement_method)
    if len(methods) > 1:
        return _conflict(distance, missing, others)
    if missing and missing[-1] == (expected_years[-1] if expected_years else None):
        return _recent_gap(distance, missing, others)
    return _historical(distance, home_distance_metres, missing, others)


def estimate_admission_probability(*args, **kwargs) -> float:
    raise ValueError("admission probabilities are unsupported: show historical cutoffs, never a chance")


def pilot_admission_coverage(authority_code: str) -> PilotCoverage:
    codes = tuple(authority.code for authority in PILOT_ADMISSION_AUTHORITIES)
    return PilotCoverage(authority_code, authority_code in codes, codes)


def record_admission_question(
    questions: Sequence[AdmissionQuestion],
    text: str,
) -> list[AdmissionQuestion]:
    trimmed = text.strip()
    if not trimmed:
        return list(questions)
    numbers = [int(q.id[2:]) for q in questions if q.id.startswith("q-") and q.id[2:].isdigit()]
    next_id = f"q-{(max(numbers) if numbers else 0) + 1}"
    return [*questions, AdmissionQuestion(next_id, trimmed, None, False)]


def _conflict(
    distance: Sequence[PriorityCutoff],
    missing: tuple[str, ...],
    others: list[str],
) -> AdmissionAssessment:
    return AdmissionAssessment(
        "unavailable",
        f"admission rules conflict across years{_other_groups(others)}; "
        "treat eligibility as unknown until the current guidance is checked.",
        len({cut.academic_year for cut in distance}), 0, missing, True,
    )


def _recent_gap(
    distance: Sequence[PriorityCutoff],
    missing: tuple[str, ...],
    others: list[str],
) -> AdmissionAssessment:
    return AdmissionAssessment(
        "unavailable",
        f"recent cutoff gap ({', '.join(missing)} not published){_other_groups(others)}; "
        "historical cutoffs are observations with gaps, never eligibility.",
        len({cut.academic_year for cut in distance}), 0, missing, False,
    )


def _historical(
    distance: Sequence[PriorityCutoff],
    home_distance_metres: float,
    missing: tuple[str, ...],
    others: list[str],
) -> AdmissionAssessment:
    years = sorted({cut.academic_year for cut in distance})
    within = sum(1 for year in years if _within_year(distance, year, home_distance_metres))
    gap = f" Gap years not published: {', '.join(missing)}." if missing else ""
    return AdmissionAssessment(
        "historical-only",
        f"{DISTANCE_INSUFFICIENT}{_other_groups(others)}{gap}",
        len(years), within, missing, False,
    )


def _within_year(distance: Sequence[PriorityCutoff], year: str, home: float) -> bool:
    published = [
        cut.last_distance_metres for cut in distance
        if cut.academic_year == year and cut.last_distance_metres is not None
    ]
    return bool(published) and home <= min(published)


def _other_groups(others: Sequence[str]) -> str:
    if not others:
        return ""
    return f" Other priority groups ({', '.join(others)}) use separate cutoffs and are never merged."


def _comparable(observations: Sequence[AdmissionObservation]) -> bool:
    keys = {
        (observation.measurement_method, observation.admission_rule, observation.school_site)
        for observation in observations
    }
    return len(keys) == 1 and observations[0].admission_rule == "distance"
