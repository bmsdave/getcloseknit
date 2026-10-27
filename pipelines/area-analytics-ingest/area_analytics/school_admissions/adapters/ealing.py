"""Ealing (307): 'Applications and offers for each ... school on National Offer Day' PDFs.

Community schools come first, one row per school: applicants, offered, refused and the
straight-line distance of the last place offered (to 2022 'All applicants offered' spans the
count columns). Academies, foundation and VA schools follow, each either '<School>: All
applicants offered' or a heading followed by one row per criterion group ('Criteria 5
(distance)', 'No supplementary information form') or a bare 'All applicants offered' line.
The page title's offer day must be in the configured year: the archive serves the 2024 file
under the 2023 address.

High schools (parse_secondary): a heading ('Ada Lovelace CE High School:', or centred without the
colon to 2021), then one row per admission criterion with applicants, offered, refused and the
distance of the last place ('0.637 of a mile', 'N/A - all offered', 'N/A - all refused', 'N/A -
aptitude score'); Twyford groups its criteria under band headings ('Foundation Band'). Each
criterion is a rule ('Distance', 'Foundation Band: 20 points with a sibling'); a wrapped
criterion ('after') is joined back. A table printed without its school's heading is not read.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, parse_count, pdf_pages

COUNTS = r"(?P<applicants>N/A|\d+)\s+(?P<offers>N/A|\d+)\s+(?P<refused>N/A|\d+)"
ROW = re.compile(r"^\s*(?P<name>\S.*?)\s{2,}" + COUNTS + r"\s+(?P<value>\S.*)$")
ALL_ROW = re.compile(r"^\s*(?P<name>\S.*?)\s{2,}All applicants offered\s{2,}(?P<value>\S.*)$", re.I)
NAMED_ALL = re.compile(r"^\s*(?P<name>\S.*?):\s*All applicants offered\s*$", re.I)
BARE_ALL = re.compile(r"^\s*All applicants offered\s*$", re.I)
NOT_A_SCHOOL = re.compile(r"^(?:Criteria\b(?!\s*\d)|School\b|Number\b|applicants\b|place offered|last\b|"
                          r"\(tie-breaker\)|Straight line|Places allocated|Applications and offers|"
                          r"Community Schools|Academies, Foundation)", re.I)
OFFER_DAY = re.compile(r"National Offer Day \(\d{1,2} \w+ (\d{4})\)")


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        pages = pdf_pages(path)
        years = set(OFFER_DAY.findall(" ".join(pages)))
        if years != {str(doc["year"])}:
            raise ValueError(f"offer day year {sorted(years)} in {path}, configured {doc['year']}")
        out += parse_secondary(pages) if doc.get("phase") == "secondary" else parse_text(pages)
    return out


def parse_text(pages: list[str]) -> list[Offer]:
    out, school = [], None
    for number, page in enumerate(pages, start=1):
        for line in page.splitlines():
            text = clean(line)
            if not text:
                continue
            if text.lower().startswith(("community schools", "academies, foundation")):
                school = None
            elif (row := ROW.match(line)) and school:
                out.append(_offer(row, school, clean(row["name"]), number))
            elif row:
                out.append(_offer(row, row["name"], None, number))
            elif all_row := ALL_ROW.match(line):
                out.append(Offer(school=clean(all_row["name"]), raw_value=clean(all_row["value"]), page=number))
            elif named := NAMED_ALL.match(line):
                out.append(Offer(school=clean(named["name"]), raw_value="All applicants offered", page=number))
                school = None
            elif BARE_ALL.match(line) and school:
                out.append(Offer(school=school, raw_value="All applicants offered", page=number))
            elif not NOT_A_SCHOOL.match(text):
                school = text  # a school heading; its criterion rows follow
    return out


def _offer(row: re.Match, school: str, criterion: str | None, page: int) -> Offer:
    return Offer(school=clean(school), raw_value=clean(row["value"]), criterion=criterion, rule=criterion,
                 applicants=parse_count(row["applicants"]), offers=parse_count(row["offers"]),
                 refused=parse_count(row["refused"]), page=page)


SECONDARY_ROW = re.compile(r"^\s*(?P<crit>\S.*?)\s{2,}(?P<applicants>\d+)\s+(?P<offers>\d+)\s+"
                           r"(?:(?P<refused>\d+)\s+)?"
                           r"(?P<value>\S.*)$")
SKIP = re.compile(r"HIGH SCHOOL ALLOCATIONS|Please see below|Ealing Borough on National|Places allocated to|"
                  r"Number of|^Criteria\b|^\*", re.I)
BAND = re.compile(r"^[A-Z][\w ]*[Bb]and(?::[\w ]*)?$")  # 'Music Band', 'Foundation band: 21 Points'


def parse_secondary(pages: list[str]) -> list[Offer]:
    out, school, band = [], None, None
    for number, page in enumerate(pages, start=1):
        for line in page.splitlines():
            text = clean(line)
            indent = len(line) - len(line.lstrip())
            if not text or SKIP.search(text):
                continue
            if named := NAMED_ALL.match(line):
                out.append(Offer(school=clean(named["name"]), raw_value="All applicants offered", page=number))
                school = None
            elif BARE_ALL.match(line) and school:
                out.append(Offer(school=school, raw_value="All applicants offered", page=number))
            elif row := SECONDARY_ROW.match(line):
                if not school:
                    continue  # a table printed without its school's name
                label = re.sub(r"^\d+\s+(?!points)", "", clean(row["crit"]))  # '3 Distance'; not '21 points'

                out.append(Offer(school=school, raw_value=clean(row["value"]), criterion=clean(row["crit"]),
                                 rule=f"{band}: {label}" if band else label,
                                 applicants=int(row["applicants"]), offers=int(row["offers"]),
                                 refused=int(row["refused"]) if row["refused"] else None, page=number))
            elif BAND.match(text):
                band = text
            elif text.endswith(":"):
                school, band = text[:-1], None
            elif indent <= 6 and text[0].islower() and not re.search(r"\d", text) and out and out[-1].rule:
                out[-1].criterion += " " + text  # a criterion wrapped onto the next line
                out[-1].rule += " " + text
            elif indent >= 20 and not re.search(r"\d", text) and text[0].isupper():
                school, band = text, None  # centred heading (2021-2022)
    return out
