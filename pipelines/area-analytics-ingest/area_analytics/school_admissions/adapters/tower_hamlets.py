"""Tower Hamlets (211): 'How Reception places were offered for Tower Hamlets Schools in <year>' on the
primary admissions page. Oversubscribed schools that use the council's policy only.

2024: one table (School, Number of applications, PAN, offers by criterion, 'Tie-break cut off
distance (metres)', Total Offered). 2025 on: a heading per school followed by 'label: value' lines
in the same order. Bonner's two sites are listed as schools. The cut-off is measured by the shortest walking distance (config method).
"""
from __future__ import annotations

import html
import re

from ..parsers import Offer, clean, html_tables, parse_count

YEAR = re.compile(r"places were offered for Tower Hamlets Schools in (\d{4})", re.I)
CUT_OFF = "tie-break cut off distance (metres)"
# Bonner Primary School has two sites, each listed as its own school.
SITES = {"Bonner Bethnal Green": ("Bonner Primary School", "bethnal-green"),
         "Bonner Mile End": ("Bonner Primary School", "mile-end")}


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        with open(path, encoding="utf-8", errors="replace") as handle:
            page = handle.read()
        text = clean(html.unescape(re.sub(r"<[^>]+>", " ", page)))
        years = set(YEAR.findall(text))
        if years != {str(doc["year"])}:
            raise ValueError(f"page is for {sorted(years)}, configured {doc['year']}")
        out += table(html_tables(path)) or blocks(page)
    for offer in out:
        offer.school, offer.site = SITES.get(offer.school, (offer.school, offer.site))
    return out


def table(tables: list[list[list[str]]]) -> list[Offer]:
    for rows in tables:
        header = [cell.lower() for cell in rows[0]]
        if not any(cell.startswith(CUT_OFF) for cell in header):
            continue
        cut, apps, total = (next(i for i, c in enumerate(header) if c.startswith(key))
                            for key in (CUT_OFF, "number of applications", "total offered"))
        return [Offer(school=clean(row[0]), raw_value=clean(row[cut]), applicants=parse_count(row[apps]),
                      offers=parse_count(row[total])) for row in rows[1:] if len(row) == len(header)]
    return []


def blocks(page: str) -> list[Offer]:
    out = []
    parts = re.split(r"<h3\b[^>]*>(.*?)</h3>", page, flags=re.S | re.I)
    for name, body in zip(parts[1::2], parts[2::2]):
        lines = {}
        for item in re.findall(r"<(?:li|p)\b[^>]*>(.*?)</(?:li|p)>", body, re.S | re.I):
            label, _, value = clean(html.unescape(re.sub(r"<[^>]+>", " ", item))).partition(":")
            lines.setdefault(label.lower(), clean(value))
        value = next((v for k, v in lines.items() if k.startswith(CUT_OFF)), None)
        if value is None:
            continue
        out.append(Offer(school=clean(html.unescape(re.sub(r"<[^>]+>", " ", name))), raw_value=value,
                         applicants=parse_count(lines.get("number of applications")),
                         offers=parse_count(lines.get("total offered"))))
    return out
