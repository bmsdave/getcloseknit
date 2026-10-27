"""Shared tolerant EPC linker (B3, #153).

One matcher for the whole pipeline: the per-home sale floor join, the UPRN
map and the LSOA £/m² index all resolve a sale address to a certificate the
same way. Previously the sale floor came from the address spine's exact-key
join while the index used the tolerant subset matcher in bulk_price, so a
whole new-build block could ship with no floor area on any sale (Duval House
SW11 2FR, Landmark Pinnacle E14 9PG) while neighbouring addresses linked
normally.

Rules, in order:
  1. Same postcode: the sale's address tokens must be a subset of the
     certificate's tokens (the AE-15 rule).
  2. Sibling-postcode fallback: within the same postcode sector, a
     certificate lodged under a different unit postcode still matches when
     it covers the sale's full token set, including the same PAON + street.
     New-build blocks are often certificated under an interim postcode
     (Pinnacle E14 9PG sales vs E14 9GU certificates).
  3. SAON synonyms are canonicalised before comparison: FLAT / APT / UNIT
     are the same dwelling word as APARTMENT.
  4. Ties break toward the fewest extra tokens, then the latest lodgement.
  5. A certificate is never shared by two different SAONs: the batch API
     `link_sales_floor` assigns such a certificate to neither sale and
     reports it as rejected (the E14 9JQ 335 m² guard — one certificate
     copied to every flat of a slice).

Floor area is never inferred: no covering certificate, no positive floor
area, or no London geography means no value, with a reason.

Stdlib only, no relative imports: deploy/tools scripts import this module
directly (etl_england_prices.py, epc_bulk.py, etl_property.py).
"""

import re
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

_EPC_COLUMN_ALIASES = {
    "certificate-number": "certificate_number",
    "local_authority": "local_authority",
    "total-floor-area": "total_floor_area",
    "lodgement-date": "lodgement_date",
}

_NON_ALNUM = re.compile(r"[^A-Z0-9 ]+")

#: Dwelling words that name the same unit: canonicalised to "APARTMENT"
#: before any token comparison (B3: "Flat 10" must meet "Apartment 10").
SAON_SYNONYMS = {
    "FLAT": "APARTMENT",
    "APT": "APARTMENT",
    "UNIT": "APARTMENT",
    "APARTMENT": "APARTMENT",
}


@dataclass(frozen=True)
class EpcRecord:
    certificate_number: str
    postcode_compact: str
    tokens: frozenset
    floor_area_sqm: float
    lodgement_date: str
    uprn: str


def normalize_address_part(text: Any) -> str:
    cleaned = _NON_ALNUM.sub(" ", str(text or "").upper())
    return " ".join(cleaned.split())


def compact_postcode(text: Any) -> str:
    return normalize_address_part(text).replace(" ", "")


def postcode_sector(postcode_compact: str) -> str:
    """Postcode sector of a compact postcode: "E149PG" -> "E149"."""
    return postcode_compact[:-2] if len(postcode_compact) > 2 else ""


def canonical_tokens(tokens: Iterable[str]) -> frozenset:
    """Fold SAON synonyms so "FLAT 10" and "APARTMENT 10" compare equal."""
    return frozenset(SAON_SYNONYMS.get(token, token) for token in tokens)


def address_tokens(*parts: Any) -> frozenset:
    tokens: set[str] = set()
    for part in parts:
        tokens.update(normalize_address_part(part).split())
    tokens.discard("")
    return frozenset(tokens)


def normalize_epc_columns(header: Iterable[str]) -> list[str]:
    return [_EPC_COLUMN_ALIASES.get(name, name) for name in header]


def map_epc_row(row: Mapping[str, Any]) -> EpcRecord:
    """Map one EPC record to the internal shape or raise a quarantine reason."""
    certificate_number = str(row.get("certificate_number", "")).strip()
    if not certificate_number:
        raise ValueError("invalid-certificate: blank certificate number")
    postcode = compact_postcode(row.get("postcode", ""))
    if not postcode:
        raise ValueError("invalid-postcode: blank EPC postcode")
    try:
        floor_area = float(str(row.get("total_floor_area", "")).strip())
    except (TypeError, ValueError):
        raise ValueError("invalid-floor-area: floor area is not a number") from None
    if not floor_area > 0:
        raise ValueError("invalid-floor-area: floor area is not positive")
    tokens = address_tokens(row.get("address1", ""), row.get("address2", ""),
                            row.get("address3", ""))
    if not tokens:
        raise ValueError("invalid-address: EPC address has no tokens")
    return EpcRecord(
        certificate_number=certificate_number,
        postcode_compact=postcode,
        tokens=tokens,
        floor_area_sqm=floor_area,
        lodgement_date=str(row.get("lodgement_date", "")).strip(),
        uprn=str(row.get("uprn", "")).strip(),
    )


def build_epc_index(records: Iterable[EpcRecord]) -> dict[str, list[EpcRecord]]:
    """Group certificates by postcode; latest lodgement first per group."""
    index: dict[str, list[EpcRecord]] = {}
    for record in records:
        index.setdefault(record.postcode_compact, []).append(record)
    for group in index.values():
        group.sort(key=lambda item: item.lodgement_date, reverse=True)
    return index


def _sector_groups(index: Mapping[str, list[EpcRecord]]
                   ) -> dict[str, list[tuple[str, list[EpcRecord]]]]:
    """Postcode groups keyed by postcode sector (for the sibling fallback)."""
    sectors: dict[str, list[tuple[str, list[EpcRecord]]]] = {}
    for postcode, group in index.items():
        sectors.setdefault(postcode_sector(postcode), []).append((postcode, group))
    return sectors


def _find(postcode_compact: str, sale_tokens: frozenset,
          index: Mapping[str, list[EpcRecord]],
          paon_street_tokens: frozenset | None,
          sector_groups: Mapping[str, list[tuple[str, list[EpcRecord]]]]
          ) -> EpcRecord | None:
    if not sale_tokens:
        return None
    sale = canonical_tokens(sale_tokens)
    best: EpcRecord | None = None
    best_extra = 0

    def consider(candidate: EpcRecord) -> None:
        nonlocal best, best_extra
        cert = canonical_tokens(candidate.tokens)
        if not sale <= cert:
            return
        extra = len(cert - sale)
        if best is None or extra < best_extra:
            best, best_extra = candidate, extra

    for candidate in index.get(postcode_compact, []):
        consider(candidate)
    if best is not None:
        return best
    anchor = canonical_tokens(paon_street_tokens or ())
    sector = postcode_sector(postcode_compact)
    if not anchor or not sector:
        return None
    for postcode, group in sector_groups.get(sector, []):
        if postcode == postcode_compact:
            continue
        for candidate in group:
            cert = canonical_tokens(candidate.tokens)
            if not anchor <= cert:
                continue
            consider(candidate)
    return best


def find_epc_match(postcode_compact: str, sale_tokens: frozenset,
                   index: Mapping[str, list[EpcRecord]],
                   paon_street_tokens: frozenset | None = None) -> EpcRecord | None:
    """Most specific covering certificate for a sale.

    Same-postcode rule first: sale tokens (synonym-canonicalised) must be a
    subset of the certificate's tokens. Optional sibling-postcode fallback:
    within the same postcode sector, a certificate under a different unit
    postcode matches when it covers the sale's full token set and the same
    PAON + street. Ties break toward the fewest extra tokens, then the
    latest lodgement (groups are pre-sorted newest first).
    """
    return _find(postcode_compact, sale_tokens, index, paon_street_tokens,
                 _sector_groups(index))


def link_sales_floor(sales: Iterable[Mapping[str, Any]],
                     index: Mapping[str, list[EpcRecord]]
                     ) -> tuple[dict[Any, EpcRecord | None], list[str]]:
    """Batch floor-area linking with the never-share guard.

    Each sale mapping carries:
      key: opaque id, echoed in the result
      postcode: compact postcode
      sale_tokens: frozenset of the SAON + PAON + street tokens
      saon_tokens: frozenset of the SAON tokens (may be empty for houses)
      paon_street_tokens: frozenset of the PAON + street tokens (may be empty)

    Returns (matches, rejected): matches maps each key to its EpcRecord or
    None; rejected lists the certificate numbers claimed by more than one
    distinct SAON, which are assigned to none of the claiming sales.
    """
    sales = list(sales)
    sector_groups = _sector_groups(index)
    matches: dict[Any, EpcRecord | None] = {}
    claims: dict[str, list[tuple[Any, frozenset]]] = {}
    for sale in sales:
        match = _find(sale["postcode"], sale["sale_tokens"], index,
                      sale.get("paon_street_tokens"), sector_groups)
        matches[sale["key"]] = match
        if match is not None:
            identity = canonical_tokens(sale.get("saon_tokens") or sale["sale_tokens"])
            claims.setdefault(match.certificate_number, []).append((sale["key"], identity))
    rejected = sorted(cert for cert, users in claims.items()
                      if len({identity for _, identity in users}) > 1)
    rejected_set = set(rejected)
    for key, match in matches.items():
        if match is not None and match.certificate_number in rejected_set:
            matches[key] = None
    return matches, rejected
