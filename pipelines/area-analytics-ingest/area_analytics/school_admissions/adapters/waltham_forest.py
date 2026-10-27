"""Waltham Forest (320): 'How Places were Offered on National Offer Day' PDFs (reception every
year, secondary 2026) and, for secondary 2020-2025, the 'Starting Secondary School' brochures'
'Cut off distances in miles for past three years' table. Read as text (pdftotext -layout).

Offer-day tables: one line per school, offers per criterion, LA alternative offers, places
available and last the 'Cut off Distance' in miles ('.454'; 'n/a' where no place went on
distance, kept as printed). A second site prints as '<School> (Site 2)' or, for Hillyfield to 2021,
'Hillyfield At The Park ACD' / 'On The Hill ACD'. A starred cut-off
('.143*') carries the footnote as its criterion. Eden Girls' School prints two cut-offs, from
the school and from the station ('School 1.654, Station 1.399'): one row each.

Brochure table: columns are academic years ('2022/23'); the configured year of entry's column
is read by position. 'Where no cut off distance is shown for a school this means that all
applicants who applied on time were offered a place', so a blank is all offered. A cut-off with
a catchment figure ('1.282 (catchment - 1.172)', Chingford Foundation) gives a 'catchment' row.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, pdf_text

TITLE = re.compile(r"National Offer Day \((?:Pre-school to Reception|Primary to Secondary) (\d{4})\)")
SITE = re.compile(r"^(?P<school>.+?)\s*(?:\((?P<site>Site \d+)\)|(?P<named>At The Park|On The Hill) ACD)$")
VALUE = re.compile(r"^(?:\d*\.\d+\*?|n/a)$", re.I)
FOOTNOTE = re.compile(r"^\*\s*(.+)$")
POINTS = re.compile(r"(School|Station) (\d*\.\d+)")
CATCHMENT = re.compile(r"(\d*\.\d+)\s*\(catchment\s*-\s*(\d*\.\d+)\)", re.I)


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    year = int(doc["year"])
    for path in files:
        text = pdf_text(path)
        if "Cut off distances in miles for past three years" in text and doc["phase"] == "secondary" \
                and not TITLE.search(text[:3000]):
            out += brochure(text, year)
            continue
        found = {int(y) for y in TITLE.findall(text)}
        if found != {year}:
            raise ValueError(f"{path}: offer-day years {sorted(found)}, configured {year}")
        out += offer_day(text)
    return out


def offer_day(text: str) -> list[Offer]:
    out, notes = [], {}
    lines = text.splitlines()
    for line in lines:
        if note := FOOTNOTE.match(line.strip()):
            notes["*"] = clean(note[1])
    for i, line in enumerate(lines):
        cells = [c for c in re.split(r"\s{2,}", line.strip()) if c]
        if len(cells) < 6 or not re.match(r"^[A-Z]", cells[0]) or cells[0] in ("BASE NAME", "Total") \
                or not re.match(r"^\d+$", cells[1]):
            continue
        name, site = clean(cells[0]), "main"
        if found := SITE.match(name):
            name, site = found["school"], re.sub(r"[^a-z0-9]+", "-", (found["site"] or found["named"]).lower())
        if "School" in cells[-1] and (points := POINTS.findall(line + " " + (lines[i + 1] if i + 1 < len(lines) else ""))):
            out += [Offer(school=name, raw_value=value, rule=rule, site=site) for rule, value in points]
            continue
        raw = cells[-1]
        if not VALUE.match(raw):  # a row broken by a page: its cut-off follows a few lines down
            raw = next((clean(x) for x in lines[i + 1:i + 4] if VALUE.match(clean(x))), raw)
        star = raw.endswith("*")
        out.append(Offer(school=name, raw_value=raw.rstrip("*"), criterion=notes.get("*") if star else None, site=site))
    return out


def brochure(text: str, year: int) -> list[Offer]:
    label = f"{year}/{(year + 1) % 100:02d}"
    section = text[text.index("Cut off distances in miles for past three years\n"):] \
        if "Cut off distances in miles for past three years\n" in text else ""
    section = section[:section.find("Where no cut off distance")] if "Where no cut off distance" in section else section
    out, header, pending, last = [], None, [], None
    for line in section.splitlines():
        years = list(re.finditer(r"(\d{4})/(?:\d{2})?(\d{2})\b", line))
        if len(years) == 3:
            header = [(m.start() + len(m.group()) / 2, f"{m[1]}/{m[2]}") for m in years]
            if label not in [h[1] for h in header]:
                raise ValueError(f"brochure columns {[h[1] for h in header]}, configured {label}")
            continue
        if header is None or not line.strip():
            continue
        name = clean(re.split(r"\s{2,}", line.strip())[0])
        if not re.match(r"^[A-Z]", name) or name == "School" or POINTS.match(name):
            name = ""
        values = {}
        for m in CATCHMENT.finditer(line):  # '1.282 (catchment - 1.172)': the catchment cut-off too
            centre = m.start(1) + len(m.group(1)) / 2
            values.setdefault("catchment", {})[min(header, key=lambda h: abs(h[0] - centre))[1]] = m.group(2)
        line = CATCHMENT.sub(lambda m: m.group(1) + " " * (len(m.group(0)) - len(m.group(1))), line)
        for m in re.finditer(r"(?:(School|Station) )?(\d*\.\d+)", line):
            centre = m.start(2) + len(m.group(2)) / 2
            column = min(header, key=lambda h: abs(h[0] - centre))[1]
            values.setdefault(m.group(1), {})[column] = m.group(2)
        if name:
            last = {"name": name, "values": values}
            for extra in pending:
                last["values"].update(extra)
            pending = []
            out.append(last)
        elif values and not name:
            if "School" in values:
                pending.append(values)  # Eden Girls': the figure from the school prints above the name
            elif last is not None:
                last["values"].update(values)  # ... and the one from the station below it
    rows = []
    for school in out:
        found = {rule: v[label] for rule, v in school["values"].items() if label in v}
        if not found:  # nothing printed for the year: all on-time applicants offered
            rows.append(Offer(school=school["name"], raw_value="", all_offered=True))
        rows += [Offer(school=school["name"], raw_value=value, rule=rule) for rule, value in found.items()]
    return rows
