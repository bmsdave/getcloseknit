"""Merton (315): 'School admissions and appeals data for recent years', one rolling PDF covering
secondary transfer and reception for 2021-2026 (read as text, pdftotext -layout), and the old
'How school places were allocated in recent years' web page (Wayback) for 2019 and 2020.

PDF: sections 'Transfer to secondary school' and 'Reception allocations', each with tables 'How
places were allocated for September <year>': school (short name, wrapping onto the next line),
places, on-time applications, offers per criterion, then the furthest distance (metres) at
offer day, after the second round and on 1 September. The offer-day column is read by its
position under the first 'Furthest' heading of the page, joining the lines a row wraps over.
'All on time offered' / 'All applicants offered' span the three columns. Academies and church
schools print 'Please contact school for further information' and give no row.
Admissions-priority-area schools (Dundonald, Wimbledon Chase, Wimbledon Park) print qualified
cells ('All APA offered 381.08 outside APA', '334.83 (APA)'): the whole cell becomes the
criterion and its one figure the distance; a cell with no figure is kept as printed.
"""
from __future__ import annotations

import re

from ..parsers import Offer, _Tables, clean, pdf_pages

YEAR = re.compile(r"How places were allocated for September (\d{4})")
SECTION = {"Transfer to secondary school": "secondary", "Reception allocations": "primary"}
ROW = re.compile(r"^(?P<name>\S.*?)\s{2,}(?P<places>\d+)\s+(?P<apps>\d+)\s{2,}")
HEADER_WORDS = re.compile(r"^(?:distance|second|round|\(m\)|time|apps|rec'd|places|on|CPLA|Soc|\d+/\d+/\d+|"
                          r"No\.|School|Furthest|EHCP|Med/|CLA/|Sibs?|Staff|\s)+$")
ALL = re.compile(r"All (?:on time|applicants) offered", re.I)
NUMBER = re.compile(r"\d+(?:\.\d+)?")


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        if path.endswith(".html"):
            out += parse_html(path, doc)
        else:
            out += parse_pdf(pdf_pages(path), doc["phase"], int(doc["year"]))
    if not out:
        raise ValueError(f"no {doc['phase']} table for {doc['year']} in {files}")
    return out


def parse_pdf(pages: list[str], phase: str, year: int) -> list[Offer]:
    groups, section, current, span, header = [], None, None, None, False
    for number, page in enumerate(pages, start=1):
        for line in page.splitlines():
            text = clean(line)
            if not text:
                continue
            if text in SECTION:
                section, current = SECTION[text], None
                continue
            if text.startswith(("Appeals", "Reception appeals")):
                section = None
            if found := YEAR.match(text):
                current, header = int(found[1]), False
                continue
            if section != phase or current != year:
                continue
            if "Furthest" in line:
                first = line.index("Furthest")
                span, header = (first - 2, line.index("Furthest", first + 8) - 1), True
                continue
            if row := ROW.match(line):
                header = False
                groups.append({"name": [clean(row["name"])], "lines": [(line, span)], "page": number,
                               "apps": int(row["apps"])})
                continue
            if header and HEADER_WORDS.match(text):
                continue
            if groups:
                groups[-1]["lines"].append((line, span))
                if not line[:1].isspace() and not header:
                    groups[-1]["name"].append(clean(re.split(r"\s{2,}", line.strip())[0]))
    return [offer for group in groups if (offer := _offer(group))]


def _offer(group: dict) -> Offer | None:
    whole = " ".join(clean(line) for line, _ in group["lines"])
    if "contact school" in whole.lower():
        return None
    name = " ".join(group["name"])
    if all_offered := ALL.search(whole):
        return Offer(school=name, raw_value=all_offered[0], applicants=group["apps"], page=group["page"])
    cell = clean(" ".join(line[a:b] for line, (a, b) in group["lines"]))
    criterion = None
    if "APA" in cell:
        numbers = NUMBER.findall(cell)
        cell = clean(re.sub(r"\bdistance\b", "", cell))  # a heading word from a page break
        criterion, cell = cell, (numbers[0] if len(numbers) == 1 else cell)
    return Offer(school=name, raw_value=cell, criterion=criterion, applicants=group["apps"], page=group["page"])


HTML_SECTION = {"secondary": ("Transfer to secondary school", "Reception allocations"),
                "primary": ("Reception allocations", "Appeals")}
OFFER_DAY = re.compile(r"(?:furthest )?distance (\d{1,2})/(\d{1,2})/(\d{2})", re.I)


def parse_html(path: str, doc: dict) -> list[Offer]:
    """The web page: per phase, one table per year (newest first); the year is the offer-day
    date in the first distance heading ('furthest distance 16/4/20 (m)'). Cells are not aligned
    (colspans), so the value is the first non-empty cell after the sibling/staff columns."""
    with open(path, encoding="utf-8", errors="replace") as handle:
        text = handle.read()
    start, end = HTML_SECTION[doc["phase"]]
    part = text[text.index(f">{start}"):]
    part = part[:part.index(f">{end}")] if f">{end}" in part else part
    reader = _Tables()
    reader.feed(part)
    out = []
    for rows in reader.tables:
        header = [clean(c.replace("\u200b", "")) for c in rows[0]]
        day = next((OFFER_DAY.search(c) for c in header[8:] if OFFER_DAY.search(c)), None)
        if not day or 2000 + int(day[3]) != int(doc["year"]):
            continue
        for row in rows[1:]:
            cells = [clean(c.replace("\u200b", "")) for c in row]
            values = [c for c in cells[8:] if c]
            if not cells[0] or not values:
                continue  # 'contact the school': no figures
            numbers = NUMBER.findall(values[0])
            criterion = values[0] if "APA" in values[0] else None
            raw = numbers[0] if criterion and len(numbers) == 1 else values[0]
            out.append(Offer(school=cells[0], raw_value=raw, criterion=criterion,
                             applicants=int(cells[2]) if cells[2].isdigit() else None))
    return out
