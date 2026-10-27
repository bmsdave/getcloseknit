"""Independent (private) schools of the coverage (England; London with CLOSE_KNIT_ETL_COVERAGE=london) from GIAS for Show › Schools (migration 067, independent_school).

Source (OGL v3.0): DfE Get Information about Schools, edubasealldata<YYYYMMDD>.csv (every establishment,
published daily). Kept: every open "Other independent school" in a coverage LAD (its ONS district), with its name, statutory
ages, Gender, ReligiousCharacter, OfficialSixthForm, Postcode and Easting/Northing (British National Grid).
Independent special schools stay out (Show › Schools is for choosing a mainstream school), as do head
teachers and every other personal field: the full file is deleted once slimmed, its sha256 kept.
Nothing goes into `school`, so state-school ranks, Ofsted, cards and search are untouched.

  fetch [folder]              download the latest file (up to 7 days back) into ~/data/gias-independent/<YYYY-MM>/
                              (or folder), keep COLUMNS of the coverage's open independent schools in
                              independent-<stamp>.csv, write sources-<stamp>.txt and delete the full file
  load [db-url] [folder]      one source release (src-gias-independent-<stamp>); replaces independent_school
  sql [folder]                independent-school-<stamp>.sql: the same load as one psql transaction (production)
  stage [db-url]              stage and activate a product release with the loaded release (an earlier
                              src-gias-independent-* member is replaced)

  .ae-venv/bin/python deploy/tools/etl_independent_schools.py fetch
  .ae-venv/bin/python deploy/tools/etl_independent_schools.py load [database-url] [folder]
  .ae-venv/bin/python deploy/tools/etl_independent_schools.py stage [database-url]
"""
from __future__ import annotations

import csv
import os
import sys
import urllib.error
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import school_history_common as common  # noqa: E402

SOURCE = "gias-independent"
RELEASE_PREFIX = "src-gias-independent-"
COLUMNS = ("URN", "EstablishmentName", "EstablishmentStatus (name)", "TypeOfEstablishment (name)", "LA (code)",
           "StatutoryLowAge", "StatutoryHighAge", "Gender (name)", "ReligiousCharacter (name)",
           "OfficialSixthForm (name)", "Postcode", "Easting", "Northing", "LA (name)", "DistrictAdministrative (code)")
KIND = "Other independent school"
GENDERS = {"Mixed", "Girls", "Boys"}
# GIAS's words for "no religious character".
NO_FAITH = {"", "None", "Does not apply", "Unknown", "Not applicable"}
CAVEATS = [
    "Independent schools as GIAS lists them today: open, mainstream (special schools left out), in "
    + ("a London borough." if common.COVERAGE is common.coverage.LONDON else "England."),
    "No Ofsted grade or results are shown: most independent schools are inspected by the Independent Schools "
    "Inspectorate, and DfE's performance tables and ranks cover state schools only.",
    "Gender is GIAS's description of the intake; a girls' or boys' school may admit both in the sixth form.",
]
ETL_VERSION = "close-knit-independent-schools-1"

INSERT_SQL = """INSERT INTO independent_school (urn, name, local_authority, age_from, age_to, gender,
  religious_character, sixth_form, postcode, location, source_release_id)
VALUES (%(urn)s, %(name)s, %(local_authority)s, %(age_from)s, %(age_to)s, %(gender)s, %(religious_character)s,
  %(sixth_form)s, %(postcode)s, ST_Transform(ST_SetSRID(ST_MakePoint(%(easting)s, %(northing)s), 27700), 4326),
  %(release)s)"""


def _stamp(path: str) -> str:
    return os.path.basename(path).removeprefix("independent-").removesuffix(".csv")


def latest(folder: str) -> str | None:
    found = sorted(f for f in os.listdir(folder) if f.startswith("independent-") and f.endswith(".csv"))
    return os.path.join(folder, found[-1]) if found else None


def covered(row: dict) -> bool:
    """In a coverage LAD (GIAS's ONS district); a slim file from before that column is London's (LA code)."""
    lad = (row.get("DistrictAdministrative (code)") or "").strip()
    if lad:
        return common.COVERAGE.contains_lad(lad)
    la = (row.get("LA (code)") or "").strip()
    return la.isdigit() and int(la) in common.LONDON_LAS


def keep(row: dict) -> bool:
    """An open mainstream independent school of the coverage."""
    return (row.get("TypeOfEstablishment (name)") == KIND
            and (row.get("EstablishmentStatus (name)") or "").startswith("Open") and covered(row))


def slim(full: str, out: str) -> int:
    """COLUMNS of the kept rows of a full GIAS file (cp1252) into out; returns the row count."""
    count = 0
    with open(full, newline="", encoding="cp1252") as src, open(out + ".tmp", "w", newline="") as dest:
        writer = csv.writer(dest)
        writer.writerow(COLUMNS)
        for row in csv.DictReader(src):
            if keep(row):
                writer.writerow([row.get(column, "") for column in COLUMNS])
                count += 1
    os.replace(out + ".tmp", out)
    return count


def fetch(folder: str, day: date | None = None, max_back: int = 7) -> str:
    """independent-<stamp>.csv in folder (downloaded once)."""
    os.makedirs(folder, exist_ok=True)
    if found := latest(folder):
        return found
    day = day or date.today()
    for back in range(max_back + 1):
        stamp = (day - timedelta(days=back)).strftime("%Y%m%d")
        url = f"{common.GIAS_BASE}edubasealldata{stamp}.csv"
        full = os.path.join(folder, f"edubasealldata{stamp}.csv")
        try:
            sha = common.http_get(url, full, attempts=2)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                continue
            raise
        out = os.path.join(folder, f"independent-{stamp}.csv")
        count = slim(full, out)
        with open(os.path.join(folder, f"sources-{stamp}.txt"), "w") as handle:
            handle.write(f"{sha}  edubasealldata{stamp}.csv  {url}\n")
        for path in (full, full + ".sha256"):  # personal fields: keep the sha256 in sources-<stamp>.txt
            os.remove(path)
        print(f"fetch: {count} open independent schools ({common.COVERAGE.name})")
        return out
    raise SystemExit(f"GIAS: no file in the {max_back} days to {day}")


def _int(text: str | None) -> int | None:
    text = (text or "").strip()
    return int(text) if text.isdigit() else None


def local_authority(row: dict) -> str:
    """The LA as school.attributes.localAuthority spells it: LONDON_LAS for London, else GIAS's LA name."""
    la = (row.get("LA (code)") or "").strip()
    return common.LONDON_LAS.get(int(la)) if la.isdigit() and int(la) in common.LONDON_LAS else row["LA (name)"].strip()


def record(row: dict) -> dict | None:
    """One independent_school row from a slim GIAS row; None without a point."""
    easting, northing = _int(row.get("Easting")), _int(row.get("Northing"))
    if not easting or not northing:
        return None
    gender = (row.get("Gender (name)") or "").strip()
    faith = (row.get("ReligiousCharacter (name)") or "").strip()
    sixth = (row.get("OfficialSixthForm (name)") or "").strip()
    return {
        "urn": row["URN"].strip(),
        "name": row["EstablishmentName"].strip(),
        "local_authority": local_authority(row),
        "age_from": _int(row.get("StatutoryLowAge")),
        "age_to": _int(row.get("StatutoryHighAge")),
        "gender": gender if gender in GENDERS else None,
        "religious_character": None if faith in NO_FAITH else faith,
        "sixth_form": True if sixth == "Has a sixth form" else False if sixth == "Does not have a sixth form" else None,
        "postcode": (row.get("Postcode") or "").strip() or None,
        "easting": easting, "northing": northing,
    }


def read(path: str) -> tuple[str, str, str, list[dict], int]:
    """(release id, sha256, url, records, rows without a point) of a slim file and its sources-<stamp>.txt."""
    stamp = _stamp(path)
    with open(os.path.join(os.path.dirname(path), f"sources-{stamp}.txt")) as handle:
        sha, _, url = handle.read().split()[:3]
    with open(path, newline="") as handle:
        rows = [row for row in csv.DictReader(handle) if keep(row)]
    records = [r for r in (record(row) for row in rows) if r]
    return f"{RELEASE_PREFIX}{stamp}", sha, url, records, len(rows) - len(records)


def load(cur, path: str) -> int:
    release, sha, url, records, pointless = read(path)
    common.register_release(cur, release, url, sha, common.GIAS_LICENCE, common.GIAS_ATTRIBUTION, CAVEATS,
                            datetime.strptime(release.removeprefix(RELEASE_PREFIX), "%Y%m%d").date(), ETL_VERSION)
    cur.execute("DELETE FROM independent_school")
    cur.executemany(INSERT_SQL, [{**r, "release": release} for r in records])
    print(f"load {release}: {len(records)} independent schools, {pointless} without a point left out; "
          f"{sum(1 for r in records if r['gender'] in ('Girls', 'Boys'))} single-sex, "
          f"{sum(1 for r in records if r['sixth_form'])} with a sixth form")
    return len(records)


def _literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def sql(path: str) -> str:
    """The load as one psql script (production has no psycopg on the host): independent-school-<stamp>.sql."""
    release, sha, url, records, _ = read(path)
    caveats = "ARRAY[" + ", ".join(_literal(c) for c in CAVEATS) + "]::text[]"
    lines = ["-- etl_independent_schools.py sql: run with psql -v ON_ERROR_STOP=1 --single-transaction",
             "INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,",
             "  transformation_version, geography_vintage, validation_status, caveats)",
             f"VALUES ({_literal(release)}, {_literal(url)}, now(), "
             f"{_literal(datetime.strptime(release.removeprefix(RELEASE_PREFIX), '%Y%m%d').date().isoformat())}, "
             f"{_literal(sha)}, {_literal(common.GIAS_LICENCE)}, {_literal(common.GIAS_ATTRIBUTION)}, "
             f"{_literal(ETL_VERSION)}, '2021', 'passed', {caveats})",
             "ON CONFLICT (id) DO NOTHING;",
             "DELETE FROM independent_school;"]
    for r in records:
        values = ", ".join(_literal(r[k]) for k in ("urn", "name", "local_authority", "age_from", "age_to", "gender",
                                                     "religious_character", "sixth_form", "postcode"))
        lines.append("INSERT INTO independent_school (urn, name, local_authority, age_from, age_to, gender, "
                     "religious_character, sixth_form, postcode, location, source_release_id) VALUES "
                     f"({values}, ST_Transform(ST_SetSRID(ST_MakePoint({r['easting']}, {r['northing']}), 27700), 4326), "
                     f"{_literal(release)});")
    out = os.path.join(os.path.dirname(path), f"independent-school-{release.removeprefix(RELEASE_PREFIX)}.sql")
    with open(out, "w") as handle:
        handle.write("\n".join(lines) + "\n")
    print(f"sql {out}: {len(records)} schools")
    return out


def stage(cur) -> str | None:
    """Stage and activate one release adding the loaded independent-school source (dict rows)."""
    import stage_release

    loaded = [row["source_release_id"] for row in cur.execute(
        "SELECT DISTINCT source_release_id FROM independent_school")]
    active = {row["source_release_id"] for row in cur.execute(
        """SELECT source_release_id FROM product_release_member
           WHERE release_id = (SELECT release_id FROM active_product_release)""")}
    new = sorted(set(loaded) - active)
    if not new:
        print("independent schools: the active release already holds the loaded source")
        return None
    replace = tuple(sorted(m for m in active if m.startswith(RELEASE_PREFIX) and m not in loaded))
    return stage_release.stage(cur, "independent-schools", new, replace=replace)


def main(argv: list[str]) -> None:
    if len(argv) < 2 or argv[1] not in ("fetch", "load", "sql", "stage"):
        raise SystemExit(__doc__)
    if argv[1] == "fetch":
        print(fetch(argv[2] if len(argv) > 2 else common.raw_dir(SOURCE)))
        return
    if argv[1] == "sql":
        folder = argv[2] if len(argv) > 2 else common.raw_dir(SOURCE)
        sql(latest(folder) or fetch(folder))
        return
    import psycopg
    from psycopg.rows import dict_row

    url = argv[2] if len(argv) > 2 else common.DEFAULT_DB_URL
    if argv[1] == "stage":
        with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
            stage(cur)
        return
    folder = argv[3] if len(argv) > 3 else common.raw_dir(SOURCE)
    path = latest(folder) or fetch(folder)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        load(cur, path)


if __name__ == "__main__":
    main(sys.argv)
