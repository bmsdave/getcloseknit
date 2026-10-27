"""Haringey (309): 'Reception Admissions / Secondary Transfer YYYY - How offers were made' PDFs.

The first part lists oversubscribed schools: on-time applications, places, offers by criterion
and 'Distance of last child offered' (miles) as the last cell. Banded or split schools print one
row per band or quota ('Band 3 ... 0.543', 'Faith 6 1.764', 'All offered', 'None offered'), with
the school's name in the header block (secondary) or on a row of its own (primary 'Eden'); each
band is a rule. A long name may be printed above and below its row.

Schools that offered every on-time applicant are listed after the table ('All on-time
applicants were able to be offered places at the following schools', 'Places could be offered
to every applicant who applied on-time to: ...', 'All applicants were able to be offered places
at ...', 'As at National Offer Day the following schools have vacancies'): all offered, no raw
value, the sentence kept as the criterion. The tables of offers by preference that follow are
not read. The title or first offer date must be in the configured year.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, parse_count, pdf_pages

YEAR = re.compile(r"(?:Reception Admissions|Secondary Transfer|Reception|offers as at [\w ]*?) (\d{4})", re.I)
END = re.compile(r"Offers as at (?:National )?Offer Day|Offers by Haringey School|Offers as at offer day", re.I)
LAST = re.compile(r"^(?:\d*\.\d+|All offered|None offered)$", re.I)
BAND = re.compile(r"^(?:Band \d+|Faith|Distance|Open|Did Not Attend|Banding Test)$", re.I)
LISTS = (("following schools have vacancies", "vacancies at national offer day"),
         ("able to be offered places at the following schools", "all on-time applicants offered"),
         ("Places could be offered to every applicant", "all on-time applicants offered"),
         ("All applicants were able to be offered places at", "all applicants offered"))


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        pages = pdf_pages(path)
        found = YEAR.search(" ".join(pages[0].split()))
        if not found or int(found.group(1)) != int(doc["year"]):
            raise ValueError(f"title year {found and found.group(1)} in {path}, configured {doc['year']}")
        out += parse_text(pages)
    return out


def _cells(line: str) -> list[str]:
    return [clean(c) for c in re.split(r"\s{2,}", line.strip()) if c.strip()]


def _fragment(line: str) -> str:
    """Text at the left of a line that holds no figures ('St. Thomas More'), or ''."""
    cells = _cells(line)
    if not cells or re.search(r"\d", cells[0]) or len(line) - len(line.lstrip()) > 8 or LAST.match(cells[-1]):
        return ""
    return cells[0]


def parse_text(pages: list[str]) -> list[Offer]:
    lines = [(n, line) for n, page in enumerate(pages, start=1) for line in page.splitlines()]
    out, banded, header, pending, listing, used = [], None, [], [], None, set()
    for i, (number, line) in enumerate(lines):
        text = clean(line)
        if END.search(text) and out:
            if listing is not None:
                out += [Offer(school=name, raw_value="", all_offered=True, criterion=listing[1], page=number)
                        for name in _names(listing[0])]
            break  # the tables of offers by preference (in 2019 they come first)
        if listing is not None:
            if not text and not listing[0]:
                continue  # a blank line between the sentence and its list
            if not text or text.startswith(("Reception", "Secondary", "Please", "*")):
                out += [Offer(school=name, raw_value="", all_offered=True, criterion=listing[1], page=number)
                        for name in _names(listing[0])]
                listing = None
            else:
                listing[0].append(line)
                if text.endswith(".") and "," in " ".join(listing[0]):
                    out += [Offer(school=name, raw_value="", all_offered=True, criterion=listing[1], page=number)
                            for name in _names(listing[0])]
                    listing = None
            continue
        trigger = next((label for words, label in LISTS if words.lower() in text.lower()), None)
        if trigger:
            after = line.split(":", 1) if ":" in line else re.split(r"offered places at", line, 1)
            listing = ([after[1]] if len(after) > 1 and after[1].strip() else [], trigger)
            if text.endswith(".") or "with no vacant places" in text:
                out += [Offer(school=name, raw_value="", all_offered=True, criterion=trigger, page=number)
                        for name in _names(listing[0])]
                listing = None
            continue
        cells = _cells(line)
        if len(cells) < 3 or not LAST.match(cells[-1]):
            if len(cells) >= 3 and re.match(r"^\D", cells[0]) and all(re.match(r"^(?:\d+|-|n/a)$", c, re.I)
                                                                       for c in cells[1:]):
                banded = cells[0]  # a school whose rows are its bands ('Eden')
                for band in pending:
                    band.school = banded
                pending = []
            elif cells and not re.search(r"\d", line) and i not in used and len(line) - len(line.lstrip()) <= 6:
                header.append(cells[0])  # a banded school's name sits at the left of its header
            continue
        if BAND.match(cells[0]):
            name = banded or " ".join(c for c in header
                                      if not re.search(r"(?i)on-time|children|places|total|school", c))
            band = Offer(school=name, raw_value=cells[-1], rule=cells[0], criterion=cells[0], page=number)
            out.append(band)
            if not banded and not name:
                pending.append(band)
            continue
        if re.match(r"^[\d-]", cells[0]):  # the name is printed above and below the row
            name = clean(" ".join(f for f in (_fragment(lines[i - 1][1]), _fragment(lines[i + 1][1])) if f))
            used.update((i - 1, i + 1))
            if name.startswith("Did Not Attend") and out and out[-1].rule:  # the last band of a banded school
                out.append(Offer(school=out[-1].school, raw_value=cells[-1], rule=name, criterion=name, page=number))
                continue
        else:
            name = cells[0]
        banded, header = None, []
        out.append(Offer(school=name, raw_value=cells[-1], applicants=parse_count(cells[1] if not
                   re.match(r"^\d", cells[0]) else cells[0]), page=number))
    for offer in out:
        offer.school = offer.school.rstrip("*").strip()
    return [offer for offer in out if offer.school]


def _names(lines: list[str]) -> list[str]:
    """School names from a column list or a sentence ('A, B and C.')."""
    if any(len(_cells(line)) > 1 for line in lines):  # names in columns
        return [c for line in lines for c in _cells(line)]
    text = " ".join(clean(line) for line in lines)
    text = re.sub(r"\s*,? with no vacant places.*$", "", text).rstrip(". ")
    return [clean(n) for n in re.split(r",\s*|\s+and\s+", text) if clean(n)]
