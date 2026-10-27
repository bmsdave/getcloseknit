"""Barnet (302): 'How places were allocated ...' tables (PDF, read with pdfplumber).

Three table layouts, told apart by their header row (a table that starts on a new page without a
header continues the previous one):

* secondary: Name of School | Places available | [On-time applications] | Criteria | Places offered
  | Furthest distance offered (Miles): one row per criterion, a distance or '(All offered)' on
  the criteria that are decided by distance ('(All)' as well: every applicant under it offered,
  kept with no raw value). Each such criterion is a rule when a school has
  more than one ('N2 Priority Postcode', 'Band A - Distance').
* primary, VA / foundation / academies: Name | Places | on-time applicants | [Band] | Criterion
  under which final place offered, with the furthest distance in brackets ('Straight-line
  distance (0.535)'); 'Demand met' is all offered; a second line without a name is a second
  allocation (faith / community bands) and each becomes a rule.
* primary, community: Name | Places | applications | Siblings | furthest distance for children
  living in the defined area | outside it; 'All' (all in that group offered) and 'None' (none).

Each table belongs to the offer day in its title ('on 16 April 2025'); one file can hold several
years (secondary 2023-2025), and only the configured year is read.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, pdf_pages

TITLE = re.compile(r"How (?:primary school )?places were allocated\b.*?\bon (?:\d{1,2} )?(?:March|April) (\d{4})",
                   re.I)
BRACKETED = re.compile(r"\((\d*\.\d+)\)\s*$")
DISTANCE_CELL = re.compile(r"^(?:\d*\.?\d+|\(All(?: offered)?\))$", re.I)
OVERLAY = "Archer Academy (The)"  # 2021 secondary: this name is printed again under two other rows


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    import pdfplumber

    out, seen = [], set()
    for path in files:
        year, kind = None, None
        with pdfplumber.open(path) as pdf:
            for number, page in enumerate(pdf.pages, start=1):
                titles = {int(y) for y in TITLE.findall(clean(page.extract_text() or ""))}
                for table in page.extract_tables():
                    rows = [[clean(cell) if cell else "" for cell in row] for row in table]
                    own = {int(y) for row in rows[:2] for cell in row for y in TITLE.findall(cell)}
                    if len(own or titles) == 1:
                        year = (own or titles).pop()
                    elif own or len(titles) > 1:
                        raise ValueError(f"{path} page {number}: tables for {sorted(own or titles)}")
                    seen.add(year)
                    header = next((i for i, row in enumerate(rows) if row and row[0] == "Name of School"), None)
                    if header is not None:
                        kind = _kind(rows[header], rows[header:header + 3])
                        columns = rows[header]
                        rows = rows[header + 1:]
                    elif kind is None or len(rows[0]) != len(columns):
                        continue  # not a continuation of the last table (header fragments, other tables)
                    if year != int(doc["year"]) or kind is None:
                        continue
                    out += READERS[kind](rows, columns, number, [table])
        if not out and int(doc["year"]) in seen:
            out = parse_text(pdf_pages(path), int(doc["year"]))  # the 2019 booklet's ruled-less tables
    if int(doc["year"]) not in seen:
        raise ValueError(f"no table for {doc['year']} (found {sorted(y for y in seen if y)})")
    return out


def parse_text(pages: list[str], year: int) -> list[Offer]:
    """Booklet tables pdfplumber cannot split: rows rebuilt from pdftotext's columns, from the
    page titled with the year for as long as pages carry a 'Name of School' header."""
    start = next((i for i, page in enumerate(pages) if int(year) in
                  {int(y) for y in TITLE.findall(clean(page))}), None)
    out = []
    for number, page in enumerate(pages[start:] if start is not None else [], start=start + 1 if start else 1):
        if "Name of School" not in page:
            break
        kind, rows = None, []
        for line in page.splitlines():
            cells = [clean(c) for c in re.split(r"\s{2,}", line.strip()) if c.strip()]
            if line.startswith("Name of School"):
                kind = "va" if "Criterion" in line else "community"
            elif kind == "community" and len(cells) == 6 and cells[1].isdigit():
                rows.append(cells)
            elif kind == "va" and len(cells) >= 4 and cells[1].isdigit() and cells[2].isdigit():
                rows.append(cells if len(cells) == 5 else cells[:3] + [""] + cells[3:])
            elif kind == "va" and rows and cells and len(line) - len(line.lstrip()) > 40:
                rows.append([""] + ([""] if len(cells) == 1 else []) + cells)
        out += READERS[kind](rows, [], number, [rows]) if kind and rows else []
    return out


def _kind(header: list[str], top: list[list[str]]) -> str | None:
    words = " ".join(" ".join(row) for row in top).lower().replace(" ", "")
    if "Criteria" in header and any(cell.startswith("Furthest") for cell in header):
        return "secondary"
    if "criterionunderwhichfinalplace" in words:
        return "va"
    if "definedarea" in words or "Siblings" in header:
        return "community"
    return None


def secondary(rows, columns, page, raw):
    name_col = 0
    crit = columns.index("Criteria")
    dist = next(i for i, cell in enumerate(columns) if cell.startswith("Furthest"))
    found, school = [], None
    for row, original in zip(rows, raw[0][-len(rows):] if rows else []):
        if len(row) != len(columns):
            continue
        if row[name_col]:
            lines = [clean(line) for line in (original[name_col] or "").split("\n") if line.strip()]
            if len(lines) > 1 and "\n" in (original[1] or "") and OVERLAY in " ".join(lines):
                lines = [line for line in lines if line != OVERLAY] or lines
            school = clean(" ".join(lines)) if lines else row[name_col]
        if school and DISTANCE_CELL.match(row[dist]):
            found.append((school, row[crit], row[dist]))
    out = []
    for school, criterion, value in found:
        several = sum(1 for other, _, _ in found if other == school) > 1
        every = value == "(All)"  # all applicants under this criterion offered
        out.append(Offer(school=school, raw_value="" if every else value, all_offered=True if every else None,
                         criterion=criterion, rule=criterion if several else None, page=page))
    return out


def va(rows, columns, page, raw):
    found, school, applicants = [], None, None
    for row in rows:
        cells = [cell for cell in row if cell]
        if not cells or cells[-1].isdigit():
            continue
        if row[0]:
            numbers = [cell for cell in cells[1:] if cell.isdigit()]
            school, applicants = row[0], int(numbers[1]) if len(numbers) > 1 else None
            band = cells[3] if len(cells) == 5 else None
        else:
            band = cells[0] if len(cells) == 2 else None
        if school:
            found.append((school, applicants, band, cells[-1]))
    out = []
    for school, applicants, band, criterion in found:
        several = sum(1 for other, *_ in found if other == school) > 1
        distance = BRACKETED.search(criterion)
        demand_met = criterion.lower() == "demand met"
        label = band or BRACKETED.sub("", criterion).strip()
        out.append(Offer(school=school, raw_value=distance.group(1) if distance else "",
                         all_offered=True if demand_met else None, criterion=criterion,
                         rule=label if several else None, applicants=applicants, page=page))
    return out


def community(rows, columns, page, raw):
    out = []
    for row in rows:
        cells = [cell for cell in row if cell]
        if len(cells) != 6 or not cells[1].isdigit():
            continue
        school, _, applications, _, inside, outside = cells
        for rule, cell in (("defined area", inside), ("outside defined area", outside)):
            word = cell.lower()
            out.append(Offer(school=school, raw_value="" if word in ("all", "none") else cell,
                             all_offered={"all": True, "none": False}.get(word),
                             criterion=f"Children living in the {rule}: {cell}" if rule == "defined area"
                             else f"Children living outside the defined area: {cell}",
                             rule=rule, applicants=int(applications), page=page))
    return out


READERS = {"secondary": secondary, "va": va, "community": community}
