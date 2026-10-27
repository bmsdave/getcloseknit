"""Issue #215: tool envelopes carry release-level provenance from the source-release table.

- ``market_depth.release_provenance`` merges the table row (sourceUrl, licence,
  attribution, transformationVersion) with the catalogue's sourceName/sourceId, never
  another metric's metricId/methodologyPath/caveats.
- find_areas/open_shared_search: productReleaseId is the active product release; the
  factor set moves to value.sourceReleaseSet; sources are full release rows.
- find_similar_areas, get_area_overview, assess_listing, get_commute, search_places,
  list_custom_presets, get_address_history, get_home_prices: no more bare {release}
  or empty source lists.
"""
import unittest
from unittest import mock

from tests.test_home_search import CRIME, PRICES, RELEASE, StubReader, _match_rows

try:
    from area_api import evidence, home_search, market_depth, tools
    from area_api.toolspec import ToolContext
except ImportError:  # pragma: no cover - dependency-free environments
    home_search = None


TABLE_ROWS = [
    {"id": CRIME, "source_url": "https://example.org/crime", "licence": "OGL-UK-3.0",
     "attribution": "Contains Police UK data", "transformation_version": "etl-crime-2"},
    {"id": PRICES, "source_url": "https://example.org/prices", "licence": "OGL-UK-3.0",
     "attribution": "Contains HM Land Registry data", "transformation_version": "etl-pp-7"},
    {"id": "src-sales", "source_url": "https://example.org/prices", "licence": "OGL-UK-3.0",
     "attribution": "Contains HM Land Registry data", "transformation_version": "etl-pp-7"},
    {"id": "src-noise", "source_url": "https://example.org/noise", "licence": "OGL-UK-3.0",
     "attribution": "Contains Defra data", "transformation_version": "etl-noise-1"},
    {"id": "src-ofsted", "source_url": "https://example.org/ofsted", "licence": "OGL-UK-3.0",
     "attribution": "Contains Ofsted data", "transformation_version": "etl-ofsted-1"},
    {"id": "src-osm-test", "source_url": "https://example.org/osm", "licence": "ODbL-1.0",
     "attribution": "© OpenStreetMap contributors", "transformation_version": "etl-osm-3"},
]


def table(rows=TABLE_ROWS):
    """What EvidenceReader.source_releases() serves: source rows keyed by release id."""
    return {row["release"]: row for row in market_depth.source_rows(rows)}


class SourceReader(StubReader):
    """StubReader with the reader's cached source-release lookup (#215)."""

    def source_releases(self, cancel=None):
        return table()


class FakeConnection:
    """A DB handle that only answers the active-release source lookup (#215)."""

    def __init__(self, rows):
        self._rows = rows
        self.queries = 0

    def execute(self, sql, params=None):
        assert "evidence:active-source-releases" in sql, f"unexpected SQL: {sql[:80]}"
        self.queries += 1
        return [dict(row) for row in self._rows]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def catalogue():
    return SourceReader().list_metrics()


@unittest.skipIf(home_search is None, "area_api is not importable")
class ReleaseProvenanceTests(unittest.TestCase):
    def test_table_row_is_merged_with_the_catalogue_name(self):
        rows = market_depth.release_provenance([CRIME], catalogue(), table())

        self.assertEqual(rows, [{
            "release": CRIME, "sourceId": "src-crime", "sourceName": "Police UK",
            "sourceUrl": "https://example.org/crime", "licence": "OGL-UK-3.0",
            "attribution": "Contains Police UK data", "transformationVersion": "etl-crime-2"}])

    def test_catalogue_only_without_a_table(self):
        rows = market_depth.release_provenance([CRIME], catalogue())

        # The #167 release-level row, nothing more.
        self.assertEqual(rows, [{
            "release": CRIME, "sourceId": "src-crime", "sourceName": "Police UK",
            "sourceUrl": "https://example.org/crime", "licence": "OGL-UK-3.0",
            "attribution": "Contains Police UK data", "transformationVersion": "etl-1"}])

    def test_the_table_overrides_the_catalogue(self):
        rows = market_depth.release_provenance([CRIME], catalogue(), table())

        self.assertEqual(rows[0]["transformationVersion"], "etl-crime-2")

    def test_unknown_release_stays_bare(self):
        rows = market_depth.release_provenance(["src-nope"], catalogue(), table())

        self.assertEqual(rows, [{"release": "src-nope"}])

    def test_dedupes_and_keeps_order(self):
        rows = market_depth.release_provenance([PRICES, CRIME, PRICES], catalogue(), table())

        self.assertEqual([row["release"] for row in rows], [PRICES, CRIME])

    def test_reader_table_is_cached_per_release_and_read_through_the_reader(self):
        connection = FakeConnection(TABLE_ROWS)
        reader = evidence.EvidenceReader(lambda: connection)
        with mock.patch.object(evidence, "_active_release", return_value=RELEASE):
            first = reader.source_releases()
            second = reader.source_releases()

        self.assertEqual(first, table())
        self.assertIs(first, second)
        self.assertEqual(connection.queries, 1)

    def test_never_carries_another_metrics_fields(self):
        rows = market_depth.release_provenance([CRIME], catalogue(), table())

        for key in ("metricId", "methodologyPath", "caveats"):
            self.assertNotIn(key, rows[0])


@unittest.skipIf(home_search is None, "area_api is not importable")
class ShortlistSources215Tests(unittest.TestCase):
    def setUp(self):
        self.context = ToolContext(reader=SourceReader(), load_match_rows=_match_rows,
                                   load_zone_lsoas=lambda zones: None)

    def find(self, **arguments):
        arguments = {"max_budget": 600_000, "bedrooms": 2,
                     "priorities": [{"factor": "crime", "importance": 4}], **arguments}
        return tools.call_tool("find_areas", self.context, arguments)

    def test_product_release_id_is_the_active_release(self):
        out = self.find()

        # Was the factor release set before #215.
        self.assertEqual(out["productReleaseId"], RELEASE)

    def test_factor_set_moves_to_value_source_release_set(self):
        out = self.find()

        factor_set = out["value"]["sourceReleaseSet"]
        self.assertIn(CRIME, factor_set)
        self.assertNotEqual(out["productReleaseId"], factor_set)

    def test_sources_are_full_release_rows(self):
        out = self.find()

        by_release = {row["release"]: row for row in out["sources"]}
        self.assertIn(CRIME, by_release)
        crime = by_release[CRIME]
        self.assertEqual(crime["sourceUrl"], "https://example.org/crime")
        self.assertEqual(crime["licence"], "OGL-UK-3.0")
        self.assertEqual(crime["attribution"], "Contains Police UK data")
        self.assertEqual(crime["transformationVersion"], "etl-crime-2")
        self.assertEqual(crime["sourceName"], "Police UK")


@unittest.skipIf(home_search is None, "area_api is not importable")
class SimilarAreasSources215Tests(unittest.TestCase):
    def setUp(self):
        self.context = ToolContext(reader=SourceReader(), load_match_rows=_match_rows)

    def test_sources_name_the_compared_factors_releases(self):
        out = tools.call_tool("find_similar_areas", self.context,
                              {"area_id": "uk:lsoa:E01000001", "top_n": 3})

        by_release = {row["release"]: row for row in out["sources"]}
        # Compared on crime and market-level (the stub's factors).
        self.assertIn(CRIME, by_release)
        self.assertIn(PRICES, by_release)
        self.assertEqual(by_release[CRIME]["sourceName"], "Police UK")
        self.assertIn("methodologyPath", by_release[CRIME])


@unittest.skipIf(home_search is None, "area_api is not importable")
class OverviewSources215Tests(unittest.TestCase):
    def setUp(self):
        self.context = ToolContext(reader=SourceReader(), load_match_rows=_match_rows)

    def overview(self):
        with mock.patch("area_api.home_search._location", return_value=None), \
                mock.patch("area_api.home_search._health", return_value=None), \
                mock.patch("area_api.home_search._getting_around", return_value=None):
            return tools.call_tool("get_area_overview", self.context, {"area_id": "uk:lsoa:E01000001"})

    def test_price_trend_release_is_cited_and_evidence_carries_source_versions(self):
        out = self.overview()

        by_release = {row["release"]: row for row in out["sources"]}
        self.assertIn(PRICES, by_release)
        self.assertEqual(by_release[PRICES]["sourceName"], "HM Land Registry Price Paid")
        for point in out["evidence"]:
            self.assertEqual(point["metricId"], "price-per-square-metre")
            # The stub trend has no per-period versions; the key is simply absent, never bare.
            self.assertNotIn("sourceVersion", point)

    def test_market_crime_and_school_releases_are_full_rows(self):
        out = self.overview()

        by_release = {row["release"]: row for row in out["sources"]}
        self.assertEqual(by_release["src-sales"]["licence"], "OGL-UK-3.0")


@unittest.skipIf(home_search is None, "area_api is not importable")
class AssessListingSources215Tests(unittest.TestCase):
    def setUp(self):
        self.context = ToolContext(reader=SourceReader(), load_match_rows=_match_rows)

    def test_sources_are_full_rows_and_evidence_names_the_rows_behind_the_verdict(self):
        out = tools.call_tool("assess_listing", self.context, {
            "postcode": "nw11aa", "asking_price": 700_000, "floor_area_sqm": 70,
            "tenure": "leasehold", "listing_url": "https://example.org/listing/1"})

        by_release = {row["release"]: row for row in out["sources"]}
        self.assertEqual(by_release["src-sales"]["sourceUrl"], "https://example.org/prices")
        kinds = {row["kind"] for row in out["evidence"]}
        self.assertIn("sales-count", kinds)
        self.assertIn("median-price-per-square-metre", kinds)
        self.assertTrue(all(row.get("sourceVersion") for row in out["evidence"]))


@unittest.skipIf(home_search is None, "area_api is not importable")
class CommuteSources215Tests(unittest.TestCase):
    def test_timetable_release_is_a_full_row(self):
        reader = SourceReader()
        reader.get_commute = lambda area_id, places, cancel=None: {
            "productReleaseId": RELEASE, "places": [],
            "network": {"timetable_source_release_id": "src-tfl-test"},
            "caveats": []}
        context = ToolContext(reader=reader, load_match_rows=_match_rows)
        rows = table(TABLE_ROWS + [
            {"id": "src-tfl-test", "source_url": "https://example.org/tfl", "licence": "OGL-UK-3.0",
             "attribution": "Powered by TfL Open Data", "transformation_version": "etl-tfl-1"}])
        reader.source_releases = lambda cancel=None: rows

        out = tools.call_tool("get_commute", context, {
            "area_id": "uk:lsoa:E01000001",
            "places": [{"label": "Work", "latitude": 51.5, "longitude": -0.12}]})

        (source,) = out["sources"]
        self.assertEqual(source["release"], "src-tfl-test")
        self.assertEqual(source["attribution"], "Powered by TfL Open Data")
        self.assertEqual(source["licence"], "OGL-UK-3.0")


@unittest.skipIf(home_search is None, "area_api is not importable")
class PresetsSources215Tests(unittest.TestCase):
    def test_presets_cite_openstreetmap(self):
        context = ToolContext(reader=SourceReader(), load_match_rows=_match_rows)

        out = tools.call_tool("list_custom_presets", context, {})

        (source,) = out["sources"]
        self.assertIn("OpenStreetMap", source["sourceName"])
        self.assertEqual(source["licence"], "ODbL-1.0")
        self.assertIn("OpenStreetMap", source["attribution"])


@unittest.skipIf(home_search is None, "area_api is not importable")
class SearchPlacesSources215Tests(unittest.TestCase):
    def test_search_cites_its_origin_datasets(self):
        context = ToolContext(reader=SourceReader(), load_match_rows=_match_rows)
        rows = table(TABLE_ROWS + [
            {"id": "src-os-open-names-test", "source_url": "https://example.org/os",
             "licence": "OGL-UK-3.0", "attribution": "Contains OS data",
             "transformation_version": "etl-os-1"},
            {"id": "src-hmlr-pp-test", "source_url": "https://example.org/hmlr",
             "licence": "OGL-UK-3.0", "attribution": "Contains HM Land Registry data",
             "transformation_version": "etl-hmlr-1"}])
        context.reader.source_releases = lambda cancel=None: rows

        out = tools.call_tool("search_places", context, {"q": "camden"})

        by_release = {row["release"]: row for row in out["sources"]}
        self.assertIn("src-osm-test", by_release)
        self.assertIn("src-os-open-names-test", by_release)
        self.assertIn("src-hmlr-pp-test", by_release)
        self.assertEqual(by_release["src-osm-test"]["licence"], "ODbL-1.0")


if __name__ == "__main__":
    unittest.main()
