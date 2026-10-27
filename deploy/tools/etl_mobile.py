"""Mobile coverage per local authority (migration 086): Ofcom Connected Nations, OGL v3.

  Ofcom publishes mobile coverage for local authorities and constituencies only (no postcode or
  output-area file), so the LAD ("borough") is the finest grain. Every LAD in the coverage is kept
  (area_analytics.coverage: England by default, CLOSE_KNIT_ETL_COVERAGE=london). From the local-authority file:
  shares of premises with predicted 4G outdoors and indoors from all four networks, and 5G outdoors
  from at least one and from all four (Ofcom's high-confidence level). Then
  rebuild_area_mobile_metrics() writes the `mobile-4g-indoor` and `mobile-5g-outdoor` map layers and
  a product release is staged with the new source.

  AE_WORK=~/data/aework/mobile python3 etl_mobile.py download
  AE_WORK=~/data/aework/mobile python3 etl_mobile.py load <database-url>

Needs psycopg for load; download and parsing are stdlib only.
"""
from __future__ import annotations

import csv
import hashlib
import io
import os
import re
import sys
import urllib.request
import zipfile
from datetime import date

import area_coverage as coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "mobile"))
ETL_VERSION = "close-knit-mobile-1"
PAGE = "https://www.ofcom.org.uk/phones-and-broadband/coverage-and-speeds/connected-nations-update-spring-2026"
FILES = {
    "mobile-coverage.zip": ("https://www.ofcom.org.uk/siteassets/resources/documents/research-and-data/multi-sector/"
                            "infrastructure-research/connected-nations-spring-2026/202601_mobile_coverage_r1.zip"),
}
PERIOD = date(2026, 1, 1)  # the spring 2026 update describes coverage in January 2026
# Each column is the % of premises served by exactly N of the four networks; blank means 0.
COLUMNS = {"outdoor_4g_all_mno": "4G_prem_out_4", "indoor_4g_all_mno": "4G_prem_in_4",
           "no_outdoor_5g": "5G_high_confidence_prem_out_0", "outdoor_5g_all": "5G_high_confidence_prem_out_4"}
ATTRIBUTION = ("Ofcom Connected Nations, spring 2026 update (January 2026 coverage). Contains public sector "
               "information licensed under the Open Government Licence v3.0.")
CAVEATS = ["Predicted coverage from the networks' models, not measured speed.",
           "Ofcom publishes mobile coverage per local authority only: every neighbourhood shows its council area's "
           "figure."]


def path(name: str) -> str:
    return os.path.join(WORK, name)


def download() -> None:
    os.makedirs(WORK, exist_ok=True)
    for name, url in FILES.items():
        target = path(name)
        if not os.path.exists(target):
            request = urllib.request.Request(url, headers={"User-Agent": "close-knit-etl"})
            with urllib.request.urlopen(request, timeout=900) as response, open(target + ".tmp", "wb") as handle:
                while chunk := response.read(1 << 20):
                    handle.write(chunk)
            os.replace(target + ".tmp", target)
        print(f"download: {name} {os.path.getsize(target) // 1024} KiB sha256 {sha256(name)}", flush=True)


def sha256(name: str) -> str:
    digest = hashlib.sha256()
    with open(path(name), "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def _share(text: str | None) -> float:
    return round(min(100.0, max(0.0, float(text))) / 100, 4) if text not in ("", None) else 0.0


def ofcom_boroughs(source, cov: coverage.Coverage | None = None) -> dict[str, tuple[int, float, float, float, float]]:
    """LAD in the coverage -> (premises, outdoor 4G all, indoor 4G all, outdoor 5G any, outdoor 5G all)."""
    cov = cov or coverage.from_env()
    with zipfile.ZipFile(source) as archive:
        names = [name for name in archive.namelist() if re.search(r"_mobile_coverage_laua_r\d+\.csv$", name)]
        if len(names) != 1:
            raise SystemExit(f"Ofcom zip: expected one local-authority file, found {names}")
        with archive.open(names[0]) as raw:
            reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))
            missing = {"laua", "prem_count", *COLUMNS.values()} - set(reader.fieldnames or ())
            if missing:
                raise SystemExit(f"Ofcom mobile: columns missing {sorted(missing)}")
            out = {}
            for row in reader:
                if cov.contains_lad(row["laua"]) and int(float(row["prem_count"] or 0)) > 0:
                    share = {key: _share(row[column]) for key, column in COLUMNS.items()}
                    out[row["laua"]] = (int(float(row["prem_count"])), share["outdoor_4g_all_mno"],
                                        share["indoor_4g_all_mno"], round(1 - share["no_outdoor_5g"], 4),
                                        share["outdoor_5g_all"])
            return out


def load(url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    cov = coverage.from_env()
    boroughs = ofcom_boroughs(path("mobile-coverage.zip"), cov)
    missing = sorted(cov.lad_codes - set(boroughs))
    if missing:
        raise SystemExit(f"Ofcom mobile: {len(missing)} of {len(cov.lad_codes)} LADs missing: {missing[:10]}")
    digest = sha256("mobile-coverage.zip")
    scope = "" if cov.name == "london" else f"-{cov.name}"  # a new release beside the London-only one
    release_id = f"src-ofcom-mobile-2026-spring{scope}-{digest[:12]}"
    print(f"load: mobile-coverage.zip sha256 {digest}", flush=True)
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
                 transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s) ON CONFLICT (id) DO NOTHING""",
            (release_id, FILES["mobile-coverage.zip"], PERIOD, digest, ATTRIBUTION, ETL_VERSION, CAVEATS))
        old = sorted({row["source_release_id"] for row in cur.execute("SELECT DISTINCT source_release_id FROM area_mobile")}
                     - {release_id})
        cur.execute("DELETE FROM area_mobile")
        with cur.copy("COPY area_mobile (geography_id, premises, outdoor_4g_all_mno, indoor_4g_all_mno, outdoor_5g_any, "
                      "outdoor_5g_all, source_release_id) FROM STDIN") as copy:
            for code, values in sorted(boroughs.items()):
                copy.write_row((f"uk:lad:{code}", *values, release_id))
        metrics = cur.execute("SELECT rebuild_area_mobile_metrics(%s, %s) AS n", (release_id, PERIOD)).fetchone()["n"]
        stage_release.stage(cur, "mobile", [release_id], replace=tuple(old))
        print(f"mobile: {len(boroughs)} boroughs, {metrics} metric values, release {release_id}")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "load" and len(sys.argv) == 3:
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
