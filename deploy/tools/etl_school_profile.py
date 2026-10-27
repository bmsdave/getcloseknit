"""School profile facts from GIAS that the slim London extract leaves out (migrations 055 and 099, school_profile).

Source (OGL v3.0): DfE Get Information about Schools, edubasealldata<YYYYMMDD>.csv (every establishment,
published daily). Kept: single-sex or mixed (Gender), the academy trust (Trusts), SchoolCapacity and
NumberOfPupils with the CensusDate they come from; for Visit & links (099) the school's SchoolWebsite and
TelephoneNum (the institution's published contacts) and its LAESTAB (LA code / EstablishmentNumber). Nothing
is derived here; the card divides pupils by capacity from the same row. Head teacher names are never kept.

  fetch [folder]          download the latest file (up to 7 days back) into ~/data/gias-profile/<YYYY-MM>/
                          (or folder) unless a profile-<stamp>.csv there already has every PROFILE_COLUMN,
                          keep PROFILE_COLUMNS in profile-<stamp>.csv and delete the full
                          file (it names head teachers); its sha256 is kept in sources-<stamp>.txt
  load [db-url] [folder]  one source release (src-gias-profile-<stamp>); replaces school_profile for the
                          schools in table `school` (by URN: these are facts about today's school)

  .ae-venv/bin/python deploy/tools/etl_school_profile.py fetch
  .ae-venv/bin/python deploy/tools/etl_school_profile.py load [database-url] [folder]
"""
from __future__ import annotations

import csv
import os
import sys
import urllib.error
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import school_history_common as common  # noqa: E402

SOURCE = "gias-profile"
PROFILE_COLUMNS = ("URN", "Gender (name)", "Trusts (code)", "Trusts (name)", "SchoolCapacity",
                   "NumberOfPupils", "CensusDate", "SchoolWebsite", "TelephoneNum", "LA (code)",
                   "EstablishmentNumber")
GENDERS = {"Mixed", "Girls", "Boys"}
CAVEATS = [
    "Gender is GIAS's description of the school's intake: a girls' or boys' school may admit both in the sixth form.",
    "Trust is the academy trust GIAS lists today; maintained schools have none.",
    ("Capacity is the school's capacity as last reported to DfE; pupils are GIAS's count from the census "
     "date shown, so the share of places filled is only as current as both."),
]
ETL_VERSION = "close-knit-school-profile-1"


def _stamp(path: str) -> str:
    return os.path.basename(path).removeprefix("profile-").removesuffix(".csv")


def _complete(path: str) -> bool:
    """The file has every PROFILE_COLUMN (one cut before migration 099 lacks the website and phone)."""
    with open(path, newline="") as handle:
        return set(PROFILE_COLUMNS) <= set(next(csv.reader(handle), []))


def latest(folder: str) -> str | None:
    found = sorted(f for f in os.listdir(folder) if f.startswith("profile-") and f.endswith(".csv"))
    found = [path for path in (os.path.join(folder, name) for name in found) if _complete(path)]
    return found[-1] if found else None


def fetch(folder: str, day: date | None = None, max_back: int = 7) -> str:
    """profile-<stamp>.csv in folder (downloaded once)."""
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
        out = os.path.join(folder, f"profile-{stamp}.csv")
        with open(full, newline="", encoding="cp1252") as src, open(out + ".tmp", "w", newline="") as dest:
            writer = csv.writer(dest)
            writer.writerow(PROFILE_COLUMNS)
            for row in csv.DictReader(src):
                writer.writerow([row.get(column, "") for column in PROFILE_COLUMNS])
        os.replace(out + ".tmp", out)
        with open(os.path.join(folder, f"sources-{stamp}.txt"), "w") as handle:
            handle.write(f"{sha}  edubasealldata{stamp}.csv  {url}\n")
        for path in (full, full + ".sha256"):  # personal fields: keep the sha256 in sources-<stamp>.txt
            os.remove(path)
        return out
    raise SystemExit(f"GIAS: no file in the {max_back} days to {day}")


def _int(text: str) -> int | None:
    text = (text or "").strip()
    return int(text) if text.isdigit() else None


def _laestab(row: dict) -> str | None:
    la, number = (row.get("LA (code)") or "").strip(), (row.get("EstablishmentNumber") or "").strip()
    return f"{la}/{number}" if len(la) == 3 and la.isdigit() and len(number) == 4 and number.isdigit() else None


def record(row: dict) -> dict:
    """One school_profile row from a GIAS row; blanks and 'Not applicable' stay null."""
    census = (row.get("CensusDate") or "").strip()
    gender = (row.get("Gender (name)") or "").strip()
    capacity = _int(row.get("SchoolCapacity"))
    return {
        "urn": row["URN"].strip(),
        "gender": gender if gender in GENDERS else None,
        "trust_code": (row.get("Trusts (code)") or "").strip() or None,
        "trust_name": (row.get("Trusts (name)") or "").strip() or None,
        "capacity": capacity or None,  # 0 is GIAS's "not recorded"
        "pupils": _int(row.get("NumberOfPupils")),
        "census_date": datetime.strptime(census, "%d-%m-%Y").date() if census else None,
        "website": (row.get("SchoolWebsite") or "").strip() or None,
        "telephone": (row.get("TelephoneNum") or "").strip() or None,
        "laestab": _laestab(row),
    }


def load(cur, path: str) -> int:
    stamp = _stamp(path)
    with open(os.path.join(os.path.dirname(path), f"sources-{stamp}.txt")) as handle:
        sha, _, url = handle.read().split()[:3]
    schools = {row[0] for row in cur.execute("SELECT urn FROM school").fetchall()}
    with open(path, newline="") as handle:
        records = [record(row) for row in csv.DictReader(handle) if row["URN"].strip() in schools]
    release = f"src-gias-profile-{stamp}"
    common.register_release(cur, release, url, sha, common.GIAS_LICENCE, common.GIAS_ATTRIBUTION, CAVEATS,
                            datetime.strptime(stamp, "%Y%m%d").date(), ETL_VERSION)
    cur.execute("DELETE FROM school_profile")
    cur.executemany(
        """INSERT INTO school_profile (urn, gender, trust_code, trust_name, capacity, pupils, census_date,
             website, telephone, laestab, source_release_id)
           VALUES (%(urn)s, %(gender)s, %(trust_code)s, %(trust_name)s, %(capacity)s, %(pupils)s,
             %(census_date)s, %(website)s, %(telephone)s, %(laestab)s, %(release)s)""",
        [{**r, "release": release} for r in records])
    print(f"load {release}: {len(records)} of {len(schools)} schools; "
          f"{sum(1 for r in records if r['trust_name'])} in a trust, "
          f"{sum(1 for r in records if r['gender'] in ('Girls', 'Boys'))} single-sex, "
          f"{sum(1 for r in records if r['capacity'] and r['pupils'] is not None)} with capacity and pupils, "
          f"{sum(1 for r in records if r['website'])} with a website, "
          f"{sum(1 for r in records if r['telephone'])} with a phone")
    return len(records)


def main(argv: list[str]) -> None:
    if len(argv) < 2 or argv[1] not in ("fetch", "load"):
        raise SystemExit(__doc__)
    if argv[1] == "fetch":
        print(fetch(argv[2] if len(argv) > 2 else common.raw_dir(SOURCE)))
        return
    import psycopg

    folder = argv[3] if len(argv) > 3 else common.raw_dir(SOURCE)
    path = latest(folder) or fetch(folder)
    with psycopg.connect(argv[2] if len(argv) > 2 else common.DEFAULT_DB_URL) as conn, conn.cursor() as cur:
        load(cur, path)


if __name__ == "__main__":
    main(sys.argv)
