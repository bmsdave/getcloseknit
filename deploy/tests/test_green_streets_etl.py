"""Green streets ETL (migration 066): reading OS Open Roads shapefiles, which links count, tree sizes and the schema."""
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import etl_green_streets  # noqa: E402

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "066-street-trees.sql").read_text()


def write_dbf(path: Path, fields: list[tuple[str, int]], rows: list[dict]) -> None:
    header_length = 32 + 32 * len(fields) + 1
    record_length = 1 + sum(size for _, size in fields)
    out = bytearray(struct.pack("<BBBBIHH20x", 3, 126, 1, 1, len(rows), header_length, record_length))
    for name, size in fields:
        out += struct.pack("<11sc4xBB14x", name.encode(), b"C", size, 0)
    out += b"\r"
    for row in rows:
        out += b" " + b"".join(str(row.get(name, "")).encode().ljust(size)[:size] for name, size in fields)
    path.write_bytes(bytes(out) + b"\x1a")


def write_shp(path: Path, lines: list[list[tuple[float, float]]]) -> None:
    records = bytearray()
    for number, points in enumerate(lines, start=1):
        xs, ys = [x for x, _ in points], [y for _, y in points]
        content = struct.pack("<i4d2i", 3, min(xs), min(ys), max(xs), max(ys), 1, len(points)) + struct.pack("<i", 0)
        content += b"".join(struct.pack("<2d", x, y) for x, y in points)
        records += struct.pack(">ii", number, len(content) // 2) + content
    header = struct.pack(">i20xi", 9994, (100 + len(records)) // 2) + struct.pack("<ii4d32x", 1000, 3, 0, 0, 0, 0)
    path.write_bytes(header + bytes(records))


FIELDS = [("identifier", 38), ("name1", 40), ("function", 40), ("formOfWay", 30), ("structure", 14)]


class RoadLinkTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        rows = [
            {"identifier": "A", "name1": "Kyverdale Road", "function": "Local Road", "formOfWay": "Single Carriageway"},
            {"identifier": "B", "name1": "", "function": "Motorway", "formOfWay": "Dual Carriageway"},
            {"identifier": "C", "name1": "Slip", "function": "A Road", "formOfWay": "Slip Road"},
            {"identifier": "D", "name1": "Tunnel", "function": "A Road", "formOfWay": "Single Carriageway", "structure": "Road In Tunnel"},
            {"identifier": "E", "name1": "Far Lane", "function": "Local Road", "formOfWay": "Single Carriageway"},
            {"identifier": "F", "name1": "Stub", "function": "Local Road", "formOfWay": "Single Carriageway"},
        ]
        lines = [[(533000, 186000), (533030, 186040)], [(533000, 186000), (533100, 186000)], [(533000, 186000), (533100, 186000)],
                 [(533000, 186000), (533100, 186000)], [(450000, 120000), (450100, 120000)], [(533000, 186000), (533000.3, 186000)]]
        write_dbf(self.dir / "TQ_RoadLink.dbf", FIELDS, rows)
        write_shp(self.dir / "TQ_RoadLink.shp", lines)
        # The same link again in the next square's file (it crosses the square's edge).
        write_dbf(self.dir / "TL_RoadLink.dbf", FIELDS, rows[:1])
        write_shp(self.dir / "TL_RoadLink.shp", lines[:1])

    def test_dbf_and_shp_read_back(self):
        rows = list(etl_green_streets.dbf_rows(str(self.dir / "TQ_RoadLink.dbf")))
        self.assertEqual(rows[0]["name1"], "Kyverdale Road")
        box, parts = next(etl_green_streets.shp_lines(str(self.dir / "TQ_RoadLink.shp")))
        self.assertEqual(box, (533000, 186000, 533030, 186040))
        self.assertEqual(parts, [[(533000, 186000), (533030, 186040)]])

    def test_streets_only_once_near_london(self):
        links = list(etl_green_streets.road_links([str(self.dir / "TQ_RoadLink.shp"), str(self.dir / "TL_RoadLink.shp")]))
        # Motorway, slip road, tunnel, a link far from London and a sub-metre stub are left out; A is read once.
        self.assertEqual([link[0] for link in links], ["A"])
        self.assertEqual(links[0][1:4], ("Kyverdale Road", "Local Road", 50.0))
        self.assertEqual(links[0][4], "SRID=27700;LINESTRING(533000.0 186000.0,533030.0 186040.0)")


class TreeSizeRowsTests(unittest.TestCase):
    def test_only_trees_with_something_recorded(self):
        header = "borough,lat,lon,uniqueid,gla_name,maintainer,height_m,canopy_m,girth_dbh,age_cat\n"
        body = ("Hackney,51.56,-0.07,1,Plane,LB Hackney,13 m,8 m,32 cm,Mature (31-80)\n"
                "Hackney,51.56,-0.07,2,Lime,LB Hackney,Not recorded,Not recorded,Not recorded,Not provided\n")
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as handle:
            handle.write(header + body)
        self.assertEqual(list(etl_green_streets.tree_sizes(handle.name)),
                         [("Hackney:1", "13 m", "8 m", "32 cm", 8.0, "Mature (31-80)")])


class SchemaTests(unittest.TestCase):
    def test_each_tree_counts_once_for_its_nearest_link(self):
        self.assertIn("ST_DWithin(r.geometry, tree.at, 20)", MIGRATION)
        self.assertIn("ORDER BY r.geometry <-> tree.at\n            LIMIT 1", MIGRATION)

    def test_tiles_have_zoom_gates_and_never_the_whole_list(self):
        self.assertIn("IF z < 13 THEN\n        RETURN NULL;", MIGRATION.split("FUNCTION public.street_tree_tile")[1])
        self.assertIn("IF z < 15 THEN", MIGRATION)
        self.assertIn("IF z < 13 THEN", MIGRATION.split("FUNCTION public.green_street_tile")[1])
        # A short stub counts as 50 m, and canopy share needs most trees' canopy recorded.
        self.assertIn("greatest(r.length_m, 50)", MIGRATION)
        self.assertIn("r.canopy_trees * 5 >= r.trees * 4", MIGRATION)
        # Trees over a tile edge come too, so a wide crown is never cut at the seam.
        self.assertIn("ST_TileEnvelope(z, x, y, margin => 64.0 / 4096)", MIGRATION)

    def test_bundle_checks_the_migration_and_the_tree_list(self):
        self.assertIn("apply deploy/migrations/066-street-trees.sql first", etl_green_streets.BUNDLE_HEAD)
        self.assertIn("IF matched < 0.99 * sized THEN", etl_green_streets.BUNDLE_TREES_APPLY)
        self.assertTrue(etl_green_streets.BUNDLE_TAIL.startswith("\\.\nCOMMIT;"))

    def test_sql_literal(self):
        self.assertEqual(etl_green_streets.sql_literal("O'Neil"), "'O''Neil'")
        self.assertEqual(etl_green_streets.sql_literal(["a", "b"]), "ARRAY['a', 'b']::text[]")
        self.assertEqual(etl_green_streets.sql_literal([]), "'{}'::text[]")
        self.assertEqual(etl_green_streets.sql_literal(None), "NULL")


if __name__ == "__main__":
    unittest.main()
