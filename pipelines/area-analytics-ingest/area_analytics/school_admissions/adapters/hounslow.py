"""Hounslow (313): 'How primary/secondary places were offered/allocated in September <year>' PDFs,
read as text (pdftotext -layout).

Community primary schools (and every school in 2025) are a grid, one line per school: offers per
criterion, the distance criterion's cell '<offers> - last distance - 0.545 miles' or '<offers> -
all offered', places available and applications (every preference naming the school). In 2026
the cell wraps ('30 - 0.779 miles last' / 'distance', '55 -distance' / 'All offered') and the
applications figure may drop to the next line, where it is not taken. Academies, free and
voluntary-aided schools (and all secondary schools) are blocks: '<School>  Places available = N
Applications received = M', then one line per criterion with its allocations; a criterion whose
cell names a last distance or 'all offered' becomes a row (the criterion as printed; a school
with two such criteria, Nishkam's faith and open places, gets one row per criterion). Schools
printing neither ('Contact school for information') give no row.

raw_value is the cell without its leading allocation count ('last distance offered - 1.40
miles'). St Mark's prints the last distance per deanery ('Hounslow - 0.842 miles, Hillingdon -
3.961 miles, ...'): one row per deanery. A cell that is not a number ('4.5122.126 miles', Green
School for Girls 2024) is left out. The 2022 secondary document is a rolling table of the last distance for 2020-2022; the
configured year's column is read.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, pdf_pages

TITLE = re.compile(r"(?:September|Secondary Transfer) (\d{4})")
CELL = re.compile(r"(?:(?P<count>\d+)\s*[–-]\s*(?:distance\s+)?)?(?P<value>all offered|"
                  r"(?:last distance(?: offered)?\s*[–-]?\s*)?\d*\.\d[\d.]*(?:\s*miles?)?(?:\s+last(?:\s+distance)?)?)",
                  re.I)
BLOCK = re.compile(r"^\s*(?P<name>\S.*?)\s{2,}Places available\s*=\s*(?P<places>\d+).*?"
                   r"Applications received\s*=\s*(?P<apps>\d+)", re.I)
DEANERY = re.compile(r"([A-Z][A-Za-z ]+?)\s*-\s*(\d*\.\d+ miles)")
GARBLED = re.compile(r"\d\.\d+\.\d")  # '4.5122.126 miles': not a number, left out
SECTION = re.compile(r"^(?:Criteria\b|Academy and Free|Voluntary|Community Schools|School\s{2,}|"
                     r"The information|to decide|The data|admission criteria|School Transfer|brochure)", re.I)
ROLLING = re.compile(r"(\d{4}) Distance \(Miles\)", re.I)


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        pages = pdf_pages(path)
        rolling = ROLLING.findall(pages[0])
        years = {int(y) for y in TITLE.findall(clean(pages[0][:400]))}
        if rolling:
            if str(doc["year"]) not in rolling:
                raise ValueError(f"{path}: rolling columns {rolling}, configured {doc['year']}")
            out += parse_rolling(pages, rolling.index(str(doc["year"])))
            continue
        if years != {int(doc["year"])}:
            raise ValueError(f"{path}: title years {sorted(years)}, configured {doc['year']}")
        out += parse_pages(pages)
    return out


def parse_rolling(pages: list[str], column: int) -> list[Offer]:
    out = []
    for number, page in enumerate(pages, start=1):
        for line in page.splitlines():
            cells = [c for c in re.split(r"\s{2,}", line.strip()) if c]
            if len(cells) == 4 and not ROLLING.search(line):
                out.append(Offer(school=cells[0], raw_value=cells[1 + column], page=number))
    return out


def parse_pages(pages: list[str]) -> list[Offer]:
    out, block = [], None
    for number, page in enumerate(pages, start=1):
        lines = page.splitlines()
        for i, line in enumerate(lines):
            text = clean(line)
            if not text:
                continue
            if head := BLOCK.match(line):
                block = {"name": clean(head["name"]), "apps": int(head["apps"]), "rows": []}
                out.append(block)
                continue
            if SECTION.match(text):
                continue
            starts = len(line) - len(line.lstrip())
            if block is None and starts <= 2:
                if row := grid_row(line, lines[i + 1:i + 3], number):
                    out.append(row)
            elif block is not None and (cell := CELL.search(line)) and re.search(r"\s{2,}", line.strip()):
                criterion = clean(re.split(r"\s{2,}", line.strip())[0])
                pairs = DEANERY.findall(re.split(r"\s{2,}", line.strip(), maxsplit=1)[1])
                if len(pairs) > 1:  # St Mark's: last distance per deanery, wrapping onto the next line
                    pairs += DEANERY.findall(lines[i + 1]) if i + 1 < len(lines) else []
                    block["rows"] += [Offer(school=block["name"], raw_value=value, criterion=criterion,
                                            rule=f"{criterion}: {clean(place)}", applicants=block["apps"],
                                            page=number) for place, value in pairs]
                    continue
                if GARBLED.search(cell["value"]):
                    continue
                block["rows"].append(Offer(school=block["name"], raw_value=clean(cell["value"]),
                                           criterion=criterion, applicants=block["apps"], page=number))
    return [o for item in out for o in (_block_offers(item) if isinstance(item, dict) else [item])]


def _block_offers(block: dict) -> list[Offer]:
    rows = block["rows"]
    for row in rows:
        if row.rule is None and len(rows) > 1:
            row.rule = row.criterion
    return rows


def grid_row(line: str, following: list[str], page: int) -> Offer | None:
    """One community-school line; the cell may wrap onto the next lines (indented)."""
    name = clean(re.split(r"\s{2,}", line.strip())[0])
    text = line
    cell = CELL.search(line[len(name):])
    for extra in following:
        if cell or not extra.strip() or len(extra) - len(extra.lstrip()) <= 2:
            break
        text = text + " " + extra.strip()
        cell = CELL.search(text[len(name):])
    if not cell:
        return None
    after = [int(n) for n in re.findall(r"\b\d+\b", line[line.find(cell.group(0)) + len(cell.group(0)):])] \
        if cell.group(0) in line else []
    return Offer(school=name, raw_value=clean(cell["value"]), applicants=after[-1] if len(after) >= 2 else None,
                 page=page)
