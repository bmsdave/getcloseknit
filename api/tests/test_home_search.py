"""Home-search tools: plain parameters in, a short varied shortlist with budget fit and links
out; portal links only (never listings); a stateless watch spec."""
import json
import os
import unittest
from pathlib import Path
from unittest import mock

from tests.test_production_evidence import OLD_RELEASE, seed_production_fixture

try:
    from area_api import civic, evidence, home_search, tools, usage
    from area_api.evidence import EvidenceReader
except ImportError:  # pragma: no cover - dependency-free environments
    tools = None

RELEASE = "rel-test"
HOME_LINKS = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "home-listing-links.json"
AREA_LINKS = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "area-listing-links.json"
CRIME = "src-crime-test"
PRICES = "src-prices-test"


def _row(area_id, factor_id, raw_value, utility, source):
    return {"geography_id": area_id, "name": f"Area {area_id[-3:]}", "factor_id": factor_id,
            "raw_value": raw_value, "utility": utility, "unit": "u", "carrier_geography_id": area_id,
            "quality": "observed", "source_release_id": source}


# Four LSOAs: A and B share a neighbourhood (MSOA 1); C is cheap but less safe; D is very expensive.
AREAS = {
    "uk:lsoa:E01000001": {"crime": 10, "price": 8000, "msoa": "uk:msoa:E02000001"},
    "uk:lsoa:E01000002": {"crime": 15, "price": 8100, "msoa": "uk:msoa:E02000001"},
    "uk:lsoa:E01000003": {"crime": 60, "price": 5000, "msoa": "uk:msoa:E02000002"},
    "uk:lsoa:E01000004": {"crime": 5, "price": 20000, "msoa": "uk:msoa:E02000003"},
}


def _match_rows(profile):
    """The evidence a v1 or v2 profile reads (repository.match_sources): crime as a factor or a range on its
    layer (utility = its London percentile), the £/m² level as a factor."""
    from area_api import repository

    sources = repository.match_sources(profile)
    wanted = set(sources["factors"]) | {f"range:{item['layer']}" for item in sources["ranges"]}
    rows = []
    for area_id, facts in AREAS.items():
        for factor in ("crime", "range:crime"):
            if factor in wanted:
                rows.append(_row(area_id, factor, facts["crime"], facts["crime"], CRIME))
        if "market-level" in wanted:
            rows.append(_row(area_id, "market-level", facts["price"], 50, PRICES))
    return rows


def _rent(area_id, monthly, borough="uk:lad:E09000007"):
    return {"geography_id": area_id, "raw_value": monthly, "bedrooms": "2 bedrooms", "carrier_geography_id": borough,
            "period": "2026-08-01", "source_release_id": "src-ons-pipr-2026-09"}


def _match_rows_fallback_affordability(profile):
    """As _match_rows, plus a fallback-quality affordability row per area (the £/m² ballpark)."""
    rows = _match_rows(profile)
    for area_id, facts in AREAS.items():
        rows.append({"geography_id": area_id, "name": f"Area {area_id[-3:]}", "factor_id": "affordability",
                     "raw_value": facts["price"], "utility": 50, "unit": "budget fit",
                     "carrier_geography_id": area_id, "quality": "fallback", "source_release_id": PRICES})
    return rows


def _match_rows_with_stray_suppressed(profile):
    """As _match_rows, plus a suppressed noise row for an area with no crime row: it feeds no component."""
    rows = _match_rows(profile)
    rows.append({"geography_id": "uk:lsoa:E01000009", "name": "Area 009", "factor_id": "noise",
                 "raw_value": None, "utility": 0, "unit": "u", "carrier_geography_id": "uk:lsoa:E01000009",
                 "quality": "suppressed", "source_release_id": "src-noise-test"})
    return rows


class StubReader:
    def __init__(self):
        self.calls = []
        self.rents = {}

    def rent_levels(self, bedrooms, area_ids=None, cancel=None):
        return {area_id: row for area_id, row in self.rents.items() if area_ids is None or area_id in area_ids}

    def area_lookup(self, area_ids, cancel=None):
        self.calls.append(("area_lookup", list(area_ids)))
        places = {}
        for area_id in area_ids:
            if area_id in AREAS:
                places[area_id] = {"geographyId": area_id, "kind": "lsoa", "name": f"Area {area_id[-3:]}",
                                   "parentId": AREAS[area_id]["msoa"], "borough": "Camden",
                                   "center": [-0.14, 51.54], "outcodes": ["NW1", "N7"],
                                   "title": f"Area {area_id[-3:]}", "displayName": f"Area {area_id[-3:]}"}
            elif area_id == "uk:msoa:E02000001":
                # Like the real area_lookup: resolves, but carries no outcodes (LSOAs only).
                places[area_id] = {"geographyId": area_id, "kind": "msoa", "name": "Camden 001",
                                   "parentId": "uk:lad:E09000007", "borough": "Camden",
                                   "center": [-0.14, 51.54], "outcodes": [],
                                   "title": "Camden 001", "displayName": "Camden 001"}
            elif area_id == "uk:lad:E09000030":
                places[area_id] = {"geographyId": area_id, "kind": "borough", "name": "Tower Hamlets",
                                   "parentId": None, "borough": "Tower Hamlets",
                                   "center": [-0.02, 51.52], "outcodes": [],
                                   "title": "Tower Hamlets", "displayName": "Tower Hamlets"}
        return {"schemaVersion": "area-lookup.v1", "productReleaseId": RELEASE, "places": places}

    def list_metrics(self, cancel=None):
        def metric(metric_id, release, name="Source"):
            return {"id": metric_id, "periods": ["2026-05", "2026-06"],
                    "provenance": {"sourceId": f"src-{metric_id}", "sourceName": name,
                                   "sourceUrl": f"https://example.org/{metric_id}",
                                   "release": release, "licence": "OGL-UK-3.0",
                                   "attribution": f"Contains {name} data",
                                   "transformationVersion": "etl-1"},
                    "methodologyPath": f"/methodology/{metric_id}", "caveats": []}
        return {"productReleaseId": RELEASE,
                "metrics": [metric("price-per-square-metre", PRICES, "HM Land Registry Price Paid"),
                            metric("crime", CRIME, "Police UK"),
                            metric("station-access", "src-osm-test", "OpenStreetMap")]}

    def get_area(self, area_id, metric_id, period, cancel=None):
        quality = getattr(self, "timeline_quality", None)
        return {"metricTimeline": [{"period": "2026-05", "value": 7900.4, "quality": quality},
                                   {"period": "2026-06", "value": None, "quality": quality},
                                   {"period": period, "value": 8000.0, "quality": quality}]}

    def get_area_pack(self, area_id, address_id=None, cancel=None):
        return {"productReleaseId": RELEASE, "geographyId": area_id, "name": f"Area {area_id[-3:]}",
                "market": {"available": True, "salesCount": 12, "turnoverPercent": 3.1,
                           "leaseholdShareOfSales": 0.5, "growth": {"growth1y": 2.0},
                           "periodEnd": "2026-06-30", "salesWindowMonths": 36, "priceWindowMonths": 36,
                           "minimumSample": 5,
                           "newBuild": {"medianPricePerSquareMetre": 9000, "sampleSize": 10},
                           "resale": {"medianPricePerSquareMetre": 8000, "sampleSize": 10},
                           "sourceVersion": "src-sales"},
                "crime": {"value": 40, "sourceVersion": CRIME},
                "noise": {"any55Share": 0.2, "sourceVersion": "src-noise"},
                "schools": {"count": 4, "primary": 3, "secondary": 1, "nearest": [
                    {"name": "School", "sourceVersion": "src-ofsted"}]}}

    def search_areas(self, q, limit=10, cancel=None):
        return {"productReleaseId": RELEASE, "results": [
            {"geographyId": "uk:lad:E09000007", "label": "Camden", "secondaryLabel": "Borough"},
            {"addressId": "uk:addr:aaaaaaaaaaaa", "geographyId": "uk:lsoa:E01000001",
             "label": "1 Test Street, London, NW1 1AA", "secondaryLabel": "NW1 1AA · 2 recorded sales",
             "postcode": "NW1 1AA"}]}

    def postcode_area(self, postcode, cancel=None):
        code = civic.normalise_postcode(postcode)
        if code == "NW1 1AA":
            return {"postcode": code, "geographyId": "uk:lsoa:E01000001",
                    "resolvedBy": "recorded-address", "productReleaseId": RELEASE}
        raise civic.PostcodeNotFound(f"postcode {code} is not in Close Knit's London coverage")

    def search_stations(self, q, cancel=None):
        return {"results": [{"stationId": "osm:n1", "name": "Camden Town", "modes": ["underground"],
                             "center": [-0.14, 51.54]}]}

    def get_similar_areas(self, area_id, cheaper=False, cancel=None):
        return {"productReleaseId": RELEASE, "name": "Area 001",
                "factors": ["crime", "market-level"], "values": [
                    {"geographyId": "uk:lsoa:E01000003", "name": "Area 003", "similarity": 91.2,
                     "components": [{"factorId": "market-level", "rawValue": 5000, "unit": "£/m²", "utility": 70},
                                    {"factorId": "crime", "rawValue": 60, "unit": "per 1,000", "utility": 40}]}]}


class _FakeZoneConnection:
    """Stands in for a DB connection in the #217/#218 tests: knows fixed stations,
    boroughs and area ids; anything else is unknown."""
    def __init__(self, stations=(), boroughs=(), areas=()):
        self.stations = set(stations)
        self.boroughs = set(boroughs)
        self.areas = dict(areas)

    def execute(self, sql, params=()):
        if "evidence:known-stations" in sql:
            return [{"id": s} for s in self.stations if s in params[0]]
        if "evidence:known-boroughs" in sql:
            return [{"id": b} for b in self.boroughs if b in params[0]]
        if "evidence:known-geographies" in sql:
            return [{"id": i} for i in params[0] if i in self.areas]
        if "evidence:expand-area-ids" in sql:
            lsoas, msoas, boroughs = (set(p) for p in params)
            return [{"geography_id": i} for i, kind in self.areas.items()
                    if kind == "lsoa" and (i in lsoas or _parent(i) in msoas
                                           or _parent(_parent(i)) in boroughs)]
        raise AssertionError(f"unexpected SQL: {sql[:60]}")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _parent(area_id):
    return {"uk:lsoa:E01000001": "uk:msoa:E02000001", "uk:lsoa:E01000002": "uk:msoa:E02000001",
            "uk:lsoa:E01000003": "uk:msoa:E02000002", "uk:lsoa:E01000004": "uk:msoa:E02000003",
            "uk:msoa:E02000001": "uk:lad:E09000007", "uk:msoa:E02000002": "uk:lad:E09000008",
            "uk:msoa:E02000003": "uk:lad:E09000008"}.get(area_id)


# The fixture areas with their MSOA/borough parents for the #218 expansion tests.
EXPANSION_AREAS = {
    "uk:lsoa:E01000001": "lsoa", "uk:lsoa:E01000002": "lsoa",
    "uk:lsoa:E01000003": "lsoa", "uk:lsoa:E01000004": "lsoa",
    "uk:msoa:E02000001": "msoa", "uk:msoa:E02000002": "msoa", "uk:msoa:E02000003": "msoa",
    "uk:lad:E09000007": "borough", "uk:lad:E09000008": "borough",
}


@unittest.skipIf(tools is None, "pydantic is not installed")
class FindAreasTests(unittest.TestCase):
    def setUp(self):
        self.reader = StubReader()
        self.context = tools.ToolContext(reader=self.reader, load_match_rows=_match_rows,
                                         load_zone_lsoas=lambda zones: None)

    def find(self, **arguments):
        arguments = {"max_budget": 600_000, "bedrooms": 2,
                     "priorities": [{"factor": "crime", "importance": 4}], **arguments}
        return tools.call_tool("find_areas", self.context, arguments)

    def test_shortlist_is_ranked_varied_and_priced(self):
        out = self.find()

        areas = out["value"]["areas"]
        self.assertEqual(out["schemaVersion"], "tool-find-areas.v1")
        # D is over budget (20000 £/m² × 70 m²); B shares A's neighbourhood.
        self.assertEqual([a["geographyId"] for a in areas], ["uk:lsoa:E01000001", "uk:lsoa:E01000003"])
        self.assertEqual([a["rank"] for a in areas], [1, 2])
        first = areas[0]
        self.assertEqual(first["estimatedPrice"], 560_000)
        self.assertEqual(first["budgetFit"], "within")
        self.assertEqual(first["borough"], "Camden")
        self.assertEqual(first["outcodes"], ["NW1", "N7"])
        # The budget leads the order (no price row here: half a fit for every area), then crime.
        self.assertEqual([f["factorId"] for f in first["factors"]], ["range:crime"])
        self.assertEqual(first["factors"][0]["fitKind"], "in")
        self.assertEqual(first["why"], ["range:crime"])
        self.assertEqual([c["id"] for c in out["value"]["criteria"]], ["affordability", "range:crime"])
        self.assertIn("#profile=v3.", first["links"]["map"])
        self.assertEqual({row["geographyId"] for row in out["evidence"]}, {a["geographyId"] for a in areas})

    def test_shortlist_links_to_my_match_on_the_map(self):
        out = self.find(property_type="house",
                        priorities=[{"factor": "crime", "importance": 4}, {"factor": "station-access", "importance": 2}])

        value = out["value"]
        self.assertEqual(value["profile"]["propertyType"], "house")
        self.assertEqual(value["briefUrl"], home_search.share_links.map_url(value["profile"], value["areas"][0]["geographyId"]))
        self.assertIn("layer=personal-match", value["briefUrl"])

    def test_over_budget_areas_can_be_kept_and_rejected_areas_are_dropped(self):
        zones = _FakeZoneConnection(areas={"uk:lsoa:E01000001": "lsoa"})
        with mock.patch("area_api.repository.evidence_connection", return_value=zones):
            out = self.find(include_over_budget=True, exclude_area_ids=["uk:lsoa:E01000001"])

        ids = [a["geographyId"] for a in out["value"]["areas"]]
        self.assertEqual(ids[0], "uk:lsoa:E01000004")
        self.assertNotIn("uk:lsoa:E01000001", ids)
        self.assertEqual(out["value"]["areas"][0]["budgetFit"], "over")

    def test_fallback_affordability_plus_observed_crime_reads_medium(self):
        """Issue #198: confidence is the weakest band of the returned components, not 'high'."""
        context = tools.ToolContext(reader=self.reader, load_match_rows=_match_rows_fallback_affordability,
                                    load_zone_lsoas=lambda zones: None)
        out = tools.call_tool("find_areas", context, {"max_budget": 600_000, "bedrooms": 2,
                                                      "priorities": [{"factor": "crime", "importance": 4}]})

        self.assertEqual(out["confidence"], "medium")
        qualities = {component["factorId"]: component["quality"] for component in out["evidence"]}
        self.assertEqual(qualities["affordability"], "fallback")
        self.assertEqual(qualities["range:crime"], "observed")

    def test_an_area_without_crime_data_says_crime_was_not_scored(self):
        # No crime is published for Greater Manchester: such an area is ranked with crime as half a fit, and
        # find_areas says so on its row and in the caveats, like My match on the website.
        def rows(profile):
            return [row for row in _match_rows_fallback_affordability(profile)
                    if not (row["geography_id"] == "uk:lsoa:E01000003" and "crime" in row["factor_id"])]
        context = tools.ToolContext(reader=self.reader, load_match_rows=rows, load_zone_lsoas=lambda zones: None)
        out = tools.call_tool("find_areas", context, {"max_budget": 600_000, "bedrooms": 2,
                                                      "priorities": [{"factor": "crime", "importance": 4}]})

        areas = {area["geographyId"]: area for area in out["value"]["areas"]}
        self.assertEqual(areas["uk:lsoa:E01000003"]["notScored"], [
            {"criterionId": "range:crime", "name": "crime", "reason": "no-data", "text": "not scored: crime (no data)"}])
        self.assertEqual(areas["uk:lsoa:E01000001"]["notScored"], [])
        self.assertIn("Not scored: crime (no data) for 1 of 2 areas (Area 003); it counts as half a fit there, "
                      "so say so.", out["caveats"])

    def test_suppressed_row_feeding_no_component_does_not_drag_match_confidence(self):
        """Issue #198: match_areas confidence comes from the returned areas' components."""
        context = tools.ToolContext(reader=self.reader, load_match_rows=_match_rows_with_stray_suppressed,
                                    load_zone_lsoas=lambda zones: None)
        profile = home_search.build_profile(home_search.FindAreasInput(
            max_budget=600_000, bedrooms=2, priorities=[{"factor": "crime", "importance": 4}]))
        out = tools.call_tool("match_areas", context, {"profile": profile})

        self.assertEqual(out["confidence"], "high")

    def test_a_station_zone_carries_the_station_name_for_the_shared_search(self):
        """G-E25: the briefUrl's banner reads "Within 20 min walk of East Didsbury", never its osm id."""
        args = home_search.FindAreasInput(max_budget=400_000, bedrooms=2, priorities=[{"factor": "crime", "importance": 4}],
                                          near_stations=[{"station_id": "osm:n21551301", "max_walk_minutes": 20}])
        named = home_search.build_profile(args, {"osm:n21551301": "East Didsbury"})
        zone = next(item for item in named["criteria"] if item["kind"] == "where")["zones"][0]
        self.assertEqual(zone["label"], "East Didsbury")
        bare = home_search.build_profile(args)
        self.assertNotIn("label", next(item for item in bare["criteria"] if item["kind"] == "where")["zones"][0])

    def test_missing_rent_never_outranks_known_over_budget_rents(self):
        # #216: ONS PIPR publishes no City of London figure, so E01000003 has no rent
        # row (budgetFit "unknown", half a fit) while every known rent is over budget.
        # The unknown area must not win the shortlist; the answer says so plainly.
        self.reader.rents = {
            "uk:lsoa:E01000001": _rent("uk:lsoa:E01000001", 2000),
            "uk:lsoa:E01000002": _rent("uk:lsoa:E01000002", 2100),
            "uk:lsoa:E01000004": _rent("uk:lsoa:E01000004", 2424),
        }
        out = self.find(market="rent", max_budget=500, bedrooms=2, top_n=5,
                        priorities=[{"factor": "crime", "importance": 4}])

        self.assertEqual(out["value"]["areas"], [])
        self.assertTrue(any("No borough's average 2-bed rent is within £500/month" in caveat
                            and "cheapest known average is £2,000/month" in caveat
                            for caveat in out["caveats"]),
                        out["caveats"])

    def test_missing_rent_ranks_last_when_over_budget_areas_are_kept(self):
        # #216 with include_over_budget: the area with no rent figure ranks after every
        # area whose rent is known, never first.
        self.reader.rents = {
            "uk:lsoa:E01000001": _rent("uk:lsoa:E01000001", 2000),
            "uk:lsoa:E01000002": _rent("uk:lsoa:E01000002", 2100),
            "uk:lsoa:E01000004": _rent("uk:lsoa:E01000004", 2424),
        }
        out = self.find(market="rent", max_budget=500, bedrooms=2, top_n=5,
                        include_over_budget=True,
                        priorities=[{"factor": "crime", "importance": 4}])

        areas = out["value"]["areas"]
        self.assertGreater(len(areas), 1)
        self.assertEqual(areas[-1]["geographyId"], "uk:lsoa:E01000003")
        self.assertEqual(areas[-1]["budgetFit"], "unknown")
        self.assertTrue(any("cheapest known average is £2,000/month" in caveat
                            for caveat in out["caveats"]),
                        out["caveats"])

    def test_borough_and_msoa_exclusions_expand_to_lsoas(self):
        # #218: borough and MSOA ids in exclude_area_ids were silently ignored.
        zones = _FakeZoneConnection(areas=EXPANSION_AREAS)
        with mock.patch("area_api.repository.evidence_connection", return_value=zones):
            excluded = self.find(exclude_area_ids=["uk:lad:E09000008", "uk:msoa:E02000002"])
            plain = self.find()
        excluded_ids = {a["geographyId"] for a in excluded["value"]["areas"]}
        plain_ids = {a["geographyId"] for a in plain["value"]["areas"]}
        self.assertNotIn("uk:lsoa:E01000003", excluded_ids)
        self.assertNotIn("uk:lsoa:E01000004", excluded_ids)
        self.assertIn("uk:lsoa:E01000003", plain_ids)  # the exclusion changed the answer
        # The profile still echoes the ids as given.
        self.assertEqual(excluded["value"]["profile"]["marks"]["excluded"],
                         ["uk:lad:E09000008", "uk:msoa:E02000002"])

    def test_unknown_excluded_area_id_is_rejected(self):
        zones = _FakeZoneConnection(areas=EXPANSION_AREAS)
        with mock.patch("area_api.repository.evidence_connection", return_value=zones):
            with self.assertRaises(evidence.MalformedQuery) as raised:
                self.find(exclude_area_ids=["uk:lsoa:E09999999"])
        self.assertIn("uk:lsoa:E09999999", str(raised.exception))

    def test_expand_area_ids_unit(self):
        from area_api import repository
        expanded, unknown = repository.expand_area_ids(
            _FakeZoneConnection(areas=EXPANSION_AREAS),
            ["uk:lad:E09000008", "uk:lsoa:E01000001"])
        self.assertEqual(expanded, {"uk:lsoa:E01000001", "uk:lsoa:E01000003", "uk:lsoa:E01000004"})
        self.assertEqual(unknown, set())
        _, unknown = repository.expand_area_ids(
            _FakeZoneConnection(areas=EXPANSION_AREAS), ["uk:lsoa:E09999999"])
        self.assertEqual(unknown, {"uk:lsoa:E09999999"})

    def test_unknown_range_layer_is_rejected(self):
        # #217: a typo'd layer silently scored the criterion as missing data.
        with self.assertRaises(evidence.MalformedQuery) as raised:
            self.find(ranges=[{"layer": "no-such-layer", "max": 20}])
        self.assertIn("no-such-layer", str(raised.exception))
        with self.assertRaises(evidence.MalformedQuery):
            self.find(ranges=[{"layer": "air-quality", "max": 20}])

    def test_known_factor_layer_still_accepted(self):
        out = self.find(ranges=[{"layer": "noise", "max": 50}])
        self.assertTrue(out["value"]["areas"])

    def test_unknown_station_and_borough_ids_are_rejected(self):
        # #217: unknown ids silently matched nothing (scoredAreas 0, no error).
        zones = _FakeZoneConnection(stations={"osm:n1"}, boroughs={"uk:lad:E09000007"})
        with mock.patch("area_api.repository.evidence_connection", return_value=zones):
            with self.assertRaises(evidence.MalformedQuery) as raised:
                self.find(near_stations=[{"station_id": "osm:n999999"}])
            self.assertIn("osm:n999999", str(raised.exception))
            with self.assertRaises(evidence.MalformedQuery) as raised:
                self.find(boroughs=["uk:lad:E09999999"])
            self.assertIn("uk:lad:E09999999", str(raised.exception))
            # Known ids pass validation.
            out = self.find(near_stations=[{"station_id": "osm:n1"}], only_in_zones=False)
            self.assertIn("areas", out["value"])

    def test_a_full_shortlist_has_no_emptied_by(self):
        out = self.find()
        self.assertIsNone(out["value"]["emptiedBy"])

    def test_empty_shortlist_names_the_budget_that_emptied_it(self):
        # #242: every area was over budget, but the reply only said areas [].
        out = self.find(max_budget=50_000)
        self.assertEqual(out["value"]["areas"], [])
        self.assertEqual(out["value"]["emptiedBy"], {"constraint": "budget", "kind": "budget", "areasBefore": 4})
        self.assertTrue(any("include_over_budget" in c for c in out["caveats"]))

    def test_empty_shortlist_names_the_must_filter_that_emptied_it(self):
        out = self.find(priorities=[], ranges=[{"layer": "crime", "max": 1, "scale": "value", "must": True}])
        self.assertEqual(out["value"]["areas"], [])
        self.assertEqual(out["value"]["emptiedBy"], {"constraint": "range:crime", "kind": "must", "areasBefore": 4})
        self.assertTrue(any("range:crime" in c and "4 areas" in c for c in out["caveats"]))

    def test_empty_shortlist_names_the_exclude_list_that_emptied_it(self):
        zones = _FakeZoneConnection(areas=EXPANSION_AREAS)
        with mock.patch("area_api.repository.evidence_connection", return_value=zones):
            out = self.find(exclude_area_ids=list(AREAS))
        self.assertEqual(out["value"]["emptiedBy"], {"constraint": "exclude_area_ids", "kind": "exclude", "areasBefore": 4})

    def test_emptied_by_is_the_first_constraint_that_reached_zero(self):
        # Constraints apply in order: the exclude list leaves two areas, the budget drops those.
        zones = _FakeZoneConnection(areas=EXPANSION_AREAS)
        with mock.patch("area_api.repository.evidence_connection", return_value=zones):
            out = self.find(max_budget=50_000, exclude_area_ids=["uk:lsoa:E01000001", "uk:lsoa:E01000002"])
        self.assertEqual(out["value"]["emptiedBy"], {"constraint": "budget", "kind": "budget", "areasBefore": 2})

    def test_range_example_uses_value_scale_and_an_unflagged_layer(self):
        # #219: a bound in the layer's own unit needs scale 'value'. The example avoids air-no2: the LAEI layer
        # is withheld on /mcp until the GLA's OK, so assistants would be told to use a layer that errors.
        from area_api import guidance
        description = home_search.FindAreasInput.model_fields["ranges"].description
        self.assertIn("{layer: 'broadband-gigabit', scale: 'value', min: 90}", description)
        self.assertIn('{layer: "broadband-gigabit", scale: "value", min: 90}', guidance.INSTRUCTIONS)
        self.assertNotIn("air-no2", description + guidance.INSTRUCTIONS)

    def test_air_range_adds_the_laei_caveat(self):
        # #219: no LAEI caveat or attribution was added when air-no2 was used.
        profile = home_search.build_profile(home_search.FindAreasInput(
            max_budget=600_000, ranges=[{"layer": "air-no2", "scale": "value", "max": 40}]))
        caveats = home_search._quick_caveats(profile)
        self.assertTrue(any("London Atmospheric Emissions Inventory 2022" in caveat
                            for caveat in caveats), caveats)

    def test_range_factor_row_echoes_scale(self):
        # #219: the factor row did not say whether the bound was a value or a percentile.
        from area_api.matching import build_match_pack
        profile = {
            "schemaVersion": "preference-profile.v2", "market": "buy",
            "targetBudget": 600_000, "maximumBudget": 600_000,
            "criteria": [
                {"kind": "budget", "must": False},
                {"kind": "range", "layer": "air-no2", "scale": "value", "min": None, "max": 40,
                 "softMin": None, "softMax": None, "must": False},
            ],
        }
        rows = [{
            "geography_id": "uk:lsoa:E01000001", "name": "Probe", "factor_id": "range:air-no2",
            "raw_value": 19.1, "utility": None, "unit": "µg/m³",
            "carrier_geography_id": "uk:lsoa:E01000001", "quality": "observed",
            "source_release_id": "src-gla-laei-layer-test",
        }]
        pack = build_match_pack(profile, rows)
        component = pack["values"][0]["components"][0]
        self.assertEqual(component["factorId"], "range:air-no2")
        self.assertEqual(component["scale"], "value")

    def test_default_target_is_the_sites_own_rule(self):
        # v4.4: an agent's link and a typed budget read the same figures (web lib/match-search.ts budgetFromMaximum).
        self.assertEqual(home_search.default_target_budget(650_000, "buy"), 600_000)
        self.assertEqual(home_search.default_target_budget(570_000, "buy"), 525_000)
        self.assertEqual(home_search.default_target_budget(2_500, "rent"), 2_300)
        self.assertEqual(home_search.default_target_budget(40, "rent"), 40)

    def test_profile_translates_plain_answers(self):
        args = home_search.FindAreasInput(
            max_budget=600_000, bedrooms=3, priorities=[{"factor": "noise", "importance": 2},
                                                        {"factor": "station-access", "importance": 5}],
            near_stations=[{"station_id": "osm:n119274464", "max_walk_minutes": 20}],
            boroughs=["uk:lad:E09000007"])

        profile = home_search.build_profile(args)

        self.assertEqual(profile["schemaVersion"], "preference-profile.v2")
        self.assertEqual(profile["targetBudget"], 550_000)  # the site's rule: max less 8%, to £5k (v4.4)
        # Ordered by importance, then as given; Where (the zones, a must by default) leads.
        self.assertEqual([(c["kind"], c.get("layer"), c["must"]) for c in profile["criteria"]],
                         [("where", None, True), ("budget", None, False), ("range", "station-access", False),
                          ("range", "noise", False)])
        self.assertEqual({key: profile["criteria"][3][key] for key in ("scale", "max", "softMax")},
                         {"scale": "percentile", "max": 50, "softMax": 75})
        # Household income and social renting are not match criteria (matching.RETIRED_FACTOR_IDS).
        for retired in ("income", "social-renting"):
            with self.assertRaises(Exception):
                home_search.FindAreasInput(max_budget=600_000, priorities=[{"factor": retired, "importance": 3}])
        # The official deprivation decile is (1 = most deprived): by default the household prefers a higher decile.
        deprivation = home_search.build_profile(home_search.FindAreasInput(
            max_budget=600_000, priorities=[{"factor": "deprivation", "importance": 3}]))
        self.assertIn(("deprivation", 50, 25), [(c.get("layer"), c.get("min"), c.get("softMin")) for c in deprivation["criteria"]])
        self.assertEqual(profile["criteria"][0]["zones"], [
            {"kind": "station", "stationId": "osm:n119274464", "maxWalkMinutes": 20},
            {"kind": "borough", "id": "uk:lad:E09000007"}])

    def test_places_and_marks_go_into_the_profile_and_the_link(self):
        args = home_search.FindAreasInput(
            max_budget=600_000, priorities=[{"factor": "crime", "importance": 3}],
            places=[{"label": "Gym", "latitude": 51.53, "longitude": -0.1, "mode": "walk", "max_minutes": 15},
                    {"label": "Gym", "latitude": 51.54, "longitude": -0.11}, {"label": "Gym", "category": "park"}],
            liked_area_ids=["uk:lsoa:E01000003"], exclude_area_ids=["uk:lsoa:E01000004"])

        profile = home_search.build_profile(args)
        profile["places"] = [c for c in profile["criteria"] if c["kind"] == "place"]

        self.assertEqual([p["id"] for p in profile["places"]], ["gym", "gym-2", "gym-3"])
        labelled = home_search.build_profile(home_search.FindAreasInput(
            max_budget=800000, priorities=[{"factor": "crime", "importance": 3}],
            places=[{"label": "My office (King's Cross)", "latitude": 51.53, "longitude": -0.12}]))
        self.assertEqual([c for c in labelled["criteria"] if c["kind"] == "place"][0]["id"], "my-office-king-s-c")
        self.assertEqual([p["mode"] for p in profile["places"]], ["walk", "transit", "walk"])
        self.assertEqual(profile["places"][2]["target"], {"kind": "category", "category": "park"})
        self.assertEqual(profile["marks"], {"liked": ["uk:lsoa:E01000003"], "excluded": ["uk:lsoa:E01000004"], "notes": {}})
        with self.assertRaises(evidence.MalformedQuery):
            home_search.build_profile(home_search.FindAreasInput(
                max_budget=600_000, priorities=[{"factor": "crime", "importance": 3}], places=[{"label": "Nowhere"}]))

    def test_a_shared_link_reopens_the_same_search(self):
        profile = home_search.build_profile(home_search.FindAreasInput(
            max_budget=600_000, bedrooms=2, priorities=[{"factor": "crime", "importance": 4}],
            places=[{"label": "Any park", "category": "park"}], liked_area_ids=["uk:lsoa:E01000001"]))
        profile["marks"]["notes"] = {"uk:lsoa:E01000001": "Viewing Saturday"}
        link = home_search.share_links.map_url(profile)

        out = tools.call_tool("open_shared_search", self.context, {"link": link, "top_n": 2})

        self.assertEqual(out["schemaVersion"], "tool-open-shared-search.v1")
        self.assertEqual(out["value"]["profile"], profile)
        self.assertEqual(out["value"]["search"]["notes"], {"uk:lsoa:E01000001": "Viewing Saturday"})
        self.assertEqual(out["value"]["search"]["places"][0]["label"], "Any park")
        with self.assertRaises(evidence.MalformedQuery):
            tools.call_tool("open_shared_search", self.context, {"link": "https://example.org/nothing-here"})

    def test_rentals_have_no_price_estimate(self):
        out = self.find(market="rent", max_budget=2500)

        self.assertTrue(all(a["budgetFit"] == "unknown" for a in out["value"]["areas"]))
        self.assertTrue(any("rental" in caveat for caveat in out["caveats"]))

    def test_rentals_read_the_borough_average_rent_with_referencing_and_rra_caveats(self):
        self.reader.rents = {area_id: _rent(area_id, 2232) for area_id in AREAS}
        self.reader.rents["uk:lsoa:E01000004"] = _rent("uk:lsoa:E01000004", 4000)
        out = self.find(market="rent", max_budget=2500)

        areas = out["value"]["areas"]
        self.assertNotIn("uk:lsoa:E01000004", [a["geographyId"] for a in areas])  # over budget, left out
        first = areas[0]
        self.assertEqual((first["estimatedPrice"], first["budgetFit"]), (2232, "within"))
        self.assertEqual(first["estimatedRent"], {"monthly": 2232, "basis": "borough-average", "bedrooms": "2 bedrooms",
                                                  "boroughId": "uk:lad:E09000007", "period": "2026-08",
                                                  "sourceVersion": "src-ons-pipr-2026-09"})
        caveats = " ".join(out["caveats"])
        self.assertIn("30×", caveats)
        self.assertIn("one month's rent in advance", caveats)
        self.assertIn("never the rent of a particular home", caveats)
        # affordability is not a priority here, so the rent release is cited from the ballpark itself
        self.assertIn({"release": "src-ons-pipr-2026-09"}, out["sources"])

    def test_rent_estimate_fit_bands(self):
        row = _rent("uk:lsoa:E01000001", 2800)
        self.assertEqual(home_search.price_estimate(None, 2, "rent", 2500, monthly_rent=row)["budgetFit"], "stretch")
        self.assertEqual(home_search.price_estimate(None, 2, "rent", 2000, monthly_rent=row)["budgetFit"], "over")
        self.assertEqual(home_search.price_estimate(5000, 2, "rent", 2000)["budgetFit"], "unknown")

    def test_bad_input_is_rejected_before_any_read(self):
        with self.assertRaises(tools.InvalidToolArguments):
            self.find(priorities=[{"factor": "schools", "importance": 3}])
        with self.assertRaises(evidence.MalformedQuery):
            self.find(priorities=[{"factor": "crime", "importance": 3}, {"factor": "crime", "importance": 1}])
        self.assertEqual(self.reader.calls, [])


@unittest.skipIf(tools is None, "pydantic is not installed")
class HomeSearchToolTests(unittest.TestCase):
    def setUp(self):
        self.context = tools.ToolContext(reader=StubReader(), load_match_rows=_match_rows)

    def call(self, tool, **arguments):
        return tools.call_tool(tool, self.context, arguments)

    def test_portal_links_use_checked_url_formats(self):
        buy = home_search.portal_links("nw1", "buy", 600_000, 2)
        rent = home_search.portal_links("NW1", "rent", 2500, 1)

        self.assertEqual(buy["rightmove"],
                         "https://www.rightmove.co.uk/property-for-sale/NW1.html?maxPrice=600000&minBedrooms=2")
        self.assertEqual(buy["zoopla"],
                         "https://www.zoopla.co.uk/for-sale/property/nw1/?price_max=600000&beds_min=2&q=NW1")
        self.assertNotIn("openrent", buy)
        self.assertEqual(rent["openrent"],
                         "https://www.openrent.co.uk/properties-to-rent/nw1?prices_max=2500&bedrooms_min=1")

    def test_home_listing_links_match_the_shared_fixture(self):
        # The map's home card builds the same links (web/src/lib/listing-links.ts).
        for case in json.loads(HOME_LINKS.read_text())["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(home_search.home_listing_links(case["postcode"]), case["links"])

    def test_area_listing_links_match_the_shared_fixture(self):
        # The shortlist card and area page build the same (web/src/lib/listing-links.ts areaListingLinks).
        for case in json.loads(AREA_LINKS.read_text())["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(home_search.portal_links(case["outcode"], case["market"], case["maxPrice"],
                                                          case["minBedrooms"]), case["links"])
                self.assertEqual(usage.go_target("rightmove", {"kind": "sold", "outcode": case["outcode"]}),
                                 case["sold"])

    def test_listing_links_group_areas_by_postcode_district(self):
        out = self.call("get_listing_search_links", area_ids=["uk:lsoa:E01000001", "uk:lsoa:E01000002",
                                                              "uk:lsoa:E01999999"], max_price=600_000)

        searches = out["value"]["searches"]
        self.assertEqual([s["outcode"] for s in searches], ["NW1"])
        self.assertEqual(searches[0]["areaIds"], ["uk:lsoa:E01000001", "uk:lsoa:E01000002"])
        self.assertTrue(any("E01999999" in caveat for caveat in out["caveats"]))

    def test_assess_listing_compares_with_local_prices(self):
        out = self.call("assess_listing", postcode="nw11aa", asking_price=700_000, floor_area_sqm=70,
                        tenure="leasehold", listing_url="https://example.org/listing/1")

        value = out["value"]
        self.assertEqual(value["listing"]["postcode"], "NW1 1AA")
        self.assertEqual(value["area"]["geographyId"], "uk:lsoa:E01000001")
        self.assertEqual(value["price"]["askingPerSqm"], 10_000)
        self.assertEqual(value["price"]["differencePercent"], 25.0)
        self.assertEqual(value["price"]["verdict"], "above-local")
        self.assertTrue(any("lease" in q for q in value["questions"]))
        self.assertTrue(out["caveats"][0].startswith("Compares the asking price with recorded sales"))
        self.assertEqual({s["release"] for s in out["sources"]},
                         {"src-sales", CRIME, "src-noise", "src-ofsted"})

    def test_assess_listing_unknown_postcode_is_not_found(self):
        with self.assertRaises(civic.PostcodeNotFound) as raised:
            self.call("assess_listing", postcode="E1 6AN", asking_price=500_000, bedrooms=2)
        self.assertIn("not in Close Knit's London coverage", str(raised.exception))
        self.assertNotIn("nearby postcode", str(raised.exception))

    def test_assess_listing_bedroom_ballpark_shows_assumed_floor_area(self):
        out = self.call("assess_listing", postcode="NW1 1AA", asking_price=775_000, bedrooms=3)

        price = out["value"]["price"]
        self.assertEqual(price["assumedFloorArea"], home_search.TYPICAL_FLOOR_AREA[3])
        self.assertIsNotNone(price["typicalEstimate"])
        self.assertTrue(any(f"typical {price['assumedFloorArea']} m² home" in caveat
                            for caveat in out["caveats"]),
                        "the verdict must say what floor area it assumes")

    def test_assess_listing_sqft_is_converted_server_side(self):
        out = self.call("assess_listing", postcode="NW1 1AA", asking_price=700_000, floor_area_sqft=753.5)

        # 753.5 sq ft ≈ 70.0 m², so £10,000/m² like the floor_area_sqm=70 case.
        self.assertEqual(out["value"]["price"]["askingPerSqm"], 10_000)
        self.assertEqual(out["value"]["listing"]["floorAreaSqm"], 70.0)

    def test_assess_listing_unknown_tenure_hedges_lease_questions(self):
        out = self.call("assess_listing", postcode="NW1 1AA", asking_price=700_000, floor_area_sqm=70)

        questions = out["value"]["questions"]
        lease = [q for q in questions if "lease" in q.lower() or "service charge" in q.lower()]
        self.assertTrue(lease)
        self.assertTrue(all(q.startswith("If leasehold: ") for q in lease),
                        "unknown tenure must not ask lease questions as fact")

    def test_assess_listing_freehold_skips_lease_questions(self):
        out = self.call("assess_listing", postcode="NW1 1AA", asking_price=700_000, floor_area_sqm=70,
                        tenure="freehold")

        questions = out["value"]["questions"]
        self.assertFalse(any("leasehold" in q.lower() or "service charge" in q.lower()
                             for q in questions))

    def test_price_trend_keeps_quality_and_carrier(self):
        self.context.reader.timeline_quality = "fallback"
        out = self.call("get_area_overview", area_id="uk:lsoa:E01000001")

        trend = out["value"]["priceTrend"]
        self.assertTrue(trend)
        self.assertTrue(all("quality" in point for point in trend))
        self.assertEqual(out["confidence"], "medium",
                         "a fallback £/m² series is the wider area's, not this neighbourhood's")

    def test_rent_listing_has_no_price_verdict(self):
        out = self.call("assess_listing", postcode="NW1 1AA", asking_price=2400, market="rent", bedrooms=2)

        self.assertEqual(out["value"]["price"]["verdict"], "unknown")
        self.assertEqual(out["value"]["price"]["incomeUsuallyNeeded"], 72_000)
        self.assertTrue(any("deposit" in q for q in out["value"]["questions"]))

    def test_rent_listing_is_compared_with_the_borough_average(self):
        self.context.reader.rents = {"uk:lsoa:E01000001": _rent("uk:lsoa:E01000001", 2000)}
        out = self.call("assess_listing", postcode="NW1 1AA", asking_price=2400, market="rent", bedrooms=2)

        price = out["value"]["price"]
        self.assertEqual((price["boroughAverageRent"], price["differencePercent"], price["verdict"]),
                         (2000, 20.0, "above-local"))
        self.assertTrue(any("Renters' Rights Act" in caveat for caveat in out["caveats"]))

    def test_overview_adds_trend_estimate_and_links(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_SITE_URL": "https://areas.example.org"}):
            out = self.call("get_area_overview", area_id="uk:lsoa:E01000001", bedrooms=1)

        value = out["value"]
        self.assertEqual(value["priceTrend"], [{"period": "2026-05", "value": 7900, "quality": None,
                                               "carrierGeographyId": None, "carrierSampleCount": None},
                                              {"period": "2026-06", "value": 8000, "quality": None,
                                               "carrierGeographyId": None, "carrierSampleCount": None}])
        self.assertEqual(value["estimate"]["estimatedPrice"], 400_000)
        self.assertEqual(value["links"]["area"], "https://areas.example.org/area/lsoa/E01000001")
        self.assertEqual(out["confidence"], "high")

    def test_overview_ballpark_matches_find_areas_basis(self):
        # #209: the overview's estimate reads the latest 12-month index level (the last priceTrend
        # point), as find_areas does, even when the 36-month resale median says otherwise.
        pack = StubReader().get_area_pack("uk:lsoa:E01000001")
        pack["market"]["resale"]["medianPricePerSquareMetre"] = 9000
        with mock.patch.object(self.context.reader, "get_area_pack", return_value=pack):
            overview = self.call("get_area_overview", area_id="uk:lsoa:E01000001", bedrooms=2)
        found = self.call("find_areas", max_budget=600_000, bedrooms=2,
                          priorities=[{"factor": "crime", "importance": 4}])

        first = next(a for a in found["value"]["areas"] if a["geographyId"] == "uk:lsoa:E01000001")
        self.assertEqual(overview["value"]["estimate"]["estimatedPrice"], first["estimatedPrice"])
        self.assertEqual(overview["value"]["estimate"]["pricePerSquareMetre"], first["pricePerSquareMetre"])
        self.assertTrue(any("latest 12-month £/m² index" in caveat for caveat in overview["caveats"]))

    def _overview_with_trend_summary(self, summary):
        reader = StubReader()
        reader.get_area = lambda area_id, metric_id, period, cancel=None: {
            "summary": summary, "metricTimeline": [{"period": "2026-06", "value": 8000.0}]}
        context = tools.ToolContext(reader=reader, load_match_rows=_match_rows)
        return tools.call_tool("get_area_overview", context, {"area_id": "uk:msoa:E02000004"})

    def _price_trend_caveat(self, out):
        return next(caveat for caveat in out["caveats"] if caveat.startswith("priceTrend"))

    def test_overview_price_trend_caveat_names_aggregation_for_a_district(self):
        """Issue #208: an aggregated district trend is not 'of recorded sales'."""
        out = self._overview_with_trend_summary({"areaCount": 4, "quality": "fallback"})

        caveat = self._price_trend_caveat(out)
        self.assertIn("neighbourhoods", caveat)
        self.assertNotIn("recorded sales", caveat)

    def test_overview_price_trend_caveat_names_recorded_sales_for_a_neighbourhood(self):
        out = self._overview_with_trend_summary({"quality": "observed"})

        self.assertIn("recorded sales", self._price_trend_caveat(out))

    def test_overview_health_caveat_names_laei_only_with_the_flag_on(self):
        def health_caveat():
            out = self.call("get_area_overview", area_id="uk:lsoa:E01000001")
            return next(caveat for caveat in out["caveats"] if caveat.startswith("health:"))

        with mock.patch.dict(os.environ, {"CLOSE_KNIT_AIR_QUALITY": ""}):
            off = health_caveat()
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_AIR_QUALITY": "1"}):
            on = health_caveat()
        self.assertNotIn("LAEI", off)
        self.assertIn("summer heat", off)
        self.assertIn("LAEI", on)

    def test_overview_caveats_name_the_region_outside_london(self):
        """G-E11: a Manchester overview speaks of North West, not London, and drops LAEI, heat and TfL words."""
        north_west = {"rankScope": {"code": "E12000002", "name": "North West"}}
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_AIR_QUALITY": "1"}), \
                mock.patch("area_api.home_search._location", return_value=north_west):
            caveats = self.call("get_area_overview", area_id="uk:lsoa:E01000001")["caveats"]
        health = next(caveat for caveat in caveats if caveat.startswith("health:"))
        around = next(caveat for caveat in caveats if caveat.startswith("gettingAround:"))
        self.assertIn("percentiles within North West", health)
        self.assertNotIn("LAEI", health)
        self.assertNotIn("summer heat", health)
        self.assertNotIn("TfL", around)

    def test_overview_adds_getting_around_from_places(self):
        places = {"available": True, "connectivity": {"score": 8},
                  "stations": [{"name": f"Station {i}", "modes": ["underground"], "zone": "2",
                                "lines": [{"id": "jubilee", "mode": "tube", "name": "Jubilee"}],
                                "distanceMetres": 400 * i} for i in range(1, 5)],
                  "parks": [{"name": "Big Park", "sizeClass": "large", "distanceMetres": 240}]}
        self.context.reader._connect = object()
        with mock.patch("area_api.places.area_places", return_value=places) as area_places, \
                mock.patch("area_api.home_search._location", return_value=None):
            out = self.call("get_area_overview", area_id="uk:lsoa:E01000001")

        around = out["value"]["gettingAround"]
        self.assertEqual(area_places.call_args.args[1], "uk:lsoa:E01000001")
        self.assertEqual(around["connectivityScore"], 8)
        self.assertEqual([s["name"] for s in around["stations"]], ["Station 1", "Station 2", "Station 3"])
        self.assertEqual((around["stations"][0]["walkMinutes"], around["stations"][0]["lines"]), (5, [{"id": "jubilee", "mode": "tube", "name": "Jubilee"}]))
        self.assertEqual(around["nearestPark"], {"name": "Big Park", "sizeClass": "large", "walkMinutes": 3})

    def test_overview_without_places_has_no_getting_around(self):
        out = self.call("get_area_overview", area_id="uk:lsoa:E01000001")

        self.assertIsNone(out["value"]["gettingAround"])

    def test_overview_and_listing_keep_the_optional_block_keys_before_their_layers_load(self):
        # #232-#234: a reader without a connection answers with the keys present and null.
        overview = self.call("get_area_overview", area_id="uk:lsoa:E01000001")["value"]
        listing = self.call("assess_listing", postcode="NW1 1AA", asking_price=700_000, bedrooms=2)["value"]

        for key in ("hpi", "councilTax", "deprivation", "home"):
            self.assertIn(key, overview)
            self.assertIsNone(overview[key])
        for key in ("hpi", "deprivation", "home", "listedNearby"):
            self.assertIsNone(listing[key])
        self.assertEqual(listing["costs"]["stampDuty"]["standard"], 25_000)
        self.assertIsNone(listing["costs"]["councilTax"])
        self.assertIsNone(listing["schools"]["independent"])

    def test_similar_areas_carry_price_and_borough(self):
        out = self.call("find_similar_areas", area_id="uk:lsoa:E01000001", cheaper=True, bedrooms=2)

        area = out["value"]["areas"][0]
        self.assertEqual(area["estimatedPrice"], 350_000)
        self.assertEqual(area["borough"], "Camden")
        self.assertEqual(out["value"]["like"]["name"], "Area 001")

    def test_cheaper_similar_areas_say_when_none_is_cheaper(self):
        # #242: find_similar_areas(cheaper=true) on the cheapest area returned areas [] with no reason.
        self.context.reader.get_similar_areas = lambda area_id, cheaper=False, cancel=None: {
            "productReleaseId": RELEASE, "name": "Area 003", "factors": ["crime", "market-level"],
            "values": [], "candidates": {"similar": 7, "cheaper": 0}}
        out = self.call("find_similar_areas", area_id="uk:lsoa:E01000003", cheaper=True)
        self.assertEqual(out["value"]["areas"], [])
        self.assertEqual(out["value"]["emptiedBy"], {"constraint": "cheaper", "kind": "cheaper", "areasBefore": 7})
        self.assertTrue(any("lower price level" in c for c in out["caveats"]))
        plain = self.call("find_similar_areas", area_id="uk:lsoa:E01000003")
        self.assertIsNone(plain["value"]["emptiedBy"])

    def test_search_places_splits_stations_areas_and_addresses(self):
        out = self.call("search_places", q="Camden")

        self.assertEqual(out["value"]["stations"][0]["stationId"], "osm:n1")
        self.assertEqual(out["value"]["areas"][0]["kind"], "lad")
        self.assertEqual(out["value"]["addresses"][0]["addressId"], "uk:addr:aaaaaaaaaaaa")

    def test_watch_prompt_names_exact_assess_listing_arguments(self):
        # Issue #213: a scheduled agent that follows the prompt literally must not call
        # assess_listing in buy mode for a rent watch.
        out = self.call("build_watch_spec", name="Walthamstow", area_ids=["uk:lsoa:E01000001"],
                        max_price=2000, market="rent", min_bedrooms=2)

        spec = out["value"]["spec"]
        self.assertEqual(spec["assessArgs"]["market"], "rent")
        prompt = out["value"]["schedulePrompt"]
        self.assertIn("market='rent'", prompt)
        self.assertIn("floor_area_sqm", prompt)
        self.assertIn("tenure", prompt)
        self.assertIn("52", prompt)  # weekly rent ×52/12 -> pcm

    def test_buy_mode_tiny_price_warns_it_may_be_a_rent(self):
        # Issue #213 safety net: £2,000 is not a sale price in London.
        out = self.call("assess_listing", postcode="NW1 1AA", asking_price=2000, bedrooms=2)

        self.assertTrue(any("market='rent'" in caveat for caveat in out["caveats"]))

    def test_watch_spec_is_stateless_and_schedulable(self):
        out = self.call("build_watch_spec", name="Camden 2-bed!", area_ids=["uk:lsoa:E01000001"],
                        max_price=600_000, min_bedrooms=2, must_haves="outdoor space")

        spec = out["value"]["spec"]
        self.assertEqual(spec["slug"], "camden-2-bed")
        self.assertEqual(spec["stateFile"], "~/.close-knit/watches/camden-2-bed.json")
        prompt = out["value"]["schedulePrompt"]
        self.assertIn("https://www.rightmove.co.uk/property-for-sale/NW1.html", prompt)
        self.assertIn("outdoor space", prompt)
        self.assertIn("assess_listing", prompt)


@unittest.skipIf(tools is None, "pydantic is not installed")
class RentAssessListingProvenanceTests(unittest.TestCase):
    """Issue #160: a rent answer cites the rent release and never the sales comparison."""

    def setUp(self):
        self.context = tools.ToolContext(reader=StubReader(), load_match_rows=_match_rows)
        self.context.reader.rents = {"uk:lsoa:E01000001": _rent("uk:lsoa:E01000001", 2000)}
        self.out = tools.call_tool("assess_listing", self.context,
                                   {"postcode": "NW1 1AA", "asking_price": 2400, "market": "rent",
                                    "bedrooms": 2})

    def test_rent_listing_cites_the_rent_release(self):
        self.assertIn("src-ons-pipr-2026-09", {s["release"] for s in self.out["sources"]})

    def test_rent_listing_has_no_sales_comparison_caveat(self):
        self.assertFalse(any(c.startswith("Compares the asking price with recorded sales")
                             for c in self.out["caveats"]))
        self.assertTrue(self.out["caveats"][0].startswith("Compares the asking rent"))

    def test_rent_listing_keeps_the_resale_median_key_null(self):
        price = self.out["value"]["price"]
        self.assertIn("localResaleMedianPerSqm", price)
        self.assertIsNone(price["localResaleMedianPerSqm"])


@unittest.skipIf(tools is None, "pydantic is not installed")
class ListingLinksAndWatchIdTests(unittest.TestCase):
    """Issue #214: MSOA, borough and unknown ids in listing links and watch specs."""

    def setUp(self):
        self.context = tools.ToolContext(reader=StubReader(), load_match_rows=_match_rows)

    def test_msoa_and_borough_ids_are_explained_not_silent(self):
        out = tools.call_tool("get_listing_search_links", self.context,
                              {"area_ids": ["uk:lsoa:E01000001", "uk:msoa:E02000001",
                                            "uk:lad:E09000030", "uk:lsoa:E01999999"],
                               "max_price": 600_000, "min_bedrooms": 2})

        value = out["value"]
        self.assertEqual([s["outcode"] for s in value["searches"]], ["NW1"])
        self.assertTrue(any("uk:msoa:E02000001" in caveat and "uk:lad:E09000030" in caveat
                            for caveat in out["caveats"]))
        self.assertTrue(any("E01999999" in caveat for caveat in out["caveats"]))
        self.assertEqual(out["confidence"], "medium")
        titles = {area["geographyId"]: area["title"] for area in value["areas"]}
        self.assertEqual(titles["uk:lad:E09000030"], "Tower Hamlets")

    def test_duplicate_area_ids_are_deduplicated(self):
        out = tools.call_tool("get_listing_search_links", self.context,
                              {"area_ids": ["uk:lsoa:E01000001", "uk:lsoa:E01000001"],
                               "max_price": 600_000})

        self.assertEqual(out["value"]["searches"][0]["areaIds"], ["uk:lsoa:E01000001"])
        self.assertEqual([area["geographyId"] for area in out["value"]["areas"]],
                         ["uk:lsoa:E01000001"])
        self.assertEqual(out["confidence"], "high")

    def test_watch_spec_reports_unsearchable_ids_and_hashes_empty_slug(self):
        arguments = {"name": "??",
                     "area_ids": ["uk:lsoa:E01000001", "uk:lsoa:E09999999", "uk:lad:E09000030",
                                  "uk:lsoa:E01000001"],
                     "max_price": 2000, "market": "rent"}
        out = tools.call_tool("build_watch_spec", self.context, arguments)

        spec = out["value"]["spec"]
        self.assertTrue(spec["slug"].startswith("watch-") and len(spec["slug"]) > len("watch-"))
        self.assertIn(spec["slug"], spec["stateFile"])
        self.assertEqual([area["geographyId"] for area in spec["areas"]],
                         ["uk:lsoa:E01000001", "uk:lad:E09000030"])
        self.assertEqual(spec["searches"][0]["areaIds"], ["uk:lsoa:E01000001"])
        self.assertTrue(any("E09999999" in caveat for caveat in out["caveats"]))
        self.assertTrue(any("uk:lad:E09000030" in caveat for caveat in out["caveats"]))
        self.assertEqual(out["confidence"], "medium")
        again = tools.call_tool("build_watch_spec", self.context, arguments)
        self.assertEqual(again["value"]["spec"]["slug"], spec["slug"])


@unittest.skipIf(tools is None, "pydantic is not installed")
class AreaLookupReaderTests(unittest.TestCase):
    def test_places_name_borough_and_outcodes_from_recorded_addresses(self):
        reader = EvidenceReader(connect=seed_production_fixture)

        out = reader.area_lookup(["uk:lsoa:E01000004", "uk:lad:E09000007", "uk:lsoa:E01999999"])

        self.assertEqual(out["productReleaseId"], OLD_RELEASE)
        lsoa = out["places"]["uk:lsoa:E01000004"]
        self.assertEqual(lsoa["borough"], "Camden test borough")
        self.assertEqual(lsoa["parentId"], "uk:msoa:E02000004")
        self.assertEqual(lsoa["outcodes"], ["SW1A"])
        self.assertEqual(out["places"]["uk:lad:E09000007"]["outcodes"], [])
        self.assertNotIn("uk:lsoa:E01999999", out["places"])

    def test_malformed_ids_are_rejected(self):
        with self.assertRaises(evidence.MalformedQuery):
            EvidenceReader(connect=seed_production_fixture).area_lookup(["E01000004"])


class LayeredConnection:
    """Answers the optional layers' SQL (HPI, council tax, Home, listed buildings) by marker; anything
    else (location, health, places) returns no rows, as before those layers are loaded."""

    def __init__(self):
        from tests import test_area_home, test_council_tax, test_uk_hpi
        self.rows = {
            "-- evidence:active-release": [{"release_id": RELEASE}],
            "-- evidence:area-borough": [{"id": "uk:lad:E09000007", "name": "Camden"}],
            "-- evidence:hpi-table": [{"t": True}],
            "-- evidence:hpi-series": test_uk_hpi._rows(),
            "-- evidence:hpi-rank": [{"metric_id": "hpi-change-5y", "region_percentile": 9}],
            "-- evidence:council-tax-bands": [test_council_tax.BANDS],
            "-- evidence:council-tax-borough": [test_council_tax.BOROUGH],
            "-- evidence:area-home-restriction": [test_area_home.RESTRICTION],
            "-- evidence:area-home-broadband": [test_area_home.BROADBAND],
            "-- evidence:area-home-settled": [test_area_home.SETTLED],
            "-- evidence:area-home-borough": [test_area_home.BOROUGH],
            "-- evidence:listed-near-postcode": [
                {"id": "nhle:1234567", "name": "12-14, CHURCH ROW", "grade": "II", "distance_metres": 8}],
        }
        self.calls = []

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        self.calls.append((marker, params))
        return list(self.rows.get(marker, []))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class LayeredReader(StubReader):
    def __init__(self):
        super().__init__()
        self.connection = LayeredConnection()

    def _connect(self):
        return self.connection

    def list_metrics(self, cancel=None):
        catalogue = super().list_metrics(cancel)
        catalogue["metrics"].append({"id": "deprivation", "periods": ["2019-01", "2025-01"],
                                     "provenance": {"release": "src-imd-2025"}})
        return catalogue

    def get_area(self, area_id, metric_id, period, cancel=None):
        if metric_id == "deprivation":
            return {"summary": {"geographyId": area_id, "metricId": "deprivation", "period": period, "value": 5,
                                "regionPercentile": 61, "quality": "observed", "sourceVersion": "src-imd-2025"},
                    "metricTimeline": []}
        return super().get_area(area_id, metric_id, period, cancel)


@unittest.skipIf(tools is None, "pydantic is not installed")
class ToolCopyTests(unittest.TestCase):
    """The MCP tools name the scope the server serves: England with London in depth, or London."""

    def test_find_areas_names_the_served_scope(self):
        from area_api import scope

        with mock.patch.object(home_search.guidance, "served_scope", return_value=scope.ENGLAND):
            self.assertEqual(home_search.coverage_words(), "in England (London in depth)")
        with mock.patch.object(home_search.guidance, "served_scope", return_value=scope.LONDON):
            self.assertEqual(home_search.coverage_words(), "in London")
        description = tools.TOOLS["find_areas"].description
        self.assertIn(f"Shortlist neighbourhoods {home_search.coverage_words()}", description)
        self.assertIn("notScored", description)

    def test_no_tool_calls_its_data_london_only(self):
        for name, spec in tools.TOOLS.items():
            for words in ("London neighbourhood", "London home", "London percentile", "borough's"):
                self.assertNotIn(words, spec.description, name)


class OverviewLayerTests(unittest.TestCase):
    """#232 HPI, #233 council tax / stamp duty / deprivation, #234 listed buildings and Article 4:
    the REST readers' figures reach get_area_overview and assess_listing, cited and caveated."""

    def setUp(self):
        self.reader = LayeredReader()
        self.context = tools.ToolContext(reader=self.reader, load_match_rows=_match_rows)
        patches = [mock.patch("area_api.home_search._getting_around", return_value=None),
                   mock.patch("area_api.home_search._location", return_value=None),
                   mock.patch("area_api.home_search._health", return_value=None)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def call(self, tool, **arguments):
        return tools.call_tool(tool, self.context, arguments)

    def test_overview_reads_the_official_hpi_next_to_the_local_index(self):
        out = self.call("get_area_overview", area_id="uk:lsoa:E01000001")

        hpi = out["value"]["hpi"]
        self.assertEqual((hpi["borough"]["name"], hpi["latest"]), ("Camden", "2026-07"))
        everything = next(kind for kind in hpi["types"] if kind["type"] == "all")
        self.assertEqual(everything["latestPrice"], round(94.7 * 8600))
        self.assertEqual(everything["change"]["1y"], round(100 * (94.7 / 105.3 - 1), 1))
        self.assertEqual(everything["regionChange"]["1y"], round(100 * (96.4 / 99.6 - 1), 1))
        self.assertNotIn("series", everything)
        self.assertEqual(hpi["regionPercentile"], {"5y": 9})
        self.assertEqual(out["value"]["market"]["growth"], {"growth1y": 2.0})  # the local index stays
        self.assertTrue(any("hpi is the borough's official UK House Price Index" in c and "market.growth" in c
                            for c in out["caveats"]))
        self.assertIn("src-hmlr-uk-hpi-2026-07", {s["release"] for s in out["sources"]})

    def test_overview_names_region_figures_and_keeps_the_london_names_as_aliases(self):
        out = self.call("get_area_overview", area_id="uk:lsoa:E01000001")

        hpi = out["value"]["hpi"]
        everything = next(kind for kind in hpi["types"] if kind["type"] == "all")
        self.assertEqual(everything["londonChange"], everything["regionChange"])
        self.assertEqual(hpi["londonPercentile"], hpi["regionPercentile"])
        description = tools.TOOLS["get_area_overview"].description
        self.assertIn("regionChange, regionPercentile", description)
        self.assertIn("deprecated aliases", description)

    def test_overview_reads_council_tax_deprivation_and_home(self):
        out = self.call("get_area_overview", area_id="uk:lsoa:E01000001")

        value = out["value"]
        tax = value["councilTax"]
        self.assertEqual((tax["financialYear"], tax["typicalBand"], tax["typicalYearlyBill"]), ("2026-27", "F", 3092))
        self.assertEqual(tax["boroughBandD"], 2140.38)
        self.assertEqual(tax["yearlyBillByBand"]["D"], 2140)
        self.assertEqual(tax["bandShares"]["E"], 0.275)
        self.assertEqual(value["deprivation"]["decile"], 5)
        self.assertEqual(value["deprivation"]["regionPercentile"], 61)
        self.assertEqual(value["home"]["extend"]["listed"]["total"], 1204)
        self.assertEqual(value["home"]["extend"]["article4Data"], "published")
        self.assertEqual(value["home"]["extend"]["conservationShare"], 0.6)
        releases = {s["release"] for s in out["sources"]}
        self.assertTrue({"src-voa-ctsop-2025-e1979a4196e2", "src-mhclg-ct-2026", "src-imd-2025", "src-he"} <= releases)
        starts = [caveat.split(":")[0] for caveat in out["caveats"]]
        for block in ("councilTax", "deprivation", "home"):
            self.assertIn(block, starts)
        self.assertTrue(any("never one home's band" in caveat for caveat in out["caveats"]))

    def test_listing_costs_listed_buildings_and_questions(self):
        out = self.call("assess_listing", postcode="NW1 1AA", asking_price=700_000, bedrooms=2, tenure="freehold")

        value = out["value"]
        costs = value["costs"]
        self.assertEqual(costs["stampDuty"]["standard"], 25_000)
        self.assertIsNone(costs["stampDuty"]["firstTimeBuyer"])  # relief ends above £500k
        self.assertEqual(costs["stampDuty"]["additionalProperty"], 60_000)
        self.assertEqual(costs["councilTax"]["typicalYearlyBill"], 3092)
        self.assertEqual(costs["councilTax"]["yearlyBillByBand"]["H"], 4281)
        self.assertEqual(value["listedNearby"][0]["grade"], "II")
        self.assertEqual(value["listedNearby"][0]["url"], "https://historicengland.org.uk/listing/the-list/list-entry/1234567")
        self.assertEqual(self.reader.connection.calls[-1][1][1], "NW1 1AA")
        self.assertTrue(any("is the home itself listed" in q for q in value["questions"]))
        self.assertEqual(value["hpi"]["borough"]["name"], "Camden")
        self.assertEqual(value["deprivation"]["decile"], 5)
        self.assertEqual(value["home"]["extend"]["listed"]["gradeII"], 1203)
        self.assertTrue(any("listedNearby" in caveat and "confirm with the agent" in caveat for caveat in out["caveats"]))
        self.assertTrue(any("costs.stampDuty" in caveat for caveat in out["caveats"]))

    def test_first_time_buyer_relief_under_the_cap_and_no_stamp_duty_for_rent(self):
        buy = self.call("assess_listing", postcode="NW1 1AA", asking_price=450_000, bedrooms=1)["value"]
        rent = self.call("assess_listing", postcode="NW1 1AA", asking_price=2400, market="rent", bedrooms=2)["value"]

        self.assertEqual(buy["costs"]["stampDuty"]["firstTimeBuyer"], 7_500)
        self.assertNotIn("note", buy["costs"]["stampDuty"])
        self.assertIsNone(rent["costs"]["stampDuty"])
        self.assertEqual(rent["costs"]["councilTax"]["typicalBand"], "F")

    def test_unpublished_article4_adds_a_question(self):
        from tests import test_area_home
        self.reader.connection.rows["-- evidence:area-home-borough"] = [{**test_area_home.BOROUGH, "article4_areas": 0}]
        out = self.call("assess_listing", postcode="NW1 1AA", asking_price=700_000, bedrooms=2, tenure="freehold")

        self.assertTrue(any("not published its Article 4" in q for q in out["value"]["questions"]))


if __name__ == "__main__":
    unittest.main()


@unittest.skipIf(tools is None, "pydantic is not installed")
class PostcodeAreaOnspdTests(unittest.TestCase):
    """#205: the reader's dedicated postcode lookup: exact address, else ONSPD, else typed error."""

    def reader(self, connection):
        return EvidenceReader(connect=lambda: connection)

    def seeded_with(self, postcode, **row):
        from tests.test_street_search import seeded
        connection = seeded()
        connection.postcodes[postcode] = {"postcode": postcode, "name": "Camden 001A",
                                          "borough_name": "Camden", "center_lon": -0.14,
                                          "center_lat": 51.55, **row}
        return connection

    def test_onspd_only_postcode_resolves_through_the_real_reader(self):
        connection = self.seeded_with("NW5 9XY", geography_id="uk:lsoa:E01000009")
        found = self.reader(connection).postcode_area("NW5 9XY")
        self.assertEqual((found["postcode"], found["geographyId"], found["resolvedBy"]),
                         ("NW5 9XY", "uk:lsoa:E01000009", "postcode-directory"))

    def test_exact_recorded_address_wins_over_onspd(self):
        from tests.test_street_search import add_home
        connection = self.seeded_with("NW5 9XY", geography_id="uk:lsoa:E01000009")
        add_home(connection, "uk:addr:00000000n801", "5 Test Road, London, NW5 9XY", "NW5 9XY")
        found = self.reader(connection).postcode_area("nw59xy")
        self.assertEqual((found["postcode"], found["resolvedBy"]), ("NW5 9XY", "recorded-address"))

    def test_multi_lsoa_postcode_takes_the_most_common_lsoa(self):
        from tests.test_street_search import add_home
        connection = self.seeded_with("NW5 9XY", geography_id="uk:lsoa:E01000009")
        add_home(connection, "uk:addr:00000000n802", "1 Test Road, London, NW5 9XY", "NW5 9XY")
        add_home(connection, "uk:addr:00000000n803", "2 Test Road, London, NW5 9XY", "NW5 9XY")
        connection.base.addresses["uk:addr:00000000n802"]["geography_id"] = "uk:lsoa:E01000004"
        connection.base.addresses["uk:addr:00000000n803"]["geography_id"] = "uk:lsoa:E01000004"
        found = self.reader(connection).postcode_area("NW5 9XY")
        self.assertEqual((found["geographyId"], found["resolvedBy"]),
                         ("uk:lsoa:E01000004", "recorded-address"))

    def test_terminated_postcode_says_no_longer_in_use(self):
        connection = self.seeded_with("NW5 9XZ", geography_id="uk:lsoa:E01000009", terminated=True)
        with self.assertRaises(civic.PostcodeNotFound) as raised:
            self.reader(connection).postcode_area("NW5 9XZ")
        self.assertIn("no longer in use", str(raised.exception))

    def test_postcode_outside_the_directory_is_a_distinct_error(self):
        connection = self.seeded_with("NW5 9XY", geography_id="uk:lsoa:E01000009")
        with self.assertRaises(civic.PostcodeNotFound) as raised:
            self.reader(connection).postcode_area("M1 1AE")
        self.assertIn("not in Close Knit's London coverage", str(raised.exception))
        self.assertNotIn("nearby postcode", str(raised.exception))

    def test_home_search_postcode_area_returns_resolved_by(self):
        import types
        context = types.SimpleNamespace(reader=StubReader(), cancel=None)
        self.assertEqual(home_search.postcode_area(context, "nw11aa"),
                         ("NW1 1AA", "uk:lsoa:E01000001", "recorded-address"))

    def test_listing_card_opens_the_onspd_area(self):
        import types
        from area_api import listing_card
        connection = self.seeded_with("E20 3AS", geography_id="uk:lsoa:E01001849")
        context = types.SimpleNamespace(reader=self.reader(connection), cancel=None)
        request = types.SimpleNamespace(lat=None, lng=None, postcode="E20 3AS")
        self.assertEqual(listing_card.resolve_area(context, request), "uk:lsoa:E01001849")


class _OnspdStub(StubReader):
    def postcode_area(self, postcode, cancel=None):
        return {"postcode": "E20 3AS", "geographyId": "uk:lsoa:E01001849",
                "resolvedBy": "postcode-directory", "productReleaseId": RELEASE}


@unittest.skipIf(tools is None, "pydantic is not installed")
class AssessListingOnspdTests(unittest.TestCase):
    """#205: assess_listing says where the area came from."""

    def call(self, reader, **arguments):
        context = tools.ToolContext(reader=reader, load_match_rows=_match_rows)
        return tools.call_tool("assess_listing", context, arguments)

    def test_assessment_says_the_area_came_from_onspd(self):
        out = self.call(_OnspdStub(), postcode="E20 3AS", asking_price=625_000, floor_area_sqm=69.6)
        self.assertEqual(out["value"]["area"]["geographyId"], "uk:lsoa:E01001849")
        self.assertEqual(out["value"]["area"]["resolvedBy"], "postcode-directory")
        self.assertTrue(any("ONS Postcode Directory" in caveat for caveat in out["caveats"]))
        self.assertFalse(any("brand-new postcodes are not found" in caveat for caveat in out["caveats"]))
        self.assertIn(civic.ONSPD_SOURCE, {source["release"] for source in out["sources"]})

    def test_recorded_address_assessment_says_so(self):
        out = self.call(StubReader(), postcode="NW1 1AA", asking_price=700_000, floor_area_sqm=70)
        self.assertEqual(out["value"]["area"]["resolvedBy"], "recorded-address")
        self.assertTrue(any("recorded addresses" in caveat for caveat in out["caveats"]))
        self.assertNotIn(civic.ONSPD_SOURCE, {source["release"] for source in out["sources"]})


class PostcodeAreaTests(unittest.TestCase):
    """#200: a full postcode compares exactly through the reader's dedicated lookup."""

    def context(self, homes):
        import types
        from tests.test_street_search import add_home, seeded
        connection = seeded()
        for id_, display, postcode, lsoa in homes:
            add_home(connection, id_, display, postcode)
            connection.base.addresses[id_]["geography_id"] = lsoa
        return types.SimpleNamespace(reader=EvidenceReader(connect=lambda: connection), cancel=None)

    def test_another_districts_postcode_is_not_a_match(self):
        with self.assertRaises(evidence.AreaNotFound):
            home_search.postcode_area(self.context([ENFIELD_EN1_1AA]), "N1 1AA")

    def test_the_exact_postcode_wins_over_an_earlier_twin(self):
        self.assertEqual(home_search.postcode_area(
            self.context([SLOANE_SW1W_8DH, EASTCASTLE_W1W_8DH]), "W1W 8DH"),
            ("W1W 8DH", "uk:lsoa:E01004765", "recorded-address"))

    def test_listing_card_does_not_open_another_borough(self):
        import types
        from area_api import listing_card
        request = types.SimpleNamespace(lat=None, lng=None, postcode="N1 1AA")
        self.assertIsNone(listing_card.resolve_area(self.context([ENFIELD_EN1_1AA]), request))


# (address id, display address, postcode, LSOA): recorded homes whose postcodes are near-twins.
ENFIELD_EN1_1AA = ("uk:addr:b37e1f4cdeab", "Enfield Delivery Office Savoy Parade, Enfield, EN1 1AA",
                   "EN1 1AA", "uk:lsoa:E01001512")
SLOANE_SW1W_8DH = ("uk:addr:b3183fe89aed", "65 Lower Sloane Street, London, SW1W 8DH",
                   "SW1W 8DH", "uk:lsoa:E01002902")
EASTCASTLE_W1W_8DH = ("uk:addr:4cb1fa00265b",
                      "Ground Floor And Basement, Eastcastle House, 27 - 28 Eastcastle Street, London, W1W 8DH",
                      "W1W 8DH", "uk:lsoa:E01004765")


@unittest.skipIf(tools is None, "pydantic is not installed")
class AssessListingTenureAndPlausibilityTests(unittest.TestCase):
    """#212: shared-ownership shares, weekly rents and implausible prices never give a
    confident wrong verdict. The stub's local median is £8,000/m², so 70 m² is £560,000."""

    def setUp(self):
        self.context = tools.ToolContext(reader=StubReader(), load_match_rows=_match_rows)

    def assess(self, **arguments):
        return tools.call_tool("assess_listing", self.context, {"postcode": "NW1 1AA", **arguments})

    def test_shared_ownership_share_is_compared_as_the_implied_full_price(self):
        out = self.assess(asking_price=140_000, floor_area_sqm=70, tenure="shared-ownership", share_percent=25)

        price = out["value"]["price"]
        self.assertEqual((price["sharePercent"], price["shareImpliedFullPrice"], price["verdict"]),
                         (25, 560_000, "in-line"))
        self.assertEqual(out["value"]["listing"]["sharePercent"], 25)
        self.assertEqual(out["confidence"], "medium")
        self.assertTrue(any(c.startswith("Shared ownership") for c in out["caveats"]))
        self.assertTrue(any("staircasing" in q for q in out["value"]["questions"]))

    def test_shared_ownership_without_the_share_has_no_verdict(self):
        out = self.assess(asking_price=140_000, floor_area_sqm=70, tenure="shared-ownership")

        price = out["value"]["price"]
        self.assertEqual(price["verdict"], "unknown")
        self.assertIn("share", price["note"])
        self.assertEqual(out["confidence"], "low")

    def test_weekly_rent_is_converted_to_monthly_before_comparing(self):
        self.context.reader.rents = {"uk:lsoa:E01000001": _rent("uk:lsoa:E01000001", 2000)}
        out = self.assess(asking_price=462, market="rent", rent_period="week", bedrooms=2)

        price = out["value"]["price"]
        self.assertEqual(price["askingRentPcm"], 2002)
        self.assertEqual(price["incomeUsuallyNeeded"], 60_060)
        self.assertEqual(price["verdict"], "in-line")
        self.assertEqual(out["value"]["listing"]["rentPeriod"], "week")

    def test_monthly_rent_keeps_the_old_arithmetic(self):
        self.context.reader.rents = {"uk:lsoa:E01000001": _rent("uk:lsoa:E01000001", 2000)}
        out = self.assess(asking_price=2400, market="rent", bedrooms=2)

        price = out["value"]["price"]
        self.assertNotIn("askingRentPcm", price)
        self.assertEqual((price["incomeUsuallyNeeded"], price["verdict"]), (72_000, "above-local"))

    def test_implausible_price_is_not_trusted(self):
        # A 25% share passed as the whole price: 81% below local.
        out = self.assess(asking_price=105_500, floor_area_sqm=70, tenure="leasehold")

        self.assertEqual(out["value"]["price"]["verdict"], "below-local")
        self.assertEqual(out["confidence"], "low")
        self.assertTrue(any("check the price basis" in c for c in out["caveats"]))

    def test_plausible_price_keeps_a_medium_confidence(self):
        out = self.assess(asking_price=700_000, floor_area_sqm=70, tenure="leasehold")

        self.assertEqual((out["value"]["price"]["verdict"], out["confidence"]), ("above-local", "medium"))
        self.assertFalse(any("check the price basis" in c for c in out["caveats"]))

    def test_unknown_tenure_values_are_rejected(self):
        with self.assertRaises(tools.InvalidToolArguments):
            self.assess(asking_price=500_000, bedrooms=2, tenure="part-buy")
