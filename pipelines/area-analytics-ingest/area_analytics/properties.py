"""One record per address, joining transactions, certificates, and derived events.

The spine keys on the normalised postcode and address, because HM Land Registry
price paid rows and EPC certificates share no identifier. Every field is taken
from a source record; nothing is inferred when a source is silent.
"""

import re
from dataclasses import dataclass
from datetime import date
from typing import Iterable, Mapping, Sequence


EXTENSION_FLOOR_AREA_GROWTH = 0.10
REFURBISHMENT_BAND_RISE = 2
ENERGY_BANDS = ("G", "F", "E", "D", "C", "B", "A")
TENURES = ("freehold", "leasehold")
GRID_PRECISION_DEGREES = 0.01
POSTCODE_PATTERN = re.compile(r"[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}")


@dataclass(frozen=True)
class Sale:
    date: str
    price: int
    new_build: bool
    tenure: str


@dataclass(frozen=True)
class Certificate:
    lodged: str
    floor_area_square_metres: float
    energy_rating: str
    rooms: int | None = None
    construction_age_band: str | None = None
    built_form: str | None = None
    extension_count: int | None = None


@dataclass(frozen=True)
class PropertyEvent:
    kind: str
    date: str
    detail: str


@dataclass(frozen=True)
class Property:
    property_id: str
    postcode: str
    address: str
    cell: str
    lsoa: str
    msoa: str
    borough: str
    sales: tuple[Sale, ...]
    certificates: tuple[Certificate, ...]
    events: tuple[PropertyEvent, ...]


def normalise_postcode(value: str) -> str:
    compact = "".join(value.split()).upper()
    if not POSTCODE_PATTERN.fullmatch(compact):
        raise ValueError(f"invalid postcode: {value}")
    return f"{compact[:-3]} {compact[-3:]}"


def normalise_address(primary: str, secondary: str | None = None) -> str:
    parts = [part for part in (secondary, primary) if part and part.strip()]
    if not parts:
        raise ValueError("address needs at least a primary addressable object name")
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", " ".join(parts).upper()).split())


def property_id(postcode: str, primary: str, secondary: str | None = None) -> str:
    postcode_key = normalise_postcode(postcode).replace(" ", "")
    address_key = normalise_address(primary, secondary).replace(" ", "-")
    return f"uk:property:{postcode_key}:{address_key}"


def grid_cell(
    latitude: float, longitude: float, precision: float = GRID_PRECISION_DEGREES
) -> str:
    if precision <= 0:
        raise ValueError("grid precision must be positive")
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError("coordinates must be a valid latitude and longitude")
    return f"cell:{precision:g}:{_cell_index(longitude, precision)}:{_cell_index(latitude, precision)}"


def build_property(
    *,
    postcode: str,
    primary_address: str,
    secondary_address: str | None = None,
    latitude: float,
    longitude: float,
    lsoa: str,
    msoa: str,
    borough: str,
    sales: Iterable[Sale],
    certificates: Iterable[Certificate],
    grid_precision: float = GRID_PRECISION_DEGREES,
) -> Property:
    ordered_sales = tuple(sorted((_validated_sale(sale) for sale in sales), key=lambda sale: sale.date))
    ordered_certificates = tuple(
        sorted(
            (_validated_certificate(certificate) for certificate in certificates),
            key=lambda certificate: certificate.lodged,
        )
    )
    if not ordered_sales and not ordered_certificates:
        raise ValueError("a property needs at least one sale or certificate")
    return Property(
        property_id=property_id(postcode, primary_address, secondary_address),
        postcode=normalise_postcode(postcode),
        address=normalise_address(primary_address, secondary_address),
        cell=grid_cell(latitude, longitude, grid_precision),
        lsoa=lsoa,
        msoa=msoa,
        borough=borough,
        sales=ordered_sales,
        certificates=ordered_certificates,
        events=derive_events(ordered_sales, ordered_certificates),
    )


def build_properties(records: Iterable[Mapping[str, object]]) -> list[Property]:
    built = [build_property(**record) for record in records]  # type: ignore[arg-type]
    identifiers = [item.property_id for item in built]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError("two records normalise to the same address; merge them upstream")
    return sorted(built, key=lambda item: item.property_id)


def derive_events(
    sales: Sequence[Sale], certificates: Sequence[Certificate]
) -> tuple[PropertyEvent, ...]:
    events: list[PropertyEvent] = []
    for earlier, later in zip(certificates, certificates[1:]):
        events.extend(_certificate_events(earlier, later))
    first_new_build = next((sale for sale in sales if sale.new_build), None)
    if first_new_build is not None:
        events.append(
            PropertyEvent("first-sold-as-new", first_new_build.date, "Sold new, priced as a new build")
        )
    for earlier, later in zip(sales, sales[1:]):
        if earlier.tenure == "leasehold" and later.tenure == "freehold":
            events.append(
                PropertyEvent("converted-to-freehold", later.date, "Sold freehold after a leasehold sale")
            )
    return tuple(sorted(events, key=lambda event: (event.date, event.kind)))


def area_deprivation_movement(
    lsoa: str,
    earlier: Mapping[str, int],
    later: Mapping[str, int],
    *,
    earlier_release: str,
    later_release: str,
    published: str,
) -> PropertyEvent | None:
    """Movement between two deprivation releases, or nothing when the code changed.

    LSOAs that were split at the 2021 boundary revision carry no comparable
    earlier decile. They are excluded rather than mapped onto a parent code.
    """
    if lsoa not in earlier or lsoa not in later:
        return None
    before, after = earlier[lsoa], later[lsoa]
    if before == after:
        return None
    direction = "less" if after > before else "more"
    detail = (
        f"Deprivation decile moved {before} → {after} between {earlier_release} "
        f"and {later_release}; the area became {direction} deprived"
    )
    return PropertyEvent("area-deprivation-moved", published, detail)


def event_rates(properties: Sequence[Property]) -> dict[str, float]:
    """Share of properties carrying each derived event, as a percentage.

    Publishing a rate is how the extension and refurbishment counts stay
    checkable: the same corpus must reproduce the same figures.
    """
    if not properties:
        raise ValueError("cannot report event rates for an empty corpus")
    counts: dict[str, int] = {}
    for item in properties:
        for kind in {event.kind for event in item.events}:
            counts[kind] = counts.get(kind, 0) + 1
    return {
        kind: round(count / len(properties) * 100, 1) for kind, count in sorted(counts.items())
    }


def confidence_band_percent(
    years_since_sale: float, ladder: Sequence[tuple[float, float]]
) -> float:
    """Band width for a valuation, widened by the gap since the last observed sale."""
    if years_since_sale < 0:
        raise ValueError("years since sale cannot be negative")
    if not ladder:
        raise ValueError("confidence ladder is empty")
    if list(ladder) != sorted(ladder):
        raise ValueError("confidence ladder must ascend by years and by width")
    for maximum_years, percent in ladder:
        if years_since_sale <= maximum_years:
            return percent
    raise ValueError(f"no confidence band covers a gap of {years_since_sale:g} years")


def years_between(earlier: str, later: str) -> float:
    days = (_parse_date(later) - _parse_date(earlier)).days
    if days < 0:
        raise ValueError("the later date precedes the earlier date")
    return round(days / 365.25, 2)


def energy_band_rank(rating: str) -> int:
    try:
        return ENERGY_BANDS.index(rating.upper())
    except ValueError as error:
        raise ValueError(f"unknown energy rating: {rating}") from error


def _certificate_events(earlier: Certificate, later: Certificate) -> list[PropertyEvent]:
    events: list[PropertyEvent] = []
    growth_threshold = earlier.floor_area_square_metres * (1 + EXTENSION_FLOOR_AREA_GROWTH)
    if later.floor_area_square_metres > growth_threshold:
        events.append(
            PropertyEvent(
                "extended",
                later.lodged,
                f"Floor area rose from {earlier.floor_area_square_metres:g} m² "
                f"to {later.floor_area_square_metres:g} m²",
            )
        )
    band_rise = energy_band_rank(later.energy_rating) - energy_band_rank(earlier.energy_rating)
    if band_rise >= REFURBISHMENT_BAND_RISE:
        events.append(
            PropertyEvent(
                "refurbished",
                later.lodged,
                f"Energy rating rose from {earlier.energy_rating} to {later.energy_rating}",
            )
        )
    return events


def _validated_sale(sale: Sale) -> Sale:
    if sale.price <= 0:
        raise ValueError("a recorded sale price must be positive")
    if sale.tenure not in TENURES:
        raise ValueError(f"unsupported tenure: {sale.tenure}")
    _parse_date(sale.date)
    return sale


def _validated_certificate(certificate: Certificate) -> Certificate:
    if certificate.floor_area_square_metres <= 0:
        raise ValueError("certificate floor area must be positive")
    if certificate.rooms is not None and certificate.rooms <= 0:
        raise ValueError("certificate room count must be positive")
    if certificate.extension_count is not None and certificate.extension_count < 0:
        raise ValueError("certificate extension count cannot be negative")
    energy_band_rank(certificate.energy_rating)
    _parse_date(certificate.lodged)
    return certificate


def _cell_index(value: float, precision: float) -> int:
    return int(value // precision)


def _parse_date(value: str) -> date:
    return date.fromisoformat(value)
