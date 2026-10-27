"""Sutton (319): the 'Primary / Secondary school allocation information' web pages, one table each:
School, DfE number, PAN and 'Furthest Distance (Metres)'. The council overwrites the page every
year, so earlier years come from Wayback copies.

'All' in the distance column is read as all applicants offered (no distance limit), 'N/A' as no
distance (selective and faith schools). Cheam High School prints a second figure for its
'Worcester Park Places' in the same cell ('1,492 678'): the second figure is a row of its own
with that rule. Year checks: the primary page names the closing date of applications ('15
January 2026' for September 2026); the secondary page names no year, so a Wayback copy must have
been captured in the configured year (between offer day and the next September).
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, html_tables

CLOSING = re.compile(r"closing date of \d{1,2} January (\d{4})")
SNAPSHOT = re.compile(r"web\.archive\.org/web/(\d{4})(\d{2})")
SECOND_SITE = re.compile(r"^(?P<school>.+?)\s+(?P<rule>Worcester Park Places)$", re.I)


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        with open(path, encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        year = int(doc["year"])
        if doc["phase"] == "primary":
            found = {int(y) for y in CLOSING.findall(text)}
            if found != {year}:
                raise ValueError(f"{path}: closing-date years {sorted(found)}, configured {year}")
        elif snap := SNAPSHOT.search(doc["url"]):
            if int(snap[1]) != year or int(snap[2]) < 3:
                raise ValueError(f"{path}: captured {snap[1]}-{snap[2]}, configured {year}")
        out += parse_tables(html_tables(path))
    return out


def parse_tables(tables: list[list[list[str]]]) -> list[Offer]:
    out = []
    for rows in tables:
        if not rows or "Furthest Distance" not in " ".join(rows[0]):
            continue
        for row in rows[1:]:
            if len(row) < 4:
                continue
            name, cell = re.sub(r"\s*\((?:Foundation|Voluntary-aided|Academy|Community|Free school)\)$", "",
                                clean(row[0]), flags=re.I), clean(row[3])  # the governance label
            figures = re.findall(r"\d{1,3}(?:,\d{3})+|\d+", cell)
            split = SECOND_SITE.match(name)
            if split and len(figures) == 2:
                out.append(Offer(school=split["school"], raw_value=figures[0]))
                out.append(Offer(school=split["school"], raw_value=figures[1], rule=split["rule"]))
            else:
                out.append(Offer(school=name, raw_value=cell))
    return out
