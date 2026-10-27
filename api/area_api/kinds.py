"""Geography kinds (the geography_kind enum): lsoa, msoa and lad.

The local-authority kind was called 'borough' until docs/architecture/global-geography.md renamed it: step R1 the
kind (migration 121), step R2 the ids and page URLs (migration 129: uk:borough:E09000001 -> uk:lad:E09000001,
/area/borough/... -> 301 /area/lad/...). The old names keep working on input, for good: the old id is a row of
area_alias, `canonical_id`/`canonical_value` read it as the new one (the API's AreaAliasMiddleware, call_tool,
shared links), and ?carrier=borough / ?level=borough read as lad (`normalise`). Answers always say lad.
The area tiles still name the layer and file 'borough' (`tile_kind`): renaming them means new PMTiles, step 7.
"""
from __future__ import annotations

from typing import Any

LAD = "lad"
KINDS = ("lsoa", "msoa", LAD)  # finest first
OLD_LAD = "borough"  # the old kind name: accepted on input; still the tile layer and file kind
ID_PREFIX = f"uk:{LAD}:"
OLD_ID_PREFIX = f"uk:{OLD_LAD}:"

# area_geography also holds the rows above the LADs (regions, England, the country: migration 123), which no page,
# card or answer serves yet. SQL reading every area keeps to KINDS (g.kind::text IN kinds.SQL_LIST), and a LAD's
# parent (its region) reads NULL: the served tree still ends at the LAD (PARENT_SQL, for area_geography g).
SQL_LIST = "(" + ", ".join(f"'{kind}'" for kind in KINDS) + ")"
PARENT_SQL = f"CASE WHEN g.kind::text = '{LAD}' THEN NULL ELSE g.parent_id END"


def normalise(kind: str | None) -> str | None:
    """A requested kind with the old name read as the new one (borough -> lad)."""
    return LAD if kind == OLD_LAD else kind


def kind_of(geography_id: str) -> str:
    """The kind of an area id: uk:lsoa:... -> lsoa, uk:lad:... (or an old uk:borough:...) -> lad."""
    parts = geography_id.split(":")
    return (normalise(parts[1]) or "") if len(parts) > 2 else ""


def tile_kind(kind: str) -> str:
    """The kind as the area tiles name their layer and file (lad -> borough, until step 7)."""
    return OLD_LAD if kind == LAD else kind


def canonical_id(value: str) -> str:
    """An area id with an old alias read as its current id: uk:borough:E09000001 -> uk:lad:E09000001."""
    return ID_PREFIX + value[len(OLD_ID_PREFIX):] if value.startswith(OLD_ID_PREFIX) else value


def canonical_text(text: str) -> str:
    """Every old area id in a path, query string or JSON text read as its current id (plain or %-encoded colons)."""
    if OLD_LAD not in text:
        return text
    return (text.replace(OLD_ID_PREFIX, ID_PREFIX)
            .replace("uk%3Aborough%3A", "uk%3Alad%3A").replace("uk%3aborough%3a", "uk%3alad%3a"))


def canonical_value(value: Any) -> Any:
    """`canonical_id` applied to every string in a JSON-like value (tool arguments, a decoded shared profile)."""
    if isinstance(value, str):
        return canonical_id(value)
    if isinstance(value, list):
        return [canonical_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(canonical_value(item) for item in value)
    if isinstance(value, dict):
        return {canonical_id(key) if isinstance(key, str) else key: canonical_value(item) for key, item in value.items()}
    return value
