"""Coverage: which English local authority districts (LADs) and regions Close Knit covers.

One place for the codes and boxes that ETLs used to hard-code (E09 lists, E12000007,
London bboxes). Data: england_lads.json, from the ONS Postcode Directory (OGL v3):
296 LADs (E06 unitary, E07 district, E08 metropolitan, E09 London borough), each in one
of the nine English regions (E12000001..E12000009). 2021 LSOAs/MSOAs nest inside them.

The DB kind 'lad' (named 'borough' before migration 121) means any of these LADs (migration 103);
the view area_region (migration 123) maps every lsoa/msoa/lad id to its region, and "London" ranks are computed within
the area's region (London = E12000007, so London numbers do not change).

    from area_analytics import coverage            # pipelines
    import area_coverage as coverage               # deploy/tools (re-export)

    cov = coverage.get("england")                  # or "london", or coverage.from_env()
    cov.lad_codes, cov.region_codes, cov.bbox_wgs84, cov.bbox_bng
    cov.contains_lad("E08000003"); cov.contains_point(lon, lat)
    coverage.region_of_lad("E09000001")            # "E12000007"
    coverage.region_name("E12000002")              # "North West"
    coverage.regional_percentiles(values, regions) # percentiles within each region
    coverage.load_area_regions(cur)                # {area_id: region_code} from area_region
    coverage.lsoa_lookup()["E01000001"]            # ("E02000001", "E09000001")
    coverage.region_of_code("E01000001")           # region of an LSOA/MSOA/LAD code
"""

from __future__ import annotations

import csv
import gzip
import json
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Callable, Iterable, Mapping

_DATA = json.load(open(os.path.join(os.path.dirname(__file__), "england_lads.json"),
                       encoding="utf-8"))

LONDON_REGION = "E12000007"
ENGLAND_COUNTRY = "E92000001"
REGIONS: dict[str, str] = dict(sorted(_DATA["regions"].items()))  # E12 code -> name
LADS: dict[str, tuple[str, str]] = {code: (name, region) for code, (name, region)
                                    in sorted(_DATA["lads"].items())}  # code -> (name, region)
ENGLAND_LAD_CODES = frozenset(LADS)
LONDON_BOROUGH_CODES = frozenset(code for code, (_, region) in LADS.items()
                                 if region == LONDON_REGION)
LAD_PREFIXES = ("E06", "E07", "E08", "E09")

# (west, south, east, north). England incl. the Isles of Scilly; boxes are a cheap
# pre-filter, the LAD/region membership is the real test.
ENGLAND_BBOX_WGS84 = (-6.45, 49.86, 1.77, 55.82)
ENGLAND_BBOX_BNG = (82_000, 5_000, 656_000, 658_000)
# The widest London box the ETLs used (etl_home/etl_short_lets, etl_schools).
LONDON_BBOX_WGS84 = (-0.53, 51.27, 0.35, 51.70)
LONDON_BBOX_BNG = (500_000, 152_000, 565_000, 204_000)


@dataclass(frozen=True)
class Coverage:
    name: str  # "england" | "london"
    lad_codes: frozenset[str]
    region_codes: frozenset[str]
    bbox_wgs84: tuple[float, float, float, float]
    bbox_bng: tuple[float, float, float, float]

    def contains_lad(self, code: str | None) -> bool:
        return code in self.lad_codes

    def contains_region(self, code: str | None) -> bool:
        return code in self.region_codes

    def contains_point(self, lon: float, lat: float) -> bool:
        """Inside the WGS84 box (a pre-filter: the box is wider than the LADs)."""
        west, south, east, north = self.bbox_wgs84
        return west <= lon <= east and south <= lat <= north

    def contains_bng(self, x: float, y: float) -> bool:
        west, south, east, north = self.bbox_bng
        return west <= x <= east and south <= y <= north


ENGLAND = Coverage("england", ENGLAND_LAD_CODES, frozenset(REGIONS),
                   ENGLAND_BBOX_WGS84, ENGLAND_BBOX_BNG)
LONDON = Coverage("london", LONDON_BOROUGH_CODES, frozenset({LONDON_REGION}),
                  LONDON_BBOX_WGS84, LONDON_BBOX_BNG)
_COVERAGES = {"england": ENGLAND, "london": LONDON}


def get(name: str = "england") -> Coverage:
    try:
        return _COVERAGES[name]
    except KeyError:
        raise ValueError(f"unknown coverage: {name!r} (england|london)") from None


def from_env(default: str = "england") -> Coverage:
    """CLOSE_KNIT_ETL_COVERAGE=london|england picks the ETL scope (default England)."""
    return get(os.environ.get("CLOSE_KNIT_ETL_COVERAGE", default).strip().lower() or default)


def is_english_lad(code: str | None) -> bool:
    return code in ENGLAND_LAD_CODES


def region_of_lad(code: str) -> str | None:
    entry = LADS.get(code)
    return entry[1] if entry else None


def lad_name(code: str) -> str | None:
    entry = LADS.get(code)
    return entry[0] if entry else None


def region_name(code: str | None) -> str | None:
    return REGIONS.get(code) if code else None


def rank_scope(region_code: str | None) -> dict | None:
    """The API's rankScope object: {"code": "E12000002", "name": "North West"}."""
    name = region_name(region_code)
    return {"code": region_code, "name": name} if name else None


def current_lad(code: str | None, name: str = "", region: str | None = None) -> str | None:
    """A council's current LAD code: `code` when it is one, else the one LAD (in `region`, when given) whose
    name starts the council's name ("Barnsley Metropolitan Borough Council" -> E08000038, after the 2023
    code change that registers such as planning.data.gov.uk's organisation list still carry)."""
    if code in ENGLAND_LAD_CODES:
        return code
    matches = [lad for lad, (lad_name, lad_region) in LADS.items()
               if name and (name + " ").startswith(lad_name + " ") and region in (None, "", lad_region)]
    return matches[0] if len(matches) == 1 else None


def lads_in_region(region_code: str) -> list[str]:
    return [code for code, (_, region) in LADS.items() if region == region_code]


def borough_id(lad_code: str) -> str:
    """The DB id of a LAD (kind 'lad'): the id keeps the prefix 'borough' (no URL churn)."""
    return f"uk:lad:{lad_code}"


@lru_cache(maxsize=1)
def lsoa_lookup() -> dict[str, tuple[str, str]]:
    """{LSOA21 code: (MSOA21 code, LAD code)} for all 33,755 English LSOAs
    (england_lsoa_lookup.csv.gz, ONSPD; London matches the ONS 2021 lookup exactly)."""
    path = os.path.join(os.path.dirname(__file__), "england_lsoa_lookup.csv.gz")
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return {row["LSOA21CD"]: (row["MSOA21CD"], row["LADCD"]) for row in csv.DictReader(handle)}


@lru_cache(maxsize=1)
def msoa_lookup() -> dict[str, str]:
    """{MSOA21 code: LAD code}."""
    return {msoa: lad for msoa, lad in lsoa_lookup().values()}


def lad_of_code(code: str | None) -> str | None:
    """The LAD of an LSOA (E01), MSOA (E02) or LAD code; None outside England."""
    if not code:
        return None
    if code in ENGLAND_LAD_CODES:
        return code
    if code.startswith("E01"):
        entry = lsoa_lookup().get(code)
        return entry[1] if entry else None
    if code.startswith("E02"):
        return msoa_lookup().get(code)
    return None


def region_of_code(code: str | None) -> str | None:
    """The region (E12) of an LSOA, MSOA or LAD official code, or of an id uk:<kind>:<code>."""
    if code and code.startswith("uk:"):
        code = code.rsplit(":", 1)[-1]
    lad = lad_of_code(code)
    return region_of_lad(lad) if lad else None


def load_area_regions(cur, kinds: Iterable[str] = ("lsoa", "msoa", "lad")) -> dict[str, str]:
    """{area_id: region_code} from area_region (migration 103) for the given id prefixes (uk:<kind>:)."""
    prefixes = [f"uk:{kind}:%" for kind in kinds]
    cur.execute("SELECT area_id, region_code FROM area_region WHERE area_id LIKE ANY(%s)",
                (prefixes,))
    return dict(cur.fetchall())


def competition_percentiles(values: Mapping[str, float | None]) -> dict[str, int]:
    """{key: 0-100} ascending (0 = lowest); tied values share one percentile. The same rule
    as area_api.percentiles and SQL round(100 * percent_rank())."""
    ordered = sorted(value for value in values.values() if value is not None)
    if len(ordered) < 2:
        return {key: 0 for key, value in values.items() if value is not None}
    first: dict[float, int] = {}
    for position, value in enumerate(ordered):
        first.setdefault(value, position)
    scale = 100 / (len(ordered) - 1)
    return {key: round(first[value] * scale) for key, value in values.items() if value is not None}


def regional_percentiles(values: Mapping[str, float | None],
                         regions: Mapping[str, str | None] | Callable[[str], str | None],
                         rank: Callable[[Mapping[str, float | None]], dict[str, int]]
                         = competition_percentiles) -> dict[str, int]:
    """Percentiles computed within each area's region (the stored "region_percentile").

    `regions` maps key -> region code (or is a function). Keys without a region rank
    together in one group, so a London-only run gives exactly the old London numbers.
    `rank` is the ETL's own ranking rule (default: competition percentiles)."""
    region_of = regions if callable(regions) else regions.get
    groups: dict[str | None, dict[str, float | None]] = {}
    for key, value in values.items():
        groups.setdefault(region_of(key), {})[key] = value
    out: dict[str, int] = {}
    for group in groups.values():
        out.update(rank(group))
    return out
