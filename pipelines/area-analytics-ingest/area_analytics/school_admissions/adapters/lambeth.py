"""Lambeth (208): 'How offers were made on National Offer Day' documents.

Primary, one document per school type:
  * community schools: one table row per school (or site, 'Henry Cavendish Primary School
    (Balham site)'): PAN, on-time applications, offers by criterion and 'Last distance - straight
    line (metres)', or 'All applicants received a place at the school or a higher preferred offer'
    across the criterion columns. PDF to 2024 and in 2026; an HTML table in 2025.
  * foundation, voluntary-aided and academy schools: a block per school, its name above 'PAN
    (Published Admissions Number)' ('Number of places available' in 2019), then 'Number of on time applications received: N' and either
    'All applicants received a place ...' or 'Distance for last child offered (with criteria 5):
    2041.53 metres (straight line)'. Julian's prints one outcome per site, and its distance as
    'shortest walking route': the row carries its own method.
Secondary, one PDF per school, laid out by the school: 'last distance 2015.21', 'Last distance
offered on NOD 3387.020', a banded table with one 'last distance' / 'Max. distance' column (one row
per band), or 'All applicants received a place ...'. The school is named by the file's URL. Index
pages saved with the documents (HTML) are skipped.
"""
from __future__ import annotations

import html
import re

from ..parsers import Offer, clean, html_tables, parse_count, pdf_text

ALL = re.compile(r"All applicants received a place", re.I)
INDEXED = re.compile(r"PAN \(Published Admissions Number\)|Last distance - straight line", re.I)
BAND_LINE = re.compile(r"^(?P<band>[A-Z][\w ]*? band)\s*(?:\(\s*\d+ child(?:ren)?\s*\))?\s*:?$", re.I)
OFFER_YEAR = re.compile(r"(?:Offer Day \(\d{1,2} \w+ |Secondary Transfer |September |Offer Day \(\d\d/\d\d/)(\d{2,4})\b")
# primary community table row: name, PAN, applications, EHCP places, then the rest
TABLE_ROW = re.compile(r"^(?P<name>\S.*?)\s{2,}(?P<pan>\d+)\s+(?P<apps>\d+)\s+(?P<ehcp>\d+)\s+(?P<rest>\S.*)$")
SITE_IN_NAME = re.compile(r"^(?P<name>.*?)\s*\((?P<site>[^)]+?) site\)$", re.I)
SITE_LINE = re.compile(r"^(?P<site>[A-Z][\w ]*?) Site$", re.I)
APPS = re.compile(r"Number of on[- ]time applications(?: received)?\s*[:=–-]\s*(\d[\d,]*)", re.I)
LAST = re.compile(r"Distance for last child offered(?: \(with (?P<criterion>criteria \d+)\))?\s*:\s*"
                  r"(?P<value>\d[\d,]*(?:\.\d+)? metres)\s*\((?P<method>[^)]+)\)", re.I)
METHODS = (("walking", "walking"), ("straight", "straight-line"))
DECIMAL = re.compile(r"^\d[\d,]*\.\d+$")
BAND = re.compile(r"^(?:band\s+)?(\d(?:\.\d)?|Z|Bursary)$", re.I)

# Secondary documents are one per school; the URL names it (checked in order: elmgreen before elms).
SCHOOL_BY_URL = (
    ("elmgreen", "The Elmgreen School"), (r"the[-_ %20]+elms", "The Elms Academy"),
    ("dunraven", "Dunraven School"), ("lilian", "Lilian Baylis Technology School"),
    ("norwood", "The Norwood School"), ("evelyn", "Ark Evelyn Grace Academy"),
    ("bishop-thomas-grant", "Bishop Thomas Grant Catholic Secondary School"),
    (r"city[-_ %20]+heights", "City Heights E-ACT Academy"), ("harris", "Harris Academy Clapham"),
    ("retraite", "La Retraite Roman Catholic Girls' School"),
    (r"\blns\b", "London Nautical, City of London Academy"), ("oasis", "Oasis Academy South Bank"),
    ("platanos", "Platanos College"), (r"\bsgc\b", "Saint Gabriel's College"),
    ("trinity", "Trinity Academy"), ("woodmansterne", "Woodmansterne School"),
)


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    urls = [doc["url"], *(doc.get("other_urls") or [])]
    out = []
    for path, url in zip(files, urls):
        with open(path, "rb") as handle:
            head = handle.read(5)
        if head != b"%PDF-":
            if doc["phase"] == "secondary" or not INDEXED.search(html_text(path)):
                continue  # an index page of the per-school PDFs
            rows = html_rows(path)
        else:
            rows = None
        text = html_text(path) if rows is not None else pdf_text(path)
        check_year(text, doc["year"], url)
        if doc["phase"] == "secondary":
            found = secondary(text, doc["year"], school_by_url(url))
        elif rows and rows[0] and rows[0][0].lower().startswith("school name"):
            found = community_rows(rows)
        elif rows is None and re.search(r"Last distance\s*-\s*strai", text):
            found = community_text(text)
        else:
            found = blocks(text)
        out += [_with_url(offer, url) for offer in found]
    return out


def _with_url(offer: Offer, url: str) -> Offer:
    offer.source_url = url
    return offer


def check_year(text: str, year: int, url: str) -> None:
    years = {int(y) % 100 for y in OFFER_YEAR.findall(text[:3000])}
    if years and year % 100 not in years:
        raise ValueError(f"{url}: offer year {sorted(years)}, configured {year}")


def html_rows(path: str) -> list[list[str]]:
    tables = html_tables(path)
    return [[clean(cell.replace("\xa0", " ")) for cell in row] for table in tables for row in table]


def html_text(path: str) -> str:
    with open(path, encoding="utf-8", errors="replace") as handle:
        page = handle.read()
    page = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", page)
    page = re.sub(r"(?i)<(?:br|/p|/h\d|/li|/tr|/div)[^>]*>", "\n", page)
    return html.unescape(re.sub(r"<[^>]+>", " ", page)).replace("\xa0", " ")


# --- primary --------------------------------------------------------------------------------------

def community_text(text: str) -> list[Offer]:
    out = []
    for line in text.splitlines():
        row = TABLE_ROW.match(line.strip())
        if not row or not re.search(r"(?:School|Academy)\b", row["name"]):
            continue
        out.append(_community(row["name"], row["apps"], row["rest"].split()))
    return out


def community_rows(rows: list[list[str]]) -> list[Offer]:
    return [_community(row[0], row[2], row[4:]) for row in rows[1:] if len(row) >= 5 and row[0]]


def _community(name: str, apps: str, rest: list[str]) -> Offer:
    name, site = _site(clean(name))
    if ALL.search(" ".join(rest)):
        return Offer(school=name, site=site, raw_value="All applicants received a place at the school or "
                     "a higher preferred offer", applicants=parse_count(apps), all_offered=True)
    return Offer(school=name, site=site, raw_value=rest[-1] if rest else "", applicants=parse_count(apps))


def _site(name: str) -> tuple[str, str]:
    found = SITE_IN_NAME.match(name)
    return (found["name"], _slug(found["site"])) if found else (name, "main")


def _slug(site: str) -> str:
    return "-".join(site.lower().split())


def blocks(text: str) -> list[Offer]:
    """Foundation, VA and academy blocks: name, PAN line, applications, outcome per site."""
    lines = [clean(line) for line in text.splitlines()]
    lines = [line for line in lines if line]
    out, school, site, apps, band = [], None, "main", None, None
    for i, line in enumerate(lines):
        if line.startswith(("PAN (Published Admissions Number)", "Number of places available")) and i:
            name = lines[i - 2] if lines[i - 1].startswith("(") and i > 1 else lines[i - 1]  # '(became an academy ...)'
            school, site = _site(name)[0], "main"
            apps = band = None
        if school is None:
            continue
        if found := APPS.search(line):
            apps = parse_count(found[1])
        if found := SITE_LINE.match(line):
            site = _slug(found["site"])
        if found := BAND_LINE.match(line):
            band = found["band"]
        if ALL.search(line):
            out.append(Offer(school=school, site=site, applicants=apps, all_offered=True, rule=band,
                             raw_value="All applicants received a place at the school or a higher preferred offer"))
        elif found := LAST.search(line):
            method = next((m for key, m in METHODS if key in found["method"].lower()), None)
            out.append(Offer(school=school, site=site, applicants=apps, raw_value=found["value"],
                             criterion=found["criterion"], method=method, rule=band))
    return out


# --- secondary ------------------------------------------------------------------------------------

def school_by_url(url: str) -> str:
    low = url.lower()
    for pattern, name in SCHOOL_BY_URL:
        if re.search(pattern, low):
            return name
    raise ValueError(f"no school known for {url}")


def secondary(text: str, year: int, school: str) -> list[Offer]:
    section = re.split(r"Offers for September (\d{4})", text)
    if len(section) > 3:  # several years in one file: keep the configured one
        text = next(body for y, body in zip(section[1::2], section[2::2]) if int(y) == year)
    lines = [line for line in text.splitlines() if line.strip()]
    apps = next((parse_count(m[1]) for line in lines if (m := APPS.search(clean(line)))), None)
    banded = re.search(r"(?m)^\s*Band\b", text)
    out = []
    for line in lines:
        label = clean(line)
        if re.search(r"last distance", label, re.I) and (value := re.search(r"(\d[\d,]*\.\d+|\d{3,})\s*$", label)):
            out.append(Offer(school=school, raw_value=value[1], applicants=apps,
                             rule=re.sub(r"\s*\d[\d,.]*$", "", label)))
        tokens = label.split()
        if banded and tokens and BAND.match(" ".join(tokens[:2]) if tokens[0].lower() == "band" else tokens[0]):
            band = tokens[1] if tokens[0].lower() == "band" else tokens[0]
            decimals = [t for t in tokens[1:] if DECIMAL.match(t)] or [t for t in tokens[1:] if re.match(r"^\d{4,5}$", t)]
            if len(decimals) == 1:  # the distance: the one decimal, else the one 4-5 digit number
                out.append(Offer(school=school, raw_value=decimals[0], rule=f"Band {band}", applicants=apps))
    if not out and re.search(r"Max\. distance", text):  # one row of values under the header
        rows = [t for line in lines if (t := clean(line).split()) and all(re.match(r"^[\d.,]+$", x) for x in t)
                and sum(bool(DECIMAL.match(x)) for x in t) == 1]
        out += [Offer(school=school, raw_value=next(x for x in row if DECIMAL.match(x)), applicants=apps)
                for row in rows[:1]]
    if not out and ALL.search(text):
        out.append(Offer(school=school, applicants=apps, all_offered=True,
                         raw_value="All applicants received a place at the school or a higher preferred offer"))
    if len({o.rule for o in out}) == 1 and len(out) == 1:
        out[0].rule = None
    if not out:
        out.append(Offer(school=school, raw_value="(no last distance found in the document)", applicants=apps))
    return out
