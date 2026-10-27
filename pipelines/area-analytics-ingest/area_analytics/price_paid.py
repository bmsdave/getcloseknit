"""HMLR Price Paid Data ingestion adapter (AE-10).

Parses dated monthly PPD releases into a derived snapshot of achieved
sale transactions. Raw releases are immutable inputs; additions,
corrections, and deletions apply by publisher transaction identifier
with provenance retained, so corrections never silently duplicate a
sale and deletions never silently erase its history.
"""

import csv
import json
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Mapping

PRICE_KIND = "achieved"

REGISTRATION_LAG_NOTE = (
    "HM Land Registry Price Paid Data lags completion: sales register "
    "weeks to months after completion, so the newest publication month "
    "is always partial and must not be presented as a complete market trend."
)

EXCLUSIONS = (
    "Latest publication month is partial and subject to later updates.",
    "Prices are achieved completion prices, not asking prices or valuations.",
    "Coverage is England and Wales only; Scotland and Northern Ireland excluded.",
    "Some transfer types (for example gifts and court orders) are out of scope.",
    "Transaction-UPRN links exist only where the source can establish them.",
)

PROPERTY_TYPES = frozenset({"D", "S", "T", "F", "O"})
RECORD_CATEGORIES = frozenset({"A", "B"})
RECORD_STATUSES = frozenset({"A", "C", "D"})


@dataclass(frozen=True)
class PricePaidRecord:
    transaction_id: str
    price: int
    sale_date: str
    sale_month: str
    postcode: str
    property_type: str
    new_build: str
    tenure: str
    paon: str
    saon: str
    street: str
    locality: str
    town: str
    district: str
    county: str
    record_category: str
    record_status: str


def price_label() -> str:
    return (
        "Achieved sale price from HM Land Registry "
        "(not an asking price, valuation, or estimate)"
    )


def make_raw_release(release_id: str, retrieved_at: str, csv_text: str) -> dict:
    return {
        "releaseId": release_id,
        "retrievedAt": retrieved_at,
        "sha256": sha256(csv_text.encode("utf-8")).hexdigest(),
        "csvText": csv_text,
    }


def parse_price_paid_row(row: Mapping[str, Any]) -> PricePaidRecord:
    transaction_id = str(row.get("Transaction unique identifier", "")).strip()
    if not transaction_id:
        raise ValueError("invalid-transaction-id: blank transaction identifier")
    price = _parse_price(row.get("Price", ""))
    sale_date, sale_month = _parse_sale_date(row.get("Date of Transfer", ""))
    property_type = _pick(row, "Property Type", PROPERTY_TYPES, "invalid-property-type")
    new_build = _pick(row, "Old/New", frozenset({"Y", "N"}), "invalid-new-build")
    tenure = _pick(row, "Duration", frozenset({"F", "L"}), "invalid-tenure")
    category = _pick(row, "PPD Category Type", RECORD_CATEGORIES, "invalid-category")
    status = _pick(row, "Record Status - monthly file only",
                   RECORD_STATUSES, "invalid-status")
    return PricePaidRecord(
        transaction_id, price, sale_date, sale_month,
        _text(row, "Postcode"), property_type, new_build, tenure,
        _text(row, "PAON"), _text(row, "SAON"), _text(row, "Street"),
        _text(row, "Locality"), _text(row, "Town/City"),
        _text(row, "District"), _text(row, "County"), category, status)


def build_price_snapshot(raw_releases: list) -> dict:
    ordered = _dedupe_releases(raw_releases)
    state = {"current": {}, "history": {}, "provenance": {},
             "tombstones": {}, "quarantine": []}
    for release in ordered:
        _apply_release(state, release)
    return _render_snapshot(state, ordered)


def snapshot_checksum(snapshot: Mapping[str, Any]) -> str:
    canonical = {
        "priceKind": snapshot["priceKind"],
        "transactions": snapshot["transactions"],
        "tombstones": snapshot["tombstones"],
        "history": snapshot["history"],
        "provenance": snapshot["provenance"],
    }
    return sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()


def _parse_price(value: Any) -> int:
    try:
        price = int(str(value).strip().replace(",", ""))
    except (TypeError, ValueError):
        raise ValueError(f"invalid-price: {value!r} is not whole pounds") from None
    if price <= 0:
        raise ValueError(f"invalid-price: {value!r} is not a positive sale price")
    return price


def _parse_sale_date(value: Any) -> tuple:
    text = str(value).strip()
    date_part = text.split(" ")[0]
    parts = date_part.split("-")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        raise ValueError(f"invalid-date: {value!r} is not a calendar date")
    year, month, day = (int(part) for part in parts)
    if not (1 <= month <= 12 and 1 <= day <= 31 and year >= 1995):
        raise ValueError(f"invalid-date: {value!r} is not a calendar date")
    return date_part, date_part[:7]


def _pick(row: Mapping[str, Any], field: str, allowed: frozenset, code: str) -> str:
    value = str(row.get(field, "")).strip()
    if value not in allowed:
        raise ValueError(f"{code}: {field} is {value!r}")
    return value


def _text(row: Mapping[str, Any], field: str) -> str:
    value = row.get(field, "")
    return "" if value is None else str(value).strip()


def _dedupe_releases(raw_releases: list) -> list:
    seen: dict = {}
    for release in raw_releases:
        seen.setdefault(release["sha256"], release)
    return sorted(seen.values(), key=lambda item: (item["retrievedAt"], item["releaseId"]))


def _apply_release(state: dict, release: dict) -> None:
    rows = csv.DictReader(release["csvText"].splitlines())
    for row in rows:
        try:
            record = parse_price_paid_row(row)
        except ValueError as error:
            _quarantine(state, release, row, error)
            continue
        _apply_record(state, release, record)


def _quarantine(state: dict, release: dict, row: dict, error: ValueError) -> None:
    message = str(error)
    state["quarantine"].append({
        "releaseId": release["releaseId"],
        "transactionId": str(row.get("Transaction unique identifier", "")).strip(),
        "reason": message.split(":")[0],
        "detail": message,
    })


def _apply_record(state: dict, release: dict, record: PricePaidRecord) -> None:
    if record.record_status == "A":
        _apply_addition(state, release, record)
    elif record.record_status == "C":
        _apply_correction(state, release, record)
    else:
        _apply_deletion(state, release, record)


def _apply_addition(state: dict, release: dict, record: PricePaidRecord) -> None:
    key = record.transaction_id
    if key in state["current"]:
        if state["current"][key] == _canonical(record):
            _touch_provenance(state, release, key)
        else:
            state["quarantine"].append({
                "releaseId": release["releaseId"], "transactionId": key,
                "reason": "conflicting-addition",
                "detail": f"addition for {key} disagrees with the stored sale",
            })
        return
    state["tombstones"].pop(key, None)
    state["current"][key] = _canonical(record)
    _touch_provenance(state, release, key)


def _apply_correction(state: dict, release: dict, record: PricePaidRecord) -> None:
    key = record.transaction_id
    if key in state["current"]:
        state["history"].setdefault(key, []).append(state["current"][key])
    else:
        state["provenance"].setdefault(key, {})["correctionWithoutPrior"] = True
    state["tombstones"].pop(key, None)
    state["current"][key] = _canonical(record)
    _touch_provenance(state, release, key)


def _apply_deletion(state: dict, release: dict, record: PricePaidRecord) -> None:
    key = record.transaction_id
    prior = state["current"].pop(key, None)
    if prior is not None:
        state["history"].setdefault(key, []).append(prior)
    state["tombstones"][key] = {
        "transactionId": key,
        "saleMonth": record.sale_month,
        "deletedInRelease": release["releaseId"],
    }
    _touch_provenance(state, release, key)


def _touch_provenance(state: dict, release: dict, key: str) -> None:
    entry = state["provenance"].setdefault(key, {})
    entry.setdefault("firstSeenRelease", release["releaseId"])
    entry["lastAppliedRelease"] = release["releaseId"]
    entry["revisions"] = entry.get("revisions", 0) + 1


def _render_snapshot(state: dict, ordered: list) -> dict:
    transactions = sorted(state["current"].values(),
                          key=lambda item: item["transactionId"])
    tombstones = sorted(state["tombstones"].values(),
                        key=lambda item: item["transactionId"])
    return {
        "priceKind": PRICE_KIND,
        "priceLabel": price_label(),
        "publicationPeriod": _publication_period(transactions),
        "registrationLagNote": REGISTRATION_LAG_NOTE,
        "exclusions": list(EXCLUSIONS),
        "transactions": transactions,
        "tombstones": tombstones,
        "history": {key: state["history"][key] for key in sorted(state["history"])},
        "provenance": {key: state["provenance"][key]
                       for key in sorted(state["provenance"])},
        "quarantine": state["quarantine"],
        "rawReleases": [{"releaseId": item["releaseId"],
                         "retrievedAt": item["retrievedAt"],
                         "sha256": item["sha256"]} for item in ordered],
    }


def _publication_period(transactions: list) -> dict:
    if not transactions:
        return {"startMonth": None, "endMonth": None,
                "completeMonths": [], "partialMonth": None}
    months = sorted({item["saleMonth"] for item in transactions})
    return {
        "startMonth": months[0],
        "endMonth": months[-1],
        "completeMonths": months[:-1],
        "partialMonth": months[-1],
        "note": REGISTRATION_LAG_NOTE,
    }


def _canonical(record: PricePaidRecord) -> dict:
    return {
        "transactionId": record.transaction_id,
        "price": record.price,
        "saleDate": record.sale_date,
        "saleMonth": record.sale_month,
        "postcode": record.postcode,
        "propertyType": record.property_type,
        "newBuild": record.new_build,
        "tenure": record.tenure,
        "paon": record.paon,
        "saon": record.saon,
        "street": record.street,
        "locality": record.locality,
        "town": record.town,
        "district": record.district,
        "county": record.county,
        "recordCategory": record.record_category,
        "recordStatus": record.record_status,
    }
