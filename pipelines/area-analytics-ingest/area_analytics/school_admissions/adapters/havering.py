"""Havering (311): '(Primary) Admissions Details for September <year> (Initial Allocations as of
<offer day>)' PDFs, one wide table per page, one row per school.

Columns: places available, total preferences expressed (1-6: every preference naming the
school), total places offered, offers per criterion, and last 'Furthest Distance Taken at Initial
Allocation in KM's (Straight line distance)'. 'N/A' (and '-' in 2020) is printed where no place
went on distance; it is kept as printed. Starred secondary distances (Campion, Coopers' Company &
Coborn) are measured under a different rule that a footnote explains; the footnote becomes the
row's criterion. Rotated headers come out reversed, so columns are found by their words.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, parse_count, pdf_tables
from ._pdf_grid import check_year, header_col

TITLE = re.compile(r"Admissions Details for September (\d{4})", re.I)
FOOTNOTE = re.compile(r"(?:^|\s)(\*{1,2}) ?([A-Z][^*]+?)(?=\s\*{1,2} ?[A-Z]|\s\^|\sNB\b|$)")


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        text = check_year(path, TITLE, doc["year"])
        out += parse_tables(pdf_tables(path), footnotes(text))
    return out


def footnotes(text: str) -> dict[str, str]:
    """{'*': 'Campion - This is the furthest distance ...'} from the document's footnotes."""
    return {mark: clean(note) for mark, note in FOOTNOTE.findall(text)}


def parse_tables(tables: list[tuple[int, list[list[str]]]], notes: dict[str, str]) -> list[Offer]:
    out = []
    for page, rows in tables:
        header = rows[0]
        distance = header_col(header, "furthest")
        applicants = header_col(header, "expressed")
        offers = header_col(header, "number", "offered")
        if None in (distance, applicants, offers):
            raise ValueError(f"page {page}: columns not found in {header}")
        for row in rows[1:]:
            name = re.sub(r"' s\b", "'s", clean(row[0])).rstrip(" *")  # extraction artefacts
            if not name or name.lower() == "totals" or parse_count(row[applicants]) is None:
                continue
            raw = clean(row[distance])
            mark = re.search(r"(\*+)$", raw)
            out.append(Offer(school=name, raw_value=raw.rstrip("* "), criterion=notes.get(mark[1]) if mark else None,
                             applicants=parse_count(row[applicants]), offers=parse_count(row[offers]),
                             page=page))
    return out
