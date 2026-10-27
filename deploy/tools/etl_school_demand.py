"""School applications and offers per school of the coverage (England; London with
CLOSE_KNIT_ETL_COVERAGE=london), entry years 2014 to the latest (DfE).

Source: DfE "Primary and secondary school applications and offers", school-level supporting file
(OGL v3.0), one row per school, offer-day year and phase, every year since 2014/15.

  fetch               download the file once to ~/data/dfe-applications/<YYYY-MM>/ (+ .sha256)
  load [db-url]       map each covered row to the current school (GIAS: the file's URN, else its
                      LAESTAB, through predecessor/successor links) and replace this release's rows
                      in school_admission_demand; rows not loaded are listed in
                      ~/data/aework/school-history/demand-unmatched.csv

entry_year is the September of entry: time_period 202627 is entry_year 2026. Reception comes from
the primary rows (entry_year 'R'), year 7 from the secondary rows ('7'); year 9 entry is left out.
  first_preferences        times_put_as_1st_preference
  any_preferences          times_put_as_any_preferred_school
  offers                   total_number_places_offered (offers made on offer day, not capacity)
  first_preference_offers  number_1st_preference_offers
  second_preferences, third_preferences            times_put_as_2nd / 3rd_preference
  preferred_offers                                 number_preferred_offers (an offer at any preferred school)
  second_preference_offers, third_preference_offers  number_2nd / 3rd_preference_offers
The file has no published admission number, so pan stays null. Not staged in a product release.
"""
from __future__ import annotations

import csv
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date

import school_history_common as common

SOURCE = "dfe-applications"
URL = ("https://content.explore-education-statistics.service.gov.uk/api/releases/"
       "0bf4f9cf-721d-44e3-8473-266c87e17e00/files/42d0d4e4-9604-413a-8275-00b829ffbdcb")
FILENAME = "AppsandOffers_2026_SchoolLevel29062026.csv"
PUBLICATION = ("https://explore-education-statistics.service.gov.uk/find-statistics/"
               "primary-and-secondary-school-applications-and-offers/2026-27")
RELEASE_ID = "src-dfe-applications-offers-2026-27"
RELEASE_DATE = "2026-06-29"
LICENCE = "OGL-3.0"
ATTRIBUTION = ("Department for Education, Primary and secondary school applications and offers "
               "2026/27, school-level data 2014/15 to 2026/27. Contains public sector information "
               "licensed under the Open Government Licence v3.0.")
CAVEATS = [
    "offers is the number of places offered on national offer day, not the published admission number; pan is null.",
    ("Rows are mapped to the current school through GIAS predecessor/successor links (the file's URN, else its "
     "LAESTAB); rows that map to no school, or two rows that map to the same school and year, are not loaded."),
    ("Where a school also lists a second admission site under a dummy LAESTAB (99xx), only the school's own "
     "row is loaded, so its figures cover the main site only."),
    "Year 9 entry (secondary rows with entry_year 9) is left out.",
]
ETL_VERSION = "close-knit-school-demand-1"
ENTRY_POINTS = {("Primary", "R"): "reception", ("Secondary", "7"): "year7"}
# file column -> school_admission_demand column
COUNTS = {
    "times_put_as_1st_preference": "first_preferences",
    "times_put_as_any_preferred_school": "any_preferences",
    "total_number_places_offered": "offers",
    "number_1st_preference_offers": "first_preference_offers",
    "times_put_as_2nd_preference": "second_preferences",
    "times_put_as_3rd_preference": "third_preferences",
    "number_preferred_offers": "preferred_offers",
    "number_2nd_preference_offers": "second_preference_offers",
    "number_3rd_preference_offers": "third_preference_offers",
}
# EES symbols for a value that is not available (suppressed, not applicable, not collected).
MISSING = {"", "c", "x", "z", "u", "low", ":", "..", "n/a", "NA"}
UNMATCHED = os.path.join(common.DATA, "aework", "school-history", "demand-unmatched.csv")


def entry_year(time_period: str) -> int:
    """'202627' -> 2026; anything else is an error."""
    match = re.fullmatch(r"(\d{4})(\d{2})", time_period.strip())
    if not match or (int(match[1]) + 1) % 100 != int(match[2]):
        raise ValueError(f"time_period {time_period!r} is not an academic year like 202627")
    return int(match[1])


def count(value: str) -> int | None:
    value = value.strip()
    if value in MISSING:
        return None
    if not value.isdigit():
        raise ValueError(f"count {value!r} is neither a number nor a known EES symbol")
    return int(value)


def covered(row: dict) -> bool:
    return row["old_la_code"].strip().isdigit() and int(row["old_la_code"]) in common.coverage_las()


def resolve(row: dict, resolver: common.UrnResolver) -> str | None:
    """The current school for a file row. The LAESTAB is tried only when the file's URN is not a
    GIAS establishment (blank or dummy): a known URN with no current school stays unmatched."""
    urn = row["school_urn"].strip()
    if urn in resolver.establishment or urn in resolver.current:
        return resolver.resolve(urn)
    return resolver.resolve(row["school_laestab"].strip())


def site_row(row: dict) -> bool:
    """A row under a dummy LAESTAB (establishment number 99xx): an extra site or a school not yet numbered."""
    return re.fullmatch(r"\d{3}99\d{2}", row["school_laestab"].strip()) is not None


def build(rows, resolver: common.UrnResolver) -> tuple[list[dict], list[dict]]:
    """(records for school_admission_demand, rows not loaded with a reason)."""
    keyed: dict[tuple, list[tuple[dict, dict]]] = defaultdict(list)
    skipped = []
    for row in rows:
        if not covered(row):
            continue
        point = ENTRY_POINTS.get((row["school_phase"], row["entry_year"].strip()))
        if point is None:
            skipped.append({**row, "reason": "entry point not loaded (year 9 or n/a)"})
            continue
        urn = resolve(row, resolver)
        if urn is None:
            skipped.append({**row, "reason": "no current school for this URN/LAESTAB"})
            continue
        record = {"urn": urn, "entry_year": entry_year(row["time_period"]), "entry_point": point,
                  **{column: count(row[field]) for field, column in COUNTS.items()}}
        keyed[(urn, record["entry_year"], point)].append((record, row))
    records = []
    for (urn, _, _), found in keyed.items():
        # Several rows for one school and year. A second site listed under a dummy LAESTAB (99xx) gives
        # way to the school's own row; then a predecessor's row gives way to the one under the school's
        # URN. Anything still ambiguous (two schools that later merged) is left out, never summed.
        if len(found) > 1:
            main = [pair for pair in found if not site_row(pair[1])]
            skipped += [{**row, "reason": "second admission site (dummy LAESTAB) of a school with its own row",
                         "maps_to": urn} for _, row in found if main and site_row(row)]
            found = main or found
        own = [pair for pair in found if pair[1]["school_urn"].strip() == urn]
        if len(found) == 1 or len(own) == 1:
            keep = (found if len(found) == 1 else own)[0]
            records.append(keep[0])
            skipped += [{**row, "reason": "a predecessor's row in a year the school has its own", "maps_to": urn}
                        for _, row in found if row is not keep[1]]
        else:
            skipped += [{**row, "reason": "several rows map to one school and year", "maps_to": urn}
                        for _, row in found]
    records.sort(key=lambda r: (r["urn"], r["entry_year"], r["entry_point"]))
    return records, skipped


def raw_path() -> str:
    return os.path.join(common.raw_dir(SOURCE), FILENAME)


def existing() -> str | None:
    """The retrieved file from any month, newest first."""
    root = os.path.join(common.DATA, SOURCE)
    found = sorted(os.path.join(root, month, FILENAME) for month in os.listdir(root)
                   if os.path.exists(os.path.join(root, month, FILENAME))) if os.path.isdir(root) else []
    return found[-1] if found else None


def fetch() -> str:
    path = existing() or raw_path()
    sha = common.http_get(URL, path)
    print(f"fetch {path} sha256 {sha}")
    return path


def write_unmatched(skipped: list[dict]) -> None:
    os.makedirs(os.path.dirname(UNMATCHED), exist_ok=True)
    fields = ["reason", "maps_to", "time_period", "la_name", "school_phase", "entry_year", "school_urn",
              "school_laestab", "school_name"]
    with open(UNMATCHED, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(skipped)


def load(cur, path: str) -> tuple[int, list[dict]]:
    resolver = common.load_resolver(cur)
    with open(path, newline="", encoding="utf-8-sig") as handle:
        records, skipped = build(csv.DictReader(handle), resolver)
    common.register_release(cur, RELEASE_ID, URL, common.recorded_sha256(path), LICENCE, ATTRIBUTION,
                            CAVEATS, date.fromisoformat(RELEASE_DATE), ETL_VERSION)
    cur.execute("DELETE FROM school_admission_demand WHERE source_release_id = %s", (RELEASE_ID,))
    cur.executemany(
        """INSERT INTO school_admission_demand (urn, entry_year, entry_point, first_preferences,
             any_preferences, offers, first_preference_offers, second_preferences, third_preferences,
             preferred_offers, second_preference_offers, third_preference_offers, pan, source_release_id)
           VALUES (%(urn)s, %(entry_year)s, %(entry_point)s, %(first_preferences)s, %(any_preferences)s,
             %(offers)s, %(first_preference_offers)s, %(second_preferences)s, %(third_preferences)s,
             %(preferred_offers)s, %(second_preference_offers)s, %(third_preference_offers)s, NULL,
             %(release)s)""",
        [{**record, "release": RELEASE_ID} for record in records])
    write_unmatched(skipped)
    years = sorted({r["entry_year"] for r in records})
    by_point = Counter(r["entry_point"] for r in records)
    reasons = Counter(row["reason"] for row in skipped)
    print(f"load {RELEASE_ID}: {len(records)} rows, {len({r['urn'] for r in records})} schools, "
          f"entry years {years[0]}-{years[-1]}, {dict(by_point)}")
    print(f"not loaded: {len(skipped)} covered rows ({dict(reasons)}); listed in {UNMATCHED}")
    return len(records), skipped


def main(argv: list[str]) -> None:
    if len(argv) < 2 or argv[1] not in ("fetch", "load"):
        raise SystemExit(__doc__)
    path = fetch()
    if argv[1] == "fetch":
        return
    import psycopg

    with psycopg.connect(argv[2] if len(argv) > 2 else common.DEFAULT_DB_URL) as conn, conn.cursor() as cur:
        load(cur, path)


if __name__ == "__main__":
    main(sys.argv)
