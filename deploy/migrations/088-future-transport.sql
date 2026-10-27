-- 088: Future transport, loaded by deploy/tools/etl_future_transport.py from the curated
-- deploy/tools/future_transport.yaml (every scheme cites a TfL, GLA or DfT page).
--
--   future_transport       one row per new station: its scheme, mode, a point placed from the official
--                          page, the scheme's status and its expected year where one is published
--   area_future_transport  per LSOA, MSOA and borough: the nearest new station of any status, measured
--                          from the middle of each LSOA (an MSOA or borough takes its closest LSOA)
--
-- The map layer `future-station-distance` (km to the nearest station under construction or consented)
-- goes to metric_value; its metric_definition row is upserted by the load, which owns the source release
-- the row points at. Plans change: a proposed scheme is stored and shown as proposed, never as coming.
--
-- Safe to run again.

CREATE TABLE IF NOT EXISTS future_transport (
    id text PRIMARY KEY,                     -- "<scheme id>/<station slug>", e.g. "blx/old-kent-road-1"
    scheme text NOT NULL,                    -- "Bakerloo line extension"
    mode text NOT NULL,                      -- tube, rail, elizabeth-line, overground, dlr, tram
    station text NOT NULL,                   -- "Old Kent Road 1"
    point geometry(Point, 4326) NOT NULL,
    status text NOT NULL CHECK (status IN ('under construction', 'consented', 'funded', 'proposed')),
    expected_year smallint CHECK (expected_year IS NULL OR expected_year BETWEEN 2020 AND 2100),
    source_url text NOT NULL CHECK (source_url ~ '^https://'),
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS future_transport_point_gix ON future_transport USING gist (point);

CREATE TABLE IF NOT EXISTS area_future_transport (
    geography_id text PRIMARY KEY REFERENCES area_geography(id) ON DELETE CASCADE,
    station_id text NOT NULL REFERENCES future_transport(id) ON DELETE CASCADE,
    nearest_station text NOT NULL,
    distance_m integer NOT NULL CHECK (distance_m >= 0),
    status text NOT NULL CHECK (status IN ('under construction', 'consented', 'funded', 'proposed')),
    expected_year smallint,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
