"""Southwark (210): 'Breakdown of reception places allocated at Southwark community schools for
September <year>', a table inside the next year's 'Starting primary school' brochure.

One row per community school: PAN (a '*' marks an ASD base), applications for preferences 1-6,
children admitted outside their age group, then either 'all offered' ('All applicants offered a
place' from 2026) across the criterion columns, or offers by criterion, 'Distance', 'Furthest
distance (metres) offered a school place', appeals heard and successful appeals. The furthest
distance is the third number from the end. Only the table for the configured September is read;
brochures cut off by the archive (1 MB captures) have no readable text and are reported unread.
The table is alphabetical, and reading stops at a row out of order: the 2024 table is followed by
six stale rows (Rye Oak to Victory, with Townsend, closed in 2023). A row printed twice is read once.
"""
from __future__ import annotations

import re
import subprocess

from ..parsers import Offer, clean, parse_count, pdf_text

TITLE = re.compile(r"Breakdown of reception places allocated at\s+Southwark\s+community schools for\s+"
                   r"September (\d{4})", re.I)
ROW = re.compile(r"^\s*(?P<name>[A-Z][A-Za-z'’&. ]*?[a-z])\s{2,}(?P<pan>\d+)\*?\s+(?P<apps>\d+)\s+(?P<outside>\d+)\s+"
                 r"(?P<rest>\S.*)$")
ALL = re.compile(r"all offered|all applicants offered a place", re.I)


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out, unread = [], []
    for path in files:
        try:
            text = pdf_text(path)
        except subprocess.CalledProcessError as error:  # a truncated capture: pdftotext fails
            unread.append(f"{path}: unreadable PDF ({error.__class__.__name__})")
            continue
        for offer in table(text, doc["year"]):
            if offer not in out:  # a row repeated where the table runs onto the next page
                out.append(offer)
    if not out:
        raise ValueError(f"no community-school table for September {doc['year']} found; " + "; ".join(unread))
    return out


def table(text: str, year: int) -> list[Offer]:
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if (m := TITLE.search(" ".join(lines[i:i + 3])))
              and int(m[1]) == year and "Breakdown" in line]
    if not starts:
        return []
    out = []
    for line in lines[starts[-1]:starts[-1] + 80]:
        row = ROW.match(line)
        if not row:
            if out and line.strip().startswith(("SEN", "LAC")):
                break
            continue
        if out and clean(row["name"]).lower() < out[-1].school.lower():
            break  # the table is alphabetical: the 2024 brochure repeats six rows of an older table after it
        rest = clean(row["rest"])
        found = ALL.search(rest)
        tokens = rest.split()
        value = found[0] if found else (tokens[-3] if len(tokens) >= 3 else rest)
        out.append(Offer(school=clean(row["name"]), raw_value=value, applicants=parse_count(row["apps"]),
                         all_offered=True if found else None))
    return out
