"""Brent (304): 'How places were offered / allocated at Brent schools' PDFs.

Each school has a heading line (name, '(PAN)', offers, sometimes applications and 'Over/Under
subscribed') and one line per admission criterion with the number offered under it and the
furthest distance in metres for the criteria that use one ('Sibling   26   1815.86'; 2019
secondary '76 (4230.01)'; the 2019 VA table prints the distance before the count). Criteria are
not always printed in priority order, so each criterion with a distance is its own rule; an
undersubscribed school is one 'Undersubscribed' (all offered) row. In the secondary tables the
school name and the first criterion share a line, split at the 'Criteria/Band' column. 999999 is
a placeholder, not a distance. The 2019 community primary table is a matrix and is read by
parse_matrix.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, parse_count, pdf_pages, pdf_tables

YEAR = re.compile(r"Reception(?: Admissions)? (\d{4})|(\d{4}) Reception Transfer|September (\d{4})")
NUMBER = re.compile(r"^\d+(?:\.\d+)?\*?$")
WITH_DISTANCE = re.compile(r"^(\d+)\s*\((\d+(?:\.\d+)?)\)$")
STATUS = re.compile(r"^(?:Over|Under|Fully) ?subscribed$", re.I)
APPLICATIONS = re.compile(r"^(\d+) applications?$")
PLACEHOLDER = "999999"
HEADER = re.compile(r"School Name|Criteria/Band|Number of offers|max distance|^\s*Offers\s*$|^\s*\(Published", re.I)
MATRIX = "Number of offers by criteria"


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        pages = pdf_pages(path)
        found = YEAR.search(" ".join(pages[0].split()))
        year = found and int(next(g for g in found.groups() if g))
        if year != int(doc["year"]):
            raise ValueError(f"title year {year} in {path}, configured {doc['year']}")
        if MATRIX in pages[0]:
            out += parse_matrix(path)
        else:
            out += parse_text(pages, doc["phase"])
    return out


def _cells(text: str) -> list[str]:
    return [clean(cell) for cell in re.split(r"\s{2,}", text.strip()) if cell.strip()]


def parse_text(pages: list[str], phase: str) -> list[Offer]:
    distance_first = "furthest distance in metres - Brent voluntary aided" in " ".join(" ".join(pages).split())
    schools, split_at, block = [], None, None
    for number, page in enumerate(pages, start=1):
        for line in page.splitlines():
            if "Criteria/Band" in line:
                split_at = line.index("Criteria/Band")
            if not line.strip() or line.lstrip().startswith(("How places", "Data ", "EHCP =", "EHCP -")):
                continue
            if phase == "secondary":
                # Names are centred on their block of criteria and may wrap, so a block runs up
                # to its 'Total' line and its name is every name-column fragment in it.
                if split_at is None or HEADER.search(line) or line.strip().lower().startswith("grand total"):
                    continue
                if block is None:
                    block = {"school": "", "page": number, "criteria": [], "counts": [], "status": None,
                             "applicants": None}
                block["school"] = clean(block["school"] + " " + line[:split_at])
                cells = _cells(line[split_at:])
                if cells:
                    _criterion(block, cells, distance_first)
                if cells and cells[0].lower() in ("total", "grand total"):
                    if block["school"] and cells[0].lower() == "total":
                        schools.append(block)
                    block = None
                continue
            indent = len(line) - len(line.lstrip())
            cells = _cells(line)
            if cells and cells[0].lower().startswith("grand total"):
                continue
            if indent <= 1 and len(cells) >= 2 and all(NUMBER.match(c) or STATUS.match(c) for c in cells[1:]):
                schools.append({"school": cells[0], "page": number, "criteria": [], "status": None,
                                "counts": [c for c in cells[1:] if NUMBER.match(c)], "applicants": None})
                schools[-1]["status"] = next((c for c in cells if STATUS.match(c)), None)
            elif indent >= 2 and schools and len(cells) >= 2:
                _criterion(schools[-1], cells, distance_first)
    out = []
    for s in schools:
        s["school"], site = _site(s["school"])
        counts = [parse_count(c.rstrip("*")) for c in s["counts"]]
        applicants = s["applicants"] if s["applicants"] is not None else (counts[0] if len(counts) == 2 else None)
        offers = counts[-1] if counts else None
        under = (s["status"] or "").lower() == "undersubscribed"
        if under or counts or s["applicants"] is not None:
            out.append(Offer(school=s["school"], site=site, raw_value="Undersubscribed" if under else "",
                             applicants=applicants, offers=offers, page=s["page"]))
        if under:
            continue
        for criterion, distance in s["criteria"]:
            out.append(Offer(school=s["school"], site=site, raw_value=distance, criterion=criterion,
                             rule=criterion, page=s["page"]))
    return out


def _site(printed: str) -> tuple[str, str]:
    """'Leopold Primary School - Hawkshead Road site' -> school and site; '(PAN)' dropped."""
    name = clean(re.sub(r"\(\d+\)\s*$", "", printed))
    found = re.match(r"^(.+?) - (.+?)(?: [Ss]ite)?$", name)
    return (found.group(1), found.group(2)) if found else (name, "main")


def _criterion(school: dict, cells: list[str], distance_first: bool) -> None:
    for cell in cells:
        if STATUS.match(cell):
            school["status"] = cell
        elif found := APPLICATIONS.match(cell):
            school["applicants"] = int(found.group(1))
    words = [c for c in cells if not NUMBER.match(c) and not WITH_DISTANCE.match(c)
             and not STATUS.match(c) and not APPLICATIONS.match(c)]
    numbers = [c for c in cells if NUMBER.match(c)]
    if not words or words[0].lower() == "total":
        return
    if words[0].lower().startswith("all applicants"):
        school["status"] = "Undersubscribed"  # 'All applicants offered'
        return
    distance = None
    if paired := next((WITH_DISTANCE.match(c) for c in cells if WITH_DISTANCE.match(c)), None):
        distance = paired.group(2)
    elif len(numbers) == 2:
        distance = numbers[0] if distance_first else numbers[1]
    if distance and distance != PLACEHOLDER:
        school["criteria"].append((words[0], distance))


def parse_matrix(path: str) -> list[Offer]:
    """2019 community schools: places, applications, offers, then per criterion a count and,
    in the next column, the furthest distance (pdfplumber keeps the columns)."""
    out = []
    for page, table in pdf_tables(path):
        header = next((row for row in table if any("Sibling" in cell for cell in row)), None)
        if header is None:
            continue
        criteria = [(i, clean(cell)) for i, cell in enumerate(header[:-1])
                    if i >= 4 and cell and not header[i + 1]]
        for row in table:
            if len(row) != len(header) or not row[1].isdigit():
                continue
            school, site = _site(row[0])
            out.append(Offer(school=school, site=site, raw_value="", applicants=parse_count(row[2]),
                             offers=parse_count(row[3]), page=page))
            for i, criterion in criteria:
                value = clean(row[i + 1])
                if NUMBER.match(value) and value != PLACEHOLDER:
                    out.append(Offer(school=school, site=site, raw_value=value, criterion=criterion,
                                     rule=criterion, page=page))
    if not out:
        raise ValueError("no community schools table")
    return out
