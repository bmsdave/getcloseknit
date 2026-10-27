"""Zones outside the match pack: the station lookup behind the zone picker and
the ``outsideZones`` query parameter of the similar-areas endpoint."""
import json
import re
from typing import Any, Iterable, Mapping

from .evidence import MalformedQuery
from .matching import validate_zones

MAX_STATION_RESULTS = 10

# Station names and queries are compared in one normal form, so "Kings Cross", "king's cross"
# and "KINGS CROSS station" all find "King's Cross St Pancras": lower case, & → and, possessive
# 's and apostrophes dropped, saint → st, a trailing s on each word dropped (plural or possessive,
# applied to both sides alike), then everything but letters and digits removed.
# station_name_key() is the Python twin; tests pin the two together.
def station_name_key_sql(column: str) -> str:
    return ("regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace("
            f"replace(lower({column}), '&', ' and '), '[''\u2019]s\\M', '', 'g'), '[''\u2019]', '', 'g'), "
            "'\\msaint\\M', 'st', 'g'), 's\\M', '', 'g'), '[^a-z0-9]', '', 'g')")


STATION_NAME_KEY_SQL = station_name_key_sql("s.name")

# Station hits come from place_station (migration 017: OSM locations with TfL modes, zones and
# lines), not the OSM-only `station` table of the walk-access ETL, whose modes miss lines and whose
# merge folds twin stations into one (#241). Each hit still carries the walk table's station id
# (what find_areas.near_stations and the zone picker send): the released `station` row sharing an
# OSM id, else the nearest released row within WALK_LINK_METRES with the same name once a bracketed
# line list is dropped (that ETL merges same-named features within 500 m, so twins such as
# "Hammersmith (District and Piccadilly lines)" share its one walk row), else osm:<place id>.
# Ranked like the area search: an exact name first, then a prefix, then a substring.
WALK_LINK_METRES = 500


def _bare_name_key_sql(column: str) -> str:
    return station_name_key_sql(f"regexp_replace({column}, '\\(.*\\)', '', 'g')")


STATION_SEARCH_SQL = f"""-- evidence:station-search
SELECT COALESCE(link.id, 'osm:' || s.id) AS id, s.name, s.modes, s.zone, s.lines,
  ST_X(s.location) AS center_lon, ST_Y(s.location) AS center_lat
FROM place_station s
LEFT JOIN LATERAL (
  SELECT walk.id
  FROM station walk
  JOIN product_release_member member ON member.source_release_id = walk.source_release_id
  WHERE member.release_id = (SELECT release_id FROM active_product_release)
    AND (substr(walk.id, 5) = ANY(s.osm_ids)
         OR (ST_DWithin(walk.geom::geography, s.location::geography, {WALK_LINK_METRES})
             AND {_bare_name_key_sql("walk.name")} = {_bare_name_key_sql("s.name")}))
  ORDER BY substr(walk.id, 5) = ANY(s.osm_ids) DESC, ST_Distance(walk.geom::geography, s.location::geography)
  LIMIT 1) link ON true
WHERE {STATION_NAME_KEY_SQL} LIKE %s
ORDER BY CASE WHEN {STATION_NAME_KEY_SQL} = %s THEN 0 WHEN {STATION_NAME_KEY_SQL} LIKE %s THEN 1 ELSE 2 END,
  length(s.name), s.name, s.id
LIMIT %s"""

# Words people add that station names do not carry.
STATION_FILLER = re.compile(r"\b(station|stn|tube|underground|overground|railway|rail)\b")

# Abbreviations, codes and nicknames Londoners use for stations: the whole query maps to a name.
STATION_ALIASES = {
    "kx": "King's Cross", "kgx": "King's Cross", "kings x": "King's Cross", "kxsp": "King's Cross St Pancras",
    "stp": "St Pancras", "eus": "Euston", "pad": "Paddington", "wat": "Waterloo", "wloo": "Waterloo",
    "vic": "Victoria", "lst": "Liverpool Street", "lbg": "London Bridge", "ldn bridge": "London Bridge",
    "cst": "Cannon Street", "fst": "Fenchurch Street", "myb": "Marylebone", "chx": "Charing Cross",
    "tcr": "Tottenham Court Road", "oc": "Oxford Circus", "ox circ": "Oxford Circus",
    "picc circus": "Piccadilly Circus", "cw": "Canary Wharf", "canary": "Canary Wharf",
    "e&c": "Elephant & Castle", "e and c": "Elephant & Castle", "elephant": "Elephant & Castle",
    "hbi": "Highbury & Islington", "highbury": "Highbury & Islington", "ally pally": "Alexandra Palace",
    "clj": "Clapham Junction", "clapham jn": "Clapham Junction", "shep bush": "Shepherd's Bush",
    "lhr": "Heathrow", "lcy": "London City Airport", "sfd": "Stratford", "sra": "Stratford",
    "ham and city": "Hammersmith", "brixton market": "Brixton",
    # Twin stations: the line people add to tell them apart. Both twins come back, each with
    # its own lines, so the caller picks.
    "hammersmith piccadilly": "Hammersmith", "hammersmith district": "Hammersmith",
    "hammersmith circle": "Hammersmith", "hammersmith h and c": "Hammersmith",
    "edgware road bakerloo": "Edgware Road", "edgware road circle": "Edgware Road",
    "edgware road district": "Edgware Road",
}


def station_name_key(text: str) -> str:
    key = text.lower().replace("&", " and ")
    key = re.sub(r"['\u2019]s\b", "", key)
    key = re.sub(r"['\u2019]", "", key)
    key = re.sub(r"\bsaint\b", "st", key)
    key = re.sub(r"s\b", "", key)
    return re.sub(r"[^a-z0-9]", "", key)


_ALIAS_KEYS = {station_name_key(alias): name for alias, name in STATION_ALIASES.items()}


def station_query_key(query: str) -> str:
    """The normal form of what the user typed, with fillers dropped and nicknames expanded."""
    text = query.strip()
    alias = _ALIAS_KEYS.get(station_name_key(text))
    if alias:
        return station_name_key(alias)
    stripped = STATION_FILLER.sub(" ", text.lower()).strip()
    alias = _ALIAS_KEYS.get(station_name_key(stripped))
    if alias:
        return station_name_key(alias)
    return station_name_key(stripped) or station_name_key(text)


def parse_zones_param(text: str | None) -> list[dict] | None:
    """``outsideZones`` is the profile's zones array as JSON; empty means none."""
    if not text:
        return None
    try:
        zones = json.loads(text)
        validate_zones(zones)
    except ValueError as error:  # JSON errors and InvalidMatchRequest alike
        raise MalformedQuery(f"invalid outsideZones: {error}") from error
    return zones or None


def station_result(row: Mapping[str, Any]) -> dict:
    lines = row.get("lines") or []
    if isinstance(lines, str):
        lines = json.loads(lines)
    return {"stationId": row["id"], "name": row["name"], "modes": list(row["modes"]),
            "lines": [{"id": line["id"], "name": line["name"], "mode": line["mode"]} for line in lines],
            "zone": row.get("zone"), "center": [row["center_lon"], row["center_lat"]]}


def station_results(rows: Iterable[Mapping[str, Any]], limit: int = MAX_STATION_RESULTS) -> list[dict]:
    """One hit per station. Rows sharing a name and the same lines (or, with no TfL lines, the
    same modes) are one station listed twice in the source: they collapse into the first, which
    keeps every mode and line. Twins with one name but different lines (Hammersmith
    District/Piccadilly vs Circle/H&C, Edgware Road) stay two hits."""
    found: dict[tuple, dict] = {}
    for row in rows:
        hit = station_result(row)
        key = (station_name_key(hit["name"]),
               tuple(sorted(line["id"] for line in hit["lines"])) or tuple(sorted(hit["modes"])))
        kept = found.get(key)
        if kept is None:
            found[key] = hit
            continue
        kept["modes"] += [mode for mode in hit["modes"] if mode not in kept["modes"]]
        known = {line["id"] for line in kept["lines"]}
        kept["lines"] += [line for line in hit["lines"] if line["id"] not in known]
        kept["zone"] = kept["zone"] or hit["zone"]
    return list(found.values())[:limit]


def station_search_params(query: str) -> tuple[str, str, str, int]:
    needle = station_query_key(query)
    # Fetch past the cap so a station listed twice still leaves room for others once collapsed.
    return f"%{needle}%", needle, f"{needle}%", MAX_STATION_RESULTS * 2
