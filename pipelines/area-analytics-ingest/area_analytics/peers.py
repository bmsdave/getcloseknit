"""Peer groups: the three reference sets a price is set against.

A number with no peer group is not evidence. Each group is a real set of
transactions we hold; a group that cannot reach the minimum size reports itself
as too thin rather than publishing a distribution drawn from a handful of sales.
The subject is always a member of its own groups, so it can never fall outside
the range it is being compared against.
"""

from dataclasses import dataclass
from statistics import median
from typing import Sequence

from . import coverage
from .analytics import MINIMUM_SAMPLE_SIZE
from .utilities import empirical_percentile


MINIMUM_PEER_GROUP_SIZE = 30
SIMILAR_FLOOR_AREA_TOLERANCE = 0.20
COMPARABLE_DECILE_TOLERANCE = 1


@dataclass(frozen=True)
class PeerCandidate:
    property_id: str
    property_type: str
    floor_area_square_metres: float
    price: int
    price_per_square_metre: float
    price_decile: int
    msoa: str
    borough: str
    crime_decile: int
    deprivation_decile: int
    income_decile: int


@dataclass(frozen=True)
class PeerSale:
    property_id: str
    year: str
    price_per_square_metre: float


@dataclass(frozen=True)
class Distribution:
    p10: float
    p25: float
    median: float
    p75: float
    p90: float


@dataclass(frozen=True)
class PeerGroup:
    id: str
    label: str
    definition: str
    status: str
    count: int
    distribution: Distribution | None
    percentile: int | None
    member_ids: tuple[str, ...]


@dataclass(frozen=True)
class YearMedian:
    year: str
    median_price_per_square_metre: float | None
    sample_count: int


def build_peer_groups(
    subject: PeerCandidate,
    candidates: Sequence[PeerCandidate],
    minimum_size: int = MINIMUM_PEER_GROUP_SIZE,
) -> tuple[PeerGroup, ...]:
    return (
        similar_homes_nearby(subject, candidates, minimum_size),
        same_money_bracket(subject, candidates, minimum_size),
        same_building_different_neighbourhood(subject, candidates, minimum_size),
    )


def similar_homes_nearby(
    subject: PeerCandidate,
    candidates: Sequence[PeerCandidate],
    minimum_size: int = MINIMUM_PEER_GROUP_SIZE,
) -> PeerGroup:
    nearby = _select(
        subject,
        candidates,
        lambda peer: _same_kind_and_size(subject, peer) and peer.msoa == subject.msoa,
    )
    definition = (
        f"{subject.property_type.capitalize()}s within "
        f"±{round(SIMILAR_FLOOR_AREA_TOLERANCE * 100)}% of "
        f"{subject.floor_area_square_metres:g} m², in MSOA {subject.msoa}"
    )
    if len(nearby) < minimum_size:
        nearby = _select(
            subject,
            candidates,
            lambda peer: _same_kind_and_size(subject, peer) and peer.borough == subject.borough,
        )
        definition = (
            f"{definition}; too thin at MSOA, widened to borough {subject.borough}"
        )
    return _group("similar-homes-nearby", "Similar homes nearby", definition, subject, nearby, minimum_size)


def same_money_bracket(
    subject: PeerCandidate,
    candidates: Sequence[PeerCandidate],
    minimum_size: int = MINIMUM_PEER_GROUP_SIZE,
) -> PeerGroup:
    members = _select(subject, candidates, lambda peer: peer.price_decile == subject.price_decile)
    definition = (
        f"Any property type in {_scope_name(subject)} price decile {subject.price_decile}, "
        "the bracket this sale falls in"
    )
    return _group("same-money-bracket", "Same money bracket", definition, subject, members, minimum_size)


def _scope_name(subject: PeerCandidate) -> str:
    """Price deciles rank within the home's region (London for a London borough)."""
    return coverage.region_name(coverage.region_of_lad(subject.borough)) or "London"


def same_building_different_neighbourhood(
    subject: PeerCandidate,
    candidates: Sequence[PeerCandidate],
    minimum_size: int = MINIMUM_PEER_GROUP_SIZE,
) -> PeerGroup:
    members = _select(
        subject,
        candidates,
        lambda peer: _same_kind_and_size(subject, peer)
        and peer.msoa != subject.msoa
        and _comparable_area(subject, peer),
    )
    definition = (
        f"{subject.property_type.capitalize()}s of the same size outside MSOA {subject.msoa}, "
        f"where crime, deprivation, and income deciles are each within "
        f"±{COMPARABLE_DECILE_TOLERANCE} of this area"
    )
    return _group(
        "same-building-different-neighbourhood",
        "Same building, different neighbourhood",
        definition,
        subject,
        members,
        minimum_size,
    )


def peer_median_by_year(
    member_ids: Sequence[str],
    sales: Sequence[PeerSale],
    minimum_sample: int = MINIMUM_SAMPLE_SIZE,
) -> tuple[YearMedian, ...]:
    """Median £/m² per year across a peer group, suppressing thin years."""
    members = set(member_ids)
    by_year: dict[str, list[float]] = {}
    for sale in sales:
        if sale.property_id in members:
            by_year.setdefault(sale.year, []).append(sale.price_per_square_metre)
    return tuple(
        YearMedian(
            year=year,
            median_price_per_square_metre=(
                round(median(values), 2) if len(values) >= minimum_sample else None
            ),
            sample_count=len(values),
        )
        for year, values in sorted(by_year.items())
    )


def _group(
    group_id: str,
    label: str,
    definition: str,
    subject: PeerCandidate,
    members: Sequence[PeerCandidate],
    minimum_size: int,
) -> PeerGroup:
    values = sorted(member.price_per_square_metre for member in members)
    if len(members) < minimum_size:
        return PeerGroup(
            id=group_id,
            label=label,
            definition=f"{definition}. Fewer than {minimum_size} members; no distribution published.",
            status="too-thin",
            count=len(members),
            distribution=None,
            percentile=None,
            member_ids=tuple(sorted(member.property_id for member in members)),
        )
    return PeerGroup(
        id=group_id,
        label=label,
        definition=definition,
        status="observed",
        count=len(members),
        distribution=Distribution(
            p10=_percentile_value(values, 0.10),
            p25=_percentile_value(values, 0.25),
            median=_percentile_value(values, 0.50),
            p75=_percentile_value(values, 0.75),
            p90=_percentile_value(values, 0.90),
        ),
        percentile=empirical_percentile(subject.price_per_square_metre, values),
        member_ids=tuple(sorted(member.property_id for member in members)),
    )


def _select(subject, candidates, predicate) -> list[PeerCandidate]:
    members = [peer for peer in candidates if peer.property_id != subject.property_id and predicate(peer)]
    return [subject, *members]


def _same_kind_and_size(subject: PeerCandidate, peer: PeerCandidate) -> bool:
    if peer.property_type != subject.property_type:
        return False
    tolerance = subject.floor_area_square_metres * SIMILAR_FLOOR_AREA_TOLERANCE
    return abs(peer.floor_area_square_metres - subject.floor_area_square_metres) <= tolerance


def _comparable_area(subject: PeerCandidate, peer: PeerCandidate) -> bool:
    return all(
        abs(getattr(peer, decile) - getattr(subject, decile)) <= COMPARABLE_DECILE_TOLERANCE
        for decile in ("crime_decile", "deprivation_decile", "income_decile")
    )


def _percentile_value(sorted_values: Sequence[float], fraction: float) -> float:
    if not sorted_values:
        raise ValueError("cannot take a percentile of an empty peer group")
    rank = max(1, round(fraction * len(sorted_values)))
    return round(sorted_values[rank - 1], 2)
