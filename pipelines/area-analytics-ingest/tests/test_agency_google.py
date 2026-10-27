"""Google place ids for agency offices: request shape, name and distance acceptance, ids-only storage."""

import http.client
import io
import os
import unittest
import urllib.error
from contextlib import redirect_stdout
from unittest import mock

from area_analytics import agency_google

LAT, LON = 51.5130, -0.3050


def place(pid, name, lat=LAT, lon=LON):
    return {"id": pid, "displayName": {"text": name, "languageCode": "en"},
            "location": {"latitude": lat, "longitude": lon}}


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.conn.calls.append((sql, params))
        self.rows = self.conn.offices if "FROM agency_office" in sql else []

    def fetchall(self):
        return self.rows


class FakeConn:
    def __init__(self, offices):
        self.offices = offices
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return FakeCursor(self)

    def inserts(self):
        return [params for sql, params in self.calls if "INSERT INTO agency_google_place" in sql]


class GoogleTests(unittest.TestCase):
    def test_body_biases_to_100_metres(self):
        body = agency_google.request_body("Foxtons Ealing", LAT, LON)
        self.assertEqual(body["textQuery"], "Foxtons Ealing")
        self.assertEqual(body["locationBias"]["circle"]["radius"], 100.0)
        self.assertEqual(body["locationBias"]["circle"]["center"], {"latitude": LAT, "longitude": LON})
        self.assertEqual(body["maxResultCount"], 3)

    def test_similarity_matches_pg_trgm_shape(self):
        self.assertEqual(agency_google.name_similarity("Foxtons", "Foxtons"), 1.0)
        self.assertGreaterEqual(agency_google.name_similarity("Foxtons Ealing", "Foxtons - Ealing Estate Agents"), 0.5)
        self.assertLess(agency_google.name_similarity("Foxtons", "Dexters"), 0.5)
        self.assertEqual(agency_google.name_similarity("", "Foxtons"), 0.0)

    def test_metres_is_haversine(self):
        self.assertAlmostEqual(agency_google.metres(51.5, -0.1, 51.5, -0.1), 0.0)
        self.assertAlmostEqual(agency_google.metres(51.5, -0.1, 51.501, -0.1), 111.2, delta=1.0)

    def test_accept_needs_name_and_distance(self):
        far = place("far", "Foxtons Ealing", LAT + 0.0036, LON)  # about 400 m
        near = place("near", "Foxtons - Ealing", LAT + 0.0007, LON)  # about 78 m
        self.assertIsNone(agency_google.accept([far], "Foxtons Ealing", LAT, LON))
        self.assertEqual(agency_google.accept([far, near], "Foxtons Ealing", LAT, LON), "near")
        self.assertIsNone(agency_google.accept([place("x", "Dexters")], "Foxtons Ealing", LAT, LON))
        self.assertIsNone(agency_google.accept([], "Foxtons Ealing", LAT, LON))

    def test_accept_a_name_whose_words_all_appear_in_the_other(self):
        near = (LAT + 0.00072, LON)  # about 80 m
        self.assertEqual(agency_google.accept([place("f", "Foxtons Ealing Estate Agents", *near)], "Foxtons", LAT, LON),
                         "f")
        self.assertEqual(agency_google.accept([place("e", "Elm Estates - Estate Agents in Ealing", *near)],
                                              "Elm Estates", LAT, LON), "e")
        self.assertIsNone(agency_google.accept([place("d", "Dexters", *near)], "Foxtons", LAT, LON))
        far = (LAT + 0.0036, LON)  # about 400 m
        self.assertIsNone(agency_google.accept([place("f", "Foxtons", *far)], "Foxtons", LAT, LON))

    def test_names_agree_needs_a_word_left_after_generic_words(self):
        self.assertFalse(agency_google.names_agree("Ltd", "Elm Lettings Ltd"))
        self.assertTrue(agency_google.names_agree("Elm Lettings Ltd", "ELM"))
        self.assertEqual(agency_google.name_words("The Elm Estates & Lettings Ltd."), {"elm"})

    def test_names_agree_on_real_london_pairs(self):
        # Pairs from OpenStreetMap and Overture offices within 150 m of each other, read by hand (2026-10-14).
        same = (("Property World", "Propertyworld - Sydenham"), ("Sales & Lettings Plc", "Sales & Lettings"),
                ("Park & Bailey", "Park & Bailey Estate Agent - Caterham Hill (SALES)"),
                ("JH Properties", "J H Properties"), ("jdm", "J D M Estate Agents"), ("Munro Lock", "Munrolock"),
                ("Truepennys", "Truepenny's Estate Agent"), ("Chesterton", "Chestertons"),
                ("Foxtons", "Foxtons Ealing Estate Agents"), ("Elm Estates", "Elm Estates - Estate Agents in Ealing"))
        different = (("AA Estate Agents", "J K Estate Agents"), ("First Step Estates", "Next Step Estates"),
                     ("Hiltons Estates", "Keytons Estates"), ("RRS Properties", "T&S Properties"),
                     ("Estates 17", "Estates East"), ("Hamar Property Services", "Open House Property Service"),
                     ("Jacksons Clapham Estate Agents", "John D Wood & Co. Estate Agents Clapham"),
                     ("Foxtons", "Dexters"))
        for a, b in same:
            self.assertTrue(agency_google.names_agree(a, b), (a, b))
        for a, b in different:
            self.assertFalse(agency_google.names_agree(a, b), (a, b))

    def test_review_prints_each_office_and_writes_nothing(self):
        offices = [("a", "Foxtons Ealing", LAT, LON), ("b", "Elm Lettings", LAT, LON), ("c", "Nobody", LAT, LON)]
        answers = {"Foxtons Ealing": {"places": [place("id1", "Foxtons - Ealing")]},
                   "Elm Lettings": {"places": [place("id2", "Oak Homes", lat=LAT + 0.0005)]},
                   "Nobody": {}}
        conn = FakeConn(offices)
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_GOOGLE_PLACES_KEY": "k"}), \
                mock.patch.object(agency_google, "connect", return_value=conn), redirect_stdout(out):
            counts = agency_google.review("postgresql://x", post=lambda url, headers, body: answers[body["textQuery"]])
        self.assertEqual(conn.inserts(), [])
        self.assertIn("Foxtons Ealing | Foxtons - Ealing | 0 m | yes", out.getvalue())
        self.assertIn("Elm Lettings | Oak Homes | 56 m | no", out.getvalue())
        self.assertIn("Nobody | - | - | no", out.getvalue())
        self.assertEqual((counts["matched"], counts["unmatched"]), (1, 2))

    def test_review_asks_50_offices_by_default_spread_across_ids(self):
        conn = FakeConn([(str(n), f"Office {n}", LAT, LON) for n in range(60)])
        asked = []
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_GOOGLE_PLACES_KEY": "k"}), \
                mock.patch.object(agency_google, "connect", return_value=conn), redirect_stdout(io.StringIO()):
            agency_google.review("postgresql://x", post=lambda url, headers, body: asked.append(body) or {})
        self.assertEqual(len(asked), 50)
        self.assertIn("md5(o.id)", conn.calls[0][0])

    def test_offices_without_a_name_are_not_asked(self):
        self.assertIn("AND nullif(btrim(o.name), '') IS NOT NULL", agency_google.OFFICES_SQL)

    def test_progress_lines_hold_counts_only(self):
        out = io.StringIO()
        with mock.patch.object(agency_google, "PROGRESS_EVERY", 2), mock.patch("sys.stdout", out):
            self.go(lambda *a: {}, n=5)
        self.assertEqual(out.getvalue().splitlines(),
                         ["google: 2/5 offices so far: 0 matched, 2 unmatched, 0 errors; error kinds: none",
                          "google: 4/5 offices so far: 0 matched, 4 unmatched, 0 errors; error kinds: none"])

    def test_ctrl_c_prints_the_summary_then_stops(self):
        calls = []

        def post(*args):
            calls.append(1)
            if len(calls) == 3:
                raise KeyboardInterrupt
            return {}

        out = io.StringIO()
        with mock.patch("sys.stdout", out), self.assertRaises(KeyboardInterrupt):
            self.go(post, n=5)
        self.assertIn("google: stopped: 0 matched, 2 unmatched, 0 errors", out.getvalue())

    def test_match_stores_only_ids(self):
        offices = [("a", "Foxtons Ealing", 51.5130, -0.3050), ("b", "Nobody Lettings", 51.4, -0.2),
                   ("c", "Dexters Acton", 51.5, -0.27)]
        answers = {"Foxtons Ealing": {"places": [place("ChIJ-secret-id", "Foxtons - Ealing")]},
                   "Nobody Lettings": {},
                   "Dexters Acton": "boom"}
        seen = []

        def post(url, headers, body):
            seen.append((url, headers, body))
            answer = answers[body["textQuery"]]
            if answer == "boom":
                raise urllib.error.URLError("down")
            return answer

        conn = FakeConn(offices)
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_GOOGLE_PLACES_KEY": "k"}), \
                mock.patch.object(agency_google, "connect", return_value=conn):
            counts = agency_google.match("postgresql://x", post=post)
        self.assertEqual(counts, {"matched": 1, "unmatched": 1, "errors": 1,
                                  "statuses": {"URLError": 1}})
        self.assertEqual(conn.inserts(), [("a", "ChIJ-secret-id"), ("b", None)])
        for params in (p for _, p in conn.calls if p):
            for value in params:
                self.assertNotIn("Foxtons - Ealing", str(value))
        url, headers, _ = seen[0]
        self.assertEqual(url, agency_google.SEARCH_URL)
        self.assertEqual(headers["X-Goog-Api-Key"], "k")
        self.assertEqual(headers["X-Goog-FieldMask"], "places.id,places.displayName,places.location")
        self.assertEqual(headers["Content-Type"], "application/json")

    def test_limit_caps_offices(self):
        conn = FakeConn([("a", "A", LAT, LON), ("b", "B", LAT, LON)])
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_GOOGLE_PLACES_KEY": "k"}), \
                mock.patch.object(agency_google, "connect", return_value=conn):
            counts = agency_google.match("postgresql://x", post=lambda *a: {}, limit=1)
        self.assertEqual(counts, {"matched": 0, "unmatched": 1, "errors": 0,
                                  "statuses": {}})

    def test_no_key_refuses_to_run(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(SystemExit) as raised:
                agency_google.match("postgresql://x", post=lambda *a: {})
        self.assertIn("CLOSE_KNIT_GOOGLE_PLACES_KEY", str(raised.exception))

    def go(self, post, n=10, sleep=None):
        conn = FakeConn([(f"o{i}", "A", LAT, LON) for i in range(n)])
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_GOOGLE_PLACES_KEY": "k"}), \
                mock.patch.object(agency_google, "connect", return_value=conn):
            return conn, agency_google.match("postgresql://x", post=post, sleep=sleep or (lambda s: None))

    def test_rejected_key_stops_after_one_call(self):
        calls = []

        def post(url, headers, body):
            calls.append(1)
            raise urllib.error.HTTPError(url, 403, "secret body text", {}, None)

        with self.assertRaises(SystemExit) as raised:
            self.go(post)
        self.assertEqual(len(calls), 1)
        self.assertIn("HTTP 403", str(raised.exception))
        self.assertNotIn("secret", str(raised.exception))

    def test_quota_backs_off_then_stops(self):
        calls, sleeps = [], []

        def post(url, headers, body):
            calls.append(1)
            raise urllib.error.HTTPError(url, 429, "slow down", {}, None)

        with self.assertRaises(SystemExit) as raised:
            self.go(post, sleep=sleeps.append)
        self.assertEqual(sleeps, [2, 4, 8, 16])
        self.assertEqual(len(calls), 5)
        self.assertIn("429", str(raised.exception))

    def test_quota_that_clears_carries_on(self):
        answers = iter([429, {}])

        def post(url, headers, body):
            answer = next(answers)
            if answer == 429:
                raise urllib.error.HTTPError(url, 429, "slow down", {}, None)
            return answer

        conn, counts = self.go(post, n=1)
        self.assertEqual((counts["unmatched"], counts["errors"]), (1, 0))

    def test_five_errors_in_a_row_stop_but_a_success_resets(self):
        def fail(url, headers, body):
            raise urllib.error.URLError("down")

        calls = []

        def post(url, headers, body):
            calls.append(1)
            raise urllib.error.URLError("down")

        with self.assertRaises(SystemExit) as raised:
            self.go(post)
        self.assertEqual(len(calls), 5)
        self.assertIn("URLError x5", str(raised.exception))

        script = iter([fail] * 4 + [lambda *a: {}] + [fail] * 4 + [lambda *a: {}])

        def mixed(url, headers, body):
            return next(script)(url, headers, body)

        conn, counts = self.go(mixed, n=10)
        self.assertEqual((counts["unmatched"], counts["errors"], counts["statuses"]), (2, 8, {"URLError": 8}))
        self.assertEqual(len(conn.inserts()), 2)

    def test_other_failures_are_counted(self):
        for error in (http.client.IncompleteRead(b""), ValueError("bad json"), urllib.error.HTTPError("u", 500, "x", {}, None)):
            def post(url, headers, body, error=error):
                raise error
            conn, counts = self.go(post, n=2)
            self.assertEqual((counts["errors"], conn.inserts()), (2, []))

    def test_limit_validation(self):
        for options in (["--limit"], ["--limit", "-3"], ["--limit", "x"]):
            with self.assertRaises(SystemExit):
                agency_google.parse_limit(options)
        self.assertEqual(agency_google.parse_limit(["--limit", "7"]), 7)
        self.assertIsNone(agency_google.parse_limit([]))


if __name__ == "__main__":
    unittest.main()
