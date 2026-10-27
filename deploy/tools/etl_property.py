"""Build house-level load files: UPRN per address, OS Open UPRN coordinates,
HM Land Registry INSPIRE parcels. Stdlib only.

Stages (run in order, each resumable):
  uprn-map   EPC certificates (with UPRN) -> address_id -> UPRN, keyed exactly
             like the address spine (postcode + normalised address key).
  os-uprn    OS Open UPRN (OGL) filtered to the UPRNs the map found.
  inspire    INSPIRE Index Polygons for every London authority -> WKT (EPSG:27700).
  emit       COPY files + SQL fragments + manifest (sha256 of every input/output).

Inputs: $AE_DATA/aework/epc/epc-london.csv (`epc_bulk.py london-csv`, EPC extract with uprn column),
$AE_DATA/address-history.sqlite (address spine; AE_DATA defaults to ~/data).
Outputs: $AE_DATA/property/.
"""
import csv
import hashlib
import io
import json
import os
import re
import sqlite3
import sys
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))
from area_analytics.epc_link import SAON_SYNONYMS  # noqa: E402  (one tolerant linker, B3 #153)

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
OUT = os.path.join(DATA, "property")
EPC_CSV = os.environ.get("AE_EPC_CSV", os.path.join(DATA, "aework", "epc", "epc-london.csv"))  # epc_bulk.py london-csv
ADDRESS_DB = os.path.join(DATA, "address-history.sqlite")
OS_UPRN_URL = "https://api.os.uk/downloads/v1/products/OpenUPRN/downloads?area=GB&format=CSV&redirect"
OS_UPRN_RELEASE = "2026-08"
INSPIRE_BASE = "https://use-land-property-data.service.gov.uk/datasets/inspire/download/"
INSPIRE_CONDITIONS = "https://use-land-property-data.service.gov.uk/datasets/inspire/#conditions"
LONDON_AUTHORITIES = {
    "E09000001": "City_of_London_Corporation", "E09000033": "City_of_Westminster",
    "E09000002": "London_Borough_of_Barking_and_Dagenham", "E09000003": "London_Borough_of_Barnet",
    "E09000004": "London_Borough_of_Bexley", "E09000005": "London_Borough_of_Brent",
    "E09000006": "London_Borough_of_Bromley", "E09000007": "London_Borough_of_Camden",
    "E09000008": "London_Borough_of_Croydon", "E09000009": "London_Borough_of_Ealing",
    "E09000010": "London_Borough_of_Enfield", "E09000011": "Royal_Borough_of_Greenwich",
    "E09000012": "London_Borough_of_Hackney", "E09000013": "London_Borough_of_Hammersmith_and_Fulham",
    "E09000014": "London_Borough_of_Haringey", "E09000015": "London_Borough_of_Harrow",
    "E09000016": "London_Borough_of_Havering", "E09000017": "London_Borough_of_Hillingdon",
    "E09000018": "London_Borough_of_Hounslow", "E09000019": "London_Borough_of_Islington",
    "E09000020": "Royal_Borough_of_Kensington_and_Chelsea", "E09000021": "Royal_Borough_of_Kingston_upon_Thames",
    "E09000022": "London_Borough_of_Lambeth", "E09000023": "London_Borough_of_Lewisham",
    "E09000024": "London_Borough_of_Merton", "E09000025": "London_Borough_of_Newham",
    "E09000026": "London_Borough_of_Redbridge", "E09000027": "London_Borough_of_Richmond_upon_Thames",
    "E09000028": "London_Borough_of_Southwark", "E09000029": "London_Borough_of_Sutton",
    "E09000030": "London_Borough_of_Tower_Hamlets", "E09000031": "London_Borough_of_Waltham_Forest",
    "E09000032": "London_Borough_of_Wandsworth",
}
ABBR = {"st": "street", "rd": "road", "ave": "avenue", "cres": "crescent",
        "terr": "terrace", "ln": "lane"}
#: Lowercase mirror of the shared SAON synonyms: the spine keys a flat by
#: postcode|norm(SAON), and norm() is lowercase.
_SPINE_SYNONYM_CANON = {k.lower(): v.lower() for k, v in SAON_SYNONYMS.items()}
_SPINE_SAON_WORDS = set(_SPINE_SYNONYM_CANON)
ETL_VERSION = "close-knit-etl-property-1"
GML = "{http://www.opengis.net/gml/3.2}"
LR = "{www.landregistry.gov.uk}"

os.makedirs(OUT, exist_ok=True)


def norm(text):
    """Identical to the address spine's key normalisation (address_build.py)."""
    words = re.sub(r"[^a-z0-9 ]", " ", str(text or "").lower()).split()
    return " ".join(ABBR.get(w, w) for w in words)


def clean_pc(postcode):
    pc = re.sub(r"\s+", "", str(postcode or "").upper())
    return pc[:-3] + " " + pc[-3:] if len(pc) > 3 else pc


def addr_id(postcode, key):
    return "uk:addr:" + hashlib.sha1(f"{postcode}|{key}".encode()).hexdigest()[:12]


def _key_variants(words):
    """A token run as spine key(s): raw plus the synonym-canonicalised form."""
    raw = " ".join(words)
    canon = " ".join(_SPINE_SYNONYM_CANON.get(w, w) for w in words)
    return (raw, canon) if canon != raw else (raw,)


def _tolerant_spine_keys(row):
    """SAON-shaped candidate spine keys for one EPC row.

    Certificates often carry the building in the same column as the flat
    ("Apartment 10, Duval House") or a dwelling synonym ("Flat 10" for a
    spine keyed "apartment 10"), so the exact column norm misses. Yield
    each column's full norm (the caller skips keys the exact pass already
    probed) plus contiguous token runs (up to 3 tokens) that contain a
    digit or a dwelling word, each raw and synonym-canonicalised.
    """
    seen = set()
    for col in ("address1", "address2", "address3"):
        words = norm(row.get(col, "")).split()
        if not words:
            continue
        runs = [words]
        for length in (3, 2, 1):
            for i in range(len(words) - length + 1):
                chunk = words[i:i + length]
                if length == len(words):
                    continue
                if not any(w in _SPINE_SAON_WORDS or any(c.isdigit() for c in w)
                           for w in chunk):
                    continue
                runs.append(chunk)
        for run in runs:
            for key in _key_variants(run):
                if key not in seen:
                    seen.add(key)
                    yield key


def uprn_hits_for_row(postcode, row, known):
    """(address_id, is_tolerant) pairs one EPC row maps to.

    Exact column norms first (historical behaviour); the tolerant
    SAON-shaped candidates only run when no exact column hits, so common
    cases are byte-identical to before.
    """
    hits = []
    probed = set()
    for col in ("address1", "address2"):
        key = norm(row.get(col, ""))
        if not key:
            continue
        probed.add(key)
        aid = addr_id(postcode, key)
        if aid in known:
            hits.append((aid, False))
    if hits:
        return hits
    for key in _tolerant_spine_keys(row):
        if key in probed:
            continue
        probed.add(key)
        aid = addr_id(postcode, key)
        if aid in known:
            hits.append((aid, True))
    return hits


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def log(message):
    print(message, flush=True)


def stage_uprn_map():
    """EPC rows -> (address_id -> uprn); latest lodgement wins per address."""
    db_path = os.path.join(OUT, "addr-uprn.sqlite")
    if os.path.exists(db_path):
        os.remove(db_path)
    db = sqlite3.connect(db_path)
    db.execute("CREATE TABLE map (address_id TEXT PRIMARY KEY, uprn TEXT, lodged TEXT)")
    spine = sqlite3.connect(ADDRESS_DB)
    known = {row[0] for row in spine.execute("SELECT id FROM addr")}
    spine.close()
    log(f"uprn-map: {len(known)} spine addresses")
    batch, rows, exact_hits, tolerant_hits = [], 0, 0, 0

    def flush():
        db.executemany(
            "INSERT INTO map VALUES (?,?,?) ON CONFLICT(address_id) DO UPDATE SET "
            "uprn=excluded.uprn, lodged=excluded.lodged WHERE excluded.lodged >= map.lodged", batch)
        batch.clear()

    with open(EPC_CSV, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            rows += 1
            uprn = (row.get("uprn") or "").strip()
            if not uprn.isdigit():
                continue
            pc = clean_pc(row["postcode"])
            for aid, tolerant in uprn_hits_for_row(pc, row, known):
                batch.append((aid, uprn, row["lodgement_date"]))
                if tolerant:
                    tolerant_hits += 1
                else:
                    exact_hits += 1
            if len(batch) >= 50000:
                flush()
    if batch:
        flush()
    db.commit()
    mapped = db.execute("SELECT COUNT(*) FROM map").fetchone()[0]
    distinct = db.execute("SELECT COUNT(DISTINCT uprn) FROM map").fetchone()[0]
    db.close()
    stats = {"epc_rows": rows, "key_hits": exact_hits + tolerant_hits,
             "exact_hits": exact_hits, "tolerant_hits": tolerant_hits,
             "addresses_mapped": mapped, "distinct_uprns": distinct,
             "spine_addresses": len(known)}
    json.dump(stats, open(os.path.join(OUT, "uprn-map-stats.json"), "w"), indent=1)
    log(f"uprn-map: {mapped}/{len(known)} addresses carry a UPRN ({100*mapped/len(known):.1f}%)")


# The INSPIRE service answers the first request with a self-redirect that sets
# a load-balancer cookie; a cookie-aware opener follows it like a browser.
_OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    log(f"download {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 close-knit-etl/1"})
    with _OPENER.open(request, timeout=120) as response, open(path + ".part", "wb") as out:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
    os.replace(path + ".part", path)
    return path


def stage_os_uprn():
    """OS Open UPRN (GB CSV) filtered to the UPRNs the EPC map references."""
    zip_path = download(OS_UPRN_URL, os.path.join(OUT, f"osopenuprn_{OS_UPRN_RELEASE}_csv.zip"))
    db = sqlite3.connect(os.path.join(OUT, "addr-uprn.sqlite"))
    wanted = {row[0] for row in db.execute("SELECT DISTINCT uprn FROM map")}
    db.close()
    out_path = os.path.join(OUT, "uprn-points.csv")
    kept = scanned = 0
    with zipfile.ZipFile(zip_path) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
        with archive.open(names[0]) as raw, open(out_path, "w", newline="") as out:
            reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace"))
            writer = csv.writer(out)
            writer.writerow(["uprn", "easting", "northing", "latitude", "longitude"])
            for row in reader:
                scanned += 1
                uprn = row["UPRN"]
                if uprn in wanted:
                    writer.writerow([uprn, row["X_COORDINATE"], row["Y_COORDINATE"],
                                     row["LATITUDE"], row["LONGITUDE"]])
                    kept += 1
                if scanned % 5000000 == 0:
                    log(f"os-uprn: scanned {scanned} kept {kept}")
    stats = {"scanned": scanned, "kept": kept, "wanted": len(wanted), "zip_sha256": sha256_file(zip_path)}
    json.dump(stats, open(os.path.join(OUT, "os-uprn-stats.json"), "w"), indent=1)
    log(f"os-uprn: {kept}/{len(wanted)} wanted UPRNs located ({100*kept/max(1,len(wanted)):.1f}%)")


def parcels_from_gml(path):
    """Yield (inspire_id, wkt) from an INSPIRE Cadastral Parcels GML file."""
    for _, element in ET.iterparse(path, events=("end",)):
        if element.tag != f"{LR}PREDEFINED":
            continue
        inspire = element.findtext(f"{LR}INSPIREID")
        rings = []
        for polygon in element.iter(f"{GML}Polygon"):
            exterior = polygon.find(f"{GML}exterior/{GML}LinearRing/{GML}posList")
            if exterior is None or not exterior.text:
                continue
            rings.append(ring_wkt(exterior.text))
            for interior in polygon.findall(f"{GML}interior/{GML}LinearRing/{GML}posList"):
                rings.append(ring_wkt(interior.text))
        if inspire and rings:
            yield inspire, f"POLYGON({','.join(rings)})"
        element.clear()


def ring_wkt(pos_list):
    numbers = pos_list.split()
    pairs = [f"{numbers[i]} {numbers[i + 1]}" for i in range(0, len(numbers) - 1, 2)]
    if pairs and pairs[0] != pairs[-1]:
        pairs.append(pairs[0])
    return "(" + ",".join(pairs) + ")"


def stage_inspire():
    """Download and flatten every London authority's INSPIRE polygons."""
    out_path = os.path.join(OUT, "parcels.csv")
    stats = {"authorities": {}, "conditions": INSPIRE_CONDITIONS}
    with open(out_path, "w", newline="") as out:
        writer = csv.writer(out)
        writer.writerow(["inspire_id", "authority_code", "wkt"])
        for code, name in LONDON_AUTHORITIES.items():
            zip_path = download(INSPIRE_BASE + name + ".zip", os.path.join(OUT, f"inspire-{code}.zip"))
            count = 0
            with zipfile.ZipFile(zip_path) as archive:
                gml = [n for n in archive.namelist() if n.lower().endswith(".gml")][0]
                with archive.open(gml) as raw:
                    for inspire_id, wkt in parcels_from_gml(raw):
                        writer.writerow([inspire_id, code, wkt])
                        count += 1
            stats["authorities"][code] = {"file": name + ".zip", "parcels": count,
                                          "sha256": sha256_file(zip_path)}
            log(f"inspire: {name} {count} parcels")
    json.dump(stats, open(os.path.join(OUT, "inspire-stats.json"), "w"), indent=1)
    log(f"inspire: {sum(a['parcels'] for a in stats['authorities'].values())} parcels total")


def stage_emit():
    """address_id -> uprn CSV and the manifest fragment for the release record."""
    db = sqlite3.connect(os.path.join(OUT, "addr-uprn.sqlite"))
    with open(os.path.join(OUT, "address-uprn.csv"), "w", newline="") as out:
        writer = csv.writer(out)
        writer.writerow(["address_id", "uprn"])
        writer.writerows(db.execute("SELECT address_id, uprn FROM map"))
    db.close()
    manifest = {
        "transformation": ETL_VERSION,
        "inputs": {"epc_csv": sha256_file(EPC_CSV), "address_spine": sha256_file(ADDRESS_DB)},
        "stats": {name: json.load(open(os.path.join(OUT, f"{name}-stats.json")))
                  for name in ("uprn-map", "os-uprn", "inspire")},
        "outputs": {name: sha256_file(os.path.join(OUT, name))
                    for name in ("address-uprn.csv", "uprn-points.csv", "parcels.csv")},
        "sources": {
            "src-os-open-uprn-2026-08": {
                "url": OS_UPRN_URL, "licence": "OGL-3.0",
                "attribution": "Contains OS data © Crown copyright and database right 2026",
            },
            "src-hmlr-inspire-2026-09": {
                "url": INSPIRE_BASE, "licence": "OGL-3.0",
                "attribution": ("This information is subject to Crown copyright and database rights 2026 "
                                "and is reproduced with the permission of HM Land Registry. The polygons "
                                "(including the associated geometry, namely x, y co-ordinates) are subject "
                                "to Crown copyright and database rights 2026 Ordnance Survey 100026316."),
                "conditions": INSPIRE_CONDITIONS,
            },
        },
    }
    json.dump(manifest, open(os.path.join(OUT, "property-manifest.json"), "w"), indent=1)
    log("emit: property-manifest.json written")


STAGES = {"uprn-map": stage_uprn_map, "os-uprn": stage_os_uprn, "inspire": stage_inspire, "emit": stage_emit}

if __name__ == "__main__":
    for stage in sys.argv[1:] or STAGES:
        STAGES[stage]()
