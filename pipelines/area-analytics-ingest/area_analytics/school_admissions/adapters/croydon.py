"""Croydon (306): allocation breakdowns (XLSX), prospectus overviews and secondary overviews (PDF).

* XLSX ('Reception YYYY  dd/mm/YYYY', oversubscribed schools only): one row per school with
  admission number, applications (not in 2026), offers, offers by criterion and the furthest
  distance offered in miles.
* Primary prospectus 'Overview of allocation of places at primary schools - YYYY entry': school,
  type, supplementary form, admission number, applications for three years, furthest distance
  for three years. The column headers are printed diagonally and pdftotext cannot read them, so
  the config gives the years in printed order (doc 'columns'): oldest first in the 2021, 2024 and
  2025 booklets, from the positions of the header characters and checked against the 2020 and
  2022 XLSX and the overlap between the 2024 and 2025 booklets.
* Secondary 'Transfer to Secondary School YYYY - Overview of allocations': offers by criterion,
  the last cell is the furthest distance (miles) or 'N/A'. The overview printed inside the
  secondary prospectuses wraps every name around its row and is not read.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, parse_count, pdf_pages, xlsx_rows

DISTANCE = re.compile(r"^\*?\d*\.\d+\**$")
ROW = re.compile(r"^(?P<left>\S.*?)\s+(?P<form>Yes|No)\s+(?P<pan>\d+)\s+(?P<apps>(?:\S+\s+){2}\S+)\s+"
                 r"(?P<dist>(?:\S+\s+){2}\S+)$")
TYPES = re.compile(r"\s+(?:Academy|Community|Foundation|Free School|Voluntary Aided|Voluntary Controlled)$")


def _name(printed: str) -> str:
    """Drop the trust after the school name ('Gonville Academy - The STEP Academy Trust')."""
    return clean(re.sub(r"\s*-\s*(?:The )?(?:STEP|Pegasus) Academy Trust", "", clean(printed)))


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        if path.endswith(".xlsx"):
            out += parse_xlsx(xlsx_rows(path), int(doc["year"]))
        elif doc["phase"] == "primary":
            out += parse_overview(pdf_pages(path), int(doc["year"]), doc.get("columns"))
        else:
            out += parse_secondary(pdf_pages(path), int(doc["year"]))
    return out


def parse_xlsx(rows: list[list[str]], year: int) -> list[Offer]:
    title = re.search(r"Reception (\d{4})", " ".join(rows[0]) if rows else "")
    if not title or int(title.group(1)) != year:
        raise ValueError(f"sheet title {title and title.group(1)}, configured {year}")
    header = next(i for i, row in enumerate(rows) if any(clean(c).endswith("School") for c in row[:2]))
    names = [clean(c).lower() for c in rows[header]]
    name = next(i for i, c in enumerate(names) if c.endswith("school"))
    apps = next((i for i, c in enumerate(names) if "applications" in c), None)
    offers = next(i for i, c in enumerate(names) if "offers" in c)
    distance = next(i for i, c in enumerate(names) if "distance offered" in c or "furthest distance" in c)
    out = []
    for row in rows[header + 1:]:
        if len(row) <= distance or not clean(row[name]) or parse_count(clean(row[offers]).rstrip("*")) is None:
            continue
        out.append(Offer(school=_name(row[name]), raw_value=clean(row[distance]),
                         applicants=parse_count(row[apps]) if apps is not None else None,
                         offers=parse_count(clean(row[offers]).rstrip("*"))))
    return out


def parse_overview(pages: list[str], year: int, columns: list[int] | None) -> list[Offer]:
    text = " ".join(" ".join(pages).split())
    entry = re.search(r"Overview of allocation of places at primary schools [-–] (\d{4}) entry", text)
    if not entry:
        raise ValueError("no primary 'Overview of allocation of places' table (not the primary prospectus)")
    if not columns or sorted(columns) != list(range(int(entry.group(1)) - 2, int(entry.group(1)) + 1)):
        raise ValueError(f"config columns {columns} do not fit the {entry.group(1)} entry table")
    if year not in columns:
        raise ValueError(f"{year} is not in the table ({columns})")
    at = columns.index(year)
    out = []
    for number, page in enumerate(pages, start=1):
        lines = page.splitlines()
        for i, line in enumerate(lines):
            row = ROW.match(line.strip())
            if not row:
                continue
            cells = [clean(c) for c in re.split(r"\s{2,}", row["left"]) if c.strip()]
            school = cells[0] if len(cells) > 1 else TYPES.sub("", cells[0])
            if TYPES.match(" " + school) or not school:  # the name wraps around the row
                around = [clean(lines[j]) for j in (i - 1, i + 1) if 0 <= j < len(lines)]
                school = " ".join(text for text in around if text and not re.search(r"\d", text))
            value = row["dist"].split()[at]
            if not (DISTANCE.match(value) or value == "N/A"):
                continue  # '***', 'abroad': not a distance
            out.append(Offer(school=_name(school), raw_value=value.strip("*"),
                             applicants=parse_count(row["apps"].split()[at]), page=number))
    return out


def parse_secondary(pages: list[str], year: int) -> list[Offer]:
    title = re.search(r"Transfer to Secondary School (\d{4})", pages[0])
    if not title:
        raise ValueError("the overview printed in the secondary prospectus is not read (names wrap around rows)")
    if int(title.group(1)) != year:
        raise ValueError(f"title year {title.group(1)}, configured {year}")
    out, lines = [], [(n, line) for n, page in enumerate(pages, start=1) for line in page.splitlines()]
    for i, (number, line) in enumerate(lines):
        cells = [clean(c) for c in re.split(r"\s{2,}", line.strip()) if c.strip()]
        if len(cells) < 10 or not (DISTANCE.match(cells[-1]) or cells[-1] == "N/A"):
            continue
        name = cells[0]
        following = lines[i + 1][1].strip() if i + 1 < len(lines) else ""
        if following and not re.search(r"\d|\s{2,}", following):
            name = f"{name} {following}"  # 'Harris City Academy Crystal' / 'Palace'
        out.append(Offer(school=_name(name), raw_value=cells[-1], page=number))
    return out
