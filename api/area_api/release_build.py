"""Builds what the active release derives into release_artifact (migration 128, area_api/release_store.py), so every
API worker reads it by primary key and none starts cold. It replaced the warm_* threads each API process ran after a
start and the module caches they filled (docs/review-2026-10 A11).

deploy/ship.sh runs tiers 0 and 1 in a one-off container of the new image before the new API starts (the serving
one keeps answering meanwhile), then tiers 2 and 3 in the background; RELEASE-CHECKLIST.md runs it after an
activation. Objects (tier 0) are keyed by the code's hash, so each deploy rebuilds them (about a minute); the map's
packs are keyed by release and payload format, so a deploy without a new release finds them built.

    python -m area_api.release_build --tiers 0,1 --jobs 4    # what pages and the start views need
    python -m area_api.release_build --tiers 2,3 --jobs 2    # every other LAD, then the regions in between

Tiers: 0 the derived objects: periods, map chunks, area tree, school pools, borough and MSOA standouts, the
sections' region lists, ready-made criteria and ranking lenses; 1 every layer's start pieces (England's LADs and regions
zoomed out, London whole; web/src/lib/map-coverage.ts viewPieces) and the ready-made criteria's packs; 2 every
other LAD; 3 each region at the layer's own areas. A failed task fails the build (exit 1) after the others ran; it
never fails silently. The end prunes rows no API reads any more and prints the table's size.
"""
from __future__ import annotations

import argparse
import logging
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Iterable

from . import coverage as coverage_module
from . import custom_criteria, feature_flags, kinds, map_chunks, release_store
from .evidence import MAX_PACK_CHUNKS, EvidenceReader, _active_release

logger = logging.getLogger("area_api.release_build")
Task = tuple[int, str, Callable[[], Any]]


def _batches(items: list[str], size: int = MAX_PACK_CHUNKS) -> Iterable[list[str]]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


def _with_release(reader: EvidenceReader, build: Callable[[Any, str], Any]) -> Callable[[], Any]:
    def run() -> Any:
        with reader._connect() as connection:
            return build(connection, _active_release(connection, None))
    return run


def derived(reader: EvidenceReader) -> list[Task]:
    """Tier 0: what pages read besides the map's packs."""
    from . import area_pages, borough_standouts, layers, regions, safety, school_card, standouts

    tasks: list[Task] = []
    metrics = [metric["id"] for metric in reader.list_metrics()["metrics"]]

    def periods(connection: Any, release_id: str) -> None:
        for metric_id in metrics:
            reader._release_periods(connection, release_id, metric_id)

    tasks.append((0, "periods", _with_release(reader, periods)))
    tasks.append((0, "map chunks", _with_release(reader, reader._chunk_index)))
    tasks.append((0, "area tree", lambda: area_pages.build(reader)))
    tasks.append((0, "school pools", _with_release(reader, school_card.build_pools)))
    tasks.append((0, "borough and MSOA standouts", lambda: borough_standouts.build(reader)))
    tasks.append((0, "ready-made criteria", _with_release(reader, layers.build_presets)))

    def sections() -> list[str]:
        """The sections' region lists (standouts' distributions, safety's region rates): one neighbourhood per
        region reads its region's (cold, standouts 490 ms and safety 270 ms a region)."""
        with reader._connect() as connection:
            region_map = regions.area_regions_on(connection)
        firsts: dict[str, str] = {}
        for area_id, region in sorted(region_map.items()):
            if area_id.startswith("uk:lsoa:"):
                firsts.setdefault(region, area_id)
        for area_id in firsts.values():
            standouts.area_standouts(reader, area_id)
            safety.area_safety(reader, area_id)
        return sorted(firsts)

    tasks.append((0, "sections", sections))
    for preset_id in custom_criteria.LENS_PRESETS:
        tasks.append((0, f"lens {preset_id}", lambda preset_id=preset_id: _with_release(
            reader, lambda connection, _: custom_criteria.lens_pack(connection, preset_id, "msoa"))()))
    return tasks


def plan(reader: EvidenceReader, titles: Callable[[], Any], tiers: set[int] | None = None) -> list[Task]:
    """Every build task as (tier, label, build), in the order pages and the map need them."""
    tasks: list[Task] = derived(reader) if tiers is None or 0 in tiers else []
    covered = reader.map_coverage()
    regions = [region["id"] for region in covered.get("regions", [])]
    london = coverage_module.LONDON_REGION
    lads = [chunk["id"] for chunk in covered.get("chunks", []) if chunk["id"] != london]
    england = feature_flags.england() and covered.get("coverage") == "england"
    metrics = reader.list_metrics()["metrics"]

    def pack(metric: str, period: str, chunks: list[str] | None, level: str | None) -> Callable[[], Any]:
        return lambda: reader.get_value_pack(metric, period, chunk=",".join(chunks) if chunks else None, level=level)

    for metric in metrics:
        period, carrier, name = metric.get("defaultPeriod"), metric.get("carrier"), metric["id"]
        if not period or carrier not in map_chunks.LEVELS:
            continue
        if not england or carrier == kinds.LAD:
            tasks.append((1, f"pack {name} whole", pack(name, period, None, None)))
            continue
        rolled = "msoa" if carrier == "lsoa" else None
        # The zoom ladder (web/src/lib/map-coverage.ts viewPieces): England's LADs, then the regions as MSOAs.
        tasks.append((1, f"pack {name} England's LADs", pack(name, period, None, kinds.LAD)))
        tasks.append((1, f"pack {name} regions zoomed out", pack(name, period, regions, rolled)))
        tasks.append((1, f"pack {name} London", pack(name, period, [london], None)))
        for batch in _batches(lads):
            tasks.append((2, f"pack {name} LADs {batch[0]}..", pack(name, period, batch, None)))
        tasks.append((3, f"pack {name} regions", pack(name, period, regions, None)))

    for preset in custom_criteria.presets()["presets"]:
        criterion_id = preset["criterion"]["id"]
        tasks.append((1, f"preset {criterion_id}", lambda criterion_id=criterion_id: reader.preset_pack(criterion_id, titles)))
        if england:  # zoomed out the map paints its MSOAs (custom_criteria.roll_up_pack)
            tasks.append((1, f"preset {criterion_id} MSOAs",
                          lambda criterion_id=criterion_id: reader.preset_pack(criterion_id, titles, level="msoa")))

    return sorted((task for task in tasks if tiers is None or task[0] in tiers), key=lambda task: task[0])


def run(reader: EvidenceReader, tasks: list[Task], jobs: int, budget_seconds: float) -> dict[str, int]:
    """Runs the tasks `jobs` at a time; none starts after the budget. A failure is logged and counted; the others
    still run."""
    started = time.monotonic()
    counts = {"done": 0, "failed": 0, "skipped": 0}
    with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
        def guarded(label: str, build: Callable[[], Any]) -> bool:
            if time.monotonic() - started > budget_seconds:
                return False
            build()
            return True

        futures = {pool.submit(guarded, label, build): label for _, label, build in tasks}
        for future in as_completed(futures):
            try:
                counts["done" if future.result() else "skipped"] += 1
            except Exception as error:  # noqa: BLE001 - one task's failure must not stop the others
                counts["failed"] += 1
                logger.error("release-build code=failed task=%s error=%s: %s", futures[future],
                             type(error).__name__, str(error)[:300])
    counts["seconds"] = int(time.monotonic() - started)
    return counts


class _Writers:
    """One autocommit connection per build thread: each built row is committed as it is written."""

    def __init__(self, url: str) -> None:
        self.url = url
        self.local = threading.local()
        self.opened: list[Any] = []
        self.lock = threading.Lock()

    def connection(self) -> Any:
        held = getattr(self.local, "connection", None)
        if held is None or held.closed:
            import psycopg

            held = self.local.connection = psycopg.connect(self.url, autocommit=True)
            with self.lock:
                self.opened.append(held)
        return held

    def close(self) -> None:
        for connection in self.opened:
            connection.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--tiers", default="0,1", help="comma-separated tiers (0: derived objects, 1: start views, "
                                                       "2: LADs, 3: regions)")
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--budget", type=float, default=1800, help="seconds after which no new task starts")
    parser.add_argument("--no-prune", action="store_true", help="keep rows of other releases and builds")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    from . import repository
    from .repository import evidence_connection

    release_store.raise_errors = True
    writers = _Writers(repository._database_url())
    release_store.store.writer = writers.connection
    reader = EvidenceReader(connect=evidence_connection)
    tiers = {int(tier) for tier in args.tiers.split(",") if tier.strip()}
    try:
        tasks = plan(reader, repository.area_titles, tiers)
        counts = run(reader, tasks, args.jobs, args.budget)
        with evidence_connection() as connection:
            release_id = _active_release(connection, None)
            pruned = 0 if args.no_prune else release_store.prune(connection)
            held = release_store.size(connection)
    finally:
        writers.close()
        repository.close_pool()
    print(f"release-build: {release_id} tiers {sorted(tiers)}: {counts['done']} built or read, {counts['failed']} "
          f"failed, {counts['skipped']} over budget, {counts['seconds']} s; {pruned} rows pruned; table "
          f"{held['rows']} rows, {held['bytes'] / 1e6:.1f} MB ({release_store.code_build()})", flush=True)
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
