"""Quick My match criteria from data the database already holds (migration 028).

Stages (each restartable, each writes only its own rows):
  disorder   `factor_utility` rows for factor `disorder` (anti-social behaviour, criminal damage
             and arson, public order per 1,000 residents, 12 months) under the active crime
             source release, from the police.uk month files in $AE_WORK (ziprange.py output).
             etl_crime_release.py writes the same rows with every new crime release; this
             backfills the release that is already active. Ranks are within each area's region;
             LSOAs whose crime figure is suppressed (missing force-month) get no row.
  epc        `area_epc_rating` from property_epc (share of homes with an EPC rated A-C).
  step-free  `place_station.step_free` from the cached TfL StopPoint files
             ($AE_DATA/tfl/stoppoints-*.json, "AccessViaLift"; DLR and trams are step-free
             throughout); registers the TfL source release places_load.py names when missing.

  AE_WORK=~/data/aework/crime python3 etl_quick_criteria.py <stage> <database-url>

Noise and leasehold share need no stage: the API reads area_noise and area_market_depth.
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import sys
from collections.abc import Iterable, Mapping
from typing import Any

import crime_rates as cr

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
TFL_FILES = sorted(glob.glob(os.path.join(DATA, "tfl", "stoppoints-*.json")))
TFL_RELEASE = "src-tfl-stoppoints-2026-10-05"  # the release places_load.py registers for the same files
STATION_TYPES = ("NaptanMetroStation", "NaptanRailStation")
CRIME_SOURCE_RE = re.compile(r"^src-police-uk-crime-12m-\d{4}-\d{2}-(\d{4}-\d{2})(-england)?(-r\d+)?$")


def lift_access(point: Mapping[str, Any]) -> bool | None:
    value = next((prop.get("value") for prop in point.get("additionalProperties", [])
                  if prop.get("category") == "Accessibility" and prop.get("key") == "AccessViaLift"), None)
    return {"Yes": True, "No": False}.get(value)


def step_free_flags(payloads: Iterable[Any]) -> dict[str, bool]:
    """Station NaPTAN id -> step-free (lift access). A station's own flag wins; otherwise any of its
    entrances, platforms or access areas with lift access makes it step-free. No data: absent."""
    own: dict[str, bool] = {}
    parts: dict[str, list[bool]] = {}

    def visit(point: Mapping[str, Any], station: str | None) -> None:
        naptan = point.get("naptanId") or point.get("id")
        is_station = point.get("stopType") in STATION_TYPES
        flag = lift_access(point)
        if flag is not None:
            if is_station:
                own[naptan] = own.get(naptan, False) or flag
            elif station or point.get("stationNaptan"):
                parts.setdefault(station or point["stationNaptan"], []).append(flag)
        for child in point.get("children", []):
            visit(child, naptan if is_station else station)

    for payload in payloads:
        for point in payload.get("stopPoints", []) if isinstance(payload, dict) else payload:
            visit(point, None)
    flags = {naptan: any(values) for naptan, values in parts.items()}
    flags.update(own)
    return flags


# TfL: every DLR station and tram stop is step-free; their "AccessViaLift: No" means no lift is needed.
STEP_FREE_NETWORKS = ("dlr", "tram")


def station_flag(tfl_ids: Iterable[str], flags: Mapping[str, bool], modes: Iterable[str] = ()) -> bool | None:
    """True when one of a station's TfL ids lists lift access or it serves a step-free network.
    Otherwise None (not known): a station without a lift can still have level access."""
    if any(flags.get(naptan) for naptan in tfl_ids) or set(modes) & set(STEP_FREE_NETWORKS):
        return True
    return None


def crime_end(source_id: str) -> str:
    match = CRIME_SOURCE_RE.match(source_id)
    if not match:
        raise SystemExit(f"not a 12-month police.uk crime release: {source_id}")
    return match.group(1)


def stage_disorder(cur) -> None:
    import etl_crime_release as crime

    source = cur.execute("SELECT source_release_id FROM metric_definition WHERE id = 'crime'").fetchone()
    if not source:
        raise SystemExit("no crime release loaded")
    source_id = source["source_release_id"]
    end = crime_end(source_id)
    lsoas = {row["id"]: (row["official_code"], row["parent_id"]) for row in cur.execute(
        """SELECT g.id, g.official_code, g.parent_id FROM area_geography g
           JOIN metric_value m ON m.geography_id = g.id AND m.metric_id = 'crime'
            AND m.period = to_date(%s, 'YYYY-MM') AND m.value IS NOT NULL
           WHERE g.kind = 'lsoa'""", (end,))}
    codes = {code for code, _ in lsoas.values()}
    regions = {row["area_id"]: row["region_code"] for row in cur.execute(
        "SELECT area_id, region_code FROM area_region WHERE area_id LIKE 'uk:lsoa:%'")}
    monthly, _, _ = crime.load_months(cr.month_list(end, cr.WINDOW_MONTHS), codes)
    rows = cr.disorder_utilities(lsoas, monthly, crime.load_population(codes), end, regions)
    cur.execute("DELETE FROM factor_utility WHERE factor_id = 'disorder'")
    crime.copy_rows(cur, "factor_utility",
                    "geography_id, factor_id, period, utility, raw_value, unit, carrier_geography_id,"
                    " quality, source_release_id", [row + [source_id] for row in rows])
    print(f"disorder: {len(rows)} LSOA rows for the 12 months to {end} under {source_id}")


def stage_epc(cur) -> None:
    source = cur.execute("SELECT DISTINCT source_release_id FROM property_epc").fetchall()
    if len(source) != 1:
        raise SystemExit(f"expected one EPC source release, found {len(source)}")
    loaded = cur.execute("SELECT rebuild_area_epc_rating(%s) AS n", (source[0]["source_release_id"],)).fetchone()["n"]
    print(f"epc: {loaded} LSOAs in area_epc_rating under {source[0]['source_release_id']}")


def stage_step_free(cur) -> None:
    if not TFL_FILES:
        raise SystemExit(f"no TfL StopPoint files in {DATA}/tfl")
    flags = step_free_flags(json.load(open(path, encoding="utf-8")) for path in TFL_FILES)
    if cur.execute("SELECT 1 FROM source_release WHERE id = %s", (TFL_RELEASE,)).fetchone() is None:
        digest = hashlib.sha256()
        for path in TFL_FILES:
            digest.update(open(path, "rb").read())
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
                 transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, 'https://api.tfl.gov.uk/StopPoint/Mode/{mode}', now(), '2026-10-05', %s,
                 'TfL-open-data (OGL-2.0 based)', 'Powered by TfL Open Data.', 'close-knit-quick-criteria-1',
                 '2021', 'passed', %s)""",
            (TFL_RELEASE, digest.hexdigest(), ["Step-free = TfL lists lift access for the station or an entrance, "
                                                  "or it is a DLR station or tram stop."]))
    stations = list(cur.execute("SELECT id, tfl_ids, modes FROM place_station"))
    updates = [(station_flag(row["tfl_ids"] or [], flags, row["modes"] or []), row["id"]) for row in stations]
    cur.executemany("UPDATE place_station SET step_free = %s WHERE id = %s", updates)
    print(f"step-free: {sum(1 for flag, _ in updates if flag)} of {len(updates)} stations step-free")


STAGES = {"disorder": stage_disorder, "epc": stage_epc, "step-free": stage_step_free}


def main(argv: list[str]) -> None:
    if len(argv) != 3 or argv[1] not in STAGES:
        sys.exit(__doc__)
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(argv[2], row_factory=dict_row) as conn, conn.cursor() as cur:
        STAGES[argv[1]](cur)


if __name__ == "__main__":
    main(sys.argv)
