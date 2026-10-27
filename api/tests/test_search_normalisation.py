"""Search normalisation (#228 #229 #230 #236 #239 #240).

The reader tests run the production SQL text (evidence:search, address-search, district-areas,
property-search) against an in-memory SQLite copy of live-shaped rows; the only changes are
mechanical dialect ones (ILIKE -> LIKE, %s -> ?, ::text dropped, ST_*/to_char stubbed).
"""
import sqlite3
import unittest

from area_api import evidence, home_search, search_text, tools
from area_api.toolspec import ToolContext

B, M, L = "lad", "msoa", "lsoa"
# (id, kind, ONS name, friendly name, postcode district), as labelled live.
AREAS = [
    ("uk:lad:E09000019", B, "Islington", "Islington", None),
    ("uk:msoa:E02000960", M, "Westminster 004", "St John's Wood North", "NW8"),
    ("uk:lsoa:E01004647", L, "Westminster 004A", "St John's Wood North", "NW8"),
    ("uk:msoa:E02007115", M, "Camden 028", "King's Cross & Bloomsbury North", "WC1"),
    ("uk:msoa:E02000575", M, "Islington 015", "Canonbury", "N1"),
    ("uk:lsoa:E01002760", L, "Islington 015A", "Canonbury", "N1"),
    ("uk:lsoa:E01002761", L, "Islington 015B", "Canonbury", "N1"),
    ("uk:msoa:E02000300", M, "Enfield 024", "Bush Hill Park", "EN1"),
    ("uk:lsoa:E01001516", L, "Enfield 024A", "Bush Hill Park", "EN1"),
    ("uk:msoa:E02000866", M, "Tower Hamlets 003", "Bow West", "E3"),
    ("uk:msoa:E02000890", M, "Tower Hamlets 027", "Canary Wharf", "E14"),
    ("uk:lsoa:E01001071", L, "Croydon 020A", "Addiscombe", "CR0"),
]
PARK_HILL = [(f"uk:addr:phc{n:09d}", f"{n}, Park Hill Court Addiscombe Road, Croydon, CR0 5PG", "CR0 5PG",
              "uk:lsoa:E01001071") for n in range(1, 23)]
ADDRESSES = [
    ("uk:addr:000000000001", "1000 Great Cambridge Road, Enfield, EN1 4JR", "EN1 4JR", "uk:lsoa:E01001516"),
    ("uk:addr:000000000002", "1003 High Road, London, N12 8QX", "N12 8QX", "uk:lsoa:E01001516"),
    ("uk:addr:000000000003", "100a Albion Road, London, N16 9PD", "N16 9PD", "uk:lsoa:E01001516"),
    ("uk:addr:000000000004", "10 Cross Street, London, N1 3LQ", "N1 3LQ", "uk:lsoa:E01002760"),
    ("uk:addr:e294b0427cdb", "100a St Johns Wood High Street, London, NW8 7SH", "NW8 7SH", "uk:lsoa:E01004647"),
    ("uk:addr:000000000006", "Flat 1, 5 Kings Cross Road, London, WC1X 9QX", "WC1X 9QX", "uk:lsoa:E01002760"),
    ("uk:addr:000000000007", "Flat 32, Park Hill Court Addiscombe Road, Croydon, CR0 5PJ", "CR0 5PJ",
     "uk:lsoa:E01001071"),
    ("uk:addr:000000000008", "10 Downing Street, London, SW1A 2AA", "SW1A 2AA", "uk:lsoa:E01002760"),
    ("uk:addr:000000000009", "1 Giltspur Street, London, EC1A 9DD", "EC1A 9DD", "uk:lsoa:E01002760"),
    ("uk:addr:000000000010", "10 Borwick Avenue, London, E17 6RA", "E17 6RA", "uk:lsoa:E01002760"),
    ("uk:addr:000000000011", "103b Kings Grove, London, SE15 2NA", "SE15 2NA", "uk:lsoa:E01002760"),
    ("uk:addr:000000000012", "12 Kings Grove, Romford, RM1 2SU", "RM1 2SU", "uk:lsoa:E01002760"),
    *PARK_HILL,
]


class SqliteSearch:
    """Connection fake: the search queries run the production SQL text; the rest answer empty."""

    def __init__(self):
        db = sqlite3.connect(":memory:")
        db.row_factory = lambda cur, row: {c[0]: v for c, v in zip(cur.description, row)}
        db.create_function("ST_Centroid", 1, lambda g: g)
        db.create_function("ST_X", 1, lambda g: 0.0)
        db.create_function("ST_Y", 1, lambda g: 51.5)
        db.create_function("to_char", 2, lambda v, f: None)
        db.executescript("""
            CREATE TABLE area_geography (id text, kind text, official_code text, name text, parent_id text, geometry text);
            CREATE TABLE area_label (geography_id text, friendly_name text, postcode_district text);
            CREATE TABLE active_product_release (release_id text);
            CREATE TABLE product_release_member (release_id text, source_release_id text);
            CREATE TABLE address (id text, display_address text, postcode text, geography_id text, source_release_id text);
            CREATE TABLE address_transaction (address_id text, source_release_id text);
            CREATE TABLE property (uprn text, address_id text, address text, geography_id text, parcel_id text,
                                   location text, source_release_id text);
            CREATE TABLE property_stock_value (uprn text, source_release_id text, period text, sale_period text,
                                               completion_date text, nominal_price integer, floor_area_square_metres real);
            CREATE TABLE suppressed_dwelling (address_id text, uprn text);
            INSERT INTO active_product_release VALUES ('rel-test');
            INSERT INTO product_release_member VALUES ('rel-test', 'src-1');""")
        for gid, kind, name, friendly, district in AREAS:
            db.execute("INSERT INTO area_geography VALUES (?,?,?,?,NULL,'g')", (gid, kind, gid.split(":")[2], name))
            db.execute("INSERT INTO area_label VALUES (?,?,?)", (gid, friendly, district))
        for aid, display, postcode, gid in ADDRESSES:
            db.execute("INSERT INTO address VALUES (?,?,?,?,'src-1')", (aid, display, postcode, gid))
        # The linked home's address row: property-search reaches homes through address.
        db.execute("INSERT INTO address VALUES ('uk:addr:000000000099', '1000 Eastern Avenue, Ilford, IG2 7HX', "
                   "'IG2 7HX', 'uk:lsoa:E01001516', 'src-1')")
        db.execute("INSERT INTO property VALUES ('100022208794', 'uk:addr:000000000099', "
                   "'1000 Eastern Avenue, Ilford, IG2 7HX', 'uk:lsoa:E01001516', NULL, 'p', 'src-1')")
        # Two unlinked homes with a recorded sale in one postcode: a fragment naming both is ambiguous.
        db.execute("INSERT INTO address_transaction VALUES ('uk:addr:phc000000001', 'src-1')")
        db.execute("INSERT INTO address_transaction VALUES ('uk:addr:phc000000002', 'src-1')")
        self.db = db
        self.markers = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        self.markers.append(marker)
        if marker == "-- evidence:active-release":
            return [{"release_id": "rel-test"}]
        if marker == "-- evidence:street-table":
            return [{"t": False}]
        if marker in ("-- evidence:search", "-- evidence:address-search", "-- evidence:district-areas",
                      "-- evidence:property-search", "-- evidence:address-by-postcode"):
            text = sql.split("\n", 1)[1].replace("::text", "").replace("ILIKE", "LIKE").replace("%s", "?")
            return self.db.execute(text, params).fetchall()
        if marker in ("-- evidence:station-search", "-- evidence:postcode-area"):
            return []
        raise AssertionError(f"unexpected query {marker}")


def reader(connection=None):
    return evidence.EvidenceReader(connect=lambda: connection or SqliteSearch())


def search(q, limit=10):
    return reader().search_areas(q, limit=limit)["results"]


def area_ids(results):
    return [r["geographyId"] for r in results if not r.get("addressId")]


def address_ids(results):
    return [r["addressId"] for r in results if r.get("addressId")]


class NormaliseQueryTests(unittest.TestCase):
    def test_punctuation_forms_share_one_key(self):
        for text in ("St John's Wood", "St Johns Wood", "St. John's Wood", "St John’s Wood",
                     "ST-JOHNS-WOOD", "Saint John's Wood", " st  johns   wood "):
            self.assertEqual(search_text.normalise_query(text), "st johns wood", text)
        self.assertEqual(search_text.normalise_query("King's Cross & Bloomsbury"), "kings cross and bloomsbury")
        self.assertEqual(search_text.normalise_query("Café Royal"), "cafe royal")
        self.assertEqual(search_text.normalise_query("2, Park Hill Court", keep=","), "2, park hill court")
        self.assertEqual(search_text.normalise_query("!!"), "")

    def test_sql_twin_matches_python(self):
        db = sqlite3.connect(":memory:")
        for name in ("St John's Wood North", "King's Cross & Bloomsbury North", "St. John’s Wood",
                     "Havering-atte-Bower & Chase Cross", "Canning Town South & Bow Creek"):
            key = db.execute(f"SELECT {search_text.NAME_KEY_SQL.format(column='?')}", (name,)).fetchone()[0]
            self.assertEqual(key, search_text.normalise_query(name), name)

    def test_like_escape_neutralises_wildcards(self):
        self.assertEqual(search_text.like_escape("a_b%c\\d"), "a\\_b\\%c\\\\d")

    def test_district_and_empty_reason(self):
        self.assertEqual(search_text.postcode_district(" n1 "), "N1")
        self.assertEqual(search_text.postcode_district("SW1A"), "SW1A")
        self.assertIsNone(search_text.postcode_district("N1 3LQ"))
        self.assertIsNone(search_text.postcode_district("Bow"))
        self.assertEqual(search_text.empty_reason("M1 1AE"), "outside-london")
        self.assertEqual(search_text.empty_reason("EH1"), "outside-london")
        self.assertEqual(search_text.empty_reason("N1 9ZZ"), "unknown-postcode")
        self.assertEqual(search_text.empty_reason("Clapham Juntion"), "no-match")


class AreaNameNormalisationTests(unittest.TestCase):
    """#228: 'St Johns Wood', 'St. John's Wood', the curly apostrophe and 'Kings Cross' find the areas."""

    def test_apostrophe_and_dot_forms_find_the_area(self):
        for q in ("St Johns Wood", "St. John's Wood", "St John’s Wood", "saint johns wood"):
            self.assertIn("uk:msoa:E02000960", area_ids(search(q)), q)

    def test_curly_apostrophe_finds_the_address_too(self):
        self.assertIn("uk:addr:e294b0427cdb", address_ids(search("St John’s Wood")))

    def test_kings_cross_without_apostrophe(self):
        found = search("Kings Cross")
        self.assertIn("uk:msoa:E02007115", area_ids(found))
        self.assertIn("uk:addr:000000000006", address_ids(found))

    def test_id_and_code_lookups_still_work(self):
        self.assertEqual(area_ids(search("uk:msoa:E02000866", 1)), ["uk:msoa:E02000866"])
        self.assertEqual(area_ids(search("E02000890", 1)), ["uk:msoa:E02000890"])


class PostcodeDistrictTests(unittest.TestCase):
    """#229: a bare district returns the district's areas and no single homes."""

    def test_n1_returns_n1_areas_only(self):
        found = search("N1")
        self.assertEqual(area_ids(found), ["uk:msoa:E02000575", "uk:lsoa:E01002760", "uk:lsoa:E01002761"])
        self.assertEqual(address_ids(found), [])
        self.assertTrue(all(row["kind"] in ("msoa", "lsoa") for row in found))

    def test_lower_case_and_other_districts(self):
        self.assertEqual(area_ids(search("e14")), ["uk:msoa:E02000890"])
        self.assertEqual(area_ids(search("EN1")), ["uk:msoa:E02000300", "uk:lsoa:E01001516"])
        self.assertEqual(address_ids(search("EN1")), [])

    def test_unknown_district_is_empty_not_arbitrary_homes(self):
        self.assertEqual(search("N19"), [])

    def test_district_with_no_labelled_area_falls_back_to_its_homes(self):
        """SW1A, EC1A: no area is labelled with them, so the plain search answers (prod preflight)."""
        for q, addr in (("SW1A", "uk:addr:000000000008"), ("EC1A", "uk:addr:000000000009"),
                        ("sw1a", "uk:addr:000000000008")):
            found = search(q)
            self.assertEqual(address_ids(found), [addr], q)
            self.assertEqual(area_ids(found), [], q)

    def test_partial_outcode_still_searches(self):
        self.assertEqual(address_ids(search("SW1")), ["uk:addr:000000000008"])


class AddressOrderTests(unittest.TestCase):
    """#236: the exact home first, then natural number order, within the per-kind cap."""

    def test_exact_flat_ranks_first(self):
        self.assertEqual(address_ids(search("2, Park Hill Court Addiscombe"))[:1], ["uk:addr:phc000000002"])

    def test_postcode_homes_come_in_natural_order(self):
        found = address_ids(search("CR0 5PG", 10))
        self.assertEqual(found, [f"uk:addr:phc{n:09d}" for n in range(1, 11)])


class PortalAddressTests(unittest.TestCase):
    """#149: "street + outcode/postcode" with no comma, through the production SQL."""

    def test_number_street_postcode_finds_the_home(self):
        for q in ("10 Borwick Avenue E17 6RA", "10 Borwick Avenue, E17 6RA", "Borwick Avenue E17",
                  "10 Borwick Avenue London E17"):
            self.assertEqual(address_ids(search(q)), ["uk:addr:000000000010"], q)

    def test_the_outcode_scopes_same_named_streets(self):
        self.assertEqual(address_ids(search("Kings Grove SE15")), ["uk:addr:000000000011"])
        self.assertEqual(address_ids(search("Kings Grove, RM1")), ["uk:addr:000000000012"])
        self.assertEqual(len(address_ids(search("Kings Grove"))), 2)

    def test_home_prices_ref_with_postcode_resolves_or_stays_ambiguous(self):
        for ref in ("1000 Eastern Avenue IG2 7HX", "1000 Eastern Avenue IG2", "1000 Eastern Avenue, Ilford IG2"):
            self.assertEqual(reader().find_property(ref)["property"]["uprn"], "100022208794", ref)
        with self.assertRaises(evidence.PropertyNotFound):
            reader().find_property("1000 Eastern Avenue E17")
        with self.assertRaises(evidence.PropertyAmbiguous) as raised:
            reader().find_property("Park Hill Court Addiscombe Road CR0 5PG")
        self.assertEqual(len(raised.exception.candidates), 2)


class WildcardTests(unittest.TestCase):
    """#239: LIKE wildcards are literal and punctuation-only queries match nothing."""

    def test_underscores_do_not_match_a_home(self):
        with self.assertRaises(evidence.MalformedQuery):
            reader().find_property("___")
        with self.assertRaises(evidence.MalformedQuery):
            reader().find_property("%%%")
        self.assertEqual(reader().find_property("1000 Eastern")["property"]["uprn"], "100022208794")

    def test_wildcards_in_a_real_query_are_literal(self):
        with self.assertRaises(evidence.PropertyNotFound):
            reader().find_property("1000 E_stern")
        self.assertEqual(search("E0200089_"), [])

    def test_punctuation_only_area_search_finds_nothing(self):
        for q in ("%%", "!!", "Кингс"):
            connection = SqliteSearch()
            self.assertEqual(reader(connection).search_areas(q)["results"], [], q)
            self.assertEqual(connection.markers, ["-- evidence:active-release"], q)

    def test_punctuation_only_station_search_finds_nothing(self):
        connection = SqliteSearch()
        self.assertEqual(reader(connection).search_stations("!!")["results"], [])
        self.assertNotIn("-- evidence:station-search", connection.markers)


class EmptyReader:
    def search_areas(self, q, limit=10, cancel=None):
        return {"productReleaseId": "rel-test", "results": []}

    def search_stations(self, q, cancel=None):
        return {"results": []}


class StreetReader(EmptyReader):
    def search_areas(self, q, limit=10, cancel=None):
        return {"productReleaseId": "rel-test", "results": [
            {"geographyId": "uk:lsoa:E01001071", "label": "66 Valley Road", "secondaryLabel": "Croydon",
             "uprn": None, "street": {"name": "Valley Road", "number": 66}, "kind": "street"},
            {"geographyId": "uk:lad:E09000008", "label": "Croydon", "secondaryLabel": "Borough"}]}


class ToolEmptyResultTests(unittest.TestCase):
    """#230: nothing found means confidence none and a typed reason, not high."""

    def places(self, q, reader=None):
        context = ToolContext(reader=reader or EmptyReader())
        return home_search._search_places(context, home_search.SearchPlacesInput(q=q))

    def test_reasons(self):
        for q, reason in (("M1 1AE", "outside-london"), ("EH1 1YZ", "outside-london"),
                          ("N1 9ZZ", "unknown-postcode"), ("Clapham Juntion", "no-match")):
            out = self.places(q)
            self.assertEqual(out["confidence"], "none", q)
            self.assertEqual(out["value"]["reason"], reason, q)
            self.assertIn(search_text.EMPTY_REASONS[reason], out["caveats"])

    def test_search_areas_tool_too(self):
        out = tools._search_areas(ToolContext(reader=EmptyReader()), tools.SearchAreasInput(q="ZZ9 9ZZ"))
        self.assertEqual(out["confidence"], "none")
        self.assertIn(search_text.EMPTY_REASONS["outside-london"], out["caveats"])

    def test_a_hit_stays_high_with_no_reason(self):
        out = self.places("66 Valley Road, Kenley", StreetReader())
        self.assertEqual(out["confidence"], "high")
        self.assertIsNone(out["value"]["reason"])

    def test_street_rows_keep_their_kind(self):
        """#240: search_places labels a street hit 'street', as search_areas does."""
        areas = self.places("66 Valley Road, Kenley", StreetReader())["value"]["areas"]
        self.assertEqual([row["kind"] for row in areas], ["street", "lad"])


if __name__ == "__main__":
    unittest.main()
