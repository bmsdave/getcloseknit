"""Newham (316): 'Reception Class - September <year>' and 'Primary to Secondary School Transition
- September <year>' application and offer statistics PDFs (read as text, pdftotext -layout).

Of the many tables, only the 'Criterion Breakdown of On Time Offers' rows are read: they end
with the total offered, the 'Criterion of Final Offer', the 'Distance of Final Offer (miles)'
and the tie-break procedure ('Shortest Walking Distance in Miles', or for a few academies
'Straight Line Distance in Miles/Kilometres'). Where the tie-break is in kilometres the figure is
kept with ' km' so it is not read as miles; where it is straight-line the tie-break joins the
criterion (the document's method is walking). Rows start with the DfE number and URN (from
2022) and the name; only the total offered is taken, since the columns before it change from
table to table (voluntary-aided schools have their own). 'N/A' (no final-offer distance) and
'TBC' are kept as printed. A second site ('... - Kirton Road Site') is a site of its school.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, parse_count, pdf_pages

TITLE = re.compile(r"(?:Reception Class|School Transition|Year 7 Class|Transition)\s*(?:-|for)?\s*September (\d{4})", re.I)
SITE = re.compile(r"^(?P<school>.+?) - (?P<site>.+?) Site$")
TIE = re.compile(r"\s(?P<tie>(?:Shortest Walking|Straight Line) Distance in (?P<unit>Miles|Kilometres))\s*$", re.I)


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        pages = pdf_pages(path)
        years = {int(y) for y in TITLE.findall(clean(" ".join(pages[:2])))}
        if years != {int(doc["year"])}:
            raise ValueError(f"{path}: title years {sorted(years)}, configured {doc['year']}")
        out += parse_pages(pages)
    return out


def parse_pages(pages: list[str]) -> list[Offer]:
    out = []
    for number, page in enumerate(pages, start=1):
        for line in page.splitlines():
            tie = TIE.search(line)
            if not tie:
                continue
            cells = re.split(r"\s{2,}", line[:tie.start()].strip())
            if len(cells) < 4:
                continue
            start = 2 if re.match(r"^\d{4}$", cells[0]) and re.match(r"^\d{6}$", cells[1]) else 0
            name, figures = cells[start], cells[start + 1:-2]
            criterion, raw = clean(cells[-2]), clean(cells[-1])
            if not re.match(r"^[A-Za-z]", name) or not figures or re.match(r"^[\d.,%]+$", criterion):
                continue  # the applications table also ends with the tie-break, after two counts
            if tie["unit"].lower() == "kilometres" and re.match(r"^\d*\.?\d+$", raw):
                raw += " km"
            if tie["tie"].lower().startswith("straight"):
                criterion = f"{criterion}; tie-break: {tie['tie']}"
            name, site = clean(name), "main"
            if found := SITE.match(name):  # 'Upton Cross Primary School - Kirton Road Site'
                name, site = found["school"], re.sub(r"[^a-z0-9]+", "-", found["site"].lower())
            out.append(Offer(school=name, raw_value=raw, criterion=None if criterion == "N/A" else criterion,
                             offers=parse_count(figures[-1]), site=site, page=number))
    # A table printed twice (secondary 2020, 2021) repeats rows exactly: keep one. Rows that
    # differ (primary 2019 faith schools) stay, for the review to stop.
    seen, unique = set(), []
    for offer in out:
        key = (offer.school, offer.site, offer.raw_value, offer.criterion, offer.offers)
        if key not in seen:
            seen.add(key)
            unique.append(offer)
    return unique
