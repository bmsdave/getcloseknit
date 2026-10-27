"""Bulk Price Paid + EPC linkage into internal linked sales (AE-15).

Raw bulk releases differ from the monthly-file shape the acquisition
adapters parse: the HMLR complete file ships without a header row, and
yearly domestic EPC extracts use snake_case where the retired service
used hyphenated columns. This module maps both into the internal record
shapes, then links each sale to the most specific EPC certificate whose
address tokens cover the sale address at the same postcode. A sale with
no covering certificate, no positive floor area, or no London geography
is reported with a reason and excluded; floor area is never inferred.

The EPC matching itself lives in :mod:`area_analytics.epc_link`, the one
tolerant linker for the whole pipeline (B3, #153): this module re-exports
its names so existing importers keep working.
"""

from typing import Any, Mapping

from .analytics import LinkedSale
from .epc_link import (  # noqa: F401  (re-exported for existing importers)
    EpcRecord,
    SAON_SYNONYMS,
    address_tokens,
    build_epc_index,
    canonical_tokens,
    compact_postcode,
    find_epc_match,
    link_sales_floor,
    map_epc_row,
    normalize_address_part,
    normalize_epc_columns,
    postcode_sector,
)

PP_COLUMNS = (
    "Transaction unique identifier",
    "Price",
    "Date of Transfer",
    "Postcode",
    "Property Type",
    "Old/New",
    "Duration",
    "PAON",
    "SAON",
    "Street",
    "Locality",
    "Town/City",
    "District",
    "County",
    "PPD Category Type",
    "Record Status - monthly file only",
)


def map_pp_row(cells: list) -> dict:
    """Map one headerless complete-file row to the internal sale mapping."""
    if len(cells) != len(PP_COLUMNS):
        raise ValueError(
            f"invalid-pp-row: expected {len(PP_COLUMNS)} columns, "
            f"saw {len(cells)}")
    record = dict(zip(PP_COLUMNS, [str(cell).strip() for cell in cells]))
    date = record["Date of Transfer"].split(" ")[0]
    record["Date of Transfer"] = date
    record["sale_month"] = date[:7]
    return record


def pp_sale_tokens(sale: Mapping[str, Any]) -> tuple[str, frozenset]:
    return (compact_postcode(sale.get("postcode", "")),
            address_tokens(sale.get("saon", ""), sale.get("paon", ""),
                           sale.get("street", "")))


def link_sale(sale: Mapping[str, Any], lsoa: str | None, msoa: str,
              borough: str,
              index: Mapping[str, list[EpcRecord]]) -> tuple:
    """Link one internal sale to floor area and geography.

    Returns (LinkedSale, None) on success or (None, reason) when the sale
    must be excluded: outside-london, no-epc-match.
    """
    if not lsoa:
        return None, "outside-london"
    postcode, tokens = pp_sale_tokens(sale)
    match = find_epc_match(
        postcode, tokens, index,
        paon_street_tokens=address_tokens(sale.get("paon", ""), sale.get("street", "")))
    if match is None:
        return None, "no-epc-match"
    try:
        price = int(str(sale.get("price", "")).strip().replace(",", ""))
    except (TypeError, ValueError):
        return None, "invalid-price"
    if price <= 0:
        return None, "invalid-price"
    return LinkedSale(
        transaction_id=str(sale.get("transaction_id", "")),
        period=str(sale.get("sale_month", "")),
        price=price,
        floor_area_sqm=match.floor_area_sqm,
        lsoa=lsoa,
        msoa=msoa,
        borough=borough,
        property_type=str(sale.get("property_type", "")),
        new_build=str(sale.get("new_build", "")) == "Y",
    ), None
