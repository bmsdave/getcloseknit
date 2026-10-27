# Prod disk cleanup, 2026-10-27

Host `vps-b714062b.vps.ovh.net`, root disk 96G. Sizes in GiB, as `df -h` prints them. Goal: room for task #17 (materialised tables at release build).

| | Used | Free |
|---|---|---|
| Before | 80G (84%) | 15.8G |
| After | 54G (57%) | 42.0G |

## Deleted

| What | Size | Why it was safe |
|---|---|---|
| Full DB dumps `pre-049`, `pre-051`, `pre-053`, `pre-054`, `pre-055`, `pre-059`, `pre-060` (10-12 to 10-16), `pre-090` (10-20) in `/srv/close-knit-data` | 15.3G | A newer full dump exists: `pre-england-2026-10-22.dump` (2.1G, 153 TABLE DATA entries; `pg_restore -l` reads it). |
| Partial dumps older than that full dump: `pre-048`, `pre-058`, `pre-066`, `pre-069`, `pre-080-schema.sql`, `pre-095`, `pre-099`, `pre-100`, `pre-101`, `pre-canopy-pyramid`, `pre-crime-price`, `pre-distances`, `pre-release-gias` | 0.6G | Superseded by the 10-22 full dump. |
| Loaded data bundles in `/srv/close-knit-data`: `census-detailed-2026-10-16`, `collisions-2026-10-16`, `crime-2026-10-20`, `epc-homes-2026-10-19`, `gias-2026-10-20`, `health/home/kids/nature-2026-10-16`, `open-data-a-2026-10-19`, `school-card-2026-10-16`, `school-distances-2026-10-15`, `school-feeders-2026-10-16`, `school-history`, `sector-2026-10-16`, `v3-2026-10-17`, `v4.0/v4.2-2026-10-18`, `wildlife-2026-10-16a/b` | 0.6G | Loaded before 10-22; the rows are in the live DB and in the 10-22 full dump. RELEASE-CHECKLIST 6l and 6x still name `school-history/` and `open-data-a-2026-10-19/` as where those loads were staged: that is history, the bundles are gone. |
| `~/ck-095-2026-10-20`, `~/ck-099`, `~/ck-100`, `~/ck-101` | 14M | Migration 095-101 working copies; those migrations are applied. |
| Docker build cache (146 entries, none in use) | 9.3G | `docker builder prune -af`. The next `ship.sh` build runs cold. |
| journald | 130M | `journalctl --vacuum-size=200M` (283M to 153M). |
| apt cache | 394M | `apt-get clean`. |
| DB: `VACUUM FULL ANALYZE dwelling_noise` | 21M | 178M to 157M, 5.5 s lock. |
| DB: `VACUUM (ANALYZE)` on `metric_value` (4.3M dead rows), `metric_value_breakdown`, `factor_utility` | 0 on disk | Dead rows become reusable space inside the files. |

## Kept

- `pre-england-2026-10-22.dump` (newest full dump) and every dump or backup made after it: `pre-fix-ranks`, `pre-116-schema`, `backup-117-street`, `backup-118-school`, `pre-119`, `pre-121`, `pre-122-123`, `pre-125/126-functions`.
- `england-2026-10/` (686M): loaded after the newest full dump, so it is the only copy outside the live DB.
- `a3-check/` (recent, 10-26), `/srv/backups` (daily user-data backups, 1M), `/tmp` (55M, other sessions' scratch).
- `/srv/close-knit-tiles` (39M): both PMTiles sets are served.
- Docker images: nothing dangling. `martin` (869M, not run in prod) and `python:3.12-slim` (loaders) are tagged and left. All 5 volumes belong to the stack.

## DB findings, no change

- DB is 38G. `metric_value` is 16G (5.8G heap, about 10G in its three indexes); 20.8M of its 25.5M rows are `src-ons-census-2021-layers-england`.
- `metric_value` has one row per (geography, metric, period), so old product releases hold no row data there. `product_release` and `product_release_member` are immutable by trigger; there is no cleanup path for old release rows, and nothing to gain.
- No `*_old`, `*_bak`, `*_tmp` or staging tables. Five tables have no reference in `api/` or `web/` (`flood_water`, `lad_region`, `property_transaction`, `agency_company`, `agency_google_place`, 3M in all); pipelines, migrations or plans still use them, so they stay.
- `VACUUM FULL metric_value` is not allowed: 16G is more than a third of free space. `REINDEX CONCURRENTLY` on its indexes may give back several GB if needed later.

## Checks after

`https://getcloseknit.com/` 200, `/api/v1/scope` 200, `/area/borough/E09000007` 200, `/area/msoa/E02000166` 200, all six `/tiles/*.pmtiles` 206 on a range request.

## Second pass: `metric_value` reindex and fresh full dump (afternoon)

Free space on `/` (bytes from `df -B1`, GiB in brackets):

| Step | Free |
|---|---|
| Before reindex | 41,976,586,240 (39.1G) |
| After reindex + `VACUUM ANALYZE` | 48,077,459,456 (44.8G) |
| After full dump | 42G (`df -h`; the dump takes 3.3G) |

`REINDEX INDEX CONCURRENTLY`, one index at a time, smallest first, `maintenance_work_mem=1GB`, with a free-space gate (index size + 10G) before each:

| Index | Before | After | Time |
|---|---|---|---|
| `metric_value_metric_release_period_idx` | 229 MB | 189 MB | 89 s |
| `metric_value_pkey` | 4356 MB | 1912 MB | 194 s |
| `metric_value_lookup_idx` | 5561 MB | 1948 MB | 169 s |

- All three indexes valid after, no `_ccnew`/`_ccold` leftovers. `VACUUM ANALYZE metric_value` took 2 s.
- `metric_value` total 16G to 9.6G (heap 5.7G). DB 38G to 32.2G.
- The API stayed up: `/api/v1/scope` from inside `deploy-api-1` was probed every 30 s during each reindex, 13 of 13 answered 200 in about 0.04 s.

Full dump: `pg_dump -Fc` run inside `deploy-database-1` under `nice -n 10 ionice -c2 -n7`, streamed to `/srv/close-knit-data/full-2026-10-27.dump` (3,575,885,608 bytes, 3.3G, 11.6 min). Checked with `pg_restore -l` in a throwaway `postgis/postgis:18-3.6` container with the folder mounted read-only: 1019 entries, 168 `TABLE DATA` (the 10-22 dump had 153), `metric_value` data present.

Not done, left for the owner (both are permanent deletes):

- `pre-england-2026-10-22.dump` (2.1G) is now superseded by `full-2026-10-27.dump`; delete it to keep only the newest full dump: `rm /srv/close-knit-data/pre-england-2026-10-22.dump`. Every partial dump stays, `pre-128-release-tables` included.
- Docker volume `deploy_close-knit-api-cache` (1.1G on disk, created 10-23): no container, running or stopped, mounts it, and no compose file on `origin/main` or on the host names it. Remove with `docker volume rm deploy_close-knit-api-cache`.

Scripts and logs on the host: `~/ops-2026-10-27/` (`reindex.sh`, `reindex.log`, `dump.sh`, `dump.log`, `full-2026-10-27.toc`).
