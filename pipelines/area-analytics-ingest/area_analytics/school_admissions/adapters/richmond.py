"""Richmond (318), admissions run by Achieving for Children like Kingston: rolling three-year
documents 'How places have been allocated at community (infant,) primary and junior schools'
and 'Distance offers' for the borough's secondary schools.

Primary: one row per school and year, '<year> (<available places>)', offers per criterion, then
'Distance of the last child offered a place under criterion (v) [junior: (vi)] at offer date'
(km, read) and the furthest distance from the waiting list (not read). The name is printed once
per school, beside whichever of its year rows the layout centres it on, so rows are grouped by
the years running upwards and the group takes the name printed in it. The 2021-2023 file is a
ruled table (pdfplumber); the 2019-2021 file is read from the text layout by column.

Secondary: per school the cut-off at national offer day and the distance at the end of
coordination for each of three years; the configured year's offer-day cut-off is read. A cut-off
under another criterion ('Crit 5 - 6.515 kms', 'Band 8 - 4.420 kms') keeps the criterion apart;
'Random alloc within Bands 2&3' (St Richard Reynolds) has no distance and gives no row. Read from
the ruled table (pdfplumber), since the text runs neighbouring cells together.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, pdf_tables, pdf_text
from ._pdf_grid import letters
from .kingston import YEAR_PLACES, _column_value, _raw

SECONDARY_YEARS = re.compile(r"(\d{4}), (\d{4}) and (\d{4})")
WITH_CRITERION = re.compile(r"^(?P<criterion>(?:Crit|Cat|Band)\s*[\d.]+)\s*-\s*(?P<value>.+)$", re.I)


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        text = pdf_text(path)
        year = int(doc["year"])
        if doc["phase"] == "secondary":
            found = SECONDARY_YEARS.search(clean(text))
            order = [int(y) for y in found.groups()] if found else []
            if year not in order:
                raise ValueError(f"{path}: covers {order}, configured {year}")
            out += parse_secondary(pdf_tables(path, text_x_tolerance=1.5), 1 + 2 * order.index(year))
            continue
        rows = table_rows(pdf_tables(path, text_x_tolerance=1.5)) or layout_rows(text)
        if year not in {r[1] for r in rows}:
            raise ValueError(f"{path}: no {year} rows")
        out += [Offer(school=name, raw_value=raw, entry_point="year3" if junior else None, page=page)
                for name, y, raw, junior, page in grouped(rows) if y == year]
    return out


def table_rows(tables) -> list[tuple]:
    """(name or '', year, value, junior, page) per ruled row, or [] for a stacked-cell layout."""
    out, value, junior = [], None, False
    for page, rows in tables:
        for row in rows:
            head = [letters(c) for c in row]
            if any(c.startswith("distanceofthelast") for c in head):
                value = next(i for i, c in enumerate(head) if c.startswith("distanceofthelast"))
                junior = any("criterionvi" in c for c in head)
                continue
            years = YEAR_PLACES.findall(row[1]) if len(row) > 1 else []
            if value is None or not years:
                continue
            if len(years) > 1:
                return []
            out.append((clean(row[0]), int(years[0][0]), _raw(row[value]), junior, page))
    return out


def layout_rows(text: str) -> list[tuple]:
    out, labels, junior = [], [], False
    for page_number, page in enumerate(text.split("\f"), start=1):
        for line in page.splitlines():
            if "Distance of" in line and ("Year" in line or "School" in line):
                labels = [(m.start() + len(m.group()) / 2, m.group()) for m in re.finditer(r"\S+(?: \S+)*", line)]
                junior = junior or "Criterion (vi)" in line
                continue
            if "junior schools" in line.lower():
                junior = True
            found = YEAR_PLACES.search(line)
            if found and labels:
                out.append((clean(line[:found.start()]), int(found[1]),
                            _column_value(line, found.end(), labels), junior, page_number))
            elif out and labels and re.match(r"^ {0,2}[A-Z]", line) and not re.match(r"^\s*(?:How places|School)", line):
                # page 2 prints the name on a line of its own between the school's year rows
                name, *rest = out[-1]
                out[-1] = (clean(f"{name} {re.split(r'\s{2,}', line.strip())[0]}"), *rest)
    return out


def grouped(rows: list[tuple]) -> list[tuple]:
    """Rows with each school's name: a school's years run upwards, so a year that does not
    follow the one before starts the next school."""
    groups, last = [], None
    for row in rows:
        if last is None or row[1] <= last or row[3] != groups[-1][-1][3]:
            groups.append([])
        groups[-1].append(row)
        last = row[1]
    out = []
    for group in groups:
        name = " ".join(r[0] for r in group if r[0])
        if name:
            out += [(name, *r[1:]) for r in group]
    return out


SPLIT = re.compile(r"^(?P<school>Christ's|Turing House|Waldegrave)\s+(?P<rule>.+)$")


def parse_secondary(tables, column: int) -> list[Offer]:
    """column: index of the year's NOD cut-off in the table row (School Name, NOD, NC, ...).
    Schools with two admission routes print a row each ('Christ's Foundation' / 'Christ's
    Open', 'Turing House 80%', 'Waldegrave Area A 85%'): the route becomes the rule."""
    out = []
    for page, rows in tables:
        for row in rows:
            name = clean(row[0])
            if not name or len(row) <= column or not any(re.search(r"km|pref(?:erence)?s met", c, re.I) for c in row[1:]) or "Cut off" in " ".join(row):
                continue
            cell = clean(row[column])
            if not cell or "random" in cell.lower():
                continue
            split = WITH_CRITERION.match(cell)
            route = SPLIT.match(name)
            out.append(Offer(school=route["school"] if route else name, rule=route["rule"] if route else None,
                             raw_value=split["value"] if split else cell,
                             criterion=split["criterion"] if split else None, page=page))
    return out
