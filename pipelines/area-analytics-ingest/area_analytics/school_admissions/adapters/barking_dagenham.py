"""Barking and Dagenham (301): the 'Statistical information' table in the annual e-booklets.

One row per school (pdftotext -raw keeps each row on one line): the name, then numbers or '-' /
'N/A'. Primary columns: on-time applications, admission number, EHCP, LAC, sibling, distance,
last place (km), appeals received, appeals allowed; appeals sometimes wrap to the next line.
Secondary columns: applications, admission number, EHC plan, LAC, Year 6 moving up, faith or
sibling, distance, last place (km), appeals received, appeals allowed. A split-site school prints
'Manor – Longbridge'. Only a decimal is a last-place distance: '-', 'N/A' and a bare '0' are not
(the booklet does not say what they mean). VA schools print 'Criteria do not apply'.

The text above the table must name the configured September; two copies of one booklet must hold
the same table.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, pdf_text

LAST_PLACE = {"primary": 6, "secondary": 7}
SEPTEMBER = re.compile(r"(?:Dagenham|secondary-phase) schools in September (\d{4})")
ROW = re.compile(r"^(?P<name>[A-Z].*?)\s+(?P<cells>(?:(?:\d[\d.]*\*?|-|N/A)\s+)*(?:\d[\d.]*|-|N/A))(?:-?\d*)?$")
NO_CRITERIA = re.compile(r"^(?P<name>.+?)\s+(?P<apps>\d+)\s+\d+\s.*Criteria do not apply")
SECTION = re.compile(r"^(?:Community schools|Own admission authority schools)$")


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    tables = []
    for path in files:
        text = pdf_text(path, raw=True)
        septembers = set(SEPTEMBER.findall(" ".join(text.split())))
        if septembers != {str(doc["year"])}:
            raise ValueError(f"table is for September {sorted(septembers)} in {path}, configured {doc['year']}")
        tables.append(parse_table(text, doc["phase"]))
    for other in tables[1:]:
        if other != tables[0]:
            raise ValueError("two copies of the booklet print different tables")
    # A short name that means another school in the other phase ('Eastbury' in the secondary
    # table is Eastbury Community School, not Eastbury Primary): config <phase>_names.
    names = config.get(f"{doc['phase']}_names") or {}
    for offer in tables[0]:
        offer.school = names.get(offer.school, offer.school)
    return tables[0]


def _site(name: str) -> tuple[str, str]:
    name = clean(re.sub(r"\*|pleaseseenextpage|`", "", name))
    name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)  # 'DagenhamPark'
    if " - " in name:
        school, site = name.split(" - ", 1)
        return school, re.sub(r"\s*Infants only$", "", site)
    return name, "main"


def parse_table(text: str, phase: str) -> list[Offer]:
    lines = text.splitlines()
    try:
        start = next(i for i, line in enumerate(lines) if SECTION.match(line.strip()))
    except StopIteration:
        raise ValueError("no 'Community schools' table") from None
    out = []
    for line in lines[start + 1:]:
        line = clean(line)
        if SECTION.match(line):
            continue
        if not line or line.startswith(("Notes", "Starting school", "Information for parents")):
            break
        if row := NO_CRITERIA.match(line):
            school, site = _site(row["name"])
            out.append(Offer(school=school, site=site, raw_value="", applicants=int(row["apps"]),
                             criterion="Criteria do not apply - contact the school"))
            continue
        row = ROW.match(line)
        if not row:
            continue  # wrapped appeal counts
        cells = row["cells"].split()
        school, site = _site(row["name"])
        index = LAST_PLACE[phase]
        last = cells[index] if len(cells) > index else ""
        raw = last if re.match(r"^\d*\.\d+$", last) else ("" if last == "0" else last)
        out.append(Offer(school=school, site=site, raw_value=raw,
                         applicants=int(cells[0]) if cells[0].isdigit() else None))
    if not out:
        raise ValueError("no rows in the statistics table")
    return out
