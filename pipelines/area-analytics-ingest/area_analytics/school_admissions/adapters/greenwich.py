"""Royal Greenwich (203): admission data and statistics workbooks, the offers-map JSON and the
secondary booklet.

xlsx (National Offer Day 2022-2024): one row per school under 'Planning Area' headings: name, 'URN &
DFE Numbers', PAN, 'Oversubscribed on National Offer Day <year>', applications by preference and
in total, offers by preference and in total, offers with SEND and LA allocations, 'Criteria of last
place offered' and 'Last distance offered in metres, using a straight line' (a number, 'Faith
School', 'N/A', or '21437.68 (Open Band)' for a church school's open places). A school that was not
oversubscribed offered every applicant a place: all_offered, the printed distance kept. Secondary
workbooks add a sheet 'Offers by Band': a school name, then one row per band (applications,
oversubscribed, offers, criterion, distance; 'Untested' has no criterion).
JSON (the offers map, 'year' 2026): school -> [easting, northing, 'Last distance offered (m)',
status]; '(Open band)' and '- Band 3' are sub-allocations, other brackets ('(Deptford site)',
'(Plum lane)') are sites.
PDF booklet (secondary, entry 2025): per school 'Places available', 'Applications received' and
'Last offer on distance (km)', by band where there are bands, before 'Applications to <school> for
entry <year>'.
A doc's ignore_distance names schools whose printed distance is over the 10-mile review limit and
not a plausible cut-off (the reason is in the config): their row keeps the counts only.
"""
from __future__ import annotations

import json
import re

from ..parsers import Offer, clean, parse_count, pdf_text, xlsx_rows

# Printed names that are one site of a school (the JSON's brackets are read as sites already).
SITES = {"Plumcroft Plum Lane": ("Plumcroft Primary School", "plum-lane"),
         "Plumcroft Vincent Road": ("Plumcroft Primary School", "vincent-road"),
         "Invicta Blackheath": ("Invicta Primary School", "blackheath"),
         "St Mary Magdalene Woolwich CE": ("Saint Mary Magdalene Church of England All Through School", "woolwich"),
         "St Mary Mag (Peninsula) CE": ("Saint Mary Magdalene Church of England All Through School", "peninsula")}
# Two schools the JSON prints as sites of one.
JSON_NAMES = {"Windrush Primary School (Charlton site)": "Windrush Charlton Primary School",
              "Windrush Primary School (Thamesmead site)": "Windrush Thamesmead Primary School"}
NUMBER = re.compile(r"^\d[\d,]*(?:\.\d+)?$")


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        if path.endswith(".xlsx"):
            out += workbook(path, doc["year"])
        elif path.endswith(".pdf"):
            out += booklet(pdf_text(path, raw=True), doc["year"])
        else:
            out += offers_map(path, doc["year"])
    ignore = doc.get("ignore_distance") or {}
    for offer in out:
        if offer.school in ignore:
            offer.raw_value = ""
        offer.school, offer.site = SITES.get(offer.school, (offer.school, offer.site))
    return out


def _cell(value) -> str:
    return clean(str(value)) if value not in (None, "") else ""


def workbook(path: str, year: int) -> list[Offer]:
    rows = xlsx_rows(path)
    title = " ".join(rows[0]) + " " + " ".join(rows[1]) if len(rows) > 1 else ""
    if f"National Offer Day {year}" not in title:
        raise ValueError(f"{path}: workbook is not for National Offer Day {year}")
    header = [_cell(c).lower() for c in rows[1]]
    oversub = next(i for i, c in enumerate(header) if c.startswith("oversubscribed"))
    criterion = header.index("criteria of last place offered")
    distance = next(i for i, c in enumerate(header) if c.startswith("last distance offered"))
    total_apps = header.index("total preferences")
    total_offers = header.index("total preferences", total_apps + 1) if header.count("total preferences") > 1 \
        else header.index("total preference offers")
    out = []
    for row in rows[2:]:
        if len(row) <= distance or not _cell(row[1]) or "&" not in _cell(row[1]):
            continue  # planning-area headings, notes
        out.append(_offer(_cell(row[0]), _cell(row[distance]), _cell(row[criterion]), _cell(row[oversub]),
                          parse_count(_cell(row[total_apps])), parse_count(_cell(row[total_offers]))))
    if len(xlsx_sheets(path)) > 1:
        out += bands(xlsx_rows(path, "Offers by Band"))
    return out


def xlsx_sheets(path: str) -> list[str]:
    import openpyxl

    book = openpyxl.load_workbook(path, read_only=True)
    names = book.sheetnames
    book.close()
    return names


def _offer(name: str, value: str, criterion: str, oversubscribed: str, apps, offers, rule=None) -> Offer:
    if found := re.match(r"^(\S+)\s*\((Open Band)\)$", value, re.I):
        value, rule = found[1], found[2]
    raw = value if NUMBER.match(value) else ""
    return Offer(school=name, raw_value=raw, criterion=criterion or (value if not raw else None) or None,
                 rule=rule, applicants=apps, offers=offers,
                 all_offered=True if oversubscribed.lower() == "no" else None)


def bands(rows: list[list[str]]) -> list[Offer]:
    out, school = [], None
    for row in rows:
        cells = [_cell(c) for c in row] + [""] * 6
        label = cells[0]
        if not label:
            continue
        if re.match(r"^(?:Band \d+|Untested)$", label, re.I) and school:
            if label.lower() == "untested":  # applications, offers, distance: no criterion columns
                values = [c for c in cells[1:] if c]
                if len(values) == 3:
                    out.append(_offer(school, values[2], "", "", parse_count(values[0]),
                                      parse_count(values[1]), rule="Untested"))
                continue
            out.append(_offer(school, cells[5], cells[4], cells[2], parse_count(cells[1]), parse_count(cells[3]),
                              rule=label))
        elif not label.lower().startswith(("total", "band")) and not any(cells[1:6]):
            school = label
    return out


def offers_map(path: str, year: int) -> list[Offer]:
    with open(path) as handle:
        data = json.load(handle)["coords_radii"]
    if str(data["year"]) != str(year):
        raise ValueError(f"{path}: map data for {data['year']}, configured {year}")
    out = []
    for name, values in data["data"].items():
        rule, site = None, "main"
        name = JSON_NAMES.get(name, name)
        if found := re.match(r"^(.*?)\s*-\s*(Band \d+)$", name):
            name, rule = found[1], found[2]
        elif found := re.match(r"^(.*?)\s*\((Open band)\)$", name, re.I):
            name, rule = found[1], found[2]
        elif found := re.match(r"^(.*?)\s*\(([^)]+?)(?: site)?\)$", name, re.I):
            name, site = found[1], "-".join(found[2].lower().split())
        value = values[2]
        out.append(Offer(school=clean(name), raw_value="" if value is None else str(value), rule=rule, site=site))
    return out


def booklet(text: str, year: int) -> list[Offer]:
    lines = [clean(line) for line in text.splitlines()]
    out = []
    for i, line in enumerate(lines):
        if not line.startswith("Last offer on distance (km)"):
            continue
        values = line.split()[5:]
        if not values:
            continue  # the school printed no figures
        name, j = [], i + 1
        if not lines[j].startswith("Applications to"):
            raise ValueError(f"no school after line {i}: {lines[j]!r}")
        first = lines[j][len("Applications to"):].strip()
        name += [first] if first else []
        for follow in lines[j + 1:j + 4]:
            entry = re.match(r"^for\s*entry\s*(\d{4})", follow)
            if entry:
                if int(entry[1]) != year:
                    raise ValueError(f"booklet figures for entry {entry[1]}, configured {year}")
                break
            name.append(follow)
        bands = next((lines[k].split()[1:] for k in range(i - 1, i - 5, -1) if lines[k].startswith("Band ")), None)
        apps = next((lines[k].split()[2:] for k in range(i - 1, i - 4, -1)
                     if lines[k].startswith("Applications received")), [])
        school = clean(" ".join(name))
        for n, value in enumerate(values):
            out.append(Offer(school=school, raw_value=f"{value} km",
                             rule=f"Band {bands[n]}" if bands and len(bands) == len(values) else None,
                             applicants=parse_count(apps[n]) if n < len(apps) else None))
    return out
