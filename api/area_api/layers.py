"""Every map layer for one area in one call (area-layers.v1): the home page's Overview tiles and chips.

One layer per metric in the active release that has a row for the area, at its newest period. A metric
published for a wider area (income is per MSOA) is read at the area's parent of that kind. Each layer has
the standouts tile shape (standouts.tile_dict), so the site's AreaTiles renders it; the site fills its
section and topic from its own layer catalogue (web/src/lib/map-topics.ts).

?scope=overview returns only OVERVIEW_LAYERS, in that order, each in place even without a row (available
false): the home page's Overview row, and the one list of its ids (web tests check their demo against it).

Standing is 0-100 with the better end high: the London percentile, flipped where a lower value is better.
A neutral layer (price, income) has no standing, only its London position. Census layers are descriptive
(no standing, no position) while CLOSE_KNIT_CENSUS_RANKED is off. A newest row without a value is a layer
without data (available false), never zero.

Both scopes also carry the three ready-made criteria (custom-presets.json, never an "X vs Y" one) this area rates highest on, as
tiles under their neutral names, and flood, air and broadband as band chips (no map metric), each read by
its own module.
"""
from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from typing import Any

from . import custom_criteria, evidence, feature_flags, flood, health, home, matching, schools, standouts

logger = logging.getLogger(__name__)

SCHEMA_VERSION = "area-layers.v1"
SCOPES = ("all", "overview")

# metric_definition.direction says "higher-is-more" for both a worse thing (crime) and a neutral one
# (price): the flipped layers are the home search's "lower is better" priorities, road collisions and the
# walks to the nearest supermarket and GP (Layers v5 batch 2).
LOWER_IS_BETTER = frozenset(
    {factor for factor, direction in matching.DEFAULT_DIRECTION.items() if direction == "lower"}
    | {"road-collisions", "supermarket-walk", "gp-walk"})
FLAT_PERCENT = 0.5  # a change smaller than this reads as flat, as AreaTiles draws no arrow under it

# The Overview's ranked layers under their short names, in the one topic order (Price, Getting around,
# Safety, Local places, Environment, Homes). Census is described in People, never rated here.
OVERVIEW_LAYERS = (
    ("price-per-square-metre", "Price"), ("station-access", "Station walk"), ("crime", "Crime"),
    ("road-collisions", "Road collisions"), ("food-hygiene", "Food hygiene"), ("nature-score", "Green & trees"),
    ("noise", "Noise"), ("deprivation", "Deprivation"), ("income", "Income"), ("social-renting", "Social renting"),
)
TOP_PRESETS = 3
PAIRED_FORMULAS = ("balance", "share")  # "X vs Y": never an Overview tile (ruling, task 8 round 2)

# The area, its parent and grandparent; each metric read at the one of its carrier's kind, at its
# newest period, with the value 12 months before for the trend. metrics null: every metric.
VALUES_SQL = """-- layers:values
WITH lineage AS (
  SELECT g.id, g.kind FROM area_geography g WHERE g.id = %(area)s
  UNION ALL
  SELECT p.id, p.kind FROM area_geography g JOIN area_geography p ON p.id = g.parent_id WHERE g.id = %(area)s
  UNION ALL
  SELECT b.id, b.kind FROM area_geography g JOIN area_geography p ON p.id = g.parent_id
    JOIN area_geography b ON b.id = p.parent_id WHERE g.id = %(area)s
), newest AS (
  SELECT DISTINCT ON (m.id) m.id, coalesce(m.definition->>'label', m.id) AS label, m.unit, m.direction,
    m.carrier::text AS carrier, v.geography_id, v.period AS at, to_char(v.period, 'YYYY-MM') AS period,
    v.value, v.region_percentile, v.source_release_id
  FROM active_product_release active
  JOIN product_release_member member ON member.release_id = active.release_id
  JOIN metric_definition m ON m.source_release_id = member.source_release_id
  JOIN lineage l ON l.kind = m.carrier
  -- Any member release of the metric: a national build may add its rows under its own release beside the one
  -- the definition names (flood-risk and noise outside London), as the map reads them.
  JOIN metric_value v ON v.metric_id = m.id AND v.geography_id = l.id AND v.source_release_id IN (
    SELECT r.source_release_id FROM product_release_member r WHERE r.release_id = active.release_id)
  WHERE %(metrics)s::text[] IS NULL OR m.id = ANY(%(metrics)s::text[])
  ORDER BY m.id, v.period DESC
)
SELECT n.id, n.label, n.unit, n.direction, n.carrier, n.geography_id, n.period, n.value, n.region_percentile,
  (SELECT y.value FROM metric_value y WHERE y.metric_id = n.id AND y.geography_id = n.geography_id
     AND y.source_release_id = n.source_release_id AND y.period = n.at - interval '12 months') AS year_ago
FROM newest n ORDER BY n.id"""

FLOOD_TABLE_SQL = """-- layers:flood-table
SELECT to_regclass('area_flood') IS NOT NULL AS t"""

FLOOD_WORDS = {"very-low": "Very low", "low": "Low", "medium": "Medium", "high": "High"}


def area_layers(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None,
                scope: str | None = None) -> dict:
    """area-layers.v1 for one LSOA, MSOA or borough; scope "overview" keeps OVERVIEW_LAYERS only."""
    evidence._check_cancelled(cancel)
    scope = scope or "all"
    if scope not in SCOPES:
        raise evidence.MalformedQuery(f"invalid scope: {scope} (all or overview)")
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    overview = scope == "overview"
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        metrics = [metric_id for metric_id, _ in OVERVIEW_LAYERS] if overview else None
        rows = list(connection.execute(VALUES_SQL, {"area": area_id, "metrics": metrics}))
        evidence._check_cancelled(cancel)
        found = load_presets(connection, release_id, area_id, cancel)
        evidence._check_cancelled(cancel)
        chip_rows = load_chips(connection, area_id)
    census_ranked, air_on = feature_flags.census_ranked(), feature_flags.air_quality()
    tiles = [layer(row, census_ranked) for row in rows if air_on or row["id"] not in feature_flags.AIR_METRICS]
    return {"schemaVersion": SCHEMA_VERSION, "productReleaseId": release_id, "areaId": area_id, "scope": scope,
            "layers": overview_layers(tiles) if overview else tiles,
            "presets": preset_tiles(found), "chips": chips(*chip_rows, air_on=air_on),
            "withheld": feature_flags.withheld(("censusRanked", "laeiAir"))}


def overview_layers(tiles: list[dict]) -> list[dict]:
    """OVERVIEW_LAYERS in order under their short names; one without a row keeps its place without data."""
    by_id = {tile["id"]: tile for tile in tiles}
    return [{**by_id[metric_id], "label": label} if metric_id in by_id else standouts.tile_dict(metric_id, label, None, None)
            for metric_id, label in OVERVIEW_LAYERS]


def layer(row: Mapping[str, Any], census_ranked: bool = False) -> dict:
    """One metric row as a tile."""
    metric_id, value, percentile = row["id"], row["value"], row["region_percentile"]
    census = matching.is_descriptive_layer(metric_id)
    lower = metric_id in LOWER_IS_BETTER or row["direction"] == "lower-is-better"
    rated = not census and (row["direction"] == "higher-is-better" or lower)
    if census and not census_ranked:
        percentile = None  # descriptive: no London position at all
    standing = None if percentile is None else 100 - percentile if rated and lower else percentile
    return standouts.tile_dict(
        metric_id, row["label"] or metric_id, None, None, neutral=not rated,
        value=value, display=None if value is None else display(value, row["unit"]),
        standing=None if value is None else standing,
        trend=None if value is None else trend(value, row["year_ago"]), period=row["period"])


def display(value: float, unit: str | None) -> str:
    """The value in words with its unit: "£6,500/m²", "80.2 per 1,000", "38.5%", "12 min", "Decile 3"."""
    if unit == "£/m²":
        return f"£{round(value / 100) * 100:,}/m²"  # to the nearest £100, as everywhere on the page
    if unit == "£":
        return f"£{round(value):,}"
    if unit == "£/year":
        return f"£{round(value):,} a year"
    if unit == "decile":
        return f"Decile {round(value)}"
    if unit == "percentile":
        return f"{round(value)}/100"
    if unit == "%":
        return f"{round(value, 1):g}%"
    if unit == "minutes":
        return f"{round(value)} min"
    if unit == "per-1000-residents-per-year":  # road-collisions (deploy/tools/etl_kids.py)
        return f"{round(value, 2):g} per 1,000 a year"
    number = f"{round(value, 1):g}" if abs(value) < 1000 else f"{round(value):,}"
    return f"{number} {unit}" if unit else number


def trend(value: float, year_ago: float | None) -> dict | None:
    """The change against the same month a year before; None without that period. From zero there is
    no percent, only the direction."""
    if year_ago is None:
        return None
    if year_ago == 0:
        return {"direction": "flat" if value == 0 else "up" if value > 0 else "down", "percent": None, "years": 1}
    percent = round((value / year_ago - 1) * 100, 1)
    direction = "flat" if abs(percent) < FLAT_PERCENT else "up" if percent > 0 else "down"
    return {"direction": direction, "percent": percent, "years": 1}


def load_presets(connection: Any, release_id: str, area_id: str,
                 cancel: Callable[[], bool] | None = None) -> list[tuple[dict, dict]]:
    """(preset, standouts._preset answer) for every ready-made criterion that counts or measures places
    with a London rank here; "X vs Y" criteria (balance, share) are never Overview tiles. Each is read in
    its own savepoint (standouts._preset) and its London values are cached per release."""
    found = []
    for preset in custom_criteria.presets()["presets"]:
        if preset["criterion"]["formula"] in PAIRED_FORMULAS:
            continue
        evidence._check_cancelled(cancel)
        value = standouts._preset(connection, release_id, preset["criterion"]["id"], area_id)
        if value and value.get("percentile") is not None:
            found.append((preset, value))
    return found


def build_presets(connection: Any, release_id: str) -> None:
    """The ready-made criteria's values and ranks for the release (the Overview's and the standouts'), built at
    release activation (release_build) into release_artifact, so no area page computes them. Unlike a page, which
    reads a failed criterion as "No data here", a failure here fails the build."""
    wanted = [(preset["criterion"]["id"], None) for preset in custom_criteria.presets()["presets"]
              if preset["criterion"]["formula"] not in PAIRED_FORMULAS]
    for preset_id, formula in [*wanted, *standouts.PRESETS.values()]:
        criterion = standouts.preset_criterion(preset_id, formula)
        if criterion is not None:
            custom_criteria.preset_values(connection, release_id, criterion)
            standouts._preset(connection, release_id, preset_id, "", formula)  # its ranks


def preset_tile(preset: Mapping[str, Any], found: Mapping[str, Any]) -> dict:
    """A ready-made criterion (count, density, per resident, nearest or variety) as a tile under its neutral name, its id
    the map's custom layer. Its rating turns with the preset's direction (fewer bars rates high where bars
    are few)."""
    criterion = preset["criterion"]
    percentile, value = found["percentile"], found["value"]
    standing = 100 - percentile if preset.get("direction") == "lower" else percentile
    formula = criterion["formula"]
    if formula == "count":
        words = "1 place" if round(value) == 1 else f"{round(value)} places"
    elif formula == "density":
        words = f"{value:g} per km²"
    elif formula == "per_resident":
        words = f"{value:g} per 1,000 residents"
    elif formula == "nearest":
        words = f"{round(value)} min walk"
    else:
        words = f"{round(value)} kinds"
    return standouts.tile_dict(f"custom:{criterion['id']}", criterion["label"], None, None, value=value,
                               display=words, standing=standing,
                               detail=None if formula == "nearest" else custom_criteria.INSIDE_AREA)


def preset_tiles(found: list[tuple[dict, dict]]) -> list[dict]:
    """The TOP_PRESETS rated highest here, ties in the presets' own order."""
    tiles = [preset_tile(preset, value) for preset, value in found]
    return sorted(tiles, key=lambda tile: -tile["standing"])[:TOP_PRESETS]


def load_chips(connection: Any, area_id: str) -> tuple[list, dict | None, dict | None]:
    """The flood rows, health value and home value, from their own modules' reads (health and home check
    their own tables; the flood rows wait for area_flood)."""
    loaded = list(connection.execute(FLOOD_TABLE_SQL))
    flood_rows = list(connection.execute(flood.AREA_FLOOD_SQL, (area_id,))) if loaded and loaded[0]["t"] else []
    return flood_rows, health.health_rows(connection, [area_id]).get(area_id), home.home_value(connection, area_id)


def chips(flood_rows: list[Mapping[str, Any]], health_value: Mapping[str, Any] | None,
          home_value: Mapping[str, Any] | None, air_on: bool = False) -> list[dict]:
    """Flood (the worse of rivers & sea and surface water), air (London-relative, withheld while LAEI is
    off) and broadband (gigabit share); band None without data."""
    bands = [found["highestBand"] for found in (flood.area_bands(row) for row in flood_rows) if found]
    worst = max(bands, key=flood.BANDS.index) if bands else None
    air = (health_value or {}).get("air") if air_on else None
    air_pct = air.get("regionPercentile") if air else None
    air_band = None if air_pct is None else (
        "Cleaner than most" if air_pct <= 40 else "More polluted than most" if air_pct >= 60 else "About average")
    share = ((home_value or {}).get("broadband") or {}).get("share")
    return [
        {"id": "flood", "label": "Flood", "band": FLOOD_WORDS.get(worst) if worst else None},
        {"id": "air", "label": "Air", "band": air_band},
        {"id": "broadband", "label": "Broadband", "band": None if share is None else f"{round(share * 100)}% gigabit"},
    ]
