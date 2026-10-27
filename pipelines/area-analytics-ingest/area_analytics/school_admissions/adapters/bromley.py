"""Bromley (305): the 'Distances and appeals' table of the annual primary / secondary booklet.

A three-year rolling table: school, appeals heard and upheld, then the distance in miles (as at
national offer day) for each of three years, newest first, under a header naming them. 'N/A'
is explained under the table as all applicants offered ('school undersubscribed' / 'offered all
applicants and had spaces remaining'). 'Church Criteria', 'See banding schools table' and
'Places offered on Test Score' are not distances and give no row; the grammar and banded
schools' band tables are not read. Junior schools (a separate 'Junior schools' table) are Year 3
entry. Only the configured year's column is read; it must be one of the header's years.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, pdf_pages

YEARS = re.compile(r"Upheld\s+(20\d\d)\s+(20\d\d)\s+(20\d\d)\s*$")
CELL = re.compile(r"^(?:\d*\.\d+|N/A|[A-Za-z][A-Za-z ]*)$")  # a distance, N/A or words; never a count
LEGEND = re.compile(r"N/A - (?:school undersubscribed|means that the school offered all applicants)")
HEADINGS = ("Distances and appeals", "Distances and appeal")
STOP = re.compile(r"^(?:Useful contacts|Banding\b|.*\s{2,}Banding\b)")


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        out += parse_text(pdf_pages(path), int(doc["year"]))
    return out


def parse_text(pages: list[str], year: int) -> list[Offer]:
    lines = [(n, line) for n, page in enumerate(pages, start=1) for line in page.splitlines()]
    try:
        start = next(i for i, (_, line) in enumerate(lines) if line.strip() in HEADINGS)
    except StopIteration:
        raise ValueError("no 'Distances and appeals' section") from None
    legend = any(LEGEND.search(line) for _, line in lines[start:])
    out, years, entry = [], None, None
    rest = lines[start + 1:]
    for i, (number, line) in enumerate(rest):
        text = line.strip()
        if STOP.match(text) or text.startswith(("Harris Academy Beckenham*", "Banding")):
            break
        if text == "Junior schools":
            entry = "year3"
        if found := YEARS.search(text):
            years = [int(y) for y in found.groups()]
            if year not in years:
                raise ValueError(f"table covers {years}, configured {year}")
            continue
        cells = [clean(c) for c in re.split(r"\s{2,}", text) if c.strip()]
        # name, appeals heard and upheld (or 'Information not available'), three years
        if not years or len(cells) < 5 or not all(CELL.match(c) for c in cells[-3:]):
            continue
        cell = cells[-3:][years.index(year)]
        following = clean(re.split(r"\s{2,}", rest[i + 1][1].strip())[0]) if i + 1 < len(rest) else ""
        name = cells[0]
        if following and following != "Junior schools" and not YEARS.search(following) \
                and not re.search(r"\d", following) and len(rest[i + 1][1]) - len(rest[i + 1][1].lstrip()) < 20:
            name = f"{name} {following}"  # a name wrapped onto the next line
        if not re.match(r"^(?:\d*\.\d+|N/A)$", cell):
            continue  # 'Church Criteria', 'Nodal Points', 'See banding schools table'
        out.append(Offer(school=name, raw_value=cell, entry_point=entry,
                         all_offered=True if cell == "N/A" and legend else None, page=number))
    if years is None:
        raise ValueError("no year header in the distances table")
    return out
