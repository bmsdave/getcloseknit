import threading
import time
import unittest
from types import SimpleNamespace
from unittest import mock

from area_api import card_cache, listing_badges, listing_card
from area_api.evidence import EvidenceReader
from tests.test_production_evidence import seed_production_fixture

try:
    from area_api import app as app_module
except ModuleNotFoundError:  # dependencies are not installed
    app_module = None


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class TTLCacheTests(unittest.TestCase):
    def test_an_entry_lives_for_its_ttl(self):
        clock = Clock()
        cache = card_cache.TTLCache(limit=10, seconds=3600, clock=clock)
        cache.put("a", 1)
        clock.now += 3599
        self.assertEqual(cache.get("a"), 1)
        clock.now += 1
        self.assertIsNone(cache.get("a"))
        self.assertEqual(len(cache), 0)

    def test_the_least_recently_used_entry_goes_first(self):
        cache = card_cache.TTLCache(limit=2)
        cache.put("a", 1)
        cache.put("b", 2)
        cache.get("a")  # "b" is now the oldest
        cache.put("c", 3)
        self.assertEqual((cache.get("a"), cache.get("b"), cache.get("c")), (1, None, 3))
        self.assertEqual(len(cache), 2)

    def test_a_build_runs_once_and_a_failing_build_stores_nothing(self):
        cache = card_cache.TTLCache(limit=4)
        calls = []
        self.assertEqual(cache.get_or_build("k", lambda: calls.append(1) or "v"), "v")
        self.assertEqual(cache.get_or_build("k", lambda: calls.append(1) or "w"), "v")
        self.assertEqual(len(calls), 1)
        with self.assertRaises(ValueError):
            cache.get_or_build("bad", lambda: (_ for _ in ()).throw(ValueError("no")))
        self.assertEqual(cache.get("bad", "missing"), "missing")
        # None is a value like any other (a profile without a factor release).
        cache.get_or_build("none", lambda: None)
        self.assertEqual(cache.get_or_build("none", lambda: "rebuilt"), None)

    def test_it_stays_bounded_under_many_threads(self):
        cache = card_cache.TTLCache(limit=50)

        def fill(start):
            for n in range(start, start + 500):
                cache.put(n, n)
                cache.get(n - 3)

        threads = [threading.Thread(target=fill, args=(n * 1000,)) for n in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(cache), 50)


class KeyTests(unittest.TestCase):
    def test_a_profile_key_ignores_key_order_and_tells_searches_apart(self):
        one = {"v": 1, "market": "buy", "factors": [{"factorId": "crime", "weight": 3}]}
        same = {"factors": [{"weight": 3, "factorId": "crime"}], "market": "buy", "v": 1}
        other = {**one, "market": "rent"}
        self.assertEqual(card_cache.profile_key(one), card_cache.profile_key(same))
        self.assertNotEqual(card_cache.profile_key(one), card_cache.profile_key(other))
        self.assertEqual(len(card_cache.profile_key(one)), 64)

    def test_the_release_is_read_at_most_once_a_minute(self):
        card_cache.forget_release()
        self.addCleanup(card_cache.forget_release)
        connection = seed_production_fixture()
        reader = EvidenceReader(connect=lambda: connection)
        clock = Clock()
        first = card_cache.release_id(reader, clock)
        count = len(connection.statements)
        clock.now += 59
        self.assertEqual(card_cache.release_id(reader, clock), first)
        self.assertEqual(len(connection.statements), count)
        clock.now += 1
        card_cache.release_id(reader, clock)
        self.assertEqual(len(connection.statements), count + 1)
        self.assertTrue(first)

    def test_a_reader_without_a_database_has_no_release(self):
        card_cache.forget_release()
        self.addCleanup(card_cache.forget_release)
        self.assertEqual(card_cache.release_id(SimpleNamespace()), "")


class ParallelTests(unittest.TestCase):
    def test_tasks_run_at_once_and_a_failure_is_returned(self):
        def slow():
            time.sleep(0.1)
            return "done"

        started = time.perf_counter()
        done = card_cache.run_parallel({"a": slow, "b": slow, "c": slow, "d": slow,
                                        "bad": lambda: 1 / 0}, workers=5)
        elapsed = time.perf_counter() - started
        self.assertLess(elapsed, 0.3)  # 0.4 s one after another
        self.assertEqual(done["a"], (True, "done"))
        self.assertFalse(done["bad"][0])
        self.assertIsInstance(done["bad"][1], ZeroDivisionError)


AREA = "uk:lsoa:E01000004"


class AreaPartTests(unittest.TestCase):
    def setUp(self):
        listing_badges.clear_cache()
        self.addCleanup(listing_badges.clear_cache)
        self.connection = seed_production_fixture()
        self.context = SimpleNamespace(reader=EvidenceReader(connect=lambda: self.connection), cancel=None)

    def test_a_cache_hit_asks_the_database_nothing_and_is_fast(self):
        started = time.perf_counter()
        first = listing_card.area_part(self.context, AREA)
        cold = time.perf_counter() - started
        count = len(self.connection.statements)
        started = time.perf_counter()
        second = listing_card.area_part(self.context, AREA)
        warm = time.perf_counter() - started

        self.assertIs(first, second)
        self.assertEqual(len(self.connection.statements), count)
        self.assertLess(warm, 0.005)
        self.assertLess(warm, cold)
        self.assertEqual(set(first), {"pack", "place", "around", "layers"})
        self.assertIn("profile", first["layers"])

    def test_a_listing_seen_again_asks_the_database_nothing(self):
        request = listing_card.ListingCardRequest(portal="rightmove", listingId="1", lat=51.535, lng=-0.145,
                                                  url="https://www.rightmove.co.uk/properties/1", askingPrice=500000)
        first = listing_card.listing_card(self.context, request)
        count = len(self.connection.statements)
        second = listing_card.listing_card(self.context, request)

        self.assertEqual(first, second)
        self.assertEqual(first["geographyId"], AREA)
        self.assertEqual(len(self.connection.statements), count)

    def test_the_card_and_the_results_line_share_the_area(self):
        listing_card.area_part(self.context, AREA)
        count = len(self.connection.statements)
        listing_badges.area_facts(self.context, AREA)
        markers = {sql.split("\n")[0] for sql, _ in self.connection.statements[count:]}
        # Only what the line adds (London ranks, standouts), not the pack or the layers again.
        self.assertNotIn("-- evidence:area-values", markers)
        self.assertNotIn("-- evidence:area-profile", markers)

    def test_a_new_release_reads_the_area_again(self):
        listing_card.area_part(self.context, AREA)
        count = len(self.connection.statements)
        with mock.patch.object(card_cache, "release_id", return_value="next-release"):
            listing_card.area_part(self.context, AREA)
        self.assertGreater(len(self.connection.statements), count)

    def test_a_failing_layer_is_left_out_and_a_failing_pack_is_not_kept(self):
        with mock.patch("area_api.flood.area_flood", side_effect=RuntimeError("down")):
            part = listing_card.area_part(self.context, AREA)
        self.assertNotIn("flood", part["layers"])
        listing_badges.clear_cache()
        with mock.patch.object(self.context.reader, "get_area_pack", side_effect=RuntimeError("down")):
            with self.assertRaises(RuntimeError):
                listing_card.area_part(self.context, AREA)
        self.assertEqual(len(listing_card.AREA_CACHE), 0)


@unittest.skipIf(app_module is None, "dependencies are not installed")
class MatchPackCacheTests(unittest.TestCase):
    def setUp(self):
        app_module.MATCH_PACKS.clear()
        self.addCleanup(app_module.MATCH_PACKS.clear)

    def test_a_saved_search_builds_its_pack_once_per_release(self):
        profile = {"v": 1, "factors": [{"factorId": "crime", "weight": 3}]}
        pack = {"values": [{"geographyId": AREA, "score": 70, "rank": 1}]}
        with mock.patch.object(app_module, "load_match_evidence", return_value=[{"row": 1}]) as load, \
                mock.patch.object(app_module, "build_match_pack", return_value=pack) as build, \
                mock.patch.object(app_module, "load_zone_lsoas", return_value=None), \
                mock.patch.object(card_cache, "release_id", return_value="r1"):
            self.assertIs(app_module._extension_match_pack(profile), pack)
            self.assertIs(app_module._extension_match_pack(dict(reversed(list(profile.items())))), pack)
            self.assertEqual((load.call_count, build.call_count), (1, 1))
            app_module._extension_match_pack({**profile, "market": "rent"})
            self.assertEqual(build.call_count, 2)
        with mock.patch.object(app_module, "load_match_evidence", return_value=[{"row": 1}]), \
                mock.patch.object(app_module, "build_match_pack", return_value=pack) as build, \
                mock.patch.object(app_module, "load_zone_lsoas", return_value=None), \
                mock.patch.object(card_cache, "release_id", return_value="r2"):
            app_module._extension_match_pack(profile)
            self.assertEqual(build.call_count, 1)


if __name__ == "__main__":
    unittest.main()
