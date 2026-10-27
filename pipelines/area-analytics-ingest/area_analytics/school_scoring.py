from dataclasses import dataclass
from typing import Mapping, Sequence


@dataclass(frozen=True)
class SchoolFacetScore:
    value: int | None
    evidence_completeness: int


def school_access_utility(option_utilities: Sequence[float], desired_count: int = 3) -> int:
    if desired_count < 1:
        raise ValueError("desired school count must be positive")
    selected = sorted(option_utilities, reverse=True)[:desired_count]
    return round(sum(selected) / desired_count)


def weighted_school_facets(
    observations: Mapping[str, float | None],
    weights: Mapping[str, int],
) -> SchoolFacetScore:
    active = {name: weight for name, weight in weights.items() if weight > 0}
    total_weight = sum(active.values())
    available = {
        name: value for name, value in observations.items()
        if name in active and value is not None
    }
    available_weight = sum(active[name] for name in available)
    completeness = round(available_weight / total_weight * 100) if total_weight else 100
    if not available_weight:
        return SchoolFacetScore(None, completeness)
    value = round(sum(value * active[name] for name, value in available.items()) / available_weight)
    return SchoolFacetScore(value, completeness)
