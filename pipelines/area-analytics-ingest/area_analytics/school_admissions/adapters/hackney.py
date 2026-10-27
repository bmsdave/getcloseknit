"""Hackney (204): 'Applications and offers at Hackney Primary/Secondary Schools 2018-26' compendia and
the per-year 'How places were offered' files.

Primary, community schools only (academy and VA tables print no distance), by section:
  * 2023 on, 'Applications and offers at Hackney community primary schools for Reception admissions
    <year>': places, applications, offers, offers by criterion, 'Max Distance (last child offered
    in miles)', non-preference offers. Non-preference offers or offers below the places (a school
    not capped, '**') mean the school had vacancies: all applicants were offered, and the printed
    distance is the furthest child offered, kept with all_offered.
  * 2021-2022, 'Offers at Community Schools ... Reception <year>': places, applications, offers,
    then the distance criterion as 'count (cut-off)', e.g. '43 (0.38)'; no bracket, no cut-off.
  * 2018-2020, 'Offers in <year> at Hackney Community Schools': places, applications, offers by
    criterion, '47 (0.486)'. Some names lose letters in the PDF's ligatures ('Be y Layward').
Secondary: boxes 'Offers at <School> (PAN: n Applications: m)' two or three to a row, each with a
'Band A Band B ...' header and a 'Maximum Distance (miles)' row ('*' or 'N/A*': all children in the
band were offered). The boxes are read by position (pdfplumber words): each value goes to the band
header nearest above it. The 2018-2020 section names the school at the top of the page and the year
in 'Admission to Year 7 in September <year>' above each box; 'All on-time applicants were offered a
place' stands for a whole year.
A doc's ignore_distance names schools whose printed distance is over the 10-mile review limit and not
a plausible cut-off (reason in the config); their row keeps the counts only. The config's
skip_schools leaves out closed schools printed beside the school GIAS links them to (one URN).
"""
from __future__ import annotations

import re
import unicodedata

from ..parsers import Offer, clean, parse_count, pdf_text

NUM = r"\d+(?:\.\d+)?"
ROW_2023 = re.compile(rf"^(?P<name>\S.*?)(?P<capped>\s*\*\*)?\s{{2,}}(?P<nums>(?:{NUM}\s+){{11}}{NUM})\s*$")
ROW_OLD = re.compile(r"^(?P<name>[A-Z][^\d]*?)\s*(?P<capped>\*)?\s{2,}(?P<places>\d+)\*?\s+(?P<apps>\d+)\s+(?P<rest>.*)$")
CUT = re.compile(r"\d+\s*\((\d*\.\d+)\)")


def norm(text: str) -> str:
    return unicodedata.normalize("NFKC", text)


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        if doc["phase"] == "primary":
            out += primary(norm(pdf_text(path)), doc["year"])
        else:
            out += secondary(path, doc["year"])
    ignore = doc.get("ignore_distance") or {}
    for offer in out:  # keys: 'School' or 'School / Band A'
        if offer.school in ignore or f"{offer.school} / {offer.rule}" in ignore:
            offer.raw_value = ""
    out = [offer for offer in out if offer.school not in (config.get("skip_schools") or {})]
    if not out:
        raise ValueError(f"no {doc['phase']} table for {doc['year']} found")
    return out


# --- primary ---------------------------------------------------------------------------------------

def _section(lines: list[str], start: re.Pattern, year: int) -> list[str]:
    """Lines from the heading for the year to the next heading of any year."""
    for i, line in enumerate(lines):
        joined = clean(" ".join(lines[i:i + 2]))
        found = start.search(joined)
        if found and int(found["year"]) == year and start.search(clean(line) + " " + clean(lines[i + 1])):
            for j in range(i + 2, len(lines)):
                if re.search(r"(?:Applications and offers at Hackney|Offers in 20\d\d at|Offer Summary at|"
                             r"Schools who normally offer|Back to index)", lines[j]):
                    return lines[i:j]
            return lines[i:]
    return []


def primary(text: str, year: int) -> list[Offer]:
    lines = text.splitlines()
    if year >= 2023:
        section = _section(lines, re.compile(r"community primary schools\s+for Reception admissions (?P<year>\d{4})"), year)
        return [offer for line in section if (offer := _row_2023(line))]
    if year >= 2021:
        section = _section(lines, re.compile(r"Hackney Primary Schools\s+for reception class admissions (?P<year>\d{4})"), year)
        return [offer for line in section if (offer := _row_old(line, with_offers=True))]
    section = _section(lines, re.compile(r"Offers in (?P<year>\d{4}) at Hackney Community Schools"), year)
    return [offer for line in section if (offer := _row_old(line, with_offers=False))]


def _row_2023(line: str) -> Offer | None:
    row = ROW_2023.match(line.strip())
    if not row:
        return None
    nums = row["nums"].split()
    places, apps, offers, npo = (parse_count(nums[i]) for i in (0, 1, 2, 11))
    vacancies = bool(npo) or (offers is not None and places is not None and offers < places and not row["capped"])
    return Offer(school=clean(row["name"]), raw_value=nums[10], applicants=apps, offers=offers,
                 all_offered=True if vacancies else None)


def _row_old(line: str, with_offers: bool) -> Offer | None:
    row = ROW_OLD.match(line.strip())
    if not row or row["name"].strip().lower().startswith(("primary school", "total")):
        return None
    rest = row["rest"].split()
    if with_offers and not rest:
        return None
    offers = parse_count(rest[0]) if with_offers else None
    places = parse_count(row["places"])
    cut = CUT.search(row["rest"])
    vacancies = with_offers and offers is not None and offers < places and not row["capped"]
    return Offer(school=clean(row["name"]), raw_value=cut[1] if cut else "", applicants=parse_count(row["apps"]),
                 offers=offers, all_offered=True if vacancies and not cut else None)


# --- secondary -------------------------------------------------------------------------------------

def _lines(words: list[dict]) -> list[list[dict]]:
    rows: list[list[dict]] = []
    for word in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        if rows and abs(rows[-1][0]["top"] - word["top"]) < 3:
            rows[-1].append(word)
        else:
            rows.append([word])
    return [sorted(row, key=lambda w: w["x0"]) for row in rows]


def _starts(row: list[dict], first: str, second: str) -> list[int]:
    return [i for i in range(len(row) - 1) if norm(row[i]["text"]) == first and norm(row[i + 1]["text"]).startswith(second)]


def secondary(path: str, year: int) -> list[Offer]:
    import pdfplumber

    out = []
    with pdfplumber.open(path) as pdf:
        page_year = None
        for page in pdf.pages:
            rows = _lines(page.extract_words())
            text = norm(" ".join(w["text"] for row in rows[:3] for w in row))
            if found := re.search(r"(?:admissions|Schools -|Transfer)\s+(20\d\d)\b", text):
                page_year = int(found[1])
            title = clean(norm(" ".join(w["text"] for w in rows[0]))) if rows else ""
            out += _boxes(rows, page.width, page_year, title, year)
    return out


def _headings(row: list[dict]) -> list[int]:
    """Indexes of box headings in a row: 'Offers at <School> (...)' or 'Admission to Year 7 in September <year>'."""
    return [i for i in range(len(row) - 1) if (norm(row[i]["text"]), norm(row[i + 1]["text"])) in
            (("Offers", "at"), ("Admission", "to"))]


def _boxes(rows: list[list[dict]], width: float, page_year, title: str, year: int) -> list[Offer]:
    out = []
    for r, row in enumerate(rows):
        for i in _starts(row, "Maximum", "Distance"):
            x0 = row[i]["x0"]
            heading = None
            for h in range(r - 1, -1, -1):  # the nearest heading above aligned with the label
                marks = [k for k in _headings(rows[h]) if abs(rows[h][k]["x0"] - x0) <= 25]
                if marks:
                    heading = (h, marks[0])
                    break
            if heading is None:
                continue
            h, k = heading
            above = rows[h]
            # the box ends where the next box's heading or labels start, to the right
            x1 = min([w["x0"] for between in rows[h:r + 1] for w in between
                      if w["x0"] > x0 + 60 and norm(w["text"]) in ("Offers", "Admission", "Maximum")] or [width])
            text = clean(norm(" ".join(w["text"] for w in above[k:] if w["x0"] < x1)))
            if found := re.search(r"September (20\d\d)", text):
                school, box_year = title, int(found[1])
            else:
                school = re.sub(r"^Offers at |\s*\((?:PAN|Applications).*$", "", text)
                box_year = page_year
            if box_year != year:
                continue
            bands = []
            for between in reversed(rows[:r]):
                inside = [w for w in between if x0 - 15 <= w["x0"] < x1]
                pairs = [(inside[n + 1]["text"], (w["x0"] + inside[n + 1]["x1"]) / 2) for n, w in enumerate(inside[:-1])
                         if w["text"] == "Band" and re.fullmatch(r"[A-Z]", inside[n + 1]["text"])]
                words_in = [w for w in inside if w["text"] == "Band"]
                if not pairs and len(words_in) > 1:  # 'Band' on one row, the letters on a row below
                    below = rows[rows.index(between) + 1:r]
                    letters = [w for lower in below for w in lower
                               if x0 - 15 <= w["x0"] < x1 and re.fullmatch(r"[A-Z]", w["text"])]
                    pairs = [(min(letters, key=lambda l: abs(l["x0"] - b["x0"]))["text"], (b["x0"] + b["x1"]) / 2)
                             for b in words_in] if letters else []
                if pairs:
                    bands = [(f"Band {letter}", centre) for letter, centre in pairs]
                    if len({letter for letter, _ in pairs}) < len(pairs):  # 'Foundation' / 'Community' A-D
                        groups = [w for upper in rows[h + 1:rows.index(between) + 1] for w in upper
                                  if x0 - 15 <= w["x0"] < x1 and w["text"] in ("Foundation", "Community", "Open", "Faith")]
                        bands = [(f"{min(groups, key=lambda g: abs((g['x0'] + g['x1']) / 2 - centre))['text']} Band {letter}"
                                  if groups else f"Band {letter}", centre) for letter, centre in pairs]
                    break
                if between is above:
                    break
            label_end = next(w["x1"] for w in row[i:] if norm(w["text"]).startswith("(miles)"))
            values = []
            for w in row:
                if w["x0"] <= label_end or w["x0"] >= x1:
                    continue
                if not re.fullmatch(r"\d*\.?\d+|\*|N/A\*?", norm(w["text"])):
                    break  # the next box's row
                values.append(w)
            for value in values:
                centre = (value["x0"] + value["x1"]) / 2
                band = min(bands, key=lambda b: abs(b[1] - centre))[0] if bands else None
                raw = norm(value["text"])
                offered = raw.startswith(("*", "N/A"))
                out.append(Offer(school=school, rule=band,
                                 raw_value="" if offered else raw, all_offered=True if offered else None))
    return out
