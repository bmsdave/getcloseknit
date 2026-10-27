"""Geograph photos in London (migration 043): dump filtering and reading."""

import gzip
import os
import tempfile
import unittest

from area_analytics import geograph


def entry(id_="4015171", name="Marathon", title="The Nelsons' drinking fountain", status="geograph",
          taken="2014-05-28", lat="51.541919", lon="-0.055269", user="43806"):
    return [id_, user, name, title, status, taken, "TQ3484", "534", "184", lat, lon, "1"]


class PhotoRowsTests(unittest.TestCase):
    def test_keeps_accepted_london_photos_with_a_credit(self):
        rows = geograph.photo_rows([
            entry("9", status="accepted"),
            entry("4015171"),
            entry("3", status="pending"),
            entry("4", status="rejected"),
            entry("5", lat="51.710646", lon="-2.277400"),  # Woodchester, Gloucestershire
            entry("6", name="  "),
            entry("7", title=""),
            entry("x"),
            entry("8", lat="nope"),
            entry("10")[:5],
        ])
        self.assertEqual([row["id"] for row in rows], [9, 4015171])
        self.assertEqual(rows[1], {"id": 4015171, "title": "The Nelsons' drinking fountain",
                                   "photographer": "Marathon", "user_id": 43806, "taken": "2014-05-28",
                                   "lat": 51.541919, "lon": -0.055269})

    def test_unescapes_fields_and_drops_unknown_dates(self):
        [row] = geograph.photo_rows([entry(title="Mare Street\\tlooking north\\nat dusk", taken="0000-00-00")])
        self.assertEqual(row["title"], "Mare Street looking north at dusk")
        self.assertIsNone(row["taken"])
        self.assertIsNone(geograph.photo_rows([entry(taken="2014-05-00")])[0]["taken"])

    def test_later_duplicate_id_wins(self):
        rows = geograph.photo_rows([entry("1", title="Old"), entry("1", title="New")])
        self.assertEqual([row["title"] for row in rows], ["New"])


class DumpRowsTests(unittest.TestCase):
    def write(self, lines):
        handle = tempfile.NamedTemporaryFile(suffix=".tsv.gz", delete=False)
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        with gzip.open(handle.name, "wt", encoding="utf-8") as out:
            out.write("".join("\t".join(line) + "\n" for line in lines))
        return handle.name

    def test_reads_a_dump_with_its_header_line(self):
        header, rows = geograph.dump_rows(self.write([list(geograph.HEADER), entry()]))
        self.assertEqual(header, geograph.HEADER)
        self.assertEqual([r["id"] for r in geograph.photo_rows(rows, header)], [4015171])

    def test_reads_a_dump_without_a_header_line(self):
        header, rows = geograph.dump_rows(self.write([entry("1"), entry("2")]))
        self.assertEqual([r["id"] for r in geograph.photo_rows(rows, header)], [1, 2])


class TsvTests(unittest.TestCase):
    def test_tsv_escapes_backslashes_for_copy_text_format(self):
        self.assertEqual(geograph._tsv("a\\b\tc"), "a\\\\b c")
        self.assertEqual(geograph._tsv(None), "")


if __name__ == "__main__":
    unittest.main()
