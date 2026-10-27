"""Review files: what was read from one council's documents for one phase and year, row by row.

parse writes ~/data/aework/admissions/review/<slug>-<phase>-<year>.csv; load reads only that
file and loads nothing while problems() finds anything:

  * a school name that matched no URN, or a cell that is neither a distance nor an outcome;
  * the same school and rule twice;
  * counts that do not add up (offers > applicants, applicants - offers != refused), or
    'all offered' with pupils refused;
  * a distance over 10 miles;
  * a year whose counts or distances repeat the previous year's for most schools (Ealing's
    2026 primary table repeats 2025's counts) — a copied table, not new data.

A problem the documents really contain is accepted per document in the config: drop_counts:
<reason> (the counts are unusable; the distances stay) or accept: [exact problem text] with a note.
"""
from __future__ import annotations

import csv
import os
from collections import Counter

REVIEW_DIR = os.environ.get("AE_ADMISSIONS_REVIEW",
                            os.path.expanduser("~/data/aework/admissions/review"))
COLUMNS = ("la", "slug", "phase", "year", "academic_year", "entry_point", "school", "urn",
           "matched_name", "rule_id", "site", "criterion", "raw_value", "distance_metres",
           "all_offered", "applicants", "offers", "refused", "measurement_method", "source_url",
           "page", "problem")
MAX_METRES = 16093  # 10 miles
MIN_REPEATED = 3


class ReviewError(SystemExit):
    pass


def review_path(slug: str, phase: str, year: int) -> str:
    return os.path.join(REVIEW_DIR, f"{slug}-{phase}-{year}.csv")


def write_review(rows: list[dict], path: str) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w", newline="") as handle:
        writer = csv.DictWriter(handle, COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: _cell(row.get(key)) for key in COLUMNS})
    os.replace(path + ".tmp", path)
    return path


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def read_review(path: str) -> list[dict]:
    """Rows with ints, bools and None restored."""
    with open(path, newline="") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        for key in ("year", "distance_metres", "applicants", "offers", "refused", "page"):
            row[key] = int(row[key]) if row[key] else None
        row["all_offered"] = {"true": True, "false": False}.get(row["all_offered"])
        for key in COLUMNS:
            if row[key] == "":
                row[key] = None
    return rows


def _counts(row: dict):
    values = (row.get("applicants"), row.get("offers"), row.get("refused"))
    return values if any(v is not None for v in values) else None


def problems(rows: list[dict], previous: list[dict] | None = None, accept: list[str] = ()) -> list[str]:
    """Everything that stops a load; empty when the rows can be loaded."""
    found = []
    if not rows:
        found.append("no rows read")
    for row in rows:
        label = f"{row.get('school')!r}" + (f" [{row['criterion']}]" if row.get("criterion") else "")
        if row.get("problem"):
            found.append(f"{label}: {row['problem']}")
        if not row.get("urn"):
            found.append(f"{label}: no URN")
        applicants, offers, refused = row.get("applicants"), row.get("offers"), row.get("refused")
        if applicants is not None and offers is not None and offers > applicants:
            found.append(f"{label}: offers {offers} > applicants {applicants}")
        if None not in (applicants, offers, refused) and applicants - offers != refused:
            found.append(f"{label}: applicants {applicants} - offers {offers} != refused {refused}")
        if row.get("all_offered") and refused:
            found.append(f"{label}: all offered but {refused} refused")
        if (row.get("distance_metres") or 0) > MAX_METRES:
            found.append(f"{label}: distance {row['distance_metres']} m over 10 miles")
    keys = Counter((row.get("urn"), row.get("rule_id"), row.get("site")) for row in rows if row.get("urn"))
    found += [f"{urn} {rule} {site}: listed {n} times" for (urn, rule, site), n in keys.items() if n > 1]
    if previous:
        found += _repeats(rows, previous)
    return [p for p in found if p not in set(accept)]


def _repeats(rows: list[dict], previous: list[dict]) -> list[str]:
    before = {(r.get("urn"), r.get("rule_id"), r.get("site")): r for r in previous if r.get("urn")}
    out = []
    for what, value in (("counts", _counts), ("distances", lambda r: r.get("distance_metres"))):
        pairs = [(value(r), value(before[key])) for r in rows
                 if (key := (r.get("urn"), r.get("rule_id"), r.get("site"))) in before and value(r) is not None]
        same = sum(1 for now, then in pairs if now == then)
        if same >= MIN_REPEATED and same * 2 > len(pairs):
            year = previous[0].get("year")
            out.append(f"{what} identical to {year} for {same} of {len(pairs)} schools")
    return out
