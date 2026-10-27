"""Minimal bulk -> internal mappers for London-only load.

EPC bulk (snake_case) -> property_identity internal names.
HMLR monthly (headerless) -> price_paid internal names.
Police street CSVs -> analytics internal names.
Boundaries/lookup -> geography parsers.
CPIH/IMD/population/income/tenure/rent/schools/ofsted -> thin pass-throughs.
No PostGIS. Quarantine on invalid rows, never invent values.
"""

import csv
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from typing import Any, Mapping

from . import bulk_price
from . import geography

LONDON_POSTCODE_AREAS = frozenset({
    "E", "N", "NW", "SE", "SW", "W", "WC", "EC",
    "BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TN", "UB",
})

_SORTED_AREAS = sorted(LONDON_POSTCODE_AREAS, key=len, reverse=True)

BOUNDARY_SPECS = {
    "lsoa": ("LSOA21CD", "LSOA21NM"),
    "msoa": ("MSOA21CD", "MSOA21NM"),
    "lad": ("LAD21CD", "LAD21NM"),
}

# Any police.uk force but British Transport Police (excluded by policy, analytics.EXCLUDED_CRIME_FORCES);
# which areas a force covers comes from the data, not from a list of forces.
EXCLUDED_POLICE_FORCES = frozenset({"british-transport-police", "btp"})

_OFFICIAL_RE = re.compile(r"^E[0-9]{8}$")


def is_london_postcode(postcode: Any) -> bool:
    text = re.sub(r"\s+", "", str(postcode or "").upper())
    outward = re.split(r"[^A-Z0-9]", text)[0] if text else ""
    if not outward:
        return False
    for area in _SORTED_AREAS:
        if not outward.startswith(area):
            continue
        rest = outward[len(area):]
        if len(area) == 1:
            if rest[:1].isdigit():
                return True
        elif rest == "" or rest[:1].isdigit():
            return True
    return False


def map_epc_bulk_to_internal(row: Mapping[str, Any]) -> dict:
    return {
        "certificateId": str(row.get("certificate_number", "")).strip(),
        "uprn": str(row.get("uprn", "")).strip(),
        "paon": str(row.get("address1", "")).strip(),
        "street": str(row.get("address2", "")).strip(),
        "locality": "",
        "town": str(row.get("posttown", "")).strip(),
        "postcode": str(row.get("postcode", "")).strip(),
        "lodgementDate": str(row.get("lodgement_date", "")).strip(),
        "inspectionDate": str(row.get("inspection_date", "")).strip(),
        "transactionType": "domestic",
        "energyRating": str(row.get("current_energy_rating", "")).strip().upper(),
        "energyPoints": str(row.get("current_energy_efficiency", "")).strip(),
        "floorAreaSqm": str(row.get("total_floor_area", "")).strip(),
        "habitableRooms": str(row.get("number_habitable_rooms", "")).strip(),
    }


def map_hmlr_cells(cells: list) -> dict:
    return bulk_price.map_pp_row(cells)


def map_police_street_to_internal(
    row: Mapping[str, Any], force: str
) -> dict:
    if not force or force in EXCLUDED_POLICE_FORCES:
        raise ValueError(f"unknown-force: {force!r}")
    return {
        "Persistent ID": str(row.get("Crime ID", "")).strip(),
        "Date": str(row.get("Month", "")).strip(),
        "Category": str(row.get("Crime type", "")).strip(),
        "LSOA code": str(row.get("LSOA code", "")).strip(),
    }


def load_boundary_file(path: str, kind: str) -> list:
    code_field, name_field = _boundary_fields(kind)
    with open(path, encoding="utf-8") as handle:
        collection = json.load(handle)
    return geography.extract_boundary_records(
        collection, kind, code_field, name_field)


def load_lookup_file(path: str) -> list:
    with open(path, encoding="utf-8", errors="replace") as handle:
        return geography.parse_lookup_csv(handle.read())


def iter_csv_rows(path: str, limit: int = 500) -> tuple:
    with open(path, newline="", encoding="utf-8", errors="replace") as handle:
        reader = csv.DictReader(handle)
        rows = [row for _, row in zip(range(limit), reader)]
        return reader.fieldnames or [], rows


def map_imd_row(row: Mapping[str, Any]) -> dict:
    code = _pick_code(row, ("LSOA code (2021)", "LSOA21CD", "lsoa_code"))
    rank = _pick_value(row, ("Index of Multiple Deprivation (IMD) Rank (where 1 is most deprived)", "imd_rank"))
    decile = _pick_value(row, (
        "Index of Multiple Deprivation (IMD) Decile (where 1 is most deprived 10% of LSOA",
        "Index of Multiple Deprivation (IMD) Decile (where 1 is most deprived 10% of LSOAs)",
        "imd_decile"))
    _require_official(code, "lsoa")
    return {"lsoa_code": code, "imd_rank": _to_int(rank, "imd_rank"),
            "imd_decile": _to_int(decile, "imd_decile")}


def map_population_row(row: Mapping[str, Any]) -> dict:
    code = _pick_code(row, ("LSOA 2021 Code", "LSOA21CD", "lsoa_code"))
    total = _pick_value(row, ("Total", "population"))
    _require_official(code, "lsoa")
    return {"lsoa_code": code, "population": _to_int(total, "population"),
            "year": str(row.get("year", "") or "").strip()}


def map_income_row(row: Mapping[str, Any]) -> dict:
    code = _pick_code(row, ("MSOA code", "MSOA21CD", "msoa_code"))
    median = _pick_value(row, ("Total annual income (£)", "median_income"))
    _require_official(code, "msoa")
    return {"msoa_code": code, "median_income": _to_float(median, "income")}


def map_tenure_row(row: Mapping[str, Any]) -> dict:
    code = _pick_code(row, ("geography code", "LSOA21CD", "lsoa_code"))
    _require_official(code, "lsoa")
    total = _to_int(_pick_value(
        row, ("Tenure of household: Total: All households", "total")), "tenure")
    return {"lsoa_code": code, "total_households": total,
            "raw": {key: row[key] for key in row}}


def map_rent_row(row: Mapping[str, Any]) -> dict:
    borough = str(row.get("geography_id", row.get("borough", ""))).strip()
    if not re.fullmatch(r"uk:lad:E[0-9]{8}", borough):
        raise ValueError(f"invalid-borough: {borough!r}")
    return {"geography_id": borough,
            "bedroom": str(row.get("bedroom", "")).strip(),
            "median_monthly_rent": _to_float(
                row.get("median_monthly_rent", ""), "rent"),
            "period": str(row.get("period", "")).strip()}


def map_cpih_row(row: Mapping[str, Any]) -> dict:
    month = str(row.get("month", "")).strip()
    if not month:
        raise ValueError("invalid-month: blank CPIH month")
    return {"month": month,
            "cpih_index": _to_float(row.get("cpih_index", ""), "cpih"),
            "source": str(row.get("source", "")).strip()}


def map_school_row(row: Mapping[str, Any]) -> dict:
    urn = str(row.get("school_urn", row.get("urn", ""))).strip()
    if not re.fullmatch(r"[0-9]{6}", urn):
        raise ValueError(f"invalid-urn: {urn!r}")
    return {"urn": urn,
            "name": str(row.get("school_name", row.get("name", ""))).strip(),
            "la_name": str(row.get("la_name", "")).strip(),
            "period": str(row.get("time_period", "")).strip()}


def map_ofsted_row(row: Mapping[str, Any]) -> dict:
    urn = str(row.get("URN", row.get("urn", ""))).strip()
    if not re.fullmatch(r"[0-9]+", urn):
        raise ValueError(f"invalid-urn: {urn!r}")
    return {"urn": urn,
            "name": str(row.get("School name", "")).strip(),
            "region": str(row.get("Region", "")).strip(),
            "overall": str(row.get(
                "Latest OEIF overall effectiveness", "")).strip()}


def read_xlsx_sheet_rows(path: str, sheet: str, limit: int = 500,
                         header_row: int = 1) -> list:
    with zipfile.ZipFile(path) as archive:
        strings = _shared_strings(archive)
        name = _sheet_file(archive, sheet)
        return _parse_sheet(archive.read(name), strings, limit, header_row)


def _boundary_fields(kind: str) -> tuple:
    try:
        return BOUNDARY_SPECS[kind]
    except KeyError:
        raise ValueError(f"unknown geography kind: {kind}") from None


def _pick_code(row: Mapping[str, Any], keys: tuple) -> str:
    for key in keys:
        if row.get(key) not in (None, ""):
            return str(row[key]).strip()
    raise ValueError(f"missing-code: none of {list(keys)} present")


def _pick_value(row: Mapping[str, Any], keys: tuple) -> str:
    for key in keys:
        if key in row and row[key] not in (None, ""):
            return str(row[key]).strip()
    # case-insensitive fallback for xlsx header drift
    lowered = {str(key).lower(): value for key, value in row.items()}
    for key in keys:
        value = lowered.get(str(key).lower(), "")
        if str(value).strip():
            return str(value).strip()
    raise ValueError(f"missing-value: none of {list(keys)} present")


def _require_official(code: str, _kind: str) -> None:
    if not _OFFICIAL_RE.match(code):
        raise ValueError(f"invalid-code: {code!r}")


def _to_int(value: Any, name: str) -> int:
    try:
        return int(str(value).strip().replace(",", ""))
    except (TypeError, ValueError):
        raise ValueError(f"invalid-{name}: {value!r}") from None


def _to_float(value: Any, name: str) -> float:
    try:
        return float(str(value).strip().replace(",", ""))
    except (TypeError, ValueError):
        raise ValueError(f"invalid-{name}: {value!r}") from None


def _shared_strings(archive: zipfile.ZipFile) -> list:
    try:
        payload = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(payload)
    namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    out = []
    for item in root.findall(f"{{{namespace}}}si"):
        out.append("".join(
            node.text or "" for node in item.findall(f".//{{{namespace}}}t")))
    return out


def _sheet_file(archive: zipfile.ZipFile, sheet: str) -> str:
    root = ET.fromstring(archive.read("xl/workbook.xml"))
    namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    names = [node.get("name") for node in root.findall(f".//{{{namespace}}}sheet")]
    if sheet not in names:
        raise ValueError(f"unknown-sheet: {sheet!r} not in {names}")
    index = names.index(sheet) + 1
    return f"xl/worksheets/sheet{index}.xml"


def _parse_sheet(payload: bytes, strings: list, limit: int,
                 header_row: int = 1) -> list:
    root = ET.fromstring(payload)
    namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rows = root.findall(f".//{{{namespace}}}row")
    if not rows:
        return []
    index = max(0, header_row - 1)
    header = _row_values(rows[index], strings)
    out = []
    for node in rows[index + 1:index + 1 + limit]:
        values = _row_values(node, strings)
        record = {header[i]: values[i] for i in range(min(len(header), len(values)))}
        out.append(record)
    return out


def _row_values(node: ET.Element, strings: list) -> list:
    namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    values: list[str] = []
    for cell in node.findall(f"{{{namespace}}}c"):
        value_node = cell.find(f"{{{namespace}}}v")
        raw = value_node.text if value_node is not None else ""
        if cell.get("t") == "s" and raw != "":
            try:
                values.append(strings[int(raw)])
            except (IndexError, ValueError):
                values.append("")
        else:
            values.append(raw or "")
    return values
