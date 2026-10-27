"""Islington (206): the cut-off distance page and older admissions booklets.

Cut-off distance page (HTML): a primary and a secondary table, 'Distances between school and home of
last child admitted', a rolling three years ('Distance (miles) in 2024-25' = 2024 entry); secondary
bands are part of the name ("Central Foundation Boys' School Band 1"). 'Not applicable' (no cut-off:
places went before distance, or every applicant was offered) gives no distance.
2020/21 primary booklet ('admission in September 2019'): one table row per school: name (may wrap
onto the next lines), type, PAN, applications, first preferences, offers, offers by criterion,
offers by distance, 'Cut off Distance (miles)' or 'Does not apply', then appeals lodged and upheld.
Brochures for 2022 admissions: per school '<School> admission(s) criteria' followed by 'Last pupil
admitted under (the) distance criterion in Sept 2021 / last year: 0.143 miles', 'Band 1: 1.298 miles
Band 2: ...', or 'Does not apply'. The school is the page title above 'Fact file': in the 2022 primary
brochure Duncombe's page carries a 'Drayton Park Primary School admissions criteria' heading.
A doc's skip_schools leaves out schools printed beside the school they later merged into (both
resolve to one URN); the reason is in the config.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, html_tables, parse_count, pdf_text

NOT_APPLICABLE = re.compile(r"^(?:Not applicable|Does not apply)$", re.I)
BAND_NAME = re.compile(r"^(?P<name>.*?)\s+(?:(?P<band>Band \d+)|\((?P<places>Open|Foundation)\))$")
TYPES = r"Community|VA|Academy|Foundation|Free School|Free"
TABLE_ROW = re.compile(rf"^\s*(?P<name>\S.*?)\s{{2,}}(?P<type>{TYPES})\s+(?P<pan>\d+)\s+(?P<apps>\d+)\s+(?P<rest>\S.*)$")
BLOCK_START = re.compile(r"^\s*(?P<name>\S.*?) admissions? criteria\s*$")
CUT_LINE = re.compile(r"^\s*(?:Last pupil admitted under|Distance of last pupil admitted under)")


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    skip = doc.get("skip_schools") or {}
    for path in files:
        if path.endswith(".html"):
            out += rolling(html_tables(path), doc["phase"], doc["year"])
        else:
            text = pdf_text(path)
            if not any(CUT_LINE.match(line) for line in text.splitlines()):  # the 2020/21 booklet table
                if f"admission in September {doc['year']}" not in clean(text):
                    raise ValueError(f"booklet table is not for September {doc['year']}")
                out += booklet_table(text)
            else:
                out += brochure(text)
    return [offer for offer in out if offer.school not in skip]


def _value(cell: str) -> str:
    cell = clean(cell)
    return "" if NOT_APPLICABLE.match(cell) else cell


def rolling(tables: list[list[list[str]]], phase: str, year: int) -> list[Offer]:
    column_name = f"distance (miles) in {year}-{(year + 1) % 100:02d}"
    tables = [t for t in tables if t and t[0] and t[0][0].lower() == "name of school"]
    if len(tables) != 2:
        raise ValueError(f"expected a primary and a secondary table, found {len(tables)}")
    rows = tables[0 if phase == "primary" else 1]
    header = [clean(c).lower() for c in rows[0]]
    if column_name not in header:
        raise ValueError(f"no column {column_name!r} (have {header[2:]})")
    column = header.index(column_name)
    out = []
    for row in rows[1:]:
        name, rule = clean(row[0]), None
        if found := BAND_NAME.match(name):
            name, rule = found["name"], found["band"] or f"{found['places']} places"
        out.append(Offer(school=name, rule=rule, raw_value=_value(row[column])))
    return out


def booklet_table(text: str) -> list[Offer]:
    out, last = [], None
    for line in text.splitlines():
        row = TABLE_ROW.match(line)
        if row:
            rest = clean(row["rest"])
            dna = re.search(r"Does not apply", rest)
            tokens = rest.split()
            last = Offer(school=clean(row["name"]), applicants=parse_count(row["apps"]),
                         raw_value="" if dna else (tokens[-3] if len(tokens) >= 3 else rest))
            out.append(last)
        elif last and (words := clean(line.replace("*", ""))) and not re.search(r"\d", words) \
                and len(line) - len(line.lstrip()) < 6 and len(words) < 30:
            last.school = f"{last.school} {words}"  # the name runs onto the next line
        else:
            last = None
    return out


def brochure(text: str) -> list[Offer]:
    lines = text.splitlines()
    out, school, title = [], None, None
    for i, line in enumerate(lines):
        if re.match(r"^\s*Fact file\s*$", line) and i:
            # the page's school (one or two lines): some criteria headings were copied from another page
            above = [clean(x) for x in lines[max(0, i - 2):i]]
            title = " ".join(x for x in above if x and not re.search(r"Section|\d$", x)) or None
        if found := BLOCK_START.match(line):
            school = title or clean(found["name"])
            continue
        if not CUT_LINE.match(line) or not (school := school or title):
            continue
        # the value column starts after the label: after a gap, else after the label's colon
        start = re.match(r"^\s*\S.*?\s{2,}(?=\S)", line) or re.match(r"^.*:\s*", line)
        parts = [line[start.end():]]
        for follow in lines[i + 1:i + 6]:
            if CUT_LINE.match(follow) or "Calculate your" in follow or not follow.strip():
                break
            parts.append(follow[start.end() - 2:])  # label words wrapped onto this line sit left of it
        value = clean(" ".join(parts))
        bands = re.findall(r"(Band \d+):\s*(\d*\.\d+)\s*miles", value)
        if bands:
            out += [Offer(school=school, rule=band, raw_value=f"{miles} miles") for band, miles in bands]
        else:
            found = re.search(r"\d*\.\d+\s*miles", value)
            nothing = not found and re.fullmatch(r"(?:(?:Band \d+:\s*)?Does not apply\s*)+", value)
            out.append(Offer(school=school, raw_value=found[0] if found else ("" if nothing else _value(value))))
        school = title = None
    return out
