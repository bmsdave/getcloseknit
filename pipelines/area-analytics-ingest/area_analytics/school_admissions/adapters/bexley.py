"""Bexley (303): 'Home to school distance for offers in miles' in the primary admissions booklet.

A three-year rolling table (the booklet for 2023/24 entry prints 2022, 2021 and 2020): school,
one cell per year, then appeals heard and successful. A cell is a distance in miles ('0.426 (TB)',
tie-break), 'All on time offered' (kept as all offered, no raw value) or 'See note' (faith
schools; nothing read). The booklet says the distances are those reached on offer day. Only the
configured year's column is read; it must be one of the table's years.

The secondary booklet's table ('5 years ago' ... '1 years ago*', '@ 7.7.2022', end of process in
August, some by road route) cannot be tied to entry years without guessing and is not read.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, pdf_pages

TITLE = "Home to school distance for offers in miles"
YEARS = re.compile(r"^\s*School\s+((?:20\d\d\s+){2,}20\d\d)\s*")


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    if doc["phase"] != "primary":
        raise ValueError("the secondary table's columns ('N years ago') are not tied to entry years")
    out = []
    for path in files:
        out += parse_text(pdf_pages(path), int(doc["year"]))
    return out


def parse_text(pages: list[str], year: int) -> list[Offer]:
    out, years = [], None
    for number, page in enumerate(pages, start=1):
        if TITLE not in page:
            continue
        for line in page.splitlines():
            if found := YEARS.match(line):
                years = [int(y) for y in found.group(1).split()]
                if year not in years:
                    raise ValueError(f"table covers {years}, configured {year}")
                continue
            # 'All on time offered All on time offered' is sometimes printed with single spaces
            line = re.sub(r"(All on time offered|See note)\s+", r"\1  ", line)
            cells = [clean(cell) for cell in re.split(r"\s{2,}", line.strip()) if cell.strip()]
            if not years or len(cells) != len(years) + 3 or not cells[-1].isdigit():
                continue
            cell = cells[1 + years.index(year)]
            if cell.lower() == "see note":
                continue
            every = cell.lower() == "all on time offered"
            out.append(Offer(school=cells[0], raw_value="" if every else cell,
                             all_offered=True if every else None,
                             criterion="All on time offered" if every else None, page=number))
    if years is None:
        raise ValueError(f"no '{TITLE}' table")
    return out
