"""Unified places (migration 034): one table merging OSM, the FSA hygiene register, Overture and Foursquare.

Inputs are the loaded source tables: place_poi (OSM, ODbL), food_business (FHRS, OGL), overture_place
(CDLA-Permissive-2.0) and fsq_place (Apache-2.0, a dated 2025-02 snapshot). Every place is described in
OSM vocabulary (amenity/shop/leisure/tourism/sport/cuisine/craft/office/healthcare/brand plus name), so
the matchers of api/area_api/custom_criteria.py read it unchanged.

1. Taxonomy (places_taxonomy.json): each source's categories -> our category key and its OSM tags; FHRS
   business types and name hints (kebab, coffee, bakery...) refine coarse categories; known brands are
   recognised from names. Places of worship and religion are dropped, and halal/kosher never become a
   cuisine (the custom-criteria guardrail: places, never who lives in an area).
2. Conflation in PostGIS, source by source (OSM, then Overture, Foursquare, FHRS): a record joins a place
   within 40 m with a similar name (pg_trgm) or the same brand and a compatible category group; FHRS
   points (postcode-based geocodes) may join up to 80 m away on a near-identical name, or a place of
   another group (a club, hotel or community centre with a kitchen) within 40 m on such a name. Each place takes
   at most one record per source, best score first.
3. Confidence from source agreement: OSM 0.7, register 0.8, Overture 0.2 + 0.5 x its confidence,
   Foursquare 0.5 if refreshed in the two years before the snapshot else 0.25 (halved when the Overture
   record is itself from Foursquare), combined as 1 - prod(1 - p); a closure flag without a register
   match multiplies by 0.6. Foursquare places marked closed never stand alone.

The id is stable: the anchor record's source and id (osm:n123, ovt:<gers>, fsq:<id>, fhrs:<id>).

  uv run --with 'psycopg[binary]' python -m area_analytics.places_unified load postgresql://...
  uv run --with 'psycopg[binary]' python -m area_analytics.places_unified check postgresql://...

England (CLOSE_KNIT_ETL_COVERAGE=england, the default) builds from the loaders' work files instead of
their tables, one region at a time (see "a build from the source files" below):

  python -m area_analytics.places_unified build-files postgresql://... <out>/place-england.tsv.gz
  python -m area_analytics.places_unified load-files postgresql://... <out>/place-england.tsv.gz
  python -m area_analytics.places_unified check-files postgresql://... <out>/check.tsv.gz  # no releases

build-files registers the input and unified source releases and writes the places (specialty coffee
included) with a <out>/place-england.json of counts per source and region; load-files replaces the place
table with them. PLACES_TRIM_BELOW (default 0.6, 0 keeps all) drops places under that confidence outside
London.

load ends with places_specialty apply (specialty_score and cuisine "specialty_coffee", migration 039).
check writes per-borough food recall / precision against the register, counts per category per source
and a 50 kebab + 50 specialty-coffee sample to $AE_WORK (default ~/data/aework/places).
"""
from __future__ import annotations

import csv
import datetime
import gzip
import hashlib
import json
import os
import re
import sys
import unicodedata
import urllib.parse
from dataclasses import dataclass, field

from .places_load import assign_lsoa

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "places"))
TAXONOMY_PATH = os.path.join(os.path.dirname(__file__), "places_taxonomy.json")
ETL_VERSION = "close-knit-places-unified-1"
# The tag keys a criterion may test (custom_criteria.KEYS) plus the name; every other OSM tag is dropped.
KEYS = ("amenity", "shop", "leisure", "tourism", "sport", "cuisine", "healthcare", "craft", "office", "brand")
LIST_KEYS = ("cuisine", "sport")
SOURCES = ("osm", "overture", "fsq", "fhrs")  # conflation order and name / location priority
ID_PREFIX = {"osm": "osm", "overture": "ovt", "fsq": "fsq", "fhrs": "fhrs"}
NEAR_METRES, FHRS_METRES = 40, 80
NAME_MATCH, FHRS_FAR_NAME_MATCH, BRAND_SCORE = 0.5, 0.8, 0.7
PRIOR = {"osm": 0.7, "fhrs": 0.8}
FSQ_FRESH, FSQ_STALE, CLOSED_FACTOR = 0.5, 0.25, 0.6
GENERIC_FOR_BRAND = ("restaurant", "fast_food", "cafe", "shop")
STOPWORDS = {"the", "ltd", "limited", "plc", "llp", "uk", "london"}
ATTRIBUTION = ("© OpenStreetMap contributors (ODbL 1.0); Food hygiene ratings: Food Standards Agency "
               "(OGL v3.0); © Overture Maps Foundation (CDLA-Permissive-2.0); Foursquare Open Source "
               "Places (Apache License 2.0).")


# --- names ------------------------------------------------------------------------------------

def normalise_name(name: str | None) -> str:
    """Lower-case ASCII words: accents dropped, '&' read as 'and', apostrophes removed."""
    if not name:
        return ""
    text = unicodedata.normalize("NFKD", name)
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = text.replace("&", " and ").replace("'", "").replace("’", "").replace("`", "")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def match_name(norm: str) -> str:
    """The name compared across sources: the normalised name without filler words."""
    return " ".join(word for word in norm.split() if word not in STOPWORDS)


def cuisine_slug(text: str, aliases: dict, blocked) -> str | None:
    slug = re.sub(r"[^a-z0-9]+", "_", normalise_name(text)).strip("_")
    slug = aliases.get(slug, slug)
    return None if not slug or slug in blocked else slug


# --- taxonomy ---------------------------------------------------------------------------------

def _parse_tags(spec: str) -> dict[str, tuple[str, ...]]:
    tags = {}
    for part in spec.split(";"):
        key, values = part.split("=", 1)
        tags[key] = tuple(values.split("|"))
    return tags


def _has(tags: dict, key: str, values: tuple[str, ...]) -> bool:
    value = tags.get(key)
    if value is None:
        return False
    if key in LIST_KEYS:
        return bool({v.strip().lower() for v in str(value).split(";")} & set(values))
    return value in values


EXCLUDED = object()  # a mapping result: drop the record (worship, religion, vending, lockers...)


@dataclass
class Mapped:
    category: str
    group: str
    tags: dict
    brand: str | None = None


class Taxonomy:
    def __init__(self, data: dict) -> None:
        self.data = data
        self.tags: dict[str, dict[str, tuple[str, ...]]] = {}
        self.group: dict[str, str] = {}
        self.order: dict[str, int] = {}
        self.index: dict[tuple[str, str], list[str]] = {}
        for group, categories in data["categories"].items():
            for key, spec in categories.items():
                if key in self.tags:
                    raise ValueError(f"category {key} defined twice")
                self.tags[key], self.group[key], self.order[key] = _parse_tags(spec), group, len(self.order)
                first_key, first_values = next(iter(self.tags[key].items()))
                for value in first_values:
                    self.index.setdefault((first_key, value), []).append(key)
        self.generic = data["generic"]
        self.compatible = {frozenset(pair) for pair in data["compatible_groups"]}
        excluded = data["excluded"]
        self.excluded_tags = {(k, v) for k, values in excluded["osm_tags"].items() for v in values}
        self.excluded_overture = tuple(excluded["overture_substrings"])
        self.excluded_fsq = tuple(excluded["fsq_prefixes"])
        self.excluded_name = re.compile(excluded["name_pattern"])
        self.excluded_name_groups = set(excluded["name_groups"])
        self.blocked = set(data["blocked_cuisines"])
        self.confirm_only = set(data["confirm_only"])
        self.aliases = data["cuisine_aliases"]
        self.fsq_map = {(top + (" > " + rest if rest else "")): value
                        for top, mapping in data["fsq"].items() for rest, value in mapping.items()}
        self.hints = [dict(h, regex=re.compile(h["pattern"])) for h in data["name_hints"]]
        self.brands = [(name, re.compile(spec[0]), spec[1])
                       for name, spec in data["brands"].items() if not name.startswith("_")]
        self.brand_names = {name for name, _, _ in self.brands}

    @classmethod
    def load(cls, path: str = TAXONOMY_PATH) -> "Taxonomy":
        with open(path) as handle:
            return cls(json.load(handle))

    def canonical(self, category: str) -> dict[str, str]:
        return {key: values[0] for key, values in self.tags[category].items()}

    def compatible_groups(self, a: str, b: str) -> bool:
        return a == b or frozenset((a, b)) in self.compatible

    def is_excluded_tags(self, tags: dict) -> bool:
        return any((key, tags.get(key)) in self.excluded_tags for key in ("amenity", "shop", "office"))

    def resolve(self, tags: dict) -> str | None:
        """The most specific category whose tags the place carries (OSM vocabulary), else the generic
        key of a shop/office/craft/healthcare tag; None for anything else."""
        if self.is_excluded_tags(tags):
            return None
        best = None
        for key in KEYS:
            value = tags.get(key)
            if value is None:
                continue
            for candidate in self.index.get((key, value), ()):
                if all(_has(tags, k, v) for k, v in self.tags[candidate].items()):
                    rank = (len(self.tags[candidate]), -self.order[candidate])
                    if best is None or rank > best[0]:
                        best = (rank, candidate)
        if best:
            return best[1]
        for key, category in self.generic.items():
            if tags.get(key):
                return category
        return None

    def target(self, value) -> tuple[str, dict] | object | None:
        """'key' or 'key;cuisine=x' -> (category, extra tags); null -> EXCLUDED."""
        if value is None:
            return EXCLUDED
        category, *extras = value.split(";")
        extra = {}
        for part in extras:
            key, raw = part.split("=", 1)
            if key == "cuisine":
                raw = cuisine_slug(raw, self.aliases, self.blocked)
            if raw:
                extra[key] = raw
        if category not in self.tags:
            raise ValueError(f"unknown category {category!r}")
        return category, extra

    def _cuisine_target(self, stem: str):
        cuisine = cuisine_slug(stem, self.aliases, self.blocked)
        if cuisine == "kebab":
            return "kebab", {}
        return ("restaurant", {"cuisine": cuisine} if cuisine else {})

    def overture(self, category: str | None, alternates=None, basic: str | None = None):
        names = [c for c in [category, *(alternates or [])] if c]
        if any(s in c for c in names for s in self.excluded_overture):
            return EXCLUDED
        mapping = self.data["overture"]
        for name in names:
            if name in mapping:
                return self.target(mapping[name])
            for kind, affix, value in self.data["overture_rules"]:
                if kind == "suffix" and name.endswith(affix) and len(name) > len(affix):
                    stem = name[: -len(affix)]
                    if "{stem}" in value:
                        return self._cuisine_target(stem)
                    return self.target(value)
                if kind == "prefix" and name.startswith(affix):
                    return self.target(value)
        if basic and basic in self.data["overture_basic"]:
            return self.target(self.data["overture_basic"][basic])
        return None

    def fsq(self, labels) -> tuple[str, dict] | object | None:
        labels = [label for label in (labels or []) if label]
        if any(label.startswith(prefix) for label in labels for prefix in self.excluded_fsq):
            return EXCLUDED
        suffix, exact_only = self.data["fsq_cuisine_suffix"], set(self.data["fsq_exact_only"])
        for label in labels:
            path = label
            while path:
                if path in self.fsq_map:
                    return self.target(self.fsq_map[path])
                parent = path.rsplit(" > ", 1)[0] if " > " in path else ""
                if parent in exact_only:
                    return EXCLUDED
                leaf = path.rsplit(" > ", 1)[-1]
                if path.startswith("Dining and Drinking > Restaurant > ") and leaf.endswith(suffix):
                    return self._cuisine_target(leaf[: -len(suffix)])
                path = parent
        return None

    def fhrs(self, business_type: str | None):
        entry = self.data["fhrs"].get(business_type or "")
        return (entry["category"], entry["standalone"]) if entry else None

    def apply_hints(self, category: str, tags: dict, norm: str, osm: bool) -> tuple[str, dict]:
        """Name hints in order: category hints (never for OSM), then a cuisine when the place has none."""
        tags = dict(tags)
        for hint in self.hints:
            if category not in hint["applies_to"] or not hint["regex"].search(norm):
                continue
            if hint.get("category") and not osm:
                category = hint["category"]
                tags = {**self.canonical(category), **{k: v for k, v in tags.items() if k in ("name", "brand")}}
            if hint.get("cuisine") and "cuisine" not in tags:
                tags["cuisine"] = hint["cuisine"]
            if osm:
                category = self.resolve(tags) or category
        return category, tags

    def brand(self, norm: str) -> tuple[str, str | None] | None:
        for name, regex, category in self.brands:
            if regex.search(norm):
                return name, category
        return None

    def build(self, category: str, extra: dict, name: str | None, norm: str, osm_tags: dict | None = None,
              brand: str | None = None):
        """The final (Mapped | EXCLUDED) for a record: hints, brand, the name guardrail."""
        osm = osm_tags is not None
        if osm:
            tags = {k: str(osm_tags[k]) for k in KEYS if osm_tags.get(k) is not None}
        else:
            tags = {**self.canonical(category), **extra}
        if name:
            tags["name"] = name
        category, tags = self.apply_hints(category, tags, norm, osm)
        group = self.group[category]
        found = self.brand(normalise_name(brand)) if brand else None
        found = found or self.brand(norm)
        if found:
            brand_name, brand_category = found
            if brand_category is None:
                return EXCLUDED  # e.g. Costa Express coffee machines
            generic = not osm and category in GENERIC_FOR_BRAND  # e.g. a register "retailer" named Greggs
            if generic or self.compatible_groups(group, self.group[brand_category]):
                tags.setdefault("brand", brand_name)
                if generic:
                    category = brand_category
                    tags = {**self.canonical(category), **{k: v for k, v in tags.items()
                                                          if k in ("name", "brand", "cuisine")}}
        elif brand and not osm:
            tags.setdefault("brand", brand)
        category = self.resolve(tags) or category
        group = self.group[category]
        if group in self.excluded_name_groups and self.excluded_name.search(norm):
            return EXCLUDED
        return Mapped(category, group, tags, tags.get("brand"))


# --- per-source candidates --------------------------------------------------------------------

@dataclass
class Candidate:
    source: str
    source_id: str
    name: str | None
    category: str
    group: str
    tags: dict
    brand: str | None
    p: float
    lon: float
    lat: float
    closed: bool = False
    standalone: bool = True
    rating: str | None = None
    from_fsq: bool = False  # an Overture record whose upstream is Foursquare

    @property
    def match_name(self) -> str:
        return match_name(normalise_name(self.name))


def osm_candidate(tax: Taxonomy, osm_id: str, tags: dict, lon: float, lat: float) -> Candidate | None:
    category = tax.resolve(tags)
    if category is None:
        return None
    name = tags.get("name")
    mapped = tax.build(category, {}, name, normalise_name(name), osm_tags=tags, brand=tags.get("brand"))
    if mapped is EXCLUDED:
        return None
    return Candidate("osm", osm_id, name, mapped.category, mapped.group, mapped.tags, mapped.brand,
                     PRIOR["osm"], lon, lat)


def overture_candidate(tax: Taxonomy, record: dict) -> Candidate | None:
    found = tax.overture(record.get("category"), record.get("alternate_categories"), record.get("basic_category"))
    if found is None or found is EXCLUDED:
        return None
    name = record.get("name")
    mapped = tax.build(*found, name, normalise_name(name), brand=record.get("brand"))
    if mapped is EXCLUDED:
        return None
    closed = record.get("operating_status") == "permanently_closed"
    confidence = record.get("confidence") or 0.0
    return Candidate("overture", record["id"], name, mapped.category, mapped.group, mapped.tags, mapped.brand,
                     0.0 if closed else round(0.2 + 0.5 * confidence, 4), record["lon"], record["lat"],
                     closed=closed, standalone=not closed and mapped.category not in tax.confirm_only,
                     from_fsq="Foursquare" in (record.get("datasets") or []))


def fsq_candidate(tax: Taxonomy, record: dict, fresh_since: str) -> Candidate | None:
    found = tax.fsq(record.get("category_labels"))
    if found is None or found is EXCLUDED:
        return None
    name = record.get("name")
    mapped = tax.build(*found, name, normalise_name(name))
    if mapped is EXCLUDED:
        return None
    closed = record.get("date_closed") is not None
    refreshed = str(record.get("date_refreshed") or "")
    p = 0.0 if closed else (FSQ_FRESH if refreshed >= fresh_since else FSQ_STALE)
    return Candidate("fsq", record["fsq_place_id"], name, mapped.category, mapped.group, mapped.tags, mapped.brand,
                     p, record["lon"], record["lat"], closed=closed,
                     standalone=not closed and mapped.category not in tax.confirm_only)


def fhrs_candidate(tax: Taxonomy, record: dict) -> Candidate | None:
    found = tax.fhrs(record.get("business_type"))
    if found is None:
        return None
    category, standalone = found
    name = record.get("name")
    if tax.excluded_name.search(normalise_name(name)):
        return None  # register kitchens of churches, temples, mosques... (whatever their business type)
    mapped = tax.build(category, {}, name, normalise_name(name))
    if mapped is EXCLUDED:
        return None
    return Candidate("fhrs", str(record["fhrs_id"]), name, mapped.category, mapped.group, mapped.tags, mapped.brand,
                     PRIOR["fhrs"], record["lon"], record["lat"], standalone=standalone, rating=record.get("rating"))


# --- merging a conflated place ----------------------------------------------------------------

def confidence(members: list[Candidate]) -> float:
    """1 - prod(1 - p) over the member records, with Foursquare discounted when an Overture member
    already carries Foursquare data, and a closure flag (without a register match) as a penalty."""
    overture_from_fsq = any(m.source == "overture" and m.from_fsq for m in members)
    miss = 1.0
    for member in members:
        p = member.p * (0.5 if member.source == "fsq" and overture_from_fsq else 1.0)
        miss *= 1.0 - p
    value = 1.0 - miss
    if any(m.closed for m in members) and not any(m.source == "fhrs" for m in members):
        value *= CLOSED_FACTOR
    return round(min(max(value, 0.01), 0.99), 3)


def merge(tax: Taxonomy, members: list[Candidate]) -> dict:
    """One place row from its member records (at most one per source)."""
    members = sorted(members, key=lambda m: SOURCES.index(m.source))
    primary = members[0]
    tags = dict(primary.tags)
    name = next((m.name for m in members if m.name), None)
    if name:
        tags["name"] = name
    for member in members[1:]:
        if "cuisine" not in tags and "cuisine" in member.tags and tax.compatible_groups(primary.group, member.group):
            tags["cuisine"] = member.tags["cuisine"]
        if "brand" not in tags and member.brand and tax.compatible_groups(primary.group, member.group):
            tags["brand"] = member.brand
    category = tax.resolve(tags) or primary.category
    ids = {m.source: m.source_id for m in members}
    rating = next((m.rating for m in members if m.source == "fhrs"), None)
    return {"id": f"{ID_PREFIX[primary.source]}:{primary.source_id}", "name": name, "category": category,
            "tags": tags, "confidence": confidence(members), "sources": [m.source for m in members],
            "osm_id": ids.get("osm"), "fhrs_id": int(ids["fhrs"]) if "fhrs" in ids else None,
            "overture_id": ids.get("overture"), "fsq_id": ids.get("fsq"), "hygiene_rating": rating,
            "location": f"SRID=4326;POINT({primary.lon} {primary.lat})"}


# --- database ---------------------------------------------------------------------------------

CAND_COLUMNS = ("source", "source_id", "name", "match_name", "brand", "category", "grp", "tags", "p", "closed",
                "standalone", "rating", "from_fsq", "lon", "lat")
PLACE_COLUMNS = ("id", "name", "category", "tags", "confidence", "sources", "osm_id", "fhrs_id", "overture_id",
                 "fsq_id", "hygiene_rating", "location")

CANDIDATE_TABLE_SQL = """CREATE UNLOGGED TABLE place_cand (
  cid serial PRIMARY KEY, source text, source_id text, name text, match_name text, brand text, category text,
  grp text, tags jsonb, p real, closed boolean, standalone boolean, rating text, from_fsq boolean,
  lon float8, lat float8, cluster int, pt geometry(Point, 27700))"""

# A record of source %(s)s against every place built so far within reach: name similarity (pg_trgm on the
# match names, whole-word containment for names of 4+ letters) or the same brand, a compatible group. A
# register record may also join a place of another group on a near-identical name within 40 m (the
# kitchen of a golf club, a community centre or a hotel), scored a little lower.
PAIRS_SQL = """INSERT INTO place_pairs
SELECT c.cid, m.cluster, max(CASE WHEN c.brand IS NOT NULL AND c.brand = m.brand THEN greatest(x.ns, %(brand)s)
                                  ELSE x.ns END - 0.25 * x.d / %(near)s - CASE WHEN g.a IS NULL THEN 0.1 ELSE 0 END)
FROM place_cand c
JOIN place_cand m ON m.cluster IS NOT NULL AND ST_DWithin(c.pt, m.pt, %(far)s)
LEFT JOIN place_compat g ON g.a = c.grp AND g.b = m.grp
CROSS JOIN LATERAL (
  SELECT ST_Distance(c.pt, m.pt) AS d,
         CASE WHEN c.match_name = '' OR m.match_name = '' THEN 0
              ELSE greatest(similarity(c.match_name, m.match_name),
                            CASE WHEN least(length(c.match_name), length(m.match_name)) >= 4
                                 THEN 0.9 * greatest(strict_word_similarity(c.match_name, m.match_name),
                                                     strict_word_similarity(m.match_name, c.match_name))
                                 ELSE 0 END) END AS ns) x
WHERE c.source = %(s)s AND c.cluster IS NULL
  AND ((g.a IS NOT NULL AND ((x.d <= %(near)s AND (x.ns >= %(name)s OR (c.brand IS NOT NULL AND c.brand = m.brand)))
                              OR (x.d <= %(far)s AND x.ns >= %(far_name)s AND c.brand IS NULL)))
       OR (%(s)s = 'fhrs' AND x.d <= %(near)s AND x.ns >= %(far_name)s))
GROUP BY c.cid, m.cluster"""

# One-to-one: each record its best place, each place its best record among those; repeated after pruning.
RESOLVE_SQL = """WITH best AS (SELECT DISTINCT ON (cid) cid, cluster, score FROM place_pairs
                               ORDER BY cid, score DESC, cluster),
win AS (SELECT DISTINCT ON (cluster) cid, cluster FROM best ORDER BY cluster, score DESC, cid)
UPDATE place_cand c SET cluster = win.cluster FROM win WHERE c.cid = win.cid"""

PRUNE_SQL = ("DELETE FROM place_pairs p USING place_cand c WHERE p.cid = c.cid AND c.cluster IS NOT NULL",
             "DELETE FROM place_pairs p USING place_cand c WHERE c.source = %(s)s AND c.cluster IS NOT NULL "
             "AND p.cluster = c.cluster")
WORK_TABLES = "place_cand, place_pairs, place_compat, place_stage"


def _rows(conn, sql: str, params=None):
    with conn.cursor(name=f"read_{abs(hash(sql)) % 10**8}") as cur:
        cur.itersize = 20_000
        cur.execute(sql, params)
        cols = [d.name for d in cur.description]
        for row in cur:
            yield dict(zip(cols, row))


def candidates(conn, tax: Taxonomy, stats: dict):
    """Every mapped record of the four source tables, counting what was dropped."""
    fresh_since = conn.execute("SELECT (max(date_refreshed) - interval '2 years')::date::text FROM fsq_place").fetchone()[0]
    stats["fsq_fresh_since"] = fresh_since
    readers = {
        "osm": ("SELECT id, tags, ST_X(location) AS lon, ST_Y(location) AS lat FROM place_poi",
                lambda r: osm_candidate(tax, r["id"], r["tags"], r["lon"], r["lat"])),
        "overture": ("SELECT id, name, category, alternate_categories, basic_category, brand, confidence, "
                     "operating_status, datasets, ST_X(location) AS lon, ST_Y(location) AS lat FROM overture_place",
                     lambda r: overture_candidate(tax, r)),
        "fsq": ("SELECT fsq_place_id, name, category_labels, date_refreshed, date_closed, "
                "ST_X(location) AS lon, ST_Y(location) AS lat FROM fsq_place",
                lambda r: fsq_candidate(tax, r, fresh_since)),
        "fhrs": ("SELECT fhrs_id, name, business_type, rating, ST_X(location) AS lon, ST_Y(location) AS lat "
                 "FROM food_business WHERE location IS NOT NULL", lambda r: fhrs_candidate(tax, r)),
    }
    for source, (sql, mapper) in readers.items():
        kept = dropped = 0
        for record in _rows(conn, sql):
            candidate = mapper(record)
            if candidate is None:
                dropped += 1
                continue
            kept += 1
            yield candidate
        stats[f"{source}_kept"], stats[f"{source}_dropped"] = kept, dropped
        print(f"candidates: {source} {kept} kept, {dropped} dropped (unmapped, excluded or no premises)")


def conflate(conn, tax: Taxonomy) -> dict:
    """Assign every candidate to a place (cand.cluster = the anchor's cid), source by source."""
    stats = {}
    conn.execute("CREATE UNLOGGED TABLE place_compat (a text, b text)")
    groups = sorted(set(tax.group.values()))
    with conn.cursor().copy("COPY place_compat (a, b) FROM STDIN") as copy:
        for a in groups:
            for b in groups:
                if tax.compatible_groups(a, b):
                    copy.write_row((a, b))
    conn.execute("CREATE UNLOGGED TABLE place_pairs (cid int, cluster int, score float8)")
    conn.execute("UPDATE place_cand SET cluster = cid WHERE source = 'osm'")
    for source in SOURCES[1:]:
        conn.execute("TRUNCATE place_pairs")
        far = FHRS_METRES if source == "fhrs" else NEAR_METRES
        conn.execute(PAIRS_SQL, {"s": source, "near": NEAR_METRES, "far": far, "name": NAME_MATCH,
                                 "far_name": FHRS_FAR_NAME_MATCH, "brand": BRAND_SCORE})
        matched = 0
        for _ in range(5):
            count = conn.execute(RESOLVE_SQL).rowcount
            matched += count
            if not count:
                break
            for sql in PRUNE_SQL:
                conn.execute(sql, {"s": source})
        new = conn.execute("UPDATE place_cand SET cluster = cid WHERE source = %s AND cluster IS NULL AND standalone",
                           (source,)).rowcount
        stats[f"{source}_matched"], stats[f"{source}_new"] = matched, new
        print(f"conflate: {source} {matched} joined an existing place, {new} new places")
    return stats


def inputs_sha256(release_ids: list[str], taxonomy_path: str = TAXONOMY_PATH) -> str:
    """Fingerprint of a build: the taxonomy, this loader, the input source releases and the ETL version."""
    digest = hashlib.sha256()
    for path in (taxonomy_path, __file__, os.path.join(os.path.dirname(__file__), "places_specialty.py")):
        with open(path, "rb") as handle:
            digest.update(handle.read())
    digest.update("\n".join(sorted(release_ids) + [ETL_VERSION]).encode())
    return digest.hexdigest()


def source_release(stats: dict, built: str, inputs: list[str], sha: str) -> tuple:
    """(id, url, release_date, licence, attribution, caveats) of a unified build. Source releases are
    immutable, so the id carries the build fingerprint: a rebuild with other inputs or code is a new release."""
    caveats = [
        "Built from OpenStreetMap, the FSA food hygiene register, Overture Maps and a dated Foursquare "
        "snapshot (2025-02): a place on one source only can be closed, misplaced or miscategorised; use "
        "confidence (source agreement) to filter.",
        "Records are matched within 40 m on a similar name or the same brand and a compatible category "
        "(register points up to 80 m on a near-identical name); chains next door to each other and renamed "
        "businesses can be merged or split wrongly.",
        "Contains OpenStreetMap data: the table is a derivative database under ODbL 1.0 (share-alike) "
        "if published as a database.",
        "Places of worship and religion are never stored; halal and kosher are not used as cuisines.",
        f"Inputs: {', '.join(sorted(inputs))}. Records kept per source: OSM {stats.get('osm_kept')}, "
        f"Overture {stats.get('overture_kept')}, Foursquare {stats.get('fsq_kept')}, FHRS {stats.get('fhrs_kept')}.",
    ]
    return (f"src-places-unified-{built}-{sha[:8]}", "derived:place_poi+food_business+overture_place+fsq_place", built,
            "ODbL-1.0", ATTRIBUTION, caveats)


INPUT_RELEASES_SQL = """SELECT DISTINCT source_release_id FROM place_poi UNION SELECT DISTINCT source_release_id
FROM food_business UNION SELECT DISTINCT source_release_id FROM overture_place
UNION SELECT DISTINCT source_release_id FROM fsq_place"""


def load(url: str) -> None:
    """Map, conflate and replace the place table. Work tables are unlogged and dropped afterwards; a
    second connection streams the inputs while the first copies."""
    import psycopg

    from area_analytics import places_specialty

    tax = Taxonomy.load()
    built = datetime.date.today().isoformat()
    with psycopg.connect(url, autocommit=True) as conn, psycopg.connect(url) as reader:
        conn.execute(f"DROP TABLE IF EXISTS {WORK_TABLES}")
        conn.execute(CANDIDATE_TABLE_SQL)
        inputs = [row[0] for row in conn.execute(INPUT_RELEASES_SQL) if row[0]]
        sha = inputs_sha256(inputs)
        stats: dict = {}
        with conn.cursor().copy(f"COPY place_cand ({', '.join(CAND_COLUMNS)}) FROM STDIN") as copy:
            for c in candidates(reader, tax, stats):
                copy.write_row((c.source, c.source_id, c.name, c.match_name, c.brand, c.category, c.group,
                                json.dumps(c.tags, ensure_ascii=False), c.p, c.closed, c.standalone, c.rating,
                                c.from_fsq, c.lon, c.lat))
        reader.commit()
        conn.execute("UPDATE place_cand SET pt = ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 27700)")
        conn.execute("CREATE INDEX ON place_cand USING gist (pt)")
        conn.execute("CREATE INDEX ON place_cand (cluster)")
        conn.execute("ANALYZE place_cand")
        stats.update(conflate(conn, tax))
        source_id, source_url, released, licence, attribution, caveats = source_release(stats, built, inputs, sha)
        conn.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
                 transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (source_id, source_url, released, sha, licence, attribution, ETL_VERSION, caveats))
        conn.execute("CREATE UNLOGGED TABLE place_stage (LIKE place INCLUDING DEFAULTS)")
        places = 0
        sql = f"SELECT cluster, {', '.join(CAND_COLUMNS)} FROM place_cand WHERE cluster IS NOT NULL ORDER BY cluster"
        with conn.cursor().copy(f"COPY place_stage ({', '.join(PLACE_COLUMNS)}, source_release_id) FROM STDIN") as copy:
            members: list[Candidate] = []
            current = None
            for row in _rows(reader, sql):
                if row["cluster"] != current and members:
                    copy.write_row(_place_values(merge(tax, members), source_id))
                    places += 1
                    members = []
                current = row["cluster"]
                members.append(Candidate(row["source"], row["source_id"], row["name"], row["category"], row["grp"],
                                         row["tags"], row["brand"], row["p"], row["lon"], row["lat"],
                                         row["closed"], row["standalone"], row["rating"], row["from_fsq"]))
            if members:
                copy.write_row(_place_values(merge(tax, members), source_id))
                places += 1
        reader.commit()
        assign_lsoa(conn, "place_stage")  # before the swap: place never goes without its LSOAs
        with conn.transaction():
            conn.execute("DELETE FROM place")
            conn.execute("INSERT INTO place SELECT * FROM place_stage")
        conn.execute(f"DROP TABLE IF EXISTS {WORK_TABLES}")
        stats["specialty"] = places_specialty.apply(url)
        conn.execute("ANALYZE place")
        stats["places"] = places
        os.makedirs(WORK, exist_ok=True)
        with open(os.path.join(WORK, "unified-load.json"), "w") as handle:
            json.dump({"release": source_id, "inputs": sorted(inputs), **stats}, handle, indent=1)
        print(f"load: {places} places as {source_id}")


def _place_values(row: dict, source_id: str) -> tuple:
    return (*[json.dumps(row[c], ensure_ascii=False) if c == "tags" else row[c] for c in PLACE_COLUMNS], source_id)


# --- a build from the source files, region by region (England) ---------------------------------
#
# England's source tables would take ~5 GB of the ETL database (Foursquare alone ~2 GB) and one
# conflation over every English record another ~3 GB of work tables. A files build reads the four
# loaders' work files instead (the OSM POI export and the Overture, Foursquare and FHRS TSVs), maps each
# record once, puts it in its region (the LSOA under its point, area_region of migration 103) and
# conflates one region at a time: conflation only joins records within 80 m, so a region is a closed
# world except along its edge (a place astride a regional boundary can stay two). The specialty-coffee
# score is computed in the same pass from each place's member records (the signals places_specialty
# reads from the source tables in a database build), and the place table is replaced in one COPY.
# Every reader of `place` but the downloads file filters confidence >= 0.6 (tiles, labels, custom
# criteria, supermarket walk, universities): outside London only those places are kept (`--trim`),
# London keeps every place as before.

FILES_TRIM_BELOW = 0.6
CAND_FILE_COLUMNS = CAND_COLUMNS + ("signals",)
STAGE_COLUMNS = PLACE_COLUMNS + ("source_release_id", "specialty_score", "lsoa_id")
REGION_SQL = """SELECT t.i, coalesce(
  (SELECT r.region_code FROM area_geography g JOIN area_region r ON r.area_id = g.id
   WHERE g.kind = 'lsoa' AND ST_Intersects(g.geometry, t.pt) LIMIT 1),
  (SELECT r.region_code FROM area_geography g JOIN area_region r ON r.area_id = g.id
   WHERE g.kind = 'lsoa' AND ST_DWithin(g.geometry, t.pt, 0.002) ORDER BY g.geometry <-> t.pt LIMIT 1))
FROM (SELECT i, ST_SetSRID(ST_MakePoint(x, y), 4326) AS pt
      FROM unnest(%s::float8[], %s::float8[]) WITH ORDINALITY AS u(x, y, i)) t"""


def default_inputs(scope) -> dict[str, str]:
    """The four work files of a coverage's loaders (England: ~/data/england-2026-10/places/work)."""
    from . import workfiles
    if scope.name == "london":
        aework = os.path.join(DATA, "aework")
        return {"osm": os.path.join(aework, "places", "poi.geojsonseq"),
                "overture": os.path.join(aework, "overture", "overture_place.tsv"),
                "fsq": os.path.join(aework, "fsq", "2026-09-15", "fsq_place.tsv"),
                "fhrs": os.path.join(aework, "fhrs", "food_business.tsv")}
    work = os.path.join(DATA, "england-2026-10", "places", "work")
    return {"osm": workfiles.name(os.path.join(work, "osm"), "poi.geojsonseq", scope),
            "overture": workfiles.name(os.path.join(work, "overture"), "overture_place.tsv", scope),
            "fsq": workfiles.name(os.path.join(work, "fsq"), "fsq_place.tsv", scope),
            "fhrs": workfiles.name(os.path.join(work, "fhrs"), "food_business.tsv", scope)}


def copy_unescape(text: str) -> str | None:
    """One COPY text field of the loaders' TSVs (NULL is the empty string)."""
    if text == "":
        return None
    if "\\" not in text:
        return text
    out, i = [], 0
    while i < len(text):
        if text[i] == "\\" and i + 1 < len(text):
            out.append({"t": "\t", "n": "\n", "r": "\r"}.get(text[i + 1], text[i + 1]))
            i += 2
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def pg_array(text: str | None) -> list | None:
    """A text[] literal as the loaders write it ({"a","b"}, NULL unquoted) -> list."""
    if text is None:
        return None
    items, i, end = [], 1, len(text) - 1
    while i < end:
        if text[i] == '"':
            j, buf = i + 1, []
            while text[j] != '"':
                if text[j] == "\\":
                    buf.append(text[j + 1])
                    j += 2
                else:
                    buf.append(text[j])
                    j += 1
            items.append("".join(buf))
            i = j + 1
        else:
            j = text.find(",", i)
            j = end if j == -1 else j
            token = text[i:j]
            items.append(None if token == "NULL" else token)
            i = j
        if i < end and text[i] == ",":
            i += 1
    return items


def _point(location: str) -> tuple[float, float]:
    lon, lat = location[location.index("(") + 1:location.rindex(")")].split()
    return float(lon), float(lat)


def tsv_records(path: str, columns: tuple[str, ...]):
    """Dicts of a loader TSV (one row per line, the table's columns), location split into lon/lat."""
    from . import workfiles
    older = tuple(c for c in columns if c != "website")  # Overture TSVs from before the agent directory (051)
    with workfiles.open_text(path) as handle:
        for line in handle:
            values = line.rstrip("\n").split("\t")
            names = older if len(values) == len(older) and len(older) < len(columns) else columns
            record = dict(zip(names, (copy_unescape(v) for v in values)))
            record["lon"], record["lat"] = _point(record.pop("location"))
            yield record


def file_records(inputs: dict[str, str]):
    """(source, record) of the four sources in conflation order, shaped as the database readers' rows."""
    from . import food_hygiene, fsq_places, overture_places
    from .places import poi
    from .places_load import read_features

    seen: set[str] = set()
    for feature in read_features(inputs["osm"]):
        found = poi(feature)
        if found is None or found[0] in seen:
            continue  # place_poi keeps the first copy of an OSM object
        seen.add(found[0])
        yield "osm", {"id": found[0], "tags": found[1], "lon": found[2], "lat": found[3]}
    seen.clear()
    for record in tsv_records(inputs["overture"], overture_places.COLUMNS):
        for key in ("alternate_categories", "datasets"):
            record[key] = pg_array(record[key])
        record["confidence"] = float(record["confidence"]) if record["confidence"] is not None else None
        yield "overture", record
    for record in tsv_records(inputs["fsq"], fsq_places.COLUMNS):
        record["category_labels"] = pg_array(record["category_labels"])
        yield "fsq", record
    for record in tsv_records(inputs["fhrs"], food_hygiene.COLUMNS):
        record["fhrs_id"] = int(record["fhrs_id"])
        yield "fhrs", record


def file_candidate(tax: Taxonomy, source: str, record: dict, fresh_since: str) -> tuple[Candidate, dict] | None:
    """A record's candidate and the signals places_specialty reads from its source table."""
    if source == "osm":
        candidate = osm_candidate(tax, record["id"], record["tags"], record["lon"], record["lat"])
        signals = {"osm_tags": record["tags"]}
    elif source == "overture":
        candidate = overture_candidate(tax, record)
        signals = {"ov_cat": record.get("category"), "ov_alt": record.get("alternate_categories"),
                   "ov_brand": record.get("brand"), "ov_from_fsq": "Foursquare" in (record.get("datasets") or [])}
    elif source == "fsq":
        candidate = fsq_candidate(tax, record, fresh_since)
        refreshed = record.get("date_refreshed")
        signals = {"fsq_labels": record.get("category_labels"), "fsq_closed": record.get("date_closed") is not None,
                   "fsq_stale": refreshed is not None and str(refreshed) < fresh_since}
    else:
        candidate = fhrs_candidate(tax, record)
        signals = {}
    return None if candidate is None else (candidate, signals)


def fsq_fresh_since(inputs: dict[str, str]) -> str:
    """Two years before the Foursquare snapshot's latest refresh (sources.json next to the TSV), as
    `max(date_refreshed) - interval '2 years'` in a database build."""
    with open(os.path.join(os.path.dirname(inputs["fsq"]), "sources.json")) as handle:
        latest = datetime.date.fromisoformat(json.load(handle)["latest_refresh"])
    try:
        return latest.replace(year=latest.year - 2).isoformat()
    except ValueError:  # 29 February
        return latest.replace(year=latest.year - 2, day=28).isoformat()


def _copy_field(value) -> str:
    if value is None:
        return "\\N"
    if isinstance(value, bool):
        value = "t" if value else "f"
    elif isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)
    text = str(value)
    return text.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def copy_line(values) -> str:
    return "\t".join(_copy_field(v) for v in values) + "\n"


def partition(conn, tax: Taxonomy, inputs: dict[str, str], folder: str, regions: frozenset[str],
              stats: dict, batch_size: int = 20_000) -> dict[str, str]:
    """Map every record and write it to its region's candidate file (COPY text, gzipped); records
    outside the coverage's regions are dropped. Returns {region code: file}."""
    from . import workfiles
    fresh_since = fsq_fresh_since(inputs)
    stats["fsq_fresh_since"] = fresh_since
    paths = {region: os.path.join(folder, f"cand-{region}.tsv.gz") for region in sorted(regions)}
    handles = {region: workfiles.open_text(path, "w") for region, path in paths.items()}
    counts = {f"{s}_{k}": 0 for s in SOURCES for k in ("kept", "dropped", "outside")}
    batch: list[tuple[Candidate, dict]] = []

    def flush() -> None:
        found = dict(conn.execute(REGION_SQL, ([c.lon for c, _ in batch], [c.lat for c, _ in batch])).fetchall())
        for i, (c, signals) in enumerate(batch, start=1):
            region = found.get(i)
            if region not in handles:
                counts[f"{c.source}_kept"] -= 1
                counts[f"{c.source}_outside"] += 1
                continue
            handles[region].write(copy_line((c.source, c.source_id, c.name, c.match_name, c.brand, c.category,
                                             c.group, c.tags, c.p, c.closed, c.standalone, c.rating, c.from_fsq,
                                             c.lon, c.lat, signals or None)))
        batch.clear()

    try:
        for source, record in file_records(inputs):
            mapped = file_candidate(tax, source, record, fresh_since)
            if mapped is None:
                counts[f"{source}_dropped"] += 1
                continue
            counts[f"{source}_kept"] += 1
            batch.append(mapped)
            if len(batch) >= batch_size:
                flush()
        if batch:
            flush()
    finally:
        for handle in handles.values():
            handle.close()
    stats.update(counts)
    for source in SOURCES:
        print(f"candidates: {source} {counts[source + '_kept']} kept, {counts[source + '_dropped']} dropped "
              f"(unmapped, excluded or no premises), {counts[source + '_outside']} outside the coverage")
    return paths


def specialty(place: dict, signals: dict, fresh_since: str) -> dict:
    """places_specialty.apply for one merged place: specialty_score and the cuisine tag."""
    from . import places_specialty as sp
    tags = place["tags"]
    place["specialty_score"] = None
    if not (place["category"] in sp.CANDIDATE_CATEGORIES or "coffee" in (tags.get("cuisine") or "")
            or tags.get("shop") == "coffee"):
        return place
    s = sp.Signals(name=place["name"], brand=tags.get("brand"), osm_tags=signals.get("osm_tags"),
                   overture_category=signals.get("ov_cat"), overture_alternates=tuple(signals.get("ov_alt") or ()),
                   overture_brand=signals.get("ov_brand"), overture_from_fsq=bool(signals.get("ov_from_fsq")),
                   fsq_labels=tuple(signals.get("fsq_labels") or ()), fsq_closed=bool(signals.get("fsq_closed")),
                   fsq_stale=bool(signals.get("fsq_stale")), sources=tuple(place["sources"] or ()))
    score, _ = sp.score(s)
    place["specialty_score"] = score
    cuisine = sp.with_tag(tags.get("cuisine"), score is not None and score >= sp.THRESHOLD)
    if cuisine is None:
        tags.pop("cuisine", None)
    else:
        tags["cuisine"] = cuisine
    return place


def build_region(conn, reader, tax: Taxonomy, region: str, path: str, source_id: str, fresh_since: str,
                 trim_below: float, out, stats: dict) -> int:
    """Conflate one region's candidate file and append its places (with LSOAs) to `out` (COPY text)."""
    from . import coverage, workfiles
    conn.execute(f"DROP TABLE IF EXISTS {WORK_TABLES}, place_cand_load")
    conn.execute(CANDIDATE_TABLE_SQL)
    conn.execute("ALTER TABLE place_cand ADD COLUMN signals jsonb")
    # The points are computed on the way in, not by an UPDATE: an UPDATE leaves HOT chains, an index built
    # over them is marked check-xmin and no query can use it while any other session keeps an older
    # transaction open (the shared ETL database always has one), so every pairs query scanned the table.
    conn.execute(f"CREATE UNLOGGED TABLE place_cand_load AS SELECT {', '.join(CAND_FILE_COLUMNS)} "
                 "FROM place_cand WITH NO DATA")
    with conn.cursor().copy(f"COPY place_cand_load ({', '.join(CAND_FILE_COLUMNS)}) FROM STDIN") as copy, \
            workfiles.open_text(path) as handle:
        for block in iter(lambda: handle.read(1 << 20), ""):
            copy.write(block)
    conn.execute(f"INSERT INTO place_cand ({', '.join(CAND_FILE_COLUMNS)}, pt) SELECT {', '.join(CAND_FILE_COLUMNS)}, "
                 "ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 27700) FROM place_cand_load")
    conn.execute("DROP TABLE place_cand_load")
    conn.execute("CREATE INDEX ON place_cand USING gist (pt)")
    conn.execute("CREATE INDEX ON place_cand (cluster)")
    conn.execute("ANALYZE place_cand")
    for key, value in conflate(conn, tax).items():
        stats[key] = stats.get(key, 0) + value
    conn.execute("CREATE UNLOGGED TABLE place_stage (LIKE place INCLUDING DEFAULTS)")
    keep_all = region == coverage.LONDON_REGION
    places = trimmed = 0
    sql = (f"SELECT cluster, signals, {', '.join(CAND_COLUMNS)} FROM place_cand WHERE cluster IS NOT NULL "
           "ORDER BY cluster")

    def emit(members: list, signals: dict, copy) -> None:
        nonlocal places, trimmed
        row = specialty(merge(tax, members), signals, fresh_since)
        if not keep_all and row["confidence"] < trim_below:
            trimmed += 1
            return
        copy.write_row((*_place_values(row, source_id), row["specialty_score"]))
        places += 1

    with conn.cursor().copy(f"COPY place_stage ({', '.join(PLACE_COLUMNS)}, source_release_id, specialty_score) "
                            "FROM STDIN") as copy:
        members: list[Candidate] = []
        signals: dict = {}
        current = None
        for row in _rows(reader, sql):
            if row["cluster"] != current and members:
                emit(members, signals, copy)
                members, signals = [], {}
            current = row["cluster"]
            members.append(Candidate(row["source"], row["source_id"], row["name"], row["category"], row["grp"],
                                     row["tags"], row["brand"], row["p"], row["lon"], row["lat"],
                                     row["closed"], row["standalone"], row["rating"], row["from_fsq"]))
            signals.update(row["signals"] or {})
        if members:
            emit(members, signals, copy)
    reader.commit()
    assign_lsoa(conn, "place_stage")
    with conn.cursor().copy(f"COPY place_stage ({', '.join(STAGE_COLUMNS)}) TO STDOUT") as copy:
        for data in copy:
            out.write(bytes(data))
    conn.execute(f"DROP TABLE IF EXISTS {WORK_TABLES}")
    stats["trimmed"] = stats.get("trimmed", 0) + trimmed
    stats.setdefault("places_by_region", {})[region] = places
    print(f"region {region} ({coverage.region_name(region)}): {places} places, {trimmed} below {trim_below} "
          "left out")
    return places


def file_input_releases(cur, inputs: dict[str, str], scope) -> list[str]:
    """Register the source release of each input file (rows of record; the source tables keep their own
    loads) and return their ids."""
    from . import food_hygiene, fsq_places, overture_places, places_load

    def sources(key: str) -> dict:
        with open(os.path.join(os.path.dirname(inputs[key]), "sources.json")) as handle:
            return json.load(handle)

    ids = []
    for key, module, version in (("overture", overture_places, overture_places.ETL_VERSION),
                                 ("fsq", fsq_places, fsq_places.ETL_VERSION),
                                 ("fhrs", food_hygiene, food_hygiene.ETL_VERSION)):
        release_id, url, released, sha, licence, attribution, caveats = module.source_release(sources(key))
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
                 transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s) ON CONFLICT (id) DO NOTHING""",
            (release_id, url, released, sha, licence, attribution, version, caveats))
        ids.append(release_id)
    if places_load.COVERAGE.name != scope.name:
        raise SystemExit(f"places_load coverage {places_load.COVERAGE.name} is not {scope.name}")
    places_load._release(cur, places_load.OSM_RELEASE, places_load.OSM_URL, places_load.OSM_DATE,
                         places_load.sha256([places_load.PBF]), "ODbL-1.0", places_load.OSM_ATTRIBUTION)
    return sorted(ids + [places_load.OSM_RELEASE])


def build_files(url: str, out_path: str, inputs: dict[str, str] | None = None,
                trim_below: float = FILES_TRIM_BELOW, register: bool = True) -> dict:
    """Map, partition and conflate the coverage's source files into `out_path` (gzipped COPY text of
    place, columns STAGE_COLUMNS) and register the input and unified source releases (unless `register`
    is false: a check build); the place table is untouched.

    Restartable: the partition (cand-<region>.tsv.gz + partition.json) and each finished region
    (place-<region>.tsv.gz + its .json) are kept next to `out_path` until the whole build is written,
    and a rerun reuses them."""
    import psycopg

    from . import coverage
    scope = coverage.from_env()
    inputs = inputs or default_inputs(scope)
    tax = Taxonomy.load()
    built = datetime.date.today().isoformat()
    folder = os.path.dirname(out_path)
    os.makedirs(folder, exist_ok=True)
    stats: dict = {"coverage": scope.name, "inputs_files": inputs, "trim_below": trim_below}
    with psycopg.connect(url, autocommit=True) as conn, psycopg.connect(url) as reader:
        with conn.cursor() as cur:
            if register:
                inputs_ids = file_input_releases(cur, inputs, scope)
            else:
                cur.execute("BEGIN")
                inputs_ids = file_input_releases(cur, inputs, scope)
                cur.execute("ROLLBACK")
        done_partition = os.path.join(folder, "partition.json")
        if os.path.exists(done_partition):
            with open(done_partition) as handle:
                saved = json.load(handle)
            paths = saved.pop("paths")
            stats.update(saved)
            print(f"partition: reusing {done_partition}")
        else:
            paths = partition(conn, tax, inputs, folder, scope.region_codes, stats)
            with open(done_partition, "w") as handle:
                json.dump({**stats, "paths": paths}, handle, indent=1)
        sha = inputs_sha256(inputs_ids)
        source_id, source_url, released, licence, attribution, caveats = source_release(stats, built, inputs_ids, sha)
        if trim_below > 0:
            caveats = caveats + [f"Outside London only places of confidence {trim_below} or more are kept (every "
                                 "map, criterion and walk-time reader uses those); London keeps every place."]
        if register:
            conn.execute(
                """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                     attribution, transformation_version, geography_vintage, validation_status, caveats)
                   VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s) ON CONFLICT (id) DO NOTHING""",
                (source_id, source_url.replace("derived:", "derived(files):"), released, sha, licence, attribution,
                 ETL_VERSION, caveats))
    total = 0
    for region, path in paths.items():
        part = os.path.join(folder, f"place-{region}.tsv.gz")
        if os.path.exists(part + ".json"):
            with open(part + ".json") as handle:
                region_stats = json.load(handle)
            print(f"region {region}: reusing {part}")
        else:
            region_stats = {}
            with psycopg.connect(url, autocommit=True) as conn, psycopg.connect(url) as reader, \
                    gzip.open(part, "wb", compresslevel=6) as out:
                build_region(conn, reader, tax, region, path, source_id, stats["fsq_fresh_since"], trim_below, out,
                             region_stats)
            with open(part + ".json", "w") as handle:
                json.dump(region_stats, handle)
        for key, value in region_stats.items():
            if key == "places_by_region":
                stats.setdefault(key, {}).update(value)
            else:
                stats[key] = stats.get(key, 0) + value
        total += region_stats["places_by_region"][region]
    with open(out_path, "wb") as out:  # gzip members concatenate into one gzip file
        for region in paths:
            with open(os.path.join(folder, f"place-{region}.tsv.gz"), "rb") as handle:
                for block in iter(lambda: handle.read(1 << 20), b""):
                    out.write(block)
    for region, path in paths.items():
        part = os.path.join(folder, f"place-{region}.tsv.gz")
        for leftover in (path, part, part + ".json"):
            if os.path.exists(leftover):
                os.remove(leftover)
    os.remove(done_partition)
    stats.update({"release": source_id, "inputs": inputs_ids, "places": total, "file": out_path})
    with open(out_path.replace(".tsv.gz", "") + ".json", "w") as handle:
        json.dump(stats, handle, indent=1)
    print(f"build-files: {total} places as {source_id} -> {out_path}")
    return stats


def load_files(url: str, out_path: str) -> None:
    """Replace the place table with a build_files output in one transaction (TRUNCATE frees the old
    rows' space at once instead of leaving them to VACUUM)."""
    import gzip

    import psycopg

    with psycopg.connect(url) as conn:
        conn.execute("TRUNCATE place")
        with conn.cursor().copy(f"COPY place ({', '.join(STAGE_COLUMNS)}) FROM STDIN") as copy, \
                gzip.open(out_path, "rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                copy.write(block)
        count = conn.execute("SELECT count(*) FROM place").fetchone()[0]
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("ANALYZE place")
    print(f"load-files: {count} places from {out_path}")


# --- checks -----------------------------------------------------------------------------------

RECALL_SQL = """-- FHRS consumer food businesses per borough and whether a non-register source found them
SELECT b.name AS borough, count(*) AS fhrs_food,
  count(*) FILTER (WHERE p.sources && ARRAY['osm', 'overture', 'fsq']) AS found,
  count(*) FILTER (WHERE 'osm' = ANY(p.sources)) AS osm,
  count(*) FILTER (WHERE 'overture' = ANY(p.sources)) AS overture,
  count(*) FILTER (WHERE 'fsq' = ANY(p.sources)) AS fsq
FROM food_business f
JOIN area_geography b ON b.kind = 'lad' AND ST_Intersects(b.geometry, f.location)
LEFT JOIN place p ON p.fhrs_id = f.fhrs_id
WHERE f.business_type = ANY(%(types)s)
GROUP BY b.name ORDER BY b.name"""

PRECISION_SQL = """-- open-data food places per borough and whether the register has them
SELECT b.name AS borough, count(*) AS food_places, count(*) FILTER (WHERE p.fhrs_id IS NOT NULL) AS in_register,
  count(*) FILTER (WHERE 'osm' = ANY(p.sources)) AS osm,
  count(*) FILTER (WHERE 'osm' = ANY(p.sources) AND p.fhrs_id IS NOT NULL) AS osm_in_register,
  count(*) FILTER (WHERE 'overture' = ANY(p.sources)) AS overture,
  count(*) FILTER (WHERE 'overture' = ANY(p.sources) AND p.fhrs_id IS NOT NULL) AS overture_in_register,
  count(*) FILTER (WHERE 'fsq' = ANY(p.sources)) AS fsq,
  count(*) FILTER (WHERE 'fsq' = ANY(p.sources) AND p.fhrs_id IS NOT NULL) AS fsq_in_register,
  count(*) FILTER (WHERE p.confidence >= 0.6) AS confident,
  count(*) FILTER (WHERE p.confidence >= 0.6 AND p.fhrs_id IS NOT NULL) AS confident_in_register
FROM place p
JOIN area_geography b ON b.kind = 'lad' AND ST_Intersects(b.geometry, p.location)
WHERE p.category = ANY(%(food)s) AND p.sources && ARRAY['osm', 'overture', 'fsq']
GROUP BY b.name ORDER BY b.name"""

COUNTS_SQL = """SELECT category, count(*) AS places,
  count(*) FILTER (WHERE 'osm' = ANY(sources)) AS osm, count(*) FILTER (WHERE 'overture' = ANY(sources)) AS overture,
  count(*) FILTER (WHERE 'fsq' = ANY(sources)) AS fsq, count(*) FILTER (WHERE 'fhrs' = ANY(sources)) AS fhrs,
  count(*) FILTER (WHERE cardinality(sources) = 1) AS single_source,
  round(avg(confidence)::numeric, 3) AS mean_confidence
FROM place GROUP BY category ORDER BY places DESC"""

SAMPLE_SQL = """SELECT %(kind)s AS kind, id, name, category, array_to_string(sources, '+') AS sources, confidence,
  hygiene_rating, tags->>'brand' AS brand, ST_Y(location) AS lat, ST_X(location) AS lon
FROM place WHERE {where} ORDER BY md5(id) LIMIT 50"""


# Coffee shops places_specialty scored as specialty, that more than one source or a confident one vouches for.
SPECIALTY_COFFEE = "tags->>'cuisine' ~ 'specialty_coffee' AND confidence >= 0.5"


def maps_url(name: str | None, lat: float, lon: float) -> str:
    return f"https://www.google.com/maps/search/{urllib.parse.quote(name or 'place')}/@{lat:.6f},{lon:.6f},19z"


def ratio(part: int, whole: int) -> float | None:
    return round(part / whole, 3) if whole else None


def check(url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    tax = Taxonomy.load()
    food = sorted(k for k, g in tax.group.items() if g in ("food", "drink"))
    os.makedirs(WORK, exist_ok=True)
    with psycopg.connect(url, row_factory=dict_row) as conn:
        recall = conn.execute(RECALL_SQL, {"types": tax.data["fhrs_food_types"]}).fetchall()
        precision = conn.execute(PRECISION_SQL, {"food": food}).fetchall()
        counts = conn.execute(COUNTS_SQL).fetchall()
        sample = (conn.execute(SAMPLE_SQL.format(where="category = 'kebab'"), {"kind": "kebab"}).fetchall()
                  + conn.execute(SAMPLE_SQL.format(where=SPECIALTY_COFFEE),
                                 {"kind": "specialty_coffee"}).fetchall())
        totals = conn.execute("SELECT count(*) AS places, count(*) FILTER (WHERE cardinality(sources) > 1) AS multi, "
                              "round(avg(confidence)::numeric, 3) AS mean_confidence FROM place").fetchone()
    by_borough = []
    precision_by = {row["borough"]: row for row in precision}
    for row in recall:
        p = precision_by.get(row["borough"], {})
        by_borough.append({"borough": row["borough"], "fhrs_food": row["fhrs_food"],
                           "recall": ratio(row["found"], row["fhrs_food"]),
                           "recall_osm": ratio(row["osm"], row["fhrs_food"]),
                           "recall_overture": ratio(row["overture"], row["fhrs_food"]),
                           "recall_fsq": ratio(row["fsq"], row["fhrs_food"]),
                           "food_places": p.get("food_places"),
                           "precision": ratio(p.get("in_register", 0), p.get("food_places", 0)),
                           "precision_confident": ratio(p.get("confident_in_register", 0), p.get("confident", 0))})

    def total(rows, key):
        return sum(row[key] or 0 for row in rows)

    london = {
        "fhrs_food": total(recall, "fhrs_food"),
        "recall": ratio(total(recall, "found"), total(recall, "fhrs_food")),
        "recall_osm": ratio(total(recall, "osm"), total(recall, "fhrs_food")),
        "recall_overture": ratio(total(recall, "overture"), total(recall, "fhrs_food")),
        "recall_fsq": ratio(total(recall, "fsq"), total(recall, "fhrs_food")),
        "food_places": total(precision, "food_places"),
        "precision": ratio(total(precision, "in_register"), total(precision, "food_places")),
        "precision_osm": ratio(total(precision, "osm_in_register"), total(precision, "osm")),
        "precision_overture": ratio(total(precision, "overture_in_register"), total(precision, "overture")),
        "precision_fsq": ratio(total(precision, "fsq_in_register"), total(precision, "fsq")),
        "precision_confident": ratio(total(precision, "confident_in_register"), total(precision, "confident")),
    }
    lows = sorted(by_borough, key=lambda r: r["recall"] or 0)
    report = {"totals": totals, "london_food": london, "recall_range": [lows[0]["recall"], lows[-1]["recall"]],
              "by_borough": by_borough, "top_categories": counts[:40],
              "notes": ["recall: register restaurants/cafés/takeaways/pubs linked to a place found by OSM, "
                        "Overture or Foursquare", "precision: open-data food/drink places matched to a "
                        "register record (a lower bound: register points are postcode-based and names differ)"]}
    with open(os.path.join(WORK, "unified-checks.json"), "w") as handle:
        json.dump(report, handle, indent=1, default=str)
    with open(os.path.join(WORK, "unified-category-counts.csv"), "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(counts[0]))
        writer.writeheader()
        writer.writerows(counts)
    with open(os.path.join(WORK, "unified-sample.csv"), "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["kind", "id", "name", "category", "sources", "confidence", "hygiene_rating", "brand",
                         "google_maps"])
        for row in sample:
            writer.writerow([row["kind"], row["id"], row["name"], row["category"], row["sources"],
                             row["confidence"], row["hygiene_rating"], row["brand"],
                             maps_url(row["name"], row["lat"], row["lon"])])
    print(json.dumps({"totals": totals, "london_food": london, "recall_range": report["recall_range"]},
                     default=str))
    print(f"check: wrote unified-checks.json, unified-category-counts.csv, unified-sample.csv to {WORK}")


def main(argv: list[str]) -> None:
    stage = argv[1] if len(argv) > 1 else ""
    trim = float(os.environ.get("PLACES_TRIM_BELOW", FILES_TRIM_BELOW))
    if stage == "load" and len(argv) == 3:
        load(argv[2])
    elif stage == "build-files" and len(argv) == 4:
        build_files(argv[2], argv[3], trim_below=trim)
    elif stage == "check-files" and len(argv) == 4:
        build_files(argv[2], argv[3], trim_below=trim, register=False)
    elif stage == "load-files" and len(argv) == 4:
        load_files(argv[2], argv[3])
    elif stage == "check" and len(argv) == 3:
        check(argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
