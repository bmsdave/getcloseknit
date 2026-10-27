"""Redbridge (317): 'Admission to Reception Class/Junior Transfer <year>' sheets and 'Transfer to
Secondary School' letters, prose lists with no counts (read as text, pdftotext -layout).

Reception: a school's name on its own line, then one line per criterion band with the distance
of the last child offered on national offer day ('Sibling: All on time sibling applications
offered   1.258 miles', 'Muslim - Distance   0.075 miles', 'None Offered'), or 'All On Time
Applicants Offered' for the whole school; a blank line ends the school's block (in 2021-2023 some
names are drawn without text, so their rows are dropped rather than given to the school above).
Each band with a figure becomes a row whose rule is the
band (the words before ':' when there is one); bands without a figure, late applications and
second figures under one band (Wanstead Church School) are not read. Junior schools follow
'TRANSFER TO JUNIOR SCHOOL' and admit into year 3.

Secondary: one paragraph per school, '<School>*: All on time ... applicants have been offered up
to 2.388 miles' or '... at a distance of 1119 metres (this school uses their own measurements)';
the figure with its unit is the value and the paragraph the criterion. A paragraph that is only
'All on time applicants/applications offered' means all offered; anything else without a
distance (Ilford County High's score, offers 'in order of oversubscription criteria') gives no
row.

Scanned sheets are read with tesseract at 300, 350 and 400 dpi and a row is kept only when two
readings agree on it and no two agree on another value for the same band.
"""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
from collections import Counter

from ..parsers import ALL_OFFERED, Offer, clean, pdf_text

TITLE = re.compile(r"(?:JUNIOR TRANSFER|Transfer to Secondary School|Year 7 places in September|"
                   r"School Places as at \d+ \w+)\s*(\d{4})", re.I)
VALUE = re.compile(r"(?:\s{2,}(?P<value>\d*\.?\d+\s*(?:miles?|metres)?|None(?: offered)?|All Applicants)|"
                   r"\s(?P<scanned>\d*\.\d+\s*(?:miles?|metres)))\s*$", re.I)  # OCR keeps one space
SKIP = re.compile(r"^(?:Please|Late Applications|All distances|It is|The following|ADMISSION TO|Admission to)", re.I)
DISTANCE = re.compile(r"(\d*\.?\d+)\s*(miles?|metres)\b", re.I)
PARAGRAPH = re.compile(r"^(?P<school>[A-Z][A-Za-z'’. -]+?)\s*[*”\"'?]*\s*:\s*(?P<text>.*)$")  # OCR reads * as ”
ONLY_ALL = re.compile(r"^All on[- ]time applica(?:nts|tions) offered\b(?!.*(?:order|further breakdown))", re.I)


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        if doc.get("format") == "scanned-pdf":
            readings = [ocr(path, dpi) for dpi in (300, 350, 400)]
            check(path, readings[0], doc)
            out += agreed([read(text, doc["phase"]) for text in readings])
        else:
            text = pdf_text(path)
            check(path, text, doc)
            out += read(text, doc["phase"])
    return out


def _key(offer: Offer) -> tuple:
    return offer.school, offer.rule, offer.raw_value, offer.entry_point


def agreed(readings: list[list[Offer]]) -> list[Offer]:
    """Rows at least two OCR readings give alike, unless two readings agree on another value."""
    votes = Counter(key for rows in readings for key in dict.fromkeys(_key(o) for o in rows))
    winners = Counter(key[:2] + key[3:] for key, n in votes.items() if n >= 2)
    first = {}
    for rows in readings:  # in reading order, so the result does not depend on hashing
        for o in rows:
            first.setdefault(_key(o), o)
    return [o for key, o in first.items() if votes[key] >= 2 and winners[key[:2] + key[3:]] == 1]


def check(path: str, text: str, doc: dict) -> None:
    years = {int(y) for y in TITLE.findall(clean(text[:3000]))}
    if int(doc["year"]) not in years or len(years) > 1:
        raise ValueError(f"{path}: title years {sorted(years)}, configured {doc['year']}")


def read(text: str, phase: str) -> list[Offer]:
    return reception(text) if phase == "primary" else secondary(text)


def reception(text: str) -> list[Offer]:
    out, school, entry, rules = [], None, None, set()
    started = False
    for line in text.splitlines():
        stripped = clean(line)
        if not stripped:
            if rules:
                school = None  # a blank line ends a school's block: rows after it need a new name line
            continue
        if "TRANSFER TO JUNIOR" in stripped.upper() and "ADMISSION" not in stripped.upper():
            entry, school = "year3", None
            continue
        if stripped.upper() == "ADMISSION TO RECEPTION CLASS" or stripped.startswith("All distances shown"):
            started = True
            continue
        value = VALUE.search(line)
        indent = len(line) - len(line.lstrip())
        if not value and ALL_OFFERED.search(stripped) and school and re.match(r"^All on[- ]time applica", stripped, re.I):
            if None not in rules:
                rules.add(None)
                out.append(Offer(school=school, raw_value=stripped.rstrip("*"), entry_point=entry))
            continue
        if started and not value and indent <= 2 and ":" not in stripped and not SKIP.match(stripped) \
                and not ALL_OFFERED.search(stripped) and re.match(r"^[A-Z]", stripped):
            school, rules = stripped, set()
            continue
        if not value or not school or not started or SKIP.match(stripped):
            continue
        label = clean(line[:value.start()])
        if not label:
            continue  # a second figure under the band above: not attributable
        rule = clean(re.sub(r"\s*\boffered to$", "", label.split(":")[0]))
        if rule in rules:
            continue
        rules.add(rule)
        out.append(Offer(school=school, raw_value=clean(value["value"] or value["scanned"]), criterion=label, rule=rule,
                         entry_point=entry))
    return out


def secondary(text: str) -> list[Offer]:
    paragraphs, out = [], []
    for line in text.splitlines():
        stripped = clean(line)
        if not stripped:
            continue
        head = PARAGRAPH.match(stripped)
        if head and re.search(r"(?:School|Academy|Trust|College|Ilford)\s*$", head["school"]):
            paragraphs.append([head["school"].strip(), head["text"]])
        elif paragraphs and not re.match(r"^\d{4}:", stripped):
            paragraphs[-1][1] += " " + stripped
    for school, sentence in paragraphs:
        sentence = clean(sentence)
        found = DISTANCE.findall(sentence)
        if len(found) == 1:
            out.append(Offer(school=school, raw_value=" ".join(found[0]), criterion=sentence))
        elif ONLY_ALL.match(sentence):
            out.append(Offer(school=school, raw_value=ONLY_ALL.match(sentence)[0], criterion=sentence))
    return out


def ocr(path: str, dpi: int) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-r", str(dpi), "-png", path, os.path.join(tmp, "page")], check=True)
        pages = []
        for image in sorted(os.listdir(tmp)):
            pages.append(subprocess.run(["tesseract", os.path.join(tmp, image), "-", "--psm", "4"], check=True,
                                        capture_output=True, text=True).stdout)
        return "\f".join(pages)
