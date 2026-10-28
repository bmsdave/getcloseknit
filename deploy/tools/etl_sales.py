"""Individual London sales (HM Land Registry Price Paid) for the sold-price map.

Stages (run in order; each is restartable):
  extract  stream $AE_DATA/hmlr/pp-complete.csv, keep Greater London rows with
           every PPD field -> $AE_WORK/ppd-london.sqlite
  emit     join each sale to the address spine ($AE_DATA/address-history.sqlite:
           txn_id -> address_id, EPC floor area) and to a postcode grid
           reference ($AE_DATA/boundaries/onspd-london-grid.csv) for sales whose
           address has no UPRN point -> $AE_WORK/sales.csv; PAON and street go
           along (normalised) so load can key sales by building and street
           (migration 013)
  load     COPY sales.csv into `sale` (migration 008) as a source release, then
           rebuild what depends on it: stock values (last category-A sale
           restated by the £/m² index), area price growth, local market depth
           (migration 014), street-block medians, the sold-price pins and the
           area price bands with the "Typical home price" layer (migration 040)
           and the postcode sector zones (migration 057; needs `cpih_month`
           from etl_cpih.py for real figures):
           python3 etl_sales.py load <url>
  release  stage a product release = the active one plus the sales source and
           the `tiles/sale_tile` asset, and activate it unless CLOSE_KNIT_STAGE_ONLY
           is set (etl.py runs it stage only and activates once at the end of the
           refresh, release_guard.py): ... release <url>
  Every rebuild replaces London's rows only (migration 133): England's come
  from the England prices bundle.

  AE_DATA=~/data AE_WORK=~/data/aework/sales python3 etl_sales.py extract

Price Paid columns (no header): 0 transaction id, 1 price, 2 date, 3 postcode,
4 property type (D/S/T/F/O), 5 new build (Y/N), 6 duration (F/L/U), 7 PAON,
8 SAON, 9 street, 10 locality, 11 town, 12 district, 13 county,
14 PPD category (A standard / B additional), 15 record status.
"""
from __future__ import annotations

import csv
import hashlib
import io
import os
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import release_guard  # noqa: E402
from area_analytics.epc_link import (  # noqa: E402  (one tolerant linker, B3 #153)
    address_tokens,
    build_epc_index,
    compact_postcode,
    link_sales_floor,
    map_epc_row,
)

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "sales"))
PP_COMPLETE = os.path.join(DATA, "hmlr", "pp-complete.csv")
ADDRESS_DB = os.path.join(DATA, "address-history.sqlite")
POSTCODE_GRID = os.path.join(DATA, "boundaries", "onspd-london-grid.csv")
PPD_DB = os.path.join(WORK, "ppd-london.sqlite")
SALES_CSV = os.path.join(WORK, "sales.csv")
ETL_VERSION = "close-knit-sales-1"
SALES_COLUMNS = ("transaction_id", "address_id", "completion_date", "price", "property_type",
                 "new_build", "tenure", "ppd_category", "postcode", "floor_area_square_metres",
                 "easting", "northing", "paon", "saon", "street")


def london_row(row: list[str]) -> bool:
    return len(row) >= 16 and row[13] == "GREATER LONDON"


def parse_row(row: list[str]) -> tuple:
    """PPD row -> ppd table tuple (dates trimmed to YYYY-MM-DD)."""
    return (row[0].strip("{}"), int(row[1]), row[2][:10], row[3].strip(), row[4], row[5] == "Y",
            row[6], row[7], row[8], row[9], row[14], row[15])


def address_part(value: str | None) -> str:
    """PAON / street as a matching key part: upper case, single spaces, no
    commas or full stops ("12a, " and "12A" are one building)."""
    return " ".join((value or "").upper().replace(",", " ").replace(".", " ").split())


def stage_extract() -> None:
    os.makedirs(WORK, exist_ok=True)
    tmp = PPD_DB + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    db = sqlite3.connect(tmp)
    db.execute("""CREATE TABLE ppd (txn TEXT PRIMARY KEY, price INT, date TEXT, postcode TEXT,
                  ptype TEXT, newbuild INT, tenure TEXT, paon TEXT, saon TEXT, street TEXT,
                  category TEXT, status TEXT)""")
    kept = seen = 0
    batch = []
    with open(PP_COMPLETE, newline="", encoding="utf-8", errors="replace") as handle:
        for row in csv.reader(handle):
            seen += 1
            if not london_row(row):
                continue
            batch.append(parse_row(row))
            if len(batch) >= 50_000:
                db.executemany("INSERT OR REPLACE INTO ppd VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", batch)
                kept += len(batch)
                batch.clear()
    db.executemany("INSERT OR REPLACE INTO ppd VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", batch)
    kept += len(batch)
    db.commit()
    db.close()
    os.replace(tmp, PPD_DB)
    print(f"extract: {kept} Greater London sales of {seen} rows -> {PPD_DB}")


def load_grid() -> dict[str, tuple[int, int]]:
    grid = {}
    with open(POSTCODE_GRID, newline="") as handle:
        for row in csv.DictReader(handle):
            if row["easting"] and row["northing"]:
                grid[row["postcode"]] = (int(float(row["easting"])), int(float(row["northing"])))
    return grid


#: EPC extract the property ETL also reads (etl_property.EPC_CSV). Override with
#: AE_EPC_CSV on machines that keep it elsewhere.
EPC_CSV = os.environ.get("AE_EPC_CSV", os.path.join(DATA, "aework", "epc", "epc-london.csv"))  # epc_bulk.py london-csv


def _load_epc_index():
    """The EPC extract as a matcher index, or None when the extract is absent.

    Absent on machines that only run the sales stages: then the spine's
    floors are used as-is, with no backfill.
    """
    try:
        handle = open(EPC_CSV, newline="", encoding="utf-8", errors="replace")
    except OSError:
        print(f"emit: no EPC extract at {EPC_CSV}; spine floors only")
        return None
    with handle:
        records = []
        for row in csv.DictReader(handle):
            try:
                records.append(map_epc_row(row))
            except ValueError:
                continue
    print(f"emit: {len(records)} EPC certificates indexed for floor backfill")
    return build_epc_index(records)


def _backfill_floors(csv_path, unmatched, epc_index):
    """Fill null spine floors from the EPC extract via the shared tolerant
    matcher (B3 #153). Certificates claimed by more than one SAON are
    rejected (the E14 9JQ 335 m² guard). Returns (backfilled, rejected)."""
    if not unmatched or epc_index is None:
        return 0, []
    matches, rejected = link_sales_floor(unmatched, epc_index)
    filled = {key: match.floor_area_sqm for key, match in matches.items()
              if match is not None}
    if not filled:
        return 0, rejected
    patched = 0
    tmp = csv_path + ".patch"
    with open(csv_path, newline="") as src, open(tmp, "w", newline="") as dst:
        reader = csv.reader(src)
        writer = csv.writer(dst)
        writer.writerow(next(reader))
        for n, row in enumerate(reader):
            if n in filled:
                row[9] = filled[n]
                patched += 1
            writer.writerow(row)
    os.replace(tmp, csv_path)
    return patched, rejected


def stage_emit() -> None:
    grid = load_grid()
    spine = sqlite3.connect(ADDRESS_DB)
    spine.execute(f"ATTACH DATABASE '{PPD_DB}' AS p")
    rows = spine.execute(
        """SELECT p.ppd.txn, t.address_id, p.ppd.date, p.ppd.price, p.ppd.ptype, p.ppd.newbuild,
                  p.ppd.tenure, p.ppd.category, p.ppd.postcode, t.floor, p.ppd.paon, p.ppd.street,
                  p.ppd.saon
           FROM p.ppd JOIN txn t ON t.txn_id = '{' || p.ppd.txn || '}'""")
    epc_index = _load_epc_index()
    unmatched, written, unplaced = [], 0, 0
    tmp_csv = SALES_CSV + ".tmp"
    with open(tmp_csv, "w", newline="") as out:
        writer = csv.writer(out)
        writer.writerow(SALES_COLUMNS)
        for (txn, address_id, date, price, ptype, newbuild, tenure, category, postcode, floor,
             paon, street, saon) in rows:
            east_north = grid.get(postcode)
            unplaced += east_north is None
            if not floor and epc_index is not None:
                unmatched.append({
                    "key": written,
                    "postcode": compact_postcode(postcode),
                    "sale_tokens": address_tokens(saon, paon, street),
                    "saon_tokens": address_tokens(saon),
                    "paon_street_tokens": address_tokens(paon, street),
                })
            writer.writerow([txn, address_id, date, price, ptype, "t" if newbuild else "f", tenure,
                             category, postcode, floor if floor else "",
                             *(east_north or ("", "")), address_part(paon), address_part(saon),
                             address_part(street)])
            written += 1
    backfilled, rejected = _backfill_floors(tmp_csv, unmatched, epc_index)
    os.replace(tmp_csv, SALES_CSV)
    print(f"emit: {written} sales joined to the address spine ({unplaced} without a postcode grid "
          f"reference) -> {SALES_CSV}")
    if epc_index is not None:
        print(f"emit: EPC floor backfill: {backfilled} sales; "
              f"{len(rejected)} shared certificates rejected")
        for cert in rejected[:20]:
            print(f"emit:   rejected shared certificate {cert}")
    unmatched = spine.execute(
        """SELECT count(*) FROM p.ppd WHERE NOT EXISTS
           (SELECT 1 FROM txn t WHERE t.txn_id = '{' || p.ppd.txn || '}')""").fetchone()[0]
    print(f"emit: {unmatched} London PPD sales are not in the address spine")


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stage_load(url: str) -> None:
    import psycopg

    checksum = sha256_file(SALES_CSV)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        latest = None
        with open(SALES_CSV, newline="") as handle:
            for row in csv.DictReader(handle):
                latest = max(latest or row["completion_date"], row["completion_date"])
        source_id = f"src-hmlr-pp-sales-{latest[:7]}"
        cur.execute("DELETE FROM sale WHERE source_release_id = %s", (source_id,))
        cur.execute("DELETE FROM source_release WHERE id = %s"
                    " AND NOT EXISTS (SELECT 1 FROM product_release_member WHERE source_release_id = %s)",
                    (source_id, source_id))
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, 'https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads',
                 now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (source_id, latest, checksum,
             "Contains HM Land Registry data © Crown copyright and database right 2026. "
             "This data is licensed under the Open Government Licence v3.0.",
             ETL_VERSION,
             ["Category B sales (repossessions, buy-to-let, company and other non-standard transfers) are flagged, not removed.",
              "Sales whose address has no UPRN are placed at their postcode centre."]))
        cur.execute("""CREATE TEMP TABLE staging_sale (
              transaction_id text, address_id text, completion_date date, price integer,
              property_type text, new_build boolean, tenure text, ppd_category text, postcode text,
              floor_area_square_metres double precision, easting integer, northing integer,
              paon text, saon text, street text)""")
        with open(SALES_CSV, newline="") as handle, cur.copy(
                "COPY staging_sale FROM STDIN WITH (FORMAT csv, HEADER true)") as copy:
            while chunk := handle.read(1 << 20):
                copy.write(chunk)
        cur.execute("SELECT load_sales(%s)", (source_id,))
        count = cur.execute("SELECT count(*) FROM sale WHERE source_release_id = %s", (source_id,)).fetchone()[0]
        print(f"load: {count} sales staged as {source_id}")
        for step in ("rebuild_stock_values(%s)", "rebuild_area_price_growth()",
                     "rebuild_market_depth()", "rebuild_sale_pins(%s)", "revalue_city_blocks(%s)",
                     "rebuild_area_price_bands(%s)", "rebuild_property_sale_bands(%s)",
                     "rebuild_zone_analytics(%s)"):
            args = (source_id,) if "%s" in step else ()
            result = cur.execute(f"SELECT {step}", args).fetchone()[0]
            print(f"load: {step.split('(')[0]} -> {result} rows")


#: Refuse to activate a sales release when more whole blocks than this ship
#: with no EPC floor area on any sale (B3, #153). Owner-tunable; the live
#: 2026-10-19 data has 3 such blocks (Duval House SW11 2FR, Pinnacle E14
#: 9PG/9PR), so a small allowance keeps the release train moving while any
#: regression fails loudly. See RELEASE-CHECKLIST.md ("Rebuilding a data
#: release", sales step). The env var raises it for one run, so a release
#: with a known, accepted count never gets stuck "failed".
ZERO_FLOOR_BUILDING_FAIL_THRESHOLD = 5
ZERO_FLOOR_THRESHOLD_ENV = "CLOSE_KNIT_ZERO_FLOOR_BLOCK_FAIL_THRESHOLD"


def zero_floor_fail_threshold() -> int:
    """The gate's threshold: $CLOSE_KNIT_ZERO_FLOOR_BLOCK_FAIL_THRESHOLD, else the default."""
    return int(os.environ.get(ZERO_FLOOR_THRESHOLD_ENV, ZERO_FLOOR_BUILDING_FAIL_THRESHOLD))


def _epc_linkage(cur):
    """EPC floor-area linkage health of the loaded sales (B3, #153).

    A block-wide miss (Duval House: 97 sales, 0 floor areas) means a null
    building median and drops the homes out of the per-home layers; a
    single floor area shared by a whole block (Pinnacle E14 9JQ: every flat
    335 m²) means a wrong median. Both are named here so a release can
    never ship them silently again.
    """
    linkage = cur.execute(
        """SELECT count(*) AS sales,
                  count(*) FILTER (WHERE floor_area_square_metres IS NOT NULL) AS with_floor
           FROM sale""").fetchone()
    zero_floor = cur.execute(
        """SELECT s.building_key AS building_key, min(a.display_address) AS example,
                  min(s.postcode) AS postcode, count(*) AS sales
           FROM sale s JOIN address a ON a.id = s.address_id
           WHERE s.building_key IS NOT NULL
           GROUP BY s.building_key
           HAVING count(*) >= 20 AND count(s.floor_area_square_metres) = 0
           ORDER BY sales DESC LIMIT 20""").fetchall()
    single_area = cur.execute(
        """SELECT s.building_key AS building_key, min(a.display_address) AS example,
                  count(*) AS sales, min(s.floor_area_square_metres) AS area
           FROM sale s JOIN address a ON a.id = s.address_id
           WHERE s.floor_area_square_metres IS NOT NULL AND s.building_key IS NOT NULL
           GROUP BY s.building_key
           HAVING count(*) >= 10 AND count(DISTINCT s.floor_area_square_metres) = 1
           ORDER BY sales DESC LIMIT 20""").fetchall()
    return {
        "buildings_ge20_sales_zero_floor": len(zero_floor),
        "buildings_ge20_sales_zero_floor_examples": [
            {"building_key": r["building_key"], "example": r["example"],
             "postcode": r["postcode"], "sales": int(r["sales"])} for r in zero_floor],
        "buildings_single_floor_area": len(single_area),
        "buildings_single_floor_area_examples": [
            {"building_key": r["building_key"], "example": r["example"],
             "sales": int(r["sales"]), "floor_area_square_metres": float(r["area"])}
            for r in single_area],
        "floor_area_link_rate": (linkage["with_floor"] / linkage["sales"]
                                 if linkage["sales"] else 0.0),
    }


def stage_release(url: str) -> None:
    import json
    from datetime import datetime, timezone

    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        source_id = cur.execute("SELECT DISTINCT source_release_id FROM sale").fetchone()["source_release_id"]
        counts = cur.execute(
            """SELECT (SELECT count(*) FROM sale) AS sales,
                      (SELECT count(*) FROM sale WHERE ppd_category = 'B') AS category_b,
                      -- Data quality (#163): Price Paid says D/S/T (a house) but the linked EPC says
                      -- flat — e.g. 13a Montague Road, recorded T in all 4 sales. Counted, not removed.
                      (SELECT count(*) FROM sale s
                       WHERE s.property_type IN ('D', 'S', 'T') AND s.tenure = 'L'
                         AND EXISTS (SELECT 1 FROM property p
                                     JOIN property_epc e ON e.uprn = p.uprn
                                     WHERE p.address_id = s.address_id
                                       AND e.property_type ILIKE '%flat%')) AS type_mismatch_flat,
                      (SELECT count(*) FROM sale_pin) AS pins,
                      (SELECT count(*) FROM sale_pin WHERE location_precision = 'uprn') AS pins_at_uprn,
                      (SELECT count(*) FROM property_stock_value) AS stock_values,
                      (SELECT count(*) FROM area_price_growth) AS growth_areas,
                      (SELECT count(*) FROM city_block) AS street_blocks""").fetchone()
        epc_linkage = _epc_linkage(cur)
        zero_count = epc_linkage["buildings_ge20_sales_zero_floor"]
        threshold = epc_linkage["zero_floor_fail_threshold"] = zero_floor_fail_threshold()
        failed = zero_count > threshold
        status = "failed" if failed else "passed"
        active = cur.execute("SELECT release_id FROM active_product_release").fetchone()["release_id"]
        base = cur.execute("SELECT * FROM product_release WHERE id = %s", (active,)).fetchone()
        release_id = f"rel-{datetime.now(timezone.utc):%Y%m%d%H%M}-sales"
        assets = list(dict.fromkeys([*base["assets"], "tiles/sale_tile"]))
        cur.execute(
            """INSERT INTO product_release (id, geography_vintage, transformation_versions, assets,
                 validation_status, validation_record) VALUES (%s, %s, %s, %s, %s, %s)""",
            (release_id, base["geography_vintage"],
             json.dumps({**base["transformation_versions"], "sales": ETL_VERSION}),
             json.dumps(assets), status,
             json.dumps({**{k: int(v) for k, v in counts.items()}, "supersedes": active,
                         "epc_linkage": epc_linkage})))
        if zero_count:
            print(f"release: WARNING: {zero_count} building(s) with >= 20 sales have no EPC "
                  f"floor area on any sale (B3 #153); "
                  f"{epc_linkage['buildings_single_floor_area']} building(s) share one floor "
                  f"area; link rate {epc_linkage['floor_area_link_rate']:.1%}; "
                  f"see validation_record.epc_linkage")
        if failed:
            print(f"release: FAILED: {zero_count} zero-floor buildings exceeds the threshold "
                  f"of {threshold}; {release_id} recorded but NOT activated. Fix the linkage, or "
                  f"for a known, accepted count re-run with {ZERO_FLOOR_THRESHOLD_ENV}={zero_count}")
            return
        # `sale` holds one load, so an earlier London sales source (src-hmlr-pp-sales-YYYY-MM) is dropped.
        cur.execute(
            """INSERT INTO product_release_member (release_id, source_release_id)
               SELECT %s, source_release_id FROM product_release_member WHERE release_id = %s
                 AND source_release_id !~ '^src-hmlr-pp-sales-[0-9]{4}-[0-9]{2}$'
               UNION SELECT %s, %s""", (release_id, active, release_id, source_id))
        # Inside an etl.py run (CLOSE_KNIT_STAGE_ONLY) the release is only staged: the run activates once at the
        # end, after the England bundle and release_build (release_guard.finish).
        if release_guard.activate(cur, release_id):
            print(f"release: activated {release_id}: {dict(counts)}")
        else:
            print(f"release: staged {release_id}: {dict(counts)}")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "extract":
        stage_extract()
    elif stage == "emit":
        stage_emit()
    elif stage == "load":
        stage_load(sys.argv[2])
    elif stage == "release":
        stage_release(sys.argv[2])
    else:
        sys.exit(__doc__)
