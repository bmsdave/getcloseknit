"""Hillingdon (312): 'September <year> allocation data' (reception) and 'Hillingdon Secondary
Schools - Admissions (Year 7) September <year>' PDFs.

Reception documents carry two years: the furthest distance offered (metres, excluding the
sibling criterion) for the document's year and the year before, so the year before is read from
the next document's second column (2020 from the 2021 file). Offers made on national offer day
and 'Criteria the last child was offered under' belong to the document's own year (its
'Published Admission Number (Sept NN)'), so they are left out when the older column is read.
The 2026 header says 'Kilometres' but the figures are metres like every other year (Bourne
Primary: 1653.8516 for 2025 beside 704 for 2026). The lines are drawn round the figures only,
so names are read level with each row (_pdf_grid.ruled_rows).

Secondary documents give the furthest distance offered in metres (read from the text layout); 'Number of offers that could
be made' is a capacity, not offers, so no counts are taken. 2024-2026 are scanned: they are read
with tesseract three times (300, 350 and 450 dpi) and a school is kept only when two readings
agree on its distance and none disagrees; counts are not read from scans.

Key printed in every document: N/A (U) undersubscribed (all applicants offered), N/A (F) faith
school, N/A (B) banding, both without a distance.
"""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
from collections import Counter

from ..parsers import Offer, parse_count, pdf_text
from ._pdf_grid import check_year, header_col, letters, ruled_rows

SECONDARY_TITLE = re.compile(r"Admissions \(Year 7\) September (\d{4})", re.I)
DOC_YEAR = re.compile(r"Published Admission Number \(Sept (\d{2})\)", re.I)
CODE = re.compile(r"^N\S?A\s*\((\w)", re.I)
NOT_A_CRITERION = re.compile(r"^contact school$", re.I)


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        if doc["phase"] == "primary":
            out += parse_rows(ruled_rows(path), int(doc["year"]))
        elif doc.get("format") == "scanned-pdf":
            check_year(path, SECONDARY_TITLE, doc["year"], ocr(path, 300))
            out += parse_scan([ocr(path, dpi) for dpi in (300, 350, 450)])
        else:
            text = pdf_text(path)
            check_year(path, SECONDARY_TITLE, doc["year"], text)
            out += parse_layout(text, int(doc["year"]))
    return out


LABEL = re.compile(r"offered (\d{4}|in)\b")
CELL = re.compile(r"N\S?A\s*\(\w\)\**|\d[\d,]*(?:\.\d+)?")


def parse_layout(text: str, year: int) -> list[Offer]:
    """Text secondary documents (2019-2023): the furthest-distance figure is the one printed
    under 'offered <year>' (2023: the only 'offered in metres'). The 2020 file's ruled table
    overlays two text layers, so the layout text is read for every year."""
    labels, out = {}, []
    for line in text.splitlines():
        for m in LABEL.finditer(line):
            labels.setdefault(m[1], m.start() + len(m.group()) / 2)
    centre = labels.get(str(year), labels.get("in") if len(labels) == 1 else None)
    if centre is None:
        raise ValueError(f"no 'offered {year}' column (have {sorted(labels)})")
    for line in text.splitlines():
        row = re.match(r"^([A-Z][A-Za-z' ]+?)\s{2,}\d", line)
        if not row or row[1] == "School":
            continue
        cells = [m for m in CELL.finditer(line, row.end(1))]
        best = min(cells, key=lambda m: abs(m.start() + len(m.group()) / 2 - centre), default=None)
        if best and abs(best.start() + len(best.group()) / 2 - centre) < 12:
            out.append(offer(row[1], best.group()))
    return out


def offer(name: str, cell: str, **fields) -> Offer:
    raw = cell.rstrip("* ")
    code = CODE.match(raw)
    return Offer(school=name.rstrip("* "), raw_value=raw,
                 all_offered=True if code and code[1].upper() == "U" else None, **fields)


def parse_rows(rows: list[tuple[int, list[str]]], year: int) -> list[Offer]:
    """Reception or text secondary rows; the distance column is the one naming the year, or the
    only 'furthest' column."""
    out, header = [], None
    for page, cells in rows:
        if header_col(cells, "furthest") is not None:
            header = cells
            continue
        if header is None or len(cells) != len(header):
            continue
        name = cells[header_col(header, "school")]
        distance = header_col(header, "furthest", str(year))
        if distance is None and sum("furthest" in letters(c) for c in header) == 1:
            distance = header_col(header, "furthest")
        if distance is None:
            raise ValueError(f"no 'furthest distance offered {year}' column in {header}")
        own = DOC_YEAR.search(" ".join(header))
        own = own is not None and 2000 + int(own[1]) == year
        offers = header_col(header, "ontime", "offers") if own else None
        criterion = header_col(header, "criteria", "lastchild") if own else None
        if not name or not cells[distance] or (offers is not None and parse_count(cells[offers]) is None):
            continue  # a blank or repeated row
        crit = cells[criterion] if criterion is not None else ""
        out.append(offer(name, cells[distance], offers=parse_count(cells[offers]) if offers is not None else None,
                         criterion=None if not crit or NOT_A_CRITERION.match(crit) else crit, page=page))
    return out


def ocr(path: str, dpi: int) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-r", str(dpi), "-png", "-f", "1", "-l", "1", path,
                        os.path.join(tmp, "page")], check=True)
        image = os.path.join(tmp, os.listdir(tmp)[0])
        return subprocess.run(["tesseract", image, "-", "--psm", "4"], check=True,
                              capture_output=True, text=True).stdout


SCAN_ROW = re.compile(r"^[\W_]*([A-Z][A-Za-z' ]+?)\s+\d+\s+\S+\s+\S+\s+(\d+(?:\.\d+)?|N\S?A\s*\(\w)")


def parse_scan(readings: list[str]) -> list[Offer]:
    """Schools whose distance at least two readings agree on and no reading contradicts."""
    seen: dict[str, list[str]] = {}
    for text in readings:
        for line in text.splitlines():
            if (row := SCAN_ROW.match(line.strip())) and row[1].strip() != "Totals":
                value = row[2]
                code = CODE.match(value)
                seen.setdefault(row[1].strip(), []).append(f"N/A ({code[1].upper()})" if code else value)
    out = []
    for name, values in seen.items():
        value, n = Counter(values).most_common(1)[0]
        if n >= 2 and len(set(values)) == 1:
            out.append(offer(name, value))
    return out
