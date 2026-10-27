"""A portal listing matched to one recorded home, behind CLOSE_KNIT_ADDRESS_MATCH (and CLOSE_KNIT_HOME_VALUE).

Candidates are the homes we already hold (address, latest EPC, last HM Land Registry sale) at the
listing's postcode, or on its street in its area when the page gives no postcode. A candidate fits
when its floor area is within FLOOR_TOLERANCE of the listing's and its type does not contradict the
listing's; the listing's EPC rating and bedrooms (against the certificate's habitable rooms) then
agree or disagree. The address is returned only for exactly one fitting home ("high") or one fitting
home that nothing contradicts while every other fitting home has a contradiction ("medium").

A hidden home ("Report or hide this home", suppressed_dwelling) is never matched or shown, and is
never replaced by its neighbour: while a hidden home could be the listed one, nothing is returned.

With the value flag, the home block also carries a range: the last standard sale (Price Paid
category A, at most MAX_SALE_AGE_YEARS old) moved by the area's same-type median since that year,
spread like the area's middle half of same-type sales today; at least MIN_SALES sales each, or none.
"""
from __future__ import annotations

import logging

import re
from datetime import date
from typing import Any, Callable, Mapping, Sequence

from . import price_bands
from .epc_policy import per_home_epc
from .property_profile import (ACTIVE_MEMBERS, AREAS_SQL, PRICE_BANDS_SQL, PRICE_YEAR_SQL, normalise_postcode)

FLOOR_TOLERANCE = 0.03
MAX_SALE_AGE_YEARS = 15
logger = logging.getLogger(__name__)

CANDIDATE_LIMIT = 500
STREET_MIN_LETTERS = 4

PPD_TYPES = {"F": "flat", "T": "terraced", "S": "semi-detached", "D": "detached"}
VALUE_METHOD = (
    "Last recorded sale ({year}, £{price:,}) moved by the change in the middle {kind} sale price in "
    "{area} since then, spread like the middle half of {sales} {kind} sales there today. "
    "From area statistics, not a valuation: it can't see condition or improvements.")

CANDIDATES_SQL = """-- home-match:{marker}
SELECT a.id AS address_id, a.display_address, a.geography_id, p.uprn,
  last.property_type AS sale_type, e.property_type AS epc_type, e.built_form, e.current_rating,
  e.habitable_rooms, to_char(e.lodgement_date, 'YYYY-MM-DD') AS epc_date,
  coalesce(e.total_floor_area, last.floor_area_square_metres) AS floor,
  EXISTS (SELECT 1 FROM suppressed_dwelling s
          WHERE s.address_id = a.id OR (p.uprn IS NOT NULL AND s.uprn = p.uprn)) AS hidden
FROM address a
LEFT JOIN LATERAL (
  SELECT s.property_type, s.floor_area_square_metres FROM sale s
  WHERE s.address_id = a.id AND s.source_release_id IN """ + ACTIVE_MEMBERS + """
  ORDER BY s.completion_date DESC, s.price DESC LIMIT 1) last ON true
LEFT JOIN LATERAL (
  SELECT p.uprn FROM property p WHERE p.address_id = a.id AND p.source_release_id IN """ + ACTIVE_MEMBERS + """
  ORDER BY p.uprn LIMIT 1) p ON true
LEFT JOIN property_epc e ON e.uprn = p.uprn AND e.source_release_id IN """ + ACTIVE_MEMBERS + """
WHERE {where} AND a.source_release_id IN """ + ACTIVE_MEMBERS + """
LIMIT %s"""

POSTCODE_SQL = CANDIDATES_SQL.format(marker="postcode", where="a.postcode = %s")
STREET_SQL = CANDIDATES_SQL.format(
    marker="street", where="a.geography_id = %s AND upper(a.display_address) LIKE %s ESCAPE '\\'")

SALES_SQL = """-- home-match:sales
SELECT to_char(s.completion_date, 'YYYY-MM-DD') AS date, s.price, s.property_type, s.ppd_category
FROM sale s
WHERE s.address_id = %s AND s.source_release_id IN """ + ACTIVE_MEMBERS + """
ORDER BY s.completion_date, s.price"""


# ---- matching ----------------------------------------------------------------------------------------

def street_of(address: str | None) -> str | None:
    """'Flat 3, 12 Middleton Road, London, E8' -> 'MIDDLETON ROAD'; None without a usable street."""
    for part in (address or "").upper().split(","):
        street = re.sub(r"^(FLAT|APARTMENT|UNIT)\s+\S+\s*", "", part.strip())
        street = re.sub(r"^[0-9]+[A-Z]?(-[0-9]+[A-Z]?)?\s+", "", street).strip()
        if street in ("LONDON", "GREATER LONDON") or re.fullmatch(r"[A-Z]{1,2}[0-9][A-Z0-9]?( [0-9][A-Z]{2})?", street):
            continue
        if len(re.sub(r"[^A-Z]", "", street)) >= STREET_MIN_LETTERS:
            return street
    return None


def home_type(row: Mapping[str, Any]) -> str | None:
    """The home's type in the listing's words: from its last sale, else its certificate."""
    if row.get("sale_type") in PPD_TYPES:
        return PPD_TYPES[row["sale_type"]]
    epc_type, form = (row.get("epc_type") or "").lower(), (row.get("built_form") or "").lower()
    if epc_type in ("flat", "maisonette"):
        return "flat"
    if "semi" in form:
        return "semi-detached"
    if "terrace" in form:
        return "terraced"
    if "detached" in form:
        return "detached"
    return None


def _type_fits(listing_type: str, row: Mapping[str, Any]) -> bool:
    known = home_type(row)
    if listing_type in ("unknown", "other") or known is None:
        return True
    if listing_type == "bungalow":
        return known != "flat"
    return known == listing_type


def _floor_fits(listing_floor: float, row: Mapping[str, Any]) -> bool | None:
    """True/False against the listing's floor area; None when the home's is not recorded."""
    if row.get("floor") is None:
        return None
    return abs(float(row["floor"]) - listing_floor) <= listing_floor * FLOOR_TOLERANCE


def _evidence(facts: Mapping[str, Any], row: Mapping[str, Any]) -> tuple[int, int]:
    """(agreements, contradictions) of the listing's EPC rating, bedrooms and type with the home."""
    agree = contradict = 0
    if facts.get("epcRating") and row.get("current_rating"):
        if facts["epcRating"] == row["current_rating"]:
            agree += 1
        else:
            contradict += 1
    if facts.get("bedrooms") is not None and row.get("habitable_rooms"):
        # Habitable rooms count bedrooms plus living rooms (kitchens are not counted).
        if facts["bedrooms"] + 1 <= int(row["habitable_rooms"]) <= facts["bedrooms"] + 3:
            agree += 1
        else:
            contradict += 1
    if facts.get("propertyType") not in (None, "unknown", "other") and home_type(row) is not None:
        agree += 1
    return agree, contradict


def best_match(facts: Mapping[str, Any], rows: Sequence[Mapping[str, Any]]) -> tuple[Mapping[str, Any], str] | None:
    """(row, "high" | "medium") for the one home the listing describes, else None.

    ``facts``: floorAreaSqm (required), propertyType, epcRating, bedrooms, as the listing gives them.
    """
    floor = facts.get("floorAreaSqm")
    if not floor:
        return None
    listing_type = facts.get("propertyType") or "unknown"
    typed = [row for row in rows if _type_fits(listing_type, row)]
    fitting = [row for row in typed if _floor_fits(floor, row)]
    unknown_floor = [row for row in typed if _floor_fits(floor, row) is None]
    # A hidden home that could be the listed one (fits, or its floor area is unknown) stops the match.
    if any(row.get("hidden") for row in fitting + unknown_floor):
        return None
    if not fitting:
        return None
    scored = [(row, *_evidence(facts, row)) for row in fitting]
    clean = [item for item in scored if item[2] == 0]
    if len(scored) == 1 and clean:
        row, agree, _ = clean[0]
        return row, ("high" if agree >= 1 and not unknown_floor else "medium")
    if len(clean) == 1 and clean[0][1] >= 1:
        return clean[0][0], "medium"
    return None


# ---- the home block ----------------------------------------------------------------------------------

def home_block(connect: Callable[[], Any], facts: Mapping[str, Any], *, postcode: str | None,
               area_id: str | None, address: str | None, with_value: bool, today: date) -> dict | None:
    """The card's ``home`` block for one listing, or None when no single home matches."""
    if postcode:
        sql, params = POSTCODE_SQL, (normalise_postcode(postcode), CANDIDATE_LIMIT)
    else:
        street = street_of(address)
        if not (area_id and street):
            return None
        pattern = "%" + street.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        sql, params = STREET_SQL, (area_id, pattern, CANDIDATE_LIMIT)
    with connect() as connection:
        rows = list(connection.execute(sql, params))
        found = best_match(facts, rows)
        if found is None:
            return None
        row, confidence = found
        sales = list(connection.execute(SALES_SQL, (row["address_id"],)))
        value = None
        if with_value:
            try:
                value = _value(connection, row, sales, today)
            except Exception:  # noqa: BLE001 - the address and sales stand without a value range
                logger.warning("home value range not computed", exc_info=True)
                connection.rollback()
    block: dict[str, Any] = {"type": "home", "address": row["display_address"], "confidence": confidence}
    if per_home_epc() and (row.get("current_rating") or row.get("floor") is not None):
        block["epc"] = {"rating": row.get("current_rating"),
                        "floorAreaSqm": round(float(row["floor"])) if row.get("floor") is not None else None,
                        "date": row.get("epc_date")}
    if sales:
        block["sales"] = [{"date": sale["date"], "price": int(sale["price"])} for sale in sales]
    if value:
        block["value"] = value
    return block


def _value(connection: Any, row: Mapping[str, Any], sales: Sequence[Mapping[str, Any]], today: date) -> dict | None:
    last = sales[-1] if sales else None
    if not last or last["ppd_category"] != "A" or last["property_type"] not in price_bands.TYPE_LABELS:
        return None
    year = int(last["date"][:4])
    if (today - date.fromisoformat(last["date"])).days > MAX_SALE_AGE_YEARS * 365.25:
        return None
    areas = next(iter(connection.execute(AREAS_SQL, (row["geography_id"],))), None) or {}
    named = {level: (areas.get(f"{level}_id"), areas.get(f"{level}_name")) for level in price_bands.LEVELS}
    named["lsoa"] = (named["lsoa"][0] or row["geography_id"], named["lsoa"][1])
    ids = [area_id for area_id, _ in named.values() if area_id]
    kind = last["property_type"]
    bands = {r["geography_id"]: r for r in connection.execute(PRICE_BANDS_SQL, (ids, kind))}
    years = {r["geography_id"]: r for r in connection.execute(PRICE_YEAR_SQL, (ids, kind, year))}
    return value_range(int(last["price"]), year, kind, named, bands, years)


def value_range(price: int, year: int, kind: str, named: Mapping[str, tuple[str | None, str | None]],
                bands: Mapping[str, Mapping[str, Any]], years: Mapping[str, Mapping[str, Any]]) -> dict | None:
    """{low, high, method} or None when no level has MIN_SALES sales of the type both today and in ``year``."""
    def usable(level: str) -> bool:
        area_id = named[level][0]
        band, then = bands.get(area_id), years.get(area_id)
        return bool(band and then and all(band.get(q) for q in ("p25", "p50", "p75")) and then.get("p50"))

    sizes = {level: min(int(bands[named[level][0]]["sales"]), int(years[named[level][0]]["sales"]))
             for level in price_bands.LEVELS if usable(level)}
    level = price_bands.pick_level(sizes)
    if level is None:
        return None
    area_id, area_name = named[level]
    band, then = bands[area_id], years[area_id]
    moved = price * band["p50"] / then["p50"]
    low, high = moved * band["p25"] / band["p50"], moved * band["p75"] / band["p50"]
    words = price_bands.TYPE_LABELS[kind].lower()
    return {"low": price_bands.round_price(low), "high": price_bands.round_price(high),
            "method": VALUE_METHOD.format(year=year, price=price, kind=words, area=area_name or "this area",
                                          sales=int(band["sales"]))}
