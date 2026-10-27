"""Camden (202): the annual admissions guides, each with the two previous offer rounds.

Primary ('Results and statistics for Camden primary schools (Y1 and Y2) on offer date'): one row per
school with the admission number, then two columns per year (order as in the year header line) for
applications, EHCP offers, sibling offers, social/medical offers and 'Furthest child offered on the
offer date calculated in miles'. A name may sit on its own line above its figures ('West Hampstead'
then '(formerly Beckford)'). 'n/a' is 'These schools had vacant places after the offer date';
'*' is 'Check with the school' and gives no distance.
Secondary ('Allocation of places in Y1 and Y2'): cut-off distances in miles per school and year,
Camden School for Girls by band ('Band A:'). 'n/a' is 'These schools had vacant places when the
offers were published'; in the older guides '*' is 'not applicable' and gives no distance.
Only the configured year's column is read. Guides cut off by the archive (1 MB) are skipped; a doc
whose files are all unreadable is reported unread.
"""
from __future__ import annotations

import re
import subprocess

from ..parsers import Offer, clean, parse_count, pdf_text

YEARS = re.compile(r"^\s*((?:20\d\d\s+){9}20\d\d)\s*$")
TOKEN = r"(?:\d+(?:\.\d+)?|-|\*|n/a)"
PRIMARY_ROW = re.compile(rf"^\s*(?:(?P<name>\S.*?)\s{{2,}})?(?P<pan>\d+)\s+(?P<cells>(?:{TOKEN}\s+){{9}}{TOKEN})\s*$")
SECONDARY_HEAD = re.compile(r"^\s*School\s+(20\d\d)\s+(20\d\d)\s*$")
SECONDARY_ROW = re.compile(rf"^\s*(?P<name>\S.*?)\s{{2,}}(?P<a>{TOKEN})\s+(?P<b>{TOKEN})\s*$")
BAND = re.compile(r"^(?P<name>.*?)\s*\b(?P<band>Band [A-Z]):$")


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out, unread = [], []
    for path in files:
        try:
            text = pdf_text(path)
        except subprocess.CalledProcessError as error:  # a truncated capture
            unread.append(f"{path}: unreadable ({error.__class__.__name__})")
            continue
        out += (primary if doc["phase"] == "primary" else secondary)(text, doc["year"])
    if not out:
        raise ValueError(f"no table for {doc['year']} found " + "; ".join(unread))
    return out


def _outcome(cell: str) -> tuple[str, bool | None]:
    if cell == "n/a":
        return "n/a", True
    return ("" if cell in ("*", "-") else cell), None


def primary(text: str, year: int) -> list[Offer]:
    lines = text.splitlines()
    head = next((i for i, line in enumerate(lines) if (m := YEARS.match(line)) and str(year) in m[1].split()[:2]), None)
    if head is None:
        return []
    column = YEARS.match(lines[head])[1].split()[:2].index(str(year))
    out, pending = [], None
    for line in lines[head + 1:]:
        if line.strip().startswith(("* - Check", "n/a - These")):
            break
        row = PRIMARY_ROW.match(line)
        if not row:
            text_only = clean(line)
            if text_only and not text_only.startswith("("):
                pending = text_only
            continue
        name = clean(row["name"]) or pending
        pending = None
        cells = row["cells"].split()
        raw, all_offered = _outcome(cells[8 + column])
        out.append(Offer(school=name, raw_value=raw, all_offered=all_offered,
                         applicants=parse_count(cells[column])))
    return out


def secondary(text: str, year: int) -> list[Offer]:
    lines = text.splitlines()
    head = next((i for i, line in enumerate(lines) if (m := SECONDARY_HEAD.match(line)) and str(year) in m.groups()), None)
    if head is None:
        return []
    column = SECONDARY_HEAD.match(lines[head]).groups().index(str(year))
    vacant = re.search(r"n/a\s*-\s*These schools had vacant places", text)
    out, school = [], None
    for line in lines[head + 1:]:
        if re.match(r"^\s*(?:\* Note|n/a - These|Please remember)", line):
            break
        row = SECONDARY_ROW.match(line)
        if not row:
            continue
        name, band = clean(row["name"]), None
        if found := BAND.match(name):  # 'Camden School for Girls Band A:', then 'Band B:' alone
            name, band = clean(found["name"]), found["band"]
        school = name or school
        cell = (row["a"], row["b"])[column]
        raw, all_offered = _outcome(cell) if vacant or cell != "n/a" else ("", None)
        out.append(Offer(school=school, raw_value=raw, all_offered=all_offered, rule=band))
    return out
