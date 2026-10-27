"""Health layers for an area (migration 061): modelled air pollution where its homes are, summer
heat on its land, and how stretched the GP practices near it are.

Places, never people: pollution and heat are modelled for the land and homes, GP figures are of
practices (registered patients per full-time-equivalent GP), never of anyone's health. Each figure
carries its London percentile among areas of the same kind (0 = lowest value in London), so the site
rates it out of 10 the same way as the other tiles. Short card notes come with each payload so the
site, the brief and the agent tools say the same thing.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from . import coverage, evidence, feature_flags, regions, schools

SCHEMA_VERSION = "area-health.v1"
# Reference levels for the card lines (µg/m³, annual mean): WHO 2021 guidelines and the UK legal limits.
WHO_NO2, WHO_PM25 = 10, 5
UK_NO2, UK_PM25 = 40, 20
GP_RADIUS_METRES = 1000
AIR_CAVEAT = (
    "Air pollution is modelled by the GLA (London Atmospheric Emissions Inventory) for one year on a 20 m grid "
    "and averaged over the area's homes; it is not a measurement at any one address.")
# Outside London the air figures are Defra's 1 km background maps (england_air.py, OGL v3): no licence gate.
PCM_RELEASE_PREFIX = "src-defra-pcm-"
PCM_AIR_CAVEAT = (
    "Outside London, air pollution is Defra's modelled background map (Pollution Climate Mapping) for one year on a "
    "1 km grid, averaged over the area's homes: much coarser than London's 20 m model, so busy roads are smoothed out.")
CAVEATS = [
    AIR_CAVEAT,
    "Summer heat is the GLA's modelled mean midnight air temperature, May to September 2011, on a 250 m grid, "
    "averaged over the area's homes: it shows which places stay warmer at night, not a forecast or an indoor temperature.",
    "GP access counts the practices whose surgery postcode is within 1 km of a neighbourhood's centre (for an MSOA or "
    "borough, inside it): registered patients per full-time-equivalent GP, trainees and locums excluded. People can "
    "register with a practice further away; practices outside England are not counted.",
]

AREA_HEALTH_SQL = """-- evidence:area-health
SELECT h.* FROM area_health h WHERE h.geography_id = ANY(%s)"""

SOURCES_SQL = """-- evidence:area-health-sources
SELECT s.id, s.source_url, s.licence, s.attribution FROM source_release s WHERE s.id = ANY(%s) ORDER BY s.id"""

RELEASE_KEYS = ("air_release_id", "heat_release_id", "gp_release_id")


def _num(value: Any, digits: int = 1) -> float | None:
    return None if value is None else round(float(value), digits)


def _pct(value: Any) -> float | None:
    return None if value is None else round(float(value), 1)


def open_air(row: Mapping[str, Any]) -> bool:
    """The area's air figures are Defra's OGL background map (outside London), not the flagged LAEI grid."""
    return str(row.get("air_release_id") or "").startswith(PCM_RELEASE_PREFIX)


def air_shown(row: Mapping[str, Any]) -> bool:
    return feature_flags.air_quality() or open_air(row)


def health_value(row: Mapping[str, Any]) -> dict:
    """The health block for one area_health row; a part is None when its layer is not loaded, and air
    from the LAEI grid (London) is None while CLOSE_KNIT_AIR_QUALITY is off. Defra's 1 km map (the rest
    of England, OGL) is always shown, with gridMetres 1000 so clients can say it is coarse."""
    air = None
    if row.get("no2") is not None and air_shown(row):
        air = {"no2": _num(row["no2"]), "pm25": _num(row.get("pm25")), "year": row.get("air_year"),
               "gridMetres": 1000 if open_air(row) else 20,
               "regionPercentile": _pct(row.get("air_pct")),
               "no2Percentile": _pct(row.get("no2_pct")), "pm25Percentile": _pct(row.get("pm25_pct"))}
    heat = None
    if row.get("heat") is not None:
        heat = {"value": _num(row["heat"]), "unit": row.get("heat_unit"), "year": row.get("heat_year"),
                "regionPercentile": _pct(row.get("heat_pct"))}
    gp = None
    if row.get("gp_practices") is not None:
        gp = {"patientsPerGp": None if row.get("gp_patients_per_fte") is None else round(float(row["gp_patients_per_fte"])),
              "practices": int(row["gp_practices"]),
              "nearestMetres": None if row.get("gp_nearest_m") is None else int(round(float(row["gp_nearest_m"]), -1)),
              "month": _iso(row.get("gp_month")), "regionPercentile": _pct(row.get("gp_pct")),
              # A neighbourhood counts practices within 1 km of its centre; an MSOA or borough those inside it.
              "withinMetres": GP_RADIUS_METRES if str(row.get("geography_id", "")).startswith("uk:lsoa:") else None}
    value = {"air": air, "heat": heat, "gp": gp}
    value["notes"] = card_notes(value)
    return value


def card_notes(value: Mapping[str, Any], place: str = "London") -> list[str]:
    """Short lines for an area card: air first, then heat (among `place`'s areas: the area's region), then GPs."""
    notes = []
    air = value.get("air")
    if air:
        no2, pm25 = air["no2"], air["pm25"]
        line = f"NO₂ {no2:g} µg/m³"
        if pm25 is not None:
            line += f", PM2.5 {pm25:g} µg/m³"
        over = [name for name, level, limit in (("NO₂", no2, UK_NO2), ("PM2.5", pm25, UK_PM25))
                if level is not None and level > limit]
        line += (f": above the UK legal limit for {' and '.join(over)}" if over
                 else f": within UK limits, above WHO guidelines ({WHO_NO2} and {WHO_PM25})"
                 if no2 > WHO_NO2 or (pm25 or 0) > WHO_PM25 else ": within WHO guidelines")
        notes.append(line)
    heat = value.get("heat")
    if heat and heat["regionPercentile"] is not None:
        hotter = heat["regionPercentile"]
        if hotter >= 80:
            notes.append(f"One of {place}'s warmer areas on summer nights")
        elif hotter <= 20:
            notes.append(f"One of {place}'s cooler areas on summer nights")
    gp = value.get("gp")
    if gp:
        if gp["practices"] == 0:
            notes.append("No GP surgery within 1 km" if gp["withinMetres"] else "No GP surgery in the area")
        elif gp["patientsPerGp"] is not None:
            practices = f"{gp['practices']} {'practice' if gp['practices'] == 1 else 'practices'}"
            where = "within 1 km" if gp["withinMetres"] else "in the area"
            notes.append(f"{gp['patientsPerGp']:,} patients per GP at the {practices} {where}")
    return notes


def _iso(day: Any) -> str | None:
    return day.isoformat() if hasattr(day, "isoformat") else day


def health_rows(connection: Any, area_ids: list[str]) -> dict[str, dict]:
    """area id -> health value for the areas that have one; {} when migration 061 is not loaded.
    A savepoint keeps a missing table from poisoning the caller's transaction."""
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                return _health_rows(connection, area_ids)
        return _health_rows(connection, area_ids)
    except Exception:  # noqa: BLE001 - an unloaded layer is a normal state, not an error
        return {}


def _health_rows(connection: Any, area_ids: list[str]) -> dict[str, dict]:
    out = {}
    region_map = regions.area_regions_on(connection)  # the notes compare with the area's region
    for row in connection.execute(AREA_HEALTH_SQL, (area_ids,)):
        keys = RELEASE_KEYS if air_shown(row) else tuple(key for key in RELEASE_KEYS if key != "air_release_id")
        value = health_value(row)
        value["notes"] = card_notes(value, coverage.region_name(region_map.get(row["geography_id"])) or "London")
        value["sourceVersions"] = sorted({row[key] for key in keys if row.get(key)})
        out[row["geography_id"]] = value
    return out


def area_health(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """area-health.v1 for one LSOA, MSOA or borough; available=false before the layers are loaded."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        value = health_rows(connection, [area_id]).get(area_id)
        pcm = bool(value and value["air"] and value["air"].get("gridMetres") == 1000)
        sources = [{"release": row["id"], "sourceUrl": row["source_url"], "licence": row["licence"],
                    "attribution": row["attribution"]}
                   for row in connection.execute(SOURCES_SQL, (value["sourceVersions"],))] if value else []
    return {"schemaVersion": SCHEMA_VERSION, "productReleaseId": release_id, "geographyId": area_id,
            "available": value is not None, "airEnabled": feature_flags.air_quality() or pcm,
            **(value or {"air": None, "heat": None, "gp": None, "notes": []}),
            "withheld": feature_flags.withheld(("laeiAir",)),
            "sources": sources,
            "caveats": ([PCM_AIR_CAVEAT, *CAVEATS[1:]] if pcm
                        else CAVEATS if feature_flags.air_quality() else CAVEATS[1:])}
