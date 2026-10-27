"""Assemble the per-property dossier the explorer panel reads.

The pack is written as grid cells so a viewport reads only the properties it can
show. Peer membership stays internal: the pack publishes a distribution and a
count, never the addresses of the neighbours a property was compared against.
"""

from dataclasses import asdict
from typing import Any, Mapping, Sequence

from .decompose import Decomposition, ReferenceGroup, decompose, waterfall_total
from .peers import PeerCandidate, PeerSale, build_peer_groups, peer_median_by_year
from .properties import (
    Certificate,
    Property,
    Sale,
    area_deprivation_movement,
    build_properties,
    confidence_band_percent,
    property_id,
    years_between,
)
from .property_history import compare_historical_price


ESTIMATE_DISCLAIMER = (
    "An estimate built from medians of comparable recorded sales, not a valuation "
    "or a survey. Steps below the reliability gate are listed, not absorbed."
)


def build_property_pack(payload: Mapping[str, Any]) -> dict[str, Any]:
    valuation_date = _required(payload, "valuationDate")
    precision = float(payload.get("gridPrecisionDegrees", 0.01))
    bands = [(float(years), float(percent)) for years, percent in _required(payload, "confidenceBands")]
    candidates = [_peer_candidate(entry) for entry in payload.get("peerCandidates", [])]
    peer_sales = [
        PeerSale(entry["propertyId"], entry["year"], float(entry["pricePerSquareMetre"]))
        for entry in payload.get("peerSales", [])
    ]
    records = [_property_record(entry, precision) for entry in _required(payload, "properties")]
    spine = {item.property_id: item for item in build_properties(records)}
    dossiers = [
        _dossier(
            spine[_property_key(entry)],
            entry,
            payload,
            valuation_date,
            bands,
            candidates,
            peer_sales,
        )
        for entry in payload["properties"]
    ]
    dossiers.sort(key=lambda dossier: dossier["propertyId"])
    return {
        "schemaVersion": "property-pack.v1",
        "sourceVersion": _required(payload, "sourceVersion"),
        "valuationDate": valuation_date,
        "cells": _cells(spine),
        "properties": dossiers,
    }


def _dossier(
    spine_entry: Property,
    entry: Mapping[str, Any],
    payload: Mapping[str, Any],
    valuation_date: str,
    bands: Sequence[tuple[float, float]],
    candidates: Sequence[PeerCandidate],
    peer_sales: Sequence[PeerSale],
) -> dict[str, Any]:
    transactions = [_transaction(sale, entry, spine_entry, payload) for sale in spine_entry.sales]
    latest_certificate = spine_entry.certificates[-1] if spine_entry.certificates else None
    if latest_certificate is None:
        raise ValueError(f"{spine_entry.property_id} has no certificate, so it has no floor area")
    floor_area = latest_certificate.floor_area_square_metres
    last_sale = transactions[-1] if transactions else None
    observed = _observed_price(last_sale)
    reference = _required(entry, "reference")
    decomposition = decompose(
        floor_area,
        _reference_group(reference["baseline"]),
        [_reference_group(step) for step in reference["steps"]],
        observed_price=observed,
    )
    years_since_sale = (
        years_between(spine_entry.sales[-1].date, valuation_date) if spine_entry.sales else None
    )
    subject = _peer_candidate(_subject_record(entry, spine_entry, floor_area, decomposition))
    groups = build_peer_groups(subject, candidates)
    events = list(spine_entry.events)
    movement = _deprivation_event(payload, spine_entry.lsoa)
    if movement is not None:
        events.append(movement)
    return {
        "schemaVersion": "property-dossier.v1",
        "propertyId": spine_entry.property_id,
        "address": entry.get("displayAddress", spine_entry.address),
        "postcode": spine_entry.postcode,
        "geographyId": f"uk:lsoa:{spine_entry.lsoa}",
        "valuation": {
            "estimate": decomposition.estimate,
            "estimatePricePerSquareMetre": decomposition.estimate_price_per_square_metre,
            "floorAreaSquareMetres": floor_area,
            "yearsSinceSale": years_since_sale,
            "confidenceBandPercent": (
                None if years_since_sale is None else confidence_band_percent(years_since_sale, bands)
            ),
            "lastSale": last_sale,
        },
        "history": {
            "propertyId": spine_entry.property_id,
            "address": entry.get("displayAddress", spine_entry.address),
            "geographyId": f"uk:lsoa:{spine_entry.lsoa}",
            "transactions": transactions,
            "estimateDisclaimer": ESTIMATE_DISCLAIMER,
            "sourceVersion": payload["sourceVersion"],
        },
        "decomposition": _decomposition_json(decomposition),
        "peerGroups": [_peer_group_json(group) for group in groups],
        "peerMedianByYear": [
            {
                "year": year.year,
                "pricePerSquareMetre": year.median_price_per_square_metre,
                "sampleCount": year.sample_count,
            }
            for year in peer_median_by_year(groups[0].member_ids, peer_sales)
        ],
        "events": [asdict(event) for event in sorted(events, key=lambda item: (item.date, item.kind))],
        "notModelled": list(payload.get("notModelled", [])),
        "sourceVersion": payload["sourceVersion"],
    }


def _transaction(
    sale: Sale,
    entry: Mapping[str, Any],
    spine_entry: Property,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    source = _sale_source(entry, sale)
    floor_area = _floor_area_in_force(sale.date, spine_entry.certificates)
    comparison = compare_historical_price(
        nominal_price=sale.price,
        cpih_at_sale=float(source["cpih"]),
        cpih_latest=float(_required(payload, "cpihLatest")),
        local_price_per_square_metre_at_sale=_optional_float(source.get("localPricePerSquareMetre")),
        local_price_per_square_metre_latest=_optional_float(
            entry.get("localPricePerSquareMetreLatest")
        ),
    )
    return {
        "date": sale.date,
        "nominalPrice": sale.price,
        "newBuild": sale.new_build,
        "tenure": sale.tenure,
        "floorAreaSquareMetres": floor_area,
        "pricePerSquareMetre": None if floor_area is None else round(sale.price / floor_area),
        "inflationAdjustedPrice": comparison.inflation_adjusted_price,
        "localMarketAdjustedPrice": comparison.local_market_adjusted_price,
    }


def _decomposition_json(decomposition: Decomposition) -> dict[str, Any]:
    total = waterfall_total(decomposition)
    if total != decomposition.estimate:
        raise ValueError("the waterfall does not sum to the estimate it explains")
    return {
        "baselineLabel": decomposition.baseline_label,
        "baselinePrice": decomposition.baseline_price,
        "baselinePricePerSquareMetre": decomposition.baseline_price_per_square_metre,
        "contributions": [
            {
                "label": contribution.label,
                "pricePerSquareMetre": contribution.price_per_square_metre,
                "amount": contribution.amount,
                "sampleCount": contribution.sample_count,
            }
            for contribution in decomposition.contributions
        ],
        "estimate": decomposition.estimate,
        "residual": decomposition.residual,
        "skipped": [
            {"label": step.label, "reason": step.reason} for step in decomposition.skipped
        ],
    }


def _peer_group_json(group) -> dict[str, Any]:
    return {
        "id": group.id,
        "label": group.label,
        "definition": group.definition,
        "status": group.status,
        "count": group.count,
        "distribution": None if group.distribution is None else asdict(group.distribution),
        "percentile": group.percentile,
    }


def _property_record(entry: Mapping[str, Any], precision: float) -> dict[str, Any]:
    return {
        "postcode": _required(entry, "postcode"),
        "primary_address": _required(entry, "primaryAddress"),
        "secondary_address": entry.get("secondaryAddress"),
        "latitude": float(_required(entry, "latitude")),
        "longitude": float(_required(entry, "longitude")),
        "lsoa": _required(entry, "lsoa"),
        "msoa": _required(entry, "msoa"),
        "borough": _required(entry, "borough"),
        "grid_precision": precision,
        "sales": [
            Sale(
                date=sale["date"],
                price=int(sale["price"]),
                new_build=bool(sale.get("newBuild", False)),
                tenure=sale["tenure"],
            )
            for sale in entry.get("sales", [])
        ],
        "certificates": [
            Certificate(
                lodged=certificate["lodged"],
                floor_area_square_metres=float(certificate["floorAreaSquareMetres"]),
                energy_rating=certificate["energyRating"],
                rooms=certificate.get("rooms"),
                construction_age_band=certificate.get("constructionAgeBand"),
                built_form=certificate.get("builtForm"),
                extension_count=certificate.get("extensionCount"),
            )
            for certificate in entry.get("certificates", [])
        ],
    }


def _subject_record(
    entry: Mapping[str, Any],
    spine_entry: Property,
    floor_area: float,
    decomposition: Decomposition,
) -> dict[str, Any]:
    deciles = _required(entry, "deciles")
    return {
        "propertyId": spine_entry.property_id,
        "propertyType": _required(entry, "propertyType"),
        "floorAreaSquareMetres": floor_area,
        "price": decomposition.estimate,
        "pricePerSquareMetre": decomposition.estimate_price_per_square_metre,
        "priceDecile": deciles["price"],
        "msoa": spine_entry.msoa,
        "borough": spine_entry.borough,
        "crimeDecile": deciles["crime"],
        "deprivationDecile": deciles["deprivation"],
        "incomeDecile": deciles["income"],
    }


def _peer_candidate(entry: Mapping[str, Any]) -> PeerCandidate:
    return PeerCandidate(
        property_id=entry["propertyId"],
        property_type=entry["propertyType"],
        floor_area_square_metres=float(entry["floorAreaSquareMetres"]),
        price=int(entry["price"]),
        price_per_square_metre=float(entry["pricePerSquareMetre"]),
        price_decile=int(entry["priceDecile"]),
        msoa=entry["msoa"],
        borough=entry["borough"],
        crime_decile=int(entry["crimeDecile"]),
        deprivation_decile=int(entry["deprivationDecile"]),
        income_decile=int(entry["incomeDecile"]),
    )


def _deprivation_event(payload: Mapping[str, Any], lsoa: str):
    movement = payload.get("deprivation")
    if not movement:
        return None
    return area_deprivation_movement(
        lsoa,
        {code: int(value) for code, value in movement["earlier"].items()},
        {code: int(value) for code, value in movement["later"].items()},
        earlier_release=movement["earlierRelease"],
        later_release=movement["laterRelease"],
        published=movement["published"],
    )


def _cells(spine: Mapping[str, Property]) -> dict[str, list[str]]:
    cells: dict[str, list[str]] = {}
    for item in sorted(spine.values(), key=lambda entry: entry.property_id):
        cells.setdefault(item.cell, []).append(item.property_id)
    return cells


def _property_key(entry: Mapping[str, Any]) -> str:
    return property_id(entry["postcode"], entry["primaryAddress"], entry.get("secondaryAddress"))


def _sale_source(entry: Mapping[str, Any], sale: Sale) -> Mapping[str, Any]:
    for source in entry.get("sales", []):
        if source["date"] == sale.date and int(source["price"]) == sale.price:
            return source
    raise ValueError(f"no source row for the sale on {sale.date}")


def _floor_area_in_force(sale_date: str, certificates: Sequence[Certificate]) -> float | None:
    in_force = [
        certificate for certificate in certificates if certificate.lodged <= sale_date
    ]
    return in_force[-1].floor_area_square_metres if in_force else None


def _observed_price(last_sale: Mapping[str, Any] | None) -> int | None:
    if last_sale is None:
        return None
    return last_sale["localMarketAdjustedPrice"] or last_sale["inflationAdjustedPrice"]


def _reference_group(entry: Mapping[str, Any]) -> ReferenceGroup:
    return ReferenceGroup(
        label=entry["label"],
        median_price_per_square_metre=float(entry["medianPricePerSquareMetre"]),
        sample_count=int(entry["sampleCount"]),
    )


def _required(payload: Mapping[str, Any], key: str) -> Any:
    if key not in payload:
        raise ValueError(f"reviewed input is missing {key!r}")
    return payload[key]


def _optional_float(value: Any) -> float | None:
    return None if value is None else float(value)
