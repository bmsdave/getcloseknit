"""Per-client rate limiting for the public API and MCP endpoint.

Pure ASGI middleware, no dependencies: layered token buckets per client and class.

Client key: an IPv4 address; an IPv4-mapped IPv6 address as IPv4; any other IPv6
address by its /64 (one host gets a whole /64, so rotating inside it gains nothing).
The day quotas of hizoom and detail are also charged to the IPv6 /48, which gets
WIDE_DAY_FACTOR times the allowance (one site, several devices). A value that
is not an address is cut to 64 characters. CLOSE_KNIT_TRUST_PROXY=1 takes the
client from X-Forwarded-For (first hop; the web BFF and Caddy set it).

Classes (classify(path) -> (class, cost)); each has layered windows, and a request
must find `cost` tokens in every window or it is a 429 and nothing is taken:
  default    everything else under /api, MCP tools/call 120/minute,2000/hour,10000/day
  discovery  /mcp messages inside a session other than tools/call: tools/list, ping, notifications,
             prompts and resources (directories poll them often; none reads data). initialize, GET and
             DELETE stay on default: each initialize holds a server session for 30 minutes
                                                     600/minute,6000/hour,30000/day
  bulk      tiles below z15, place tiles, value packs, price scale, area geometry
                                                     600/minute,6000/hour
  hizoom     property and sale tiles z15+ (one point per home; a /64 needs 4.5+ days
             for London at z15)                     200/minute,600/hour,1000/day
  detail     properties/{uprn} 1, .../profile 5, addresses/*/history 1, .../nearby-sales 1,
             postcodes/*/homes 5, areas/*/recent-sales 1; tools in TOOL_POLICY
                                                     30/minute,300/hour,1000/day
  expensive  not a class: cost 10 in default (custom-criteria/evaluate, matches, listing-card, listing-badges and
             the search/ranking tools in TOOL_POLICY)
  assistant_init
             MCP initialize from an assistant range (below), keyed by address: one egress address
             opens sessions for many users, but a burst of new sessions stays bounded
                                                     300/minute,3000/hour,30000/day
  report     POST /api/v1/corrections               5/minute,20/day
  download   GET /api/v2/downloads/*  (whole-database CSV, tens of MB)
                                                     2/minute,4/hour,10/day
  render     pages the web server renders: its reads for one render carry
             CLOSE_KNIT_INTERNAL_KEY and a render id (X-Close-Knit-Internal,
             X-Close-Knit-Render); the first read of each id costs 1, the rest of
             that render 0 (ids are remembered RENDER_ID_TTL)
                                                     30/minute,600/hour,3000/day
             Detail paths keep their own class inside a render (per-home data), but one
             render reading the same detail path again (the page and its metadata) pays once.
             The key is compared in constant time; with it unset, or a wrong or
             missing one sent, the headers are ignored and the read is classed as above.
  crawler    a search crawler's address (crawler_ranges: Google's and Bing's published ranges):
             its default, discovery, bulk, hizoom, detail and render reads, at their usual
             costs; report and download stay as they are. A person's budget turned a crawl of
             ~1,140 sitemaps and ~300,000 pages into 429s. CLOSE_KNIT_CRAWLER_RANGES replaces
             the ranges ("none" turns this off)          1200/minute,30000/hour,300000/day
Tools are classed by name through TOOL_POLICY, both on /api/v2/tools/{name} and for
MCP tools/call: a POST /mcp body (at most 64 KB, else 413) is read, classed and
replayed; a JSON-RPC batch gets a 400 so one charge always covers one call.
While CLOSE_KNIT_MCP_DATA is off an MCP tools/call only answers "coming soon", so it
costs 1 in default whatever TOOL_POLICY says (the REST mirror keeps TOOL_POLICY).

Assistants: ChatGPT and Claude call /mcp for all their users from a few shared egress addresses, so
an address budget would refuse them all at once. A /mcp request from a client inside an assistant range
that carries Mcp-Session-Id is keyed by (range, session id): each conversation gets the budgets above.
The session id is cut to MAX_SESSION_ID characters; the MCP server refuses ids it did not issue, and it
issues them only on initialize, which stays keyed by address (class assistant_init). The client address
is found as for every other request, so X-Forwarded-For is trusted no further than above. Outside the
ranges a session id changes nothing. CLOSE_KNIT_ASSISTANT_RANGES: comma-separated CIDRs replacing the
published ranges in assistant_ranges.DEFAULT; "none" turns this off.

Configuration (env): CLOSE_KNIT_RATE_<CLASS>="200/minute,600/hour,1000/day"
(periods second, minute, hour, day). Legacy CLOSE_KNIT_RATE_LIMIT and
CLOSE_KNIT_TILE_RATE_LIMIT replace the shortest window of default and bulk.
CLOSE_KNIT_INTERNAL_KEY (shared with the web container) turns the render class on.
With one uvicorn worker, buckets and render ids live in process memory (LRU, MAX_TRACKED_BUCKETS).
With WEB_CONCURRENCY=N > 1 workers (api/Dockerfile) every worker of the container keeps them in one
SQLite file (SharedBuckets: CLOSE_KNIT_RATE_STORE, default /dev/shm), so a client gets the configured
allowance once whichever workers its connections reach: a burst is refused at the configured minute,
and one person's My match runs are not refused early because their connections landed on one worker.
CLOSE_KNIT_RATE_STORE=memory (or a file that cannot be opened) keeps them per worker instead, each
granting 1/N of every hour and day allowance, rounded up, and every shorter window whole.
/health is never limited. Over the limit: 429 with Retry-After (the longest wait)
and X-RateLimit-* headers of the tightest window.
"""
import hashlib
import hmac
import ipaddress
import json
import os
import logging
import re
import sqlite3
import tempfile
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import assistant_ranges, crawler_ranges, feature_flags

log = logging.getLogger(__name__)

RATE_PATTERN = re.compile(r"^(\d+)/(second|minute|hour|day)$")
PERIODS = {"second": 1.0, "minute": 60.0, "hour": 3600.0, "day": 86400.0}
# Per-worker buckets (no shared store) split the allowance of windows this long or longer (module notes).
SPLIT_FROM_SECONDS = 3600.0
STORE_ENV = "CLOSE_KNIT_RATE_STORE"
STORE_FILE = "close-knit-ratelimit.sqlite3"
# A shared store drops buckets that refilled and render ids that expired every this many charges.
SWEEP_EVERY = 2000
EXEMPT_PATHS = ("/health",)
DEFAULT_LIMITS = {
    "default": "120/minute,2000/hour,10000/day",
    "discovery": "600/minute,6000/hour,30000/day",
    "bulk": "600/minute,6000/hour",
    "hizoom": "200/minute,600/hour,1000/day",
    "detail": "30/minute,300/hour,1000/day",
    "assistant_init": "300/minute,3000/hour,30000/day",
    "report": "5/minute,20/day",
    "download": "2/minute,4/hour,10/day",
    "render": "30/minute,600/hour,3000/day",
}
# A search crawler's class (module docstring): apart from DEFAULT_LIMITS, which /about#teams publishes for people.
CRAWLER_LIMITS = {"crawler": "1200/minute,30000/hour,300000/day"}
# The classes a search crawler's reads are charged to "crawler" instead (module docstring).
CRAWLER_CLASSES = ("default", "discovery", "bulk", "hizoom", "detail", "render")
LEGACY_ENV = {"default": "CLOSE_KNIT_RATE_LIMIT", "bulk": "CLOSE_KNIT_TILE_RATE_LIMIT"}
# Day windows of these classes are charged to the IPv6 /48 as well as the /64;
# the /48 gets WIDE_DAY_FACTOR times the allowance.
WIDE_DAY_CLASSES = ("hizoom", "detail")
WIDE_DAY_FACTOR = 4
HIGH_ZOOM = 15
MAX_TRACKED_BUCKETS = 100_000
MAX_MCP_BODY = 64 * 1024
INTERNAL_KEY_HEADER = b"x-close-knit-internal"
RENDER_ID_HEADER = b"x-close-knit-render"
RENDER_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
# A render's reads arrive within seconds (the web server gives each up after 2.5 s);
# after this an id costs again, so a leaked one cannot read for free for long.
RENDER_ID_TTL = 120.0
MAX_RENDER_IDS = 50_000

Policy = tuple[str, int]
DEFAULT: Policy = ("default", 1)
DISCOVERY: Policy = ("discovery", 1)
EXPENSIVE: Policy = ("default", 10)
# Agent tools by name (tools.py), shared by /api/v2/tools/{name} and MCP tools/call.
TOOL_POLICY: dict[str, Policy] = {
    "get_address_history": ("detail", 1),
    "get_home_prices": ("detail", 1),
    "get_nearby_sales_summary": ("detail", 1),
    "find_areas": EXPENSIVE,
    "match_areas": EXPENSIVE,
    "evaluate_custom_criterion": EXPENSIVE,
    "find_similar_areas": EXPENSIVE,
    "rank_areas_by_metric": EXPENSIVE,
}
# Cacheable map data the browser pulls in bursts (a timeline play fetches a
# value pack per step): the bulk budget, not the per-request evidence budget.
BULK_PREFIXES = ("/api/v1/tiles/", "/api/v1/value-packs/", "/api/v1/metric-values/", "/api/v1/price-scale",
                 "/api/v1/areas/boxes")
HIZOOM_TILE = re.compile(r"^/api/v1/tiles/(?:properties|sales)/(\d+)/")
DETAIL_PATHS: list[tuple[re.Pattern[str], int]] = [
    (re.compile(r"^/api/v1/properties/[^/]+$"), 1),
    (re.compile(r"^/api/v1/properties/[^/]+/profile$"), 5),
    (re.compile(r"^/api/v1/addresses/[^/]+/(?:history|nearby-sales)$"), 1),
    (re.compile(r"^/api/v1/postcodes/[^/]+/homes$"), 5),
    (re.compile(r"^/api/v1/areas/[^/]+/recent-sales$"), 1),
]
EXPENSIVE_PATHS = ("/api/v1/custom-criteria/evaluate", "/api/v1/matches", "/api/v1/listing-card",
                   "/api/v1/listing-badges")
TOOL_PATH = re.compile(r"^/api/v2/tools/([^/]+)$")
ASSISTANT_INIT: Policy = ("assistant_init", 1)
SESSION_HEADER = b"mcp-session-id"
# The SDK issues 32 hex characters; a longer id is cut so a bucket key stays small.
MAX_SESSION_ID = 128
Network = ipaddress.IPv4Network | ipaddress.IPv6Network


@dataclass(frozen=True)
class Rate:
    requests: int
    period_seconds: float

    @property
    def per_second(self) -> float:
        return self.requests / self.period_seconds


def parse_rate(text: str | None, default: str) -> Rate:
    match = RATE_PATTERN.match((text or default).strip())
    if not match:
        raise ValueError(f"rate limit must look like 120/minute, got {text!r}")
    return Rate(int(match.group(1)), PERIODS[match.group(2)])


def parse_rates(text: str) -> tuple[Rate, ...]:
    """"200/minute,600/hour" -> windows, shortest first."""
    rates = [parse_rate(part, "") for part in text.split(",") if part.strip()]
    if not rates:
        raise ValueError(f"rate limits must look like 120/minute,2000/hour, got {text!r}")
    return tuple(sorted(rates, key=lambda rate: rate.period_seconds))


def workers(env: Mapping[str, str]) -> int:
    """The uvicorn workers sharing the allowances: WEB_CONCURRENCY, which uvicorn reads too."""
    try:
        return max(1, int(env.get("WEB_CONCURRENCY") or 1))
    except ValueError:
        return 1


def limits_from_env(env: Mapping[str, str], shared: bool = False) -> dict[str, tuple[Rate, ...]]:
    """Each class's windows; per-worker buckets (`shared` False) split the hour and day allowances."""
    limits = {}
    share = 1 if shared else workers(env)
    for name, default in {**DEFAULT_LIMITS, **CRAWLER_LIMITS}.items():
        configured = env.get(f"CLOSE_KNIT_RATE_{name.upper()}")
        rates = parse_rates(configured or default)
        legacy = env.get(LEGACY_ENV.get(name, ""))
        if legacy and not configured:  # the old single rate becomes the shortest window
            rates = tuple(sorted((parse_rate(legacy, ""), *rates[1:]), key=lambda rate: rate.period_seconds))
        if share > 1 and name != "render":
            rates = tuple(Rate(-(-rate.requests // share), rate.period_seconds)
                          if rate.period_seconds >= SPLIT_FROM_SECONDS else rate for rate in rates)
        limits[name] = rates
    return limits


def parse_ranges(text: str) -> tuple[Network, ...]:
    """"160.79.104.0/21,2001:db8::/32" -> networks; "none" -> no ranges."""
    if text.strip().lower() == "none":
        return ()
    return tuple(ipaddress.ip_network(part.strip()) for part in text.split(",") if part.strip())


def assistant_ranges_from_env(env: Mapping[str, str]) -> tuple[Network, ...]:
    configured = env.get("CLOSE_KNIT_ASSISTANT_RANGES", "").strip()
    return parse_ranges(configured) if configured else parse_ranges(",".join(assistant_ranges.DEFAULT))


def crawler_ranges_from_env(env: Mapping[str, str]) -> tuple[Network, ...]:
    configured = env.get("CLOSE_KNIT_CRAWLER_RANGES", "").strip()
    return parse_ranges(configured) if configured else parse_ranges(",".join(crawler_ranges.DEFAULT))


def assistant_range(key: str, ranges: tuple[Network, ...]) -> str | None:
    """The assistant range holding a client key (an address or an IPv6 /64); None outside them."""
    try:
        network = ipaddress.ip_network(key)
    except ValueError:
        return None
    for candidate in ranges:
        if network.version == candidate.version and network.subnet_of(candidate):  # type: ignore[arg-type]
            return str(candidate)
    return None


def is_mcp(path: str) -> bool:
    return path == "/mcp" or path.startswith("/mcp/")


def normalise_client(value: str) -> str:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return value[:64]
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped:
            return str(address.ipv4_mapped)
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


def wide_key(key: str) -> str | None:
    """The /48 around an IPv6 /64 key; None for anything else."""
    if ":" not in key or not key.endswith("/64"):
        return None
    return str(ipaddress.ip_network(key).supernet(new_prefix=48))


def client_key(scope: Scope, trust_proxy: bool) -> str:
    if trust_proxy:
        for name, value in scope.get("headers", []):
            if name == b"x-forwarded-for":
                first = value.decode("latin-1").split(",")[0].strip()
                if first:
                    return normalise_client(first)
    client = scope.get("client")
    return normalise_client(client[0]) if client else "unknown"


def classify(path: str) -> Policy | None:
    """(class, cost) for a path; None when the path is not limited."""
    if any(path == p or path.startswith(p + "/") for p in EXEMPT_PATHS):
        return None
    if tile := HIZOOM_TILE.match(path):
        return ("hizoom", 1) if int(tile.group(1)) >= HIGH_ZOOM else ("bulk", 1)
    if any(path.startswith(prefix) for prefix in BULK_PREFIXES):
        return ("bulk", 1)
    for pattern, cost in DETAIL_PATHS:
        if pattern.match(path):
            return ("detail", cost)
    if path in EXPENSIVE_PATHS:
        return EXPENSIVE
    if path == "/api/v1/corrections":
        return ("report", 1)
    if path.startswith("/api/v2/downloads/"):
        return ("download", 1)
    if tool := TOOL_PATH.match(path):
        return TOOL_POLICY.get(tool.group(1), DEFAULT)
    if is_mcp(path):
        return DEFAULT  # a POST is classed again by its message (classify_mcp)
    if path.startswith("/api/"):
        return DEFAULT
    return None


def classify_mcp(body: bytes, assistant: bool = False) -> Policy | None:
    """(class, cost) of one JSON-RPC message; None for a batch, which is refused.
    `assistant`: the client is inside an assistant range, whose initialize has its own class."""
    try:
        message = json.loads(body)
    except ValueError:
        return DEFAULT  # the MCP server answers the parse error
    if isinstance(message, list):
        return None
    if isinstance(message, dict) and message.get("method") == "tools/call":
        if not feature_flags.mcp_data():
            return DEFAULT  # every data tool answers "coming soon": no detail or expensive read happens
        params = message.get("params")
        name = params.get("name") if isinstance(params, dict) else None
        return TOOL_POLICY.get(name, DEFAULT) if isinstance(name, str) else DEFAULT
    if isinstance(message, dict) and message.get("method") == "initialize":
        # Opens a session that the server keeps for 30 minutes.
        return ASSISTANT_INIT if assistant else DEFAULT
    return DISCOVERY


@dataclass
class Bucket:
    tokens: float
    updated: float


@dataclass(frozen=True)
class Decision:
    allowed: bool
    limit: int  # the tightest window (allowed) or the longest wait (refused)
    remaining: int
    wait: float


@dataclass
class TokenBuckets:
    """One bucket per (key, rate); refills continuously, capped at the burst size.
    Least recently used buckets are dropped beyond MAX_TRACKED_BUCKETS."""
    clock: Callable[[], float] = time.monotonic
    buckets: "OrderedDict[tuple[str, Rate], Bucket]" = field(default_factory=OrderedDict)
    capacity: int = MAX_TRACKED_BUCKETS

    def _refilled(self, key: str, rate: Rate, now: float) -> Bucket:
        bucket = self.buckets.get((key, rate))
        if bucket is None:
            bucket = self.buckets[(key, rate)] = Bucket(float(rate.requests), now)
            while len(self.buckets) > self.capacity:
                self.buckets.popitem(last=False)
        else:
            self.buckets.move_to_end((key, rate))
        bucket.tokens = min(float(rate.requests), bucket.tokens + (now - bucket.updated) * rate.per_second)
        bucket.updated = now
        return bucket

    def charge(self, windows: list[tuple[str, Rate]], cost: int = 1) -> Decision:
        """Take `cost` from every window, or from none."""
        now = self.clock()
        buckets = [(rate, self._refilled(key, rate, now)) for key, rate in windows]
        short = [(rate, (cost - bucket.tokens) / rate.per_second)
                 for rate, bucket in buckets if bucket.tokens < cost]
        if short:
            rate, wait = max(short, key=lambda item: item[1])
            return Decision(False, rate.requests, 0, wait)
        for _, bucket in buckets:
            bucket.tokens -= cost
        rate, bucket = min(buckets, key=lambda item: item[1].tokens)
        return Decision(True, rate.requests, int(bucket.tokens), 0.0)

    def take(self, key: str, rate: Rate) -> tuple[bool, int, float]:
        """One token from one window: (allowed, remaining, seconds until a token is back)."""
        decision = self.charge([(key, rate)])
        return decision.allowed, decision.remaining, decision.wait


@dataclass
class RecentIds:
    """Render ids seen in the last `ttl` seconds, oldest first; at most `capacity`."""
    ttl: float = RENDER_ID_TTL
    capacity: int = MAX_RENDER_IDS
    seen: "OrderedDict[str, float]" = field(default_factory=OrderedDict)

    def fresh(self, key: str, now: float) -> bool:
        stamp = self.seen.get(key)
        return stamp is not None and now - stamp < self.ttl

    def add(self, key: str, now: float) -> None:
        self.seen.pop(key, None)
        self.seen[key] = now
        while self.seen and (len(self.seen) > self.capacity or now - next(iter(self.seen.values())) >= self.ttl):
            self.seen.popitem(last=False)


class SharedBuckets:
    """TokenBuckets and RecentIds in one SQLite file that every uvicorn worker of a container opens, so a
    client's allowance and a render's ids are the same whichever worker a request reaches. Each charge is one
    write transaction (BEGIN IMMEDIATE serialises the workers). Wall-clock time, shared by the processes.
    A bucket idle for its whole period is full again, so its row is dropped (sweep). If the file fails
    (locked past `timeout`, disk error) the charge falls back to this worker's own buckets and says so in
    the log, so the API keeps answering."""

    def __init__(self, path: str, clock: Callable[[], float] = time.time, timeout: float = 1.0) -> None:
        self.path, self.clock, self.timeout = path, clock, timeout
        self.local = TokenBuckets(clock=clock)
        self.local_ids = RecentIds()
        self._connection: sqlite3.Connection | None = None
        self._pid = 0
        self._charges = 0

    def _db(self) -> sqlite3.Connection:
        if self._connection is None or self._pid != os.getpid():  # one connection per worker process
            connection = sqlite3.connect(self.path, timeout=self.timeout, isolation_level=None,
                                         check_same_thread=False)
            connection.execute("PRAGMA synchronous=OFF")
            self._create(connection)
            self._connection, self._pid = connection, os.getpid()
        return self._connection

    def _create(self, connection: sqlite3.Connection) -> None:
        """WAL and the tables. Workers start together, and switching the journal mode is refused at once
        (no busy wait) while another opens the file, so it is retried for up to `timeout`."""
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.execute("BEGIN IMMEDIATE")
                connection.execute("CREATE TABLE IF NOT EXISTS bucket (key TEXT PRIMARY KEY, tokens REAL NOT NULL, "
                                   "updated REAL NOT NULL, expires REAL NOT NULL) WITHOUT ROWID")
                connection.execute("CREATE TABLE IF NOT EXISTS seen (key TEXT PRIMARY KEY, stamp REAL NOT NULL) "
                                   "WITHOUT ROWID")
                connection.execute("COMMIT")
                return
            except sqlite3.OperationalError:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.01)

    def open(self) -> "SharedBuckets":
        """Open (and create) the file now; raises sqlite3.Error when it cannot be used."""
        self._db()
        return self

    def charge(self, windows: list[tuple[str, Rate]], cost: int = 1) -> Decision:
        """Take `cost` from every window, or from none (as TokenBuckets.charge)."""
        try:
            return self._charge(windows, cost)
        except sqlite3.Error as error:
            log.warning("rate limit store %s failed (%s): this worker's own buckets answer", self.path, error)
            return self.local.charge(windows, cost)

    def _charge(self, windows: list[tuple[str, Rate]], cost: int) -> Decision:
        now = self.clock()
        keys = [f"{key}|{rate.requests}/{rate.period_seconds:g}" for key, rate in windows]
        db = self._db()
        db.execute("BEGIN IMMEDIATE")
        try:
            stored = dict(((row[0], (row[1], row[2])) for row in db.execute(
                f"SELECT key, tokens, updated FROM bucket WHERE key IN ({','.join('?' * len(keys))})", keys)))
            tokens = []
            for name, (_, rate) in zip(keys, windows):
                level, updated = stored.get(name, (float(rate.requests), now))
                tokens.append(min(float(rate.requests), level + max(0.0, now - updated) * rate.per_second))
            short = [(rate, (cost - level) / rate.per_second)
                     for (_, rate), level in zip(windows, tokens) if level < cost]
            if short:
                db.execute("COMMIT")
                rate, wait = max(short, key=lambda item: item[1])
                return Decision(False, rate.requests, 0, wait)
            db.executemany("INSERT OR REPLACE INTO bucket (key, tokens, updated, expires) VALUES (?, ?, ?, ?)",
                           [(name, level - cost, now, now + rate.period_seconds)
                            for name, (_, rate), level in zip(keys, windows, tokens)])
            self._charges += 1
            if self._charges % SWEEP_EVERY == 0:
                db.execute("DELETE FROM bucket WHERE expires < ?", (now,))
                db.execute("DELETE FROM seen WHERE stamp < ?", (now - RENDER_ID_TTL,))
            db.execute("COMMIT")
        except BaseException:
            if db.in_transaction:
                db.execute("ROLLBACK")
            raise
        index = min(range(len(windows)), key=lambda i: tokens[i] - cost)
        return Decision(True, windows[index][1].requests, int(tokens[index] - cost), 0.0)

    def take(self, key: str, rate: Rate) -> tuple[bool, int, float]:
        decision = self.charge([(key, rate)])
        return decision.allowed, decision.remaining, decision.wait

    # Render ids (the RecentIds interface).
    def fresh(self, key: str, now: float) -> bool:
        try:
            row = self._db().execute("SELECT stamp FROM seen WHERE key = ?", (key,)).fetchone()
        except sqlite3.Error as error:
            log.warning("rate limit store %s failed (%s): this worker's own render ids answer", self.path, error)
            return self.local_ids.fresh(key, now)
        return row is not None and now - row[0] < RENDER_ID_TTL

    def add(self, key: str, now: float) -> None:
        try:
            self._db().execute("INSERT OR REPLACE INTO seen (key, stamp) VALUES (?, ?)", (key, now))
        except sqlite3.Error as error:
            log.warning("rate limit store %s failed (%s): this worker's own render ids answer", self.path, error)
            self.local_ids.add(key, now)


def store_path(env: Mapping[str, str]) -> str | None:
    """The shared store's file, or None for per-worker buckets: one worker, or CLOSE_KNIT_RATE_STORE=memory."""
    configured = env.get(STORE_ENV, "").strip()
    if configured.lower() == "memory" or workers(env) == 1:
        return None
    if configured:
        return configured
    folder = "/dev/shm" if os.path.isdir("/dev/shm") and os.access("/dev/shm", os.W_OK) else tempfile.gettempdir()
    return os.path.join(folder, STORE_FILE)


def shared_store(env: Mapping[str, str]) -> SharedBuckets | None:
    path = store_path(env)
    if path is None:
        return None
    try:
        return SharedBuckets(path).open()
    except sqlite3.Error as error:
        log.warning("rate limit store %s cannot be opened (%s): each worker keeps its own buckets", path, error)
        return None


def _digest(value: bytes) -> bytes:
    return hashlib.sha256(value).digest()


def render_id(scope: Scope, internal_key: bytes | None) -> str | None:
    """The render id of a request that carries the internal key; None otherwise (no key configured,
    no or a wrong key sent, or a malformed id). The key is compared in constant time."""
    if not internal_key:
        return None
    sent = rendered = None
    for name, value in scope.get("headers", []):
        if name == INTERNAL_KEY_HEADER:
            sent = value
        elif name == RENDER_ID_HEADER:
            rendered = value
    if sent is None or not hmac.compare_digest(_digest(sent), _digest(internal_key)):
        return None
    text = rendered.decode("latin-1") if rendered is not None else ""
    return text if RENDER_ID.match(text) else None


@dataclass
class RateLimiter:
    """Configuration + buckets; attributes are read per request so tests can swap them."""
    limits: dict[str, tuple[Rate, ...]]
    trust_proxy: bool
    buckets: "TokenBuckets | SharedBuckets" = field(default_factory=TokenBuckets)
    # CLOSE_KNIT_INTERNAL_KEY, shared with the web server; None turns the render class off.
    internal_key: bytes | None = None
    renders: "RecentIds | SharedBuckets" = field(default_factory=RecentIds)
    # Assistant egress ranges whose MCP sessions get their own buckets (module docstring).
    assistant_ranges: tuple[Network, ...] = ()
    # Search crawlers' published ranges, charged to the crawler class (module docstring).
    crawler_ranges: tuple[Network, ...] = ()

    @classmethod
    def from_env(cls) -> "RateLimiter":
        key = os.environ.get("CLOSE_KNIT_INTERNAL_KEY", "").strip()
        store = shared_store(os.environ)
        shared = {"buckets": store, "renders": store} if store else {}
        return cls(limits=limits_from_env(os.environ, shared=store is not None),
                   trust_proxy=os.environ.get("CLOSE_KNIT_TRUST_PROXY") == "1",
                   internal_key=key.encode() if key else None,
                   assistant_ranges=assistant_ranges_from_env(os.environ),
                   crawler_ranges=crawler_ranges_from_env(os.environ), **shared)

    def reset(self) -> None:
        """Forget every bucket and render id (tests: each starts with a full allowance)."""
        self.buckets = TokenBuckets()
        self.renders = RecentIds()

    def client(self, scope: Scope) -> str:
        return client_key(scope, self.trust_proxy)

    def assistant_range(self, scope: Scope) -> str | None:
        return assistant_range(self.client(scope), self.assistant_ranges)

    def bucket_key(self, scope: Scope, name: str, client: str) -> str:
        """(range, session id) for an MCP session from an assistant range; the client otherwise."""
        if name == "assistant_init" or not is_mcp(scope.get("path", "")):
            return client
        session = next((value for header, value in scope.get("headers", []) if header == SESSION_HEADER), b"")
        network = assistant_range(client, self.assistant_ranges) if session else None
        if network is None:
            return client
        return f"{network}|session:{session.decode('latin-1')[:MAX_SESSION_ID]}"

    def render_id(self, scope: Scope) -> str | None:
        return render_id(scope, self.internal_key)

    def charge_render(self, scope: Scope, render: str) -> Decision:
        """One page view per render id and viewer: the first read costs 1, the others 0 (they still
        get the X-RateLimit headers); a refused first read is not remembered, so the next one pays."""
        seen = f"{self.client(scope)}|{render}"
        now = self.buckets.clock()
        known = self.renders.fresh(seen, now)
        decision = self.charge(scope, ("render", 0 if known else 1))
        if decision.allowed and not known:
            self.renders.add(seen, now)
        return decision

    def charge_render_detail(self, scope: Scope, render: str, policy: Policy) -> Decision:
        """A detail read inside a render: its own class and cost, once per path and render (a
        page's metadata and body read one home's profile; charging both made the next view a 429)."""
        seen = f"{self.client(scope)}|{render}|{scope.get('path', '')}"
        now = self.buckets.clock()
        known = self.renders.fresh(seen, now)
        decision = self.charge(scope, (policy[0], 0 if known else policy[1]))
        if decision.allowed and not known:
            self.renders.add(seen, now)
        return decision

    def charge(self, scope: Scope, policy: Policy) -> Decision:
        name, cost = policy
        client = self.client(scope)
        if name in CRAWLER_CLASSES and assistant_range(client, self.crawler_ranges) is not None:
            name = "crawler"
        key = self.bucket_key(scope, name, client)
        rates = self.limits[name]
        windows = [(f"{name}:{key}", rate) for rate in rates]
        wide = wide_key(key) if name in WIDE_DAY_CLASSES and key == client else None
        if wide:
            windows += [(f"{name}:{wide}", Rate(rate.requests * WIDE_DAY_FACTOR, rate.period_seconds))
                        for rate in rates if rate.period_seconds >= PERIODS["day"]]
        return self.buckets.charge(windows, cost)


class RateLimitMiddleware:
    def __init__(self, app: ASGIApp, *, limiter: RateLimiter | None = None) -> None:
        self.app = app
        self.limiter = limiter or RateLimiter.from_env()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        policy = classify(scope.get("path", "")) if scope["type"] == "http" else None
        if policy is None:
            await self.app(scope, receive, send)
            return
        render = self.limiter.render_id(scope)
        if render is not None and policy[0] != "detail":
            decision = self.limiter.charge_render(scope, render)
            if not decision.allowed:
                await _too_many(send, decision)
                return
            await self.app(scope, receive, _with_headers(send, decision))
            return
        if render is not None:  # a detail read inside a render
            decision = self.limiter.charge_render_detail(scope, render, policy)
            if not decision.allowed:
                await _too_many(send, decision)
                return
            await self.app(scope, receive, _with_headers(send, decision))
            return
        if scope["path"].rstrip("/") == "/mcp" and scope.get("method") == "POST":
            body = await _read_body(receive, MAX_MCP_BODY)
            if body is None:
                await _reply(send, 413, b'{"detail":{"error":"payload-too-large","message":"MCP requests are '
                                        b'limited to 64 KB"}}')
                return
            policy = classify_mcp(body, assistant=self.limiter.assistant_range(scope) is not None)
            if policy is None:
                await _reply(send, 400, b'{"jsonrpc":"2.0","id":null,"error":{"code":-32600,'
                                        b'"message":"batch requests are not supported; send one message per request"}}')
                return
            receive = _replay(body, receive)
        decision = self.limiter.charge(scope, policy)
        if not decision.allowed:
            await _too_many(send, decision)
            return
        await self.app(scope, receive, _with_headers(send, decision))


async def _read_body(receive: Receive, limit: int) -> bytes | None:
    """The whole request body, or None past `limit` bytes or on disconnect."""
    chunks, size = [], 0
    while True:
        message = await receive()
        if message["type"] != "http.request":
            return None
        chunk = message.get("body", b"")
        size += len(chunk)
        if size > limit:
            return None
        chunks.append(chunk)
        if not message.get("more_body", False):
            return b"".join(chunks)


def _replay(body: bytes, receive: Receive) -> Receive:
    sent = False

    async def replay() -> Message:
        nonlocal sent
        if sent:
            return await receive()
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}
    return replay


def _headers(decision: Decision) -> list[tuple[bytes, bytes]]:
    return [(b"x-ratelimit-limit", str(decision.limit).encode()),
            (b"x-ratelimit-remaining", str(decision.remaining).encode())]


def _with_headers(send: Send, decision: Decision) -> Send:
    async def sender(message: Any) -> None:
        if message["type"] == "http.response.start":
            message["headers"] = list(message.get("headers", [])) + _headers(decision)
        await send(message)
    return sender


async def _reply(send: Send, status: int, body: bytes, headers: tuple[tuple[bytes, bytes], ...] = ()) -> None:
    await send({"type": "http.response.start", "status": status, "headers": [
        (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), *headers]})
    await send({"type": "http.response.body", "body": body})


async def _too_many(send: Send, decision: Decision) -> None:
    retry = max(1, int(decision.wait + 0.999))
    body = b'{"detail":{"error":"too-many-requests","message":"rate limit exceeded; retry later"}}'
    await _reply(send, 429, body, ((b"retry-after", str(retry).encode()), *_headers(decision)))
