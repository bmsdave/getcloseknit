"""Helpers for councils that print one table row per school (Harrow, Havering, Hillingdon,
Kingston, Merton, Newham, Richmond, Waltham Forest): find columns by their header words, which
pdfplumber often returns reversed (rotated headers), and check the document's year.
"""
from __future__ import annotations

import re

from ..parsers import clean, pdf_text


def letters(cell: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (cell or "").lower())


def header_col(header: list[str], *words: str) -> int | None:
    """Index of the first header cell that spells every word, forwards or backwards."""
    for i, cell in enumerate(header):
        text = letters(cell)
        if all(w in text for w in words) or all(w in text[::-1] for w in words):
            return i
    return None


def check_year(path: str, pattern: re.Pattern, year: int, text: str | None = None) -> str:
    """The document text; ValueError unless pattern's first group finds exactly the configured year."""
    text = clean(text if text is not None else pdf_text(path))
    found = {int(y) for y in pattern.findall(text)}
    if found != {int(year)}:
        raise ValueError(f"{path}: years {sorted(found)} in the title, configured {year}")
    return text


def ruled_rows(path: str) -> list[tuple[int, list[str]]]:
    """(page, cells) for every row of every ruled table, with the text printed level with the row
    to the left of the table first and to its right last ('' when none): some councils draw
    lines only round the figures, leaving the school names outside the table."""
    import pdfplumber

    out = []
    with pdfplumber.open(path) as pdf:
        for number, page in enumerate(pdf.pages, start=1):
            for table in page.find_tables():
                x0, _, x1, _ = table.bbox
                for row in table.rows:
                    top, bottom = row.bbox[1], row.bbox[3]
                    left = _text(page, (0, top, x0, bottom)) if x0 > 1 else ""
                    right = _text(page, (x1, top, page.width, bottom)) if x1 < page.width - 1 else ""
                    cells = [_text(page, cell) if cell else "" for cell in row.cells]
                    out.append((number, [clean(text) for text in (left, *cells, right)]))
                out[len(out) - len(table.rows):len(out) - len(table.rows)] = [
                    (number, cells) for cells in _rows_above(page, table)]
    return out


def _clip(page, box):
    """The part of the page inside box (some tables are drawn past the page's edge), or None."""
    x0, top, x1, bottom = page.bbox
    box = (max(box[0], x0), max(box[1], top), min(box[2], x1), min(box[3], bottom))
    return page.crop(box) if box[0] < box[2] and box[1] < box[3] else None


def _text(page, box) -> str:
    part = _clip(page, box)
    return part.extract_text() if part else ""


def _rows_above(page, table) -> list[list[str]]:
    """A continuation page's first row, printed above the table's detected top edge (its top
    rule is missing): words in the table's columns, a line with a figure in it being a row and
    the name words within 12pt of it (a wrapped name) going with it."""
    x0, top, x1, _ = table.bbox
    cells = table.rows[-1].cells
    if top < 20 or None in cells:
        return []
    bands = [(0, x0), *[(c[0], c[2]) for c in cells], (x1, page.width)]
    part = _clip(page, (0, 0, page.width, top))
    words = part.extract_words() if part else []
    figures = sorted({round(w["top"]) for w in words if x0 <= w["x0"] and re.match(r"^[\d.,]+\*?$", w["text"])})
    out = []
    for y in figures:
        near = [w for w in words if abs(w["top"] - y) < 12]
        out.append([clean(" ".join(w["text"] for w in near if a <= (w["x0"] + w["x1"]) / 2 < b))
                    for a, b in bands])
    return out
