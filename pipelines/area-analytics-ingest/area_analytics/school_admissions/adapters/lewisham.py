"""Lewisham (209): application and appeal rates for community schools (academies and VA schools
are not included; the council says to ask the school).

Primary: a PDF grid, one row per school: PAN, applicants naming the school, offers by criterion,
the 'Distance of last child offered for published admissions number' in metres or 'All places
offered' / 'All applicants offered', in some years a second distance for a bulge class, then EHCP
places. The distance is the first decimal number after the counts; a second one is the bulge class.
Secondary: an HTML page with a heading and a two-column table per school ('Total number of
applicants', 'Home-to-school distance of last place offered*'); 'Contact school' gives no distance.
2020 is a PDF grid and 2021 a Word table of the primary kind.

The offer date printed ('allocated on 16 April 2026') must be in the configured year; a doc's
label_year says which year a mislabelled page prints instead. A doc's ignore_distance names the
schools whose printed distance is not a usable cut-off (the reason is in the config); their row
keeps the counts only.
"""
from __future__ import annotations

import html
import re

from ..parsers import Offer, clean, docx_tables, parse_count, pdf_text

ALLOCATED = re.compile(r"allocated on (?:the )?\d{1,2}\w*\s+(?:April|March)\s+(\d{4})", re.I)
ROW = re.compile(r"^\s*(?P<name>[A-Z][A-Za-z.'’&() -]*?[a-z.)])\s{2,}(?P<pan>\d+)\s+(?P<apps>\d+)\s+(?P<rest>\S.*)$")
DECIMAL = re.compile(r"^\d[\d,]*\.\d+$")
ALL = re.compile(r"\b(?:All places offered|All applicants offered(?: a place)?|Applicants all offered(?: a place)?)", re.I)
HEADING = re.compile(r"<(h[1-6]|strong)\b[^>]*>(.*?)</\1>", re.S | re.I)


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        with open(path, "rb") as handle:
            head = handle.read(5)
        if head == b"%PDF-":
            text = pdf_text(path)
            check_year(text, doc)
            out += grid(text)
        elif head.startswith(b"PK"):
            out += word_grid(docx_tables(path))
        else:
            with open(path, encoding="utf-8", errors="replace") as handle:
                page = handle.read()
            check_year(html.unescape(re.sub(r"<[^>]+>", " ", page)), doc)
            out += school_tables(page)
    ignore = doc.get("ignore_distance") or {}
    for offer in out:
        if offer.school in ignore:
            offer.raw_value, offer.all_offered = "", None
    return out


def check_year(text: str, doc: dict) -> None:
    years = {int(y) for y in ALLOCATED.findall(" ".join(text.split()))}
    expected = int(doc.get("label_year") or doc["year"])
    if years and years != {expected}:
        raise ValueError(f"offers allocated in {sorted(years)}, configured {expected}")


def grid(text: str) -> list[Offer]:
    """PDF grid rows. A name or an outcome wrapped onto the next lines ('Conisborough' / 'College',
    'Applicants' / 'all offered' / 'a place') is joined from the line's first and last chunks."""
    lines = [line for line in text.splitlines() if line.strip()]
    out = []
    for i, line in enumerate(lines):
        row = ROW.match(line)
        if not row or row["name"].lower().startswith(("name of", "published")):
            continue
        name, rest = row["name"], row["rest"]
        for following in lines[i + 1:i + 3]:
            chunks = re.split(r"\s{2,}", following.strip())
            if ROW.match(following) or len(chunks) > 2:
                break
            if re.fullmatch(r"(?:College|School|Academy)", chunks[0]):
                name = f"{name} {chunks[0]}"
            if len(chunks) == 2 or not re.fullmatch(r"(?:College|School|Academy)", chunks[0]):
                rest = f"{rest} {chunks[-1]}"
        out.append(_grid_offer(name, row["apps"], rest))
    return out


def _grid_offer(name: str, apps: str, rest: str) -> Offer:
    tokens = clean(rest).split()
    if "Applicants" in tokens and "all offered" in clean(rest):  # 'Applicants' / 'all offered' / 'a place'
        return Offer(school=clean(name), raw_value="Applicants all offered a place", applicants=parse_count(apps),
                     all_offered=True)
    if ALL.search(clean(rest)):
        return Offer(school=clean(name), raw_value=ALL.search(clean(rest))[0], applicants=parse_count(apps),
                     all_offered=True)
    decimals = [t for t in tokens if DECIMAL.match(t)]
    return Offer(school=clean(name), raw_value=decimals[0] if decimals else clean(rest),
                 applicants=parse_count(apps))


def word_grid(tables: list[list[list[str]]]) -> list[Offer]:
    out = []
    for table in tables:
        header = next((row for row in table if row and row[0].lower().startswith("name of school")), None)
        if not header:
            continue
        column = next(i for i, cell in enumerate(header) if cell.lower().startswith("distance of last"))
        for row in table[table.index(header) + 1:]:
            if row[0] and len(row) > column:
                value = clean(row[column])
                out.append(Offer(school=clean(row[0]), raw_value=value, applicants=parse_count(row[2]),
                                 all_offered=True if ALL.search(value) else None))
    return out


def school_tables(page: str) -> list[Offer]:
    """One heading and one two-column table per school."""
    out = []
    for match in re.finditer(r"<table\b.*?</table>", page, re.S | re.I):
        headings = [clean(html.unescape(re.sub(r"<[^>]+>", " ", h[1])))
                    for h in HEADING.findall(page[:match.start()])]
        headings = [h for h in headings if h]
        cells = {}
        for row in re.findall(r"<tr\b.*?</tr>", match.group(0), re.S | re.I):
            texts = [clean(html.unescape(re.sub(r"<[^>]+>", " ", c)))
                     for c in re.findall(r"<t[dh]\b.*?</t[dh]>", row, re.S | re.I)]
            if len(texts) == 2:
                cells[texts[0].lower()] = texts[1]
        value = next((v for k, v in cells.items() if k.startswith("home-to-school distance")), None)
        if value is None or not headings:
            continue  # appeals tables and the like
        if value.lower().startswith("contact school"):
            value = ""
        out.append(Offer(school=headings[-1], raw_value=value,
                         applicants=parse_count(cells.get("total number of applicants")),
                         all_offered=True if ALL.search(value) else None))
    return out
