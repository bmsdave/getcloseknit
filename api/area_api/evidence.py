"""Production evidence reads over validated storage (AE-06).

Every read pins to the active product release through release membership, so
search, detail, history, and value packs expose one coherent source release.
Reads never touch analytics tables: matching consent accounting stays on the
matches path. All methods accept an optional ``cancel`` callable which is
checked between statements so a dropped request stops issuing queries.
"""

import json
import re
import threading
from typing import Any, Callable, Mapping

from . import coverage, feature_flags, kinds, map_chunks, map_tiles, regions, release_store
from .scope import current as current_scope
from .epc_policy import floor_area_note, per_home
from . import search_text
from .search_text import (like_escape, normalise_query, postcode_district, postcode_like,
                          split_address_tail)

MAX_SEARCH_RESULTS = 25
# /api/v1/areas/names: a shortlist holds at most a few dozen areas.
MAX_NAME_IDS = 50
DEFAULT_SEARCH_LIMIT = 10
# The site search's schools, stations and parks: a few of each after the areas and homes.
SITE_KIND_LIMIT = 3
PRICE_METRIC_ID = "price-per-square-metre"
# Mirrors PROFILE_METRIC_IDS in web/src/lib/contracts.ts: every metric but stock value.
PROFILE_METRIC_IDS = ("price-per-square-metre", "crime", "deprivation", "income", "social-renting")
# Census 2021 map layers (deploy/tools/etl_census_layers.py, web lib/census-layers.ts) describe who
# lives in an area: shown on the map and the area page, never ranked or matched.
DESCRIPTIVE_ONLY_PREFIX = "census-"
# Census-based layers named outside the prefix (Layers v5): Student areas, from TS066.
DESCRIPTIVE_ONLY_IDS = frozenset({"student-share"})


def is_descriptive_only(metric_id: str) -> bool:
    return metric_id.startswith(DESCRIPTIVE_ONLY_PREFIX) or metric_id in DESCRIPTIVE_ONLY_IDS


# Only the Census is never ranked. Deprivation (owner decision), household income and
# social renting (owner decision) were released from the old v3 rule and rank like any
# other metric (web lib/area-pages.ts › RANKINGS).
def is_never_ranked(metric_id: str) -> bool:
    return is_descriptive_only(metric_id)

GEOGRAPHY_PATTERN = re.compile(r"^uk:(lsoa|msoa|lad):E[0-9]{8}$")
ADDRESS_PATTERN = re.compile(r"^uk:addr:[0-9a-f]{12}$")
UPRN_PATTERN = re.compile(r"^[0-9]{1,12}$")
PROPERTY_TILE_ZOOM = (12, 19)
SALE_TILE_ZOOM = (11, 19)
# Places overlay: points from zoom 14; outer zooms are valid tiles with nothing in them.
PLACE_TILE_ZOOM = (14, 22)
PERIOD_PATTERN = re.compile(r"^[0-9]{4}-(0[1-9]|1[0-2])$")


class EvidenceError(Exception):
    pass


class AreaNotFound(EvidenceError):
    pass


class PropertyNotFound(EvidenceError):
    pass


class PropertyAmbiguous(EvidenceError):
    """A home lookup matched several homes; `candidates` holds up to 10 of them
    ({addressId, uprn or None, displayAddress, postcode, saleCount}). The caller
    must not pick one: it returns the candidates instead."""

    def __init__(self, message: str, candidates: list, product_release_id: str | None = None):
        super().__init__(message)
        self.candidates = candidates
        self.product_release_id = product_release_id


class AddressNotFound(EvidenceError):
    pass


class MetricNotFound(EvidenceError):
    pass


class PeriodNotFound(EvidenceError):
    pass


class SchoolNotFound(EvidenceError):
    pass


class MalformedQuery(EvidenceError):
    pass


class ReleaseUnavailable(EvidenceError):
    pass


class Cancelled(EvidenceError):
    pass


ACTIVE_RELEASE_SQL = """-- evidence:active-release
SELECT release_id FROM active_product_release"""

# A metric's periods in its release, by skip scan: one index probe per distinct month (metric_value_lookup_idx, or
# 115's metric_value_metric_release_period_idx) instead of reading every row. The catalogue reads ~660 metrics over
# England's ~25M rows: the plain DISTINCT took ~30 s cold and hit the statement timeout (503).
_PERIODS = """SELECT array_agg(to_char(d.period, 'YYYY-MM') ORDER BY d.period) FROM (
     WITH RECURSIVE step(period) AS (
       SELECT min(p.period) FROM metric_value p WHERE p.metric_id = m.id AND p.source_release_id = m.source_release_id
       UNION ALL
       SELECT (SELECT min(p.period) FROM metric_value p
               WHERE p.metric_id = m.id AND p.source_release_id = m.source_release_id AND p.period > step.period)
       FROM step WHERE step.period IS NOT NULL)
     SELECT period FROM step WHERE period IS NOT NULL) d"""

# Where the metric has values (metric_coverage, migration 126): each region, nation and country with a value at the
# metric's carrier in any month, as [scope id, areas with a value, areas] in the scope's own latest month (a source
# loaded for England to June and London to August covers both); null when nothing is stored.
_COVERAGE = """SELECT json_agg(json_build_array(c.scope_id, c.with_value, c.total) ORDER BY c.scope_id)
     FROM (SELECT DISTINCT ON (x.scope_id) x.scope_id, x.with_value, x.total FROM metric_coverage x
           WHERE x.release_id = active.release_id AND x.metric_id = m.id AND x.kind::text = m.carrier::text
           ORDER BY x.scope_id, x.period DESC) c"""

METRICS_SQL = """-- evidence:metrics
SELECT m.id, m.carrier::text AS carrier, m.unit, m.direction,
  m.definition, m.source_release_id,
  s.source_url, s.sha256 AS checksum, s.licence, s.attribution,
  s.transformation_version,
  (""" + _PERIODS + """) AS periods,
  (""" + _COVERAGE + """) AS coverage
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN metric_definition m ON m.source_release_id = member.source_release_id
JOIN source_release s ON s.id = m.source_release_id
ORDER BY m.id"""

METRIC_SQL = """-- evidence:metric
SELECT m.id, m.carrier::text AS carrier, m.unit, m.direction,
  m.definition, m.source_release_id,
  s.source_url, s.sha256 AS checksum, s.licence, s.attribution,
  s.transformation_version,
  (""" + _PERIODS + """) AS periods
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN metric_definition m ON m.source_release_id = member.source_release_id
JOIN source_release s ON s.id = m.source_release_id
WHERE m.id = %s"""

METRIC_EXISTS_SQL = """-- evidence:metric-exists
SELECT id FROM metric_definition WHERE id = %s"""

PERIODS_SQL = """-- evidence:periods
SELECT DISTINCT to_char(v.period, 'YYYY-MM') AS period
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN metric_value v ON v.source_release_id = member.source_release_id
WHERE v.metric_id = %s
ORDER BY period"""

# Normalised name columns (search_text.NAME_KEY_SQL) the search ranks by.
_NAME_KEY = search_text.NAME_KEY_SQL.format(column="g.name")
_FRIENDLY_KEY = search_text.NAME_KEY_SQL.format(column="coalesce(l.friendly_name, '')")

# The LAD an area is in (itself, its MSOA's or its LSOA's), as a name key: "York" ranks York's own
# neighbourhoods above New York · NE29, and "Clifton Bristol" keeps to Bristol's Clifton.
_LAD_NAME = ("CASE WHEN g.kind::text = 'lad' THEN g.name WHEN p.kind::text = 'lad' THEN p.name "
             "WHEN gp.kind::text = 'lad' THEN gp.name END")
_LAD_KEY = search_text.NAME_KEY_SQL.format(column=f"coalesce({_LAD_NAME}, '')")

# A LAD named so and its own areas first (tiers 1-3). Tier 4 is a place's own name: exact, a part of it
# ("Clifton East", "Clifton Village") or the first of a joined name ("Clifton & Maidenway", "Ham, Beacon Park &
# Pennycross"), never another name that starts the same ("Ham Hill"). Inside it each town's MSOAs come first, the
# towns ordered by the people in their matching MSOAs (area_population), so a bare "Clifton" lists Nottingham's
# and Bristol's before a small namesake. LSOAs come after the MSOAs (tiers 2-3, 4-5): one town's never crowd out
# the others.
PLACE_PARTS = ("north", "south", "east", "west", "central", "centre", "village", "town")
SEARCH_SQL = ("""-- evidence:search
WITH hit AS (
SELECT g.id, g.kind::text AS kind, g.official_code, g.name, """ + kinds.PARENT_SQL + """ AS parent_id,
  l.friendly_name, l.postcode_district,
  ST_X(ST_Centroid(g.geometry)) AS center_lon,
  ST_Y(ST_Centroid(g.geometry)) AS center_lat,
  """ + _FRIENDLY_KEY + """ AS friendly_key, """ + _NAME_KEY + """ AS name_key, """ + _LAD_KEY + """ AS lad_key,
  pop.population, length(coalesce(l.friendly_name, g.name)) AS name_length
FROM area_geography g
LEFT JOIN area_label l ON l.geography_id = g.id
LEFT JOIN area_geography p ON p.id = g.parent_id
LEFT JOIN area_geography gp ON gp.id = p.parent_id
LEFT JOIN area_population pop ON pop.geography_id = g.id
WHERE g.kind::text IN """ + kinds.SQL_LIST + """ AND ((""" + _NAME_KEY + " || ' ' || " + _FRIENDLY_KEY + """) ILIKE %s ESCAPE '\\'
  OR g.official_code ILIKE %s ESCAPE '\\' OR g.id = %s)
  AND (%s::text IS NULL OR """ + _LAD_KEY + """ LIKE %s ESCAPE '\\')
), ranked AS (
SELECT hit.*, CASE
    WHEN id = %s THEN 0
    WHEN kind = 'lad' AND (friendly_key = %s OR name_key = %s) THEN 1
    WHEN ((' ' || friendly_key || ' ') LIKE %s ESCAPE '\\' AND lad_key IN (%s, %s, %s))
      OR (kind = 'lad' AND name_key LIKE %s ESCAPE '\\') THEN 2
    WHEN kind = 'msoa' AND lad_key IN (%s, %s, %s) THEN 3
    WHEN friendly_key = %s OR name_key = %s OR friendly_key IN (""" + ", ".join(["%s"] * len(PLACE_PARTS)) + """)
      OR friendly_key LIKE %s ESCAPE '\\' OR lower(coalesce(friendly_name, '')) LIKE %s ESCAPE '\\' THEN 4
    WHEN (' ' || friendly_key || ' ') LIKE %s ESCAPE '\\' THEN 5
    WHEN friendly_key LIKE %s ESCAPE '\\' OR name_key LIKE %s ESCAPE '\\' THEN 6
    WHEN (' ' || friendly_key) LIKE %s ESCAPE '\\' THEN 7
    ELSE 8
  END AS tier
FROM hit
)
SELECT * FROM ranked
ORDER BY CASE WHEN tier = 3 THEN 2 WHEN tier = 5 THEN 4 ELSE tier END,
  CASE WHEN kind = 'lad' THEN 0 WHEN tier BETWEEN 2 AND 5 AND kind <> 'msoa' THEN 2 ELSE 1 END,
  tier,
  CASE WHEN tier = 4 THEN sum(CASE WHEN kind = 'msoa' THEN population END) OVER (PARTITION BY tier, lad_key) END DESC NULLS LAST,
  CASE WHEN tier = 4 THEN lad_key END,
  name_length, friendly_name,
  CASE WHEN kind = 'msoa' THEN 0 ELSE 1 END, name
LIMIT %s""")


def _search_params(needle: str, key: str, bound: int, place: str | None = None) -> tuple:
    """SEARCH_SQL's parameters for a name key, optionally kept to the LADs whose name starts with `place`."""
    word = like_escape(key)
    named = (key, f"{key} city of", f"{key} county of")  # ONS's "Bristol, City of", "Herefordshire, County of"
    return (f"%{word}%", f"%{like_escape(needle)}%", needle,
            place, f"{like_escape(place)}%" if place else None,
            needle, key, key,
            f"% {word} %", *named, f"{word} %",
            *named,
            key, key, *(f"{key} {part}" for part in PLACE_PARTS), f"{word} and %", f"{word},%",
            f"% {word} %", f"{word}%", f"{word}%", f"% {word}%",
            bound)

# A bare postcode district ("N1", "E14") is the areas labelled with it, never single homes (#229).
DISTRICT_AREAS_SQL = """-- evidence:district-areas
SELECT g.id, g.kind::text AS kind, g.official_code, g.name, """ + kinds.PARENT_SQL + """ AS parent_id,
  l.friendly_name, l.postcode_district,
  ST_X(ST_Centroid(g.geometry)) AS center_lon,
  ST_Y(ST_Centroid(g.geometry)) AS center_lat
FROM area_geography g
JOIN area_label l ON l.geography_id = g.id
WHERE l.postcode_district = %s
ORDER BY CASE WHEN g.kind::text = 'msoa' THEN 0 ELSE 1 END, g.name
LIMIT %s"""

GEOGRAPHY_SQL = """-- evidence:geography
SELECT g.id, g.kind::text AS kind, g.official_code, g.name, """ + kinds.PARENT_SQL + """ AS parent_id,
  l.friendly_name, l.postcode_district,
  ST_XMin(g.geometry) AS west, ST_YMin(g.geometry) AS south, ST_XMax(g.geometry) AS east, ST_YMax(g.geometry) AS north
FROM area_geography g
LEFT JOIN area_label l ON l.geography_id = g.id
WHERE g.id = %s"""

# Places for agent answers: a readable borough name, a centre and the postcode districts
# (outcodes) homes in each area sit in, so an agent can build portal searches.
AREA_LOOKUP_SQL = """-- evidence:area-lookup
SELECT g.id, g.kind::text AS kind, g.name, """ + kinds.PARENT_SQL + """ AS parent_id,
  CASE WHEN g.kind::text = 'lad' THEN g.name
       WHEN parent.kind::text = 'lad' THEN parent.name
       WHEN grandparent.kind::text = 'lad' THEN grandparent.name END AS borough,
  ST_X(ST_Centroid(g.geometry)) AS center_lon,
  ST_Y(ST_Centroid(g.geometry)) AS center_lat,
  l.friendly_name, l.postcode_district
FROM area_geography g
LEFT JOIN area_geography parent ON parent.id = g.parent_id
LEFT JOIN area_geography grandparent ON grandparent.id = parent.parent_id
LEFT JOIN area_label l ON l.geography_id = g.id
WHERE g.id = ANY(%s)"""

AREA_OUTCODES_SQL = """-- evidence:area-outcodes
SELECT a.geography_id, split_part(a.postcode, ' ', 1) AS outcode, COUNT(*) AS addresses
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN address a ON a.source_release_id = member.source_release_id
WHERE a.geography_id = ANY(%s)
GROUP BY a.geography_id, split_part(a.postcode, ' ', 1)"""

# Outside London there are no address rows (per-home data is London only): an LSOA's postcode districts come
# from its live postcodes in the ONS Postcode Directory, as the site's portal links (portal_zones) do.
AREA_POSTCODE_OUTCODES_SQL = """-- evidence:area-postcode-outcodes
SELECT 'uk:lsoa:' || p.lsoa_code AS geography_id, split_part(p.postcode, ' ', 1) AS outcode, COUNT(*) AS addresses
FROM postcode_civic p
WHERE p.lsoa_code = ANY(%s) AND p.terminated IS NULL
GROUP BY 1, 2"""

AREA_AT_SQL = """-- evidence:area-at
SELECT g.id
FROM area_geography g
WHERE g.kind = 'lsoa' AND ST_Intersects(g.geometry, ST_SetSRID(ST_MakePoint(%s, %s), 4326)){scope}
ORDER BY g.id
LIMIT 1"""

AREA_VALUES_SQL = """-- evidence:area-values
SELECT v.geography_id, g.name, g.kind::text AS carrier, v.metric_id,
  to_char(v.period, 'YYYY-MM') AS period, v.value,
  v.region_percentile, v.country_percentile, v.sample_count,
  v.quality::text AS quality, v.carrier_geography_id, v.carrier_sample_count,
  v.source_release_id
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN metric_value v ON v.source_release_id = member.source_release_id
JOIN area_geography g ON g.id = v.geography_id
WHERE v.geography_id = %s AND v.metric_id = %s
ORDER BY v.period"""

# AREA_VALUES_SQL across the profile metrics at once, up to the requested month.
AREA_PROFILE_SQL = """-- evidence:area-profile
SELECT v.geography_id, g.name, g.kind::text AS carrier, v.metric_id,
  to_char(v.period, 'YYYY-MM') AS period, v.value,
  v.region_percentile, v.country_percentile, v.sample_count,
  v.quality::text AS quality, v.source_release_id
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN metric_value v ON v.source_release_id = member.source_release_id
JOIN area_geography g ON g.id = v.geography_id
WHERE v.geography_id = ANY(%s) AND v.metric_id = ANY(%s) AND v.period <= to_date(%s, 'YYYY-MM')
ORDER BY v.metric_id, v.period"""

# £/m² is published per LSOA only. A district (MSOA) or borough takes the middle
# value of the LSOAs inside it each month: the rule the area pages use.
# Until the release stores the wider areas' own series (#208), the on-the-fly
# row must never claim more than its inputs: any fallback child makes the row
# a fallback, and the row says how many LSOAs it used.
AREA_PRICE_WITHIN_SQL = """-- evidence:area-price-within
SELECT to_char(v.period, 'YYYY-MM') AS period,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY v.value) AS value,
  count(*) AS areas, count(*) FILTER (WHERE v.quality <> 'observed') AS fallback_areas,
  max(v.source_release_id) AS source_release_id
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN metric_value v ON v.source_release_id = member.source_release_id
WHERE v.metric_id = %s AND v.value IS NOT NULL
  AND v.geography_id IN (
    SELECT l.id FROM area_geography l LEFT JOIN area_geography m ON m.id = l.parent_id
    WHERE l.kind = 'lsoa' AND (l.parent_id = %s OR m.parent_id = %s))
GROUP BY v.period
ORDER BY v.period"""

# Typical home price by type (migration 040's area_price_band): absent before 040.
PRICE_BAND_TABLE_SQL = """-- evidence:price-band-table
SELECT to_regclass('area_price_band') IS NOT NULL AS t"""

AREA_TYPICAL_PRICES_SQL = """-- evidence:area-typical-prices
SELECT b.geography_id, b.property_type, to_char(b.window_start, 'YYYY-MM') AS window_start,
  to_char(b.period, 'YYYY-MM') AS period, b.sales, b.p50
FROM area_price_band b
WHERE b.geography_id = ANY(%s) AND b.source_release_id IN (
  SELECT member.source_release_id FROM active_product_release active
  JOIN product_release_member member ON member.release_id = active.release_id)"""

# The brief's typical prices: all homes, then each Price Paid type, in the map layer's order.
TYPICAL_PRICE_TYPES = (("*", "all"), ("F", "flat"), ("T", "terraced"), ("S", "semi"), ("D", "detached"))

PACK_SQL = """-- evidence:pack
SELECT v.geography_id, g.name, g.kind::text AS carrier, v.metric_id,
  to_char(v.period, 'YYYY-MM') AS period, v.value,
  v.region_percentile, v.country_percentile, v.sample_count,
  v.quality::text AS quality, v.source_release_id
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN metric_value v ON v.source_release_id = member.source_release_id
JOIN area_geography g ON g.id = v.geography_id
JOIN metric_definition m ON m.id = v.metric_id
WHERE v.metric_id = %s AND v.period = to_date(%s, 'YYYY-MM')
  AND g.kind = m.carrier
  AND (%s::text[] IS NULL OR v.geography_id = ANY(%s::text[]))
ORDER BY v.geography_id"""


# A zoomed-out level's ranks in the country: each MSOA's or LAD's median of its ranked areas (the value
# map_chunks.roll_up gives it; the mean of the two middle values, as statistics.median) ranked among the same
# level's medians by the stored rule (migration 124). Areas' own country ranks are stored; a median is not, so
# this is read once per release, metric, month and level.
ROLLED_RANK_SQL = """-- evidence:rolled-country-rank
SELECT parent AS geography_id, round(100 * percent_rank() OVER (ORDER BY median))::int AS country_percentile
FROM (
  SELECT CASE WHEN %s = 'msoa' THEN CASE WHEN g.kind = 'lsoa' THEN g.parent_id END
              WHEN g.kind = 'lsoa' THEN p.parent_id ELSE g.parent_id END AS parent,
    (percentile_disc(0.5) WITHIN GROUP (ORDER BY v.value)
     + percentile_disc(0.5) WITHIN GROUP (ORDER BY v.value DESC)) / 2 AS median
  FROM active_product_release active
  JOIN product_release_member member ON member.release_id = active.release_id
  JOIN metric_value v ON v.source_release_id = member.source_release_id
  JOIN area_geography g ON g.id = v.geography_id
  JOIN metric_definition m ON m.id = v.metric_id
  LEFT JOIN area_geography p ON p.id = g.parent_id
  WHERE v.metric_id = %s AND v.period = to_date(%s, 'YYYY-MM')
    AND g.kind = m.carrier AND v.value IS NOT NULL AND v.region_percentile IS NOT NULL
  GROUP BY 1) rolled
WHERE parent IS NOT NULL"""


# Only the numbers of several months' packs (the price layer's fixed scale): one read
# instead of a full pack per year, each with names, percentiles and breakdowns the scale never uses.
PACK_VALUES_SQL = """-- evidence:pack-values
SELECT to_char(v.period, 'YYYY-MM') AS period, v.value, v.geography_id
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN metric_value v ON v.source_release_id = member.source_release_id
JOIN area_geography g ON g.id = v.geography_id
JOIN metric_definition m ON m.id = v.metric_id
WHERE v.metric_id = %s AND v.period = ANY(%s::date[]) AND v.value IS NOT NULL
  AND g.kind = m.carrier
  AND (%s::text[] IS NULL OR v.geography_id = ANY(%s::text[]))
ORDER BY v.period, v.geography_id"""
MAX_VALUE_PERIODS = 40


BREAKDOWN_SQL = """-- evidence:breakdown
SELECT to_char(b.period, 'YYYY-MM') AS period, b.category, b.offence_count
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN metric_value_breakdown b ON b.source_release_id = member.source_release_id
WHERE b.geography_id = %s AND b.metric_id = %s
ORDER BY b.period, b.category"""

PACK_BREAKDOWN_SQL = """-- evidence:pack-breakdown
SELECT b.geography_id, b.category, b.offence_count
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN metric_value_breakdown b ON b.source_release_id = member.source_release_id
WHERE b.metric_id = %s AND b.period = to_date(%s, 'YYYY-MM')
  AND (%s::text[] IS NULL OR b.geography_id = ANY(%s::text[]))
ORDER BY b.geography_id, b.category"""

GEOMETRY_CARRIERS = kinds.KINDS
# A map chunk (map_chunks): a region (E12...) or LAD (E06-E09) code.
CHUNK_PATTERN = re.compile(r"^E(0[6-9]|12)\d{6}$")
# One value-pack request may name this many chunks: every LAD a zoomed-in view touches, with room to spare.
MAX_PACK_CHUNKS = 64

# Homes whose owner/occupier objected (confirmed) are dropped from every per-dwelling read.
NOT_SUPPRESSED_ADDRESS = """NOT EXISTS (SELECT 1 FROM suppressed_dwelling s WHERE s.address_id = a.id)"""
NOT_SUPPRESSED_PROPERTY = """NOT EXISTS (SELECT 1 FROM suppressed_dwelling s
                              WHERE s.uprn = p.uprn OR s.address_id = p.address_id)"""

# The site search's named parks and green spaces (OSM; no release membership, as places.py reads them).
PARK_SEARCH_SQL = """-- evidence:park-search
SELECT p.id, p.name, p.kind, ST_X(ST_PointOnSurface(p.geometry)) AS center_lon,
  ST_Y(ST_PointOnSurface(p.geometry)) AS center_lat
FROM place_park p
WHERE p.name ILIKE %s
ORDER BY p.name ILIKE %s DESC, p.area_hectares DESC, p.name, p.id
LIMIT %s"""

# The LSOA (and its borough) each point falls in, by 1-based position; a point outside every LSOA has no row.
POINT_LSOAS_SQL = """-- evidence:point-lsoas
SELECT p.i::integer AS i, a.id AS geography_id, b.name AS borough
FROM unnest(%s::float8[], %s::float8[]) WITH ORDINALITY AS p(lon, lat, i)
JOIN LATERAL (
  SELECT g.id, g.parent_id FROM area_geography g
  WHERE g.kind = 'lsoa' AND ST_Intersects(g.geometry, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326))
  ORDER BY g.id LIMIT 1) a ON true
LEFT JOIN area_geography m ON m.id = a.parent_id
LEFT JOIN area_geography b ON b.id = m.parent_id AND b.kind = 'lad'"""

ADDRESS_SEARCH_SQL = """-- evidence:address-search
SELECT a.id AS address_id, a.display_address, a.postcode, a.geography_id,
  (SELECT COUNT(*) FROM address_transaction t WHERE t.address_id = a.id) AS sale_count,
  (SELECT p.uprn FROM property p WHERE p.address_id = a.id
     AND p.source_release_id IN (SELECT m.source_release_id FROM product_release_member m
                                 WHERE m.release_id = active.release_id) LIMIT 1) AS uprn,
  ST_X(ST_Centroid(g.geometry)) AS center_lon,
  ST_Y(ST_Centroid(g.geometry)) AS center_lat
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN address a ON a.source_release_id = member.source_release_id
JOIN area_geography g ON g.id = a.geography_id
WHERE (a.display_address ILIKE %s ESCAPE '\\' OR replace(a.postcode, ' ', '') ILIKE %s ESCAPE '\\'
       OR a.display_address ILIKE %s ESCAPE '\\')
  AND a.postcode LIKE %s
  AND """ + NOT_SUPPRESSED_ADDRESS + """
ORDER BY CASE WHEN a.display_address ILIKE %s ESCAPE '\\' OR a.display_address ILIKE %s ESCAPE '\\'
              THEN 0 ELSE 1 END,
  a.display_address
LIMIT %s"""
# Homes fetched per address search before the natural-order sort in _homes_and_streets, so a
# postcode's flats 1-9 are reachable within the per-kind cap (#236).
ADDRESS_FETCH = 60

# A full postcode compares exactly, never as a substring: "E8 3PJ" must not match "SE8 3PJ",
# "N1 1AA" must not match "EN1 1AA" (#200). Served by the btree address_postcode_idx
# (deploy/migrations/003-address-history.sql).
ADDRESS_BY_POSTCODE_SQL = """-- evidence:address-by-postcode
SELECT a.id AS address_id, a.display_address, a.postcode, a.geography_id,
  (SELECT COUNT(*) FROM address_transaction t WHERE t.address_id = a.id) AS sale_count,
  (SELECT p.uprn FROM property p WHERE p.address_id = a.id
     AND p.source_release_id IN (SELECT m.source_release_id FROM product_release_member m
                                 WHERE m.release_id = active.release_id) LIMIT 1) AS uprn,
  ST_X(ST_Centroid(g.geometry)) AS center_lon,
  ST_Y(ST_Centroid(g.geometry)) AS center_lat
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN address a ON a.source_release_id = member.source_release_id
JOIN area_geography g ON g.id = a.geography_id
WHERE a.postcode = %s
  AND """ + NOT_SUPPRESSED_ADDRESS + """
ORDER BY a.display_address
LIMIT 100"""

# A postcode's directory status, ignoring the live filter: tells a terminated postcode apart
# from one outside the loaded London directory (#205).
POSTCODE_STATUS_SQL = """-- evidence:postcode-status
SELECT p.postcode, p.terminated IS NOT NULL AS terminated
FROM postcode_civic p
WHERE p.postcode = %s"""

# Street-level search (migration 042): a home with no recorded sale is not in `address`, so a
# query like "120 Valley Road" finds the street (OS Open Names) instead. Its numbered homes with
# recorded sales give the street's postcodes and, for a house number, a likely postcode.
STREET_TABLE_SQL = """-- evidence:street-table
SELECT to_regclass('street') IS NOT NULL AS t"""

STREET_SEARCH_SQL = """-- evidence:street-search
SELECT * FROM (
  SELECT DISTINCT ON (lower(s.name), s.borough_id, s.postcode_district) s.name, s.locality,
    s.postcode_district,
    s.geography_id, s.borough_id, b.name AS borough_name,
    ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(s.easting, s.northing), 27700), 4326)) AS center_lon,
    ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(s.easting, s.northing), 27700), 4326)) AS center_lat
  FROM street s
  JOIN area_geography b ON b.id = s.borough_id
  WHERE s.name ILIKE %s
    AND (%s::text IS NULL OR s.locality ILIKE %s OR b.name ILIKE %s OR s.postcode_district = upper(%s))
  ORDER BY lower(s.name), s.borough_id, s.postcode_district, s.id
) streets
ORDER BY lower(name) = lower(%s) DESC, name, borough_name
LIMIT %s"""

# The street's recorded homes through the sale street key (migration 013: md5 of the upper-cased
# Price Paid street and the borough id), an index lookup rather than a text scan of every address.
# Deterministic (issue #152): a long street's homes must read the same every run, and the caller
# needs each home's LSOA to place a numbered hit where its recorded homes are.
STREET_HOMES_LIMIT = 2000
STREET_HOMES_SQL = """-- evidence:street-homes
SELECT DISTINCT a.display_address, a.postcode, a.geography_id
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN sale t ON t.source_release_id = member.source_release_id
JOIN address a ON a.id = t.address_id
WHERE t.street_key = md5(%s || '|' || %s)
  AND """ + NOT_SUPPRESSED_ADDRESS + """
ORDER BY a.postcode, a.display_address
LIMIT """ + str(STREET_HOMES_LIMIT)

# The centroid of the LSOA a numbered street hit's recorded homes sit in (issue #152).
LSOA_CENTER_SQL = """-- evidence:lsoa-center
SELECT ST_X(ST_Centroid(g.geometry)) AS center_lon, ST_Y(ST_Centroid(g.geometry)) AS center_lat
FROM area_geography g WHERE g.id = %s"""

# A postcode with no recorded home still resolves through the ONS Postcode Directory (migration 019).
POSTCODE_AREA_SQL = """-- evidence:postcode-area
SELECT p.postcode, g.id AS geography_id, g.name, b.name AS borough_name,
  ST_X(ST_Centroid(g.geometry)) AS center_lon, ST_Y(ST_Centroid(g.geometry)) AS center_lat
FROM postcode_civic p
JOIN area_geography g ON g.id = 'uk:lsoa:' || p.lsoa_code
LEFT JOIN area_geography b ON b.id = 'uk:lad:' || p.borough_code
WHERE p.postcode = %s AND p.terminated IS NULL"""

ADDRESS_SQL = """-- evidence:address
SELECT a.id AS address_id, a.display_address, a.postcode, a.geography_id,
  a.source_release_id
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN address a ON a.source_release_id = member.source_release_id
WHERE a.id = %s AND """ + NOT_SUPPRESSED_ADDRESS

ADDRESS_TXNS_SQL = """-- evidence:address-txns
SELECT t.address_id, to_char(t.completion_date, 'YYYY-MM-DD') AS date,
  t.nominal_price AS price, t.floor_area_square_metres AS floor,
  EXISTS (
    SELECT 1
    FROM product_release_member m2
    JOIN address_transaction t2 ON t2.source_release_id = m2.source_release_id
    WHERE m2.release_id = active.release_id
      AND t2.address_id = t.address_id
      AND t2.completion_date <> t.completion_date
      AND abs(t2.completion_date - t.completion_date) <= 90
      AND t2.nominal_price >= 2 * t.nominal_price
  ) AS part_share_likely,
  (SELECT bool_or(s.ppd_category = 'A') FROM sale s
   WHERE s.address_id = t.address_id AND s.completion_date = t.completion_date
     AND s.price = t.nominal_price AND s.source_release_id = member.source_release_id) AS standard_sale
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN address_transaction t ON t.source_release_id = member.source_release_id
JOIN address a ON a.id = t.address_id
WHERE t.address_id = %s AND """ + NOT_SUPPRESSED_ADDRESS + """
ORDER BY t.completion_date, t.nominal_price"""

# Sales in the same building and on the same street (migration 013 keys). Rows
# carry no floor area or £/m²; the median £/m² only leaves the database from
# NEARBY_MEDIAN_MIN standard sales with an EPC floor area.
NEARBY_WINDOW_YEARS = 10
NEARBY_ROW_LIMIT = 50
NEARBY_MEDIAN_MIN = 5
NEARBY_KEYS_SQL = """-- evidence:nearby-sale-keys
SELECT t.building_key, t.street_key, t.postcode, t.source_release_id
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN sale t ON t.source_release_id = member.source_release_id
WHERE t.address_id = %s
ORDER BY t.completion_date DESC
LIMIT 1"""


# A sale that looks like a shared-ownership first tranche: the same address has another
# standard sale within 90 days at twice the price or more (issue #211). Price Paid does not
# label part shares, so this is a heuristic; flagged sales are excluded from the medians.
PART_SHARE_EXISTS = """EXISTS (
      SELECT 1
      FROM product_release_member m2
      JOIN sale s2 ON s2.source_release_id = m2.source_release_id
      WHERE m2.release_id = active.release_id
        AND s2.address_id = t.address_id
        AND s2.completion_date <> t.completion_date
        AND abs(s2.completion_date - t.completion_date) <= 90
        AND s2.ppd_category = 'A'
        AND s2.price >= 2 * t.price
    )"""


def _nearby_sales_sql(scope: str, match: str) -> str:
    return f"""-- evidence:nearby-sales-{scope}
WITH scoped AS (
  SELECT t.completion_date, t.price, t.property_type, t.tenure, t.new_build, t.ppd_category,
    t.price_per_square_metre, {PART_SHARE_EXISTS} AS part_share_likely
  FROM active_product_release active
  JOIN product_release_member member ON member.release_id = active.release_id
  JOIN sale t ON t.source_release_id = member.source_release_id
  CROSS JOIN LATERAL (SELECT t.address_id AS id) a
  WHERE {match}
    AND t.address_id <> %(address_id)s
    AND t.completion_date >= current_date - make_interval(years => %(years)s)
    AND """ + NOT_SUPPRESSED_ADDRESS + """
), summary AS (
  SELECT count(*) AS sale_count,
    count(*) FILTER (WHERE part_share_likely) AS excluded_part_share,
    count(price_per_square_metre)
      FILTER (WHERE ppd_category = 'A' AND NOT part_share_likely) AS median_sample,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_square_metre)
      FILTER (WHERE ppd_category = 'A' AND NOT part_share_likely) AS median_ppm
  FROM scoped
)
SELECT summary.sale_count, summary.excluded_part_share, summary.median_sample,
  CASE WHEN summary.median_sample >= %(median_min)s THEN round(summary.median_ppm::numeric) END AS median_ppm,
  to_char(r.completion_date, 'YYYY-MM-DD') AS date, r.price, r.property_type, r.tenure, r.new_build,
  r.part_share_likely
FROM summary
LEFT JOIN LATERAL (
  SELECT * FROM scoped ORDER BY completion_date DESC, price DESC LIMIT %(limit)s
) r ON true"""


NEARBY_BUILDING_SQL = _nearby_sales_sql("building", "t.building_key = %(key)s")
# The street excludes the subject's own building, which has its own list.
NEARBY_STREET_SQL = _nearby_sales_sql(
    "street", "t.street_key = %(key)s AND t.building_key IS DISTINCT FROM %(building_key)s "
              "AND split_part(t.postcode, ' ', 1) = split_part(%(postcode)s, ' ', 1)")
PROPERTY_TYPES = {"D": "detached", "S": "semi-detached", "T": "terraced", "F": "flat", "O": "other"}
TENURES = {"F": "freehold", "L": "leasehold", "U": "unknown"}
NEARBY_DISCLAIMER = (
    "Recorded achieved sale prices from HM Land Registry Price Paid for other homes, not valuations. "
    "Building = same house number or name and street in the same postcode sector; street = the same "
    "street name in the same postcode district, other buildings. Last 10 years, newest 50 per list. "
    "Per-sale floor area is not shown; the median £/m² uses standard sales with an EPC floor area and "
    "appears only from 5 of them. "
    "Sales that look like shared-ownership part shares (a sale at under half of another standard sale "
    "at the same address within 90 days) are excluded from the median £/m² and counted separately.")

PROPERTY_COLUMNS = """
  p.uprn, p.address_id, p.address AS display_address, p.geography_id, p.parcel_id,
  ST_X(p.location) AS lon, ST_Y(p.location) AS lat, p.source_release_id,
  to_char(v.period, 'YYYY-MM') AS period, to_char(v.sale_period, 'YYYY-MM') AS sale_period,
  to_char(v.completion_date, 'YYYY-MM-DD') AS completion_date, v.nominal_price,
  v.floor_area_square_metres AS floor"""

# Only the last standard sale's recorded facts are read from property_stock_value
# (never its restated value: owner decision). It is stamped with the
# sales source release, so it joins on any active member, not the property's own.
PROPERTY_SQL = """-- evidence:property
SELECT""" + PROPERTY_COLUMNS + """
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN property p ON p.source_release_id = member.source_release_id
LEFT JOIN property_stock_value v ON v.uprn = p.uprn AND v.source_release_id IN
  (SELECT m.source_release_id FROM product_release_member m WHERE m.release_id = active.release_id)
WHERE p.uprn = %s AND """ + NOT_SUPPRESSED_PROPERTY

# A home lookup over every address with a linked UPRN or a recorded sale: a
# `property` row exists only where an EPC certificate mapped the address exactly,
# so the search unions linked homes with unlinked ones (no property row) that have
# a recorded sale. Never ORDER BY … LIMIT 1 here: several rows mean ambiguity,
# not a first match (B2).
_PROPERTY_SEARCH_LIMIT = 11
PROPERTY_SEARCH_SQL = """-- evidence:property-search
SELECT p.uprn, a.id AS address_id,
  coalesce(p.address, a.display_address) AS display_address,
  coalesce(p.geography_id, a.geography_id) AS geography_id,
  p.parcel_id, ST_X(p.location) AS lon, ST_Y(p.location) AS lat,
  coalesce(p.source_release_id, a.source_release_id) AS source_release_id,
  to_char(v.period, 'YYYY-MM') AS period, to_char(v.sale_period, 'YYYY-MM') AS sale_period,
  to_char(v.completion_date, 'YYYY-MM-DD') AS completion_date, v.nominal_price,
  v.floor_area_square_metres AS floor,
  a.postcode,
  (SELECT count(*) FROM address_transaction t
   WHERE t.address_id = a.id AND t.source_release_id = member.source_release_id) AS sale_count
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN address a ON a.source_release_id = member.source_release_id
LEFT JOIN property p ON p.address_id = a.id AND p.source_release_id = member.source_release_id
LEFT JOIN property_stock_value v ON v.uprn = p.uprn AND v.source_release_id IN
  (SELECT m.source_release_id FROM product_release_member m WHERE m.release_id = active.release_id)
WHERE (a.display_address ILIKE %s ESCAPE '\\' OR p.address ILIKE %s ESCAPE '\\' OR a.id ILIKE %s ESCAPE '\\')
  AND a.postcode LIKE %s
  AND """ + NOT_SUPPRESSED_ADDRESS + """
  AND (p.uprn IS NULL OR """ + NOT_SUPPRESSED_PROPERTY + """)
  AND (p.uprn IS NOT NULL
       OR EXISTS (SELECT 1 FROM address_transaction t
                  WHERE t.address_id = a.id AND t.source_release_id = member.source_release_id))
ORDER BY a.display_address
LIMIT %s"""

# One linked home by its address id (B2: the addressId search_places returned).
PROPERTY_BY_ADDRESS_SQL = """-- evidence:property-by-address
SELECT""" + PROPERTY_COLUMNS + """
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN property p ON p.source_release_id = member.source_release_id
LEFT JOIN property_stock_value v ON v.uprn = p.uprn AND v.source_release_id IN
  (SELECT m.source_release_id FROM product_release_member m WHERE m.release_id = active.release_id)
WHERE p.address_id = %s AND """ + NOT_SUPPRESSED_PROPERTY

# One unlinked home by its address id: the address row plus its recorded sale count.
ADDRESS_HOME_SQL = """-- evidence:address-home
SELECT a.id AS address_id, a.display_address, a.postcode, a.geography_id, a.source_release_id,
  (SELECT count(*) FROM address_transaction t
   WHERE t.address_id = a.id AND t.source_release_id = member.source_release_id) AS sale_count
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN address a ON a.id = %s AND a.source_release_id = member.source_release_id
WHERE """ + NOT_SUPPRESSED_ADDRESS

PROPERTY_TILE_SQL = """-- evidence:property-tile
SELECT property_tile(%s, %s, %s) AS tile"""
SALE_TILE_SQL = """-- evidence:sale-tile
SELECT sale_tile(%s, %s, %s) AS tile"""
PLACE_TILE_SQL = """-- evidence:place-tile
SELECT place_tile(%s, %s, %s) AS tile"""

PROPERTY_CAVEATS = (
    "The last sale is the recorded achieved price of the last standard sale (HM Land Registry); "
    "no home is valued. Area price ranges are on the home's profile.",
    "Coordinates come from OS Open UPRN; the parcel is the registered freehold, so flats share their block's parcel.",
    "Public-record data (HM Land Registry Price Paid; energy certificate facts about the building, never the "
    "occupant); an owner or "
    "occupier can hide a home via POST /api/v1/corrections kind=privacy-objection (see /privacy).",
)


class EvidenceReader:
    """Contract-shaped reads; ``connect`` is a zero-arg context manager factory."""

    def __init__(self, connect: Callable[[], Any]) -> None:
        self._connect = connect
        # Metric definitions and their period lists only change when another
        # release is activated, but computing a period list scans every row of
        # that metric (1.2 M for £/m²). Keep them per active release id, so an
        # activation invalidates them without any explicit flush.
        self._release_cache: dict[str, dict] = {}
        self._cache_lock = threading.Lock()

    def _cached(self, release_id: str, key: tuple, load: Callable[[], Any]) -> Any:
        with self._cache_lock:
            bucket = self._release_cache.get(release_id)
            if bucket is None:
                self._release_cache.clear()
                bucket = self._release_cache.setdefault(release_id, {})
            if key in bucket:
                return bucket[key]
        value = load()
        with self._cache_lock:
            self._release_cache.setdefault(release_id, {})[key] = value
        return value

    def _cached_pack(self, key: tuple, build: Callable[[], dict]) -> dict:
        """A built payload kept per release (release_artifact): key[0] is the release. The lookup and the write
        each take a connection of their own; `build` opens its own."""
        stored = ("pack", *key[1:])
        with self._connect() as connection:
            held = release_store.get(connection, key[0], stored, payload=True)
        if held is not release_store.MISSING:
            return held
        pack = build()
        with self._connect() as connection:
            release_store.put(connection, key[0], stored, pack, payload=True)
        return pack

    def _metric_for_release(self, connection: Any, release_id: str, metric_id: str) -> Mapping[str, Any]:
        return self._cached(release_id, ("metric", metric_id), lambda: _pinned_metric(connection, metric_id))

    def _release_periods(self, connection: Any, release_id: str, metric_id: str) -> frozenset:
        """The release's periods of a metric, which every area summary checks its ?period= against: built by
        release_build (cold, the price metric's took ~1.2 s, a DISTINCT over every LSOA month)."""
        return release_store.cached(connection, release_id, ("periods", metric_id), lambda: frozenset(
            row["period"] for row in connection.execute(PERIODS_SQL, (metric_id,))))

    def _check_release_period(self, connection: Any, release_id: str, metric_id: str, period: str,
                              cancel: Callable[[], bool] | None) -> None:
        _check_cancelled(cancel)
        periods = self._release_periods(connection, release_id, metric_id)
        if period not in periods:
            latest = ", ".join(sorted(periods)[-12:])
            raise PeriodNotFound(f"no validated values for {metric_id} in {period}; "
                                 f"valid periods (latest 12): {latest}")

    def area_boxes(self, carrier: str, cancel: Callable[[], bool] | None = None, *,
                   chunk: str | None = None) -> dict:
        """The box index of a map chunk (area-boxes.v1): each area's box, what the map needs of the shapes besides
        drawing them, which the area tiles do (map_tiles.py). Built once per release and chunk."""
        _check_cancelled(cancel)
        carrier = kinds.normalise(carrier)
        if carrier not in GEOMETRY_CARRIERS:
            raise MalformedQuery(f"invalid carrier: {carrier}")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            ids = self._chunk_ids(connection, release_id, carrier, chunk)

            def build() -> dict:
                rows = connection.execute(map_tiles.BOXES_SQL, (carrier, ids, ids))
                return {"schemaVersion": map_tiles.BOXES_SCHEMA, "carrier": carrier, "productReleaseId": release_id,
                        **({"chunk": chunk} if chunk else {}),
                        "areas": [[row["geography_id"], row["west"], row["south"], row["east"], row["north"]]
                                  for row in rows]}

            key = ("geometry-boxes", carrier, (chunk, feature_flags.england()))
            return release_store.cached(connection, release_id, key, build, payload=True)

    def area_tile_info(self, cancel: Callable[[], bool] | None = None) -> dict | None:
        """The area tiles the map draws (map_tiles.py), or None before migration 116."""
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            return self._cached(release_id, ("area-tiles",), lambda: map_tiles.tile_info(connection))

    def area_tile(self, release: str, kind: str, z: int, x: int, y: int,
                  cancel: Callable[[], bool] | None = None) -> bytes:
        """One area tile (migration 116): the stored one, or made on the fly before the store is built. The London
        map's (CLOSE_KNIT_ENGLAND off, or its own release) holds London's areas alone, made on request (125)."""
        _check_cancelled(cancel)
        problem = map_tiles.tile_problem(release, kind, z, x, y)
        if problem:
            raise MalformedQuery(problem)
        info = self.area_tile_info(cancel)
        if info is None:  # before migration 116
            raise MalformedQuery("area tiles unavailable")
        if z < map_tiles.MIN_ZOOM:
            return b""
        with self._connect() as connection:
            if map_tiles.london_only(info, release, feature_flags.england()):
                rows = list(connection.execute(map_tiles.REGION_TILE_SQL, (kind, z, x, y, coverage.LONDON_REGION)))
                return bytes(rows[0]["tile"] or b"") if rows else b""
            if info["built"]:
                rows = list(connection.execute(map_tiles.STORED_TILE_SQL, (info["release"], kind, z, x, y)))
                return bytes(rows[0]["tile"]) if rows else b""
            rows = list(connection.execute(map_tiles.LIVE_TILE_SQL, (kind, z, x, y)))
            return bytes(rows[0]["tile"] or b"") if rows else b""

    def _chunk_index(self, connection: Any, release_id: str) -> map_chunks.ChunkIndex:
        """Every chunk's areas and box, which each pack request checks its chunks against: built once per release
        (release_artifact; ~0.9 s of SQL, ~20 ms to read back) and held by each process for its release."""
        return self._cached(release_id, ("map-chunks",), lambda: release_store.cached(
            connection, release_id, ("map-chunks",), lambda: map_chunks.ChunkIndex(
                list(connection.execute(map_chunks.CHUNKS_SQL)), list(connection.execute(map_chunks.CHUNK_BOXES_SQL)))))

    def _chunk_ids(self, connection: Any, release_id: str, kind: str, chunk: str | None) -> list[str] | None:
        """The areas of `kind` in a map chunk (a region or LAD code). Without one, every area (None) with
        CLOSE_KNIT_ENGLAND on; off, London's (when the release knows regions): the map, packs and shapes
        stay the London ones whatever else the release holds."""
        if chunk is None:
            if feature_flags.england():
                return None
            index = self._chunk_index(connection, release_id)
            return index.ids(kind, map_chunks.LONDON) or [] if index.has_chunk(map_chunks.LONDON) else None
        if not CHUNK_PATTERN.match(chunk):
            raise MalformedQuery(f"invalid chunk: {chunk}")
        index = self._chunk_index(connection, release_id)
        if not index.has_chunk(chunk):
            raise MalformedQuery(f"unknown chunk: {chunk}")
        if not feature_flags.england() and map_chunks.LONDON not in (chunk, index.region_of_lad(chunk)):
            return []  # flag off: nothing outside London, whatever the release holds
        return index.ids(kind, chunk) or []

    def map_coverage(self, cancel: Callable[[], bool] | None = None) -> dict:
        """map-coverage.v1: where the map can go, the chunks it loads (map_chunks) and the tiles it draws (map_tiles);
        with CLOSE_KNIT_ENGLAND off, London's bounds, no chunks and London's own tiles."""
        _check_cancelled(cancel)
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            tiles = self._cached(release_id, ("area-tiles",), lambda: map_tiles.tile_info(connection))
            if not feature_flags.england():
                return map_tiles.with_tiles(map_chunks.london_payload(), tiles, london=True)
            index = self._chunk_index(connection, release_id)
            return self._cached(release_id, ("map-coverage",), lambda: map_tiles.with_tiles(index.payload(release_id), tiles))

    def list_metrics(self, cancel: Callable[[], bool] | None = None) -> dict:
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            rows = self._cached(release_id, ("metrics",), lambda: list(connection.execute(METRICS_SQL)))
            return {
                "schemaVersion": "area-metrics.v1",
                "productReleaseId": release_id,
                "metrics": [_metric_definition(row) for row in rows if row["id"] not in feature_flags.hidden_metrics()],
            }

    def source_releases(self, cancel: Callable[[], bool] | None = None) -> dict[str, dict]:
        """The active release's source-release table as source rows keyed by release id (#215),
        cached per active release like the metric catalogue."""
        from . import market_depth

        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            return self._cached(release_id, ("source-releases",),
                                lambda: market_depth.active_source_releases(connection))

    def search_areas(
        self,
        query: str,
        limit: int | None = None,
        cancel: Callable[[], bool] | None = None,
    ) -> dict:
        needle = (query or "").strip()
        if len(needle) < 2:
            raise MalformedQuery("search query must be at least 2 characters")
        # One normal form on both sides (#228): "St. John's Wood", "St Johns Wood" and the curly
        # "St John’s Wood" all read "st johns wood"; a punctuation-only query is no query (#239).
        key = normalise_query(needle)
        bound = _bound_limit(limit)
        district = postcode_district(needle)
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            postcode_match = POSTCODE_NEEDLE.match(needle.upper())
            district_rows: list = []
            if not key:
                results, addresses = [], []
            elif postcode_match is not None:
                # A full postcode is compared exactly, never as a substring (#200): "E8 3PJ"
                # must not match "SE8 3PJ", "N1 1AA" must not match "EN1 1AA". With no recorded
                # address the ONSPD fallback below still applies.
                results = []
                addresses = list(connection.execute(
                    ADDRESS_BY_POSTCODE_SQL, (f"{postcode_match[1]} {postcode_match[2]}",)))
            elif district is not None and (district_rows := list(
                    connection.execute(DISTRICT_AREAS_SQL, (district, bound)))):
                # A bare district is its areas, never an arbitrary home from EN1 or N12 (#229).
                # A district no area is labelled with (SW1A, EC1A) falls through to the plain
                # search below, so its homes still answer.
                results = [_search_result(row) for row in district_rows]
                addresses = []
            else:
                rows = list(connection.execute(SEARCH_SQL, _search_params(needle, key, bound)))
                if not rows:
                    rows = _search_in_place(connection, key, bound)
                results = [_search_result(row) for row in rows]
                remainder = bound - len(results)
                addresses = []
                if remainder > 0:
                    addresses = list(connection.execute(
                        ADDRESS_SEARCH_SQL, _address_search_params(needle, max(remainder, ADDRESS_FETCH))))
            if not results and not addresses:
                if key and not district_rows:
                    results = _postcode_area(connection, needle) or _street_results(connection, needle, bound)
            else:
                results = (results + _homes_and_streets(connection, needle, addresses, bound))[:bound]
            # Hits come from several queries (names, districts, postcodes, homes, streets): each hit's area is
            # checked once here rather than in every query.
            served, region_map = current_scope(), regions.area_regions_on(connection)
            return {
                "schemaVersion": "area-search.v1",
                "productReleaseId": release_id,
                "results": [{**row, "kind": _result_kind(row)} for row in results
                            if not row.get("geographyId") or served.admits(region_map, row["geographyId"])],
            }

    def search_site(
        self,
        query: str,
        limit: int | None = None,
        cancel: Callable[[], bool] | None = None,
    ) -> dict:
        """The site's one Search (/api/v1/search?scope=all): search_areas' areas, homes and streets,
        then a few schools, stations and named parks. Each of those carries the LSOA its point is in
        (the map opens there) and its borough; one outside every LSOA is left out."""
        from . import schools, zones

        found = self.search_areas(query, limit=limit, cancel=cancel)
        needle = query.strip()
        escaped = _like_escape(needle)
        with self._connect() as connection:
            _check_cancelled(cancel)
            stations = zones.station_results(
                connection.execute(zones.STATION_SEARCH_SQL, zones.station_search_params(needle)), SITE_KIND_LIMIT) \
                if zones.station_query_key(needle) else []
            wordy = len(needle) >= 3
            school_rows = list(connection.execute(
                schools.scoped(schools.SCHOOL_SEARCH_SQL), (f"%{escaped}%", SITE_KIND_LIMIT))) if wordy else []
            # Independent schools (GIAS, migration 067) too, once the table is there: state and independent by name.
            independent = list(connection.execute(schools.scoped(schools.INDEPENDENT_SEARCH_SQL), (
                f"%{_like_escape(normalise_query(needle))}%", SITE_KIND_LIMIT))) \
                if wordy and list(connection.execute(schools.INDEPENDENT_TABLE_SQL))[0]["t"] else []
            school_hits = sorted([_school_hit(row) for row in school_rows]
                                 + [_independent_hit(row) for row in independent],
                                 key=lambda hit: hit["label"])[:SITE_KIND_LIMIT]
            parks = list(connection.execute(
                PARK_SEARCH_SQL, (f"%{escaped}%", f"{escaped}%", SITE_KIND_LIMIT))) if wordy else []
            rows = (school_hits
                    + [_station_hit(station) for station in stations]
                    + [_park_hit(row) for row in parks])
            _check_cancelled(cancel)
            points = list(connection.execute(POINT_LSOAS_SQL, (
                [row["center"][0] for row in rows], [row["center"][1] for row in rows]))) if rows else []
        inside = {point["i"] - 1: point for point in points}
        extra = [{**row, "geographyId": inside[index]["geography_id"],
                  "secondaryLabel": " · ".join(part for part in (row["secondaryLabel"], inside[index]["borough"]) if part)}
                 for index, row in enumerate(rows) if index in inside]
        return {**found, "results": found["results"] + extra}

    def postcode_area(self, postcode: str, cancel: Callable[[], bool] | None = None) -> dict:
        """A full postcode's LSOA, for assess_listing / the listing card / badges (#205).

        Resolution order: (1) the exact recorded addresses' most common LSOA;
        (2) the live ONS Postcode Directory row (postcode_civic); (3) a typed error —
        PostcodeNotFound saying the postcode is no longer in use (terminated) or outside
        Close Knit's London coverage. Never a substring match of another district's postcode.
        """
        from . import civic
        normalised = civic.normalise_postcode(postcode)
        if normalised is None:
            raise MalformedQuery(f"invalid postcode: {postcode}")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            rows = list(connection.execute(ADDRESS_BY_POSTCODE_SQL, (normalised,)))
            if rows:
                counts: dict[str, int] = {}
                for row in rows:
                    counts[row["geography_id"]] = counts.get(row["geography_id"], 0) + 1
                area_id = max(counts, key=lambda gid: (counts[gid], gid))
                resolved_by = "recorded-address"
            else:
                civic_rows = list(connection.execute(POSTCODE_AREA_SQL, (normalised,)))
                if civic_rows:
                    area_id = civic_rows[0]["geography_id"]
                    resolved_by = "postcode-directory"
                else:
                    status = list(connection.execute(POSTCODE_STATUS_SQL, (normalised,)))
                    if status and status[0]["terminated"]:
                        raise civic.PostcodeNotFound(f"postcode {normalised} is no longer in use")
                    raise civic.PostcodeNotFound(
                        f"postcode {normalised} is not in Close Knit's London coverage")
            return {"postcode": normalised, "geographyId": area_id, "resolvedBy": resolved_by,
                    "productReleaseId": release_id}

    def get_address_history(
        self,
        address_id: str,
        cancel: Callable[[], bool] | None = None,
    ) -> dict:
        _check_cancelled(cancel)
        if not ADDRESS_PATTERN.match(address_id or ""):
            raise MalformedQuery(f"invalid address id: {address_id}")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            rows = list(connection.execute(ADDRESS_SQL, (address_id,)))
            if not rows:
                raise AddressNotFound(f"unknown address: {address_id}")
            address = rows[0]
            txns = list(connection.execute(ADDRESS_TXNS_SQL, (address_id,)))
            return {
                "schemaVersion": "address-history.v1",
                "productReleaseId": release_id,
                "history": {
                    "addressId": address["address_id"],
                    "displayAddress": address["display_address"],
                    "postcode": address["postcode"],
                    "geographyId": address["geography_id"],
                    "saleCount": len(txns),
                    "coordinatesPrecision": "postcode",
                    "transactions": [
                        {**per_home({"date": txn["date"], "nominalPrice": txn["price"],
                                     "floorAreaSquareMetres": txn["floor"],
                                     "partShareLikely": bool(txn.get("part_share_likely"))}),
                         # Whether the sale was a standard market sale (PPD category A); null when
                         # the sale row is not linked, so a category-B repeat never reads as a duplicate (#163).
                         "standardSale": txn.get("standard_sale")}
                        for txn in txns
                    ],
                    "estimateDisclaimer": (
                        "Recorded achieved sale prices, not valuations or asking prices. "
                        f"{floor_area_note()}; no sale carries a price per m²."),
                    "withheld": feature_flags.withheld(),
                    "sourceVersion": address["source_release_id"],
                },
            }

    def get_nearby_sales(self, address_id: str, cancel: Callable[[], bool] | None = None) -> dict:
        """Other homes' sales in the address's building and street (no per-sale floor area or £/m²)."""
        _check_cancelled(cancel)
        if not ADDRESS_PATTERN.match(address_id or ""):
            raise MalformedQuery(f"invalid address id: {address_id}")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            _load_address(connection, address_id)
            building, street, _ = _nearby_groups(connection, address_id, cancel)
            return _nearby_payload(release_id, address_id, building, street)

    def get_nearby_sales_summary(self, address_id: str, cancel: Callable[[], bool] | None = None) -> dict:
        """Building and street counts and gated medians only: no sale rows (agent tool)."""
        from . import market_depth

        _check_cancelled(cancel)
        if not ADDRESS_PATTERN.match(address_id or ""):
            raise MalformedQuery(f"invalid address id: {address_id}")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            _load_address(connection, address_id)
            building, street, source_id = _nearby_groups(connection, address_id, cancel)
            summary = market_depth.nearby_summary(_nearby_payload(release_id, address_id, building, street))
            return {"schemaVersion": "nearby-sales-summary.v1", "productReleaseId": release_id, **summary,
                    "sources": _source_releases(connection, [source_id])}

    def get_market_depth(self, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
        """Local market depth of an LSOA or MSOA (area-market.v1; unavailable for boroughs)."""
        from . import market_depth

        _check_cancelled(cancel)
        _validate_geography_id(area_id)
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            geography = _load_geography(connection, area_id)
            row = _market_row(connection, area_id)
            sources = _source_releases(connection, [row["source_release_id"] if row else None])
            return market_depth.market_payload(release_id, geography, row, sources)

    def get_area_pack(self, area_id: str, address_id: str | None = None,
                      cancel: Callable[[], bool] | None = None) -> dict:
        """Market depth, crime, noise and nearby schools of one area, plus the building and
        street aggregates of an address inside it (area-evidence-pack.v1)."""
        from . import market_depth, schools

        _check_cancelled(cancel)
        _validate_geography_id(area_id)
        if address_id is not None and not ADDRESS_PATTERN.match(address_id):
            raise MalformedQuery(f"invalid address id: {address_id}")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            geography = _load_geography(connection, area_id)
            row = _market_row(connection, area_id)
            crime_rows = _area_rows(connection, area_id, "crime", cancel)
            # #238: the offence mix of the latest month, so a busy centre is not read as a dangerous street.
            crime_mix = (_breakdown_map(connection, area_id, "crime", cancel).get(crime_rows[-1]["period"])
                         if crime_rows else None)
            crime = market_depth.crime_section(crime_rows, crime_mix)
            if crime:
                # Anti-social behaviour is stored as its own breakdown category (#163); surface it
                # next to the crime rate so the overview shows it.
                asb_rows = list(connection.execute(
                    """-- evidence:pack-asb
                    SELECT b.offence_count FROM active_product_release active
                    JOIN product_release_member member ON member.release_id = active.release_id
                    JOIN metric_value_breakdown b ON b.source_release_id = member.source_release_id
                    WHERE b.geography_id = %s AND b.metric_id = 'crime'
                      AND b.period = to_date(%s, 'YYYY-MM') AND b.category = 'anti-social-behaviour'""",
                    (area_id, crime["period"])))
                if asb_rows:
                    crime["asbOffences"] = asb_rows[0]["offence_count"]
                    crime["asbNote"] = ("Anti-social behaviour is an incident log, not a recorded "
                                        "crime; it is excluded from the rate above.")
            _check_cancelled(cancel)
            noise_rows = list(connection.execute(schools.AREA_NOISE_SQL, (area_id,)))
            noise = schools.noise_payload(area_id, release_id, noise_rows[0] if noise_rows else None, None, None)
            _check_cancelled(cancel)
            school_list = [schools.school_summary(school) for school in connection.execute(
                schools.scoped(schools.AREA_SCHOOLS_SQL), (area_id, schools.NEAR_RADIUS_METRES, schools.NEAR_LIMIT))]
            # The standing inspection per nearby URN (the map's rule): an ungraded visit
            # ("Standards maintained") leaves the earlier grade in place.
            standing = schools.standing_inspections(connection, [school["urn"] for school in school_list])
            for school in school_list:
                school["standingInspection"] = standing.get(school["urn"])
            # #227: AREA_SCHOOLS_SQL is capped at NEAR_LIMIT for the nearest list; counts come uncapped.
            school_counts = list(connection.execute(schools.scoped(schools.AREA_SCHOOL_COUNTS_SQL), (area_id, schools.NEAR_RADIUS_METRES)))
            # #250: independent schools (migration 067) in the same radius, kept apart from the Ofsted list.
            independent = (list(connection.execute(schools.scoped(schools.INDEPENDENT_NEAR_SQL), (area_id, schools.NEAR_RADIUS_METRES)))
                           if list(connection.execute(schools.INDEPENDENT_TABLE_SQL))[0]["t"] else None)
            nearby = nearby_source = None
            if address_id is not None:
                address = _load_address(connection, address_id)
                if not _contains(connection, area_id, address["geography_id"]):
                    raise MalformedQuery(f"address {address_id} is not in {area_id}")
                building, street, nearby_source = _nearby_groups(connection, address_id, cancel)
                nearby = market_depth.nearby_summary(_nearby_payload(release_id, address_id, building, street))
            sources = _source_releases(connection, [
                row["source_release_id"] if row else None, crime["sourceVersion"] if crime else None,
                noise["sourceVersion"], *(school["sourceVersion"] for school in school_list),
                *(school["source_release_id"] for school in independent or []), nearby_source])
            return market_depth.pack_payload(
                release_id, geography, market=market_depth.market_section(row), crime=crime,
                noise=market_depth.noise_section(noise),
                schools=market_depth.schools_section(school_list, schools.NEAR_RADIUS_METRES,
                                                     school_counts[0] if school_counts else None, independent),
                nearby=nearby, sources=sources)

    def search_stations(self, query: str, cancel: Callable[[], bool] | None = None) -> dict:
        """Stations by name for the zone picker (station-search.v1)."""
        from . import zones

        if len((query or "").strip()) < 2:
            raise MalformedQuery("station search query must be at least 2 characters")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            # "!!" or a non-Latin query has an empty key, and '%%' would match every station (#239).
            rows = connection.execute(zones.STATION_SEARCH_SQL, zones.station_search_params(query)) \
                if zones.station_query_key(query) else []
            return {"schemaVersion": "station-search.v1", "productReleaseId": release_id,
                    "results": zones.station_results(rows)}

    def get_similar_areas(self, area_id: str, cheaper: bool = False, outside_zones: str | None = None,
                          social_renting: bool = False, cancel: Callable[[], bool] | None = None) -> dict:
        """Up to ten LSOAs with the closest crime, deprivation, income, price-level and
        station-access percentiles (similar-areas.v1); never demographic composition."""
        from . import repository, similarity, zones

        _check_cancelled(cancel)
        _validate_geography_id(area_id)
        if not area_id.startswith("uk:lsoa:"):
            raise MalformedQuery("similar areas compare neighbourhoods (LSOAs); choose an LSOA")
        zone_list = zones.parse_zones_param(outside_zones)
        factors = similarity.factors_for(social_renting)
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            geography = _load_geography(connection, area_id)
            vectors = self._cached(release_id, ("similar-vectors", factors), lambda: similarity.area_vectors(
                connection.execute(similarity.SIMILAR_SQL, (list(factors),))))
            _check_cancelled(cancel)
            inside = repository.zone_lsoas(connection, zone_list) or set()
            # Percentiles are regional (migration 103): areas like this one are found in its own region, so a
            # London area's answer stays London's and "cheaper" compares like with like.
            region_map = regions.area_regions_on(connection)
            region = region_map.get(area_id)
            if region is not None:
                vectors = {key: value for key, value in vectors.items() if region_map.get(key) == region}
            candidates: dict = {}
            values = similarity.similar_areas(area_id, vectors, factors, cheaper=cheaper, exclude=inside,
                                              candidates=candidates)
            return similarity.similar_payload(release_id, geography, factors, values, cheaper=cheaper,
                                              outside_zones=zone_list is not None, candidates=candidates)

    def area_names(self, area_ids: list[str], cancel: Callable[[], bool] | None = None) -> dict:
        """The name to show for each known area id (display_name), for links that stored codes
        as names (a shared shortlist): names are resolved when a link is read. Unknown ids are left out."""
        _check_cancelled(cancel)
        if len(area_ids) > MAX_NAME_IDS:
            raise MalformedQuery(f"at most {MAX_NAME_IDS} ids")
        for area_id in area_ids:
            _validate_geography_id(area_id)
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            rows = list(connection.execute(AREA_LOOKUP_SQL, (list(area_ids),))) if area_ids else []
            names = {row["id"]: name for row in rows if (name := display_name(row))}
            # Where to pin each area (a ranking's top 10 numbered on the map): [longitude, latitude].
            centers = {row["id"]: [round(row["center_lon"], 5), round(row["center_lat"], 5)] for row in rows
                       if row.get("center_lon") is not None and row.get("center_lat") is not None}
            return {"schemaVersion": "area-names.v1", "productReleaseId": release_id, "names": names, "centers": centers}

    def area_lookup(self, area_ids: list[str], cancel: Callable[[], bool] | None = None) -> dict:
        """Name, borough, centre and postcode districts (busiest first) of each known area id;
        unknown ids are left out. Outcodes come from recorded addresses, else (outside London) the live
        postcodes of the ONS Postcode Directory, so only LSOAs carry them."""
        _check_cancelled(cancel)
        for area_id in area_ids:
            _validate_geography_id(area_id)
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            places = {row["id"]: {
                "geographyId": row["id"], "kind": row["kind"], "name": row["name"],
                "parentId": row["parent_id"], "borough": row["borough"],
                "center": [row["center_lon"], row["center_lat"]], "outcodes": [],
                "title": friendly_title(row.get("friendly_name"), row.get("postcode_district")),
                "displayName": display_name(row),
            } for row in connection.execute(AREA_LOOKUP_SQL, (list(area_ids),))}
            lsoas = [area_id for area_id in places if area_id.startswith("uk:lsoa:")]
            if lsoas:
                rows = sorted(connection.execute(AREA_OUTCODES_SQL, (lsoas,)),
                              key=lambda row: (-row["addresses"], row["outcode"]))
                for row in rows:
                    places[row["geography_id"]]["outcodes"].append(row["outcode"])
            bare = [area_id.split(":")[-1] for area_id in lsoas if not places[area_id]["outcodes"]]
            if bare and current_scope().level == "nation":  # London answers from its addresses, as before
                for row in sorted(connection.execute(AREA_POSTCODE_OUTCODES_SQL, (bare,)),
                                  key=lambda row: (-row["addresses"], row["outcode"])):
                    places[row["geography_id"]]["outcodes"].append(row["outcode"])
            return {"schemaVersion": "area-lookup.v1", "productReleaseId": release_id, "places": places}

    def area_at(self, longitude: float, latitude: float, cancel: Callable[[], bool] | None = None) -> str | None:
        """The LSOA a point lies in, None outside the loaded areas and the request's scope."""
        _check_cancelled(cancel)
        with self._connect() as connection:
            rows = list(connection.execute(AREA_AT_SQL.replace("{scope}", current_scope().sql_filter("g.id")),
                                           (longitude, latitude)))
        return rows[0]["id"] if rows else None

    def get_brief(self, area_ids: list[str], budget: tuple[int | None, int | None], bedrooms: int,
                  market: str, property_type: str, cancel: Callable[[], bool] | None = None) -> dict:
        """The evidence behind an agent's shortlist for the /brief page (area-brief.v1): each
        recommended LSOA with its ring of touching neighbours, prices against the budget,
        graded nearby schools and the nearest station."""
        from . import brief, home_search, location, repository, schools

        _check_cancelled(cancel)
        if not 1 <= len(area_ids) <= brief.MAX_AREAS or len(set(area_ids)) != len(area_ids):
            raise MalformedQuery(f"a brief takes 1 to {brief.MAX_AREAS} distinct areas")
        for area_id in area_ids:
            if not area_id.startswith("uk:lsoa:"):
                raise MalformedQuery("a brief compares neighbourhoods (LSOAs)")
            _validate_geography_id(area_id)
        if market not in ("buy", "rent") or property_type not in brief.PROPERTY_TYPES or not 0 <= bedrooms <= 8:
            raise MalformedQuery("invalid market, property type or bedrooms")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            ring_rows = list(connection.execute(brief.RING_SQL, (list(area_ids),)))
            ring = {area_id: [] for area_id in area_ids}
            for row in ring_rows:
                if row["neighbour_id"] not in ring:
                    ring[row["area_id"]].append(row["neighbour_id"])
            neighbours = sorted({n for ids in ring.values() for n in ids})
            _check_cancelled(cancel)
            sale_rows = list(connection.execute(
                brief.PRICE_CONTEXT_SQL, (list(area_ids) + neighbours, brief.PRICE_WINDOW_MONTHS)))
            stations = {row["geography_id"]: row for row in connection.execute(
                brief.NEAREST_STATION_SQL, (list(area_ids),))}
            markers = []
            for area_id in area_ids:
                _check_cancelled(cancel)
                summaries = [schools.school_summary(row) for row in connection.execute(schools.scoped(schools.AREA_SCHOOLS_SQL), (
                    area_id, schools.NEAR_RADIUS_METRES, schools.NEAR_LIMIT))]
                # The standing inspection per nearby URN (the map's rule).
                standing = schools.standing_inspections(connection, [s["urn"] for s in summaries])
                for summary in summaries:
                    summary["standingInspection"] = standing.get(summary["urn"])
                markers += [brief.school_marker(summary, area_id) for summary in summaries]
            outlines = {row["geography_id"]: _json(row["geometry"]) for row in connection.execute(
                brief.BRIEF_GEOMETRY_SQL, (brief.GEOMETRY_TOLERANCE, list(area_ids) + neighbours))}
            rents = ({row["geography_id"]: row for row in repository.rent_rows(
                connection, bedrooms, list(area_ids) + neighbours)} if market == "rent" else {})
            located = location.location_rows(connection, list(area_ids))
            notes = {area_id: value["notes"] for area_id, value in located.items()}
            sources = _source_releases(connection, sorted(
                {row["source_release_id"] for row in sale_rows}
                | {marker["sourceVersion"] for marker in markers if marker["sourceVersion"]}
                | {row["source_release_id"] for row in rents.values()}
                | {release for value in located.values() for release in value["sourceVersions"]}))
        places = self.area_lookup(list(area_ids) + neighbours, cancel=cancel)["places"]
        unknown = [area_id for area_id in area_ids if area_id not in places]
        if unknown:
            raise AreaNotFound(f"unknown area: {unknown[0]}")
        levels = self._price_levels(cancel)
        def estimate(area_id: str) -> dict:
            return home_search.price_estimate(levels.get(area_id), bedrooms, market, budget[1],
                                              monthly_rent=rents.get(area_id))
        areas = [{
            "rank": index + 1, **_place_fields(places[area_id]), "geometry": outlines.get(area_id),
            "ring": ring[area_id],
            "station": brief.station_entry(stations.get(area_id)), **estimate(area_id),
            "priceContext": (brief.price_context(sale_rows, {area_id, *ring[area_id]}, bedrooms,
                                                 property_type, budget)
                             if market == "buy" else {"available": False, "reason": "no rental evidence"}),
            "locationNotes": notes.get(area_id, []),
        } for index, area_id in enumerate(area_ids)]
        ring_entries = [{**_place_fields(places[n]), "geometry": outlines.get(n),
                         "ringOf": [a for a in area_ids if n in ring[a]],
                         **estimate(n)} for n in neighbours if n in places]
        return {"schemaVersion": "area-brief.v1", "productReleaseId": release_id,
                "request": {"budget": list(budget), "bedrooms": bedrooms, "market": market,
                            "propertyType": property_type},
                "areas": areas, "ring": ring_entries, "schools": brief.merge_schools(markers),
                "sources": sources,
                "caveats": brief.CAVEATS + (home_search.RENT_CAVEATS[:1] if market == "rent" else [])}

    def rent_levels(self, bedrooms: int, area_ids: list[str] | None = None) -> dict[str, dict]:
        """Borough average monthly rent per LSOA for the bedroom count (migration 029), with the
        borough, month and source; empty for a studio or before the rents are loaded. A requested MSOA
        or borough id gets the row of an LSOA inside it (the rent is the borough's)."""
        from .repository import rent_rows

        with self._connect() as connection:
            rows = rent_rows(connection, bedrooms, area_ids)
        levels = {row["geography_id"]: row for row in rows}
        for row in rows:
            for parent in (row.get("msoa_id"), row.get("carrier_geography_id")):
                if area_ids and parent in area_ids:
                    levels.setdefault(parent, row)
        return levels

    def _price_levels(self, cancel: Callable[[], bool] | None) -> dict[str, float]:
        """Latest £/m² of every area, from the cached value pack the map also uses."""
        catalogue = self.list_metrics(cancel=cancel)
        metric = next((m for m in catalogue["metrics"] if m["id"] == "price-per-square-metre"), None)
        if not metric or not metric.get("periods"):
            return {}
        pack = self.get_value_pack("price-per-square-metre", max(metric["periods"]), cancel=cancel)
        return {row["geographyId"]: row["value"] for row in pack["values"] if row["value"] is not None}

    _MODE_WORDS = {"transit": "by public transport", "walk": "on foot", "cycle": "by bike", "car": "by car"}

    def get_commute(self, area_id: str, places: list[dict], cancel: Callable[[], bool] | None = None) -> dict:
        """Transit, walking and cycling minutes from an LSOA to pinned places via the commute hubs."""
        from . import commute

        _check_cancelled(cancel)
        _validate_geography_id(area_id)
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            _load_geography(connection, area_id)
            network = commute.active_network(connection)
            routed = commute.area_commute(connection, network, area_id, places, release_id) if network else []
            nr_stations = commute.national_rail_only(connection, {area_id}, network["id"]).get(area_id) if network else None
            for entry in routed:
                if nr_stations is not None:
                    # National Rail is not in the timetables: these minutes are bus/TfL only.
                    entry["nationalRailNotModelled"] = True
            routed += commute.local_places(connection, release_id, area_id, places)
        mode_of = {place["id"]: place.get("mode", "transit") for place in places}
        capped = [(entry, mode) for entry in routed for mode, value in entry["modes"].items() if value.get("capped")]
        outside = [entry for entry in routed if entry.get("reason") in ("outside-london", "outside-coverage")]
        area_outside = commute.area_outside_routing(connection, release_id, area_id) if network else False
        nothing_near = [entry for entry in routed if entry.get("searchedRadiusM") and entry.get("nearest") is None]
        caveats = ["Weekday departures 08:00-09:00, median door-to-door minutes with the 10th-90th percentile range; "
                   "from the hub to the place is walked after public transport, ridden or driven otherwise.",
                   "The example route starts from the wider neighbourhood's centre; the minutes are from "
                   "this area itself.",
                   "Overground and Elizabeth line run on a frequency approximation; National Rail is not included yet, "
                   "so areas that rely on it can look slower than they are.",
                   "Cycling is at the speed Santander Cycles riders reach on weekday mornings (about 16 km/h); the "
                   "range spans two routing engines (OSRM and R5).",
                   "Driving: the route without traffic up to typical weekday-morning traffic (DfT average speeds on "
                   "local 'A' roads, 2025); parking, the congestion charge and ULEZ are not included."]
        if nr_stations is not None:
            if len(nr_stations) == 1:
                station_clause = f"{nr_stations[0]} is National Rail only"
            else:
                station_clause = f"{', '.join(nr_stations)} are National Rail only"
            caveats.append(f"{station_clause}, and National Rail is not in the timetable data yet: transit "
                           "minutes from here are bus and TfL services only and read slower than the railway.")
        if capped:
            cap = commute.MATRIX_CAP_MINUTES
            untimed = ", ".join(f"{entry['label']} {self._MODE_WORDS[mode]}" for entry, mode in capped)
            caveats.append(f"Journeys over {cap} minutes are not timed (the routing matrix stops there), so these "
                           f"have no minutes: {untimed}.")
        if any(entry.get("estimate") for entry in routed):
            caveats.append("Minutes marked estimate are straight-line (no commute hub within 1.5 km of the place), "
                           "not a route: good for screening, not a journey plan.")
        if area_outside:
            caveats.append("Door-to-door times cover London only (TfL timetables): no minutes from this area.")
        else:
            for entry in outside:
                caveats.append(f"{entry['label']} is outside Greater London, which the routing covers: no minutes.")
        for entry in nothing_near:
            caveats.append(f"No {entry['label']} within {entry['searchedRadiusM'] // 1000} km of this area.")
        if not network:
            caveats = ["No routing release is loaded: door-to-door times are unavailable."]
        points = [entry for entry in routed if entry["placeId"] in mode_of and "nearest" not in entry]
        return {"schemaVersion": "area-commute.v1", "productReleaseId": release_id, "geographyId": area_id,
                "network": network, "places": routed, "caveats": caveats,
                "nationalRailNotModelled": nr_stations is not None,
                # The place's own mode (transit unless chosen) is untimed: the answer is weaker than it looks.
                "capped": any(mode == mode_of.get(entry["placeId"]) for entry, mode in capped),
                "outsideLondon": None if not outside else ("all" if len(outside) == len(points) else "some")}

    def get_property(self, uprn: str, cancel: Callable[[], bool] | None = None) -> dict:
        _check_cancelled(cancel)
        if not UPRN_PATTERN.match(uprn or ""):
            raise MalformedQuery(f"invalid uprn: {uprn}")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            rows = list(connection.execute(PROPERTY_SQL, (uprn,)))
            if not rows:
                raise PropertyNotFound(f"unknown property: {uprn}")
            return _property_payload(release_id, rows[0])

    def find_property(self, query: str, cancel: Callable[[], bool] | None = None) -> dict:
        _check_cancelled(cancel)
        needle = (query or "").strip()
        if len(needle) < 3:
            raise MalformedQuery("property search needs at least 3 characters")
        if not normalise_query(needle):
            raise MalformedQuery("property search needs letters or digits")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            # A portal-style ref ("10 Borwick Avenue E17 6RA") skips the stored ", London, ":
            # the words match on their own, the tail scopes the postcode (#149).
            head, district, postcode = split_address_tail(needle)
            rows = list(connection.execute(PROPERTY_SEARCH_SQL, (f"%{like_escape(head)}%",) * 3
                                           + (postcode_like(district, postcode), _PROPERTY_SEARCH_LIMIT)))
            if not rows:
                raise PropertyNotFound(f"no dwelling matches: {needle}")
            if len(rows) == 1:
                return _home_payload(release_id, rows[0])
            # Several matches, and exactly one equals the needle (case- and
            # comma-insensitive): that one is the home. Otherwise the caller gets
            # the candidates; a fragment never resolves to a blind first row.
            exact = [row for row in rows if _loose_address(row["display_address"]) == _loose_address(needle)]
            if len(exact) == 1:
                return _home_payload(release_id, exact[0])
            raise PropertyAmbiguous(f"several homes match: {needle}",
                                    [_candidate(row) for row in rows[:10]], release_id)

    def find_home_by_address(self, address_id: str, cancel: Callable[[], bool] | None = None) -> dict:
        """A home by its address id (B2): the linked property when one exists, else the
        address-level home when it has a recorded sale. Never a forced single match."""
        _check_cancelled(cancel)
        if not ADDRESS_PATTERN.match(address_id or ""):
            raise MalformedQuery(f"invalid address id: {address_id}")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            rows = list(connection.execute(PROPERTY_BY_ADDRESS_SQL, (address_id,)))
            if rows:
                return _property_payload(release_id, rows[0])
            rows = list(connection.execute(ADDRESS_HOME_SQL, (address_id,)))
            if not rows or not int(rows[0]["sale_count"] or 0):
                raise PropertyNotFound(f"no dwelling matches: {address_id}")
            return _home_payload(release_id, rows[0])

    def property_tile(self, z: int, x: int, y: int, cancel: Callable[[], bool] | None = None) -> bytes:
        _check_cancelled(cancel)
        low, high = PROPERTY_TILE_ZOOM
        if not low <= z <= high or not 0 <= x < 2 ** z or not 0 <= y < 2 ** z:
            raise MalformedQuery(f"tile out of range: {z}/{x}/{y}")
        with self._connect() as connection:
            _active_release(connection, cancel)
            rows = list(connection.execute(PROPERTY_TILE_SQL, (z, x, y)))
            return bytes(rows[0]["tile"] or b"") if rows else b""

    def area_schools(self, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
        """State-funded primary and secondary schools within 1.5 km of the area, each with its topBadge."""
        from . import school_card, schools

        _check_cancelled(cancel)
        if not schools.AREA_PATTERN.match(area_id or ""):
            raise MalformedQuery(f"invalid area id: {area_id}")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
                raise AreaNotFound(f"unknown area: {area_id}")
            rows = list(connection.execute(
                schools.scoped(schools.AREA_SCHOOLS_SQL), (area_id, schools.NEAR_RADIUS_METRES, schools.NEAR_LIMIT)))
            badges = school_card.top_badges(connection, release_id, rows)
            return {"schemaVersion": "area-schools.v1", "productReleaseId": release_id,
                    "geographyId": area_id, "radiusMetres": schools.NEAR_RADIUS_METRES,
                    "schools": [schools.school_summary(row, badges.get(row["urn"])) for row in rows]}

    def area_noise(self, area_id: str, uprn: str | None = None,
                   cancel: Callable[[], bool] | None = None) -> dict:
        """Road, rail and aircraft Lden exposure of the area's dwellings (and one home's levels)."""
        from . import schools

        _check_cancelled(cancel)
        if not schools.AREA_PATTERN.match(area_id or ""):
            raise MalformedQuery(f"invalid area id: {area_id}")
        if uprn is not None and not schools.UPRN_PATTERN.match(uprn):
            raise MalformedQuery(f"invalid UPRN: {uprn}")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
                raise AreaNotFound(f"unknown area: {area_id}")
            rows = list(connection.execute(schools.AREA_NOISE_SQL, (area_id,)))
            dwelling = list(connection.execute(schools.DWELLING_NOISE_SQL, (uprn,))) if uprn else []
            return schools.noise_payload(area_id, release_id, rows[0] if rows else None,
                                         dwelling[0] if dwelling else None, uprn)

    def search_schools(self, query: str, cancel: Callable[[], bool] | None = None) -> dict:
        from . import schools

        _check_cancelled(cancel)
        needle = (query or "").strip()
        if len(needle) < 3:
            return {"schemaVersion": "school-search.v1", "schools": []}
        with self._connect() as connection:
            _active_release(connection, cancel)
            rows = list(connection.execute(schools.scoped(schools.SCHOOL_SEARCH_SQL), (f"%{_like_escape(needle)}%", schools.SEARCH_LIMIT)))
            return {"schemaVersion": "school-search.v1", "schools": [schools.school_summary(row) for row in rows]}

    def school_ranking(self, axis: str, phase: str = "secondary", limit: int = 100,
                       cancel: Callable[[], bool] | None = None) -> dict:
        """One phase's schools ranked on one measure (KS4) or filtered by one framework's grade."""
        from . import schools

        _check_cancelled(cancel)
        if axis not in schools.RANKING_CAVEATS:
            raise MetricNotFound(f"no school ranking: {axis}")
        if phase not in schools.RANKING_PHASES:
            raise MalformedQuery(f"invalid phase: {phase}")
        if axis in schools.PERFORMANCE_AXES and phase != "secondary":
            raise MalformedQuery(f"{axis} is published for secondary schools only")
        if not 1 <= limit <= schools.RANKING_LIMIT:
            raise MalformedQuery(f"limit must be 1-{schools.RANKING_LIMIT}")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            rows = list(connection.execute(schools.scoped(schools.SCHOOL_RANKING_SQL), (phase,)))
            return {"schemaVersion": "school-ranking.v1", "productReleaseId": release_id,
                    "axis": axis, "phase": phase, **schools.school_ranking(axis, rows, limit)}

    def get_school(self, urn: str, cancel: Callable[[], bool] | None = None) -> dict:
        from . import schools

        _check_cancelled(cancel)
        if not schools.URN_PATTERN.match(urn or ""):
            raise MalformedQuery(f"invalid URN: {urn}")
        with self._connect() as connection:
            _active_release(connection, cancel)
            rows = list(connection.execute(schools.scoped(schools.SCHOOL_SQL), (urn,)))
            if not rows:
                raise SchoolNotFound(f"unknown school: {urn}")
            return {"schemaVersion": "school-summary.v1", "school": schools.school_summary(rows[0])}

    def school_index(self, cancel: Callable[[], bool] | None = None) -> dict:
        """school-index.v1: every school's URN, name, phase and whether it has any result or inspection."""
        from . import school_card, schools

        _check_cancelled(cancel)
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            return school_card.school_index(connection.execute(schools.scoped(school_card.SCHOOL_INDEX_SQL)), release_id)

    def school_points(self, cancel: Callable[[], bool] | None = None) -> dict:
        """school-points.v1: every open school's point and what its map icon and popup show (Show › Schools);
        independent schools too once migration 067 is applied."""
        from . import schools

        _check_cancelled(cancel)
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            return schools.load_points(connection, release_id)

    def university_points(self, cancel: Callable[[], bool] | None = None) -> dict:
        """university-points.v1: universities and colleges from OpenStreetMap (Student areas' points)."""
        from . import universities

        _check_cancelled(cancel)
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            unified = list(connection.execute(universities.TABLE_SQL))[0]["t"]
            rows = list(connection.execute(universities.POINTS_SQL)) if unified else []
            return universities.points(rows, release_id)

    def school_card(self, urn: str, cancel: Callable[[], bool] | None = None) -> dict:
        """school-card.v1: history, percentiles and medians in the school's region, topBadge, Ofsted extracts,
        admissions."""
        from . import school_card, schools

        _check_cancelled(cancel)
        if not schools.URN_PATTERN.match(urn or ""):
            raise MalformedQuery(f"invalid URN: {urn}")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            rows = list(connection.execute(schools.scoped(school_card.CARD_SCHOOL_SQL), (urn,)))
            if not rows:
                raise SchoolNotFound(f"unknown school: {urn}")
            history = schools.school_history(connection, urn)
            _check_cancelled(cancel)
            region = rows[0].get("region_code") or school_card.LONDON_REGION
            pool = school_card.london_pool(connection, release_id, region)
            rank_rows = list(connection.execute(school_card.NATIONAL_RANK_SQL,
                                                {"urn": urn, "phase": rows[0]["phase"]}))
            sixth_rows = (list(connection.execute(school_card.SIXTH_FORM_RANK_SQL, {"urn": urn, "region": region}))
                          if list(connection.execute(schools.SIXTH_FORM_RANK_TABLE_SQL))[0]["t"] else [])
            profile_row = next(iter(connection.execute(school_card.PROFILE_SQL, (urn,))), None)
            used = {row["source_release_id"] for row in rank_rows if row["source_release_id"]}
            used |= {row["source_release_id"] for row in sixth_rows if row["source_release_id"]}
            used |= {profile_row["source_release_id"]} if profile_row else set()
            extras = school_card.extra_rows(connection, urn)
            extras["comparePool"] = school_card.compare_pool(connection, release_id, region)
            extras["compareRows"] = [dict(row) for row in connection.execute(school_card.COMPARE_SCHOOL_SQL, (urn,))]
            used |= school_card.extra_release_ids(extras)
            extra = [dict(row) for row in connection.execute(schools.HISTORY_SOURCES_SQL, (sorted(used),))] if used else []
            return school_card.card(rows[0], history, pool, release_id, rank_rows, profile_row,
                                    [{**row, "caveats": list(row["caveats"] or [])} for row in extra], extras,
                                    sixth_rows=sixth_rows)

    def sale_tile(self, z: int, x: int, y: int, cancel: Callable[[], bool] | None = None) -> bytes:
        """Sold-price map: merged cells (z11-14) and one pin per home (z15+);
        suppressed homes are left out inside sale_tile() (migration 008)."""
        _check_cancelled(cancel)
        low, high = SALE_TILE_ZOOM
        if not low <= z <= high or not 0 <= x < 2 ** z or not 0 <= y < 2 ** z:
            raise MalformedQuery(f"tile out of range: {z}/{x}/{y}")
        with self._connect() as connection:
            _active_release(connection, cancel)
            rows = list(connection.execute(SALE_TILE_SQL, (z, x, y)))
            return bytes(rows[0]["tile"] or b"") if rows else b""

    def place_tile(self, z: int, x: int, y: int, cancel: Callable[[], bool] | None = None) -> bytes:
        """Places overlay (unified place table, migration 034): one point per place the sources agree on
        (confidence >= 0.6) from zoom 14, empty below; place_tile() keeps places of worship out (035)."""
        _check_cancelled(cancel)
        low, high = PLACE_TILE_ZOOM
        if not 0 <= z <= high or not 0 <= x < 2 ** z or not 0 <= y < 2 ** z:
            raise MalformedQuery(f"tile out of range: {z}/{x}/{y}")
        if z < low:
            return b""
        with self._connect() as connection:
            _active_release(connection, cancel)
            rows = list(connection.execute(PLACE_TILE_SQL, (z, x, y)))
            return bytes(rows[0]["tile"] or b"") if rows else b""

    def get_area(
        self,
        geography_id: str,
        metric_id: str,
        period: str,
        cancel: Callable[[], bool] | None = None,
    ) -> dict:
        _check_cancelled(cancel)
        _validate_geography_id(geography_id)
        _validate_period_format(period)
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            geography = _load_geography(connection, geography_id)
            metric = self._metric_for_release(connection, release_id, metric_id)
            self._check_release_period(connection, release_id, metric_id, period, cancel)
            rows = _area_rows(connection, geography_id, metric_id, cancel)
            if metric_id == PRICE_METRIC_ID and not rows:
                rows = _price_within(connection, geography, cancel)
            if _needs_carrier_fallback(rows, period, geography, metric):
                # A metric published for a wider area (income per MSOA; rent change
                # and mobile coverage per borough): read the enclosing carrier
                # area's series instead of reporting null/suppressed. Issue #206.
                rows = _carrier_rows(connection, geography, metric, cancel)
            price_rows = _price_rows(connection, geography_id, metric_id, rows, cancel)
            if not price_rows and metric_id != PRICE_METRIC_ID:
                price_rows = _price_within(connection, geography, cancel)
            names = _stored_carrier_names(connection, rows + price_rows, cancel)
            rows = [_with_stored_carrier(row, names) for row in rows]
            price_rows = [_with_stored_carrier(row, names) for row in price_rows]
            breakdowns = _breakdown_map(connection, geography_id, metric_id, cancel)
            current = _at_period(rows, period)
            region_map = regions.area_regions_on(connection)
            return {
                "schemaVersion": "area-summary.v1",
                "productReleaseId": release_id,
                "summary": _summary(geography, metric, period, current,
                                    breakdowns.get(period) if current else None, region_map),
                "parentId": geography["parent_id"],
                **_friendly(geography),
                # Where the area is: a link naming it without a position flies there (web area-map).
                "bbox": _bbox(geography),
                "priceTimeline": [_summary(geography, metric, row["period"], row, region_map=region_map)
                                  for row in price_rows],
                "metricTimeline": [_summary(geography, metric, row["period"], row,
                                            breakdowns.get(row["period"]), region_map) for row in rows],
            }

    def get_profile(self, geography_id: str, period: str,
                    cancel: Callable[[], bool] | None = None) -> dict:
        """Every profile metric at its latest period on or before ``period``, plus
        schools within 1 km by phase and the area's road/rail noise share.

        A metric published for a wider area (income is MSOA-level) or with no
        value here comes from the nearest enclosing area that has one; its
        summary keeps that area's id and carrier, so it never reads as local."""
        from . import places, schools

        _check_cancelled(cancel)
        _validate_geography_id(geography_id)
        _validate_period_format(period)
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            geography = _load_geography(connection, geography_id)
            areas = _lineage(connection, geography)
            lineage = [area["id"] for area in areas]
            levels = {area["kind"]: area["id"] for area in areas}
            _check_cancelled(cancel)
            rows = {(row["geography_id"], row["metric_id"], row["period"]): row for row in connection.execute(
                AREA_PROFILE_SQL, (lineage, list(PROFILE_METRIC_IDS), period))}
            metrics = []
            region_map = regions.area_regions_on(connection)
            for metric_id in PROFILE_METRIC_IDS:
                try:
                    metric = self._metric_for_release(connection, release_id, metric_id)
                except (MetricNotFound, ReleaseUnavailable):
                    continue  # not in this release: absent, never zero
                latest = max((p for p in metric["periods"] or [] if p <= period), default=None)
                row = next((rows[key] for key in ((area, metric_id, latest) for area in lineage)
                            if key in rows and rows[key]["value"] is not None), None)
                if row is None and metric_id == PRICE_METRIC_ID:
                    row = next((r for r in _price_within(connection, geography, cancel) if r["period"] == latest), None)
                if row is not None:
                    metrics.append(_summary(geography, metric, latest, row, region_map=region_map))
            _check_cancelled(cancel)
            counts = list(connection.execute(
                schools.scoped(schools.AREA_SCHOOL_COUNTS_SQL), (geography_id, schools.PROFILE_RADIUS_METRES)))
            _check_cancelled(cancel)
            noise_rows = list(connection.execute(schools.AREA_NOISE_SQL, (geography_id,)))
            noise = schools.noise_payload(geography_id, release_id, noise_rows[0] if noise_rows else None,
                                          None, None)
            typical = _typical_prices(connection, levels, cancel)
            _check_cancelled(cancel)
            london_ranks = places.with_best_schools(
                places.london_ranks(connection, geography["id"]),
                places.best_school_ranks(connection, geography["id"], release_id))
            return {
                "schemaVersion": "area-profile.v1",
                "geographyId": geography["id"],
                "name": geography["name"],
                **_friendly(geography),
                "metrics": metrics,
                "schools": ({"primary": counts[0]["primary_count"], "secondary": counts[0]["secondary_count"],
                             "radiusMetres": schools.PROFILE_RADIUS_METRES} if counts else None),
                "noise": {"available": noise["available"], "any55Share": noise["any55Share"]},
                "typicalPrices": typical,
                "regionRanks": london_ranks,
            }

    def get_value_pack(
        self,
        metric_id: str,
        period: str,
        cancel: Callable[[], bool] | None = None,
        *,
        chunk: str | None = None,
        level: str | None = None,
    ) -> dict:
        """Every area's value for one month; England's map asks per chunk of its view (a region or
        LAD code), and zoomed out for a coarser `level` (msoa, borough): each wider area's median of
        the metric's own areas (map_chunks.roll_up). Without a chunk, every area, as always.
        `chunk` may list several (comma-separated, at most MAX_PACK_CHUNKS): one request for every
        LAD in view, each LAD's pack cached on its own and the values joined in the order given."""
        _check_cancelled(cancel)
        _validate_period_format(period)
        level = kinds.normalise(level)
        if level is not None and level not in map_chunks.LEVELS:
            raise MalformedQuery(f"invalid level: {level}")
        chunks = list(dict.fromkeys(chunk.split(","))) if chunk else [None]
        if len(chunks) > MAX_PACK_CHUNKS:
            raise MalformedQuery(f"at most {MAX_PACK_CHUNKS} chunks")
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            for each in chunks:
                if each is not None:
                    self._chunk_ids(connection, release_id, kinds.LAD, each)  # validates the chunk
            # Each chunk's pack is kept per release (release_artifact), built at release activation or by the first
            # request that asks.
            keys = [("pack", metric_id, period, each, feature_flags.england(), level) for each in chunks]
            held = [release_store.get(connection, release_id, key, payload=True) for key in keys]
        missing = [each for each, pack in zip(chunks, held) if pack is release_store.MISSING]
        # The chunks not built yet are read together: one query for thirty LADs, not thirty.
        built = dict(zip(missing, self._build_value_packs(release_id, metric_id, period, cancel, missing, level))) if missing else {}
        if built:
            with self._connect() as connection:
                for each, key in zip(chunks, keys):
                    if each in built:
                        release_store.put(connection, release_id, key, built[each], payload=True)
        packs = [built[each] if pack is release_store.MISSING else pack for each, pack in zip(chunks, held)]
        if len(packs) == 1:
            return packs[0]
        return {**packs[0], "chunk": ",".join(chunks), "values": [entry for pack in packs for entry in pack["values"]]}

    def preset_pack(self, criterion_id: str, titles: Callable[[], Mapping[str, str]],
                    cancel: Callable[[], bool] | None = None, level: str | None = None) -> dict | None:
        """A ready-made criterion's pack (custom-criterion-pack.v1), built once per release and kept in memory and
        on disk: the map's Gyms or Cafés layer is the same for everyone, unlike a household's own criterion (POST,
        never cached), which every switch rebuilt (1-5 s, perf/layer-load). None for an unknown id.

        level="msoa": its LSOAs rolled up to MSOAs (custom_criteria.roll_up_pack), what the map paints below
        WIDE_ZOOM as for every other layer: England's 6,900 MSOAs instead of 33,000 LSOAs (perf/layer-load)."""
        from . import custom_criteria

        if level not in (None, "msoa"):
            raise MalformedQuery(f"invalid level: {level}")
        criterion = custom_criteria.preset_criterion(criterion_id)
        if criterion is None:
            return None
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            key = ("preset-pack", criterion_id, feature_flags.england())

            def build() -> dict:
                return custom_criteria.evaluate(connection, criterion, titles=titles(), cancel=cancel)

            pack = release_store.cached(connection, release_id, key, build, payload=True)
            if level is None:
                return pack
            index = self._chunk_index(connection, release_id)
            return release_store.cached(connection, release_id, (*key, level), lambda: custom_criteria.roll_up_pack(
                pack, lambda area: index.parent(area, level), level), payload=True)

    def metric_values(self, metric_id: str, periods: list[str],
                      cancel: Callable[[], bool] | None = None) -> dict:
        """Every area's value for each of `periods` (YYYY-MM), numbers only, in one read: what the
        price layer's fixed scale is computed from (web/src/app/api/v1/price-scale). A month the
        release does not hold is a PeriodNotFound, as for a pack."""
        _check_cancelled(cancel)
        if not periods or len(periods) > MAX_VALUE_PERIODS:
            raise MalformedQuery(f"between 1 and {MAX_VALUE_PERIODS} periods")
        for period in periods:
            _validate_period_format(period)
        wanted = list(dict.fromkeys(periods))
        with self._connect() as connection:
            release_id = _active_release(connection, cancel)
            metric = self._metric_for_release(connection, release_id, metric_id)
            for period in wanted:
                self._check_release_period(connection, release_id, metric_id, period, cancel)
            ids = self._chunk_ids(connection, release_id, metric["carrier"], None)  # London only, flag off

        def build() -> dict:
            values: dict[str, list] = {period: [] for period in wanted}
            with self._connect() as connection:
                months = [f"{period}-01" for period in wanted]
                for row in connection.execute(PACK_VALUES_SQL, (metric_id, months, ids, ids)):
                    values[row["period"]].append(row["value"])
            return {"schemaVersion": "metric-values.v1", "metricId": metric_id,
                    "productReleaseId": release_id, "values": values}

        return self._cached_pack((release_id, "metric-values", metric_id, tuple(wanted), ids is None), build)

    def _build_value_packs(self, release_id: str, metric_id: str, period: str,
                           cancel: Callable[[], bool] | None, chunks: list[str | None],
                           level: str | None = None) -> list[dict]:
        """One pack per chunk (None: every area, London only with the flag off), all read in one query."""
        with self._connect() as connection:
            metric = self._metric_for_release(connection, release_id, metric_id)
            self._check_release_period(connection, release_id, metric_id, period, cancel)
            scopes = [self._chunk_ids(connection, release_id, metric["carrier"], chunk) for chunk in chunks]
            ids = None if any(scope is None for scope in scopes) else sorted({area for scope in scopes for area in scope})
            rows = list(connection.execute(PACK_SQL, (metric_id, period, ids, ids)))
            rolled = map_chunks.coarser(level, metric["carrier"])
            # Medians of the metric's own areas carry no crime breakdown (the category filter needs counts).
            breakdowns = {} if rolled else _pack_breakdown_map(connection, metric_id, period, cancel, ids)
            index = self._chunk_index(connection, release_id) if rolled else None
            region_map = regions.area_regions_on(connection)
            # Ranks in the country (the map's one scale across regions) are stored for each area; a roll-up's are
            # read here. With CLOSE_KNIT_ENGLAND off the map is London's and _summary withholds them.
            ranks = (self._rolled_country_ranks(connection, release_id, metric_id, period, level)
                     if rolled and feature_flags.england() else None)
            packs = []
            for chunk, scope in zip(chunks, scopes):
                wanted = None if scope is None else set(scope)
                chunk_rows = [row for row in rows if wanted is None or row["geography_id"] in wanted]
                if index is not None:
                    chunk_rows = map_chunks.roll_up(chunk_rows, index, level)
                if ranks is not None:
                    chunk_rows = [{**row, "country_percentile": ranks.get(row["geography_id"])} for row in chunk_rows]
                packs.append(self._pack_body(release_id, metric_id, metric, period, chunk_rows, breakdowns, chunk,
                                             level if rolled else None, region_map))
            return packs

    def _rolled_country_ranks(self, connection: Any, release_id: str, metric_id: str, period: str,
                              level: str) -> dict[str, int]:
        """Every MSOA's or LAD's (`level`) rank in the country for one month, read once per release and kept with
        the packs: a view of thirty LADs asks for it once, not thirty times."""
        def build() -> dict:
            rows = connection.execute(ROLLED_RANK_SQL, (level, metric_id, period))
            return {"ranks": {row["geography_id"]: row["country_percentile"] for row in rows}}

        return release_store.cached(connection, release_id, ("pack", "rolled-ranks", metric_id, period, level), build,
                                    payload=True)["ranks"]

    @staticmethod
    def _pack_body(release_id: str, metric_id: str, metric: Mapping[str, Any], period: str, rows: list, breakdowns: dict,
                   chunk: str | None, level: str | None, region_map: Mapping[str, str] | None = None) -> dict:
        geography = {"name": "", "parent_id": None}
        pack = {
            "schemaVersion": "area-value-pack.v1",
            "metricId": metric_id,
            "period": period,
            "sourceVersion": metric["source_release_id"],
            "productReleaseId": release_id,
            "values": [_summary(geography, metric, period, row, breakdowns.get(row["geography_id"]), region_map)
                       for row in rows],
        }
        if chunk is not None:
            pack["chunk"] = chunk
        if level is not None:
            pack["level"] = level
        return pack


def in_scope(connect: Callable[[], Any], area_id: str) -> bool:
    """Whether one area is inside the request's scope (London's alone with CLOSE_KNIT_ENGLAND off)."""
    served = current_scope()
    return served.regions is None or served.admits(regions.area_regions(connect), area_id)


def _json(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def _place_fields(place: Mapping[str, Any]) -> dict:
    return {"geographyId": place["geographyId"], "name": place["name"], "displayName": place.get("displayName"),
            "borough": place["borough"],
            "parentId": place["parentId"], "center": place["center"], "outcodes": place["outcodes"][:3]}


def _check_cancelled(cancel: Callable[[], bool] | None) -> None:
    if cancel is not None and cancel():
        raise Cancelled("evidence request was cancelled")


def _validate_geography_id(geography_id: str) -> None:
    if not GEOGRAPHY_PATTERN.match(geography_id or ""):
        raise MalformedQuery(f"invalid geography id: {geography_id}")


def _validate_period_format(period: str) -> None:
    if not PERIOD_PATTERN.match(period or ""):
        raise MalformedQuery(f"invalid period: {period}")


def _bound_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_SEARCH_LIMIT
    if limit < 1:
        raise MalformedQuery("search limit must be at least 1")
    return min(limit, MAX_SEARCH_RESULTS)


def _active_release(connection: Any, cancel: Callable[[], bool] | None) -> str:
    _check_cancelled(cancel)
    rows = list(connection.execute(ACTIVE_RELEASE_SQL))
    if not rows:
        raise ReleaseUnavailable("no active product release is loaded")
    return rows[0]["release_id"]


def _bbox(geography: Mapping[str, Any]) -> list[float] | None:
    """[west, south, east, north] of the area's shape, rounded to ~100 m; None without a shape."""
    box = [geography.get(key) for key in ("west", "south", "east", "north")]
    return [round(float(value), 4) for value in box] if all(value is not None for value in box) else None


def _load_geography(connection: Any, geography_id: str) -> Mapping[str, Any]:
    rows = list(connection.execute(GEOGRAPHY_SQL, (geography_id,)))
    if not rows:
        raise AreaNotFound(f"unknown area: {geography_id}")
    return rows[0]


def _pinned_metric(connection: Any, metric_id: str) -> Mapping[str, Any]:
    if metric_id in feature_flags.hidden_metrics():
        raise MetricNotFound(f"unknown metric: {metric_id}")
    rows = list(connection.execute(METRIC_SQL, (metric_id,)))
    if rows:
        return rows[0]
    known = list(connection.execute(METRIC_EXISTS_SQL, (metric_id,)))
    if known:
        raise ReleaseUnavailable(f"metric release is not in the active release: {metric_id}")
    raise MetricNotFound(f"unknown metric: {metric_id}")


def _check_period(
    connection: Any, metric_id: str, period: str, cancel: Callable[[], bool] | None,
) -> None:
    _check_cancelled(cancel)
    periods = [row["period"] for row in list(connection.execute(PERIODS_SQL, (metric_id,)))]
    if period not in periods:
        latest = ", ".join(sorted(periods)[-12:])
        raise PeriodNotFound(f"no validated values for {metric_id} in {period}; "
                             f"valid periods (latest 12): {latest}")


def _area_rows(
    connection: Any, geography_id: str, metric_id: str, cancel: Callable[[], bool] | None,
) -> list[dict]:
    _check_cancelled(cancel)
    return list(connection.execute(AREA_VALUES_SQL, (geography_id, metric_id)))


def _price_rows(
    connection: Any, geography_id: str, metric_id: str, rows: list[dict],
    cancel: Callable[[], bool] | None,
) -> list[dict]:
    if metric_id == PRICE_METRIC_ID:
        return rows
    _check_cancelled(cancel)
    return list(connection.execute(AREA_VALUES_SQL, (geography_id, PRICE_METRIC_ID)))


def _price_within(connection: Any, geography: Mapping[str, Any],
                  cancel: Callable[[], bool] | None) -> list[dict]:
    """A district or borough's monthly £/m²: the middle value of its LSOAs (an LSOA: none)."""
    if geography["kind"] == "lsoa":
        return []
    _check_cancelled(cancel)
    return [{
        "geography_id": geography["id"], "name": geography["name"], "carrier": geography["kind"],
        "metric_id": PRICE_METRIC_ID, "period": row["period"], "value": round(float(row["value"]), 1),
        "region_percentile": None, "country_percentile": None, "sample_count": None,
        # A median of LSOA values, not of the district's own sales: any fallback
        # child makes the row a fallback, and it says how many areas it used.
        "quality": "fallback" if row["fallback_areas"] else "observed",
        "source_release_id": row["source_release_id"], "area_count": row["areas"],
    } for row in connection.execute(AREA_PRICE_WITHIN_SQL, (PRICE_METRIC_ID, geography["id"], geography["id"]))]


# Read with get_area_metric / get_area_overview while an MSOA or borough £/m²
# is still the on-the-fly median of its LSOAs (dropped once the release stores
# the wider areas' own series). Issue #208.
PRICE_WITHIN_CAVEAT = (
    "District/borough £/m² is the median of its neighbourhood (LSOA) values, some of which "
    "are borough fallbacks; it is not a median of the district's own sales.")


# lsoa < msoa < lad: a metric published for a wider area is read from the
# enclosing area at that level (income per MSOA; rent change and mobile
# coverage per borough). Issue #206.
_CARRIER_RANK = {kind: rank for rank, kind in enumerate(kinds.KINDS)}


def _lineage(connection: Any, geography: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """The area and its parents, nearest first (self, parent, grandparent)."""
    lineage = [geography]
    parent_id = geography["parent_id"]
    while parent_id and len(lineage) < 3:
        parent = _load_geography(connection, parent_id)
        lineage.append(parent)
        parent_id = parent["parent_id"]
    return lineage


def _needs_carrier_fallback(rows: list[dict], period: str, geography: Mapping[str, Any],
                            metric: Mapping[str, Any]) -> bool:
    """No usable row at this level, while the metric is published for a wider area."""
    current = _at_period(rows, period)
    if current is not None and current["value"] is not None:
        return False
    return _CARRIER_RANK.get(metric["carrier"], 0) > _CARRIER_RANK.get(geography["kind"], 0)


def _carrier_rows(connection: Any, geography: Mapping[str, Any], metric: Mapping[str, Any],
                  cancel: Callable[[], bool] | None) -> list[dict]:
    """The enclosing carrier area's series, relabelled as a fallback for the requested area."""
    carrier = next((area for area in _lineage(connection, geography) if area["kind"] == metric["carrier"]), None)
    if carrier is None:
        return []
    projected = []
    for row in _area_rows(connection, carrier["id"], metric["id"], cancel):
        row = dict(row)
        if row.get("carrier_geography_id") in (None, carrier["id"]):
            row["carrier_geography_id"] = carrier["id"]
            row["carrier_name"] = display_name(carrier)
        # Otherwise the carrier's own row is a stored fallback: _stored_carrier_names names it.
        if row["quality"] != "suppressed":
            row["quality"] = "fallback"
        row["geography_id"] = geography["id"]
        row["name"] = geography["name"]
        projected.append(row)
    return projected


def _has_stored_carrier(row: Mapping[str, Any]) -> bool:
    """A row whose carrier id the ETL stored (095), not one _carrier_rows projected and named."""
    return row.get("carrier_geography_id") is not None and "carrier_name" not in row


def _stored_carrier_names(connection: Any, rows: list[dict],
                          cancel: Callable[[], bool] | None) -> dict[str, str]:
    """The name to show for each stored carrier id in ``rows``: one /areas/names read per request."""
    ids = list(dict.fromkeys(row["carrier_geography_id"] for row in rows if _has_stored_carrier(row)))
    if not ids:
        return {}
    _check_cancelled(cancel)
    return {row["id"]: name for row in connection.execute(AREA_LOOKUP_SQL, (ids,)) if (name := display_name(row))}


def _with_stored_carrier(row: dict, names: Mapping[str, str]) -> dict:
    """A stored-carrier row with its carrier's name (null if unknown) and the level its value comes from."""
    if not _has_stored_carrier(row):
        return row
    carrier_id = row["carrier_geography_id"]
    return {**row, "carrier": kinds.kind_of(carrier_id), "carrier_name": names.get(carrier_id)}


def _typical_prices(connection: Any, levels: Mapping[str, str],
                    cancel: Callable[[], bool] | None) -> list[dict]:
    """Typical (median) price of each type of home today, from the area price bands: for each
    type the first of the area's own level and its wider ones with enough sales (the property
    page's rule); a type with too few sales anywhere is left out. About the area, never a home."""
    from . import price_bands

    _check_cancelled(cancel)
    if not list(connection.execute(PRICE_BAND_TABLE_SQL))[0]["t"]:
        return []
    bands = {(row["geography_id"], row["property_type"]): row
             for row in connection.execute(AREA_TYPICAL_PRICES_SQL, (list(levels.values()),))}
    typical = []
    for code, key in TYPICAL_PRICE_TYPES:
        level = price_bands.pick_level({
            kind: int(bands[(area, code)]["sales"]) if (area, code) in bands else None
            for kind, area in levels.items()})
        if level is None:
            continue
        row = bands[(levels[level], code)]
        typical.append({
            "propertyType": key, "price": price_bands.round_price(row["p50"]), "sales": int(row["sales"]),
            "geographyId": levels[level], "carrier": level, "since": row["window_start"], "adjustedTo": row["period"],
        })
    return typical


def _at_period(rows: list[dict], period: str) -> dict | None:
    for row in rows:
        if row["period"] == period:
            return row
    return None


_INVERTED = re.compile(r"^(.+), (?:City|County) of$")


def plain_place_name(name: str | None) -> str | None:
    """A place's name as people say it: ONS lists a few local authorities inverted ("Bristol, City of",
    "Herefordshire, County of"); shown as "Bristol". Other names pass through."""
    return _INVERTED.sub(r"\1", name.strip()) if name and name.strip() else None


def friendly_title(friendly_name: str | None, district: str | None) -> str | None:
    """The area title the web shows: "Alperton East · NW10" (a borough: its name)."""
    friendly_name = plain_place_name(friendly_name)
    if not friendly_name:
        return None
    return f"{friendly_name} · {district}" if district else friendly_name


def display_name(row: Mapping[str, Any]) -> str | None:
    """The one name the site and agents show for an area: its friendly title
    ("Alperton East · HA0"), else the official name ("Brent 026D"), never a bare code."""
    return friendly_title(row.get("friendly_name"), row.get("postcode_district")) or plain_place_name(row.get("name"))


def _friendly(row: Mapping[str, Any]) -> dict:
    """Additive friendly-name fields (migration 023); null when the area has no row. displayName is
    the name to show (the official name stays in "name" for Sources)."""
    return {"friendlyName": row.get("friendly_name"), "postcodeDistrict": row.get("postcode_district"),
            "displayName": display_name(row)}


def _result_kind(row: Mapping[str, Any]) -> str:
    """A search row's kind: a street, a home (address), a postcode, else its area's level (lad, msoa, lsoa)."""
    if row.get("street"):
        return "street"
    if row.get("addressId"):
        return "address"
    if row.get("kind") == "postcode":
        return "postcode"
    return kinds.kind_of(row["geographyId"])


_like_escape = like_escape


# place_station's TfL modes (migration 017), as the site's search rows say them.
STATION_MODE_WORDS = {"tube": "Tube", "elizabeth-line": "Elizabeth line", "dlr": "DLR", "overground": "Overground",
                      "tram": "Tram", "national-rail": "Rail"}
PARK_KIND_WORDS = {"park": "Park", "garden": "Garden", "nature-reserve": "Nature reserve", "common": "Common",
                   "recreation-ground": "Recreation ground", "village-green": "Village green"}


def _school_hit(row: Mapping[str, Any]) -> dict:
    return {"kind": "school", "label": row["name"], "secondaryLabel": (row["phase"] or "School").capitalize(),
            "urn": row["urn"], "uprn": None, "center": [float(row["longitude"]), float(row["latitude"])]}


def _independent_hit(row: Mapping[str, Any]) -> dict:
    """An independent school: no school page of its own (no Ofsted grades or results), so it opens the map there."""
    return {"kind": "school", "label": row["name"], "secondaryLabel": "Independent", "urn": row["urn"],
            "independent": True, "uprn": None, "center": [float(row["longitude"]), float(row["latitude"])]}


def _station_hit(station: Mapping[str, Any]) -> dict:
    """A zones.station_result() as a site search row: the lines name the station's services
    (twins such as Hammersmith tell apart by them), the modes when TfL lists no line."""
    lines = [line["name"] for line in station["lines"]]
    modes = lines or [STATION_MODE_WORDS[mode] for mode in station["modes"] if mode in STATION_MODE_WORDS]
    return {"kind": "station", "label": station["name"], "secondaryLabel": " · ".join(modes) or "Station",
            "stationId": station["stationId"], "uprn": None, "center": list(station["center"])}


def _park_hit(row: Mapping[str, Any]) -> dict:
    return {"kind": "place", "label": row["name"], "secondaryLabel": PARK_KIND_WORDS.get(row["kind"], "Park"),
            "placeId": row["id"], "uprn": None, "center": [row["center_lon"], row["center_lat"]]}


def _lad_word(official_code: str | None) -> str:
    """What a local authority is called: London's (E09) are boroughs, the rest of England's councils."""
    return "borough" if (official_code or "").startswith("E09") else "council"


def _search_result(row: Mapping[str, Any]) -> dict:
    title = friendly_title(row.get("friendly_name"), row.get("postcode_district"))
    friendly = title is not None and title != row["name"]
    return {
        "geographyId": row["id"],
        "label": title if friendly else row["name"],
        "secondaryLabel": (f"{row['name']} · {row['official_code']}" if friendly
                           # a LAD is a borough in London (E09), a council elsewhere
                           else f"{row['official_code']} · {_lad_word(row['official_code']) if row['kind'] == kinds.LAD else row['kind']}"),
        **_friendly(row),
        "uprn": None,
        "center": [row["center_lon"], row["center_lat"]],
    }


PLACE_QUERY_WORDS = 5


def _search_in_place(connection: Any, key: str, bound: int) -> list:
    """A name with its town after it ("Clifton Bristol", "Headingley Leeds"): the name's areas inside the LADs
    whose name starts with the town's words; [] when no split finds any."""
    words = key.split()
    if len(words) > PLACE_QUERY_WORDS or any(char.isdigit() for char in key):
        return []  # an address ("10 Valley Road, Tufnell Park") goes to the home and street search
    for cut in range(len(words) - 1, 0, -1):
        head, place = " ".join(words[:cut]), " ".join(words[cut:])
        rows = list(connection.execute(SEARCH_SQL, _search_params(head, head, bound, place)))
        if rows:
            return rows
    return []


def _loose_address(text: str) -> str:
    """An address for exact-match comparison: case- and comma-insensitive."""
    return re.sub(r"[\s,]+", " ", (text or "").lower()).strip()


def _candidate(row: Mapping[str, Any]) -> dict:
    """One home for a PropertyAmbiguous answer: identified, never described."""
    return {"addressId": row["address_id"], "uprn": row["uprn"],
            "displayAddress": row["display_address"], "postcode": row["postcode"],
            "saleCount": int(row["sale_count"] or 0)}


def _home_payload(release_id: str, row: Mapping[str, Any]) -> dict:
    """A found home: the property payload when a UPRN is linked, else the
    address-level payload (no UPRN, no EPC, no parcel)."""
    if row.get("uprn"):
        return _property_payload(release_id, row)
    return {
        "schemaVersion": "property.v2",
        "productReleaseId": release_id,
        "property": {
            "uprn": None,
            "addressId": row["address_id"],
            "displayAddress": row["display_address"],
            "geographyId": row["geography_id"],
            "postcode": row["postcode"],
            "saleCount": int(row["sale_count"] or 0),
            "caveats": ["No UPRN or energy certificate is linked to this home; figures are for its area."],
            "sourceVersion": row["source_release_id"],
        },
    }


def _property_payload(release_id: str, row: Mapping[str, Any]) -> dict:
    return {
        "schemaVersion": "property.v2",
        "productReleaseId": release_id,
        "property": {
            "uprn": row["uprn"], "addressId": row["address_id"],
            "displayAddress": row["display_address"], "geographyId": row["geography_id"],
            "parcelId": row["parcel_id"], "location": [row["lon"], row["lat"]],
            "lastSale": _last_sale(row),
            "caveats": list(PROPERTY_CAVEATS),
            "sourceVersion": row["source_release_id"],
        },
    }


def _last_sale(row: Mapping[str, Any]) -> dict | None:
    """The last standard sale as recorded: date, price and floor area; no per-sale £/m² (EPC licence pending)."""
    if row.get("completion_date") is None:
        return None
    return per_home({
        "date": row["completion_date"], "period": row["sale_period"],
        "nominalPrice": row["nominal_price"], "floorAreaSquareMetres": row["floor"],
    })


def tidy_address_label(label: str) -> str:
    """'Flat 4, Kinross House, London, London, N1 0AA' -> '..., London, N1 0AA': no doubled town."""
    parts = [part.strip() for part in label.split(",") if part.strip()]
    return ", ".join(part for index, part in enumerate(parts)
                     if index == 0 or part.lower() != parts[index - 1].lower())


def _address_result(row: Mapping[str, Any]) -> dict:
    sales = row["sale_count"]
    return {
        "addressId": row["address_id"],
        "geographyId": row["geography_id"],
        "label": tidy_address_label(row["display_address"]),
        "secondaryLabel": f"{row['postcode']} · {sales} recorded sale{'' if sales == 1 else 's'}",
        "postcode": row["postcode"],
        "uprn": row.get("uprn"),
        "saleCount": row["sale_count"],
        "center": [row["center_lon"], row["center_lat"]],
        # The point is the address's LSOA centroid, never the dwelling (B7); agents must
        # not pin it as the home. "uprn" only when the owner allows the home point.
        "centerPrecision": "lsoa-centroid",
    }


POSTCODE_NEEDLE = re.compile(r"^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$")
# "120 Valley Road", "Flat 2, 120a Valley Road, Kenley" -> (120, "Valley Road"); "Valley Road" -> (None, ...).
STREET_NEEDLE = re.compile(r"^(?:(?:flat|apartment|unit)\s+\w+\s*,?\s*)?(?:(\d{1,5})[a-z]?\s*,?\s+)?([^,]+)", re.I)
STREET_SEARCH_LIMIT = 5
# A typed place Open Names does not name (Kenley's roads say "London") is looked for in the
# recorded addresses of this many streets instead.
STREET_PLACE_FALLBACK = 12
NEIGHBOUR_REACH = 10
STREET_POSTCODES = 6


def _postcode_area(connection: Any, needle: str) -> list[dict]:
    """A full postcode with no recorded home: one row (kind postcode) for its LSOA, labelled with the postcode."""
    match = POSTCODE_NEEDLE.match(needle.upper())
    if not match:
        return []
    rows = list(connection.execute(POSTCODE_AREA_SQL, (f"{match[1]} {match[2]}",)))
    return [{
        "kind": "postcode",
        "geographyId": row["geography_id"],
        "label": row["postcode"],
        "secondaryLabel": " · ".join(part for part in (row["name"], row["borough_name"]) if part),
        "uprn": None,
        "center": [row["center_lon"], row["center_lat"]],
    } for row in rows[:1]]


def street_place(needle: str) -> str | None:
    """The place typed after the street ("66 Valley Road, Kenley" -> "Kenley"; a postcode -> its
    district; "Montague Road E8" -> "E8", comma or not, #149); None when there is none, or it
    is only "London"."""
    head, district, _ = split_address_tail(needle)
    if district:
        return district
    match = STREET_NEEDLE.match(head)
    rest = [part.strip() for part in head[match.end():].split(",") if part.strip()] if match else []
    for part in rest:
        postcode = POSTCODE_NEEDLE.match(part.upper())
        if postcode:
            return postcode[1]
        if part.lower() != "london" and len(part) >= 2:
            return part
    return None


def street_query(needle: str) -> tuple[int | None, str | None]:
    """(house number, street words) of a typed address; street None when too short to search."""
    match = STREET_NEEDLE.match(split_address_tail(needle)[0])
    if not match:
        return None, None
    street = " ".join(match[2].split())
    if len(street) < 3 or not re.search(r"[A-Za-z]", street) or POSTCODE_NEEDLE.match(street.upper()):
        return None, None
    return (int(match[1]) if match[1] else None), street


def _street_number_pattern(street: str) -> re.Pattern:
    return re.compile(r"(?:^|[,\s])(\d{1,5})[a-z]?\s+" + re.escape(street) + r"\s*(?:,|$)", re.I)


def street_numbers(street: str, addresses: list[Mapping[str, Any]]) -> list[tuple[int, str]]:
    """(house number, postcode) of each recorded home whose address names `street` after its number."""
    pattern = _street_number_pattern(street)
    found = []
    for row in addresses:
        match = pattern.search(row["display_address"])
        if match:
            found.append((int(match[1]), row["postcode"]))
    return found


def _homes_at_number(street: str, homes: list[Mapping[str, Any]], number: int) -> list[Mapping[str, Any]]:
    """Recorded homes whose address names `street` at exactly `number` (issue #152: a tower's
    flats share one number across several postcodes)."""
    pattern = _street_number_pattern(street)
    return [home for home in homes
            if (match := pattern.search(home["display_address"])) and int(match[1]) == number]


def likely_postcode(number: int, numbered: list[tuple[int, str]]) -> tuple[str | None, list[int]]:
    """The postcode a house number most likely has, from recorded homes on the same side of the street.

    The same number (another flat at 120) decides on its own; otherwise the nearest number below and
    above, each within NEIGHBOUR_REACH, must share one postcode. Anything less certain gives None.
    """
    side = [(n, postcode) for n, postcode in numbered if n % 2 == number % 2]
    same = {postcode for n, postcode in side if n == number}
    if same:
        return (same.pop(), [number]) if len(same) == 1 else (None, [])
    below = [(n, pc) for n, pc in side if number - NEIGHBOUR_REACH <= n < number]
    above = [(n, pc) for n, pc in side if number < n <= number + NEIGHBOUR_REACH]
    if not below or not above:
        return None, []
    low, high = max(n for n, _ in below), min(n for n, _ in above)
    low_codes = {pc for n, pc in below if n == low}
    high_codes = {pc for n, pc in above if n == high}
    if len(low_codes) == 1 and low_codes == high_codes:
        return low_codes.pop(), [low, high]
    return None, []


def _address_search_params(needle: str, limit: int) -> tuple:
    """ADDRESS_SEARCH_SQL's parameters: the normalised words (apostrophes and dots dropped, the
    flat's comma kept), the postcode without its space, the words with straight apostrophes for
    a stored "St Mary's Road", the postcode pattern of a trailing district or postcode (#149),
    then the two prefix forms that rank the exact home first (#236)."""
    head, district, postcode = split_address_tail(needle)
    plain = like_escape(normalise_query(head, keep=","))
    quoted = like_escape(normalise_query(head, keep=",'"))
    nospace = like_escape(head.replace(" ", ""))
    return (f"%{plain}%", f"%{nospace}%", f"%{quoted}%", postcode_like(district, postcode),
            f"{plain}%", f"{quoted}%", limit)


def _address_order(needle: str, rows: list[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """Homes starting with what was typed first, then natural number order (flat 2 before flat 10),
    so the exact flat and a postcode's low numbers are reachable within the cap (#236)."""
    from .property_profile import natural_key

    head = split_address_tail(needle)[0]
    prefixes = tuple(p for p in (normalise_query(head, keep=","), normalise_query(head, keep=",'")) if p)
    return sorted(rows, key=lambda row: (not row["display_address"].lower().startswith(prefixes),
                                         natural_key(row["display_address"])))


def _homes_and_streets(connection: Any, needle: str, addresses: list[Mapping[str, Any]], bound: int) -> list[dict]:
    """Address results; with a typed house number, the homes with exactly that number come first,
    then streets where that number has no recorded sale, then near misses ("166" for "66")."""
    number, street = street_query(needle)
    addresses = _address_order(needle, addresses)
    found = [_address_result(row) for row in addresses]
    if number is None:
        return found
    exact = [any(n == number for n, _ in street_numbers(street, [row])) for row in addresses]
    unsold = [row for row in _street_results(connection, needle, bound) if row["street"]["neighbours"] != [number]]
    return ([r for r, hit in zip(found, exact) if hit] + unsold + [r for r, hit in zip(found, exact) if not hit])


def street_candidates(connection: Any, number: int | None, street: str, borough_id: str | None,
                      district: str | None = None) -> dict:
    """What the recorded homes on a street say about a house number: its `homes`, the street's
    `postcodes` (the typed number's first, then most homes first), and, with a number, the `likely`
    postcode and the `neighbours` (numbers either side) it comes from.

    A number with recorded homes is modelled separately from one likely postcode (issue #152):
    `numberPostcodes` lists every postcode with a recorded home at that number, and
    `numberGeographyId` is the LSOA most of those homes sit in. `likely_postcode` keeps the
    neighbour logic for the no-same-number case.

    `district` scopes the homes to one postcode district: same-named streets in one borough are
    separate physical streets, and pooling their homes mislabels recorded homes (#202).
    """
    homes = list(connection.execute(STREET_HOMES_SQL, (" ".join(street.upper().split()), borough_id)))
    if district:
        outcode = district.upper()
        homes = [home for home in homes if home["postcode"].split(" ")[0].upper() == outcode]
    numbered = street_numbers(street, homes)
    counts: dict[str, int] = {}
    for _, postcode in numbered:
        counts[postcode] = counts.get(postcode, 0) + 1
    at_number = _homes_at_number(street, homes, number) if number is not None else []
    number_postcodes = sorted({home["postcode"] for home in at_number})
    if number_postcodes:
        likely = number_postcodes[0] if len(number_postcodes) == 1 else None
        neighbours = [number]
        lsoa_counts: dict[str, int] = {}
        for home in at_number:
            lsoa_counts[home["geography_id"]] = lsoa_counts.get(home["geography_id"], 0) + 1
        number_lsoa = max(sorted(lsoa_counts), key=lambda geography: lsoa_counts[geography])
    else:
        likely, neighbours = likely_postcode(number, numbered) if number is not None else (None, [])
        number_lsoa = None
    postcodes = number_postcodes + [pc for pc in sorted(counts, key=lambda pc: (-counts[pc], pc))
                                    if pc not in number_postcodes]
    return {"homes": homes, "postcodes": postcodes, "likely": likely, "neighbours": neighbours,
            "numberPostcodes": number_postcodes, "numberGeographyId": number_lsoa}


def _street_results(connection: Any, needle: str, limit: int) -> list[dict]:
    """Streets matching a typed address that has no recorded sale (empty before migration 042 loads)."""
    number, street = street_query(needle)
    if street is None or not list(connection.execute(STREET_TABLE_SQL))[0]["t"]:
        return []
    place = street_place(needle)

    def streets(where: str | None, count: int) -> list[Mapping[str, Any]]:
        wide = f"%{like_escape(where)}%" if where else None
        return list(connection.execute(
            STREET_SEARCH_SQL, (f"%{like_escape(street)}%", where, wide, wide, where, street, count)))

    rows = streets(place, min(limit, STREET_SEARCH_LIMIT))
    # A district is a hard fact: "Kings Grove, SE15" never falls through to Romford (#149).
    by_homes = place is not None and not rows and postcode_district(place) is None
    if by_homes:
        rows = streets(None, STREET_PLACE_FALLBACK)
    results, named = [], []
    for row in rows:
        found = street_candidates(connection, number, row["name"], row["borough_id"],
                                  row["postcode_district"])
        named.append(by_homes and any(place.lower() in home["display_address"].lower() for home in found["homes"]))
        number_postcodes = found["numberPostcodes"]
        postcodes, likely, neighbours = found["postcodes"][:STREET_POSTCODES], found["likely"], found["neighbours"]
        town = row["locality"] if row["locality"] and row["locality"] not in ("London", row["borough_name"]) else None
        label = f"{number} {row['name']}" if number is not None else row["name"]
        detail = [part for part in (town, row["borough_name"]) if part]
        if number is not None and number_postcodes:
            shown = number_postcodes[:3]
            more = f" and {len(number_postcodes) - 3} more" if len(number_postcodes) > 3 else ""
            detail.append(f"recorded homes at no. {number} in {', '.join(shown)}{more}")
        elif number is not None and neighbours == [number]:
            detail.append(f"recorded homes at no. {number} in {likely}")
        elif number is not None:
            detail.append(f"likely {likely}" if likely else "no recorded sale")
        geography_id, center = row["geography_id"], [row["center_lon"], row["center_lat"]]
        if number_postcodes and found["numberGeographyId"]:
            # The hit sits where its recorded homes are, not at the Open Names segment point.
            geography_id = found["numberGeographyId"]
            center_row = next(iter(connection.execute(LSOA_CENTER_SQL, (geography_id,))), None)
            if center_row and center_row["center_lon"] is not None:
                center = [center_row["center_lon"], center_row["center_lat"]]
        results.append({
            "geographyId": geography_id,
            "label": label,
            "secondaryLabel": " · ".join(detail),
            "uprn": None,
            "center": center,
            "street": {
                "name": row["name"], "number": number, "locality": town,
                "borough": row["borough_name"], "postcodeDistrict": row["postcode_district"],
                "likelyPostcode": likely, "neighbours": neighbours, "postcodes": postcodes,
                "numberPostcodes": number_postcodes,
            },
        })
    if any(named):
        results = [result for result, hit in zip(results, named) if hit]
    return results[:min(limit, STREET_SEARCH_LIMIT)]


def _load_address(connection: Any, address_id: str) -> Mapping[str, Any]:
    rows = list(connection.execute(ADDRESS_SQL, (address_id,)))
    if not rows:
        raise AddressNotFound(f"unknown address: {address_id}")
    return rows[0]


def _nearby_groups(connection: Any, address_id: str,
                   cancel: Callable[[], bool] | None) -> tuple[dict | None, dict | None, str | None]:
    """Building and street groups of an address (None when its sale has no key) and the sale release."""
    keys = next(iter(connection.execute(NEARBY_KEYS_SQL, (address_id,))), None) or {}
    building_key, street_key = keys.get("building_key"), keys.get("street_key")
    params = {"address_id": address_id, "years": NEARBY_WINDOW_YEARS,
              "median_min": NEARBY_MEDIAN_MIN, "limit": NEARBY_ROW_LIMIT}
    building = street = None
    if building_key:
        _check_cancelled(cancel)
        building = _nearby_group(connection.execute(NEARBY_BUILDING_SQL, {**params, "key": building_key}))
    if street_key:
        _check_cancelled(cancel)
        street = _nearby_group(connection.execute(
            NEARBY_STREET_SQL, {**params, "key": street_key, "building_key": building_key,
                                "postcode": keys.get("postcode")}))
    return building, street, keys.get("source_release_id")


def _nearby_payload(release_id: str, address_id: str, building: dict | None, street: dict | None) -> dict:
    return {
        "schemaVersion": "nearby-sales.v1",
        "productReleaseId": release_id,
        "addressId": address_id,
        "windowYears": NEARBY_WINDOW_YEARS,
        "building": building,
        "street": street,
        "disclaimer": NEARBY_DISCLAIMER,
    }


def _market_row(connection: Any, area_id: str) -> Mapping[str, Any] | None:
    from .market_depth import MARKET_SQL

    return next(iter(connection.execute(MARKET_SQL, (area_id,))), None)


def _source_releases(connection: Any, ids: list[str | None]) -> list[dict]:
    from .market_depth import SOURCE_RELEASES_SQL, source_rows

    wanted = sorted({source_id for source_id in ids if source_id})
    return source_rows(connection.execute(SOURCE_RELEASES_SQL, (wanted,))) if wanted else []


def _contains(connection: Any, area_id: str, lsoa_id: str) -> bool:
    """True when the LSOA is the area or lies inside it (LSOA -> MSOA -> borough)."""
    current: str | None = lsoa_id
    for _ in range(3):
        if current is None:
            return False
        if current == area_id:
            return True
        rows = list(connection.execute(GEOGRAPHY_SQL, (current,)))
        current = rows[0]["parent_id"] if rows else None
    return False


def _nearby_group(rows: Any) -> dict:
    """One summary row per group, joined to its newest sales (none -> one row with date NULL)."""
    rows = list(rows)
    summary = rows[0] if rows else {}
    median = summary.get("median_ppm")
    sample = int(summary.get("median_sample") or 0)
    flagged = [
        {"date": row["date"], "nominalPrice": row["price"],
         "propertyType": PROPERTY_TYPES.get(row["property_type"], "other"),
         "tenure": TENURES.get(row["tenure"], "unknown"), "newBuild": bool(row["new_build"]),
         "partShareLikely": bool(row.get("part_share_likely"))}
        for row in rows if row.get("date") is not None
    ]
    return {
        "saleCount": int(summary.get("sale_count") or 0),
        "excludedPartShare": int(summary.get("excluded_part_share") or 0),
        "sales": flagged,
        # Belt and braces: the SQL gate already withholds a median under the minimum.
        "medianPricePerSquareMetre": int(median) if median is not None and sample >= NEARBY_MEDIAN_MIN else None,
        "medianSampleSize": sample,
    }


def _breakdown_map(
    connection: Any, geography_id: str, metric_id: str, cancel: Callable[[], bool] | None,
) -> dict[str, dict[str, int]]:
    _check_cancelled(cancel)
    grouped: dict[str, dict[str, int]] = {}
    for row in list(connection.execute(BREAKDOWN_SQL, (geography_id, metric_id))):
        grouped.setdefault(row["period"], {})[row["category"]] = row["offence_count"]
    return grouped


def _pack_breakdown_map(
    connection: Any, metric_id: str, period: str, cancel: Callable[[], bool] | None, ids: list[str] | None = None,
) -> dict[str, dict[str, int]]:
    """Crime's per-category counts for the pack's areas (all when `ids` is None): a LAD's pack used to read
    England's whole breakdown, most of a cold crime pack's 6 s."""
    _check_cancelled(cancel)
    grouped: dict[str, dict[str, int]] = {}
    for row in list(connection.execute(PACK_BREAKDOWN_SQL, (metric_id, period, ids, ids))):
        grouped.setdefault(row["geography_id"], {})[row["category"]] = row["offence_count"]
    return grouped


def _percentile_meaning(percentile: Any, geography_id: str | None, region_map: Mapping[str, str] | None) -> str | None:
    """"90 = lower than 10% of London LSOAs": of the row's own region (decision 2: every percentile is computed
    within the area's region), London without a map or for an unknown area."""
    if percentile is None:
        return None
    scope = coverage.region_name((region_map or {}).get(geography_id or "")) or "London"
    return f"{percentile} = lower than {100 - percentile}% of {scope} LSOAs"


def _summary(
    geography: Mapping[str, Any], metric: Mapping[str, Any], period: str, row: dict | None,
    breakdown: dict[str, int] | None = None, region_map: Mapping[str, str] | None = None,
) -> dict:
    if row is None:
        return {
            "geographyId": geography["id"], "name": geography["name"],
            "metricId": metric["id"], "period": period, "value": None,
            "regionPercentile": None, "countryPercentile": None,
            "direction": metric.get("direction"), "percentileMeaning": None,
            "sampleCount": None, "quality": "suppressed",
            "sourceVersion": metric["source_release_id"], "carrier": metric["carrier"],
        }
    percentile = row["region_percentile"]
    summary = {
        "geographyId": row["geography_id"], "name": row["name"],
        "metricId": row["metric_id"], "period": row["period"], "value": row["value"],
        "regionPercentile": percentile,
        # Stored (migration 124); with CLOSE_KNIT_ENGLAND off the site is London's and the key stays null.
        "countryPercentile": row["country_percentile"] if feature_flags.england() else None,
        # London percentiles run 0 = lowest in London to 100 = highest: say what the number means
        # and which way the metric points, so "crime percentile 7" is unambiguous (#163).
        "direction": metric.get("direction"),
        "percentileMeaning": _percentile_meaning(percentile, row["geography_id"], region_map),
        "sampleCount": row["sample_count"], "quality": row["quality"],
        # Which area and sample a fallback row comes from (#163); null for observed rows.
        "carrierGeographyId": row.get("carrier_geography_id"),
        "carrierSampleCount": row.get("carrier_sample_count"),
        "sourceVersion": row["source_release_id"], "carrier": row["carrier"],
    }
    if row.get("area_count") is not None:
        # An on-the-fly median of LSOA values (#208): how many areas it used.
        summary["areaCount"] = row["area_count"]
    if row.get("carrier_geography_id") is not None:
        # A fallback projected from a wider area (#206): the value's real home.
        summary["carrierGeographyId"] = row["carrier_geography_id"]
        # Named by _carrier_rows or _stored_carrier_names; null when the id is unknown.
        summary["carrierName"] = row.get("carrier_name")
    if breakdown is not None:
        summary["breakdown"] = breakdown
    return summary


def _metric_definition(row: Mapping[str, Any]) -> dict:
    definition = row["definition"]
    static = definition if isinstance(definition, dict) else json.loads(definition)
    periods = sorted(row.get("periods") or [])
    return {
        "id": row["id"], "label": static["label"], "shortLabel": static["shortLabel"],
        "description": static["description"], "carrier": row["carrier"],
        "unit": row["unit"], "direction": row["direction"],
        "periods": periods, "defaultPeriod": periods[-1] if periods else "",
        "legend": static["legend"],
        "provenance": {
            "sourceId": static["sourceId"], "sourceName": static["sourceName"],
            "sourceUrl": row["source_url"], "release": row["source_release_id"],
            "checksum": row["checksum"], "licence": row["licence"],
            "attribution": row["attribution"],
            "transformationVersion": row["transformation_version"],
        },
        "freshness": static.get("freshness", row["source_release_id"]),
        "methodologyPath": static["methodologyPath"],
        "caveats": static.get("caveats", []),
        # The catalogue's flag: shown on the map and the area page, never ranked, filtered, weighted or matched.
        **({"descriptiveOnly": True} if is_descriptive_only(row["id"]) else {}),
        **({"coverage": _coverage(row["coverage"])} if row.get("coverage") is not None else {}),
    }


def _coverage(rows: Any) -> list[dict]:
    """The catalog's coverage: the share of each scope's areas with a value, for the scopes the call is served (with
    CLOSE_KNIT_ENGLAND off London's region alone: nothing is said about places outside it). A scope not listed has
    no value anywhere in it."""
    served = current_scope().regions
    shown = None if served is None else {f"uk:region:{code}" for code in served}
    return [{"scopeId": scope_id, "share": round(with_value / total, 3)}
            for scope_id, with_value, total in (json.loads(rows) if isinstance(rows, str) else rows)
            if shown is None or scope_id in shown]
