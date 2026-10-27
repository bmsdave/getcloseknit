"""AE-06 contract tests: production evidence API over validated storage.

Uses a small real-shaped in-memory fixture (official geography IDs, metric
definitions, monthly metric values, product-release membership) through the
same connection protocol the Postgres store speaks. No live services.
"""
import json
import math
import re
import statistics
import unittest
from datetime import date

from area_api import evidence, release_store
from area_api.evidence import (
    AddressNotFound,
    AreaNotFound,
    Cancelled,
    EvidenceReader,
    MalformedQuery,
    MetricNotFound,
    PeriodNotFound,
    ReleaseUnavailable,
)
from area_api.zones import station_name_key


def _metres(a, b):
    """Rough metres between two rows with center_lon/center_lat (London: 1° lon ≈ 69 km, 1° lat ≈ 111 km)."""
    return math.hypot((a["center_lon"] - b["center_lon"]) * 69_000, (a["center_lat"] - b["center_lat"]) * 111_000)


OLD_RELEASE = "product-2026-06"
NEW_RELEASE = "product-2026-07"
OLD_CRIME = "police-uk-2026-06"
NEW_CRIME = "police-uk-2026-07"
PRICE_RELEASE = "hmlr-epc-2026-06"


def crime_definition():
    return {
        "label": "Recorded crime",
        "shortLabel": "Crime",
        "description": "Street-level crimes per 1,000 residents over the latest 12 months.",
        "legend": [
            {"value": 40, "colour": "#3a7d44", "label": "40"},
            {"value": 80, "colour": "#f4d35e", "label": "80"},
            {"value": 120, "colour": "#b23a48", "label": "120+"},
        ],
        "freshness": OLD_CRIME,
        "methodologyPath": "/guide/crime",
        "caveats": ["Published crime coordinates are deliberately anonymised."],
        "sourceId": "police-uk",
        "sourceName": "data.police.uk",
    }


def price_definition():
    return {
        "label": "Price per square metre",
        "shortLabel": "Price / m2",
        "description": "Rolling 12-month median sold price joined to floor area.",
        "legend": [
            {"value": 4000, "colour": "#2a6f97", "label": "4k"},
            {"value": 12000, "colour": "#c44536", "label": "12k+"},
        ],
        "freshness": PRICE_RELEASE,
        "methodologyPath": "/guide/price-per-m2",
        "caveats": [],
        "sourceId": "hmlr-epc",
        "sourceName": "HM Land Registry Price Paid + EPC",
    }


class CursorShim:
    """Non-subscriptable single-pass iterable, shaped like a psycopg cursor."""

    def __init__(self, rows):
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)


class FakeConnection:
    """Real-shaped stand-in for a psycopg dict_row connection."""

    cursor_shaped = False

    def __init__(self):
        self.statements = []
        self.sources = {}
        self.geographies = {}
        self.metrics = {}
        self.values = []
        self.breakdowns = []
        self.geometries = {}
        self.area_regions = {}  # area id -> region code (map_chunks); London when absent
        self.members = {}
        self.active_id = None
        self.addresses = {}
        self.address_txns = []
        self.sales = []  # `sale` rows with migration 013 building/street keys
        self.properties = {}
        self.tiles = {}
        self.suppressed = set()  # uprns and address ids with a confirmed objection
        self.school_counts = {}  # area id -> (primary, secondary) within 1 km
        self.noise = {}  # area id -> area_noise row
        self.london_ranks = None  # area id -> area_rank rows (migration 054); None = no table
        self.price_bands = None  # area_price_band rows (migration 040); None: no table
        self.market_depth = {}  # area_market_depth rows (migration 014) by geography id
        self.area_schools = {}  # school rows (with distance_metres) near each geography id
        self.independent_schools = None  # independent_school rows near the area (migration 067); None = no table
        self.match_rows = []  # EVIDENCE_SQL-shaped factor rows (similar areas)
        self.stations = {}  # station rows (migration 012) by id
        self.place_stations = {}  # place_station rows (migration 017) by id, with center_lon/center_lat
        self.station_walks = []  # lsoa_station_walk rows
        self.touching = set()  # unordered LSOA pairs whose boundaries touch (brief ring)
        self.network = None  # active route_network_release row (migration 024 routing)
        self.commute_hubs = []  # commute_hub rows
        self.hub_minutes = {}  # (geography, hub, mode) -> (median, p10, p90)
        self.itineraries = {}  # (msoa, hub) -> commute_itinerary rows
        self.street_routes = {}  # (msoa, hub) -> commute_route rows
        self.nr_stations = []  # place_station rows within ~15 min walk: geography_id, name, modes
        self.area_points = None  # override rows for -- evidence:place-area-points
        self.area_amenities = []  # place_amenity rows near the area, nearest first (name, brand, sport, metres)
        self.area_school_rows = []  # school rows near the area (urn, name, metres)
        self.school_observations = []  # school rows with attributes->observations, for the London ranking
        self.best_school_rows = {}  # area id -> school rows within 1 km (urn, name, phase, distance_metres)
        self.school_pool = []  # school_card POOL_SQL rows (urn, phase, observation_kind, academic_year, value, percentile)
        self.standing_inspections = []  # school_inspection standing rows (urn, standing_framework, standing_overall, standing_date)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        if "profile_analytics_event" in sql:
            raise AssertionError("production evidence reads must not write analytics")
        self.statements.append((sql, params))
        marker = sql.split("\n", 1)[0]
        # Backlog #20: test_postgis.py runs these queries on the seeded PostGIS and checks their numbers, so their
        # entries here are redundant and can go with the tests that only exercise them: active-release, metrics,
        # metric, periods, geography, area-values, area-price-within, area-profile, breakdown, pack, pack-breakdown,
        # pack-asb, pack-values, rolled-country-rank, area-chunks, chunk-boxes, market-depth, area-noise, area-schools,
        # area-school-counts, standing-inspections, source-releases, area-lookup, area-outcodes. It also runs (on
        # empty tables only) metric-exists, active-source-releases, area-typical-prices, price-band-table,
        # independent-school-table, independent-schools-near, school-card-pool.
        handler = {
            "-- evidence:active-release": self._active,
            "-- evidence:metrics": self._metrics,
            "-- evidence:metric": self._metric,
            "-- evidence:metric-exists": self._metric_exists,
            "-- evidence:periods": self._periods,
            "-- evidence:search": self._search,
            "-- evidence:geography": self._geography,
            "-- evidence:area-values": self._area_values,
            "-- evidence:pack": self._pack,
            "-- evidence:pack-values": self._pack_values,
            "-- evidence:rolled-country-rank": self._rolled_rank,
            "-- evidence:area-chunks": self._area_chunks,
            "-- evidence:chunk-boxes": self._chunk_boxes,
            "-- evidence:breakdown": self._breakdown,
            "-- evidence:pack-breakdown": self._pack_breakdown,
            "-- evidence:pack-asb": lambda params: [{"offence_count": 12}],
            "-- evidence:address-search": self._address_search,
            "-- evidence:address-by-postcode": self._address_by_postcode,
            # postcode_civic rows live in StreetConnection.postcodes (test_street_search).
            "-- evidence:postcode-status": lambda params: [],
            "-- evidence:postcode-area": lambda params: [],
            # Street search (migration 042) and ONSPD postcodes: test_street_search seeds them.
            "-- evidence:street-table": lambda params: [{"t": False}],
            "-- evidence:address": self._address,
            "-- evidence:address-txns": self._address_txns,
            "-- evidence:property": self._property,
            "-- evidence:property-search": self._property_search,
            "-- evidence:property-by-address": self._property_by_address,
            "-- evidence:address-home": self._address_home,
            "-- property-profile:address-row": self._address_row,
            "-- evidence:property-tile": self._property_tile,
            "-- evidence:sale-tile": self._property_tile,
            "-- evidence:place-tile": self._property_tile,
            "-- evidence:area-profile": self._area_profile,
            "-- evidence:area-price-within": self._area_price_within,
            "-- evidence:price-band-table": lambda params: [{"t": self.price_bands is not None}],
            "-- evidence:area-typical-prices": lambda params: [
                dict(row) for row in self.price_bands or [] if row["geography_id"] in params[0]],
            "-- evidence:area-school-counts": self._school_counts,
            "-- evidence:area-noise": self._area_noise,
            "-- places:london-rank-table": lambda params: [{"t": self.london_ranks is not None}],
            "-- places:london-ranks": lambda params: [dict(row) for row in (self.london_ranks or {}).get(params[0], [])],
            "-- places:best-schools": lambda params: [dict(row) for row in self.best_school_rows.get(params["area"], [])],
            "-- evidence:school-card-pool": lambda params: [dict(row) for row in self.school_pool],
            "-- evidence:nearby-sale-keys": self._nearby_keys,
            "-- evidence:nearby-sales-building": self._nearby_building,
            "-- evidence:nearby-sales-street": self._nearby_street,
            "-- evidence:market-depth": self._market_depth,
            "-- evidence:source-releases": self._source_releases,
            "-- evidence:active-source-releases": lambda params: self._source_releases([self.member_sources()]),
            "-- evidence:home-sources": self._home_sources,
            "-- evidence:area-schools": lambda params: [dict(row) for row in self.area_schools.get(params[0], [])][:params[2]],
            "-- evidence:independent-school-table": lambda params: [{"t": self.independent_schools is not None}],
            "-- evidence:independent-schools-near": lambda params: [
                dict(row) for row in sorted(self.independent_schools or [], key=lambda row: row["distance_metres"])
                if row["distance_metres"] <= params[1]],
            "-- evidence:standing-inspections": lambda params: [dict(row) for row in self.standing_inspections
                                                                if row["urn"] in params[0]],
            "-- evidence:similar-utilities": lambda params: [dict(row) for row in self.match_rows
                                                             if row["factor_id"] in params[0]],
            "-- evidence:zone-station": self._zone_station,
            "-- evidence:zone-borough": self._zone_borough,
            "-- evidence:station-search": self._station_search,
            "-- evidence:area-lookup": self._area_lookup,
            "-- evidence:area-at": self._area_at,
            "-- evidence:area-outcodes": self._area_outcodes,
            "-- evidence:brief-ring": self._brief_ring,
            "-- evidence:brief-price-context": self._brief_price_context,
            "-- evidence:brief-stations": self._brief_stations,
            "-- evidence:rent-table": lambda params: [{"t": bool(getattr(self, "rents", None))}],
            "-- evidence:borough-rent": lambda params: [
                dict(row) for row in getattr(self, "rents", []) if row["bedrooms"] == params[0]
                and (params[1] is None or row["geography_id"] in params[1])],
            "-- evidence:brief-geometry": self._brief_geometry,
            "-- evidence:place-area-points": lambda params: self.area_points or [
                {"geography_id": g["id"], "name": g["name"], "lon": -0.12, "lat": 51.53, "station_walk": None}
                for g in self.geographies.values() if g["kind"] == "lsoa"],
            "-- evidence:commute-network": lambda params: [dict(self.network)] if self.network else [],
            "-- commute:national-rail-only": lambda params: [dict(row) for row in self.nr_stations],
            "-- evidence:commute-itineraries": lambda params: [
                dict(row) for row in self.itineraries.get((self.geographies[params[2]]["parent_id"], params[1]), [])],
            "-- evidence:commute-routes": lambda params: [
                dict(row) for row in self.street_routes.get((self.geographies[params[2]]["parent_id"], params[1]), [])],
            "-- evidence:commute-area-amenities": lambda params: [dict(row) for row in self.area_amenities],
            "-- evidence:commute-area-park": lambda params: [dict(row) for row in getattr(self, "area_parks", [])][:1],
            "-- evidence:commute-area-schools": lambda params: [
                dict(row) for row in sorted(self.area_school_rows, key=lambda row: row["metres"]) if row["urn"] in params[1]][:3],
            "-- evidence:place-school-observations": lambda params: [dict(row) for row in self.school_observations],
            "-- evidence:place-area-region": lambda params: [{"region_code": "E12000007"}],
            "-- evidence:commute-hubs": lambda params: [dict(hub) for hub in self.commute_hubs],
            "-- evidence:commute-hub-minutes": lambda params: [
                {"geography_id": area, "median_minutes": m[0], "p10_minutes": m[1], "p90_minutes": m[2]}
                for (area, hub, mode), m in self.hub_minutes.items() if (hub, mode) == (params[1], params[2])],
            # Area tiles (migration 116, map_tiles): absent unless a test sets area_tiles.
            "-- evidence:area-tiles-ready": lambda params: [{"ready": getattr(self, "area_tiles", None) is not None}],
            "-- evidence:area-tiles-info": lambda params: [
                {"release": "a1-0123456789ab", "built": bool(getattr(self, "area_tiles_built", False))}],
            "-- evidence:area-tile": lambda params: [
                {"tile": tile} for tile in [(self.area_tiles or {}).get(tuple(params))] if tile is not None],
            "-- evidence:area-tile-live": lambda params: [{"tile": getattr(self, "live_tile", b"")}],
            # London's areas alone (migration 125): the region code is the last parameter.
            "-- evidence:area-tile-region": lambda params: [{"tile": getattr(self, "region_tile", b"") + params[-1].encode()}],
            "-- evidence:area-boxes": self._area_boxes,
        }[marker]
        rows = handler(params)
        if self.cursor_shaped:
            return CursorShim(rows)
        return rows

    def _area_at(self, params):
        lon, lat = params
        for row in sorted(self.geometries.get("lsoa", []), key=lambda item: item["geography_id"]):
            ring = row["geometry"]["coordinates"][0]
            xs, ys = [point[0] for point in ring], [point[1] for point in ring]
            if min(xs) <= lon <= max(xs) and min(ys) <= lat <= max(ys):
                return [{"id": row["geography_id"]}]
        return []

    def _area_lookup(self, params):
        rows = []
        for area_id in params[0]:
            geography = self.geographies.get(area_id)
            if not geography:
                continue
            chain = [geography]
            while chain[-1]["parent_id"] in self.geographies and len(chain) < 3:
                chain.append(self.geographies[chain[-1]["parent_id"]])
            borough = next((item["name"] for item in chain if item["kind"] == "lad"), None)
            rows.append({**{key: geography[key] for key in ("id", "kind", "name", "parent_id")},
                         "borough": borough, "center_lon": geography.get("center_lon"),
                         "center_lat": geography.get("center_lat"),
                         "friendly_name": geography.get("friendly_name"),
                         "postcode_district": geography.get("postcode_district")})
        return rows

    def _area_outcodes(self, params):
        counts = {}
        for address in self.addresses.values():
            if address["geography_id"] in params[0] and address["source_release_id"] in self.member_sources():
                key = (address["geography_id"], address["postcode"].split(" ")[0])
                counts[key] = counts.get(key, 0) + 1
        return [{"geography_id": g, "outcode": o, "addresses": n} for (g, o), n in counts.items()]

    def _brief_ring(self, params):
        return [{"area_id": area, "neighbour_id": other} for area in params[0]
                for pair in sorted(self.touching) if area in pair for other in pair if other != area]

    def _brief_price_context(self, params):
        """Street sales without a seeded address sit in the subject's LSOA (Sample Street)."""
        area_ids, months = params
        released = [sale for sale in self.sales if sale["source_release_id"] in self.member_sources()]
        latest = max(date.fromisoformat(sale["date"]) for sale in self.sales)
        start = date(latest.year - months // 12, latest.month, latest.day)
        rows = []
        for sale in released:
            geography = self.addresses.get(sale["address_id"], {}).get("geography_id", "uk:lsoa:E01000004")
            if geography in area_ids and sale["ppd_category"] == "A" and date.fromisoformat(sale["date"]) > start:
                rows.append({"geography_id": geography, "price": sale["price"],
                             "property_type": sale["property_type"], "floor": sale["floor"],
                             "source_release_id": sale["source_release_id"]})
        return rows

    def _brief_geometry(self, params):
        rows = [row for carrier in self.geometries.values() for row in carrier]
        return [{"geography_id": row["geography_id"], "geometry": json.dumps(row["geometry"])}
                for row in rows if row["geography_id"] in params[1]]

    def _brief_stations(self, params):
        best = {}
        for walk in self.station_walks:
            if walk["geography_id"] in params[0] and walk["source_release_id"] in self.member_sources():
                if walk["geography_id"] not in best or walk["median_minutes"] < best[walk["geography_id"]]["median_minutes"]:
                    station = self.stations[walk["station_id"]]
                    best[walk["geography_id"]] = {"geography_id": walk["geography_id"], "station_id": station["id"],
                                                  "name": station["name"], "modes": station["modes"],
                                                  "median_minutes": walk["median_minutes"],
                                                  "center_lon": station["center_lon"], "center_lat": station["center_lat"]}
        return list(best.values())

    def member_sources(self):
        return set(self.members.get(self.active_id, []))

    def _hidden(self, *keys):
        """The reads carry NOT EXISTS (… suppressed_dwelling …); the fake honours it here."""
        keys = {key for key in keys if key}
        linked = {p["address_id"] for p in self.properties.values() if p["uprn"] in self.suppressed}
        linked |= {p["uprn"] for p in self.properties.values() if p["address_id"] in self.suppressed}
        return bool(keys & (self.suppressed | linked))

    def _zone_station(self, params):
        station_id, minutes = params
        return [{"geography_id": row["geography_id"]} for row in self.station_walks
                if row["station_id"] == station_id and row["median_minutes"] <= minutes
                and row["source_release_id"] in self.member_sources()]

    def _zone_borough(self, params):
        msoas = {g["id"] for g in self.geographies.values() if g["kind"] == "msoa" and g["parent_id"] == params[0]}
        return [{"geography_id": g["id"]} for g in self.geographies.values()
                if g["kind"] == "lsoa" and g["parent_id"] in msoas]

    def _station_search(self, params):
        """STATION_SEARCH_SQL: place_station rows by name, each linked to the released walk-table
        station sharing an OSM id, else the nearest within 500 m with the same name once a bracketed
        line list is dropped."""
        _, needle, _, limit = params
        released = [row for row in self.stations.values() if row["source_release_id"] in self.member_sources()]

        def bare(name):
            return station_name_key(re.sub(r"\(.*\)", "", name))

        def link(place):
            by_id = [row for row in released if row["id"][4:] in place["osm_ids"]]
            if by_id:
                return by_id[0]["id"]
            near = sorted(((_metres(row, place), row["id"]) for row in released
                           if bare(row["name"]) == bare(place["name"]) and _metres(row, place) <= 500))
            return near[0][1] if near else "osm:" + place["id"]

        found = [{"id": link(row), "name": row["name"], "modes": row["modes"], "zone": row.get("zone"),
                  "lines": row.get("lines") or [], "center_lon": row["center_lon"], "center_lat": row["center_lat"],
                  "_sort": (0 if station_name_key(row["name"]) == needle
                            else 1 if station_name_key(row["name"]).startswith(needle) else 2, len(row["name"]),
                            row["name"], row["id"])}
                 for row in self.place_stations.values() if needle in station_name_key(row["name"])]
        return [{key: value for key, value in row.items() if key != "_sort"}
                for row in sorted(found, key=lambda row: row["_sort"])][:limit]

    def _active(self, params):
        if self.active_id is None:
            return []
        return [{"release_id": self.active_id}]

    def _metrics(self, params):
        allowed = self.member_sources()
        return [self._metric_row(metric) for metric in self.metrics.values()
                if metric["source_release_id"] in allowed]

    def _metric(self, params):
        metric = self.metrics.get(params[0])
        if metric is None or metric["source_release_id"] not in self.member_sources():
            return []
        return [self._metric_row(metric)]

    def _metric_exists(self, params):
        return [{"id": params[0]}] if params[0] in self.metrics else []

    def _periods(self, params):
        allowed = self.member_sources()
        periods = sorted({row["period"] for row in self.values
                          if row["metric_id"] == params[0]
                          and row["source_release_id"] in allowed})
        return [{"period": period} for period in periods]

    @staticmethod
    def _search_rank(geography, needle):
        """Mirror SEARCH_SQL's ordering: exact name, whole word, prefix, word prefix, substring."""
        name = geography["name"].lower()
        friendly = (geography.get("friendly_name") or "").lower()
        if friendly == needle or name == needle:
            return 1
        if f" {needle} " in f" {friendly} " or (
                geography["kind"] == "lad" and name.startswith(needle + " ")):
            return 2
        if friendly.startswith(needle) or name.startswith(needle):
            return 3
        if f" {needle}" in f" {friendly}":
            return 4
        return 5

    def _search(self, params):
        needle, exact, limit = params[0].strip("%").lower(), params[2], params[-1]
        scored = []
        for geography in self.geographies.values():
            haystack = f"{geography['name']} {geography['official_code']} {geography['id']}".lower()
            if geography["id"] == exact:
                rank = 0
            elif needle and needle in haystack:
                rank = self._search_rank(geography, needle)
            else:
                continue
            scored.append((rank, geography))
        scored.sort(key=lambda item: (item[0], 0 if item[1]["kind"] == "lad" else 1,
                                      len(item[1].get("friendly_name") or item[1]["name"]),
                                      item[1].get("friendly_name") or "",
                                      0 if item[1]["kind"] == "msoa" else 1,
                                      item[1]["name"]))
        return [self._search_row(geography) for _, geography in scored[:limit]]

    def _geography(self, params):
        geography = self.geographies.get(params[0])
        return [dict(geography)] if geography else []

    def _joined_row(self, row):
        geography = self.geographies[row["geography_id"]]
        return {
            "geography_id": row["geography_id"], "name": geography["name"],
            "carrier": geography["kind"], "metric_id": row["metric_id"],
            "period": row["period"], "value": row["value"],
            "region_percentile": row["region_percentile"],
            "country_percentile": row["country_percentile"],
            "sample_count": row["sample_count"], "quality": row["quality"],
            "source_release_id": row["source_release_id"],
        }

    def _area_values(self, params):
        allowed = self.member_sources()
        # AREA_VALUES_SQL also reads the stored carrier columns (095).
        rows = [{**self._joined_row(row), "carrier_geography_id": row.get("carrier_geography_id"),
                 "carrier_sample_count": row.get("carrier_sample_count")} for row in self.values
                if row["geography_id"] == params[0]
                and row["metric_id"] == params[1]
                and row["source_release_id"] in allowed]
        rows.sort(key=lambda row: row["period"])
        return rows

    def _area_profile(self, params):
        allowed = self.member_sources()
        rows = [self._joined_row(row) for row in self.values
                if row["geography_id"] in params[0]
                and row["metric_id"] in params[1]
                and row["period"] <= params[2]
                and row["source_release_id"] in allowed]
        rows.sort(key=lambda row: (row["metric_id"], row["period"]))
        return rows

    def _area_price_within(self, params):
        """The middle £/m² of the LSOAs inside an MSOA or borough, per month."""
        metric_id, area_id, _ = params
        inside = {g["id"] for g in self.geographies.values() if g["kind"] == "lsoa" and (
            g["parent_id"] == area_id or self.geographies.get(g["parent_id"], {}).get("parent_id") == area_id)}
        by_period = {}
        for row in self.values:
            if (row["geography_id"] in inside and row["metric_id"] == metric_id and row["value"] is not None
                    and row["source_release_id"] in self.member_sources()):
                by_period.setdefault(row["period"], []).append(row)
        return [{"period": period, "value": statistics.median(r["value"] for r in rows), "areas": len(rows),
                 "fallback_areas": sum(1 for r in rows if r["quality"] != "observed"),
                 "source_release_id": rows[0]["source_release_id"]} for period, rows in sorted(by_period.items())]

    def _school_counts(self, params):
        if params[0] not in self.school_counts:
            return []
        primary, secondary = self.school_counts[params[0]]
        return [{"primary_count": primary, "secondary_count": secondary}]

    def _area_noise(self, params):
        row = self.noise.get(params[0])
        return [dict(row)] if row else []

    def _pack_values(self, params):
        months = [day[:7] for day in params[1]]
        ids = params[2] if len(params) > 2 else None
        rows = [row for month in months for row in self._pack((params[0], month, ids, ids)) if row["value"] is not None]
        return [{"period": row["period"], "value": row["value"]} for row in rows]

    def _rolled_rank(self, params):
        # (level, metric, month): each wider area's median of its ranked areas, ranked among them (ties lowest).
        level, metric_id, period = params
        groups = {}
        for row in self._pack((metric_id, period, None, None)):
            if row["value"] is None or row["region_percentile"] is None:
                continue
            parent = self.geographies[row["geography_id"]]["parent_id"]
            if level != "msoa":
                parent = self.geographies[parent]["parent_id"]
            groups.setdefault(parent, []).append(row["value"])
        medians = {area: statistics.median(values) for area, values in groups.items()}
        ordered = sorted(medians.values())
        return [{"geography_id": area, "country_percentile": round(100 * ordered.index(median) / max(1, len(ordered) - 1))}
                for area, median in medians.items()]

    def _pack(self, params):
        allowed = self.member_sources()
        metric = self.metrics.get(params[0], {})
        rows = [self._joined_row(row) for row in self.values
                if row["metric_id"] == params[0]
                and row["period"] == params[1]
                and row["source_release_id"] in allowed
                and self.geographies[row["geography_id"]]["kind"] == metric.get("carrier")
                and (len(params) < 3 or params[2] is None or row["geography_id"] in params[2])]
        rows.sort(key=lambda row: row["geography_id"])
        return rows

    def _area_boxes(self, params):
        # (carrier, ids, ids): each area's box, 4 decimals.
        carrier, ids = params[0], params[1]
        rows = []
        for row in self.geometries.get(carrier, []):
            if ids is not None and row["geography_id"] not in ids:
                continue
            points = [point for ring in row["geometry"]["coordinates"] for point in ring]
            xs, ys = [point[0] for point in points], [point[1] for point in points]
            rows.append({"geography_id": row["geography_id"], "west": round(min(xs), 4), "south": round(min(ys), 4),
                         "east": round(max(xs), 4), "north": round(max(ys), 4)})
        return rows

    def _area_chunks(self, params):
        """map_chunks.CHUNKS_SQL: every test area sits in London (E12000007)."""
        rows = []
        for area in sorted(self.geographies.values(), key=lambda area: area["id"]):
            parent = self.geographies.get(area["parent_id"]) if area["parent_id"] else None
            borough = {"lsoa": parent and parent["parent_id"], "msoa": area["parent_id"]}.get(area["kind"], area["id"])
            rows.append({"id": area["id"], "kind": area["kind"], "name": area["name"],
                         "region_code": self.area_regions.get(area["id"], "E12000007"), "borough_id": borough,
                         "msoa_id": area["parent_id"] if area["kind"] == "lsoa" else None})
        return rows

    def _chunk_boxes(self, params):
        return [{"id": area["id"], "west": area["center_lon"] - 0.05, "south": area["center_lat"] - 0.05,
                 "east": area["center_lon"] + 0.05, "north": area["center_lat"] + 0.05}
                for area in sorted(self.geographies.values(), key=lambda area: area["id"]) if area["kind"] == "lad"]

    def _breakdown(self, params):
        allowed = self.member_sources()
        return [{"period": row["period"], "category": row["category"],
                 "offence_count": row["offence_count"]}
                for row in self.breakdowns
                if row["geography_id"] == params[0]
                and row["metric_id"] == params[1]
                and row["source_release_id"] in allowed]

    def _pack_breakdown(self, params):
        allowed = self.member_sources()
        return [{"geography_id": row["geography_id"], "category": row["category"],
                 "offence_count": row["offence_count"]}
                for row in self.breakdowns
                if row["metric_id"] == params[0]
                and row["period"] == params[1]
                and (len(params) < 3 or params[2] is None or row["geography_id"] in params[2])
                and row["source_release_id"] in allowed]

    def _address_search(self, params):
        needle, nospace, limit = params[0].strip("%").lower(), params[1].strip("%").lower(), params[-1]
        postcode = params[3].rstrip("%")  # a.postcode LIKE: "E17 ", "E17 6RA" or "" (#149)
        scored = []
        for address in self.addresses.values():
            if self._hidden(address["id"]) or not address["postcode"].startswith(postcode):
                continue
            haystack = f"{address['display_address']} {address['postcode']}".lower()
            flat_pc = address["postcode"].lower().replace(" ", "")
            if needle and (needle in haystack or (nospace and nospace in flat_pc)):
                sales = sum(1 for txn in self.address_txns if txn["address_id"] == address["id"])
                uprn = next((p["uprn"] for p in self.properties.values() if p["address_id"] == address["id"]), None)
                scored.append((address["display_address"], {
                    "address_id": address["id"],
                    "display_address": address["display_address"],
                    "postcode": address["postcode"],
                    "geography_id": address["geography_id"],
                    "sale_count": sales, "uprn": uprn,
                    "center_lon": -0.14, "center_lat": 51.54,
                }))
        scored.sort(key=lambda item: item[0])
        return [row for _, row in scored[:limit]]

    def _address_by_postcode(self, params):
        """Mirror ADDRESS_BY_POSTCODE_SQL: the postcode compares exactly (#200/#205)."""
        code = params[0].upper()
        rows = []
        for address in self.addresses.values():
            if self._hidden(address["id"]) or address["postcode"].upper() != code:
                continue
            sales = sum(1 for txn in self.address_txns if txn["address_id"] == address["id"])
            uprn = next((p["uprn"] for p in self.properties.values()
                         if p["address_id"] == address["id"]), None)
            rows.append({
                "address_id": address["id"], "display_address": address["display_address"],
                "postcode": address["postcode"], "geography_id": address["geography_id"],
                "sale_count": sales, "uprn": uprn, "center_lon": -0.14, "center_lat": 51.54})
        rows.sort(key=lambda row: row["display_address"])
        return rows[:100]

    def _address(self, params):
        address = self.addresses.get(params[0])
        if not address or self._hidden(address["id"]):
            return []
        return [{**address, "address_id": address["id"]}]

    def _address_txns(self, params):
        rows = [txn for txn in self.address_txns
                if txn["address_id"] == params[0] and not self._hidden(params[0])]
        rows.sort(key=lambda txn: (txn["date"], txn["price"]))
        return [{**txn, "part_share_likely": self._part_share_likely(txn, self.address_txns)} for txn in rows]

    def _released_sales(self):
        return [sale for sale in self.sales if sale["source_release_id"] in self.member_sources()]

    def _nearby_keys(self, params):
        own = sorted((sale for sale in self._released_sales() if sale["address_id"] == params[0]),
                     key=lambda sale: sale["date"], reverse=True)
        return [{"building_key": sale["building_key"], "street_key": sale["street_key"],
                 "postcode": self.addresses.get(sale["address_id"], {}).get("postcode"),
                 "source_release_id": sale["source_release_id"]} for sale in own[:1]]

    def _market_depth(self, params):
        row = self.market_depth.get(params[0])
        return [dict(row)] if row and row["source_release_id"] in self.member_sources() else []

    def _source_releases(self, params):
        return [{"id": source_id, "source_url": self.sources[source_id]["source_url"],
                 "licence": self.sources[source_id]["licence"],
                 "attribution": self.sources[source_id]["attribution"],
                 "transformation_version": self.sources[source_id]["transformation_version"]}
                for source_id in sorted(params[0]) if source_id in self.sources]

    def _home_sources(self, params):
        """LIKE ANY(prefix%) over the active release's members."""
        prefixes = tuple(pattern.rstrip("%") for pattern in params[0])
        return self._source_releases([[source_id for source_id in self.member_sources()
                                       if source_id.startswith(prefixes)]])

    def _nearby_building(self, params):
        return self._nearby(params, lambda sale: sale["building_key"] == params["key"])

    def _nearby_street(self, params):
        # Mirror NEARBY_STREET_SQL: the street group is the same street name in the subject's
        # postcode district (#202). Sales whose address the fixture does not model keep the old
        # behaviour (no postcode to filter on).
        outcode = (params.get("postcode") or "").split(" ")[0].upper()

        def same_outcode(sale):
            postcode = self.addresses.get(sale["address_id"], {}).get("postcode")
            return postcode is None or postcode.split(" ")[0].upper() == outcode

        return self._nearby(params, lambda sale: sale["street_key"] == params["key"]
                            and sale["building_key"] != params["building_key"]
                            and (not outcode or same_outcode(sale)))

    def _part_share_likely(self, txn, pool):
        """Mirrors the SQL heuristic: the same address has another standard sale within 90
        days at twice the price or more (a shared-ownership first tranche)."""
        txn_date = date.fromisoformat(txn["date"])
        return any(other is not txn and other["address_id"] == txn["address_id"]
                   and other.get("ppd_category", "A") == "A" and other["date"] != txn["date"]
                   and abs((date.fromisoformat(other["date"]) - txn_date).days) <= 90
                   and other["price"] >= 2 * txn["price"]
                   for other in pool)

    def _nearby(self, params, match):
        """Mirrors the nearby-sales SQL: window, subject and suppressed homes out, gated median,
        likely part-share sales out of the median and counted."""
        today = date.today()
        cutoff = today.replace(year=today.year - params["years"]).isoformat()
        released = self._released_sales()
        scoped = [sale for sale in released
                  if match(sale) and sale["address_id"] != params["address_id"]
                  and sale["date"] >= cutoff and not self._hidden(sale["address_id"])]
        flags = {id(sale): self._part_share_likely(sale, released) for sale in scoped}
        ppms = [sale["ppm"] for sale in scoped
                if sale["ppm"] is not None and sale["ppd_category"] == "A" and not flags[id(sale)]]
        summary = {"sale_count": len(scoped),
                   "excluded_part_share": sum(1 for sale in scoped if flags[id(sale)]),
                   "median_sample": len(ppms),
                   "median_ppm": round(statistics.median(ppms)) if len(ppms) >= params["median_min"] else None}
        newest = sorted(scoped, key=lambda sale: (sale["date"], sale["price"]), reverse=True)[:params["limit"]]
        if not newest:
            return [{**summary, "date": None, "price": None, "property_type": None,
                     "tenure": None, "new_build": None, "part_share_likely": None}]
        return [{**summary, **{key: sale[key] for key in ("date", "price", "property_type", "tenure", "new_build")},
                 "part_share_likely": flags[id(sale)]} for sale in newest]

    def _property(self, params):
        row = self.properties.get(params[0])
        if not row or self._hidden(row["uprn"], row["address_id"]):
            return []
        return [dict(row)] if row["source_release_id"] in self.member_sources() else []

    def _property_search(self, params):
        """Mirrors -- evidence:property-search: linked homes plus addresses with a recorded
        sale but no property row; no blind first row (B2)."""
        needle, postcode = params[0].strip("%").lower(), params[3].rstrip("%")
        allowed = self.member_sources()
        linked = {p["address_id"] for p in self.properties.values()
                  if p["source_release_id"] in allowed}
        rows = []
        for row in self.properties.values():
            address = self.addresses.get(row["address_id"], {})
            if (needle in row["display_address"].lower() and row["source_release_id"] in allowed
                    and (address.get("postcode") or "").startswith(postcode)
                    and not self._hidden(row["uprn"], row["address_id"])):
                rows.append({**row, "postcode": address.get("postcode"),
                             "sale_count": sum(1 for txn in self.address_txns
                                               if txn["address_id"] == row["address_id"])})
        for address in self.addresses.values():
            if address["id"] in linked or self._hidden(address["id"]) or not address["postcode"].startswith(postcode):
                continue
            sales = sum(1 for txn in self.address_txns if txn["address_id"] == address["id"])
            if ((needle in address["display_address"].lower() or needle in address["id"])
                    and sales and address["source_release_id"] in allowed):
                rows.append({"uprn": None, "address_id": address["id"],
                             "display_address": address["display_address"],
                             "geography_id": address["geography_id"], "parcel_id": None,
                             "lon": None, "lat": None, "source_release_id": address["source_release_id"],
                             "period": None, "sale_period": None, "completion_date": None,
                             "nominal_price": None, "floor": None, "postcode": address["postcode"],
                             "sale_count": sales})
        rows.sort(key=lambda row: row["display_address"])
        return rows[:params[-1]]

    def _property_by_address(self, params):
        row = next((p for p in self.properties.values() if p["address_id"] == params[0]
                    and p["source_release_id"] in self.member_sources()
                    and not self._hidden(p["uprn"], p["address_id"])), None)
        return [dict(row)] if row else []

    def _address_home(self, params):
        address = self.addresses.get(params[0])
        if (not address or self._hidden(address["id"])
                or address["source_release_id"] not in self.member_sources()):
            return []
        sales = sum(1 for txn in self.address_txns if txn["address_id"] == address["id"])
        return [{**address, "address_id": address["id"], "sale_count": sales}]

    def _address_row(self, params):
        """Mirrors -- property-profile:address-row: the address row for a profile."""
        rows = self._address_home(params)
        return [{key: row[key] for key in ("address_id", "display_address", "postcode",
                                          "geography_id", "source_release_id")} for row in rows]

    def _property_tile(self, params):
        return [{"tile": self.tiles.get(tuple(params), b"")}]

    def _metric_row(self, metric):
        source = self.sources[metric["source_release_id"]]
        return {
            "id": metric["id"], "carrier": metric["carrier"], "unit": metric["unit"],
            "direction": metric["direction"], "definition": dict(metric["definition"]),
            "source_release_id": metric["source_release_id"],
            "source_url": source["source_url"],
            "checksum": source["sha256"], "licence": source["licence"],
            "attribution": source["attribution"],
            "transformation_version": source["transformation_version"],
            "periods": [row["period"] for row in self._periods((metric["id"],))],
        }

    def _search_row(self, geography):
        return {
            "id": geography["id"], "kind": geography["kind"],
            "official_code": geography["official_code"], "name": geography["name"],
            "parent_id": geography["parent_id"],
            "center_lon": geography["center_lon"], "center_lat": geography["center_lat"],
        }


UPRN_RELEASE = "os-open-uprn-2026-08"


def seed_production_fixture():
    connection = FakeConnection()
    _seed_sources(connection)
    _seed_geographies(connection)
    _seed_metrics(connection)
    _seed_values(connection)
    _seed_breakdowns(connection)
    _seed_geometries(connection)
    _seed_addresses(connection)
    _seed_properties(connection)
    _seed_sales(connection)
    _seed_market(connection)
    connection.members[OLD_RELEASE] = [OLD_CRIME, PRICE_RELEASE, UPRN_RELEASE]
    connection.active_id = OLD_RELEASE
    return connection


def _seed_sources(connection):
    connection.sources[OLD_CRIME] = _police_source("a" * 64)
    connection.sources[NEW_CRIME] = _police_source("b" * 64)
    connection.sources[PRICE_RELEASE] = {
        "source_id": "hmlr-epc", "source_name": "HM Land Registry Price Paid + EPC",
        "source_url": "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
        "sha256": "c" * 64, "licence": "OGL-3.0",
        "attribution": "Contains HM Land Registry information licensed under OGL v3.0",
        "transformation_version": "price-v1",
    }


def _police_source(checksum):
    return {
        "source_id": "police-uk", "source_name": "data.police.uk",
        "source_url": "https://data.police.uk/", "sha256": checksum,
        "licence": "OGL-3.0", "attribution": "Contains police data licensed under OGL v3.0",
        "transformation_version": "crime-v1",
    }


def _seed_geographies(connection):
    connection.geographies["uk:lsoa:E01000004"] = _geography(
        "uk:lsoa:E01000004", "lsoa", "E01000004",
        "Camden 001A test area", "uk:msoa:E02000004", -0.14, 51.54)
    connection.geographies["uk:msoa:E02000004"] = _geography(
        "uk:msoa:E02000004", "msoa", "E02000004",
        "Camden 001 test area", "uk:lad:E09000007", -0.14, 51.54)
    connection.geographies["uk:lad:E09000007"] = _geography(
        "uk:lad:E09000007", "lad", "E09000007",
        "Camden test borough", None, -0.14, 51.53)
    connection.geographies["uk:lsoa:E01000005"] = _geography(
        "uk:lsoa:E01000005", "lsoa", "E01000005",
        "Camden 002A test area", "uk:msoa:E02000004", -0.13, 51.55)


def _geography(id, kind, official_code, name, parent_id, lon, lat):
    return {
        "id": id, "kind": kind, "official_code": official_code,
        "name": name, "parent_id": parent_id,
        "center_lon": lon, "center_lat": lat,
    }


def _seed_metrics(connection):
    connection.metrics["crime"] = {
        "id": "crime", "carrier": "lsoa", "unit": "per 1,000",
        "direction": "higher-is-more", "definition": crime_definition(),
        "source_release_id": OLD_CRIME,
    }
    connection.metrics["price-per-square-metre"] = {
        "id": "price-per-square-metre", "carrier": "lsoa", "unit": "GBP/m2",
        "direction": "higher-is-more", "definition": price_definition(),
        "source_release_id": PRICE_RELEASE,
    }


def _seed_values(connection):
    for month in range(1, 13):
        period = f"2025-{month:02d}" if month > 6 else f"2026-{month:02d}"
        connection.values.append({
            "geography_id": "uk:lsoa:E01000004", "metric_id": "crime",
            "period": period, "value": 50.0 + month,
            "region_percentile": 40, "country_percentile": None,
            "sample_count": None, "quality": "observed",
            "source_release_id": OLD_CRIME, "carrier": "lsoa",
            "name": "Camden 001A test area",
        })
    connection.values.append({
        "geography_id": "uk:lsoa:E01000004", "metric_id": "price-per-square-metre",
        "period": "2026-06", "value": 9800.0,
        "region_percentile": 92, "country_percentile": 98,
        "sample_count": 42, "quality": "observed",
        "source_release_id": PRICE_RELEASE, "carrier": "lsoa",
        "name": "Camden 001A test area",
    })


def _seed_breakdowns(connection):
    for period, counts in (("2026-06", {"Violence and sexual offences": 9, "Shoplifting": 4}),
                           ("2026-05", {"Violence and sexual offences": 7})):
        for category, count in counts.items():
            connection.breakdowns.append({
                "geography_id": "uk:lsoa:E01000004", "metric_id": "crime",
                "period": period, "category": category, "offence_count": count,
                "source_release_id": OLD_CRIME,
            })


def _seed_addresses(connection):
    connection.addresses["uk:addr:a1b2c3d4e5f6"] = {
        "id": "uk:addr:a1b2c3d4e5f6",
        "display_address": "Flat 1, 10 Sample Street, Westminster, London, SW1A 1AA",
        "postcode": "SW1A 1AA",
        "geography_id": "uk:lsoa:E01000004",
        "source_release_id": OLD_CRIME,
    }
    connection.address_txns.append({
        "address_id": "uk:addr:a1b2c3d4e5f6",
        "date": "2022-11-03", "price": 570000,
        "floor": 54.0, "ppm": 10555.56,
        "source_release_id": OLD_CRIME,
    })
    connection.address_txns.append({
        "address_id": "uk:addr:a1b2c3d4e5f6",
        "date": "2006-06-15", "price": 280000,
        "floor": None, "ppm": None,
        "source_release_id": OLD_CRIME,
    })


BUILDING_KEY = "b" * 32
STREET_KEY = "c" * 32


def _sale(address_id, sale_date, price, ppm=None, *, building_key=BUILDING_KEY, street_key=STREET_KEY,
          ptype="F", tenure="L", new_build=False, category="A"):
    return {"address_id": address_id, "date": sale_date, "price": price, "property_type": ptype,
            "tenure": tenure, "new_build": new_build, "ppd_category": category, "ppm": ppm,
            "floor": None if ppm is None else round(price / ppm, 1),
            "building_key": building_key, "street_key": street_key, "source_release_id": PRICE_RELEASE}


def _seed_sales(connection):
    """10 Sample Street: the subject flat, three other flats (one sale too old)
    and seven sales in other buildings on the street (one category B)."""
    connection.sales += [
        _sale("uk:addr:a1b2c3d4e5f6", "2022-11-03", 570000, 10555.56),
        _sale("uk:addr:00000000b001", "2024-03-01", 610000, 11000.0, new_build=True),
        _sale("uk:addr:00000000b002", "2021-06-30", 495000, 9800.0),
        _sale("uk:addr:00000000b003", "2019-01-15", 450000),
        _sale("uk:addr:00000000b003", "2009-05-01", 300000, 7000.0),
    ]
    for index, (sale_date, price, ppm) in enumerate([
            ("2025-09-01", 1250000, 12000.0), ("2024-05-20", 980000, 10000.0), ("2023-02-11", 1100000, 11000.0),
            ("2022-08-08", 875000, 9000.0), ("2020-10-10", 1500000, 13000.0), ("2018-04-04", 760000, 8000.0)]):
        connection.sales.append(_sale(f"uk:addr:00000000c00{index}", sale_date, price, ppm,
                                      building_key=f"{index:032d}", ptype="T", tenure="F"))
    connection.sales.append(_sale("uk:addr:00000000c009", "2023-07-07", 400000, 50000.0,
                                  building_key="9" * 32, ptype="T", tenure="F", category="B"))


NOISE_RELEASE = "defra-noise-round4-2022"
OFSTED_RELEASE = "ofsted-inspections-2026-08"


def market_row(geography_id, **overrides):
    """An area_market_depth row (migration 014) as MARKET_SQL selects it."""
    row = {
        "geography_id": geography_id, "period_end": "2026-07-31", "sales_12m": 24, "dwellings": 400,
        "dwellings_sold_12m": 16, "turnover_percent": 4.0, "tenure_known_12m": 24,
        "leasehold_share_of_sales": 0.625, "new_build_sample_36m": 12, "resale_sample_36m": 40,
        "new_build_median_ppm": 12600, "resale_median_ppm": 10500, "new_build_premium_percent": 20.0,
        "growth_period": "2026-06", "growth_1y": 2.5, "growth_3y": -1.2, "growth_5y": 8.0,
        "growth_10y": 31.4, "source_release_id": PRICE_RELEASE,
    }
    row.update(overrides)
    return row


def _seed_market(connection):
    """Market depth for the LSOA (premium shown) and its MSOA (too few new builds),
    road/rail noise and two schools near the LSOA."""
    connection.market_depth["uk:lsoa:E01000004"] = market_row("uk:lsoa:E01000004")
    connection.market_depth["uk:msoa:E02000004"] = market_row(
        "uk:msoa:E02000004", sales_12m=90, dwellings=2000, dwellings_sold_12m=70, turnover_percent=3.5,
        new_build_sample_36m=6, new_build_median_ppm=None, new_build_premium_percent=None,
        growth_period=None, growth_1y=None, growth_3y=None, growth_5y=None, growth_10y=None)
    connection.sources[NOISE_RELEASE] = {
        "source_url": "https://environment.data.gov.uk/dataset/noise", "sha256": "d" * 64, "licence": "OGL-3.0",
        "attribution": "Defra strategic noise mapping Round 4", "transformation_version": "noise-1"}
    connection.sources[OFSTED_RELEASE] = {
        "source_url": "https://www.gov.uk/government/statistical-data-sets/ofsted", "sha256": "e" * 64,
        "licence": "OGL-3.0", "attribution": "Ofsted", "transformation_version": "schools-1"}
    connection.noise["uk:lsoa:E01000004"] = {
        "dwellings": 400, "road_55_share": 0.41, "rail_55_share": 0.05, "any_55_share": 0.43,
        "air_55_share": 0.0, "any_65_share": 0.08, "road_lden_median": 54.2, "source_release_id": NOISE_RELEASE,
        "caveats": ["Modelled levels."], "attribution": "Defra strategic noise mapping Round 4"}
    connection.area_schools["uk:lsoa:E01000004"] = [
        _school_row("100001", "Sample Primary School", "Primary", 350, "Good"),
        _school_row("100002", "Sample Academy", "Secondary", 900, "Outstanding"),
    ]
    # Fix 158: the standing inspection rows the pack attaches to nearest[].
    connection.standing_inspections = [
        {"urn": "100001", "standing_framework": "eif-2019", "standing_overall": 2,
         "standing_date": "2023-05-16"},
        {"urn": "100002", "standing_framework": "eif-2019", "standing_overall": 1,
         "standing_date": "2022-11-02"},
    ]


def _school_row(urn, name, phase, distance, grade):
    return {"urn": urn, "name": name, "phase": phase, "latitude": 51.54, "longitude": -0.14,
            "distance_metres": distance, "source_release_id": OFSTED_RELEASE,
            "attributes": {"type": "Academy", "observations": [
                {"kind": "inspection-legacy", "value": grade, "measure": "Overall effectiveness",
                 "academicYear": "2023/24", "sourceRelease": OFSTED_RELEASE}]}}


def _seed_properties(connection):
    connection.properties["100023336956"] = {
        "uprn": "100023336956", "address_id": "uk:addr:a1b2c3d4e5f6",
        "display_address": "Flat 1, 10 Sample Street, Westminster, London, SW1A 1AA",
        "geography_id": "uk:lsoa:E01000004", "parcel_id": "63267097",
        "lon": -0.1416, "lat": 51.501, "source_release_id": UPRN_RELEASE,
        "period": "2026-06", "sale_period": "2022-11", "completion_date": "2022-11-03",
        "nominal_price": 570000, "floor": 54.0, "sale_ppm": 10555.56,
        "index_carrier": "lsoa", "index_geography_id": "uk:lsoa:E01000004",
        "index_at_sale": 9000.0, "index_latest": 9800.0,
        "restated_ppm": 11494.16, "restated_value": 620667, "confidence": "medium",
    }
    connection.tiles[(16, 32745, 21792)] = b"\x1a\x05parcels"


def _square(x0, y0, x1, y1):    return {"type": "Polygon",
            "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


def _seed_geometries(connection):
    connection.geometries["lsoa"] = [
        {"geography_id": "uk:lsoa:E01000004", "name": "Camden 001A test area",
         "geometry": _square(-0.15, 51.53, -0.13, 51.55)},
        {"geography_id": "uk:lsoa:E01000005", "name": "Camden 002A test area",
         "geometry": _square(-0.14, 51.54, -0.12, 51.56)},
    ]


def make_reader(connection):
    return EvidenceReader(connect=lambda: connection)


def assert_checksum(value):
    assert len(value) == 64 and all(char in "0123456789abcdef" for char in value)


class MetricCatalogueTests(unittest.TestCase):
    def test_catalogue_conforms_to_schema_and_pins_selected_release(self):
        reader = make_reader(seed_production_fixture())

        catalogue = reader.list_metrics()

        self.assertEqual(catalogue["schemaVersion"], "area-metrics.v1")
        self.assertEqual(catalogue["productReleaseId"], OLD_RELEASE)
        self.assertEqual([metric["id"] for metric in catalogue["metrics"]],
                         ["crime", "price-per-square-metre"])
        for metric in catalogue["metrics"]:
            assert_checksum(metric["provenance"]["checksum"])
            self.assertIn(metric["defaultPeriod"], metric["periods"])
            self.assertGreaterEqual(len(metric["legend"]), 2)

    def test_catalogue_periods_come_from_validated_storage(self):
        reader = make_reader(seed_production_fixture())

        crime = next(m for m in reader.list_metrics()["metrics"] if m["id"] == "crime")

        self.assertEqual(len(crime["periods"]), 12)
        self.assertEqual(crime["periods"][0], "2025-07")
        self.assertEqual(crime["defaultPeriod"], "2026-06")

    def test_catalogue_without_active_release_is_unavailable(self):
        connection = seed_production_fixture()
        connection.active_id = None

        with self.assertRaises(ReleaseUnavailable):
            make_reader(connection).list_metrics()

    def test_catalogue_hides_metrics_outside_selected_release(self):
        connection = seed_production_fixture()
        connection.metrics["crime"]["source_release_id"] = NEW_CRIME

        catalogue = make_reader(connection).list_metrics()

        self.assertEqual([metric["id"] for metric in catalogue["metrics"]],
                         ["price-per-square-metre"])


class AreaSearchTests(unittest.TestCase):
    def test_search_finds_area_outside_demo_codes_with_stable_ids(self):
        reader = make_reader(seed_production_fixture())

        first = reader.search_areas("E01000004")
        second = reader.search_areas("camden 001a")

        self.assertEqual(first["schemaVersion"], "area-search.v1")
        self.assertEqual(first["productReleaseId"], OLD_RELEASE)
        self.assertEqual(first["results"][0]["geographyId"], "uk:lsoa:E01000004")
        self.assertEqual(first["results"][0]["geographyId"], second["results"][0]["geographyId"])

    def test_search_rejects_malformed_queries(self):
        reader = make_reader(seed_production_fixture())

        for query in ("", " ", "x"):
            with self.assertRaises(MalformedQuery, msg=query):
                reader.search_areas(query)

    def test_search_bounds_result_limits(self):
        connection = seed_production_fixture()
        for index in range(40):
            code = f"E0900{100 + index}"
            connection.geographies[f"uk:lad:{code}"] = {
                "id": f"uk:lad:{code}", "kind": "lad", "official_code": code,
                "name": f"Limit probe borough {index}", "parent_id": None,
                "center_lon": -0.1, "center_lat": 51.5,
            }
        reader = make_reader(connection)

        results = reader.search_areas("limit probe", limit=200)

        self.assertEqual(len(results["results"]), evidence.MAX_SEARCH_RESULTS)
        _, params = connection.statements[-1]
        self.assertLessEqual(params[-1], evidence.MAX_SEARCH_RESULTS)

    def test_search_without_active_release_is_unavailable(self):
        connection = seed_production_fixture()
        connection.active_id = None

        with self.assertRaises(ReleaseUnavailable):
            make_reader(connection).search_areas("camden")


class AreaDetailTests(unittest.TestCase):
    def test_detail_returns_summary_hierarchy_and_monthly_history(self):
        reader = make_reader(seed_production_fixture())

        detail = reader.get_area("uk:lsoa:E01000004", "crime", "2026-06")

        self.assertEqual(detail["schemaVersion"], "area-summary.v1")
        self.assertEqual(detail["productReleaseId"], OLD_RELEASE)
        self.assertEqual(detail["summary"]["geographyId"], "uk:lsoa:E01000004")
        self.assertEqual(detail["summary"]["value"], 56.0)
        self.assertEqual(detail["parentId"], "uk:msoa:E02000004")
        self.assertEqual(len(detail["metricTimeline"]), 12)
        self.assertEqual(detail["metricTimeline"][0]["period"], "2025-07")
        self.assertTrue(all(row["sourceVersion"] == OLD_CRIME for row in detail["metricTimeline"]))
        self.assertIsNone(detail["bbox"])  # the fixture's areas have no shape

    def test_detail_names_the_areas_box(self):
        # A link naming an area without a position flies there (web area-map): its shape's box.
        connection = seed_production_fixture()
        connection.geographies["uk:lsoa:E01000004"].update(west=-4.80123, south=50.33, east=-4.77, north=50.35)
        detail = make_reader(connection).get_area("uk:lsoa:E01000004", "crime", "2026-06")
        self.assertEqual(detail["bbox"], [-4.8012, 50.33, -4.77, 50.35])

    def test_detail_period_change_selects_matching_summary(self):
        reader = make_reader(seed_production_fixture())

        detail = reader.get_area("uk:lsoa:E01000004", "crime", "2025-07")

        self.assertEqual(detail["summary"]["period"], "2025-07")
        self.assertEqual(detail["summary"]["value"], 57.0)

    def test_detail_reload_is_stable(self):
        reader = make_reader(seed_production_fixture())

        first = reader.get_area("uk:lsoa:E01000004", "crime", "2026-06")
        second = reader.get_area("uk:lsoa:E01000004", "crime", "2026-06")

        self.assertEqual(first, second)

    def test_unknown_area_and_missing_release_are_distinct(self):
        reader = make_reader(seed_production_fixture())

        with self.assertRaises(AreaNotFound):
            reader.get_area("uk:lsoa:E01009999", "crime", "2026-06")
        connection = seed_production_fixture()
        connection.active_id = None
        with self.assertRaises(ReleaseUnavailable):
            make_reader(connection).get_area("uk:lsoa:E01000004", "crime", "2026-06")

    def test_malformed_area_detail_queries(self):
        reader = make_reader(seed_production_fixture())

        with self.assertRaises(MalformedQuery):
            reader.get_area("not-an-id", "crime", "2026-06")
        with self.assertRaises(MetricNotFound):
            reader.get_area("uk:lsoa:E01000004", "noise", "2026-06")
        with self.assertRaises(MalformedQuery):
            reader.get_area("uk:lsoa:E01000004", "crime", "june-2026")
        with self.assertRaises(PeriodNotFound):
            reader.get_area("uk:lsoa:E01000004", "crime", "2019-01")

    def test_missing_values_are_unavailable_never_zero(self):
        reader = make_reader(seed_production_fixture())

        detail = reader.get_area("uk:lsoa:E01000005", "crime", "2026-06")

        self.assertIsNone(detail["summary"]["value"])
        self.assertEqual(detail["summary"]["quality"], "suppressed")
        self.assertIsNone(detail["summary"]["regionPercentile"])
        self.assertEqual(detail["metricTimeline"], [])

    def test_evidence_responses_carry_no_demo_analytics(self):
        connection = seed_production_fixture()
        reader = make_reader(connection)

        detail = reader.get_area("uk:lsoa:E01000004", "crime", "2026-06")

        payload = repr(detail)
        self.assertNotIn("analytics", payload)
        self.assertNotIn("preview", payload)
        for sql, _ in connection.statements:
            self.assertNotIn("analytics", sql)

    def test_cancelled_detail_stops_before_any_query(self):
        connection = seed_production_fixture()
        reader = make_reader(connection)

        with self.assertRaises(Cancelled):
            reader.get_area("uk:lsoa:E01000004", "crime", "2026-06",
                            cancel=lambda: True)

        self.assertEqual(connection.statements, [])


class AreaProfileTests(unittest.TestCase):
    CONTRACT_KEYS = {"schemaVersion", "geographyId", "name", "metrics", "schools", "noise",
                     "friendlyName", "postcodeDistrict", "displayName", "typicalPrices", "regionRanks"}
    SUMMARY_KEYS = {"geographyId", "name", "metricId", "period", "value", "regionPercentile",
                    "countryPercentile", "sampleCount", "breakdown", "quality", "sourceVersion",
                    "carrier", "direction", "percentileMeaning", "carrierGeographyId", "carrierSampleCount"}

    def test_profile_matches_contract_shape(self):
        connection = seed_production_fixture()
        connection.school_counts["uk:lsoa:E01000004"] = (3, 1)
        connection.noise["uk:lsoa:E01000004"] = {
            "dwellings": 420, "road_55_share": 0.41234, "rail_55_share": 0.0,
            "air_55_share": 0.0, "any_55_share": 0.43219, "any_65_share": 0.05, "road_lden_median": 54.2,
            "source_release_id": "defra-noise-2022", "caveats": [], "attribution": "Defra"}

        profile = make_reader(connection).get_profile("uk:lsoa:E01000004", "2026-06")

        self.assertEqual(set(profile), self.CONTRACT_KEYS)
        self.assertEqual(profile["schemaVersion"], "area-profile.v1")
        self.assertEqual(profile["geographyId"], "uk:lsoa:E01000004")
        self.assertEqual(profile["name"], "Camden 001A test area")
        self.assertEqual([m["metricId"] for m in profile["metrics"]], ["price-per-square-metre", "crime"])
        for metric in profile["metrics"]:
            self.assertLessEqual(set(metric), self.SUMMARY_KEYS)
        self.assertEqual(profile["schools"], {"primary": 3, "secondary": 1, "radiusMetres": 1000})
        self.assertEqual(profile["noise"], {"available": True, "any55Share": 0.432})

    def test_profile_london_ranks_are_0_to_100_or_null(self):
        connection = seed_production_fixture()
        reader = make_reader(connection)
        self.assertIsNone(reader.get_profile("uk:lsoa:E01000004", "2026-06")["regionRanks"])  # before 054

        connection.london_ranks = {"uk:lsoa:E01000004": [
            {"rank_id": "quiet", "value": 0.54, "region_percentile": 72, "ranked": 4993, "detail": None,
             "source_release_id": "src-defra-noise", "licence": "OGL-3.0", "attribution": "Defra"},
            {"rank_id": "best-primary", "value": 88.0, "region_percentile": 92, "ranked": 1265,
             "detail": {"urn": "100447", "name": "St Peter and St Paul", "academicYear": "2024/25",
                        "distanceMetres": 831},
             "source_release_id": "src-dfe-ks2", "licence": "OGL-3.0", "attribution": "DfE"}]}
        ranks = reader.get_profile("uk:lsoa:E01000004", "2026-06")["regionRanks"]

        self.assertEqual(ranks["quiet"]["percentile"], 72)
        self.assertEqual(ranks["bestPrimary"]["school"]["name"], "St Peter and St Paul")
        self.assertIsNone(ranks["gettingAround"])
        self.assertIsNone(ranks["greenSpace"])
        for key in ("gettingAround", "quiet", "greenSpace", "bestPrimary"):
            self.assertTrue(ranks[key] is None or 0 <= ranks[key]["percentile"] <= 100)
        self.assertEqual([s["id"] for s in ranks["sources"]], ["src-defra-noise", "src-dfe-ks2"])
        # Ranked among London LSOAs only: wider areas carry none.
        self.assertIsNone(reader.get_profile("uk:msoa:E02000004", "2026-06")["regionRanks"])

    def test_profile_best_secondary_by_attainment_8_within_1_km(self):
        from area_api import school_card

        self.addCleanup(school_card.release_store.use_memory())
        connection = seed_production_fixture()
        pool = [("200001", "secondary", "ks4-attainment8", 41.0, 25.0), ("200002", "secondary", "ks4-attainment8", 63.5, 96.4),
                ("200003", "secondary", "ks4-attainment8", 50.0, 60.0), ("100001", "primary", "ks2-rwm-expected", 80.0, 88.0)]
        connection.school_pool = [{"urn": urn, "phase": phase, "observation_kind": kind, "academic_year": "2024/25",
                                   "value": value, "percentile": pct} for urn, phase, kind, value, pct in pool]
        nearby = [{"urn": "200001", "name": "Near Secondary", "phase": "secondary", "distance_metres": 200},
                  {"urn": "200002", "name": "Best Secondary", "phase": "secondary", "distance_metres": 900},
                  {"urn": "100001", "name": "Only Primary", "phase": "primary", "distance_metres": 300},
                  {"urn": "300009", "name": "Unranked Secondary", "phase": "secondary", "distance_metres": 100}]
        connection.best_school_rows = {"uk:lsoa:E01000004": nearby, "uk:msoa:E02000004": nearby}
        reader = make_reader(connection)

        # Before migration 054 the LSOA still gets both best schools; every other rank stays null.
        ranks = reader.get_profile("uk:lsoa:E01000004", "2026-06")["regionRanks"]
        secondary = ranks["bestSecondary"]
        self.assertEqual(secondary["school"], {"urn": "200002", "name": "Best Secondary", "distanceMetres": 900,
                                               "academicYear": "2024/25"})
        self.assertEqual((secondary["percentile"], secondary["value"], secondary["unit"], secondary["ranked"]),
                         (96, 63.5, "points", 3))
        self.assertTrue(secondary["higherIsBetter"])
        self.assertEqual(ranks["bestPrimary"]["school"]["urn"], "100001")
        self.assertEqual([ranks[k] for k in ("gettingAround", "quiet", "greenSpace")], [None] * 3)
        self.assertEqual(ranks["scope"], "london-lsoa")

        # A neighbourhood answered by its MSOA names the wider area's best schools, not "no rank".
        wider = reader.get_profile("uk:msoa:E02000004", "2026-06")["regionRanks"]
        self.assertEqual(wider["bestSecondary"]["school"]["urn"], "200002")

        # Migration 054's primary wins over the request-time one; no school nearby: null, never a guess.
        connection.london_ranks = {"uk:lsoa:E01000004": [
            {"rank_id": "best-primary", "value": 88.0, "region_percentile": 92, "ranked": 1265,
             "detail": {"urn": "100447", "name": "St Peter", "academicYear": "2024/25", "distanceMetres": 831},
             "source_release_id": "src-dfe-ks2", "licence": "OGL-3.0", "attribution": "DfE"}]}
        self.assertEqual(reader.get_profile("uk:lsoa:E01000004", "2026-06")["regionRanks"]["bestPrimary"]["school"]["urn"],
                         "100447")
        connection.best_school_rows = {}
        ranks = reader.get_profile("uk:lsoa:E01000004", "2026-06")["regionRanks"]
        self.assertIsNone(ranks["bestSecondary"])
        self.assertIsNone(reader.get_profile("uk:msoa:E02000004", "2026-06")["regionRanks"])

    def test_each_metric_takes_its_latest_period_on_or_before_the_request(self):
        reader = make_reader(seed_production_fixture())

        later = reader.get_profile("uk:lsoa:E01000004", "2026-09")
        earlier = reader.get_profile("uk:lsoa:E01000004", "2026-03")

        self.assertEqual([(m["metricId"], m["period"], m["value"]) for m in later["metrics"]],
                         [("price-per-square-metre", "2026-06", 9800.0), ("crime", "2026-06", 56.0)])
        # Price has no period by March 2026: absent, never zero or stale-filled.
        self.assertEqual([(m["metricId"], m["period"], m["value"]) for m in earlier["metrics"]],
                         [("crime", "2026-03", 53.0)])

    def test_missing_values_and_unknown_evidence_are_absent(self):
        connection = seed_production_fixture()
        connection.values.append({
            "geography_id": "uk:lsoa:E01000005", "metric_id": "crime", "period": "2026-06",
            "value": None, "region_percentile": None, "country_percentile": None,
            "sample_count": None, "quality": "suppressed", "source_release_id": OLD_CRIME})

        profile = make_reader(connection).get_profile("uk:lsoa:E01000005", "2026-06")

        self.assertEqual(profile["metrics"], [])
        self.assertIsNone(profile["schools"])
        self.assertEqual(profile["noise"], {"available": False, "any55Share": None})

    def test_a_metric_missing_here_comes_from_the_enclosing_area(self):
        # Income is published per MSOA: an LSOA profile takes its MSOA's value,
        # labelled with the MSOA id and carrier, never as a local figure.
        connection = seed_production_fixture()
        connection.values.append({
            "geography_id": "uk:lsoa:E01000005", "metric_id": "crime", "period": "2026-06",
            "value": None, "region_percentile": None, "country_percentile": None,
            "sample_count": None, "quality": "suppressed", "source_release_id": OLD_CRIME})
        connection.values.append({
            "geography_id": "uk:msoa:E02000004", "metric_id": "crime", "period": "2026-06",
            "value": 61.0, "region_percentile": 70, "country_percentile": None,
            "sample_count": None, "quality": "observed", "source_release_id": OLD_CRIME})

        profile = make_reader(connection).get_profile("uk:lsoa:E01000005", "2026-06")

        self.assertEqual([(m["metricId"], m["geographyId"], m["carrier"], m["value"]) for m in profile["metrics"]],
                         [("crime", "uk:msoa:E02000004", "msoa", 61.0)])

    def _price_inside_camden(self):
        connection = seed_production_fixture()
        connection.values.append({
            "geography_id": "uk:lsoa:E01000005", "metric_id": "price-per-square-metre", "period": "2026-06",
            "value": 9000.0, "region_percentile": 60, "country_percentile": None,
            "sample_count": 30, "quality": "observed", "source_release_id": PRICE_RELEASE})
        return connection

    def test_a_district_or_borough_price_is_the_middle_of_its_neighbourhoods(self):
        # £/m² is published per LSOA only: a wider area takes the middle value of the
        # LSOAs inside it (the area pages' rule), labelled with its own id and carrier.
        reader = make_reader(self._price_inside_camden())

        for area_id, carrier in (("uk:msoa:E02000004", "msoa"), ("uk:lad:E09000007", "lad")):
            price = next(m for m in reader.get_profile(area_id, "9999-12")["metrics"]
                         if m["metricId"] == "price-per-square-metre")
            self.assertEqual((price["geographyId"], price["carrier"], price["period"], price["value"]),
                             (area_id, carrier, "2026-06", 9400.0))
            self.assertIsNone(price["regionPercentile"])
            self.assertEqual(price["areaCount"], 2)  # both LSOA children are observed here

    def test_a_wider_area_detail_carries_its_price_and_trend(self):
        reader = make_reader(self._price_inside_camden())

        price = reader.get_area("uk:lad:E09000007", "price-per-square-metre", "2026-06")
        crime = reader.get_area("uk:msoa:E02000004", "crime", "2026-06")

        self.assertEqual(price["summary"]["value"], 9400.0)
        self.assertEqual(price["summary"]["carrier"], "lad")
        self.assertEqual([(p["period"], p["value"]) for p in price["priceTimeline"]], [("2026-06", 9400.0)])
        self.assertEqual([(p["period"], p["value"]) for p in crime["priceTimeline"]], [("2026-06", 9400.0)])

    def test_typical_home_prices_by_type_come_from_the_area_price_bands(self):
        connection = seed_production_fixture()
        band = {"window_start": "2023-01", "period": "2026-06", "p50": 651_234}
        connection.price_bands = [
            {**band, "geography_id": "uk:lsoa:E01000004", "property_type": "*", "sales": 41},
            {**band, "geography_id": "uk:lsoa:E01000004", "property_type": "F", "sales": 8, "p50": 402_000},
            {**band, "geography_id": "uk:msoa:E02000004", "property_type": "F", "sales": 90, "p50": 455_000},
            {**band, "geography_id": "uk:lad:E09000007", "property_type": "D", "sales": 3, "p50": 2_000_000},
        ]

        typical = make_reader(connection).get_profile("uk:lsoa:E01000004", "9999-12")["typicalPrices"]

        # Each type from the first level with 20 sales; too few anywhere: absent. Rounded to £5k.
        self.assertEqual([(t["propertyType"], t["price"], t["sales"], t["carrier"]) for t in typical],
                         [("all", 650_000, 41, "lsoa"), ("flat", 455_000, 90, "msoa")])
        self.assertEqual((typical[0]["since"], typical[0]["adjustedTo"]), ("2023-01", "2026-06"))

    def test_typical_home_prices_are_empty_before_the_price_bands_exist(self):
        profile = make_reader(seed_production_fixture()).get_profile("uk:lsoa:E01000004", "9999-12")

        self.assertEqual(profile["typicalPrices"], [])

    def test_profile_errors_match_area_detail(self):
        reader = make_reader(seed_production_fixture())

        with self.assertRaises(AreaNotFound):
            reader.get_profile("uk:lsoa:E01009999", "2026-06")
        with self.assertRaises(MalformedQuery):
            reader.get_profile("not-an-id", "2026-06")
        with self.assertRaises(MalformedQuery):
            reader.get_profile("uk:lsoa:E01000004", "june-2026")
        connection = seed_production_fixture()
        connection.active_id = None
        with self.assertRaises(ReleaseUnavailable):
            make_reader(connection).get_profile("uk:lsoa:E01000004", "2026-06")


class ReleaseConsistencyTests(unittest.TestCase):
    def test_activation_switch_moves_every_response_together(self):
        connection = seed_production_fixture()
        connection.sources[NEW_CRIME] = connection.sources[OLD_CRIME]
        connection.values.append({
            "geography_id": "uk:lsoa:E01000004", "metric_id": "crime",
            "period": "2026-06", "value": 61.0,
            "region_percentile": 44, "country_percentile": None,
            "sample_count": None, "quality": "observed",
            "source_release_id": NEW_CRIME, "carrier": "lsoa",
            "name": "Camden 001A test area",
        })
        connection.members[NEW_RELEASE] = [NEW_CRIME, PRICE_RELEASE]
        reader = make_reader(connection)

        before = reader.get_area("uk:lsoa:E01000004", "crime", "2026-06")
        connection.metrics["crime"]["source_release_id"] = NEW_CRIME
        connection.active_id = NEW_RELEASE
        after = reader.get_area("uk:lsoa:E01000004", "crime", "2026-06")

        self.assertEqual(before["productReleaseId"], OLD_RELEASE)
        self.assertEqual(after["productReleaseId"], NEW_RELEASE)
        self.assertEqual(after["summary"]["value"], 61.0)
        self.assertEqual(after["summary"]["geographyId"], before["summary"]["geographyId"])


class ReleaseCacheTests(unittest.TestCase):
    """Period lists scan every row of a metric; they are read once per active release (release_artifact)."""

    def setUp(self):
        self.addCleanup(release_store.use_memory())

    def scans(self, connection, marker):
        return sum(1 for sql, _ in connection.statements if sql.startswith(marker))

    def test_metric_and_periods_are_read_once_per_release(self):
        connection = seed_production_fixture()
        reader = make_reader(connection)
        for _ in range(3):
            reader.get_value_pack("crime", "2026-06")
            reader.list_metrics()
        self.assertEqual(self.scans(connection, "-- evidence:periods"), 1)
        self.assertEqual(self.scans(connection, "-- evidence:metric\n"), 1)
        self.assertEqual(self.scans(connection, "-- evidence:metrics"), 1)

    def test_activating_another_release_refreshes_the_cache(self):
        connection = seed_production_fixture()
        reader = make_reader(connection)
        reader.get_value_pack("crime", "2026-06")
        connection.active_id = "rel-some-later-release"
        try:
            reader.get_value_pack("crime", "2026-06")
        except Exception:
            pass  # the fixture has no members for that release; only the refresh matters
        self.assertGreaterEqual(self.scans(connection, "-- evidence:metric\n"), 2)


class ValuePackTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(release_store.use_memory())  # packs are kept per release (release_artifact)

    def test_pack_conforms_to_schema_and_pins_release(self):
        reader = make_reader(seed_production_fixture())

        pack = reader.get_value_pack("crime", "2026-06")

        self.assertEqual(pack["schemaVersion"], "area-value-pack.v1")
        self.assertEqual(pack["metricId"], "crime")
        self.assertEqual(pack["period"], "2026-06")
        self.assertEqual(pack["sourceVersion"], OLD_CRIME)
        self.assertEqual(pack["productReleaseId"], OLD_RELEASE)
        self.assertEqual(len(pack["values"]), 1)
        self.assertEqual(pack["values"][0]["geographyId"], "uk:lsoa:E01000004")

    def test_metric_values_are_the_packs_numbers_in_one_read(self):
        connection = seed_production_fixture()
        reader = make_reader(connection)

        values = reader.metric_values("crime", ["2026-06", "2026-06"])
        again = reader.metric_values("crime", ["2026-06"])
        pack = reader.get_value_pack("crime", "2026-06")

        self.assertEqual(values["schemaVersion"], "metric-values.v1")
        self.assertEqual(values["productReleaseId"], OLD_RELEASE)
        self.assertEqual(values["values"], {"2026-06": [row["value"] for row in pack["values"] if row["value"] is not None]})
        self.assertEqual(again, values, "built once per release and months")
        self.assertEqual(sum(1 for sql, _ in connection.statements if sql.startswith("-- evidence:pack-values")), 1)
        with self.assertRaises(evidence.PeriodNotFound):
            reader.metric_values("crime", ["1999-06"])
        with self.assertRaises(evidence.MalformedQuery):
            reader.metric_values("crime", [])
        with self.assertRaises(evidence.MalformedQuery):
            reader.metric_values("crime", ["2026-6"])

    def test_pack_values_carry_category_breakdown(self):
        pack = make_reader(seed_production_fixture()).get_value_pack("crime", "2026-06")

        self.assertEqual(
            pack["values"][0]["breakdown"],
            {"Violence and sexual offences": 9, "Shoplifting": 4})

    def test_pack_values_omit_breakdown_when_no_categories_recorded(self):
        connection = seed_production_fixture()
        connection.breakdowns = [
            row for row in connection.breakdowns
            if not (row["geography_id"] == "uk:lsoa:E01000004"
                    and row["metric_id"] == "crime" and row["period"] == "2026-06")]

        pack = make_reader(connection).get_value_pack("crime", "2026-06")

        self.assertNotIn("breakdown", pack["values"][0])

    def test_pack_returns_only_metric_carrier_rows(self):
        connection = seed_production_fixture()
        connection.values.append({
            "geography_id": "uk:lad:E09000007", "metric_id": "crime",
            "period": "2026-06", "value": 5.0,
            "region_percentile": 10, "country_percentile": None,
            "sample_count": 900, "quality": "observed",
            "source_release_id": OLD_CRIME, "carrier": "lad",
            "name": "Camden test borough",
        })
        connection.geographies["uk:lad:E09000007"]["kind"] = "lad"

        pack = make_reader(connection).get_value_pack("crime", "2026-06")

        self.assertEqual(len(pack["values"]), 1)
        self.assertEqual(pack["values"][0]["geographyId"], "uk:lsoa:E01000004")

    def test_pack_rejects_unknown_metric_and_period(self):
        reader = make_reader(seed_production_fixture())

        with self.assertRaises(MetricNotFound):
            reader.get_value_pack("noise", "2026-06")
        with self.assertRaises(PeriodNotFound):
            reader.get_value_pack("crime", "2019-01")

    def test_pack_without_active_release_is_unavailable(self):
        connection = seed_production_fixture()
        connection.active_id = None

        with self.assertRaises(ReleaseUnavailable):
            make_reader(connection).get_value_pack("crime", "2026-06")


class AddressSearchTests(unittest.TestCase):
    def test_search_finds_building_by_postcode_with_sale_count(self):
        results = make_reader(seed_production_fixture()).search_areas("SW1A 1AA")["results"]

        addresses = [row for row in results if row.get("addressId")]
        self.assertEqual(len(addresses), 1)
        self.assertEqual(addresses[0]["addressId"], "uk:addr:a1b2c3d4e5f6")
        self.assertEqual(addresses[0]["geographyId"], "uk:lsoa:E01000004")
        self.assertEqual(addresses[0]["saleCount"], 2)

    def test_search_fills_remainder_with_buildings_within_limit(self):
        results = make_reader(seed_production_fixture()).search_areas("sample", limit=5)["results"]

        self.assertLessEqual(len(results), 5)
        self.assertTrue(any(row.get("addressId") for row in results))

    def test_history_returns_ordered_sales_with_floor_context(self):
        payload = make_reader(seed_production_fixture()).get_address_history("uk:addr:a1b2c3d4e5f6")
        history = payload["history"]

        self.assertEqual(payload["schemaVersion"], "address-history.v1")
        self.assertEqual(history["displayAddress"], "Flat 1, 10 Sample Street, Westminster, London, SW1A 1AA")
        self.assertEqual([txn["nominalPrice"] for txn in history["transactions"]], [280000, 570000])
        self.assertNotIn("pricePerSquareMetre", history["transactions"][1])
        self.assertIsNone(history["transactions"][0]["floorAreaSquareMetres"])
        self.assertIn("achieved", history["estimateDisclaimer"].lower())
        self.assertEqual(history["coordinatesPrecision"], "postcode")

    def test_history_flags_likely_part_share_sales(self):
        # Issue #211: the £107,500 sale two weeks after the £348,635 sale at the
        # same address is flagged as a likely shared-ownership part share.
        connection = seed_production_fixture()
        connection.addresses["uk:addr:00000000e001"] = {
            "id": "uk:addr:00000000e001",
            "display_address": "Flat 18, 7 Waterden Road, London, E20 3AL",
            "postcode": "E20 3AL",
            "geography_id": "uk:lsoa:E01000004",
            "source_release_id": "src-test",
        }
        connection.address_txns += [
            {"address_id": "uk:addr:00000000e001", "date": "2021-04-26", "price": 348635,
             "floor": 51.0, "ppm": 6836.0, "source_release_id": "src-test"},
            {"address_id": "uk:addr:00000000e001", "date": "2021-05-10", "price": 107500,
             "floor": 51.0, "ppm": 2108.0, "source_release_id": "src-test"},
        ]

        txns = make_reader(connection).get_address_history("uk:addr:00000000e001")["history"]["transactions"]

        self.assertEqual([(txn["nominalPrice"], txn["partShareLikely"]) for txn in txns],
                         [(348635, False), (107500, True)])

    def test_history_rejects_unknown_and_malformed_ids(self):
        reader = make_reader(seed_production_fixture())

        with self.assertRaises(AddressNotFound):
            reader.get_address_history("uk:addr:000000000000")
        with self.assertRaises(MalformedQuery):
            reader.get_address_history("not-an-address")

    def test_address_reads_without_active_release_are_unavailable(self):
        connection = seed_production_fixture()
        connection.active_id = None
        reader = make_reader(connection)

        with self.assertRaises(ReleaseUnavailable):
            reader.search_areas("sample")
        with self.assertRaises(ReleaseUnavailable):
            reader.get_address_history("uk:addr:a1b2c3d4e5f6")


class AreaBoxTests(unittest.TestCase):
    """The box index (map_tiles.BOXES_SQL): the map's only read of the shapes besides the area tiles."""

    def setUp(self):
        self.addCleanup(release_store.use_memory())

    def test_every_area_of_a_carrier_with_its_box_cached_per_release(self):
        connection = seed_production_fixture()
        reader = make_reader(connection)

        boxes = reader.area_boxes("lsoa")

        self.assertEqual(reader.area_boxes("lsoa"), boxes)
        self.assertEqual(sum(1 for sql, _ in connection.statements if sql.startswith("-- evidence:area-boxes")), 1)
        self.assertEqual((boxes["schemaVersion"], boxes["carrier"]), ("area-boxes.v1", "lsoa"))
        self.assertEqual(boxes["productReleaseId"], connection.active_id)
        self.assertEqual([area[0] for area in boxes["areas"]], ["uk:lsoa:E01000004", "uk:lsoa:E01000005"])
        self.assertTrue(all(len(area) == 5 and area[1] < area[3] and area[2] < area[4] for area in boxes["areas"]))

    def test_an_unknown_carrier_or_no_active_release_is_refused(self):
        with self.assertRaises(evidence.MalformedQuery):
            make_reader(seed_production_fixture()).area_boxes("street")
        connection = seed_production_fixture()
        connection.active_id = None
        with self.assertRaises(evidence.ReleaseUnavailable):
            make_reader(connection).area_boxes("lsoa")


class BreakdownTests(unittest.TestCase):
    def test_timeline_entries_carry_category_breakdown(self):
        reader = make_reader(seed_production_fixture())

        detail = reader.get_area("uk:lsoa:E01000004", "crime", "2026-06")

        latest = [row for row in detail["metricTimeline"] if row["period"] == "2026-06"][0]
        self.assertEqual(latest["breakdown"],
                         {"Violence and sexual offences": 9, "Shoplifting": 4})
        self.assertEqual(detail["summary"]["breakdown"],
                         {"Violence and sexual offences": 9, "Shoplifting": 4})

    def test_breakdown_is_pinned_to_active_release(self):
        connection = seed_production_fixture()
        connection.breakdowns.append({
            "geography_id": "uk:lsoa:E01000004", "metric_id": "crime",
            "period": "2026-06", "category": "Burglary", "offence_count": 3,
            "source_release_id": NEW_CRIME,
        })
        reader = make_reader(connection)

        detail = reader.get_area("uk:lsoa:E01000004", "crime", "2026-06")

        latest = [row for row in detail["metricTimeline"] if row["period"] == "2026-06"][0]
        self.assertNotIn("Burglary", latest["breakdown"])

    def test_periods_without_breakdown_carry_none(self):
        reader = make_reader(seed_production_fixture())

        detail = reader.get_area("uk:lsoa:E01000004", "crime", "2026-06")

        Saskatoon = [row for row in detail["metricTimeline"] if row["period"] == "2025-07"][0]
        self.assertNotIn("breakdown", Saskatoon)


class CursorCompatibilityTests(unittest.TestCase):
    """Reader methods must accept psycopg cursors, not just row lists."""

    def shaped_reader(self):
        connection = seed_production_fixture()
        connection.cursor_shaped = True
        return make_reader(connection)

    def test_metrics_search_pack_and_detail_accept_cursors(self):
        reader = self.shaped_reader()

        metrics = reader.list_metrics()
        search = reader.search_areas("Camden")
        pack = reader.get_value_pack("crime", "2026-06")
        detail = reader.get_area("uk:lsoa:E01000004", "crime", "2026-06")
        boxes = reader.area_boxes("lsoa")

        self.assertEqual([metric["id"] for metric in metrics["metrics"]],
                         ["crime", "price-per-square-metre"])
        self.assertEqual(len(search["results"]), 4)
        self.assertEqual(len(pack["values"]), 1)
        self.assertEqual(len(detail["metricTimeline"]), 12)
        self.assertEqual(
            detail["summary"]["breakdown"],
            {"Violence and sexual offences": 9, "Shoplifting": 4})
        self.assertEqual(len(boxes["areas"]), 2)


class SearchLabelTests(unittest.TestCase):
    def test_address_labels_drop_the_doubled_town_and_count_sales_in_words(self):
        row = {"address_id": "uk:addr:1", "geography_id": "uk:lsoa:E01002715", "uprn": None, "postcode": "N1 0AA",
               "display_address": "Flat 4, Kinross House Bemerton Estate, London, London, N1 0AA", "sale_count": 1,
               "center_lon": -0.12, "center_lat": 51.54}
        result = evidence._address_result(row)
        self.assertEqual(result["label"], "Flat 4, Kinross House Bemerton Estate, London, N1 0AA")
        self.assertEqual(result["secondaryLabel"], "N1 0AA · 1 recorded sale")
        self.assertEqual(evidence._address_result({**row, "sale_count": 3})["secondaryLabel"], "N1 0AA · 3 recorded sales")
        self.assertEqual(evidence.tidy_address_label("1 Ealing Road, Ealing, London, W5 1LR"), "1 Ealing Road, Ealing, London, W5 1LR")


if __name__ == "__main__":
    unittest.main()

