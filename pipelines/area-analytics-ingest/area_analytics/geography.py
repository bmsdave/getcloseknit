"""Immutable ONS 2021 statistical boundary ingestion for England.

Only statistical multipolygons are accepted: LSOA, MSOA, and local authority
district (kind 'lad', any English LAD) boundaries plus the official LSOA to MSOA to LAD lookup.
Hierarchy is reconciled against the lookup, never inferred from
street or property precision. Network stays outside this module:
callers fetch bytes explicitly, verify checksums, then ingest.
"""

import csv
import hashlib
import re
from copy import deepcopy

from area_analytics import coverage


GEOGRAPHY_VINTAGE = "2021"
TRANSFORMATION_VERSION = "geography-v1"
LICENCE = "OGL-3.0"
ATTRIBUTION = "Office for National Statistics"
STATISTICAL_CAVEAT = "Statistical boundaries only; no street or property precision."

PARENT_KIND = {"lsoa": "msoa", "msoa": "lad", "lad": None}
# The id segment of a kind: uk:lad: since step R2 (uk:lad: before; docs/architecture/global-geography.md).
ID_PREFIX = {"lsoa": "lsoa", "msoa": "msoa", "lad": "lad"}

# The 'lad' kind is any English LAD (E06/E07/E08/E09); the 33 London boroughs are
# the E09 subset. Codes come from the shared coverage list (england_lads.json).
LONDON_BOROUGH_CODES = coverage.LONDON_BOROUGH_CODES
BOROUGH_CODES = coverage.ENGLAND_LAD_CODES

OFFICIAL_CODE_RE = re.compile(r"^E[0-9]{8}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
VINTAGE_FIELD_RE = re.compile(r"^[A-Z]+21(CD|NM)$")


def stable_geography_id(kind, official_code):
    if kind not in PARENT_KIND:
        raise ValueError(f"unknown geography kind: {kind}")
    if not isinstance(official_code, str) or not OFFICIAL_CODE_RE.match(official_code):
        raise ValueError(f"invalid official code: {official_code!r}")
    return f"uk:{ID_PREFIX[kind]}:{official_code}"


def verify_content_checksum(content, expected_sha256):
    if not isinstance(content, bytes) or not content:
        raise ValueError("boundary payload is empty")
    if not isinstance(expected_sha256, str) or not SHA256_RE.match(expected_sha256):
        raise ValueError("expected sha256 must be 64 lowercase hexadecimal characters")
    actual = hashlib.sha256(content).hexdigest()
    if actual != expected_sha256:
        raise ValueError("boundary checksum mismatch")
    return actual


def validate_multipolygon(geometry):
    if not isinstance(geometry, dict):
        raise ValueError("geometry must be a GeoJSON geometry object")
    kind = geometry.get("type")
    if kind == "Polygon":
        polygons = [geometry.get("coordinates")]
    elif kind == "MultiPolygon":
        polygons = geometry.get("coordinates")
    else:
        raise ValueError("only Polygon/MultiPolygon boundaries are accepted")
    if not isinstance(polygons, list) or not polygons:
        raise ValueError("boundary has no polygons")
    return [_validate_polygon(polygon) for polygon in polygons]


def _validate_polygon(polygon):
    if not isinstance(polygon, list) or not polygon:
        raise ValueError("boundary polygon has no rings")
    return [_validate_ring(ring) for ring in polygon]


def _validate_ring(ring):
    if not isinstance(ring, list) or len(ring) < 4:
        raise ValueError("boundary ring needs at least four positions")
    if ring[0] != ring[-1]:
        raise ValueError("boundary ring is not closed")
    validated = [_validate_position(position) for position in ring]
    _reject_self_intersection(validated)
    return validated


def _reject_self_intersection(ring):
    edges = [(ring[index], ring[index + 1]) for index in range(len(ring) - 1)]
    boxes = [_edge_box(edge) for edge in edges]
    for first in range(len(edges)):
        for second in range(first + 1, len(edges)):
            if _crossing_pair(edges[first], edges[second], boxes[first], boxes[second]):
                raise ValueError("boundary ring is self-intersecting")


def _crossing_pair(first, second, first_box, second_box):
    if _share_endpoint(first, second):
        return False
    return _boxes_overlap(first_box, second_box) and _segments_cross(first, second)


def _edge_box(edge):
    (x1, y1), (x2, y2) = edge
    return (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))


def _boxes_overlap(first, second):
    return first[0] <= second[2] and second[0] <= first[2] \
        and first[1] <= second[3] and second[1] <= first[3]


def _share_endpoint(first, second):
    return any(a == b for a in first for b in second)


def _segments_cross(first, second):
    (p1, p2), (p3, p4) = first, second
    facing = (_orientation(p3, p4, p1), _orientation(p3, p4, p2),
              _orientation(p1, p2, p3), _orientation(p1, p2, p4))
    if facing[0] != facing[1] and facing[2] != facing[3]:
        return True
    return (facing[0] == 0 and _on_segment(p3, p1, p4)) \
        or (facing[1] == 0 and _on_segment(p3, p2, p4)) \
        or (facing[2] == 0 and _on_segment(p1, p3, p2)) \
        or (facing[3] == 0 and _on_segment(p1, p4, p2))


def _orientation(anchor, moving, candidate):
    value = (moving[0] - anchor[0]) * (candidate[1] - anchor[1]) \
        - (moving[1] - anchor[1]) * (candidate[0] - anchor[0])
    return 0 if value == 0 else (1 if value > 0 else -1)


def _on_segment(anchor, point, far):
    return min(anchor[0], far[0]) <= point[0] <= max(anchor[0], far[0]) \
        and min(anchor[1], far[1]) <= point[1] <= max(anchor[1], far[1])


def _validate_position(position):
    if not isinstance(position, list) or len(position) != 2:
        raise ValueError("boundary position must be [longitude, latitude]")
    longitude, latitude = position
    if not isinstance(longitude, (int, float)) or not isinstance(latitude, (int, float)):
        raise ValueError("boundary position must be numeric")
    if not -180 <= longitude <= 180:
        raise ValueError(f"longitude out of range: {longitude!r}")
    if not -90 <= latitude <= 90:
        raise ValueError(f"latitude out of range: {latitude!r}")
    return [longitude, latitude]


def extract_boundary_records(collection, kind, code_field, name_field):
    if kind not in PARENT_KIND:
        raise ValueError(f"unknown geography kind: {kind}")
    _require_vintage_fields(code_field, name_field)
    try:
        features = collection["features"]
    except (KeyError, TypeError) as error:
        raise ValueError("boundary collection has no features") from error
    return [_extract_record(feature, kind, code_field, name_field) for feature in features]


def _require_vintage_fields(code_field, name_field):
    for field in (code_field, name_field):
        if not isinstance(field, str) or not VINTAGE_FIELD_RE.match(field):
            raise ValueError(f"boundary fields must name the 2021 vintage: {field!r}")


def _extract_record(feature, kind, code_field, name_field):
    try:
        properties = feature["properties"]
        geometry = feature["geometry"]
    except (KeyError, TypeError) as error:
        raise ValueError("boundary feature needs properties and geometry") from error
    return parse_boundary_record({
        "kind": kind, "officialCode": properties.get(code_field),
        "name": properties.get(name_field), "geometry": geometry,
    })


def parse_boundary_record(record):
    kind = record.get("kind")
    if kind not in PARENT_KIND:
        raise ValueError(f"unknown geography kind: {kind}")
    code = record.get("officialCode")
    if not isinstance(code, str) or not OFFICIAL_CODE_RE.match(code):
        raise ValueError(f"invalid official code: {code!r}")
    if kind == "lad" and code not in BOROUGH_CODES:
        raise ValueError(f"borough is not an English local authority district: {code}")
    name = record.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError(f"boundary {code} has no name")
    polygons = validate_multipolygon(record.get("geometry"))
    return {
        "id": stable_geography_id(kind, code), "kind": kind,
        "official_code": code, "name": name.strip(),
        "geometry": {"type": "MultiPolygon", "coordinates": polygons},
    }


def parse_lookup_csv(payload):
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8")
    rows = csv.DictReader(payload.splitlines())
    required = {"LSOA21CD", "MSOA21CD", "LAD21CD"}
    if rows.fieldnames is None or not required.issubset(rows.fieldnames):
        raise ValueError("lookup needs LSOA21CD, MSOA21CD and LAD21CD columns")
    return [parse_lookup_record(row) for row in rows]


def parse_lookup_record(row):
    codes = {"lsoa_code": row.get("LSOA21CD"), "msoa_code": row.get("MSOA21CD"),
             "lad_code": row.get("LAD21CD")}
    for key, code in codes.items():
        if not isinstance(code, str) or not OFFICIAL_CODE_RE.match(code):
            raise ValueError(f"invalid {key} official code: {code!r}")
    if codes["lad_code"] not in BOROUGH_CODES:
        raise ValueError(f"lookup LAD is not an English local authority district: {codes['lad_code']}")
    return codes


def reconcile_hierarchy(boundaries, lookups):
    by_code = {}
    for boundary in boundaries:
        if boundary["official_code"] in by_code:
            raise ValueError(f"duplicate boundary: {boundary['official_code']}")
        by_code[boundary["official_code"]] = boundary
    seen = {}
    parents = {}
    for lookup in lookups:
        _check_consistent(lookup, parents)
        for area in _resolve_row(lookup, by_code):
            seen[area["id"]] = area
    _reject_orphans(boundaries, lookups)
    return sorted(seen.values(), key=lambda area: area["id"])


def _check_consistent(lookup, parents):
    pairs = ((lookup["lsoa_code"], lookup["msoa_code"]),
             (lookup["msoa_code"], lookup["lad_code"]))
    for child, parent in pairs:
        if child in parents and parents[child] != parent:
            raise ValueError(f"hierarchy mismatch for {child}")
        parents[child] = parent


def _resolve_row(lookup, by_code):
    lsoa = _typed_boundary(by_code, lookup["lsoa_code"], "lsoa")
    msoa = _typed_boundary(by_code, lookup["msoa_code"], "msoa")
    borough = _typed_boundary(by_code, lookup["lad_code"], "lad")
    return [_area_row(lsoa, msoa["id"]), _area_row(msoa, borough["id"]),
            _area_row(borough, None)]


def _typed_boundary(by_code, code, kind):
    boundary = by_code.get(code)
    if boundary is None:
        raise ValueError(f"boundary without official lookup entry: {code}")
    if boundary["kind"] != kind:
        raise ValueError(f"hierarchy mismatch: {code} is {boundary['kind']}")
    return boundary


def _area_row(boundary, parent_id):
    return {
        "id": boundary["id"], "kind": boundary["kind"],
        "official_code": boundary["official_code"], "name": boundary["name"],
        "parent_id": parent_id, "geometry": deepcopy(boundary["geometry"]),
    }


def _reject_orphans(boundaries, lookups):
    covered = {code for lookup in lookups for code in lookup.values()}
    orphans = sorted(b["official_code"] for b in boundaries
                     if b["kind"] in ("lsoa", "msoa") and b["official_code"] not in covered)
    if orphans:
        raise ValueError(f"boundary without official lookup entry: {orphans[0]}")


def build_coverage_report(boundaries, lookups):
    """Reconcile expected units against the official lookup.

    Every lookup-expected code ends up either as a parented area or as a
    quarantined entry carrying a reason, so missing units stay explicit
    instead of silently dropped. Duplicate boundary codes still raise:
    they are corrupt input, not coverable absence.
    """
    parsed = [_ensure_parsed(boundary) for boundary in boundaries]
    by_code = _index_boundaries(parsed)
    rows = [dict(lookup) for lookup in lookups]
    quarantine = {}
    _quarantine_conflicts(rows, quarantine)
    areas = _resolve_clean_rows(rows, by_code, quarantine)
    _quarantine_tainted(rows, by_code, quarantine, areas)
    _quarantine_unlinked(parsed, quarantine, areas)
    expected = {code for row in rows for code in row.values()}
    ordered = sorted(areas.values(), key=lambda area: area["id"])
    quarantined = sorted(quarantine.values(), key=lambda entry: entry["official_code"])
    return {"areas": ordered, "quarantine": quarantined,
            "expected": len(expected), "matched": len(ordered)}


def _index_boundaries(boundaries):
    by_code = {}
    for boundary in boundaries:
        if boundary["official_code"] in by_code:
            raise ValueError(f"duplicate boundary: {boundary['official_code']}")
        by_code[boundary["official_code"]] = boundary
    return by_code


def _row_pairs(row):
    return (("lsoa", row["lsoa_code"], row["msoa_code"]),
            ("msoa", row["msoa_code"], row["lad_code"]))


def _quarantine_entry(kind, official_code, reason):
    return {"official_code": official_code, "kind": kind, "reason": reason}


def _quarantine_conflicts(rows, quarantine):
    claims = {}
    kinds = {}
    for row in rows:
        for kind, child, parent in _row_pairs(row):
            claims.setdefault(child, set()).add(parent)
            kinds[child] = kind
    for child, parents in claims.items():
        if len(parents) > 1:
            quarantine[child] = _quarantine_entry(kinds[child], child, "hierarchy-mismatch")


def _resolve_clean_rows(rows, by_code, quarantine):
    areas = {}
    for row in rows:
        if any(code in quarantine for code in row.values()):
            continue
        _resolve_clean_row(row, by_code, quarantine, areas)
    return areas


def _resolve_clean_row(row, by_code, quarantine, areas):
    wanted = (("lsoa", row["lsoa_code"]), ("msoa", row["msoa_code"]),
              ("lad", row["lad_code"]))
    if any(_unresolvable(kind, code, by_code, quarantine) for kind, code in wanted):
        return
    lsoa = by_code[row["lsoa_code"]]
    msoa = by_code[row["msoa_code"]]
    borough = by_code[row["lad_code"]]
    resolved = (_area_row(lsoa, msoa["id"]), _area_row(msoa, borough["id"]),
                _area_row(borough, None))
    for area in resolved:
        areas[area["id"]] = area


def _unresolvable(kind, code, by_code, quarantine):
    boundary = by_code.get(code)
    if boundary is not None and boundary["kind"] == kind:
        return False
    reason = "missing-boundary" if boundary is None else "hierarchy-mismatch"
    quarantine.setdefault(code, _quarantine_entry(kind, code, reason))
    return True


def _quarantine_tainted(rows, by_code, quarantine, areas):
    covered = {area["official_code"] for area in areas.values()}
    kinds = {"lsoa_code": "lsoa", "msoa_code": "msoa", "lad_code": "lad"}
    for row in rows:
        if not any(code in quarantine for code in row.values()):
            continue
        for key, kind in kinds.items():
            _quarantine_skipped(row[key], kind, by_code, quarantine, covered)


def _quarantine_skipped(code, kind, by_code, quarantine, covered):
    if code in covered or code in quarantine:
        return
    boundary = by_code.get(code)
    reason = "hierarchy-mismatch" if boundary is not None else "missing-boundary"
    quarantine[code] = _quarantine_entry(kind, code, reason)


def _quarantine_unlinked(boundaries, quarantine, areas):
    covered = {area["official_code"] for area in areas.values()}
    for boundary in boundaries:
        code = boundary["official_code"]
        if code not in covered and code not in quarantine:
            quarantine[code] = _quarantine_entry(boundary["kind"], code, "missing-lookup")


def build_geography_manifest(inputs, retrieved_at, release_date):
    entries = [dict(entry) for entry in inputs]
    if not entries:
        raise ValueError("geography release needs at least one input")
    for entry in entries:
        missing = {"sourceId", "sourceUrl", "sha256"} - entry.keys()
        if missing:
            raise ValueError(f"input provenance missing: {', '.join(sorted(missing))}")
        if not SHA256_RE.match(entry["sha256"]):
            raise ValueError("input sha256 must be 64 lowercase hexadecimal characters")
    if not retrieved_at or not release_date:
        raise ValueError("geography release needs retrieval and release dates")
    ordered = sorted(entries, key=lambda entry: entry["sourceId"])
    return {
        "licence": LICENCE, "attribution": ATTRIBUTION,
        "geographyVintage": GEOGRAPHY_VINTAGE,
        "transformationVersion": TRANSFORMATION_VERSION,
        "retrievedAt": retrieved_at, "releaseDate": release_date,
        "validationStatus": "passed", "caveats": [STATISTICAL_CAVEAT],
        "inputs": ordered,
    }


def build_geography_release(areas, manifest):
    if manifest.get("validationStatus") != "passed":
        raise ValueError("geography validation status must be passed")
    if manifest.get("geographyVintage") != GEOGRAPHY_VINTAGE:
        raise ValueError("geography vintage must be 2021")
    if manifest.get("licence") != LICENCE:
        raise ValueError("geography licence must be OGL-3.0")
    ordered = sorted((deepcopy(area) for area in areas), key=lambda area: area["id"])
    return {"manifest": deepcopy(manifest), "areas": ordered}


def ingest_geography_release(boundaries, lookups, manifest):
    parsed = [_ensure_parsed(boundary) for boundary in boundaries]
    copied = [dict(lookup) for lookup in lookups]
    return build_geography_release(reconcile_hierarchy(parsed, copied), manifest)


def _ensure_parsed(boundary):
    if "official_code" not in boundary:
        return parse_boundary_record(boundary)
    polygons = validate_multipolygon(boundary.get("geometry"))
    record = deepcopy(boundary)
    record["geometry"] = {"type": "MultiPolygon", "coordinates": polygons}
    return record
