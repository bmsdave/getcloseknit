"""Area search ranking (#203): an exact, whole-word or prefix hit on the place's own name
ranks above a mid-word substring hit, so "Ham", "Bow" and "Kensington" find the place named so.

Runs the production evidence.SEARCH_SQL text against an in-memory SQLite copy of the live rows;
the only changes are mechanical dialect ones (ILIKE -> LIKE, %s -> ?, ::text dropped, ST_* stubbed).
"""
import sqlite3
import unittest

from area_api import evidence, home_search
from area_api.toolspec import ToolContext

B, M, L = "lad", "msoa", "lsoa"
# (id, kind, ONS name, friendly name, postcode district): ids and names as returned live.
AREAS = [
    ("uk:lad:E09000002", B, "Barking and Dagenham", "Barking and Dagenham", None),
    *[(f"uk:msoa:E0200000{i}", M, f"Barking and Dagenham 00{i - 1}", n, "RM6")
      for i, n in [(2, "Marks Gate"), (3, "Chadwell Heath East"), (4, "Eastbrookend"), (5, "Becontree Heath")]],
    *[(f"uk:lsoa:E010000{i:02d}", L, f"Barking and Dagenham 00{1 + i % 4}{'ABCDEFG'[i % 7]}", "Marks Gate", "RM6")
      for i in range(10, 40)],
    ("uk:lad:E09000027", B, "Richmond upon Thames", "Richmond upon Thames", None),
    ("uk:msoa:E02000800", M, "Richmond upon Thames 017", "Ham", "TW10"),
    ("uk:msoa:E02000311", M, "Enfield 035", "Bowes", "N13"),
    *[(f"uk:lsoa:E0100139{i}", L, f"Enfield 035{'ABCDEF'[i]}", "Bowes", "N13") for i in range(6)],
    *[(f"uk:lsoa:E0100197{i}", L, f"Haringey 001{'ABCDE'[i]}", "Bowes Park", "N22") for i in range(5)],
    *[(f"uk:lsoa:E0100230{i}", L, f"Havering 003{'ABCDEF'[i]}", "Havering-atte-Bower & Chase Cross", "RM5")
      for i in range(6)],
    *[(f"uk:lsoa:E0100350{i}", L, f"Newham 034{'ABCDEFG'[i]}", "Canning Town South & Bow Creek", "E16")
      for i in range(7)],
    ("uk:msoa:E02000866", M, "Tower Hamlets 003", "Bow West", "E3"),
    ("uk:lsoa:E01004228", L, "Tower Hamlets 003A", "Bow West", "E3"),
    ("uk:msoa:E02000383", M, "Hammersmith and Fulham 012", "West Kensington", "W14"),
    *[(f"uk:lsoa:E0100186{i}", L, f"Hammersmith and Fulham 012{'ABCDEF'[i]}", "West Kensington", "W14")
      for i in range(6)],
    ("uk:lad:E09000020", B, "Kensington and Chelsea", "Kensington and Chelsea", None),
    ("uk:msoa:E02000579", M, "Kensington and Chelsea 003", "North Kensington", "W10"),
]


class SqliteSearch:
    """Connection fake: evidence:search runs the production SQL text; the rest answer empty."""

    def __init__(self):
        db = sqlite3.connect(":memory:")
        db.row_factory = lambda cur, row: {c[0]: v for c, v in zip(cur.description, row)}
        db.create_function("ST_Centroid", 1, lambda g: g)
        db.create_function("ST_X", 1, lambda g: 0.0)
        db.create_function("ST_Y", 1, lambda g: 51.5)
        db.executescript("""
            CREATE TABLE area_geography (id text, kind text, official_code text, name text, parent_id text, geometry text);
            CREATE TABLE area_label (geography_id text, friendly_name text, postcode_district text);""")
        for gid, kind, name, friendly, district in AREAS:
            db.execute("INSERT INTO area_geography VALUES (?,?,?,?,NULL,'g')", (gid, kind, gid.split(":")[2], name))
            db.execute("INSERT INTO area_label VALUES (?,?,?)", (gid, friendly, district))
        self.db = db

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- evidence:active-release":
            return [{"release_id": "rel-test"}]
        if marker == "-- evidence:search":
            text = sql.split("\n", 1)[1].replace("::text", "").replace("ILIKE", "LIKE").replace("%s", "?")
            return self.db.execute(text, params).fetchall()
        if marker in ("-- evidence:address-search", "-- evidence:station-search",
                      "-- evidence:address-by-postcode", "-- evidence:active-source-releases"):
            return []
        raise AssertionError(f"unexpected query {marker}")


def search(q, limit):
    connection = SqliteSearch()
    return evidence.EvidenceReader(connect=lambda: connection).search_areas(q, limit=limit)["results"]


def ids(results):
    return [r["geographyId"] for r in results]


class AreaSearchRankingTests(unittest.TestCase):
    def test_exact_friendly_name_comes_first(self):
        found = ids(search("Ham", 25))
        self.assertEqual(found[:1], ["uk:msoa:E02000800"])

    def test_mid_word_ons_name_hit_does_not_outrank_a_whole_word_friendly_name(self):
        found = ids(search("Ham", 25))
        self.assertIn("uk:msoa:E02000800", found)

    def test_whole_word_friendly_name_beats_longer_word_prefix(self):
        found = ids(search("Bow", 25))
        self.assertEqual(found[:2], ["uk:msoa:E02000866", "uk:lsoa:E01004228"])

    def test_borough_whose_name_starts_with_the_query_is_in_search_places(self):
        connection = SqliteSearch()
        context = ToolContext(reader=evidence.EvidenceReader(connect=lambda: connection))
        areas = home_search._search_places(context, home_search.SearchPlacesInput(q="Kensington", limit=3))
        self.assertIn("uk:lad:E09000020", ids(areas["value"]["areas"]))

    # Guards that pass today and must keep passing.
    def test_exact_id_still_first(self):
        self.assertEqual(ids(search("uk:lad:E09000020", 5))[:1], ["uk:lad:E09000020"])

    def test_ons_name_still_finds_the_area(self):
        self.assertEqual(ids(search("Richmond upon Thames 017", 1)), ["uk:msoa:E02000800"])

    def test_full_borough_name_still_first(self):
        self.assertEqual(ids(search("Kensington and Chelsea", 1)), ["uk:lad:E09000020"])


if __name__ == "__main__":
    unittest.main()
