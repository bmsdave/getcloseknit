"""Kingston (314), admissions run by Achieving for Children: 'How places have been allocated at
community infant and primary (and junior) schools over the last three years (Y1, Y2, Y3)' PDFs.

Each document is a rolling three-year table, so one file serves up to three configured years.
Per school and year: '<year> (<available places>)', offers per criterion, 'Distance of the last
child offered a place under criterion (v) [junior: (vi)] at offer date' (km, read), 'Furthest
distance offered from the waiting list' (not read) and appeals. 'All prefs met' means every
preference was met (all offered); 'n/a' and '-' have no distance. Junior schools admit into
year 3. Only community schools are listed (academies and faith schools publish their own).

From 2021 the three years sit stacked in one table cell each (pdfplumber); the 2019-2021
document draws a separate box per figure, so it is read from the text layout by column.
pdfplumber's default word gap (3pt) runs this document's words together ('KingAthelstan'), so
tables are read with 1.5pt.

Secondary: 'How places were allocated at Kingston borough secondary schools ... for 2026, 2025
and 2024', one row per school: PAN, then per year the cut-off distance at national offer day
(read) and the distance at the end of national coordination (not read). 'Overseas' (the last
place went to an applicant abroad) is printed as is; schools that 'CONTACT THE SCHOOL' give no
row. The 2026 file wraps 'All preferences met' over two lines, so its table is read; the 2023
file's table has no rules, so its text is split on wide gaps.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, pdf_tables, pdf_text
from ._pdf_grid import letters

YEARS = re.compile(r"over the last three years \(?(\d{4}), (\d{4}),? (?:and )?(\d{4})", re.I)
YEAR_PLACES = re.compile(r"(\d{4}) ?\( ?(\d+)\)?")
TOKEN = re.compile(r"All ?prefs ?met|\d*\.\d+ ?km\*?|n/a|-", re.I)


SECONDARY_YEARS = re.compile(r"\(NC\)(?: on 31 August)? for (\d{4}), (\d{4}) and (\d{4})")


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        text = pdf_text(path)
        if doc["phase"] == "secondary":
            years = SECONDARY_YEARS.search(clean(text))
            order = [int(y) for y in years.groups()] if years else []
            if int(doc["year"]) not in order:
                raise ValueError(f"{path}: covers {order}, configured {doc['year']}")
            out += parse_secondary(pdf_tables(path, text_x_tolerance=1.5), text, 2 + 2 * order.index(int(doc["year"])))
            continue
        covered = {int(y) for found in YEARS.findall(clean(text)) for y in found}
        if int(doc["year"]) not in covered:
            raise ValueError(f"{path}: covers {sorted(covered)}, configured {doc['year']}")
        rows = parse_tables(pdf_tables(path, text_x_tolerance=1.5), int(doc["year"]))
        out += rows if rows else parse_layout(text, int(doc["year"]))
    return out


def _raw(token: str) -> str:
    return clean(token).rstrip("*").strip()


def parse_tables(tables: list[tuple[int, list[list[str]]]], year: int) -> list[Offer]:
    """Documents from 2021: one row per school, each cell holding the three years' figures."""
    out = []
    for page, rows in tables:
        start = next((i for i, row in enumerate(rows) if len(row) > 1 and letters(row[1]).startswith("year")), None)
        if start is None:
            continue
        header = rows[start]
        junior = any("criterionvi" in letters(cell) for cell in header)
        value = next((i for i, cell in enumerate(header) if letters(cell).startswith("distanceofthelast")), None)
        if value is None:
            return []
        for row in rows[start + 1:]:
            years = [int(y) for y, _ in YEAR_PLACES.findall(row[1])]
            name = clean(row[0])
            if len(years) == 1:
                return []  # one figure per box: the 2019-2021 layout
            if not name or year not in years:
                continue
            tokens = TOKEN.findall(row[value])
            raw = _raw(tokens[years.index(year)]) if len(tokens) == len(years) else clean(row[value])
            out.append(Offer(school=name, raw_value=raw, entry_point="year3" if junior else None, page=page))
    return out


def parse_layout(text: str, year: int) -> list[Offer]:
    """The 2019-2021 document: a header line names the columns; each figure is assigned to the
    column label nearest to it, and a school's name may wrap onto the lines below its first row."""
    out, labels, junior, school = [], [], False, None
    for page_number, page in enumerate(text.split("\f"), start=1):
        for line in page.splitlines():
            if "Distance of" in line and "Year" in line:
                labels = [(m.start() + len(m.group()) / 2, m.group()) for m in re.finditer(r"\S+(?: \S+)*", line)]
                junior = "Criterion (vi)" in line
                continue
            if "junior schools" in line.lower():
                junior = True
            found = YEAR_PLACES.search(line)
            left = clean(line[:found.start()] if found else line)
            if found:
                if left:
                    school = {"name": [left], "rows": [], "junior": junior}
                    out.append(school)
                if school is not None and int(found[1]) == year:
                    school["rows"].append((_column_value(line, found.end(), labels), page_number))
            elif school is not None and left and len(line) - len(line.lstrip()) < 20 and not TOKEN.search(line):
                school["name"].append(left)  # the wrapped end of the name
    return [Offer(school=" ".join(s["name"]), raw_value=raw, entry_point="year3" if s["junior"] else None,
                  page=page) for s in out for raw, page in s["rows"]]


def _column_value(line: str, start: int, labels: list[tuple[float, str]]) -> str:
    for m in TOKEN.finditer(line, start):
        centre = m.start() + len(m.group()) / 2
        if labels and min(labels, key=lambda label: abs(label[0] - centre))[1].startswith("Distance of"):
            return _raw(m.group())
    return ""


def parse_secondary(tables: list[tuple[int, list[list[str]]]], text: str, column: int) -> list[Offer]:
    """column: index of the year's 'cut off distance at NOD' among School, PAN, NOD, NC, ..."""
    rows = [(page, row) for page, table in tables for row in table if len(row) == 8]
    if not any(re.match(r"^\d+$", row[1]) for _, row in rows):
        rows = [(page, re.split(r"\s{2,}", line.strip()))
                for page, part in enumerate(text.split("\f"), start=1) for line in part.splitlines()]
    return [Offer(school=clean(row[0]), raw_value=clean(row[column]), page=page)
            for page, row in rows if len(row) == 8 and re.match(r"^\d+$", row[1])
            and not re.search(r"contact the school", " ".join(row), re.I)]
