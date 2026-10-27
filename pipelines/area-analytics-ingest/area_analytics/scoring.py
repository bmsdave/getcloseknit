from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class FactorObservation:
    raw_value: float
    utility: float
    carrier_geography_id: str
    quality: str


@dataclass(frozen=True)
class FactorPreference:
    weight: int
    minimum_utility: float | None = None
    maximum_utility: float | None = None


@dataclass(frozen=True)
class ScoreComponent:
    factor_id: str
    raw_value: float
    utility: float
    weight: int
    contribution: float
    carrier_geography_id: str
    quality: str


@dataclass(frozen=True)
class MatchScore:
    geography_id: str
    score: int | None
    evidence_completeness: int
    excluded: bool
    unmet_limits: tuple[str, ...]
    components: tuple[ScoreComponent, ...]


def score_area(
    geography_id: str,
    observations: Mapping[str, FactorObservation],
    preferences: Mapping[str, FactorPreference],
) -> MatchScore:
    active = {factor_id: preference for factor_id, preference in preferences.items() if preference.weight > 0}
    total_weight = sum(preference.weight for preference in active.values())
    available_weight = sum(
        preference.weight for factor_id, preference in active.items() if factor_id in observations
    )
    completeness = round(available_weight / total_weight * 100) if total_weight else 100
    unmet = _unmet_limits(active, observations)
    if unmet or available_weight == 0:
        return MatchScore(geography_id, None, completeness, bool(unmet), unmet, ())
    components = _components(active, observations, available_weight)
    score = round(sum(component.contribution for component in components))
    return MatchScore(geography_id, score, completeness, False, (), components)


def _unmet_limits(
    preferences: Mapping[str, FactorPreference], observations: Mapping[str, FactorObservation]
) -> tuple[str, ...]:
    failures: list[str] = []
    for factor_id, preference in preferences.items():
        constrained = preference.minimum_utility is not None or preference.maximum_utility is not None
        observation = observations.get(factor_id)
        if constrained and observation is None:
            failures.append(f"{factor_id}:missing")
        elif observation and preference.minimum_utility is not None and observation.utility < preference.minimum_utility:
            failures.append(f"{factor_id}:below-minimum")
        elif observation and preference.maximum_utility is not None and observation.utility > preference.maximum_utility:
            failures.append(f"{factor_id}:above-maximum")
    return tuple(failures)


def _components(
    preferences: Mapping[str, FactorPreference],
    observations: Mapping[str, FactorObservation],
    available_weight: int,
) -> tuple[ScoreComponent, ...]:
    return tuple(
        ScoreComponent(
            factor_id=factor_id,
            raw_value=observation.raw_value,
            utility=observation.utility,
            weight=preference.weight,
            contribution=observation.utility * preference.weight / available_weight,
            carrier_geography_id=observation.carrier_geography_id,
            quality=observation.quality,
        )
        for factor_id, preference in preferences.items()
        if (observation := observations.get(factor_id)) is not None
    )
