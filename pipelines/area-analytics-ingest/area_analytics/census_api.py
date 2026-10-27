"""Census 2021 tables ONS publishes for small areas only through its API ("create a custom dataset").

Nomis bulk files hold detailed country of birth (TS012) for local authorities only and detailed main
language (TS024) likewise; the ONS API serves the same census for smaller areas:

  country_of_birth_190a        Country of birth (extended), 190 categories   per MSOA (refused per LSOA)
  main_language_detailed_26a   Main language (detailed), 26 categories       per LSOA

`fetch` asks for the coverage's areas (England by default, CLOSE_KNIT_ETL_COVERAGE=london for London
only; area_analytics.coverage) in batches and writes each as a Nomis-shaped zip in $AE_DATA/census
(census2021-<id>.zip holding census2021-<id>-<geography>.csv: date, geography, geography code, a total
and one column per category), so census_people reads it like any bulk table. The areas are taken
from the bulk files already there (MSOAs from TS022's csv, LSOAs from TS021's), an area being covered
when its LSOA/MSOA code lies in a covered region (coverage.region_of_code).
"Does not apply" (people outside the universe, such as children under 3 for language) is left out.

  python -m area_analytics.census_api fetch

Source: Office for National Statistics, Census 2021, licensed under the Open Government Licence v3.0.
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import time
import urllib.request
import zipfile
from dataclasses import dataclass

from . import coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
USER_AGENT = "close-knit-census/1.0"
API_URL = ("https://api.beta.ons.gov.uk/v1/population-types/UR/census-observations"
           "?area-type={geography},{codes}&dimensions={dimension}")


@dataclass(frozen=True)
class ApiTable:
    id: str
    dimension: str
    geography: str
    # The csv's column prefix and total, like a Nomis header.
    prefix: str
    total: str
    batch: int


TABLES: tuple[ApiTable, ...] = (
    ApiTable("cob190", "country_of_birth_190a", "msoa", "Country of birth (extended)",
             "Total: All usual residents", 200),
    ApiTable("lang26", "main_language_detailed_26a", "lsoa", "Main language (detailed)",
             "Total: All usual residents aged 3 years and over", 400),
)
# A bulk csv that lists every area of a geography with its name.
AREA_LISTS = {"ltla": ("ts012", "ltla"), "msoa": ("ts022", "msoa"), "lsoa": ("ts021", "lsoa")}


def _rows(data: str, table: str, geography: str) -> list[list[str]]:
    path = os.path.join(data, "census", f"census2021-{table}.zip")
    with zipfile.ZipFile(path) as archive, archive.open(f"census2021-{table}-{geography}.csv") as raw:
        reader = csv.reader(io.TextIOWrapper(raw, encoding="utf-8-sig"))
        next(reader)
        return list(reader)


def covered_areas(geography: str, data: str = DATA, cov: coverage.Coverage | None = None) -> dict[str, str]:
    """{code: name} of the coverage's areas of one geography, from the bulk files."""
    cov = cov or coverage.from_env()
    return {row[2]: row[1] for row in _rows(data, *AREA_LISTS[geography])
            if cov.contains_region(coverage.region_of_code(row[2]))}


def observations(payload: dict) -> dict[str, tuple[str, dict[str, int]]]:
    """{area code: (name, {category label: count})} from one API answer, "Does not apply" left out."""
    areas: dict[str, tuple[str, dict[str, int]]] = {}
    for entry in payload["observations"]:
        area, category = entry["dimensions"]
        if category["option_id"] == "-8":
            continue
        areas.setdefault(area["option_id"], (area["option"], {}))[1][category["option"]] = int(entry["observation"])
    return areas


def table_csv(table: ApiTable, areas: dict[str, tuple[str, dict[str, int]]]) -> str:
    """A Nomis-shaped csv: one row per area, its total the sum of its categories."""
    labels = list(next(iter(areas.values()))[1])
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["date", "geography", "geography code", f"{table.prefix}: {table.total}",
                     *(f"{table.prefix}: {label}" for label in labels)])
    for code in sorted(areas):
        name, counts = areas[code]
        if list(counts) != labels:
            raise ValueError(f"{table.id} {code}: categories differ from the first area's")
        writer.writerow([2021, name, code, sum(counts.values()), *(counts[label] for label in labels)])
    return out.getvalue()


def _get(url: str) -> dict:
    for attempt in range(4):
        try:
            # The API's firewall refuses Python's default User-Agent (Cloudflare error 1010).
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except OSError:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    raise AssertionError("unreachable")


def fetch(data: str = DATA, get=_get, cov: coverage.Coverage | None = None) -> None:
    cov = cov or coverage.from_env()
    for table in TABLES:
        codes = sorted(covered_areas(table.geography, data, cov))
        areas: dict[str, tuple[str, dict[str, int]]] = {}
        for start in range(0, len(codes), table.batch):
            batch = codes[start:start + table.batch]
            areas.update(observations(get(API_URL.format(geography=table.geography, codes=",".join(batch),
                                                         dimension=table.dimension))))
        missing = set(codes) - set(areas)
        if missing:
            raise ValueError(f"{table.id}: {len(missing)} {cov.name} areas missing from the API answers")
        path = os.path.join(data, "census", f"census2021-{table.id}.zip")
        with zipfile.ZipFile(path + ".tmp", "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(f"census2021-{table.id}-{table.geography}.csv", table_csv(table, areas))
        os.replace(path + ".tmp", path)
        print(f"fetch: {table.id} {len(areas)} {cov.name} {table.geography.upper()}s -> {path}")


if __name__ == "__main__":
    if sys.argv[1:] == ["fetch"]:
        fetch()
    else:
        sys.exit(__doc__)
