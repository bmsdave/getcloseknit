"""Replace the crime metric of the active release with a rolling 12-month one.

Builds a new crime source release from the per-month police.uk extracts
written by `ziprange.py WINDOW <end>` and stages a product release that keeps
every other member of the active release, then activates it — all in one
transaction, so a failure leaves the active release untouched.

  AE_WORK=~/data/aework/crime python3 etl_crime_release.py 2026-08 \
      postgresql://close_knit@127.0.0.1:5434/close_knit [--dry-run | --bundle out.sql.gz]

--bundle reads the database (geography, regions, police force areas) but writes
nothing there: it writes a production bundle instead, one transaction that
inserts the source release, replaces every crime / disorder row and stages and
activates a release replacing earlier `src-police-uk-crime*` members.

Coverage follows CLOSE_KNIT_ETL_COVERAGE (area_coverage.from_env): England
(default) or London. Ranks (the stored "region_percentile") are within each
area's region (area_region, migration 103). A police force that did not
publish every month of a window (missing, or under half its usual rows), or a
force area with no published data at all, gets no figure for that window: its
areas are written as "suppressed" (the missing-force-month quarantine).

Inputs: $AE_WORK/crime-YYYY-MM.json for the 23 months the 12 published
periods need; $AE_DATA/population/sapelsoabroadage20222024.xlsx (ONS mid-2024
LSOA estimates, sheet "Mid-2024 LSOA 2021"). Geography and its hierarchy come
from the database (`area_geography`), so codes always match what is served.
Needs psycopg and openpyxl (the API venv plus `pip install openpyxl`).
"""
from __future__ import annotations

import hashlib
import io
import csv
import json
import os
import sys
from datetime import datetime, timezone

import area_coverage as coverage
import crime_rates as cr
import release_bundle as rb
import release_guard

WORK = os.environ.get("AE_WORK", "/tmp/aedata")
DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
POP_FILE = os.path.join(DATA, "population", "sapelsoabroadage20222024.xlsx")
POP_SHEET = "Mid-2024 LSOA 2021"
ETL_VERSION = "close-knit-crime-12m-1"
ARCHIVE_URL = "https://data.police.uk/data/archive/{m}.zip"
# A force-month with fewer rows than this share of the force's median month is a partial publication.
PARTIAL_SHARE = 0.5
FORCES_TEXT = {"london": "Metropolitan and City of London police", "england": "every police force in England"}
ATTRIBUTION = {"london": "Police.uk open data: Metropolitan Police Service, City of London Police. ",
               "england": "Police.uk open data: the police forces of England and Wales. "}


def load_population(lsoas: set[str]) -> dict[str, int]:
    import openpyxl

    sheet = openpyxl.load_workbook(POP_FILE, read_only=True, data_only=True)[POP_SHEET]
    pop = {}
    for row in sheet.iter_rows(min_row=5, values_only=True):
        if row[2] in lsoas:
            pop[row[2]] = int(str(row[4]).replace(",", ""))
    return pop


def load_months(months: list[str], lsoas: set[str]):
    """Per-month LSOA cells inside `lsoas`, {month: {force: rows or None}} and quarantined codes."""
    monthly, forces, unknown = {}, {}, {}
    for month in months:
        with open(os.path.join(WORK, f"crime-{month}.json")) as handle:
            data = json.load(handle)
        rows = data.get("force_rows") or {}
        forces[month] = {force: rows.get(force) for force in sorted(data["forces"])}
        areas = {}
        for code, cell in data["areas"].items():
            if code in lsoas:
                areas[code] = cell
            else:
                unknown[code] = unknown.get(code, 0) + cell["n"]
        monthly[month] = areas
    return monthly, forces, unknown


def force_gaps(forces: dict[str, dict[str, int | None]]) -> dict[str, list[str]]:
    """{force: months it did not publish in full}: absent, or under PARTIAL_SHARE of its median month."""
    gaps = {}
    for force in sorted(set().union(*forces.values()) if forces else ()):
        known = sorted(rows[force] for rows in forces.values() if rows.get(force) is not None)
        median = known[len(known) // 2] if known else None
        missing = [month for month, rows in sorted(forces.items())
                   if force not in rows or (median and rows[force] is not None
                                            and rows[force] < PARTIAL_SHARE * median)]
        if missing:
            gaps[force] = missing
    return gaps


def _force_rows(value) -> int:
    """Rows of one force in a cell: ziprange's per-force cell, or a bare count (earlier extracts)."""
    return value if isinstance(value, int) else value["n"] + value["asb"]


def force_areas(monthly, leaves: dict[str, list[str]], lad_pfa: dict[str, str]) -> dict[str, tuple[str, int]]:
    """{force: (police force area, rows there)}: the area (ONSPD, `lad_pfa`) where most of its rows fall.
    Forces with no rows in a known area (Welsh forces, Northern Ireland) are left out."""
    pfa_of_code = {code: lad_pfa.get(bid.rsplit(":", 1)[1]) for bid, codes in leaves.items() for code in codes}
    rows: dict[str, dict[str | None, int]] = {}
    for areas in monthly.values():
        for code, cell in areas.items():
            pfa = pfa_of_code.get(code)
            for force, value in cell.get("f", {}).items():
                by_pfa = rows.setdefault(force, {})
                by_pfa[pfa] = by_pfa.get(pfa, 0) + _force_rows(value)
    out = {}
    for force, by_pfa in sorted(rows.items()):
        pfa = max(by_pfa, key=lambda key: (by_pfa[key], key or ""))
        if pfa:
            out[force] = (pfa, by_pfa[pfa])
    return out


def borough_forces(monthly, leaves: dict[str, list[str]], lad_pfa: dict[str, str]) -> dict[str, str | None]:
    """{borough id: the police.uk force publishing for it, or None when no force does}.

    Data-driven, no list of forces: each force belongs to the police force area where most of its rows
    fall (force_areas); a borough takes the force of its area (ties: the force with more rows there).
    A force area no force belongs to (Greater Manchester publishes no street data) gets None."""
    pfa_force: dict[str, tuple[int, str]] = {}
    for force, (pfa, n) in force_areas(monthly, leaves, lad_pfa).items():
        if pfa not in pfa_force or n > pfa_force[pfa][0]:
            pfa_force[pfa] = (n, force)
    return {bid: pfa_force.get(lad_pfa.get(bid.rsplit(":", 1)[1]), (0, None))[1] for bid in leaves}


def keep_region_forces(monthly, region_of_code: dict[str, str], force_region: dict[str, str]):
    """Each LSOA's cells counting only the forces of its own region, and the offences left out.

    London's release always counted London's two forces only; England generalises that: a crime a
    force records in another region (well under 2% of any force's rows) is left out. Cells without
    per-force detail (earlier extracts) stay as they are."""
    out, dropped = {}, 0
    for month, areas in monthly.items():
        kept = {}
        for code, cell in areas.items():
            per_force = cell.get("f")
            if not per_force or any(isinstance(v, int) for v in per_force.values()):
                kept[code] = cell
                continue
            region = region_of_code.get(code)
            new = {"n": 0, "asb": 0, "cats": {}, "f": {}}
            for force, own in per_force.items():
                if force_region.get(force) != region:
                    dropped += own["n"]
                    continue
                new["f"][force] = own
                new["n"] += own["n"]
                new["asb"] += own["asb"]
                for category, n in own["cats"].items():
                    new["cats"][category] = new["cats"].get(category, 0) + n
            kept[code] = new
        out[month] = kept
    return out, dropped


def blocked_boroughs(window: list[str], forces_of: dict[str, str | None],
                     gaps: dict[str, list[str]]) -> dict[str, str]:
    """{borough id: reason} for boroughs without a complete window: no force, or a missing force-month."""
    out = {}
    for bid, force in forces_of.items():
        if force is None:
            out[bid] = "no-force-data"
        elif set(window) & set(gaps.get(force, ())):
            out[bid] = "missing-force-month"
    return out


def build(end: str, geography: list[dict], regions: dict[str, str] | None = None,
          lad_pfa: dict[str, str] | None = None):
    """Rows for metric_value, metric_value_breakdown and factor_utility.

    `regions` maps area id -> region code (ranks within each region; None ranks everything together).
    `lad_pfa` maps LAD code -> police force area code; without it no area is quarantined."""
    lsoa_rows = [g for g in geography if g["kind"] == "lsoa"]
    lsoas = {g["official_code"] for g in lsoa_rows}
    children: dict[str, list[str]] = {}
    for g in geography:
        if g["parent_id"]:
            children.setdefault(g["parent_id"], []).append(g["id"])

    def leaf_codes(gid: str) -> list[str]:
        kids = children.get(gid)
        if not kids:
            return [gid.rsplit(":", 1)[1]]
        return [code for kid in kids for code in leaf_codes(kid)]

    population = load_population(lsoas)
    periods = cr.month_list(end, cr.WINDOW_MONTHS)
    months = cr.month_list(end, cr.WINDOW_MONTHS * 2 - 1)
    monthly, forces, unknown = load_months(months, lsoas)
    parent_of = {g["id"]: g["parent_id"] for g in geography}

    def root(gid: str) -> str:
        """The area's LAD: the walk stops below the region (a LAD's parent, not in `geography`)."""
        while parent_of.get(gid) in parent_of:
            gid = parent_of[gid]
        return gid

    root_of = {g["id"]: root(g["id"]) for g in geography}
    boroughs = [g["id"] for g in geography if g["kind"] == "lad"]
    gaps = force_gaps(forces)
    leaves = {b: leaf_codes(b) for b in boroughs}
    # Extracts without per-force counts (earlier London ones) cannot say whose month is missing:
    # then every borough answers for every force, as the London release's "both forces" check did.
    per_force = any("f" in cell for areas in monthly.values() for cell in areas.values())
    forces_of = borough_forces(monthly, leaves, lad_pfa) if lad_pfa and per_force else {}
    other_region_offences = 0
    if lad_pfa and regions:
        pfa_region = {pfa: regions.get(f"uk:lad:{lad}") for lad, pfa in lad_pfa.items()
                      if regions.get(f"uk:lad:{lad}")}
        force_region = {force: pfa_region.get(pfa) for force, (pfa, _) in
                        force_areas(monthly, leaves, lad_pfa).items()}
        monthly, other_region_offences = keep_region_forces(
            monthly, {code: regions.get(f"uk:lsoa:{code}") for code in lsoas}, force_region)

    values, breakdown, utility = [], [], []
    latest_lsoa_rates = []
    totals = {}
    blocked_latest: dict[str, str] = {}
    fallbacks = 0
    fallback_details = []
    for period in periods:
        window = cr.month_list(period, cr.WINDOW_MONTHS)
        if forces_of:
            blocked = blocked_boroughs(window, forces_of, gaps)
        else:
            gap = any(set(window) & set(months_missing) for months_missing in gaps.values())
            blocked = {bid: "missing-force-month" for bid in boroughs} if gap else {}
        if period == end:
            blocked_latest = blocked
        period_rates: dict[str, float | None] = {}
        period_cells: dict[str, dict] = {}  # every kind's cell, so LSOAs can borrow their carrier's
        for kind in ("lad", "msoa", "lsoa"):  # parents first: LSOAs may fall back
            members = [g for g in geography if g["kind"] == kind]
            cells, rates, carrier = {}, {}, {}
            for g in members:
                codes = leaf_codes(g["id"]) if kind != "lsoa" else [g["official_code"]]
                cell = cr.window_cell(monthly, window, codes)
                pop = sum(population.get(c, 0) for c in codes) or None
                cell["pop"] = pop
                cells[g["id"]] = cell
                rates[g["id"]] = None if root_of[g["id"]] in blocked else cr.annual_rate(cell["count"], pop)
                carrier[g["id"]] = g["id"]
                parent = parent_of.get(g["id"])
                parent_rate = period_rates.get(parent)
                if kind == "lsoa" and cr.snap_gap(cell["count"], pop, parent_rate):
                    rates[g["id"]], carrier[g["id"]] = period_rates[parent], parent
                    if period == end:
                        fallbacks += 1
                        expected = parent_rate * pop / 1000 if (parent_rate and pop) else None
                        fallback_details.append(
                            {"code": g["official_code"], "count": cell["count"],
                             "expected": round(expected, 1) if expected is not None else None})
                    # A fallback row reads from its carrier: the headline rate is the
                    # carrier's, so the sample count and breakdown must be too. Scale
                    # the carrier's breakdown to this LSOA's population, so per-type
                    # rates (count / residents) stay consistent with the headline.
                    parent_cell = period_cells[parent]
                    scale = pop / parent_cell["pop"] if (pop and parent_cell.get("pop")) else 0
                    scaled_cats = {cat: int(round(n * scale)) for cat, n in parent_cell["cats"].items()}
                    cell = {"count": sum(scaled_cats.values()),
                            "asb": int(round(parent_cell["asb"] * scale)),
                            "cats": scaled_cats, "pop": pop}
                    cells[g["id"]] = cell
            period_cells.update(cells)
            period_rates.update(rates)
            pct = cr.ascending_percentiles(rates, regions)
            for gid, cell in cells.items():
                rate = rates[gid]
                day = f"{period}-01"
                if rate is None:
                    values.append([gid, "crime", day, "", "", "", "suppressed"])
                    continue
                quality = "observed" if carrier[gid] == gid else "fallback"
                values.append([gid, "crime", day, rate, pct[gid], cell["count"], quality])
                utility.append([gid, "crime", day, pct[gid], rate, "per 1,000", carrier[gid], quality])
                for category, n in sorted(cell["cats"].items()):
                    breakdown.append([gid, "crime", day, category, n])
                # Anti-social behaviour is an incident log, not a recorded crime, so it stays out
                # of the rate — but it is stored as its own breakdown category so the MCP can show
                # it (#163).
                breakdown.append([gid, "crime", day, "anti-social-behaviour", cell["asb"]])
                if kind == "lsoa" and period == end:
                    latest_lsoa_rates.append(rate)
            if kind == "lad":
                totals[period] = region_totals(cells, rates, regions)
    # My match "disorder" (ASB, criminal damage and arson, public order) for the latest window.
    utility += cr.disorder_utilities({g["id"]: (g["official_code"], g["parent_id"]) for g in lsoa_rows
                                      if root_of[g["id"]] not in blocked_latest},
                                     monthly, population, end, regions)
    london = totals[end].get(coverage.LONDON_REGION if regions else None)
    record = {
        "window": f"{months[0]}..{end}",
        "periods": f"{periods[0]}..{end}",
        "quarantined_unknown_codes": len(unknown),
        "quarantined_offences": sum(unknown.values()),
        "other_region_force_offences": other_region_offences,
        "lsoa_snap_gap_fallbacks_latest": fallbacks,
        "lsoa_snap_gap_fallback_codes_latest": sorted(fallback_details, key=lambda d: d["code"]),
        "missing_population": sorted(lsoas - set(population)),
        "london_latest": london,
        "london_rate_latest": round(london["offences"] / london["population"] * 1000, 1) if london else None,
        "region_rates_latest": {region or "all": round(t["offences"] / t["population"] * 1000, 1)
                                for region, t in sorted(totals[end].items(), key=lambda kv: kv[0] or "")
                                if t["population"]},
        "coverage": forces,
        "missing_force_months": gaps,
        "force_of_borough": forces_of,
        "suppressed_boroughs_latest": blocked_latest,
    }
    return values, breakdown, utility, latest_lsoa_rates, record, months


def region_totals(cells: dict[str, dict], rates: dict, regions: dict[str, str] | None) -> dict:
    """{region (None without regions): offences, asb, population} over the boroughs with a rate."""
    out: dict = {}
    for gid, cell in cells.items():
        if rates.get(gid) is None:
            continue
        total = out.setdefault((regions or {}).get(gid), {"offences": 0, "asb": 0, "population": 0})
        total["offences"] += cell["count"]
        total["asb"] += cell["asb"]
        total["population"] += cell["pop"] or 0
    return out


def lad_police_areas(cur) -> dict[str, str]:
    """{LAD code: police force area (E23) code}: the area most of the LAD's postcodes are in (ONSPD)."""
    return {row["borough_code"]: row["police_code"] for row in cur.execute(
        """SELECT DISTINCT ON (borough_code) borough_code, police_code
           FROM (SELECT borough_code, police_code, count(*) AS n FROM postcode_civic
                 WHERE police_code IS NOT NULL GROUP BY 1, 2) t
           ORDER BY borough_code, n DESC, police_code""")}


def suppressed_caveat(cur, record: dict) -> str | None:
    """A caveat naming the force areas without a figure in the latest window (from the record)."""
    lad_pfa = record.get("lad_pfa") or {}
    codes = sorted({lad_pfa.get(bid.rsplit(":", 1)[1]) for bid in record["suppressed_boroughs_latest"]} - {None})
    if not codes:
        return None
    names = [row["name"] for row in cur.execute(
        "SELECT DISTINCT ON (code) code, name FROM civic_name WHERE code = ANY(%s) ORDER BY code, name", (codes,))]
    return ("No figure where the police force did not publish every month of the 12 (latest window: "
            + ", ".join(names or codes) + ").")


def crime_definition(cov_name: str, latest: list[float], end: str, caveat: str | None) -> dict:
    """metric_definition 'crime' for this build (legend over every LSOA rate of the latest window)."""
    return {
        "label": "Recorded crime", "shortLabel": "Crime",
        "description": ("Police-recorded offences in the 12 months to the selected month, per "
                        f"1,000 residents ({FORCES_TEXT[cov_name]}). Excludes "
                        "anti-social behaviour and British Transport Police."),
        "legend": cr.legend_stops(latest),
        "sourceId": "police-uk", "sourceName": "Police.uk open data",
        "methodologyPath": "/guide/crime", "freshness": end,
        "caveats": [
            "Rolling 12 months: each month shows offences recorded in the year to that month.",
            "Published crime coordinates are deliberately anonymised and never identify a building.",
            "British Transport Police records are excluded.",
            "Anti-social behaviour is excluded from the rate (police.uk lists it separately).",
            "Population denominator: ONS mid-2024 LSOA estimates; borough/MSOA rates use summed counts and populations.",
            "City of London and West End rates use resident population; daytime footfall is far higher.",
            "police.uk places each crime at an anonymous snap point; an LSOA with fewer than "
            "20 offences in 12 months and under a tenth of the crimes its MSOA rate predicts "
            "shows the MSOA rate instead (marked fallback).",
            "Percentiles compare each area with the others of its region.",
            *filter(None, [caveat]),
        ],
    }


def source_release_row(source_id: str, end: str, checksum: str, cov_name: str) -> dict:
    return {"id": source_id, "source_url": ARCHIVE_URL.format(m=end), "release_date": f"{end}-01",
            "sha256": checksum, "licence": "OGL-3.0",
            "attribution": ATTRIBUTION[cov_name] +
            "Contains public sector information licensed under the Open Government Licence v3.0.",
            "transformation_version": ETL_VERSION,
            "caveats": ["british-transport-police-excluded", "anti-social-behaviour-excluded",
                        "rolling-12-months", "denominator-ons-mid-2024"]}


VALUE_COLUMNS = ("geography_id", "metric_id", "period", "value", "region_percentile", "sample_count", "quality",
                 "source_release_id")
BREAKDOWN_COLUMNS = ("geography_id", "metric_id", "period", "category", "offence_count", "source_release_id")
UTILITY_COLUMNS = ("geography_id", "factor_id", "period", "utility", "raw_value", "unit", "carrier_geography_id",
                   "quality", "source_release_id")
ENGLAND_LSOAS = 33755


def write_bundle(path: str, source: dict, definition: dict, values, breakdown, utility) -> None:
    """The production bundle: one transaction, idempotent (crime rows are replaced whole)."""
    src = source["id"]
    with_source = lambda rows: (row + [src] for row in rows)  # noqa: E731
    rb.write(path, [
        "BEGIN;",
        "DO $$ BEGIN IF to_regclass('public.area_region') IS NULL THEN\n"
        "  RAISE EXCEPTION 'apply deploy/migrations/103-england-geography.sql first'; END IF;\n"
        f"  IF (SELECT count(*) FROM area_geography WHERE kind = 'lsoa') < {ENGLAND_LSOAS} THEN\n"
        "  RAISE EXCEPTION 'load the England geography (bundles/core) first'; END IF; END $$;",
        rb.source_release_sql(source),
        "INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)\n"
        f"VALUES ('crime', 'lsoa', 'per 1,000', 'higher-is-more', {rb.literal(json.dumps(definition))}::jsonb, "
        f"{rb.literal(src)})\nON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition, "
        "source_release_id = EXCLUDED.source_release_id;",
        "DELETE FROM metric_value_breakdown WHERE metric_id = 'crime';",
        "DELETE FROM metric_value WHERE metric_id = 'crime';",
        "DELETE FROM factor_utility WHERE factor_id IN ('crime', 'disorder');",
        rb.copy_sql("metric_value", VALUE_COLUMNS, with_source(values)),
        rb.copy_sql("metric_value_breakdown", BREAKDOWN_COLUMNS, with_source(breakdown)),
        rb.copy_sql("factor_utility", UTILITY_COLUMNS, with_source(utility)),
        rb.stage_sql("crime-england", [src], ["src-police-uk-crime"]),
        "COMMIT;",
    ])


def copy_rows(cur, table: str, columns: str, rows: list[list]):
    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    buffer.seek(0)
    with cur.copy(f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT csv)") as copy:
        copy.write(buffer.read())


def main(argv: list[str]) -> None:
    import psycopg
    from psycopg.rows import dict_row, tuple_row

    end, url = argv[1], argv[2]
    dry_run = "--dry-run" in argv
    cov = coverage.from_env()
    source_id = f"src-police-uk-crime-12m-{cr.month_list(end, 12)[0]}-{end}"
    if cov.name != "london":
        source_id += f"-{cov.name}"
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        geography = [g for g in cur.execute(
            "SELECT id, kind::text AS kind, official_code, parent_id FROM area_geography"
            " WHERE kind IN ('lsoa', 'msoa', 'lad')")
            if cov.contains_lad(coverage.lad_of_code(g["official_code"]))]
        with conn.cursor(row_factory=tuple_row) as plain:
            regions = coverage.load_area_regions(plain)
        lad_pfa = lad_police_areas(cur)
        values, breakdown, utility, latest, record, months = build(end, geography, regions, lad_pfa)
        record["lad_pfa"] = lad_pfa
        print(json.dumps({k: record[k] for k in ("window", "periods", "london_latest",
                                                  "london_rate_latest", "region_rates_latest",
                                                  "quarantined_offences", "other_region_force_offences",
                                                  "missing_force_months",
                                                  "suppressed_boroughs_latest",
                                                  "lsoa_snap_gap_fallbacks_latest")}))
        print(f"{len(geography)} areas, {len(values)} values "
              f"({sum(1 for v in values if v[6] == 'suppressed')} suppressed), {len(breakdown)} breakdown rows, "
              f"{len(utility)} utilities")
        if dry_run:
            return
        checksum = hashlib.sha256(json.dumps(
            {"months": months, "rows": len(values), "record": record}, sort_keys=True).encode()).hexdigest()
        definition = crime_definition(cov.name, latest, end, suppressed_caveat(cur, record))
        if "--bundle" in argv:
            path = argv[argv.index("--bundle") + 1]
            write_bundle(path, source_release_row(source_id, end, checksum, cov.name), definition,
                         values, breakdown, utility)
            print(f"wrote {path} with {source_id}")
            return

        # A rebuild of the same window becomes a new revision of the source.
        taken = {row["id"] for row in cur.execute(
            "SELECT id FROM source_release WHERE id LIKE %s", (source_id + "%",))}
        revision = 1
        while (source_id if revision == 1 else f"{source_id}-r{revision}") in taken:
            revision += 1
        source_id = source_id if revision == 1 else f"{source_id}-r{revision}"
        active = cur.execute("SELECT release_id FROM active_product_release").fetchone()["release_id"]
        old = cur.execute("SELECT source_release_id FROM metric_definition WHERE id = 'crime'").fetchone()
        base = cur.execute("SELECT * FROM product_release WHERE id = %s", (active,)).fetchone()
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
        release_id = f"rel-{stamp}-crime-12m-{end}"
        source = source_release_row(source_id, end, checksum, cov.name)
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256,
                 licence, attribution, transformation_version, geography_vintage,
                 validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)""",
            (source_id, source["source_url"], source["release_date"], checksum, source["licence"],
             source["attribution"], ETL_VERSION, source["caveats"]))
        cur.execute("DELETE FROM metric_value_breakdown WHERE metric_id = 'crime'")
        cur.execute("DELETE FROM metric_value WHERE metric_id = 'crime'")
        cur.execute("DELETE FROM factor_utility WHERE factor_id IN ('crime', 'disorder')")
        with_source = lambda rows: [row + [source_id] for row in rows]  # noqa: E731
        copy_rows(cur, "metric_value",
                  "geography_id, metric_id, period, value, region_percentile, sample_count, quality,"
                  " source_release_id", with_source(values))
        copy_rows(cur, "metric_value_breakdown",
                  "geography_id, metric_id, period, category, offence_count, source_release_id",
                  with_source(breakdown))
        copy_rows(cur, "factor_utility",
                  "geography_id, factor_id, period, utility, raw_value, unit, carrier_geography_id,"
                  " quality, source_release_id", with_source(utility))

        cur.execute("""INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
                       VALUES ('crime', 'lsoa', 'per 1,000', 'higher-is-more', %s, %s)
                       ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition,
                         source_release_id = EXCLUDED.source_release_id""",
                    (json.dumps(definition), source_id))
        cur.execute(
            """INSERT INTO product_release (id, geography_vintage, transformation_versions, assets,
                 validation_status, validation_record)
               VALUES (%s, %s, %s, %s, 'passed', %s)""",
            (release_id, base["geography_vintage"],
             json.dumps({**base["transformation_versions"], "crime": ETL_VERSION}),
             json.dumps(base["assets"]),
             json.dumps({**record, "supersedes": active,
                         "replaced_crime_source": old["source_release_id"] if old else None})))
        cur.execute(
            """INSERT INTO product_release_member (release_id, source_release_id)
               SELECT %s, source_release_id FROM product_release_member
               WHERE release_id = %s AND source_release_id <> %s
               UNION SELECT %s, %s""",
            (release_id, active, old["source_release_id"] if old else "", release_id, source_id))
        live = release_guard.activate(cur, release_id)  # stage only inside an etl.py run
        print(f"{'activated' if live else 'staged'} {release_id} with {source_id}: {len(values)} values, "
              f"{len(breakdown)} breakdown rows, {len(utility)} utilities")


if __name__ == "__main__":
    main(sys.argv)
