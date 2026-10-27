"""Property profile and postcode home list (track K).

Two reads over the active release:
- ``postcode_homes``: every address in a postcode with its type and tenure
  (last Price Paid record), floor area and energy rating (latest EPC) and
  last sale.
- ``property_profile``: one dwelling's recorded sales, EPC facts and the
  other homes at its postcode, plus "Prices in this area today": the
  area's price range for its type and the coarse band its last sale fell in
  (``price_bands``, migration 040).

Homes known only from an energy certificate (no recorded sale, no spine UPRN;
``property_epc_home``, migration 089) are listed and get a profile only while
CLOSE_KNIT_EPC_ADDRESSES is on AND the table exists on the database: their address
is the certificate's, which carries Royal Mail/OS rights. With the flag off, or on a
database where migration 089 was never applied, nothing reads that table and the
recorded homes keep working (issue #182).

Owner decision: nothing here states what one home is worth (no
restated value, no estimate); recorded facts and area statistics only. The one
exception waits behind CLOSE_KNIT_PER_HOME_VALUATION (default off): ``valuation``
is null and withheld unless it is on (valuation.py).
Missing data stays ``None`` so the page can say "unknown" instead of 0.
"""
from __future__ import annotations

import logging
import re
from types import SimpleNamespace
from typing import Any, Callable, Mapping

from . import card_cache, feature_flags, market, price_bands, valuation
from .epc_policy import floor_area_note, per_home
from .flood import DWELLING_FLOOD_SQL, band_name
from .evidence import (
    ADDRESS_PATTERN,
    NOT_SUPPRESSED_ADDRESS,
    NOT_SUPPRESSED_PROPERTY,
    UPRN_PATTERN,
    AddressNotFound,
    AreaNotFound,
    Cancelled,
    MalformedQuery,
    PropertyNotFound,
    _active_release,
    _check_cancelled,
    friendly_title,
)

LOGGER = logging.getLogger(__name__)

__all__ = ["address_profile", "home_index", "postcode_homes", "property_profile", "normalise_postcode"]

POSTCODE_PATTERN = re.compile(r"^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$")
POSTCODE_IN_ADDRESS = re.compile(r"([A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2})\s*$")
POSTCODE_HOME_LIMIT = 500

PRICE_PAID_TYPES = {"D": "Detached", "S": "Semi-detached", "T": "Terraced", "F": "Flat or maisonette",
                    "O": "Other"}
TENURES = {"F": "Freehold", "L": "Leasehold"}

PROFILE_DISCLAIMER = (
    "Recorded sales are facts from HM Land Registry. Area prices describe this area's sales, "
    "not a valuation of this home.")
POSTCODE_DISCLAIMER = (
    "Recorded sale prices from HM Land Registry and facts from the latest energy certificate. "
    "No home here is valued.")
PROFILE_CAVEATS = (
    "Type comes from the latest standard Land Registry sale (else the energy certificate); tenure "
    "from the last record; rooms, age and rating from the latest energy certificate, which can be "
    "years old.",
    "Area prices use standard market sales only (Price Paid category A), each adjusted to the latest "
    "month by the local price index; at least 5 sales of the type, or nothing is shown.",
    # Reconciling caveat (#163, after the #148 owner decision): the valuation and the bands
    # can disagree without either being wrong.
    "The valuation restates this home's own last standard sale at today's index; the area prices "
    "show its type's range. They differ when the home sold above or below its type's typical "
    "range, or when the index moved since the sale.",
)

ACTIVE_MEMBERS = """(SELECT m.source_release_id FROM active_product_release a
   JOIN product_release_member m ON m.release_id = a.release_id)"""

# What the row is for a postcode list: its type comes from the newest standard
# (Price Paid category A) sale with a priced type, never from a trailing 'O'
# (other) ancillary transfer (share-of-freehold, lease) like the last-record logic
# used to; its last sale facts stay the newest record's.
POSTCODE_HOMES_SQL = """-- property-profile:postcode-homes
SELECT a.id AS address_id, a.display_address, a.postcode, a.geography_id,
  p.uprn, typed.property_type, last.tenure, to_char(last.completion_date, 'YYYY-MM-DD') AS last_date,
  last.price AS last_price, coalesce(last.sale_count, 0) AS sale_count,
  coalesce(e.total_floor_area, last.floor_area_square_metres) AS floor, e.current_rating,
  f.rivers_sea_band, f.surface_water_band
FROM address a
LEFT JOIN LATERAL (
  SELECT s.property_type, s.tenure, s.completion_date, s.price, s.floor_area_square_metres,
    count(*) OVER () AS sale_count
  FROM sale s WHERE s.address_id = a.id AND s.source_release_id IN """ + ACTIVE_MEMBERS + """
  ORDER BY s.completion_date DESC, s.price DESC LIMIT 1) last ON true
LEFT JOIN LATERAL (
  SELECT s.property_type
  FROM sale s WHERE s.address_id = a.id AND s.source_release_id IN """ + ACTIVE_MEMBERS + """
    AND s.ppd_category = 'A' AND s.property_type <> 'O'
  ORDER BY s.completion_date DESC, s.price DESC LIMIT 1) typed ON true
LEFT JOIN LATERAL (
  SELECT p.uprn FROM property p WHERE p.address_id = a.id AND p.source_release_id IN """ + ACTIVE_MEMBERS + """
  ORDER BY p.uprn LIMIT 1) p ON true
LEFT JOIN property_epc e ON e.uprn = p.uprn AND e.source_release_id IN """ + ACTIVE_MEMBERS + """
LEFT JOIN dwelling_flood f ON f.uprn = p.uprn
WHERE a.postcode = %s AND a.source_release_id IN """ + ACTIVE_MEMBERS + """
  AND """ + NOT_SUPPRESSED_ADDRESS + """
  AND (p.uprn IS NULL OR NOT EXISTS (SELECT 1 FROM suppressed_dwelling d WHERE d.uprn = p.uprn))
LIMIT %s"""

# Homes known only from an energy certificate (migration 089), read only behind
# feature_flags.epc_addresses(): never one the spine now knows, never a hidden one.
EPC_HOME_FILTER = """h.source_release_id IN """ + ACTIVE_MEMBERS + """
  AND NOT EXISTS (SELECT 1 FROM property p WHERE p.uprn = h.uprn AND p.source_release_id IN """ + ACTIVE_MEMBERS + """)
  AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling d WHERE d.uprn = h.uprn)"""

# Migration 089's table may not be on the database yet (FLAGS.md: "not loaded on prod
# yet"), while the flag is on in private preview when unset. A flag that is on but whose
# table is missing must not break the recorded homes: the reads below run only when this
# says the table exists (the places.py area_rank pattern).
EPC_TABLE_SQL = """-- property-profile:epc-table
SELECT to_regclass('property_epc_home') IS NOT NULL AS t"""

_epc_table_missing_warned = False


def epc_addresses_ready(connection: Any) -> bool:
    """CLOSE_KNIT_EPC_ADDRESSES is on AND migration 089's table exists on this database.

    A flag that is on but not yet deployed degrades to "no EPC-only homes" instead of
    raising "relation does not exist" (issue #182: every get_home_prices call answered
    internal-error on prod). The missing table is logged loudly once per process."""
    if not feature_flags.epc_addresses():
        return False
    try:
        ready = bool(list(connection.execute(EPC_TABLE_SQL))[0]["t"])
    except Exception:  # noqa: BLE001 - a failed check degrades like a missing table
        LOGGER.exception("epc-table check failed; treating CLOSE_KNIT_EPC_ADDRESSES as off")
        return False
    if not ready:
        global _epc_table_missing_warned
        if not _epc_table_missing_warned:
            _epc_table_missing_warned = True
            LOGGER.error("CLOSE_KNIT_EPC_ADDRESSES is on but property_epc_home is missing: "
                         "EPC-only homes are hidden until migration 089 is applied")
    return ready

EPC_HOMES_SQL = """-- property-profile:epc-homes
SELECT h.uprn, h.display_address, h.postcode, h.geography_id, h.property_type AS epc_type, h.built_form,
  h.total_floor_area AS floor, h.current_rating, f.rivers_sea_band, f.surface_water_band
FROM property_epc_home h
LEFT JOIN dwelling_flood f ON f.uprn = h.uprn
WHERE h.postcode = %s AND """ + EPC_HOME_FILTER + """
LIMIT %s"""

# One EPC-only home in PROPERTY_SQL's shape plus its certificate facts in EPC_SQL's.
EPC_HOME_SQL = """-- property-profile:epc-home
SELECT h.uprn, NULL::text AS address_id, h.display_address, h.postcode, h.geography_id,
  ST_X(h.location) AS lon, ST_Y(h.location) AS lat, h.source_release_id,
  to_char(h.lodgement_date, 'YYYY-MM-DD') AS lodgement_date, h.current_rating, h.potential_rating,
  h.property_type, h.built_form, h.construction_age_band, h.total_floor_area, h.habitable_rooms, h.floor_level
FROM property_epc_home h
WHERE h.uprn = %s AND """ + EPC_HOME_FILTER

# Every recorded sale of the listed homes in one statement (the same rows as each
# address's /history), so a postcode page needs one call, not one per home.
POSTCODE_SALES_SQL = """-- property-profile:postcode-sales
SELECT t.address_id, to_char(t.completion_date, 'YYYY-MM-DD') AS date,
  t.nominal_price AS price, t.floor_area_square_metres AS floor
FROM address_transaction t
JOIN address a ON a.id = t.address_id
WHERE t.address_id = ANY(%s) AND t.source_release_id IN """ + ACTIVE_MEMBERS + """
  AND """ + NOT_SUPPRESSED_ADDRESS + """
ORDER BY t.address_id, t.completion_date, t.nominal_price"""

# The sitemap's per-address pages, one postcode sector at a time (web app/postcode/sitemap.ts):
# every postcode with a home and every home with a page, by the same filters as the pages, so a
# hidden home is never listed. The BETWEEN keeps the postcode index usable whatever the collation;
# the LIKE is the exact sector test.
SECTOR_ADDRESSES = """a.postcode BETWEEN %(low)s AND %(high)s AND a.postcode LIKE %(prefix)s
  AND a.source_release_id IN """ + ACTIVE_MEMBERS + """
  AND """ + NOT_SUPPRESSED_ADDRESS

HOME_INDEX_POSTCODES_SQL = """-- property-profile:home-index-postcodes
SELECT DISTINCT a.postcode FROM address a
WHERE """ + SECTOR_ADDRESSES + """
ORDER BY a.postcode"""

HOME_INDEX_UPRNS_SQL = """-- property-profile:home-index-uprns
SELECT DISTINCT p.uprn FROM address a JOIN property p ON p.address_id = a.id
WHERE """ + SECTOR_ADDRESSES + """
  AND p.source_release_id IN """ + ACTIVE_MEMBERS + """
  AND """ + NOT_SUPPRESSED_PROPERTY + """
ORDER BY p.uprn"""

HOME_INDEX_EPC_SQL = """-- property-profile:home-index-epc
SELECT h.postcode, h.uprn FROM property_epc_home h
WHERE h.postcode BETWEEN %(low)s AND %(high)s AND h.postcode LIKE %(prefix)s AND """ + EPC_HOME_FILTER

SECTOR_CODE_PATTERN = re.compile(r"^([A-Z]{1,2}[0-9][A-Z0-9]?) ([0-9])$")


def home_index(connect: Callable[[], Any], sector: str, cancel: Callable[[], bool] | None = None) -> dict:
    """home-index.v1: one sector's postcodes and UPRNs ("W5-1" or "W5 1"); empty lists for a sector with none."""
    _check_cancelled(cancel)
    code = re.sub(r"[\s\-_]+", " ", (sector or "").strip().upper())
    if not SECTOR_CODE_PATTERN.match(code):
        raise MalformedQuery(f"invalid postcode sector: {sector}")
    bounds = {"low": code, "high": f"{code}ZZ", "prefix": f"{code}%"}
    with connect() as connection:
        release_id = _active_release(connection, cancel)
        _check_cancelled(cancel)
        postcodes = [row["postcode"] for row in connection.execute(HOME_INDEX_POSTCODES_SQL, bounds)]
        uprns = [row["uprn"] for row in connection.execute(HOME_INDEX_UPRNS_SQL, bounds)]
        if epc_addresses_ready(connection):
            epc = list(connection.execute(HOME_INDEX_EPC_SQL, bounds))
            postcodes = sorted(set(postcodes) | {row["postcode"] for row in epc})
            uprns = sorted(set(uprns) | {row["uprn"] for row in epc})
    return {"schemaVersion": "home-index.v1", "productReleaseId": release_id, "sector": code,
            "postcodes": postcodes, "uprns": uprns}


ADDRESS_ROW_SQL = """-- property-profile:address-row
SELECT a.id AS address_id, a.display_address, a.postcode, a.geography_id, a.source_release_id
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN address a ON a.id = %s AND a.source_release_id = member.source_release_id
WHERE """ + NOT_SUPPRESSED_ADDRESS

# A home with recorded sales but no linked UPRN: no certificate is linked either,
# so its EPC facts are empty and its facts stay under the same flags as a profile's.
ADDRESS_CAVEAT = "No UPRN or energy certificate is linked to this home; figures are for its area."


def address_profile(connect: Callable[[], Any], address_id: str,
                    cancel: Callable[[], bool] | None = None) -> dict:
    """A price profile for a home known only from `address` (B2): the same shape as
    property_profile, built from address + address_transaction, so every home that
    search_places lists is reachable. No EPC facts (no certificate is linked), no
    parcel, no home point. `withheld` names the flags as usual."""
    _check_cancelled(cancel)
    if not ADDRESS_PATTERN.match(address_id or ""):
        raise MalformedQuery(f"invalid address id: {address_id}")
    with connect() as connection:
        release_id = _active_release(connection, cancel)
        rows = list(connection.execute(ADDRESS_ROW_SQL, (address_id,)))
        if not rows:
            raise PropertyNotFound(f"unknown address: {address_id}")
        row = rows[0]
        _check_cancelled(cancel)
        sales = list(connection.execute(SALES_SQL, (address_id,)))
        if not sales:
            raise PropertyNotFound(f"no recorded sales for address: {address_id}")
        area_rows = list(connection.execute(AREAS_SQL, (row["geography_id"],)))
        areas = area_rows[0] if area_rows else {}
        last = sales[-1] if sales else None
        typing = _typing_sale(sales)
        type_code = typing["property_type"] if typing else None
        named = _areas(areas, row["geography_id"])
        ids = [area["id"] for area in named.values() if area and area.get("id")]
        bands, years = {}, {}
        if type_code in price_bands.TYPE_LABELS and ids:
            bands = {r["geography_id"]: r for r in connection.execute(PRICE_BANDS_SQL, (ids, type_code))}
            if last and last["ppd_category"] == "A":
                years = {r["geography_id"]: r for r in connection.execute(
                    PRICE_YEAR_SQL, (ids, type_code, int(last["date"][:4])))}
        last_sale = ({"date": last["date"], "price": last["price"], "standard": last["ppd_category"] == "A"}
                     if last else None)
        prices = price_bands.area_prices(
            type_code, [(level, named[level]) for level in price_bands.LEVELS], bands, years, last_sale)
        facts = _facts(None, last, sales)
        facts["propertyType"] = PRICE_PAID_TYPES.get(type_code or "")
        local = (_local_market(connection, type_code, prices["range"], bands, facts["floorAreaSquareMetres"], release_id)
                 if feature_flags.per_home_valuation() else None)
        _check_cancelled(cancel)
        neighbours = list(connection.execute(POSTCODE_HOMES_SQL, (row["postcode"], POSTCODE_HOME_LIMIT)))
        epc_neighbours = _epc_homes(connection, row["postcode"], POSTCODE_HOME_LIMIT - len(neighbours))

    index = _borough_index(connect, named["borough"], type_code, cancel) if last else None
    # Only standard market sales (category A) are indexed or compared.
    recent = _with_previous([sale for sale in sales if sale["ppd_category"] == "A"])
    estimate = (valuation.estimate({"floorAreaSquareMetres": facts["floorAreaSquareMetres"], "lastSale": recent},
                                   local, index) if feature_flags.per_home_valuation() else None)
    others = sorted([_home(home) for home in neighbours if home["address_id"] != address_id]
                    + [_epc_home(home) for home in epc_neighbours],
                    key=lambda home: natural_key(home["displayAddress"]))
    return {
        "schemaVersion": "property-profile.v2",
        "productReleaseId": release_id,
        "profile": {
            "uprn": None,
            "addressId": address_id,
            "displayAddress": row["display_address"],
            "postcode": row["postcode"],
            "location": None,  # no home point without a UPRN (see B7)
            "areas": named,
            "facts": facts,
            "areaPrices": prices,
            "valuation": estimate,  # null unless per_home_valuation()
            "sales": [_sale(sale) for sale in sales],
            "salesSummary": {"changeSinceLastSale": valuation.annualised_change(recent, index)},
            "otherHomes": [{key: home[key] for key in ("addressId", "uprn", "displayAddress", "lastSale")}
                           for home in others],
            "disclaimer": PROFILE_DISCLAIMER,
            "caveats": [ADDRESS_CAVEAT, *PROFILE_CAVEATS],
            "sourceVersion": row["source_release_id"],
            "withheld": feature_flags.withheld(),
        },
    }


def sales_disclaimer() -> str:
    # Per-sale £/m² is served only behind per_home_price_per_sqm() (which needs per-home EPC).
    per_m2 = "" if feature_flags.per_home_price_per_sqm() else "; no sale carries a price per m²"
    return ("Recorded achieved sale prices, not valuations or asking prices. "
            f"{floor_area_note()}{per_m2}.")

# A hidden home (suppressed_dwelling, "Report or hide this home") is not found at
# all, so nothing about it is shown: no sales, no area position.
PROPERTY_SQL = """-- property-profile:property
SELECT p.uprn, p.address_id, p.address AS display_address, p.geography_id,
  ST_X(p.location) AS lon, ST_Y(p.location) AS lat, p.source_release_id
FROM property p
WHERE p.uprn = %s AND p.source_release_id IN """ + ACTIVE_MEMBERS + """
  AND """ + NOT_SUPPRESSED_PROPERTY

ADDRESS_POSTCODE_SQL = """-- property-profile:address
SELECT a.postcode FROM address a WHERE a.id = %s"""

EPC_SQL = """-- property-profile:epc
SELECT to_char(e.lodgement_date, 'YYYY-MM-DD') AS lodgement_date, e.current_rating, e.potential_rating,
  e.property_type, e.built_form, e.construction_age_band, e.total_floor_area, e.habitable_rooms, e.floor_level
FROM property_epc e
WHERE e.uprn = %s AND e.source_release_id IN """ + ACTIVE_MEMBERS

SALES_SQL = """-- property-profile:sales
SELECT s.transaction_id, to_char(s.completion_date, 'YYYY-MM-DD') AS date, to_char(s.sale_month, 'YYYY-MM') AS period,
  s.price, s.property_type, s.new_build, s.tenure, s.ppd_category, s.floor_area_square_metres AS floor,
  s.source_release_id
FROM sale s
WHERE s.address_id = %s AND s.source_release_id IN """ + ACTIVE_MEMBERS + """
ORDER BY s.completion_date, s.price"""

# With each area's friendly name (migration 023), so the page names "Peckham Rye Common · SE22",
# never "Southwark 028A".
AREAS_SQL = """-- property-profile:areas
SELECT l.id AS lsoa_id, l.name AS lsoa_name, m.id AS msoa_id, m.name AS msoa_name,
  b.id AS borough_id, b.name AS borough_name,
  ll.friendly_name AS lsoa_friendly, ll.postcode_district AS lsoa_district,
  ml.friendly_name AS msoa_friendly, ml.postcode_district AS msoa_district
FROM area_geography l
LEFT JOIN area_geography m ON m.id = l.parent_id AND m.kind = 'msoa'
LEFT JOIN area_geography b ON b.id = m.parent_id AND b.kind = 'lad'
LEFT JOIN area_label ll ON ll.geography_id = l.id
LEFT JOIN area_label ml ON ml.geography_id = m.id
WHERE l.id = %s"""

PRICE_BANDS_SQL = """-- property-profile:price-bands
SELECT geography_id, to_char(window_start, 'YYYY-MM') AS window_start, to_char(period, 'YYYY-MM') AS period,
  sales, p10, p25, p50, p75, p90
FROM area_price_band
WHERE source_release_id IN """ + ACTIVE_MEMBERS + """
  AND geography_id = ANY(%s) AND property_type = %s"""

PRICE_YEAR_SQL = """-- property-profile:price-year
SELECT geography_id, sales, p10, p25, p50, p75, p90
FROM area_price_year
WHERE source_release_id IN """ + ACTIVE_MEMBERS + """
  AND geography_id = ANY(%s) AND property_type = %s AND year = %s"""


def normalise_postcode(value: str) -> str:
    compact = re.sub(r"[\s\-_]+", "", (value or "").upper())
    match = POSTCODE_PATTERN.match(compact)
    if not match:
        raise MalformedQuery(f"invalid postcode: {value}")
    return f"{match.group(1)} {match.group(2)}"


def natural_key(text: str) -> tuple:
    """'Flat 2, 10 High St' sorts before 'Flat 10, 10 High St'."""
    return tuple((0, int(part), "") if part.isdigit() else (1, 0, part.lower())
                 for part in re.findall(r"\d+|\D+", text or ""))


def postcode_homes(connect: Callable[[], Any], postcode: str,
                   cancel: Callable[[], bool] | None = None, *, include_sales: bool = False) -> dict:
    """Every home in a postcode; with include_sales, each home also carries its
    recorded sales (date, price, floor area, price per m2) as its address history does."""
    _check_cancelled(cancel)
    code = normalise_postcode(postcode)
    with connect() as connection:
        release_id = _active_release(connection, cancel)
        _check_cancelled(cancel)
        rows = list(connection.execute(POSTCODE_HOMES_SQL, (code, POSTCODE_HOME_LIMIT)))
        epc_rows = _epc_homes(connection, code, POSTCODE_HOME_LIMIT - len(rows))
        sold = [row["address_id"] for row in rows if int(row.get("sale_count") or 0) > 0]
        sales = list(connection.execute(POSTCODE_SALES_SQL, (sold,))) if include_sales and sold else []
    if not rows and not epc_rows:
        raise AddressNotFound(f"no recorded homes in postcode: {code}")
    homes = sorted([_home(row) for row in rows] + [_epc_home(row) for row in epc_rows],
                   key=lambda home: natural_key(home["displayAddress"]))
    if include_sales:
        by_address: dict[str, list[dict]] = {}
        for sale in sales:
            by_address.setdefault(sale["address_id"], []).append(per_home({
                "date": sale["date"], "nominalPrice": sale["price"],
                "floorAreaSquareMetres": sale["floor"]}))
        for home in homes:
            home["sales"] = by_address.get(home["addressId"], [])
    extra = {"salesDisclaimer": sales_disclaimer()} if include_sales else {}
    return {
        "schemaVersion": "postcode-homes.v1",
        "productReleaseId": release_id,
        "postcode": code,
        "geographyId": (rows or epc_rows)[0]["geography_id"],
        "homes": homes,
        "disclaimer": POSTCODE_DISCLAIMER,
        "withheld": feature_flags.withheld(),
        **extra,
    }

# The local same-type £/m² quartiles for the floor-area estimate (flagged): standard sales
# with a floor area in the price range's area and window (nominal prices). The area's neighbourhoods are listed
# first, then their addresses and sales by index: matching the area on every sale's address (as before) read all
# of England's sales of the type, 1.2 s for a borough, and a home page waits 2.5 s for its whole profile.
TYPE_PPM_SQL = """-- property-profile:type-ppm
WITH inside AS (
  SELECT l.id FROM area_geography l LEFT JOIN area_geography m ON m.id = l.parent_id
  WHERE l.kind = 'lsoa' AND %s IN (l.id, m.id, m.parent_id)
)
SELECT count(*) AS sales,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY s.price_per_square_metre) AS p25,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY s.price_per_square_metre) AS p50,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY s.price_per_square_metre) AS p75
FROM inside
JOIN address a ON a.geography_id = inside.id
JOIN sale s ON s.address_id = a.id
WHERE s.source_release_id IN """ + ACTIVE_MEMBERS + """
  AND s.property_type = %s AND s.ppd_category = 'A' AND s.price_per_square_metre IS NOT NULL
  AND s.sale_month >= %s::date"""
# Per release, area, type and window: every home of an area shares them, and they change only with a release.
_TYPE_PPM = card_cache.TTLCache(limit=5_000)


def property_profile(connect: Callable[[], Any], uprn: str,
                     cancel: Callable[[], bool] | None = None) -> dict:
    _check_cancelled(cancel)
    if not UPRN_PATTERN.match(uprn or ""):
        raise MalformedQuery(f"invalid uprn: {uprn}")
    with connect() as connection:
        release_id = _active_release(connection, cancel)
        rows = list(connection.execute(PROPERTY_SQL, (uprn,)))
        # A home known only from its energy certificate (flagged): its row carries its facts too.
        # The table itself may not be deployed yet (issue #182): then EPC-only rows are absent.
        epc_ready = epc_addresses_ready(connection)
        epc_only = not rows and epc_ready
        if epc_only:
            rows = list(connection.execute(EPC_HOME_SQL, (uprn,)))
        if not rows:
            raise PropertyNotFound(f"unknown property: {uprn}")
        row = rows[0]
        _check_cancelled(cancel)
        address_id = row["address_id"]
        postcode = row["postcode"] if epc_only else _postcode(connection, address_id, row["display_address"])
        epc_rows = rows if epc_only else list(connection.execute(EPC_SQL, (uprn,)))
        flood_rows = list(connection.execute(DWELLING_FLOOD_SQL, (row["uprn"],)))
        sales = list(connection.execute(SALES_SQL, (address_id,))) if address_id else []
        _check_cancelled(cancel)
        area_rows = list(connection.execute(AREAS_SQL, (row["geography_id"],)))
        areas = area_rows[0] if area_rows else {}
        last = sales[-1] if sales else None
        # The home's type comes from its newest standard sale, never from a trailing
        # 'O' (other) ancillary transfer: see _typing_sale. The newest record still
        # gives the last sale and the position (null for non-standard).
        typing = _typing_sale(sales) if not epc_only else None
        type_code = typing["property_type"] if typing else None
        if epc_only and feature_flags.epc_per_home():
            type_code = _epc_type_code(row.get("property_type"), row.get("built_form"))
        elif type_code is None and feature_flags.epc_per_home():
            # No standard typed sale at all: the latest energy certificate's type
            # stands in, under the same flag as every other per-home EPC fact.
            epc_row = epc_rows[0] if epc_rows else None
            type_code = _epc_type_code(epc_row.get("property_type") if epc_row else None,
                                      epc_row.get("built_form") if epc_row else None)
        named = _areas(areas, row["geography_id"])
        ids = [area["id"] for area in named.values() if area and area.get("id")]
        bands, years = {}, {}
        if type_code in price_bands.TYPE_LABELS and ids:
            bands = {r["geography_id"]: r for r in connection.execute(PRICE_BANDS_SQL, (ids, type_code))}
            if last and last["ppd_category"] == "A":
                years = {r["geography_id"]: r for r in connection.execute(
                    PRICE_YEAR_SQL, (ids, type_code, int(last["date"][:4])))}
        last_sale = ({"date": last["date"], "price": last["price"], "standard": last["ppd_category"] == "A"}
                     if last else None)
        prices = price_bands.area_prices(
            type_code, [(level, named[level]) for level in price_bands.LEVELS], bands, years, last_sale)
        facts = _facts(epc_rows[0] if epc_rows else None, last, sales, type_code)
        local = (_local_market(connection, type_code, prices["range"], bands, facts["floorAreaSquareMetres"], release_id)
                 if feature_flags.per_home_valuation() else None)
        _check_cancelled(cancel)
        neighbours = list(connection.execute(POSTCODE_HOMES_SQL, (postcode, POSTCODE_HOME_LIMIT))) if postcode else []
        epc_neighbours = _epc_homes(connection, postcode, POSTCODE_HOME_LIMIT - len(neighbours),
                                    ready=epc_ready) if postcode else []

    index = _borough_index(connect, named["borough"], type_code, cancel) if last else None
    # Only standard market sales (category A) are indexed or compared.
    recent = _with_previous([sale for sale in sales if sale["ppd_category"] == "A"])
    estimate = (valuation.estimate({"floorAreaSquareMetres": facts["floorAreaSquareMetres"], "lastSale": recent},
                                   local, index) if feature_flags.per_home_valuation() else None)
    others = sorted([_home(home) for home in neighbours if address_id is None or home["address_id"] != address_id]
                    + [_epc_home(home) for home in epc_neighbours if home["uprn"] != row["uprn"]],
                    key=lambda home: natural_key(home["displayAddress"]))
    extra = {"addressSource": "epc"} if epc_only else {}
    return {
        "schemaVersion": "property-profile.v2",
        "productReleaseId": release_id,
        "profile": {
            "uprn": row["uprn"],
            "addressId": address_id,
            "displayAddress": row["display_address"],
            "postcode": postcode,
            "location": [row["lon"], row["lat"]],
            "areas": named,
            "facts": facts,
            "areaPrices": prices,
            "valuation": estimate,  # null unless per_home_valuation()
            "sales": [_sale(sale) for sale in sales],
            "salesSummary": {"changeSinceLastSale": valuation.annualised_change(recent, index)},
            # The home's own Environment Agency bands (null without a dwelling_flood row); the page
            # leads with these, then the worst of otherHomes', and only then its area's land.
            "flood": _flood(flood_rows[0] if flood_rows else None),
            "otherHomes": [{key: home[key] for key in ("addressId", "uprn", "displayAddress", "lastSale", "flood")}
                           for home in others],
            "disclaimer": PROFILE_DISCLAIMER,
            "caveats": list(PROFILE_CAVEATS),
            "sourceVersion": row["source_release_id"],
            "withheld": feature_flags.withheld(),
            **extra,
        },
    }


def _with_previous(sales: list) -> dict | None:
    """The last of these (standard) sales with the one before it."""
    if not sales:
        return None
    previous = sales[-2] if len(sales) > 1 else None
    return {"date": sales[-1]["date"], "price": sales[-1]["price"], "standard": True,
            "previous": {"date": previous["date"], "price": previous["price"], "standard": True} if previous else None}


def _borough_index(connect: Callable[[], Any], borough: Mapping[str, Any] | None, type_code: str | None,
                   cancel: Callable[[], bool] | None) -> Mapping[str, Any] | None:
    """The borough same-type index (ruling R5): its market-by-type 10-year median trend."""
    if not borough or type_code not in market.PROPERTY_TYPES:
        return None
    try:
        payload = market.area_market(SimpleNamespace(_connect=connect), borough["id"], cancel)
    except (AreaNotFound, MalformedQuery):
        return None
    except Cancelled:
        raise
    except Exception:  # noqa: BLE001 - a market failure leaves the change unknown, not the page down
        LOGGER.exception("borough market unavailable for %s", borough["id"])
        return None
    return valuation.type_index(payload, type_code)


def _local_market(connection: Any, type_code: str | None, price_range: Mapping[str, Any] | None,
                  bands: Mapping[str, Mapping[str, Any]], floor: Any, release_id: str = "") -> dict | None:
    """Same-type sales in the price range's area: today's adjusted price quartiles and,
    with a floor area (EPC per home), the £/m² quartiles."""
    if not price_range:
        return None
    band = bands[price_range["areaId"]]
    local = {"medianPrice": band["p50"], "p25": band["p25"], "p75": band["p75"]}
    if floor and feature_flags.epc_per_home():
        since = f"{price_range['since']}-01"
        rows = _TYPE_PPM.get_or_build((release_id, type_code, since, price_range["areaId"]), lambda: list(
            connection.execute(TYPE_PPM_SQL, (price_range["areaId"], type_code, since))))
        row = rows[0] if rows and (rows[0]["sales"] or 0) >= price_bands.MIN_SALES else {}
        local.update({f"{key}PricePerSquareMetre": row.get(quantile)
                      for key, quantile in (("median", "p50"), ("p25", "p25"), ("p75", "p75"))})
    return local


def _postcode(connection: Any, address_id: str | None, display_address: str) -> str | None:
    if address_id:
        rows = list(connection.execute(ADDRESS_POSTCODE_SQL, (address_id,)))
        if rows:
            return rows[0]["postcode"]
    match = POSTCODE_IN_ADDRESS.search((display_address or "").upper())
    return match.group(1) if match else None


def _home(row: Mapping[str, Any]) -> dict:
    last_sale = ({"date": row["last_date"], "price": row["last_price"]}
                 if row.get("last_date") and row.get("last_price") else None)
    return per_home({
        "addressId": row["address_id"],
        "uprn": row.get("uprn"),
        "displayAddress": row["display_address"],
        "propertyType": PRICE_PAID_TYPES.get(row.get("property_type") or ""),
        "tenure": TENURES.get(row.get("tenure") or ""),
        "floorAreaSquareMetres": _round(row.get("floor")),
        "energyRating": row.get("current_rating"),
        "saleCount": int(row.get("sale_count") or 0),
        "lastSale": last_sale,
        "flood": _flood(row),
    })


def _flood(row: Mapping[str, Any] | None) -> dict | None:
    """One home's own EA bands (dwelling_flood, not EPC data), or None when it has no row."""
    if not row or not row.get("rivers_sea_band"):
        return None
    return {"riversSea": band_name(row["rivers_sea_band"]), "surfaceWater": band_name(row.get("surface_water_band"))}


def _epc_homes(connection: Any, postcode: str, limit: int, *, ready: bool | None = None) -> list:
    """The postcode's EPC-only homes: only while the flag is on AND migration 089's table
    exists (no statement against property_epc_home otherwise). `ready` lets a caller that
    already checked pass it in instead of checking again."""
    if ready is None:
        ready = epc_addresses_ready(connection)
    if not ready or limit <= 0:
        return []
    return list(connection.execute(EPC_HOMES_SQL, (postcode, limit)))


# EPC built forms -> the Price Paid house types (flats and maisonettes are one Price Paid type).
EPC_BUILT_FORMS = {"detached": "D", "semi-detached": "S", "mid-terrace": "T", "end-terrace": "T",
                   "enclosed mid-terrace": "T", "enclosed end-terrace": "T"}


def _epc_type_code(epc_type: str | None, built_form: str | None) -> str | None:
    """An EPC property type and built form as a Price Paid type code, or None when it can't be told."""
    if epc_type in ("Flat", "Maisonette"):
        return "F"
    if epc_type in ("House", "Bungalow"):
        return EPC_BUILT_FORMS.get((built_form or "").lower())
    return None


def _epc_home(row: Mapping[str, Any]) -> dict:
    """An EPC-only home as a postcode list row: no address id, sale or tenure; its type is an EPC fact."""
    type_code = _epc_type_code(row.get("epc_type"), row.get("built_form")) if feature_flags.epc_per_home() else None
    return per_home({
        "addressId": None,
        "uprn": row["uprn"],
        "displayAddress": row["display_address"],
        "propertyType": PRICE_PAID_TYPES.get(type_code or ""),
        "tenure": None,
        "floorAreaSquareMetres": _round(row.get("floor")),
        "energyRating": row.get("current_rating"),
        "saleCount": 0,
        "lastSale": None,
        "flood": _flood(row),
        "addressSource": "epc",
    })


def _round(value: Any, digits: int = 0) -> float | int | None:
    if value is None:
        return None
    rounded = round(float(value), digits)
    return int(rounded) if digits == 0 else rounded


def _areas(areas: Mapping[str, Any], geography_id: str) -> dict:
    """Each level's id, official name and the one name to show: the friendly title
    ("Peckham Rye Common · SE22"), else the official name; a borough is its own name."""
    def pick(kind: str) -> dict | None:
        area_id = areas.get(f"{kind}_id")
        if not area_id:
            return None
        name = areas.get(f"{kind}_name")
        friendly = friendly_title(areas.get(f"{kind}_friendly"), areas.get(f"{kind}_district"))
        return {"id": area_id, "name": name, "displayName": friendly or name}
    return {"lsoa": pick("lsoa") or {"id": geography_id, "name": None, "displayName": None},
            "msoa": pick("msoa"), "borough": pick("borough")}


def _typing_sale(sales: list) -> Mapping[str, Any] | None:
    """The sale that types the home (B4). Sales run oldest first, so the newest
    standard (Price Paid category A) sale with a priced type (F/T/S/D); if none, the
    newest sale with a priced type in any category. A trailing 'O' (other) record --
    a share-of-freehold or lease transfer, category B -- never types the home, even
    when it is the newest record. None when no sale has a priced type."""
    typed = [sale for sale in sales if sale["property_type"] in price_bands.TYPE_LABELS]
    standard = [sale for sale in typed if sale["ppd_category"] == "A"]
    pool = standard or typed
    return pool[-1] if pool else None


def _facts(epc: Mapping[str, Any] | None, last: Mapping[str, Any] | None, sales: list,
           type_code: str | None = None) -> dict:
    epc = epc or {}
    return per_home({
        "propertyType": PRICE_PAID_TYPES.get(type_code or ""),
        "tenure": TENURES.get(last["tenure"]) if last else None,
        "newBuildSale": sales[0]["date"] if sales and sales[0]["new_build"] else None,
        "epcPropertyType": epc.get("property_type"),
        "builtForm": epc.get("built_form"),
        "constructionAgeBand": epc.get("construction_age_band"),
        "floorAreaSquareMetres": _round(epc.get("total_floor_area"))
        if epc.get("total_floor_area") else _round(last["floor"] if last else None),
        "habitableRooms": epc.get("habitable_rooms"),
        "floorLevel": epc.get("floor_level"),
        "energyRating": epc.get("current_rating"),
        "potentialEnergyRating": epc.get("potential_rating"),
        "energyCertificateDate": epc.get("lodgement_date"),
        # Null until an open VOA bulk licence lets a source be loaded (CLOSE_KNIT_COUNCIL_TAX_BAND).
        "councilTaxBand": None,
    })


PPD_TRANSACTION_URL = "https://landregistry.data.gov.uk/data/ppi/transaction/{}/current"


def _sale(sale: Mapping[str, Any]) -> dict:
    """A recorded sale, with a link to its public HM Land Registry Price Paid record."""
    transaction = sale.get("transaction_id")
    floor = sale["floor"]
    per_m2 = round(sale["price"] / float(floor)) if feature_flags.per_home_price_per_sqm() and floor else None
    return per_home({
        "date": sale["date"],
        "price": sale["price"],
        "propertyType": PRICE_PAID_TYPES.get(sale["property_type"]),
        "tenure": TENURES.get(sale["tenure"]),
        "newBuild": bool(sale["new_build"]),
        "standardSale": sale["ppd_category"] == "A",
        "floorAreaSquareMetres": _round(sale["floor"]),
        "sourceUrl": PPD_TRANSACTION_URL.format(transaction) if transaction else None,
        "sourceVersion": sale.get("source_release_id"),  # the Price Paid release behind this sale (#215)
        "pricePerSquareMetre": per_m2,  # null unless per_home_price_per_sqm() and a floor area
    })
