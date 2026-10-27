"""Map delivery for all of England (CLOSE_KNIT_ENGLAND): values (and each area's box) per chunk of the view.

London's map loaded every value at once (1.4 MB per value pack). England has seven times as many areas, so the
map asks only for the chunks in view, at a level for its zoom (web/src/lib/map-coverage.ts); the shapes are vector
tiles (map_tiles.py):

- country (all of England in view): each region in view as MSOAs (medians of their LSOAs);
- wide (from zoom 7): each region in view as its own areas (LSOAs);
- neighbourhood: one chunk per LAD in view; London's 33 boroughs as one chunk (the request the London map always
  made), painted in the same frame as its neighbours.

Every level is the same for London and the rest of England: one map, one loading path. Colours follow the
view (web/src/lib/map-coverage.ts): a view of one region by that region's ranks (`region_percentile`, as
the area cards say), a view across regions by ranks in the country (`country_percentile`, stored by migration
124; a roll-up's from evidence.ROLLED_RANK_SQL).

A chunk is a region code (E12...) or a LAD code (E06-E09). Which areas sit in each chunk, and each
chunk's box, is read once per release (area_region, migration 103). Areas without data are simply
absent: the map draws what the release has and leaves the rest blank.
"""
from __future__ import annotations

import statistics
from collections.abc import Iterable, Mapping
from typing import Any

from . import coverage, kinds

SCHEMA_VERSION = "map-coverage.v1"
LEVELS = kinds.KINDS  # finest first
LONDON = coverage.LONDON_REGION

# Each area with its region, MSOA (an LSOA's) and LAD (borough id): the chunk index.
CHUNKS_SQL = """-- evidence:area-chunks
SELECT g.id, g.kind::text AS kind, g.name, r.region_code,
  CASE g.kind WHEN 'lsoa' THEN p.parent_id WHEN 'msoa' THEN g.parent_id ELSE g.id END AS borough_id,
  CASE g.kind WHEN 'lsoa' THEN g.parent_id END AS msoa_id
FROM area_geography g
LEFT JOIN area_geography p ON p.id = g.parent_id
LEFT JOIN area_region r ON r.area_id = g.id
WHERE g.kind::text IN """ + kinds.SQL_LIST + """
ORDER BY g.id"""

# Each LAD's box, rounded out to 3 decimals (~100 m): what the map tests against its view.
CHUNK_BOXES_SQL = """-- evidence:chunk-boxes
SELECT g.id, floor(ST_XMin(g.geometry) * 1000) / 1000 AS west, floor(ST_YMin(g.geometry) * 1000) / 1000 AS south,
  ceil(ST_XMax(g.geometry) * 1000) / 1000 AS east, ceil(ST_YMax(g.geometry) * 1000) / 1000 AS north
FROM area_geography g
WHERE g.kind = 'lad'
ORDER BY g.id"""


def _lad(borough_id: str | None) -> str | None:
    return borough_id.rsplit(":", 1)[-1] if borough_id else None


class ChunkIndex:
    """Which areas of each kind sit in each chunk, each area's parents, and each chunk's box."""

    def __init__(self, rows: Iterable[Mapping[str, Any]], boxes: Iterable[Mapping[str, Any]] = ()) -> None:
        self.areas: dict[str, Mapping[str, Any]] = {}
        self._members: dict[tuple[str, str], list[str]] = {}
        for row in rows:
            self.areas[row["id"]] = row
            for chunk in (row["region_code"], _lad(row["borough_id"])):
                if chunk:
                    self._members.setdefault((row["kind"], chunk), []).append(row["id"])
        self.lad_boxes = {_lad(row["id"]): [round(float(row[key]), 3) for key in ("west", "south", "east", "north")]
                          for row in boxes}

    def ids(self, kind: str, chunk: str) -> list[str] | None:
        """The areas of `kind` in `chunk`; None for a chunk the release does not have."""
        return self._members.get((kind, chunk))

    def has_chunk(self, chunk: str) -> bool:
        return any(key[1] == chunk for key in self._members)

    def parent(self, area_id: str, level: str) -> str | None:
        area = self.areas.get(area_id)
        if area is None:
            return None
        if level == kinds.LAD:
            return area["borough_id"]
        return area["msoa_id"] if level == "msoa" else area_id

    def region_of_lad(self, lad: str) -> str | None:
        area = self.areas.get(f"uk:lad:{lad}")
        return area["region_code"] if area else None

    def payload(self, release_id: str) -> dict:
        """map-coverage.v1 with the flag on: England's bounds, the regions (the MSOA level's chunks) and
        the neighbourhood level's chunks (London whole, every other LAD on its own), each with its box."""
        regions: dict[str, list[float]] = {}
        chunks = []
        for lad, box in sorted(self.lad_boxes.items()):
            region = self.region_of_lad(lad)
            if not region or not self.ids("lsoa", lad):
                continue  # no neighbourhoods loaded here: nothing to draw
            current = regions.get(region)
            regions[region] = box[:] if current is None else [
                min(current[0], box[0]), min(current[1], box[1]), max(current[2], box[2]), max(current[3], box[3])]
            if region != coverage.LONDON_REGION:
                chunks.append({"id": lad, "region": region, "bbox": box, "areas": len(self.ids("lsoa", lad) or ())})
        if coverage.LONDON_REGION in regions:
            chunks.insert(0, {"id": coverage.LONDON_REGION, "region": coverage.LONDON_REGION,
                              "bbox": regions[coverage.LONDON_REGION],
                              "areas": len(self.ids("lsoa", coverage.LONDON_REGION) or ())})
        box = coverage.ENGLAND_BOX
        return {
            "schemaVersion": SCHEMA_VERSION, "coverage": "england", "productReleaseId": release_id,
            "bounds": [[box["longitude"][0], box["latitude"][0]], [box["longitude"][1], box["latitude"][1]]],
            "regions": [{"id": code, "name": coverage.region_name(code), "bbox": regions[code]} for code in sorted(regions)],
            "chunks": chunks,
        }


def london_payload() -> dict:
    """map-coverage.v1 with the flag off: the London map as it always was (one request per layer); its tiles are
    London's alone (map_tiles.with_tiles)."""
    box = coverage.LONDON_BOX
    return {"schemaVersion": SCHEMA_VERSION, "coverage": "london", "productReleaseId": None,
            "bounds": [[box["longitude"][0], box["latitude"][0]], [box["longitude"][1], box["latitude"][1]]],
            "regions": [], "chunks": []}


def coarser(level: str | None, carrier: str) -> bool:
    """Whether `level` is a coarser level than the metric's own carrier (a roll-up is needed)."""
    return level in LEVELS and carrier in LEVELS and LEVELS.index(level) > LEVELS.index(carrier)


COMPACT_SCHEMA = "area-value-pack-compact.v1"
COMPACT_FIELDS = ("geographyId", "value", "regionPercentile", "countryPercentile", "quality", "areaCount", "breakdown")


def compact_pack(pack: Mapping[str, Any]) -> dict:
    """A value pack as the map reads it (?format=compact): per area only its id, value, regional and England
    percentiles, quality, area count (a roll-up) and crime breakdown, as rows; what every entry repeats
    (metric, month, carrier, direction, source) is said once. England's 34k LSOAs are ~1.5 MB instead of
    ~15 MB before compression, and parse in a tenth of the time."""
    values = pack["values"]
    first = values[0] if values else {}
    body = {
        "schemaVersion": COMPACT_SCHEMA, "metricId": pack["metricId"], "period": pack["period"],
        "sourceVersion": pack["sourceVersion"], "productReleaseId": pack.get("productReleaseId"),
        "carrier": first.get("carrier"), "direction": first.get("direction"), "fields": list(COMPACT_FIELDS),
        "values": [[entry["geographyId"], entry["value"], entry["regionPercentile"], entry["countryPercentile"],
                    entry["quality"], entry.get("areaCount"), entry.get("breakdown")] for entry in values],
    }
    for key in ("chunk", "level", "region"):
        if key in pack:
            body[key] = pack[key]
    return body


def roll_up(rows: Iterable[Mapping[str, Any]], index: ChunkIndex, level: str) -> list[dict]:
    """Pack rows rolled up to `level`: each wider area's value and percentile are the medians of its
    areas' (as an MSOA's or borough's £/m² already is, #208), with how many areas were used. An area
    none of whose children has a value is left out."""
    groups: dict[str, list[Mapping[str, Any]]] = {}
    for row in rows:
        parent = index.parent(row["geography_id"], level)
        if parent and row["value"] is not None:
            groups.setdefault(parent, []).append(row)
    rolled = []
    for parent, children in sorted(groups.items()):
        percentiles = [row["region_percentile"] for row in children if row["region_percentile"] is not None]
        first = children[0]
        rolled.append({
            "geography_id": parent, "name": index.areas[parent]["name"] if parent in index.areas else "",
            "carrier": level, "metric_id": first["metric_id"], "period": first["period"],
            "value": round(float(statistics.median(float(row["value"]) for row in children)), 4),
            "region_percentile": round(statistics.median(percentiles)) if percentiles else None,
            "country_percentile": None, "sample_count": None,
            "quality": "fallback" if any(row["quality"] == "fallback" for row in children) else "observed",
            "source_release_id": first["source_release_id"], "area_count": len(children),
        })
    return rolled
