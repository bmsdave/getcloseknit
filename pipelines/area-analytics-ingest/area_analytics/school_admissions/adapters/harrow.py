"""Harrow (310): 'How places were allocated at Harrow Primary/Secondary Schools for September
<year> on <offer day>' PDFs, one table per document, one row per school.

Primary: school, places, applications received (every preference naming the school), offers per
criterion, the furthest distance offered in miles where distance was the tie-breaker, offers as
the nearest school with a vacancy, total offered. The distance is always third from the end (the
rotated headers of 2020-2022 come out garbled). Secondary: school, applications, places, offers
per criterion and the furthest distance in miles, found by its header (2019 adds a nearest-school
column after it); there is no total. Faith schools leave the criteria columns blank ('Please
contact the schools directly'), so their distance cell is empty. 'N/A' is printed as is: the
document does not say why. The title's September year must be the configured year.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, parse_count, pdf_tables
from ._pdf_grid import check_year, header_col

TITLE = {"primary": re.compile(r"Harrow Primary Schools for September (\d{4})", re.I),
         "secondary": re.compile(r"Harrow Secondary Schools for September (\d{4})", re.I)}


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        check_year(path, TITLE[doc["phase"]], doc["year"])
        out += parse_tables(pdf_tables(path), doc["phase"])
    return out


def parse_tables(tables: list[tuple[int, list[list[str]]]], phase: str) -> list[Offer]:
    out = []
    for page, rows in tables:
        header = rows[0]
        if phase == "primary":
            distance, applicants, total = len(header) - 3, 2, len(header) - 1
        else:
            distance, applicants, total = header_col(header, "furthest"), 1, None
            if distance is None:
                raise ValueError(f"page {page}: no 'furthest distance' column")
        for row in rows[1:]:
            name = clean(row[0])
            if not name or parse_count(row[applicants]) is None:
                continue
            out.append(Offer(school=name, raw_value=clean(row[distance]),
                             applicants=parse_count(row[applicants]),
                             offers=parse_count(row[total]) if total is not None else None, page=page))
    return out
