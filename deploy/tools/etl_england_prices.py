"""Area-level prices and housing for every English area from national files (England, 2026-10).

London's price layers are built from per-home tables (`sale`, `address`, `property`; etl_sales.py,
etl_price_release.py). Those stay London-only (decision 5: no per-home data for England on prod).
This tool builds the same AREA tables for England straight from the national files, with sales placed
by postcode (ONSPD -> 2021 LSOA) instead of by UPRN, and EPC floor areas linked by the shared
tolerant matcher (area_analytics.epc_link). Only area rows are written; nothing per home is stored.

Stages (restartable; work files in $AE_WORK, default ~/data/england-2026-10/prices):
  postcodes      ONSPD -> postcodes.tsv.gz: every English postcode (live and terminated) with its LSOA
  link           EPC certificates (domestic-csv.zip, one CSV a year) and Price Paid (pp-complete.csv), read
                 in AE_PASSES (12) groups of postcode areas so RAM stays small; each sale is linked to its
                 EPC floor area (same postcode; the sibling-postcode fallback only for new builds) ->
                   link/sales-NN.tsv.gz  per English sale: LSOA, date, price, type, new build, tenure,
                                         category, floor area, postcode, dwelling key (a hash), PPD street
                   epc-lsoa.tsv          per LSOA: dwellings with an EPC (latest certificate), A-C rated
                 Work files only: no address or sale leaves this machine.
  london-linked  link/sales-*.tsv.gz -> $AE_DATA/price-linked.sqlite: London's sales with a floor area, the
                 input of London's per-home £/m² index (etl_price_release.py)
  aggregate URL  link/sales-*.tsv.gz -> out/*.csv, the area tables (england_price_tables.py; the URL is
                 read for cpih_month and OS Open Names street names)
  bundle URL     $AE_BUNDLE/load.sql.gz (default ~/data/england-2026-10/bundles/prices): one transaction
                 that adds every area outside London (London keeps its address-level build), copies the
                 national HPI / PIPR / CTSOP loads from the ETL database and stages a product release.
                 The ETL database is loaded by applying this same file (README in the bundle dir).

  AE_WORK=~/data/england-2026-10/prices python3 etl_england_prices.py postcodes | link | london-linked
  python3 etl_england_prices.py aggregate|bundle postgresql://...
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import multiprocessing
import os
import sys
import time
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))
import area_coverage as coverage  # noqa: E402
import epc_bulk  # noqa: E402
from area_analytics.epc_link import (  # noqa: E402
    EpcRecord,
    _find,
    _sector_groups,
    address_tokens,
    canonical_tokens,
    compact_postcode,
)

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "england-2026-10", "prices"))
PP_COMPLETE = os.environ.get("AE_PPD", os.path.join(DATA, "hmlr", "pp-complete.csv"))
EPC_ZIP = epc_bulk.source()  # domestic-csv.zip or its unzipped folder
ONSPD_ZIP = os.environ.get("AE_ONSPD_ZIP", os.path.join(DATA, "civic", "ONSPD_AUG_2026.zip"))
POSTCODES = os.path.join(WORK, "postcodes.tsv.gz")
LINK_DIR = os.path.join(WORK, "link")              # per pass: sales-NN.tsv.gz, ratings-NN.tsv, stats-NN.tsv
EPC_LSOA = os.path.join(WORK, "epc-lsoa.tsv")
PASSES = int(os.environ.get("AE_PASSES", "12"))
RECENT_FROM = os.environ.get("AE_RECENT_FROM", "2021-01")  # keep dwelling key and street from here (disk)
WORKERS = int(os.environ.get("AE_WORKERS", "4"))
SALES_COLUMNS = ("lsoa", "date", "price", "ptype", "new_build", "tenure", "category", "floor",
                 "postcode", "dwelling", "street")


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {message}", flush=True)


def postcode_area(postcode: str) -> str:
    """The letters before the first digit: "SW1A 1AA" -> "SW", "B1 1AA" -> "B"."""
    out = []
    for char in postcode:
        if not char.isalpha():
            break
        out.append(char)
    return "".join(out).upper()


# --- postcodes ---------------------------------------------------------------------------------

def stage_postcodes() -> None:
    """Every English postcode in ONSPD (live and terminated: old sales use terminated ones)."""
    cov = coverage.from_env()
    lookup = coverage.lsoa_lookup()
    os.makedirs(WORK, exist_ok=True)
    kept = 0
    with zipfile.ZipFile(ONSPD_ZIP) as archive, gzip.open(POSTCODES + ".tmp", "wt") as out:
        member = next(name for name in archive.namelist()
                      if name.startswith("Data/ONSPD_") and name.endswith("_UK.csv"))
        with archive.open(member) as raw:
            reader = csv.reader(io.TextIOWrapper(raw, encoding="utf-8-sig"))
            header = next(reader)
            at = {name: index for index, name in enumerate(header)}
            for row in reader:
                lsoa = row[at["lsoa21cd"]]
                entry = lookup.get(lsoa)
                if entry is None or not cov.contains_lad(entry[1]):
                    continue
                pcds = row[at["pcds"]]
                live = "0" if row[at["doterm"]].strip() else "1"
                out.write(f"{compact_postcode(pcds)}\t{pcds}\t{lsoa}\t{row[at['east1m']]}\t"
                          f"{row[at['north1m']]}\t{live}\n")
                kept += 1
    os.replace(POSTCODES + ".tmp", POSTCODES)
    log(f"postcodes: {kept} {cov.name} postcodes -> {POSTCODES}")


def load_postcodes() -> dict[str, tuple[str, str]]:
    """{compact postcode: (formatted postcode, LSOA code)}."""
    found = {}
    with gzip.open(POSTCODES, "rt") as handle:
        for line in handle:
            compact, pcds, lsoa, _east, _north, _live = line.rstrip("\n").split("\t")
            found[compact] = (pcds, lsoa)
    return found


# --- link --------------------------------------------------------------------------------------

def plan_passes(postcodes: dict[str, tuple[str, str]], passes: int) -> list[frozenset[str]]:
    """Postcode areas split into `passes` groups of about equal postcode counts."""
    weight = Counter(postcode_area(compact) for compact in postcodes)
    groups: list[set[str]] = [set() for _ in range(passes)]
    loads = [0] * passes
    for area, count in weight.most_common():
        smallest = loads.index(min(loads))
        groups[smallest].add(area)
        loads[smallest] += count
    return [frozenset(group) for group in groups if group]


def _epc_year(args: tuple[str, str, frozenset[str]]) -> tuple[str, list[tuple]]:
    """(member, rows) for one EPC year file: England certificates in the pass's postcode areas.
    Row: (compact postcode, uprn, address1, address2, address3, lodgement date, rating, floor)."""
    zip_path, member, areas = args
    lads = coverage.from_env().lad_codes
    rows = []
    with epc_bulk.open_text(zip_path, member) as handle:
        reader = csv.reader(handle)
        header = next(reader)
        at = {name: index for index, name in enumerate(header)}
        i_pc, i_la, i_uprn = at["postcode"], at["local_authority"], at["uprn"]
        i_a1, i_a2, i_a3 = at["address1"], at["address2"], at["address3"]
        i_date, i_rating, i_floor = at["lodgement_date"], at["current_energy_rating"], at["total_floor_area"]
        width = len(header)
        for row in reader:
            if len(row) < width or row[i_la] not in lads:
                continue
            postcode = compact_postcode(row[i_pc])
            if not postcode or postcode_area(postcode) not in areas:
                continue
            rows.append((postcode, row[i_uprn].strip(), row[i_a1], row[i_a2], row[i_a3],
                         row[i_date][:10], row[i_rating].strip().upper()[:1], row[i_floor].strip()))
    return member, rows


def _ppd_rows(postcodes: dict[str, tuple[str, str]], areas: frozenset[str]):
    """English Price Paid rows of the pass's areas, placed in their postcode's LSOA."""
    unplaced = 0
    with open(PP_COMPLETE, newline="", encoding="utf-8", errors="replace") as handle:
        for row in csv.reader(handle):
            if len(row) < 15:
                continue
            postcode = row[3].strip().upper()
            compact = postcode.replace(" ", "")
            if postcode_area(compact) not in areas:
                continue
            placed = postcodes.get(compact)
            if placed is None:
                unplaced += 1
                continue
            yield (placed[1], row[2][:10], int(row[1]), row[4], row[5], row[6], row[14],
                   placed[0], row[7].strip(), row[8].strip(), row[9].strip())
    log(f"link: {unplaced} sales in these areas with no English postcode (Wales, blank or unknown)")


def dwelling_key(postcode: str, paon: str, saon: str, street: str) -> str:
    """A short opaque id for 'the same home' (turnover counts distinct homes sold)."""
    return hashlib.blake2b(f"{postcode}|{paon}|{saon}|{street}".encode(), digest_size=6).hexdigest()


def link_area(args: tuple[str, list[tuple], list[tuple], dict[str, str]]) -> tuple[str, list[str], dict, dict]:
    """Link one postcode area's sales to EPC floor areas; count its EPC ratings per LSOA.

    Returns (area, sales lines, {lsoa: [rated, a_to_c]}, stats)."""
    area, certificates, sales, lsoa_of = args
    certificates.sort()  # the year files arrive in any order: make ties (same lodgement day) deterministic
    # Latest certificate per dwelling (UPRN, else postcode + address) for the rating counts.
    latest: dict[str, tuple[str, str, str]] = {}
    records = []
    for number, (postcode, uprn, a1, a2, a3, lodged, rating, floor) in enumerate(certificates):
        tokens = address_tokens(a1, a2, a3)
        key = uprn if uprn.isdigit() else postcode + "|" + " ".join(sorted(canonical_tokens(tokens)))
        if rating in "ABCDEFG" and rating and (key not in latest or lodged > latest[key][0]):
            latest[key] = (lodged, rating, postcode)
        try:
            area_sqm = float(floor)
        except ValueError:
            continue
        if area_sqm > 0 and tokens:
            records.append(EpcRecord(str(number), postcode, tokens, area_sqm, lodged, uprn))
    ratings: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for _lodged, rating, postcode in latest.values():
        lsoa = lsoa_of.get(postcode)
        if lsoa:
            counts = ratings[lsoa]
            counts[0] += 1
            counts[1] += rating in "ABC"
    index: dict[str, list[EpcRecord]] = {}
    for record in records:
        index.setdefault(record.postcode_compact, []).append(record)
    for group in index.values():
        group.sort(key=lambda item: item.lodgement_date, reverse=True)
    sectors = _sector_groups(index)
    # The never-share guard of epc_link.link_sales_floor: a certificate claimed by two different
    # SAONs is given to neither.
    matches: list[EpcRecord | None] = []
    claims: dict[str, set[frozenset]] = defaultdict(set)
    for lsoa, day, price, ptype, new_build, tenure, category, pcds, paon, saon, street in sales:
        sale_tokens = address_tokens(saon, paon, street)
        anchor = address_tokens(paon, street) if new_build == "Y" else None
        match = _find(pcds.replace(" ", ""), sale_tokens, index, anchor, sectors)
        matches.append(match)
        if match is not None:
            claims[match.certificate_number].add(canonical_tokens(address_tokens(saon) or sale_tokens))
    shared = {number for number, identities in claims.items() if len(identities) > 1}
    lines = []
    linked = 0
    for sale, match in zip(sales, matches):
        lsoa, day, price, ptype, new_build, tenure, category, pcds, paon, saon, street = sale
        floor = "" if match is None or match.certificate_number in shared else f"{match.floor_area_sqm:g}"
        linked += bool(floor)
        recent = day >= RECENT_FROM  # dwelling and street feed only the 36- and 60-month tables
        lines.append("\t".join((lsoa, day, str(price), ptype, "1" if new_build == "Y" else "0", tenure,
                                category, floor, pcds, dwelling_key(pcds, paon, saon, street) if recent else "",
                                street.upper().replace("\t", " ") if recent else "")))
    stats = {"sales": len(sales), "linked": linked, "certificates": len(certificates),
             "shared_rejected": len(shared), "dwellings_rated": len(latest)}
    return area, lines, dict(ratings), stats


def stage_link() -> None:
    """Restartable: each pass writes link/sales-NN.tsv.gz, ratings-NN.tsv and stats-NN.tsv; a finished pass
    is skipped on a rerun (AE_PASSES must stay the same)."""
    postcodes = load_postcodes()
    members = epc_bulk.members(EPC_ZIP)
    groups = plan_passes(postcodes, PASSES)
    only = {area.strip().upper() for area in os.environ.get("AE_AREAS", "").split(",") if area.strip()}
    if only:  # a smoke run on a few postcode areas
        groups = [frozenset(only)]
    lsoa_by_area: dict[str, dict[str, str]] = defaultdict(dict)
    for compact, (_pcds, lsoa) in postcodes.items():
        lsoa_by_area[postcode_area(compact)][compact] = lsoa
    os.makedirs(LINK_DIR, exist_ok=True)
    log(f"link: {len(members)} EPC files, {len(groups)} passes over {sum(map(len, groups))} postcode areas")
    context = multiprocessing.get_context("fork")
    for number, areas in enumerate(groups, 1):
        sales_path = os.path.join(LINK_DIR, f"sales-{number:02d}.tsv.gz")
        if os.path.exists(sales_path):
            log(f"link: pass {number}/{len(groups)} already done")
            continue
        log(f"link: pass {number}/{len(groups)}: {len(areas)} areas ({', '.join(sorted(areas))})")
        by_area: dict[str, list[tuple]] = defaultdict(list)
        with context.Pool(WORKERS) as pool:
            for _member, rows in pool.imap_unordered(_epc_year, [(EPC_ZIP, member, areas) for member in members]):
                for row in rows:
                    by_area[postcode_area(row[0])].append(row)
        sales_by_area: dict[str, list[tuple]] = defaultdict(list)
        for sale in _ppd_rows(postcodes, areas):
            sales_by_area[postcode_area(sale[7].replace(" ", ""))].append(sale)
        log(f"link:   {sum(map(len, sales_by_area.values()))} sales, {sum(map(len, by_area.values()))} certificates")
        jobs = sorted(set(by_area) | set(sales_by_area),
                      key=lambda a: -(len(by_area.get(a, ())) + len(sales_by_area.get(a, ()))))
        ratings: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        totals: Counter = Counter()
        with gzip.open(sales_path + ".tmp", "wt", compresslevel=6) as out, \
                open(os.path.join(LINK_DIR, f"stats-{number:02d}.tsv"), "w") as stats_out, \
                context.Pool(WORKERS) as pool:
            tasks = ((a, by_area.pop(a, []), sales_by_area.pop(a, []), lsoa_by_area.get(a, {})) for a in jobs)
            for area, lines, area_ratings, stats in pool.imap_unordered(link_area, tasks):
                if lines:
                    out.write("\n".join(lines) + "\n")
                for lsoa, (rated, good) in area_ratings.items():
                    ratings[lsoa][0] += rated
                    ratings[lsoa][1] += good
                totals.update(stats)
                stats_out.write(f"{area}\t{stats['sales']}\t{stats['linked']}\t{stats['certificates']}\t"
                                f"{stats['shared_rejected']}\t{stats['dwellings_rated']}\n")
        with open(os.path.join(LINK_DIR, f"ratings-{number:02d}.tsv"), "w") as handle:
            for lsoa, (rated, good) in sorted(ratings.items()):
                handle.write(f"{lsoa}\t{rated}\t{good}\n")
        os.replace(sales_path + ".tmp", sales_path)
        log(f"link:   pass {number} done: {dict(totals)}")
    merged: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    totals = Counter()
    for name in sorted(os.listdir(LINK_DIR)):
        path = os.path.join(LINK_DIR, name)
        if name.startswith("ratings-"):
            for line in open(path):
                lsoa, rated, good = line.split("\t")
                merged[lsoa][0] += int(rated)
                merged[lsoa][1] += int(good)
        elif name.startswith("stats-"):
            for line in open(path):
                _area, sales, linked, certificates, shared, rated = line.split("\t")
                totals.update({"sales": int(sales), "linked": int(linked), "certificates": int(certificates),
                               "shared_rejected": int(shared), "dwellings_rated": int(rated)})
    with open(EPC_LSOA + ".tmp", "w") as handle:
        handle.write("lsoa\thomes_rated\trated_a_to_c\n")
        for lsoa in sorted(merged):
            handle.write(f"{lsoa}\t{merged[lsoa][0]}\t{merged[lsoa][1]}\n")
    os.replace(EPC_LSOA + ".tmp", EPC_LSOA)
    log(f"link: done {dict(totals)}; floor link rate {totals['linked'] / max(totals['sales'], 1):.3f}")


def sales_files() -> list[str]:
    return sorted(os.path.join(LINK_DIR, name) for name in os.listdir(LINK_DIR)
                  if name.startswith("sales-") and name.endswith(".tsv.gz"))


# --- aggregate ---------------------------------------------------------------------------------

OUT = os.path.join(WORK, "out")
PPM_END = os.environ.get("AE_PPM_END", "2026-06")            # London's vintage: src-hmlr-pp-category-a-2026-06
PPM_FIRST = "2006-06"                                           # etl_price_release.FIRST_PERIOD
# Disk: monthly £/m² from this month (the typical-price restatement window starts in January three years
# before the latest month); before it one value a year at the latest month's anniversaries (the growth lags).
PPM_MONTHLY_FROM = os.environ.get("AE_PPM_MONTHLY_FROM", "2023-01")
CTSOP_ZIP = os.environ.get("AE_CTSOP_ZIP", os.path.join(DATA, "aework", "council-tax", "CTSOP1.1.zip"))
PPM_METRIC = "price-per-square-metre"
LONDON_REGION = coverage.LONDON_REGION


def _month(text: str) -> int:
    year, month = text[:7].split("-")
    return int(year) * 12 + int(month) - 1


def read_sales(since: str = ""):
    """The linked sales (link/sales-NN.tsv.gz) as england_price_tables.Sale tuples, from month `since` on."""
    for path in sales_files():
        yield from _read_sales_file(path, since)


def _read_sales_file(path: str, since: str):
    import england_price_tables as tables
    from datetime import date

    with gzip.open(path, "rt") as handle:
        for line in handle:
            if since and line[10:17] < since:
                continue
            lsoa, day, price, ptype, new_build, tenure, category, floor, pcds, dwelling, street = \
                line.rstrip("\n").split("\t")
            when = date.fromisoformat(day)
            yield tables.Sale(lsoa, when, when.year * 12 + when.month - 1, int(price), ptype, new_build == "1",
                              tenure, category, float(floor) if floor else None, pcds, dwelling, street)


def latest_sale_day():
    """The newest completion date of the linked sales (the London build's max(completion_date))."""
    from datetime import date

    latest = ""
    for path in sales_files():
        with gzip.open(path, "rt") as handle:
            for line in handle:
                day = line[10:20]
                if day > latest:
                    latest = day
    return date.fromisoformat(latest)


def ppm_periods(end: int, first: int, monthly_from: int) -> list[int]:
    lags = {end - 12 * years for years in range(0, 21) if end - 12 * years >= first}
    return sorted(lags | set(range(max(monthly_from, first), end + 1)))


def _write(name: str, header, rows) -> int:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    count = 0
    with open(path + ".tmp", "w", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(header)
        for row in rows:
            writer.writerow(["" if value is None else
                             "{" + ",".join(map(str, value)) + "}" if isinstance(value, list) else value
                             for value in row])
            count += 1
    os.replace(path + ".tmp", path)
    log(f"aggregate: {name}: {count} rows")
    return count


def ctsop_dwellings() -> dict[str, int]:
    """Homes on the VOA valuation list per LSOA and MSOA id (the market-depth denominator)."""
    import etl_council_tax

    rows, _period = etl_council_tax.read_zip(CTSOP_ZIP)
    lookup = coverage.lsoa_lookup()
    out: dict[str, int] = defaultdict(int)
    for code, bands in rows.items():
        if code in lookup:
            out[f"uk:lsoa:{code}"] += sum(bands)
            out[f"uk:msoa:{lookup[code][0]}"] += sum(bands)
    return dict(out)


def stage_aggregate(url: str) -> None:
    import england_price_tables as tables
    import psycopg
    from area_analytics import market

    areas = tables.Areas(coverage.lsoa_lookup(), coverage.region_of_lad)
    end, first = _month(PPM_END), _month(PPM_FIRST)
    periods = ppm_periods(end, first, _month(PPM_MONTHLY_FROM))
    latest_day = latest_sale_day()
    latest_sale = latest_day.year * 12 + latest_day.month - 1
    log(f"aggregate: {len(periods)} £/m² periods to {PPM_END}; latest sale {latest_day}")
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "latest.txt"), "w") as handle:
        handle.write(f"{latest_day}\n")
    digest = hashlib.sha256()  # the linked sales' fingerprint, kept so link/ can be deleted after aggregate
    for path in sales_files():
        digest.update(_sha256(path).encode())
    with open(os.path.join(OUT, "sales.sha256"), "w") as handle:
        handle.write(digest.hexdigest() + "\n")

    def since(months_back_from: int) -> str:
        return f"{months_back_from // 12:04d}-{months_back_from % 12 + 1:02d}"

    # 1. £/m² index (and its growth windows)
    series = tables.index_series(read_sales(since(first - 11)), areas, first)
    cells = {}

    def ppm_rows():
        for gid, period, value, pct, n, quality, carrier, carrier_n in tables.price_index_rows(series, areas, periods):
            if value is not None and value > 0:
                cells[(gid, tables.month_index(period))] = (value, quality, carrier, carrier_n)
            yield gid, PPM_METRIC, period, value, pct, n, quality, carrier, carrier_n

    _write("metric_ppm.csv", ("geography_id", "metric_id", "period", "value", "region_percentile", "sample_count",
                              "quality", "carrier_geography_id", "carrier_sample_count"), ppm_rows())
    series = None
    growth = {row[0]: row for row in tables.growth_rows(cells, end)}
    spans = ("1y", "3y", "5y", "10y", "20y")
    _write("area_price_growth.csv", ("geography_id", "period", *(f"growth_{s}{part}" for s in spans
                                                                  for part in ("", "_quality", "_n"))),
           growth.values())

    # 2. typical price bands and layers
    bands, adjusted, in_window = tables.price_band_rows(read_sales(since(_month(f"{int(PPM_END[:4]) - 3}-01"))),
                                                        areas, cells, end, first)
    log(f"aggregate: price bands: adjusted {adjusted} of {in_window} in-window sales (same-carrier rule)")
    _write("area_price_band.csv", ("geography_id", "property_type", "window_start", "period", "sales",
                                   "p10", "p25", "p50", "p75", "p90"), bands)
    _write("metric_typical.csv", ("geography_id", "metric_id", "period", "value", "region_percentile",
                                  "sample_count", "quality"),
           tables.typical_price_rows(bands, areas, tables.index_day(end)))
    bands = cells = None

    # 3. price by type
    _write("area_type_price.csv", ("geography_id", "property_type", "years_back", "window_months", "window_end",
                                   "sales", "median_price", "ppm_sales", "p25_ppm", "median_ppm", "p75_ppm"),
           tables.type_price_rows(read_sales(since(latest_sale - 359)), areas, latest_sale))

    # 4. local market depth
    _write("area_market_depth.csv",
           ("geography_id", "period_end", "sales_12m", "dwellings", "dwellings_sold_12m", "turnover_percent",
            "tenure_known_12m", "leasehold_share_of_sales", "new_build_sample_36m", "resale_sample_36m",
            "new_build_median_ppm", "resale_median_ppm", "new_build_premium_percent", "growth_period",
            *(f"growth_{s}{part}" for s in spans[:4] for part in ("", "_quality", "_n"))),
           tables.market_depth_rows(read_sales(since(latest_sale - 37)), areas, latest_day, ctsop_dwellings(),
                                    growth))

    # 5. postcode sector / district / borough zones
    with psycopg.connect(url) as conn:
        cpih = dict(conn.execute("SELECT month, cpih_index::float8 FROM cpih_month"))
        names: dict[str, dict[str, str]] = defaultdict(dict)
        for district, name in conn.execute(
                "SELECT DISTINCT postcode_district, name FROM street WHERE postcode_district IS NOT NULL"):
            names[district].setdefault(name.upper(), name)
    distribution, index_rows, street_rows = tables.zone_rows(read_sales("2004-01"), areas, latest_sale, cpih, names)
    _write("zone_ppm_distribution.csv", ("zone_kind", "zone_code", "period_end", "sales", "p09", "p25", "p50",
                                         "p75", "p91", "bucket_edges", "bucket_counts"), distribution)
    _write("zone_price_index.csv", ("zone_kind", "zone_code", "group", "year", "sales", "median_ppm",
                                    "index_nominal", "index_real"), index_rows)
    _write("zone_street.csv", ("sector", "street_name", "sales_60m", "median_floor_area", "median_ppm"),
           street_rows)

    # 6. local market by type (area_analytics.market, the London module)
    parents = {f"uk:lsoa:{code}": areas.parents(code) for code in areas.lookup}
    month_of = tables.index_day
    market_sales = (market.Sale(f"uk:lsoa:{s.lsoa}", month_of(s.month), s.price, s.ptype,
                                tables.ppm_of(s.price, s.floor), s.category)
                    for s in read_sales(since(latest_sale - market.WINDOWS * 12 + 1)) if s.lsoa in areas.lookup)
    rows = market.aggregate(market_sales, parents, month_of(latest_sale))
    _write("area_market.csv", ("geography_id", "property_type", "window_end", "sales", "median_price", "p5", "p25",
                               "p75", "p95", "min_price", "max_price", "ppm_sales", "median_ppm"),
           ((r.geography_id, r.property_type, r.window_end, r.sales, r.median_price, r.p5, r.p25, r.p75, r.p95,
             r.min_price, r.max_price, r.ppm_sales, r.median_ppm) for r in rows))

    # 7. EPC ratings per LSOA (latest certificate per dwelling; migration 028's 30-home rule)
    with open(EPC_LSOA) as handle:
        epc = [line.rstrip("\n").split("\t") for line in handle][1:]
    _write("area_epc_rating.csv", ("geography_id", "homes_rated", "rated_a_to_c", "share_a_to_c"),
           ((f"uk:lsoa:{lsoa}", int(rated), int(good), round(int(good) / int(rated), 6) if int(rated) >= 30 else None)
            for lsoa, rated, good in epc if lsoa in areas.lookup))


# --- bundle ------------------------------------------------------------------------------------

BUNDLE = os.environ.get("AE_BUNDLE", os.path.join(DATA, "england-2026-10", "bundles", "prices"))
TYPICAL_METRICS = tuple(metric for _t, metric in (("*", "typical-price"), ("F", "typical-price-flat"),
                                                   ("T", "typical-price-terraced"), ("S", "typical-price-semi"),
                                                   ("D", "typical-price-detached")))
OUTSIDE_LONDON = f"(SELECT area_id FROM area_region WHERE region_code <> '{LONDON_REGION}')"
# Whole-England releases built by their own ETLs on the ETL database (same files as London's releases):
# table copies and metrics, with the London-only release prefix each replaces.
NATIONAL = {
    "hpi": {"prefix": "src-hmlr-uk-hpi-", "tables": ("borough_hpi",),
            "metrics": ("hpi-change-5y", "hpi-change-10y")},
    "rent": {"prefix": "src-ons-pipr-2", "tables": ("borough_rent",),
             "metrics": ("typical-rent", "typical-rent-1-bed", "typical-rent-3-bed")},
    "rent-series": {"prefix": "src-ons-pipr-series-", "tables": ("borough_rent_series",),
                    "metrics": ("rent-change-1y", "rent-change-5y")},
    "ctsop": {"prefix": "src-voa-ctsop-", "tables": ("area_council_tax_band",),
              "metrics": ("council-tax-band-mean",)},
}
PPM_CAVEATS = [
    "Areas with fewer than 20 qualifying sales in the 12 months fall back to their MSOA, then borough.",
    "Excludes repossessions, buy-to-let and company sales (category B) and 'other' property types.",
    "Sales without an EPC floor area, under £20,000, or outside 15–1,000 m² or £500–£40,000/m² are excluded.",
    "Land Registry registers sales with a lag of up to a few months, so the latest window is still filling.",
    "Outside London, sales are placed in their postcode's area (ONSPD) and linked to EPC floor areas by address; "
    "before 2023 they show one value a year. London's figures come from its address-level build.",
]


def release_ids() -> dict[str, str]:
    """Our three releases; the sales one is named after the newest sale (written by aggregate)."""
    latest = open(os.path.join(OUT, "latest.txt")).read().strip()
    return {"ppm": f"src-hmlr-pp-category-a-{PPM_END}-england",
            "sales": f"src-hmlr-pp-sales-{latest[:7]}-england",
            "epc": "src-epc-bulk-2008-2026-england"}


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def own_releases(ids: dict[str, str]) -> list[dict]:
    sales_sha = open(os.path.join(OUT, "sales.sha256")).read().strip()  # written by aggregate
    hmlr = ("Contains HM Land Registry data © Crown copyright and database right 2026. This data is licensed "
            "under the Open Government Licence v3.0.")
    return [
        {"id": ids["ppm"], "source_url": "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
         "release_date": f"{PPM_END}-01", "sha256": sales_sha, "licence": "OGL-3.0",
         "attribution": hmlr + " Floor areas: EPC open data (OGL v3.0).",
         "transformation_version": "close-knit-england-prices-1", "caveats": [
             "Standard market sales only (PPD category A); repossessions, buy-to-let and company sales are excluded.",
             "Floor area comes from the dwelling's latest EPC, not necessarily one lodged at the sale.",
             "England outside London: sales placed by postcode (ONSPD, 2021 LSOAs); London rows are the "
             "address-level London build, relabelled to this national release."]},
        {"id": ids["sales"], "source_url": "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
         "release_date": open(os.path.join(OUT, "latest.txt")).read().strip(), "sha256": sales_sha,
         "licence": "OGL-3.0", "attribution": hmlr, "transformation_version": "close-knit-england-prices-1",
         "caveats": ["Area tables only (markets, bands, depth, postcode-sector zones) for England outside London; "
                     "no sale or address is stored.",
                     "Sales are placed in their postcode's area (ONSPD); dwellings for turnover are VOA council tax "
                     "homes."]},
        {"id": ids["epc"], "source_url": "https://get-energy-performance-data.communities.gov.uk/",
         "release_date": "2026-08-31", "sha256": _sha256(EPC_LSOA), "licence": "OGL-3.0",
         "attribution": "Energy Performance of Buildings Register, Department for Energy Security and Net Zero. "
                        "Open Government Licence v3.0 (non-address fields).",
         "transformation_version": "close-knit-england-prices-1",
         "caveats": ["Latest certificate per dwelling (UPRN, else postcode and address), placed by postcode; "
                     "only counts are stored."]},
    ]


def _csv_copy(out, table: str, path: str, keep=lambda row: True, extra: tuple = ()) -> int:
    """COPY block of the CSV's rows that pass `keep` (header = column names) plus constant `extra` columns."""
    with open(os.path.join(OUT, path), newline="") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        columns = [f'"{c}"' if c == "group" else c for c in header] + [name for name, _v in extra]
        out.write(f"COPY {table} ({', '.join(columns)}) FROM stdin WITH (FORMAT csv);\n")
        writer = csv.writer(out, lineterminator="\n")
        count = 0
        for row in reader:
            if keep(row):
                writer.writerow(row + [value for _n, value in extra])
                count += 1
    out.write("\\.\n")
    return count


def outside_london(row) -> bool:
    return coverage.region_of_code(row[0]) not in (LONDON_REGION, None)


def stage_bundle(url: str) -> None:
    import psycopg

    import release_bundle as rb
    from etl_england_people_bundle import METRIC_COLUMNS, copy_out, release_rows

    ids = release_ids()
    os.makedirs(BUNDLE, exist_ok=True)
    path = os.path.join(BUNDLE, "load.sql.gz")
    counts: dict[str, int] = {}
    with psycopg.connect(url) as conn, conn.cursor() as cur, gzip.open(path + ".tmp", "wt", encoding="utf-8") as out:
        national = {}
        for key, spec in NATIONAL.items():
            table = spec["tables"][0]
            found = [row[0] for row in cur.execute(
                f"SELECT DISTINCT source_release_id FROM {table} WHERE source_release_id LIKE '%%-england'")]
            if len(found) != 1:
                raise SystemExit(f"{table}: expected one national (-england) release on the ETL database, got {found}")
            national[key] = found[0]
        out.write("-- England prices and housing (branch england/d3-prices). Apply with:\n"
                  "--   gunzip -c load.sql.gz | psql \"$DB\" -v ON_ERROR_STOP=1\n"
                  "BEGIN;\nSET client_min_messages = notice;\n"
                  "DO $$ BEGIN\n"
                  "  IF (SELECT count(*) FROM area_geography WHERE kind = 'lsoa') < 33755 THEN\n"
                  "    RAISE EXCEPTION 'load the England geography (bundles/core) first'; END IF;\n"
                  "  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'metric_value'\n"
                  "                 AND column_name = 'carrier_geography_id') THEN\n"
                  "    RAISE EXCEPTION 'migration 095 (carrier columns) is missing'; END IF; END $$;\n")
        for row in own_releases(ids) + release_rows(cur, sorted(national.values())):
            out.write(rb.source_release_sql(row) + "\n")

        # £/m²: London keeps its address-level values, relabelled to the national release; the rest is new.
        out.write(f"DELETE FROM metric_value WHERE metric_id = '{PPM_METRIC}' AND geography_id IN {OUTSIDE_LONDON};\n"
                  f"UPDATE metric_value SET source_release_id = {rb.literal(ids['ppm'])} "
                  f"WHERE metric_id = '{PPM_METRIC}' AND source_release_id <> {rb.literal(ids['ppm'])};\n")
        counts["metric_value price-per-square-metre"] = _csv_copy(
            out, "metric_value", "metric_ppm.csv", outside_london, (("source_release_id", ids["ppm"]),))
        out.write("UPDATE metric_definition SET source_release_id = " + rb.literal(ids["ppm"]) +
                  ", definition = definition || jsonb_build_object('caveats', " +
                  rb.literal(json_dumps(PPM_CAVEATS)) + "::jsonb) WHERE id = '" + PPM_METRIC + "';\n")

        # Typical price layers: the same, then the legend over every English LSOA (103's UPDATE).
        typical = "(" + ", ".join(rb.literal(m) for m in TYPICAL_METRICS) + ")"
        out.write("INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)\n"
                  "SELECT m, 'lsoa', '£', 'higher-is-more', '{}'::jsonb, " + rb.literal(ids["sales"]) + "\n"
                  "FROM unnest(ARRAY" + repr(list(TYPICAL_METRICS)) + ") m ON CONFLICT (id) DO NOTHING;\n")
        out.write(f"DELETE FROM metric_value WHERE metric_id IN {typical} AND geography_id IN {OUTSIDE_LONDON};\n"
                  f"UPDATE metric_value SET source_release_id = {rb.literal(ids['sales'])} "
                  f"WHERE metric_id IN {typical} AND source_release_id <> {rb.literal(ids['sales'])};\n")
        counts["metric_value typical-price*"] = _csv_copy(
            out, "metric_value", "metric_typical.csv", outside_london, (("source_release_id", ids["sales"]),))
        out.write(TYPICAL_LEGEND_SQL.replace(":source", rb.literal(ids["sales"])) + "\n")

        # Area tables: rows outside London (London's stay as its build made them).
        for table, name in (("area_price_band", "area_price_band.csv"), ("area_type_price", "area_type_price.csv"),
                            ("area_market", "area_market.csv"), ("area_market_depth", "area_market_depth.csv")):
            out.write(f"DELETE FROM {table} WHERE source_release_id = {rb.literal(ids['sales'])} "
                      f"OR geography_id IN {OUTSIDE_LONDON};\n")
            counts[table] = _csv_copy(out, table, name, outside_london, (("source_release_id", ids["sales"]),))
        out.write(f"DELETE FROM area_price_growth WHERE geography_id IN {OUTSIDE_LONDON};\n")
        counts["area_price_growth"] = _csv_copy(out, "area_price_growth", "area_price_growth.csv", outside_london)
        out.write(f"DELETE FROM area_epc_rating WHERE source_release_id = {rb.literal(ids['epc'])} "
                  f"OR geography_id IN {OUTSIDE_LONDON};\n")
        counts["area_epc_rating"] = _csv_copy(out, "area_epc_rating", "area_epc_rating.csv", outside_london,
                                              (("source_release_id", ids["epc"]),))

        # Postcode zones: every English sector/district/borough; London's own rows win where both exist.
        for table, name, key in (("zone_ppm_distribution", "zone_ppm_distribution.csv", "zone_kind, zone_code"),
                                 ("zone_price_index", "zone_price_index.csv", 'zone_kind, zone_code, "group", year'),
                                 ("zone_street", "zone_street.csv", "sector, street_name")):
            out.write(f"DELETE FROM {table} WHERE source_release_id = {rb.literal(ids['sales'])};\n"
                      f"CREATE TEMP TABLE {table}_in (LIKE {table}) ON COMMIT DROP;\n")
            counts[table] = _csv_copy(out, f"{table}_in", name, extra=(("source_release_id", ids["sales"]),))
            out.write(f"INSERT INTO {table} SELECT * FROM {table}_in ON CONFLICT ({key}) DO NOTHING;\n")

        # Postcode sectors and districts England adds (stage sectors); London's rows win on a clash.
        if os.path.exists(SECTOR_CODES):
            zones: dict[str, list[str]] = defaultdict(list)
            for line in open(SECTOR_CODES):
                table, code = line.rstrip("\n").split("\t")
                zones[table].append(code)
            for table, columns in (("postcode_sector", ("code", "slug", "district", "name", "borough_id",
                                                        "postcode_count", "geometry", "label_point")),
                                   ("postcode_district", ("code", "slug", "name", "borough_id", "postcode_count",
                                                          "geometry", "label_point"))):
                out.write(f"CREATE TEMP TABLE {table}_in (LIKE {table}) ON COMMIT DROP;\n")
                counts[table] = copy_out(cur, out, f"{table}_in", columns,
                                         f"SELECT {', '.join(columns)} FROM {table} WHERE code = ANY("
                                         f"{rb.text_array(zones[table])}) ORDER BY code")
                out.write(f"INSERT INTO {table} ({', '.join(columns)}) SELECT {', '.join(columns)} FROM {table}_in "
                          "ON CONFLICT (code) DO NOTHING;\n")

        # Whole-England releases from their own ETLs (same source files as London's): copied from the ETL database.
        for key, spec in NATIONAL.items():
            source = national[key]
            for table in spec["tables"]:
                columns = [row[0] for row in cur.execute(
                    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' "
                    "AND table_name = %s ORDER BY ordinal_position", (table,))]
                out.write(f"DELETE FROM {table};\n")
                counts[table] = copy_out(cur, out, table, columns,
                                         f"SELECT {', '.join(columns)} FROM {table} WHERE source_release_id = "
                                         f"{rb.literal(source)}")
            for metric in spec["metrics"]:
                definition = cur.execute(
                    "SELECT carrier, unit, direction, definition::text FROM metric_definition WHERE id = %s",
                    (metric,)).fetchone()
                out.write("INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)\n"
                          f"VALUES ({rb.literal(metric)}, {rb.literal(definition[0])}, {rb.literal(definition[1])}, "
                          f"{rb.literal(definition[2])}, {rb.literal(definition[3])}::jsonb, {rb.literal(source)})\n"
                          "ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit, "
                          "direction = EXCLUDED.direction, definition = EXCLUDED.definition, "
                          "source_release_id = EXCLUDED.source_release_id;\n"
                          f"DELETE FROM metric_value WHERE metric_id = {rb.literal(metric)};\n")
                counts[f"metric_value {metric}"] = copy_out(
                    cur, out, "metric_value", METRIC_COLUMNS,
                    f"SELECT {', '.join(METRIC_COLUMNS)} FROM metric_value WHERE metric_id = {rb.literal(metric)} "
                    f"AND source_release_id = {rb.literal(source)}")
        out.write(rb.stage_sql("prices-england", [ids["ppm"], ids["sales"], ids["epc"], *national.values()],
                               ["src-hmlr-pp-category-a-", *(spec["prefix"] for spec in NATIONAL.values())]) + "\n")
        out.write("COMMIT;\n")
    os.replace(path + ".tmp", path)
    with open(os.path.join(BUNDLE, "counts.tsv"), "w") as handle:
        for name, count in counts.items():
            handle.write(f"{name}\t{count}\n")
    log(f"bundle: {path} ({os.path.getsize(path) / 1e6:.1f} MB): {counts}; national {national}; own {ids}")


def json_dumps(value) -> str:
    import json

    return json.dumps(value, ensure_ascii=False)


# 103 rebuild_area_price_bands' legend UPDATE, over every English LSOA's typical-price values.
TYPICAL_LEGEND_SQL = """UPDATE metric_definition d
   SET source_release_id = :source,
       definition = jsonb_build_object(
           'label', 'Typical home price' || q.suffix,
           'shortLabel', 'Typical home price',
           'description', 'Median price of standard sales' || q.words || ' since ' || EXTRACT(YEAR FROM q.window_start)
               || ', each adjusted to ' || to_char(q.latest, 'Mon YYYY') || ' by the local price index. '
               || 'Area-level only: not a valuation of any home.',
           'sourceId', 'hmlr-price-paid', 'sourceName', 'HM Land Registry Price Paid',
           'methodologyPath', '/guide/typical-price', 'freshness', to_char(q.latest, 'YYYY-MM'),
           'legend', CASE WHEN q.c1 IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(
               jsonb_build_object('value', q.c1, 'colour', '#c7e9b4', 'label', '£' || round(q.c1 / 1000) || 'k'),
               jsonb_build_object('value', q.c2, 'colour', '#7fcdbb', 'label', '£' || round(q.c2 / 1000) || 'k'),
               jsonb_build_object('value', q.c3, 'colour', '#1d91c0', 'label', '£' || round(q.c3 / 1000) || 'k'),
               jsonb_build_object('value', q.c4, 'colour', '#253494', 'label', '£' || round(q.c4 / 1000) || 'k'),
               jsonb_build_object('value', q.c5, 'colour', '#081d58', 'label', '£' || round(q.c5 / 1000) || 'k+')) END,
           'caveats', jsonb_build_array(
               'Areas with fewer than 20 sales of the type use their MSOA, then their borough (at least 5 sales); below that no value is shown.',
               'Standard market sales only (Price Paid category A). The index adjusts for the market, not for condition or improvements.',
               'Outside London, sales are placed in their postcode''s area; London''s bands come from its address-level build.',
               'Contains HM Land Registry data © Crown copyright and database right. Licensed under the Open Government Licence v3.0.'))
  FROM (
    SELECT k.metric_id,
           (SELECT max(period) FROM metric_value WHERE metric_id = 'price-per-square-metre') AS latest,
           make_date(EXTRACT(YEAR FROM (SELECT max(period) FROM metric_value
                                        WHERE metric_id = 'price-per-square-metre'))::integer - 3, 1, 1) AS window_start,
           CASE k.metric_id WHEN 'typical-price' THEN '' WHEN 'typical-price-flat' THEN ': flats'
                WHEN 'typical-price-terraced' THEN ': terraced' WHEN 'typical-price-semi' THEN ': semi-detached'
                ELSE ': detached' END AS suffix,
           CASE k.metric_id WHEN 'typical-price' THEN '' WHEN 'typical-price-flat' THEN ' of flats'
                WHEN 'typical-price-terraced' THEN ' of terraced houses'
                WHEN 'typical-price-semi' THEN ' of semi-detached houses' ELSE ' of detached houses' END AS words,
           round(percentile_cont(0.1) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c1,
           round(percentile_cont(0.3) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c2,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c3,
           round(percentile_cont(0.7) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c4,
           round(percentile_cont(0.9) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c5
    FROM (VALUES ('typical-price'), ('typical-price-flat'), ('typical-price-terraced'),
                 ('typical-price-semi'), ('typical-price-detached')) k(metric_id)
    LEFT JOIN metric_value v ON v.metric_id = k.metric_id AND v.value IS NOT NULL
    GROUP BY k.metric_id
  ) q
 WHERE d.id = q.metric_id;"""


# (name, CSV, value column, SQL: London's own build as (geography_id, value), which CSV rows to compare)
LONDON_CHECKS = (
    ("price-per-square-metre, LSOA, latest month", "metric_ppm.csv", "value",
     f"SELECT geography_id, value FROM metric_value WHERE metric_id = '{PPM_METRIC}' AND geography_id LIKE 'uk:lsoa:%' "
     f"AND period = '{PPM_END}-01' AND value IS NOT NULL", lambda row, _w: row["period"] == f"{PPM_END}-01"),
    ("area_market median price, all homes, latest window", "area_market.csv", "median_price",
     "SELECT geography_id, median_price FROM area_market WHERE property_type = 'all' "
     "AND window_end = (SELECT max(window_end) FROM area_market) AND median_price IS NOT NULL",
     lambda row, window: row["property_type"] == "all" and row["window_end"] == window),
    ("area_market_depth sales in 12 months", "area_market_depth.csv", "sales_12m",
     "SELECT geography_id, sales_12m FROM area_market_depth", lambda row, _w: True),
    ("area_type_price borough median, all types, last 12 months", "area_type_price.csv", "median_price",
     "SELECT geography_id, median_price FROM area_type_price WHERE property_type = '*' "
     "AND window_months = 12 AND years_back = 0",
     lambda row, _w: row["property_type"] == "*" and row["window_months"] == "12" and row["years_back"] == "0"),
    ("area_epc_rating share A-C", "area_epc_rating.csv", "share_a_to_c",
     "SELECT geography_id, share_a_to_c FROM area_epc_rating WHERE share_a_to_c IS NOT NULL", lambda row, _w: True),
)


def stage_diff(url: str) -> None:
    """London rows of the postcode-placed build against London's own (address-level) build on the database:
    a method check only (London keeps its own rows). Writes out/london-diff.json."""
    import json
    from statistics import median as middle

    import psycopg

    window = open(os.path.join(OUT, "latest.txt")).read().strip()[:7] + "-01"
    report = {}
    with psycopg.connect(url) as conn:
        for name, path, column, sql, keep in LONDON_CHECKS:
            theirs = {gid: float(value) for gid, value in conn.execute(sql)}
            ours = {}
            with open(os.path.join(OUT, path), newline="") as handle:
                for row in csv.DictReader(handle):
                    gid = row["geography_id"]
                    if row[column] and keep(row, window) and coverage.region_of_code(gid) == LONDON_REGION:
                        ours[gid] = float(row[column])
            both = sorted(set(ours) & set(theirs))
            gaps = [abs(ours[g] - theirs[g]) / abs(theirs[g]) for g in both if theirs[g]]
            report[name] = {"london_rows_ours": len(ours), "london_rows_theirs": len(theirs), "both": len(both),
                            "identical": sum(1 for g in both if ours[g] == theirs[g]),
                            "median_abs_pct_diff": round(100 * middle(gaps), 2) if gaps else None,
                            "within_5pct": round(sum(gap <= 0.05 for gap in gaps) / len(gaps), 3) if gaps else None,
                            "within_10pct": round(sum(gap <= 0.10 for gap in gaps) / len(gaps), 3) if gaps else None}
            log(f"diff: {name}: {report[name]}")
    with open(os.path.join(OUT, "london-diff.json"), "w") as handle:
        json.dump(report, handle, indent=1)


SECTOR_SQL = Path(__file__).with_name("england_postcode_sectors.sql")
SECTOR_CODES = os.path.join(OUT, "postcode-zones.tsv")


def stage_sectors(url: str) -> None:
    """England's postcode sectors and districts (england_postcode_sectors.sql) from the live ONSPD points;
    London's own rows stay. Writes the codes it added to out/postcode-zones.tsv for the bundle."""
    import psycopg

    before: dict[str, set[str]] = {}
    with psycopg.connect(url) as conn:
        for table in ("postcode_sector", "postcode_district"):
            before[table] = {row[0] for row in conn.execute(f"SELECT code FROM {table}")}
        conn.execute("CREATE TEMP TABLE england_postcode_point (postcode text, east integer, north integer, "
                     "lsoa_code text) ON COMMIT DROP")
        with conn.cursor().copy("COPY england_postcode_point FROM STDIN") as copy, \
                gzip.open(POSTCODES, "rt") as handle:
            for line in handle:
                _compact, pcds, lsoa, east, north, live = line.rstrip("\n").split("\t")
                if live == "1" and east.isdigit() and north.isdigit():
                    copy.write_row((pcds, int(east), int(north), lsoa))
        conn.execute(SECTOR_SQL.read_text())
        added = {table: sorted({row[0] for row in conn.execute(f"SELECT code FROM {table}")} - before[table])
                 for table in before}
    os.makedirs(OUT, exist_ok=True)
    with open(SECTOR_CODES, "w") as handle:
        for table, codes in added.items():
            for code in codes:
                handle.write(f"{table}\t{code}\n")
    log(f"sectors: added {len(added['postcode_sector'])} sectors, {len(added['postcode_district'])} districts")


# --- London's linked sales --------------------------------------------------------------------------

LINKED_SCHEMA = """CREATE TABLE sale (txn TEXT PRIMARY KEY, month TEXT, price INT, floor REAL, lsoa TEXT, msoa TEXT,
  borough TEXT, ptype TEXT, newbuild INT, category TEXT);
CREATE INDEX idx_sale_month_lsoa ON sale(month, lsoa);"""


def linked_rows(sales, lookup: dict[str, tuple[str, str]], lad_codes: frozenset[str]):
    """price-linked.sqlite rows (txn, month, price, floor, lsoa, msoa, borough, ptype, newbuild, category) for
    the sales with a floor area whose LSOA lies in `lad_codes`; txn is the sale's position (the link files
    carry no Price Paid id: the category travels with the row instead)."""
    for number, sale in enumerate(sales):
        parents = lookup.get(sale.lsoa)
        if sale.floor is None or parents is None or parents[1] not in lad_codes:
            continue
        yield (f"e{number}", f"{sale.day:%Y-%m}", sale.price, sale.floor, sale.lsoa, parents[0], parents[1],
               sale.ptype, int(sale.new_build), sale.category)


def stage_london_linked(out: str | None = None) -> None:
    """The London per-home £/m² input (etl_price_release.py reads $AE_DATA/price-linked.sqlite) from the
    same linked sales England's areas use: one linker for every area."""
    import sqlite3

    out = out or os.path.join(DATA, "price-linked.sqlite")
    lads = coverage.get(epc_bulk.PER_HOME_SCOPE).lad_codes
    if os.path.exists(out + ".tmp"):
        os.remove(out + ".tmp")
    db = sqlite3.connect(out + ".tmp")
    db.executescript(LINKED_SCHEMA)
    db.executemany("INSERT INTO sale VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                   linked_rows(read_sales(), coverage.lsoa_lookup(), lads))
    db.commit()
    count = db.execute("SELECT count(*) FROM sale").fetchone()[0]
    db.close()
    os.replace(out + ".tmp", out)
    log(f"london-linked: {count} sales with a floor area -> {out}")


STAGES = {"postcodes": stage_postcodes, "link": stage_link, "london-linked": stage_london_linked}
URL_STAGES = {"aggregate": stage_aggregate, "bundle": stage_bundle, "diff": stage_diff, "sectors": stage_sectors}


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] in STAGES:
        STAGES[sys.argv[1]]()
    elif len(sys.argv) == 3 and sys.argv[1] in URL_STAGES:
        URL_STAGES[sys.argv[1]](sys.argv[2])
    else:
        sys.exit(__doc__)
