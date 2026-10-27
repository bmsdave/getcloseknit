"""Chunked ArcGIS downloads of 2021 statistical boundaries (LSOA/MSOA/LAD) for the coverage.

The BGC layers carry no parent fields, so we query explicit code lists in chunks of 150 via
POST. Codes come from the shared coverage list (area_coverage: England's 296 LADs and the
LSOA/MSOA lookup; CLOSE_KNIT_ETL_COVERAGE=london keeps London's).
Resumable per-chunk files. Usage:
    python3 boundaries.py [lsoa|msoa|lad|ALL]
    CLOSE_KNIT_ETL_COVERAGE=london|england (default england)  BOUNDARIES_OUT=/tmp/aedata
"""
import json
import os
import sys
import urllib.parse
import urllib.request

import area_coverage

OUT = os.environ.get("BOUNDARIES_OUT", "/tmp/aedata")
LAYERS = {
    "lsoa": (
        "Lower_layer_Super_Output_Areas_December_2021_Boundaries_EW_BGC_V5",
        "LSOA21CD",
        "LSOA21NM",
    ),
    "msoa": (
        "Middle_layer_Super_Output_Areas_December_2021_Boundaries_EW_BGC_V3",
        "MSOA21CD",
        "MSOA21NM",
    ),
    "lad": (
        # May 2026: the LAD codes of the ONSPD lookup (Barnsley/Sheffield became E08000038/39).
        "Local_Authority_Districts_May_2026_Boundaries_UK_BGC",
        "LAD26CD",
        "LAD26NM",
    ),
}
CHUNK = 150


def query(layer, code_field, name_field, codes):
    url = (
        "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/"
        f"{layer}/FeatureServer/0/query"
    )
    quoted = ",".join(f"'{c}'" for c in codes)
    form = {
        "where": f"{code_field} IN ({quoted})",
        "outFields": f"{code_field},{name_field}",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    }
    req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode())
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def coverage_codes(kind, cov=None):
    """LSOA, MSOA or LAD codes of the coverage (England by default)."""
    cov = cov or area_coverage.from_env()
    lookup = area_coverage.lsoa_lookup()
    if kind == "lad":
        return sorted(cov.lad_codes)
    if kind == "msoa":
        return sorted({msoa for msoa, lad in lookup.values() if lad in cov.lad_codes})
    return sorted(code for code, (_, lad) in lookup.items() if lad in cov.lad_codes)


def fetch_kind(kind):
    layer, code_field, name_field = LAYERS[kind]
    codes = coverage_codes(kind)
    print(f"{kind}: {len(codes)} areas", flush=True)
    features = []
    for i in range(0, len(codes), CHUNK):
        part = os.path.join(OUT, f"geom-{kind}-{i//CHUNK:02d}.json")
        chunk = codes[i : i + CHUNK]
        if os.path.exists(part):
            fc = json.load(open(part))
        else:
            fc = query(layer, code_field, name_field, chunk)
            json.dump(fc, open(part, "w"))
        got = {f["properties"][code_field] for f in fc.get("features", [])}
        missing = set(chunk) - got
        if missing:
            print(f"{kind}: chunk {i//CHUNK} MISSING {len(missing)}: {sorted(missing)[:5]}", flush=True)
        features.extend(fc.get("features", []))
        print(f"{kind}: chunk {i//CHUNK} +{len(fc.get('features', []))} total={len(features)}", flush=True)
    geoms = {}
    for f in features:
        geoms.setdefault(f["properties"][code_field], []).append(f)
    dupes = {k: len(v) for k, v in geoms.items() if len(v) > 1}
    if dupes:
        print(f"{kind}: DUPLICATE codes: {list(dupes)[:5]}", flush=True)
    merged = {"type": "FeatureCollection", "features": [v[0] for v in geoms.values()]}
    json.dump(merged, open(os.path.join(OUT, f"geom-{kind}.json"), "w"))
    kinds = {}
    for f in merged["features"]:
        kinds[f["geometry"]["type"]] = kinds.get(f["geometry"]["type"], 0) + 1
    print(f"{kind}: FINAL {len(merged['features'])} geometry={kinds}", flush=True)


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "ALL"
    for kind in LAYERS if arg == "ALL" else [arg]:
        fetch_kind(kind)
