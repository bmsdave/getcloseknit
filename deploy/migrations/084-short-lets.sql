-- Short lets, loaded by deploy/tools/etl_short_lets.py from Inside Airbnb's London snapshot
-- (insideairbnb.com, CC BY 4.0):
--   area_short_let  per LSOA, MSOA and borough: Airbnb listings, those that are entire homes, those
--                   with a review in the last 12 months, Census 2021 households, listings per 1,000
-- Listing points are counted into LSOAs at load and never stored; nothing about a host or a listing
-- is kept. MSOAs and boroughs are sums of their LSOAs, so the levels always agree. The map layer is
-- the `short-lets-per-1000` metric (metric_definition and metric_value rows written by the ETL under
-- its source release, as every map metric).

CREATE TABLE IF NOT EXISTS area_short_let (
    geography_id text PRIMARY KEY REFERENCES area_geography(id) ON DELETE CASCADE,
    listings integer NOT NULL CHECK (listings >= 0),
    entire_home integer NOT NULL CHECK (entire_home >= 0 AND entire_home <= listings),
    active_12m integer NOT NULL CHECK (active_12m >= 0 AND active_12m <= listings),  -- a review in 12 months
    homes integer NOT NULL CHECK (homes >= 0),                                         -- Census 2021 households
    per_1000_homes real CHECK (per_1000_homes >= 0),                                   -- NULL without homes
    source_release_id text NOT NULL REFERENCES source_release(id)
);
