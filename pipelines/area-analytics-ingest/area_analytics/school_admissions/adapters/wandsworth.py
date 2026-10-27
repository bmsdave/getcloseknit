"""Wandsworth (212): 'How places were offered at each Wandsworth school' PDFs.

Primary: an upper-case school heading, then either 'All applicants offered a place ...' or a
small table whose data row starts with the admission number and ends with the furthest distance
offered under the proximity criterion ('429m'); a few schools print a row per class
('Bilingual' / 'English'), and older files wrap the last cell as '(up to a distance of 636m from
the school)'. A table whose last column is not a distance (faith criteria only) gives no row.

Secondary: a heading '<SCHOOL> (DFE no 212 nnnn)', then 'All applicants offered', band rows
('A ... 38 (2659m)'), feeder-school rows ('Belleville   42 (805m)') or sentences 'Other
children ...: 85 (up to a distance of 525 metres from the school)'. The distance tie-break inside
a selective (ability) score is not a last-offer distance and is not read.

The first page's year must be the configured year (2020 and 2022 share an address).
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, pdf_pages

YEAR = {"primary": re.compile(r"ADMISSIONS (\d{4})"), "secondary": re.compile(r"SECONDARY SCHOOL (\d{4})")}
ALL_OFFERED = re.compile(r"^All (?:applicants )?offered\b", re.I)
HEADING = re.compile(r"^[A-Z][A-Z'’ .&()/,-]{5,}$")
NOT_HEADING = re.compile(r"^(?:HOW PLACES|CONTINUED|PRIMARY SCHOOL \(|TRANSFER TO)")
DISTANCE = re.compile(r"^(\d[\d,]*)\s?m+$")  # '429m'; one table prints '491mm'
WRAPPED = re.compile(r"distance (?:of|from) (\d[\d,]*)\s?(?:m|metres)\b", re.I)
SECONDARY_HEAD = re.compile(r"^(?P<name>.+?)\s*\(DFE no\b", re.I)
BAND = re.compile(r"^(?P<band>[A-E])\s{2,}.*\s(?:\d+|<5)\s*\((?P<value>\d[\d,]*\s?m|all offered)\)$", re.I)
FEEDER = re.compile(r"^(?P<feeder>[A-Z][\w'’ –-]+?)\s{2,}(?:\d+|<5)\s*\((?P<value>\d[\d,]*\s?m|all offered)\)$")
SENTENCE = re.compile(r"^(?P<label>[^:]+):\s*(?:\d+|<5)\s*\(up to a distance (?:of|from) (?P<metres>\d[\d,]*) metres")


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        pages = pdf_pages(path)
        found = YEAR[doc["phase"]].search(pages[0])
        if not found or int(found.group(1)) != int(doc["year"]):
            raise ValueError(f"first page says {found and found.group(1)}, configured {doc['year']}: {path}")
        out += (parse_primary if doc["phase"] == "primary" else parse_secondary)(pages)
    return out


def _cells(line: str) -> list[str]:
    return [cell for cell in re.split(r"\s{2,}", line.strip()) if cell]


def parse_primary(pages: list[str]) -> list[Offer]:
    blocks = []  # (school, page, [lines])
    for number, page in enumerate(pages, start=1):
        for line in page.splitlines():
            text = clean(line).replace("’", "'")
            if HEADING.match(text) and not NOT_HEADING.match(text):
                blocks.append((text, number, []))
            elif blocks and text:
                blocks[-1][2].append(line)
    out = []
    for school, page, lines in blocks:
        if any(ALL_OFFERED.match(clean(line)) for line in lines):
            out.append(Offer(school=school, raw_value="All applicants offered", page=page))
            continue
        rows = []
        for i, line in enumerate(lines):
            cells = _cells(line)
            first_row = re.match(r"^\d+\**$", cells[0]) and len(cells) >= 3
            class_row = rows and len(cells) >= 3 and re.match(r"^[A-Za-z]+$", cells[0])
            if not (first_row or class_row):
                continue
            label = next((c for c in cells[1:2] + cells[:1] if re.match(r"^[A-Z][a-z]+$", c)), None)
            last = cells[-1]
            if DISTANCE.match(last):
                raw = re.sub(r"m+$", "m", last)
            elif last.endswith("(up to a"):
                tail = " ".join(clean(more) for more in lines[i + 1:i + 5])
                wrapped = WRAPPED.search("(up to a " + tail)
                raw = f"up to a distance of {wrapped.group(1)}m" if wrapped else last
            elif clean(last).upper() == "N/A":
                raw = "N/A"
            else:
                continue  # last column is a count: no distance criterion
            rows.append((label, raw))
        for label, raw in rows:
            out.append(Offer(school=school, raw_value=raw, rule=label if len(rows) > 1 else None, page=page))
    return out


def parse_secondary(pages: list[str]) -> list[Offer]:
    out, school = [], None
    for number, page in enumerate(pages, start=1):
        for line in page.splitlines():
            text = clean(line).replace("’", "'")
            if head := SECONDARY_HEAD.match(text):
                school = clean(head["name"])
            elif not school or not text:
                continue
            elif ALL_OFFERED.match(text):
                out.append(Offer(school=school, raw_value="All applicants offered", page=number))
            elif band := BAND.match(line.strip()):
                out.append(Offer(school=school, raw_value=band["value"], rule=f"Band {band['band']}",
                                 criterion="distance", page=number))
            elif feeder := FEEDER.match(line.strip().replace("’", "'")):
                out.append(Offer(school=school, raw_value=feeder["value"],
                                 rule=f"Feeder {clean(feeder['feeder'])}", criterion="feeder school", page=number))
            elif sentence := SENTENCE.match(text):
                label = clean(sentence["label"])
                general = label.lower().startswith("other children")
                out.append(Offer(school=school, raw_value=f"{sentence['metres']} metres",
                                 rule=None if general else label, criterion=label, page=number))
    return out
