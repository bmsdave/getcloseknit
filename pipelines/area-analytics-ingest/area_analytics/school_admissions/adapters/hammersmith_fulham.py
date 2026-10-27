"""Hammersmith & Fulham (205): school pages of the 'Starting school' and 'Moving on up' brochures,
and the standalone 'How places were offered for LBHF secondary schools for <year>' PDFs.

Brochures: one page per school, its name at the top, and a box 'How places were offered in <year>'
in one of the two columns, read by cropping that column below the heading. The box is free text:
'All on-time applicants were offered.', or offers by criterion with '(up to a distance of 0.342 of
a mile)', '(last distance offered was 0.368 of a mile)', 'Open: last distance offered 0.254 of a
mile', 'places offered to the Hammersmith site (last distance offered 0.806)'. One distance is the
school's; several are labelled by the criterion, band or site written before each.
Standalone secondary PDFs: '<School>  Places available = 180 (Applications received = 260)', then
'All applicants who applied were offered a place' or criterion rows ending 'last offer up to 0.829
miles straight-line', the band label beside the row or on the next line.
"""
from __future__ import annotations

import re
import subprocess

from ..parsers import Offer, clean, parse_count, pdf_text

BOX_YEAR = re.compile(r"How places were offered in (\d{4})")
ALL = re.compile(r"\bAll (?:on-time |open )?(?:applicants|applications|students)\b[^.;]*?\boffered\b", re.I)
DISTANCE = re.compile(r"(?:up to(?: a distance)?(?: of)?|last distance(?: offered)?(?: was| up to| of)?|"
                      r"at(?: a)? distance(?: of)?|last offer up to|\bwas)\s+(\d*\.\d+)(?:\s*(?:of a mile|miles?))?", re.I)
LABEL = re.compile(r"((?:Foundation|Open) [Bb]and \d+|Band [A-Z0-9]+|Category \d+ [a-z ]*?places|Church places|Open places|Foundation|Open|"
                   r"Nursery children|[Cc]riterion \d+[a-z]?|Distance)\b")
SITE = re.compile(r"offered to the ([A-Z][A-Za-z ]+?) site")
SCHOOL_HEAD = re.compile(r"^(?P<name>\S.*?)\s{2,}Places available\s*=\s*\d+\s*\(Applications received\s*=\s*(?P<apps>[\d,]+)\)")


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        try:
            text = pdf_text(path)
        except subprocess.CalledProcessError as error:  # a capture cut off by the archive
            raise ValueError(f"{path}: unreadable PDF (pdftotext exit {error.returncode})") from error
        if re.search(r"How places were offered for LBHF", text):
            if f"secondary schools for {doc['year']}" not in clean(text):
                raise ValueError(f"{path}: not the {doc['year']} offers document")
            out += standalone(text)
        else:
            out += brochure(path, doc["year"])
    return out


def box_offers(school: str, box: str, apps: int | None = None) -> list[Offer]:
    """Offers from one school's free-text box (whitespace collapsed)."""
    found = list(DISTANCE.finditer(box))
    if not found:
        if ALL.search(box):
            return [Offer(school=school, raw_value=ALL.search(box)[0], all_offered=True, applicants=apps)]
        # offers by criterion with no distance (faith and sports places), or 'contact the school'
        return [Offer(school=school, raw_value="", applicants=apps)]
    out, start = [], 0
    for match in found:
        segment = box[start:match.start()]
        start = match.end()
        site = SITE.search(segment)
        labels = LABEL.findall(segment)
        rule = None if len(found) == 1 or site else (labels[0] if labels else f"distance {len(out) + 1}")
        out.append(Offer(school=school, raw_value=f"{match[1]} miles", rule=rule, applicants=apps,
                         site="-".join(site[1].lower().split()) if site else "main"))
    return out


def _title(page) -> str | None:
    """The school's name: the large type (20pt and over) at the top of its page."""
    words = [w for w in page.extract_words(extra_attrs=["size"]) if w["top"] < page.height * 0.3 and w["size"] >= 20
             and re.search(r"[A-Za-z]", w["text"])]
    return clean(" ".join(w["text"] for w in words)) or None


def brochure(path: str, year: int) -> list[Offer]:
    """Boxes by page. A box printing another year is skipped (one stale box in RBKC's 2024 primary
    brochure); a box with no year (RBKC's 2026 brochures) is taken as the configured year. A page
    with no name in large type (RBKC 2026 secondary spreads) takes the last name seen."""
    import pdfplumber

    out, previous, boxes, stale = [], None, 0, []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            title = _title(page) or previous
            previous = title
            words = page.extract_words()
            heads = [w for i, w in enumerate(words[:-3]) if w["text"] == "How" and words[i + 1]["text"] == "places"
                     and words[i + 2]["text"] == "were" and words[i + 3]["text"] == "offered"]
            if not heads:
                continue
            head, mid = heads[0], page.width / 2
            x0, x1 = (0, mid) if head["x0"] < mid else (mid, page.width)
            box = page.crop((x0, head["top"] - 1, x1, page.height)).extract_text() or ""
            box = clean(re.split(r"\n\s*(?:Appeals|Sixth form admissions)\b", box)[0])
            stated = BOX_YEAR.search(box)
            if stated and int(stated[1]) != year:
                stale.append(f"page {page.page_number} ({title}): box for {stated[1]}")
                continue
            boxes += 1
            out += box_offers(title, box)
    if not boxes:
        raise ValueError(f"no box for {year}: " + "; ".join(stale[:3]))
    return out


def standalone(text: str) -> list[Offer]:
    lines = text.splitlines()
    out, school, apps, rows = [], None, None, []

    def flush():
        if school:
            out.extend(_school_rows(school, apps, rows))

    for i, line in enumerate(lines):
        head = SCHOOL_HEAD.match(line.strip())
        if head:
            flush()
            school, apps, rows = clean(head["name"]), parse_count(head["apps"]), []
            continue
        if school is None:
            continue
        if found := ALL.search(line):
            rows.append(("", found[0]))
        elif match := DISTANCE.search(line):
            left = re.match(r"^\s{0,3}(\S.*?)\s{2,}", line)
            label = left[1] if left else None
            if not label and i + 1 < len(lines) and (nxt := re.match(r"^\s{0,3}(\S.*?)(?:\s{2,}|\s*$)", lines[i + 1])):
                label = nxt[1]  # the band label printed on the line below its row
            rows.append((clean(label or ""), f"{match[1]} miles"))
    flush()
    return out


def _school_rows(school: str, apps, rows: list[tuple[str, str]]) -> list[Offer]:
    distances = [(label, value) for label, value in rows if value.endswith("miles")]
    if not distances:
        if rows:
            return [Offer(school=school, raw_value=rows[0][1], all_offered=True, applicants=apps)]
        return []
    return [Offer(school=school, raw_value=value, applicants=apps,
                  rule=(LABEL.search(label)[0] if LABEL.search(label) else label or None) if len(distances) > 1 else None)
            for label, value in distances]
