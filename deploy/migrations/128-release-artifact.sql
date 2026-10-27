-- 128: derived data materialised per release (2026-10-27, docs/review-2026-10 finding A11, task #17). Safe to run
-- again; apply with psql --single-transaction -v ON_ERROR_STOP=1. A new table only: nothing is rebuilt.
--
-- What the API derives from a release and serves to everyone alike (school pools and comparison groups, borough and
-- MSOA standouts, the sections' region lists, ready-made criteria and ranking lenses, the area tree, value packs,
-- boxes and roll-ups) was recomputed by warm_* threads inside each API process after every restart and kept in
-- module caches. It is now built once per release by `python -m area_api.release_build` (deploy/ship.sh before the
-- new API starts, RELEASE-CHECKLIST.md after an activation) and read by primary key (api/area_api/release_store.py).
-- A key the build did not cover is built by the first request that needs it and stored for every API process.
--
-- release_artifact  one row per release, build, kind and key.
--   build   what made the body: "payload-v<N>" for answers sent as built (value packs, boxes, preset packs: plain
--           values, kept across deploys until N is bumped for a new shape), "py-<hash of area_api's files>" for
--           Python objects, so a deploy never reads objects another version of the code made.
--   kind    what it is (school-pool, borough-standouts, pack, ...); key: the rest of the key (metric, period, scope).
--   body    the value pickled and zlib-compressed (exactly what was built), written only by the API and its build
--           step.
-- The build step keeps the active and previous releases' rows, its own builds and the newest other build of each kind
-- (the serving API's while a deploy builds the next one); a deleted release takes its rows with it.

CREATE TABLE IF NOT EXISTS release_artifact (
    release_id text NOT NULL REFERENCES product_release (id) ON DELETE CASCADE,
    build text NOT NULL,
    kind text NOT NULL,
    key text NOT NULL,
    body bytea NOT NULL,
    built_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (release_id, build, kind, key)
);

-- The body is compressed already: keep it out of line without compressing it again.
ALTER TABLE release_artifact ALTER COLUMN body SET STORAGE EXTERNAL;
