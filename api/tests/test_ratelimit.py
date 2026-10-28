"""Rate limiting: layered token buckets per client and class, 429 with Retry-After, health exempt."""
import asyncio
import os
import unittest
from unittest import mock

from area_api import ratelimit
from area_api.ratelimit import (
    DEFAULT_LIMITS, EXPENSIVE, MAX_SESSION_ID, RENDER_ID_TTL, TOOL_POLICY, Rate, RateLimiter, RecentIds, TokenBuckets,
    assistant_range, assistant_ranges_from_env, classify, classify_mcp, client_key, limits_from_env, parse_ranges,
    parse_rate, parse_rates, render_id)

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api import ratelimit, tools
    from area_api.evidence import EvidenceReader
    from tests.test_production_evidence import seed_production_fixture
except ImportError:  # pragma: no cover
    TestClient = None

MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def without_rate_limits(case):
    """For HTTP tests that are not about limits: the app's limiter is process-wide,
    so give the test fresh buckets with room for any burst, restored afterwards."""
    limiter = app_module.rate_limiter
    saved = limiter.limits, limiter.buckets
    limiter.limits = {name: (Rate(10_000, 60.0),) for name in limiter.limits}
    limiter.buckets = ratelimit.TokenBuckets()
    case.addCleanup(lambda: (setattr(limiter, "limits", saved[0]), setattr(limiter, "buckets", saved[1])))


def scope(address, forwarded=None):
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return {"client": (address, 1234), "headers": headers}


def _charge_in_process(path, count, queue):  # a uvicorn worker of its own (SharedBucketTests)
    store = ratelimit.SharedBuckets(path)
    queue.put(sum(store.charge([("default:1.2.3.4", Rate(120, 86400.0))]).allowed for _ in range(count)))


class SharedBucketTests(unittest.TestCase):
    """WEB_CONCURRENCY workers share one allowance per client through a SQLite file."""

    def setUp(self):
        import tempfile
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = os.path.join(folder.name, "limits.sqlite3")
        self.clock = FakeClock()

    def worker(self):
        return ratelimit.SharedBuckets(self.path, clock=self.clock).open()

    def test_a_burst_spread_over_three_workers_is_refused_at_the_configured_minute(self):
        # Regression: with per-worker minute windows, 240 requests spread over 3 workers all passed.
        workers = [self.worker() for _ in range(3)]
        minute = [("default:203.0.113.9", Rate(120, 60.0))]
        allowed = [workers[index % 3].charge(minute).allowed for index in range(240)]
        self.assertEqual(sum(allowed), 120)
        refused = workers[0].charge(minute)
        self.assertFalse(refused.allowed)
        self.assertAlmostEqual(refused.wait, 0.5)  # one token back at 2 a second: Retry-After 1
        self.clock.now += 0.5
        self.assertTrue(workers[1].charge(minute).allowed, "the refill is shared too")

    def test_my_match_gets_the_whole_minute_across_workers(self):
        # One person re-scoring My match (cost 10) gets 12 runs a minute whichever worker answers, not 4.
        workers = [self.worker() for _ in range(3)]
        windows = [("default:198.51.100.7", rate) for rate in limits_from_env({}, shared=True)["default"]]
        runs = [workers[index % 3].charge(windows, cost=10) for index in range(13)]
        self.assertEqual([run.allowed for run in runs], [True] * 12 + [False])
        self.assertEqual(runs[0].limit, 120)
        self.assertEqual(runs[0].remaining, 110)

    def test_a_refusal_takes_nothing_from_any_window(self):
        store = self.worker()
        windows = [("k", Rate(5, 60.0)), ("k", Rate(100, 86400.0))]
        self.assertTrue(store.charge(windows, cost=5).allowed)
        self.assertFalse(store.charge(windows).allowed)
        self.clock.now += 60
        self.assertEqual(store.charge(windows, cost=5).remaining, 0)
        # The day lost only the 10 it granted (and refilled 0.07): 89 left after one more.
        self.assertEqual(self.worker().charge([("k", Rate(100, 86400.0))]).remaining, 89)

    def test_render_ids_are_shared_and_expire(self):
        first, second = self.worker(), self.worker()
        first.add("1.2.3.4|render-1", self.clock.now)
        self.assertTrue(second.fresh("1.2.3.4|render-1", self.clock.now + 1))
        self.assertFalse(second.fresh("1.2.3.4|render-1", self.clock.now + RENDER_ID_TTL))
        self.assertFalse(second.fresh("1.2.3.4|other", self.clock.now))

    def test_idle_full_buckets_are_swept(self):
        store = self.worker()
        store.charge([("old", Rate(10, 60.0))])
        self.clock.now += 61
        with mock.patch.object(ratelimit, "SWEEP_EVERY", 1):
            store.charge([("new", Rate(10, 60.0))])
        keys = [row[0] for row in store._db().execute("SELECT key FROM bucket")]
        self.assertEqual(keys, ["new|10/60"])

    def test_processes_share_one_allowance(self):
        import multiprocessing
        context = multiprocessing.get_context("spawn")  # as uvicorn starts its workers
        queue = context.Queue()
        processes = [context.Process(target=_charge_in_process, args=(self.path, 100, queue)) for _ in range(3)]
        for process in processes:
            process.start()
        allowed = sum(queue.get(timeout=60) for _ in processes)
        for process in processes:
            process.join(timeout=60)
        self.assertEqual(allowed, 120)

    def test_a_broken_store_falls_back_to_the_workers_own_buckets(self):
        store = self.worker()
        store._db().close()  # every statement now raises sqlite3.ProgrammingError
        with self.assertLogs("area_api.ratelimit", "WARNING"):
            self.assertTrue(store.charge([("k", Rate(1, 60.0))]).allowed)
        with self.assertLogs("area_api.ratelimit", "WARNING"):
            self.assertFalse(store.charge([("k", Rate(1, 60.0))]).allowed)

    def test_the_store_is_used_only_with_several_workers(self):
        self.assertIsNone(ratelimit.store_path({}))
        self.assertIsNone(ratelimit.store_path({"WEB_CONCURRENCY": "3", "CLOSE_KNIT_RATE_STORE": "memory"}))
        self.assertEqual(ratelimit.store_path({"WEB_CONCURRENCY": "3", "CLOSE_KNIT_RATE_STORE": self.path}), self.path)
        self.assertTrue(ratelimit.store_path({"WEB_CONCURRENCY": "3"}).endswith(ratelimit.STORE_FILE))
        env = {"WEB_CONCURRENCY": "3", "CLOSE_KNIT_RATE_STORE": self.path}
        with mock.patch.dict(os.environ, env):
            limiter = RateLimiter.from_env()
        self.assertIsInstance(limiter.buckets, ratelimit.SharedBuckets)
        self.assertIs(limiter.renders, limiter.buckets)
        self.assertEqual(limiter.limits, limits_from_env({}))
        unusable = {"WEB_CONCURRENCY": "3", "CLOSE_KNIT_RATE_STORE": os.path.dirname(self.path)}  # a folder
        with mock.patch.dict(os.environ, unusable), self.assertLogs("area_api.ratelimit", "WARNING"):
            limiter = RateLimiter.from_env()
        self.assertIsInstance(limiter.buckets, TokenBuckets)
        self.assertEqual(limiter.limits, limits_from_env({"WEB_CONCURRENCY": "3"}), "per-worker buckets split")


class BucketTests(unittest.TestCase):
    def test_rates_parse_and_reject_nonsense(self):
        self.assertEqual(parse_rate("120/minute", "1/second"), Rate(120, 60.0))
        self.assertEqual(parse_rate(None, "5/second"), Rate(5, 1.0))
        self.assertEqual(parse_rates("1000/day, 200/minute"), (Rate(200, 60.0), Rate(1000, 86400.0)))
        for text in ("lots", "120/minute,lots", ""):
            with self.assertRaises(ValueError):
                parse_rates(text)

    def test_env_classes_and_legacy_minute_rates(self):
        limits = limits_from_env({})
        self.assertEqual(set(limits), set(DEFAULT_LIMITS))
        self.assertEqual(limits["hizoom"], (Rate(200, 60), Rate(600, 3600), Rate(1000, 86400)))
        legacy = limits_from_env({"CLOSE_KNIT_RATE_LIMIT": "90/minute", "CLOSE_KNIT_TILE_RATE_LIMIT": "300/minute"})
        self.assertEqual(legacy["default"], (Rate(90, 60), Rate(2000, 3600), Rate(10000, 86400)))
        self.assertEqual(legacy["bulk"], (Rate(300, 60), Rate(6000, 3600)))
        explicit = limits_from_env({"CLOSE_KNIT_RATE_LIMIT": "90/minute", "CLOSE_KNIT_RATE_DEFAULT": "10/minute"})
        self.assertEqual(explicit["default"], (Rate(10, 60),), "the class variable wins over the legacy one")

    def test_per_worker_buckets_split_long_allowances_except_renders(self):
        # Without the shared store (CLOSE_KNIT_RATE_STORE=memory): hours and days split, rounded up; a minute
        # stays whole, since one person's burst lands on one worker.
        split = limits_from_env({"WEB_CONCURRENCY": "3"})
        self.assertEqual(split["hizoom"], (Rate(200, 60), Rate(200, 3600), Rate(334, 86400)))
        self.assertEqual(split["report"], (Rate(5, 60), Rate(7, 86400)))
        self.assertEqual(split["default"][0], Rate(120, 60))
        self.assertEqual(split["render"], limits_from_env({})["render"], "each worker a render reaches charges it")
        # The shared store holds one set of buckets for every worker: each allowance is the configured one.
        self.assertEqual(limits_from_env({"WEB_CONCURRENCY": "3"}, shared=True), limits_from_env({}))
        self.assertEqual(limits_from_env({"WEB_CONCURRENCY": "1"}), limits_from_env({}))
        self.assertEqual(limits_from_env({"WEB_CONCURRENCY": "lots"}), limits_from_env({}))

    def test_burst_then_refill(self):
        clock = FakeClock()
        buckets = TokenBuckets(clock=clock)
        rate = Rate(3, 60.0)
        self.assertEqual([buckets.take("a", rate)[0] for _ in range(4)], [True, True, True, False])
        allowed, remaining, wait = buckets.take("a", rate)
        self.assertFalse(allowed)
        self.assertAlmostEqual(wait, 20.0, places=1)
        clock.now += 20.0
        self.assertTrue(buckets.take("a", rate)[0])
        self.assertTrue(buckets.take("b", rate)[0], "other clients have their own bucket")

    def test_day_window_holds_after_the_minute_refills(self):
        clock = FakeClock()
        buckets = TokenBuckets(clock=clock)
        windows = [("k", Rate(2, 60)), ("k", Rate(3, 86400))]
        self.assertEqual([buckets.charge(windows).allowed for _ in range(3)], [True, True, False])
        clock.now += 60
        self.assertTrue(buckets.charge(windows).allowed)
        clock.now += 60
        refused = buckets.charge(windows)
        self.assertFalse(refused.allowed)
        self.assertEqual(refused.limit, 3, "the day window is the one to wait for")
        self.assertGreater(refused.wait, 3600)

    def test_charge_is_atomic(self):
        buckets = TokenBuckets(clock=FakeClock())
        wide, narrow = ("k", Rate(10, 60)), ("k", Rate(4, 3600))
        self.assertTrue(buckets.charge([wide, narrow], cost=3).allowed)
        self.assertFalse(buckets.charge([wide, narrow], cost=3).allowed, "narrow has 1 left")
        decision = buckets.charge([wide], cost=7)
        self.assertTrue(decision.allowed, "the refused charge took nothing from wide")
        self.assertEqual(decision.remaining, 0)

    def test_least_recently_used_bucket_is_evicted(self):
        buckets = TokenBuckets(clock=FakeClock(), capacity=2)
        rate = Rate(1, 60)
        buckets.take("a", rate)
        buckets.take("b", rate)
        buckets.take("a", rate)  # refused, but a is now the most recent
        buckets.take("c", rate)
        self.assertEqual([key for key, _ in buckets.buckets], ["a", "c"])
        self.assertFalse(buckets.take("a", rate)[0], "a kept its empty bucket")

    def test_classify_table(self):
        cases = {
            "/api/v1/search": ("default", 1),
            "/mcp": ("default", 1),
            "/api/v1/areas/uk:lsoa:E01000001/profile": ("default", 1),
            "/api/v1/tiles/properties/14/1/1.pbf": ("bulk", 1),
            "/api/v1/tiles/properties/15/1/1.pbf": ("hizoom", 1),
            "/api/v1/tiles/sales/16/1/1.pbf": ("hizoom", 1),
            "/api/v1/tiles/places/16/1/1.pbf": ("bulk", 1),
            "/api/v1/value-packs/price-per-square-metre/2026-06": ("bulk", 1),
            "/api/v1/price-scale": ("bulk", 1),
            "/api/v1/areas/boxes": ("bulk", 1),
            "/api/v1/properties/100023336956": ("detail", 1),
            "/api/v1/properties/100023336956/profile": ("detail", 5),
            "/api/v1/addresses/a1/history": ("detail", 1),
            "/api/v1/addresses/a1/nearby-sales": ("detail", 1),
            "/api/v1/postcodes/E1%201AA/homes": ("detail", 5),
            "/api/v1/areas/uk:lsoa:E01000001/recent-sales": ("detail", 1),
            "/api/v1/custom-criteria/evaluate": EXPENSIVE,
            "/api/v1/matches": ("default", 10),
            "/api/v1/corrections": ("report", 1),
            "/api/v2/downloads/places.csv": ("download", 1),
            "/api/v2/tools/find_areas": ("default", 10),
            "/api/v2/tools/get_address_history": ("detail", 1),
            "/api/v2/tools/search_areas": ("default", 1),
        }
        for path, policy in cases.items():
            self.assertEqual(classify(path), policy, path)
        self.assertIsNone(classify("/health"))
        self.assertIsNone(classify("/llms.txt"))

    def test_tool_policy_names_real_tools(self):
        from area_api.tools import TOOLS
        self.assertLessEqual(set(TOOL_POLICY), set(TOOLS))

    def test_mcp_messages_are_classed_by_tool(self):
        call = b'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_address_history"}}'
        expensive = b'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"find_areas"}}'
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_MCP_DATA": "1"}):
            self.assertEqual(classify_mcp(call), ("detail", 1))
            self.assertEqual(classify_mcp(expensive), EXPENSIVE)
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_MCP_DATA": "0"}):
            # Closed tools only answer "coming soon": one default token, never detail or expensive.
            self.assertEqual(classify_mcp(call), ("default", 1))
            self.assertEqual(classify_mcp(expensive), ("default", 1))
        for method in ("notifications/initialized", "tools/list", "ping"):
            message = f'{{"jsonrpc":"2.0","id":1,"method":"{method}"}}'.encode()
            self.assertEqual(classify_mcp(message), ("discovery", 1), method)
        # Each initialize holds a server session for 30 minutes: it stays on the default budget.
        self.assertEqual(classify_mcp(b'{"jsonrpc":"2.0","id":1,"method":"initialize"}'), ("default", 1))
        self.assertEqual(classify_mcp(b"not json"), ("default", 1))
        self.assertIsNone(classify_mcp(b'[{"jsonrpc":"2.0","id":1,"method":"tools/list"}]'))

    def test_client_key_honours_forwarded_for_only_when_trusted(self):
        forwarded = scope("10.0.0.1", "203.0.113.5, 10.0.0.1")
        self.assertEqual(client_key(forwarded, trust_proxy=False), "10.0.0.1")
        self.assertEqual(client_key(forwarded, trust_proxy=True), "203.0.113.5")

    def test_client_key_shares_an_ipv6_64_and_unmaps_ipv4(self):
        one = client_key(scope("2001:db8:1:2::1"), False)
        self.assertEqual(one, "2001:db8:1:2::/64")
        self.assertEqual(client_key(scope("2001:db8:1:2:ffff::9"), False), one)
        self.assertNotEqual(client_key(scope("2001:db8:1:3::1"), False), one)
        self.assertEqual(client_key(scope("::ffff:203.0.113.5"), False), "203.0.113.5")
        self.assertEqual(client_key(scope("10.0.0.1", "x" * 200), True), "x" * 64)

    def test_ipv6_48_shares_the_detail_day_quota(self):
        limiter = RateLimiter(limits={"detail": (Rate(100, 60), Rate(2, 86400))}, trust_proxy=False,
                              buckets=TokenBuckets(clock=FakeClock()))
        # Each /64 gets 2 a day, the /48 around them 2 * WIDE_DAY_FACTOR = 8.
        for subnet in range(1, 5):
            for _ in range(2):
                self.assertTrue(limiter.charge(scope(f"2001:db8:1:{subnet}::1"), ("detail", 1)).allowed)
        self.assertFalse(limiter.charge(scope("2001:db8:1:1::1"), ("detail", 1)).allowed, "its /64 is spent")
        self.assertFalse(limiter.charge(scope("2001:db8:1:5::1"), ("detail", 1)).allowed, "the /48 is spent")
        self.assertTrue(limiter.charge(scope("2001:db8:2:1::1"), ("detail", 1)).allowed, "another /48")


KEY = "k" * 64


def render_scope(key=KEY, render="render-0001", address="203.0.113.5"):
    headers = [(b"x-forwarded-for", address.encode())]
    if key is not None:
        headers.append((b"x-close-knit-internal", key.encode()))
    if render is not None:
        headers.append((b"x-close-knit-render", render.encode()))
    return {"client": ("10.0.0.2", 1234), "headers": headers}


class RenderClassTests(unittest.TestCase):
    """A server render of a page is one page view: CLOSE_KNIT_INTERNAL_KEY + a render id."""

    def limiter(self, clock):
        return RateLimiter(limits={**limits_from_env({}), "render": (Rate(2, 60),)}, trust_proxy=True,
                           buckets=TokenBuckets(clock=clock), internal_key=KEY.encode())

    def test_render_id_needs_the_key(self):
        self.assertEqual(render_id(render_scope(), KEY.encode()), "render-0001")
        self.assertIsNone(render_id(render_scope(key="k" * 63 + "j"), KEY.encode()), "a wrong key")
        self.assertIsNone(render_id(render_scope(key="short"), KEY.encode()), "a wrong key of another length")
        self.assertIsNone(render_id(render_scope(key=None), KEY.encode()), "no key header")
        self.assertIsNone(render_id(render_scope(), None), "no key configured: the header means nothing")
        self.assertIsNone(render_id(render_scope(), b""), "an empty key is no key")
        self.assertIsNone(render_id(render_scope(render=None), KEY.encode()), "no render id")
        self.assertIsNone(render_id(render_scope(render="a b"), KEY.encode()), "a malformed render id")
        self.assertEqual(limits_from_env({})["render"], (Rate(30, 60), Rate(600, 3600), Rate(3000, 86400)))
        self.assertEqual(limits_from_env({"CLOSE_KNIT_RATE_RENDER": "5/minute"})["render"], (Rate(5, 60),))

    def test_one_charge_per_render_id(self):
        clock = FakeClock()
        limiter = self.limiter(clock)
        decisions = [limiter.charge_render(render_scope(render="render-0001"), "render-0001") for _ in range(22)]
        self.assertTrue(all(decision.allowed for decision in decisions))
        self.assertEqual({decision.remaining for decision in decisions}, {1}, "22 reads, one page")
        self.assertTrue(limiter.charge_render(render_scope(render="render-0002"), "render-0002").allowed)
        self.assertFalse(limiter.charge_render(render_scope(render="render-0003"), "render-0003").allowed,
                         "the third page in a minute is over 2/minute")
        self.assertTrue(limiter.charge_render(render_scope(render="render-0002"), "render-0002").allowed,
                        "a render already paid for keeps reading")
        other = render_scope(render="render-0003", address="198.51.100.7")
        self.assertTrue(limiter.charge_render(other, "render-0003").allowed, "each viewer has their own pages")

    def test_a_render_id_costs_again_after_its_ttl(self):
        clock = FakeClock()
        limiter = self.limiter(clock)
        limiter.limits = {**limiter.limits, "render": (Rate(2, 86400),)}
        self.assertTrue(limiter.charge_render(render_scope(), "render-0001").allowed)
        clock.now += RENDER_ID_TTL - 1
        self.assertEqual(limiter.charge_render(render_scope(), "render-0001").remaining, 1, "still free")
        clock.now += 2
        self.assertEqual(limiter.charge_render(render_scope(), "render-0001").remaining, 0, "charged again")

    def test_seen_ids_are_bounded(self):
        ids = RecentIds(ttl=60, capacity=2)
        for index, key in enumerate(("a", "b", "c")):
            ids.add(key, 1000.0 + index)
        self.assertEqual(list(ids.seen), ["b", "c"])
        ids.add("d", 1062.5)
        self.assertEqual(list(ids.seen), ["d"], "expired ids are dropped as new ones come")
        self.assertFalse(ids.fresh("c", 1062.5))


CLAUDE_EGRESS = "160.79.104.17"


def mcp_scope(address, session=None, method="POST"):
    headers = [(b"x-forwarded-for", address.encode())]
    if session is not None:
        headers.append((b"mcp-session-id", session.encode()))
    return {"type": "http", "method": method, "path": "/mcp", "client": ("10.0.0.2", 1234), "headers": headers}


class AssistantSessionTests(unittest.TestCase):
    """ChatGPT and Claude reach /mcp for every user from shared egress addresses: their sessions get own budgets."""

    def limiter(self):
        limits = {**limits_from_env({}), "default": (Rate(2, 60),), "assistant_init": (Rate(5, 60),)}
        return RateLimiter(limits=limits, trust_proxy=True, buckets=TokenBuckets(clock=FakeClock()),
                           assistant_ranges=parse_ranges("160.79.104.0/21"))

    def test_ranges_default_to_the_published_ones_and_parse(self):
        self.assertEqual(assistant_range(CLAUDE_EGRESS, assistant_ranges_from_env({})), "160.79.104.0/21")
        self.assertIsNotNone(assistant_range("9.129.1.1", assistant_ranges_from_env({})), "ChatGPT connectors")
        self.assertIsNone(assistant_range("203.0.113.5", assistant_ranges_from_env({})))
        self.assertEqual(assistant_ranges_from_env({"CLOSE_KNIT_ASSISTANT_RANGES": "none"}), ())
        ranges = assistant_ranges_from_env({"CLOSE_KNIT_ASSISTANT_RANGES": "203.0.113.0/24, 2001:db8::/32"})
        self.assertEqual(assistant_range("203.0.113.5", ranges), "203.0.113.0/24")
        self.assertEqual(assistant_range("2001:db8:1:2::/64", ranges), "2001:db8::/32", "an IPv6 /64 key")
        self.assertIsNone(assistant_range("unknown", ranges))

    def test_two_sessions_from_an_assistant_range_do_not_share_a_bucket(self):
        limiter = self.limiter()
        for session in ("a" * 32, "b" * 32):
            for _ in range(2):
                self.assertTrue(limiter.charge(mcp_scope(CLAUDE_EGRESS, session), ("default", 1)).allowed, session)

    def test_the_same_session_shares_its_bucket_across_egress_addresses(self):
        limiter = self.limiter()
        self.assertTrue(limiter.charge(mcp_scope("160.79.104.1", "a" * 32), ("default", 1)).allowed)
        self.assertTrue(limiter.charge(mcp_scope("160.79.111.254", "a" * 32), ("default", 1)).allowed)
        self.assertFalse(limiter.charge(mcp_scope(CLAUDE_EGRESS, "a" * 32), ("default", 1)).allowed)
        self.assertFalse(limiter.charge(mcp_scope(CLAUDE_EGRESS, "a" * 32, method="GET"), ("default", 1)).allowed)

    def test_session_ids_outside_the_ranges_share_the_address_bucket(self):
        limiter = self.limiter()
        self.assertTrue(limiter.charge(mcp_scope("203.0.113.5", "a" * 32), ("default", 1)).allowed)
        self.assertTrue(limiter.charge(mcp_scope("203.0.113.5", "b" * 32), ("default", 1)).allowed)
        self.assertFalse(limiter.charge(mcp_scope("203.0.113.5", "c" * 32), ("default", 1)).allowed)

    def test_a_session_id_off_mcp_or_without_one_keeps_the_address(self):
        limiter = self.limiter()
        api = {**mcp_scope(CLAUDE_EGRESS, "a" * 32), "path": "/api/v1/areas"}
        self.assertTrue(limiter.charge(api, ("default", 1)).allowed)
        self.assertTrue(limiter.charge(mcp_scope(CLAUDE_EGRESS), ("default", 1)).allowed)
        self.assertFalse(limiter.charge(mcp_scope(CLAUDE_EGRESS), ("default", 1)).allowed)
        self.assertTrue(limiter.charge(mcp_scope(CLAUDE_EGRESS, "a" * 32), ("default", 1)).allowed)

    def test_a_long_session_id_is_cut(self):
        limiter = self.limiter()
        key = limiter.bucket_key(mcp_scope(CLAUDE_EGRESS, "x" * 500), "default", CLAUDE_EGRESS)
        self.assertEqual(key, "160.79.104.0/21|session:" + "x" * MAX_SESSION_ID)

    def test_initialize_from_an_assistant_range_uses_the_higher_limit_by_address(self):
        initialize = b'{"jsonrpc":"2.0","id":1,"method":"initialize"}'
        self.assertEqual(classify_mcp(initialize, assistant=True), ("assistant_init", 1))
        self.assertEqual(classify_mcp(initialize), ("default", 1))
        self.assertEqual(limits_from_env({})["assistant_init"], (Rate(300, 60), Rate(3000, 3600), Rate(30000, 86400)))
        limiter = self.limiter()

        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

        async def post(address, session=None):
            statuses = []

            async def receive():
                return {"type": "http.request", "body": initialize, "more_body": False}

            async def send(message):
                if message["type"] == "http.response.start":
                    statuses.append(message["status"])
            await ratelimit.RateLimitMiddleware(app, limiter=limiter)(mcp_scope(address, session), receive, send)
            return statuses[0]

        async def run():
            # A forged session id on initialize does not escape the address budget.
            assistant = [await post(CLAUDE_EGRESS, session=f"s{index}") for index in range(6)]
            other = [await post("203.0.113.5") for _ in range(3)]
            return assistant, other
        assistant, other = asyncio.run(run())
        self.assertEqual(assistant, [200] * 5 + [429], "assistant_init: 5/minute in this test")
        self.assertEqual(other, [200, 200, 429], "elsewhere initialize stays on default: 2/minute in this test")


class QueryGuardTests(unittest.TestCase):
    def test_statement_timeout_is_a_503_and_internal_errors_say_nothing(self):
        from unittest import mock

        from psycopg.errors import QueryCanceled

        from area_api import errors, repository
        self.assertEqual(errors.status_and_code(QueryCanceled("canceling statement")), (503, "query-timeout"))
        self.assertEqual(errors.classify(RuntimeError("SELECT * FROM secret")), ("internal-error", "internal error"))
        with mock.patch.dict("os.environ", {"CLOSE_KNIT_DB_STATEMENT_TIMEOUT_MS": ""}):
            self.assertEqual(repository._statement_timeout_ms(), 20000)
        with mock.patch.dict("os.environ", {"CLOSE_KNIT_DB_STATEMENT_TIMEOUT_MS": "500"}):
            self.assertEqual(repository._statement_timeout_ms(), 500)


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class RateLimitHttpTests(unittest.TestCase):
    def setUp(self):
        tools.clear_catalogue_cache()
        connection = seed_production_fixture()
        self._previous = (app_module._reader, app_module._health_loader)
        app_module._reader = EvidenceReader(connect=lambda: connection)
        app_module._health_loader = lambda: {"status": "ready", "code": "ready", "productReleaseId": "rel", "checks": [], "unavailableReasons": []}
        self.limiter = app_module.rate_limiter
        self._saved = self.limiter.limits
        self.limiter.limits = {**self._saved, "default": (Rate(3, 60.0),)}
        self.limiter.buckets = ratelimit.TokenBuckets(clock=FakeClock())
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader, app_module._health_loader = self._previous
        self.limiter.limits = self._saved
        self.limiter.buckets = ratelimit.TokenBuckets()

    def test_fourth_request_is_429_with_headers_and_health_stays_open(self):
        statuses = [self.client.get("/api/v1/metrics").status_code for _ in range(4)]
        self.assertEqual(statuses, [200, 200, 200, 429])
        blocked = self.client.get("/api/v1/metrics")
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.json()["detail"]["error"], "too-many-requests")
        self.assertIn("retry-after", blocked.headers)
        self.assertEqual(blocked.headers["x-ratelimit-limit"], "3")
        self.assertEqual([self.client.get("/health").status_code for _ in range(20)], [200] * 20)
        self.assertNotIn("x-ratelimit-limit", self.client.get("/health").headers)

    def test_agent_tool_by_name_costs_ten(self):
        self.limiter.limits = {**self.limiter.limits, "default": (Rate(15, 60.0),)}
        first = self.client.post("/api/v2/tools/find_areas", json={})
        self.assertNotEqual(first.status_code, 429)
        self.assertEqual(first.headers["x-ratelimit-remaining"], "5")
        self.assertEqual(self.client.post("/api/v2/tools/find_areas", json={}).status_code, 429)

    def test_mcp_batch_is_400_and_oversized_body_413(self):
        batch = [{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}] * 2
        response = self.client.post("/mcp", json=batch, headers=MCP_HEADERS)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], -32600)
        huge = self.client.post("/mcp", content=b" " * (64 * 1024 + 1), headers=MCP_HEADERS)
        self.assertEqual(huge.status_code, 413)

    def _mcp_session(self):
        init = self.client.post("/mcp", headers=MCP_HEADERS, json={
            "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2025-06-18", "capabilities": {},
                "clientInfo": {"name": "test", "version": "0"}}})
        self.assertEqual(init.status_code, 200, init.text)
        headers = {**MCP_HEADERS, "mcp-session-id": init.headers["mcp-session-id"]}
        self.client.post("/mcp", headers=headers, json={"jsonrpc": "2.0", "method": "notifications/initialized"})
        return headers

    def test_mcp_discovery_calls_have_their_own_budget(self):
        # default is 3 a minute here (setUp): a directory's 100 listings and pings must not touch it.
        with self.client:
            headers = self._mcp_session()
            statuses = [self.client.post("/mcp", headers=headers, json={
                "jsonrpc": "2.0", "id": 2, "method": method}).status_code for method in ("tools/list", "ping") * 50]
            self.assertEqual(statuses, [200] * 100)
            self.assertNotEqual(self.client.get("/api/v1/metrics").status_code, 429)

    def test_closed_mcp_tool_calls_cost_one_default_token(self):
        # 25 = the session's initialize + 24 closed calls.
        self.limiter.limits = {**self.limiter.limits, "default": (Rate(25, 60.0),), "detail": (Rate(2, 60.0),)}
        with self.client, mock.patch.dict(os.environ, {"CLOSE_KNIT_MCP_DATA": "0"}):
            headers = self._mcp_session()
            calls = [("find_areas", {"max_budget": 500000}),
                     ("get_address_history", {"address_id": "uk:addr:0123456789ab"}),
                     ("rank_areas_by_metric", {"metric_id": "crime", "period": "2026-06"})] * 8
            responses = [self.client.post("/mcp", headers=headers, json={
                "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": name, "arguments": arguments}})
                for name, arguments in calls]
            self.assertEqual([r.status_code for r in responses], [200] * 24)
            self.assertEqual(responses[-1].headers["x-ratelimit-remaining"], "0")
            self.assertEqual(responses[0].json()["result"]["structuredContent"]["status"], "coming-soon")
            self.assertEqual(self.client.post("/mcp", headers=headers, json={
                "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": {"name": "find_areas", "arguments": {}}}).status_code, 429)

    def test_mcp_tool_call_drains_the_detail_class(self):
        self.limiter.limits = {**self.limiter.limits, "default": (Rate(100, 60.0),),
                               "detail": (Rate(2, 60.0),)}
        with self.client, mock.patch.dict(os.environ, {"CLOSE_KNIT_MCP_DATA": "1"}):
            init = self.client.post("/mcp", headers=MCP_HEADERS, json={
                "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                    "protocolVersion": "2025-06-18", "capabilities": {},
                    "clientInfo": {"name": "test", "version": "0"}}})
            self.assertEqual(init.status_code, 200, init.text)
            headers = {**MCP_HEADERS, "mcp-session-id": init.headers["mcp-session-id"]}
            self.client.post("/mcp", headers=headers, json={"jsonrpc": "2.0", "method": "notifications/initialized"})
            call = {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": {"name": "get_address_history", "arguments": {"address_id": "nowhere"}}}
            statuses = [self.client.post("/mcp", headers=headers, json=call).status_code for _ in range(3)]
            self.assertEqual(statuses, [200, 200, 429])
            listing = {"jsonrpc": "2.0", "id": 3, "method": "tools/list"}
            self.assertEqual(self.client.post("/mcp", headers=headers, json=listing).status_code, 200,
                             "other MCP calls use the discovery budget")


AREA = "/api/v1/areas/uk:lsoa:E01000001"
# 22 reads, as the area page's server render makes them (sections, metrics, health, follow-ups).
PAGE = [f"{AREA}?metric=price-per-square-metre&period=2026-06", f"{AREA}?metric=crime&period=2026-06",
        f"{AREA}?metric=food-hygiene&period=2026-06", f"{AREA}/profile?period=9999-12",
        *(f"{AREA}/{part}" for part in ("market-by-type", "people", "flood", "places", "market", "civic", "safety",
                                        "rents", "noise", "nature", "kids", "schools", "health", "home",
                                        "location", "standouts")),
        "/api/v1/metrics", "/api/v1/health"]


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class RenderHttpTests(unittest.TestCase):
    """The web server's reads for one area page (web/src/lib/area-page-seed.ts) through the middleware."""

    def setUp(self):
        tools.clear_catalogue_cache()
        connection = seed_production_fixture()
        self._previous = (app_module._reader, app_module._health_loader)
        app_module._reader = EvidenceReader(connect=lambda: connection)
        app_module._health_loader = lambda: {"status": "ready", "code": "ready", "productReleaseId": "rel", "checks": [], "unavailableReasons": []}
        self.limiter = app_module.rate_limiter
        self._saved = (self.limiter.limits, self.limiter.trust_proxy, self.limiter.internal_key, self.limiter.renders)
        self.limiter.limits = limits_from_env({})
        self.limiter.trust_proxy = True
        self.limiter.internal_key = KEY.encode()
        self.limiter.renders = RecentIds()
        self.limiter.buckets = ratelimit.TokenBuckets(clock=FakeClock())
        # Only the limiter is under test: the fixture does not answer every section (a 500 is fine here).
        self.client = TestClient(app_module.app, raise_server_exceptions=False)

    def tearDown(self):
        app_module._reader, app_module._health_loader = self._previous
        self.limiter.limits, self.limiter.trust_proxy, self.limiter.internal_key, self.limiter.renders = self._saved
        self.limiter.buckets = ratelimit.TokenBuckets()

    def render(self, render, key=KEY, viewer="203.0.113.5"):
        headers = {"x-forwarded-for": viewer, "x-close-knit-render": render}
        if key is not None:
            headers["x-close-knit-internal"] = key
        self.assertEqual(len(PAGE), 22)
        return [self.client.get(path, headers=headers) for path in PAGE]

    def test_six_quick_renders_are_six_page_views(self):
        for index in range(6):
            responses = self.render(f"render-{index:04d}")
            self.assertNotIn(429, [response.status_code for response in responses], f"render {index + 1}")
        self.assertEqual(responses[-1].headers["x-ratelimit-limit"], "30")
        self.assertEqual(responses[-1].headers["x-ratelimit-remaining"], "24", "6 of 30 pages a minute")
        plain = self.client.get("/api/v1/metrics", headers={"x-forwarded-for": "203.0.113.5"})
        self.assertEqual(plain.headers["x-ratelimit-remaining"], "119", "the viewer's own budget is untouched")

    def test_without_a_valid_key_each_read_is_charged_as_before(self):
        for key in ("wrong" * 13, None):
            self.limiter.buckets = ratelimit.TokenBuckets(clock=FakeClock())
            statuses = [response.status_code for index in range(6) for response in self.render(f"render-{index:04d}", key)]
            self.assertEqual(statuses.index(429), 120, f"key={key!r}: the default 120/minute, read by read")

    def test_the_header_means_nothing_when_the_key_is_unset(self):
        self.limiter.internal_key = None
        statuses = [response.status_code for index in range(6) for response in self.render(f"render-{index:04d}")]
        self.assertIn(429, statuses)

    def test_detail_reads_keep_their_class_inside_a_render(self):
        self.limiter.limits = {**self.limiter.limits, "detail": (Rate(1, 60.0),)}
        headers = {"x-forwarded-for": "203.0.113.5", "x-close-knit-render": "render-0001", "x-close-knit-internal": KEY}
        statuses = [self.client.get(path, headers=headers).status_code
                    for path in (f"{AREA}/recent-sales", "/api/v1/properties/100023336956")]
        self.assertNotEqual(statuses[0], 429)
        self.assertEqual(statuses[1], 429, "another home in the same render pays its own detail cost")

    def test_a_render_reading_one_detail_path_twice_pays_once(self):
        # v4 Task 27: /property's metadata and page both read the home's profile (cost 5 each); charging
        # both left the next view a 429, which the page turned into an HTTP 500 (React #441).
        self.limiter.limits = {**self.limiter.limits, "detail": (Rate(5, 60.0),)}
        headers = {"x-forwarded-for": "203.0.113.5", "x-close-knit-render": "render-0001", "x-close-knit-internal": KEY}
        path = "/api/v1/properties/100023336956/profile"
        statuses = [self.client.get(path, headers=headers).status_code for _ in range(3)]
        self.assertNotIn(429, statuses)
        other = {**headers, "x-close-knit-render": "render-0002"}
        self.assertEqual(self.client.get(path, headers=other).status_code, 429, "a new render pays again")


if __name__ == "__main__":
    unittest.main()
