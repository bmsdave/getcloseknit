"""Price decomposition by nested comparables.

This is not a fitted regression. Each step is the median £/m² of a real,
narrower group of transactions we hold, and the contribution is the distance
between one step and the one before it. A step whose group falls below the
reliability gate is skipped and reported, never silently folded into its
neighbours, and the part of an observed price the steps do not reach stays
visible as a residual.
"""

from dataclasses import dataclass
from typing import Sequence

from .analytics import MINIMUM_SAMPLE_SIZE


@dataclass(frozen=True)
class ReferenceGroup:
    label: str
    median_price_per_square_metre: float
    sample_count: int


@dataclass(frozen=True)
class Contribution:
    label: str
    price_per_square_metre: float
    amount: int
    sample_count: int


@dataclass(frozen=True)
class SkippedStep:
    label: str
    reason: str


@dataclass(frozen=True)
class Decomposition:
    baseline_label: str
    baseline_price: int
    baseline_price_per_square_metre: float
    contributions: tuple[Contribution, ...]
    estimate: int
    estimate_price_per_square_metre: float
    residual: int | None
    skipped: tuple[SkippedStep, ...]


def decompose(
    floor_area_square_metres: float,
    baseline: ReferenceGroup,
    steps: Sequence[ReferenceGroup],
    observed_price: int | None = None,
    minimum_sample: int = MINIMUM_SAMPLE_SIZE,
) -> Decomposition:
    if floor_area_square_metres <= 0:
        raise ValueError("floor area must be positive to price a property per square metre")
    if baseline.sample_count < minimum_sample:
        raise ValueError(
            f"baseline {baseline.label!r} has {baseline.sample_count} sales, "
            f"below the {minimum_sample}-sale reliability gate"
        )
    current = _validated(baseline).median_price_per_square_metre
    cumulative = round(current * floor_area_square_metres)
    baseline_price = cumulative
    contributions: list[Contribution] = []
    skipped: list[SkippedStep] = []
    for step in steps:
        _validated(step)
        if step.sample_count < minimum_sample:
            skipped.append(
                SkippedStep(
                    step.label,
                    f"{step.sample_count} sales is below the {minimum_sample}-sale reliability gate",
                )
            )
            continue
        total = round(step.median_price_per_square_metre * floor_area_square_metres)
        contributions.append(
            Contribution(
                label=step.label,
                price_per_square_metre=round(step.median_price_per_square_metre - current, 2),
                amount=total - cumulative,
                sample_count=step.sample_count,
            )
        )
        current, cumulative = step.median_price_per_square_metre, total
    return Decomposition(
        baseline_label=baseline.label,
        baseline_price=baseline_price,
        baseline_price_per_square_metre=baseline.median_price_per_square_metre,
        contributions=tuple(contributions),
        estimate=cumulative,
        estimate_price_per_square_metre=round(current, 2),
        residual=None if observed_price is None else observed_price - cumulative,
        skipped=tuple(skipped),
    )


def waterfall_total(decomposition: Decomposition) -> int:
    """The figure the panel must show: the baseline plus every contribution."""
    return decomposition.baseline_price + sum(
        contribution.amount for contribution in decomposition.contributions
    )


def _validated(group: ReferenceGroup) -> ReferenceGroup:
    if group.median_price_per_square_metre <= 0:
        raise ValueError(f"reference group {group.label!r} needs a positive median £/m²")
    if group.sample_count < 0:
        raise ValueError(f"reference group {group.label!r} has a negative sample count")
    return group
