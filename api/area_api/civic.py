"""Civic context for an area or a postcode (track J, migration 019).

Where a place sits (England > region > borough (any English LAD) > ward > area, plus its
constituency, police force and statistical codes) comes from the ONS Postcode
Directory. An LSOA, MSOA or borough is linked to wards and constituencies by
its share of live postcodes, so an area that straddles a boundary lists both
sides. Council tax is the council area's average for each band (MHCLG), with who
the Band D goes to (the GLA in London; county, police, fire, combined authority
and parish precepts elsewhere, migration 113); ward
councillors come from Democracy Club and MPs from the UK Parliament Members
API, each with the day they were fetched. Missing data is null, never zero.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Any, Callable, Iterable, Mapping

from . import feature_flags, kinds
from .scope import current as current_scope
from .evidence import AreaNotFound, MalformedQuery, _active_release, _check_cancelled
from .schools import AREA_EXISTS_SQL, AREA_PATTERN

POSTCODE_PATTERN = re.compile(r"^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$")
# Councillors and MPs are listed for wards / constituencies holding at least
# this share of the area's postcodes (the largest one is always included).
REPRESENTED_SHARE = 0.2
LINK_KINDS = ("country", "region", "borough", "ward", "parish", "constituency", "police", "msoa", "lsoa")
_AREA_COLUMN = {"lsoa": "lsoa_code", "msoa": "msoa_code", "borough": "borough_code"}

_LINK_COLUMNS = """country_code, region_code, borough_code, ward_code, parish_code,
  constituency_code, police_code, msoa_code, lsoa_code"""


def _area_links_sql(column: str) -> str:
    return f"""-- civic:area-links
SELECT {_LINK_COLUMNS}, count(*)::integer AS postcodes
FROM postcode_civic WHERE {column} = %s AND terminated IS NULL
GROUP BY {_LINK_COLUMNS}"""


AREA_LINKS_SQL = {kind: _area_links_sql(column) for kind, column in _AREA_COLUMN.items()}

POSTCODE_SQL = f"""-- civic:postcode
SELECT postcode, introduced, terminated, {_LINK_COLUMNS}, 1 AS postcodes
FROM postcode_civic WHERE postcode = %s"""

NAMES_SQL = """-- civic:names
SELECT code, name FROM civic_name WHERE code = ANY(%s)"""

COUNCIL_TAX_SQL = """-- civic:council-tax
SELECT financial_year, band_d_borough, band_d_gla, band_a, band_b, band_c, band_d, band_e, band_f,
  band_g, band_h, band_d_county, band_d_police, band_d_fire, band_d_combined_authority, band_d_parish,
  source_release_id
FROM council_tax WHERE borough_code = %s ORDER BY financial_year DESC LIMIT 1"""

REPRESENTATIVES_SQL = """-- civic:representatives
SELECT role, area_code, name, party, elected_on, profile_url, fetched_on, source_release_id
FROM representative
WHERE (role = 'councillor' AND area_code = ANY(%s)) OR (role = 'mp' AND area_code = ANY(%s))
ORDER BY role, area_code, name"""

SOURCES_SQL = """-- civic:sources
SELECT id, licence, attribution, caveats, release_date FROM source_release WHERE id = ANY(%s) ORDER BY id"""

ONSPD_SOURCE = "src-onspd-2026-08"
# Who the Band D goes to beside the council itself, in bill order: (payload kind, council_tax column).
PRECEPTS = (("gla", "band_d_gla"), ("county", "band_d_county"), ("police", "band_d_police"),
            ("fire", "band_d_fire"), ("combined-authority", "band_d_combined_authority"), ("parish", "band_d_parish"))


class PostcodeNotFound(AreaNotFound):
    """A postcode outside the loaded directory (London, or England with CLOSE_KNIT_ENGLAND; area-not-found 404)."""


def normalise_postcode(value: str) -> str | None:
    """"sw1a-1aa", "SW1A1AA" and "SW1A 1AA" all become "SW1A 1AA" (the ONSPD pcds form)."""
    match = POSTCODE_PATTERN.match(re.sub(r"[\s_-]+", "", (value or "").upper()))
    return f"{match.group(1)} {match.group(2)}" if match else None


def links(rows: Iterable[Mapping[str, Any]]) -> dict[str, list[tuple[str, float]]]:
    """Per kind, the codes the postcodes fall in with their share, largest first."""
    counts: dict[str, dict[str, int]] = {kind: defaultdict(int) for kind in LINK_KINDS}
    total = 0
    for row in rows:
        total += row["postcodes"]
        for kind in LINK_KINDS:
            code = row[f"{kind}_code"]
            if code:
                counts[kind][code] += row["postcodes"]
    return {kind: sorted(((code, round(n / total, 3)) for code, n in found.items()),
                         key=lambda item: (-item[1], item[0]))
            for kind, found in counts.items()} if total else {kind: [] for kind in LINK_KINDS}


def _month(value: Any) -> str | None:
    return None if value is None else str(value)[:7]


def _money(value: Any) -> float | None:
    return None if value is None else round(float(value), 2)


def precepts(tax: Mapping[str, Any]) -> list[dict]:
    """The Band D's other parts: the GLA, county council, police, fire, combined authority and the average
    parish precept, each where one is levied (a missing column, before migration 113, is none)."""
    return [{"kind": kind, "amount": _money(tax.get(column))} for kind, column in PRECEPTS
            if tax.get(column) is not None]


def _represented(shares: list[tuple[str, float]]) -> list[str]:
    return [code for index, (code, share) in enumerate(shares) if index == 0 or share >= REPRESENTED_SHARE]


def civic_payload(subject: dict, release_id: str, found: dict[str, list[tuple[str, float]]],
                  names: Mapping[str, str], tax: Mapping[str, Any] | None,
                  people: list[Mapping[str, Any]], sources: list[Mapping[str, Any]],
                  live_postcodes: int | None, represented: Mapping[str, list[str]]) -> dict:
    """`represented` holds the ward and constituency codes whose councillors / MPs were looked up."""
    def named(kind: str) -> dict | None:
        shares = found.get(kind) or []
        if not shares:
            return None
        code = shares[0][0]
        return {"code": code, "name": names.get(code)}

    def shares(kind: str) -> list[dict]:
        return [{"code": code, "name": names.get(code), "share": share} for code, share in found.get(kind) or []]

    def person(row: Mapping[str, Any]) -> dict:
        return {"role": row["role"], "areaCode": row["area_code"], "areaName": names.get(row["area_code"]),
                "name": row["name"], "party": row["party"],
                "electedOn": None if row["elected_on"] is None else str(row["elected_on"]),
                "profileUrl": row["profile_url"]}

    def fetched(role: str) -> str | None:
        days = sorted(str(row["fetched_on"]) for row in people if row["role"] == role)
        return days[-1] if days else None

    parish = named("parish")
    if parish and not parish["code"].startswith("E04"):  # E43…: "unparished area"
        parish = None
    borough = named("borough")
    return {
        "schemaVersion": "civic.v1",
        "productReleaseId": release_id,
        "subject": subject,
        "available": bool(found.get("borough")),
        "place": {
            "country": named("country"), "region": named("region"), "borough": borough,
            "ward": named("ward") if subject["kind"] != "borough" else None,
            "parish": parish, "constituency": named("constituency"), "policeForce": named("police"),
            "msoa": named("msoa") if subject["kind"] != "borough" else None,
            "lsoa": named("lsoa") if subject["kind"] in ("lsoa", "postcode") else None,
        },
        "wards": shares("ward"),
        "constituencies": shares("constituency"),
        "livePostcodes": live_postcodes,
        # The home's own band waits for CLOSE_KNIT_COUNCIL_TAX_BAND and an open VOA bulk licence; no source is loaded yet.
        "councilTaxBand": None,
        "withheld": feature_flags.withheld(("councilTaxBand",)),
        "councilTax": None if tax is None else {
            "financialYear": tax["financial_year"],
            "boroughCode": borough["code"] if borough else None,
            "boroughName": borough["name"] if borough else None,
            "bandDBorough": _money(tax["band_d_borough"]),
            "bandDGla": _money(tax["band_d_gla"]),
            "precepts": precepts(tax),
            "bands": [{"band": band.upper(), "amount": _money(tax[f"band_{band}"])} for band in "abcdefgh"],
            "sourceVersion": tax["source_release_id"],
        },
        "representedWards": [{"code": code, "name": names.get(code)} for code in represented["wards"]],
        "representedConstituencies": [{"code": code, "name": names.get(code)}
                                      for code in represented["constituencies"]],
        "councillors": [person(row) for row in people if row["role"] == "councillor"],
        "mps": [person(row) for row in people if row["role"] == "mp"],
        "fetchedOn": {"councillors": fetched("councillor"), "mps": fetched("mp")},
        "sources": [{"id": row["id"], "licence": row["licence"], "attribution": row["attribution"],
                     "caveats": list(row["caveats"] or []), "releaseDate": str(row["release_date"])}
                    for row in sources],
    }


class CivicReader:
    """Reads migration 019 tables; ``connect`` is a zero-arg context manager factory."""

    def __init__(self, connect: Callable[[], Any]) -> None:
        self._connect = connect

    def area(self, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
        _check_cancelled(cancel)
        if not AREA_PATTERN.match(area_id or ""):
            raise MalformedQuery(f"invalid area id: {area_id}")
        code = area_id.split(":")[2]
        kind = "borough" if kinds.kind_of(area_id) == kinds.LAD else kinds.kind_of(area_id)
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            if not list(connection.execute(AREA_EXISTS_SQL, (area_id,))):
                raise AreaNotFound(f"unknown area: {area_id}")
            rows = list(connection.execute(AREA_LINKS_SQL[kind], (code,)))
            subject = {"kind": kind, "geographyId": area_id, "postcode": None,
                       "introduced": None, "terminated": None}
            return self._payload(connection, subject, release_id, rows,
                                 sum(row["postcodes"] for row in rows), kind != "borough")

    def postcode(self, value: str, cancel: Callable[[], bool] | None = None) -> dict:
        _check_cancelled(cancel)
        postcode = normalise_postcode(value)
        if postcode is None:
            raise MalformedQuery(f"invalid postcode: {value}")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            rows = list(connection.execute(POSTCODE_SQL, (postcode,)))
            if not rows:
                raise PostcodeNotFound(f"postcode not in the {current_scope().name} directory: {postcode}")
            row = rows[0]
            subject = {"kind": "postcode", "geographyId": f"uk:lsoa:{row['lsoa_code']}" if row["lsoa_code"] else None,
                       "postcode": postcode, "introduced": _month(row["introduced"]),
                       "terminated": _month(row["terminated"])}
            return self._payload(connection, subject, release_id, rows, None, True)

    def _payload(self, connection: Any, subject: dict, release_id: str, rows: list,
                 live_postcodes: int | None, with_councillors: bool) -> dict:
        found = links(rows)
        codes = sorted({code for shares in found.values() for code, _ in shares})
        names = {row["code"]: row["name"] for row in connection.execute(NAMES_SQL, (codes,))} if codes else {}
        borough = found["borough"][0][0] if found["borough"] else None
        taxes = list(connection.execute(COUNCIL_TAX_SQL, (borough,))) if borough else []
        # A borough has dozens of wards: councillors are listed for smaller places only,
        # while every one of its constituencies' MPs is listed.
        wards = _represented(found["ward"]) if with_councillors else []
        seats = _represented(found["constituency"]) if with_councillors else [c for c, _ in found["constituency"]]
        people = list(connection.execute(REPRESENTATIVES_SQL, (wards, seats))) if wards or seats else []
        source_ids = sorted({ONSPD_SOURCE} | {row["source_release_id"] for row in [*taxes, *people]}) if rows else []
        sources = list(connection.execute(SOURCES_SQL, (source_ids,))) if source_ids else []
        return civic_payload(subject, release_id, found, names, taxes[0] if taxes else None, people, sources,
                             live_postcodes, {"wards": wards, "constituencies": seats})
