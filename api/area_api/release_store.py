"""Derived data kept per release in the database (migration 128, table release_artifact).

What the API derives from a release and serves to everyone alike (school pools, standouts, the sections' region
lists, ready-made criteria, ranking lenses, the area tree, value packs and their roll-ups) is built once per release
by `python -m area_api.release_build` and read here by primary key. It replaced warm_* threads that rebuilt it inside
every API process after each restart and module caches that held it per process (docs/review-2026-10 A11), so any
number of API workers share one copy and none of them starts cold.

`cached(connection, release_id, key, load)` reads the row for (release, build, kind = key[0], key[1:]); a key the
build did not cover is built by the first request that asks (one at a time per process) and stored for the others.
Bodies are the built value pickled and zlib-compressed, so a stored answer is the one built, byte for byte once
sent. An object's row is keyed by a hash of this package's files, so a deploy never reads objects another version of
the code made; an answer sent as built (`payload=True`: value packs, boxes, preset packs: plain values) is keyed by
FORMAT instead and survives deploys, as the disk cache it replaced did. Only the API and its build step write the
table (the database role the API runs as).

A connection without savepoints (a test's fake) has no store: every call builds. A failed read or write is logged
and the request builds or answers anyway; the build step sets `raise_errors`, so there it fails the build.
"""
from __future__ import annotations

import hashlib
import logging
import pickle
import threading
import zlib
from pathlib import Path
from typing import Any, Callable, Iterable

logger = logging.getLogger(__name__)

# Bumped when a stored payload's shape changes (4: R2's uk:lad: ids; 3: kept in release_artifact; 2 was the disk
# cache's R1 names).
FORMAT = 4
MISSING: Any = object()
# release_build sets it: a store error fails the build instead of being logged.
raise_errors = False

GET_SQL = """-- release-artifact:get
SELECT body FROM release_artifact WHERE release_id = %s AND build = %s AND kind = %s AND key = %s"""
PUT_SQL = """-- release-artifact:put
INSERT INTO release_artifact (release_id, build, kind, key, body) VALUES (%s, %s, %s, %s, %s)
ON CONFLICT DO NOTHING"""
# The active and previous releases' rows stay, and of other builds only the newest of each kind of build (payloads,
# objects): the serving API's while a deploy builds the next one's.
PRUNE_SQL = """-- release-artifact:prune
WITH releases AS (
  SELECT release_id FROM active_product_release
  UNION SELECT previous_release_id FROM active_product_release WHERE previous_release_id IS NOT NULL
), kept AS (
  SELECT DISTINCT ON (split_part(build, '-', 1)) build FROM release_artifact WHERE build <> ALL(%(current)s)
  ORDER BY split_part(build, '-', 1), built_at DESC
)
DELETE FROM release_artifact
WHERE release_id NOT IN (SELECT release_id FROM releases)
   OR (build <> ALL(%(current)s) AND build NOT IN (SELECT build FROM kept))"""
SIZE_SQL = """-- release-artifact:size
SELECT count(*) AS n, coalesce(sum(octet_length(body)), 0) AS bytes FROM release_artifact"""

_code_build: str | None = None


def code_build() -> str:
    """"py-" and a hash of this package's files: what made a pickled object."""
    global _code_build
    if _code_build is None:
        root = Path(__file__).resolve().parent
        digest = hashlib.sha256()
        for path in sorted(root.rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
                digest.update(path.relative_to(root).as_posix().encode() + b"\0" + path.read_bytes() + b"\0")
        _code_build = "py-" + digest.hexdigest()[:16]
    return _code_build


def build_name(payload: bool) -> str:
    return f"payload-v{FORMAT}" if payload else code_build()


def current_builds() -> list[str]:
    return [build_name(True), build_name(False)]


def encode(value: Any) -> bytes:
    return zlib.compress(pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL), 3)


def decode(body: bytes) -> Any:
    # Rows come from this package alone (the API's role writes the table): the same trust as the code itself.
    return pickle.loads(zlib.decompress(body))  # noqa: S301


def _savepoint(connection: Any, run: Callable[[], Any]) -> Any:
    # A failed read or write must not abort the caller's transaction.
    with connection.transaction():
        return run()


class DatabaseStore:
    """The table, through the caller's connection: a row written during a request is seen by the others once that
    request commits. The release build writes through `writer` instead (a connection of the thread's own that
    commits each row at once), so its parallel tasks see each other's rows at once and never wait on one another's
    open transactions."""

    def __init__(self) -> None:
        self.writer: Callable[[], Any] | None = None

    def get(self, connection: Any, release_id: str, build: str, kind: str, key: str) -> Any:
        if not hasattr(connection, "transaction"):
            return MISSING
        rows = _savepoint(connection, lambda: list(connection.execute(GET_SQL, (release_id, build, kind, key))))
        return decode(bytes(rows[0]["body"])) if rows else MISSING

    def put(self, connection: Any, release_id: str, build: str, kind: str, key: str, value: Any) -> None:
        if not hasattr(connection, "transaction"):
            return
        body = encode(value)
        if self.writer is not None:
            self.writer().execute(PUT_SQL, (release_id, build, kind, key, body))
            return
        _savepoint(connection, lambda: connection.execute(PUT_SQL, (release_id, build, kind, key, body)))


class MemoryStore:
    """Tests: the table's behaviour without a database (rows are encoded and decoded as stored ones are)."""

    def __init__(self) -> None:
        self.rows: dict[tuple, bytes] = {}

    def get(self, connection: Any, release_id: str, build: str, kind: str, key: str) -> Any:
        row = self.rows.get((release_id, build, kind, key))
        return decode(row) if row is not None else MISSING

    def put(self, connection: Any, release_id: str, build: str, kind: str, key: str, value: Any) -> None:
        self.rows.setdefault((release_id, build, kind, key), encode(value))

    def kinds(self) -> list[tuple[str, str, str]]:
        return sorted((release, kind, key) for release, _, kind, key in self.rows)


store: DatabaseStore | MemoryStore = DatabaseStore()


def use_memory() -> Callable[[], None]:
    """Tests: an in-memory store from now on; returns what puts the previous one back."""
    global store
    previous, store = store, MemoryStore()
    return lambda: globals().__setitem__("store", previous)


def _parts(key: tuple) -> tuple[str, str]:
    return str(key[0]), repr(tuple(key[1:]))


def get(connection: Any, release_id: str, key: tuple, *, payload: bool = False) -> Any:
    """The stored value of `key` (key[0] is its kind), or MISSING."""
    kind, rest = _parts(key)
    try:
        return store.get(connection, release_id, build_name(payload), kind, rest)
    except Exception as error:
        if raise_errors:
            raise
        logger.warning("release-store code=read-failed kind=%s error=%s", kind, type(error).__name__)
        return MISSING


def put(connection: Any, release_id: str, key: tuple, value: Any, *, payload: bool = False) -> None:
    kind, rest = _parts(key)
    try:
        store.put(connection, release_id, build_name(payload), kind, rest, value)
    except Exception as error:
        if raise_errors:
            raise
        logger.warning("release-store code=write-failed kind=%s error=%s", kind, type(error).__name__)


class _Flight:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.value: Any = MISSING


_flights: dict[tuple, _Flight] = {}
_flights_lock = threading.Lock()


def cached(connection: Any, release_id: str, key: tuple, load: Callable[[], Any], *, payload: bool = False) -> Any:
    """The stored value of `key`, else `load()` stored. Concurrent cold callers in one process wait for the one load
    (ten school cards opened at once after a release each ran a ~9 s query) and get its value, written by then but
    perhaps not yet committed. A failed load stores nothing."""
    held = get(connection, release_id, key, payload=payload)
    if held is not MISSING:
        return held
    name = (release_id, build_name(payload), key)
    with _flights_lock:
        flight = _flights.setdefault(name, _Flight())
    try:
        with flight.lock:
            if flight.value is not MISSING:
                return flight.value
            held = get(connection, release_id, key, payload=payload)  # another process built it meanwhile
            if held is MISSING:
                held = load()
                put(connection, release_id, key, held, payload=payload)
            flight.value = held
            return held
    finally:
        with _flights_lock:
            if _flights.get(name) is flight and not flight.lock.locked():
                del _flights[name]


def prune(connection: Any, builds: Iterable[str] | None = None) -> int:
    """Deletes the rows no API reads any more (PRUNE_SQL); how many."""
    cursor = connection.execute(PRUNE_SQL, {"current": list(builds or current_builds())})
    return cursor.rowcount


def size(connection: Any) -> dict:
    row = list(connection.execute(SIZE_SQL))[0]
    return {"rows": int(row["n"]), "bytes": int(row["bytes"])}
