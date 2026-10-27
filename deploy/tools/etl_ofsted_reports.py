"""Ofsted report text into school_inspection.report_url / improve_text / key_findings (migration 048).

Report PDFs are not in the inspection files: each school's page on reports.ofsted.gov.uk
(/provider/21/<inspected URN>, else the category the site's search gives, e.g. 23; robots.txt
allows both) lists its reports with the inspection date. Closed schools often have no page.
A PDF is matched to an inspection by that date (start date, else the publication date when two
reports share a start date); an inspection without exactly one match is left alone.

Text is cut from `pdftotext` output by the framework's own headings, never guessed:
  * EIF 2019 / 2024: "What is it like to attend this school?" -> key_findings,
    "What does the school need to do to improve?" -> improve_text.
  * 2012-2019: "Summary of key findings for parents and pupils" (2012 Jan-Aug: "Key findings",
    2009-12: "Main findings", 2005-09: "Overall effectiveness of the school") -> key_findings,
    "What does the school need to do to improve further?" ("What the school should do to
    improve further", short-inspection letters: "Next steps for the school") -> improve_text.
  * Report cards (Nov 2025+): "What it's like to be a pupil at this school" and the text of each
    evaluation area with its grade -> key_findings, "Next steps" -> improve_text.
A section whose heading or end is not found stays NULL. Report text is Crown copyright under the
Open Government Licence v3.0: it is stored as a quotation, report_url pointing at the PDF.

Raw files: ~/data/ofsted-reports/provider/<urn>.html (.search.html) and pdf/<file id>.pdf (+ .sha256),
fetched at most one request per second with a browser User-Agent, never fetched twice, so a re-run
resumes. PDFs without a text layer (some 2008-10 reports) would need OCR; they are logged.
Per-row misses go to ~/data/aework/school-history/logs/ofsted-reports-detail.log.

  run [db-url] [--limit N]   fetch pages and PDFs of every inspected URN, extract, update rows
  load [db-url]              extract again from the files already fetched (no network)
"""
from __future__ import annotations

import html
import os
import re
import subprocess
import sys
import time
import urllib.error
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import school_history_common as common  # noqa: E402

PROVIDER_URL = "https://reports.ofsted.gov.uk/provider/21/{urn}"
SEARCH_URL = "https://reports.ofsted.gov.uk/search?q={urn}"
ROOT = os.path.join(common.DATA, "ofsted-reports")
LOG_DIR = os.path.join(common.DATA, "aework", "school-history", "logs")
PAUSE = 1.0  # seconds between requests to Ofsted

_last_request = 0.0


def polite_get(url: str, dest: str) -> str | None:
    """Download url to dest once, at most one request per PAUSE; None when Ofsted says 404/410."""
    global _last_request
    if os.path.exists(dest):
        return dest
    time.sleep(max(0.0, _last_request + PAUSE - time.monotonic()))
    try:
        common.http_get(url, dest, timeout=120)
    except urllib.error.HTTPError as error:
        if error.code in (404, 410):
            return None
        raise
    finally:
        _last_request = time.monotonic()
    return dest


# --- provider page ---------------------------------------------------------------------------

LINK = re.compile(r'<a class="publication-link"[^>]*href="(https://files\.ofsted\.gov\.uk/v1/file/(\d+))"[^>]*>(.*?)</a>'
                  r'(?=(.{0,400}))', re.S)
DAY = r"(\d{1,2} [A-Z][a-z]+ \d{4})"


def parse_day(text: str) -> date | None:
    try:
        return datetime.strptime(text, "%d %B %Y").date()
    except ValueError:
        return None


def reports(page: str) -> list[dict]:
    """Each report PDF linked on a provider page: file id, url, title, inspection and publication dates.

    The timeline gives the inspection date before the link (<p class="timeline__date">); a report
    card gives it inside the link. A report card's PDF is linked twice (page and timeline).
    """
    page = html.unescape(page)
    out: dict[str, dict] = {}
    for match in LINK.finditer(page):
        url, file_id, inner, after = match.groups()
        inside = re.search(r"<time>" + DAY + "</time>", inner)
        before = re.findall(r'timeline__date"><time>' + DAY, page[max(0, match.start() - 3000):match.start()])
        day = inside.group(1) if inside else (before[-1] if before else None)
        published = re.search(r"Published(?: on)? <time[^>]*>" + DAY, after)
        title = re.search(r'class="nonvisual">([^<,]+), (?:PDF|pdf)', inner)
        out.setdefault(file_id, {"file_id": file_id, "url": url, "title": title.group(1).strip() if title else None,
                                 "inspected": parse_day(day) if day else None,
                                 "published": parse_day(published.group(1)) if published else None})
    return list(out.values())


def match(inspection: dict, candidates: list[dict]) -> dict | None:
    """The one report of this inspection: same inspection date, else same date and publication date."""
    same_day = [r for r in candidates if r["inspected"] and r["inspected"] == inspection["start_date"]]
    if len(same_day) > 1:
        same_day = [r for r in same_day if r["published"] == inspection["publication_date"]]
    return same_day[0] if len(same_day) == 1 else None


# --- text ------------------------------------------------------------------------------------

def pdf_text(path: str, raw: bool = False) -> str:
    args = ["pdftotext", "-enc", "UTF-8"] + (["-raw"] if raw else []) + [path, "-"]
    return subprocess.run(args, capture_output=True, check=True, timeout=120).stdout.decode("utf-8", "replace")


# Symbol/Wingdings glyphs, bullets, and the 2005-06 reports' "*" bullets.
BULLET = re.compile(r"\s*(?:[\uf000-\uf0ff\u25aa\u25a0\u25cf\u2022]|\*(?= ?\w))\s*")
# Running headers and footers: "Inspection report: <school>[, dates][ N of M]", page numbers,
# the 2009-12 grade key, the 2025 report card's page furniture.
FOOTER = re.compile(r"Inspection [Rr]eport:?[^\n]*?(?:\d+ of \d+|$)|Inspect ?ion grades: 1 is[^\n]*|"
                    r"Please tur ?n to the glossary[^\n]*|Page \d+ of \d+|^\s*\d+(?: of \d+)?\s*$", re.M)


def clean(text: str) -> str:
    """Page furniture removed: footers, page numbers and the line after a bare "Inspection report:"."""
    lines = text.replace("\f", "\n").replace("­", "").split("\n")
    out, drop_next = [], False
    for line in lines:
        stripped = line.strip()
        if drop_next and stripped:
            drop_next = False
            # "Montpelier Primary School, 13–14 March 2012" or "14 and 15 November 2023"
            if re.search(r"\b(19|20)\d\d$", stripped):
                continue
        header = re.match(r"Inspection [Rr]eport:?(.*)", stripped)
        if header and not re.search(r"\d+ of \d+$|\b(19|20)\d\d$", header.group(1)):
            drop_next = True
        out.append(line)
    return FOOTER.sub("\n", "\n".join(out))


def reflow(lines: list[str]) -> str | None:
    """Wrapped lines joined into paragraphs; bullets kept one per line, as "• "."""
    items: list[tuple[bool, str]] = []  # (starts a bullet, text)
    pending = False
    for line in lines:
        parts = BULLET.split(line.strip())
        for n, part in enumerate(parts):
            part = part.strip()
            if not part:
                pending = pending or n > 0
                continue
            items.append((pending or n > 0, part))
            pending = False
        if not line.strip():
            pending = False
    width = max((len(text) for _, text in items), default=0)
    paragraphs: list[str] = []
    last_len = 0
    for bullet, text in items:
        prev = paragraphs[-1] if paragraphs else ""
        ends = prev.endswith((".", ":", "?", "!", "’", "”", ")", ";"))
        if bullet:
            paragraphs.append("• " + text)
        elif not paragraphs or (ends and last_len < 0.8 * width):
            paragraphs.append(text)
        else:
            paragraphs[-1] = prev + " " + text
        last_len = len(text)
    return "\n".join(paragraphs).strip() or None


def heading(line: str) -> str:
    return " ".join(line.split()).rstrip(":").lower()


def section(text: str, starts: tuple[str, ...], stops: tuple[str, ...], skip: tuple[str, ...] = ()) -> str | None:
    """Lines after the first heading in starts up to the next heading in stops; None if either is missing."""
    lines = text.split("\n")
    starts_l, stops_l, skip_l = [s.lower() for s in starts], [s.lower() for s in stops], [s.lower() for s in skip]
    for i, line in enumerate(lines):
        joined = heading(line + " " + lines[i + 1]) if i + 1 < len(lines) else ""
        if heading(line) in starts_l or joined in starts_l:
            body_start = i + (2 if heading(line) not in starts_l else 1)
            break
    else:
        return None
    body = []
    for j in range(body_start, len(lines)):
        line = heading(lines[j])
        if any(line == stop or (len(stop) >= 20 and line.startswith(stop)) for stop in stops_l):
            return reflow([b for b in body if heading(b) not in skip_l])
        body.append(lines[j])
    return None


# Headings that end a section (prefix match on the normalised line).
EIF_STOPS = ("what does the school do well", "what does the school need to do to improve",
             "how can i feed back my views", "background", "further information", "school details",
             "safeguarding")
OLD_STOPS = ("what does the school need to do to improve further", "what the school should do to improve further",
             "information about this inspection", "information about this school", "full report", "main report",
             "inspection judgements", "achievement and standards", "personal development and well-being",
             "effectiveness of the foundation stage", "effectiveness of the early years foundation stage",
             "outcomes for individuals and groups of pupils", "information about the school",
             "inspection team", "what inspection judgements mean", "school details", "the quality of teaching",
             "achievement of pupils", "effectiveness of leadership and management", "next steps for the school",
             "effectiveness of the sixth form", "annex a")
LETTER_STOPS = ("i am copying this letter", "yours sincerely", "information about the inspection", "evidence",
                "context", "external support", "main findings", "priorities for further improvement",
                "the school should take further action to", "additional support")
REPORT_CARD_AREAS = ("Inclusion", "Curriculum and teaching", "Achievement", "Attendance and behaviour",
                     "Personal development and wellbeing", "Early years", "Sixth form",
                     "Leadership and governance")
REPORT_CARD_GRADES = ("Exceptional", "Strong standard", "Expected standard", "Needs attention", "Urgent improvement")


def report_card(text: str) -> tuple[str | None, str | None] | None:
    """(key_findings, improve_text) of a 2025 report card, or None when text is not one."""
    if "What it's like to be a pupil at this school" not in text.replace("’", "'"):
        return None
    text = text.replace("’", "'")
    lines = [line.strip() for line in text.split("\n")]
    areas, i = [], 0
    while i < len(lines):
        if lines[i] in REPORT_CARD_AREAS:
            grade = next((lines[k] for k in range(i + 1, min(i + 4, len(lines))) if lines[k]), "")
            if grade in REPORT_CARD_GRADES:
                k = lines.index(grade, i + 1) + 1
                body = []
                while k < len(lines) and lines[k] not in REPORT_CARD_GRADES and lines[k] not in REPORT_CARD_AREAS \
                        and lines[k] != "What it's like to be a pupil at this school":
                    body.append(lines[k])
                    k += 1
                para = reflow(body)
                if para:
                    areas.append(f"{lines[i]} ({grade}): {para}")
                i = k
                continue
        i += 1
    pupil = section(text, ("What it's like to be a pupil at this school",), ("Next steps", "About this inspection",
                                                                          "Lead inspector"))
    key = "\n\n".join(([pupil] if pupil else []) + areas) or None
    improve = section(text, ("Next steps",), ("About this inspection", "Lead inspector"))
    return key, improve


class NoText(ValueError):
    """The PDF has no usable text layer (fonts without a Unicode map); it would need OCR."""


def extract(path: str) -> tuple[str | None, str | None]:
    """(key_findings, improve_text) from one report PDF; each None when its section is not found."""
    text = clean(pdf_text(path))
    if len(re.findall(r"[A-Za-z]", text)) < 0.5 * len(re.sub(r"\s", "", text)):
        raise NoText(path)
    card = report_card(text)
    if card is not None:
        return card
    key = section(text, ("What is it like to attend this school?",), EIF_STOPS)
    if key is None:
        # Two columns: the reading order is right only in pdftotext -raw.
        key = section(clean(pdf_text(path, raw=True)), ("Summary of key findings for parents and pupils",),
                      OLD_STOPS + ("information about this inspection",))
    for start in ("Key findings", "Main findings", "Overall effectiveness of the school"):
        if key is None:
            key = section(text, (start,), OLD_STOPS + LETTER_STOPS,
                          skip=("Grade", "Grade: 1", "Grade: 2", "Grade: 3", "Grade: 4"))
    improve = section(text, ("What does the school need to do to improve?",), EIF_STOPS[2:],
                      skip=("(Information for the school and appropriate authority)",))
    if improve is None:
        improve = section(text, ("What does the school need to do to improve further?",
                                 "What the school should do to improve further"), OLD_STOPS[2:])
    if improve is None:  # letters: short inspections, monitoring visits
        improve = section(text, ("Next steps for the school", "Priorities for further improvement",
                                 "The school should take further action to"), LETTER_STOPS + OLD_STOPS)
    return key, improve


# --- run -------------------------------------------------------------------------------------

def provider_path(urn: str) -> str:
    return os.path.join(ROOT, "provider", f"{urn}.html")


def pdf_path(file_id: str) -> str:
    return os.path.join(ROOT, "pdf", f"{file_id}.pdf")


def fetch_provider(urn: str) -> None:
    """The school's provider page; most are under category 21, others (e.g. 23) are found by search."""
    page, search = provider_path(urn), provider_path(urn).replace(".html", ".search.html")
    if os.path.exists(page):
        return
    if not os.path.exists(search) and polite_get(PROVIDER_URL.format(urn=urn), page):
        return
    if polite_get(SEARCH_URL.format(urn=urn), search):
        with open(search, encoding="utf-8", errors="replace") as handle:
            found = re.search(rf'href="/provider/(\d+)/{urn}"', handle.read())
        if found:
            polite_get(f"https://reports.ofsted.gov.uk/provider/{found.group(1)}/{urn}", page)


def inspections(cur) -> dict[str, list[dict]]:
    cur.execute("""SELECT urn, inspection_number, inspected_urn, start_date, publication_date
                   FROM school_inspection ORDER BY inspected_urn, start_date""")
    out: dict[str, list[dict]] = {}
    for urn, number, inspected, start, published in cur.fetchall():
        out.setdefault(inspected, []).append({"urn": urn, "inspection_number": number, "start_date": start,
                                              "publication_date": published})
    return out


def process(cur, inspected_urn: str, rows: list[dict], offline: bool, counts: dict) -> None:
    page = provider_path(inspected_urn)
    if not offline:
        fetch_provider(inspected_urn)
    if not os.path.exists(page):
        counts["no page"] = counts.get("no page", 0) + len(rows)
        return
    with open(page, encoding="utf-8", errors="replace") as handle:
        candidates = reports(handle.read())
    for row in rows:
        report = match(row, candidates)
        if report is None:
            counts["no report"] = counts.get("no report", 0) + 1
            log(f"no report {inspected_urn} {row['start_date']} {row['inspection_number']}")
            continue
        path = pdf_path(report["file_id"])
        if not offline:
            polite_get(report["url"], path)
        if not os.path.exists(path):
            counts["no pdf"] = counts.get("no pdf", 0) + 1
            continue
        try:
            key, improve = extract(path)
        except NoText:
            key = improve = None
            counts["no text layer"] = counts.get("no text layer", 0) + 1
            log(f"no text layer {path}")
        except subprocess.SubprocessError as error:
            counts["unreadable"] = counts.get("unreadable", 0) + 1
            log(f"unreadable {path}: {error}")
            continue
        counts["matched"] = counts.get("matched", 0) + 1
        counts["key_findings"] = counts.get("key_findings", 0) + (key is not None)
        counts["improve_text"] = counts.get("improve_text", 0) + (improve is not None)
        cur.execute("""UPDATE school_inspection SET report_url = %s, key_findings = %s, improve_text = %s,
                         text_extracted_at = now() WHERE urn = %s AND inspection_number = %s""",
                    (report["url"], key, improve, row["urn"], row["inspection_number"]))


def log(message: str) -> None:
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(os.path.join(LOG_DIR, "ofsted-reports-detail.log"), "a") as handle:
        handle.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {message}\n")


def run(url: str, offline: bool, limit: int | None = None) -> dict:
    import psycopg

    counts: dict = {}
    with psycopg.connect(url, autocommit=True) as conn, conn.cursor() as cur:
        todo = inspections(cur)
        failures = 0
        for n, (inspected_urn, rows) in enumerate(sorted(todo.items())[:limit], 1):
            try:
                with conn.transaction():
                    process(cur, inspected_urn, rows, offline, counts)
                failures = 0
            except (OSError, subprocess.SubprocessError) as error:  # network: log, go on; a re-run retries
                counts["error"] = counts.get("error", 0) + 1
                log(f"error {inspected_urn}: {error!r}")
                failures += 1
                if failures >= 20:
                    raise SystemExit(f"20 schools in a row failed, last: {error!r}") from error
            if n % 25 == 0 or n == len(todo):
                print(f"{datetime.now():%H:%M:%S} {n}/{len(todo)} schools {counts}", flush=True)
    print(f"ofsted-reports: {counts}", flush=True)
    return counts


def main(argv: list[str]) -> None:
    if len(argv) < 2 or argv[1] not in ("run", "load"):
        raise SystemExit(__doc__)
    args = argv[2:]
    limit = None
    if "--limit" in args:
        limit = int(args[args.index("--limit") + 1])
        del args[args.index("--limit"):args.index("--limit") + 2]
    run(args[0] if args else common.DEFAULT_DB_URL, offline=argv[1] == "load", limit=limit)


if __name__ == "__main__":
    main(sys.argv)
