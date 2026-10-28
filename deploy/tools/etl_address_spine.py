"""London's address spine (address search and per-home sale history) from HM Land Registry Price Paid.

Stages:
  build [CSV] [OUT]      stream pp-complete.csv ($AE_DATA/hmlr/pp-complete.csv) -> OUT
                         ($AE_DATA/address-history.sqlite): tables addr (id, display, postcode,
                         geography_id, sale_count), txn (txn_id, address_id, month, date, price, floor, ppm)
                         and meta (source sha256, rows, last sale)
  compare BUILT REF      match a build against an earlier spine: address ids, txn ids and every field
  load URL [--dry-run]   upsert `address`, replace `address_transaction` (migration 003) as
                         src-hmlr-pp-complete-<last month>, then stage and activate a product release that
                         replaces the previous src-hmlr-pp-complete-* member; --dry-run rolls back

A sale is London's when its postcode (trimmed) is in the ONSPD London lookup
($AE_DATA/boundaries/onspd-london-2025.csv, which also gives the 2021 LSOA) and in a London
postcode area. An address is keyed by postcode + the normalised SAON (a flat), else PAON + street:
id = "uk:addr:" + sha1("<postcode>|<key>")[:12], never a UPRN. Its display address comes from its
first row in file order. Floor areas come from the EPC extract keyed the same way
($AE_DATA/epc-london-floor.sqlite: postcode, akey -> floor), falling back to the PAON + street key
(a flat in a converted house shares the house's certificate); £/m² = price / floor, 2 dp.
Coordinates are postcode grid references ($AE_DATA/boundaries/onspd-london-grid.csv).

  AE_DATA=~/data python3 etl_address_spine.py build
  python3 etl_address_spine.py compare ~/data/address-history.sqlite ~/data/address-history.2026-07.sqlite
  python3 etl_address_spine.py load postgresql://... --dry-run
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import sqlite3
import sys

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
PP_COMPLETE = os.path.join(DATA, "hmlr", "pp-complete.csv")
SPINE_DB = os.path.join(DATA, "address-history.sqlite")
POSTCODE_LOOKUP = os.path.join(DATA, "boundaries", "onspd-london-2025.csv")
POSTCODE_GRID = os.path.join(DATA, "boundaries", "onspd-london-grid.csv")
EPC_FLOOR_DB = os.path.join(DATA, "epc-london-floor.sqlite")
ETL_VERSION = "close-knit-address-spine-1"
SOURCE_PREFIX = "src-hmlr-pp-complete-"
#: Postcode areas inside Greater London; the lookup also lists a few WD and CM border postcodes.
LONDON_AREAS = frozenset("E N NW SE SW W WC EC BR CR DA EN HA IG KT RM SM TN TW UB".split())
ABBR = {"st": "street", "rd": "road", "ave": "avenue", "cres": "crescent", "terr": "terrace", "ln": "lane"}
TXN_COLUMNS = ("txn_id", "address_id", "month", "date", "price", "floor", "ppm")


def norm(text: str) -> str:
    """The spine's key normalisation (etl_property.norm mirrors it)."""
    words = re.sub(r"[^a-z0-9 ]", " ", str(text or "").lower()).split()
    return " ".join(ABBR.get(w, w) for w in words)


def address_key(paon: str, saon: str, street: str) -> str:
    return norm(saon) if saon else norm(f"{paon} {street}")


def address_id(postcode: str, key: str) -> str:
    return "uk:addr:" + hashlib.sha1(f"{postcode}|{key}".encode()).hexdigest()[:12]


def capitalise(text: str) -> str:
    """Upper-case a letter after anything but a letter, digit or apostrophe: 'FLAT A-B (REAR)' -> 'Flat A-B
    (Rear)', '42A' -> '42a', "ST.THOMAS'S" -> "St.Thomas's"; spacing kept."""
    return re.sub(r"(^|[^a-z0-9'])([a-z])", lambda m: m.group(1) + m.group(2).upper(), text.lower())


def display_address(paon: str, saon: str, street: str, locality: str, town: str, postcode: str) -> str:
    parts = (saon, f"{paon} {street}".strip(), locality, town)
    return ", ".join([capitalise(part) for part in parts if part] + [postcode])


def postcode_area(postcode: str) -> str:
    return re.match(r"[A-Z]*", postcode).group(0)


def load_lookup(path: str | None = None) -> dict[str, str]:
    with open(path or POSTCODE_LOOKUP, newline="") as handle:
        return {row["postcode"]: row["lsoa21"] for row in csv.DictReader(handle)
                if row["lsoa21"] and postcode_area(row["postcode"]) in LONDON_AREAS}


def load_floors(path: str | None = None) -> dict[tuple[str, str], float]:
    db = sqlite3.connect(path or EPC_FLOOR_DB)
    try:
        return {(postcode, key): floor for postcode, key, floor in db.execute("SELECT postcode, akey, floor FROM epc")}
    finally:
        db.close()


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 22), b""):
            digest.update(chunk)
    return digest.hexdigest()


def spine_rows(rows, lookup: dict[str, str], floors: dict[tuple[str, str], float]):
    """Price Paid rows -> (addresses {id: [display, postcode, geography_id, sale_count]}, txn tuples)."""
    addresses: dict[str, list] = {}
    txns = []
    for row in rows:
        if len(row) < 16:
            continue
        postcode = row[3].strip()
        lsoa = lookup.get(postcode)
        if lsoa is None:
            continue
        paon, saon, street, locality, town = (value.strip() for value in row[7:12])
        key = address_key(paon, saon, street)
        aid = address_id(postcode, key)
        known = addresses.get(aid)
        if known is None:
            addresses[aid] = [display_address(paon, saon, street, locality, town, postcode),
                              postcode, f"uk:lsoa:{lsoa}", 1]
        else:
            known[3] += 1
        price = int(row[1])
        date = row[2][:10]
        floor = floors.get((postcode, key)) or floors.get((postcode, norm(f"{paon} {street}")))
        ppm = round(price / floor, 2) if floor else None
        txns.append((row[0], aid, date[:7], date, price, floor, ppm))
    return addresses, txns


def build(csv_path: str | None = None, out: str | None = None) -> dict:
    csv_path, out = csv_path or PP_COMPLETE, out or SPINE_DB
    lookup = load_lookup()
    floors = load_floors()
    tmp = out + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    with open(csv_path, newline="", encoding="utf-8", errors="replace") as handle:
        addresses, txns = spine_rows(csv.reader(handle), lookup, floors)
    db = sqlite3.connect(tmp)
    db.executescript("""
        CREATE TABLE addr (id TEXT PRIMARY KEY, display TEXT, postcode TEXT, geography_id TEXT, sale_count INT);
        CREATE TABLE txn (txn_id TEXT PRIMARY KEY, address_id TEXT, month TEXT, date TEXT, price INT,
                          floor REAL, ppm REAL);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);""")
    db.executemany("INSERT INTO addr VALUES (?,?,?,?,?)", ((aid, *v) for aid, v in addresses.items()))
    db.executemany("INSERT INTO txn VALUES (?,?,?,?,?,?,?)", txns)
    db.executescript("CREATE INDEX idx_txn_addr ON txn(address_id); CREATE INDEX idx_addr_pc ON addr(postcode);")
    meta = {"source": os.path.basename(csv_path), "sha256": sha256_file(csv_path),
            "addresses": len(addresses), "txns": len(txns), "last_date": max(t[3] for t in txns),
            "etl_version": ETL_VERSION}
    db.executemany("INSERT INTO meta VALUES (?,?)", ((k, str(v)) for k, v in meta.items()))
    db.commit()
    db.close()
    os.replace(tmp, out)
    print(f"build: {json.dumps(meta)} -> {out}")
    return meta


def compare(built: str, reference: str) -> dict:
    """Ids and fields of `built` against an earlier spine `reference` (every reference row checked)."""
    db = sqlite3.connect(built)
    db.execute("ATTACH DATABASE ? AS ref", (reference,))
    one = lambda sql: db.execute(sql).fetchone()[0]  # noqa: E731
    report = {
        "ref_addresses": one("SELECT count(*) FROM ref.addr"),
        "ref_addresses_found": one("SELECT count(*) FROM ref.addr r JOIN addr b ON b.id = r.id"),
        "ref_txns": one("SELECT count(*) FROM ref.txn"),
        "ref_txns_found_same_address": one(
            "SELECT count(*) FROM ref.txn r JOIN txn b ON b.txn_id = r.txn_id AND b.address_id = r.address_id"),
        "built_addresses": one("SELECT count(*) FROM addr"),
        "built_txns": one("SELECT count(*) FROM txn"),
    }
    report["address_id_match_rate"] = report["ref_addresses_found"] / max(report["ref_addresses"], 1)
    report["txn_id_match_rate"] = report["ref_txns_found_same_address"] / max(report["ref_txns"], 1)
    diffs = {}
    for column in ("display", "postcode", "geography_id", "sale_count"):
        diffs[f"addr.{column}"] = one(
            f"SELECT count(*) FROM ref.addr r JOIN addr b ON b.id = r.id WHERE b.{column} IS NOT r.{column}")
    for column in TXN_COLUMNS[1:]:
        diffs[f"txn.{column}"] = one(
            f"SELECT count(*) FROM ref.txn r JOIN txn b ON b.txn_id = r.txn_id WHERE b.{column} IS NOT r.{column}")
    report["field_differences"] = diffs
    report["display_examples"] = [list(r) for r in db.execute(
        "SELECT r.display, b.display FROM ref.addr r JOIN addr b ON b.id = r.id"
        " WHERE b.display IS NOT r.display LIMIT 5")]
    print(json.dumps(report, indent=1))
    return report


def _meta(spine: sqlite3.Connection) -> dict:
    return dict(spine.execute("SELECT key, value FROM meta"))


def _grid(path: str | None = None) -> dict[str, tuple[int, int]]:
    grid = {}
    with open(path or POSTCODE_GRID, newline="") as handle:
        for row in csv.DictReader(handle):
            if row["easting"] and row["northing"]:
                grid[row["postcode"]] = (int(float(row["easting"])), int(float(row["northing"])))
    return grid


def _copy(cur, sql: str, rows) -> None:
    with cur.copy(sql) as copy:
        for row in rows:
            copy.write_row(row)


#: Addresses only in London's 2021 LSOAs: the lookup puts a few border postcodes in a neighbour's LSOA.
LONDON_LSOA_SQL = """SELECT g.id FROM area_geography g
    JOIN area_geography m ON m.id = g.parent_id JOIN area_geography l ON l.id = m.parent_id
    WHERE g.kind = 'lsoa' AND l.official_code LIKE 'E09%'"""


def load(url: str, spine_path: str | None = None, dry_run: bool = False) -> dict:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    spine = sqlite3.connect(spine_path or SPINE_DB)
    meta = _meta(spine)
    source_id = f"{SOURCE_PREFIX}{meta['last_date'][:7]}"
    grid = _grid()
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        cur.execute("SET LOCAL statement_timeout = 0")
        before = cur.execute("""SELECT (SELECT count(*) FROM address) AS addresses,
                                       (SELECT count(*) FROM address_transaction) AS txns""").fetchone()
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, 'https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads',
                 now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (source_id, meta["last_date"], meta["sha256"],
             "Contains HM Land Registry data © Crown copyright and database right 2026. "
             "This data is licensed under the Open Government Licence v3.0.",
             ETL_VERSION,
             ["Addresses are keyed by postcode and Price Paid address, not by UPRN.",
              "Coordinates are postcode centres, never building positions.",
              "Floor areas come from the dwelling's EPC, not necessarily one lodged at the sale."]))
        cur.execute("""CREATE TEMP TABLE staging_address (id text, display_address text, postcode text,
                         geography_id text, easting integer, northing integer) ON COMMIT DROP""")
        _copy(cur, "COPY staging_address FROM STDIN",
              ((aid, display, postcode, geo, *grid.get(postcode, (None, None)))
               for aid, display, postcode, geo in spine.execute(
                   "SELECT id, display, postcode, geography_id FROM addr")))
        cur.execute(f"""DELETE FROM staging_address WHERE geography_id NOT IN ({LONDON_LSOA_SQL})""")
        cur.execute("CREATE UNIQUE INDEX ON staging_address (id)")
        cur.execute("ANALYZE staging_address")
        display_changed = cur.execute("""SELECT count(*) AS n FROM staging_address s JOIN address a ON a.id = s.id
                                         WHERE a.display_address <> s.display_address""").fetchone()["n"]
        cur.execute("""INSERT INTO address (id, display_address, postcode, geography_id, easting, northing,
                         source_release_id)
                       SELECT id, display_address, postcode, geography_id, easting, northing, %s FROM staging_address
                       ON CONFLICT (id) DO UPDATE SET display_address = EXCLUDED.display_address,
                         postcode = EXCLUDED.postcode, geography_id = EXCLUDED.geography_id,
                         easting = coalesce(EXCLUDED.easting, address.easting),
                         northing = coalesce(EXCLUDED.northing, address.northing),
                         source_release_id = EXCLUDED.source_release_id""", (source_id,))
        # The zone and kids builds read the postcode point in WGS84 too (6 dp, as the first load wrote it).
        if cur.execute("""SELECT count(*) AS n FROM information_schema.columns
                          WHERE table_name = 'address' AND column_name IN ('longitude', 'latitude')""").fetchone()["n"]:
            cur.execute("""UPDATE address SET longitude = round(ST_X(p)::numeric, 6), latitude = round(ST_Y(p)::numeric, 6)
                           FROM (SELECT id AS pid, ST_Transform(ST_SetSRID(ST_MakePoint(easting, northing), 27700), 4326) AS p
                                 FROM address WHERE longitude IS NULL AND easting IS NOT NULL) s
                           WHERE id = s.pid""")
        # Addresses Price Paid no longer lists keep their row (homes and objections point at them).
        dropped = cur.execute("""UPDATE address a SET source_release_id = %s
                                 WHERE NOT EXISTS (SELECT 1 FROM staging_address s WHERE s.id = a.id)""",
                              (source_id,)).rowcount
        cur.execute("""CREATE TEMP TABLE previous_txn ON COMMIT DROP AS
                       SELECT address_id, completion_date, nominal_price, floor_area_square_metres,
                              price_per_square_metre FROM address_transaction""")
        cur.execute("DELETE FROM address_transaction")
        cur.execute("""CREATE TEMP TABLE staging_txn (address_id text, completion_date date, nominal_price integer,
                         floor double precision, ppm double precision) ON COMMIT DROP""")
        _copy(cur, "COPY staging_txn FROM STDIN",
              spine.execute("SELECT address_id, date, price, floor, ppm FROM txn ORDER BY rowid"))
        cur.execute("""INSERT INTO address_transaction (address_id, sale_month, completion_date, nominal_price,
                         floor_area_square_metres, price_per_square_metre, source_release_id)
                       SELECT t.address_id, date_trunc('month', t.completion_date)::date, t.completion_date,
                              t.nominal_price, t.floor, t.ppm, %s
                       FROM staging_txn t JOIN staging_address a ON a.id = t.address_id
                       WHERE t.nominal_price > 0
                       ON CONFLICT DO NOTHING""", (source_id,))
        after = cur.execute("""SELECT (SELECT count(*) FROM address) AS addresses,
                                      (SELECT count(*) FROM address_transaction) AS txns,
                                      (SELECT max(completion_date)::text FROM address_transaction) AS last_sale"""
                            ).fetchone()
        changed = cur.execute("""SELECT
              (SELECT count(*) FROM (SELECT address_id, completion_date, nominal_price, floor_area_square_metres,
                 price_per_square_metre FROM address_transaction EXCEPT SELECT * FROM previous_txn) n) AS txns_new,
              (SELECT count(*) FROM (SELECT * FROM previous_txn EXCEPT SELECT address_id, completion_date,
                 nominal_price, floor_area_square_metres, price_per_square_metre FROM address_transaction) g)
                 AS txns_gone""").fetchone()
        report = {"source": source_id, "before": before, "after": after, "unlisted_addresses": dropped,
                  "display_changed": display_changed, **changed}
        print(f"load: {json.dumps(report)}")
        old = [row["source_release_id"] for row in cur.execute(
            """SELECT m.source_release_id FROM product_release_member m JOIN active_product_release a
                 ON a.release_id = m.release_id
               WHERE m.source_release_id LIKE %s AND m.source_release_id <> %s""",
            (SOURCE_PREFIX + "%", source_id))]
        report["release"] = stage_release.stage(cur, "address-spine", [source_id], replace=tuple(old))
        if dry_run:
            conn.rollback()
            print("load: dry run rolled back")
    return report


def main(argv: list[str]) -> None:
    stage = argv[1] if len(argv) > 1 else ""
    args = [a for a in argv[2:] if not a.startswith("--")]
    if stage == "build":
        build(*args[:2])
    elif stage == "compare" and len(args) == 2:
        compare(*args)
    elif stage == "load" and args:
        load(args[0], *args[1:2], dry_run="--dry-run" in argv)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
