"""Property identity + domestic EPC linkage (AE-11).

Typed identity records preserve publisher IDs, an optional verified
UPRN, normalized-address aliases, match method, confidence, and
unresolved conflicts. Validated UPRN links win; cautious normalized
address matching is a documented fallback; ambiguous records stay
separate. Domestic EPC rows carry dates, floor area, points, rating,
and replacement status. Habitable-room counts are never bedrooms.
Deterministic fixtures only; no live publishers.
"""

import re
from dataclasses import dataclass, field
from hashlib import sha256

MATCH_METHODS = ("verified-uprn", "cautious-address", "unresolved")

ABBREVIATIONS = {
    "st": "street",
    "rd": "road",
    "ave": "avenue",
    "cres": "crescent",
    "terr": "terrace",
    "ln": "lane",
}

EPC_RATINGS = frozenset({"A", "B", "C", "D", "E", "F", "G"})

EPC_LABEL = (
    "Domestic Energy Performance Certificate evidence "
    "(current certificate only; replaced certificates are superseded)"
)


@dataclass(frozen=True)
class IdentityRecord:
    identity_id: str
    publisher_ids: tuple
    verified_uprn: str | None
    address_aliases: tuple
    match_method: str
    confidence: float
    conflicts: tuple = ()


@dataclass(frozen=True)
class EpcRecord:
    certificate_id: str
    uprn: str | None
    address_key: str
    lodgement_date: str
    inspection_date: str
    energy_rating: str
    energy_points: int | None
    floor_area_sqm: float | None
    habitable_rooms: int | None


def epc_label() -> str:
    return EPC_LABEL


def normalize_address(text: str) -> str:
    words = re.sub(r"[^a-z0-9 ]", " ", str(text).lower()).split()
    return " ".join(ABBREVIATIONS.get(word, word) for word in words)


def normalize_postcode(text: str) -> str:
    compact = re.sub(r"\s+", "", str(text).upper())
    if len(compact) > 3:
        return compact[:-3] + " " + compact[-3:]
    return compact


def address_aliases(record: dict) -> tuple:
    saon = normalize_address(record.get("saon", ""))
    core = normalize_address(" ".join((
        str(record.get("paon", "")),
        str(record.get("street", "")),
        str(record.get("locality", "")),
        str(record.get("town", "")),
    )))
    postcode = normalize_postcode(record.get("postcode", ""))
    alias = f"{saon}|{core} {postcode}".strip()
    return (alias,)


def build_identities(records: list, previous_ids: dict | None = None) -> list:
    mapping = previous_ids or {}
    verified, fallback = _split_by_uprn(records)
    identities = []
    for uprn, group in sorted(verified.items()):
        identities.append(_verified_identity(uprn, group, mapping))
    identities.extend(_fallback_identities(fallback, mapping))
    return sorted(identities, key=lambda item: item.identity_id)


def parse_epc_row(row: dict) -> EpcRecord:
    if str(row.get("transactionType", "")).strip().lower() != "domestic":
        raise ValueError("non-domestic-epc: only domestic certificates link")
    rating = str(row.get("energyRating", "")).strip().upper()
    if rating not in EPC_RATINGS:
        raise ValueError(f"invalid-rating: {rating!r} is not A-G")
    return EpcRecord(
        certificate_id=str(row.get("certificateId", "")).strip(),
        uprn=_optional_uprn(row.get("uprn", "")),
        address_key=address_aliases(row)[0],
        lodgement_date=_require_date(row.get("lodgementDate", "")),
        inspection_date=str(row.get("inspectionDate", "")).strip(),
        energy_rating=rating,
        energy_points=_optional_int(row.get("energyPoints", ""), "points"),
        floor_area_sqm=_optional_area(row.get("floorAreaSqm", "")),
        habitable_rooms=_optional_int(row.get("habitableRooms", ""), "rooms"),
    )


def build_epc_snapshot(rows: list) -> dict:
    grouped: dict = {}
    quarantine: list = []
    for row in rows:
        try:
            record = parse_epc_row(row)
        except ValueError as error:
            quarantine.append(_quarantine_entry(row, error))
            continue
        key = record.uprn or record.address_key
        grouped.setdefault(key, []).append(record)
    current, history = _current_and_history(grouped)
    return {"current": current, "history": history, "quarantine": quarantine}


def link_identity_epc(identities: list, snapshot: dict) -> list:
    current = snapshot.get("current", {})
    joined = [_join_one(identity, current) for identity in identities]
    return sorted(joined, key=lambda item: item["identityId"])


def bedrooms_from_epc(record: EpcRecord) -> int:
    raise ValueError(
        "never map EPC habitable-room counts to bedrooms: "
        f"certificate {record.certificate_id} keeps "
        f"habitableRooms={record.habitable_rooms} separate"
    )


def measure_match_quality(sample: list, reviewed_count: int) -> dict:
    predicted = [row for row in sample if row.get("predicted") is not None]
    correct = [row for row in predicted
               if row["predicted"] == row["expected"]]
    return {
        "precision": _ratio(len(correct), len(predicted)),
        "coverage": _ratio(len(correct), reviewed_count),
        "reviewedSample": reviewed_count,
        "coverageByPropertyType": _coverage_by(sample, "propertyType"),
        "coverageByGeography": _coverage_by(sample, "geography"),
    }


def identity_deep_link(identity_id: str) -> str:
    return f"/properties/{identity_id}"


def resolve_identity_link(link: str, migrations: dict) -> str | None:
    identity_id = str(link).rstrip("/").rsplit("/", 1)[-1]
    if identity_id in migrations:
        target = _follow_migration(identity_id, migrations)
        return identity_deep_link(target)
    if identity_id in set(migrations.values()):
        return identity_deep_link(identity_id)
    return None


def _split_by_uprn(records: list) -> tuple:
    verified: dict = {}
    fallback: list = []
    for record in records:
        uprn = _verified_uprn(record)
        if uprn is None:
            fallback.append(record)
        else:
            verified.setdefault(uprn, []).append(record)
    return verified, fallback


def _verified_uprn(record: dict) -> str | None:
    if not record.get("uprnVerified"):
        return None
    return _optional_uprn(record.get("uprnLink", ""))


def _optional_uprn(value: object) -> str | None:
    text = str(value).strip()
    if not text:
        return None
    if not re.fullmatch(r"[0-9]+", text):
        raise ValueError(f"invalid-uprn: {value!r} is not digits")
    return text


def _verified_identity(uprn: str, group: list, mapping: dict) -> IdentityRecord:
    natural_id = f"prop-uprn-{uprn}"
    aliases = sorted({alias for record in group
                      for alias in address_aliases(record)})
    return IdentityRecord(
        identity_id=mapping.get(natural_id, natural_id),
        publisher_ids=tuple(sorted(str(item.get("transactionId", ""))
                                   for item in group)),
        verified_uprn=uprn,
        address_aliases=tuple(aliases),
        match_method="verified-uprn",
        confidence=1.0,
        conflicts=(),
    )


def _fallback_identities(records: list, mapping: dict) -> list:
    grouped: dict = {}
    for record in records:
        grouped.setdefault(address_aliases(record)[0], []).append(record)
    identities = []
    for key in sorted(grouped):
        identities.extend(_fallback_group(key, grouped[key], mapping))
    return identities


def _fallback_group(key: str, group: list, mapping: dict) -> list:
    if len(group) == 1:
        return [_cautious_identity(key, group[0], mapping)]
    return [_unresolved_identity(item, group, mapping) for item in group]


def _cautious_identity(key: str, record: dict, mapping: dict) -> IdentityRecord:
    natural_id = f"prop-addr-{sha256(key.encode()).hexdigest()[:12]}"
    confidence = 0.7 if str(record.get("saon", "")).strip() else 0.6
    return IdentityRecord(
        identity_id=mapping.get(natural_id, natural_id),
        publisher_ids=(str(record.get("transactionId", "")),),
        verified_uprn=None,
        address_aliases=(key,),
        match_method="cautious-address",
        confidence=confidence,
        conflicts=(),
    )


def _unresolved_identity(record: dict, group: list, mapping: dict) -> IdentityRecord:
    transaction_id = str(record.get("transactionId", ""))
    seed = address_aliases(record)[0] + "|" + transaction_id
    natural_id = f"prop-unresolved-{sha256(seed.encode()).hexdigest()[:12]}"
    conflicts = tuple(sorted(str(item.get("transactionId", ""))
                             for item in group
                             if item is not record))
    return IdentityRecord(
        identity_id=mapping.get(natural_id, natural_id),
        publisher_ids=(transaction_id,),
        verified_uprn=None,
        address_aliases=address_aliases(record),
        match_method="unresolved",
        confidence=0.3,
        conflicts=conflicts,
    )


def _require_date(value: object) -> str:
    text = str(value).strip()[:10]
    parts = text.split("-")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        raise ValueError(f"invalid-date: {value!r} is not a calendar date")
    return text


def _optional_int(value: object, name: str) -> int | None:
    text = str(value).strip()
    if not text:
        return None
    try:
        number = int(text)
    except (TypeError, ValueError):
        raise ValueError(f"invalid-{name}: {value!r} is not whole") from None
    if number < 0:
        raise ValueError(f"invalid-{name}: {value!r} is negative")
    return number


def _optional_area(value: object) -> float | None:
    text = str(value).strip()
    if not text:
        return None
    try:
        area = float(text)
    except (TypeError, ValueError):
        raise ValueError(f"invalid-area: {value!r} is not square metres") from None
    if area <= 0:
        raise ValueError(f"invalid-area: {value!r} is not positive")
    return area


def _quarantine_entry(row: dict, error: ValueError) -> dict:
    message = str(error)
    return {
        "certificateId": str(row.get("certificateId", "")).strip(),
        "reason": message.split(":")[0],
        "detail": message,
    }


def _current_and_history(grouped: dict) -> tuple:
    current: dict = {}
    history: dict = {}
    for key in sorted(grouped):
        ordered = sorted(grouped[key], key=lambda item: item.lodgement_date)
        current[key] = _canonical_epc(ordered[-1], "current")
        history[key] = [_canonical_epc(item, "superseded")
                        for item in ordered[:-1]]
    return current, history


def _canonical_epc(record: EpcRecord, status: str) -> dict:
    return {
        "certificateId": record.certificate_id,
        "uprn": record.uprn,
        "lodgementDate": record.lodgement_date,
        "inspectionDate": record.inspection_date,
        "energyRating": record.energy_rating,
        "energyPoints": record.energy_points,
        "floorAreaSqm": record.floor_area_sqm,
        "habitableRooms": record.habitable_rooms,
        "replacementStatus": status,
    }


def _join_one(identity: IdentityRecord, current: dict) -> dict:
    key, basis = _join_key(identity, current)
    if key is None or basis is None:
        return {"identityId": identity.identity_id, "epc": None,
                "identityBasis": identity.match_method}
    record = dict(current[key])
    record["identityBasis"] = basis
    return {"identityId": identity.identity_id, "epc": record,
            "identityBasis": identity.match_method}


def _join_key(identity: IdentityRecord, current: dict) -> tuple:
    if identity.match_method == "unresolved":
        return None, None
    if identity.verified_uprn and identity.verified_uprn in current:
        return identity.verified_uprn, "verified-uprn"
    for alias in identity.address_aliases:
        if alias in current:
            return alias, "cautious-address"
    return None, None


def _ratio(matched: int, total: int) -> float:
    return matched / total if total else 0.0


def _coverage_by(sample: list, field: str) -> dict:
    groups: dict = {}
    for row in sample:
        groups.setdefault(row.get(field), []).append(row)
    scored = {}
    for name in sorted(groups, key=str):
        rows = groups[name]
        hits = sum(1 for row in rows if row.get("predicted") == row["expected"]
                   and row.get("predicted") is not None)
        scored[str(name)] = _ratio(hits, len(rows))
    return scored


def _follow_migration(identity_id: str, migrations: dict) -> str:
    target = migrations[identity_id]
    seen = {identity_id}
    while target in migrations and target not in seen:
        seen.add(target)
        target = migrations[target]
    return target
