"""Civic geography, council tax and elected representatives (track J).

Sources (all official or open; licences recorded in each source_release row):
  ONSPD       ONS Postcode Directory, August 2026 (OGL v3, with OS and Royal Mail
              attribution). Only the coverage's postcodes are kept (England by
              default, CLOSE_KNIT_ETL_COVERAGE=london for London; area_analytics.coverage),
              so no Northern Ireland (BT) data, which carries its own licence, is ever used.
  MHCLG       Council Tax levels set by local authorities in England 2026-27,
              Table 10 (OGL v3): average Band D for each covered council's area and
              who it goes to: the council, the GLA (London) or the county council,
              police, fire, a combined authority and parish precepts.
  Democracy   Democracy Club candidates API (CC BY 4.0): the sitting councillors of
  Club        every covered ward, from the local elections since May 2021 (councils
              elect all-out, by halves or by thirds; see current_councillors).
  Parliament  UK Parliament Members API (Open Parliament Licence v3): the
              current MP for each constituency.

Stages (work files go to $AE_WORK, default ~/data/aework/civic):
  download    fetch Democracy Club ballots and Parliament members as JSON
              (ONSPD and the council tax workbook are downloaded by hand into
              ~/data/civic; see DATA-LICENCES.md)
  build       write postcode_civic / civic_name / council_tax / representative
              TSVs and sources.json
  build postcodes   only postcode_civic / civic_name (needs only the ONSPD zip)
  load URL    load the TSVs into migration 019 tables (psycopg needed)
  load URL civic   replace only council_tax and representative (postcodes stay)
  load URL postcodes   replace only postcode_civic and civic_name (the ONSPD release)

  python3 -m area_analytics.civic download
  python3 -m area_analytics.civic build
  uv run --with 'psycopg[binary]' python -m area_analytics.civic load postgresql://...

Everything except download and load is pure and dependency-free.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Iterator, Mapping

from . import coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "civic"))
ONSPD_ZIP = os.path.join(DATA, "civic", "ONSPD_AUG_2026.zip")
COUNCIL_TAX_ODS = os.path.join(DATA, "civic", "Table_10_2026-27.ods")
ETL_VERSION = "close-knit-civic-1"
FINANCIAL_YEAR = "2026-27"
# Councillors sit for four years: a ward's seats are filled by its elections in the four years
# up to its latest one (a few days' slack for the first-Thursday-in-May date moving).
TERM_DAYS = 1430
FIRST_ELECTION = "2021-05-01"

ONSPD_SOURCE = "src-onspd-2026-08"
# The England build (precepts included) is a new release of the same Table 10 file.
COUNCIL_TAX_SOURCE = "src-mhclg-council-tax-2026-27-england"
ONSPD_URL = "https://geoportal.statistics.gov.uk/datasets/9e5a92a3cfb14dc7ad43d6ea7a7b8c7f"
COUNCIL_TAX_URL = ("https://www.gov.uk/government/statistics/"
                   "council-tax-levels-set-by-local-authorities-in-england-2026-to-2027")
# Every local election since May 2021 (the City of London's Common Council included): long enough
# for every ward's latest full term, whichever cycle its council keeps.
DC_BALLOTS_URLS = (
    "https://candidates.democracyclub.org.uk/api/next/ballots/"
    f"?election_type=local&election_date_range_after={FIRST_ELECTION}&page_size=100",
)
DC_PERSON_URL = "https://candidates.democracyclub.org.uk/person/{id}"
MEMBERS_URL = ("https://members-api.parliament.uk/api/Members/Search"
               "?House=1&IsCurrentMember=true&take=20&skip={skip}")
MP_PROFILE_URL = "https://members.parliament.uk/member/{id}/contact"

ONSPD_ATTRIBUTION = (
    "Source: Office for National Statistics licensed under the Open Government Licence v.3.0. "
    "Contains OS data © Crown copyright and database right 2026. "
    "Contains Royal Mail data © Royal Mail copyright and database right 2026.")
COUNCIL_TAX_ATTRIBUTION = (
    "Council Tax levels set by local authorities in England 2026 to 2027, Ministry of Housing, "
    "Communities and Local Government. Contains public sector information licensed under the "
    "Open Government Licence v3.0.")
DC_ATTRIBUTION = "Councillor data from Democracy Club (democracyclub.org.uk), CC BY 4.0."
PARLIAMENT_ATTRIBUTION = (
    "MP data from the UK Parliament Members API. Contains Parliamentary information licensed "
    "under the Open Parliament Licence v3.0.")

# Statutory band ratios to Band D (Local Government Finance Act 1992, s.5).
BAND_RATIOS = {"A": (6, 9), "B": (7, 9), "C": (8, 9), "D": (9, 9),
               "E": (11, 9), "F": (13, 9), "G": (15, 9), "H": (18, 9)}

# ONSPD Documents/ name files: filename pattern -> civic_name kind.
NAME_FILES = (
    (re.compile(r"^CTRY Country names"), "country"),
    (re.compile(r"^RGN Region names"), "region"),
    (re.compile(r"^LAD Local Authority District names"), "borough"),
    (re.compile(r"^WD Ward names"), "ward"),
    (re.compile(r"^PARNCP Parish"), "parish"),
    (re.compile(r"^PCON Westminster Parliamentary Constituency names"), "constituency"),
    (re.compile(r"^PFA Police Force Area names"), "police"),
    (re.compile(r"^MSOA \(2021\) names and codes EW"), "msoa"),
    (re.compile(r"^LSOA \(2021\) names and codes EW"), "lsoa"),
)

POSTCODE_COLUMNS = ("postcode", "introduced", "terminated", "country_code", "region_code",
                    "borough_code", "ward_code", "parish_code", "constituency_code", "police_code",
                    "msoa_code", "lsoa_code")
# ONSPD uses pseudo codes ending in 99999999 for "not applicable".
_PSEUDO = re.compile(r"^[EWSNLM]99999999$")


# --- ONSPD -----------------------------------------------------------------

def month_start(yyyymm: str) -> str | None:
    """ONSPD dates are year+month ("198001"); store the first day of that month."""
    value = (yyyymm or "").strip()
    if not re.fullmatch(r"[0-9]{6}", value):
        return None
    return f"{value[:4]}-{value[4:]}-01"


def _code(value: str) -> str | None:
    value = (value or "").strip()
    return None if not value or _PSEUDO.match(value) else value


def onspd_rows(lines: Iterable[str], cov: coverage.Coverage | None = None) -> Iterator[dict]:
    """The coverage's postcodes (England by default) from ONSPD CSV lines, one dict per postcode."""
    cov = cov or coverage.from_env()
    for row in csv.DictReader(lines):
        if not cov.contains_region(row["rgn26cd"]):
            continue
        introduced = month_start(row["dointr"])
        if introduced is None:
            continue
        yield {
            "postcode": row["pcds"].strip().upper(),
            "introduced": introduced,
            "terminated": month_start(row["doterm"]),
            "country_code": row["ctry26cd"],
            "region_code": row["rgn26cd"],
            "borough_code": row["lad26cd"],
            "ward_code": _code(row["wd26cd"]),
            "parish_code": _code(row["parncp26cd"]),
            "constituency_code": _code(row["pcon24cd"]),
            "police_code": _code(row["pfa23cd"]),
            "msoa_code": _code(row["msoa21cd"]),
            "lsoa_code": _code(row["lsoa21cd"]),
        }


def read_onspd(zip_path: str = ONSPD_ZIP) -> Iterator[dict]:
    with zipfile.ZipFile(zip_path) as archive:
        name = next(n for n in archive.namelist() if re.fullmatch(r"Data/ONSPD_[A-Z]{3}_[0-9]{4}_UK\.csv", n))
        with archive.open(name) as raw:
            yield from onspd_rows(io.TextIOWrapper(raw, encoding="utf-8", newline=""))


def name_kind(filename: str) -> str | None:
    base = os.path.basename(filename)
    if not base.endswith(".csv"):
        return None
    return next((kind for pattern, kind in NAME_FILES if pattern.search(base)), None)


def name_rows(lines: Iterable[str], kind: str, wanted: set[str]) -> Iterator[tuple[str, str, str]]:
    """(code, kind, name) for the wanted codes; first column is the code, second the name."""
    reader = csv.reader(lines)
    next(reader, None)
    for row in reader:
        if len(row) >= 2 and row[0].strip() in wanted and row[1].strip():
            yield row[0].strip(), kind, row[1].strip()


def read_names(zip_path: str, wanted: set[str]) -> list[tuple[str, str, str]]:
    names: dict[str, tuple[str, str, str]] = {}
    with zipfile.ZipFile(zip_path) as archive:
        for filename in sorted(archive.namelist()):  # later "as at" files win
            kind = name_kind(filename)
            if kind is None or not filename.startswith("Documents/"):
                continue
            with archive.open(filename) as raw:
                for code, row_kind, name in name_rows(io.TextIOWrapper(raw, encoding="utf-8-sig"), kind, wanted):
                    names[code] = (code, row_kind, name)
    return sorted(names.values())


# --- Council tax (MHCLG Table 10, ODS) ---------------------------------------

_T = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"
_X = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
_O = "{urn:oasis:names:tc:opendocument:xmlns:office:1.0}"


def ods_sheet(path: str, sheet: str, max_repeat: int = 200) -> list[list[str]]:
    """Cell text of one ODS sheet; numeric cells give their exact office:value."""
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("content.xml"))
    for table in root.iter(f"{_T}table"):
        if table.get(f"{_T}name") != sheet:
            continue
        rows = []
        for row in table.iter(f"{_T}table-row"):
            cells: list[str] = []
            for cell in row:
                repeat = min(int(cell.get(f"{_T}number-columns-repeated", "1")), max_repeat)
                value = cell.get(f"{_O}value")
                if value is None:
                    value = " ".join("".join(p.itertext()) for p in cell.iter(f"{_X}p"))
                cells.extend([value] * repeat)
            rows.append(cells)
        return rows
    raise ValueError(f"{path}: no sheet {sheet!r}")


def money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def bands(band_d: Decimal) -> dict[str, Decimal]:
    return {band: money(band_d * top / bottom) for band, (top, bottom) in BAND_RATIOS.items()}


def _column(header: list[str], prefix: str, suffix: str = "", required: bool = True) -> int | None:
    for index, text in enumerate(header):
        clean = " ".join(text.split())
        if clean.startswith(prefix) and clean.endswith(suffix):
            return index
    if required:
        raise ValueError(f"council tax table: no column {prefix!r}…{suffix!r}")
    return None


def _decimal(value: str) -> Decimal | None:
    try:
        return Decimal(value.strip())
    except Exception:
        return None


def _cell(row: list[str], index: int | None) -> Decimal | None:
    return _decimal(row[index]) if index is not None and index < len(row) else None


def _precept(value: Decimal | None) -> Decimal | None:
    """A precept as money; 0 or blank means none is levied here (None)."""
    return money(value) if value else None


def council_tax_rows(rows: list[list[str]], cov: coverage.Coverage | None = None) -> list[dict]:
    """The coverage's councils' 2026-27 area Band D and bands A-H, and who the Band D goes to.

    band_d (and A-H from it) is line 17: the council's own tax with every major precept and the
    average parish precept. band_d_borough is the council's own (line 9, no parish); line 16 holds
    the major preceptors': the GLA in London (band_d_gla, as before England), else the county
    council in two-tier areas, then police, fire and a combined authority, each null where none is
    levied. band_d_parish is the average local (parish) precept, line 8 less line 9."""
    cov = cov or coverage.from_env()
    header_at = next(i for i, row in enumerate(rows) if "ONS Code" in row)
    header = rows[header_at]
    code = header.index("ONS Code")
    area = _column(header, "17. Average")
    own = _column(header, "9. Average", "(current year)")
    with_parish = _column(header, "8. Average", "(current year)", required=False)
    major = "16. Average council tax of major precepting"
    county = _column(header, major, "(county or GLA)", required=False)
    county = county if county is not None else _column(header, major)
    police = _column(header, major, "(police)", required=False)
    fire = _column(header, major, "(fire)", required=False)
    combined = _column(header, major, "(combined authority)", required=False)
    result = []
    for row in rows[header_at + 1:]:
        if len(row) <= area or not cov.contains_lad(row[code]):
            continue
        band_d = _decimal(row[area])
        if band_d is None:
            continue
        own_d, county_d, parish_d = _cell(row, own), _cell(row, county), _cell(row, with_parish)
        london = coverage.region_of_lad(row[code]) == coverage.LONDON_REGION
        result.append({
            "borough_code": row[code], "financial_year": FINANCIAL_YEAR,
            "band_d_borough": money(own_d) if own_d is not None else None,
            "band_d_gla": money(county_d) if london and county_d is not None else None,
            "band_d_county": None if london else _precept(county_d),
            "band_d_police": _precept(_cell(row, police)),
            "band_d_fire": _precept(_cell(row, fire)),
            "band_d_combined_authority": _precept(_cell(row, combined)),
            "band_d_parish": _precept(parish_d - own_d) if parish_d is not None and own_d is not None else None,
            **{f"band_{band.lower()}": amount for band, amount in bands(band_d).items()},
        })
    return sorted(result, key=lambda item: item["borough_code"])


# --- Representatives ---------------------------------------------------------

def _winners(ballot: Mapping) -> list[Mapping]:
    """A ballot's elected candidacies, most votes first. An uncontested ballot is "cancelled" (no
    poll) yet its candidates are elected, so the elected flag decides, not the cancelled one."""
    won = [c for c in ballot.get("candidacies") or [] if c.get("elected") is True]
    return sorted(won, key=lambda c: -((c.get("result") or {}).get("num_ballots") or 0))


def _is_by_election(ballot: Mapping) -> bool:
    return ".by." in ballot["ballot_paper_id"]


def _ballot_day(ballot: Mapping) -> str:
    return ballot["ballot_paper_id"].rsplit(".", 1)[-1]


def current_councillors(ballots: list[Mapping]) -> list[tuple[Mapping, Mapping]]:
    """(ballot, candidacy) for one ward's sitting councillors, from all its ballots.

    Councils elect all-out every four years, by halves or by thirds, so a ward's seats are filled
    by its scheduled elections in the four years up to its latest one. The latest of those that
    filled more than one seat (an all-out election) replaced everyone elected before it; when later
    elections filled some of its seats again, its winners with the fewest votes (the shorter terms)
    give way. By-election winners since are added: whom they replaced is not published."""
    dated = sorted(((date.fromisoformat(_ballot_day(b)), b) for b in ballots), key=lambda item: item[0])
    scheduled = [(day, b) for day, b in dated if not _is_by_election(b) and _winners(b)]
    if not scheduled:
        return [(b, c) for _, b in dated for c in _winners(b)]
    latest = scheduled[-1][0]
    window = [(day, b) for day, b in scheduled if (latest - day).days < TERM_DAYS]
    all_out = [index for index, (_, b) in enumerate(window) if len(_winners(b)) > 1]
    if all_out:
        start = all_out[-1]
        first_day, base = window[start]
        later = sum(len(_winners(b)) for _, b in window[start + 1:])
        kept = [(base, c) for c in _winners(base)[:max(len(_winners(base)) - later, 0)]]
        kept += [(b, c) for _, b in window[start + 1:] for c in _winners(b)]
    else:
        first_day = window[0][0]
        kept = [(b, c) for _, b in window for c in _winners(b)]
    return kept + [(b, c) for day, b in dated if _is_by_election(b) and day >= first_day for c in _winners(b)]


def councillors(ballots: Iterable[Mapping], ward_codes: set[str]) -> list[dict]:
    """The sitting councillors of the given wards: current_councillors per ward and office (the council's
    slug in the ballot id, so the City of London's aldermen never replace its common councilmen)."""
    groups: dict[tuple[str, str], list[Mapping]] = {}
    for ballot in ballots:
        ward = ((ballot.get("post") or {}).get("id") or "").removeprefix("gss:")
        if ward in ward_codes:
            groups.setdefault((ward, ballot["ballot_paper_id"].split(".")[1]), []).append(ballot)
    people: dict[tuple[str, str], dict] = {}
    for (ward, _office), group in sorted(groups.items()):
        for ballot, candidacy in current_councillors(group):
            person = candidacy["person"]
            known = people.get((ward, person["name"]))
            if known and known["elected_on"] >= _ballot_day(ballot):
                continue  # one person in two offices: the latest election
            people[(ward, person["name"])] = {
                "role": "councillor", "area_code": ward, "name": person["name"],
                "party": candidacy.get("party_name") or (candidacy.get("party") or {}).get("name"),
                "elected_on": _ballot_day(ballot), "profile_url": DC_PERSON_URL.format(id=person["id"]),
            }
    return sorted(people.values(), key=lambda item: (item["area_code"], item["name"]))


def slim_ballot(ballot: Mapping) -> dict:
    """The fields current_councillors reads (the API's pages carry much more)."""
    return {"ballot_paper_id": ballot["ballot_paper_id"], "post": {"id": (ballot.get("post") or {}).get("id")},
            "winner_count": ballot.get("winner_count"), "cancelled": ballot.get("cancelled"),
            "candidacies": [{"elected": True, "party_name": c.get("party_name") or (c.get("party") or {}).get("name"),
                             "person": {"id": c["person"]["id"], "name": c["person"]["name"]},
                             "result": {"num_ballots": (c.get("result") or {}).get("num_ballots")}}
                            for c in ballot.get("candidacies") or [] if c.get("elected") is True]}


def constituency_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower().replace("&", " and ")).strip()


def mps(members: Iterable[Mapping], constituencies: Mapping[str, str]) -> list[dict]:
    """Current MPs for the given constituencies (code -> name), matched by name."""
    by_key = {constituency_key(name): code for code, name in constituencies.items()}
    result = []
    for member in members:
        membership = member.get("latestHouseMembership") or {}
        code = by_key.get(constituency_key(membership.get("membershipFrom") or ""))
        if code is None or membership.get("membershipEndDate"):
            continue
        result.append({
            "role": "mp", "area_code": code, "name": member["nameDisplayAs"],
            "party": (member.get("latestParty") or {}).get("name"),
            "elected_on": (membership.get("membershipStartDate") or "")[:10] or None,
            "profile_url": MP_PROFILE_URL.format(id=member["id"]),
        })
    return sorted(result, key=lambda item: item["area_code"])


def _get_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/json",
                                                   "User-Agent": "close-knit-civic/1"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except OSError:
            if attempt == 5:
                raise
            time.sleep(5 * (attempt + 1))  # the candidates API answers 502 under load
    raise AssertionError("unreachable")


def download() -> None:
    os.makedirs(WORK, exist_ok=True)
    ballots = []
    for url in DC_BALLOTS_URLS:
        while url:
            page = _get_json(url)
            ballots.extend(slim_ballot(ballot) for ballot in page["results"])
            url = page.get("next")
            print(f"download: democracy club {len(ballots)} ballots", flush=True)
    members, skip = [], 0
    while True:
        page = _get_json(MEMBERS_URL.format(skip=skip))
        members.extend(item["value"] for item in page["items"])
        skip += 20
        if skip >= page["totalResults"]:
            break
    print(f"download: parliament {len(members)} current MPs")
    fetched = date.today().isoformat()
    _write_json("democracy-club-ballots.json", {"fetchedOn": fetched, "urls": DC_BALLOTS_URLS, "ballots": ballots})
    _write_json("parliament-members.json", {"fetchedOn": fetched, "url": MEMBERS_URL, "members": members})


# --- Build and load ----------------------------------------------------------

def _write_json(name: str, payload: dict) -> None:
    path = os.path.join(WORK, name)
    with open(path + ".tmp", "w") as handle:
        json.dump(payload, handle)
    os.replace(path + ".tmp", path)


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _write_tsv(name: str, columns: Iterable[str], rows: Iterable[Mapping]) -> int:
    count = 0
    with open(os.path.join(WORK, name), "w", newline="") as handle:
        for row in rows:
            handle.write("\t".join("" if row[c] is None else str(row[c]) for c in columns) + "\n")
            count += 1
    return count


def build_postcodes() -> tuple[list[dict], list[tuple[str, str, str]], dict]:
    """postcode_civic.tsv and civic_name.tsv (and sources-postcodes.json) from the ONSPD zip."""
    os.makedirs(WORK, exist_ok=True)
    postcodes = list(read_onspd())
    codes = {row[c] for row in postcodes for c in POSTCODE_COLUMNS[3:] if row[c]}
    names = read_names(ONSPD_ZIP, codes)
    counts = {
        "postcode_civic": _write_tsv("postcode_civic.tsv", POSTCODE_COLUMNS, postcodes),
        "civic_name": _write_tsv("civic_name.tsv", ("code", "kind", "name"),
                                 ({"code": c, "kind": k, "name": n} for c, k, n in names)),
    }
    _write_json("sources-postcodes.json", {"onspdSha256": _sha256(ONSPD_ZIP), "counts": counts})
    print(f"build postcodes: {counts}")
    return postcodes, names, counts


def build() -> None:
    postcodes, names, counts = build_postcodes()
    tax = council_tax_rows(ods_sheet(COUNCIL_TAX_ODS, "Data_Billing"))
    with open(os.path.join(WORK, "democracy-club-ballots.json")) as handle:
        dc = json.load(handle)
    with open(os.path.join(WORK, "parliament-members.json")) as handle:
        parliament = json.load(handle)
    live = [row for row in postcodes if row["terminated"] is None]
    wards = {row["ward_code"] for row in live if row["ward_code"]}
    seats = {code: name for code, kind, name in names if kind == "constituency"}
    seats = {code: name for code, name in seats.items() if any(r["constituency_code"] == code for r in live)}
    people = councillors(dc["ballots"], wards) + mps(parliament["members"], seats)
    for person in people:
        person["fetched_on"] = dc["fetchedOn"] if person["role"] == "councillor" else parliament["fetchedOn"]

    counts = {
        **counts,
        "council_tax": _write_tsv("council_tax.tsv", TAX_COLUMNS, tax),
        "representative": _write_tsv("representative.tsv", PERSON_COLUMNS, people),
    }
    _write_json("sources.json", {
        "onspdSha256": _sha256(ONSPD_ZIP), "councilTaxSha256": _sha256(COUNCIL_TAX_ODS),
        "democracyClubSha256": _sha256(os.path.join(WORK, "democracy-club-ballots.json")),
        "parliamentSha256": _sha256(os.path.join(WORK, "parliament-members.json")),
        "democracyClubFetchedOn": dc["fetchedOn"], "parliamentFetchedOn": parliament["fetchedOn"],
        "counts": counts,
    })
    missing_wards = len(wards - {p["area_code"] for p in people if p["role"] == "councillor"})
    missing_seats = len(set(seats) - {p["area_code"] for p in people if p["role"] == "mp"})
    print(f"build: {counts}; wards without councillors {missing_wards}/{len(wards)}, "
          f"constituencies without an MP {missing_seats}/{len(seats)}")


TAX_COLUMNS = ("borough_code", "financial_year", "band_d_borough", "band_d_gla", "band_a", "band_b",
               "band_c", "band_d", "band_e", "band_f", "band_g", "band_h", "band_d_county", "band_d_police",
               "band_d_fire", "band_d_combined_authority", "band_d_parish")  # the last five: migration 113
PERSON_COLUMNS = ("role", "area_code", "name", "party", "elected_on", "profile_url", "fetched_on")


def onspd_release(sha256: str) -> tuple:
    return (ONSPD_SOURCE, ONSPD_URL, "2026-08-01", sha256, "OGL-3.0", ONSPD_ATTRIBUTION,
            ["Postcodes are linked to wards and constituencies by their ONS grid reference.",
             "An area that straddles a boundary is linked to each side by its share of live postcodes."])


def source_releases(sources: Mapping) -> list[tuple]:
    """(id, url, release_date, sha256, licence, attribution, caveats) per loaded source."""
    dc_day, mp_day = sources["democracyClubFetchedOn"], sources["parliamentFetchedOn"]
    return [
        onspd_release(sources["onspdSha256"]),
        (COUNCIL_TAX_SOURCE, COUNCIL_TAX_URL, "2026-03-25", sources["councilTaxSha256"], "OGL-3.0",
         COUNCIL_TAX_ATTRIBUTION,
         ["Average Band D for the whole council area, including the GLA or county council, police, fire, "
          "combined authority and the average parish precept.",
          "Bands A-H use the legal ratios to Band D; a bill differs by pennies, and by its parish's own precept."]),
        (f"src-democracy-club-{dc_day}", "https://candidates.democracyclub.org.uk/api/next/ballots/",
         dc_day, sources["democracyClubSha256"], "CC-BY-4.0", DC_ATTRIBUTION,
         ["Sitting councillors from each ward's local elections since May 2021: its latest all-out election "
          "and the elections by halves or thirds since, plus ward by-elections.",
          "A councillor who stood down, or was replaced at a by-election, may still be listed.",
          "County council divisions are not wards: county councillors are not listed."]),
        (f"src-uk-parliament-members-{mp_day}", "https://members-api.parliament.uk/",
         mp_day, sources["parliamentSha256"], "OPL-3.0", PARLIAMENT_ATTRIBUTION,
         ["Current members of the House of Commons on the day fetched."]),
    ]


RELEASE_SQL = """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
     attribution, transformation_version, geography_vintage, validation_status, caveats)
   VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)
   ON CONFLICT (id) DO NOTHING"""  # source releases are immutable (a trigger refuses updates)


def _check_release(cur, source_id: str, sha: str) -> None:
    stored = cur.execute("SELECT sha256 FROM source_release WHERE id = %s", (source_id,)).fetchone()[0]
    if stored != sha:
        raise SystemExit(f"{source_id} was loaded from another file (sha256 {stored[:12]}); give it a new id")


def load_postcodes(url: str) -> None:
    """Replace postcode_civic and civic_name only (the ONSPD release); council tax and people stay."""
    import psycopg

    with open(os.path.join(WORK, "sources-postcodes.json")) as handle:
        sources = json.load(handle)
    source_id, source_url, released, sha, licence, attribution, caveats = onspd_release(sources["onspdSha256"])
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(RELEASE_SQL, (source_id, source_url, released, sha, licence, attribution, ETL_VERSION, caveats))
        _check_release(cur, source_id, sha)
        for table in ("civic_name", "postcode_civic"):
            cur.execute(f"DELETE FROM {table}")
        _copy(cur, "postcode_civic", POSTCODE_COLUMNS, ONSPD_SOURCE, "postcode_civic.tsv")
        _copy(cur, "civic_name", ("code", "kind", "name"), ONSPD_SOURCE, "civic_name.tsv")
        print("load postcodes:", {table: cur.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                                  for table in ("postcode_civic", "civic_name")})


def load(url: str, only_civic: bool = False) -> None:
    """Replace the civic tables; only_civic keeps postcode_civic and civic_name (another load owns them)."""
    import psycopg

    with open(os.path.join(WORK, "sources.json")) as handle:
        sources = json.load(handle)
    releases = source_releases(sources)
    dc_id, mp_id = releases[2][0], releases[3][0]
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        for source_id, source_url, released, sha, licence, attribution, caveats in releases:
            cur.execute(RELEASE_SQL, (source_id, source_url, released, sha, licence, attribution, ETL_VERSION,
                                      caveats))
            _check_release(cur, source_id, sha)
        tables = ("representative", "council_tax") if only_civic else (
            "representative", "council_tax", "civic_name", "postcode_civic")
        for table in tables:
            cur.execute(f"DELETE FROM {table}")
        if not only_civic:
            _copy(cur, "postcode_civic", POSTCODE_COLUMNS, ONSPD_SOURCE, "postcode_civic.tsv")
            _copy(cur, "civic_name", ("code", "kind", "name"), ONSPD_SOURCE, "civic_name.tsv")
        _copy(cur, "council_tax", TAX_COLUMNS, COUNCIL_TAX_SOURCE, "council_tax.tsv")
        _copy(cur, "representative", PERSON_COLUMNS, None, "representative.tsv")
        cur.execute("UPDATE representative SET source_release_id = CASE role WHEN 'mp' THEN %s ELSE %s END",
                    (mp_id, dc_id))
        print("load:", {table: cur.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                        for table in tables})


def _copy(cur, table: str, columns: tuple, source_id: str | None, name: str) -> None:
    with open(os.path.join(WORK, name)) as handle:
        body = handle.read()
    # representative rows get their source after the copy; a placeholder keeps NOT NULL happy.
    tag = source_id or ONSPD_SOURCE
    body = "".join(f"{line}\t{tag}\n" for line in body.splitlines())
    with cur.copy(f"COPY {table} ({', '.join(columns)}, source_release_id) FROM STDIN "
                  "WITH (FORMAT text, NULL '')") as copy:
        copy.write(body)


def main(argv: list[str]) -> None:
    stage = argv[1] if len(argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "build" and argv[2:] == ["postcodes"]:
        build_postcodes()
    elif stage == "build" and len(argv) == 2:
        build()
    elif stage == "load" and argv[3:] == ["postcodes"]:
        load_postcodes(argv[2])
    elif stage == "load" and argv[3:] == ["civic"]:
        load(argv[2], only_civic=True)
    elif stage == "load" and len(argv) == 3:
        load(argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
