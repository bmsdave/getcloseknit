"""Westminster (213): the 'HOW PLACES WERE OFFERED IN YYYY' box on each school's brochure page.

A primary school page starts with its name in capitals above 'SUMMARISED ADMISSION CRITERIA'; a
secondary school's name heads the page before its 'ADMISSION CRITERIA' page. The box sits in the
same column under the criteria (pages and the 2021 spreads hold two or three columns): total
(on-time) applications, then either 'All applicants were offered ...' or the offers by criterion
with the distance places were offered up to ('Distance: 32 - offered up to 0.709 of a mile',
'Open: remaining places offered up to 0.529 miles straight-line'). Every distance in the box is
read; when there are several, each is a rule named by the text before it. A junior school's
entry is Year 3. Pages whose box names another year are skipped, and at least one must name
the configured year (brochure 'YYYY' covers the YYYY-1 round).
"""
from __future__ import annotations

import re
import subprocess

from ..parsers import Offer, clean, pdf_pages

BOX = re.compile(r"HOW PLACES WERE OFFERED IN (\d{4})")
HEADING = re.compile(r"(?:SUMMARISED )?ADMISSION CRITERIA")
SECTION = re.compile(r"SCHOOL INFORMATION|ADMISSION CRITERIA|ACADEMIES, FREE|VOLUNTARY AIDED SCHOOLS|"
                     r"COMMUNITY SCHOOLS|ABOUT THE SCHOOL")
APPLICATIONS = re.compile(r"Total (?:number of )?(?:on-time )?applications(?: submitted)?:\s*(\d+)", re.I)
ALL = re.compile(r"All applicants were offered|all applicants offered", re.I)
DISTANCE = re.compile(r"(\d*\.\d+)\s*(of a mile|miles?)")
LIGATURES = str.maketrans({"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl"})


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out, years = [], set()
    for path in files:
        try:
            pages = [page.translate(LIGATURES) for page in pdf_pages(path)]
        except subprocess.CalledProcessError:
            raise ValueError(f"{path} cannot be read (the archived copy is cut off)") from None
        for number, page in enumerate(pages, start=1):
            found = BOX.search(page)
            if not found:
                continue
            years.add(int(found.group(1)))
            if int(found.group(1)) == int(doc["year"]):
                out += parse_page(page, number, pages[number - 2] if number > 1 else "")
    if int(doc["year"]) not in years:
        raise ValueError(f"no 'How places were offered' box for {doc['year']} (found {sorted(years)})")
    sites = config.get("sites") or {}  # schools since merged into another: their own rows, as a site
    for offer in out:
        offer.site = sites.get(offer.school, offer.site)
    return out


def _at(line: str, x: int) -> str:
    """The text of the column that starts at x."""
    if len(line) <= x or line[max(x - 3, 0):x].strip() and line[x - 1:x] != " ":
        return ""
    return clean(re.split(r"\s{2,}", line[max(x - 3, 0):].strip())[0])


def _capitals(text: str) -> bool:
    return bool(text) and text.isupper() and not re.search(r"\d", text)


def parse_page(page: str, number: int, previous: str = "") -> list[Offer]:
    lines, out = page.splitlines(), []
    for i, line in enumerate(lines):
        if found := BOX.search(line):
            out += _box(lines, i, found.start(), number, previous)
    return out


def _name(lines: list[str], x: int, previous: str) -> str:
    parts = []
    for line in lines:  # the last block of capitals at column x above the criteria heading
        text = _at(line, x)
        if text and not _capitals(text):
            parts = []
        elif text and not SECTION.search(text):
            parts.append(text)
    if not parts:  # secondary: the first capitals on the school's previous page
        for line in previous.splitlines():
            text = _at(line, x)
            if text:
                if _capitals(text) and not SECTION.search(text):
                    parts.append(text)
                break
    return " ".join(parts)


def _box(lines: list[str], at: int, x: int, number: int, previous: str) -> list[Offer]:
    head = None
    for j in range(at - 1, -1, -1):
        found = HEADING.search(lines[j])
        if found and abs(found.start() - x) <= 10:
            head, x_head = j, found.start()
            break
    # no heading above the box on this page: the school's criteria began on the previous page
    name = _name(lines[:head], x_head, previous) if head is not None else _name([], x, previous)
    if not name:
        return []
    box = []
    for line in lines[at + 1:]:
        text = _at(line, x)
        if text.startswith(("*", "APPEALS")) or BOX.search(text) or HEADING.search(text):
            break
        if text:
            box.append(text)
    text = " ".join(box)
    applicants = APPLICATIONS.search(text)
    common = {"school": clean(name.title()), "page": number,
              "entry_point": "year3" if "JUNIOR" in name else None,
              "applicants": int(applicants.group(1)) if applicants else None}
    distances = list(DISTANCE.finditer(text))
    if not distances:
        every = ALL.search(text)
        return [Offer(raw_value="All applicants offered" if every else "", **common)] if every or applicants else []
    out = []
    for i, found in enumerate(distances):
        before = text[distances[i - 1].end() if i else 0:found.start()]
        label = clean(re.split(r"[.:]\s", before.strip())[-1] if ". " in before else before.split(":")[0])
        label = re.sub(r"^\d+\s*|[-–]?\s*(?:remaining places )?offer(?:ed|s) up to( a distance of)?$", "",
                       label).strip(" :-–")
        out.append(Offer(raw_value=found.group(0), criterion=label or None,
                         rule=(label or f"distance {i + 1}") if len(distances) > 1 else None, **common))
    return out
