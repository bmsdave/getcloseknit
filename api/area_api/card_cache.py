"""In-process caches behind the extension's card and results line (listing-card, listing-badges).

An area's facts and a saved profile's match pack are the same for every listing that asks within a release,
so they are kept for an hour per product release: a bounded LRU, safe across the server's worker threads.
The release itself is re-read at most once a minute, so a cache hit asks the database nothing.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
import weakref
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Hashable, Mapping

logger = logging.getLogger(__name__)

HOUR = 60 * 60
RELEASE_SECONDS = 60
# Connections one card may hold at once while its layers load (the pool has 10 by default).
LAYER_WORKERS = 4
_MISSING = object()


class TTLCache:
    """A bounded, thread-safe LRU whose entries expire ``seconds`` after they were stored."""

    def __init__(self, limit: int, seconds: float = HOUR, clock: Callable[[], float] = time.monotonic):
        self.limit, self.seconds, self.clock = limit, seconds, clock
        self._items: OrderedDict[Hashable, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: Hashable, default: Any = None) -> Any:
        with self._lock:
            hit = self._items.get(key)
            if hit is None:
                return default
            if self.clock() - hit[0] >= self.seconds:
                del self._items[key]
                return default
            self._items.move_to_end(key)
            return hit[1]

    def put(self, key: Hashable, value: Any) -> None:
        with self._lock:
            self._items[key] = (self.clock(), value)
            self._items.move_to_end(key)
            while len(self._items) > self.limit:
                self._items.popitem(last=False)

    def get_or_build(self, key: Hashable, build: Callable[[], Any]) -> Any:
        """The cached value, else ``build()`` stored. A build that raises stores nothing."""
        value = self.get(key, _MISSING)
        if value is _MISSING:
            value = build()
            self.put(key, value)
        return value

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._items)


_release_lock = threading.Lock()
# Per reader: when its active release was read, and what it was.
_releases: "weakref.WeakKeyDictionary[Any, tuple[float, str]]" = weakref.WeakKeyDictionary()


def release_id(reader: Any, clock: Callable[[], float] = time.monotonic) -> str:
    """The reader's active product release, re-read at most once a minute; "" when it cannot say."""
    connect = getattr(reader, "_connect", None)
    if connect is None:
        return ""
    now = clock()
    with _release_lock:
        hit = _releases.get(reader)
    if hit and now - hit[0] < RELEASE_SECONDS:
        return hit[1]
    from .evidence import ACTIVE_RELEASE_SQL

    found = ""
    try:
        with connect() as connection:
            rows = list(connection.execute(ACTIVE_RELEASE_SQL))
        found = rows[0]["release_id"] if rows else ""
    except Exception:  # noqa: BLE001 - without a release the caches still expire within the hour
        logger.info("card cache: active release unavailable", exc_info=True)
    with _release_lock:
        _releases[reader] = (now, found)
    return found


def forget_release() -> None:
    with _release_lock:
        _releases.clear()


def profile_key(profile: Mapping[str, Any]) -> str:
    """A stable hash of a validated profile: the same search in any key order gives the same key."""
    text = json.dumps(profile, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(text.encode()).hexdigest()


def run_parallel(tasks: Mapping[str, Callable[[], Any]], workers: int = LAYER_WORKERS) -> dict[str, tuple[bool, Any]]:
    """Each task's (True, value) or (False, the exception it raised), run on up to ``workers`` threads.
    Each task opens its own connection; one that fails does not stop the others."""
    def run(task: Callable[[], Any]) -> tuple[bool, Any]:
        try:
            return True, task()
        except Exception as error:  # noqa: BLE001 - the caller decides what a failure means
            return False, error

    if len(tasks) <= 1 or workers <= 1:
        return {name: run(task) for name, task in tasks.items()}
    with ThreadPoolExecutor(max_workers=min(workers, len(tasks)), thread_name_prefix="card") as pool:
        futures = {name: pool.submit(run, task) for name, task in tasks.items()}
        return {name: future.result() for name, future in futures.items()}
