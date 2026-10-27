"""Enfield (308): 'breakdown of allocations' PDFs, one section per September (up to four years).

Primary ('Admission to Reception Classes - September YYYY'): oversubscribed community schools,
academies and free schools, one row each: total applications, admission number, EHCP, LAC /
medical, siblings, employed at the school, priority zone, distance, furthest distance (miles),
refusals; an empty cell prints nothing, so the furthest distance is read second from the end.
A long name wraps onto the line above. Every school in the paragraph 'It has been
possible to meet the demand for places from on time applicants at the following schools: ...'
offered every on-time applicant (all offered, no raw value).

Secondary ('Enfield Schools YYYY'): name, type, PAN, then either 'Places have been offered to all
applicants.' or EHCP/LAC/medical, siblings, parent employed, distance, max distance offered
(miles), refusals. Names wrap above and below the row and carry footnote digits. Prose rows
(quota, test rank, faith criteria) are not read.

Only the configured year's section is read; it must be in the file.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, parse_count, pdf_pages

PRIMARY = re.compile(r"Reception(?: Classes)? [-–] September (\d{4})")
SECONDARY = re.compile(r"^\s*Enfield Schools (\d{4})\s*$")
VALUE = r"(?:\d[\d,]*(?:\.\d+)?|N/A|–|-)"
PRIMARY_ROW = re.compile(rf"^(?P<name>\D*?)\s*(?P<cells>(?:{VALUE}\s+){{7,10}}{VALUE})$")  # empty cells print nothing
TYPE = r"Academy|Community|Voluntary Aided|Foundation|Free School"
SECONDARY_ROW = re.compile(rf"^(?:(?P<name>.*?)\s{{2,}})?(?P<type>{TYPE})\s+(?P<pan>\d+)\s*(?P<rest>.*)$")
SECONDARY_CELLS = re.compile(rf"^(?:{VALUE}\s+){{5}}{VALUE}$")  # after the PAN
DEMAND_MET = "It has been possible to meet the demand for places"


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        lines = [(n, line) for n, page in enumerate(pdf_pages(path), start=1) for line in page.splitlines()]
        section = _section(lines, int(doc["year"]), doc["phase"])
        out += (parse_primary if doc["phase"] == "primary" else parse_secondary)(section)
    # A school that later merged into another keeps its own rows as a site of the current
    # school (config sites: printed name -> site label); 'Bowes - Wilmer Way' is a site too.
    sites = config.get("sites") or {}
    for offer in out:
        if offer.school in sites:
            offer.site = sites[offer.school]
        elif " - " in offer.school:
            offer.school, offer.site = offer.school.split(" - ", 1)
    return out


def _section(lines, year, phase):
    """The lines from the configured year's heading to the next year's heading."""
    heading = PRIMARY if phase == "primary" else SECONDARY
    starts = [(i, int(m.group(1))) for i, (_, line) in enumerate(lines) if (m := heading.search(line))]
    mine = [i for i, y in starts if y == year]
    if not mine:
        raise ValueError(f"no section for {year} (found {sorted({y for _, y in starts})})")
    after = [i for i, _ in starts if i > mine[0]]
    return lines[mine[0]:after[0] if after else len(lines)]


def _text_only(line: str) -> str:
    text = clean(line)
    return "" if not text or re.search(r"\d{2}|\.", text) or text.isupper() else text


def parse_primary(section) -> list[Offer]:
    out, paragraph = [], None
    for i, (number, line) in enumerate(section):
        text = clean(line)
        if DEMAND_MET in text:
            paragraph = []
        if paragraph is not None:
            paragraph.append(text)
            if text.endswith("."):  # the list ends with 'and <school>.'
                out += _demand_met(" ".join(paragraph), number)
                paragraph = None
            continue
        row = PRIMARY_ROW.match(text)
        if not row:
            continue
        cells = row["cells"].split()
        name = clean(row["name"])
        above = _text_only(section[i - 1][1]) if i else ""
        if above:
            name = clean(f"{above} {name}")
        out.append(Offer(school=name, raw_value=cells[-2], applicants=parse_count(cells[0]),
                         refused=parse_count(cells[-1]), page=number))
    return out


def _demand_met(text: str, page: int) -> list[Offer]:
    names = text.split("following schools:", 1)[-1].rstrip(".")
    parts = re.split(r",\s*|\s+and\s+(?=[A-Z][^,]*$)", names)
    return [Offer(school=clean(part), raw_value="", all_offered=True, criterion="demand met (all on-time applicants)",
                  page=page) for part in parts if clean(part)]


def _fragment(section, i: int) -> str:
    """A name fragment on line i (left column, no figures), or ''."""
    if not 0 <= i < len(section) or SECONDARY_ROW.match(section[i][1].strip()):
        return ""
    fragment = clean(re.sub(r"\d+$", "", clean(section[i][1][:30])))
    return "" if re.search(r"\d", fragment) else fragment


def parse_secondary(section) -> list[Offer]:
    out = []
    for i, (number, line) in enumerate(section):
        row = SECONDARY_ROW.match(line.strip())
        if not row:
            continue
        name = clean(re.sub(r"\d+$", "", clean(row["name"] or "")))
        if not name:  # the name is printed around the row: above, and maybe below
            name = _fragment(section, i - 1)
            below = _fragment(section, i + 1)
            next_row = SECONDARY_ROW.match(section[i + 2][1].strip()) if i + 2 < len(section) else None
            if below and not (next_row and not clean(next_row["name"] or "")):
                name = clean(f"{name} {below}")
        rest = clean(row["rest"])
        if rest.startswith("Places have been offered to all applicants"):
            out.append(Offer(school=name, raw_value="", all_offered=True,
                             criterion="Places have been offered to all applicants", page=number))
        elif SECONDARY_CELLS.match(rest):
            cells = rest.split()
            out.append(Offer(school=name, raw_value=cells[4], refused=parse_count(cells[5]), page=number))
    return out
