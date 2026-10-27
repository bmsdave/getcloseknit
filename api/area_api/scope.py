"""One Scope per request: the places Close Knit serves it (docs/architecture/global-geography.md §6-7, step 4).

The base is London (scope_grant, migration 123: flag NULL -> uk:region:E12000007); CLOSE_KNIT_ENGLAND grants England
(uk:nation:E92000001), with ranks within each area's region. The flag is read per call (feature_flags: the MCP and
the extension read it as off while the site is private), so `current()` is the scope of the call it runs in; a
request may narrow England to some of its regions (?regions=). Readers apply it in SQL, never as a Python
post-filter, and a point outside its box is not looked up.

    scope.current().sql_filter("g.id")   # " AND g.id IN (areas of the served regions)", "" for all of England
    scope.current().contains(lat, lon)   # inside the scope's box (a pre-filter, not the region test)
    scope.current().outside_reason       # "outside-london" | "outside-coverage"
    scope.current().covers               # "London" | "England" | the regions asked for, in words
    GET /api/v1/scope                    # payload(): the scope of the caller's channel
"""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import Iterable, Mapping

from fastapi import HTTPException

from . import coverage, feature_flags

SCHEMA_VERSION = "scope.v1"


@dataclass(frozen=True)
class Scope:
    id: str
    level: str  # "region" | "nation" (geo_level, migration 123)
    name: str
    regions: tuple[str, ...] | None  # the served regions' codes (E12...); None: every region, nothing filtered
    bbox: tuple[float, float, float, float]  # west, south, east, north
    outside_reason: str  # the reason code for a place outside it

    @property
    def covers(self) -> str:
        """The place the scope covers, in words: "London", "England", or the regions asked for."""
        if self.regions is None or self.level == "region":
            return self.name
        return ", ".join(coverage.REGIONS[code] for code in self.regions if code in coverage.REGIONS) or self.name

    def contains(self, latitude: float, longitude: float) -> bool:
        west, south, east, north = self.bbox
        return south <= latitude <= north and west <= longitude <= east

    def sql_filter(self, id_expr: str) -> str:
        """`AND <id_expr> IN (areas of the served regions)`, or "" when nothing is filtered. The region ids are
        inlined as literals: only codes from coverage.REGIONS (a fixed list) ever reach the text."""
        if self.regions is None:
            return ""
        ids = ", ".join(f"'uk:region:{code}'" for code in self.regions if code in coverage.REGIONS)
        return f" AND {id_expr} IN (SELECT id FROM area_geography WHERE region_id IN ({ids or 'NULL'}))"

    def within(self, codes: Iterable[str]) -> Scope:
        """The scope cut to some of its regions (a request's ?regions=, one region's ranks)."""
        return dataclasses.replace(self, regions=tuple(codes))

    def rows(self, sql: str, id_column: str = "geography_id", order: str | None = None) -> str:
        """A row query cut to the served areas: its rows whose `id_column` is an area inside the scope, in the
        query's order when `order` repeats its ORDER BY column."""
        where = self.sql_filter(f"scoped.{id_column}")
        if not where:
            return sql
        marker = sql.split("\n", 1)[0] + "\n" if sql.startswith("--") else ""  # the query's name stays its first line
        return (f"{marker}SELECT * FROM ({sql}\n) scoped WHERE TRUE{where}"
                + (f" ORDER BY scoped.{order}" if order else ""))

    def admits(self, region_map: Mapping[str, str], area_id: str) -> bool:
        """One area inside the scope (an area route, a search hit), by the area -> region map; every area while
        nothing is filtered or the map is not loaded (before migration 103)."""
        return self.regions is None or not region_map or region_map.get(area_id) in self.regions

    def payload(self) -> dict:
        west, south, east, north = self.bbox
        regions = sorted(coverage.REGIONS) if self.regions is None else list(self.regions)
        return {"schemaVersion": SCHEMA_VERSION, "id": self.id, "level": self.level, "name": self.name,
                "served": [{"id": f"uk:region:{code}", "code": code, "name": coverage.REGIONS[code]} for code in regions],
                "bbox": [west, south, east, north], "outsideReason": self.outside_reason}


def _box(box: dict[str, tuple[float, float]]) -> tuple[float, float, float, float]:
    return box["longitude"][0], box["latitude"][0], box["longitude"][1], box["latitude"][1]


LONDON = Scope(f"uk:region:{coverage.LONDON_REGION}", "region", "London", (coverage.LONDON_REGION,),
               _box(coverage.LONDON_BOX), "outside-london")
ENGLAND = Scope("uk:nation:E92000001", "nation", "England", None, _box(coverage.ENGLAND_BOX), "outside-coverage")
# The rows of scope_grant (migration 123): the base and the place each flag adds (tests/test_postgis.py checks them).
GRANTS = {None: LONDON.id, "CLOSE_KNIT_ENGLAND": ENGLAND.id}


def current(requested: Iterable[str] | None = None) -> Scope:
    """The call's scope: London with CLOSE_KNIT_ENGLAND off (whatever was asked); with it on England, or the
    regions asked for."""
    if not feature_flags.england():
        return LONDON
    codes = tuple(sorted({code for code in requested or () if code in coverage.REGIONS}))
    return ENGLAND.within(codes) if codes else ENGLAND


def of_region(code: str) -> Scope:
    """One region's areas (an area's rank region), whatever the request's scope."""
    return ENGLAND.within((code,))


def parse(text: str | None) -> list[str]:
    """"E12000007,E12000008" -> the codes; ValueError on anything but England's nine region codes."""
    codes = [code.strip().upper() for code in (text or "").split(",") if code.strip()]
    unknown = [code for code in codes if code not in coverage.REGIONS]
    if unknown:
        raise ValueError(f"unknown region code: {', '.join(unknown)} (E12000001 to E12000009)")
    return codes


def get_scope(regions: str | None = None) -> Scope:
    """The request's scope (a FastAPI dependency): `?regions=` narrows England to those regions."""
    try:
        return current(parse(regions))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
